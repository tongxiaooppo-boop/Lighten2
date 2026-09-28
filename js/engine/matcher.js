// 輕盈計畫 (Lighten Plan) — 蛋白質(日)／纖維(週日均) 硬約束缺口計算
// 對照 TECH-SPEC 4.4、PRD 5.6。回傳值供 recommend.js 優先安排高蛋白/高纖組合。
// 紀錄是 daily_log 格式（營養合計在 totals）；今天日期由呼叫端傳入（章程 C1.1）。

import { FIBER_FLOOR_G } from "../core/config.js";
import { round1 } from "../core/num.js";
import { proteinPerKg } from "./nutrition.js";
import { isCompleteLogDay } from "./budget.js";

export function checkHardConstraints(weekLogs, profile, today) {
  const logs = Array.isArray(weekLogs) ? weekLogs : [];
  const weightKg = Number((profile && profile.weight_kg) || 0);

  const proteinTarget = proteinPerKg(profile) * weightKg;

  let todayProtein = 0;
  const logsByDate = {};

  logs.forEach(function (log) {
    if (!log) return;
    if (log.log_date === today) {
      todayProtein += Number(log.totals.protein_g) || 0;
    }
    if (log.log_date) {
      if (!logsByDate[log.log_date]) logsByDate[log.log_date] = [];
      logsByDate[log.log_date].push(log);
    }
  });

  // 蛋白質缺口：目標 − 今日已攝取；已達標回傳 0（不做負缺口）
  let proteinGapToday = proteinTarget - todayProtein;
  if (proteinGapToday < 0) proteinGapToday = 0;

  // 纖維週日均：只算「完整記錄日」（所有開啟時段都有記錄）且不含今天，跟 budget.js 的近7天平均同一套規則。
  const enabledSlots = profile ? profile.enabled_slots : null;
  const dates = Object.keys(logsByDate).filter(function (d) {
    return d < today && isCompleteLogDay(logsByDate[d], enabledSlots);
  });
  const avgFiber =
    dates.length > 0
      ? dates.reduce(function (sum, d) {
          return sum + logsByDate[d].reduce(function (s, l) { return s + (Number(l.totals.fiber_g) || 0); }, 0);
        }, 0) / dates.length
      : 0;
  const fiberGapThisWeek = avgFiber < FIBER_FLOOR_G ? FIBER_FLOOR_G - avgFiber : 0;

  return {
    proteinGapToday: round1(proteinGapToday),
    fiberGapThisWeek: round1(fiberGapThisWeek),
  };
}
