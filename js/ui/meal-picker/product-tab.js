// 輕盈計畫 — 選擇器的商品分頁（超商、外食）與共用的飲料步驟：只負責把 engine 分好的組畫成 HTML。
// 分組規則在 engine/picker.js groupForTab（PRD 6.3），被擋的原因來自 engine/filters.js passesHardFilters。

import { escapeHtml } from "../../core/html.js";
import { ROLE_LABELS } from "../../core/config.js";

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

function cardsHtml(entries, selected) {
  return '<div class="item-grid">' + entries.map(function (e) {
    return cardHtml(e.item, { selected: !e.reason && selected.indexOf(e.item.uid) !== -1, blockedReason: e.reason });
  }).join("") + "</div>";
}

// groups：engine groupForTab 的結果；selected：這個分頁已選的 uid；tabLabel：「超商」「外食」
export function productTabHtml(groups, selected, tabLabel) {
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
        cardsHtml(g.entries, selected) + "</details>";
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
export function drinkStepHtml(entries, drinkUid, stepNo) {
  let html = '<div class="meal-picker-step-label">' + stepNo + ". 加飲料（選填）</div><div class=\"item-grid\">";
  html += '<button type="button" class="item-card' + (drinkUid ? "" : " selected") + '" data-drink=""><span class="item-card-name">不加</span></button>';
  entries.filter(function (e) { return !e.reason; }).concat(entries.filter(function (e) { return e.reason; })).forEach(function (e) {
    html += cardHtml(e.item, { drink: true, selected: !e.reason && e.item.uid === drinkUid, blockedReason: e.reason });
  });
  return html + "</div>";
}
