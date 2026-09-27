// 輕盈計畫 (Lighten Plan) — 分頁一：基本資料 + 體重回填
// 依賴：database.js（getProfile/saveProfile/addWeightLog/getTdeeState）、nutrition.js（calculateTargets）、tdee.js（getCalibratedTargets 等）

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

  function calStatusText(status, state) {
    if (status === "cooldown") {
      const next = state.last_adjusted_date ? dateAddDays(state.last_adjusted_date, 14) : "";
      return "已調整，下次可調整日期：" + next;
    }
    if (status === "capped") return "已達累計調整上限（±300 kcal）";
    if (status === "at_floor") return "每日目標已到熱量安全下限，暫不調整";
    if (status === "intake_gap") return "近4週平均攝取略高於目前目標，這段體重變化較可能反映的是這部分，所以先不調整";
    if (status === "dismissed") return "14 天內不會再提醒這件事";
    if (status === "insufficient") return "目前資料不足以判斷是否需要調整";
    if (status === "adjusted") return "已自動調整每日目標";
    if (status === "ok") return "目前無需調整";
    return "";
  }

  // 體重趨勢校正卡片：唯一能操作 offset 的地方。
  async function renderCalibrationCard(profile) {
    const card = $("#calibration-card");
    if (!card) return;
    const body = $("#calibration-body");
    if (!body) return;

    let state;
    try {
      state = await getTdeeState();
    } catch (err) {
      console.error(err);
      card.hidden = true;
      return;
    }

    const targets = await getCalibratedTargets(profile);
    const base = targets.baseTargetKcal;
    const offset = targets.offsetKcal;
    const current = targets.targetKcal;
    const today = getLocalDateStr();
    const tomorrow = dateAddDays(today, 1);

    let html = "";

    // 目標拆解。
    html += '<div class="cal-targets">';
    html += '<div class="cal-target-row">公式目標：<span>' + Math.round(base) + ' kcal</span></div>';
    html += '<div class="cal-target-row">校正值：<span>' + (offset >= 0 ? "+" : "") + Math.round(offset) + ' kcal</span></div>';
    html += '<div class="cal-target-row">目前每日目標：<span>' + Math.round(current) + ' kcal</span></div>';
    if (state.effective_date && state.effective_date === tomorrow) {
      html += '<div class="cal-target-row">明天起：<span>' + Math.round(current) + ' kcal</span></div>';
    }
    html += "</div>";

    // 趨勢。
    const lr = state.last_result || {};
    if (lr.slope_kg_per_week == null) {
      html += '<div class="cal-trend">需要近4週至少8次體重紀錄</div>';
    } else {
      const sign = lr.slope_kg_per_week > 0 ? "+" : "";
      html += '<div class="cal-trend">近4週體重趨勢：' + sign + lr.slope_kg_per_week + ' kg／週</div>';
    }

    // 狀態說明（pending 時由下方 pending 區塊說明，不重複顯示）。
    if (lr.status !== "pending") {
      html += '<div class="cal-status">' + calStatusText(lr.status, state) + "</div>";
    }

    // pending 區塊（只有維持模式下修會進到這個狀態）。
    if (state.pending) {
      const slopeText = state.pending.slope_kg_per_week != null
        ? (state.pending.slope_kg_per_week > 0 ? "+" : "") + state.pending.slope_kg_per_week
        : "";
      const downKcal = Math.abs(state.pending.delta_kcal || 150);
      html += '<div class="cal-pending">';
      html += "<p>近4週體重平均每週上升 " + slopeText + " kg。如果你這段期間有重訓增肌，這可能是正常的；如果沒有，可以把每日目標下調 " + downKcal + " kcal（明天起生效）。</p>";
      html += '<button type="button" class="primary-btn" id="cal-apply">套用</button> ';
      html += '<button type="button" class="secondary-btn" id="cal-dismiss">先不要</button>';
      html += "</div>";
    }

    // 重設按鈕。
    if (offset !== 0) {
      html += '<div class="cal-reset"><button type="button" class="secondary-btn" id="cal-reset-btn">重設校正</button></div>';
    }

    body.innerHTML = html;
    card.hidden = false;

    const applyBtn = body.querySelector("#cal-apply");
    if (applyBtn) applyBtn.addEventListener("click", async function () {
      await confirmPendingCalibration();
      await renderCalibrationCard(profile);
    });
    const dismissBtn = body.querySelector("#cal-dismiss");
    if (dismissBtn) dismissBtn.addEventListener("click", async function () {
      await dismissPendingCalibration();
      await renderCalibrationCard(profile);
    });
    const resetBtn = body.querySelector("#cal-reset-btn");
    if (resetBtn) resetBtn.addEventListener("click", async function () {
      await resetCalibrationOffset();
      await renderCalibrationCard(profile);
    });
  }

  async function onCalculate(e) {
    e.preventDefault();
    const profile = readProfileForm();
    if (profile.age === null || profile.height_cm === null || profile.weight_kg === null) {
      alert("請填寫年齡、身高、體重後再計算。");
      return;
    }

    // 先用原始 profile 驗證公式可以算（不帶 offset），再存檔、跑校正、顯示校正後目標。
    let baseResult;
    try {
      baseResult = calculateTargets(profile);
    } catch (err) {
      alert(err && err.message ? err.message : "計算失敗。");
      return;
    }

    try {
      await saveProfile(profile);
    } catch (err) {
      console.error("saveProfile 失敗", err);
    }

    try {
      await runCalibrationNow(profile);
      const calibrated = await getCalibratedTargets(profile);
      showTargets(calibrated);
      await renderCalibrationCard(profile);
    } catch (err) {
      console.error("校正失敗", err);
      showTargets(baseResult);
    }
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
      return;
    }

    // 記錄體重後重跑校正（就算因此調整也是隔天生效，不會改到今天的目標）。
    try {
      const profile = await getProfile();
      if (profile) {
        await runCalibrationNow(profile);
        await renderCalibrationCard(profile);
      }
    } catch (err) {
      console.error("校正失敗", err);
    }
  }

  ready(async function () {
    const dateInput = document.querySelector("#weight-form input[name='log_date']");
    if (dateInput) dateInput.value = getLocalDateStr();

    try {
      const profile = await getProfile();
      fillProfileForm(profile);
      if (profile) {
        const targets = await getCalibratedTargets(profile);
        showTargets(targets);
        await renderCalibrationCard(profile);
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
