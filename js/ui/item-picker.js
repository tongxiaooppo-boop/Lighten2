// 輕盈計畫 (Lighten Plan) — 共用品項挑選器
// 美饗日曆（單選）跟今日建議手動組餐（多選）共用同一套「資料正規化 + 硬性過濾 + 卡片渲染」，
// 避免兩處各寫一份品項清單/過濾/卡片邏輯。選取策略（單選/多選、role 上限）由各呼叫端自己管。
// 依賴：database.js（getTaiwanItems/getCustomFoods）、recommend.js（passesHardFilters/sumOrNull）。

(function () {
  "use strict";

  var ALL_SLOTS = ["breakfast", "lunch", "afternoon_tea", "dinner", "snack"];

  // 台式熱門品項 id → 縮圖
  var TAIWAN_ITEM_IMAGE = {
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

  function round1(n) { return Math.round(n * 10) / 10; }

  function escapeHtml(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  var _convCache = null;
  async function getConvenienceItems() {
    if (_convCache) return _convCache;
    var res = await fetch("data/convenience_items.json");
    if (!res.ok) throw new Error("[item-picker.js] 載入 convenience_items.json 失敗");
    _convCache = await res.json();
    return _convCache;
  }

  function normalizeTaiwan(it) {
    var kcal = it.kcal_rep != null ? it.kcal_rep : round1((it.kcal_low + it.kcal_high) / 2);
    return { uid: "tw_" + it.id, id: it.id, name: it.name, role: it.role, valid_slots: it.valid_slots || [],
      kcal: kcal, protein_g: it.protein_g != null ? it.protein_g : null,
      // 2026-09-27：taiwan_items.json 已用食物代換表份量概念＋熱量平衡反推補上 carb_g/fat_g（估算值，非官方逐筆查證）。
      carb_g: it.carb_g != null ? it.carb_g : null, fat_g: it.fat_g != null ? it.fat_g : null, fiber_g: it.fiber_g != null ? it.fiber_g : null,
      allergen_tags: Array.isArray(it.allergen_tags) ? it.allergen_tags : [],
      diet_tags: [], components: ["tw_" + it.id],
      is_custom: false, is_taiwan: true, image: TAIWAN_ITEM_IMAGE[it.id] || null };
  }
function normalizeConvenience(it) {
    return { uid: it.id, id: it.id, name: it.name, role: it.role, valid_slots: it.valid_slots || [],
      kcal: it.kcal != null ? it.kcal : null, protein_g: it.protein_g != null ? it.protein_g : null,
      carb_g: it.carb_g != null ? it.carb_g : null, fat_g: it.fat_g != null ? it.fat_g : null,
      fiber_g: it.fiber_g != null ? it.fiber_g : null,
      allergen_tags: Array.isArray(it.allergen_tags) ? it.allergen_tags : [],
      diet_tags: it.diet_tags || [], components: [it.id],
      is_custom: false, is_taiwan: false, image: null };
  }

  function normalizeCustom(f) {
    return { uid: f.id, id: f.id, name: f.name, role: "side", valid_slots: ALL_SLOTS,
      kcal: f.kcal != null ? f.kcal : null, protein_g: f.protein_g != null ? f.protein_g : null,
      carb_g: f.carb_g != null ? f.carb_g : null, fat_g: f.fat_g != null ? f.fat_g : null,
      fiber_g: f.fiber_g != null ? f.fiber_g : null,
      allergen_tags: [], diet_tags: [], components: [f.id],
      is_custom: true, is_taiwan: false, image: null };
  }

  async function loadItems(opts) {
    opts = opts || {};
    var items = [];
    var taiwan = await getTaiwanItems();
    taiwan.forEach(function (it) { items.push(normalizeTaiwan(it)); });
    if (opts.includeConvenience !== false) {
      var conv = await getConvenienceItems();
      conv.forEach(function (it) { items.push(normalizeConvenience(it)); });
    }
    var custom = await getCustomFoods();
    custom.forEach(function (f) { items.push(normalizeCustom(f)); });
    return items;
  }

  function fitsSlot(item, slot) {
    return item.role === "drink" || (Array.isArray(item.valid_slots) && item.valid_slots.indexOf(slot) !== -1);
  }

  async function filterForSlot(slot, profile, opts) {
    var items = await loadItems(opts);
    var pass = [];
    var blocked = [];
    items.forEach(function (it) {
      if (!fitsSlot(it, slot)) return;
      var res = window.passesHardFilters ? window.passesHardFilters(it, profile) : { ok: true, reason: null };
      if (res.ok) pass.push(it);
      else blocked.push({ item: it, reason: res.reason });
    });
    return { pass: pass, blocked: blocked };
  }

  function cardHtml(item, opts) {
    opts = opts || {};
    var blocked = opts.blockedReason != null;
    var imgHtml = item.image
      ? '<img class="feast-item-card-img" src="' + item.image + '" alt="' + escapeHtml(item.name) + '" loading="lazy">'
      : '<div class="feast-item-card-img feast-item-card-img-empty" aria-hidden="true"></div>';
    var cls = "feast-item-card" + (opts.selected ? " selected" : "") + (blocked ? " is-blocked" : "");
    var reasonHtml = blocked ? '<span class="feast-item-card-reason">' + escapeHtml(opts.blockedReason) + "</span>" : "";
    var kcalText = item.kcal != null ? "約 " + item.kcal + " kcal" : "";
    return '<button type="button" class="' + cls + '" data-item-id="' + escapeHtml(item.id) +
      '" data-uid="' + escapeHtml(item.uid) + '"' + (blocked ? " disabled" : "") + ">" +
      imgHtml + '<span class="feast-item-card-name">' + escapeHtml(item.name) + "</span>" +
      (kcalText ? '<span class="feast-item-card-kcal">' + escapeHtml(kcalText) + "</span>" : "") +
      reasonHtml + "</button>";
  }

  function sumSelected(items) {
    return {
      kcal: round1(items.reduce(function (s, it) { return s + (Number(it.kcal) || 0); }, 0)),
      protein_g: window.sumOrNull ? window.sumOrNull(items, "protein_g") : null,
      carb_g: window.sumOrNull ? window.sumOrNull(items, "carb_g") : null,
      fat_g: window.sumOrNull ? window.sumOrNull(items, "fat_g") : null,
      fiber_g: window.sumOrNull ? window.sumOrNull(items, "fiber_g") : null,
    };
  }

  window.ItemPicker = {
    loadItems: loadItems, filterForSlot: filterForSlot, fitsSlot: fitsSlot,
    cardHtml: cardHtml, sumSelected: sumSelected, TAIWAN_ITEM_IMAGE: TAIWAN_ITEM_IMAGE,
  };
})();