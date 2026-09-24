// 輕盈計畫 (Lighten Plan) — 分頁五：運動紀錄（獨立頁面）
// 依賴：database.js（addExerciseLog / getExerciseLogs）
// 原則：僅記錄運動項目/時長/強度，不做熱量換算；版面與文案與飲食/大餐完全隔離。

(function () {
  "use strict";

  const INTENSITY_LABELS = { 低: "低強度", 中: "中強度", 高: "高強度" };

  function ready(fn) {
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", fn);
    else fn();
  }

  function $(sel) { return document.querySelector(sel); }

  function escapeHtml(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

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

  // 連續紀錄天數：從今天往回算，每天都有至少一筆記錄。
  // 今天尚未記錄不算中斷（從昨天起算）；一旦遇到中斷天即停止。
  function computeStreak(logs) {
    const days = {};
    logs.forEach(function (l) {
      if (l && l.log_date) days[l.log_date] = true;
    });

    let streak = 0;
    let cursor = localDateStr();
    if (!days[cursor]) cursor = dateAddDays(cursor, -1);
    while (days[cursor]) {
      streak += 1;
      cursor = dateAddDays(cursor, -1);
    }
    return streak;
  }

  function renderStreak(logs) {
    const el = $("#exercise-streak");
    if (!el) return;
    const streak = computeStreak(logs);
    el.textContent = streak > 0 ? "連續紀錄 " + streak + " 天" : "尚未開始連續紀錄";
  }

  function renderList(logs) {
    const container = $("#exercise-history");
    if (!container) return;
    const sorted = logs.slice().sort(function (a, b) {
      const byDate = String(b.log_date).localeCompare(String(a.log_date));
      if (byDate !== 0) return byDate;
      return String(b.id || "").localeCompare(String(a.id || ""));
    });
    if (sorted.length === 0) {
      container.innerHTML = '<p class="rec-empty">尚無運動紀錄</p>';
      return;
    }
    container.innerHTML = sorted.map(function (r) {
      const intensityLabel = INTENSITY_LABELS[r.intensity] || r.intensity || "";
      return '<div class="exercise-item">' +
        '<div class="exercise-item-info">' +
        '<span class="exercise-item-title">' + escapeHtml(r.activity_type || "") + "</span>" +
        '<span class="exercise-item-meta">' + escapeHtml(r.log_date) + " · " + escapeHtml(r.duration_min) + " 分鐘 · " + escapeHtml(intensityLabel) + "</span>" +
        "</div>" +
        "</div>";
    }).join("");
  }

  async function render() {
    const status = $("#exercise-status");
    try {
      const logs = await getExerciseLogs();
      renderStreak(logs);
      renderList(logs);
      if (status) status.textContent = "";
    } catch (err) {
      console.error(err);
      if (status) status.textContent = "讀取運動紀錄失敗。";
    }
  }

  async function onSubmit(e) {
    e.preventDefault();
    const form = document.getElementById("exercise-form");
    const fd = new FormData(form);
    const log_date = fd.get("log_date");
    const activity_type = (fd.get("activity_type") || "").trim();
    const duration_min = parseInt(fd.get("duration_min"), 10);
    const intensity = fd.get("intensity");

    if (!log_date) { alert("請選擇日期。"); return; }
    if (!activity_type) { alert("請填寫運動項目。"); return; }
    if (!isFinite(duration_min) || duration_min <= 0) { alert("請填寫正確的時長（分鐘）。"); return; }

    try {
      await addExerciseLog({
        log_date: log_date,
        activity_type: activity_type,
        duration_min: duration_min,
        intensity: intensity,
      });
      form.elements["activity_type"].value = "";
      form.elements["duration_min"].value = "";
      await render();
    } catch (err) {
      console.error(err);
      alert("記錄失敗，請重試。");
    }
  }

  ready(function () {
    const dateInput = document.querySelector("#exercise-form input[name='log_date']");
    if (dateInput) dateInput.value = localDateStr();

    const form = document.getElementById("exercise-form");
    if (form) form.addEventListener("submit", onSubmit);

    render();
  });
})();
