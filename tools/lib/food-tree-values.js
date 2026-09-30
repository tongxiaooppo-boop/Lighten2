// 代換表分層品項的唯一算法（章程 B4「分層品項」、decisions #101–#111）：build-food-tree.js 用它產生 data/food_tree.json，
// check-data.js 用同一份重算比對。代換表轉錄在 data/reference/food_exchange_table.json（照 PDF 抄，不在這裡改字），
// 人工對應在 data/reference/food_tree_map.json，過敏原與素食標註在 data/reference/food_exchange_tags.json。
//
// 數值的兩條路徑（decisions #103）：
//   fx_ 品項   跟現成品項同一段換算：computePer100g({ source: derived「編號 × 倍數」 })，TFDA 未進位值 × 倍數再進位
//              （所以外帶「鮮奶一杯」tw_dr08 的 L01021 × 2.4 跟代換表全脂奶 240ml 完全相同）
//   內建食材   共用內建 id 與只列內建的：內建已進位的 per_100g × 克數再進位（跟 engine 的 ingredientContribution 相同）

"use strict";

const fs = require("fs");
const path = require("path");
const { computePer100g, round1, FIELDS, DERIVED_REF } = require("./ingredient-values");

const ROOT = path.join(__dirname, "..", "..");
const readRef = (f) => JSON.parse(fs.readFileSync(path.join(ROOT, "data", "reference", f), "utf8"));

const GROUP_OF_TABLE = { "附-2": "dairy", "附-3-1": "protein", "附-3-2": "protein", "附-3-3": "protein", "附-4": "grain", "附-5": "vegetable", "附-6": "fruit", "附-7": "fat" };
const EXCLUDED_AXES = ["method", "implicit", "seasoning"]; // 不列在分層（decisions #102）
const STATES = ["raw", "cooked", "dry", "wet", "as_is"];

// 代換表每一個品名一個 key：「表號#列序#第幾個品名」（跟 collab/transcripts/exchange_names.tsv 相同）。
// 一列只有一個品名時 names 是 null，品名＝原列文字。
function exchangeNames(table) {
  const out = [];
  table.items.forEach((row) => {
    const names = Array.isArray(row.names) && row.names.length ? row.names : [row.row_text];
    names.forEach((name, i) => out.push({ key: row.table + "#" + row.order + "#" + (i + 1), name: name, row: row }));
  });
  return out;
}

function loadExchange() {
  return { table: readRef("food_exchange_table.json"), tags: readRef("food_exchange_tags.json") };
}

// 畫面名稱的預設值：去掉代換表的符號與附註（PRD 13.3）；對應表可以另外指定 name
function cleanExchangeName(s) {
  return s.replace(/[◎＊△#]/g, "")
    .replace(/[（(]\s*\+[^）)]*[）)]/g, "")        // （+5公克碳水化合物）、(+1茶匙油)
    .replace(/[（(][^）)]*個\/斤[）)]/g, "")        // (3個/斤)
    .replace(/[（(]\d+斤\/個[）)]/g, "")
    .replace(/\d+x\d+x[\d.]+公分/, "")
    .replace(/\(/g, "（").replace(/\)/g, "）")
    .trim();
}

// ---------- 樣品狀態（章程 B12，decisions M3） ----------
// 在「樣品狀態:」裡去掉括號內的成分清單後找關鍵字；生熟乾濕優先於包裝型態。
// 沒有關鍵字、但有樣品狀態（例：水果的品系名稱）的水果、蔬菜、菇類視為 raw。推不出回 null（對應表要寫 state_reason）。
function sampleState(r) {
  const m = /樣品狀態:([^;]*)/.exec((r && r["內容物描述"]) || "");
  if (!m) return null;
  const s = m[1].replace(/[（(][^）)]*[）)]/g, "");
  if (/濕/.test(s)) return "wet";
  if (/(^|,)\s*熟/.test(s)) return "cooked";
  if (/乾貨|果乾|乾麵條/.test(s)) return "dry";
  if (/(^|,)\s*(生|未烹調)/.test(s)) return "raw";
  if (/冷凍包裝|包裝產品|罐頭|瓶裝|糖漬|醃漬|鹽漬/.test(s)) return "as_is";
  if (["水果類", "蔬菜類", "菇類"].indexOf(r["食品分類"]) !== -1) return "raw";
  return null;
}

// ---------- 含糖（decisions M4） ----------
// sugar: "none" 的樣品名稱與描述不得有加糖字眼（「無加糖」「無糖」除外）；"added" 必須有。不看糖質總量（乳糖、果糖是天然的）
const ADDED_SUGAR = /砂糖|蔗糖|特砂|果糖|糖漬|加糖|(^|[,(（])糖([,)）]|等|$)/;
function sugarProblem(sugar, r) {
  if (sugar == null) return null;
  const text = ((r["樣品名稱"] || "") + " " + (r["內容物描述"] || "")).replace(/無加糖|無糖/g, "");
  if (sugar === "none" && ADDED_SUGAR.test(text)) return "標「無糖」但衛福部樣品有加糖字眼";
  if (sugar === "added" && !ADDED_SUGAR.test(text)) return "標「含糖」但衛福部樣品沒有加糖字眼";
  if (sugar !== "none" && sugar !== "added") return "sugar 只能是 none、added 或 null";
  return null;
}

// ---------- TFDA 缺值填 0 的白名單（章程 B5.1，decisions #107） ----------
const ZERO_FILL = {
  動物性食材: { cats: ["肉類", "魚貝類", "蛋類", "乳品類"], fields: ["fiber_g"], note: { fiber_g: "TFDA 此欄無資料；動物性食材不含膳食纖維，填 0" } },
  蔬菜: { cats: ["蔬菜類", "菇類"], fields: ["sat_fat_g"], maxFat: 0.5, note: { sat_fat_g: "TFDA 此欄無資料；這項蔬菜脂肪 ≤0.5g/100g，飽和脂肪接近 0，填 0" } },
  水果: { cats: ["水果類"], fields: ["sat_fat_g"], maxFat: 0.5, note: { sat_fat_g: "TFDA 此欄無資料；這項水果脂肪 ≤0.5g/100g，飽和脂肪接近 0，填 0" } },
  油脂: { cats: ["油脂類"], fields: ["fiber_g", "sodium_mg"], note: { fiber_g: "TFDA 此欄無資料；純油脂不含膳食纖維，填 0", sodium_mg: "TFDA 此欄無資料；純油脂不含鈉，填 0" } },
};
// 回傳錯誤文字或 null。r＝衛福部樣品
function zeroFillProblem(reason, field, r) {
  const rule = ZERO_FILL[reason];
  if (!rule) return "填 0 的理由「" + reason + "」不在白名單（動物性食材、蔬菜、水果、油脂）";
  if (!r) return "沒有衛福部樣品，不能依食品分類判斷";
  if (rule.fields.indexOf(field) === -1) return "理由「" + reason + "」只能填 " + rule.fields.join("、") + "，不能填 " + field;
  if (rule.cats.indexOf(r["食品分類"]) === -1) return "理由「" + reason + "」只適用衛福部" + rule.cats.join("、") + "，這個樣品是" + r["食品分類"];
  if (rule.maxFat != null && !(r["粗脂肪(g)"] <= rule.maxFat)) return "理由「" + reason + "」要脂肪 ≤ " + rule.maxFat + "g/100g，這個樣品是 " + r["粗脂肪(g)"];
  return null;
}
// 這個樣品依白名單可以填 0 的欄位（撰寫對應表時自動補；結果明寫在對應表裡）
function autoZeroFill(r) {
  const out = {};
  if (!r) return out;
  Object.keys(ZERO_FILL).forEach((reason) => {
    ZERO_FILL[reason].fields.forEach((f) => {
      const col = { fiber_g: "膳食纖維(g)", sat_fat_g: "飽和脂肪(g)", sodium_mg: "鈉(mg)" }[f];
      if (r[col] == null && !zeroFillProblem(reason, f, r)) out[f] = reason;
    });
  });
  return out;
}

// ---------- 代換表名目熱量（decisions #110） ----------
// 附-1 每份熱量，加上代換表附註（多的碳水、蛋白質 × 4，多的脂肪 × 9，另加 N 茶匙油 × 45）。超高脂只有下限。
function nominalKcal(row) {
  const t = row.table, tier = row.tier, x = row.extra || {};
  let base, lowerOnly = false;
  if (t === "附-2") {
    const fat = { 全脂: 8, 低脂: 4, 脫脂: 0 }[tier];
    // 乳酪等另給碳水的，用 蛋白質 8、該級脂肪、代換表給的碳水 算
    base = x.carb_g != null ? 8 * 4 + fat * 9 + x.carb_g * 4 : { 全脂: 150, 低脂: 120, 脫脂: 80 }[tier];
    return { kcal: base, lowerOnly: false };
  }
  if (t === "附-3-1") base = 55;
  else if (t === "附-3-2") base = 75;
  else if (t === "附-3-3") { base = tier === "超高脂" ? 135 : 120; lowerOnly = tier === "超高脂"; }
  else base = { "附-4": 70, "附-5": 25, "附-6": 60, "附-7": 45 }[t];
  if (x.carb_g != null) base += x.carb_g * 4;
  if (x.protein_g != null) base += x.protein_g * 4;
  if (x.fat_g != null) base += x.fat_g * 9;
  const oil = /\+\s*(\d+\/\d+|\d+)\s*茶匙油/.exec(row.row_text);
  if (oil) base += (oil[1].indexOf("/") !== -1 ? Number(oil[1].split("/")[0]) / Number(oil[1].split("/")[1]) : Number(oil[1])) * 45;
  return { kcal: base, lowerOnly: lowerOnly };
}
function nominalOutOfRange(kcal, nominal) {
  const ratio = kcal / nominal.kcal;
  return { ratio: ratio, out: ratio < 0.6 || (!nominal.lowerOnly && ratio > 1.6) };
}

// ---------- 產生 data/food_tree.json ----------
function tfdaCodeOf(ing) {
  const src = ing.source || {};
  if (src.type === "tfda") return src.ref;
  const m = src.type === "derived" ? DERIVED_REF.exec(src.ref || "") : null;
  return m ? m[1] : null;
}
const factorStr = (n) => String(n);
const perServingFromPer100 = (per, g) => {
  const out = {};
  FIELDS.forEach((k) => { out[k] = per[k] == null ? null : round1(per[k] * g / 100); });
  return out;
};
function fieldSourcesOf(zeroFill) {
  const out = {};
  Object.keys(zeroFill || {}).forEach((f) => {
    const reason = zeroFill[f];
    const rule = ZERO_FILL[reason];
    out[f] = { type: "derived", value: 0, ref: reason, note: rule ? rule.note[f] : "" };
  });
  return out;
}
function displayOf(row) {
  if (row.cooked_g != null && row.cooked_g !== row.raw_g) return "煮熟約 " + row.cooked_g + "g";
  if (row.buy_g != null && row.buy_g !== row.edible_g) return "購買量約 " + row.buy_g + "g";
  return null;
}
function uniq(list, not) {
  const seen = {};
  return list.filter((s) => s && s !== not && !seen[s] && (seen[s] = true));
}

// ctx：{ table, tags, map, ingredients, products: [{ uid, source }], refs }
// 回傳 { version, groups, items }；丟錯＝對應表本身有結構問題（check-data 另外逐條檢查語意）
function buildFoodTree(ctx) {
  const names = exchangeNames(ctx.table);
  const nameByKey = {};
  names.forEach((n) => { nameByKey[n.key] = n; });
  const tagByKey = {};
  ctx.tags.items.forEach((t) => { tagByKey[t.key] = t; });
  const ingById = {};
  ctx.ingredients.forEach((it) => { ingById[it.id] = it; });
  // 被併入者的名稱與原列文字，進目標的別名
  const mergedAliases = {};
  ctx.map.entries.filter((e) => e.action === "merge").forEach((e) => {
    const n = nameByKey[e.key];
    if (!n) throw new Error("merge 的 key 不存在：" + e.key);
    (mergedAliases[e.into] = mergedAliases[e.into] || []).push(cleanExchangeName(n.name), n.row.row_text);
  });
  const sameSample = (code) => ctx.products.filter((p) => {
    const m = p.source && p.source.type === "derived" ? DERIVED_REF.exec(p.source.ref || "") : null;
    return m && m[1] === code;
  }).map((p) => p.uid);

  const items = [];
  const makeItem = (e, part, n) => {
    const row = n ? n.row : null;
    const ing = ingById[part.id];
    const builtin = !!ing;
    const tag = n ? tagByKey[n.key] : null;
    let amount, per100, perServing, source, fieldSources;
    if (e.builtin_only) {
      amount = { value: ing.serving_g, unit: "g", from: "builtin" };
    } else {
      amount = e.amount;
    }
    const code = builtin ? tfdaCodeOf(ing) : part.tfda_id;
    if (builtin) {
      per100 = Object.assign({}, ing.per_100g);
      perServing = perServingFromPer100(per100, amount.value);
      source = { type: "derived", ref: (code || ing.source.ref) + " × " + factorStr(amount.value / 100),
        note: "內建食材 " + ing.id + " 的每 100g × " + amount.value + (amount.unit === "ml" ? "ml（附-1 換算 1ml＝1g）" : "g") + "（跟今日建議同一算法，decisions #103）" };
      fieldSources = {};
      Object.keys(ing.field_sources || {}).forEach((k) => { if (FIELDS.indexOf(k) !== -1) fieldSources[k] = ing.field_sources[k]; });
    } else {
      const eq = part.equivalent || e.equivalent;
      const serveFactor = eq ? eq.grams / 100 : amount.value / 100;
      const per100Factor = eq ? eq.grams / amount.value : 1;
      fieldSources = fieldSourcesOf(part.zero_fill);
      perServing = computePer100g({ source: { type: "derived", ref: part.tfda_id + " × " + factorStr(serveFactor) }, field_sources: fieldSources }, ctx.refs);
      per100 = computePer100g({ source: { type: "derived", ref: part.tfda_id + " × " + factorStr(per100Factor) }, field_sources: fieldSources }, ctx.refs);
      const how = eq ? eq.row : row.table + " " + row.row_text + " " + amount.value + (amount.unit === "ml" ? "ml，附-1「1 杯＝240 公克」換算" : "g");
      source = { type: "derived", ref: part.tfda_id + " × " + factorStr(serveFactor), note: how };
    }
    const allergen = builtin && !n ? ing.allergen_tags : tag.allergen_tags;
    const vegan = builtin && !n ? ing.vegan : tag.vegan;
    const lactoOvo = builtin && !n ? ing.lacto_ovo : tag.lacto_ovo;
    const name = builtin ? ing.name : (part.name || cleanExchangeName(n.name));
    const aliases = uniq([].concat(part.aliases || [], n && !part.split_child ? [cleanExchangeName(n.name), n.name, row.row_text] : [], mergedAliases[e.key] || []), name);
    return {
      id: part.id, group: e.group, subgroup: e.subgroup, name: name, aliases: aliases,
      exchange: n ? { table: row.table, key: n.key, row_text: row.row_text } : null,
      serving: {
        amount: amount.value, unit: amount.unit,
        household: e.builtin_only ? null : (part.household !== undefined ? part.household : (row.portion_text || null)),
        display: e.builtin_only ? null : displayOf(row),
        builtin_meal: !!e.builtin_only,
      },
      per_serving: perServing, per_100g: per100,
      tfda_id: code, source: source, field_sources: fieldSources,
      state: builtin && e.builtin_only ? ing.basis : part.state, sugar: part.sugar || null,
      allergen_tags: allergen, vegan: vegan, lacto_ovo: lactoOvo,
      composite: builtin && e.builtin_only ? !!ing.composite : !!part.composite,
      home_drink: !!part.home_drink, tags: part.tags || [], note: part.note || null,
      builtin: builtin, same_sample_products: code ? sameSample(code) : [],
    };
  };
  ctx.map.entries.forEach((e) => {
    if (e.builtin_only) {
      const ing = ingById[e.builtin_only];
      if (!ing) throw new Error("builtin_only 找不到內建食材 " + e.builtin_only);
      items.push(makeItem(e, { id: ing.id }, null));
      return;
    }
    if (e.action !== "item") return;
    const n = nameByKey[e.key];
    if (!n) throw new Error("對應表的 key 不存在：" + e.key);
    items.push(makeItem(e, e, n));
    (e.split || []).forEach((s) => {
      items.push(makeItem(e, Object.assign({ split_child: true, amount: e.amount }, s), n));
    });
  });
  return {
    version: { exchange: ctx.table._source, tfda: ctx.refs.tfdaFile || "tfda-2025-update1.json" },
    groups: ctx.map.groups,
    items: items,
  };
}

// 一行一筆的輸出（方便看 diff）
function stringifyFoodTree(tree) {
  return "{\n  \"version\": " + JSON.stringify(tree.version) + ",\n  \"groups\": " + JSON.stringify(tree.groups) +
    ",\n  \"items\": [\n" + tree.items.map((it) => "    " + JSON.stringify(it)).join(",\n") + "\n  ]\n}\n";
}

function loadFoodTreeContext(refs, readJson) {
  const ex = loadExchange();
  const products = readJson("convenience_items.json").map((p) => ({ uid: p.id, source: p.source }))
    .concat(readJson("taiwan_items.json").map((p) => ({ uid: "tw_" + p.id, source: p.source })));
  return { table: ex.table, tags: ex.tags, map: readRef("food_tree_map.json"), ingredients: readJson("ingredients.json"), products: products, refs: refs };
}

module.exports = {
  exchangeNames, loadExchange, cleanExchangeName, sampleState, sugarProblem, zeroFillProblem, autoZeroFill, ZERO_FILL,
  nominalKcal, nominalOutOfRange, buildFoodTree, stringifyFoodTree, loadFoodTreeContext, tfdaCodeOf,
  GROUP_OF_TABLE, EXCLUDED_AXES, STATES, readRef,
};
