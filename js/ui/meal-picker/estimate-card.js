// 輕盈計畫 — 外食分頁最上方的「找不到？直接估算」（PRD 第 9 節、decisions #46）：
// 名稱（選填）＋ S/M/L → estimate 元件，只存在這一餐，不存成品項；估算是使用者自己宣告吃了什麼，不過硬性過濾。

import { escapeHtml } from "../../core/html.js";
import { ESTIMATE_SIZE_KCAL } from "../../core/config.js";

const SIZE_LABELS = { S: "小份", M: "一般", L: "大餐" };

// estimates：這一餐已加入的估算 [{ size, name }]
export function estimateCardHtml(estimates) {
  let html = '<div class="meal-picker-estimate"><div class="meal-picker-estimate-title">找不到？直接估算</div>' +
    '<p class="meal-picker-note">有聚餐？先記下來，其他餐會自動調整。</p>' +
    '<input type="text" id="meal-picker-estimate-name" class="meal-picker-input" maxlength="30" placeholder="名稱（選填，例：喜宴）">' +
    '<div class="compose-options">';
  Object.keys(ESTIMATE_SIZE_KCAL).forEach(function (size) {
    html += '<button type="button" class="compose-option" data-estimate-size="' + size + '">' + size + " " + SIZE_LABELS[size] +
      '<span class="item-card-kcal">約 ' + ESTIMATE_SIZE_KCAL[size] + " kcal</span></button>";
  });
  html += "</div>";
  if (estimates.length > 0) {
    html += '<div class="meal-picker-estimate-list">';
    estimates.forEach(function (e, i) {
      html += '<button type="button" class="compose-option selected" data-estimate-remove="' + i + '">' +
        escapeHtml((e.name || "外食估算") + "（" + e.size + "，約 " + ESTIMATE_SIZE_KCAL[e.size] + " kcal）") + " ×</button>";
    });
    html += "</div>";
  }
  return html + "</div>";
}
