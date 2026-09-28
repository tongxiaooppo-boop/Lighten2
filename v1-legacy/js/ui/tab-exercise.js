// 輕盈計畫 (Lighten Plan) — 分頁五：運動紀錄（獨立頁面）
// 依賴：database.js（addExerciseLog / getExerciseLogs）
// 原則：僅記錄運動項目/時長/強度，不做熱量換算；版面與文案與飲食/大餐完全隔離。

(function () {
  "use strict";

  const INTENSITY_LABELS = { 低: "低強度", 中: "中強度", 高: "高強度" };

  // 每種運動項目的「一般典型強度」，選項目時自動帶出強度，避免使用者選出不合理組合
  // （例如「散步」配「高強度」）。使用者仍可自行覆蓋（例如真的在爬坡快走）。
  const ACTIVITY_DEFAULT_INTENSITY = {
    "散步": "低",
    "快走": "中",
    "慢跑": "高",
    "腳踏車": "中",
    "游泳": "中",
    "羽毛球": "中",
    "籃球": "高",
    "重訓": "中",
    "瑜伽": "低",
  };

  // 本週活動量參考：WHO/ACSM 一般性建議，跟飲食熱量完全脫鉤、跟 goal_mode 也無關。
  const WEEKLY_ACTIVITY_TARGET = { moderateMinutes: 150, strengthDays: 2 };
  const INTENSITY_MULTIPLIER = { "低": 0, "中": 1, "高": 2 }; // 低強度不計入 150 分鐘累計，另外顯示

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

  function mondayOfThisWeek() {
    const d = new Date();
    const day = d.getDay();
    const diff = day === 0 ? 6 : day - 1;
    d.setDate(d.getDate() - diff);
    return fmt(d);
  }

  function computeWeeklyActivity(logs) {
    let moderateMinutes = 0;
    let lightMinutes = 0;
    const strengthDates = {};
    logs.forEach(function (l) {
      if (!l) return;
      if (l.activity_type === "重訓") {
        strengthDates[l.log_date] = true;
        return;
      }
      const mult = INTENSITY_MULTIPLIER.hasOwnProperty(l.intensity) ? INTENSITY_MULTIPLIER[l.intensity] : 1;
      if (mult === 0) {
        lightMinutes += Number(l.duration_min) || 0;
      } else {
        moderateMinutes += (Number(l.duration_min) || 0) * mult;
      }
    });
    return {
      moderateMinutes: Math.round(moderateMinutes),
      lightMinutes: Math.round(lightMinutes),
      strengthDays: Object.keys(strengthDates).length,
    };
  }

  let intensityManuallyEdited = false;

  function syncIntensityFromActivity() {
    if (intensityManuallyEdited) return;
    const select = document.querySelector("#exercise-form select[name='activity_type_preset']");
    const intensitySelect = document.querySelector("#exercise-form select[name='intensity']");
    if (!select || !intensitySelect) return;
    const def = ACTIVITY_DEFAULT_INTENSITY[select.value];
    if (def) intensitySelect.value = def;
  }

  function onPresetChange() {
    const select = document.querySelector("#exercise-form select[name='activity_type_preset']");
    const customField = $("#exercise-custom-activity-field");
    if (!select || !customField) return;
    if (select.value === "其他") {
      customField.hidden = false;
    } else {
      customField.hidden = true;
      const customInput = document.querySelector("#exercise-form [name='activity_type_custom']");
      if (customInput) customInput.value = "";
    }
    syncIntensityFromActivity();
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

  async function renderWeeklyActivity() {
    const el = $("#exercise-weekly-activity-text");
    if (!el) return;
    const weekStart = mondayOfThisWeek();
    const today = localDateStr();
    let logs;
    try {
      logs = await getExerciseLogs({ start: weekStart, end: today });
    } catch (err) {
      console.error(err);
      el.textContent = "";
      return;
    }
    const stats = computeWeeklyActivity(logs);
    let text = "本週已活動 " + stats.moderateMinutes + " 分鐘（目標 " + WEEKLY_ACTIVITY_TARGET.moderateMinutes + " 分鐘）・肌力訓練 " + stats.strengthDays + " 天（目標 " + WEEKLY_ACTIVITY_TARGET.strengthDays + " 天）";
    if (stats.lightMinutes > 0) {
      text += "；另有輕度活動 " + stats.lightMinutes + " 分鐘";
    }
    el.textContent = text;
  }

  async function render() {
    const status = $("#exercise-status");
    try {
      const logs = await getExerciseLogs();
      renderStreak(logs);
      renderList(logs);
      await renderWeeklyActivity();
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
    const preset = fd.get("activity_type_preset") || "";
    const activity_type = (preset === "其他" ? (fd.get("activity_type_custom") || "") : preset).trim();
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
      form.elements["activity_type_preset"].value = "散步";
      form.elements["activity_type_custom"].value = "";
      form.elements["duration_min"].value = "";
      const customField = $("#exercise-custom-activity-field");
      if (customField) customField.hidden = true;
      intensityManuallyEdited = false;
      syncIntensityFromActivity();
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

    const presetSelect = document.querySelector("#exercise-form select[name='activity_type_preset']");
    if (presetSelect) presetSelect.addEventListener("change", onPresetChange);

    const intensitySelect = document.querySelector("#exercise-form select[name='intensity']");
    if (intensitySelect) intensitySelect.addEventListener("change", function () { intensityManuallyEdited = true; });

    syncIntensityFromActivity();
    render();
  });
})();
