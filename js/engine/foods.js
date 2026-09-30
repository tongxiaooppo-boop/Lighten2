// 輕盈計畫 — 「我的食物」分頁的純函式（PRD 13；工作線 D 切片 2 計畫第 12 項）。
// 不碰 DOM、不 import data（章程 C1）；品項形狀是 catalog 的 products／fromCustomFood，catalog 物件由 ui 傳入。

import { passesHardFilters } from "./filters.js";
import { quickAddProblem } from "./picker.js";

// 不吃的全部清單（PRD 13.2）：依 key 去重（保留第一筆），key 依序查內建品項 uid、內建食材 id；
// 查得到用現在的名稱（改名後跟著變），查不到 gone: true（畫面寫「已不提供」，章程 B9）。順序照清單。
export function dislikedListEntries(disliked, catalog) {
  const byUid = (catalog && catalog.productsByUid) || {};
  const ingById = {};
  ((catalog && catalog.ingredients) || []).forEach(function (it) { ingById[it.id] = it; });
  const seen = {};
  const out = [];
  (Array.isArray(disliked) ? disliked : []).forEach(function (d) {
    if (!d || typeof d.key !== "string" || seen[d.key]) return;
    seen[d.key] = true;
    const hit = byUid[d.key] || ingById[d.key] || null;
    out.push({ key: d.key, label: d.label || d.key, name: hit ? hit.name : null, gone: !hit });
  });
  return out;
}

// 頂端搜尋：entries 由 ui 組好 [{ uid, name, aliases?, ... }]；去頭尾空白、不分大小寫比對名稱與別名（別名切片 3 起才有）。
// 空字串回 []；結果照 entries 原順序（不依熱量排，PRD 6.1）。
export function searchFoods(entries, query) {
  const q = String(query || "").trim().toLowerCase();
  if (q === "") return [];
  return (entries || []).filter(function (e) {
    const names = [e.name].concat(Array.isArray(e.aliases) ? e.aliases : []);
    return names.some(function (n) { return String(n || "").toLowerCase().indexOf(q) !== -1; });
  });
}

// 明細「以你目前的設定」那一行（中性文字，章程 C4.1、C4.13）；沒被擋回 null。
// 過敏原、飲食沿用選擇器快速新增的同一套句型；不吃寫「只擋這一項」（PRD 13.5）。
export function foodBlockText(item, profile) {
  const res = passesHardFilters(item, profile || {});
  if (res.ok) return null;
  if (res.code === "disliked") return "你標了不吃（只擋這一項）";
  return quickAddProblem(item, profile || {}).blocked;
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
