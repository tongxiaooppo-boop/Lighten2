// 輕盈計畫 — 「我的食物」最下方的「你標了不吃的全部」（PRD 13.2、13.5；取代基本資料的「不吃的食材」）。
// 含推薦卡片「順便不要」加的食材（共用內建 id 的也在自煮子分頁的「你標了不吃」）與已下架殘留的 key（章程 B9：列「已不提供」可移除）。
// 展開狀態記在 s.openSections["all:disliked"]；內容一律畫出來（不像其他組收合時不畫）。
// 只組 HTML；模組頂層不碰 document。

import { escapeHtml } from "../../core/html.js";
import { dislikedListEntries } from "../../engine/foods.js";

export function dislikedAllHtml(s) {
  const list = s.profile && Array.isArray(s.profile.disliked_ingredients) ? s.profile.disliked_ingredients : [];
  const entries = dislikedListEntries(list, s.catalog);
  if (entries.length === 0) return "";
  const open = s.openSections && s.openSections["all:disliked"] ? " open" : "";
  return '<details class="foods-group foods-folded foods-disliked-all" data-foods-section="all:disliked"' + open + '><summary>你標了不吃的全部（' + entries.length + "）</summary>" +
    '<p class="backup-note">推薦與「自己選」都不會出現這些。上面各組的「你標了不吃」只算這個分類的品項，所以筆數可能不同。</p>' +
    entries.map(function (e) {
      const name = e.gone ? e.label + "（已不提供）" : e.name;
      return '<div class="food-row"><div class="food-row-main"><span class="food-name">' + escapeHtml(name) + "</span></div>" +
        '<div class="backup-actions"><button type="button" class="secondary-btn" data-foods-undislike="' + escapeHtml(e.key) + '">' +
        (e.gone ? "移除" : "取消不吃") + "</button></div></div>";
    }).join("") + "</details>";
}
