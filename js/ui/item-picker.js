// 輕盈計畫 (Lighten Plan) — 「自己選」的品項清單：從 catalog 取出現成品項＋我的品項、依時段與硬性過濾分成可選/被擋、渲染卡片。
// 選取策略（多選、角色上限）由 manual-picker.js 管。Phase 0 改成三分頁選擇器（ui/meal-picker/）。

import { escapeHtml } from "../core/html.js";
import { fromCustomFood } from "../data/catalog.js";
import { passesHardFilters } from "../engine/filters.js";

// 台式熱門品項 id → 縮圖（Phase 0 品項卡片改純文字時移除，decisions #8）
const TAIWAN_ITEM_IMAGE = {
  bf01: "images/food/egg-pancake.jpg", bf02: "images/food/milk-glass.jpg", bf03: "images/food/rice-ball.jpg",
  bf04: "images/food/pork-egg-toast.jpg", bf06: "images/food/radish-cake.jpg", bf07: "images/food/teppan-noodles.jpg",
  bf08: "images/food/sweet-potato.jpg", bf09: "images/food/youtiao.jpg", bf10: "images/food/scallion-pancake-egg.jpg",
  ln01: "images/food/pork-chop-bento.jpg", ln02: "images/food/chicken-leg-bento.jpg", ln03: "images/food/dumplings.jpg",
  ln04: "images/food/beef-noodle-soup.jpg", ln05: "images/food/noodle-soup.jpg", ln06: "images/food/buffet-rice.jpg",
  ln07: "images/food/healthy-bento.jpg", ln08: "images/food/braised-pork-rice.jpg", ln09: "images/food/ham-fried-rice.jpg",
  ln10: "images/food/conv-store-bento.jpg", dn01: "images/food/hot-pot.jpg", dn02: "images/food/popcorn-chicken.jpg",
  dn03: "images/food/luwei.jpg", dn04: "images/food/teppanyaki.jpg", dn05: "images/food/sushi-set.jpg",
  dn06: "images/food/oyster-omelet.jpg", dn07: "images/food/boiled-healthy-meal.jpg", dn08: "images/food/pasta.jpg",
  dn09: "images/food/home-cooking.jpg", dn10: "images/food/congee.jpg", sn01: "images/food/popcorn-chicken.jpg",
  sn02: "images/food/skewers-grill.jpg", sn03: "images/food/instant-noodles.jpg", sn04: "images/food/xiaolongbao.jpg",
  sn05: "images/food/fried-chicken-cutlet.jpg", sn06: "images/food/luwei.jpg", sn07: "images/food/oden.jpg",
  sn08: "images/food/cold-noodles.jpg", sn09: "images/food/douhua.jpg", sn10: "images/food/salt-water-chicken.jpg",
  dr01: "images/food/bubble-tea-full-sugar.jpg", dr02: "images/food/bubble-tea-half-sugar.jpg",
  dr03: "images/food/black-tea-unsweetened.jpg", dr04: "images/food/fruit-tea.jpg", dr05: "images/food/latte.jpg",
  dr06: "images/food/soy-milk.jpg", fw01: "images/food/big-mac-meal.jpg", fw02: "images/food/big-mac.jpg",
  fw03: "images/food/fried-chicken-fries.jpg", fw04: "images/food/pizza-slices.jpg", fw05: "images/food/burger-meal.jpg",
};

// 「整套便當」分類：自己選要排除
const WHOLE_MEAL_CATEGORIES = ["健身餐盒", "蔬食餐盒", "減醣餐盒", "連鎖健康餐盒", "宅配健身餐"];

// 直接帶 catalog 品項的全部欄位（章程 C2：逐欄抄會漏掉新加的欄位），只加上 picker 專用的欄位
function toPickerItem(p) {
  return Object.assign({}, p, {
    id: p.source_id, components: [p.uid], is_custom: !!p.is_custom,
    image: p.is_taiwan ? TAIWAN_ITEM_IMAGE[p.source_id] || null : null,
  });
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

function fitsSlot(item, slot) {
  return item.role === "drink" || (Array.isArray(item.valid_slots) && item.valid_slots.indexOf(slot) !== -1);
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
  const imgHtml = item.image
    ? '<img class="item-card-img" src="' + item.image + '" alt="' + escapeHtml(item.name) + '" loading="lazy">'
    : '<div class="item-card-img item-card-img-empty" aria-hidden="true"></div>';
  const cls = "item-card" + (o.selected ? " selected" : "") + (blocked ? " is-blocked" : "");
  const reasonHtml = blocked ? '<span class="item-card-reason">' + escapeHtml(o.blockedReason) + "</span>" : "";
  const kcalText = item.kcal != null ? "約 " + item.kcal + " kcal" : "";
  return '<button type="button" class="' + cls + '" data-item-id="' + escapeHtml(item.id) +
    '" data-uid="' + escapeHtml(item.uid) + '"' + (blocked ? " disabled" : "") + ">" +
    imgHtml + '<span class="item-card-name">' + escapeHtml(item.name) + "</span>" +
    (kcalText ? '<span class="item-card-kcal">' + escapeHtml(kcalText) + "</span>" : "") +
    reasonHtml + "</button>";
}
