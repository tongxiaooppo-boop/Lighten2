// 輕盈計畫 (Lighten Plan) — 日總額 × 週彈性點數：今日餐次配額動態重算
// 對照 TECH-SPEC 4.3、PRD 5.1。此檔只做「今日預算重算」，不碰週彈性點數（那是 feast.js 的事）。

(function () {
  "use strict";

  const SLOTS = ["breakfast", "lunch", "afternoon_tea", "dinner", "snack"];

  // 無紀錄時的預設切分比例（PRD 5.1：早20%／午30%／下午茶10%／晚30%／宵夜10%）
  const DEFAULT_WEIGHTS = {
    breakfast: 0.20,
    lunch: 0.30,
    afternoon_tea: 0.10,
    dinner: 0.30,
    snack: 0.10,
  };

  // 今日建議時段的預設開關（早/午/晚預設開啟，下午茶/宵夜預設關閉）。
  // 這是唯一來源，tab-profile.js／tab-today.js 都引用 window.DEFAULT_ENABLED_SLOTS，
  // 避免「勾選框顯示的預設值」跟「實際判斷用的預設值」兩邊各存一份、以後改一邊忘了改另一邊。
  const DEFAULT_ENABLED_SLOTS = { breakfast: true, lunch: true, afternoon_tea: false, dinner: true, snack: false };

  function isSlotEnabled(enabledSlots, slot) {
    const slots = enabledSlots || {};
    return slots.hasOwnProperty(slot) ? slots[slot] !== false : DEFAULT_ENABLED_SLOTS[slot];
  }

  // 分配邏輯（報告會說明）：
  // - 已吃餐次：配額回傳 0（不再顯示）。
  // - 未吃餐次：把「剩餘熱量」依各餐次的「預設權重」在未吃餐次之間做相對加權分配。
  //   例：吃完早餐後，剩餘熱量按 午0.35/晚0.30/宵0.10 的相對比例分給這三餐。
  // - 吃越多 → remainingKcal 越小；未吃餐次越少 → 每餐分越多。
  function recalcTodayBudget(targetKcal, todayLogs, enabledSlots) {
    const target = Number(targetKcal);
    const base = isFinite(target) && target > 0 ? target : 0;
    const logs = Array.isArray(todayLogs) ? todayLogs : [];

    const eatenKcal = { breakfast: 0, lunch: 0, afternoon_tea: 0, dinner: 0, snack: 0 };
    const eatenSlots = {};

    // 被關閉的時段（含完全沒存過 enabled_slots 時套用 DEFAULT_ENABLED_SLOTS）視同「已處理」，
    // 排除在未吃餐次的權重分配之外
    SLOTS.forEach(function (s) {
      if (!isSlotEnabled(enabledSlots, s)) eatenSlots[s] = true;
    });

    logs.forEach(function (log) {
      if (!log || !DEFAULT_WEIGHTS.hasOwnProperty(log.slot)) return;
      eatenSlots[log.slot] = true;
      eatenKcal[log.slot] += Number(log.kcal) || 0;
    });

    const totalEaten = SLOTS.reduce(function (sum, s) {
      return sum + eatenKcal[s];
    }, 0);
    const remainingKcal = Math.max(0, base - totalEaten);

    const uneatenSlots = SLOTS.filter(function (s) {
      return !eatenSlots[s];
    });
    const totalWeight = uneatenSlots.reduce(function (sum, s) {
      return sum + DEFAULT_WEIGHTS[s];
    }, 0);

    const perSlotSuggestion = { breakfast: 0, lunch: 0, afternoon_tea: 0, dinner: 0, snack: 0 };
    if (totalWeight > 0) {
      uneatenSlots.forEach(function (s) {
        perSlotSuggestion[s] = remainingKcal * (DEFAULT_WEIGHTS[s] / totalWeight);
      });
    }

    return {
      remainingKcal: round1(remainingKcal),
      perSlotSuggestion: {
        breakfast: round1(perSlotSuggestion.breakfast),
        lunch: round1(perSlotSuggestion.lunch),
        afternoon_tea: round1(perSlotSuggestion.afternoon_tea),
        dinner: round1(perSlotSuggestion.dinner),
        snack: round1(perSlotSuggestion.snack),
      },
    };
  }

  function round1(n) {
    return Math.round(n * 10) / 10;
  }

  window.recalcTodayBudget = recalcTodayBudget;
  window.DEFAULT_ENABLED_SLOTS = DEFAULT_ENABLED_SLOTS;
  window.isSlotEnabled = isSlotEnabled;
})();
