// 輕盈計畫 — 今日建議的純流程：預算重算 → 蛋白質/纖維缺口 → 跳過已記錄/已關閉的時段 → 推薦。
// 資料由 ui/tab-today.js 讀好傳入（章程 C1.1）。

import { SLOTS, isSlotEnabled } from "../core/slots.js";
import { recalcTodayBudget } from "./budget.js";
import { checkHardConstraints } from "./matcher.js";
import { getTodayRecommendation } from "./recommend.js";

// o = { profile, targets, todayLogs, weekLogs（本週一到今天）, feedbackMap, pool, today, nowMs }
export function planToday(o) {
  const profile = o.profile;
  const remainingBudget = recalcTodayBudget(o.targets.targetKcal, o.todayLogs, profile.enabled_slots);
  const hardConstraints = checkHardConstraints(o.weekLogs, profile, o.today);

  // 已記錄、已關閉的時段都不需要推薦，也不該佔用跨時段不重複的名額。
  const logsBySlot = {};
  o.todayLogs.forEach(function (l) {
    if (!logsBySlot[l.slot]) logsBySlot[l.slot] = [];
    logsBySlot[l.slot].push(l);
  });
  const skipSlots = {};
  SLOTS.forEach(function (slot) {
    if (logsBySlot[slot] || !isSlotEnabled(profile.enabled_slots, slot)) skipSlots[slot] = true;
  });

  const recs = getTodayRecommendation({
    pool: o.pool,
    feedbackMap: o.feedbackMap,
    remainingBudget: remainingBudget,
    hardConstraints: hardConstraints,
    mealPrefs: profile.meal_prefs,
    dietRestriction: profile.diet_restriction,
    allergens: profile.allergens,
    skipSlots: skipSlots,
    dislikedIngredients: profile.disliked_ingredients,
    lowCarb: !!profile.low_carb,
    nowMs: o.nowMs,
  });

  return { remainingBudget: remainingBudget, hardConstraints: hardConstraints, skipSlots: skipSlots, logsBySlot: logsBySlot, recs: recs };
}
