// 輕盈計畫 — 選擇器的兩個共用步驟「加飲品・水果」「加點單品」（工作線 D 切片 7；PRD 13.4）：只組 HTML。
// 分組與排序是 engine/foods.js foodTreeSections，份量文字是 foodQtyText，灰字是 foodsBlockLabel；選取規則在 engine/picker.js。
// 只被 renderDrinks 呼叫，一次 innerHTML 寫進 #meal-picker-drinks；不碰 DOM（快照的 fake DOM 也會跑這裡，計畫 8.2 M4）。

import { escapeHtml } from "../../core/html.js";
import { FOOD_QTY_STEP, FOOD_QTY_MAX, FOOD_AMOUNT_MAX } from "../../core/config.js";
import { foodQtyText, foodTreeServingShort, foodsWhereOf, searchFoods, foodAmountModeText } from "../../engine/foods.js";
import { cardHtml, favoriteLinkHtml, favoriteTitleHtml } from "./product-tab.js";

// st：{ foods: { items, byId, labels, codes }, sections: { cook, drinks }, sel: [{ uid, qty } | { uid, amount }], open: {key: bool}, query, fav: { uid: true } }
// labels：uid → 灰字（foodsBlockLabel）；codes：uid → passesHardFilters 的 code（"disliked" 的移到不吃組）；
// fav：扣掉不吃之後的常吃（engine effectiveFavorites），常吃的搬到步驟最上面的常吃組（decisions #126 ②）

function selOf(st, uid) {
  return st.sel.filter(function (x) { return x.uid === uid; })[0] || null;
}

function unitOf(item) {
  return item.serving.unit === "ml" ? "ml" : "g";
}

// 卡片上的已選量：「已選 · 2 份」「已選 · 120g」
function selectedText(item, f) {
  return f.amount != null ? f.amount + unitOf(item) : f.qty + " 份";
}

// 卡片上的 1 份：「代換表 1 份 · 生重 30g · 約 N kcal」；沒設一份的我的食材寫「每 100g 約 N kcal」（切片 8b）
function servingLine(item) {
  if (item.serving.amount == null) return "每 100" + unitOf(item) + " 約 " + Math.round(item.per_100g.kcal) + " kcal";
  return foodTreeServingShort(item) + " · 約 " + Math.round(item.per_serving.kcal) + " kcal";
}

// 單品卡片（審核 S5）：名稱＋「代換表 1 份 · 生重 30g · 約 N kcal」；已選的標「已選 · N 份」；被擋的灰、寫原因、不能點
function foodCardHtml(st, item, where) {
  const reason = st.foods.labels[item.uid] || null;
  const q = reason ? null : selOf(st, item.uid);
  const cls = "item-card" + (q != null ? " selected" : "") + (reason ? " is-blocked" : "");
  return '<button type="button" class="' + cls + '" data-food-uid="' + escapeHtml(item.uid) + '"' + (reason ? " disabled" : "") + ">" +
    '<span class="item-card-name">' + escapeHtml(item.name) + "</span>" +
    '<span class="item-card-kcal">' + escapeHtml(servingLine(item)) + "</span>" +
    (where ? '<span class="item-card-kcal">' + escapeHtml(where) + "</span>" : "") +
    (q != null ? '<span class="item-card-kcal">已選 · ' + escapeHtml(selectedText(item, q)) + "</span>" : "") +
    (reason ? '<span class="item-card-reason">' + escapeHtml(reason) + "</span>" : "") + "</button>";
}

// 留在原分類的：不是不吃（步驟最下方）、也不是常吃（步驟最上面）
function stepListed(st, it) {
  return st.foods.codes[it.uid] !== "disliked" && !(st.fav && st.fav[it.uid]);
}

// 組內：能選的在前、被擋的灰在最後；標了不吃與常吃的不在這裡
function gridHtml(st, items) {
  const shown = items.filter(function (it) { return stepListed(st, it); });
  const ordered = shown.filter(function (it) { return !st.foods.labels[it.uid]; }).concat(shown.filter(function (it) { return st.foods.labels[it.uid]; }));
  return '<div class="item-grid">' + ordered.map(function (it) { return foodCardHtml(st, it, null); }).join("") + "</div>";
}

function countShown(st, items) {
  return items.filter(function (it) { return stepListed(st, it); }).length;
}

// 常吃的分層品項（照原順序；不吃的不算，codes 已含不吃判斷）
function favoriteFoods(st, items) {
  return items.filter(function (it) { return st.fav && st.fav[it.uid] && st.foods.codes[it.uid] !== "disliked"; });
}

// 步驟最上面的常吃組：drinkEntries（現成飲料 [{ item, reason }]，用 drinkCard 畫）→ 分層品項；能選的在前、被擋的灰在組尾（decisions #127 ④）
function favoriteGroupHtml(st, drinkEntries, drinkCard, foodItems) {
  const drinks = drinkEntries || [];
  const drinkCardOf = drinkCard || function () { return ""; };
  if (drinks.length + foodItems.length === 0) return "";
  const ok = drinks.filter(function (e) { return !e.reason; }).map(drinkCardOf)
    .concat(foodItems.filter(function (it) { return !st.foods.labels[it.uid]; }).map(function (it) { return foodCardHtml(st, it, null); }));
  const blocked = drinks.filter(function (e) { return e.reason; }).map(drinkCardOf)
    .concat(foodItems.filter(function (it) { return st.foods.labels[it.uid]; }).map(function (it) { return foodCardHtml(st, it, null); }));
  return '<section class="meal-picker-group meal-picker-favorites">' + favoriteTitleHtml() + '<div class="item-grid">' + ok.concat(blocked).join("") + "</div></section>";
}

// 可收合的組：展開狀態記在 st.open[key]（index.js 聽 toggle 寫回）；收合時不產生內容（量大）
function foldHtml(st, key, title, items, inner, cls) {
  const n = countShown(st, items);
  if (n === 0) return "";
  const open = !!st.open[key];
  return '<details class="foods-group foods-folded ' + cls + '" data-food-section="' + escapeHtml(key) + '"' + (open ? " open" : "") + ">" +
    "<summary>" + escapeHtml(title) + "（" + n + "）</summary>" + (open ? inner() : "") + "</details>";
}

// 一個大類：只有一個沒有代碼的子類（乳品類）直接放品項；否則子類再收合一層
// 這個大類的我的食材（切片 8b-2，decisions #134：跟代換表一起顯示，放在最後一組）
function mineOf(st, code) {
  return (st.sections.mine && st.sections.mine.cook[code]) || [];
}

function mineFoldHtml(st, key, items) {
  return foldHtml(st, key + ":mine", "我的食材", items, function () { return gridHtml(st, items); }, "foods-minor");
}

function foodMajorHtml(st, prefix, g) {
  const all = [];
  g.subgroups.forEach(function (s) { Array.prototype.push.apply(all, s.items); });
  const mine = prefix === "cook:" ? mineOf(st, g.code) : [];
  return foldHtml(st, prefix + g.code, g.name, all.concat(mine), function () {
    const tail = mine.length ? mineFoldHtml(st, prefix + g.code, mine) : "";
    if (g.subgroups.length === 1 && g.subgroups[0].code === null) return gridHtml(st, g.subgroups[0].items) + tail;
    return g.subgroups.map(function (s) {
      return foldHtml(st, prefix + g.code + ":" + s.code, s.name, s.items, function () { return gridHtml(st, s.items); }, "foods-minor");
    }).join("") + tail;
  }, "foods-major");
}

// 份／克切換（decisions #136）：兩個按鈕，目前的 aria-pressed；沒有 1 份的只有克，不畫切換
function modeSwitchHtml(uid, item, f) {
  if (item.serving.amount == null) return "";
  const unit = item.serving.unit === "ml" ? "毫升" : "克";
  const btn = function (label, on) {
    return '<button type="button" class="compose-option food-mode-btn" data-food-mode="' + uid + '" aria-pressed="' + (on ? "true" : "false") + '"' +
      (on ? " disabled" : "") + ">" + label + "</button>";
  };
  return '<span class="food-mode">' + btn("份", f.amount == null) + btn(unit, f.amount != null) + "</span>";
}

// 份數記法：步進器；克數記法：數字輸入（失焦或 Enter 才寫回，index.js 聽 change）
function amountControlHtml(uid, item, f) {
  if (f.amount == null) {
    return '<button type="button" class="compose-option food-step-btn" data-food-step="' + uid + '" data-dir="-1" aria-label="少 0.5 份"' + (f.qty <= FOOD_QTY_STEP ? " disabled" : "") + ">−</button>" +
      '<span class="food-qty">' + f.qty + " 份</span>" +
      '<button type="button" class="compose-option food-step-btn" data-food-step="' + uid + '" data-dir="1" aria-label="多 0.5 份"' + (f.qty >= FOOD_QTY_MAX ? " disabled" : "") + ">＋</button>";
  }
  const unit = unitOf(item);
  return '<input type="number" class="food-amount-input" data-food-amount="' + uid + '" inputmode="numeric" min="1" max="' + FOOD_AMOUNT_MAX + '" step="1" value="' + f.amount + '"' +
    ' aria-label="' + (unit === "ml" ? "毫升" : "克數") + '"><span class="food-qty">' + unit + "</span>";
}

// 已選框（審核 S4：不用 .meal-picker-step-label，步驟編號檢查才不會讀到它）：名稱、份／克、步進器或克數、份量文字、移除
function selectedBoxHtml(st, where) {
  const rows = st.sel.map(function (f) { return { f: f, item: st.foods.byId[f.uid] }; })
    .filter(function (x) { return x.item && foodsWhereOf(x.item) === where; });
  if (rows.length === 0) return "";
  return '<div class="meal-picker-selected food-selected"><div class="food-selected-title">已選（可以改份量）</div>' + rows.map(function (x) {
    const uid = escapeHtml(x.f.uid);
    return '<div class="selected-row" id="food-sel-' + uid + '"><div class="selected-name">' + escapeHtml(x.item.name) + "</div>" +
      '<div class="food-stepper">' + modeSwitchHtml(uid, x.item, x.f) + amountControlHtml(uid, x.item, x.f) +
      favoriteLinkHtml(x.f.uid, !!(st.fav && st.fav[x.f.uid])) +
      '<button type="button" class="link-btn" data-food-remove="' + uid + '">移除</button></div>' +
      '<div class="food-qty-text">' + escapeHtml(x.f.amount != null ? foodAmountModeText(x.item, x.f.amount) : foodQtyText(x.item, x.f.qty)) + "</div></div>";
  }).join("") + "</div>";
}

// 「你標了不吃（N）」：預設收合；drinkItems 是標了不吃的現成飲料（只在飲品・水果步驟，跟單品合併一組，PRD 6.3）
function dislikedFoldHtml(st, drinkItems, foodItems) {
  const n = drinkItems.length + foodItems.length;
  if (n === 0) return "";
  const undo = function (uid) { return '<button type="button" class="secondary-btn item-fill-btn" data-undislike-uid="' + escapeHtml(uid) + '">取消不吃</button>'; };
  return '<details class="meal-picker-group meal-picker-disliked"><summary>你標了不吃（' + n + "）</summary>" + '<div class="item-grid">' +
    drinkItems.map(function (it) { return '<div class="item-card-wrap">' + cardHtml(it, { drink: true, blockedReason: "你標了不吃" }) + undo(it.uid) + "</div>"; }).join("") +
    foodItems.map(function (it) { return '<div class="item-card-wrap">' + foodCardHtml(st, it, null) + undo(it.uid) + "</div>"; }).join("") +
    "</div></details>";
}

function dislikedOf(st, items) {
  return items.filter(function (it) { return st.foods.codes[it.uid] === "disliked"; });
}

// 加飲品・水果：已選框 → 常吃（favDrinks＋家裡的飲品＋水果）→ 現成飲料（drinkGridHtml，照舊 1 杯）＋選中那杯的份量與動作（drinkExtraHtml）
// → 家裡的飲品 → 水果（兩層收合）→ 不吃（合併）。favDrinks：常吃的現成飲料 [{ item, reason }]，drinkCard 畫一張（審核 S4）
export function drinksFruitStepHtml(st, stepNo, drinkGridHtml, drinkExtraHtml, dislikedDrinks, favDrinks, drinkCard) {
  const d = st.sections.drinks;
  const fruitItems = [];
  if (d.fruit) d.fruit.subgroups.forEach(function (s) { Array.prototype.push.apply(fruitItems, s.items); });
  const mineDrinks = (st.sections.mine && st.sections.mine.drinks) || [];
  Array.prototype.push.apply(fruitItems, mineDrinks);
  let html = '<div class="meal-picker-step-label">' + stepNo + ". 加飲品・水果（選填）</div>" + selectedBoxHtml(st, "drinks") +
    favoriteGroupHtml(st, favDrinks, drinkCard, favoriteFoods(st, d.homeDrinks.concat(fruitItems))) +
    '<h4 class="meal-picker-role">現成飲料</h4>' + drinkGridHtml + (drinkExtraHtml || "");
  if (countShown(st, d.homeDrinks) > 0) html += '<h4 class="meal-picker-role">家裡的飲品</h4>' + gridHtml(st, d.homeDrinks);
  if (d.fruit) html += foodMajorHtml(st, "fruit:", d.fruit);
  if (countShown(st, mineDrinks) > 0) html += '<h4 class="meal-picker-role">我的食材</h4>' + gridHtml(st, mineDrinks);
  return html + dislikedFoldHtml(st, dislikedDrinks || [], dislikedOf(st, d.homeDrinks.concat(fruitItems)));
}

// 搜尋結果（審核 S1）：搜全部分層品項，飲品・水果的標出所在步驟；空字串不列
export function foodSearchResultsHtml(st) {
  const hits = searchFoods(st.foods.items, st.query);
  if (String(st.query || "").trim() === "") return "";
  if (hits.length === 0) return '<p class="meal-picker-note">找不到「' + escapeHtml(String(st.query).trim()) + "」。</p>";
  // 標了不吃的也列出來（灰字「你標了不吃」，取消在步驟最下方的不吃組）
  return '<div class="item-grid">' + hits.map(function (it) {
    return foodCardHtml(st, it, foodsWhereOf(it) === "drinks" ? "在飲品・水果" : null);
  }).join("") + "</div>";
}

// 加點單品：說明 → 已選框 → 常吃 → 搜尋 → 大類 > 子類兩層收合 → 不吃（搜尋結果照舊全列，常吃的也在）
export function addFoodsStepHtml(st, stepNo) {
  const cookItems = [];
  st.sections.cook.forEach(function (g) { g.subgroups.forEach(function (s) { Array.prototype.push.apply(cookItems, s.items); }); });
  const mine = st.sections.mine || { cook: {}, other: [], drinks: [] };
  Object.keys(mine.cook).forEach(function (k) { Array.prototype.push.apply(cookItems, mine.cook[k]); });
  mine.other.forEach(function (o) { Array.prototype.push.apply(cookItems, o.items); });
  const otherAll = [];
  mine.other.forEach(function (o) { Array.prototype.push.apply(otherAll, o.items); });
  const otherHtml = foldHtml(st, "cook:other", "其他食材", otherAll, function () {
    return mine.other.map(function (o) { return foldHtml(st, "cook:other:" + o.name, o.name, o.items, function () { return gridHtml(st, o.items); }, "foods-minor"); }).join("");
  }, "foods-major");
  return '<div class="meal-picker-step-label">' + stepNo + ". 加點單品（選填）</div>" +
    '<p class="meal-picker-note">單品不含烹調用油；有用油可以加油脂類。</p>' +
    (st.lookupNote ? '<p class="meal-picker-note">' + escapeHtml(st.lookupNote) + "</p>" : "") + selectedBoxHtml(st, "cook") +
    favoriteGroupHtml(st, [], null, favoriteFoods(st, cookItems)) +
    '<input type="search" class="foods-search" id="meal-picker-food-search" placeholder="搜尋單品（名稱或別名）" value="' + escapeHtml(st.query || "") + '">' +
    '<div id="meal-picker-food-results">' + foodSearchResultsHtml(st) + "</div>" +
    st.sections.cook.map(function (g) { return foodMajorHtml(st, "cook:", g); }).join("") + otherHtml +
    dislikedFoldHtml(st, [], dislikedOf(st, cookItems));
}
