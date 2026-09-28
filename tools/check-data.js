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
    if (ing.vegan && !ing.lacto_ovo) err(w + "：全素一定也是蛋奶素（lacto_ovo 要是 true）");
    const src = ing.source;
    if (!src || typeof src.type !== "string") { err(w + "：缺 source"); return; }

    if (ing.axis === "method") {
      if (!Array.isArray(ing.implicit)) err(w + "：烹調法要有 implicit 陣列（章程 B5.6）");
      if (ing.per_100g !== null) err(w + "：烹調法沒有 per_100g（要是 null）");
      return;
    }

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

    // 複合料理（章程 B6.3）：醬料要標 composite；不含未確認時要有列出成分的 TFDA 樣品
    if (ing.axis === "seasoning") {
      if (typeof ing.composite !== "boolean") err(w + "：醬料要標 composite: true|false");
      if (ing.composite && (ing.allergen_tags || []).indexOf(UNVERIFIED) === -1) {
        const r = src.type === "tfda" ? refs.tfda[src.ref] : null;
        const listsIngredients = r && /[（(][^）)]*[,，][^）)]*[）)]/.test(r["內容物描述"] || "");
        if (!listsIngredients) err(w + "：複合料理沒標「未確認」，出處要是內容物描述列有成分的 TFDA 樣品（或包裝/官網成分表）");
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

function checkProducts(products, frozen) {
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

function main() {
  const refs = loadReferences();
  const ingredients = readJson("ingredients.json");
  console.log("[食材]");
  checkIngredients(ingredients, refs);
  console.log("[餐型骨架]");
  checkArchetypes(readJson("dish_archetypes.json"), ingredients);
  console.log("[現成品項]");
  checkProducts(
    readJson("convenience_items.json").map((p) => ({ file: "convenience_items", p: p }))
      .concat(readJson("taiwan_items.json").map((p) => ({ file: "taiwan_items", p: p }))),
    readJson("reference/label_unsourced_frozen.json").fields
  );

  warnings.forEach((m) => console.log("  ⚠ " + m));
  errors.forEach((m) => console.log("  ✗ " + m));
  console.log("\n" + (errors.length === 0 ? "資料檢查通過" : errors.length + " 個錯誤") + (warnings.length ? "，" + warnings.length + " 個警告" : ""));
  process.exit(errors.length === 0 ? 0 : 1);
}

main();
