// 輕盈計畫 (Lighten Plan) — 分頁四：本週總覽
// 原則：只顯示「週平均是否仍在目標內」的中性總結，不做逐日評判性呈現。

import { dateAddDays, diffDays, mondayOf, shortDate } from "../core/dates.js";
import { escapeHtml } from "../core/html.js";
import { $ } from "./dom.js";
import { round1 } from "../core/num.js";
import { getProfile, getDailyLogs } from "../data/db.js";
import { summarizeWeek, computeRecentAvgVsTarget } from "../engine/budget.js";
import { getCalibratedTargets } from "./calibration.js";
import { todayStr } from "./clock.js";

const WEEKDAY = ["週一", "週二", "週三", "週四", "週五", "週六", "週日"];

// 週平均熱量狀態：中性描述，不加「略」這類會在差很多時失準的修飾。
function calStatus(avg, target) {
  if (!target || target <= 0) return "本週平均熱量已記錄";
  const diffPct = ((avg - target) / target) * 100;
  if (diffPct > 5) return "本週平均熱量高於目標";
  if (diffPct < -5) return "本週平均熱量低於目標";
  return "本週平均熱量在目標範圍內";
}

function pct(actual, target) {
  if (!target || target <= 0) return null;
  return Math.round((actual / target) * 100);
}

function renderDays(byDate, weekStart, daysElapsed) {
  const container = $("#week-days");
  if (!container) return;
  if (daysElapsed <= 0) {
    container.innerHTML = '<p class="rec-empty">本週尚無紀錄</p>';
    return;
  }
  const rows = [];
  for (let i = 0; i < daysElapsed; i++) {
    const dateStr = dateAddDays(weekStart, i);
    const rec = byDate[dateStr];
    const label = WEEKDAY[i % 7] + " " + shortDate(dateStr);
    if (rec) {
      rows.push('<div class="week-day-item">' +
        '<span class="week-day-label">' + escapeHtml(label) + "</span>" +
        '<span class="week-day-value">' + escapeHtml(Math.round(rec.kcal)) + " kcal</span>" +
        "</div>");
    } else {
      rows.push('<div class="week-day-item">' +
        '<span class="week-day-label">' + escapeHtml(label) + "</span>" +
        '<span class="week-day-value week-day-empty">尚無紀錄</span>' +
        "</div>");
    }
  }
  container.innerHTML = rows.join("");
}

export async function renderWeek() {
  const status = $("#week-status");

  let profile;
  try {
    profile = await getProfile();
  } catch (err) {
    console.error(err);
    if (status) status.textContent = "讀取基本資料失敗。";
    return;
  }
  if (!profile) {
    if (status) status.textContent = "請先到「基本資料」分頁填寫並按「計算」。";
    return;
  }

  let targets;
  try {
    targets = await getCalibratedTargets(profile);
  } catch (err) {
    console.error(err);
    if (status) status.textContent = "計算目標失敗。";
    return;
  }

  const today = todayStr();
  const weekStart = mondayOf(today);
  const weekEnd = dateAddDays(weekStart, 6);
  const daysElapsed = Math.min(7, Math.max(1, diffDays(weekStart, today) + 1));

  let logs;
  try {
    logs = await getDailyLogs({ start: weekStart, end: weekEnd });
  } catch (err) {
    console.error(err);
    if (status) status.textContent = "讀取本週紀錄失敗。";
    return;
  }

  const week = summarizeWeek(logs, profile.enabled_slots, today);
  const nComplete = week.nComplete;

  const calEl = $("#week-cal-summary");
  if (calEl) {
    if (nComplete === 0) {
      calEl.textContent = "本週還沒有完整記錄的日子（當天所有開啟時段都有記錄才算，今天不算）";
    } else {
      calEl.textContent = calStatus(week.avgKcal, targets.targetKcal) +
        "（" + nComplete + " 個完整記錄日平均 " + Math.round(week.avgKcal) + "／目標 " + Math.round(targets.targetKcal) + " kcal）";
    }
  }

  // 平均只算這一欄有資料的完整記錄日；有日子因為缺資料沒算進去時，註明算了幾天
  function nutrientLine(label, avg, days, target) {
    if (nComplete === 0) return label + "：—";
    if (avg == null) return label + "：—（完整記錄日的紀錄都沒有這項資料）";
    const p = pct(avg, target);
    return label + "：週平均 " + round1(avg) + " g／目標 " + round1(target) + " g" +
      (p == null ? "" : "（達成率 " + p + "%）") +
      (days < nComplete ? "（" + days + " 天有資料）" : "");
  }
  const proteinEl = $("#week-protein");
  if (proteinEl) proteinEl.textContent = nutrientLine("蛋白質", week.avgProtein, week.proteinDays, targets.protein_g);
  const fiberEl = $("#week-fiber");
  if (fiberEl) fiberEl.textContent = nutrientLine("膳食纖維", week.avgFiber, week.fiberDays, targets.fiber_g);

  const flexEl = $("#week-flex");
  if (flexEl) {
    let recent;
    try {
      const recentLogs = await getDailyLogs({ start: dateAddDays(today, -7), end: today }); // 近7天平均不含今天，窗口往前多抓一天
      recent = computeRecentAvgVsTarget(recentLogs, targets.targetKcal, profile.enabled_slots, 7, today);
    } catch (err) {
      console.error(err);
      recent = { status: "insufficient" };
    }
    flexEl.textContent = recent.status === "ok"
      ? "近7天平均 " + Math.round(recent.avgKcal) + "／目標 " + Math.round(recent.targetKcal) + " kcal"
      : "近7天平均：資料不足";
  }

  renderDays(week.byDate, weekStart, daysElapsed);

  if (status) status.textContent = "";
}

export function initWeekTab() {
  document.addEventListener("tab:activated", function (e) {
    if (e.detail === "week") renderWeek();
  });
  renderWeek();
}
