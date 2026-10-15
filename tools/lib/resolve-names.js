// 食材名稱 → 每 100g 營養：先找內建食材，再找衛福部全表（名稱完全相同優先，其次別名／開頭相同），給食譜頁換算套組營養用
"use strict";
const fs = require("fs");
const path = require("path");
const ROOT = path.join(__dirname, "..", "..");
const rd = (f) => JSON.parse(fs.readFileSync(path.join(ROOT, f), "utf8"));

// 清單內的簡稱 → 實際查的名稱（衛福部名稱或內建食材名）
const ALIAS = {
  "雞蛋": "雞蛋", "希臘優格(無糖)": "希臘優格", "水煮鮪魚罐頭": "鮪魚", "五香豆干": "五香豆干", "起司片": "起司片", "火腿片": "火腿",
  "低脂牛奶": "低脂奶", "馬鈴薯": "馬鈴薯", "玉米粒": "玉米粒", "吐司": "吐司", "饅頭": "饅頭", "萵苣": "萵苣（A菜）",
  "紅蘿蔔": "胡蘿蔔", "地瓜葉": "甘藷葉", "烹調用油(橄欖油/沙拉油)": "橄欖油", "橄欖油": "橄欖油", "沙拉油": "大豆油",
   "醬油": "醬油", "黑胡椒": "黑胡椒", "香蕉": "香蕉", "蘋果": "富士蘋果", "奇異果": "奇異果", "草莓": "草莓", "芭樂": "土芭樂",
  "木瓜": "木瓜", "柳丁": "柳橙", "鳳梨": "鳳梨", "杏仁": "杏仁果", "核桃": "核桃仁", "腰果": "腰果", "花生": "花生仁",
};

function load() {
  const base = {};
  rd("data/ingredients.json").forEach((i) => { base[i.name] = { name: i.name, per_100g: i.per_100g, src: "內建" }; });
  rd("data/food_tree.json").items.forEach((i) => { if (!base[i.name]) base[i.name] = { name: i.name, per_100g: i.per_100g, src: "代換表 " + i.id }; });
  base["食鹽"] = { name: "食鹽", per_100g: { kcal: 0, protein_g: 0, carb_g: 0, fat_g: 0, fiber_g: 0, sat_fat_g: 0, sodium_mg: 39300 }, src: "固定值" };
  base["鹽"] = base["食鹽"];
  const tfda = rd("data/tfda_lookup.json").items;
  const byName = {};
  tfda.forEach((t) => { (byName[t.name] = byName[t.name] || []).push(t); });
  function resolve(raw) {
    const q = ALIAS[raw] || ALIAS[raw.replace(/[(（].*$/, "")] || raw.replace(/[(（].*$/, "");
    if (base[q]) return base[q];
    if (base[raw]) return base[raw];
    let c = byName[q];
    if (!c) c = tfda.filter((t) => t.name.indexOf(q) === 0 || (t.aliases || []).indexOf(q) !== -1);
    if (!c || !c.length) return null;
    // 優先：生鮮、非飲料、名稱最短
    c = c.slice().sort((a, b) => (a.state === "raw" ? 0 : 1) - (b.state === "raw" ? 0 : 1) || a.name.length - b.name.length);
    return { name: c[0].name, per_100g: c[0].per_100g, src: "衛福部 " + c[0].id };
  }
  return resolve;
}
module.exports = { load, ALIAS };
