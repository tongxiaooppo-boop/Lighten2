// 輕盈計畫 — 「我的食物」的代換表分層（工作線 D 切片 4；PRD 13.3、decisions #114–#117）：自煮子分頁、
// 飲品・水果的「家裡的飲品」與「水果」、分層品項的列與明細、搜尋項目。
// 只組 HTML 字串，不讀資料庫、不存狀態（狀態在 tab-foods.js，由參數 s 傳入）；模組頂層不碰 document。
// 分組、份量、出處、灰字、同樣本都問 engine（章程 C1、C4.11）；文字一律中性（章程 C4.13）。

import { passesHardFilters } from "../../engine/filters.js";
import {
  foodTreeSections, foodTreeServingText, foodTreeServingShort, builtinMealLine, foodTreeSourceText, sugarLine,
  allergenSummary, foodsBlockLabel, foodBlockText,
} from "../../engine/foods.js";
import { nutrientLines, dietText, linesHtml, foodsRowHtml, detailsGroup, dislikeButtonHtml, dislikeNotesHtml, sameSampleHtml } from "./rows.js";
import { dislikedAllHtml } from "./disliked.js";

const HIGH_CALCIUM = "高鈣深色蔬菜";

function codeOf(s, item) {
  return passesHardFilters(item, s.profile || {}).code;
}

function kcalOf(item) {
  return item.per_serving.kcal == null ? "熱量無資料" : "約 " + item.per_serving.kcal + " kcal";
}

// 分層品項的明細（PRD 13.3）：份量、今日建議的一餐、營養、過敏原、飲食、含糖、說明、出處、同樣本、以目前設定、不吃
export function treeDetailHtml(s, item) {
  const block = foodBlockText(item, s.profile || {});
  const lines = [foodTreeServingText(item), builtinMealLine(item, s.catalog), "熱量：" + kcalOf(item)]
    .concat(nutrientLines(item.per_serving), [
      allergenSummary(item.allergen_tags), dietText(item), sugarLine(item), item.note,
      item.tags.indexOf(HIGH_CALCIUM) !== -1 ? "每日飲食指南的高鈣深色蔬菜" : null,
    ], foodTreeSourceText(item), [block ? "以你目前的設定：" + block : null]);
  return '<div class="food-detail">' + linesHtml(lines) + sameSampleHtml(s, item.uid) + dislikeNotesHtml(s, item.uid) +
    '<div class="backup-actions">' + dislikeButtonHtml(s, item.uid) + "</div></div>";
}

export function treeRow(s, item, reason) {
  return foodsRowHtml(s, { uid: item.uid, name: item.name, meta: foodTreeServingShort(item) + " · " + kcalOf(item), reason: reason,
    detail: function () { return treeDetailHtml(s, item); } });
}

// 一組品項的列：沒被擋的在前、被擋的在後（組內原順序，PRD 6.3）；標了不吃的不在這裡（移到「你標了不吃」）
function rowsHtml(s, items) {
  const entries = items.map(function (it) { return { item: it, reason: foodsBlockLabel(it, s.profile || {}) }; });
  return entries.filter(function (e) { return !e.reason; }).concat(entries.filter(function (e) { return e.reason; }))
    .map(function (e) { return treeRow(s, e.item, e.reason); }).join("");
}

function notDisliked(s) {
  return function (it) { return codeOf(s, it) !== "disliked"; };
}

// 一個大類：可收合（預設收合），裡面每個子類也可收合；乳品類沒有子類只有一層（審核 S3）。筆數不含標了不吃的
function majorHtml(s, prefix, group) {
  const keep = notDisliked(s);
  const subs = group.subgroups.map(function (sg) { return Object.assign({}, sg, { items: sg.items.filter(keep) }); })
    .filter(function (sg) { return sg.items.length > 0; });
  const count = subs.reduce(function (n, sg) { return n + sg.items.length; }, 0);
  const holds = function (items) { return items.some(function (it) { return it.uid === s.openUid; }); };
  const key = prefix + ":" + group.code;
  return detailsGroup(s, key, group.name, count, function () {
    if (subs.length === 1 && subs[0].code === null) return rowsHtml(s, subs[0].items);
    return subs.map(function (sg) {
      const title = sg.name + (sg.app_defined ? "（本 App 自己的分組）" : "");
      const soyNote = group.code === "protein" && sg.code === "soy" ? '<p class="meal-picker-note">無糖豆漿在「飲品・水果」。</p>' : "";
      return detailsGroup(s, key + ":" + sg.code, title, sg.items.length, function () { return soyNote + rowsHtml(s, sg.items); }, holds(sg.items), "foods-minor", true);
    }).join("");
  }, subs.some(function (sg) { return holds(sg.items); }), "foods-major", true);
}

// 子分頁裡的分層品項（標不吃分組、灰字筆數用）
export function treeItemsOf(s, where) {
  const t = s.catalog.foodTree;
  if (where === "cook") {
    const out = [];
    foodTreeSections(t, "cook").forEach(function (g) { g.subgroups.forEach(function (sg) { sg.items.forEach(function (it) { out.push(it); }); }); });
    return out;
  }
  const d = foodTreeSections(t, "drinks");
  const out = d.homeDrinks.slice();
  if (d.fruit) d.fruit.subgroups.forEach(function (sg) { sg.items.forEach(function (it) { out.push(it); }); });
  return out;
}

function blockedNote(n) {
  return n > 0 ? '<p class="meal-picker-note">灰色的 ' + n + " 項因你的過敏原／飲食設定不能選，點開可以看原因。</p>" : "";
}

// 自煮子分頁（PRD 13.3、計畫第 20 項）：六大類（水果除外）→ 你標了不吃 → 不吃的全部清單。
// 沒有我的品項、新增、已隱藏、已封存（我的食材、我的料理在切片 8、9，不放空殼，decisions #94、#97）
export function cookSubtabHtml(s) {
  const all = treeItemsOf(s, "cook");
  const disliked = all.filter(function (it) { return codeOf(s, it) === "disliked"; });
  const blocked = all.filter(function (it) { const c = codeOf(s, it); return c && c !== "disliked"; }).length;
  return blockedNote(blocked) +
    foodTreeSections(s.catalog.foodTree, "cook").map(function (g) { return majorHtml(s, "cook", g); }).join("") +
    detailsGroup(s, "cook:disliked", "你標了不吃", disliked.length, function () {
      return disliked.map(function (it) { return treeRow(s, it, "你標了不吃"); }).join("");
    }, disliked.some(function (it) { return it.uid === s.openUid; })) +
    dislikedAllHtml(s);
}

// 飲品・水果的分層兩組（緊接在現成飲料之後，decisions #114）：家裡的飲品（平列）、水果（兩層收合）
export function drinksTreeHtml(s) {
  const d = foodTreeSections(s.catalog.foodTree, "drinks");
  const home = d.homeDrinks.filter(notDisliked(s));
  let html = home.length ? '<section class="foods-group"><h4 class="meal-picker-role">家裡的飲品</h4>' + rowsHtml(s, home) + "</section>" : "";
  if (d.fruit) html += majorHtml(s, "drinks", d.fruit);
  return html;
}

// 搜尋用的項目：位置寫子分頁 · 大類 · 子類（家裡的飲品寫組名）
export function treeSearchEntries(s, subLabels) {
  const t = s.catalog.foodTree;
  const groupName = {}, subName = {};
  t.groups.forEach(function (g) {
    groupName[g.code] = g.name;
    (g.subgroups || []).forEach(function (sg) { subName[g.code + ":" + sg.code] = sg.name; });
  });
  return treeItemsOf(s, "cook").concat(treeItemsOf(s, "drinks")).map(function (it) {
    const sub = it.group === "fruit" || it.home_drink ? "drinks" : "cook";
    const where = it.home_drink ? "家裡的飲品" : groupName[it.group] + (it.subgroup && subName[it.group + ":" + it.subgroup] ? " · " + subName[it.group + ":" + it.subgroup] : "");
    return { uid: it.uid, name: it.name, aliases: it.aliases, sub: sub, where: subLabels[sub] + " · " + where, tree: it };
  });
}

