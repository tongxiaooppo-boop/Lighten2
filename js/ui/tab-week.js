// 輕盈計畫 (Lighten Plan) — 分頁四：本週總覽
// 依賴：database.js（getProfile/getDailyLogs/getWeeklyLedger）、nutrition.js（calculateTargets）、feast.js（computeWeeklyCapKcal）
// 原則：只顯示「週平均是否仍在目標內」的中性總結，不做逐日評判性呈現。

(function () {
  "use strict";

  const WEEKDAY = ["週一", "週二", "週三", "週四", "週五", "週六", "週日"];

  function ready(fn) {
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", fn);
    else fn();
  }

  function $(sel) { return document.querySelector(sel); }

  function escapeHtml(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  function round1(n) { return Math.round(n * 10) / 10; }

  function fmt(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return y + "-" + m + "-" + day;
  }

  function localDateStr() { return fmt(new Date()); }

  function dateAddDays(dateStr, days) {
    const d = new Date(dateStr + "T00:00:00");
    d.setDate(d.getDate() + days);
    return fmt(d);
  }

  function mondayOfThisWeek() {
    const d = new Date();
    const day = d.getDay();
    const diff = day === 0 ? 6 : day - 1;
    d.setDate(d.getDate() - diff);
    return fmt(d);
  }

  function diffDays(a, b) {
    const da = new Date(a + "T00:00:00");
    const db = new Date(b + "T00:00:00");
    return Math.round((db - da) / 86400000);
  }

  function shortDate(dateStr) {
    return dateStr ? dateStr.slice(5).replace("-", "/") : "";
  }

  // 週平均熱量狀態：只用中性/正向字眼，不用負面詞。
  function calStatus(avg, target) {
    if (!target || target <= 0) return "本週平均熱量已記錄";
    const diffPct = ((avg - target) / target) * 100;
    if (diffPct > 5) return "本週平均熱量略高於目標";
    if (diffPct < -5) return "本週平均熱量略低於目標";
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

  async function render() {
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
      targets = calculateTargets(profile);
    } catch (err) {
      console.error(err);
      if (status) status.textContent = "計算目標失敗。";
      return;
    }

    const weekStart = mondayOfThisWeek();
    const weekEnd = dateAddDays(weekStart, 6);
    const today = localDateStr();
    const daysElapsed = Math.min(7, Math.max(1, diffDays(weekStart, today) + 1));

    let logs;
    try {
      logs = await getDailyLogs({ start: weekStart, end: weekEnd });
    } catch (err) {
      console.error(err);
      if (status) status.textContent = "讀取本週紀錄失敗。";
      return;
    }

    const byDate = {};
    let totalKcal = 0;
    let totalProtein = 0;
    let totalFiber = 0;
    logs.forEach(function (l) {
      const d = l.log_date;
      if (!byDate[d]) byDate[d] = { kcal: 0, protein: 0, fiber: 0 };
      byDate[d].kcal += Number(l.kcal) || 0;
      byDate[d].protein += Number(l.protein_g) || 0;
      byDate[d].fiber += Number(l.fiber_g) || 0;
      totalKcal += Number(l.kcal) || 0;
      totalProtein += Number(l.protein_g) || 0;
      totalFiber += Number(l.fiber_g) || 0;
    });

    const avgKcal = totalKcal / daysElapsed;
    const avgProtein = totalProtein / daysElapsed;
    const avgFiber = totalFiber / daysElapsed;

    // 彈性點數剩餘：讀 weekly_flex_ledger；若尚無 ledger，用 computeWeeklyCapKcal 當上限。
    let cap = null;
    let used = 0;
    try {
      const ledger = await getWeeklyLedger(weekStart);
      if (ledger && ledger.cap_kcal != null) cap = ledger.cap_kcal;
      if (ledger) used = ledger.used_kcal || 0;
    } catch (err) {
      console.error(err);
    }
    if (cap == null) {
      try {
        cap = computeWeeklyCapKcal(profile);
      } catch (err) {
        cap = 0;
      }
    }
    const remaining = Math.max(0, (cap || 0) - used);

    const calEl = $("#week-cal-summary");
    if (calEl) {
      if (logs.length === 0) {
        calEl.textContent = "本週尚無攝取紀錄";
      } else {
        calEl.textContent = calStatus(avgKcal, targets.targetKcal) +
          "（週平均 " + Math.round(avgKcal) + "／目標 " + Math.round(targets.targetKcal) + " kcal）";
      }
    }

    const proteinPct = pct(avgProtein, targets.protein_g);
    const fiberPct = pct(avgFiber, targets.fiber_g);

    const proteinEl = $("#week-protein");
    if (proteinEl) {
      proteinEl.textContent = "蛋白質：週平均 " + round1(avgProtein) + " g／目標 " + round1(targets.protein_g) + " g" +
        (proteinPct == null ? "" : "（達成率 " + proteinPct + "%）");
    }

    const fiberEl = $("#week-fiber");
    if (fiberEl) {
      fiberEl.textContent = "膳食纖維：週平均 " + round1(avgFiber) + " g／目標 " + round1(targets.fiber_g) + " g" +
        (fiberPct == null ? "" : "（達成率 " + fiberPct + "%）");
    }

    const flexEl = $("#week-flex");
    if (flexEl) {
      flexEl.textContent = "彈性點數：剩餘 " + Math.round(remaining) + "／上限 " + Math.round(cap || 0) + " kcal";
    }

    renderDays(byDate, weekStart, daysElapsed);

    if (status) status.textContent = "";
  }

  ready(render);
})();
