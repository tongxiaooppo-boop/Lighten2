// 食材營養值的唯一算法（章程 B4）：build-ingredients.js 用它寫入 data/ingredients.json，check-data.js 用它驗證「完全相等」。
//
// 出處（source）決定 per_100g 怎麼來：
//   tfda     ref＝TFDA 整合編號，取 data/reference/tfda-2025-update1.json 的欄位
//   usda     ref＝FDC ID，取 data/reference/usda-selected.json
//   derived  ref＝「<TFDA 編號> × <倍數>」（例：熟重＝生米 × cooked_to_raw）
// TFDA 某欄是 null、但實際接近 0 的（動物性食材的纖維、蔬菜的飽和脂肪、油的鈉），在 field_sources 標
// { type: "derived", value: 0, note: 理由 }（章程 B5.1）。其他 null 照實保留。
// value 只能補參考資料的 null、只能是 0，否則報錯（−1b 驗收審核 T1–T3：之前可以覆寫任何欄位）。
// 數值一律四捨五入到小數 1 位。

"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..", "..");
const FIELDS = ["kcal", "protein_g", "carb_g", "fat_g", "fiber_g", "sat_fat_g", "sodium_mg"];
// TFDA 欄位名（熱量取「熱量(kcal)」，不取修正熱量，章程 B2.4；碳水取總碳水化合物）
const TFDA_COLUMNS = {
  kcal: "熱量(kcal)", protein_g: "粗蛋白(g)", carb_g: "總碳水化合物(g)", fat_g: "粗脂肪(g)",
  fiber_g: "膳食纖維(g)", sat_fat_g: "飽和脂肪(g)", sodium_mg: "鈉(mg)",
};
const DERIVED_REF = /^([A-Z0-9]+) × ([0-9.]+)$/;

function round1(v) {
  return Math.round(v * 10) / 10;
}

function loadReferences() {
  const tfda = {};
  JSON.parse(fs.readFileSync(path.join(ROOT, "data", "reference", "tfda-2025-update1.json"), "utf8"))
    .forEach((r) => { tfda[r["整合編號"]] = r; });
  const usda = {};
  JSON.parse(fs.readFileSync(path.join(ROOT, "data", "reference", "usda-selected.json"), "utf8"))
    .foods.forEach((f) => { usda[f.fdc_id] = f; });
  return { tfda: tfda, usda: usda };
}

function fromTfda(refs, code) {
  const r = refs.tfda[code];
  if (!r) throw new Error("TFDA 找不到編號 " + code);
  const out = {};
  FIELDS.forEach((k) => { const v = r[TFDA_COLUMNS[k]]; out[k] = v == null ? null : v; });
  return out;
}

// 回傳這個食材依出處算出來的 per_100g；烹調法、隱含成分（沒有 per_100g）回傳 null。
function computePer100g(ing, refs) {
  const src = ing.source || {};
  let raw;
  if (src.type === "tfda") {
    raw = fromTfda(refs, src.ref);
  } else if (src.type === "usda") {
    const f = refs.usda[src.ref];
    if (!f) throw new Error("USDA 參考資料找不到 FDC " + src.ref);
    raw = Object.assign({}, f.per_100g);
  } else if (src.type === "derived") {
    const m = DERIVED_REF.exec(src.ref || "");
    if (!m) throw new Error(ing.id + " 的 derived 出處要寫成「TFDA編號 × 倍數」：" + src.ref);
    const base = fromTfda(refs, m[1]);
    const factor = Number(m[2]);
    raw = {};
    FIELDS.forEach((k) => { raw[k] = base[k] == null ? null : base[k] * factor; });
  } else {
    return null;
  }
  const fs_ = ing.field_sources || {};
  const out = {};
  FIELDS.forEach((k) => {
    const override = fs_[k];
    if (override && Object.prototype.hasOwnProperty.call(override, "value")) {
      // 只准補參考資料的 null，而且只能填 0（章程 B5.1）；不能拿來改掉參考資料有的數字
      if (raw[k] != null) throw new Error(k + " 參考資料有值（" + round1(raw[k]) + "），field_sources.value 不能覆寫");
      if (override.value !== 0) throw new Error(k + " 參考資料是 null，field_sources.value 只能填 0（目前 " + override.value + "）");
      out[k] = 0;
    } else {
      out[k] = raw[k] == null ? null : round1(raw[k]);
    }
  });
  return out;
}

module.exports = { FIELDS, loadReferences, computePer100g, round1, DERIVED_REF };
