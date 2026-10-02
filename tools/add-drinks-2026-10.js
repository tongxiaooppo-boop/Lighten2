// 一次性工具（decisions #145）：把 2026-10-02 調查的隨餐飲料加進現成品項，並把全部飲料（舊的 20 種＋新的）歸到小類。
// 依據：collab/proofs/2026-10-02-drink-verdict.md（使用者 2026-10-02：有問題的不收、有加糖的不推薦、超商／外食分開）。
// 用法：node tools/add-drinks-2026-10.js（--dry 只列出要加的）。可以重跑：已經有的 id 不重複加。
"use strict";
const fs = require("fs");
const path = require("path");
const { loadReferences, computePer100g } = require("./lib/ingredient-values.js");

const ROOT = path.join(__dirname, "..");
const DRY = process.argv.indexOf("--dry") !== -1;
const ALL = ["breakfast", "lunch", "afternoon_tea", "dinner", "snack"];
const TEA = ["breakfast", "lunch", "afternoon_tea", "dinner"];
const COFFEE = ["breakfast", "afternoon_tea"]; // 跟既有 dr05、dr09 一致
const CHECKED = "2026-10-02 查";

// 飲料小類（每個通路內的顯示順序就是這裡的順序；選擇器的現成飲料步驟依它分小標題）
const CATEGORY = {
  conv_dr01: "豆漿・植物奶", conv_dr02: "豆漿・植物奶", conv_dr03: "豆漿・植物奶", conv_dr04: "豆漿・植物奶", conv_dr05: "豆漿・植物奶",
  conv_pk04: "豆漿・植物奶", conv_dr06: "蛋白飲", conv_pk01: "蛋白飲", conv_pk02: "蛋白飲",
  bf02: "早餐店", dr06: "早餐店", dr07: "早餐店", dr08: "早餐店",
  dr05: "咖啡", dr09: "咖啡", dr10: "咖啡",
  dr03: "無糖茶", dr01: "手搖飲", dr02: "手搖飲", dr04: "手搖飲",
};

const label = (url, ref) => ({ type: "label", ref: url, note: ref + "（" + CHECKED + "）" });
const official = (url, ref) => ({ type: "official_web", ref: url, note: ref + "（" + CHECKED + "）" });
const PX = "https://shop.pxgo.com.tw/hourArrive/goods/";

function drink(o) {
  return Object.assign({
    channel: "convenience", vendor: null, role: "drink", valid_slots: ALL, contains_drink: false, is_treat: false,
    kcal_basis: "stated", kcal_range: null, protein_g: null, carb_g: null, fat_g: null, fiber_g: null, sat_fat_g: null, sodium_mg: null,
    allergen_tags: [], composite: false, vegan: false, lacto_ovo: false, field_sources: {}, verified_at: null,
  }, o);
}

// ---- 超商（convenience_items.json） ----
const CONV = [
  drink({ id: "conv_dr07", name: "原萃 日式綠茶（580ml）", vendor: "可口可樂", category: "茶", valid_slots: TEA,
    kcal: 0, protein_g: 0, carb_g: 0, fat_g: 0, sat_fat_g: 0, sodium_mg: 52, vegan: true, lacto_ovo: true,
    source: label("https://dailly.cc/food-4710018152702", "每份 290ml、2 份：熱量 0、蛋白質 0、脂肪 0、飽和脂肪 0、碳水 0、糖 0、鈉 26mg；成分 水、綠茶萃取物、維生素C鈉鹽、抹茶、小蘇打（2015 年頁面，同系列烏龍茶現行標示一致）"),
    note: "包裝標示；無糖，整瓶 2 份" }),
  drink({ id: "conv_dr08", name: "原萃 烏龍茶（580ml）", vendor: "可口可樂", category: "茶", valid_slots: TEA,
    kcal: 0, protein_g: 0, carb_g: 0, fat_g: 0, sat_fat_g: 0, sodium_mg: 52, vegan: true, lacto_ovo: true,
    source: label(PX + "237970-06010165-4710018162404", "每份 290ml、2 份：熱量 0、蛋白質 0、脂肪 0、飽和脂肪 0、碳水 0、糖 0、鈉 26mg；成分 水、包種茶、烏龍茶、維生素C鈉、烏龍茶粉、小蘇打；標示素食"),
    note: "包裝標示；無糖，整瓶 2 份" }),
  drink({ id: "conv_dr09", name: "純喫茶 無糖綠茶（481ml）", vendor: "統一", category: "茶", valid_slots: TEA,
    kcal: 0, protein_g: 0, carb_g: 0, fat_g: 0, sat_fat_g: 0, sodium_mg: 25, vegan: false, lacto_ovo: true,
    source: label(PX + "253432-21030077-4710088434050", "每份 96.2ml、5 份：熱量 0、蛋白質 0、脂肪 0、飽和脂肪 0、碳水 0、糖 0、鈉 5mg；成分 水、綠茶抽出液、綠茶、維生素C；標示奶素"),
    note: "包裝標示；成分只有茶，但包裝標「奶素」，照標示記蛋奶素、不記全素" }),
  drink({ id: "conv_dr10", name: "純喫茶 鮮柚綠茶（650ml）", vendor: "統一", category: "茶", is_treat: true,
    kcal: 254, protein_g: 0, carb_g: 63.6, fat_g: 0, sat_fat_g: 0, sodium_mg: 46, allergen_tags: ["未確認"], vegan: false, lacto_ovo: true,
    source: label(PX + "254029-21330148-4710088470485", "每份 325ml、2 份：熱量 127、蛋白質 0、脂肪 0、飽和脂肪 0、碳水 31.8、糖 29.2、鈉 23mg；標示奶素"),
    note: "包裝標示；含糖，整瓶 2 份；沒有完整成分表，過敏原未確認；包裝標「奶素」" }),
  drink({ id: "conv_dr11", name: "麥香 紅茶（375ml）", vendor: "統一", category: "茶", is_treat: true,
    kcal: 142, protein_g: 0, carb_g: 35.6, fat_g: 0, sat_fat_g: 0, sodium_mg: 52, allergen_tags: ["麩質"], vegan: false, lacto_ovo: true,
    source: label(PX + "246583-13060188-4710088471239", "375ml：熱量 142、蛋白質 0、脂肪 0、飽和脂肪 0、碳水 35.6、糖 34、鈉 52mg；含麩質穀物；標示奶素"),
    note: "包裝標示；含糖；含大麥（麩質）；包裝標「奶素」，照標示記蛋奶素" }),
  drink({ id: "conv_dr12", name: "麥香 奶茶（375ml）", vendor: "統一", category: "奶茶・乳酸飲料", is_treat: true,
    kcal: 148, protein_g: 1.1, carb_g: 34.1, fat_g: 0.8, sat_fat_g: 0.8, sodium_mg: 52, allergen_tags: ["乳製品", "麩質"], vegan: false, lacto_ovo: true,
    source: label("https://dailly.cc/food-4710088425263", "375ml：熱量 148、蛋白質 1.1、脂肪 0.8、飽和脂肪 0.8、碳水 34.1、糖 32.6、鈉 52mg；過敏原 乳製品、含麩質穀物；成分含全脂乳粉、脫脂乳粉（2015 年頁面）"),
    note: "包裝標示；含糖" }),
  drink({ id: "conv_dr13", name: "可爾必思 水語（330ml）", vendor: "朝日", category: "奶茶・乳酸飲料", is_treat: true,
    kcal: 147, protein_g: 0.8, carb_g: 36, fat_g: 0, sat_fat_g: 0, sodium_mg: 59, allergen_tags: ["乳製品", "黃豆"], vegan: false, lacto_ovo: true,
    source: label("https://24h.pchome.com.tw/prod/DBAB04-A9008IMRH", "330ml：熱量 147、蛋白質 0.83、脂肪 0、飽和脂肪 0、碳水 36、糖 34.7、鈉 59mg；含乳製品、大豆（官網 https://www.asahisoftdrinks.com.tw/product/calpis/4 每 100ml 數字一致）"),
    note: "包裝標示；含糖；蛋白質 0.83 記 0.8" }),
  drink({ id: "conv_dr14", name: "養樂多（100ml）", vendor: "養樂多", category: "奶茶・乳酸飲料", is_treat: true,
    kcal: 72, protein_g: 1.2, carb_g: 16.1, fat_g: 0, sodium_mg: 20, allergen_tags: ["乳製品"], vegan: false, lacto_ovo: true,
    source: label("https://dailly.cc/food-4711080010112", "100ml：熱量 72、蛋白質 1.2、脂肪 0、碳水 16.1、糖 13.6、鈉 20mg；成分 水、糖漿、果糖、生乳、脫脂奶粉、天然香料、代田菌"),
    note: "包裝標示；含糖；一瓶 100ml" }),
  drink({ id: "conv_dr15", name: "可口可樂（330ml）", vendor: "可口可樂", category: "汽水・果汁・氣泡水", is_treat: true,
    kcal: 138.6, protein_g: 0, carb_g: 35, fat_g: 0, sat_fat_g: 0, sodium_mg: 19.8, vegan: true, lacto_ovo: true,
    source: label(PX + "237677-06120011-4710018004605", "2000ml 瓶每份 250ml：熱量 105、蛋白質 0、脂肪 0、飽和脂肪 0、碳水 26.5、糖 26.5、鈉 15mg；成分 碳酸水、高果糖糖漿、蔗糖、焦糖色素、磷酸、香料、咖啡因；標示全素"),
    note: "包裝標示；含糖；330ml 罐依 2000ml 瓶每份 × 1.32 換算（同一配方）；成分表沒有過敏原" }),
  drink({ id: "conv_dr16", name: "雪碧（330ml）", vendor: "可口可樂", category: "汽水・果汁・氣泡水", is_treat: true,
    kcal: 112.2, protein_g: 0, carb_g: 28.4, fat_g: 0, sat_fat_g: 0, sodium_mg: 33, vegan: true, lacto_ovo: true,
    source: label(PX + "238023-06120136-4710018028601", "600ml 瓶每份 300ml：熱量 102、蛋白質 0、脂肪 0、飽和脂肪 0、碳水 25.8、糖 25.8、鈉 30mg；成分 碳酸水、高果糖糖漿、檸檬酸、香料、檸檬酸鈉、蔗糖素、醋磺內酯鉀；標示全素"),
    note: "包裝標示；含糖（部分以甜味劑取代）；330ml 罐依 600ml 瓶每份 × 1.1 換算；成分表沒有過敏原" }),
  drink({ id: "conv_dr17", name: "波蜜 芭樂汁（580ml）", vendor: "波蜜", category: "汽水・果汁・氣泡水", is_treat: true,
    kcal: 255.2, protein_g: 0, carb_g: 63.8, fat_g: 0, sat_fat_g: 0, sodium_mg: 116, vegan: true, lacto_ovo: true,
    source: label(PX + "250983-06010005-4710171052376", "每 100ml：熱量 44、蛋白質 0、脂肪 0、飽和脂肪 0、碳水 11、糖 10、鈉 20mg；成分 水、芭樂原汁、砂糖、果糖、香料、羧甲基纖維素鈉、檸檬酸、維生素C；標示無過敏原、素食"),
    note: "包裝標示；含糖（非原汁）；每 100ml × 5.8 換算整瓶" }),
  drink({ id: "conv_dr18", name: "舒味思 氣泡水 原味（500ml）", vendor: "可口可樂", category: "汽水・果汁・氣泡水",
    kcal: 0, protein_g: 0, carb_g: 0, fat_g: 0, sat_fat_g: 0, sodium_mg: 20, vegan: true, lacto_ovo: true,
    source: label(PX + "242159-06010613-4710018175701", "每份 250ml、2 份：熱量 0、蛋白質 0、脂肪 0、飽和脂肪 0、碳水 0、糖 0、鈉 10mg；成分 碳酸水"),
    note: "包裝標示；無糖" }),
  drink({ id: "conv_dr19", name: "CITY CAFE 美式咖啡 大杯（冰，約480ml）", vendor: "7-ELEVEN", category: "咖啡", valid_slots: COFFEE,
    kcal: 21.6, vegan: true, lacto_ovo: true,
    source: official("https://www.citycafe.com.tw/file/ingredient.pdf", "7-ELEVEN CITY CAFE 飲品營養標示（2026/9/16 起）：美式咖啡 大杯（16oz 約 480ml）冰 總熱量 21.6 kcal、總糖量 0g（最高值）；熱 16.8 kcal"),
    note: "官網營養標示；官方只公告總熱量、總糖量與咖啡因，蛋白質、脂肪、鈉無資料" }),
  drink({ id: "conv_dr20", name: "CITY CAFE 拿鐵咖啡 大杯（冰，約480ml）", vendor: "7-ELEVEN", category: "咖啡", valid_slots: COFFEE,
    kcal: 188.1, allergen_tags: ["乳製品"], vegan: false, lacto_ovo: true,
    source: official("https://www.citycafe.com.tw/file/ingredient.pdf", "7-ELEVEN CITY CAFE 飲品營養標示（2026/9/16 起）：拿鐵咖啡 大杯（16oz 約 480ml）冰 總熱量 188.1 kcal、總糖量 13.1g（最高值）；熱 254.4 kcal、16.7g"),
    note: "官網營養標示；不另加糖，糖是牛奶的乳糖；官方只公告總熱量、總糖量與咖啡因，蛋白質、脂肪、鈉無資料" }),
];

// ---- 外食（taiwan_items.json：手搖飲・咖啡・早餐店） ----
const tfdaNote = (code, name, ml) => "TFDA「" + name + "」（" + code + "）每 100g × " + ml + "ml（1ml 以 1g 計）";
const TW = [
  drink({ id: "dr11", channel: "delivery", name: "清漿（無糖豆漿，大杯約450ml）", category: "早餐店", valid_slots: ["breakfast", "lunch", "dinner", "snack"],
    allergen_tags: ["黃豆"], vegan: true, lacto_ovo: true,
    source: { type: "derived", ref: "H1150201 × 4.5", note: "TFDA 每 100g × 容量（1ml 以 1g 計）" },
    note: tfdaNote("H1150201", "豆漿(無糖)", 450) + "；樣品是包裝豆漿，店家現磨濃度會有差；成分只有黃豆與水" }),
  drink({ id: "dr12", channel: "delivery", name: "無糖綠茶（手搖大杯約700ml）", category: "無糖茶", valid_slots: TEA, vegan: true, lacto_ovo: true,
    source: { type: "derived", ref: "O0701301 × 7", note: "TFDA 每 100g × 容量（1ml 以 1g 計）" },
    note: tfdaNote("O0701301", "綠茶茶湯", 700) + "；用茶湯樣品代表手搖無糖綠茶" }),
  drink({ id: "dr13", channel: "delivery", name: "無糖青茶（手搖大杯約700ml）", category: "無糖茶", valid_slots: TEA, vegan: true, lacto_ovo: true,
    source: { type: "derived", ref: "O0700801 × 7", note: "TFDA 每 100g × 容量（1ml 以 1g 計）" },
    note: tfdaNote("O0700801", "烏龍茶茶湯", 700) + "；衛福部沒有青茶樣品，青茶是半發酵茶，用烏龍茶湯代表" }),
  drink({ id: "dr14", channel: "delivery", name: "炭焙烏龍（無糖，手搖大杯約700ml）", category: "無糖茶", valid_slots: TEA, vegan: true, lacto_ovo: true,
    source: { type: "derived", ref: "O0700801 × 7", note: "TFDA 每 100g × 容量（1ml 以 1g 計）" },
    note: tfdaNote("O0700801", "烏龍茶茶湯", 700) + "；衛福部沒有炭焙烏龍樣品，用烏龍茶湯代表" }),
  drink({ id: "dr15", channel: "delivery", name: "鐵觀音（無糖，手搖大杯約700ml）", category: "無糖茶", valid_slots: TEA, vegan: true, lacto_ovo: true,
    source: { type: "derived", ref: "O0700801 × 7", note: "TFDA 每 100g × 容量（1ml 以 1g 計）" },
    note: tfdaNote("O0700801", "烏龍茶茶湯", 700) + "；鐵觀音屬烏龍茶類，用烏龍茶湯代表" }),
];
const CS = (slug, ref) => official("https://www.chingshin.tw/product/" + slug, "清心福全官網：" + ref);
[["dr16", "清心福全 檸檬紅茶（大杯，少糖）", 208, CS("lemon-black-tea", "大杯 正常冰／少糖 總熱量 208 大卡、總糖量 49g")],
 ["dr17", "清心福全 金桔檸檬（大杯，少糖）", 211, CS("kumquat-lemon-juice", "大杯 正常冰／少糖 總熱量 211 大卡、總糖量 48g；成分 檸檬原汁、金桔汁、甘蔗液糖")],
 ["dr18", "清心福全 梅子綠茶（大杯，少糖）", 202, CS("plum-green-tea", "大杯 正常冰／少糖 總熱量 202 大卡、總糖量 46g")],
 ["dr19", "清心福全 冬瓜檸檬（大杯，半糖）", 261, CS("lemon-winter-melon-tea", "大杯 半糖 總熱量 261 大卡、總糖量 61g（最高甜度是半糖）")],
].forEach(function (r) {
  TW.push(drink({ id: r[0], channel: "delivery", vendor: "清心福全", name: r[1], category: "手搖飲", is_treat: true, kcal: r[2],
    allergen_tags: ["未確認"], source: r[3],
    note: "官網營養標示；官網只公告總熱量與總糖量，蛋白質、脂肪、鈉無資料；店內手工調製，熱量會略有增減；官網沒有過敏原聲明，標未確認" }));
});

// derived：數值一律由 TFDA 參考資料算（跟 check-data 的驗算同一個函式）
const refs = loadReferences();
TW.forEach(function (p) {
  if (p.source.type !== "derived") return;
  const v = computePer100g({ id: p.id, source: p.source, field_sources: p.field_sources }, refs);
  ["kcal", "protein_g", "carb_g", "fat_g", "fiber_g", "sat_fat_g", "sodium_mg"].forEach(function (k) { p[k] = v[k]; });
});

// 欄位順序照既有品項
const ORDER = ["id", "name", "channel", "vendor", "category", "role", "valid_slots", "contains_drink", "is_treat", "kcal", "kcal_basis", "kcal_range",
  "protein_g", "carb_g", "fat_g", "fiber_g", "sat_fat_g", "sodium_mg", "allergen_tags", "composite", "vegan", "lacto_ovo", "source", "field_sources", "verified_at", "note"];
function ordered(p) {
  const o = {};
  ORDER.forEach(function (k) { o[k] = p[k]; });
  return o;
}

function update(file, added, indent) {
  const p = path.join(ROOT, "data", file);
  const raw = fs.readFileSync(p, "utf8");
  const crlf = raw.indexOf("\r\n") !== -1;
  const list = JSON.parse(raw);
  let recat = 0;
  list.forEach(function (it) {
    if (CATEGORY[it.id] && it.category !== CATEGORY[it.id]) { it.category = CATEGORY[it.id]; recat++; }
  });
  const have = {};
  list.forEach(function (it) { have[it.id] = true; });
  const fresh = added.filter(function (it) { return !have[it.id]; }).map(ordered);
  // 新飲料放在同通路既有飲料的最後一筆後面（現成飲料步驟照資料順序）
  let at = -1;
  list.forEach(function (it, i) { if (it.role === "drink") at = i; });
  list.splice(at + 1, 0, ...fresh);
  console.log(file + "：改小類 " + recat + " 筆、新增 " + fresh.length + " 筆（" + fresh.map(function (x) { return x.id; }).join("、") + "）");
  if (DRY) return;
  const lines = list.map(function (it) { return indent + JSON.stringify(it); });
  const out = "[\n" + lines.join(",\n") + "\n]\n";
  fs.writeFileSync(p, crlf ? out.split("\n").join("\r\n") : out);
}

update("convenience_items.json", CONV, "");
update("taiwan_items.json", TW, "  ");
