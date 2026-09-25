// 輕盈計畫 (Lighten Plan) — 分頁一：基本資料 + 體重回填
// 依賴：database.js（getProfile/saveProfile/addWeightLog）、nutrition.js（calculateTargets）

(function () {
  "use strict";

  function ready(fn) {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", fn);
    } else {
      fn();
    }
  }

  function $(sel) {
    return document.querySelector(sel);
  }

  function toIntOrNull(v) {
    if (v === "" || v === null || v === undefined) return null;
    const n = parseInt(v, 10);
    return isFinite(n) ? n : null;
  }

  function toFloatOrNull(v) {
    if (v === "" || v === null || v === undefined) return null;
    const n = parseFloat(v);
    return isFinite(n) ? n : null;
  }

  function getLocalDateStr() {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return y + "-" + m + "-" + day;
  }

  function fmt(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return y + "-" + m + "-" + day;
  }

  function mondayOfThisWeek() {
    const d = new Date();
    const day = d.getDay();
    const diff = day === 0 ? 6 : day - 1;
    d.setDate(d.getDate() - diff);
    return fmt(d);
  }

  function dateAddDays(dateStr, days) {
    const d = new Date(dateStr + "T00:00:00");
    d.setDate(d.getDate() + days);
    return fmt(d);
  }

  function readProfileForm() {
    const form = document.getElementById("profile-form");
    const fd = new FormData(form);
    return {
      age: toIntOrNull(fd.get("age")),
      gender: fd.get("gender"),
      height_cm: toFloatOrNull(fd.get("height_cm")),
      weight_kg: toFloatOrNull(fd.get("weight_kg")),
      body_fat_pct: toFloatOrNull(fd.get("body_fat_pct")),
      activity_mode: fd.get("activity_mode"),
      special_activity_kcal: toFloatOrNull(fd.get("special_activity_kcal")),
      diet_restriction: fd.get("diet_restriction"),
      allergens: (fd.get("allergens") || "").trim(),
      // 「今日建議時段」與「今日建議來源」已合併成同一組下拉（選「不顯示建議」= off）。
      // meal_prefs 照下拉原始值存（off 對 recommend.js 來說是無效值，會自動 fallback 成預設偏好，
      // 但反正該時段會被 enabled_slots 擋住不顯示，fallback 值本身不影響使用者看到的結果）；
      // enabled_slots 從同一個下拉值推導（!== "off"），取代原本獨立的 checkbox 群組。
      meal_prefs: {
        breakfast: fd.get("meal_pref_breakfast"),
        lunch: fd.get("meal_pref_lunch"),
        afternoon_tea: fd.get("meal_pref_afternoon_tea"),
        dinner: fd.get("meal_pref_dinner"),
        snack: fd.get("meal_pref_snack"),
      },
      goal_mode: fd.get("goal_mode"),
      enabled_slots: {
        breakfast: fd.get("meal_pref_breakfast") !== "off",
        lunch: fd.get("meal_pref_lunch") !== "off",
        afternoon_tea: fd.get("meal_pref_afternoon_tea") !== "off",
        dinner: fd.get("meal_pref_dinner") !== "off",
        snack: fd.get("meal_pref_snack") !== "off",
      },
    };
  }

  function fillProfileForm(profile) {
    if (!profile) return;
    const form = document.getElementById("profile-form");
    const set = function (name, value) {
      const el = form.elements[name];
      if (el && value !== null && value !== undefined) el.value = value;
    };
    set("age", profile.age);
    set("gender", profile.gender);
    set("height_cm", profile.height_cm);
    set("weight_kg", profile.weight_kg);
    set("body_fat_pct", profile.body_fat_pct);
    set("activity_mode", profile.activity_mode);
    set("special_activity_kcal", profile.special_activity_kcal);
    set("diet_restriction", profile.diet_restriction);
    set("allergens", profile.allergens);
    // 「今日建議時段」與「今日建議來源」合併後的下拉回填：時段被關閉（isSlotEnabled 為 false，
    // 含舊資料只存過 enabled_slots、沒存過合併後 UI 的情況）就顯示「不顯示建議」(off)；
    // 否則顯示驗證過的來源偏好，驗證不過（例如舊資料本來就沒存、或存的是 off）才套預設值。
    const mealPrefs = profile.meal_prefs || {};
    ["breakfast", "lunch", "afternoon_tea", "dinner", "snack"].forEach(function (slot) {
      const el = form.elements["meal_pref_" + slot];
      if (!el) return;
      if (!window.isSlotEnabled(profile.enabled_slots, slot)) {
        el.value = "off";
        return;
      }
      const v = mealPrefs[slot];
      el.value = (window.MEAL_SOURCE_OPTIONS && window.MEAL_SOURCE_OPTIONS.indexOf(v) !== -1)
        ? v
        : (window.DEFAULT_MEAL_PREFS ? window.DEFAULT_MEAL_PREFS[slot] : "auto");
    });
    set("goal_mode", profile.goal_mode);
  }

  function showTargets(result) {
    $("#target-bmr").textContent = result.bmr;
    $("#target-tdee").textContent = result.tdee;
    $("#target-kcal").textContent = result.targetKcal;
    $("#target-protein").textContent = result.protein_g;
    $("#target-fat").textContent = result.fat_g;
    $("#target-carb").textContent = result.carb_g;
    $("#target-fiber").textContent = result.fiber_g;
    $("#target-netcarb").textContent = result.netCarb_g;
    $("#target-warning").hidden = !result.flooredWarning;
    $("#targets-result").hidden = false;
  }

  function showCalibration(targetKcal) {
    const row = $("#calibrated-target-row");
    if (row) {
      $("#calibrated-target").textContent = targetKcal;
      row.hidden = false;
    }
  }

  function hideCalibration() {
    const row = $("#calibrated-target-row");
    if (row) row.hidden = true;
  }

  async function refreshCalibration(profile) {
    try {
      const eightWeeksAgo = dateAddDays(mondayOfThisWeek(), -7 * 8);
      const weightLogs = await getWeightLogs({ start: eightWeeksAgo });
      const dailyLogs = await getDailyLogs({ start: eightWeeksAgo });
      const cal = await calibrateWeeklyTdee(weightLogs, dailyLogs, profile);
      showCalibration(cal.targetKcal);
    } catch (err) {
      console.error("calibrateWeeklyTdee 失敗", err);
    }
  }

  async function onCalculate(e) {
    e.preventDefault();
    const profile = readProfileForm();
    if (profile.age === null || profile.height_cm === null || profile.weight_kg === null) {
      alert("請填寫年齡、身高、體重後再計算。");
      return;
    }

    let result;
    try {
      result = calculateTargets(profile);
    } catch (err) {
      alert(err && err.message ? err.message : "計算失敗。");
      return;
    }

    showTargets(result);
    try {
      await saveProfile(profile);
    } catch (err) {
      console.error("saveProfile 失敗", err);
    }
    await refreshCalibration(profile);
  }

  async function onWeightSubmit(e) {
    e.preventDefault();
    const form = document.getElementById("weight-form");
    const fd = new FormData(form);
    const log_date = fd.get("log_date");
    const weight_kg = toFloatOrNull(fd.get("weight_kg"));

    if (!log_date || weight_kg === null) {
      alert("請填寫日期與體重。");
      return;
    }

    try {
      await addWeightLog({ log_date: log_date, weight_kg: weight_kg });
      $("#weight-log-status").textContent =
        "已記錄 " + log_date + " 體重 " + weight_kg + " kg";
      form.elements["weight_kg"].value = "";
    } catch (err) {
      console.error("addWeightLog 失敗", err);
      $("#weight-log-status").textContent = "記錄失敗，請重試。";
    }
  }

  ready(async function () {
    const dateInput = document.querySelector("#weight-form input[name='log_date']");
    if (dateInput) dateInput.value = getLocalDateStr();

    try {
      const profile = await getProfile();
      fillProfileForm(profile);
      if (profile) {
        const cal = await getTdeeCalibration(mondayOfThisWeek());
        if (cal && cal.target_kcal != null) {
          showCalibration(cal.target_kcal);
        } else {
          hideCalibration();
        }
      }
    } catch (err) {
      console.error("載入 profile 失敗", err);
    }

    const profileForm = document.getElementById("profile-form");
    if (profileForm) profileForm.addEventListener("submit", onCalculate);

    const weightForm = document.getElementById("weight-form");
    if (weightForm) weightForm.addEventListener("submit", onWeightSubmit);
  });
})();
