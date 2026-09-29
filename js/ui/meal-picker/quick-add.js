// 輕盈計畫 — 「我的品項」快速新增（PRD 10.3、decisions #48；Phase 0 計畫 2.1 第 7 項）。
// 表單 → PRD 10.1 格式的記錄 → db.addCustomFood（寫入驗證，章程 B8）→ catalog.fromCustomFood → engine 過濾。
// 送出前預告走同一條路：這裡把表單組成記錄、用 fromCustomFood 轉成品項形狀，交給 engine 的 quickAddProblem。

import { escapeHtml } from "../../core/html.js";
import { ALLERGEN_OPTIONS, ROLE_LABELS } from "../../core/config.js";
import { fromCustomFood } from "../../data/catalog.js";
import { quickAddDefaults, defaultQuickAddRole, quickAddProblem } from "../../engine/picker.js";
import { MORE_FIELDS, DIET_LABELS, ROLES, hasDietRestriction, parseNum } from "../custom-food-form.js";

export function emptyQuickAdd(slot) {
  const nutrients = {};
  MORE_FIELDS.forEach(function (f) { nutrients[f[0]] = ""; });
  return { name: "", kcal: "", role: defaultQuickAddRole(slot), allergenMode: "unknown", allergens: [], diet: "none", nutrients: nutrients };
}

// 表單值 → PRD 10.1 記錄；errors：表單層的問題（名稱、數字格式），寫入驗證另由 db.js 做
export function quickAddRecord(values, slot, channel) {
  const errors = [];
  const rec = quickAddDefaults(slot, values.role, channel);
  rec.name = String(values.name || "").trim();
  if (rec.name === "") errors.push("請填名稱");
  rec.kcal = parseNum(values.kcal);
  if (!(rec.kcal > 0)) errors.push("請填熱量（大於 0 的數字）");
  MORE_FIELDS.forEach(function (f) {
    const n = parseNum(values.nutrients[f[0]]);
    if (n !== null && !(n >= 0)) errors.push(f[1] + "要是 0 以上的數字");
    rec[f[0]] = n !== null && n >= 0 ? n : null;
  });
  rec.allergen_tags = values.allergenMode === "none" ? [] : values.allergenMode === "some" ? values.allergens.slice() : null;
  if (values.allergenMode === "some" && values.allergens.length === 0) errors.push("勾選含有的過敏原，或改選「未確認」");
  rec.vegan = values.diet === "vegan";
  rec.lacto_ovo = values.diet === "lacto_ovo";
  return { record: rec, errors: errors };
}

// 預告與提示（中性說明）：以目前的設定會不會被擋、宣告是否矛盾
export function quickAddNotes(values, slot, channel, profile) {
  const r = quickAddRecord(values, slot, channel);
  const item = fromCustomFood(Object.assign({ id: "preview" }, r.record));
  const p = quickAddProblem(item, profile);
  return [p.blocked ? "以你目前的設定，這樣存會不能選：" + p.blocked : null, p.conflict].filter(Boolean);
}

function dietHtml(values) {
  return '<div class="quick-add-row"><div class="compose-axis-label">這個品項是</div><div class="compose-options">' +
    Object.keys(DIET_LABELS).map(function (k) {
      return '<button type="button" class="compose-option' + (values.diet === k ? " selected" : "") + '" data-qa-diet="' + k + '">' + DIET_LABELS[k] + "</button>";
    }).join("") + "</div></div>";
}

function textInput(key, placeholder, value) {
  return '<input type="text" class="meal-picker-input" data-qa="' + key + '" maxlength="40" placeholder="' + placeholder + '" value="' + escapeHtml(String(value)) + '">';
}

function numberInput(attr, placeholder, value) {
  return '<input type="number" class="meal-picker-input" ' + attr + ' min="0" step="any" inputmode="decimal" placeholder="' + placeholder + '" value="' + escapeHtml(String(value)) + '">';
}

export function quickAddFormHtml(values, tabLabel, profile, notes) {
  const restricted = hasDietRestriction(profile);
  let html = '<div class="quick-add" id="quick-add-form"><div class="meal-picker-estimate-title">新增到我的' + escapeHtml(tabLabel) + "品項</div>";
  const energyInput = numberInput('data-qa="kcal"', "熱量 kcal（必填）", values.kcal);
  html += textInput("name", "名稱（必填）", values.name) + energyInput;
  html += '<div class="quick-add-row"><div class="compose-axis-label">角色</div><div class="compose-options">' + ROLES.map(function (r) {
    return '<button type="button" class="compose-option' + (values.role === r ? " selected" : "") + '" data-qa-role="' + r + '">' + ROLE_LABELS[r] + "</button>";
  }).join("") + "</div></div>";
  html += '<div class="quick-add-row"><div class="compose-axis-label">過敏原</div><div class="compose-options">' +
    [["unknown", "未確認"], ["none", "確認不含"], ["some", "含："]].map(function (x) {
      return '<button type="button" class="compose-option' + (values.allergenMode === x[0] ? " selected" : "") + '" data-qa-allergen-mode="' + x[0] + '">' + x[1] + "</button>";
    }).join("") + "</div>";
  if (values.allergenMode === "some") {
    html += '<div class="compose-options">' + ALLERGEN_OPTIONS.map(function (a) {
      return '<button type="button" class="compose-option' + (values.allergens.indexOf(a) !== -1 ? " selected" : "") + '" data-qa-allergen="' + escapeHtml(a) + '">' + escapeHtml(a) + "</button>";
    }).join("") + "</div>";
  }
  html += "</div>";
  if (restricted) html += dietHtml(values);
  html += '<details class="meal-picker-group quick-add-more"><summary>更多（選填）</summary>';
  html += MORE_FIELDS.map(function (f) { return numberInput('data-qa-nutrient="' + f[0] + '"', f[1], values.nutrients[f[0]]); }).join("");
  if (!restricted) html += dietHtml(values);
  html += "</details>";
  html += '<div id="quick-add-notes" class="meal-picker-note">' + notes.map(function (t) { return "<p>" + escapeHtml(t) + "</p>"; }).join("") + "</div>";
  html += '<div class="meal-picker-actions"><button type="button" class="secondary-btn" data-qa-cancel>取消</button>' +
    '<button type="button" class="primary-btn" data-qa-save>存成我的品項</button></div></div>';
  return html;
}

// 從畫面讀回文字欄位（按鈕類的選擇直接改在 values 上）
export function readQuickAddInputs(root, values) {
  if (!root || !root.querySelector) return values;
  const get = function (sel) { const el = root.querySelector(sel); return el ? el.value : undefined; };
  const name = get('[data-qa="name"]');
  if (name !== undefined) values.name = name;
  const kcal = get('[data-qa="kcal"]');
  if (kcal !== undefined) values.kcal = kcal;
  MORE_FIELDS.forEach(function (f) {
    const v = get('[data-qa-nutrient="' + f[0] + '"]');
    if (v !== undefined) values.nutrients[f[0]] = v;
  });
  return values;
}
