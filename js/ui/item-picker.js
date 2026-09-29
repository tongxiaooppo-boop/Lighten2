// 輕盈計畫 (Lighten Plan) — 「自己選」的品項清單：從 catalog 取出現成品項＋我的品項、依時段與硬性過濾分成可選/被擋、渲染卡片。
// 選取策略（多選、角色上限）由 manual-picker.js 管。Phase 0 改成三分頁選擇器（ui/meal-picker/）。

import { escapeHtml } from "../core/html.js";
import { fromCustomFood } from "../data/catalog.js";
import { passesHardFilters } from "../engine/filters.js";
import { fitsSlot } from "../engine/picker.js";

// 「整套便當」分類：自己選要排除
const WHOLE_MEAL_CATEGORIES = ["健身餐盒", "蔬食餐盒", "減醣餐盒", "連鎖健康餐盒", "宅配健身餐"];

// 直接帶 catalog 品項的全部欄位（章程 C2：逐欄抄會漏掉新加的欄位），只加上 picker 專用的欄位
function toPickerItem(p) {
  return Object.assign({}, p, { id: p.source_id, components: [p.uid], is_custom: !!p.is_custom });
}

// 順序：台式外食、超商/連鎖、我的品項。excludeWholeMeals：台式只留飲料、超商排除整套便當。
function pickerItems(catalog, customFoods, opts) {
  const o = opts || {};
  const items = [];
  catalog.products.forEach(function (p) {
    if (!p.is_taiwan) return;
    if (o.excludeWholeMeals && p.role !== "drink") return;
    items.push(toPickerItem(p));
  });
  catalog.products.forEach(function (p) {
    if (p.is_taiwan) return;
    if (o.excludeWholeMeals && WHOLE_MEAL_CATEGORIES.indexOf(p.category) !== -1) return;
    items.push(toPickerItem(p));
  });
  customFoods.forEach(function (f) { items.push(toPickerItem(fromCustomFood(f))); });
  return items;
}

export function filterForSlot(catalog, customFoods, slot, profile, opts) {
  const pass = [];
  const blocked = [];
  pickerItems(catalog, customFoods, opts).forEach(function (it) {
    if (!fitsSlot(it, slot)) return;
    const res = passesHardFilters(it, profile);
    if (res.ok) pass.push(it);
    else blocked.push({ item: it, reason: res.reason });
  });
  return { pass: pass, blocked: blocked };
}

export function cardHtml(item, opts) {
  const o = opts || {};
  const blocked = o.blockedReason != null;
  const cls = "item-card" + (o.selected ? " selected" : "") + (blocked ? " is-blocked" : "");
  const reasonHtml = blocked ? '<span class="item-card-reason">' + escapeHtml(o.blockedReason) + "</span>" : "";
  const kcalText = item.kcal != null ? "約 " + item.kcal + " kcal" : "";
  return '<button type="button" class="' + cls + '" data-item-id="' + escapeHtml(item.id) +
    '" data-uid="' + escapeHtml(item.uid) + '"' + (blocked ? " disabled" : "") + ">" +
    '<span class="item-card-name">' + escapeHtml(item.name) + "</span>" +
    (kcalText ? '<span class="item-card-kcal">' + escapeHtml(kcalText) + "</span>" : "") +
    reasonHtml + "</button>";
}
