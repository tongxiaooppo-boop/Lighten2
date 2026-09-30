// 輕盈計畫 — 「我的食物」分頁的畫面（工作線 D 切片 2；PRD 13.2、13.3、12.1、12.2）：子分頁各組、每一列、明細、搜尋結果。
// 只組 HTML 字串，不讀資料庫、不存狀態（狀態在 tab-foods.js，由參數 s 傳入）；模組頂層不碰 document。
// 分組、不吃、被擋原因、出處類別都問 engine（章程 C1、C4.11）；文字一律中性，不上色、不警告（章程 C4.13、B3）。

import { escapeHtml } from "../../core/html.js";
import { ROLE_LABELS } from "../../core/config.js";
import { SLOT_LABELS } from "../../core/slots.js";
import { fromCustomFood } from "../../data/catalog.js";
import { passesHardFilters } from "../../engine/filters.js";
import { partitionAllChannels, splitDisliked, groupForTab, fillableReason, hiddenEntries } from "../../engine/picker.js";
import { builtinCurrentValues } from "../../engine/meal-content.js";
import { foodBlockText, customFoodsNewestFirst, sourceClassGroups, searchFoods } from "../../engine/foods.js";
import { sodiumText, satFatText } from "../dom.js";
import { customFoodCompareHtml, customFoodEditFormHtml } from "./custom-foods.js";
import { dislikedAllHtml } from "./disliked.js";

export const FOODS_SUBTABS = ["convenience", "delivery", "drinks"];
export const FOODS_SUBTAB_LABELS = { convenience: "超商", delivery: "外食", drinks: "飲品・水果" };
const SOURCE_CLASS_LABELS = { tfda: "衛福部", label: "包裝或官網標示", estimate: "估算" };
const FIELD_LABELS = { kcal: "熱量", protein_g: "蛋白質", carb_g: "碳水", fat_g: "脂肪", fiber_g: "纖維", sat_fat_g: "飽和脂肪", sodium_mg: "鈉" };
export const NO_PROFILE_NOTE = "先在基本資料填好身體數據並按計算，才能標「不吃」。";

// 品項在哪個子分頁：飲料都在「飲品・水果」；台式外食與宅配餐盒在「外食」；其餘在「超商」（跟選擇器的分頁一致）
export function foodsSubtabOf(item) {
  if (item.role === "drink") return "drinks";
  return item.is_taiwan || item.channel === "delivery" ? "delivery" : "convenience";
}

function dislikedKeys(s) {
  const list = s.profile && Array.isArray(s.profile.disliked_ingredients) ? s.profile.disliked_ingredients : [];
  return list.map(function (d) { return d && d.key; });
}

function blockOf(s, item) {
  return passesHardFilters(item, s.profile || {});
}

function kcalText(item) {
  if (item.kcal == null) return "";
  let t = "約 " + item.kcal + " kcal";
  if (item.kcal_basis === "midpoint" && item.kcal_low != null && item.kcal_high != null) t += "（區間 " + item.kcal_low + "–" + item.kcal_high + " kcal）";
  return t;
}

// 數字照資料原樣（跟「內建目前的數值」、選擇器一致，不另外進位）
function gramText(label, v) {
  return label + " " + (v == null ? "無資料" : v + "g");
}

function nutrientLines(v) {
  return [
    [gramText("蛋白質", v.protein_g), gramText("碳水", v.carb_g), gramText("脂肪", v.fat_g), gramText("纖維", v.fiber_g)].join(" · "),
    satFatText(v.sat_fat_g, false) + " · " + sodiumText(v.sodium_mg, false, true),
  ];
}

function allergenText(tags) {
  const t = Array.isArray(tags) ? tags : ["未確認"];
  if (t.indexOf("未確認") !== -1) return "過敏原：未確認";
  return "過敏原：" + (t.length === 0 ? "確認不含" : t.join("、"));
}

function dietText(item) {
  const d = item.diet_tags || [];
  return "飲食宣告：" + (d.length ? d.join("、") : "沒有宣告全素或蛋奶素");
}

function brandText(item) {
  const parts = [item.vendor, item.category].filter(Boolean);
  return parts.length ? "品牌／分類：" + parts.join(" · ") : null;
}

function slotsText(item) {
  if (item.role === "drink") return "能在哪些餐出現：飲料任何時段都能選";
  const s = (item.valid_slots || []).map(function (x) { return SLOT_LABELS[x] || x; });
  return "能在哪些餐出現：" + (s.length ? s.join("、") : "無");
}

// 出處（PRD 12.1）：依類別分組，一類一句；衛福部附整合編號；不顯示 ref（裡面有開發註記，decisions #98）
function sourceText(item) {
  const groups = sourceClassGroups(item);
  return "出處：" + groups.map(function (g) {
    const ids = g.cls === "tfda" && item.tfda_ids && item.tfda_ids.length ? "（整合編號 " + item.tfda_ids.join("、") + "）" : "";
    return g.fields.map(function (k) { return FIELD_LABELS[k]; }).join("、") + "：" + SOURCE_CLASS_LABELS[g.cls] + ids;
  }).join("；");
}

function linesHtml(lines) {
  return lines.filter(Boolean).map(function (t) { return '<p class="food-detail-line">' + escapeHtml(t) + "</p>"; }).join("");
}

// 內建品項的明細（PRD 12.2、13.3）
function builtinDetailHtml(s, item) {
  const v = builtinCurrentValues(item.uid, s.catalog.productsByUid) || item;
  const block = foodBlockText(item, s.profile || {});
  const lines = ["一份：" + kcalText(item)].concat(nutrientLines(v), [
    allergenText(item.allergen_tags), dietText(item),
    brandText(item),
    slotsText(item), sourceText(item),
    block ? "以你目前的設定：" + block : null,
  ]);
  const disliked = dislikedKeys(s).indexOf(item.uid) !== -1;
  const noProfile = !s.profile;
  // 「不吃」看 key 在不在清單（不看原因代碼：又不吃又含過敏原的，代碼是 allergen，計畫 S6）
  let buttons = disliked
    ? '<button type="button" class="secondary-btn" data-foods-undislike="' + escapeHtml(item.uid) + '"' + (noProfile ? " disabled" : "") + ">取消不吃</button>"
    : '<button type="button" class="secondary-btn" data-foods-dislike="' + escapeHtml(item.uid) + '"' + (noProfile ? " disabled" : "") + ">不吃</button>";
  // 被擋的也可以複製；按鈕在按鈕列、不在原因旁邊（章程 C4.1、decisions #84）
  buttons += '<button type="button" class="secondary-btn" data-foods-copy="' + escapeHtml(item.uid) + '">複製成我的版本</button>';
  const editing = s.editing && s.editing.mode === "copy" && s.editing.uid === item.uid;
  return '<div class="food-detail">' + linesHtml(lines) +
    (disliked ? "" : '<p class="food-detail-line">「不吃」只擋這一項。</p>') +
    (noProfile ? '<p class="food-detail-line">' + escapeHtml(NO_PROFILE_NOTE) + "</p>" : "") +
    '<div class="backup-actions">' + buttons + "</div>" + (editing ? customFoodEditFormHtml(s) : "") + "</div>";
}

// 我的品項的明細：B-1a 的內容與按鈕（編輯、補填、封存／還原），沒有「不吃」（PRD 13.3）
function customDetailHtml(s, rec) {
  const item = fromCustomFood(rec);
  const res = rec.archived === true ? { ok: true } : blockOf(s, item);
  const lines = ["一份：" + kcalText(item)].concat(nutrientLines(rec), [
    allergenText(item.allergen_tags), dietText(item),
    brandText(rec),
    slotsText(item),
    "出處：" + (rec.copied_from ? "從內建複製" : "你填的"),
    res.ok ? null : "以你目前的設定不能選：" + res.reason,
    rec.archived === true ? "已封存" : null,
  ]);
  let buttons = '<button type="button" class="secondary-btn" data-cf-edit="' + escapeHtml(rec.id) + '">編輯</button>';
  if (!res.ok && fillableReason(res.reason)) buttons += '<button type="button" class="secondary-btn" data-cf-fill="' + escapeHtml(rec.id) + '">補填</button>';
  buttons += rec.archived === true
    ? '<button type="button" class="secondary-btn" data-cf-restore="' + escapeHtml(rec.id) + '">還原</button>'
    : '<button type="button" class="secondary-btn" data-cf-archive="' + escapeHtml(rec.id) + '">封存</button>';
  const editing = s.editing && (s.editing.mode === "edit" || s.editing.mode === "fill") && s.editing.id === rec.id;
  return '<div class="food-detail">' + linesHtml(lines) + customFoodCompareHtml(s, rec) +
    '<div class="backup-actions">' + buttons + "</div>" + (editing ? customFoodEditFormHtml(s) : "") + "</div>";
}

// 一列：名稱、熱量、被擋原因（灰）；整列可以點開明細，被擋的也可以（一次只開一筆）
function foodsRowHtml(s, o) {
  const open = s.openUid === o.uid;
  const cls = "food-row" + (o.reason ? " is-blocked" : "");
  return '<div class="' + cls + '"><button type="button" class="food-row-main" data-foods-open="' + escapeHtml(o.uid) + '" aria-expanded="' + (open ? "true" : "false") + '">' +
    '<span class="food-name">' + escapeHtml(o.name) + "</span>" +
    (o.meta ? '<span class="food-meta">' + escapeHtml(o.meta) + "</span>" : "") +
    (o.reason ? '<span class="food-status">' + escapeHtml(o.reason) + "</span>" : "") +
    "</button>" + (open ? o.detail() : "") + "</div>";
}

function builtinRow(s, item, reason) {
  return foodsRowHtml(s, { uid: item.uid, name: item.name, meta: kcalText(item), reason: reason, detail: function () { return builtinDetailHtml(s, item); } });
}

function customRow(s, rec) {
  const res = rec.archived === true ? { ok: true } : blockOf(s, fromCustomFood(rec));
  const meta = [rec.copied_from ? "從內建複製" : null, "約 " + rec.kcal + " kcal"].filter(Boolean).join(" · ");
  return foodsRowHtml(s, { uid: rec.id, name: rec.name, meta: meta, reason: res.ok ? null : res.reason, detail: function () { return customDetailHtml(s, rec); } });
}

function recordsOfSubtab(s, sub, archived) {
  return customFoodsNewestFirst(s.records.filter(function (r) {
    return (r.archived === true) === archived && foodsSubtabOf(fromCustomFood(r)) === sub;
  }));
}

// 內建品項的組：超商、外食照選擇器的分組（角色分區、category 分組，被擋的在組內最後）；飲品・水果這一版只有「現成飲料」
function builtinGroupsHtml(s, sub, items) {
  const reasonOf = function (it) { const r = blockOf(s, it); return r.ok ? null : r.reason; };
  if (sub === "drinks") {
    const entries = items.map(function (it) { return { item: it, reason: reasonOf(it) }; });
    const sorted = entries.filter(function (e) { return !e.reason; }).concat(entries.filter(function (e) { return e.reason; }));
    return '<section class="foods-group"><h4 class="meal-picker-role">現成飲料</h4>' + sorted.map(function (e) { return builtinRow(s, e.item, e.reason); }).join("") + "</section>";
  }
  let html = "";
  let role = null;
  groupForTab(items, reasonOf).forEach(function (g) {
    if (g.role !== role) {
      role = g.role;
      html += '<h4 class="meal-picker-role">' + escapeHtml(ROLE_LABELS[role] || role) + "</h4>";
    }
    html += '<section class="foods-group"><h5 class="meal-picker-category">' + escapeHtml(g.category || "其他") + "</h5>" +
      g.entries.map(function (e) { return builtinRow(s, e.item, e.reason); }).join("") + "</section>";
  });
  return html;
}

function detailsGroup(title, count, inner, open) {
  if (count === 0) return "";
  return '<details class="foods-group foods-folded"' + (open ? " open" : "") + "><summary>" + escapeHtml(title) + "（" + count + "）</summary>" + inner + "</details>";
}

// 一個子分頁：內建各組 → 我的品項 → 你標了不吃（收合）→ 已隱藏 → 已封存 → 不吃的全部清單（計畫第 15 項）
export function foodsSubtabHtml(s) {
  const sub = s.subtab;
  const customs = s.records.filter(function (r) { return r.archived !== true; }).map(fromCustomFood);
  const parts = partitionAllChannels(s.catalog.products, customs, s.hidden);
  const list = sub === "drinks" ? parts.drinks : parts[sub];
  const builtin = list.filter(function (it) { return !it.is_custom; });
  const split = splitDisliked(builtin, function (it) { return blockOf(s, it).code; });
  const blocked = split.rest.filter(function (it) { return !blockOf(s, it).ok; }).length;
  let html = blocked > 0 ? '<p class="meal-picker-note">灰色的 ' + blocked + " 項因你的過敏原／飲食設定不能選，點開可以看原因。</p>" : "";
  html += builtinGroupsHtml(s, sub, split.rest);

  const mine = recordsOfSubtab(s, sub, false);
  const label = FOODS_SUBTAB_LABELS[sub];
  html += '<section class="foods-group foods-mine"><h4 class="meal-picker-role">我的品項（' + mine.length + "）</h4>" +
    (mine.length ? mine.map(function (r) { return customRow(s, r); }).join("") : '<p class="backup-note">還沒有。</p>') +
    (s.editing && s.editing.mode === "add" ? customFoodEditFormHtml(s)
      : '<button type="button" class="secondary-btn" data-foods-add>＋新增到我的' + escapeHtml(label) + "品項</button>") + "</section>";

  html += detailsGroup("你標了不吃", split.disliked.length, split.disliked.map(function (it) { return builtinRow(s, it, "你標了不吃"); }).join(""),
    split.disliked.some(function (it) { return it.uid === s.openUid; }));

  const hidden = hiddenEntries(s.hidden, s.catalog.productsByUid).filter(function (e) { return foodsSubtabOf(s.catalog.productsByUid[e.uid]) === sub; });
  html += detailsGroup("已隱藏", hidden.length, hidden.map(function (e) {
    return '<div class="food-row"><div class="food-row-main"><span class="food-name">' + escapeHtml(e.name) + "</span></div>" +
      '<div class="backup-actions"><button type="button" class="secondary-btn" data-cf-unhide="' + escapeHtml(e.uid) + '">取消隱藏</button></div></div>';
  }).join(""), false);

  const archived = recordsOfSubtab(s, sub, true);
  html += detailsGroup("已封存", archived.length, archived.map(function (r) { return customRow(s, r); }).join(""),
    archived.some(function (r) { return r.id === s.openUid; }));

  return html + dislikedAllHtml(s);
}

// 搜尋的範圍：內建品項（含已隱藏）與我的品項（含已封存）；結果標子分頁、分組與狀態（PRD 13.2）
function searchEntries(s) {
  const keys = dislikedKeys(s);
  const out = [];
  s.catalog.products.forEach(function (p) {
    const status = [s.hidden.indexOf(p.uid) !== -1 ? "已隱藏" : null, keys.indexOf(p.uid) !== -1 ? "你標了不吃" : null].filter(Boolean);
    out.push({ uid: p.uid, name: p.name, where: FOODS_SUBTAB_LABELS[foodsSubtabOf(p)] + " · " + (p.category || "其他"), status: status, item: p });
  });
  customFoodsNewestFirst(s.records).forEach(function (r) {
    out.push({ uid: r.id, name: r.name, where: FOODS_SUBTAB_LABELS[foodsSubtabOf(fromCustomFood(r))] + " · 我的品項", status: r.archived === true ? ["已封存"] : [], rec: r });
  });
  return out;
}

export function foodsSearchHtml(s) {
  const hits = searchFoods(searchEntries(s), s.query);
  if (hits.length === 0) return '<p class="backup-note">沒有符合「' + escapeHtml(s.query.trim()) + "」的食物。</p>";
  return '<section class="foods-group">' + hits.map(function (e) {
    const meta = [e.where].concat(e.status).join(" · ");
    return foodsRowHtml(s, { uid: e.uid, name: e.name, meta: meta, reason: null,
      detail: function () { return e.rec ? customDetailHtml(s, e.rec) : builtinDetailHtml(s, e.item); } });
  }).join("") + "</section>";
}

export function foodsSubtabsHtml(s) {
  return FOODS_SUBTABS.map(function (t) {
    const sel = t === s.subtab && !s.query.trim();
    return '<button type="button" role="tab" class="meal-picker-tab' + (sel ? " selected" : "") + '" data-foods-subtab="' + t +
      '" aria-selected="' + (sel ? "true" : "false") + '">' + FOODS_SUBTAB_LABELS[t] + "</button>";
  }).join("");
}
