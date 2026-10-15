// 輕盈計畫 — 產生「食譜」分頁的資料 data/recipes_guide.json
// 輸入：collab/recipes-gen/final/steps.json（家常菜作法，id → {steps,tip,buy}）、final/sets.json（減重推薦套組）
// 食材名稱與克數來自 data/reference/home_dish_recipes.json；每份營養由 data/home_dishes.json 換算；套組營養由食材名稱對衛福部／代換表重算。
// 用法：node tools/build-recipes-guide.js [--dry]

"use strict";
const fs = require("fs");
const path = require("path");
const { load: loadResolver } = require("./lib/resolve-names");

const ROOT = path.join(__dirname, "..");
const rd = (f) => JSON.parse(fs.readFileSync(path.join(ROOT, f), "utf8"));
const FINAL = path.join(ROOT, "collab", "recipes-gen", "final");
const dry = process.argv.indexOf("--dry") !== -1;

const names = { cooking_oil: "食用油" };
rd("data/ingredients.json").forEach((i) => { names[i.id] = i.name; });
rd("data/reference/home_dish_seasonings.json").items.forEach((i) => { names[i.id] = i.name; });
rd("data/food_tree.json").items.forEach((i) => { names[i.id] = i.name; });
rd("data/tfda_lookup.json").items.forEach((i) => { if (!names[i.id]) names[i.id] = i.name; });

const recipes = rd("data/reference/home_dish_recipes.json").dishes;
const built = {};
rd("data/home_dishes.json").dishes.forEach((d) => { built[d.id] = d; });
const steps = JSON.parse(fs.readFileSync(path.join(FINAL, "steps.json"), "utf8"));
const sets = JSON.parse(fs.readFileSync(path.join(FINAL, "sets.json"), "utf8"));
const problems = [];
const warnings = [];

const dishes = [];
recipes.forEach((r) => {
  const st = steps[r.id];
  const b = built[r.id];
  if (!st || !st.steps || st.steps.length < 3) { problems.push("缺作法：" + r.id + " " + r.name); return; }
  if (!b) { problems.push("home_dishes 沒有 " + r.id); return; }
  const per = b.per_100g, f = (b.cooked_g / r.serv) / 100;
  const ing = r.recipe.map((x) => {
    if (!names[x.ref]) problems.push(r.id + " 食材名稱查不到：" + x.ref);
    return [names[x.ref] || x.ref, x.g];
  });
  dishes.push({
    id: r.id, name: r.name, role: r.role, method: r.method, serv: r.serv, mins: r.mins,
    per_serving: { kcal: +(per.kcal * f).toFixed(0), protein_g: +(per.protein_g * f).toFixed(1), carb_g: +(per.carb_g * f).toFixed(1), fat_g: +(per.fat_g * f).toFixed(1), fiber_g: +(per.fiber_g * f).toFixed(1) },
    ing: ing, oil_g: r.oil ? r.oil.g : 0, buy: st.buy || "", steps: st.steps, tip: st.tip || "",
  });
});

const resolve = loadResolver();
const outSets = [];
sets.forEach((s, idx) => {
  const tot = { kcal: 0, protein_g: 0, carb_g: 0, fat_g: 0, fiber_g: 0 };
  let ok = true;
  s.items.forEach((it) => {
    const x = resolve(it.name);
    if (!x) { problems.push("套組「" + s.name + "」食材查不到：" + it.name); ok = false; return; }
    ["kcal", "protein_g", "carb_g", "fat_g", "fiber_g"].forEach((k) => { tot[k] += (x.per_100g[k] || 0) * it.g / 100; });
  });
  if (!ok) return;
  Object.keys(tot).forEach((k) => { tot[k] = +tot[k].toFixed(1); });
  const dev = s.est ? Math.abs(tot.kcal - s.est.kcal) / tot.kcal : 0;
  if (dev > 0.15) warnings.push("套組「" + s.name + "」模型估 " + s.est.kcal + " kcal，重算 " + Math.round(tot.kcal));
  outSets.push({
    id: "rs_" + s.entry + "_" + String(idx).padStart(2, "0"), entry: s.entry, name: s.name, type: s.type, why: s.why,
    items: s.items.map((i) => [i.name, i.g]), steps: s.steps, nutrition: tot, prep_min: s.prep_min, keep: s.keep || "", tip: s.tip || "",
  });
});

warnings.forEach((w) => console.log("⚠ " + w));
if (problems.length) { problems.forEach((p) => console.error("✗ " + p)); process.exit(1); }
const out = { version: 1, note: "產生檔，不手改：改 collab/recipes-gen/final/ 再跑 node tools/build-recipes-guide.js", dishes: dishes, sets: outSets };
if (dry) console.log("（未寫檔）" + dishes.length + " 道菜、" + outSets.length + " 套");
else { fs.writeFileSync(path.join(ROOT, "data", "recipes_guide.json"), JSON.stringify(out)); console.log("已寫入 data/recipes_guide.json：" + dishes.length + " 道菜、" + outSets.length + " 套"); }
