// 輕盈計畫 — 今日建議的「自己選」modal（現成品項多選＋自己煮）。
// Phase 0 整個改成三分頁選擇器（ui/meal-picker/）；−1a 只搬家，畫面與行為不變。

import { SLOT_LABELS } from "../core/slots.js";
import { escapeHtml } from "../core/html.js";
import { NO_COOK_METHOD_ID } from "../core/config.js";
import { $, notIncludedText, sodiumText } from "./dom.js";
import { getProfile, getDailyLogs, getCustomFoods, addDailyLog } from "../data/db.js";
import { loadCatalog } from "../data/catalog.js";
import { passesHardFilters } from "../engine/filters.js";
import { slotNutrientShare } from "../engine/budget.js";
import {
  sumProducts, composeTotals, composeImplicit, suggestFillers, slotGaps,
  contentFromProducts, contentFromCompose, buildLogEntry, manualSelectionProblem, canAddManualItem,
} from "../engine/meal-content.js";
import { filterForSlot, cardHtml } from "./item-picker.js";
import { getCalibratedTargets } from "./calibration.js";
import { todayStr, nowIso } from "./clock.js";

export const manualPicker = {
  slot: null, mode: "items", selectedUids: [], passItems: [], blockedItems: [], profile: null, targets: null, todayLogs: null,
  onLogged: null,
  compose: { axes: null, archetype: null, protein: null, staple: null, vegetable: null, seasoning: null, method: null, primaryScale: 1, drink: null, drinkItems: [] },
};

function manualSelectedItems() {
  const sel = manualPicker.selectedUids;
  return manualPicker.passItems.filter(function (it) { return sel.indexOf(it.uid) !== -1; });
}

function fmtNutrient(v) { return v == null ? "—" : Math.round(v) + "g"; }

// onLogged：記錄成功後要做的事（今日建議重新整理）
export async function openManualPicker(slot, onLogged) {
  let profile;
  try { profile = await getProfile(); } catch (e) { console.error(e); return; }
  if (!profile) { alert("請先到「基本資料」分頁填寫並按「計算」。"); return; }
  const targets = await getCalibratedTargets(profile);
  const today = todayStr();
  const todayLogs = await getDailyLogs({ start: today, end: today });
  const catalog = await loadCatalog();
  const customFoods = await getCustomFoods();
  // 現成品項模式：排除整套便當；飲料直接從過濾結果裡 role==='drink' 的品項挑。
  const filtered = filterForSlot(catalog, customFoods, slot, profile, { excludeWholeMeals: true });
  manualPicker.slot = slot;
  manualPicker.mode = "items";
  manualPicker.profile = profile;
  manualPicker.targets = targets;
  manualPicker.todayLogs = todayLogs;
  manualPicker.passItems = filtered.pass;
  manualPicker.blockedItems = filtered.blocked;
  manualPicker.selectedUids = [];
  manualPicker.onLogged = onLogged || null;
  manualPicker.compose = {
    axes: catalog, archetype: null, protein: null, staple: null, vegetable: null, seasoning: null, method: null,
    primaryScale: 1, drink: null,
    drinkItems: filtered.pass.filter(function (it) { return it.role === "drink"; }),
    drinkBlocked: filtered.blocked.filter(function (b) { return b.item.role === "drink"; }),
  };
  const labelEl = $("#manual-picker-slot-label");
  if (labelEl) labelEl.textContent = SLOT_LABELS[slot] || slot;
  syncModeRadios();
  renderManualPicker();
  const overlay = $("#manual-picker-overlay");
  if (overlay) overlay.hidden = false;
}

// ----- 「自己煮」模式（compose）：餐型 → 食材 → 份量 -----
function syncModeRadios() {
  const radios = document.querySelectorAll("input[name='manual-picker-mode']");
  Array.prototype.forEach.call(radios, function (r) { r.checked = r.value === manualPicker.mode; });
}

function setManualMode(mode) {
  manualPicker.mode = mode;
  renderManualPicker();
}

function pickIds(list, ids) {
  const map = {};
  list.forEach(function (it) { map[it.id] = it; });
  return (ids || []).map(function (id) { return map[id]; }).filter(Boolean);
}

// 把單一食材包成跟推薦的自組食譜一樣的形狀再過硬性過濾，讓「不吃食材」清單能正確命中。
function composePassFilter(candidate, axisType) {
  const wrapper = { is_composed: true, allergen_tags: candidate.allergen_tags || [], diet_tag_sets: [candidate.diet_tags || []] };
  if (axisType === "protein") wrapper.protein_id = candidate.id;
  else if (axisType === "staple") wrapper.staple_id = candidate.id;
  else if (axisType === "vegetable") wrapper.vegetable_id = candidate.id;
  else if (axisType === "sauce") wrapper.sauce_id = candidate.id;
  return passesHardFilters(wrapper, manualPicker.profile);
}

function composeHasStapleSlot() {
  const a = manualPicker.compose.archetype;
  return !!(a && a.staple && a.staple.allow && a.staple.allow.length > 0);
}

function composePrimaryItem() {
  const c = manualPicker.compose;
  return composeHasStapleSlot() ? c.staple : c.protein;
}

export function currentComposeTotals() {
  const c = manualPicker.compose;
  return composeTotals(c, composePrimaryItem(), composeImplicit(c, manualPicker.profile.oil_habit), c.axes.implicit);
}

function composeBlockedReason(it, axisType, c) {
  // 免開火食安：選了免開火，需煮熟的食材擋掉（跟推薦候選池同一條規則）
  if (c.method && c.method.id === NO_COOK_METHOD_ID && it.requires_cooking) return "這個食材需要加熱";
  const res = composePassFilter(it, axisType);
  if (!res.ok) return res.reason;
  return null;
}

function composeOptionHtml(id, name, opts) {
  const o = opts || {};
  const cls = "compose-option" + (o.selected ? " selected" : "") + (o.blockedReason != null ? " is-blocked" : "");
  const reason = o.blockedReason != null ? '<span class="item-card-reason">' + escapeHtml(o.blockedReason) + "</span>" : "";
  return '<button type="button" class="' + cls + '" data-axis="' + escapeHtml(o.axis) + '" data-id="' + escapeHtml(id) + '"' +
    (o.blockedReason != null ? " disabled" : "") + ">" + escapeHtml(name) + reason + "</button>";
}

function composeAxisHtml(label, axisField, options, selected, axisType, c) {
  const optional = (axisField === "vegetable" || axisField === "seasoning");
  let html = '<div class="compose-axis"><div class="compose-axis-label">' + escapeHtml(label) + '</div><div class="compose-options">';
  if (optional) html += composeOptionHtml("", "不加", { axis: axisField, selected: selected == null });
  options.forEach(function (it) {
    const isSel = selected && selected.id === it.id;
    const blockedReason = composeBlockedReason(it, axisType, c);
    // 已選中的品項即使有 blockedReason 也要能點（取消選取）；未選中的才 disabled。
    html += composeOptionHtml(it.id, it.name, { axis: axisField, selected: isSel, blockedReason: isSel ? null : blockedReason });
  });
  html += "</div></div>";
  return html;
}

function composeMethodAxisHtml(c) {
  const methods = (c.archetype.methods || []).map(function (id) { return pickIds(c.axes.sauces, [id])[0]; }).filter(Boolean);
  let html = '<div class="compose-axis"><div class="compose-axis-label">烹調法</div><div class="compose-options">';
  methods.forEach(function (m) {
    html += composeOptionHtml(m.id, m.name, { axis: "method", selected: c.method && c.method.id === m.id });
  });
  html += "</div></div>";
  return html;
}

function renderComposeMode() {
  const el = $("#manual-picker-compose-mode");
  if (!el) return;
  const c = manualPicker.compose;
  const axes = c.axes;
  if (!axes) { el.innerHTML = ""; return; }
  const slot = manualPicker.slot;
  const archetypes = axes.archetypes.filter(function (a) { return (a.valid_slots || []).indexOf(slot) !== -1; });
  let html = '<div class="compose-step"><div class="compose-step-label">1. 選餐型</div><div class="compose-options">';
  html += archetypes.map(function (a) {
    return composeOptionHtml(a.id, a.name, { axis: "archetype", selected: c.archetype && c.archetype.id === a.id });
  }).join("");
  html += "</div></div>";

  if (c.archetype) {
    html += '<div class="compose-step"><div class="compose-step-label">2. 選食材</div>';
    html += composeAxisHtml("蛋白質（必選）", "protein", pickIds(axes.proteins, c.archetype.protein.allow), c.protein, "protein", c);
    if (composeHasStapleSlot()) html += composeAxisHtml("主食（必選）", "staple", pickIds(axes.staples, c.archetype.staple.allow), c.staple, "staple", c);
    if (c.archetype.vegetable && c.archetype.vegetable.allow && c.archetype.vegetable.allow.length > 0) {
      html += composeAxisHtml("蔬菜（選填）", "vegetable", pickIds(axes.vegetables, c.archetype.vegetable.allow), c.vegetable, "vegetable", c);
    }
    if (c.archetype.seasoning && c.archetype.seasoning.allow && c.archetype.seasoning.allow.length > 0) {
      html += composeAxisHtml("調味（選填）", "seasoning", pickIds(axes.sauces, c.archetype.seasoning.allow), c.seasoning, "sauce", c);
    }
    html += composeMethodAxisHtml(c);
    html += "</div>";

    const primary = composePrimaryItem();
    if (primary) {
      html += '<div class="compose-step"><div class="compose-step-label">3. 份量（' + escapeHtml(primary.name) + '）</div><div class="compose-scale">';
      html += '<input type="range" min="0.5" max="2.0" step="0.1" value="' + c.primaryScale + '" id="compose-scale-slider">' +
        '<span id="compose-scale-value">' + c.primaryScale.toFixed(1) + ' 倍</span></div></div>';
    }
  }

  html += '<div class="compose-step"><div class="compose-step-label">4. 加飲料（選填）</div><div class="compose-options">';
  html += composeOptionHtml("", "不加飲料", { axis: "drink", selected: c.drink == null });
  c.drinkItems.forEach(function (d) {
    html += composeOptionHtml(d.uid, d.name, { axis: "drink", selected: c.drink && c.drink.uid === d.uid });
  });
  c.drinkBlocked.forEach(function (b) {
    html += composeOptionHtml(b.item.uid, b.item.name, { axis: "drink", blockedReason: b.reason });
  });
  html += "</div></div>";

  el.innerHTML = html;

  const slider = document.getElementById("compose-scale-slider");
  if (slider && slider.addEventListener) {
    slider.addEventListener("input", function () {
      c.primaryScale = parseFloat(slider.value);
      const v = document.getElementById("compose-scale-value");
      if (v) v.textContent = c.primaryScale.toFixed(1) + " 倍";
      updateManualSummary();
    });
  }
}

function composeMissingReason() {
  const c = manualPicker.compose;
  if (!c.archetype) return "請先選餐型";
  if (!c.protein) return "請選蛋白質";
  if (composeHasStapleSlot() && !c.staple) return "請選主食";
  if (!c.method) return "請選烹調法";
  // 免開火食安：選了免開火，任何已選食材需要加熱就要擋（跟推薦候選池同一條規則）。
  if (c.method.id === NO_COOK_METHOD_ID) {
    const needsCooking = [c.protein, c.staple, c.vegetable, c.seasoning].some(function (it) { return it && it.requires_cooking; });
    if (needsCooking) return "免開火不能搭配需要加熱的食材，請換烹調法或換食材。";
  }
  return null;
}

function onComposeClick(e) {
  const btn = e.target.closest(".compose-option");
  if (!btn || btn.disabled) return;
  const axis = btn.getAttribute("data-axis");
  const id = btn.getAttribute("data-id");
  const c = manualPicker.compose;
  if (axis === "archetype") {
    c.archetype = pickIds(c.axes.archetypes, [id])[0] || null;
    c.protein = null; c.staple = null; c.vegetable = null; c.seasoning = null; c.method = null; c.primaryScale = 1;
  } else if (axis === "protein") {
    c.protein = id ? pickIds(c.axes.proteins, [id])[0] : null;
  } else if (axis === "staple") {
    c.staple = id ? pickIds(c.axes.staples, [id])[0] : null;
  } else if (axis === "vegetable") {
    c.vegetable = id ? pickIds(c.axes.vegetables, [id])[0] : null;
  } else if (axis === "seasoning") {
    c.seasoning = id ? pickIds(c.axes.sauces, [id])[0] : null;
  } else if (axis === "method") {
    c.method = id ? pickIds(c.axes.sauces, [id])[0] : null;
  } else if (axis === "drink") {
    c.drink = id ? (c.drinkItems.filter(function (d) { return d.uid === id; })[0] || null) : null;
  }
  renderComposeMode();
  updateManualSummary();
}

export function renderManualPicker() {
  const itemsModeEl = $("#manual-picker-items-mode");
  const composeModeEl = $("#manual-picker-compose-mode");
  if (itemsModeEl) itemsModeEl.hidden = manualPicker.mode !== "items";
  if (composeModeEl) composeModeEl.hidden = manualPicker.mode !== "compose";

  if (manualPicker.mode === "compose") {
    renderComposeMode();
  } else {
    const itemsEl = $("#manual-picker-items");
    if (itemsEl) {
      const selected = manualPicker.selectedUids;
      let html = manualPicker.passItems.map(function (it) {
        return cardHtml(it, { selected: selected.indexOf(it.uid) !== -1 });
      }).join("");
      html += manualPicker.blockedItems.map(function (b) {
        return cardHtml(b.item, { selected: false, blockedReason: b.reason });
      }).join("");
      itemsEl.innerHTML = html;
    }
  }
  updateManualSummary();
}

export function updateManualSummary() {
  const isCompose = manualPicker.mode === "compose";
  let totals, selItems;
  if (isCompose) {
    totals = currentComposeTotals();
    selItems = [];
  } else {
    selItems = manualSelectedItems();
    totals = sumProducts(selItems);
  }

  const summaryEl = $("#manual-picker-summary");
  if (summaryEl) {
    summaryEl.innerHTML =
      (isCompose ? "已配好 · " : "已選 " + selItems.length + " 件 · ") + "約 " + Math.round(totals.kcal) + " kcal" +
      " · 蛋白質 " + fmtNutrient(totals.protein_g) +
      " · 碳水 " + fmtNutrient(totals.carb_g) +
      " · 脂肪 " + fmtNutrient(totals.fat_g) +
      " · 纖維 " + fmtNutrient(totals.fiber_g) +
      " · " + escapeHtml(sodiumText(totals.sodium_mg, totals.partial.indexOf("sodium_mg") !== -1, false)) +
      (isCompose && manualPicker.compose.archetype && notIncludedText(manualPicker.compose.archetype.not_included)
        ? " · " + escapeHtml(notIncludedText(manualPicker.compose.archetype.not_included)) : "");
  }

  const gapEl = $("#manual-picker-gap");
  if (gapEl) {
    const share = slotNutrientShare(manualPicker.targets, manualPicker.todayLogs, manualPicker.profile.enabled_slots, manualPicker.slot);
    const lines = [];
    const gaps = slotGaps(share, totals);
    const overKcal = gaps.overKcal;
    if (overKcal > 0) lines.push("這組合約 " + Math.round(totals.kcal) + " kcal，這個時段配額約 " + Math.round(share.kcalShare) + " kcal（+" + overKcal + "），仍可送出。");
    const proteinGap = gaps.proteinGap;
    const fiberGap = gaps.fiberGap;
    if (proteinGap > 0) lines.push("蛋白質缺口約 " + proteinGap + "g");
    if (fiberGap > 0) lines.push("纖維缺口約 " + fiberGap + "g");
    if (!isCompose) {
      let suggestions = [];
      if (proteinGap > 0) suggestions = suggestions.concat(suggestFillers(manualPicker.passItems, selItems, proteinGap, "protein_g", share));
      if (fiberGap > 0) suggestions = suggestions.concat(suggestFillers(manualPicker.passItems, selItems, fiberGap, "fiber_g", share));
      if (suggestions.length > 0) lines.push("可以考慮加：" + suggestions.slice(0, 2).join("、"));
    }
    gapEl.innerHTML = lines.length > 0 ? lines.map(function (t) { return "<p>" + escapeHtml(t) + "</p>"; }).join("") : "";
  }

  const submitBtn = $("#manual-picker-submit");
  const hint = document.getElementById("manual-picker-main-hint");
  let missingReason = null;
  if (isCompose) {
    missingReason = composeMissingReason();
  } else {
    missingReason = manualSelectionProblem(selItems);
  }
  if (submitBtn) submitBtn.disabled = missingReason != null;
  if (hint) {
    hint.hidden = missingReason == null;
    if (missingReason) hint.textContent = missingReason;
  }
}

function roleLabel(role) {
  return role === "main" ? "主餐" : role === "side" ? "配菜" : role === "drink" ? "飲料" : "點心";
}

function onManualItemClick(e) {
  const card = e.target.closest(".item-card");
  if (!card || card.disabled) return;
  const uid = card.getAttribute("data-uid");
  const it = manualPicker.passItems.filter(function (x) { return x.uid === uid; })[0];
  if (!it) return;
  const idx = manualPicker.selectedUids.indexOf(uid);
  if (idx === -1) {
    if (!canAddManualItem(manualSelectedItems(), it)) {
      alert("這個時段的「" + roleLabel(it.role) + "」已經選過了，要不要先取消上一個？");
      return;
    }
    manualPicker.selectedUids.push(uid);
  } else {
    manualPicker.selectedUids.splice(idx, 1);
  }
  renderManualPicker();
}

export async function onManualSubmit() {
  let entry;
  if (manualPicker.mode === "compose") {
    const missing = composeMissingReason();
    if (missing) { alert(missing); return; }
    const c = manualPicker.compose;
    const primary = composePrimaryItem();
    const implicit = composeImplicit(c, manualPicker.profile.oil_habit);
    const totals = composeTotals(c, primary, implicit, c.axes.implicit);
    const nameParts = [c.archetype.name, c.protein.name, c.staple && c.staple.name, c.vegetable && c.vegetable.name, c.seasoning && c.seasoning.name, c.drink && c.drink.name].filter(Boolean);
    entry = buildLogEntry({
      date: todayStr(), slot: manualPicker.slot, source: "manual", name: nameParts.join("＋"),
      content: contentFromCompose(c, primary, implicit), totals: totals, createdAt: nowIso(),
    });
  } else {
    const selItems = manualSelectedItems();
    const problem = manualSelectionProblem(selItems);
    if (problem) { alert(problem); return; }
    entry = buildLogEntry({
      date: todayStr(), slot: manualPicker.slot, source: "manual",
      name: selItems.map(function (it) { return it.name; }).join("＋"),
      content: contentFromProducts(selItems), totals: sumProducts(selItems), createdAt: nowIso(),
    });
  }
  try {
    await addDailyLog(entry);
    const overlay = $("#manual-picker-overlay");
    if (overlay) overlay.hidden = true;
    if (manualPicker.onLogged) await manualPicker.onLogged();
  } catch (err) {
    console.error(err);
    alert("記錄失敗，請重試。");
  }
}

export function initManualPicker() {
  const overlay = $("#manual-picker-overlay");
  if (overlay) {
    overlay.addEventListener("click", function (e) {
      if (e.target === overlay) overlay.hidden = true;
    });
  }
  const manualItems = $("#manual-picker-items");
  if (manualItems) manualItems.addEventListener("click", onManualItemClick);
  const composeModeEl = $("#manual-picker-compose-mode");
  if (composeModeEl) composeModeEl.addEventListener("click", onComposeClick);
  const modeRadios = document.querySelectorAll("input[name='manual-picker-mode']");
  Array.prototype.forEach.call(modeRadios, function (r) {
    r.addEventListener("change", function () { if (r.checked) setManualMode(r.value); });
  });
  const manualCancel = $("#manual-picker-cancel");
  if (manualCancel) manualCancel.addEventListener("click", function () { overlay.hidden = true; });
  const manualSubmit = $("#manual-picker-submit");
  if (manualSubmit) manualSubmit.addEventListener("click", onManualSubmit);
}
