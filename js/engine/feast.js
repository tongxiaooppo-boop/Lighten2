// 輕盈計畫 (Lighten Plan) — 大餐預約/確認/取消
// 對照 TECH-SPEC 4.6、PRD 6.2–6.4。預約/記錄大餐只負責寫 daily_log / feast_reservation，
// 長期熱量盈餘交給體重趨勢自動校正（js/engine/tdee.js），本檔不再有週彈性帳本結算。

(function () {
  "use strict";

  // 小/中/大份量 → 估算 kcal（對照 TECH-SPEC 3.11 範例 S=400/M=700/L=1200），僅供「不指定品項」時用
  const FEAST_SIZE_KCAL = { S: 400, M: 700, L: 1200 };

  function round1(n) { return Math.round(n * 10) / 10; }

  // 2026-09-25 修正（Opus 二輪審查）：台式品項現在也回傳 protein_g/carb_g/fat_g/fiber_g
  // （原本只有自訂食物有），避免 checkHardConstraints 算出的蛋白質/纖維缺口失真。
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
    // 預約只寫進 feast_reservation；tab-today.js 的 buildRecommendation() 會把它當成
    // 「這個時段大概會吃這麼多」納入當天剩餘配額，等於事先幫其他還沒吃的時段重新分配預算。
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
    // 直接寫進 daily_log 就結束了，daily_log 就是所有攝取的唯一真相來源。
    return await addDailyLog(entry);
  }

  // 2026-09-25 新增（Opus 二輪審查指出完全沒有撤銷機制）：撤銷一筆用 logFeastDirectly 直接寫入的
  // daily_log 記錄，單純刪掉這筆紀錄。只處理「直接記錄」（feast_reservation_id 為 null）的情況；
  // 有關聯預約的紀錄請走 cancelFeast。
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
    // 確認後寫進 daily_log，並把預約狀態改為 confirmed。
    await updateFeastStatus(reservationId, "confirmed", daylogId);
    return res;
  }

  async function cancelFeast(reservationId) {
    const reservations = await getFeastReservations();
    const res = reservations.find(function (r) { return r.id === reservationId; });
    if (!res) return null;

    // 預約本來就沒有寫進 daily_log（只有確認/直接記錄才會），取消只要改狀態即可。
    await updateFeastStatus(reservationId, "cancelled");
    return res;
  }

  window.reserveFeast = reserveFeast;
  window.logFeastDirectly = logFeastDirectly;
  window.undoDailyLog = undoDailyLog;
  window.confirmFeast = confirmFeast;
  window.cancelFeast = cancelFeast;
  window.resolveFeastItem = resolveFeastItem;
  window.FEAST_SIZE_KCAL = FEAST_SIZE_KCAL;
})();
