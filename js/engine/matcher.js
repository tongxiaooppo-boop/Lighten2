// 輕盈計畫 (Lighten Plan) — 蛋白質(日)／纖維(週日均) 硬約束缺口計算
// 對照 TECH-SPEC 4.4、PRD 5.6。回傳值供 recommend.js 優先安排高蛋白/高纖組合。
// 紀錄是 daily_log 格式（營養合計在 totals）；今天日期由呼叫端傳入（章程 C1.1）。

import { FIBER_FLOOR_G } from "../core/config.js";
import { round1 } from "../core/num.js";
import { proteinPerKg } from "./nutrition.js";
import { isCompleteLogDay } from "./budget.js";
import { sumKnownLogTotals, sumLogTotals } from "./meal-content.js";

export function checkHardConstraints(weekLogs, profile, today) {
  const logs = Array.isArray(weekLogs) ? weekLogs : [];
  const weightKg = Number((profile && profile.weight_kg) || 0);

  const proteinTarget = (profile ? proteinPerKg(profile) : 1.8) * weightKg;

  const logsByDate = {};

  logs.forEach(function (log) {
    if (!log) return;
    if (log.log_date) {
      if (!logsByDate[log.log_date]) logsByDate[log.log_date] = [];
      logsByDate[log.log_date].push(log);
    }
  });

  // 蛋白質缺口：目標 − 今日已攝取；已達標回傳 0（不做負缺口）。
  // 蛋白質未知的一餐不算「已經吃到」（只加已知部分，缺口偏大、往安全方向）。
  const todayProtein = sumKnownLogTotals(logsByDate[today] || [], "protein_g").sum;
  let proteinGapToday = proteinTarget - todayProtein;
  if (proteinGapToday < 0) proteinGapToday = 0;

  // 纖維週日均：只算「完整記錄日」（所有開啟時段都有記錄）且不含今天，跟 budget.js 的近7天平均同一套規則。
  const enabledSlots = profile ? profile.enabled_slots : null;
  // 某天有一餐纖維未知，那天的纖維就是未知，不列入平均。
  const dayFibers = Object.keys(logsByDate).filter(function (d) {
    return d < today && isCompleteLogDay(logsByDate[d], enabledSlots);
  }).map(function (d) { return sumLogTotals(logsByDate[d], "fiber_g"); }).filter(function (v) { return v != null; });
  const avgFiber =
    dayFibers.length > 0
      ? dayFibers.reduce(function (sum, v) { return sum + v; }, 0) / dayFibers.length
      : 0;
  const fiberGapThisWeek = avgFiber < FIBER_FLOOR_G ? FIBER_FLOOR_G - avgFiber : 0;

  return {
    proteinGapToday: round1(proteinGapToday),
    fiberGapThisWeek: round1(fiberGapThisWeek),
  };
}
