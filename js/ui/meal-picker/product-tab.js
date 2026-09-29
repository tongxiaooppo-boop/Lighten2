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

// 已選的一行：名稱、份量；內建品項再加「隱藏」「複製成我的版本」（B-1a，PRD 10.2）
export function selectedRowHtml(item, q) {
  const actions = item.is_custom ? "" :
    '<div class="selected-actions"><button type="button" class="link-btn" data-hide-uid="' + escapeHtml(item.uid) + '">隱藏</button>' +
    '<button type="button" class="link-btn" data-copy-uid="' + escapeHtml(item.uid) + '">複製成我的版本</button></div>';
  return '<div class="selected-row"><div class="selected-name">' + escapeHtml(item.name) + "</div>" + qtyChipsHtml(item.uid, q) + actions + "</div>";
}

// 「已選」段（超商／外食分頁，品項清單上方）
export function selectedSectionHtml(items, qtyByUid) {
  if (items.length === 0) return "";
  return '<div class="meal-picker-selected"><div class="meal-picker-step-label">已選（可以改份量）</div>' +
    items.map(function (it) { return selectedRowHtml(it, qtyByUid[it.uid] || 1); }).join("") + "</div>";
}

// 隱藏後的提示列＋復原
export function hideNoticeHtml(notice) {
  if (!notice) return "";
  return '<div class="meal-picker-note hide-notice"><p>已隱藏「' + escapeHtml(notice.name) + '」。可以到基本資料的「我的品項」取消隱藏。</p>' +
    '<button type="button" class="secondary-btn" data-unhide-uid="' + escapeHtml(notice.uid) + '">復原</button></div>';
}

// groups：engine groupForTab 的結果；selected：這個分頁已選的 uid；tabLabel：「超商」「外食」；fillable：原因可不可以補填
export function productTabHtml(groups, selected, tabLabel, fillable) {
  const total = groups.reduce(function (n, g) { return n + g.entries.length; }, 0);
  const blocked = groups.reduce(function (n, g) { return n + g.blocked; }, 0);
  let html = "";
  if (total - blocked === 0) {
    html += '<p class="meal-picker-note">這個時段的' + escapeHtml(tabLabel) + "分頁沒有可以選的品項，可以看看其他分頁，或只記飲料。</p>";
  }
  if (blocked > 0) html += '<p class="meal-picker-note">灰色的 ' + blocked + " 項因你的過敏原／飲食／不吃設定不能選。</p>";
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

// 飲料步驟（三分頁共用）：「不加」＋可選的飲料，被擋的排最後、灰階寫原因。entries：[{ item, reason }]
// extraHtml：選中那杯的份量與動作、提示、表單（B-1a）；fillable：被擋的我的品項飲料可不可以補填
export function drinkStepHtml(entries, drinkUid, stepNo, extraHtml, fillable) {
  let html = '<div class="meal-picker-step-label">' + stepNo + ". 加飲料（選填）</div><div class=\"item-grid\">";
  html += '<button type="button" class="item-card' + (drinkUid ? "" : " selected") + '" data-drink=""><span class="item-card-name">不加</span></button>';
  entries.filter(function (e) { return !e.reason; }).concat(entries.filter(function (e) { return e.reason; })).forEach(function (e) {
    html += withFill(cardHtml(e.item, { drink: true, selected: !e.reason && e.item.uid === drinkUid, blockedReason: e.reason }), e.item, e.reason, fillable);
  });
  return html + "</div>" + (extraHtml || "");
}
