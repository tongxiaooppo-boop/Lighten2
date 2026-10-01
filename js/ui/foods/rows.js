// 輕盈計畫 — 「我的食物」的列、明細共用的小元件（工作線 D 切片 4，審核 S1：list.js 與 tree.js 共用，避免循環 import 與 C2 重名）。
// 只組 HTML 字串，不讀資料庫、不存狀態（狀態在 tab-foods.js，由參數 s 傳入）；模組頂層不碰 document。
// 文字一律中性，不上色、不警告（章程 C4.13）。

import { escapeHtml } from "../../core/html.js";
import { sameSampleEntries, favoriteEffectText } from "../../engine/foods.js";
import { effectiveFavorites, favoriteEntries } from "../../engine/picker.js";
import { sodiumText, satFatText } from "../dom.js";

export const NO_PROFILE_NOTE = "先在基本資料填好身體數據並按計算，才能標「常吃」「不吃」。";

export function dislikedList(s) {
  return s.profile && Array.isArray(s.profile.disliked_ingredients) ? s.profile.disliked_ingredients : [];
}

export function dislikedKeys(s) {
  return dislikedList(s).map(function (d) { return d && d.key; });
}

// 常吃（工作線 D 切片 5）：一律用扣掉不吃之後的清單（PRD 13.5、審核 S1）
export function foodsFavSet(s) {
  return effectiveFavorites(s.favorites, dislikedList(s));
}

// 子分頁最上面的「常吃（N）」（decisions #126 ③）：不收合、0 筆不畫。
// entries：[{ item, kind, row(reason) }]；能選的在前、被擋的灰在組尾（decisions #127 ④），reasonOf 由呼叫端給
export function favoritesGroupHtml(entries, reasonOf) {
  if (!entries || entries.length === 0) return "";
  const ordered = favoriteEntries(entries, function (e) { return reasonOf(e); });
  return '<section class="foods-group foods-favorites"><h4 class="meal-picker-role">常吃（' + entries.length + "）</h4>" +
    ordered.map(function (x) { return x.item.row(x.reason); }).join("") + "</section>";
}

// 明細的「常吃」／「取消常吃」（PRD 13.6；按鈕列第一個，審核 S13）；沒有基本資料時停用
export function favoriteButtonHtml(s, uid) {
  const on = !!foodsFavSet(s)[uid];
  const dis = s.profile ? "" : " disabled";
  return on
    ? '<button type="button" class="secondary-btn" data-foods-unfavorite="' + escapeHtml(uid) + '"' + dis + ">取消常吃</button>"
    : '<button type="button" class="secondary-btn" data-foods-favorite="' + escapeHtml(uid) + '"' + dis + ">常吃</button>";
}

export function favoriteNoteHtml() {
  return '<p class="food-detail-line">' + escapeHtml(favoriteEffectText()) + "</p>";
}

// 數字照資料原樣（跟「內建目前的數值」、選擇器一致，不另外進位）
function gramText(label, v) {
  return label + " " + (v == null ? "無資料" : v + "g");
}

export function nutrientLines(v) {
  return [
    [gramText("蛋白質", v.protein_g), gramText("碳水", v.carb_g), gramText("脂肪", v.fat_g), gramText("纖維", v.fiber_g)].join(" · "),
    satFatText(v.sat_fat_g, false) + " · " + sodiumText(v.sodium_mg, false, true),
  ];
}

export function dietText(item) {
  const d = item.diet_tags || [];
  return "飲食宣告：" + (d.length ? d.join("、") : "沒有宣告全素或蛋奶素");
}

export function linesHtml(lines) {
  return lines.filter(Boolean).map(function (t) { return '<p class="food-detail-line">' + escapeHtml(t) + "</p>"; }).join("");
}

// 一列：名稱、meta、被擋原因（灰）；整列可以點開明細，被擋的也可以（一次只開一筆）。
// detail 是函式：只有點開的那一列才組明細
export function foodsRowHtml(s, o) {
  const open = s.openUid === o.uid;
  const cls = "food-row" + (o.reason ? " is-blocked" : "");
  return '<div class="' + cls + '"><button type="button" class="food-row-main" data-foods-open="' + escapeHtml(o.uid) + '" aria-expanded="' + (open ? "true" : "false") + '">' +
    '<span class="food-name">' + escapeHtml(o.name) + "</span>" +
    (o.meta ? '<span class="food-meta">' + escapeHtml(o.meta) + "</span>" : "") +
    (o.reason ? '<span class="food-status">' + escapeHtml(o.reason) + "</span>" : "") +
    "</button>" + (open ? o.detail() : "") + "</div>";
}

// 可收合的組（審核 M3、S3）：展開狀態記在 s.openSections[key]（tab-foods.js 聽 toggle 寫回），或 forceOpen（含點開的列）。
// inner 是函式；lazy（分層的大類、子類，量大）收合時不產生內容 HTML，其他組照舊一律畫（walkthrough 在收合時也找得到列）。count 是 0 就不畫
export function detailsGroup(s, key, title, count, inner, forceOpen, extraClass, lazy) {
  if (count === 0) return "";
  const open = !!(s.openSections && s.openSections[key]) || !!forceOpen;
  return '<details class="foods-group foods-folded' + (extraClass ? " " + extraClass : "") + '" data-foods-section="' + escapeHtml(key) + '"' + (lazy ? " data-foods-lazy" : "") + (open ? " open" : "") + ">" +
    "<summary>" + escapeHtml(title) + "（" + count + "）</summary>" + (open || !lazy ? inner() : "") + "</details>";
}

// 明細底部的「不吃」／「取消不吃」與說明（PRD 13.5）；沒有基本資料時停用
export function dislikeButtonHtml(s, uid) {
  const disliked = dislikedKeys(s).indexOf(uid) !== -1;
  const dis = s.profile ? "" : " disabled";
  return disliked
    ? '<button type="button" class="secondary-btn" data-foods-undislike="' + escapeHtml(uid) + '"' + dis + ">取消不吃</button>"
    : '<button type="button" class="secondary-btn" data-foods-dislike="' + escapeHtml(uid) + '"' + dis + ">不吃</button>";
}

export function dislikeNotesHtml(s, uid) {
  const disliked = dislikedKeys(s).indexOf(uid) !== -1;
  return favoriteNoteHtml() + (disliked ? "" : '<p class="food-detail-line">「不吃」只擋這一項。</p>') +
    (s.profile ? "" : '<p class="food-detail-line">' + escapeHtml(NO_PROFILE_NOTE) + "</p>");
}

// 同樣本（decisions #85、#108、#115）：明細一律列出；剛在這一列標了不吃（或取消）時，對另一邊還沒跟上的出現「也標不吃」「也取消」
export function sameSampleHtml(s, uid) {
  const list = sameSampleEntries(uid, s.catalog, dislikedList(s));
  if (list.length === 0) return "";
  const selfDisliked = dislikedKeys(s).indexOf(uid) !== -1;
  const acted = s.acted && s.acted.uid === uid ? s.acted : null;
  const line = function (kind, label) {
    const xs = list.filter(function (e) { return e.kind === kind; });
    return xs.length ? '<p class="food-detail-line">' + escapeHtml(label + xs.map(function (e) { return e.name; }).join("、")) + "</p>" : "";
  };
  let buttons = "";
  if (acted && s.profile) {
    list.forEach(function (e) {
      if (selfDisliked && !e.disliked) buttons += '<button type="button" class="secondary-btn" data-foods-also-dislike="' + escapeHtml(e.uid) + '">也標不吃「' + escapeHtml(e.name) + "」</button>";
      if (!selfDisliked && e.disliked) buttons += '<button type="button" class="secondary-btn" data-foods-also-undislike="' + escapeHtml(e.uid) + '">也取消「' + escapeHtml(e.name) + "」</button>";
    });
  }
  return '<div class="foods-same-sample">' + line("sample", "同一個衛福部樣品：") + line("form", "同一種食材的其他形式：") +
    (buttons ? '<div class="backup-actions">' + buttons + "</div>" : "") + "</div>";
}
