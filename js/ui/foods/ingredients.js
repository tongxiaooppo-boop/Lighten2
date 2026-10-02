// 輕盈計畫 — 「我的食物」的我的食材（工作線 D 切片 8b-2；PRD 12.4、13.8，decisions #134、#136、#138）：
// ＋新增食材（衛福部搜尋＋分類晶片、確認表單）、自填表單、我的食材的列與明細、衛福部的不吃（＝移除）與復原、自填的刪除與還原。
// 組 HTML 與寫入動作；狀態在 tab-foods.js（參數 s）。數值、分組、文字都問 engine（章程 C1、C4.11）；文字中性（C4.13）。
//
// s 用到的欄位：ingRecords（custom_ingredients 原始紀錄）、tfdaLookup（查詢檔，沒載到是 null）、lookupState（idle｜loading｜ok｜failed）、
// addIng（新增面板 { query, category, picked, name, amount, note, error }）、ingForm（自填或編輯 { mode, id, values, error }）、removedIng（剛移除的，給復原）

import { escapeHtml } from "../../core/html.js";
import { ALLERGEN_OPTIONS, INGREDIENT_GROUPS } from "../../core/config.js";
import { addCustomIngredient, updateCustomIngredient, removeTfdaIngredient, restoreTfdaIngredient } from "../../data/db.js";
import { ingredientItem, tfdaSearch, tfdaCategories, per100FromServing, TFDA_SEARCH_LIMIT } from "../../engine/my-ingredients.js";
import {
  ingredientMeta, ingredientServingText, ingredientSourceLines, ingredientSections, defaultAmountHint, allergenSummary,
  foodsBlockLabel, foodBlockText, ingredientRemovedMessage, ingredientNutrition, tfdaRowMeta,
} from "../../engine/foods.js";
import { nutrientLines, dietText, linesHtml, foodsRowHtml, detailsGroup, favoriteButtonHtml, favoriteNoteHtml, foodsFavSet } from "./rows.js";
import { chips, row, parseNum, MORE_FIELDS } from "../custom-food-form.js";

export const ING_FORM_ID = "foods-ing-form";
export const ING_ADD_ID = "foods-add-ing";
const GROUP_LABELS = { dairy: "乳品類", protein: "豆魚蛋肉類", grain: "全穀雜糧類", vegetable: "蔬菜類", fruit: "水果類", fat: "油脂與堅果種子類", other: "其他食材" };
const STATE_LABELS = { raw: "生", cooked: "熟", as_is: "照現狀（加工品、乾貨、包裝）" };

// ---------- 品項 ----------

// 沒刪除的我的食材（衛福部來源要查詢檔；沒載到的先不列，畫面另寫一行）
export function myIngredientItems(s, withArchived) {
  return (s.ingRecords || []).filter(function (r) { return withArchived || r.archived !== true; })
    .map(function (r) { return ingredientItem(r, s.tfdaLookup); }).filter(Boolean);
}

export function myIngredientSections(s) {
  return ingredientSections(myIngredientItems(s, false));
}

function hasTfda(s) {
  return (s.ingRecords || []).some(function (r) { return r.source === "tfda"; });
}

// 查詢檔還沒好時的一行（載入中／失敗＋重試）
export function lookupNoteHtml(s) {
  if (!hasTfda(s) && !s.addIng) return "";
  if (s.lookupState === "loading") return '<p class="meal-picker-note">衛福部資料載入中…</p>';
  if (s.lookupState === "failed") return '<p class="meal-picker-note">衛福部資料載入失敗，請稍後再試。 <button type="button" class="link-btn" data-ing-retry>重試</button></p>';
  return "";
}

export function ingredientDetailHtml(s, item) {
  const rec = (s.ingRecords || []).filter(function (r) { return r.id === item.uid; })[0] || {};
  const block = foodBlockText(item, s.profile || {});
  const nut = ingredientNutrition(item);
  const lines = [ingredientServingText(item), nut.kcalLine].concat(nutrientLines(nut.values), [
    allergenSummary(item.allergen_tags) + (item.origin === "tfda" ? "（衛福部標註）" : ""), dietText(item), item.note ? "備註：" + item.note : null,
  ], ingredientSourceLines(item), [block ? "以你目前的設定：" + block : null]);
  let buttons = rec.archived === true ? "" : favoriteButtonHtml(s, item.uid) + '<button type="button" class="secondary-btn" data-ing-edit="' + escapeHtml(item.uid) + '">編輯</button>';
  if (item.origin === "tfda") buttons += '<button type="button" class="secondary-btn" data-ing-remove="' + escapeHtml(item.uid) + '">不吃</button>';
  else if (rec.archived === true) buttons += '<button type="button" class="secondary-btn" data-ing-restore="' + escapeHtml(item.uid) + '">還原</button>';
  else buttons += '<button type="button" class="secondary-btn" data-ing-archive="' + escapeHtml(item.uid) + '">刪除</button>';
  const note = item.origin === "tfda" ? '<p class="food-detail-line">「不吃」會從我的食材移除，可以從「＋新增食材」再加回來。</p>' : "";
  const form = s.ingForm && s.ingForm.mode === "edit" && s.ingForm.id === item.uid ? ingFormHtml(s) : "";
  return '<div class="food-detail">' + linesHtml(lines) + favoriteNoteHtml() + note + '<div class="backup-actions">' + buttons + "</div>" + form + "</div>";
}

export function ingredientRow(s, item, reason) {
  return foodsRowHtml(s, { uid: item.uid, name: item.name, meta: ingredientMeta(item), reason: reason === undefined ? foodsBlockLabel(item, s.profile || {}) : reason,
    detail: function () { return ingredientDetailHtml(s, item); } });
}

// 一組我的食材的列：沒被擋的在前、被擋的在後；常吃的搬到最上面（不在這裡）
export function ingredientRowsHtml(s, items) {
  const fav = foodsFavSet(s);
  const entries = items.filter(function (it) { return !fav[it.uid]; }).map(function (it) { return { item: it, reason: foodsBlockLabel(it, s.profile || {}) }; });
  return entries.filter(function (e) { return !e.reason; }).concat(entries.filter(function (e) { return e.reason; }))
    .map(function (e) { return ingredientRow(s, e.item, e.reason); }).join("");
}

export function ingredientFavorites(s, where) {
  const fav = foodsFavSet(s);
  const sec = myIngredientSections(s);
  const all = where === "drinks" ? sec.drinks : [].concat.apply([], Object.keys(sec.cook).map(function (k) { return sec.cook[k]; }).concat(sec.other.map(function (o) { return o.items; })));
  return all.filter(function (it) { return fav[it.uid]; }).map(function (it) { return { uid: it.uid, check: it, tree: it, row: function (reason) { return ingredientRow(s, it, reason); } }; });
}

function countUnfav(s, items) {
  const fav = foodsFavSet(s);
  return items.filter(function (it) { return !fav[it.uid]; }).length;
}

// 代換表大類裡的「我的食材」一組（tree.js majorHtml 呼叫）
export function mineInMajorHtml(s, key, items) {
  const n = countUnfav(s, items);
  return detailsGroup(s, key + ":mine", "我的食材", n, function () { return ingredientRowsHtml(s, items); },
    items.some(function (it) { return it.uid === s.openUid; }), "foods-minor", true);
}

// 「其他食材」大類：依衛福部分類分（自填的歸「自填」）
export function otherIngredientsHtml(s) {
  const other = myIngredientSections(s).other;
  const n = other.reduce(function (t, o) { return t + countUnfav(s, o.items); }, 0);
  return detailsGroup(s, "cook:other", "其他食材", n, function () {
    return other.map(function (o) {
      return detailsGroup(s, "cook:other:" + o.name, o.name, countUnfav(s, o.items), function () { return ingredientRowsHtml(s, o.items); },
        o.items.some(function (it) { return it.uid === s.openUid; }), "foods-minor", true);
    }).join("");
  }, other.some(function (o) { return o.items.some(function (it) { return it.uid === s.openUid; }); }), "foods-major", true);
}

// 飲品・水果子分頁的「我的食材」一組
export function drinksIngredientsHtml(s) {
  const items = myIngredientSections(s).drinks;
  const n = countUnfav(s, items);
  return n ? '<section class="foods-group"><h4 class="meal-picker-role">我的食材（' + n + "）</h4>" + ingredientRowsHtml(s, items) + "</section>" : "";
}

// 已刪除的自填食材（可以還原）
export function archivedIngredientsHtml(s) {
  const items = (s.ingRecords || []).filter(function (r) { return r.archived === true; }).map(function (r) { return ingredientItem(r, null); }).filter(Boolean);
  return detailsGroup(s, "cook:ing-archived", "已刪除的食材", items.length, function () {
    return items.map(function (it) { return ingredientRow(s, it, "已刪除"); }).join("");
  }, items.some(function (it) { return it.uid === s.openUid; }));
}

// 搜尋（tab-foods 的搜尋範圍加我的食材）
export function ingredientSearchEntries(s, subLabels) {
  return myIngredientItems(s, true).map(function (it) {
    const sub = it.home_drink || it.group === "fruit" ? "drinks" : "cook";
    const rec = (s.ingRecords || []).filter(function (r) { return r.id === it.uid; })[0] || {};
    return { uid: it.uid, name: it.name, aliases: it.tfda ? [it.tfda.name] : [], sub: sub, where: subLabels[sub] + " · 我的食材（" + (it.origin === "tfda" ? "衛福部" : "自填") + "）",
      ing: it, archived: rec.archived === true };
  });
}

// ---------- ＋新增食材（衛福部搜尋） ----------

export function addButtonHtml(s) {
  if (s.addIng || (s.ingForm && s.ingForm.mode === "add")) return "";
  return '<button type="button" class="secondary-btn" data-ing-add>＋新增食材</button>';
}

function addedIds(s) {
  return (s.ingRecords || []).filter(function (r) { return r.source === "tfda"; }).map(function (r) { return r.tfda_id; });
}

// 搜尋結果（輸入時只換這一塊，不重畫輸入框）
export function addResultsHtml(s) {
  const a = s.addIng;
  if (!a || !s.tfdaLookup) return "";
  const r = tfdaSearch(s.tfdaLookup, a.query, a.category, addedIds(s));
  if (!a.query.trim() && !a.category) return '<p class="backup-note">打字搜尋，或點上面的分類翻。</p>';
  if (r.items.length === 0) return '<p class="backup-note">衛福部資料沒有符合的。可以按下面「自己填」。</p>';
  return r.items.map(function (x) {
    const it = x.row;
    const meta = tfdaRowMeta(it);
    return '<button type="button" class="food-row-main ing-result" data-ing-pick="' + escapeHtml(it.id) + '"' + (x.added ? " disabled" : "") + ">" +
      '<span class="food-name">' + escapeHtml(it.name) + "</span>" + '<span class="food-meta">' + escapeHtml(meta + (x.added ? " · 已加入" : "")) + "</span></button>";
  }).join("") + (r.more ? '<p class="backup-note">還有 ' + r.more + " 筆，請再打幾個字縮小（最多列 " + TFDA_SEARCH_LIMIT + " 筆）。</p>" : "");
}

function pickedHtml(s) {
  const a = s.addIng;
  const row = s.tfdaLookup && a.picked ? s.tfdaLookup.byId[a.picked] : null;
  if (!row) return "";
  const unit = row.drink ? "ml" : "g";
  const hint = defaultAmountHint(row, s.catalog.foodTree);
  const tags = allergenSummary(row.allergen_tags) + "（衛福部標註）";
  const diet = row.vegan ? "全素" : row.lacto_ovo ? "蛋奶素" : "沒有宣告全素或蛋奶素";
  return '<div class="quick-add ing-confirm"><div class="meal-picker-estimate-title">加入「' + escapeHtml(row.name) + "」</div>" +
    '<input type="text" class="meal-picker-input" data-ing-add-field="name" maxlength="40" placeholder="名稱" value="' + escapeHtml(a.name) + '">' +
    '<input type="number" class="meal-picker-input" data-ing-add-field="amount" min="1" max="3000" step="any" inputmode="decimal" placeholder="一份幾' + (row.drink ? "毫升" : "克") + '（選填，空白就用克數記）" value="' + escapeHtml(a.amount) + '">' +
    linesHtml([hint, row.state === "raw" ? "這是生的樣品，克數請用煮之前的重量。" : null, row.drink ? "衛福部是每 100g，這裡視為每 100ml。" : null,
      tags, "飲食宣告：" + diet + "（衛福部標註）", tfdaRowMeta(row)]) +
    '<input type="text" class="meal-picker-input" data-ing-add-field="note" maxlength="80" placeholder="備註（選填）" value="' + escapeHtml(a.note) + '">' +
    (a.error ? '<p class="meal-picker-note">' + escapeHtml(a.error) + "</p>" : "") +
    '<div class="meal-picker-actions"><button type="button" class="secondary-btn" data-ing-unpick>換一個</button><button type="button" class="primary-btn" data-ing-confirm>加入</button></div></div>';
}

export function addPanelHtml(s) {
  const a = s.addIng;
  if (!a) return "";
  let html = '<section class="foods-group foods-add-ing" id="' + ING_ADD_ID + '"><h4 class="meal-picker-role">新增食材（衛福部資料）</h4>';
  if (!s.tfdaLookup) return html + lookupNoteHtml(s) + '<div class="meal-picker-actions"><button type="button" class="secondary-btn" data-ing-add-close>關閉</button></div></section>';
  if (a.picked) return html + pickedHtml(s) + "</section>";
  html += '<input type="search" class="meal-picker-input" id="ing-search" placeholder="搜尋名稱或俗名（例：鯖魚、豆干）" value="' + escapeHtml(a.query) + '">';
  html += '<div class="compose-options ing-cats">' + tfdaCategories(s.tfdaLookup).map(function (c) {
    const on = a.category === c.name;
    return '<button type="button" class="compose-option' + (on ? " selected" : "") + '" data-ing-cat="' + escapeHtml(c.name) + '" aria-pressed="' + (on ? "true" : "false") + '">' + escapeHtml(c.name) + "（" + c.count + "）</button>";
  }).join("") + "</div>";
  html += '<div id="ing-results" class="ing-results">' + addResultsHtml(s) + "</div>";
  html += '<p class="backup-note">代換表已經有的食物不在這裡，請在上面的分類裡找。</p>';
  html += '<div class="meal-picker-actions"><button type="button" class="secondary-btn" data-ing-add-close>關閉</button><button type="button" class="secondary-btn" data-ing-self>找不到？自己填</button></div>';
  return html + "</section>";
}

export function readAddInputs(root, a) {
  if (!root || !a) return;
  ["name", "amount", "note"].forEach(function (k) {
    const el = root.querySelector('[data-ing-add-field="' + k + '"]');
    if (el) a[k] = el.value;
  });
}

// 加入衛福部食材：回傳訊息
export async function confirmAdd(s) {
  const a = s.addIng;
  const row = s.tfdaLookup.byId[a.picked];
  const name = String(a.name || "").trim();
  const amt = parseNum(a.amount);
  if (name === "") { a.error = "請填名稱"; return null; }
  if (amt !== null && !(amt > 0 && amt <= 3000)) { a.error = "一份要是 0 到 3000 的數字，或留空白"; return null; }
  const note = String(a.note || "").trim();
  try {
    const rec = await addCustomIngredient({ source: "tfda", tfda_id: row.id, tfda_version: s.tfdaLookup.version, name: name, default_amount: amt, note: note === "" ? null : note });
    s.addIng = null;
    return rec;
  } catch (err) {
    console.error(err);
    a.error = "存檔失敗，請重試。";
    return null;
  }
}

// ---------- 自填與編輯表單 ----------

function emptyValues() {
  const n = {};
  MORE_FIELDS.forEach(function (f) { n[f[0]] = ""; });
  return { name: "", group: "protein", drink: false, state: "raw", basis: "100", servingAmount: "", kcal: "", nutrients: n,
    allergenMode: "unknown", allergens: [], diet: "none", amount: "", note: "" };
}

function valuesOf(rec) {
  const v = emptyValues();
  const text = function (x) { return x == null ? "" : String(x); };
  v.name = rec.name || ""; v.amount = text(rec.default_amount); v.note = rec.note || "";
  if (rec.source === "user") {
    Object.assign(v, { group: rec.group, drink: rec.drink, state: rec.state, kcal: text(rec.per_100g.kcal),
      allergenMode: rec.allergen_tags == null ? "unknown" : rec.allergen_tags.length === 0 ? "none" : "some",
      allergens: Array.isArray(rec.allergen_tags) ? rec.allergen_tags.slice() : [], diet: rec.vegan ? "vegan" : rec.lacto_ovo ? "lacto_ovo" : "none" });
    MORE_FIELDS.forEach(function (f) { v.nutrients[f[0]] = text(rec.per_100g[f[0]]); });
  }
  return v;
}

export function openSelfForm(s) {
  s.ingForm = { mode: "add", id: null, source: "user", values: emptyValues(), error: null };
  s.addIng = null;
}

export function openEditForm(s, id) {
  const rec = (s.ingRecords || []).filter(function (r) { return r.id === id; })[0];
  if (!rec) return;
  s.ingForm = { mode: "edit", id: id, source: rec.source, values: valuesOf(rec), error: null };
}

function energyInputHtml(v) {
  return '<input type="number" class="meal-picker-input" data-ing="kcal" min="0" step="any" inputmode="decimal" placeholder="熱量 kcal（必填，可以是 0）" value="' + escapeHtml(v.kcal) + '">';
}

export function ingFormHtml(s) {
  const f = s.ingForm;
  if (!f) return "";
  const v = f.values;
  const unit = v.drink ? "ml" : "g";
  let html = '<div class="quick-add" id="' + ING_FORM_ID + '"><div class="meal-picker-estimate-title">' + (f.mode === "add" ? "自己填食材" : "編輯食材") + "</div>";
  html += '<input type="text" class="meal-picker-input" data-ing="name" maxlength="40" placeholder="名稱（必填）" value="' + escapeHtml(v.name) + '">';
  if (f.source === "user") {
    html += row("放在哪一類", chips("data-ing-group", INGREDIENT_GROUPS.map(function (g) { return [g, GROUP_LABELS[g]]; }), function (g) { return v.group === g; }));
    html += row("是液體嗎", chips("data-ing-drink", [["no", "不是（用克）"], ["yes", "是（用毫升）"]], function (k) { return (k === "yes") === v.drink; }));
    html += row("數字是", chips("data-ing-state", Object.keys(STATE_LABELS).map(function (k) { return [k, STATE_LABELS[k]]; }), function (k) { return v.state === k; }));
    html += row("營養標示寫的是", chips("data-ing-basis", [["100", "每 100" + unit], ["serving", "每一份"]], function (k) { return v.basis === k; }));
    if (v.basis === "serving") html += '<input type="number" class="meal-picker-input" data-ing="servingAmount" min="0" step="any" inputmode="decimal" placeholder="標示上一份幾' + (v.drink ? "毫升" : "克") + '（必填）" value="' + escapeHtml(v.servingAmount) + '">';
    html += energyInputHtml(v);
    html += MORE_FIELDS.map(function (m) {
      return '<input type="number" class="meal-picker-input" data-ing-nutrient="' + m[0] + '" min="0" step="any" inputmode="decimal" placeholder="' + m[1] + '（選填）" value="' + escapeHtml(v.nutrients[m[0]]) + '">';
    }).join("");
    let allergen = chips("data-ing-allergen-mode", [["unknown", "未確認"], ["none", "確認不含"], ["some", "含："]], function (m) { return v.allergenMode === m; });
    if (v.allergenMode === "some") allergen += chips("data-ing-allergen", ALLERGEN_OPTIONS.map(function (a) { return [a, a]; }), function (a) { return v.allergens.indexOf(a) !== -1; });
    html += row("過敏原", allergen);
    html += row("這個食材是", chips("data-ing-diet", [["none", "都不是"], ["vegan", "全素"], ["lacto_ovo", "蛋奶素"]], function (k) { return v.diet === k; }));
  }
  html += '<input type="number" class="meal-picker-input" data-ing="amount" min="0" step="any" inputmode="decimal" placeholder="一份幾' + (v.drink ? "毫升" : "克") + '（選填，空白就用克數記）" value="' + escapeHtml(v.amount) + '">';
  html += '<input type="text" class="meal-picker-input" data-ing="note" maxlength="80" placeholder="備註（選填）" value="' + escapeHtml(v.note) + '">';
  if (f.error) html += '<p class="meal-picker-note">' + escapeHtml(f.error) + "</p>";
  html += '<div class="meal-picker-actions"><button type="button" class="secondary-btn" data-ing-cancel>取消</button><button type="button" class="primary-btn" data-ing-save>存檔</button></div></div>';
  return html;
}

export function readFormInputs(root, f) {
  if (!root || !f) return;
  ["name", "servingAmount", "kcal", "amount", "note"].forEach(function (k) {
    const el = root.querySelector('[data-ing="' + k + '"]');
    if (el) f.values[k] = el.value;
  });
  MORE_FIELDS.forEach(function (m) {
    const el = root.querySelector('[data-ing-nutrient="' + m[0] + '"]');
    if (el) f.values.nutrients[m[0]] = el.value;
  });
}

// 表單的晶片：有處理回傳 true
export function onFormChipClick(target, f) {
  const at = function (sel) { return target.closest ? target.closest(sel) : null; };
  const v = f.values;
  let el;
  if ((el = at("[data-ing-group]"))) v.group = el.getAttribute("data-ing-group");
  else if ((el = at("[data-ing-drink]"))) v.drink = el.getAttribute("data-ing-drink") === "yes";
  else if ((el = at("[data-ing-state]"))) v.state = el.getAttribute("data-ing-state");
  else if ((el = at("[data-ing-basis]"))) v.basis = el.getAttribute("data-ing-basis");
  else if ((el = at("[data-ing-allergen-mode]"))) v.allergenMode = el.getAttribute("data-ing-allergen-mode");
  else if ((el = at("[data-ing-allergen]"))) { const a = el.getAttribute("data-ing-allergen"); const i = v.allergens.indexOf(a); if (i === -1) v.allergens.push(a); else v.allergens.splice(i, 1); }
  else if ((el = at("[data-ing-diet]"))) v.diet = el.getAttribute("data-ing-diet");
  else return false;
  return true;
}

// 表單值 → 寫入的欄位；errors 是表單層問題（寫入驗證另由 db 做）
function recordFromForm(f) {
  const v = f.values;
  const errors = [];
  const name = String(v.name || "").trim();
  if (name === "") errors.push("請填名稱");
  const amt = parseNum(v.amount);
  if (amt !== null && !(amt > 0 && amt <= 3000)) errors.push("一份要是 0 到 3000 的數字，或留空白");
  const note = String(v.note || "").trim();
  const out = { name: name, default_amount: amt, note: note === "" ? null : note };
  if (f.source !== "user") return { record: out, errors: errors };
  const raw = { kcal: parseNum(v.kcal) };
  MORE_FIELDS.forEach(function (m) { raw[m[0]] = parseNum(v.nutrients[m[0]]); });
  if (raw.kcal === null || !(raw.kcal >= 0)) errors.push("請填熱量（0 以上的數字）");
  MORE_FIELDS.forEach(function (m) { if (raw[m[0]] !== null && !(raw[m[0]] >= 0)) errors.push(m[1] + "要是 0 以上的數字"); });
  let per = raw;
  if (v.basis === "serving") {
    const sa = parseNum(v.servingAmount);
    if (!(sa > 0)) errors.push("請填標示上一份幾" + (v.drink ? "毫升" : "克"));
    else per = per100FromServing(raw, sa);
  }
  if (v.allergenMode === "some" && v.allergens.length === 0) errors.push("勾選含有的過敏原，或改選「未確認」");
  Object.assign(out, {
    group: v.group, drink: v.drink, state: v.state, per_100g: per,
    allergen_tags: v.allergenMode === "none" ? [] : v.allergenMode === "some" ? v.allergens.slice() : null,
    vegan: v.diet === "vegan", lacto_ovo: v.diet === "lacto_ovo" || v.diet === "vegan",
  });
  return { record: out, errors: errors };
}

// 存檔：回傳寫入的紀錄或 null（錯誤寫在 f.error）
export async function saveIngForm(s) {
  const f = s.ingForm;
  const r = recordFromForm(f);
  if (r.errors.length) { f.error = r.errors.join("；"); return null; }
  try {
    const saved = f.mode === "add" ? await addCustomIngredient(Object.assign({ source: "user" }, r.record)) : await updateCustomIngredient(f.id, r.record);
    s.ingForm = null;
    return saved;
  } catch (err) {
    console.error(err);
    f.error = "存檔失敗，請重試。" + (/格式不對/.test(String(err.message)) ? "（" + String(err.message).replace(/^\[db\.js\] /, "") + "）" : "");
    return null;
  }
}

// ---------- 移除、復原、刪除、還原 ----------

export async function removeTfda(s, id, savedCount) {
  try {
    const old = await removeTfdaIngredient(id);
    s.removedIng = old;
    return ingredientRemovedMessage(old.name, savedCount);
  } catch (err) {
    console.error(err);
    return "存檔失敗，請重試。";
  }
}

export async function undoRemoveTfda(s) {
  const old = s.removedIng;
  if (!old) return "";
  try {
    await restoreTfdaIngredient(old);
    s.removedIng = null;
    return "已復原「" + old.name + "」。";
  } catch (err) {
    console.error(err);
    return "復原失敗，請重試。";
  }
}

export async function setIngArchived(s, id, archived) {
  try {
    const saved = await updateCustomIngredient(id, { archived: archived });
    return (archived ? "已刪除「" : "已還原「") + saved.name + "」。";
  } catch (err) {
    console.error(err);
    return "存檔失敗，請重試。";
  }
}

// 移除後的提示列「復原」
export function undoBarHtml(s) {
  return s.removedIng ? ' <button type="button" class="link-btn" data-ing-undo>復原</button>' : "";
}
