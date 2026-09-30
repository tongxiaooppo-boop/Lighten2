// 輕盈計畫 (Lighten Plan) — 分頁一：基本資料 + 體重回填 + 體重趨勢校正卡片

import { SLOTS, isSlotEnabled, MEAL_SOURCE_OPTIONS, DEFAULT_MEAL_PREFS } from "../core/slots.js";
import { dateAddDays } from "../core/dates.js";
import { escapeHtml } from "../core/html.js";
import { ALLERGEN_OPTIONS } from "../core/config.js";
import { $ } from "./dom.js";
import { getProfile, saveProfileForm, addWeightLog } from "../data/db.js";
import { calculateTargets } from "../engine/nutrition.js";
import { initBackup } from "./backup.js";
import { normalizeAllergens } from "../engine/filters.js";
import {
loadTdeeState, getCalibratedTargets, runCalibrationNow,
confirmPendingCalibration, dismissPendingCalibration, resetCalibrationOffset,
} from "./calibration.js";
import { todayStr } from "./clock.js";

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
    diet_restriction: fd.get("diet_restriction"),
    low_carb: fd.get("low_carb") === "on",
    oil_habit: fd.get("oil_habit") === "less" ? "less" : "normal",
    // 2026-09-27 整案審查 A2：改成固定詞彙勾選框（自由文字打「蝦」比對不到資料裡的「甲殼類」）
    allergens: fd.getAll("allergens"),
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
    // 不吃清單不是表單欄位：saveProfileForm 一律保留資料庫裡的（「我的食物」「順便不要」隨時會改，decisions #99）
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
  set("diet_restriction", profile.diet_restriction);
  form.elements["low_carb"].checked = !!profile.low_carb;
  form.elements["oil_habit"].value = profile.oil_habit === "less" ? "less" : "normal";
  // 舊版存的是自由文字：能對回固定詞彙的直接勾上，對不回的提示使用者重新勾選。
  const allergens = normalizeAllergens(profile.allergens);
  Array.prototype.forEach.call(form.querySelectorAll("input[name='allergens']"), function (box) {
    box.checked = allergens.list.indexOf(box.value) !== -1;
  });
  const legacyNote = document.getElementById("allergen-legacy-note");
  if (legacyNote) {
    legacyNote.hidden = allergens.unknown.length === 0;
    legacyNote.textContent = allergens.unknown.length === 0 ? "" :
      "舊設定裡的「" + allergens.unknown.join("、") + "」對不到上面的選項，目前推薦會先避開所有成分未確認的品項；請勾選最接近的項目後按「計算」儲存。";
  }
  // 「今日建議時段」與「今日建議來源」合併後的下拉回填：時段被關閉（isSlotEnabled 為 false，
  // 含舊資料只存過 enabled_slots、沒存過合併後 UI 的情況）就顯示「不顯示建議」(off)；
  // 否則顯示驗證過的來源偏好，驗證不過（例如舊資料本來就沒存、或存的是 off）才套預設值。
  const mealPrefs = profile.meal_prefs || {};
  SLOTS.forEach(function (slot) {
    const el = form.elements["meal_pref_" + slot];
    if (!el) return;
    if (!isSlotEnabled(profile.enabled_slots, slot)) {
      el.value = "off";
      return;
    }
    const v = mealPrefs[slot];
    el.value = MEAL_SOURCE_OPTIONS.indexOf(v) !== -1 ? v : DEFAULT_MEAL_PREFS[slot];
  });
  set("goal_mode", profile.goal_mode);
}

export function showTargets(result) {
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
  // 2026-09-27 整案審查 B2：原本「記錄天數不夠」跟「攝取偏高」共用 intake_gap，只是記錄不完整的人
  // 也會收到「平均攝取略高於目標」。拆成兩個狀態；intake_gap 留給升級前存下來的舊結果。
  if (status === "intake_log_short") return "完整記錄的天數還不夠，暫不調整";
  // 只陳述數字跟規則，不歸因（使用者 2026-09-27 拍板：明講，但不說「體重變化是因為吃多」）。
  if (status === "intake_high") {
    const lr = state.last_result || {};
    const nums = lr.avg_intake_kcal != null && lr.target_kcal != null
      ? "近4週完整記錄日平均攝取 " + lr.avg_intake_kcal + " kcal，目前目標 " + lr.target_kcal + " kcal。"
      : "近4週完整記錄日的平均攝取高於目前目標。";
    return nums + "平均攝取接近目標之前，系統不會調低目標。";
  }
  if (status === "intake_gap") return "暫不調整";
  if (status === "dismissed") return "14 天內不會再提醒這件事";
  if (status === "insufficient") return "目前資料不足以判斷是否需要調整";
  if (status === "adjusted") return "已自動調整每日目標";
  if (status === "ok") return "目前無需調整";
  return "";
}

// 體重趨勢校正卡片：唯一能操作 offset 的地方。
export async function renderCalibrationCard(profile) {
  const card = $("#calibration-card");
  if (!card) return;
  const body = $("#calibration-body");
  if (!body) return;

  let state;
  try {
    state = await loadTdeeState();
  } catch (err) {
    console.error(err);
    card.hidden = true;
    return;
  }

  const targets = await getCalibratedTargets(profile);
  const base = targets.baseTargetKcal;
  const offset = targets.offsetKcal;
  const current = targets.targetKcal;
  const today = todayStr();
  const tomorrow = dateAddDays(today, 1);

  let html = "";

  // 目標拆解。
  html += '<div class="cal-targets">';
  html += '<div class="cal-target-row">公式目標：<span>' + Math.round(base) + ' kcal</span></div>';
  html += '<div class="cal-target-row">校正值：<span>' + (offset >= 0 ? "+" : "") + Math.round(offset) + ' kcal</span></div>';
  html += '<div class="cal-target-row">目前每日目標：<span>' + Math.round(current) + ' kcal</span></div>';
  if (state.effective_date && state.effective_date === tomorrow) {
    // 用生效日的目標，不是今天的（調整當天今天還是舊值，2026-09-27 整案審查 B3）
    const next = await getCalibratedTargets(profile, state.effective_date);
    html += '<div class="cal-target-row">明天起：<span>' + Math.round(next.targetKcal) + ' kcal</span></div>';
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
    // 不在同一句提運動（PRD：運動與飲食熱量脫鉤），只說明體重變化本身。
    html += "<p>近4週體重平均每週上升 " + slopeText + " kg。如果這是你預期中的變化（例如肌肉量增加），可以維持不變；如果不是，可以把每日目標調整 −" + downKcal + " kcal（明天起生效）。</p>";
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
  const form = readProfileForm();
  if (form.age === null || form.height_cm === null || form.weight_kg === null) {
    alert("請填寫年齡、身高、體重後再計算。");
    return;
  }

  // 先用原始 profile 驗證公式可以算（不帶 offset），再存檔、跑校正、顯示校正後目標。
  let baseResult;
  try {
    baseResult = calculateTargets(form);
  } catch (err) {
    alert(err && err.message ? err.message : "計算失敗。");
    return;
  }

  let profile = form;
  try {
    // 一個 transaction 讀改寫，不吃清單以資料庫為準（別的分頁會在本分頁不知道的時候改）
    profile = await saveProfileForm(form);
  } catch (err) {
    console.error("saveProfileForm 失敗", err);
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

  if (!log_date || weight_kg === null || !(weight_kg > 0)) {
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

// 過敏原勾選框由固定詞彙產生（唯一來源 core/config.js，章程 C2）
function renderAllergenOptions() {
  const box = document.getElementById("allergen-options");
  if (!box) return;
  box.innerHTML = ALLERGEN_OPTIONS.map(function (a) {
    return '<label class="allergen-option"><input type="checkbox" name="allergens" value="' + escapeHtml(a) + '" /> ' + escapeHtml(a) + "</label>";
  }).join("");
}

export async function initProfileTab() {
  renderAllergenOptions();
  initBackup();
  const dateInput = document.querySelector("#weight-form input[name='log_date']");
  if (dateInput) dateInput.value = todayStr();

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

  // 切回這個分頁時更新目標與校正卡片（不重填表單，避免蓋掉還沒按「計算」的修改）。
  document.addEventListener("tab:activated", async function (e) {
    if (e.detail !== "profile") return;
    try {
      const profile = await getProfile();
      if (!profile) return;
      showTargets(await getCalibratedTargets(profile));
      await renderCalibrationCard(profile);
    } catch (err) {
      console.error(err);
    }
  });
}
