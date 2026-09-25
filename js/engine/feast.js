// 輕盈計畫 (Lighten Plan) — 大餐預約/確認/取消 + 超額攤還（週彈性帳本）
// 對照 TECH-SPEC 4.6、PRD 6.2–6.4。cap_kcal 只依 goal_mode 與熱量赤字換算，不讀運動資料。

(function () {
  "use strict";

  // 小/中/大份量 → 估算 kcal（對照 TECH-SPEC 3.11 範例 S=400/M=700/L=1200）
  const FEAST_SIZE_KCAL = { S: 400, M: 700, L: 1200 };
  const CUT_CAP_RATIO = 0.4; // 減脂：取週熱量赤字的 40% 當週彈性上限
  const FLEX_CAP_FIXED = 1400; // 維持/增肌：固定額度（約 1 餐大份大餐 + 小彈性）

  function round1(n) { return Math.round(n * 10) / 10; }

  function fmt(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return y + "-" + m + "-" + day;
  }

  function weekStartOf(dateStr) {
    const d = new Date(dateStr + "T00:00:00");
    if (isNaN(d.getTime())) return dateStr;
    const day = d.getDay(); // 0=Sun
    const diff = day === 0 ? 6 : day - 1;
    d.setDate(d.getDate() - diff);
    return fmt(d);
  }

  function computeWeeklyCapKcal(profile) {
    const goal = (profile && profile.goal_mode) || "維持";
    if (goal === "減脂" || goal === "cut") {
      const t = calculateTargets(profile);
      const weeklyDeficit = (t.tdee - t.targetKcal) * 7;
      return Math.round(weeklyDeficit * CUT_CAP_RATIO);
    }
    return FLEX_CAP_FIXED;
  }

  // 2026-09-25 修正（Opus 二輪審查）：
  // - 台式品項現在也回傳 protein_g/carb_g/fat_g/fiber_g（原本只有自訂食物有），避免 checkHardConstraints
  //   算出的蛋白質/纖維缺口失真。
  // - 新增 usesFlex：只有「大餐類」（taiwan_items.uses_flex===true）才消耗週彈性點數；健康品項
  //   （無糖豆漿、地瓜等）跟自訂食物、小/中/大估算，各自依規則決定要不要動用彈性點數，見下方三個分支。
  async function resolveFeastItem(itemId, size) {
    let estimatedKcal = null;
    let itemName = null;
    let sourceType = null; // 'taiwan_item' | 'custom' | null
    let proteinG = null;
    let carbG = null;
    let fatG = null;
    let fiberG = null;
    let usesFlex = true; // 預設 true：小/中/大估算、自訂食物都視為使用者自己判斷要記的「額外」餐點

    if (itemId) {
      const taiwanItems = await getTaiwanItems();
      const taiwanItem = taiwanItems.find(function (it) { return it.id === itemId; });
      if (taiwanItem) {
        estimatedKcal = taiwanItem.kcal_rep != null ? taiwanItem.kcal_rep : round1((taiwanItem.kcal_low + taiwanItem.kcal_high) / 2);
        itemName = taiwanItem.name;
        sourceType = "taiwan_item";
        proteinG = taiwanItem.protein_g != null ? taiwanItem.protein_g : null;
        fiberG = taiwanItem.fiber_g != null ? taiwanItem.fiber_g : null;
        usesFlex = taiwanItem.uses_flex !== false; // 台式品項依資料裡的 uses_flex 決定，缺欄位時保守當 true
      } else {
        const customFoods = await getCustomFoods();
        const customFood = customFoods.find(function (f) { return f.id === itemId; });
        if (customFood) {
          estimatedKcal = customFood.kcal;
          itemName = customFood.name;
          sourceType = "custom";
          proteinG = customFood.protein_g != null ? customFood.protein_g : null;
          fiberG = customFood.fiber_g != null ? customFood.fiber_g : null;
          usesFlex = true; // 使用者自己在「預約大餐/直接記錄」流程輸入，視為額外餐點
        }
      }
    }
    if (estimatedKcal == null) {
      estimatedKcal = FEAST_SIZE_KCAL.hasOwnProperty(size) ? FEAST_SIZE_KCAL[size] : FEAST_SIZE_KCAL.M;
      usesFlex = true; // 小/中/大估算本來就是走大餐流程，一律消耗彈性點數
    }
    return {
      kcal: estimatedKcal,
      name: itemName,
      sourceType: sourceType,
      protein_g: proteinG,
      carb_g: carbG,
      fat_g: fatG,
      fiber_g: fiberG,
      usesFlex: usesFlex,
    };
  }

  async function reserveFeast(planDate, slot, size, itemId) {
    const profile = await getProfile();
    const resolved = await resolveFeastItem(itemId, size);

    const entry = {
      plan_date: planDate,
      slot: slot,
      size: itemId ? null : size,
      item_id: itemId || null,
      item_name: resolved.name,
      estimated_kcal: resolved.kcal,
      uses_flex: resolved.usesFlex,
      status: "reserved",
    };
    const saved = await addFeastReservation(entry);

    if (resolved.usesFlex) {
      const weekStart = weekStartOf(planDate);
      const ledger = await getWeeklyLedger(weekStart);
      const cap = ledger && ledger.cap_kcal != null ? ledger.cap_kcal : computeWeeklyCapKcal(profile);
      const prevUsed = ledger ? (ledger.used_kcal || 0) : 0;
      await updateWeeklyLedger(weekStart, prevUsed + resolved.kcal, cap);
    }

    return saved;
  }

  async function logFeastDirectly(planDate, slot, size, itemId) {
    const resolved = await resolveFeastItem(itemId, size);
    const profile = await getProfile();

    const entry = {
      log_date: planDate,
      slot: slot,
      source_type: resolved.sourceType || "custom",
      item_id: itemId || null,
      item_name: resolved.name,
      kcal: resolved.kcal,
      protein_g: resolved.protein_g,
      carb_g: resolved.carb_g,
      fat_g: resolved.fat_g,
      fiber_g: resolved.fiber_g,
      is_feast: 1,
      feast_reservation_id: null,
      uses_flex: resolved.usesFlex,
    };
    const saved = await addDailyLog(entry);

    if (resolved.usesFlex) {
      const weekStart = weekStartOf(planDate);
      const ledger = await getWeeklyLedger(weekStart);
      const cap = ledger && ledger.cap_kcal != null ? ledger.cap_kcal : computeWeeklyCapKcal(profile);
      const prevUsed = ledger ? (ledger.used_kcal || 0) : 0;
      await updateWeeklyLedger(weekStart, prevUsed + resolved.kcal, cap);
    }

    return saved;
  }

  // 2026-09-25 新增（Opus 二輪審查指出完全沒有撤銷機制）：撤銷一筆用 logFeastDirectly 直接寫入的
  // daily_log 記錄——刪掉這筆紀錄，如果當初有消耗彈性點數（uses_flex===true）就退回去。
  // 只處理「直接記錄」（feast_reservation_id 為 null）的情況；有關聯預約的紀錄請走 cancelFeast。
  async function undoDailyLog(dailyLogId) {
    const logs = await getDailyLogs();
    const entry = logs.find(function (l) { return l.id === dailyLogId; });
    if (!entry) return null;
    if (entry.feast_reservation_id) {
      throw new Error("[feast.js] 這筆記錄關聯到一筆預約，請改用取消預約。");
    }

    await removeDailyLog(dailyLogId);

    if (entry.is_feast && entry.uses_flex) {
      const weekStart = weekStartOf(entry.log_date);
      const ledger = await getWeeklyLedger(weekStart);
      if (ledger) {
        const newUsed = Math.max(0, (ledger.used_kcal || 0) - (Number(entry.kcal) || 0));
        await updateWeeklyLedger(weekStart, newUsed, ledger.cap_kcal);
      }
    }
    return entry;
  }

  async function confirmFeast(reservationId, actualDailyLogEntry) {
    const reservations = await getFeastReservations();
    const res = reservations.find(function (r) { return r.id === reservationId; });
    if (!res) return null;

    const actual = actualDailyLogEntry || {};
    const actualKcal = Number(actual.kcal) || res.estimated_kcal || 0;

    let daylogId = actual.id;
    if (!daylogId) {
      const entry = Object.assign({}, actual, {
        kcal: actualKcal,
        is_feast: 1,
        feast_reservation_id: reservationId,
        log_date: actual.log_date || res.plan_date,
        slot: actual.slot || res.slot,
      });
      daylogId = (await addDailyLog(entry)).id;
    }
    await updateFeastStatus(reservationId, "confirmed", daylogId);

    const weekStart = weekStartOf(res.plan_date);
    const ledger = await getWeeklyLedger(weekStart);
    if (ledger) {
      const newUsed = Math.max(0, (ledger.used_kcal || 0) - (res.estimated_kcal || 0) + actualKcal);
      await updateWeeklyLedger(weekStart, newUsed, ledger.cap_kcal);
    }
    return res;
  }

  async function cancelFeast(reservationId) {
    const reservations = await getFeastReservations();
    const res = reservations.find(function (r) { return r.id === reservationId; });
    if (!res) return null;

    await updateFeastStatus(reservationId, "cancelled");

    const weekStart = weekStartOf(res.plan_date);
    const ledger = await getWeeklyLedger(weekStart);
    if (ledger) {
      const newUsed = Math.max(0, (ledger.used_kcal || 0) - (res.estimated_kcal || 0));
      await updateWeeklyLedger(weekStart, newUsed, ledger.cap_kcal);
    }
    return res;
  }

  function planOverageSmoothing(overageKcal, upcomingDaysBudget, safetyFloor) {
    const raw = Array.isArray(upcomingDaysBudget) ? upcomingDaysBudget : [];
    const days = raw.map(function (d, i) {
      if (typeof d === "number") return { date: "day" + (i + 1), budget: d };
      return { date: d.date || ("day" + (i + 1)), budget: Number(d.budget) || 0 };
    });
    const floor = Number(safetyFloor) || 0;
    const DAILY_CAP_PCT = 0.15; // 單日攤還幅度上限 15%
    const MAX_DAYS = 3; // 1–3 天攤還

    let remaining = Math.max(0, Number(overageKcal) || 0);
    const appliedDates = [];
    let smoothingDays = 0;

    for (let i = 0; i < Math.min(days.length, MAX_DAYS) && remaining > 0; i++) {
      const budget = days[i].budget;
      if (budget <= 0) continue;
      const capacity = Math.min(budget * DAILY_CAP_PCT, Math.max(0, budget - floor));
      if (capacity <= 0) continue;
      const reduce = Math.min(capacity, remaining);
      remaining -= reduce;
      smoothingDays++;
      appliedDates.push({ date: days[i].date, reduce_kcal: round1(reduce), new_budget: round1(budget - reduce) });
    }

    return {
      smoothingDays: smoothingDays,
      dailyCapPct: DAILY_CAP_PCT,
      appliedDates: appliedDates,
      remainingKcal: round1(remaining),
    };
  }

  window.reserveFeast = reserveFeast;
  window.logFeastDirectly = logFeastDirectly;
  window.undoDailyLog = undoDailyLog;
  window.confirmFeast = confirmFeast;
  window.cancelFeast = cancelFeast;
  window.planOverageSmoothing = planOverageSmoothing;
  window.computeWeeklyCapKcal = computeWeeklyCapKcal;
  window.FEAST_SIZE_KCAL = FEAST_SIZE_KCAL;
})();
