// 家常菜估算資料的唯一算法（章程 B4「家常菜估算」、decisions #151）：build-home-dishes.js 用它產生 data/home_dishes.json，
// check-data.js 用同一份重算比對。配方在 data/reference/home_dish_recipes.json（手寫），調料選樣表在
// data/reference/home_dish_seasonings.json。
//
// 每道菜每 100g ＝ Σ(食材每 100g × 克數) ÷ cooked_g × 100（七欄，一律四捨五入到小數 1 位）。
// 配方食材的 ref 只能是四種：ingredients.json 的食材 id、food_tree 的 fx_ id、衛福部整合編號（讀 data/tfda_lookup.json）、
// 調料選樣表的 id（hs_ 開頭）。任何一欄是 null 就算錯（null 不傳染到家常菜估算：估算要七欄都有數字）。
// 類別平均是簡單平均（不加權），用各道菜四捨五入後的值平均再進位。

"use strict";

const { round1, FIELDS } = require("./ingredient-values");

const CLASSES = ["veg", "mixed", "meat"];
const ROLES = ["veg", "protein", "other"];
const STAPLES = [
  { key: "white", ref: "fx_cooked_rice", name: "白飯" },
  { key: "brown", ref: "brown_rice_cooked", name: "糙米飯" },
  { key: "mixed", ref: "mixed_grain_rice_cooked", name: "雜糧飯" },
  { key: "noodle", ref: "fx_cooked_noodles", name: "白麵（熟麵條）" },
];
// 調料選樣表：derived 只准這兩項（章程 B4），數字也鎖死
const DERIVED_SEASONINGS = {
  hs_salt: { kcal: 0, protein_g: 0, carb_g: 0, fat_g: 0, fiber_g: 0, sat_fat_g: 0, sodium_mg: 39340 }, // NaCl 化學計量：Na 23／58.44
  hs_water: { kcal: 0, protein_g: 0, carb_g: 0, fat_g: 0, fiber_g: 0, sat_fat_g: 0, sodium_mg: 0 },
};
// 缺值補 0 的理由（章程 B5.1，只列調料選樣表會用到的）：理由 → { 衛福部食品分類, 可填欄位, 脂肪上限 }
const ZERO_FILL_REASONS = {
  "調味料": { category: "調味料及香辛料類", fields: ["sat_fat_g"], maxFat: 0.5 },
  "油脂": { category: "油脂類", fields: ["fiber_g", "sodium_mg"], maxFat: null },
};
const NTU_DEVIATION_LIMIT = 0.25;
const SEASONS = ["spring", "summer", "autumn", "winter"]; // 春 3–5、夏 6–8、秋 9–11、冬 12–2 月（共餐清單只列當季）
const UNVERIFIED = "未確認";
const VEG_SHARE_MEAT_MAX = 0.3;

function loadHomeDishContext(readJson) {
  const byId = (list) => { const m = {}; list.forEach((x) => { m[x.id] = x; }); return m; };
  return {
    recipes: readJson("reference/home_dish_recipes.json"),
    seasonings: readJson("reference/home_dish_seasonings.json"),
    lookup: byId(readJson("tfda_lookup.json").items),
    ingredients: byId(readJson("ingredients.json")),
    tree: byId(readJson("food_tree.json").items),
  };
}

// 調料選樣表一項 → { per_100g, field_sources, problems }
function seasoningValues(entry, ctx) {
  const problems = [];
  const w = "調料選樣表 " + entry.id;
  const src = entry.source || {};
  if (!/^hs_[a-z0-9_]+$/.test(entry.id || "")) problems.push(w + "：id 要 hs_ 開頭的小寫英數");
  if (typeof entry.name !== "string" || entry.name === "") problems.push(w + "：name 不能空");
  if (src.type === "derived") {
    const want = DERIVED_SEASONINGS[entry.id];
    if (!want) {
      problems.push(w + "：derived 只限食鹽與水（hs_salt、hs_water），其他請查衛福部或包裝標示");
      return { per_100g: null, field_sources: {}, problems };
    }
    if (typeof src.ref !== "string" || src.ref === "") problems.push(w + "：derived 要寫公式或理由（ref）");
    const given = entry.per_100g || {};
    FIELDS.forEach((k) => { if (given[k] !== want[k]) problems.push(w + "：derived 的 " + k + " 必須是 " + want[k]); });
    return { per_100g: Object.assign({}, want), field_sources: {}, problems };
  }
  if (src.type === "label") {
    // 市售標示（給日後的沙茶醬）：七欄照標示填，要有 ref
    const given = entry.per_100g || {};
    if (typeof src.ref !== "string" || src.ref === "") problems.push(w + "：label 要寫 ref（品名與來源）");
    const out = {};
    FIELDS.forEach((k) => { if (typeof given[k] !== "number") problems.push(w + "：label 的 " + k + " 要是數字"); out[k] = given[k]; });
    return { per_100g: out, field_sources: {}, problems };
  }
  if (src.type !== "tfda") {
    problems.push(w + "：出處只能是 tfda、label、derived");
    return { per_100g: null, field_sources: {}, problems };
  }
  const row = ctx.lookup[src.ref];
  if (!row) {
    problems.push(w + "：衛福部查詢檔找不到 " + src.ref);
    return { per_100g: null, field_sources: {}, problems };
  }
  const out = {};
  const fsrc = entry.field_sources || {};
  FIELDS.forEach((k) => {
    const v = row.per_100g[k];
    const fill = fsrc[k];
    if (v != null) {
      out[k] = v;
      if (fill) problems.push(w + "：" + k + " 衛福部有值，不能再補 0");
      return;
    }
    const reason = fill && ZERO_FILL_REASONS[fill.ref];
    if (!fill || fill.type !== "derived" || fill.value !== 0 || !reason) {
      problems.push(w + "：" + k + " 衛福部沒有值，要在 field_sources 以章程 B5.1 的理由補 0（調味料或油脂）");
      out[k] = null;
      return;
    }
    if (reason.fields.indexOf(k) === -1) problems.push(w + "：理由「" + fill.ref + "」不能補 " + k);
    if (row.category !== reason.category) problems.push(w + "：理由「" + fill.ref + "」要衛福部食品分類是 " + reason.category + "（這筆是 " + row.category + "）");
    if (reason.maxFat != null && !(row.per_100g.fat_g <= reason.maxFat)) problems.push(w + "：理由「" + fill.ref + "」要脂肪 ≤ " + reason.maxFat + " g/100g");
    out[k] = 0;
  });
  return { per_100g: out, field_sources: fsrc, problems };
}

function seasoningMap(ctx) {
  const m = {};
  const problems = [];
  (ctx.seasonings.items || []).forEach((e) => {
    if (m[e.id]) problems.push("調料選樣表 id 重複：" + e.id);
    const r = seasoningValues(e, ctx);
    problems.push.apply(problems, r.problems);
    m[e.id] = { entry: e, per_100g: r.per_100g, field_sources: r.field_sources };
  });
  return { map: m, problems };
}

// ref → 每 100g 的七欄；找不到或有 null 回傳 { problem }
function resolveRef(ref, ctx, seas) {
  let per = null, kind = null, tags = null;
  const arr = (a) => (Array.isArray(a) ? a : [UNVERIFIED]); // 缺欄＝未確認（decisions #77）
  if (/^hs_/.test(ref)) {
    kind = "seasoning"; per = seas[ref] ? seas[ref].per_100g : null;
    const src = seas[ref] && seas[ref].entry.source;
    tags = src && src.type === "tfda" && ctx.lookup[src.ref] ? arr(ctx.lookup[src.ref].allergen_tags) : [];
  }
  else if (ctx.ingredients[ref]) { kind = "ingredient"; per = ctx.ingredients[ref].per_100g; tags = arr(ctx.ingredients[ref].allergen_tags); }
  else if (ctx.tree[ref]) { kind = "food_tree"; per = ctx.tree[ref].per_100g; tags = arr(ctx.tree[ref].allergen_tags); }
  else if (ctx.lookup[ref]) { kind = "tfda"; per = ctx.lookup[ref].per_100g; tags = arr(ctx.lookup[ref].allergen_tags); }
  if (!per) return { problem: "ref「" + ref + "」不是食材 id、fx_ id、衛福部編號或調料選樣表 id（或沒有每 100g 營養）" };
  const nulls = FIELDS.filter((k) => typeof per[k] !== "number");
  if (nulls.length) return { problem: "ref「" + ref + "」的 " + nulls.join("、") + " 是 null（家常菜估算要七欄都有數字）" };
  return { per_100g: per, kind: kind, tags: tags || [] };
}

// 一道菜 → { per_100g, veg_share, problems }
function computeDish(d, ctx, seas) {
  const problems = [];
  const w = "家常菜 " + d.id;
  const sum = {};
  FIELDS.forEach((k) => { sum[k] = 0; });
  let veg = 0, protein = 0;
  const tagSet = {};
  const items = (d.recipe || []).concat(d.oil && d.oil.g > 0 ? [Object.assign({ role: "other" }, d.oil)] : []);
  if (!(d.recipe || []).length) problems.push(w + "：recipe 不能空");
  if (!(d.cooked_g > 0)) problems.push(w + "：cooked_g 要大於 0");
  items.forEach((it, i) => {
    if (!(it.g > 0)) { problems.push(w + " 第 " + (i + 1) + " 項：g 要大於 0"); return; }
    if (ROLES.indexOf(it.role || "other") === -1) problems.push(w + " " + it.ref + "：role 只能是 " + ROLES.join("、"));
    const r = resolveRef(it.ref, ctx, seas);
    if (r.problem) { problems.push(w + "：" + r.problem); return; }
    FIELDS.forEach((k) => { sum[k] += r.per_100g[k] * it.g / 100; });
    r.tags.forEach((t) => { tagSet[t] = true; });
    if (it.role === "veg") veg += it.g;
    else if (it.role === "protein") protein += it.g;
  });
  if (d.oil && d.oil.ref !== "cooking_oil") problems.push(w + "：油只能用 cooking_oil");
  const per = {};
  FIELDS.forEach((k) => { per[k] = d.cooked_g > 0 ? round1(sum[k] / d.cooked_g * 100) : null; });
  const share = veg + protein > 0 ? Math.round(veg / (veg + protein) * 1000) / 1000 : 0;
  tagSet[UNVERIFIED] = true; // 複合料理各家做法不同，一律未確認（章程 B6.3）
  return { per_100g: per, veg_share: share, protein_g: protein, allergen_tags: Object.keys(tagSet).sort(), problems };
}

// 自動規則（只當警告對照）：沒有蛋豆魚肉＝素菜；蛋豆魚肉且蔬菜占（蔬菜＋蛋豆魚肉）重量 < 30%＝純肉；其餘菜肉
function autoClass(computed) {
  if (!(computed.protein_g > 0)) return "veg";
  return computed.veg_share < VEG_SHARE_MEAT_MAX ? "meat" : "mixed";
}

function average(rows) {
  const per = {};
  FIELDS.forEach((k) => { per[k] = round1(rows.reduce((a, r) => a + r.per_100g[k], 0) / rows.length); });
  return per;
}

// 整份產生檔（物件）與配方檢查的問題清單
function buildHomeDishes(ctx) {
  const problems = [];
  const sm = seasoningMap(ctx);
  problems.push.apply(problems, sm.problems);
  const dishes = [];
  const warnings = [];
  const seen = {};
  (ctx.recipes.dishes || []).forEach((d) => {
    if (seen[d.id]) problems.push("家常菜 id 重複：" + d.id);
    seen[d.id] = true;
    if (!/^hd_[a-z0-9_]+$/.test(d.id || "")) problems.push("家常菜 id 要 hd_ 開頭的小寫英數：" + d.id);
    if (typeof d.name !== "string" || d.name === "") problems.push("家常菜 " + d.id + "：name 不能空");
    if (d.kind !== "dish" && d.kind !== "soup") problems.push("家常菜 " + d.id + "：kind 只能是 dish 或 soup");
    if (d.kind === "dish" ? CLASSES.indexOf(d.class) === -1 : d.class !== null) problems.push("家常菜 " + d.id + "：class 菜要是 veg／mixed／meat，湯要是 null");
    if (typeof d.note !== "string" || d.note === "") problems.push("家常菜 " + d.id + "：note 要寫來源與假設");
    const c = computeDish(d, ctx, sm.map);
    problems.push.apply(problems, c.problems);
    // 成品重不能低於食材總重的 40%（含水的湯、滷汁收乾的菜之外，過低通常是抄錯）
    const total = (d.recipe || []).reduce((a, it) => a + (it.g || 0), 0) + (d.oil ? d.oil.g || 0 : 0);
    if (d.cooked_g > 0 && total > 0 && d.cooked_g < total * 0.4) warnings.push("家常菜 " + d.id + "：cooked_g（" + d.cooked_g + "）低於食材總重（" + total + "）的 40%，確認沒抄錯");
    if (d.kind === "dish" && c.per_100g.kcal != null && autoClass(c) !== d.class) warnings.push("家常菜 " + d.id + "：手動類別 " + d.class + " 與自動規則 " + autoClass(c) + " 不一致");
    if (!Array.isArray(d.seasons) || d.seasons.length === 0 || d.seasons.some((x) => SEASONS.indexOf(x) === -1) || new Set(d.seasons).size !== d.seasons.length) {
      problems.push("家常菜 " + d.id + "：seasons 要是非空、不重複的 spring／summer／autumn／winter");
    }
    const row = { id: d.id, name: d.name, kind: d.kind, class: d.class, seasons: SEASONS.filter((x) => (d.seasons || []).indexOf(x) !== -1),
      per_100g: c.per_100g, veg_share: c.veg_share, cooked_g: d.cooked_g,
      // 家庭共餐的單品欄位（decisions #152）：複合料理，過敏原＝配方聯集＋未確認，素食一律不標
      // 「不吃」清單用：自己的 id 加上配方裡的食材與分層品項 id（findDislikedHit 比對 components）
      components: [d.id].concat((d.recipe || []).map((it) => it.ref).filter((ref, i, a) => a.indexOf(ref) === i && !/^hs_/.test(ref) && (ctx.ingredients[ref] || ctx.tree[ref]))),
      state: "cooked", unit: d.kind === "soup" ? "ml" : "g", allergen_tags: c.allergen_tags, vegan: false, lacto_ovo: false, composite: true,
      source: d.source || { type: "assumption", ref: "配方與成品重為估計（見 note）" }, note: d.note };
    if (d.ntu_kcal_100g != null) {
      row.ntu_kcal_100g = d.ntu_kcal_100g;
      const dev = (c.per_100g.kcal - d.ntu_kcal_100g) / d.ntu_kcal_100g;
      row.ntu_deviation = Math.round(dev * 1000) / 1000;
      if (Math.abs(dev) > NTU_DEVIATION_LIMIT) {
        if (typeof d.deviation_note !== "string" || d.deviation_note === "") problems.push("家常菜 " + d.id + "：跟 NTU 對照差 " + Math.round(dev * 100) + "%（超過 25%），要寫 deviation_note");
        else row.deviation_note = d.deviation_note;
      }
    }
    dishes.push(row);
  });
  const classes = {};
  CLASSES.forEach((cl) => {
    const rows = dishes.filter((x) => x.kind === "dish" && x.class === cl);
    if (rows.length < 3) problems.push("類別 " + cl + " 至少要 3 道菜（目前 " + rows.length + "）");
    classes[cl] = { n: rows.length, per_100g: rows.length ? average(rows) : null, dishes: rows.map((x) => x.id) };
  });
  const soups = dishes.filter((x) => x.kind === "soup");
  if (soups.length < 3) problems.push("湯至少要 3 道（目前 " + soups.length + "）");
  // 每個季節都要有菜可選（共餐清單只列當季）：素菜、菜肉各至少 3 道，純肉至少 3 道，湯至少 1 道
  SEASONS.forEach((se) => {
    const inSeason = (cl) => dishes.filter((x) => x.kind === "dish" && x.class === cl && x.seasons.indexOf(se) !== -1).length;
    ["veg", "mixed", "meat"].forEach((cl) => { if (inSeason(cl) < 3) problems.push("季節 " + se + " 的 " + cl + " 少於 3 道（目前 " + inSeason(cl) + "）"); });
    if (!soups.some((x) => x.seasons.indexOf(se) !== -1)) problems.push("季節 " + se + " 沒有湯");
  });
  const soup = { n: soups.length, per_100g: soups.length ? average(soups) : null, dishes: soups.map((x) => x.id) };
  const staples = {};
  STAPLES.forEach((s) => {
    const r = resolveRef(s.ref, ctx, sm.map);
    if (r.problem) problems.push("主食 " + s.key + "：" + r.problem);
    else staples[s.key] = { ref: s.ref, name: s.name, per_100g: Object.assign({}, r.per_100g) };
  });
  const seasonings = Object.keys(sm.map).map((id) => ({
    id: id, name: sm.map[id].entry.name, source: sm.map[id].entry.source, per_100g: sm.map[id].per_100g,
    field_sources: sm.map[id].field_sources, note: sm.map[id].entry.note || null,
  }));
  const out = {
    version: 1,
    note: "產生檔，不手改：改 data/reference/home_dish_recipes.json 或 home_dish_seasonings.json 再跑 node tools/build-home-dishes.js（章程 B4「家常菜估算」）。",
    staples: staples, classes: classes, soup: soup, dishes: dishes, seasonings: seasonings,
  };
  return { data: out, problems: problems, warnings: warnings };
}

function stringifyHomeDishes(data) {
  return JSON.stringify(data, null, 1) + "\n";
}

module.exports = {
  CLASSES, ROLES, SEASONS, STAPLES, DERIVED_SEASONINGS, ZERO_FILL_REASONS, NTU_DEVIATION_LIMIT,
  loadHomeDishContext, seasoningValues, seasoningMap, resolveRef, computeDish, autoClass, buildHomeDishes, stringifyHomeDishes,
};
