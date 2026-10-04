// 輕盈計畫 — 今日建議的預約（日期切換，PRD 第 1、3 節；decisions #140–#142；設計草案第 9 節）。
// 讀預約（getMealPlans 只准這個檔案，章程 C4.10：預約不進統計與校正）→ 解析（saved-ctx 帶我的食材，fail-closed）→
// 今天：有效的預約變成暫時紀錄給 planToday；未來：只算已排的合計熱量。寫入：記下、取消預約、這餐不吃。

import { getMealPlans, setMealPlan, deleteMealPlan, purgeOldMealPlans, addDailyLog } from "../data/db.js";
import { dateAddDays } from "../core/dates.js";
import { loadSavedMealCtx } from "./saved-ctx.js";
import {
  resolvePlan, planPseudoLog, skippedLogEntry, savedMealDraft, buildDraftContent, contentTotals, buildLogEntry,
  savedMealUnavailableLine, logsKcal, PLAN_SKIP_CONTENT,
} from "../engine/meal-content.js";
import { nowIso } from "./clock.js";

// 一天的預約逐筆解析。回傳 { [slot]: { plan, result, pseudo, unavailable } }；ctx 讀不到時每筆都當失效（不扣預算、照常推薦）
export async function loadDayPlans(date, oilHabit) {
  const plans = await getMealPlans({ start: date, end: date });
  if (plans.length === 0) return {};
  let c = null;
  try { c = await loadSavedMealCtx({ slot: null }); } catch (err) { console.error(err); }
  const out = {};
  plans.forEach(function (plan) {
    let result;
    try {
      result = c ? resolvePlan(plan, c.catalog, c.ctx, oilHabit) : { status: "invalid", resolved: null, totals: null };
    } catch (err) {
      console.error(err);
      result = { status: "invalid", resolved: null, totals: null };
    }
    out[plan.slot] = {
      plan: plan, result: result, pseudo: planPseudoLog(plan, result),
      unavailable: result.status === "invalid" ? (result.resolved && savedMealUnavailableLine(result.resolved)) || "這個預約目前不能用" : null,
      catalog: c ? c.catalog : null,
    };
  });
  return out;
}

// 今天的暫時紀錄（已有紀錄的時段不算，由 engine effectiveTodayLogs 處理）
export function pseudoLogsOf(dayPlans) {
  return Object.keys(dayPlans).map(function (slot) { return dayPlans[slot].pseudo; }).filter(Boolean);
}

// 已排的合計熱量（未來日子頂端那一行；失效的不算）
export function plannedSummary(dayPlans) {
  const logs = pseudoLogsOf(dayPlans);
  return { count: logs.length, kcal: logsKcal(logs) };
}

// 今天按「記下」：預約 → 一筆 daily_log（from_plan；預約不吃 → skipped）。預約留著，紀錄優先顯示（PRD 6.1）
// today：寫進哪一天（今天，或昨天卡片的昨天）；realToday 省略＝today
export async function logPlanEntry(entry, today, oilHabit, realToday) {
  const plan = entry.plan;
  const bound = { today: realToday || today };
  if (entry.result.status === "skip") return addDailyLog(skippedLogEntry(today, plan.slot, nowIso()), bound);
  if (entry.result.status !== "ok") throw new Error("[today-plans.js] 失效的預約不能記下");
  const content = buildDraftContent(savedMealDraft(entry.result.resolved), { oilHabit: oilHabit });
  const totals = contentTotals(content, entry.catalog);
  return addDailyLog(buildLogEntry({
    date: today, slot: plan.slot, source: "from_plan", name: plan.name, content: content, totals: totals, createdAt: nowIso(),
  }), bound);
}

// 日期列的小點：範圍內哪幾天有預約
export async function planDatesInRange(start, end) {
  const out = {};
  (await getMealPlans({ start: start, end: end })).forEach(function (p) { out[p.date] = true; });
  return out;
}

// 未來日子預約「這餐不吃」（decisions #141③）
export function setSkipPlan(date, slot) {
  return setMealPlan({ date: date, slot: slot, name: "這餐不吃", content: JSON.parse(JSON.stringify(PLAN_SKIP_CONTENT)) });
}

export function cancelPlan(id) {
  return deleteMealPlan(id);
}

// 今天「這餐不吃」（decisions #141①）
export function skipToday(today, slot) {
  return addDailyLog(skippedLogEntry(today, slot, nowIso()), { today: today });
}

// 開今日建議時清掉昨天以前的預約（昨天的留給「昨天的餐」）；失敗不擋畫面（讀取一律用日期範圍，清不清都不影響顯示）
export function purgePlans(today) {
  return purgeOldMealPlans(dateAddDays(today, -1)).catch(function (err) { console.error(err); });
}
