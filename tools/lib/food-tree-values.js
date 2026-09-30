// 代換表分層品項的唯一算法（章程 B4「分層品項」）：build-food-tree.js 用它產生 data/food_tree.json，
// check-data.js 用它重算比對。代換表轉錄在 data/reference/food_exchange_table.json（照 PDF 抄，不在這裡改字）。

"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..", "..");
const readRef = (f) => JSON.parse(fs.readFileSync(path.join(ROOT, "data", "reference", f), "utf8"));

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

module.exports = { exchangeNames, loadExchange };
