// 輕盈計畫 — 食物資料目錄（唯一來源，章程 C2）：載入 data/*.json 並正規化成統一形狀。
// 推薦候選池、「自己選」、紀錄快照都只查這裡，不再各自 fetch、各自正規化。
//
// 統一的現成品項形狀（products）：
//   uid（超商＝原 id、台式外食＝"tw_"+id）、source_id、name、channel（convenience|delivery）、category、
//   role、valid_slots、contains_drink、is_treat、kcal（外食沒有代表值時取區間中點）、kcal_low/high/rep、
//   protein_g/carb_g/fat_g/fiber_g（缺值保留 null）、tier、diet_tags、allergen_tags（缺欄＝["未確認"]）、note、is_taiwan
// −1a 只接上現有資料、不改資料；欄位規格（章程 B4）在 −1b 重建資料時定案。

import { round1 } from "../core/num.js";

const UNVERIFIED = "未確認";

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error("[catalog.js] 載入種子資料失敗：" + url);
  return await res.json();
}

function fromConvenience(it) {
  return {
    uid: it.id, source_id: it.id, name: it.name,
    channel: it.channel === "delivery" ? "delivery" : "convenience",
    category: it.category || null, role: it.role, valid_slots: it.valid_slots || [],
    contains_drink: !!it.contains_drink, is_treat: !!it.is_treat,
    kcal: it.kcal != null ? it.kcal : null, kcal_low: null, kcal_high: null, kcal_rep: it.kcal != null ? it.kcal : null,
    protein_g: it.protein_g != null ? it.protein_g : null, carb_g: it.carb_g != null ? it.carb_g : null,
    fat_g: it.fat_g != null ? it.fat_g : null, fiber_g: it.fiber_g != null ? it.fiber_g : null,
    tier: it.tier, diet_tags: it.diet_tags || [],
    allergen_tags: Array.isArray(it.allergen_tags) ? it.allergen_tags : [UNVERIFIED],
    note: it.note || null, is_taiwan: false,
  };
}

function fromTaiwan(it) {
  return {
    uid: "tw_" + it.id, source_id: it.id, name: it.name,
    channel: "delivery",
    category: it.category || null, role: it.role, valid_slots: it.valid_slots || [],
    contains_drink: !!it.contains_drink, is_treat: !!it.is_treat,
    kcal: it.kcal_rep != null ? it.kcal_rep : round1((it.kcal_low + it.kcal_high) / 2),
    kcal_low: it.kcal_low != null ? it.kcal_low : null, kcal_high: it.kcal_high != null ? it.kcal_high : null,
    kcal_rep: it.kcal_rep != null ? it.kcal_rep : null,
    protein_g: it.protein_g != null ? it.protein_g : null, carb_g: it.carb_g != null ? it.carb_g : null,
    fat_g: it.fat_g != null ? it.fat_g : null, fiber_g: it.fiber_g != null ? it.fiber_g : null,
    tier: "🟢", // 外食品項對使用者來說零烹調成本
    diet_tags: [], // 台式品項沒有飲食限制標記：有設定飲食限制的使用者一律看不到，刻意的保守預設
    allergen_tags: Array.isArray(it.allergen_tags) ? it.allergen_tags : [UNVERIFIED],
    note: null, is_taiwan: true,
  };
}

// 使用者的「我的品項」（custom_foods store）→ 跟現成品項同形狀。v1 的自訂食物沒有角色與時段，一律當配菜、全時段。
export function fromCustomFood(f) {
  return {
    uid: f.id, source_id: f.id, name: f.name, channel: null, category: null,
    role: "side", valid_slots: ["breakfast", "lunch", "afternoon_tea", "dinner", "snack"],
    contains_drink: false, is_treat: false,
    kcal: f.kcal != null ? f.kcal : null, kcal_low: null, kcal_high: null, kcal_rep: null,
    protein_g: f.protein_g != null ? f.protein_g : null, carb_g: f.carb_g != null ? f.carb_g : null,
    fat_g: f.fat_g != null ? f.fat_g : null, fiber_g: f.fiber_g != null ? f.fiber_g : null,
    tier: "🟢", diet_tags: [], allergen_tags: [], note: null, is_taiwan: false, is_custom: true,
  };
}

export function buildCatalog(raw) {
  const products = raw.convenienceItems.map(fromConvenience).concat(raw.taiwanItems.map(fromTaiwan));
  const productsByUid = {};
  products.forEach(function (p) { productsByUid[p.uid] = p; });
  return {
    proteins: raw.proteins,
    staples: raw.staples,
    sauces: raw.sauces,
    vegetables: raw.rawIngredients.filter(function (it) { return it.category === "蔬菜"; }),
    archetypes: raw.archetypes,
    products: products,
    productsByUid: productsByUid,
  };
}

let _catalog = null;

// 整個 app 共用一份（種子資料在執行期間不會變）
export function loadCatalog() {
  if (!_catalog) {
    _catalog = Promise.all([
      fetchJson("data/protein_sources.json"),
      fetchJson("data/staples.json"),
      fetchJson("data/sauce_methods.json"),
      fetchJson("data/raw_ingredients.json"),
      fetchJson("data/convenience_items.json"),
      fetchJson("data/taiwan_items.json"),
      fetchJson("data/dish_archetypes.json"),
    ]).then(function (r) {
      return buildCatalog({
        proteins: r[0], staples: r[1], sauces: r[2], rawIngredients: r[3],
        convenienceItems: r[4], taiwanItems: r[5], archetypes: r[6],
      });
    }).catch(function (err) {
      _catalog = null;
      throw err;
    });
  }
  return _catalog;
}
