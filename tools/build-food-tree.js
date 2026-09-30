// 輕盈計畫 — 由代換表、對應表、標註產生代換表分層品項 data/food_tree.json（章程 B4「分層品項」、PRD 13.3）
//
// 用法：node tools/build-food-tree.js            重新產生並寫回 data/food_tree.json
//       node tools/build-food-tree.js --dry      只列出有變動的品項，不寫檔
//       node tools/build-food-tree.js --report   印出報告（每大類筆數、合併、不收、名目熱量、保留的 null、高鈣交叉比對）
//
// data/food_tree.json 不手改：改 data/reference/food_tree_map.json（對應）或 food_exchange_tags.json（標註）再跑這支。
// 算法在 tools/lib/food-tree-values.js，check-data.js 用同一份重算比對。

"use strict";

const fs = require("fs");
const path = require("path");
const { loadReferences, FIELDS } = require("./lib/ingredient-values");
const L = require("./lib/food-tree-values");

const ROOT = path.join(__dirname, "..");
const FILE = path.join(ROOT, "data", "food_tree.json");
const readJson = (f) => JSON.parse(fs.readFileSync(path.join(ROOT, "data", f), "utf8"));
const args = process.argv.slice(2);

const refs = loadReferences();
const ctx = L.loadFoodTreeContext(refs, readJson);
const tree = L.buildFoodTree(ctx);
const text = L.stringifyFoodTree(tree);

if (args.indexOf("--report") !== -1) {
  report();
} else {
  const prev = fs.existsSync(FILE) ? JSON.parse(fs.readFileSync(FILE, "utf8")) : { items: [] };
  const prevById = {};
  prev.items.forEach((it) => { prevById[it.id] = JSON.stringify(it); });
  const changed = tree.items.filter((it) => prevById[it.id] !== JSON.stringify(it)).map((it) => it.id);
  const gone = prev.items.filter((it) => !tree.items.some((x) => x.id === it.id)).map((it) => it.id);
  if (changed.length) console.log("變動 " + changed.length + " 筆：" + changed.slice(0, 40).join("、") + (changed.length > 40 ? "…" : ""));
  if (gone.length) console.log("消失 " + gone.length + " 筆：" + gone.join("、"));
  if (args.indexOf("--dry") === -1) {
    fs.writeFileSync(FILE, text);
    console.log("已寫入 data/food_tree.json（" + tree.items.length + " 筆，" + Buffer.byteLength(text) + " bytes）");
  } else {
    console.log("（未寫檔）" + tree.items.length + " 筆");
  }
}

function report() {
  const T = {};
  JSON.parse(fs.readFileSync(path.join(ROOT, "data", "reference", "tfda-2025-update1.json"), "utf8")).forEach((r) => { T[r["整合編號"]] = r; });
  const names = {};
  L.exchangeNames(ctx.table).forEach((n) => { names[n.key] = n; });
  const byGroup = {};
  ctx.map.entries.forEach((e) => {
    const g = e.builtin_only ? e.group : L.GROUP_OF_TABLE[names[e.key].row.table];
    const b = byGroup[g] = byGroup[g] || { item: 0, split: 0, merge: 0, exclude: 0, builtin_only: 0 };
    if (e.builtin_only) b.builtin_only++; else b[e.action]++;
    if (e.split) b.split += e.split.length;
  });
  console.log("## 每大類\n");
  Object.keys(byGroup).forEach((g) => console.log("- " + g + "：" + JSON.stringify(byGroup[g])));
  console.log("\n共 " + tree.items.length + " 筆分層品項；檔案 " + Buffer.byteLength(text) + " bytes");
  console.log("\n## 不收\n");
  ctx.map.entries.filter((e) => e.action === "exclude").forEach((e) => console.log("- " + e.key + "「" + names[e.key].name + "」：" + e.reason));
  console.log("\n## 合併\n");
  ctx.map.entries.filter((e) => e.action === "merge").forEach((e) => console.log("- " + e.key + "「" + names[e.key].name + "」→ " + e.into + "：" + e.reason));
  console.log("\n## 名目熱量（1 份 ÷ 代換表名目，超出 0.6–1.6 的要有 nominal_reason）\n");
  const entryById = {};
  ctx.map.entries.forEach((e) => { if (e.action === "item") [e].concat(e.split || []).forEach((p) => { entryById[p.id] = { e: e, p: p }; }); });
  tree.items.forEach((it) => {
    if (!it.exchange) return;
    const nom = L.nominalKcal(names[it.exchange.key].row);
    const r = L.nominalOutOfRange(it.per_serving.kcal, nom);
    const reason = entryById[it.id].p.nominal_reason;
    if (r.out || reason) console.log("- " + it.id + " " + it.name + "：" + it.per_serving.kcal + " / " + nom.kcal + " = " + r.ratio.toFixed(2) + (reason ? "｜理由：" + reason : "｜⚠ 沒有理由"));
  });
  console.log("\n## 保留的 null 欄位\n");
  tree.items.forEach((it) => {
    const nulls = FIELDS.filter((k) => it.per_100g[k] == null);
    if (nulls.length) console.log("- " + it.id + " " + it.name + "（" + it.tfda_id + "）：" + nulls.join("、"));
  });
  console.log("\n## 高鈣深色蔬菜交叉比對（指南定義：每 100g 鈣 > 75mg，只當提醒）\n");
  tree.items.filter((it) => it.group === "vegetable").forEach((it) => {
    const r = T[it.tfda_id];
    const ca = r ? r["鈣(mg)"] : null;
    const tagged = it.tags.indexOf("高鈣深色蔬菜") !== -1;
    if (tagged !== (ca != null && ca > 75)) console.log("- " + it.id + " " + it.name + "：鈣 " + ca + " mg，" + (tagged ? "有標" : "沒標"));
  });
}
