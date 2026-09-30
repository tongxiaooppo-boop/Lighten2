// 輕盈計畫 — 食物資料檢查（章程 B12）
// 用法：在 repo 根目錄執行 `node tools/check-data.js`；有錯誤 exit 1，警告只列出。pre-commit hook 會跑。
// 營養值跟參考資料「完全相等」的算法跟 build-ingredients.js 共用 tools/lib/ingredient-values.js。

"use strict";

const fs = require("fs");
const path = require("path");
const { loadReferences, computePer100g, FIELDS, DERIVED_REF } = require("./lib/ingredient-values");
const FT = require("./lib/food-tree-values");
const { exchangeNames, loadExchange } = FT;

const ROOT = path.join(__dirname, "..");
const readJson = (f) => JSON.parse(fs.readFileSync(path.join(ROOT, "data", f), "utf8"));

const errors = [];
const warnings = [];
const err = (m) => errors.push(m);
const warn = (m) => warnings.push(m);

// 詞彙與列舉（章程 B4、B6.1）。過敏原詞彙的唯一來源是 js/core/config.js，這裡讀原始碼避免另抄一份。
const configSrc = fs.readFileSync(path.join(ROOT, "js", "core", "config.js"), "utf8");
const ALLERGENS = JSON.parse(/ALLERGEN_OPTIONS = (\[[^\]]*\])/.exec(configSrc)[1]);
const UNVERIFIED = "未確認";
const AXES = ["protein", "staple", "vegetable", "seasoning", "method", "implicit"];
const BASES = ["raw", "cooked", "dry", "as_is"];
const TIERS = ["🟢", "🟡", "🔴"];
const SLOTS = ["breakfast", "lunch", "afternoon_tea", "dinner", "snack"];
const INGREDIENT_SOURCES = { tfda: 1, usda: 2, derived: 3 };
const NOT_IN_TFDA = /TFDA (無|沒有)/;

const isNum = (v) => typeof v === "number" && isFinite(v);

function checkAllergenTags(where, tags, allowNull) {
  if (tags === null && allowNull) return;
  if (!Array.isArray(tags)) { err(where + "：allergen_tags 必須是陣列" + (allowNull ? "或 null" : "（食材不允許 null）")); return; }
  tags.forEach((t) => { if (ALLERGENS.indexOf(t) === -1 && t !== UNVERIFIED) err(where + "：過敏原「" + t + "」不在固定詞彙內"); });
}

// 飲食限制跟過敏原一致（章程 B6.8）。allergen_tags 是 null＝未確認
const NOT_VEGAN = ["蛋", "乳製品", "魚", "甲殼類", "軟體動物"];
const NOT_LACTO_OVO = ["魚", "甲殼類", "軟體動物"];
function checkDietTags(where, it) {
  const tags = Array.isArray(it.allergen_tags) ? it.allergen_tags : [UNVERIFIED];
  const unverified = tags.indexOf(UNVERIFIED) !== -1;
  if (it.vegan) {
    tags.filter((t) => NOT_VEGAN.indexOf(t) !== -1).forEach((t) => err(where + "：標全素卻含「" + t + "」（章程 B6.8）"));
    if (unverified) err(where + "：過敏原未確認就不能宣告全素（章程 B6.8）");
  }
  if (it.lacto_ovo) {
    tags.filter((t) => NOT_LACTO_OVO.indexOf(t) !== -1).forEach((t) => err(where + "：標蛋奶素卻含「" + t + "」（章程 B6.8）"));
    if (unverified && !/素食依據：/.test(it.note || "")) err(where + "：過敏原未確認又標蛋奶素，note 要寫「素食依據：」（章程 B6.8）");
  }
  // 過敏原詞彙沒有畜禽肉：名稱或 note 有肉類字眼又標素，要寫依據（啟發式）
  const meatWord = MEAT_WORDS.exec(((it.name || "") + " " + (it.note || "")).replace(NOT_MEAT_WORDS, ""));
  if ((it.vegan || it.lacto_ovo) && meatWord && !/素食依據：/.test(it.note || "")) {
    err(where + "：名稱或 note 有「" + meatWord[0] + "」又標素，note 要寫「素食依據：」（章程 B6.8）");
  }
}
const MEAT_WORDS = /雞|豬|牛|羊|鴨|肉|排骨|火腿|培根|魚|蝦/;
const NOT_MEAT_WORDS = /雞蛋|牛奶|牛乳|牛蒡|植物肉|素肉|果肉|肉桂/g;

// TFDA 內容物描述有沒有完整列出成分（章程 B6.3）：括號裡用逗號列出成分，而且任何成分清單都沒有「等」
// （TFDA 常見「樣品狀態:…(A,B等); 前處理描述:…」，清單以「等」結尾但整段描述不是）
function listsCompleteIngredients(desc) {
  return /[（(][^）)]*[,，][^）)]*[）)]/.test(desc) && !/等\s*([）)]|$)/.test(desc);
}

// 衛福部樣品的整合編號：tfda 出處取 ref，derived「編號 × 倍數」取編號；其他（usda、估算）回 null
function tfdaSampleCode(src) {
  if (!src) return null;
  if (src.type === "tfda") return src.ref || null;
  const m = src.type === "derived" ? DERIVED_REF.exec(src.ref || "") : null;
  return m ? m[1] : null;
}
// 樣品名稱＋內容物描述（不含俗名：俗名是別稱，不是成分）
function tfdaSampleText(refs, code) {
  const r = code ? refs.tfda[code] : null;
  return r ? (r["樣品名稱"] || "") + " " + (r["內容物描述"] || "") : "";
}
const hasTagOrUnverified = (tags, tag) => (tags || []).some((t) => t === tag || t === UNVERIFIED);

// 章程 B6.2 延伸到樣品描述（decisions #101）：衛福部樣品含燕麥、麥片的，要標麩質或未確認
function oatsInSampleProblem(tags, text) {
  return /燕麥|麥片/.test(text) && !hasTagOrUnverified(tags, "麩質");
}
// 樣品名稱與描述的過敏原關鍵字跟標註對不上（章程 B6.2，只當警告）。
// 例外依衛福部編號列出處：M1100101 大豆油——高度提煉大豆油不必標黃豆（decisions #89）
const SAMPLE_ALLERGEN_WORDS = [
  ["麩質", /燕麥|麥片|小麥|大麥|麵粉|麵筋|麩/], ["黃豆", /黃豆|大豆|醬油|豆腐|豆漿/],
  ["蛋", /(?<!分離|大豆|植物|乳清)蛋(?!白質|黃果)/], ["乳製品", /乳(?!化)|奶|起司/],
  ["魚", /(?<!章|魷|墨|鮑)魚/], ["甲殼類", /蝦|蟹/], ["芝麻", /芝麻/], ["花生", /花生/],
];
const SAMPLE_WORD_EXCEPTIONS = { M1100101: ["黃豆"] };
function sampleAllergenGaps(tags, text, code) {
  const skip = SAMPLE_WORD_EXCEPTIONS[code] || [];
  return SAMPLE_ALLERGEN_WORDS
    .filter(([tag, re]) => skip.indexOf(tag) === -1 && re.test(text) && !hasTagOrUnverified(tags, tag))
    .map(([tag]) => tag);
}
// 分層品項（樣品已選定、人工標，章程 B6、B6.9）：描述明寫的過敏原一律要標，「未確認」不能代替（切片 3 抽查 T1、M4）。
// 比 sampleAllergenGaps 多：醬油、麵衣算麩質（醬油一般用小麥釀造）；「蛋餅」是餅名、「黃豆蛋白」不是蛋、「人造奶油」不是乳製品。
// 例外另加 M9900101 烤酥油（純大豆提煉，同 decisions #89 高度提煉大豆油的排除）。
const SAMPLE_ALLERGEN_WORDS_STRICT = SAMPLE_ALLERGEN_WORDS.map(([tag, re]) => {
  if (tag === "麩質") return [tag, /燕麥|麥片|小麥|大麥|麵粉|麵筋|麩|麵衣|醬油/];
  if (tag === "蛋") return [tag, /(?<!分離|大豆|黃豆|植物|乳清)蛋(?!白質|黃果|餅)/];
  if (tag === "乳製品") return [tag, /乳(?!化)|(?<!人造)奶|起司/];
  return [tag, re];
});
const STRICT_WORD_EXCEPTIONS = Object.assign({ M9900101: ["黃豆"] }, SAMPLE_WORD_EXCEPTIONS);
function sampleAllergenMissing(tags, text, code) {
  const skip = STRICT_WORD_EXCEPTIONS[code] || [];
  return SAMPLE_ALLERGEN_WORDS_STRICT
    .filter(([tag, re]) => skip.indexOf(tag) === -1 && re.test(text) && (tags || []).indexOf(tag) === -1)
    .map(([tag]) => tag);
}

// 代換表轉錄與標註（章程 B1、B10）。decisions #35 與食物資料 review 引用的份量要在轉錄檔裡仍成立
const EXCHANGE_CITED = [
  ["附-4", "米、黑米、小米、糯米等", "edible_g", 20], ["附-4", "糙米、什穀米、胚芽米", "edible_g", 20],
  ["附-4", "飯", "edible_g", 40], ["附-4", "蕃薯(4個/斤)", "edible_g", 55], ["附-4", "南瓜", "edible_g", 85],
  ["附-3-1", "毛豆（+5公克碳水化合物）", "raw_g", 50], ["附-3-1", "雞里肉、雞胸肉", "raw_g", 30],
  ["附-3-1", "◎ 膽肝", "raw_g", 20], ["附-3-2", "虱目魚、烏魚、肉鯽、鹹馧魚、鮭魚", "raw_g", 35],
  ["附-3-2", "虱目魚、烏魚、肉鯽、鹹馧魚、鮭魚", "cooked_g", 30],
];
function checkExchangeReference(table, tags) {
  EXCHANGE_CITED.forEach(([t, text, k, v]) => {
    const row = table.items.find((r) => r.table === t && r.row_text === text);
    if (!row) err("代換表轉錄找不到 " + t + "「" + text + "」（decisions #35 引用）");
    else if (row[k] !== v) err("代換表 " + t + "「" + text + "」" + k + " 是 " + row[k] + "，decisions #35 引用的是 " + v);
  });
  const names = exchangeNames(table);
  if (names.length !== 374) err("代換表品名應為 374 個，實際 " + names.length);
  const byKey = {};
  tags.items.forEach((x, i) => {
    const w = "food_exchange_tags[" + i + "] " + x.key;
    if (byKey[x.key]) err(w + "：key 重複");
    byKey[x.key] = x;
    checkAllergenTags(w, x.allergen_tags, false);
    if (typeof x.vegan !== "boolean" || typeof x.lacto_ovo !== "boolean") err(w + "：vegan、lacto_ovo 要是 true/false");
    if (x.vegan && !x.lacto_ovo) err(w + "：全素一定也是蛋奶素");
    checkDietTags(w, { name: x.name, allergen_tags: x.allergen_tags, vegan: x.vegan, lacto_ovo: x.lacto_ovo, note: x.reason });
  });
  names.forEach((n) => {
    const x = byKey[n.key];
    if (!x) err("代換表標註缺 " + n.key + "「" + n.name + "」");
    else if (x.name !== n.name) err("代換表標註 " + n.key + " 的品名「" + x.name + "」跟轉錄「" + n.name + "」不同");
  });
  if (tags.items.length !== names.length) err("代換表標註 " + tags.items.length + " 筆，品名 " + names.length + " 個");
}

// ---------- 代換表分層品項（章程 B4「分層品項」、B12，decisions #78、#79、#101–#111） ----------
const USER_PREFIXES = /^(custom_|cdish_|cing_|saved_)/;
const FX_ID = /^fx_[a-z0-9_]+$/;
// ctx＝loadFoodTreeContext 的結果；fileText＝data/food_tree.json 原文；frozen＝凍結清單；catalogUids＝現成品項 uid
function checkFoodTree(ctx, fileText, frozen, catalogUids) {
  const names = FT.exchangeNames(ctx.table);
  const nameByKey = {};
  names.forEach((n) => { nameByKey[n.key] = n; });
  const tagByKey = {};
  ctx.tags.items.forEach((t) => { tagByKey[t.key] = t; });
  const ingById = {};
  ctx.ingredients.forEach((it) => { ingById[it.id] = it; });
  const groupOk = (g, sub) => {
    const G = ctx.map.groups.find((x) => x.code === g);
    return !!G && (sub == null ? G.subgroups.length === 0 : G.subgroups.some((s) => s.code === sub));
  };
  const sameTags = (a, b) => JSON.stringify((a.allergen_tags || []).slice().sort()) === JSON.stringify((b.allergen_tags || []).slice().sort()) &&
    a.vegan === b.vegan && a.lacto_ovo === b.lacto_ovo;

  // 1. 對應表：374 個品名齊全、動作合法、merge 目標是 item、被併入者標註相同
  const entryByKey = {};
  const parts = []; // { e, p, n }
  ctx.map.entries.forEach((e, i) => {
    const w = "food_tree_map[" + i + "] " + (e.key || e.builtin_only);
    if (typeof e.reason !== "string" || e.reason.trim() === "") err(w + "：要寫理由（reason）");
    if (e.builtin_only) {
      const ing = ingById[e.builtin_only];
      if (!ing) err(w + "：builtin_only 找不到內建食材");
      else if (FT.EXCLUDED_AXES.indexOf(ing.axis) !== -1) err(w + "：烹調法、隱含成分、醬料不列在分層（decisions #102）");
      if (!groupOk(e.group, e.subgroup)) err(w + "：大類／子類不合法（" + e.group + "／" + e.subgroup + "）");
      return;
    }
    const n = nameByKey[e.key];
    if (!n) { err(w + "：代換表沒有這個 key"); return; }
    if (entryByKey[e.key]) err(w + "：key 重複");
    entryByKey[e.key] = e;
    if (["item", "merge", "exclude"].indexOf(e.action) === -1) err(w + "：action 只能是 item、merge、exclude");
    if (e.action === "item") {
      if (e.group !== FT.GROUP_OF_TABLE[n.row.table]) err(w + "：大類應為 " + FT.GROUP_OF_TABLE[n.row.table] + "（照代換表表號）");
      if (!groupOk(e.group, e.subgroup)) err(w + "：子類不合法（" + e.subgroup + "）");
      [e].concat(e.split || []).forEach((p) => parts.push({ e: e, p: p, n: n }));
    }
  });
  parts.forEach(({ e, p }) => { if (!p.tfda_id) err("分層 " + p.id + "（" + e.key + "）：tfda_id 只有出處是 usda 的內建食材可以是 null（代換表對應一定要有衛福部樣品）"); });
  names.forEach((n) => { if (!entryByKey[n.key]) err("對應表缺 " + n.key + "「" + n.name + "」（374 個品名每個都要有一筆）"); });
  ctx.map.entries.filter((e) => e.action === "merge").forEach((e) => {
    const t = entryByKey[e.into];
    if (!t || t.action !== "item") err("food_tree_map " + e.key + "：merge 的目標 " + e.into + " 不是 item");
    else if (tagByKey[e.key] && tagByKey[e.into] && !sameTags(tagByKey[e.key], tagByKey[e.into])) err("food_tree_map " + e.key + "：併入 " + e.into + " 但過敏原或素食標註不同（對應錯了？）");
  });

  // 2. data/food_tree.json 等於重算結果（不手改）
  let tree;
  try { tree = FT.buildFoodTree(ctx); } catch (e) { err("代換表分層產生失敗：" + e.message); return; }
  if (fileText !== null && FT.stringifyFoodTree(tree) !== fileText) {
    let fileItems = [];
    try { fileItems = JSON.parse(fileText).items; } catch (e) { /* 原文壞掉就只報一句 */ }
    const byId = {};
    fileItems.forEach((it) => { byId[it.id] = JSON.stringify(it); });
    const diff = tree.items.filter((it) => byId[it.id] !== JSON.stringify(it)).map((it) => it.id);
    err("data/food_tree.json 跟重算結果不同（不手改，跑 node tools/build-food-tree.js）" + (diff.length ? "：" + diff.slice(0, 10).join("、") : ""));
  }
  const itemById = {};
  const idCount = {};
  tree.items.forEach((it) => { itemById[it.id] = it; idCount[it.id] = (idCount[it.id] || 0) + 1; });

  // 3. 每一筆的對應：樣品存在、狀態、含糖、缺值填 0、名目熱量、內建一致
  parts.forEach(({ e, p, n }) => {
    const w = "分層 " + p.id + "（" + e.key + "）";
    const ing = ingById[p.id];
    const r = ctx.refs.tfda[p.tfda_id];
    if (!p.reason && p !== e) err(w + "：split 要寫理由");
    if (!r) { err(w + "：衛福部樣品 " + p.tfda_id + " 不存在"); return; }
    if (FT.STATES.indexOf(p.state) === -1) err(w + "：state 不合法（" + p.state + "）");
    const eq = p.equivalent || e.equivalent;
    if (eq) {
      if (!(eq.grams > 0) || !eq.row) err(w + "：生熟等值推算要有 grams 與 row（代換表的等值列）");
    } else {
      const derived = FT.sampleState(r);
      if (derived && derived !== p.state) err(w + "：樣品狀態是 " + derived + "（" + p.tfda_id + "），對應表記 " + p.state + "（章程 B12）");
      if (!derived && !p.state_reason) err(w + "：衛福部樣品推不出狀態，對應表要寫 state_reason（章程 B12）");
    }
    const sp = FT.sugarProblem(p.sugar, r);
    if (sp) err(w + "：" + sp + "（decisions #109）");
    Object.keys(p.zero_fill || {}).forEach((f) => {
      const zp = FT.zeroFillProblem(p.zero_fill[f], f, r);
      if (zp) err(w + "：缺值填 0 " + f + "：" + zp + "（章程 B5.1、decisions #107）");
    });
    if (ing) {
      if (FT.EXCLUDED_AXES.indexOf(ing.axis) !== -1) err(w + "：" + ing.axis + " 軸的內建食材不共用分層 id（decisions #102）");
      if (FT.tfdaCodeOf(ing) !== p.tfda_id) err(w + "：共用內建 id，衛福部樣品要跟內建相同（內建 " + FT.tfdaCodeOf(ing) + "）");
      if (ing.basis !== p.state) err(w + "：共用內建 id，狀態要等於內建 basis（" + ing.basis + "）");
    } else if (!FX_ID.test(p.id)) {
      err(w + "：不是內建食材的分層 id 要是 fx_ 開頭、小寫英文數字底線（格式 ^fx_[a-z0-9_]+$）");
    }
    const it = itemById[p.id];
    if (it) {
      const nom = FT.nominalKcal(n.row);
      if (FT.nominalOutOfRange(it.per_serving.kcal, nom).out && !p.nominal_reason) {
        err(w + "：1 份 " + it.per_serving.kcal + " kcal 超出代換表名目 " + nom.kcal + " 的 0.6–1.6 倍，對應表要寫 nominal_reason（decisions #110）");
      }
      const mac = FT.nominalMacro(n.row);
      const mv = mac ? it.per_serving[mac.field] : null;
      if (mv != null && FT.nominalOutOfRange(mv, { kcal: mac.value }).out && !p.nominal_reason) {
        err(w + "：1 份 " + mac.field + " " + mv + "g 超出代換表名目 " + mac.value + "g 的 0.6–1.6 倍，對應表要寫 nominal_reason（切片 3 抽查 T2）");
      }
    }
    // 果乾標無糖要有正面證據（衛福部寫「無加糖」「無糖」），沒寫的用 null（decisions #109、切片 3 抽查 T5）
    if (p.sugar === "none" && p.subgroup === "dried" && !/無加糖|無糖/.test((r["樣品名稱"] || "") + (r["內容物描述"] || ""))) {
      err(w + "：果乾標「無糖」，衛福部樣品 " + p.tfda_id + " 沒寫無加糖；沒有正面證據的用 null（decisions #109）");
    }
  });

  // 4. id 唯一、凍結、使用者前綴、catalog uid（decisions #78、#104）
  const catalogSet = {};
  catalogUids.forEach((u) => { catalogSet[u] = true; });
  tree.items.forEach((it) => {
    const w = "分層 " + it.id;
    if (idCount[it.id] > 1) err(w + "：id 出現 " + idCount[it.id] + " 次（共用內建 id 也只能出現一次）");
    if (catalogSet[it.id]) err(w + "：跟現成品項的 catalog uid 重複（decisions #78）");
    if (USER_PREFIXES.test(it.id)) err(w + "：不能用使用者資料的前綴 custom_／cdish_／cing_／saved_（decisions #40）");
    if (/^fx_/.test(it.id) && ingById[it.id]) err(w + "：fx_ id 撞到內建食材 id");
    if (!!ingById[it.id] !== it.builtin) err(w + "：builtin 要等於「id 是內建食材」");
    if (/^fx_/.test(it.id) && frozen.ids.indexOf(it.id) === -1) err(w + "：新的 fx_ id 要加進 data/reference/food_tree_ids_frozen.json");
  });
  frozen.ids.forEach((id) => { if (!itemById[id]) err("分層 id「" + id + "」已凍結，不得改名；下架要移到 retired（章程 B10、decisions #104）"); });
  (frozen.retired || []).forEach((x) => {
    if (itemById[x.id]) err("分層 id「" + x.id + "」已下架（retired），不得重用（decisions #104）");
    if (frozen.ids.indexOf(x.id) !== -1) err("分層 id「" + x.id + "」同時在 ids 與 retired");
  });

  // 5. 沒有重複品項
  const seenSample = {}, seenName = {};
  tree.items.forEach((it) => {
    const k1 = it.tfda_id + "|" + it.serving.amount;
    if (it.tfda_id && seenSample[k1]) err("分層 " + it.id + " 跟 " + seenSample[k1] + " 重複（同一個衛福部樣品、同一個 1 份克數，要合併）");
    else seenSample[k1] = it.id;
    const k2 = it.group + "|" + it.name;
    if (seenName[k2]) err("分層 " + it.id + " 跟 " + seenName[k2] + " 在同一大類同名「" + it.name + "」");
    else seenName[k2] = it.id;
  });

  // 6. 過敏原與素食（章程 B6）
  const bySample = {};
  tree.items.forEach((it) => {
    const w = "分層 " + it.id + " " + it.name;
    checkAllergenTags(w, it.allergen_tags, false);
    if (typeof it.vegan !== "boolean" || typeof it.lacto_ovo !== "boolean") err(w + "：vegan、lacto_ovo 要是 true/false");
    if (it.vegan && !it.lacto_ovo) err(w + "：全素一定也是蛋奶素");
    checkDietTags(w, it);
    const words = [it.name].concat(it.aliases).join(" ");
    if (/芒果|檬果/.test(words) && !hasTagOrUnverified(it.allergen_tags, "芒果")) err(w + "：名稱或別名有芒果，芒果要標芒果或未確認（章程 B6.1）");
    const text = tfdaSampleText(ctx.refs, it.tfda_id);
    if ((/燕麥/.test(it.name) || oatsInSampleProblem([], text)) && !hasTagOrUnverified(it.allergen_tags, "麩質")) err(w + "：燕麥、麥片要標麩質或未確認（章程 B6.2）");
    if (it.composite && it.allergen_tags.indexOf(UNVERIFIED) === -1) {
      const r = ctx.refs.tfda[it.tfda_id];
      if (!listsCompleteIngredients((r && r["內容物描述"]) || "")) err(w + "：複合品沒標「未確認」，衛福部樣品的內容物描述要列完整成分（章程 B6.3）");
    }
    const missing = sampleAllergenMissing(it.allergen_tags, text, it.tfda_id);
    if (missing.length) err(w + "：衛福部樣品 " + it.tfda_id + " 的名稱或描述提到「" + missing.join("、") + "」，要標出來（「未確認」不能代替；章程 B6.2、切片 3 抽查 T1）");
    if (it.tfda_id) (bySample[it.tfda_id] = bySample[it.tfda_id] || []).push({ who: "分層 " + it.id, t: it });
    else if (!(it.builtin && ingById[it.id].source.type === "usda")) err(w + "：tfda_id 只有出處是 usda 的內建食材可以是 null");
  });
  ctx.ingredients.forEach((ing) => {
    const code = FT.tfdaCodeOf(ing);
    if (code && bySample[code] && !bySample[code].some((x) => x.t.id === ing.id)) bySample[code].push({ who: "內建 " + ing.id, t: ing });
  });
  Object.keys(bySample).forEach((code) => {
    const list = bySample[code];
    list.slice(1).forEach((x) => {
      if (!sameTags(list[0].t, x.t)) err("同一個衛福部樣品 " + code + " 的標註不同：" + list[0].who + " 跟 " + x.who + "（章程 B6.9）");
    });
  });
}

// 分層規則的工具自我檢查：每條規則一個刻意改壞的例子要被擋、原資料不被擋
function selfTestFoodTree(refs, reports) {
  const T = refs.tfda;
  const bad = (what) => err("工具自我檢查（分層）：" + what);
  // 純函式
  if (FT.sampleState({ "內容物描述": "樣品狀態:濕麵條(麵粉,食油); 前處理描述:x" }) !== "wet") bad("「濕麵條」沒判成 wet");
  if (FT.sampleState({ "內容物描述": "樣品狀態:生,冷凍包裝; 前處理描述:x" }) !== "raw") bad("「生,冷凍包裝」沒判成 raw");
  if (FT.sampleState({ "內容物描述": "樣品狀態:冷凍包裝(麵粉,生鮮蝦)" }) !== "as_is") bad("括號裡的「生」被當成生的");
  if (FT.sampleState({ "內容物描述": "樣品狀態:普遍系", "食品分類": "水果類" }) !== "raw") bad("有品系、沒關鍵字的水果沒判成 raw");
  if (FT.sampleState({ "內容物描述": "前處理描述:混合均勻", "食品分類": "水果類" }) !== null) bad("沒有樣品狀態的卻推得出狀態");
  if (!FT.sugarProblem("none", T.Q8100201)) bad("芒果青（糖漬）標無糖卻沒擋");
  if (FT.sugarProblem("none", T.D1710101)) bad("葡萄乾（果乾(無加糖)）標無糖卻被擋");
  if (!FT.sugarProblem("added", T.D1710101)) bad("無加糖的樣品標含糖卻沒擋");
  if (!FT.zeroFillProblem("動物性食材", "fiber_g", T.R6100501)) bad("鱈魚丸（加工品）纖維填 0 卻沒擋");
  if (!FT.zeroFillProblem("動物性食材", "fiber_g", T.R5600201)) bad("豬肉酥（加工品）纖維填 0 卻沒擋");
  if (!FT.zeroFillProblem("水果", "sat_fat_g", T.D4410101)) bad("無花果乾（脂肪 > 0.5）飽和脂肪填 0 卻沒擋");
  if (!FT.zeroFillProblem("動物性食材", "sat_fat_g", T.I04024)) bad("動物性食材填飽和脂肪卻沒擋");
  if (!FT.zeroFillProblem("看起來差不多", "fiber_g", T.I04024)) bad("白名單以外的理由卻沒擋");
  if (FT.zeroFillProblem("動物性食材", "fiber_g", T.I04024)) bad("雞胸肉纖維填 0 卻被擋");
  // 整份檢查：拿真的對應表改一處
  const ctx0 = FT.loadFoodTreeContext(refs, readJson);
  const frozen0 = readJson("reference/food_tree_ids_frozen.json");
  const uids0 = readJson("convenience_items.json").map((p) => p.id).concat(readJson("taiwan_items.json").map((p) => "tw_" + p.id));
  const clone = (o) => JSON.parse(JSON.stringify(o));
  const run = (mutate, opts) => () => {
    const ctx = Object.assign({}, ctx0, { map: clone(ctx0.map), tags: clone(ctx0.tags) });
    const frozen = clone(frozen0);
    mutate(ctx, frozen);
    checkFoodTree(ctx, null, frozen, (opts && opts.uids) || uids0);
  };
  const entry = (ctx, key) => ctx.map.entries.find((e) => e.key === key);
  const cases = [
    [/decisions #78|./, "原資料", () => {}, false],
    [/對應表缺/, "少一個品名", (c) => { c.map.entries = c.map.entries.filter((e) => e.key !== "附-2#1#1"); }],
    [/merge 的目標/, "merge 指向不收的列", (c) => { entry(c, "附-5#3#1").into = "附-5#34#1"; }],
    [/fx_ id 撞到內建|只能出現一次|builtin 要等於/, "fx_ 撞內建 id", (c) => { entry(c, "附-2#1#1").id = "quinoa"; }],
    [/catalog uid/, "撞現成品項 uid", () => {}, true, { uids: uids0.concat(["fx_whole_milk"]) }],
    [/前綴|格式/, "使用者資料前綴", (c) => { entry(c, "附-2#1#1").id = "cing_milk"; }],
    [/格式/, "fx_ 格式", (c) => { entry(c, "附-2#1#1").id = "fx_Milk"; }],
    [/retired/, "重用已下架的 id", (c, f) => { f.retired = [{ id: "fx_whole_milk", date: "2026-09-30", reason: "x" }]; }],
    [/B6\.9/, "同一樣品不同標註", (c) => { c.tags.items.find((t) => t.key === "附-4#2#2").allergen_tags = ["麩質", "黃豆", "未確認"]; }],
    [/重複/, "重複品項（葵花油）", (c) => { const e = entry(c, "附-7#10#1"); Object.assign(e, clone(entry(c, "附-7#5#1")), { key: "附-7#10#1", id: "fx_sunflower_oil_2", name: "葵花油" }); }],
    [/樣品狀態/, "狀態不符（油麵記乾）", (c) => { entry(c, "附-4#18#1").state = "dry"; }],
    [/無糖/, "芒果青標無糖", (c) => { entry(c, "附-6#66#1").sugar = "none"; }],
    [/只適用/, "熱狗纖維填 0", (c) => { entry(c, "附-3-3#15#1").zero_fill = { fiber_g: "動物性食材" }; }],
    [/芒果/, "別名有芒果沒標", (c) => { entry(c, "附-6#2#1").aliases = ["芒果柳丁"]; }],
    [/nominal_reason/, "名目熱量超出沒寫理由", (c) => { entry(c, "附-3-1#5#2").nominal_reason = null; }],
    [/usda/, "tfda_id 是 null 卻不是 USDA 內建", (c) => { entry(c, "附-2#1#1").tfda_id = null; }],
    [/不能代替/, "蘿蔔糕（含蝦米）只標未確認", (c) => { c.tags.items.find((t) => t.key === "附-4#7#1").allergen_tags = ["未確認"]; }],
    [/protein_g .*nominal_reason/, "文蛤蛋白質超出沒寫理由", (c) => { entry(c, "附-3-1#14#1").nominal_reason = null; }],
    [/沒寫無加糖/, "龍眼乾（樣品沒寫無加糖）標無糖", (c) => { entry(c, "附-6#64#1").sugar = "none"; }],
    [/不共用分層 id|樣品要跟內建相同/, "烹調用油共用 id", (c) => { entry(c, "附-7#1#1").id = "cooking_oil"; }],
  ];
  cases.forEach(([re, what, mutate, expect, opts]) => {
    const hit = reports(re, run(mutate, opts));
    if (expect === false ? reports(/./, run(mutate, opts)) : !hit) bad(expect === false ? "原資料卻報錯" : what + "卻沒報錯");
  });
}

// 二手官方數字凍結（章程 B2.2）：frozen＝{ "檔名.id": { 欄位: 值 } }，productByKey＝同樣 key 的品項
function checkOfficialFrozen(frozen, productByKey) {
  Object.keys(frozen).forEach((key) => {
    const p = productByKey[key];
    if (!p) { err("官方數字凍結清單的「" + key + "」找不到品項（章程 B2.2）"); return; }
    Object.keys(frozen[key]).forEach((k) => {
      if (p[k] !== frozen[key][k]) err(key + "." + k + " 是 " + p[k] + "，凍結的官方數字是 " + frozen[key][k] + "（要改請同一個 commit 改 data/reference/official_values_frozen.json 並說明，章程 B2.2）");
    });
    // 清單沒列碳水＝碳水由凍結數字反推，出處不能改標 estimate 繞過公式檢查
    const carbSrc = (p.field_sources || {}).carb_g;
    if (!("carb_g" in frozen[key]) && !(carbSrc && carbSrc.type === "derived")) {
      err(key + ".carb_g 要維持由凍結的官方數字反推（field_sources.carb_g 標 derived），不能改標其他出處（章程 B2.2）");
    }
  });
}

// 不吃清單只比 key（decisions #40），前提是 id 全資料庫唯一。entries＝[[種類, uid], …]
function checkUniqueIds(entries) {
  const seen = {};
  entries.forEach(([kind, uid]) => {
    if (seen[uid]) err("id「" + uid + "」在" + seen[uid] + "與" + kind + "重複（不吃清單只比 key，id 要全資料庫唯一，decisions #40）");
    else seen[uid] = kind;
  });
}

// 巨量營養素驗算（章程 B5.4）：蛋白質×4＋(碳水−纖維)×4＋纖維×2＋脂肪×9 跟熱量差距
function macroGap(v) {
  if (![v.kcal, v.protein_g, v.carb_g, v.fat_g].every(isNum) || !(v.kcal > 0)) return 0;
  const fiber = isNum(v.fiber_g) ? v.fiber_g : 0;
  const calc = v.protein_g * 4 + (v.carb_g - fiber) * 4 + fiber * 2 + v.fat_g * 9;
  return (calc - v.kcal) / v.kcal;
}

// ---------- 食材 ----------
function checkIngredients(list, refs) {
  const ids = {};
  list.forEach((ing, i) => {
    const w = "ingredients[" + i + "] " + (ing.id || "(沒有 id)");
    if (typeof ing.id !== "string" || !/^[a-z][a-z0-9_]*$/.test(ing.id)) err(w + "：id 要是小寫英文＋底線");
    if (ids[ing.id]) err(w + "：id 重複");
    ids[ing.id] = true;
    if (typeof ing.name !== "string" || ing.name.trim() === "") err(w + "：缺 name");
    if (AXES.indexOf(ing.axis) === -1) { err(w + "：axis 不合法（" + ing.axis + "）"); return; }
    if (TIERS.indexOf(ing.prep_tier) === -1 && ing.axis !== "implicit") err(w + "：prep_tier 不合法");
    ["requires_cooking", "vegan", "lacto_ovo"].forEach((k) => {
      if (ing.axis !== "implicit" && typeof ing[k] !== "boolean") err(w + "：" + k + " 必須是 true/false");
    });
    if (ing.axis !== "implicit") checkAllergenTags(w, ing.allergen_tags, false);
    if (ing.axis !== "implicit") checkDietTags(w, ing);
    if (ing.vegan && !ing.lacto_ovo) err(w + "：全素一定也是蛋奶素（lacto_ovo 要是 true）");
    const src = ing.source;
    if (!src || typeof src.type !== "string") { err(w + "：缺 source"); return; }

    if (ing.axis === "method") {
      if (!Array.isArray(ing.implicit)) err(w + "：烹調法要有 implicit 陣列（章程 B5.6）");
      else ing.implicit.forEach((x) => {
        if (!x || typeof x.ref !== "string" || !isNum(x.g) || x.g < 0 || !isNum(x.veg_add_g) || x.veg_add_g < 0) err(w + "：implicit 每項要有 ref、g、veg_add_g（非負）");
        else if (!list.some((o) => o.id === x.ref && o.axis === "implicit")) err(w + "：implicit 引用的 " + x.ref + " 不是隱含成分");
      });
      if (ing.per_100g !== null) err(w + "：烹調法沒有 per_100g（要是 null）");
      if (src.type !== "assumption" || !src.ref) err(w + "：烹調法的用油量出處是 assumption，要寫依據");
      return;
    }

    // 調味程度（章程 B5.7）：只有每份的鈉，出處是 assumption；只代表鹽等值的鈉，不帶過敏原（decisions #38）
    if (ing.axis === "implicit" && ing.per_serving) {
      if (!isNum(ing.per_serving.sodium_mg) || ing.per_serving.sodium_mg < 0) err(w + "：調味程度要有 per_serving.sodium_mg");
      if (src.type !== "assumption" || !src.ref) err(w + "：調味程度的出處是 assumption，要寫依據");
      if (!Array.isArray(ing.allergen_tags) || ing.allergen_tags.length > 0) err(w + "：隱含調味只代表鈉，allergen_tags 要是 []");
      return;
    }
    if (ing.axis === "implicit" && ing.allergen_tags) checkAllergenTags(w, ing.allergen_tags, false);

    // 有營養值的食材
    if (BASES.indexOf(ing.basis) === -1) err(w + "：basis 不合法（" + ing.basis + "）");
    if (ing.axis === "vegetable" && ing.basis !== "raw") err(w + "：蔬菜一律用生重（章程 B5.3）");
    if (!isNum(ing.serving_g) || !(ing.serving_g > 0)) err(w + "：serving_g 要是正數");
    if (typeof ing.serving_label !== "string" || ing.serving_label === "") err(w + "：缺 serving_label");
    if (!INGREDIENT_SOURCES[src.type]) err(w + "：食材出處只能是 tfda／usda／derived（章程 B2），不存在估算的食材：" + src.type);
    if (!src.ref) err(w + "：source.ref 沒有值");
    if (src.type !== "tfda" && !NOT_IN_TFDA.test(src.note || "")) err(w + "：出處不是 TFDA，source.note 要寫明「TFDA 無此品項」（章程 B2.1）");

    const per = ing.per_100g;
    if (!per || typeof per !== "object") { err(w + "：缺 per_100g"); return; }
    FIELDS.forEach((k) => {
      if (!(k in per)) err(w + "：per_100g 缺 " + k + "（未知要寫 null，不能省略）");
      else if (per[k] !== null && (!isNum(per[k]) || per[k] < 0)) err(w + "：per_100g." + k + " 要是非負數或 null");
    });
    if (!(per.kcal > 0)) err(w + "：熱量必須大於 0（章程 B5.2）");

    // 跟參考資料完全相等（章程 B4）
    let expected = null;
    try { expected = computePer100g(ing, refs); } catch (e) { err(w + "：" + e.message); }
    if (expected) {
      FIELDS.forEach((k) => {
        if (per[k] !== expected[k]) err(w + "：per_100g." + k + " 是 " + per[k] + "，依出處應為 " + expected[k] + "（不手改，跑 tools/build-ingredients.js）");
      });
    }

    // field_sources：填 0 必有說明（章程 B5.1）
    Object.keys(ing.field_sources || {}).forEach((k) => {
      const fsrc = ing.field_sources[k];
      if (FIELDS.indexOf(k) === -1 && k !== "cooked_to_raw") err(w + "：field_sources 有不認得的欄位 " + k);
      if (!fsrc || typeof fsrc.type !== "string" || !fsrc.ref) err(w + "：field_sources." + k + " 要有 type 與 ref");
      if (fsrc && "value" in fsrc && !(fsrc.note && fsrc.note.length > 0)) err(w + "：field_sources." + k + " 填了數值，note 要寫理由");
      if (fsrc && "value" in fsrc) {
        const zp = FT.zeroFillProblem(fsrc.ref, k, refs.tfda[tfdaSampleCode(src)]);
        if (zp) err(w + "：缺值填 0 " + k + "：" + zp + "（章程 B5.1、decisions #107）");
      }
    });

    // 生熟（章程 B5.3）：熟重要有 cooked_to_raw 與公式，公式倍數要跟 cooked_to_raw 一致
    if (ing.basis === "cooked") {
      const m = DERIVED_REF.exec(src.ref || "");
      if (!isNum(ing.cooked_to_raw) || !(ing.cooked_to_raw > 0)) err(w + "：熟重食材要有 cooked_to_raw");
      if (src.type !== "derived" || !m) err(w + "：熟重食材的數值要是 derived 並寫公式（TFDA編號 × 倍數）");
      else if (Number(m[2]) !== ing.cooked_to_raw) err(w + "：公式倍數 " + m[2] + " 跟 cooked_to_raw " + ing.cooked_to_raw + " 不一致");
      const cs = (ing.field_sources || {}).cooked_to_raw;
      if (!cs || ["exchange", "tfda", "derived"].indexOf(cs.type) === -1) err(w + "：cooked_to_raw 要在 field_sources 標出處（代換表或 TFDA）");
    } else if (ing.cooked_to_raw !== null && ing.cooked_to_raw !== undefined) {
      err(w + "：不是熟重，cooked_to_raw 要是 null");
    }

    // 燕麥屬含麩質穀物（章程 B6.2）
    if (/燕麥/.test(ing.name) && !(ing.allergen_tags || []).some((t) => t === "麩質" || t === UNVERIFIED)) err(w + "：燕麥要標麩質（章程 B6.2）");
    const code = tfdaSampleCode(src);
    const sampleText = tfdaSampleText(refs, code);
    if (oatsInSampleProblem(ing.allergen_tags, sampleText)) err(w + "：衛福部樣品 " + code + " 含燕麥或麥片，要標麩質或未確認（章程 B6.2、decisions #101）");
    const gaps = sampleAllergenGaps(ing.allergen_tags, sampleText, code);
    if (gaps.length) warn(w + "：衛福部樣品 " + code + " 的名稱或描述提到「" + gaps.join("、") + "」，標註沒有也沒有未確認（章程 B6.2，請確認）");
    // 芒果是過敏原標示項目（章程 B6.1、decisions #88）
    if (/芒果|檬果/.test(ing.name) && !(ing.allergen_tags || []).some((t) => t === "芒果" || t === UNVERIFIED)) err(w + "：芒果要標芒果或未確認（章程 B6.1）");

    // 複合料理（章程 B6.3）：醬料要標 composite；不含未確認時要有列出成分的 TFDA 樣品
    if (ing.axis === "seasoning") {
      if (typeof ing.composite !== "boolean") err(w + "：醬料要標 composite: true|false");
      if (ing.composite && (ing.allergen_tags || []).indexOf(UNVERIFIED) === -1) {
        const r = src.type === "tfda" ? refs.tfda[src.ref] : null;
        if (!listsCompleteIngredients((r && r["內容物描述"]) || "")) err(w + "：複合料理沒標「未確認」，出處要是內容物描述列有成分的 TFDA 樣品（或包裝/官網成分表）");
      }
    }

    // 巨量營養素驗算（章程 B5.4）
    if (src.type === "tfda" || src.type === "usda") {
      const gap = macroGap(per);
      if (Math.abs(gap) > 0.15 && !/熱量驗算/.test(src.note || "")) {
        err(w + "：熱量驗算差 " + Math.round(gap * 100) + "%（超過 15%），source.note 要寫「熱量驗算」說明原因");
      }
    }
  });
  return ids;
}

// ---------- 現成品項（章程 B4、B3） ----------
const PRODUCT_SOURCES = ["label", "official_web", "derived", "estimate", "label_unsourced"];
const PRODUCT_FIELDS = ["kcal", "protein_g", "carb_g", "fat_g", "fiber_g", "sat_fat_g", "sodium_mg"];

function fieldSource(p, k) {
  return (p.field_sources && p.field_sources[k]) || p.source || {};
}

function checkProducts(products, frozen, refs) {
  const ids = {};
  const labelUnsourced = [];
  products.forEach(({ file, p }) => {
    const w = file + " " + (p.id || "(沒有 id)");
    if (typeof p.id !== "string" || p.id === "") err(w + "：缺 id");
    if (ids[file + p.id]) err(w + "：id 重複");
    ids[file + p.id] = true;
    if (typeof p.name !== "string" || p.name.trim() === "") err(w + "：缺 name");
    if (["convenience", "delivery"].indexOf(p.channel) === -1) err(w + "：channel 不合法");
    if (["main", "side", "snack", "drink"].indexOf(p.role) === -1) err(w + "：role 不合法");
    if (!Array.isArray(p.valid_slots) || p.valid_slots.length === 0 || p.valid_slots.some((s) => SLOTS.indexOf(s) === -1)) err(w + "：valid_slots 不合法");
    if (p.role === "drink" && p.contains_drink) err(w + "：飲料不能再標 contains_drink");
    ["contains_drink", "is_treat", "vegan", "lacto_ovo"].forEach((k) => { if (typeof p[k] !== "boolean") err(w + "：" + k + " 必須是 true/false"); });
    if (p.vegan && !p.lacto_ovo) err(w + "：全素一定也是蛋奶素");
    if (!isNum(p.kcal) || p.kcal < 0) err(w + "：kcal 要是非負數（章程 B5.2）");
    if (["stated", "midpoint"].indexOf(p.kcal_basis) === -1) err(w + "：kcal_basis 要是 stated 或 midpoint");
    if (p.kcal_range !== null) {
      const r = p.kcal_range;
      if (!Array.isArray(r) || r.length !== 2 || !r.every(isNum) || !(r[0] <= p.kcal && p.kcal <= r[1])) err(w + "：kcal_range 要是 [低, 高] 且 低 ≤ kcal ≤ 高");
    } else if (p.kcal_basis === "midpoint") {
      err(w + "：由區間取中點的品項要有 kcal_range");
    }
    PRODUCT_FIELDS.forEach((k) => {
      if (!(k in p)) err(w + "：缺 " + k + "（未知寫 null，不能省略）");
      else if (p[k] !== null && (!isNum(p[k]) || p[k] < 0)) err(w + "：" + k + " 要是非負數或 null");
    });
    checkAllergenTags(w, p.allergen_tags, true);
    checkDietTags(w, p);
    // note 只放「資料來源；內容描述」，AI 的數字不是出處、不寫進 note（章程 B2.3、B2.6）
    if (/AI|Claude|GPT|Gemini/i.test(p.note || "")) err(w + "：note 不得出現 AI 回答的內容，出處寫在 source／field_sources（章程 B2.6）");
    // 複合料理（章程 B6.3）：要標 composite；沒標「未確認」時要有官方成分表出處
    if (typeof p.composite !== "boolean") err(w + "：要標 composite: true|false（章程 B6.3）");
    if (p.composite && Array.isArray(p.allergen_tags) && p.allergen_tags.indexOf(UNVERIFIED) === -1 &&
        ["label", "official_web"].indexOf((p.source || {}).type) === -1) {
      err(w + "：複合料理沒標「未確認」，要有包裝或官網成分表的出處");
    }
    // 燕麥屬含麩質穀物（章程 B6.2）
    if (/燕麥/.test(p.name) && !(p.allergen_tags || []).some((t) => t === "麩質" || t === UNVERIFIED)) err(w + "：燕麥要標麩質（章程 B6.2）");
    // 芒果是過敏原標示項目（章程 B6.1、decisions #88）
    if (/芒果|檬果/.test(p.name) && !(p.allergen_tags || []).some((t) => t === "芒果" || t === UNVERIFIED)) err(w + "：芒果要標芒果或未確認（章程 B6.1）");
    if (!p.source || PRODUCT_SOURCES.indexOf(p.source.type) === -1) err(w + "：source.type 不合法（" + (p.source && p.source.type) + "）");
    Object.keys(p.field_sources || {}).forEach((k) => {
      const f = p.field_sources[k];
      if (PRODUCT_FIELDS.indexOf(k) === -1) err(w + "：field_sources 有不認得的欄位 " + k);
      if (!f || PRODUCT_SOURCES.indexOf(f.type) === -1) err(w + "：field_sources." + k + " 的 type 不合法");
    });
    PRODUCT_FIELDS.forEach((k) => {
      const t = fieldSource(p, k).type;
      if (p[k] !== null && t === "label_unsourced") labelUnsourced.push(p.id + "." + k);
      if ((t === "label" || t === "official_web") && !fieldSource(p, k).ref) err(w + "：" + k + " 的出處是 " + t + "，ref 要寫照片檔名或網址");
    });
    // derived 只有三種寫法（PRD 12.1 出處類別靠它機械歸類，decisions #98）：整筆由 TFDA 換算（source.ref「編號 × 倍數」）、
    // 這種品項 TFDA 缺值的欄位用 value 填 0（章程 B5.1）、碳水由熱量反推（章程 B2.2）
    const tfdaRow = (p.source || {}).type === "derived" && DERIVED_REF.test(p.source.ref || "");
    PRODUCT_FIELDS.forEach((k) => {
      const f = fieldSource(p, k);
      if (f.type !== "derived") return;
      const ok = (f === p.source && tfdaRow) ||
        (tfdaRow && p.field_sources && p.field_sources[k] === f && f.value === 0) ||
        (k === "carb_g" && /熱量 − 蛋白質×4 − 脂肪×9/.test(f.ref || ""));
      if (!ok) err(w + "：" + k + " 標 derived，但不是「TFDA 編號 × 倍數」、TFDA 缺值填 0 或熱量反推碳水（decisions #98）");
    });
    // 由 TFDA 換算的（derived「TFDA編號 × 倍數」）：derived 的欄位要跟參考資料完全相等
    if ((p.source || {}).type === "derived" && DERIVED_REF.test(p.source.ref || "")) {
      let expected = null;
      try { expected = computePer100g({ id: p.id, source: p.source, field_sources: p.field_sources || {} }, refs); } catch (e) { err(w + "：" + e.message); }
      if (expected) PRODUCT_FIELDS.forEach((k) => {
        if (fieldSource(p, k).type === "derived" && p[k] !== expected[k]) err(w + "：" + k + " 是 " + p[k] + "，依 " + p.source.ref + " 應為 " + expected[k]);
      });
    }
    // 巨量營養素驗算（章程 B5.4）：熱量與三大營養素都出自包裝標示或官網時才驗（有欄位是估算反推的就不驗）
    if (["kcal", "protein_g", "carb_g", "fat_g"].every((k) => ["label", "official_web"].indexOf(fieldSource(p, k).type) !== -1)) {
      const gap = macroGap(p);
      if (Math.abs(gap) > 0.15 && !/熱量驗算/.test((p.note || "") + ((p.source || {}).note || ""))) {
        err(w + "：熱量驗算差 " + Math.round(gap * 100) + "%（超過 15%），note 要寫「熱量驗算」說明原因（章程 B5.4）");
      }
    }
    // 用官方熱量/蛋白質/脂肪反推的碳水要合公式（章程 B2.2）
    const carbSrc = (p.field_sources || {}).carb_g;
    if (carbSrc && carbSrc.type === "derived" && /熱量 − 蛋白質×4 − 脂肪×9/.test(carbSrc.ref || "") &&
        [p.kcal, p.protein_g, p.fat_g, p.carb_g].every(isNum) &&
        Math.abs(p.carb_g - (p.kcal - p.protein_g * 4 - p.fat_g * 9) / 4) > 0.05 + 1e-9) {
      err(w + "：碳水 " + p.carb_g + " 跟反推公式不符（應為 " + Math.round((p.kcal - p.protein_g * 4 - p.fat_g * 9) / 4 * 10) / 10 + "，章程 B2.2）");
    }
    // 外食的鈉與飽和脂肪沒有出處就是 null（章程 B5.8）
    ["sat_fat_g", "sodium_mg"].forEach((k) => {
      if (p[k] !== null && ["estimate", "label_unsourced"].indexOf(fieldSource(p, k).type) !== -1) err(w + "：" + k + " 沒有出處就寫 null，不填沒根據的數字（章程 B5.8）");
    });
  });
  // label_unsourced 只准減少不准新增（章程 B3）
  const allowed = {};
  frozen.forEach((f) => { allowed[f] = true; });
  labelUnsourced.forEach((f) => { if (!allowed[f]) err("「" + f + "」是 label_unsourced，但不在凍結清單 data/reference/label_unsourced_frozen.json（只准減少不准新增）"); });
  // 查證優先順序（章程 B12 警告）
  const nEstimate = products.reduce((n, { p }) => n + PRODUCT_FIELDS.filter((k) => p[k] !== null && fieldSource(p, k).type === "estimate").length, 0);
  warn("現成品項：label_unsourced " + labelUnsourced.length + " 欄、estimate " + nEstimate + " 欄待查證（清單：node tools/check-data.js --list）");
  if (process.argv.indexOf("--list") !== -1) {
    products.forEach(({ p }) => PRODUCT_FIELDS.forEach((k) => {
      const t = fieldSource(p, k).type;
      if (p[k] !== null && (t === "estimate" || t === "label_unsourced")) console.log("    " + t + "\t" + p.id + "." + k + "\t" + p.name);
    }));
  }
}

// ---------- 餐型骨架（章程 B7） ----------
function checkArchetypes(archetypes, ingredients) {
  const byId = {};
  ingredients.forEach((it) => { byId[it.id] = it; });
  const referenced = {};
  const AXIS_OF = { protein: "protein", staple: "staple", vegetable: "vegetable", seasoning: "seasoning" };
  archetypes.forEach((a) => {
    const w = "餐型 " + a.id;
    if (!Array.isArray(a.valid_slots) || a.valid_slots.length === 0 || a.valid_slots.some((s) => SLOTS.indexOf(s) === -1)) err(w + "：valid_slots 不合法");
    Object.keys(AXIS_OF).forEach((axis) => {
      ((a[axis] && a[axis].allow) || []).forEach((id) => {
        referenced[id] = true;
        if (!byId[id]) err(w + "：" + axis + " 的 allow 引用不存在的食材 " + id);
        else if (byId[id].axis !== AXIS_OF[axis]) err(w + "：" + axis + " 的 allow 引用了 axis=" + byId[id].axis + " 的 " + id);
      });
    });
    if (typeof a.seasoned !== "boolean") err(w + "：要標 seasoned: true|false（章程 B7.2）");
    if (a.not_included !== undefined && !(Array.isArray(a.not_included) && a.not_included.length > 0 && a.not_included.every((x) => typeof x === "string" && x.trim())))
      err(w + "：not_included 要是非空字串陣列（章程 B7.5）");
    if (!Array.isArray(a.methods) || a.methods.length === 0) err(w + "：至少要有一個烹調法");
    (a.methods || []).forEach((id) => {
      referenced[id] = true;
      if (!byId[id] || byId[id].axis !== "method") err(w + "：methods 引用的 " + id + " 不是烹調法");
    });
  });
  ingredients.forEach((it) => {
    if (it.axis !== "implicit" && !referenced[it.id]) warn("食材 " + it.id + "（" + it.name + "）沒被任何餐型骨架引用");
  });
}

// 工具自我檢查：規則本身要擋得住刻意改壞的資料（−1b 驗收審核第 4 節）
function checkToolRules(refs) {
  const throws = (fn) => { try { fn(); return false; } catch (e) { return true; } };
  const chicken = { id: "selftest", source: { type: "tfda", ref: "I04024" } };
  const withOverride = (k, value) => Object.assign({}, chicken, { field_sources: { [k]: { type: "derived", value: value, note: "x" } } });
  // T1–T3：field_sources.value 只准用在參考資料是 null 的欄位，且只能填 0（章程 B5.1）
  if (!throws(() => computePer100g(withOverride("fat_g", 1.0), refs))) err("工具自我檢查：field_sources.value 覆寫了 TFDA 有值的欄位（脂肪）卻沒報錯");
  if (!throws(() => computePer100g(withOverride("fiber_g", 5), refs))) err("工具自我檢查：TFDA 是 null 的欄位用 value 填了非 0 的數字卻沒報錯");
  if (throws(() => computePer100g(withOverride("fiber_g", 0), refs))) err("工具自我檢查：TFDA 是 null 的欄位填 0 應該允許");
  // 跑一次檢查函式，回傳有沒有出現符合 pattern 的錯誤；自我檢查產生的訊息不算資料問題
  const reports = (pattern, fn) => {
    const before = errors.length, beforeWarn = warnings.length;
    try { fn(); } catch (e) { errors.push(String(e.message)); }
    const found = errors.slice(before).some((m) => pattern.test(m));
    errors.length = before; warnings.length = beforeWarn;
    return found;
  };
  // 寫死的測試品項（不綁真實資料，品項下架不會讓自我檢查誤報）
  const PRODUCT = {
    id: "selftest_p", name: "測試豆漿", channel: "convenience", vendor: null, category: "飲品", role: "drink",
    valid_slots: ["breakfast"], contains_drink: false, is_treat: false, kcal: 160, kcal_basis: "stated", kcal_range: null,
    protein_g: 15, carb_g: 14, fat_g: 7.6, fiber_g: 10.2, sat_fat_g: null, sodium_mg: null,
    allergen_tags: ["黃豆"], composite: false, vegan: true, lacto_ovo: true,
    source: { type: "label", ref: "selftest" }, field_sources: {}, verified_at: null, note: "自我檢查",
  };
  const product = (patch) => () => checkProducts([{ file: "selftest", p: Object.assign({}, PRODUCT, patch) }], [], refs);
  // T8：label／official_web 出處的現成品項也要做巨量營養素驗算（章程 B5.4）
  if (!reports(/熱量驗算/, product({ protein_g: 50 }))) err("工具自我檢查：包裝標示出處的品項蛋白質抄錯（熱量差很多）卻沒報錯");
  if (reports(/熱量驗算/, product({}))) err("工具自我檢查：包裝標示出處、數字正確的品項不該報熱量驗算");
  // T4：反推的碳水要合公式（章程 B2.2）
  const derivedCarb = { source: { type: "estimate", ref: "selftest" }, kcal: 343, protein_g: 18, fat_g: 16,
    field_sources: { carb_g: { type: "derived", ref: "（熱量 − 蛋白質×4 − 脂肪×9）÷ 4" } } };
  if (!reports(/反推公式/, product(Object.assign({}, derivedCarb, { carb_g: 80 })))) err("工具自我檢查：反推的碳水跟公式不符卻沒報錯");
  if (reports(/反推公式/, product(Object.assign({}, derivedCarb, { carb_g: 31.8 })))) err("工具自我檢查：反推碳水四捨五入到 0.05 以內不該報錯");
  // decisions #98：derived 只有三種寫法
  const tfdaDrink = { source: { type: "derived", ref: "O0700101 × 4.5" }, kcal: 10.7, protein_g: 0.9, carb_g: 1.1, fat_g: 0.3, fiber_g: 0, sat_fat_g: 0.1, sodium_mg: 7.6, allergen_tags: [] };
  if (!reports(/decisions #98/, product({ field_sources: { fiber_g: { type: "derived", ref: "咖啡飲品" } } }))) err("工具自我檢查：包裝標示品項的纖維標 derived 但沒有公式卻沒報錯");
  if (!reports(/decisions #98/, product({ source: { type: "derived", ref: "看起來差不多" } }))) err("工具自我檢查：整筆 derived 但 ref 不是公式卻沒報錯");
  if (!reports(/decisions #98/, product(Object.assign({}, tfdaDrink, { field_sources: { fiber_g: { type: "derived", value: 1, ref: "x" } } })))) err("工具自我檢查：TFDA 換算品項用 value 填了非 0 卻沒被 #98 擋下");
  if (reports(/decisions #98/, product(Object.assign({}, tfdaDrink, { field_sources: { fiber_g: { type: "derived", value: 0, ref: "咖啡飲品" } } })))) err("工具自我檢查：TFDA 換算品項缺值填 0 不該被 #98 擋下");
  if (reports(/decisions #98/, product(Object.assign({}, derivedCarb, { carb_g: 31.8 })))) err("工具自我檢查：熱量反推碳水不該被 #98 擋下");
  // B2.6：note 不得出現 AI 回答（不分大小寫、各家名稱）
  ["Google Ai 估算：鈉380mg", "ChatGPT 估算", "Claude依網路資料整理", "Gemini 回覆"].forEach((note) => {
    if (!reports(/B2\.6/, product({ note: note }))) err("工具自我檢查：note 寫「" + note + "」卻沒報錯");
  });
  // B6.1：名稱含芒果要標芒果或未確認
  if (!reports(/芒果要標芒果/, product({ name: "芒果優格", allergen_tags: ["乳製品"], vegan: false, lacto_ovo: true }))) err("工具自我檢查：芒果優格沒標芒果卻沒報錯");
  if (reports(/芒果要標芒果/, product({ name: "芒果優格", allergen_tags: ["乳製品", "芒果"], vegan: false, lacto_ovo: true }))) err("工具自我檢查：芒果優格標了芒果不該報錯");
  // B6.8：過敏原詞彙沒有畜禽肉，名稱含肉類字眼又標素要有「素食依據：」
  if (!reports(/素食依據/, product({ name: "排骨便當", allergen_tags: [], vegan: false, lacto_ovo: true }))) err("工具自我檢查：排骨便當標蛋奶素卻沒報錯");
  if (reports(/素食依據/, product({ name: "植物肉便當", allergen_tags: [], vegan: false, lacto_ovo: true, note: "素食依據：素食系列" }))) err("工具自我檢查：寫了素食依據的品項不該報錯");
  // B6.3：成分清單裡出現「等」就不算列完，不論在描述的哪裡（TFDA 常見「樣品狀態:…(A,B等); 前處理描述:…」）
  if (listsCompleteIngredients("樣品狀態:醬油(水,脫水性植物蛋白質,鹽等); 前處理描述:混合均勻")) err("工具自我檢查：成分清單以「等」結尾（不在描述最後）卻被當成列完");
  if (listsCompleteIngredients("前處理描述:混合均勻(醬油,味醂,糖等)")) err("工具自我檢查：描述最後的「…等)」卻被當成列完");
  if (!listsCompleteIngredients("前處理描述:混合均勻(醬油,味醂,糖)")) err("工具自我檢查：完整列出成分的描述卻不被接受");
  // T14、3.8：官方數字凍結，反推碳水不能改標 estimate 繞過
  const frozenKey = { "selftest.x": { kcal: 343, protein_g: 18, fat_g: 16 } };
  const frozenItem = (patch) => ({ "selftest.x": Object.assign({}, PRODUCT, derivedCarb, { carb_g: 31.8 }, patch) });
  if (!reports(/凍結/, () => checkOfficialFrozen(frozenKey, frozenItem({ protein_g: 10 })))) err("工具自我檢查：凍結的官方蛋白質被改掉卻沒報錯");
  if (!reports(/凍結/, () => checkOfficialFrozen(frozenKey, frozenItem({ field_sources: { carb_g: { type: "estimate", ref: "x" } } })))) err("工具自我檢查：凍結品項的反推碳水改標 estimate 卻沒報錯");
  if (reports(/凍結/, () => checkOfficialFrozen(frozenKey, frozenItem({})))) err("工具自我檢查：凍結品項沒被改卻報錯");
  // decisions #101：樣品描述含麥片要標麩質或未確認；關鍵字警告與大豆油例外
  const fiveGrain = "五穀米 樣品狀態:生(糙米,薏仁,蕎麥,小米,黑糯米,麥片,紅扁豆,紅薏仁等)";
  if (!oatsInSampleProblem([], fiveGrain)) err("工具自我檢查：樣品含麥片、標註是 [] 卻沒報錯");
  if (oatsInSampleProblem(["麩質", "未確認"], fiveGrain)) err("工具自我檢查：樣品含麥片、已標麩質卻報錯");
  if (oatsInSampleProblem([], "糙稉米平均值 樣品狀態:生")) err("工具自我檢查：沒有麥片的樣品卻報錯");
  if (sampleAllergenGaps([], "大豆油 前處理描述:混合均勻(100%大豆沙拉油)", "M1100101").length) err("工具自我檢查：大豆油（decisions #89 例外）卻被警告");
  if (sampleAllergenGaps([], "大豆油 前處理描述:混合均勻(100%大豆沙拉油)", "X0000000").join() !== "黃豆") err("工具自我檢查：不在例外清單的大豆樣品沒被警告");
  if (sampleAllergenGaps([], "豆漿 樣品狀態:大豆分離蛋白質", "X").indexOf("蛋") !== -1) err("工具自我檢查：「分離蛋白質」被當成蛋");
  // 切片 3 抽查 T1：分層品項的嚴格版，未確認不能代替；誤報的字眼不算
  if (sampleAllergenMissing(["未確認"], "廣式蘿蔔糕 樣品狀態:冷藏(米,蘿蔔,豬肉,蝦米等)", "X").join() !== "甲殼類") err("工具自我檢查：蘿蔔糕含蝦米只標未確認卻沒報");
  if (sampleAllergenMissing(["未確認"], "牛肉乾 (牛肉,砂糖,醬油等)", "X").join() !== "麩質,黃豆") err("工具自我檢查：醬油沒算成麩質、黃豆");
  if (sampleAllergenMissing(["未確認"], "熱狗 (豬肉,黃豆蛋白等) 人造奶油 蛋餅皮", "X").join() !== "黃豆") err("工具自我檢查：黃豆蛋白、人造奶油、蛋餅皮誤報成蛋或乳製品");
  if (sampleAllergenMissing([], "烤酥油 (純大豆提煉)", "M9900101").length) err("工具自我檢查：烤酥油（高度提煉大豆，同 decisions #89）卻被報");
  // 代換表參考資料：#35 引用的數字、標註跟品名一一對應
  {
    const ex = loadExchange();
    const clone = (o) => JSON.parse(JSON.stringify(o));
    const t1 = clone(ex.table); t1.items.find((r) => r.row_text === "飯").edible_g = 45;
    if (!reports(/decisions #35/, () => checkExchangeReference(t1, ex.tags))) err("工具自我檢查：代換表「飯」被改成 45g 卻沒報錯（decisions #35）");
    const g1 = clone(ex.tags); g1.items.pop();
    if (!reports(/代換表標註缺/, () => checkExchangeReference(ex.table, g1))) err("工具自我檢查：代換表標註少一筆卻沒報錯");
    if (reports(/./, () => checkExchangeReference(ex.table, ex.tags))) err("工具自我檢查：代換表參考資料沒被改卻報錯");
  }
  if (reports(/素食依據/, product({ name: "牛蒡絲", allergen_tags: [], vegan: true, lacto_ovo: true }))) err("工具自我檢查：牛蒡標全素卻被當成肉類");
  selfTestFoodTree(refs, reports);
  // T13：id 全資料庫唯一
  if (!reports(/重複/, () => checkUniqueIds([["食材", "egg"], ["超商", "egg"]]))) err("工具自我檢查：食材與超商 id 重複卻沒報錯");
  if (reports(/重複/, () => checkUniqueIds([["食材", "egg"], ["台式", "tw_egg"]]))) err("工具自我檢查：不同 id 卻報重複");
}

function main() {
  const refs = loadReferences();
  console.log("[工具自我檢查]");
  checkToolRules(refs);
  const ingredients = readJson("ingredients.json");
  console.log("[食材]");
  checkIngredients(ingredients, refs);
  // 食材 id 凍結（章程 B4）：凍結清單裡的 id 都要還在（改名＝舊 id 消失）
  const existing = {};
  ingredients.forEach((it) => { existing[it.id] = true; });
  readJson("reference/ingredient_ids_frozen.json").ids.forEach((id) => {
    if (!existing[id]) err("食材 id「" + id + "」已凍結，不得改名；要下架請同一個 commit 從 data/reference/ingredient_ids_frozen.json 刪掉並說明（章程 B4、B9）");
  });
  console.log("[餐型骨架]");
  checkArchetypes(readJson("dish_archetypes.json"), ingredients);
  console.log("[現成品項]");
  // 二手官方數字凍結（章程 B2.2）：要改必須同一個 commit 改清單
  const productByKey = {};
  ["convenience_items", "taiwan_items"].forEach((f) => readJson(f + ".json").forEach((p) => { productByKey[f + "." + p.id] = p; }));
  checkOfficialFrozen(readJson("reference/official_values_frozen.json").values, productByKey);
  checkProducts(
    readJson("convenience_items.json").map((p) => ({ file: "convenience_items", p: p }))
      .concat(readJson("taiwan_items.json").map((p) => ({ file: "taiwan_items", p: p }))),
    readJson("reference/label_unsourced_frozen.json").fields, refs
  );

  console.log("[代換表參考資料]");
  const exchange = loadExchange();
  checkExchangeReference(exchange.table, exchange.tags);
  console.log("[代換表分層品項]");
  const treeCtx = FT.loadFoodTreeContext(refs, readJson);
  const treeText = fs.existsSync(path.join(ROOT, "data", "food_tree.json")) ? fs.readFileSync(path.join(ROOT, "data", "food_tree.json"), "utf8") : "";
  const catalogUids = readJson("convenience_items.json").map((p) => p.id).concat(readJson("taiwan_items.json").map((p) => "tw_" + p.id));
  checkFoodTree(treeCtx, treeText, readJson("reference/food_tree_ids_frozen.json"), catalogUids);

  // 食材 id 跟現成品項 uid（台式加 tw_）不得重複
  checkUniqueIds(ingredients.map((it) => ["食材", it.id])
    .concat(readJson("convenience_items.json").map((p) => ["超商", p.id]))
    .concat(readJson("taiwan_items.json").map((p) => ["台式", "tw_" + p.id])));

  warnings.forEach((m) => console.log("  ⚠ " + m));
  errors.forEach((m) => console.log("  ✗ " + m));
  console.log("\n" + (errors.length === 0 ? "資料檢查通過" : errors.length + " 個錯誤") + (warnings.length ? "，" + warnings.length + " 個警告" : ""));
  process.exit(errors.length === 0 ? 0 : 1);
}

main();
