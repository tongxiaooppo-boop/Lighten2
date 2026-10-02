// 輕盈計畫 — 「我的食物」分頁的純函式（PRD 13；工作線 D 切片 2 計畫第 12 項）。
// 不碰 DOM、不 import data（章程 C1）；品項形狀是 catalog 的 products／fromCustomFood，catalog 物件由 ui 傳入。

import { passesHardFilters, normalizeAllergens } from "./filters.js";
import { quickAddProblem } from "./picker.js";
import { foodAmount, isEdiblePortionItem, zeroFilledText } from "./meal-content.js";
import { isMyIngredient } from "./my-ingredients.js";
import { round1 } from "../core/num.js";

// 不吃的全部清單（PRD 13.2）：依 key 去重（保留第一筆），key 依序查內建品項 uid、內建食材 id、分層品項 id；
// 查得到用現在的名稱（改名後跟著變），查不到 gone: true（畫面寫「已不提供」，章程 B9）。順序照清單。
export function dislikedListEntries(disliked, catalog) {
  const byUid = (catalog && catalog.productsByUid) || {};
  const ingById = {};
  ((catalog && catalog.ingredients) || []).forEach(function (it) { ingById[it.id] = it; });
  const treeById = (catalog && catalog.foodTree && catalog.foodTree.byId) || {};
  const seen = {};
  const out = [];
  (Array.isArray(disliked) ? disliked : []).forEach(function (d) {
    if (!d || typeof d.key !== "string" || seen[d.key]) return;
    seen[d.key] = true;
    const hit = byUid[d.key] || ingById[d.key] || treeById[d.key] || null;
    out.push({ key: d.key, label: d.label || d.key, name: hit ? hit.name : null, gone: !hit });
  });
  return out;
}

// 頂端搜尋：entries 由 ui 組好 [{ uid, name, aliases?, ... }]；去頭尾空白、不分大小寫比對名稱與別名。
// 空字串回 []；結果照 entries 原順序（不依熱量排，PRD 6.1）。名稱沒中、別名中了的，回傳項多一個 matchedAlias（審核 S9）
export function searchFoods(entries, query) {
  const q = String(query || "").trim().toLowerCase();
  if (q === "") return [];
  const hit = function (n) { return String(n || "").toLowerCase().indexOf(q) !== -1; };
  const out = [];
  (entries || []).forEach(function (e) {
    if (hit(e.name)) { out.push(e); return; }
    const alias = (Array.isArray(e.aliases) ? e.aliases : []).filter(hit)[0];
    if (alias !== undefined) out.push(Object.assign({}, e, { matchedAlias: alias }));
  });
  return out;
}

// 明細「以你目前的設定」那一行（中性文字，章程 C4.1、C4.13）；沒被擋回 null。
// 過敏原、飲食沿用選擇器快速新增的同一套句型；不吃寫「只擋這一項」（PRD 13.5）。
// 已知過敏原命中的（例：美乃滋標「蛋、未確認」、使用者設蛋）寫「含有它」，不寫「未確認」；
// 有宣告、只是不符合飲食設定的（雞胸對蛋奶素）寫「這一項不符合」（decisions #117）。其餘沿用 quickAddProblem 的句子
export function foodBlockText(item, profile) {
  const p = profile || {};
  const res = passesHardFilters(item, p);
  if (res.ok) return null;
  if (res.code === "disliked") return "你標了不吃（只擋這一項）";
  const label = foodsBlockLabel(item, p);
  if (res.code === "allergen" && label === "含過敏原") {
    const tags = Array.isArray(item.allergen_tags) ? item.allergen_tags : [];
    const hit = normalizeAllergens(p.allergens).list.filter(function (a) { return tags.indexOf(a) !== -1; });
    return "你設了過敏原「" + hit.join("、") + "」，含有它的品項不能選。";
  }
  if (res.code === "diet" && label === "不符合你的飲食設定") return "你設了飲食限制「" + p.diet_restriction + "」，這一項不符合。";
  return quickAddProblem(item, p).blocked;
}

// 我的品項「新到舊」（PRD 10.6）：依 created_at，相同時依 id 倒序。records 是 custom_foods 的原始紀錄。
export function customFoodsNewestFirst(records) {
  return (records || []).slice().sort(function (a, b) {
    const ca = String(a.created_at || ""), cb = String(b.created_at || "");
    if (ca !== cb) return ca < cb ? 1 : -1;
    const ia = String(a.id || ""), ib = String(b.id || "");
    return ia < ib ? 1 : ia > ib ? -1 : 0;
  });
}

const SOURCE_FIELD_ORDER = ["kcal", "protein_g", "carb_g", "fat_g", "fiber_g", "sat_fat_g", "sodium_mg"];
const SOURCE_CLASS_ORDER = ["tfda", "label", "estimate"];

// 明細的出處依類別分組（「熱量、蛋白質：包裝或官網標示；碳水、脂肪：估算」），不逐欄各寫一次。
// item.source_class 由 catalog 推導（decisions #98）；我的品項是 null → 回 []（畫面寫「你填的」「從內建複製」）。
export function sourceClassGroups(item) {
  const sc = item && item.source_class;
  if (!sc) return [];
  return SOURCE_CLASS_ORDER.map(function (cls) {
    return { cls: cls, fields: SOURCE_FIELD_ORDER.filter(function (k) { return sc[k] === cls; }) };
  }).filter(function (g) { return g.fields.length > 0; });
}

// ---------- 代換表分層品項（工作線 D 切片 4；PRD 13.3、decisions #114–#117） ----------
// 品項形狀是 catalog.foodTree.items（data/food_tree.json 正規化後）。只組字串與分組，不碰 DOM。

const FOOD_FIELD_LABELS = { "kcal": "熱量", "protein_g": "蛋白質", "carb_g": "碳水", "fat_g": "脂肪", "fiber_g": "纖維", "sat_fat_g": "飽和脂肪", "sodium_mg": "鈉" }; // 只給出處說明用欄位名稱（不讀數值，C4.14）
const COLLATOR = new Intl.Collator("zh-Hant");

// 單品（分層品項與我的食材）才有 group（現成品項、我的品項沒有），不用「沒有 role」反推（審核 S8）；
// 我的食材另用 isMyIngredient 分（切片 8b 審核 N1）
export function isFoodTreeItem(item) {
  return !!(item && typeof item.group === "string");
}

// 在「我的食物」的哪個子分頁：飲料都在飲品・水果；台式外食與宅配餐盒在外食；其餘現成品項在超商（跟選擇器一致）。
// 分層：水果類與家裡的飲品（home_drink）在飲品・水果，其餘在自煮（PRD 13.3）。
export function foodsWhereOf(item) {
  if (isFoodTreeItem(item)) return item.group === "fruit" || item.home_drink ? "drinks" : "cook";
  if (item.role === "drink") return "drinks";
  return item.is_taiwan || item.channel === "delivery" ? "delivery" : "convenience";
}

// 組內排序：名稱（Intl.Collator zh-Hant），同名依 id（decisions #111）
export function compareFoodTreeItems(a, b) {
  return COLLATOR.compare(a.name, b.name) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

function groupSections(group, items) {
  const subs = group.subgroups && group.subgroups.length ? group.subgroups : [{ code: null, name: null }];
  return {
    code: group.code, name: group.name,
    subgroups: subs.map(function (sg) {
      return {
        code: sg.code, name: sg.name, app_defined: !!sg.app_defined,
        items: items.filter(function (it) { return it.group === group.code && (sg.code === null || it.subgroup === sg.code); }).sort(compareFoodTreeItems),
      };
    }).filter(function (sg) { return sg.items.length > 0; }),
  };
}

// where="cook"：水果類以外、排除 home_drink，[{ code, name, subgroups: [{ code, name, app_defined, items }] }]，順序照 groups；
// 乳品類沒有子類（一個 code: null 的子類）；空的子類、大類不回。where="drinks"：{ homeDrinks, fruit }。
export function foodTreeSections(foodTree, where) {
  const t = foodTree || { groups: [], items: [] };
  if (where === "drinks") {
    const fruitGroup = t.groups.filter(function (g) { return g.code === "fruit"; })[0];
    return {
      homeDrinks: t.items.filter(function (it) { return it.home_drink; }).sort(compareFoodTreeItems),
      fruit: fruitGroup ? groupSections(fruitGroup, t.items) : null,
    };
  }
  const cookItems = t.items.filter(function (it) { return foodsWhereOf(it) === "cook"; });
  return t.groups.filter(function (g) { return g.code !== "fruit"; })
    .map(function (g) { return groupSections(g, cookItems); })
    .filter(function (g) { return g.subgroups.length > 0; });
}

// 克數前的量詞（審核 M2、章程 B5.5）：水果與油脂類的生品寫可食部分，其餘生的寫生重；液體不加
function stateWord(item) {
  if (item.serving.unit === "ml") return "";
  switch (item.state) {
    case "raw": return isEdiblePortionItem(item) ? "可食部分 " : "生重 ";
    case "cooked": return "熟重 ";
    case "dry": return "乾重 ";
    case "wet": return "濕重 ";
    default: return "";
  }
}

function amountText(item, amount) {
  return stateWord(item) + amount + (item.serving.unit === "ml" ? "ml" : "g");
}

// 明細的份量：「1 份（代換表）＝生重 35g，煮熟約 30g」「1 份（代換表）＝240ml（1杯）」；
// 對不到代換表的內建食材：「內建一餐：熟重 150g（今日建議會依你的熱量調整）」
export function foodTreeServingText(item) {
  const s = item.serving;
  if (s.builtin_meal) return "內建一餐：" + amountText(item, s.amount) + "（今日建議會依你的熱量調整）";
  return "1 份（代換表）＝" + amountText(item, s.amount) + (s.household ? "（" + s.household + "）" : "") + (s.display ? "，" + s.display : "");
}

// 列上的簡寫（審核 S12）：「代換表 1 份 · 生重 30g」「內建一餐 · 熟重 150g」
export function foodTreeServingShort(item) {
  return (item.serving.builtin_meal ? "內建一餐 · " : "代換表 1 份 · ") + amountText(item, item.serving.amount);
}

// ---------- 單品步進器旁的份量文字（切片 7；PRD 13.4、計畫 8.2 M2–M3、8.6） ----------

// 可以乘的家用量：開頭是整數、小數、分數或帶分數，後面是單位（不含數字與 ~–-，、或約）；數字與單位之間可以有空白
const HOUSEHOLD_RE = /^(\d+(?:\s+\d+\/\d+|\/\d+|\.\d+)?)(\s*)([^\d~～–\-，,、或約]+)$/;
const COUNTABLE_UNITS = ["個", "粒", "張", "片", "根", "顆"];

function gcd(a, b) {
  return b ? gcd(b, a % b) : a;
}

// 「1 1/2」「1/8」「2.5」「3」→ [分子, 分母]
function parseHouseholdNumber(s) {
  let m = /^(\d+)\s+(\d+)\/(\d+)$/.exec(s);
  if (m) return [Number(m[1]) * Number(m[3]) + Number(m[2]), Number(m[3])];
  m = /^(\d+)\/(\d+)$/.exec(s);
  if (m) return [Number(m[1]), Number(m[2])];
  m = /^(\d+)(?:\.(\d+))?$/.exec(s);
  const dec = m[2] || "";
  return [Number(m[1] + dec), Math.pow(10, dec.length)];
}

function fractionText(num, den) {
  const whole = Math.floor(num / den);
  const rem = num % den;
  if (rem === 0) return String(whole);
  return (whole > 0 ? whole + " " : "") + rem + "/" + den;
}

// 家用量乘份數（有理數）：約分後分母 ≤ 4 才寫（米杯放寬到 8）；可數單位且原值是 ≥2 的整數時，結果是整數才寫；
// 不寫小數；寫不乾淨或不是可乘的寫法回 null（只寫克數或毫升）。qty 是 0.5 的倍數
export function scaleHousehold(household, qty) {
  const m = HOUSEHOLD_RE.exec(String(household || "").trim());
  if (!m) return null;
  const base = parseHouseholdNumber(m[1]);
  const g0 = gcd(base[0], base[1]);
  const bn = base[0] / g0, bd = base[1] / g0;
  let num = bn * Math.round(qty * 2), den = bd * 2;
  const g = gcd(num, den);
  num /= g; den /= g;
  const unit = m[3];
  if (den > (unit.indexOf("米杯") !== -1 ? 8 : 4)) return null;
  const countable = COUNTABLE_UNITS.some(function (u) { return unit.indexOf(u) === 0; });
  if (countable && bd === 1 && bn >= 2 && den !== 1) return null;
  return fractionText(num, den) + m[2] + unit;
}

// 「煮熟約 35g」「購買量約 170g」乘份數
function scaleDisplay(display, qty) {
  return display.replace(/(\d+(?:\.\d+)?)g$/, function (_, n) { return round1(Number(n) * qty) + "g"; });
}

// 克數記法的已選框文字（decisions #136）：「生重 120g」「240ml」，必寫狀態詞（同步進器）
export function foodAmountModeText(item, amount) {
  return amountText(item, amount);
}

// 步進器旁的文字：克數或毫升為主、必寫狀態詞，家用量與 display 放括號（份數 1 原樣）。
// 「4 份＝熟重 160g（1碗）」「4 份＝可食部分 520g（4個，購買量約 680g）」「1 份＝內建一餐 熟重 150g」
export function foodQtyText(item, qty) {
  const s = item.serving;
  const amt = amountText(item, foodAmount(item, qty));
  if (s.builtin_meal) {
    return qty === 1 ? "1 份＝內建一餐 " + amt : qty + " 份＝" + amt + "（1 份是內建一餐 " + amountText(item, s.amount) + "）";
  }
  const extras = [];
  const hh = qty === 1 ? s.household : scaleHousehold(s.household, qty);
  if (hh) extras.push(hh);
  if (s.display) extras.push(qty === 1 ? s.display : scaleDisplay(s.display, qty));
  return qty + " 份＝" + amt + (extras.length ? "（" + extras.join("，") + "）" : "");
}

// 共用內建 id 的代換表品項：今日建議的一餐是多少（審核 S5），份數取最接近的 0.5；其餘 null
export function builtinMealLine(item, catalog) {
  if (!item.builtin || item.serving.builtin_meal) return null;
  const ing = ((catalog && catalog.ingredients) || []).filter(function (x) { return x.id === item.id; })[0];
  if (!ing || !(ing.serving_g > 0)) return null;
  const n = Math.round(ing.serving_g / item.serving.amount * 2) / 2;
  return "今日建議的一餐：" + amountText(item, ing.serving_g) + "（約 " + n + " 份代換表）";
}

// 缺值填 0 的四類理由（章程 B5.1 白名單）→ 使用者看得懂的說法；不顯示 field_sources 的 note 原文（decisions #98、審核 M8）
const ZERO_FILL_WHY = {
  動物性食材: "動物性食材不含纖維",
  蔬菜: "這項蔬菜脂肪很少，飽和脂肪接近 0",
  水果: "這項水果脂肪很少，飽和脂肪接近 0",
  油脂: "純油脂不含纖維與鈉",
};

// 明細的出處（decisions #116），回傳多行：衛福部附整合編號；推算方式依 source.derivation；缺值填 0 的欄位一句話
export function foodTreeSourceText(item) {
  const tail = item.serving.builtin_meal ? "" : "；1 份的量照食物代換表";
  const lines = [item.tfda_id
    ? "出處：衛福部食品營養成分資料庫（整合編號 " + item.tfda_id + "）" + tail
    : "出處：美國農業部食物資料庫" + tail];
  const d = item.source && item.source.derivation;
  if (d === "equivalent") lines.push("依代換表的生熟等值推算（整合編號是未煮的樣品）");
  if (d === "cooked_from_raw") lines.push("由生米樣品依熟重係數推算，可能略高估");
  const byWhy = {};
  Object.keys(item.field_sources || {}).forEach(function (k) {
    const f = item.field_sources[k];
    if (f && f.value === 0 && ZERO_FILL_WHY[f.ref]) (byWhy[f.ref] = byWhy[f.ref] || []).push(FOOD_FIELD_LABELS[k] || k);
  });
  Object.keys(byWhy).forEach(function (why) {
    lines.push(byWhy[why].join("、") + "：衛福部沒有這一欄；" + ZERO_FILL_WHY[why] + "，以 0 計");
  });
  return lines;
}

// 含糖一行（審核 S6）：只陳述樣品，不警告（章程 C4.13）
export function sugarLine(item) {
  if (item.sugar === "added") return "衛福部樣品：有加糖";
  if (item.sugar === "none") return "衛福部樣品：無加糖";
  return null;
}

// 過敏原摘要（decisions #117）：已知的列出來，不被「未確認」蓋掉。現成品項、分層品項共用
export function allergenSummary(tags) {
  const t = Array.isArray(tags) ? tags : ["未確認"];
  const known = t.filter(function (x) { return x !== "未確認"; });
  if (t.indexOf("未確認") !== -1) return "過敏原：" + (known.length ? known.join("、") + "；其他成分未確認" : "未確認");
  return "過敏原：" + (known.length ? known.join("、") : "確認不含");
}

// 「我的食物」列上的灰字（decisions #117）：依 passesHardFilters 的 code 與標籤分流，不比對 reason 文字；沒被擋回 null
export function foodsBlockLabel(item, profile) {
  const res = passesHardFilters(item, profile || {});
  if (res.ok) return null;
  const tags = Array.isArray(item.allergen_tags) ? item.allergen_tags : ["未確認"];
  if (res.code === "allergen") {
    const mine = normalizeAllergens((profile || {}).allergens).list;
    return tags.some(function (t) { return mine.indexOf(t) !== -1; }) ? "含過敏原" : "成分未確認";
  }
  // 只有分層品項與衛福部來源的我的食材（8a 人工標註）的素食欄位是確認過的（審核 S4、切片 8b N1）；現成品項、我的品項、自填食材沒宣告不等於不符合
  if (res.code === "diet") return isFoodTreeItem(item) && item.origin !== "user" && tags.indexOf("未確認") === -1 ? "不符合你的飲食設定" : "飲食限制未確認";
  return "你標了不吃";
}

// 同樣本（decisions #85、#108）：kind "sample"＝分層與現成品項同一個衛福部樣品；"form"＝分層之間同樣本、不同食物（白米↔白粥）。
// tfda_id 是 null 的不配對。disliked＝profile.disliked_ingredients，回傳項標出是否已標不吃
export function sameSampleEntries(uid, catalog, disliked) {
  const tree = (catalog && catalog.foodTree) || { items: [], byId: {} };
  const byUid = (catalog && catalog.productsByUid) || {};
  const keys = {};
  (Array.isArray(disliked) ? disliked : []).forEach(function (d) { if (d && d.key) keys[d.key] = true; });
  const entry = function (it, kind) { return { uid: it.uid, name: it.name, where: foodsWhereOf(it), kind: kind, disliked: !!keys[it.uid] }; };
  const self = tree.byId && tree.byId[uid];
  if (self) {
    const out = (self.same_sample_products || []).filter(function (u) { return byUid[u]; }).map(function (u) { return entry(byUid[u], "sample"); });
    if (self.tfda_id) {
      tree.items.forEach(function (it) { if (it.uid !== uid && it.tfda_id === self.tfda_id) out.push(entry(it, "form")); });
    }
    return out;
  }
  if (byUid[uid]) {
    return tree.items.filter(function (it) { return (it.same_sample_products || []).indexOf(uid) !== -1; }).map(function (it) { return entry(it, "sample"); });
  }
  return [];
}

// 標不吃／取消的訊息（審核 M7）：fx_ 品項推薦與「自己選」本來就不會出現，不能說「都不會再選它」
// wasFavorite：標不吃前它是常吃（互斥，PRD 13.5），補一句
export function dislikedMessage(item, on, wasFavorite) {
  if (!on) return "已取消不吃「" + item.name + "」。";
  const tail = wasFavorite ? "原本標的常吃已取消。" : "";
  if (isFoodTreeItem(item) && !isMyIngredient(item) && !item.builtin) return "已標不吃「" + item.name + "」。只擋這一項，不影響推薦裡的其他食物。" + tail;
  return "已標不吃「" + item.name + "」。推薦與「自己選」都不會再選它。" + tail;
}

// ---------- 常吃（工作線 D 切片 5；PRD 13.6） ----------

// 標常吃／取消的訊息；wasDisliked：標常吃前它是不吃（互斥），補一句
export function favoriteMessage(item, on, wasDisliked) {
  if (!on) return "已取消常吃「" + item.name + "」。";
  return "已標常吃「" + item.name + "」，自己選會放在最上面。" + (wasDisliked ? "原本標的不吃已取消。" : "");
}

// 明細寫常吃的作用（decisions #127 ⑥）：切片 5 推薦不讀常吃，一律這一句；切片 6 再依品項能不能進推薦分兩種
export function favoriteEffectText() {
  return "常吃只影響自己選的排列。";
}

// ---------- 我的食材（工作線 D 切片 8b；PRD 12.4、13.8，decisions #134、#136、#138） ----------

// 「一份幾克」的參考句（decisions #136 ②、審核 N2）：衛福部分類×狀態×液體 → 代表的代換表品項，數字讀 food_tree（章程 C2）；
// 代表品項跟這個樣品不同大類（例：堅果類裡的栗子歸全穀雜糧）、水果、其他、自填一律不給
export const AMOUNT_HINT_REFS = [
  ["肉類", "raw", false, "chicken_breast"], ["魚貝類", "raw", false, "fx_milkfish"],
  ["蛋類", "raw", false, "egg"], ["蛋類", "cooked", false, "egg"], ["蛋類", "as_is", false, "egg"],
  ["豆類", "as_is", true, "soy_milk"], ["穀物類", "raw", false, "fx_rice"], ["澱粉類", "raw", false, "sweet_potato"],
  ["蔬菜類", "raw", false, "cabbage"], ["菇類", "raw", false, "cabbage"], ["藻類", "raw", false, "cabbage"],
  ["乳品類", "as_is", true, "fx_whole_milk"], ["油脂類", "as_is", false, "fx_soybean_oil"],
  ["堅果及種子類", "raw", false, "fx_peanut"], ["堅果及種子類", "cooked", false, "fx_peanut"],
];

// row：查詢檔的一筆；回「參考：代換表 1 份「雞胸肉」是生重 30g」或 null
export function defaultAmountHint(row, foodTree) {
  if (!row) return null;
  const ref = AMOUNT_HINT_REFS.filter(function (h) { return h[0] === row.category && h[1] === row.state && h[2] === !!row.drink; })[0];
  const t = ref && foodTree && foodTree.byId ? foodTree.byId[ref[3]] : null;
  if (!t || t.group !== row.group) return null;
  return "參考：代換表 1 份「" + t.name + "」是" + amountText(t, t.serving.amount);
}

function unitWord(item) {
  return item.serving.unit === "ml" ? "毫升" : "克數";
}

// 列上的簡寫：「衛福部 · 1 份 生重 40g · 約 N kcal」「自填 · 每 100g 約 N kcal」
export function ingredientMeta(item) {
  const head = item.origin === "tfda" ? "衛福部" : "自填";
  const kcal = function (v) { return v == null ? "熱量無資料" : "約 " + Math.round(v) + " kcal"; };
  if (item.serving.amount == null) return head + " · 每 100" + item.serving.unit + " " + kcal(item.per_100g.kcal);
  return head + " · 1 份 " + amountText(item, item.serving.amount) + " · " + kcal(item.per_serving.kcal);
}

// 明細的份量：「1 份＝你設的 生重 40g」「沒有設一份，記錄時直接輸入克數」
export function ingredientServingText(item) {
  return item.serving.amount == null ? "沒有設一份，記錄時直接輸入" + unitWord(item) + "。" : "1 份＝你設的 " + amountText(item, item.serving.amount);
}

// 明細的出處與說明（中性）：衛福部整合編號與樣品名稱、樣品說明、補 0 的欄位、液體的單位、生的樣品
export function ingredientSourceLines(item) {
  if (item.origin !== "tfda") return ["出處：自填" + (item.home_drink ? "（每 100ml）" : "（每 100g）")];
  const t = item.tfda;
  return [
    "出處：衛福部 " + t.id + "「" + t.name + "」（" + t.category + "）",
    t.desc ? "衛福部樣品說明：" + t.desc : null,
    zeroFilledText(t.zero_filled),
    item.home_drink ? "衛福部是每 100g，這裡視為每 100ml。" : null,
    item.state === "raw" ? "這是生的樣品，克數請用煮之前的重量。" : null,
  ];
}

// 我的食材的分組（PRD 13.8、decisions #134）：items 是 ingredientItem 轉好、沒刪除的。
// cook：代換表大類（水果除外）各一組；other：衛福部分類各一組（自填的歸「自填」）；drinks：液體與水果。組內依名稱
export function ingredientSections(items) {
  const sorted = (items || []).slice().sort(compareFoodTreeItems);
  const cook = {};
  const otherIdx = {};
  const other = [];
  const drinks = [];
  sorted.forEach(function (it) {
    if (it.home_drink || it.group === "fruit") { drinks.push(it); return; }
    if (it.group !== "other") { (cook[it.group] = cook[it.group] || []).push(it); return; }
    const name = it.tfda ? it.tfda.category : "自填";
    if (otherIdx[name] == null) { otherIdx[name] = other.length; other.push({ name: name, items: [] }); }
    other[otherIdx[name]].items.push(it);
  });
  return { cook: cook, other: other, drinks: drinks };
}

// 明細的熱量一行與營養數字（1 份，或沒設一份時每 100），數字進位到 0.1（顯示用，章程 C4.11：ui 不自己算）
export function ingredientNutrition(item) {
  const per100 = item.serving.amount == null;
  const v = per100 ? item.per_100g : item.per_serving;
  const values = {};
  Object.keys(v).forEach(function (k) { values[k] = v[k] == null ? null : round1(v[k]); });
  return {
    kcalLine: (per100 ? "每 100" + item.serving.unit + " 熱量：" : "1 份熱量：") + (v.kcal == null ? "無資料" : "約 " + Math.round(v.kcal) + " kcal"),
    values: values,
  };
}

// 新增食材的搜尋結果一行：「魚貝類 · 生 · 每 100g 約 N kcal」
export function tfdaRowMeta(row) {
  const states = { raw: "生", cooked: "熟", dry: "乾", wet: "濕", as_is: "" };
  return [row.category, states[row.state] || "", "每 100" + (row.drink ? "ml" : "g") + " 約 " + Math.round(row.per_100g.kcal) + " kcal"].filter(Boolean).join(" · ");
}

// 衛福部食材「不吃」＝移除的訊息（decisions #134、審核 S9）；savedCount：引用它的組合數
export function ingredientRemovedMessage(name, savedCount) {
  return "已從我的食材移除「" + name + "」，可以從「＋新增食材」再加回來。" +
    (savedCount > 0 ? "用到它的 " + savedCount + " 個組合會顯示已不提供，再加回來就恢復。" : "");
}
