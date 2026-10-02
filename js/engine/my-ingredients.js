// 我的食材（PRD 12.4、13.8，decisions #134、#136、#138）：custom_ingredients 紀錄 → 單品品項形狀（跟代換表分層品項同形，
// 給選擇器、我的食物、組合解析共用）。不碰 DOM、不讀時鐘；推薦不讀（章程 C4.17 ③）。
//
// 衛福部來源只存名稱、一份、備註，其餘（狀態、每 100g、過敏原、素食、組、液體）讀查詢檔 data/tfda_lookup.json
// （lookup＝catalog.loadTfdaLookup 正規化後的 { version, items, byId }）。液體的每 100g 視為每 100ml（同代換表全脂奶 1 杯＝240g 的慣例）。

import { UNVERIFIED_ALLERGEN } from "../core/config.js";

const NUTRIENTS = ["kcal", "protein_g", "carb_g", "fat_g", "fiber_g", "sat_fat_g", "sodium_mg"];

// 是不是我的食材（分層品項也有 group，靠 origin 分；審核 N1）
export function isMyIngredient(item) {
  return !!(item && (item.origin === "tfda" || item.origin === "user"));
}

// 1 份的營養：每 100 × 一份 ÷ 100，不進位（只在合計與顯示時進位，審核 S2）；沒設一份回 null
function perServing(per100, amount) {
  if (amount == null) return null;
  const out = {};
  NUTRIENTS.forEach(function (k) { out[k] = per100[k] == null ? null : per100[k] * amount / 100; });
  return out;
}

// 紀錄 → 品項。衛福部來源要傳 lookup；查詢檔裡沒有這個編號回 null（呼叫端歸已不提供，章程 B9）。
// 回傳 { uid, id, name, origin, group, subgroup: "mine", state, home_drink, serving: { amount, unit }, per_100g, per_serving,
//        allergen_tags（一律陣列，未確認＝["未確認"]，審核 S10）, diet_tags, note, archived, tfda: { id, name, category, desc, zero_filled } | null }
export function ingredientItem(rec, lookup) {
  let src;
  if (rec.source === "tfda") {
    const L = lookup && lookup.byId ? lookup.byId[rec.tfda_id] : null;
    if (!L) return null;
    src = { group: L.group, drink: L.drink, state: L.state, per_100g: L.per_100g, allergen_tags: L.allergen_tags, vegan: L.vegan, lacto_ovo: L.lacto_ovo,
      tfda: { id: L.id, name: L.name, category: L.category, desc: L.desc, zero_filled: L.zero_filled || [] } };
  } else {
    src = { group: rec.group, drink: rec.drink, state: rec.state, per_100g: rec.per_100g, allergen_tags: rec.allergen_tags, vegan: rec.vegan, lacto_ovo: rec.lacto_ovo, tfda: null };
  }
  const amount = rec.default_amount != null ? rec.default_amount : null;
  return {
    uid: rec.id, id: rec.id, name: rec.name, origin: rec.source, group: src.group, subgroup: "mine", state: src.state,
    home_drink: src.drink === true,
    serving: { amount: amount, unit: src.drink ? "ml" : "g" },
    per_100g: src.per_100g, per_serving: perServing(src.per_100g, amount),
    allergen_tags: Array.isArray(src.allergen_tags) ? src.allergen_tags.slice() : [UNVERIFIED_ALLERGEN],
    diet_tags: src.vegan ? ["全素"] : src.lacto_ovo ? ["蛋奶素"] : [],
    note: rec.note || null, archived: rec.archived === true, tfda: src.tfda,
  };
}

// ---------- 新增食材：衛福部搜尋（PRD 13.8、decisions #131、#134） ----------

export const TFDA_SEARCH_LIMIT = 100;

// 只搜 listed（代換表沒用到的 1887 筆）；名稱與俗名包含查詢字；category 是衛福部食品分類（晶片篩選）。
// 結果照查詢檔原順序（PRD 12.2）；沒有查詢字也沒有分類回空的。addedIds：已加入的衛福部整合編號（標「已加入」）
export function tfdaSearch(lookup, query, category, addedIds) {
  const q = String(query || "").trim().toLowerCase();
  if (!lookup || (!q && !category)) return { items: [], more: 0 };
  const added = {};
  (addedIds || []).forEach(function (id) { added[id] = true; });
  const hit = function (s) { return String(s).toLowerCase().indexOf(q) !== -1; };
  const hits = lookup.items.filter(function (it) {
    return it.listed && (!category || it.category === category) && (!q || hit(it.name) || (it.aliases || []).some(hit));
  });
  return {
    items: hits.slice(0, TFDA_SEARCH_LIMIT).map(function (it) { return { row: it, added: !!added[it.id] }; }),
    more: Math.max(0, hits.length - TFDA_SEARCH_LIMIT),
  };
}

// 有 listed 樣品的衛福部分類與筆數，照查詢檔出現的順序
export function tfdaCategories(lookup) {
  const out = [];
  const idx = {};
  ((lookup && lookup.items) || []).forEach(function (it) {
    if (!it.listed) return;
    if (idx[it.category] == null) { idx[it.category] = out.length; out.push({ name: it.category, count: 0 }); }
    out[idx[it.category]].count++;
  });
  return out;
}

// 自填照包裝填「每份的數字＋每份幾克（ml）」→ 每 100（decisions #64），進位到 0.1；null 照實
export function per100FromServing(values, amount) {
  const out = {};
  NUTRIENTS.forEach(function (k) {
    const v = values[k];
    out[k] = v == null || v === "" ? null : Math.round(Number(v) * 100 / amount * 10) / 10;
  });
  return out;
}
