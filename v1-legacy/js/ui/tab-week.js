// 輕盈計畫 (Lighten Plan) — 分頁四：本週總覽
// 依賴：database.js（getProfile/getDailyLogs）、nutrition.js（calculateTargets）、tdee.js（getCalibratedTargets）
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

  // 週平均熱量狀態：中性描述，不加「略」這類會在差很多時失準的修飾（2026-09-27 整案審查第 5 節）。
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
      targets = await getCalibratedTargets(profile);
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
    const logsByDate = {};
    logs.forEach(function (l) {
      const d = l.log_date;
      if (!byDate[d]) byDate[d] = { kcal: 0, protein: 0, fiber: 0 };
      byDate[d].kcal += Number(l.kcal) || 0;
      byDate[d].protein += Number(l.protein_g) || 0;
      byDate[d].fiber += Number(l.fiber_g) || 0;
      if (!logsByDate[d]) logsByDate[d] = [];
      logsByDate[d].push(l);
    });

    // 平均只算「完整記錄日」（所有開啟時段都有記錄）且不含今天，跟「近7天平均」同一套規則。
    // 原本除以含今天在內的所有天數，週一早上就會顯示「低於目標」（2026-09-27 整案審查第 5 節）。
    const completeDates = Object.keys(logsByDate).filter(function (d) {
      return d < today && isCompleteLogDay(logsByDate[d], profile.enabled_slots);
    });
    const nComplete = completeDates.length;
    function avgOf(key) {
      if (nComplete === 0) return 0;
      return completeDates.reduce(function (s, d) { return s + byDate[d][key]; }, 0) / nComplete;
    }
    const avgKcal = avgOf("kcal");
    const avgProtein = avgOf("protein");
    const avgFiber = avgOf("fiber");

    const calEl = $("#week-cal-summary");
    if (calEl) {
      if (nComplete === 0) {
        calEl.textContent = "本週還沒有完整記錄的日子（當天所有開啟時段都有記錄才算，今天不算）";
      } else {
        calEl.textContent = calStatus(avgKcal, targets.targetKcal) +
          "（" + nComplete + " 個完整記錄日平均 " + Math.round(avgKcal) + "／目標 " + Math.round(targets.targetKcal) + " kcal）";
      }
    }

    const proteinPct = pct(avgProtein, targets.protein_g);
    const fiberPct = pct(avgFiber, targets.fiber_g);

    const proteinEl = $("#week-protein");
    if (proteinEl && nComplete === 0) proteinEl.textContent = "蛋白質：—";
    else if (proteinEl) {
      proteinEl.textContent = "蛋白質：週平均 " + round1(avgProtein) + " g／目標 " + round1(targets.protein_g) + " g" +
        (proteinPct == null ? "" : "（達成率 " + proteinPct + "%）");
    }

    const fiberEl = $("#week-fiber");
    if (fiberEl && nComplete === 0) fiberEl.textContent = "膳食纖維：—";
    else if (fiberEl) {
      fiberEl.textContent = "膳食纖維：週平均 " + round1(avgFiber) + " g／目標 " + round1(targets.fiber_g) + " g" +
        (fiberPct == null ? "" : "（達成率 " + fiberPct + "%）");
    }

    const flexEl = $("#week-flex");
    if (flexEl) {
      let recent;
      try {
        const sevenAgo = dateAddDays(today, -7); // 近7天平均不含今天，窗口往前多抓一天
        const recentLogs = await getDailyLogs({ start: sevenAgo, end: today });
        recent = computeRecentAvgVsTarget(recentLogs, targets.targetKcal, profile.enabled_slots, 7);
      } catch (err) {
        console.error(err);
        recent = { status: "insufficient" };
      }
      flexEl.textContent = recent.status === "ok"
        ? "近7天平均 " + Math.round(recent.avgKcal) + "／目標 " + Math.round(recent.targetKcal) + " kcal"
        : "近7天平均：資料不足";
    }

    renderDays(byDate, weekStart, daysElapsed);

    if (status) status.textContent = "";
  }

  ready(function () {
    document.addEventListener("tab:activated", function (e) {
      if (e.detail === "week") render();
    });
    render();
  });
})();
