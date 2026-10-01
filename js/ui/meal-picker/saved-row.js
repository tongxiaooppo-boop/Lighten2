// 輕盈計畫 — 選擇器最上面的「我的組合」列與入口 1 的「存成組合」（工作線 C；PRD 11.2、11.3）：只組 HTML。
// 解析、熱量、名稱都是 engine（resolveSavedMeal、savedMealTotals、savedMealDefaultName）算好傳進來；不碰 DOM（快照的 fake DOM 也會跑）。

import { escapeHtml } from "../../core/html.js";

// 型態用文字，不做圖示（decisions #124）
export const SAVED_TYPE_LABELS = { convenience: "超商", delivery: "外食", cook_quick: "快煮", cook_full: "開伙" };

// cards：[{ id, name, meal_type, contentText, kcal, unavailable, usable }]，照建立順序；沒有組合時不輸出（既有快照不變的前提）
export function savedRowHtml(cards, notice) {
  if (!cards || cards.length === 0) return notice ? '<p class="meal-picker-note">' + escapeHtml(notice) + "</p>" : "";
  return '<div class="saved-row"><div class="saved-row-label">我的組合（點了帶入，可以再改）</div><div class="saved-row-cards">' +
    cards.map(function (c) {
      return '<button type="button" class="saved-card' + (c.usable ? "" : " is-blocked") + '" data-saved-id="' + escapeHtml(c.id) + '"' + (c.usable ? "" : " disabled") + ">" +
        '<span class="saved-card-name">' + escapeHtml(c.name) + "</span>" +
        '<span class="saved-card-meta">' + escapeHtml((SAVED_TYPE_LABELS[c.meal_type] || "") + " · 約 " + Math.round(c.kcal) + " kcal") + "</span>" +
        (c.contentText && c.contentText !== c.name ? '<span class="saved-card-meta">' + escapeHtml(c.contentText) + "</span>" : "") +
        (c.unavailable ? '<span class="saved-card-note">' + escapeHtml(c.unavailable) + "</span>" : "") + "</button>";
    }).join("") + "</div></div>" + (notice ? '<p class="meal-picker-note">' + escapeHtml(notice) + "</p>" : "");
}

// 「存成組合」勾選與名稱（放在 #meal-picker-drinks 尾端；狀態在 mealPicker.saveAs，render 只讀 state，審核 M8）。
// estimates：這一餐有估算時不能勾（decisions #124）
export function saveAsHtml(saveAs, hasEstimates) {
  const on = saveAs.on && !hasEstimates;
  return '<div class="save-as"><label class="save-as-check"><input type="checkbox" data-save-as' + (on ? " checked" : "") + (hasEstimates ? " disabled" : "") + ">" +
    " 存成組合（下次在「自己選」最上面一點就帶入）</label>" +
    (hasEstimates ? '<p class="meal-picker-note">估算的一餐不能存成組合。</p>' : "") +
    (on ? '<input type="text" class="foods-search save-as-name" id="meal-picker-save-name" maxlength="40" placeholder="組合名稱" value="' + escapeHtml(saveAs.name || "") + '">' : "") +
    "</div>";
}
