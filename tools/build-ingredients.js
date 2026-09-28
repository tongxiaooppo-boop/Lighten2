// 輕盈計畫 — 由參考資料產生食材的營養值（章程 B4、B10、B11）
//
// 用法：node tools/build-ingredients.js           依 source 重算 data/ingredients.json 每一筆的 per_100g 並寫回
//       node tools/build-ingredients.js --dry     只列出會變動的數值，不寫檔
//
// 食材的 per_100g 不手改：要改就改 source.ref／field_sources，再跑這支。TFDA 改版時換掉參考檔後重跑，
// 列出的差異逐項確認後提交（commit 訊息 data(tfda): 升級到 <版本>）。算法在 tools/lib/ingredient-values.js，
// check-data.js 用同一份算法驗證資料跟參考資料完全相等。

"use strict";

const fs = require("fs");
const path = require("path");
const { loadReferences, computePer100g, FIELDS } = require("./lib/ingredient-values");

const FILE = path.join(__dirname, "..", "data", "ingredients.json");
const DRY = process.argv.indexOf("--dry") !== -1;

const list = JSON.parse(fs.readFileSync(FILE, "utf8"));
const refs = loadReferences();
let changes = 0;

list.forEach((ing) => {
  const next = computePer100g(ing, refs);
  if (next === null) return;
  const prev = ing.per_100g || {};
  const diffs = FIELDS.filter((k) => prev[k] !== next[k]).map((k) => k + " " + prev[k] + " → " + next[k]);
  if (diffs.length > 0) {
    changes++;
    console.log(ing.id + "（" + ing.name + "，" + ing.source.type + " " + ing.source.ref + "）：" + diffs.join("、"));
  }
  ing.per_100g = {};
  FIELDS.forEach((k) => { ing.per_100g[k] = next[k]; });
});

if (!DRY) {
  fs.writeFileSync(FILE, "[\n" + list.map((o) => "  " + JSON.stringify(o)).join(",\n") + "\n]\n");
}
console.log((DRY ? "（未寫檔）" : "已寫入 data/ingredients.json，") + changes + " 筆食材的數值有變動");
