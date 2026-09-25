// 輕盈計畫 (Lighten Plan) — 分頁五：運動紀錄（獨立頁面）
// 依賴：database.js（addExerciseLog / getExerciseLogs）
// 原則：僅記錄運動項目/時長/強度，不做熱量換算；版面與文案與飲食/大餐完全隔離。

(function () {
  "use strict";

  const INTENSITY_LABELS = { 低: "低強度", 中: "中強度", 高: "高強度" };

  // 常見運動項目 → MET 值（供「僅供參考」的熱量估算，不寫回任何飲食資料）
  const ACTIVITY_MET = {
    "散步": 3.0, "快走": 4.3, "慢跑": 7.0, "腳踏車": 6.8, "游泳": 6.0,
    "羽毛球": 5.5, "籃球": 6.5, "重訓": 3.5, "瑜伽": 2.5,
  };
  const INTENSITY_MET_FALLBACK = { "低": 3.0, "中": 5.0, "高": 7.5 }; // 給「其他」自訂項目用
  const WEEKLY_EXERCISE_KCAL_TARGET = { "減脂": 1500, "維持": 1000, "增肌": 600 }; // 一般性建議值，僅供參考

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

  function estimateExerciseKcal(activityType, durationMin, intensity, weightKg) {
    if (!weightKg || !durationMin) return null;
    const met = ACTIVITY_MET.hasOwnProperty(activityType)
      ? ACTIVITY_MET[activityType]
      : (INTENSITY_MET_FALLBACK[intensity] || INTENSITY_MET_FALLBACK["中"]);
    return Math.round(met * weightKg * (durationMin / 60));
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

  function renderList(logs, profile) {
    const container = $("#exercise-history");
    if (!container) return;
    const weightKg = profile && Number(profile.weight_kg);
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
      const kcal = estimateExerciseKcal(r.activity_type, r.duration_min, r.intensity, weightKg);
      const kcalHtml = kcal != null
        ? '<span class="exercise-item-meta">約消耗 ' + kcal + " kcal（僅供參考）</span>"
        : "";
      return '<div class="exercise-item">' +
        '<div class="exercise-item-info">' +
        '<span class="exercise-item-title">' + escapeHtml(r.activity_type || "") + "</span>" +
        '<span class="exercise-item-meta">' + escapeHtml(r.log_date) + " · " + escapeHtml(r.duration_min) + " 分鐘 · " + escapeHtml(intensityLabel) + "</span>" +
        kcalHtml +
        "</div>" +
        "</div>";
    }).join("");
  }

  async function renderWeeklyKcal(profile) {
    const el = $("#exercise-weekly-kcal-text");
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
    const weightKg = profile && Number(profile.weight_kg);
    const total = logs.reduce(function (sum, r) {
      const kcal = estimateExerciseKcal(r.activity_type, r.duration_min, r.intensity, weightKg);
      return sum + (kcal || 0);
    }, 0);
    const goal = profile && profile.goal_mode;
    const target = WEEKLY_EXERCISE_KCAL_TARGET.hasOwnProperty(goal) ? WEEKLY_EXERCISE_KCAL_TARGET[goal] : null;

    if (target != null) {
      if (total >= target) {
        el.textContent = "本週已運動消耗約 " + total + " kcal，已達成建議額度 " + target + " kcal";
      } else {
        el.textContent = "本週已運動消耗約 " + total + " kcal／建議額度 " + target + " kcal，還差 " + (target - total) + " kcal";
      }
    } else {
      el.textContent = "本週已運動消耗約 " + total + " kcal";
    }
  }

  async function render() {
    const status = $("#exercise-status");
    try {
      const logs = await getExerciseLogs();
      let profile = null;
      try {
        profile = await getProfile();
      } catch (err) {
        console.error(err);
      }
      renderStreak(logs);
      renderList(logs, profile);
      await renderWeeklyKcal(profile);
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

    render();
  });
})();
