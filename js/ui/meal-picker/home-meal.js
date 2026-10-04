// 輕盈計畫 — 選擇器自煮分頁的「共餐」區塊（家庭共餐，decisions #152）：
// 主食（含不吃）→ 主食量 → 從當季家常菜清單選 1–4 樣（依素菜／菜肉／純肉分組標題）→ 菜量 → 湯（至多 1 道）。
// 清單、克數、能不能選都問 engine（homeMealChoices、homeMealGrams、homeMealProblem）；這裡只畫畫面。
// 按鈕一律用 data 屬性＋事件委派（沒有新的 DOM id）。

import { escapeHtml } from "../../core/html.js";
import {
  EST_SIZES, EST_STAPLES, EST_DISH_GRAMS, EST_STAPLE_PORTIONS, EST_STAPLE_G_PER_PORTION, EST_SOUP_ML, EST_STAPLE_LABELS, HOME_MEAL_DISH_MAX,
} from "../../core/config.js";
import { homeMealChoices, homeMealGrams, homeMealProblem } from "../../engine/meal-content.js";
import { chip, group, PART_LABELS } from "./estimate-card.js";

// 共餐入口（放在「選餐型」那排）
export function homeMealToggleHtml(open) {
  return chip("data-hm-toggle", "1", open, "共餐");
}

// hm：{ open, form }；ctx：{ catalog, profile, season }
export function homeMealStepHtml(hm, ctx, label) {
  const form = hm.form;
  const choices = homeMealChoices(ctx.catalog, ctx.season, ctx.profile, form.dishes.concat(form.soup ? [form.soup] : []));
  let html = '<div class="compose-step"><div class="meal-picker-step-label">' + escapeHtml(label) + "</div>" +
    '<p class="meal-picker-note">家裡的共餐：記你自己吃的那一份。選主食、當季的家常菜 1–' + HOME_MEAL_DISH_MAX + " 樣；每一樣的量是全部的菜平分。</p>";
  html += group("主食", EST_STAPLES.map(function (k) { return chip("data-hm-staple", k, form.staple === k, EST_STAPLE_LABELS[k]); }).join(""));
  if (form.staple !== "none") {
    html += group("主食量", EST_SIZES.map(function (s) {
      return chip("data-hm-staple-size", s, form.staple_size === s, PART_LABELS[s], EST_STAPLE_PORTIONS[s] * EST_STAPLE_G_PER_PORTION[form.staple] + "g");
    }).join(""));
  }
  choices.groups.forEach(function (g) {
    html += group(g.label, g.dishes.map(function (x) {
      const on = form.dishes.indexOf(x.item.uid) !== -1;
      return chip("data-hm-dish", x.item.uid, on, x.item.name, x.reason || (x.offSeason ? "非當季" : null), !!x.reason && !on);
    }).join(""));
  });
  html += '<p class="meal-picker-note">純肉＝肉、魚、蛋、豆腐為主。已選 ' + form.dishes.length + " 道（最多 " + HOME_MEAL_DISH_MAX + " 道）。</p>";
  html += group("菜量（全部的菜合計" + (form.dishes.length > 1 ? "，平分給 " + form.dishes.length + " 道" : "") + "）", EST_SIZES.map(function (s) {
    return chip("data-hm-size", s, form.dish === s, PART_LABELS[s], EST_DISH_GRAMS[s] + "g");
  }).join(""));
  html += group("湯（選填）", chip("data-hm-soup", "", !form.soup, "不加") + choices.soups.map(function (x) {
    return chip("data-hm-soup", x.item.uid, form.soup === x.item.uid, x.item.name, x.reason || (x.offSeason ? "非當季" : EST_SOUP_ML + "ml"), !!x.reason && form.soup !== x.item.uid);
  }).join(""));
  const problem = homeMealProblem(form, ctx.catalog, ctx.profile);
  if (problem) return html + '<p class="meal-picker-note">' + escapeHtml(problem) + "</p></div>";
  if (form.dishes.length > 0 || form.soup) {
    const g = homeMealGrams(form);
    const parts = [];
    if (g.staple_g) parts.push(EST_STAPLE_LABELS[form.staple] + " " + g.staple_g + "g");
    if (form.dishes.length > 0) parts.push("每道菜約 " + g.per_dish_g + "g");
    if (g.soup_ml) parts.push("湯 " + g.soup_ml + "ml");
    html += '<p class="meal-picker-note">' + escapeHtml(parts.join("、") + "。數字是依家常菜配方估計的，不是你這一餐的實際數字。") + "</p>";
  }
  return html + "</div>";
}
