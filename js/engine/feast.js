// 輕盈計畫 (Lighten Plan) — 大餐預約/確認/取消 + 週彈性帳本結算
// 對照 TECH-SPEC 4.6、PRD 6.2–6.4。cap_kcal 只依 goal_mode 與熱量赤字換算，不讀運動資料。
//
// 2026-09-25 二輪重構（Opus 三輪磋商，使用者質疑「彈性點數該看實際總量超標，不是靠食物標籤」後改版）：
// 舊設計是幫食物貼「uses_flex」標籤，吃到標記的品項才扣點數，跟「今天實際攝取有沒有超過每日預算」
// 完全脫鉤，而且扣款邏輯本身也有 bug（扣整份熱量、不是超出預算的部分）。新設計拿掉 uses_flex，
// 彈性帳本改成「每天結算」：daily_log 已經是所有攝取的唯一真相來源（含大餐），不用再另外記帳——
// settleWeeklyLedger() 逐日結算「目標 vs 實際」，超過記進 used_kcal、低於目標存一點點回去（有上限、
// 有安全下限保護，避免鼓勵報復性節食）。reserveFeast/logFeastDirectly/confirmFeast/cancelFeast
// 不再直接碰 weekly_flex_ledger，只負責寫 daily_log/feast_reservation，帳本完全是結算算出來的。

(function () {
  "use strict";

  // 小/中/大份量 → 估算 kcal（對照 TECH-SPEC 3.11 範例 S=400/M=700/L=1200），僅供「不指定品項」時用
  const FEAST_SIZE_KCAL = { S: 400, M: 700, L: 1200 };
  const CUT_CAP_RATIO = 0.4; // 減脂：取週熱量赤字的 40% 當週彈性「警戒上限」（超過就在畫面提醒，不是硬性擋下）
  const FLEX_CAP_FIXED = 1400; // 維持/增肌：固定額度
  const DAILY_SAVE_CAP_RATIO = 0.15; // 單日最多能把「吃得比預算少」的部分存回彈性額度的比例
  const SETTLE_SLOTS = ["breakfast", "lunch", "afternoon_tea", "dinner", "snack"];

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

  // 2026-09-25 修正（Opus 二輪審查）：台式品項現在也回傳 protein_g/carb_g/fat_g/fiber_g
  // （原本只有自訂食物有），避免 checkHardConstraints 算出的蛋白質/纖維缺口失真。
  // 2026-09-25 二輪重構移除 usesFlex：彈性帳本改成逐日結算（見檔案開頭說明），不用再幫食物分「會不會扣點數」。
  async function resolveFeastItem(itemId, size) {
    let estimatedKcal = null;
    let itemName = null;
    let sourceType = null; // 'taiwan_item' | 'custom' | null
    let proteinG = null;
    let carbG = null;
    let fatG = null;
    let fiberG = null;

    if (itemId) {
      const taiwanItems = await getTaiwanItems();
      const taiwanItem = taiwanItems.find(function (it) { return it.id === itemId; });
      if (taiwanItem) {
        estimatedKcal = taiwanItem.kcal_rep != null ? taiwanItem.kcal_rep : round1((taiwanItem.kcal_low + taiwanItem.kcal_high) / 2);
        itemName = taiwanItem.name;
        sourceType = "taiwan_item";
        proteinG = taiwanItem.protein_g != null ? taiwanItem.protein_g : null;
        fiberG = taiwanItem.fiber_g != null ? taiwanItem.fiber_g : null;
      } else {
        const customFoods = await getCustomFoods();
        const customFood = customFoods.find(function (f) { return f.id === itemId; });
        if (customFood) {
          estimatedKcal = customFood.kcal;
          itemName = customFood.name;
          sourceType = "custom";
          proteinG = customFood.protein_g != null ? customFood.protein_g : null;
          fiberG = customFood.fiber_g != null ? customFood.fiber_g : null;
        }
      }
    }
    if (estimatedKcal == null) {
      estimatedKcal = FEAST_SIZE_KCAL.hasOwnProperty(size) ? FEAST_SIZE_KCAL[size] : FEAST_SIZE_KCAL.M;
    }
    return {
      kcal: estimatedKcal,
      name: itemName,
      sourceType: sourceType,
      protein_g: proteinG,
      carb_g: carbG,
      fat_g: fatG,
      fiber_g: fiberG,
    };
  }

  async function reserveFeast(planDate, slot, size, itemId) {
    const resolved = await resolveFeastItem(itemId, size);

    const entry = {
      plan_date: planDate,
      slot: slot,
      size: itemId ? null : size,
      item_id: itemId || null,
      item_name: resolved.name,
      estimated_kcal: resolved.kcal,
      status: "reserved",
    };
    // 2026-09-25 二輪重構：預約不再直接扣彈性點數（帳本改逐日結算），但預約會被
    // tab-today.js 的 buildRecommendation() 當成「這個時段大概會吃這麼多」納入當天剩餘配額計算，
    // 等於「事先幫其他還沒吃的時段/時間重新分配預算」，跟使用者的原意（不要用標籤判斷，看實際總量）一致。
    return await addFeastReservation(entry);
  }

  async function logFeastDirectly(planDate, slot, size, itemId) {
    const resolved = await resolveFeastItem(itemId, size);

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
    };
    // 直接寫進 daily_log 就結束了，不用另外扣彈性點數——daily_log 本身就是結算時的資料來源，
    // 隔天 settleWeeklyLedger() 結算昨天時會自然把這筆熱量算進去。
    return await addDailyLog(entry);
  }

  // 2026-09-25 新增（Opus 二輪審查指出完全沒有撤銷機制）：撤銷一筆用 logFeastDirectly 直接寫入的
  // daily_log 記錄，單純刪掉這筆紀錄。只處理「直接記錄」（feast_reservation_id 為 null）的情況；
  // 有關聯預約的紀錄請走 cancelFeast。（2026-09-25 二輪重構：不用再退彈性點數，帳本是結算算出來的，
  // 只要當天還沒結算過，刪掉記錄後續結算自然不會算到它；如果已經結算過的舊日期記錄被撤銷，
  // 差額會在下一次改動觸發重新結算時反映，這是已知的簡化，重新結算過去日期不在這輪範圍內。）
  async function undoDailyLog(dailyLogId) {
    const logs = await getDailyLogs();
    const entry = logs.find(function (l) { return l.id === dailyLogId; });
    if (!entry) return null;
    if (entry.feast_reservation_id) {
      throw new Error("[feast.js] 這筆記錄關聯到一筆預約，請改用取消預約。");
    }

    await removeDailyLog(dailyLogId);
    return entry;
  }

  async function confirmFeast(reservationId, actualDailyLogEntry) {
    const reservations = await getFeastReservations();
    const res = reservations.find(function (r) { return r.id === reservationId; });
    if (!res) return null;

    const actual = actualDailyLogEntry || {};
    // 2026-09-25 修正既有 bug（使用者實測本週總覽發現蛋白質/纖維永遠是0）：UI 上的「確認」按鈕
    // 呼叫 confirmFeast 時不會帶 actualDailyLogEntry，先前寫死只用 actual 的欄位，導致寫進 daily_log
    // 的 protein_g/carb_g/fat_g/fiber_g 全部是 undefined。改成用 resolveFeastItem 依預約當初的
    // item_id/size 查回巨量營養素當預設值，actual 有明確帶值時才覆蓋（保留給以後「真的輸入實際攝取」用）。
    const resolved = await resolveFeastItem(res.item_id, res.size);
    const actualKcal = Number(actual.kcal) || res.estimated_kcal || resolved.kcal || 0;

    let daylogId = actual.id;
    if (!daylogId) {
      const entry = Object.assign(
        {
          item_name: resolved.name || res.item_name,
          source_type: resolved.sourceType || "custom",
          item_id: res.item_id || null,
          protein_g: resolved.protein_g,
          carb_g: resolved.carb_g,
          fat_g: resolved.fat_g,
          fiber_g: resolved.fiber_g,
        },
        actual,
        {
          kcal: actualKcal,
          is_feast: 1,
          feast_reservation_id: reservationId,
          log_date: actual.log_date || res.plan_date,
          slot: actual.slot || res.slot,
        }
      );
      daylogId = (await addDailyLog(entry)).id;
    }
    // 2026-09-25 二輪重構：確認不用再改彈性點數，daily_log 寫進去之後結算時自然算得到。
    await updateFeastStatus(reservationId, "confirmed", daylogId);
    return res;
  }

  async function cancelFeast(reservationId) {
    const reservations = await getFeastReservations();
    const res = reservations.find(function (r) { return r.id === reservationId; });
    if (!res) return null;

    // 2026-09-25 二輪重構：預約本來就沒有寫進 daily_log（只有確認/直接記錄才會），
    // 取消不用再退彈性點數，帳本從一開始就沒被這筆預約動過。
    await updateFeastStatus(reservationId, "cancelled");
    return res;
  }

  function safetyFloorFor(profile) {
    const gender = profile && profile.gender;
    return gender === "male" ? 1500 : 1200;
  }

  // 結算「一天」：目標 vs 實際攝取。實際攝取的定義兼顧「使用者可能沒有每餐都記」——
  // 如果當天所有開啟的時段都有記錄（完整結算），直接比對實際總量；
  // 只要有任何時段沒記錄，就假設沒記錄的部分「大致照計畫吃」（=目標值），只在已記錄的部分
  // 已經超過目標時才算超標（這種情況不管有沒有全部記錄都藏不住），避免因為漏記被錯誤判定成「存到點數」。
  async function computeDaySettlement(dateStr, profile, targetKcal) {
    const logs = await getDailyLogs({ start: dateStr, end: dateStr });
    const totalEaten = logs.reduce(function (s, l) { return s + (Number(l.kcal) || 0); }, 0);
    const enabledList = SETTLE_SLOTS.filter(function (s) { return isSlotEnabled(profile.enabled_slots, s); });
    const loggedSlots = {};
    logs.forEach(function (l) { if (l && l.slot) loggedSlots[l.slot] = true; });
    const fullyLogged = enabledList.length > 0 && enabledList.every(function (s) { return loggedSlots[s]; });
    const assumedTotal = fullyLogged ? totalEaten : Math.max(totalEaten, targetKcal);
    const delta = targetKcal - assumedTotal; // >0 表示低於目標（可能可以存一點）；<=0 表示達標或超標

    if (delta > 0) {
      const floor = safetyFloorFor(profile);
      const effectiveActual = Math.max(assumedTotal, floor); // 吃得比安全下限還少的那一段不算存款
      const deposit = Math.min(Math.max(0, targetKcal - effectiveActual), targetKcal * DAILY_SAVE_CAP_RATIO);
      return { deposit: deposit, overage: 0 };
    }
    return { deposit: 0, overage: -delta };
  }

  // 逐日把「昨天以前、還沒結算過」的日子結算進 weekly_flex_ledger。用 settings 存一個全域的
  // 「結算到哪一天」游標（跨週），每次呼叫都從游標隔天補到昨天為止，今天還沒過完不結算。
  // 第一次呼叫（沒有游標紀錄）不會回頭結算使用者過去所有歷史，直接把游標設到昨天，避免
  // 舊資料被一次性拿來罰款或加碼獎勵，使用者感受不到這是「新機制」還誤以為帳本突然爆掉。
  async function settleWeeklyLedger(profile) {
    const today = fmt(new Date());
    let lastSettled = await getSetting("ledger_last_settled_date");
    if (!lastSettled) {
      const y = new Date();
      y.setDate(y.getDate() - 1);
      lastSettled = fmt(y);
      await setSetting("ledger_last_settled_date", lastSettled);
      return;
    }

    const targets = calculateTargets(profile);
    const targetKcal = targets.targetKcal;

    let cursor = fmt(new Date(new Date(lastSettled + "T00:00:00").getTime() + 86400000));
    while (cursor < today) {
      const weekStart = weekStartOf(cursor);
      const settlement = await computeDaySettlement(cursor, profile, targetKcal);
      const ledger = await getWeeklyLedger(weekStart);
      const cap = ledger && ledger.cap_kcal != null ? ledger.cap_kcal : computeWeeklyCapKcal(profile);
      const prevUsed = ledger ? (ledger.used_kcal || 0) : 0;
      const newUsed = Math.max(0, prevUsed - settlement.deposit + settlement.overage);
      await updateWeeklyLedger(weekStart, newUsed, cap);
      await setSetting("ledger_last_settled_date", cursor);
      cursor = fmt(new Date(new Date(cursor + "T00:00:00").getTime() + 86400000));
    }
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
  window.settleWeeklyLedger = settleWeeklyLedger;
  window.FEAST_SIZE_KCAL = FEAST_SIZE_KCAL;
})();
