// 輕盈計畫 — 選擇器的商品分頁（超商、外食）與共用的飲料步驟：只負責把 engine 分好的組畫成 HTML。
// 分組規則在 engine/picker.js groupForTab（PRD 6.3），被擋的原因來自 engine/filters.js passesHardFilters。

import { escapeHtml } from "../../core/html.js";
import { ROLE_LABELS, QTY_OPTIONS } from "../../core/config.js";
import { qtyLabel } from "../../engine/meal-content.js";

// 純文字卡片（decisions #8）：名稱＋熱量；被擋的灰階、寫原因、不能點
export function cardHtml(item, opts) {
  const o = opts || {};
  const blocked = o.blockedReason != null;
  const cls = "item-card" + (o.selected ? " selected" : "") + (blocked ? " is-blocked" : "");
  const key = o.drink ? "data-drink" : "data-uid";
  const reasonHtml = blocked ? '<span class="item-card-reason">' + escapeHtml(o.blockedReason) + "</span>" : "";
  const kcalText = item.kcal != null ? "約 " + item.kcal + " kcal" : "";
  return '<button type="button" class="' + cls + '" ' + key + '="' + escapeHtml(item.uid) + '"' + (blocked ? " disabled" : "") + ">" +
    '<span class="item-card-name">' + escapeHtml(item.name) + "</span>" +
    (kcalText ? '<span class="item-card-kcal">' + escapeHtml(kcalText) + "</span>" : "") +
    reasonHtml + "</button>";
}

// 被擋的我的品項，原因可以補填時（只有「未確認」類，PRD 10.4）卡片旁多一個「補填」按鈕（不巢狀在 disabled 的卡片裡）
function withFill(cardHtmlStr, item, reason, fillable) {
  if (!reason || !item.is_custom || !fillable || !fillable(reason)) return cardHtmlStr;
  return '<div class="item-card-wrap">' + cardHtmlStr +
    '<button type="button" class="secondary-btn item-fill-btn" data-fill-uid="' + escapeHtml(item.uid) + '">補填</button></div>';
}

function cardsHtml(entries, selected, fillable) {
  return '<div class="item-grid">' + entries.map(function (e) {
    return withFill(cardHtml(e.item, { selected: !e.reason && selected.indexOf(e.item.uid) !== -1, blockedReason: e.reason }), e.item, e.reason, fillable);
  }).join("") + "</div>";
}

// 份量晶片（PRD 12.3）：半份／1／1.5／2，不上色、不顯示熱量（看摘要，章程 C4.11、C4.13）
function qtyChipsHtml(uid, q) {
  return '<div class="compose-options qty-chips">' + QTY_OPTIONS.map(function (v) {
    return '<button type="button" class="compose-option' + (v === q ? " selected" : "") + '" data-qty-uid="' + escapeHtml(uid) + '" data-qty="' + v + '">' +
      (v === 1 ? "1 份" : qtyLabel(v)) + "</button>";
  }).join("") + "</div>";
}

// 已選的一行：名稱、份量；內建品項再加「不吃」「複製成我的版本」（PRD 10.2、13.5；「隱藏」由「不吃」取代，decisions #99）
export function selectedRowHtml(item, q) {
  const actions = item.is_custom ? "" :
    '<div class="selected-actions"><button type="button" class="link-btn" data-dislike-uid="' + escapeHtml(item.uid) + '">不吃</button>' +
    '<button type="button" class="link-btn" data-copy-uid="' + escapeHtml(item.uid) + '">複製成我的版本</button></div>';
  return '<div class="selected-row"><div class="selected-name">' + escapeHtml(item.name) + "</div>" + qtyChipsHtml(item.uid, q) + actions + "</div>";
}

// 「已選」段（超商／外食分頁，品項清單上方）
export function selectedSectionHtml(items, qtyByUid) {
  if (items.length === 0) return "";
  return '<div class="meal-picker-selected"><div class="meal-picker-step-label">已選（可以改份量）</div>' +
    items.map(function (it) { return selectedRowHtml(it, qtyByUid[it.uid] || 1); }).join("") + "</div>";
}

// 標不吃後的提示列＋復原（取消不吃）
export function dislikeNoticeHtml(notice) {
  if (!notice) return "";
  return '<div class="meal-picker-note dislike-notice"><p>已標不吃「' + escapeHtml(notice.name) + '」，可以在「我的食物」取消。</p>' +
    '<button type="button" class="secondary-btn" data-undislike-uid="' + escapeHtml(notice.uid) + '">復原</button></div>';
}

// 「你標了不吃（N）」：放在分頁（或飲料步驟）最下方、預設收合；卡片灰階不能點，旁邊「取消不吃」（PRD 6.3 第 4 點）
export function dislikedGroupHtml(items, drink) {
  if (!items || items.length === 0) return "";
  return '<details class="meal-picker-group meal-picker-disliked"><summary>你標了不吃（' + items.length + "）</summary>" +
    '<div class="item-grid">' + items.map(function (it) {
      return '<div class="item-card-wrap">' + cardHtml(it, { drink: drink, blockedReason: "你標了不吃" }) +
        '<button type="button" class="secondary-btn item-fill-btn" data-undislike-uid="' + escapeHtml(it.uid) + '">取消不吃</button></div>';
    }).join("") + "</div></details>";
}

// groups：engine groupForTab 的結果（不含標了不吃的，那些在 dislikedGroupHtml）；selected：這個分頁已選的 uid；
// tabLabel：「超商」「外食」；fillable：原因可不可以補填
export function productTabHtml(groups, selected, tabLabel, fillable) {
  const total = groups.reduce(function (n, g) { return n + g.entries.length; }, 0);
  const blocked = groups.reduce(function (n, g) { return n + g.blocked; }, 0);
  let html = "";
  if (total - blocked === 0) {
    html += '<p class="meal-picker-note">這個時段的' + escapeHtml(tabLabel) + "分頁沒有可以選的品項，可以看看其他分頁，或只記飲料。</p>";
  }
  if (blocked > 0) html += '<p class="meal-picker-note">灰色的 ' + blocked + " 項因你的過敏原／飲食設定不能選。</p>";
  let role = null;
  groups.forEach(function (g) {
    if (g.is_custom) {
      // 預設收合；有已選的（例：剛快速新增並選中）就展開，讓人看得到
      const open = g.entries.some(function (e) { return selected.indexOf(e.item.uid) !== -1; });
      html += '<details class="meal-picker-group meal-picker-custom"' + (open ? " open" : "") + "><summary>我的品項（" + g.entries.length + "）</summary>" +
        cardsHtml(g.entries, selected, fillable) + "</details>";
      return;
    }
    if (g.role !== role) {
      role = g.role;
      html += '<h4 class="meal-picker-role">' + escapeHtml(ROLE_LABELS[role] || role) + "</h4>";
    }
    const name = escapeHtml(g.category || "其他");
    if (g.blocked === g.entries.length) {
      html += '<details class="meal-picker-group is-all-blocked"><summary>' + name + "（" + g.blocked + " 項因設定不能選）</summary>" +
        cardsHtml(g.entries, selected) + "</details>";
    } else {
      html += '<section class="meal-picker-group"><h5 class="meal-picker-category">' + name + "</h5>" + cardsHtml(g.entries, selected) + "</section>";
    }
  });
  return html;
}

// 現成飲料（「加飲品・水果」步驟裡，三分頁共用）：「不加」＋可選的飲料，被擋的排最後、灰階寫原因。
// entries：[{ item, reason }]（不含標了不吃的，那些併進步驟最下方的不吃組，food-step.js）；fillable：被擋的我的品項飲料可不可以補填
export function drinkGridHtml(entries, drinkUid, fillable) {
  let html = '<div class="item-grid">';
  html += '<button type="button" class="item-card' + (drinkUid ? "" : " selected") + '" data-drink=""><span class="item-card-name">不加</span></button>';
  entries.filter(function (e) { return !e.reason; }).concat(entries.filter(function (e) { return e.reason; })).forEach(function (e) {
    html += withFill(cardHtml(e.item, { drink: true, selected: !e.reason && e.item.uid === drinkUid, blockedReason: e.reason }), e.item, e.reason, fillable);
  });
  return html + "</div>";
}
