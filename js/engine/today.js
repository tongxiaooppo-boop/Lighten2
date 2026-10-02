// 輕盈計畫 — 今日建議的純流程：預算重算 → 蛋白質/纖維缺口 → 跳過已記錄/已關閉的時段 → 推薦。
// 資料由 ui/tab-today.js 讀好傳入（章程 C1.1）。

import { SLOTS, isSlotEnabled } from "../core/slots.js";
import { recalcTodayBudget } from "./budget.js";
import { checkHardConstraints } from "./matcher.js";
import { getTodayRecommendation } from "./recommend.js";
import { withoutHidden } from "./pool.js";

// 今天的有效預約（meal-content.js planPseudoLog 產生的暫時紀錄）併進紀錄：已有真紀錄的時段，預約不算（紀錄優先，PRD 第 1 節）。
// 只給預算、推薦、全天缺口用（章程 C4.10：預約不進統計與校正）。
export function effectiveTodayLogs(todayLogs, todayPlans) {
  const logged = {};
  (todayLogs || []).forEach(function (l) { logged[l.slot] = true; });
  return (todayLogs || []).concat((todayPlans || []).filter(function (p) { return p && !logged[p.slot]; }));
}

// o = { profile, targets, todayLogs, weekLogs（本週一到今天）, feedbackMap, pool, today, nowMs, todayPlans? }
// todayPlans 沒給（或空）時跟日期切換之前逐字相同
export function planToday(o) {
  const profile = o.profile;
  const plans = effectiveTodayLogs(o.todayLogs, o.todayPlans).slice((o.todayLogs || []).length);
  const effLogs = o.todayLogs.concat(plans);
  const remainingBudget = recalcTodayBudget(o.targets.targetKcal, effLogs, profile.enabled_slots);
  const hardConstraints = checkHardConstraints(o.weekLogs.concat(plans), profile, o.today);

  // 已記錄、已關閉的時段都不需要推薦；已記錄的餐吃過的東西由 loggedContents 佔住跨時段不重複的名額（decisions #39）。
  const logsBySlot = {};
  o.todayLogs.forEach(function (l) {
    if (!logsBySlot[l.slot]) logsBySlot[l.slot] = [];
    logsBySlot[l.slot].push(l);
  });
  const plannedSlots = {};
  plans.forEach(function (p) { plannedSlots[p.slot] = p; });
  const skipSlots = {};
  SLOTS.forEach(function (slot) {
    if (logsBySlot[slot] || plannedSlots[slot] || !isSlotEnabled(profile.enabled_slots, slot)) skipSlots[slot] = true;
  });

  const recs = getTodayRecommendation({
    pool: withoutHidden(o.pool, o.hiddenUids), // 使用者隱藏的內建品項（PRD 10.2；缺＝不過濾）
    feedbackMap: o.feedbackMap,
    remainingBudget: remainingBudget,
    hardConstraints: hardConstraints,
    mealPrefs: profile.meal_prefs,
    dietRestriction: profile.diet_restriction,
    allergens: profile.allergens,
    skipSlots: skipSlots,
    dislikedIngredients: profile.disliked_ingredients,
    lowCarb: !!profile.low_carb,
    oilHabit: profile.oil_habit || "normal",
    loggedContents: effLogs.map(function (l) { return l.content; }),
    nowMs: o.nowMs,
  });

  const out = { remainingBudget: remainingBudget, hardConstraints: hardConstraints, skipSlots: skipSlots, logsBySlot: logsBySlot, recs: recs };
  if (plans.length > 0) {
    out.plannedSlots = plannedSlots;
    out.plannedKcal = plans.reduce(function (s, p) { return s + (p.totals && isFinite(p.totals.kcal) ? p.totals.kcal : 0); }, 0);
  }
  return out;
}
