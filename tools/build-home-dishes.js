// 輕盈計畫 — 由配方與調料選樣表產生家常菜估算資料 data/home_dishes.json（章程 B4「家常菜估算」、decisions #151）
//
// 用法：node tools/build-home-dishes.js            重新產生並寫回 data/home_dishes.json
//       node tools/build-home-dishes.js --dry      只列出有變動的菜，不寫檔
//       node tools/build-home-dishes.js --report   印出每道菜每 100g、類別平均與跟 NTU 的差
//
// data/home_dishes.json 不手改：改 data/reference/home_dish_recipes.json（配方）或 home_dish_seasonings.json（調料）再跑這支。
// 算法在 tools/lib/home-dish-values.js，check-data.js 用同一份重算比對。

"use strict";

const fs = require("fs");
const path = require("path");
const L = require("./lib/home-dish-values");

const ROOT = path.join(__dirname, "..");
const FILE = path.join(ROOT, "data", "home_dishes.json");
const readJson = (f) => JSON.parse(fs.readFileSync(path.join(ROOT, "data", f), "utf8"));
const args = process.argv.slice(2);

const ctx = L.loadHomeDishContext(readJson);
const built = L.buildHomeDishes(ctx);
if (built.problems.length) {
  built.problems.forEach((p) => console.error("✗ " + p));
  process.exit(1);
}
built.warnings.forEach((w) => console.log("⚠ " + w));
const text = L.stringifyHomeDishes(built.data);

if (args.indexOf("--report") !== -1) {
  built.data.dishes.forEach((d) => {
    const p = d.per_100g;
    console.log((d.kind === "soup" ? "湯  " : d.class.padEnd(5)) + d.name + "：" + [p.kcal, p.protein_g, p.carb_g, p.fat_g, p.fiber_g, p.sat_fat_g, p.sodium_mg].join("／") +
      (d.ntu_deviation != null ? "（NTU " + d.ntu_kcal_100g + "，" + (d.ntu_deviation * 100).toFixed(0) + "%）" : ""));
  });
  Object.keys(built.data.classes).concat(["soup"]).forEach((k) => {
    const c = k === "soup" ? built.data.soup : built.data.classes[k];
    console.log("平均 " + k + "（" + c.n + " 道）：" + FIELDS_TEXT(c.per_100g));
  });
} else {
  const prev = fs.existsSync(FILE) ? JSON.parse(fs.readFileSync(FILE, "utf8")) : { dishes: [] };
  const prevById = {};
  prev.dishes.forEach((d) => { prevById[d.id] = JSON.stringify(d); });
  const changed = built.data.dishes.filter((d) => prevById[d.id] !== JSON.stringify(d)).map((d) => d.id);
  if (changed.length) console.log("變動 " + changed.length + " 道：" + changed.join("、"));
  if (args.indexOf("--dry") === -1) {
    fs.writeFileSync(FILE, text);
    console.log("已寫入 data/home_dishes.json（" + built.data.dishes.length + " 道，" + Buffer.byteLength(text) + " bytes）");
  } else {
    console.log("（未寫檔）" + built.data.dishes.length + " 道");
  }
}

function FIELDS_TEXT(p) {
  return [p.kcal, p.protein_g, p.carb_g, p.fat_g, p.fiber_g, p.sat_fat_g, p.sodium_mg].join("／");
}
