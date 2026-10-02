// 輕盈計畫 — 「我的食物」分頁的畫面（工作線 D 切片 2、4；PRD 13.2、13.3、12.1、12.2）：子分頁各組、現成品項與我的品項的列與明細、搜尋結果。
// 只組 HTML 字串，不讀資料庫、不存狀態（狀態在 tab-foods.js，由參數 s 傳入）；模組頂層不碰 document。
// 分組、不吃、被擋原因、出處類別都問 engine（章程 C1、C4.11）；文字一律中性，不上色、不警告（章程 C4.13、B3）。
// 代換表分層（自煮、家裡的飲品、水果）在 tree.js；列、明細共用的小元件在 rows.js。

import { escapeHtml } from "../../core/html.js";
import { ROLE_LABELS } from "../../core/config.js";
import { SLOT_LABELS } from "../../core/slots.js";
import { fromCustomFood } from "../../data/catalog.js";
import { passesHardFilters } from "../../engine/filters.js";
import { partitionAllChannels, splitDisliked, groupForTab, fillableReason, hiddenEntries } from "../../engine/picker.js";
import { builtinCurrentValues } from "../../engine/meal-content.js";
import {
  foodBlockText, customFoodsNewestFirst, sourceClassGroups, searchFoods, foodsWhereOf, allergenSummary, foodsBlockLabel,
} from "../../engine/foods.js";
import { customFoodCompareHtml, customFoodEditFormHtml } from "./custom-foods.js";
import { dislikedAllHtml } from "./disliked.js";
import {
  dislikedKeys, nutrientLines, dietText, linesHtml, foodsRowHtml, detailsGroup,
  dislikeButtonHtml, dislikeNotesHtml, sameSampleHtml, foodsFavSet, favoritesGroupHtml, favoriteButtonHtml, favoriteNoteHtml,
} from "./rows.js";
import { splitFavorites } from "../../engine/picker.js";
import { cookSubtabHtml, drinksTreeHtml, treeItemsOf, treeRow, treeDetailHtml, treeSearchEntries, treeFavorites, treeFavoriteEntry } from "./tree.js";
import { drinksIngredientsHtml, ingredientFavorites, ingredientSearchEntries, ingredientDetailHtml } from "./ingredients.js";

export const FOODS_SUBTABS = ["convenience", "delivery", "cook", "drinks"];
export const FOODS_SUBTAB_LABELS = { convenience: "超商", delivery: "外食", cook: "自煮", drinks: "飲品・水果" };
const SOURCE_CLASS_LABELS = { tfda: "衛福部", label: "包裝或官網標示", estimate: "估算" };
const FIELD_LABELS = { kcal: "熱量", protein_g: "蛋白質", carb_g: "碳水", fat_g: "脂肪", fiber_g: "纖維", sat_fat_g: "飽和脂肪", sodium_mg: "鈉" };

function blockOf(s, item) {
  return passesHardFilters(item, s.profile || {});
}

function kcalText(item) {
  if (item.kcal == null) return "";
  let t = "約 " + item.kcal + " kcal";
  if (item.kcal_basis === "midpoint" && item.kcal_low != null && item.kcal_high != null) t += "（區間 " + item.kcal_low + "–" + item.kcal_high + " kcal）";
  return t;
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

// 內建品項的明細（PRD 12.2、13.3）；同一個衛福部樣品的分層品項也列出（decisions #85、#114）
function builtinDetailHtml(s, item) {
  const v = builtinCurrentValues(item.uid, s.catalog.productsByUid) || item;
  const block = foodBlockText(item, s.profile || {});
  const lines = ["一份：" + kcalText(item)].concat(nutrientLines(v), [
    allergenSummary(item.allergen_tags), dietText(item),
    brandText(item),
    slotsText(item), sourceText(item),
    block ? "以你目前的設定：" + block : null,
  ]);
  // 被擋的也可以複製；按鈕在按鈕列、不在原因旁邊（章程 C4.1、decisions #84）。常吃第一個、不吃最後（意思相反，中間隔開；審核 S13）
  const buttons = favoriteButtonHtml(s, item.uid) +
    '<button type="button" class="secondary-btn" data-foods-copy="' + escapeHtml(item.uid) + '">複製成我的版本</button>' + dislikeButtonHtml(s, item.uid);
  const editing = s.editing && s.editing.mode === "copy" && s.editing.uid === item.uid;
  return '<div class="food-detail">' + linesHtml(lines) + sameSampleHtml(s, item.uid) + dislikeNotesHtml(s, item.uid) +
    '<div class="backup-actions">' + buttons + "</div>" + (editing ? customFoodEditFormHtml(s) : "") + "</div>";
}

// 我的品項的明細：B-1a 的內容與按鈕（編輯、補填、封存／還原），沒有「不吃」（PRD 13.3）
function customDetailHtml(s, rec) {
  const item = fromCustomFood(rec);
  const res = rec.archived === true ? { ok: true } : blockOf(s, item);
  const lines = ["一份：" + kcalText(item)].concat(nutrientLines(rec), [
    allergenSummary(item.allergen_tags), dietText(item),
    brandText(rec),
    slotsText(item),
    "出處：" + (rec.copied_from ? "從內建複製" : "你填的"),
    res.ok ? null : "以你目前的設定不能選：" + res.reason,
    rec.archived === true ? "已刪除" : null,
  ]);
  // 我的品項有常吃、沒有不吃（PRD 13.3）；封存的不能標常吃（不出現在選擇器）
  let buttons = (rec.archived === true ? "" : favoriteButtonHtml(s, rec.id)) +
    '<button type="button" class="secondary-btn" data-cf-edit="' + escapeHtml(rec.id) + '">編輯</button>';
  if (!res.ok && fillableReason(res.reason)) buttons += '<button type="button" class="secondary-btn" data-cf-fill="' + escapeHtml(rec.id) + '">補填</button>';
  buttons += rec.archived === true
    ? '<button type="button" class="secondary-btn" data-cf-restore="' + escapeHtml(rec.id) + '">還原</button>'
    : '<button type="button" class="secondary-btn" data-cf-archive="' + escapeHtml(rec.id) + '">刪除</button>';
  const editing = s.editing && (s.editing.mode === "edit" || s.editing.mode === "fill") && s.editing.id === rec.id;
  return '<div class="food-detail">' + linesHtml(lines) + customFoodCompareHtml(s, rec) + (rec.archived === true ? "" : favoriteNoteHtml()) +
    '<div class="backup-actions">' + buttons + "</div>" + (editing ? customFoodEditFormHtml(s) : "") + "</div>";
}

function builtinRow(s, item, reason) {
  return foodsRowHtml(s, { uid: item.uid, name: item.name, meta: kcalText(item), reason: reason, detail: function () { return builtinDetailHtml(s, item); } });
}

function customRow(s, rec) {
  const item = fromCustomFood(rec);
  const reason = rec.archived === true ? null : foodsBlockLabel(item, s.profile || {});
  const meta = [rec.copied_from ? "從內建複製" : null, "約 " + rec.kcal + " kcal"].filter(Boolean).join(" · ");
  return foodsRowHtml(s, { uid: rec.id, name: rec.name, meta: meta, reason: reason, detail: function () { return customDetailHtml(s, rec); } });
}

function recordsOfSubtab(s, sub, archived) {
  return customFoodsNewestFirst(s.records.filter(function (r) {
    return (r.archived === true) === archived && foodsWhereOf(fromCustomFood(r)) === sub;
  }));
}

// 內建品項的組：超商、外食照選擇器的分組（角色分區、category 分組，被擋的在組內最後）；飲品・水果是「現成飲料」一組
function builtinGroupsHtml(s, sub, items) {
  const reasonOf = function (it) { return foodsBlockLabel(it, s.profile || {}); };
  if (items.length === 0) return "";
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

// 一個子分頁。超商、外食：常吃 → 內建各組 → 我的品項 → 你標了不吃 → 已隱藏 → 已封存 → 不吃的全部清單。
// 飲品・水果：常吃 → 現成飲料 → 家裡的飲品 → 水果 → 我的品項 → 你標了不吃（現成與分層合併）→ 已隱藏 → 已封存 → 全部清單（計畫第 21 項）。
// 常吃組（decisions #126 ③）：現成 → 分層 → 我的品項，搬過去、原分類不再出現；被擋的灰在組尾
// 自煮在 tree.js
export function foodsSubtabHtml(s) {
  const sub = s.subtab;
  if (sub === "cook") return cookSubtabHtml(s);
  const customs = s.records.filter(function (r) { return r.archived !== true; }).map(fromCustomFood);
  const parts = partitionAllChannels(s.catalog.products, customs, s.hidden);
  const list = sub === "drinks" ? parts.drinks : parts[sub];
  const builtin = list.filter(function (it) { return !it.is_custom; });
  const codeOf = function (it) { return blockOf(s, it).code; };
  const split = splitDisliked(builtin, codeOf);
  const treeSplit = splitDisliked(sub === "drinks" ? treeItemsOf(s, "drinks") : [], codeOf);
  // 灰字筆數在分出常吃組之前算（常吃組裡被擋的也算進去，審核 S3）
  const blocked = split.rest.concat(treeSplit.rest).filter(function (it) { return !blockOf(s, it).ok; }).length;
  let html = blocked > 0 ? '<p class="meal-picker-note">灰色的 ' + blocked + " 項因你的過敏原／飲食設定不能選，點開可以看原因。</p>" : "";
  const fav = foodsFavSet(s);
  const favSplit = splitFavorites(split.rest, fav);
  const mineAll = recordsOfSubtab(s, sub, false);
  const mine = mineAll.filter(function (r) { return !fav[r.id]; });
  const reasonOf = function (it) { return foodsBlockLabel(it, s.profile || {}); };
  const favs = favSplit.favorites.map(function (it) { return { uid: it.uid, check: it, row: function (reason) { return builtinRow(s, it, reason); } }; })
    .concat((sub === "drinks" ? treeFavorites(s, "drinks") : []).map(function (it) { const e = treeFavoriteEntry(s, it); e.check = it; return e; }))
    .concat(sub === "drinks" ? ingredientFavorites(s, "drinks") : [])
    .concat(mineAll.filter(function (r) { return fav[r.id]; }).map(function (r) { return { uid: r.id, check: fromCustomFood(r), row: function () { return customRow(s, r); } }; }));
  html += favoritesGroupHtml(favs, function (e) { return reasonOf(e.check); });
  html += builtinGroupsHtml(s, sub, favSplit.rest);
  if (sub === "drinks") html += drinksTreeHtml(s) + drinksIngredientsHtml(s);

  const label = FOODS_SUBTAB_LABELS[sub];
  html += '<section class="foods-group foods-mine"><h4 class="meal-picker-role">我的品項（' + mine.length + "）</h4>" +
    (mine.length ? mine.map(function (r) { return customRow(s, r); }).join("") : '<p class="backup-note">還沒有。</p>') +
    (s.editing && s.editing.mode === "add" ? customFoodEditFormHtml(s)
      : '<button type="button" class="secondary-btn" data-foods-add>＋新增到我的' + escapeHtml(label) + "品項</button>") + "</section>";

  const disliked = split.disliked.concat(treeSplit.disliked);
  html += detailsGroup(s, sub + ":disliked", "你標了不吃", disliked.length, function () {
    return split.disliked.map(function (it) { return builtinRow(s, it, "你標了不吃"); }).join("") +
      treeSplit.disliked.map(function (it) { return treeRow(s, it, "你標了不吃"); }).join("");
  }, disliked.some(function (it) { return it.uid === s.openUid; }));

  const hidden = hiddenEntries(s.hidden, s.catalog.productsByUid).filter(function (e) { return foodsWhereOf(s.catalog.productsByUid[e.uid]) === sub; });
  html += detailsGroup(s, sub + ":hidden", "已換成我的版本", hidden.length, function () {
    return hidden.map(function (e) {
      return '<div class="food-row"><div class="food-row-main"><span class="food-name">' + escapeHtml(e.name) + "</span></div>" +
        '<div class="backup-actions"><button type="button" class="secondary-btn" data-cf-unhide="' + escapeHtml(e.uid) + '">改回內建</button></div></div>';
    }).join("");
  }, false);

  const archived = recordsOfSubtab(s, sub, true);
  html += detailsGroup(s, sub + ":archived", "已刪除", archived.length, function () { return archived.map(function (r) { return customRow(s, r); }).join(""); },
    archived.some(function (r) { return r.id === s.openUid; }));

  return html + dislikedAllHtml(s);
}

// 搜尋的範圍：內建品項（含已隱藏）、代換表分層、我的品項（含已封存）；結果照子分頁順序，同子分頁內現成、分層、我的品項（審核 S9）。
// 標位置與狀態；別名命中的寫出別名（PRD 13.2）
function searchEntries(s) {
  const keys = dislikedKeys(s);
  const fav = foodsFavSet(s);
  const out = [];
  s.catalog.products.forEach(function (p) {
    const status = [s.hidden.indexOf(p.uid) !== -1 ? "已換成我的版本" : null, fav[p.uid] ? "常吃" : null, keys.indexOf(p.uid) !== -1 ? "你標了不吃" : null].filter(Boolean);
    const sub = foodsWhereOf(p);
    out.push({ uid: p.uid, name: p.name, sub: sub, rank: 0, where: FOODS_SUBTAB_LABELS[sub] + " · " + (p.category || "其他"), status: status, item: p });
  });
  treeSearchEntries(s, FOODS_SUBTAB_LABELS).forEach(function (e) {
    out.push(Object.assign(e, { rank: 1, status: keys.indexOf(e.uid) !== -1 ? ["你標了不吃"] : fav[e.uid] ? ["常吃"] : [] }));
  });
  ingredientSearchEntries(s, FOODS_SUBTAB_LABELS).forEach(function (e) {
    out.push(Object.assign(e, { rank: 3, status: e.archived ? ["已刪除"] : fav[e.uid] ? ["常吃"] : [] }));
  });
  customFoodsNewestFirst(s.records).forEach(function (r) {
    const sub = foodsWhereOf(fromCustomFood(r));
    out.push({ uid: r.id, name: r.name, sub: sub, rank: 2, where: FOODS_SUBTAB_LABELS[sub] + " · 我的品項", status: r.archived === true ? ["已刪除"] : fav[r.id] ? ["常吃"] : [], rec: r });
  });
  return out.map(function (e, i) { return Object.assign(e, { seq: i }); }).sort(function (a, b) {
    return FOODS_SUBTABS.indexOf(a.sub) - FOODS_SUBTABS.indexOf(b.sub) || a.rank - b.rank || a.seq - b.seq;
  });
}

// otherHits：同一次搜尋已經有別的結果（我的組合）時，食物沒有命中就不寫「沒有符合」
export function foodsSearchHtml(s, otherHits) {
  const hits = searchFoods(searchEntries(s), s.query);
  if (hits.length === 0 && otherHits) return "";
  if (hits.length === 0) return '<p class="backup-note">沒有符合「' + escapeHtml(s.query.trim()) + "」的食物。</p>";
  return '<section class="foods-group">' + hits.map(function (e) {
    const meta = [e.where].concat(e.matchedAlias ? ["別名：" + e.matchedAlias] : [], e.status).join(" · ");
    return foodsRowHtml(s, { uid: e.uid, name: e.name, meta: meta, reason: null,
      detail: function () { return e.rec ? customDetailHtml(s, e.rec) : e.ing ? ingredientDetailHtml(s, e.ing) : e.tree ? treeDetailHtml(s, e.tree) : builtinDetailHtml(s, e.item); } });
  }).join("") + "</section>";
}

export function foodsSubtabsHtml(s) {
  return FOODS_SUBTABS.map(function (t) {
    const sel = t === s.subtab && !s.query.trim();
    return '<button type="button" role="tab" class="meal-picker-tab' + (sel ? " selected" : "") + '" data-foods-subtab="' + t +
      '" aria-selected="' + (sel ? "true" : "false") + '">' + FOODS_SUBTAB_LABELS[t] + "</button>";
  }).join("");
}
