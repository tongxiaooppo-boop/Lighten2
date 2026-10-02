// 輕盈計畫 — 由衛福部原始資料、標註、分組規則產生衛福部全表查詢檔 data/tfda_lookup.json（PRD 12.2、13.8，decisions #134）
//
// 用法：node tools/build-tfda-lookup.js            重新產生並寫回 data/tfda_lookup.json
//       node tools/build-tfda-lookup.js --dry      只列出有變動的樣品，不寫檔
//       node tools/build-tfda-lookup.js --report   印出報告（各組筆數、狀態、標註、檔案大小）
//
// data/tfda_lookup.json 不手改：改 data/reference/tfda_tags.json（標註）或 tfda_groups.json（分組）再跑這支。
// 分層對應（food_tree）改了會改變哪些樣品 listed，所以 build-food-tree.js 之後也要跑這支（check-data 會擋不一致）。
// 算法在 tools/lib/tfda-lookup-values.js，check-data.js 用同一份重算比對。

"use strict";

const fs = require("fs");
const path = require("path");
const L = require("./lib/tfda-lookup-values");

const ROOT = path.join(__dirname, "..");
const FILE = path.join(ROOT, "data", "tfda_lookup.json");
const readJson = (f) => JSON.parse(fs.readFileSync(path.join(ROOT, "data", f), "utf8"));
const args = process.argv.slice(2);

const built = L.buildTfdaLookup(L.loadTfdaLookupContext(readJson));
const lookup = built.lookup;
const text = L.stringifyTfdaLookup(lookup);

if (built.problems.length) { console.error("標註有問題：\n" + built.problems.join("\n")); process.exit(1); }

if (args.indexOf("--report") !== -1) {
  const count = (f) => { const c = {}; lookup.items.filter((it) => it.listed).forEach((it) => { const k = f(it); c[k] = (c[k] || 0) + 1; }); return c; };
  console.log("共 " + lookup.items.length + " 筆，搜尋列出 " + lookup.items.filter((it) => it.listed).length + " 筆；檔案 " + Buffer.byteLength(text) + " bytes");
  console.log("組：", count((it) => it.group + (it.drink ? "（飲品）" : "")));
  console.log("狀態：", count((it) => it.state));
  console.log("未確認：", count((it) => it.composite ? "composite" : "—"));
} else {
  const prev = fs.existsSync(FILE) ? JSON.parse(fs.readFileSync(FILE, "utf8")) : { items: [] };
  const prevById = {};
  prev.items.forEach((it) => { prevById[it.id] = JSON.stringify(it); });
  const changed = lookup.items.filter((it) => prevById[it.id] !== JSON.stringify(it)).map((it) => it.id);
  if (changed.length) console.log("變動 " + changed.length + " 筆：" + changed.slice(0, 40).join("、") + (changed.length > 40 ? "…" : ""));
  if (args.indexOf("--dry") === -1) {
    fs.writeFileSync(FILE, text);
    console.log("已寫入 data/tfda_lookup.json（" + lookup.items.length + " 筆，" + Buffer.byteLength(text) + " bytes）");
  } else {
    console.log("（未寫檔）" + lookup.items.length + " 筆");
  }
}
