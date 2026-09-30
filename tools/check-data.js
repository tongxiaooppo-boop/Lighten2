// 輕盈計畫 — 食物資料檢查（章程 B12）
// 用法：在 repo 根目錄執行 `node tools/check-data.js`；有錯誤 exit 1，警告只列出。pre-commit hook 會跑。
// 營養值跟參考資料「完全相等」的算法跟 build-ingredients.js 共用 tools/lib/ingredient-values.js。

"use strict";

const fs = require("fs");
const path = require("path");
const { loadReferences, computePer100g, FIELDS, DERIVED_REF } = require("./lib/ingredient-values");

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
const NOT_MEAT_WORDS = /雞蛋|牛奶|牛乳|植物肉|素肉|果肉|肉桂/g;

// TFDA 內容物描述有沒有完整列出成分（章程 B6.3）：括號裡用逗號列出成分，而且任何成分清單都沒有「等」
// （TFDA 常見「樣品狀態:…(A,B等); 前處理描述:…」，清單以「等」結尾但整段描述不是）
function listsCompleteIngredients(desc) {
  return /[（(][^）)]*[,，][^）)]*[）)]/.test(desc) && !/等\s*([）)]|$)/.test(desc);
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
