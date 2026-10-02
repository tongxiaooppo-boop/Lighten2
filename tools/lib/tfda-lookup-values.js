// 衛福部全表查詢檔 data/tfda_lookup.json 的唯一算法（PRD 12.2、13.8，章程 B10、B12，decisions #131、#134）：
// build-tfda-lookup.js 用它產生，check-data.js 用同一份重算比對「完全相等」。
//
// 每筆一個衛福部樣品（2213 筆全收，代換表分層已用的樣品 listed: false——搜尋不列，但使用者手上已有的我的食材
// 在對應表改動後仍讀得到數值）。per_100g 走 ingredient-values 的同一段算法（TFDA 原值進位到小數 1 位，null 照實保留）。
// 標註：listed 的取 data/reference/tfda_tags.json；分層已用的取分層品項（同一樣品同標註，章程 B6.9）。
// composite＝標註含「未確認」（審查檔第 3 點：描述有「等」字但照原料標完的是傳統單純原料，不算複合）。
// 狀態：food-tree-values 的 sampleState，推不出的當「照現狀」（PRD 12.4）。

"use strict";

const { computePer100g } = require("./ingredient-values");
const { sampleState, readRef } = require("./food-tree-values");

const VERSION = "2025-update1";
const UNVERIFIED = "未確認";

function groupOf(r, rules, overrideOf) {
  const id = r["整合編號"];
  if (overrideOf[id]) return overrideOf[id];
  const g = rules.category[r["食品分類"]];
  if (!g) throw new Error("tfda_groups.json 沒有這個食品分類：" + r["食品分類"] + "（" + id + "）");
  return g;
}

function isDrink(r, group, rules) {
  const d = rules.drink;
  const name = r["樣品名稱"];
  if (d.ids.indexOf(r["整合編號"]) !== -1) return true;
  if (d.categories.indexOf(r["食品分類"]) !== -1) return !new RegExp(d.exclude_name).test(name);
  if (r["食品分類"] === "乳品類" && group === "dairy") return !new RegExp(d.dairy_liquid_exclude_name).test(name);
  return false;
}

function splitAliases(s) {
  return (s || "").split(/[,，、]/).map((x) => x.trim()).filter(Boolean);
}

// ctx：{ tfda: [衛福部原始列], tree: food_tree.json, tags: tfda_tags.json, groups: tfda_groups.json }
function buildTfdaLookup(ctx) {
  const overrideOf = {};
  ctx.groups.overrides.forEach((o) => o.ids.forEach((id) => {
    if (overrideOf[id]) throw new Error("tfda_groups.json：" + id + " 出現在兩個 overrides");
    overrideOf[id] = o.group;
  }));
  const treeTags = {};
  ctx.tree.items.forEach((it) => {
    if (!it.tfda_id) return;
    const t = { allergen_tags: it.allergen_tags, vegan: it.vegan, lacto_ovo: it.lacto_ovo };
    const prev = treeTags[it.tfda_id];
    if (prev && JSON.stringify(prev) !== JSON.stringify(t)) throw new Error("分層品項同一樣品標註不同：" + it.tfda_id);
    treeTags[it.tfda_id] = t;
  });
  const tagOf = {};
  ctx.tags.items.forEach((t) => { tagOf[t.key] = t; });
  const items = ctx.tfda.map((r) => {
    const id = r["整合編號"];
    const listed = !treeTags[id];
    const t = listed ? tagOf[id] : treeTags[id];
    if (!t) throw new Error("衛福部樣品沒有標註：" + id + " " + r["樣品名稱"] + "（補進 data/reference/tfda_tags.json）");
    const group = groupOf(r, ctx.groups, overrideOf);
    return {
      id: id, name: r["樣品名稱"], aliases: splitAliases(r["俗名"]), category: r["食品分類"], desc: r["內容物描述"] || "",
      group: group, drink: isDrink(r, group, ctx.groups), state: sampleState(r) || "as_is",
      per_100g: computePer100g({ source: { type: "tfda", ref: id } }, { tfda: ctx.tfdaById, usda: {} }),
      allergen_tags: t.allergen_tags, vegan: t.vegan, lacto_ovo: t.lacto_ovo,
      composite: t.allergen_tags.indexOf(UNVERIFIED) !== -1, listed: listed,
    };
  });
  // 標註檔裡、分層也用到的樣品（對應表後來改的），兩邊必須相同（章程 B6.9）；編號不存在的報出來
  const problems = [];
  ctx.tags.items.forEach((t) => {
    if (!ctx.tfdaById[t.key]) problems.push(t.key + " 不在衛福部資料");
    else if (treeTags[t.key] && JSON.stringify([t.allergen_tags, t.vegan, t.lacto_ovo]) !==
        JSON.stringify([treeTags[t.key].allergen_tags, treeTags[t.key].vegan, treeTags[t.key].lacto_ovo])) problems.push(t.key + " 跟分層品項的標註不同");
  });
  return { lookup: { version: VERSION, items: items }, problems: problems };
}

function stringifyTfdaLookup(lookup) {
  return "{\n  \"version\": " + JSON.stringify(lookup.version) + ",\n  \"items\": [\n" +
    lookup.items.map((it) => "    " + JSON.stringify(it)).join(",\n") + "\n  ]\n}\n";
}

function loadTfdaLookupContext(readJson) {
  const tfda = readRef("tfda-" + VERSION + ".json");
  const tfdaById = {};
  tfda.forEach((r) => { tfdaById[r["整合編號"]] = r; });
  return { tfda: tfda, tfdaById: tfdaById, tree: readJson("food_tree.json"), tags: readRef("tfda_tags.json"), groups: readRef("tfda_groups.json") };
}

module.exports = { buildTfdaLookup, stringifyTfdaLookup, loadTfdaLookupContext, VERSION };
