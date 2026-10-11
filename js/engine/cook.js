// 輕盈計畫 — 新自煮（2026-10-11）：餐盒、早餐盤、早餐碗、家常餐的選項、份量、用油與驗證。
// 全部是純函式：catalog、profile 由呼叫端傳入（章程 C1.1）。畫面只畫（章程 C2）。
//
// 一餐的內容記成「單品（food）元件」加克數，外加 content.form（編輯用的設定）與 content.implicit（下鍋油）：
//   元件多帶三個選填欄位 part（"box"|"plate"|"bowl"|"home"，不佔單品名額）、role、method；
//   組裝類（餐盒、早餐盤）每個蛋白質、蔬菜各有自己的做法，用油合計放在 implicit.oil_g。
// 食材的取捨規則（可生吃、筋多部位只滷燉、一餐份量）原本是原型的「例外表」，這裡是唯一來源。

import {
  COOK_METHODS, COOK_BOX_PROTEIN_METHODS, COOK_PLATE_PROTEIN_METHODS, COOK_VEG_METHODS, COOK_GOALS, COOK_PAMTS, COOK_CARB_AMTS,
  COOK_PROTEIN_MAX, COOK_VEG_MAX, COOK_EGG_G, COOK_EGG_MAX, COOK_HOME_DISH_MAX, COOK_SOUP_G, COOK_CONGEE_G, COOK_HOME_SIDE_PEOPLE,
  COOK_POT_AMTS, COOK_MEAL_SERVINGS, COOK_VEG_G, COOK_ITEM_CAP_G, COOK_FAT_HEAVY_PER_100, OIL_HABIT_FACTOR, isQuickTier, COOK_ENTRY_LABELS,
} from "../core/config.js";
import { passesHardFilters } from "./filters.js";

// ---------- 例外表（沿用原型） ----------
const EXCLUDE_PROTEIN = /蝦米|小魚干|蝦皮|肉乾|魚肉鬆|肉脯|豬肉酥|鹹小卷|鹹馧魚|豆豉|豆漿/;
const EXCLUDE_STAPLE = /麵包|吐司|餅|饅頭|燒餅|油條|甜不辣|糕|皮|麵粉|餐包|漢堡|蘇打|藕粉|西谷米|芋圓|粥/;
const RAW_OK_VEG = /^(小黃瓜|番茄|萵苣（A菜）|紅甜椒|苜蓿芽|美國芹菜|紫甘藍)$/;
const BRAISE_ONLY = /牛腱|牛肚|豬腳|豬蹄膀|牛腩|雞爪|豬小排|豬大腸|豬小腸|豬肚/;
const LEAFY_OK = /^(山東白菜|包心白菜|翠玉白菜|高麗菜|紫甘藍|球莖甘藍|高麗菜芽)$/;
// 現成可直接吃（做法「直接吃」只給它們）；起司片只能直接吃
const READY = /^(鮪魚|火腿|起司片|五香豆干|小方豆干|豆干)/;
const WHOLE_CARB_EXCLUDE = /白飯|白米|麵|粉|冬粉|吐司/; // 餐盒的碳水不收白飯、麵、粉
// 早餐盤的碳水：吐司、饅頭、蘿蔔糕、油麵（吐司一份 2 片、饅頭半顆、蘿蔔糕 120g、油麵 150g）
const PLATE_CARBS = [
  ["fx_whole_wheat_toast", "全麥吐司（2 片）", 60], ["fx_toast", "白吐司（2 片）", 60], ["fx_mantou", "饅頭（半顆）", 60],
  ["fx_turnip_cake", "蘿蔔糕", 120], ["fx_oil_noodles", "油麵（鐵板麵）", 150],
];
// 內建食材裡不是主蛋白／主食的（優格、豆漿、燕麥歸早餐碗與飲品）
const BUILTIN_EXCLUDE = ["greek_yogurt", "soy_milk", "oats"];
const DRINKS = [["soy_milk", "無糖豆漿", 190], ["fx_lowfat_milk", "低脂鮮奶", 240], ["fx_whole_milk", "全脂鮮奶", 240]];
const CHEESE_ID = "fx_cheese_slice";

export function cookMethodName(key) { return COOK_METHODS[key] ? COOK_METHODS[key].name : key; }

// 畫面「常見的先列、其餘收在更多」用的名單（之後由「我的食物」☆ 與預設清單取代）
export const COOK_COMMON = {
  protein: ["雞胸肉", "去皮雞腿肉", "蝦仁", "鮭魚", "牛腱", "瘦豬後腿肉", "鯛魚片", "板豆腐", "雞蛋"],
  plateProtein: ["雞蛋", "板豆腐", "雞胸肉", "五香豆干", "鮪魚", "起司片", "火腿"],
  carb: ["地瓜", "糙米飯", "雜糧飯", "南瓜", "玉米粒", "藜麥", "馬鈴薯", "紫米"],
  veg: ["青花菜", "高麗菜", "地瓜葉", "菠菜", "紅蘿蔔", "玉米筍", "紅甜椒", "小黃瓜", "番茄", "萵苣（A菜）", "四季豆"],
};

// 家常菜主菜的主料分組（畫面分組用）
export function homeDishProtein(d) {
  if (/雞/.test(d.name)) return "雞";
  if (/牛/.test(d.name)) return "牛";
  if (/魚|蝦|蛤|花枝|蚵|鮭|鱸|海鮮/.test(d.name)) return "魚海鮮";
  if (/豆腐|豆干|蛋|蔬菜/.test(d.name)) return "豆蛋";
  return "豬";
}

// ---------- 選項清單（每個 catalog 建一次） ----------
// 回傳 { protein, carb, veg, plateCarb, drink, bowlBase, bowlGrain, bowlFruit, bowlNut }
// 每一項：{ uid, name, item（單品形狀）, g（一餐的量）, rank（難度）, rc（需要煮熟）, only（只適合的做法）, no（不適合的做法）, ready, sub }
const _cache = new WeakMap();

function entryOf(item, extra) {
  return Object.assign({ uid: item.uid, name: item.name, item: item, g: null, rank: 1, rc: true, only: null, no: [], ready: false, sub: item.subgroup || null }, extra);
}

export function cookOptions(catalog) {
  if (_cache.has(catalog)) return _cache.get(catalog);
  const tree = (catalog.foodTree && catalog.foodTree.items) || [];
  const byId = (catalog.foodTree && catalog.foodTree.byId) || {};
  const builtin = {};
  (catalog.ingredients || []).forEach(function (i) { if (i.axis === "protein" || i.axis === "staple" || i.axis === "vegetable") builtin[i.id] = i; });
  const out = { protein: [], carb: [], veg: [], plateCarb: [], drink: [], bowlBase: [], bowlGrain: [], bowlFruit: [], bowlNut: [] };
  const seen = {};
  const per100 = function (it) { return it.per_100g || {}; };

  // 內建食材（有自己的一餐份量、難度、需要煮熟）
  Object.keys(builtin).forEach(function (id) {
    if (BUILTIN_EXCLUDE.indexOf(id) !== -1) return;
    const b = builtin[id], it = byId[id];
    if (!it) return;
    const e = entryOf(it, { g: b.serving_g || 100, rank: b.prep_tier === "🔴" ? 2 : b.prep_tier === "🟢" ? 0 : 1, rc: b.requires_cooking !== false });
    seen[id] = true;
    if (b.axis === "protein") out.protein.push(e);
    else if (b.axis === "staple") { if (!WHOLE_CARB_EXCLUDE.test(it.name)) out.carb.push(e); }
    else out.veg.push(Object.assign(e, { no: leafyNo(it) }));
  });

  // 代換表分層品項：預設允許，套例外表
  tree.forEach(function (it) {
    if (seen[it.id] || !it.serving || it.serving.unit !== "g") return;
    if (it.group === "protein") {
      if (EXCLUDE_PROTEIN.test(it.name)) return;
      const fat = per100(it).fat_g || 0;
      const n = fat >= COOK_FAT_HEAVY_PER_100 ? 2 : COOK_MEAL_SERVINGS.protein;
      const braise = BRAISE_ONLY.test(it.name);
      out.protein.push(entryOf(it, { g: Math.round(Math.min(COOK_ITEM_CAP_G, it.serving.amount * n)), rank: braise ? 2 : 1, only: braise ? ["braise"] : null, ready: READY.test(it.name) }));
    } else if (it.group === "grain") {
      if (EXCLUDE_STAPLE.test(it.name) || it.subgroup === "starch" || it.sugar) return;
      if (WHOLE_CARB_EXCLUDE.test(it.name)) return;
      out.carb.push(entryOf(it, { g: Math.round(Math.min(COOK_ITEM_CAP_G, it.serving.amount * COOK_MEAL_SERVINGS.staple)), rank: it.subgroup === "legume" ? 2 : 1 }));
    } else if (it.group === "vegetable") {
      const raw = RAW_OK_VEG.test(it.name);
      out.veg.push(entryOf(it, { g: COOK_VEG_G, rank: raw ? 0 : 1, rc: !raw, no: leafyNo(it) }));
    }
  });

  // 早餐盤：吐司、饅頭、蘿蔔糕、油麵；起司片
  PLATE_CARBS.forEach(function (p) { const it = byId[p[0]]; if (it) out.plateCarb.push(entryOf(it, { name: p[1], g: p[2], rank: 0, rc: false })); });
  const cheese = byId[CHEESE_ID];
  if (cheese) out.protein.push(entryOf(cheese, { name: "起司片", g: 20, rank: 0, rc: false, ready: true, only: ["cold"], plateOnly: true }));
  DRINKS.forEach(function (d) { const it = byId[d[0]]; if (it) out.drink.push(entryOf(it, { name: d[1], g: d[2], rank: 0, rc: false })); });

  // 早餐碗：碗底、穀物、水果、堅果（一份＝代換表一份）
  tree.forEach(function (it) {
    if (!it.serving || it.serving.amount == null) return;
    const e = entryOf(it, { g: it.serving.amount, rank: 0, rc: false });
    if ((it.group === "dairy" && /優格|低脂奶|脫脂奶|全脂奶（/.test(it.name)) || it.id === "soy_milk") out.bowlBase.push(e);
    else if (it.group === "grain" && /燕麥|藜麥/.test(it.name)) out.bowlGrain.push(e);
    else if (it.group === "fruit" && it.subgroup !== "dried") out.bowlFruit.push(e);
    else if (it.group === "fat" && it.subgroup === "nuts") out.bowlNut.push(e);
  });
  _cache.set(catalog, out);
  return out;
}

function leafyNo(it) {
  return it.subgroup === "leafy" && !LEAFY_OK.test(it.name) ? ["braise", "air"] : [];
}

export function cookOptionByUid(catalog, uid) {
  const o = cookOptions(catalog);
  const lists = ["protein", "carb", "veg", "plateCarb", "drink", "bowlBase", "bowlGrain", "bowlFruit", "bowlNut"];
  for (let i = 0; i < lists.length; i++) {
    const hit = o[lists[i]].filter(function (e) { return e.uid === uid; })[0];
    if (hit) return hit;
  }
  return null;
}

// ---------- 做法能不能用 ----------
// quick：這一餐是快煮（難度 ≤🟡）。asVeg：這個食材放在蔬菜格。回傳原因或 null。
export function cookMethodProblem(entry, key, asVeg, quick) {
  const m = COOK_METHODS[key];
  if (!m) return "沒有這個做法";
  if (quick && !isQuickTier(m.rank)) return "快煮不做" + m.name;
  if (key === "raw" && (!asVeg || !RAW_OK_VEG.test(entry.name))) return "不能生吃";
  if (key === "cold" && !(entry.ready || READY.test(entry.name))) return "要加熱才能吃";
  if (entry.name === "起司片" && key !== "cold") return "直接吃";
  if (entry.only && entry.only.indexOf(key) === -1) return "只適合滷燉";
  if ((entry.no || []).indexOf(key) !== -1) return "不適合" + m.name;
  return null;
}

export function cookItemProblem(entry, quick) {
  return quick && !isQuickTier(entry.rank) ? "快煮不收（需要較久）" : null;
}

// ---------- 組裝類（餐盒、早餐盤） ----------
// form = { entry: "box"|"plate", goal, pamt, ps: [{ uid, m, n }], carb: uid|null, carbAmt: "half"|"one"|"none", veg: [{ uid, m }], fruit: uid|null, drink: uid|null }
export function newBoxForm(entry) {
  const goal = entry === "plate" ? "normal" : "low";
  return { entry: entry, goal: goal, pamt: COOK_GOALS[goal].pamt, ps: [], carb: null, carbAmt: COOK_GOALS[goal].carbAmt, veg: [], fruit: null, drink: null };
}

export function applyGoal(form, goal) {
  if (!COOK_GOALS[goal]) return form;
  form.goal = goal;
  if (form.carbAmt !== "none") form.carbAmt = COOK_GOALS[goal].carbAmt;
  form.pamt = COOK_GOALS[goal].pamt;
  return form;
}

export function boxProteinMethods(entry) {
  return entry === "plate" ? COOK_PLATE_PROTEIN_METHODS : COOK_BOX_PROTEIN_METHODS;
}

const isFixedProtein = function (e) { return e.uid === "egg" || !!e.plateOnly; };

// 肉／豆類平分一份（蛋與起司片固定，不平分）
function splitCount(form, opts) {
  return form.ps.filter(function (p) { const e = cookOptionByUid(opts.catalog, p.uid); return e && !isFixedProtein(e); }).length;
}

export function boxSplitCount(form, catalog) {
  return splitCount(form, { catalog: catalog });
}

// 切到快煮：把做不了快煮的選項拿掉（做法清成未選、食材與菜移除），回傳有沒有動到
export function cookPruneForQuick(form, catalog) {
  let changed = false;
  if (form.entry === "box" || form.entry === "plate") {
    form.ps = form.ps.filter(function (p) {
      const e = cookOptionByUid(catalog, p.uid);
      if (!e || cookItemProblem(e, true)) { changed = true; return false; }
      if (p.m && cookMethodProblem(e, p.m, false, true)) { p.m = null; changed = true; }
      return true;
    });
    if (form.carb) {
      const e = cookOptionByUid(catalog, form.carb);
      if (!e || cookItemProblem(e, true)) { form.carb = null; changed = true; }
    }
    form.veg.forEach(function (v) {
      const e = cookOptionByUid(catalog, v.uid);
      if (e && v.m && cookMethodProblem(e, v.m, true, true)) { v.m = null; changed = true; }
    });
  } else if (form.entry === "home") {
    const slow = function (d) { return d && d.tier === "🔴" && !d.passive; };
    form.dishes = form.dishes.filter(function (x) { if (slow(homeDishById(catalog, x.uid))) { changed = true; return false; } return true; });
    if (slow(homeDishById(catalog, form.staple))) { form.staple = "brown_rice_cooked"; changed = true; }
  }
  return changed;
}

// 組裝類的零件 [{ item, amount, role, method? }] 與下鍋油合計；資料不在的零件丟掉（驗證另外擋）
export function boxParts(form, catalog, oilHabit) {
  const parts = [];
  let oil = 0;
  const pn = splitCount(form, { catalog: catalog });
  form.ps.forEach(function (p) {
    const e = cookOptionByUid(catalog, p.uid);
    if (!e) return;
    const m = COOK_METHODS[p.m];
    let amount;
    if (e.uid === "egg") amount = COOK_EGG_G * (p.n || 1);
    else if (e.plateOnly) amount = e.g;
    else amount = Math.round(e.g * (form.pamt || 1) / Math.max(1, pn));
    parts.push({ item: e.item, amount: amount, role: "protein", method: p.m || null });
    if (m) oil += m.oil;
  });
  if (form.carb && form.carbAmt !== "none") {
    const e = cookOptionByUid(catalog, form.carb);
    if (e) parts.push({ item: e.item, amount: Math.round(e.g * COOK_CARB_AMTS[form.carbAmt]), role: "carb" });
  }
  form.veg.forEach(function (v) {
    const e = cookOptionByUid(catalog, v.uid);
    if (!e) return;
    parts.push({ item: e.item, amount: e.g, role: "veg", method: v.m || null });
    if (COOK_METHODS[v.m]) oil += COOK_METHODS[v.m].vegOil;
  });
  if (form.fruit) {
    const e = cookOptionByUid(catalog, form.fruit);
    if (e) parts.push({ item: e.item, amount: e.g, role: "fruit" });
  }
  if (form.drink) {
    const e = cookOptionByUid(catalog, form.drink);
    if (e) parts.push({ item: e.item, amount: e.g, role: "drink" });
  }
  const factor = OIL_HABIT_FACTOR[oilHabit || "normal"] != null ? OIL_HABIT_FACTOR[oilHabit || "normal"] : 1;
  return { parts: parts, oil_g: Math.round(oil * factor * 10) / 10 };
}

// 組裝類能不能送出：回傳原因或 null。tier：cook_quick | cook_full
export function boxProblem(form, catalog, profile, tier) {
  const quick = tier === "cook_quick";
  if (!form || (form.entry !== "box" && form.entry !== "plate")) return "餐型不對";
  if (form.ps.length === 0) return "請選蛋白質（1–" + COOK_PROTEIN_MAX + " 種）";
  if (form.ps.length > COOK_PROTEIN_MAX) return "蛋白質最多選 " + COOK_PROTEIN_MAX + " 種";
  if (new Set(form.ps.map(function (p) { return p.uid; })).size !== form.ps.length) return "同一種蛋白質不用選兩次";
  const allowed = boxProteinMethods(form.entry);
  const pf = profile || {};
  for (let i = 0; i < form.ps.length; i++) {
    const p = form.ps[i];
    const e = cookOptionByUid(catalog, p.uid);
    if (!e || (e.plateOnly && form.entry !== "plate")) return "「" + p.uid + "」已不提供";
    const hf = passesHardFilters(e.item, pf);
    if (!hf.ok) return "「" + e.name + "」" + hf.reason;
    const ip = cookItemProblem(e, quick);
    if (ip) return "「" + e.name + "」" + ip;
    if (!p.m) return e.name + "：請選做法";
    if (allowed.indexOf(p.m) === -1) return e.name + "：這個做法不在" + COOK_ENTRY_LABELS[form.entry] + "裡";
    const mp = cookMethodProblem(e, p.m, false, quick);
    if (mp) return e.name + "：" + mp;
    if (e.uid === "egg" && !(Number.isInteger(p.n || 1) && (p.n || 1) >= 1 && (p.n || 1) <= COOK_EGG_MAX)) return "雞蛋一餐 1–" + COOK_EGG_MAX + " 顆";
  }
  if (COOK_PAMTS.indexOf(form.pamt) === -1) return "蛋白質份量不對";
  if (["half", "one", "none"].indexOf(form.carbAmt) === -1) return "碳水份量不對";
  if (form.carbAmt !== "none") {
    if (!form.carb) return "請選碳水，或點「不要」";
    const e = cookOptionByUid(catalog, form.carb);
    const okCarb = e && (form.entry === "plate" ? (cookOptions(catalog).carb.indexOf(e) !== -1 || cookOptions(catalog).plateCarb.indexOf(e) !== -1) : cookOptions(catalog).carb.indexOf(e) !== -1);
    if (!okCarb) return "碳水已不提供";
    const hf = passesHardFilters(e.item, pf);
    if (!hf.ok) return "「" + e.name + "」" + hf.reason;
    const ip = cookItemProblem(e, quick);
    if (ip) return "「" + e.name + "」" + ip;
  }
  if (form.veg.length > COOK_VEG_MAX) return "蔬菜最多選 " + COOK_VEG_MAX + " 種";
  for (let i = 0; i < form.veg.length; i++) {
    const v = form.veg[i];
    const e = cookOptionByUid(catalog, v.uid);
    if (!e) return "蔬菜已不提供";
    const hf = passesHardFilters(e.item, pf);
    if (!hf.ok) return "「" + e.name + "」" + hf.reason;
    if (!v.m) return e.name + "：請選做法";
    if (COOK_VEG_METHODS.indexOf(v.m) === -1) return e.name + "：這個做法不能用在蔬菜";
    const mp = cookMethodProblem(e, v.m, true, quick);
    if (mp) return e.name + "：" + mp;
  }
  [form.fruit, form.drink].forEach(function () {});
  const extra = [["fruit", form.fruit], ["drink", form.drink]];
  for (let i = 0; i < extra.length; i++) {
    if (!extra[i][1]) continue;
    const e = cookOptionByUid(catalog, extra[i][1]);
    if (!e) return "「" + extra[i][1] + "」已不提供";
    const hf = passesHardFilters(e.item, pf);
    if (!hf.ok) return "「" + e.name + "」" + hf.reason;
  }
  return null;
}

// ---------- 早餐碗 ----------
// form = { entry: "bowl", base: uid|null, grain: uid|null, fruit: [uid], nut: uid|null }
export function newBowlForm() {
  return { entry: "bowl", base: null, grain: null, fruit: [], nut: null };
}

export function bowlParts(form, catalog) {
  const parts = [];
  const add = function (uid, role) {
    if (!uid) return;
    const e = cookOptionByUid(catalog, uid);
    if (e) parts.push({ item: e.item, amount: Math.round(e.g), role: role });
  };
  add(form.base, "base");
  add(form.grain, "grain");
  form.fruit.forEach(function (u) { add(u, "fruit"); });
  add(form.nut, "nut");
  return { parts: parts, oil_g: 0 };
}

export function bowlProblem(form, catalog, profile) {
  if (!form || form.entry !== "bowl") return "餐型不對";
  if (!form.base) return "請選碗底";
  if (form.fruit.length > 2) return "水果最多選 2 種";
  const pf = profile || {};
  const all = [form.base, form.grain].concat(form.fruit, [form.nut]).filter(Boolean);
  for (let i = 0; i < all.length; i++) {
    const e = cookOptionByUid(catalog, all[i]);
    if (!e) return "「" + all[i] + "」已不提供";
    const hf = passesHardFilters(e.item, pf);
    if (!hf.ok) return "「" + e.name + "」" + hf.reason;
  }
  return null;
}

// ---------- 家常餐 ----------
// form = { entry: "home", staple: uid|"none"（白飯等或整碗／粥的菜 uid）, stapleAmt: 1|0.5, people: null|1–6, dishes: [{ uid, amt }] }
// 菜庫的菜在 catalog.homeDishes.dishes（含整碗、粥、湯）；主食 uid 是 homeDishes.staples 的 ref 或整碗／粥的 hd_ id
export function newHomeForm() {
  return { entry: "home", staple: "brown_rice_cooked", stapleAmt: 1, people: null, dishes: [] };
}

export function homeDishById(catalog, uid) {
  return (catalog.homeDishes && catalog.homeDishes.byId && catalog.homeDishes.byId[uid]) || null;
}

function stapleRefs(catalog) {
  const st = (catalog.homeDishes && catalog.homeDishes.staples) || {};
  return Object.keys(st).map(function (k) { return st[k].ref; });
}

// 這道菜怎麼算份量：soup（一碗 250）、congee（一碗 300）、pot（一鍋菜：配方一人份 × 倍數）、share（整盤 ÷ 人數）、bowl（整碗）
export function homeDishKind(d) {
  if (d.kind === "soup") return "soup";
  if (d.role === "粥") return "congee";
  if (d.role === "整碗") return "bowl";
  if (d.pot) return "pot";
  return "share";
}

export function homeStapleIsComplete(catalog, staple) {
  const d = staple && staple !== "none" ? homeDishById(catalog, staple) : null;
  return !!d && d.role === "整碗";
}

// 會被「÷ 人數」的菜：炒煎蒸拌炸烤與現組（湯、粥、一鍋菜、整碗不算）
export function homeShareCount(form, catalog) {
  return form.dishes.filter(function (x) { const d = homeDishById(catalog, x.uid); return d && homeDishKind(d) === "share"; }).length;
}

export function homePeople(form, catalog) {
  if (homeStapleIsComplete(catalog, form.staple)) return COOK_HOME_SIDE_PEOPLE;
  return form.people || Math.max(1, homeShareCount(form, catalog));
}

export function homeParts(form, catalog) {
  const parts = [];
  const n = homePeople(form, catalog);
  if (form.staple && form.staple !== "none") {
    const hd = homeDishById(catalog, form.staple);
    if (hd) {
      const g = homeDishKind(hd) === "congee" ? COOK_CONGEE_G : hd.cooked_g / (hd.serv || 1);
      parts.push({ item: hd, amount: Math.max(1, Math.round(g * form.stapleAmt)), role: "staple" });
    } else {
      const tree = (catalog.foodTree && catalog.foodTree.byId) || {};
      const item = tree[form.staple];
      if (item) parts.push({ item: item, amount: Math.round(150 * form.stapleAmt), role: "staple" });
    }
  }
  form.dishes.forEach(function (x) {
    const d = homeDishById(catalog, x.uid);
    if (!d) return;
    const k = homeDishKind(d);
    let g;
    if (k === "soup") g = COOK_SOUP_G;
    else if (k === "congee") g = COOK_CONGEE_G;
    else if (k === "pot") g = d.cooked_g / (d.serv || 1) * (x.amt || 1);
    else if (k === "bowl") g = d.cooked_g / (d.serv || 1) * (x.amt || 1);
    else g = d.cooked_g / n;
    parts.push({ item: d, amount: Math.max(1, Math.round(g)), role: k === "soup" ? "soup" : "dish" });
  });
  return { parts: parts, oil_g: 0 };
}

export function homeProblem(form, catalog, profile, tier) {
  const quick = tier === "cook_quick";
  if (!form || form.entry !== "home") return "餐型不對";
  const pf = profile || {};
  const complete = homeStapleIsComplete(catalog, form.staple);
  if (form.dishes.length === 0 && !complete) return "至少選一道菜，或選一份整碗主食";
  if (form.staple && form.staple !== "none") {
    const hd = homeDishById(catalog, form.staple);
    const tree = (catalog.foodTree && catalog.foodTree.byId) || {};
    const item = hd || tree[form.staple];
    if (!item || (!hd && stapleRefs(catalog).indexOf(form.staple) === -1)) return "主食已不提供";
    const hf = passesHardFilters(item, pf);
    if (!hf.ok) return "「" + item.name + "」" + hf.reason;
    if (hd && quick && hd.tier === "🔴" && !hd.passive) return "「" + hd.name + "」快煮不做";
  }
  if (new Set(form.dishes.map(function (x) { return x.uid; })).size !== form.dishes.length) return "同一道菜不用選兩次";
  let count = 0;
  for (let i = 0; i < form.dishes.length; i++) {
    const x = form.dishes[i];
    const d = homeDishById(catalog, x.uid);
    if (!d) return "「" + x.uid + "」已不提供";
    if (d.role === "整碗" || d.role === "粥") return "「" + d.name + "」是主食，請放在主食格";
    const hf = passesHardFilters(d, pf);
    if (!hf.ok) return "「" + d.name + "」" + hf.reason;
    if (quick && d.tier === "🔴" && !d.passive) return "「" + d.name + "」快煮不做";
    if (d.kind !== "soup") count++;
    if (x.amt != null && homeDishKind(d) === "pot" && COOK_POT_AMTS.indexOf(x.amt) === -1) return "「" + d.name + "」份量不對";
  }
  if (count > COOK_HOME_DISH_MAX) return "菜最多 " + COOK_HOME_DISH_MAX + " 道（湯另外加）";
  if (form.people != null && !(Number.isInteger(form.people) && form.people >= 1 && form.people <= 6)) return "人數不對";
  if (![1, 0.5].includes(form.stapleAmt)) return "主食份量不對";
  return null;
}

// ---------- 共用 ----------
export function cookFormProblem(form, catalog, profile, tier) {
  if (!form) return null;
  if (form.entry === "box" || form.entry === "plate") return boxProblem(form, catalog, profile, tier);
  if (form.entry === "bowl") return bowlProblem(form, catalog, profile);
  if (form.entry === "home") return homeProblem(form, catalog, profile, tier);
  return "餐型不對";
}

export function cookFormParts(form, catalog, oilHabit) {
  if (form.entry === "box" || form.entry === "plate") return boxParts(form, catalog, oilHabit);
  if (form.entry === "bowl") return bowlParts(form, catalog);
  return homeParts(form, catalog);
}

// 記錄名稱：餐型＋各零件名稱（沒有克數，decisions #152）
export function cookFormName(form, catalog) {
  const names = cookFormParts(form, catalog, "normal").parts.map(function (p) { return p.item.name; });
  return COOK_ENTRY_LABELS[form.entry] + "（" + names.join("＋") + "）";
}

// 從存下來的 form 取出乾淨的副本（只留合法欄位，帶回選擇器用）
export function cleanCookForm(form) {
  if (!form || typeof form !== "object") return null;
  const f = JSON.parse(JSON.stringify(form));
  return f;
}
