// 輕盈計畫 — 「我的食物」自煮子分頁的家常菜（2026-10-11）：角色分組的列與明細，可以 ☆（今日建議的自煮從 ☆ 的菜裡挑，自己選也排在最前面）、可以標不吃。
// 家常菜的資料在 catalog.homeDishes（data/home_dishes.json）；只組 HTML 字串，不讀資料庫、不存狀態（狀態在 tab-foods.js，由參數 s 傳入）。
// 文字一律中性（章程 C4.13）。

import { foodsBlockLabel, foodBlockText, allergenSummary } from "../../engine/foods.js";
import { homeDishKind } from "../../engine/cook.js";
import { nutrientLines, linesHtml, foodsRowHtml, detailsGroup, dislikeButtonHtml, dislikeNotesHtml, foodsFavSet, favoriteButtonHtml, dislikedKeys } from "./rows.js";

// 角色分組的順序與標題（整碗、粥是主食，另外分組）
const ROLE_GROUPS = [["主菜", "主菜"], ["蛋豆菜", "蛋豆菜・半葷素"], ["青菜", "青菜"], ["小菜", "小菜・根莖菇"], ["湯", "湯"], ["整碗", "整碗主食"], ["粥", "粥"]];

export function homeDishesOf(s) {
  return (s.catalog.homeDishes && s.catalog.homeDishes.dishes) || [];
}

function dishRole(d) {
  return d.kind === "soup" ? "湯" : d.role;
}

// 這道菜本身標了不吃（只比菜的 id）；成分裡有你不吃的食材而被擋的，照一般灰字列在原位，不算在「你標了不吃」
function explicitDisliked(s, d) {
  return dislikedKeys(s).indexOf(d.id) !== -1;
}

function metaOf(d) {
  const parts = [dishRole(d) === "湯" ? "湯" : d.role, d.method, d.tier === "🔴" ? (d.passive ? "預約電鍋" : "開伙") : "快煮", d.mins ? d.mins + " 分" : null];
  if (homeDishKind(d) === "pot") parts.push("一鍋");
  return parts.filter(Boolean).join(" · ");
}

export function homeDishDetailHtml(s, d) {
  const block = foodBlockText(d, s.profile || {});
  const lines = ["每 100g 熱量：約 " + d.per_100g.kcal + " kcal"].concat(nutrientLines({
    protein_g: d.per_100g.protein_g, carb_g: d.per_100g.carb_g, fat_g: d.per_100g.fat_g, fiber_g: d.per_100g.fiber_g,
    sat_fat_g: d.per_100g.sat_fat_g, sodium_mg: d.per_100g.sodium_mg,
  }), [
    "一份配方約 " + d.cooked_g + "g，" + (d.serv || 1) + " 人份" + (d.mins ? "；約 " + d.mins + " 分鐘" : ""),
    allergenSummary(d.allergen_tags),
    d.note,
    block ? "以你目前的設定：" + block : null,
  ]);
  return '<div class="food-detail">' + linesHtml(lines) + dislikeNotesHtml(s, d.id) +
    '<div class="backup-actions">' + favoriteButtonHtml(s, d.id) + dislikeButtonHtml(s, d.id) + "</div></div>";
}

export function homeDishRow(s, d, reason) {
  return foodsRowHtml(s, { uid: d.id, name: d.name, meta: metaOf(d), reason: reason, detail: function () { return homeDishDetailHtml(s, d); } });
}

// ☆ 的家常菜（扣掉不吃），照菜庫順序
export function homeDishFavorites(s) {
  const fav = foodsFavSet(s);
  return homeDishesOf(s).filter(function (d) { return fav[d.id] && !explicitDisliked(s, d); });
}

export function homeDishFavoriteEntry(s, d) {
  return { uid: d.id, row: function (reason) { return homeDishRow(s, d, reason); }, tree: d };
}

export function homeDishesDisliked(s) {
  return homeDishesOf(s).filter(function (d) { return explicitDisliked(s, d); });
}

function holds(s, list) {
  return list.some(function (d) { return d.id === s.openUid; });
}

// 家常菜：可收合的一組，裡面依角色分小組；☆ 的搬到最上面的常吃組、不吃的在「你標了不吃」，這裡不重複
export function homeDishesGroupHtml(s) {
  const fav = foodsFavSet(s);
  const listed = homeDishesOf(s).filter(function (d) { return !explicitDisliked(s, d) && !fav[d.id]; });
  if (listed.length === 0) return "";
  const blockedCount = listed.filter(function (d) { return foodsBlockLabel(d, s.profile || {}); }).length;
  const rows = function (list) {
    const entries = list.map(function (d) { return { d: d, reason: foodsBlockLabel(d, s.profile || {}) }; });
    return entries.filter(function (e) { return !e.reason; }).concat(entries.filter(function (e) { return e.reason; })).map(function (e) { return homeDishRow(s, e.d, e.reason); }).join("");
  };
  return detailsGroup(s, "cook:home", "家常菜", listed.length, function () {
    const note = '<p class="meal-picker-note">標 ☆：今日建議的家常餐會從你標的菜裡挑（不夠的用預設補），自己選也排在最前面。' +
      (blockedCount > 0 ? "灰色的 " + blockedCount + " 道因你的過敏原／飲食設定不能選（家常菜是複合料理，成分標「未確認」）。" : "") + "</p>";
    return note + ROLE_GROUPS.map(function (g) {
      const list = listed.filter(function (d) { return dishRole(d) === g[0]; });
      return detailsGroup(s, "cook:home:" + g[0], g[1], list.length, function () { return rows(list); }, holds(s, list), "foods-minor", true);
    }).join("");
  }, holds(s, listed), "foods-major", true);
}

// 搜尋用的項目
export function homeDishSearchEntries(s, subLabels) {
  return homeDishesOf(s).map(function (d) {
    return { uid: d.id, name: d.name, aliases: [], sub: "cook", where: subLabels.cook + " · 家常菜 · " + (dishRole(d) === "湯" ? "湯" : d.role), home: d };
  });
}
