// 輕盈計畫 — 「我的品項」的完整表單（B-1a：複製成我的版本、補填、基本資料的新增與編輯共用；PRD 10.1、10.3、10.6）。
// 表單值 → PRD 10.1 記錄 → db 寫入驗證（章程 B8）；送出前預告走 catalog.fromCustomFood → engine quickAddProblem（章程 C4.1 不引導改答案）。
// 快速新增（meal-picker/quick-add.js）欄位比較少、帶目前時段，但營養欄位、飲食宣告、數字解析跟這裡共用。
// 屬性一律用 data-cf-*，跟快速新增的 data-qa-* 分開，兩個表單同時在畫面上也不會互相干擾。

import { escapeHtml } from "../core/html.js";
import { ALLERGEN_OPTIONS, ROLE_LABELS } from "../core/config.js";
import { SLOTS, SLOT_LABELS } from "../core/slots.js";
import { fromCustomFood } from "../data/catalog.js";
import { quickAddProblem, quickAddSlots } from "../engine/picker.js";

export const MORE_FIELDS = [["protein_g", "蛋白質（g）"], ["carb_g", "碳水（g）"], ["fat_g", "脂肪（g）"], ["fiber_g", "纖維（g）"], ["sat_fat_g", "飽和脂肪（g）"], ["sodium_mg", "鈉（mg）"]];
export const DIET_LABELS = { none: "都不是", vegan: "全素", lacto_ovo: "蛋奶素" };
export const ROLES = ["main", "side", "snack", "drink"];
export const CHANNEL_LABELS = { convenience: "超商", delivery: "外食" };

// 使用者有設飲食限制（全素、蛋奶素）時，飲食宣告放在必填區；沒設時收在「更多」
export function hasDietRestriction(profile) {
  const d = profile && profile.diet_restriction;
  return d === "全素" || d === "蛋奶素";
}

export function parseNum(v) {
  const t = String(v == null ? "" : v).trim();
  if (t === "") return null;
  const n = Number(t);
  return isFinite(n) ? n : NaN;
}

function numText(v) {
  return v == null ? "" : String(v);
}

// PRD 10.1 記錄（我的品項或 copyFromBuiltin 的預帶值）→ 表單值
export function valuesFromRecord(rec) {
  const nutrients = {};
  MORE_FIELDS.forEach(function (f) { nutrients[f[0]] = numText(rec[f[0]]); });
  const tags = rec.allergen_tags;
  return {
    name: rec.name || "", kcal: numText(rec.kcal), channel: rec.channel || "convenience", role: rec.role || "main",
    slots: Array.isArray(rec.valid_slots) ? rec.valid_slots.slice() : [],
    allergenMode: tags == null ? "unknown" : tags.length === 0 ? "none" : "some",
    allergens: Array.isArray(tags) ? tags.slice() : [],
    diet: rec.vegan === true ? "vegan" : rec.lacto_ovo === true ? "lacto_ovo" : "none",
    nutrients: nutrients, note: rec.note || "",
  };
}

// 新增用的空白表單值：valid_slots 用角色推的時段（「我的食物」裡沒有「目前時段」，PRD 10.6）；
// role：「飲品・水果」子分頁預帶 drink（計畫 S14）
export function emptyCustomFoodValues(channel, role) {
  const r = role || "main";
  return valuesFromRecord({ channel: channel || "convenience", role: r, valid_slots: quickAddSlots(r, null), allergen_tags: null });
}

// 表單值 → 記錄的可編輯欄位（不含 id、created_at、copied_from、archived）；errors：表單層的問題，寫入驗證另由 db.js 做
export function recordFromValues(values) {
  const errors = [];
  const rec = { name: String(values.name || "").trim(), channel: values.channel, role: values.role };
  if (rec.name === "") errors.push("請填名稱");
  rec.kcal = parseNum(values.kcal);
  if (!(rec.kcal > 0)) errors.push("請填熱量（大於 0 的數字）");
  rec.valid_slots = SLOTS.filter(function (s) { return values.slots.indexOf(s) !== -1; });
  if (rec.valid_slots.length === 0) errors.push("至少勾一個適合的時段");
  MORE_FIELDS.forEach(function (f) {
    const n = parseNum(values.nutrients[f[0]]);
    if (n !== null && !(n >= 0)) errors.push(f[1] + "要是 0 以上的數字");
    rec[f[0]] = n !== null && n >= 0 ? n : null;
  });
  rec.allergen_tags = values.allergenMode === "none" ? [] : values.allergenMode === "some" ? values.allergens.slice() : null;
  if (values.allergenMode === "some" && values.allergens.length === 0) errors.push("勾選含有的過敏原，或改選「未確認」");
  rec.vegan = values.diet === "vegan";
  rec.lacto_ovo = values.diet === "lacto_ovo";
  const note = String(values.note || "").trim();
  rec.note = note === "" ? null : note;
  return { record: rec, errors: errors };
}

// 預告與提示（中性說明）：以目前的設定會不會被擋、宣告是否矛盾
export function customFoodNotes(values, profile) {
  const r = recordFromValues(values);
  const item = fromCustomFood(Object.assign({ id: "preview" }, r.record));
  const p = quickAddProblem(item, profile);
  return [p.blocked ? "以你目前的設定，這樣存會不能選：" + p.blocked : null, p.conflict].filter(Boolean);
}

function chips(attr, options, isSelected) {
  return '<div class="compose-options">' + options.map(function (o) {
    return '<button type="button" class="compose-option' + (isSelected(o[0]) ? " selected" : "") + '" ' + attr + '="' + escapeHtml(o[0]) + '">' + escapeHtml(o[1]) + "</button>";
  }).join("") + "</div>";
}

function row(label, inner) {
  return '<div class="quick-add-row"><div class="compose-axis-label">' + label + "</div>" + inner + "</div>";
}

function dietRow(values) {
  return row("這個品項是", chips("data-cf-diet", Object.keys(DIET_LABELS).map(function (k) { return [k, DIET_LABELS[k]]; }), function (k) { return values.diet === k; }));
}

// opts：{ formId, title, saveLabel, profile, notes, extraHtml（例：內建目前的數值） }
export function customFoodFormHtml(values, opts) {
  const o = opts || {};
  const id = o.formId || "custom-food-form";
  const restricted = hasDietRestriction(o.profile);
  let html = '<div class="quick-add custom-food-form" id="' + escapeHtml(id) + '"><div class="meal-picker-estimate-title">' + escapeHtml(o.title || "我的品項") + "</div>";
  html += '<input type="text" class="meal-picker-input" data-cf="name" maxlength="40" placeholder="名稱（必填）" value="' + escapeHtml(values.name) + '">';
  const energyInput = '<input type="number" class="meal-picker-input" data-cf="kcal" min="0" step="any" inputmode="decimal" placeholder="熱量 kcal（必填）" value="' + escapeHtml(values.kcal) + '">';
  html += energyInput;
  html += row("在哪裡買", chips("data-cf-channel", [["convenience", CHANNEL_LABELS.convenience], ["delivery", CHANNEL_LABELS.delivery]], function (c) { return values.channel === c; }));
  html += row("角色", chips("data-cf-role", ROLES.map(function (r) { return [r, ROLE_LABELS[r]]; }), function (r) { return values.role === r; }));
  html += row("適合的時段", chips("data-cf-slot", SLOTS.map(function (s) { return [s, SLOT_LABELS[s]]; }), function (s) { return values.slots.indexOf(s) !== -1; }));
  let allergen = chips("data-cf-allergen-mode", [["unknown", "未確認"], ["none", "確認不含"], ["some", "含："]], function (m) { return values.allergenMode === m; });
  if (values.allergenMode === "some") allergen += chips("data-cf-allergen", ALLERGEN_OPTIONS.map(function (a) { return [a, a]; }), function (a) { return values.allergens.indexOf(a) !== -1; });
  html += row("過敏原", allergen);
  if (restricted) html += dietRow(values);
  html += '<details class="meal-picker-group quick-add-more"><summary>更多（選填）</summary>';
  html += MORE_FIELDS.map(function (f) {
    return '<input type="number" class="meal-picker-input" data-cf-nutrient="' + f[0] + '" min="0" step="any" inputmode="decimal" placeholder="' + f[1] + '" value="' + escapeHtml(values.nutrients[f[0]]) + '">';
  }).join("");
  html += '<input type="text" class="meal-picker-input" data-cf="note" maxlength="80" placeholder="備註（例：內容物、在哪一家）" value="' + escapeHtml(values.note) + '">';
  if (!restricted) html += dietRow(values);
  html += "</details>";
  html += '<div class="meal-picker-note" data-cf-notes>' + (o.notes || []).map(function (t) { return "<p>" + escapeHtml(t) + "</p>"; }).join("") + "</div>";
  html += o.extraHtml || "";
  html += '<div class="meal-picker-actions"><button type="button" class="secondary-btn" data-cf-cancel>取消</button>' +
    '<button type="button" class="primary-btn" data-cf-save>' + escapeHtml(o.saveLabel || "存檔") + "</button></div></div>";
  return html;
}

// 從畫面讀回文字欄位（按鈕類的選擇由 onCustomFoodFormClick 直接改在 values 上）
export function readCustomFoodInputs(root, values) {
  if (!root || !root.querySelector) return values;
  const get = function (sel) { const el = root.querySelector(sel); return el ? el.value : undefined; };
  ["name", "kcal", "note"].forEach(function (k) {
    const v = get('[data-cf="' + k + '"]');
    if (v !== undefined) values[k] = v;
  });
  MORE_FIELDS.forEach(function (f) {
    const v = get('[data-cf-nutrient="' + f[0] + '"]');
    if (v !== undefined) values.nutrients[f[0]] = v;
  });
  return values;
}

// 表單裡的晶片點擊：有處理回傳 true（呼叫端重畫表單）
export function onCustomFoodFormClick(target, values) {
  const at = function (sel) { return target.closest ? target.closest(sel) : null; };
  let el;
  if ((el = at("[data-cf-channel]"))) values.channel = el.getAttribute("data-cf-channel");
  else if ((el = at("[data-cf-role]"))) values.role = el.getAttribute("data-cf-role");
  else if ((el = at("[data-cf-slot]"))) toggle(values.slots, el.getAttribute("data-cf-slot"));
  else if ((el = at("[data-cf-allergen-mode]"))) values.allergenMode = el.getAttribute("data-cf-allergen-mode");
  else if ((el = at("[data-cf-allergen]"))) toggle(values.allergens, el.getAttribute("data-cf-allergen"));
  else if ((el = at("[data-cf-diet]"))) values.diet = el.getAttribute("data-cf-diet");
  else return false;
  return true;
}

function toggle(list, v) {
  const i = list.indexOf(v);
  if (i === -1) list.push(v); else list.splice(i, 1);
}
