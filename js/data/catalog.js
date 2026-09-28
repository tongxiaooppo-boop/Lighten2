// 輕盈計畫 — 食物資料目錄（唯一來源，章程 C2）：載入 data/*.json 並正規化成統一形狀。
// 推薦候選池、「自己選」、紀錄快照都只查這裡，不再各自 fetch、各自正規化。
//
// 統一的現成品項形狀（products）：
//   uid（超商＝原 id、台式外食＝"tw_"+id）、source_id、name、channel（convenience|delivery）、category、
//   role、valid_slots、contains_drink、is_treat、kcal（外食沒有代表值時取區間中點）、kcal_low/high/rep、
//   protein_g/carb_g/fat_g/fiber_g（缺值保留 null）、tier、diet_tags、allergen_tags（缺欄＝["未確認"]）、note、is_taiwan
//
// 食材（data/ingredients.json，章程 B4）依 axis 分成 proteins／staples／vegetables／sauces（醬料＋烹調法）四份清單，
// 並攤平成 engine 用的形狀：kcal_100g、protein_100g、carb_100g、fat_100g、fiber_100g、sat_fat_100g、sodium_100g、
// diet_tags（由 vegan／lacto_ovo 推導：全素 ⊃ 蛋奶素）；其餘欄位照抄。

import { round1 } from "../core/num.js";
import { SLOTS } from "../core/slots.js";
import { UNVERIFIED_ALLERGEN as UNVERIFIED } from "../core/config.js";

// 種子 JSON 帶跟程式同一個版本字串（取自這個模組被 import map 對應到的網址 ?v=），部署後資料跟程式一起更新（章程 C1.6）
const VERSION = new URL(import.meta.url).searchParams.get("v");

async function fetchJson(url) {
  const res = await fetch(VERSION ? url + "?v=" + VERSION : url);
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
// allergen_tags 缺欄或 null＝未確認（PRD 10.4），有設過敏原的使用者會被擋。
export function fromCustomFood(f) {
  return {
    uid: f.id, source_id: f.id, name: f.name, channel: null, category: null,
    role: "side", valid_slots: SLOTS.slice(),
    contains_drink: false, is_treat: false,
    kcal: f.kcal != null ? f.kcal : null, kcal_low: null, kcal_high: null, kcal_rep: null,
    protein_g: f.protein_g != null ? f.protein_g : null, carb_g: f.carb_g != null ? f.carb_g : null,
    fat_g: f.fat_g != null ? f.fat_g : null, fiber_g: f.fiber_g != null ? f.fiber_g : null,
    tier: "🟢", diet_tags: [], allergen_tags: Array.isArray(f.allergen_tags) ? f.allergen_tags : [UNVERIFIED],
    note: null, is_taiwan: false, is_custom: true,
  };
}

function fromIngredient(it) {
  const per = it.per_100g || {};
  const v = function (k) { return per[k] != null ? per[k] : null; };
  return Object.assign({}, it, {
    kcal_100g: it.per_100g ? v("kcal") : 0, // 烹調法本身沒有營養值
    protein_100g: it.per_100g ? v("protein_g") : 0,
    carb_100g: it.per_100g ? v("carb_g") : 0,
    fat_100g: it.per_100g ? v("fat_g") : 0,
    fiber_100g: it.per_100g ? v("fiber_g") : 0,
    sat_fat_100g: it.per_100g ? v("sat_fat_g") : 0,
    sodium_100g: it.per_100g ? v("sodium_mg") : 0,
    diet_tags: it.vegan ? ["全素"] : it.lacto_ovo ? ["蛋奶素"] : [],
  });
}

export function buildCatalog(raw) {
  const products = raw.convenienceItems.map(fromConvenience).concat(raw.taiwanItems.map(fromTaiwan));
  const productsByUid = {};
  products.forEach(function (p) { productsByUid[p.uid] = p; });
  const ingredients = raw.ingredients.map(fromIngredient);
  const ofAxis = function (axes) { return ingredients.filter(function (it) { return axes.indexOf(it.axis) !== -1; }); };
  return {
    ingredients: ingredients,
    proteins: ofAxis(["protein"]),
    staples: ofAxis(["staple"]),
    sauces: ofAxis(["seasoning", "method"]),
    vegetables: ofAxis(["vegetable"]),
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
      fetchJson("data/ingredients.json"),
      fetchJson("data/convenience_items.json"),
      fetchJson("data/taiwan_items.json"),
      fetchJson("data/dish_archetypes.json"),
    ]).then(function (r) {
      return buildCatalog({ ingredients: r[0], convenienceItems: r[1], taiwanItems: r[2], archetypes: r[3] });
    }).catch(function (err) {
      _catalog = null;
      throw err;
    });
  }
  return _catalog;
}
