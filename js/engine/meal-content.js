// 輕盈計畫 — 一餐內容（唯一來源，章程 C2）：營養計算（含縮放、null 規則）、MealContent 與 daily_log 的建立。
// 推薦組合、「自己選」的現成品項與自己煮、今日/本週的攝取加總都走這裡；ui/ 不自己加總營養（章程 C4.11）。
//
// null 規則（章程 C4.5）：缺資料是 null，加總時 null 傳染，不當 0。
//   - 顯示用的合計（sumLogTotals、自己煮與現成品項的合計、推薦組合）：任一項未知 → null
//   - 缺口計算（sumKnownLogTotals）：未知的量不能算成「已經吃到」，只加已知部分，缺口因此偏大（往安全方向）
//   - 今日 hero 另有涵蓋率警語（todayIntake）
//   - 例外：鈉與飽和脂肪只用於顯示、不參與任何計算（章程 C4.5、C4.14）：有資料的部分照加，
//     另外在 partial 記下哪些欄位有品項沒有資料；全部都沒資料才是 null。
//
// 自煮一律帶隱含成分（章程 B5.6–B5.7、C4.11）：implicit = { oil_g, seasoning: "light" | "normal" | null }。
// 用油與調味不跟主要槽位縮放；推薦、自己選、紀錄快照都用這裡的函式。

import {
  PRIMARY_SLOT_SCALE_RANGE, COOKING_OIL_ID, OIL_HABIT_FACTOR, SEASONING_IDS, OIL_TSP_OPTIONS_G, NO_COOK_METHOD_ID, COMPOSE_MAX, ESTIMATE_SIZE_KCAL, ESTIMATE_RECALL_KCAL, ESTIMATE_RECALL_GROUP,
  ROLE_LABELS, tierRank, isQuickTier, manualRoleMax, QTY_OPTIONS, UNVERIFIED_ALLERGEN, FOOD_MAX_PER_MEAL,
  EST_SIZES, EST_CATS, EST_STAPLES, EST_DISH_MAX, EST_DISH_GRAMS, EST_STAPLE_PORTIONS, EST_STAPLE_G_PER_PORTION, EST_SOUP_ML, EST_DEFAULT_DISH_PROTEIN_CUTS, HOME_MEAL_DISH_MAX, HOME_MEAL_SOUP_MAX, HOME_DISH_PREFIX, HOME_STAPLE_REFS, EST_CAT_LABELS, EST_STAPLE_LABELS,
} from "../core/config.js";
import { SLOTS, SLOT_LABELS, isSlotEnabled } from "../core/slots.js";
import { passesHardFilters, ingredientFilterResult } from "./filters.js";
import { round1, isNum } from "../core/num.js";
import { ingredientItem } from "./my-ingredients.js";

export const NUTRIENT_FIELDS = ["protein_g", "carb_g", "fat_g", "fiber_g"];
const CONTRIB_FIELDS = ["kcal"].concat(NUTRIENT_FIELDS);
// 只用於顯示的欄位（不 null 傳染）
export const DISPLAY_FIELDS = ["sat_fat_g", "sodium_mg"];


// 我的品項的選填營養欄位（PRD 10.1），沒填是 null
export function emptyOptionalNutrients() {
  const out = {};
  NUTRIENT_FIELDS.concat(DISPLAY_FIELDS).forEach(function (k) { out[k] = null; });
  return out;
}

function round1OrNull(v) {
  return v == null ? null : round1(v);
}

// 組合裡只要任一成員該欄位是 null，整個組合這欄就是 null；否則才正常加總。
export function sumOrNull(members, field) {
  if (members.some(function (m) { return m[field] == null; })) return null;
  return round1(members.reduce(function (s, m) { return s + m[field]; }, 0));
}

// ---------- 自組食譜（推薦候選） ----------

// 一個食材的天然一份（或指定克數）營養值；每 100g 的值未知時那一欄是 null。
export function ingredientContribution(it, servingG) {
  const r = (servingG != null ? servingG : (it.serving_g != null ? it.serving_g : 100)) / 100;
  const per = function (v) { return isNum(v) ? v * r : null; };
  return {
    kcal: per(it.kcal_100g),
    protein_g: per(it.protein_100g),
    carb_g: per(it.carb_100g),
    fat_g: per(it.fat_100g),
    fiber_g: per(it.fiber_100g),
    sat_fat_g: per(it.sat_fat_100g),
    sodium_mg: per(it.sodium_100g),
  };
}

export const ZERO_CONTRIBUTION = { kcal: 0, protein_g: 0, carb_g: 0, fat_g: 0, fiber_g: 0, sat_fat_g: 0, sodium_mg: 0, partial: [] };

// 逐欄加總：營養素任一部分是 null 那一欄就是 null；鈉與飽和脂肪只加有資料的部分，缺資料的欄位記進 partial。
// 部分本身也可以是加總過的結果（帶 partial）。
export function addContributions(parts) {
  const acc = { kcal: 0, protein_g: 0, carb_g: 0, fat_g: 0, fiber_g: 0 };
  const known = { sat_fat_g: 0, sodium_mg: 0 };
  const sums = { sat_fat_g: 0, sodium_mg: 0 };
  const partial = {};
  parts.forEach(function (part) {
    CONTRIB_FIELDS.forEach(function (k) {
      acc[k] = acc[k] == null || part[k] == null ? null : acc[k] + part[k];
    });
    DISPLAY_FIELDS.forEach(function (k) {
      if (part[k] == null) partial[k] = true;
      else { sums[k] += part[k]; known[k]++; }
      if (part.partial && part.partial.indexOf(k) !== -1) partial[k] = true;
    });
  });
  DISPLAY_FIELDS.forEach(function (k) { acc[k] = known[k] > 0 ? sums[k] : null; });
  acc.partial = DISPLAY_FIELDS.filter(function (k) { return partial[k] && acc[k] != null; });
  return acc;
}

// ---------- 隱含成分：用油與調味（章程 B5.6–B5.7） ----------

// 預設用油與調味：烹調法的 implicit（煎 5g、炒 5g＋有蔬菜 5g…）× 用油習慣（少油減半）；
// 骨架 seasoned 時加調味，這一餐已選醬料就預設清淡、否則一般（decisions #28）。
export function defaultImplicit(method, archetype, hasVegetable, hasSauce, oilHabit) {
  const factor = OIL_HABIT_FACTOR[oilHabit] || 1;
  const oil = ((method && method.implicit) || []).reduce(function (g, x) {
    return x.ref === COOKING_OIL_ID ? g + x.g + (hasVegetable ? x.veg_add_g : 0) : g;
  }, 0);
  return {
    oil_g: round1(oil * factor),
    seasoning: archetype && archetype.seasoned ? (hasSauce ? "light" : "normal") : null,
  };
}

// 隱含成分的營養值（固定，不縮放）。implicitItems：catalog.implicit（用油與調味程度的食材，依 id）
export function implicitContribution(implicit, implicitItems) {
  const parts = [];
  if (implicit && implicit.oil_g > 0) parts.push(ingredientContribution(implicitItems[COOKING_OIL_ID], implicit.oil_g));
  if (implicit && implicit.seasoning) {
    const s = implicitItems[SEASONING_IDS[implicit.seasoning]];
    parts.push({ kcal: 0, protein_g: 0, carb_g: 0, fat_g: 0, fiber_g: 0, sat_fat_g: 0, sodium_mg: s.per_serving.sodium_mg });
  }
  const total = addContributions(parts);
  // 沒有任何隱含成分時，顯示用欄位是 0 而不是「沒資料」
  if (parts.length === 0) { total.sat_fat_g = 0; total.sodium_mg = 0; }
  return total;
}

// 候選池以「一般」用油習慣建立；少油習慣時把自組食譜的用油換成實際克數（熱量、脂肪等跟著調整，主要槽位不動）。
export function withOilHabit(c, oilHabit) {
  const factor = OIL_HABIT_FACTOR[oilHabit] || 1;
  if (!c.is_composed || !c.implicit || factor === 1 || !(c.implicit.oil_g > 0)) return c;
  const oilItem = c.implicit_items[COOKING_OIL_ID];
  const newOil = round1(c.implicit.oil_g * factor);
  const delta = ingredientContribution(oilItem, newOil - c.implicit.oil_g);
  const out = Object.assign({}, c, { implicit: Object.assign({}, c.implicit, { oil_g: newOil }) });
  CONTRIB_FIELDS.concat(DISPLAY_FIELDS).forEach(function (k) {
    if (out[k] != null && delta[k] != null) out[k] = round1(out[k] + delta[k]);
  });
  return out;
}

// 自組食譜可以靠「主要槽位」（有主食槽用主食，沒有的用蛋白質）在 PRIMARY_SLOT_SCALE_RANGE
// 內縮放去貼近熱量預算；超商/台式外送是真實商品，不能縮放，固定用天然份量的熱量。
// 回傳值同時給評分判斷貼近度、也給最終結果組裝實際要顯示的份量。
// maxScale（選填）：低碳時「碳水 ≤ 上限」容許的最大倍數，縮放取兩者較小者（呼叫端保證 ≥ 最小倍數）。
export function achievableNutrition(c, budget, maxScale) {
  if (!c.is_composed || !(budget > 0) || !(c.primary_kcal > 0)) {
    return Object.assign({ scale: 1, kcal: c.kcal, protein_g: c.protein_g, carb_g: c.carb_g, fat_g: c.fat_g, fiber_g: c.fiber_g },
      scaledDisplay(c, 1));
  }
  const fixedKcal = c.kcal - c.primary_kcal;
  let scale = (budget - fixedKcal) / c.primary_kcal;
  scale = Math.max(PRIMARY_SLOT_SCALE_RANGE.min, Math.min(PRIMARY_SLOT_SCALE_RANGE.max, scale));
  if (maxScale != null && scale > maxScale) scale = Math.max(PRIMARY_SLOT_SCALE_RANGE.min, maxScale);
  // 主要槽位是合計的一部分：合計已知時主要槽位一定已知；合計未知就維持 null
  const scaled = function (total, primary) {
    return total == null || primary == null ? null : round1((total - primary) + primary * scale);
  };
  return Object.assign({
    scale: scale,
    kcal: round1(fixedKcal + c.primary_kcal * scale),
    protein_g: scaled(c.protein_g, c.primary_protein_g),
    carb_g: scaled(c.carb_g, c.primary_carb_g),
    fat_g: scaled(c.fat_g, c.primary_fat_g),
    fiber_g: scaled(c.fiber_g, c.primary_fiber_g),
  }, scaledDisplay(c, scale));
}

// 顯示用欄位縮放：主要槽位只縮放它有資料的部分（沒資料的部分本來就不在合計裡）
function scaledDisplay(c, scale) {
  const out = {};
  DISPLAY_FIELDS.forEach(function (k) {
    out[k] = c[k] == null ? null : round1(c[k] + (c["primary_" + k] || 0) * (scale - 1));
  });
  return out;
}

// 低碳（章程 B6.6）：這個候選在碳水 ≤ maxCarbG 的前提下，主要槽位最多能放大幾倍。
// 回傳 null＝不算低碳（碳水未知，或縮到最小倍數仍超過）；Infinity＝不受限制（現成品項本來就不縮放）。
export function lowCarbMaxScale(c, maxCarbG) {
  if (c.carb_g == null) return null;
  if (!c.is_composed || !(c.primary_carb_g > 0)) return c.carb_g <= maxCarbG ? Infinity : null;
  const m = (maxCarbG - (c.carb_g - c.primary_carb_g)) / c.primary_carb_g;
  return m >= PRIMARY_SLOT_SCALE_RANGE.min ? m : null;
}

// ---------- 現成品項多選（自己選） ----------

// 公開的合計函式都在最後才進位一次（Phase 0 計畫 F1：先各自進位再相加，兩位小數的資料會差 0.1）
function roundTotals(t) {
  const out = Object.assign({}, t);
  CONTRIB_FIELDS.concat(DISPLAY_FIELDS).forEach(function (k) { out[k] = round1OrNull(out[k]); });
  return out;
}

// 一件商品或估算的營養值：品項（或記錄當下的快照）乘份數。熱量是必填欄位（章程 B4、B8），不會是 null。
function productPart(p, qty) {
  const q = qty != null ? qty : 1;
  const per = function (v) { return v == null ? null : v * q; };
  return {
    kcal: per(p.kcal), protein_g: per(p.protein_g), carb_g: per(p.carb_g), fat_g: per(p.fat_g), fiber_g: per(p.fiber_g),
    sat_fat_g: per(p.sat_fat_g), sodium_mg: per(p.sodium_mg),
  };
}

export function sumProducts(items) {
  return roundTotals(addContributions(items.map(function (it) { return productPart(it, 1); })));
}

// ---------- 手動記錄規則（章程 C4.8） ----------
// 比推薦寬：只限制每個角色的數量（主餐上限依時段，decisions #41），不要求主餐（一杯拿鐵可以記成一餐），不套用低碳。

function roleCounts(items) {
  const n = {};
  items.forEach(function (it) { n[it.role] = (n[it.role] || 0) + 1; });
  return n;
}

// 單品數超過一餐上限（PRD 13.4）：回傳原因或 null
export function foodLimitProblem(n) {
  return n > FOOD_MAX_PER_MEAL ? "單品最多選 " + FOOD_MAX_PER_MEAL + " 項。" : null;
}

// 可以送出回傳 null，否則回傳原因。opts.estimates：這一餐的「直接估算」筆數（不佔角色名額，但算有選東西）；
// opts.foods：單品項數（同樣不佔角色名額，章程 C4.8）
export function manualSelectionProblem(items, slot, opts) {
  const estimates = (opts && opts.estimates) || 0;
  const foods = (opts && opts.foods) || 0;
  if (items.length === 0 && estimates === 0 && foods === 0) return "請至少選一個品項。";
  const limit = foodLimitProblem(foods);
  if (limit) return limit;
  const n = roleCounts(items);
  const over = Object.keys(n).filter(function (r) { return n[r] > manualRoleMax(r, slot); })[0];
  if (!over) return null;
  return (SLOT_LABELS[slot] ? SLOT_LABELS[slot] + "的" : "") + (ROLE_LABELS[over] || over) + "最多選 " + manualRoleMax(over, slot) + " 個。";
}

export function canAddManualItem(items, item, slot) {
  return (roleCounts(items)[item.role] || 0) < manualRoleMax(item.role, slot);
}

// 自己選的單餐缺口提示：熱量超出份額多少、蛋白質/纖維還差多少（share 來自 budget.js slotNutrientShare）。
// 合計未知（例：估算、蛋白質沒填的我的品項）時缺口是 null，畫面顯示「無資料」，不當 0 算出假的缺口（章程 C4.5）。
export function slotGaps(share, totals) {
  const gap = function (target, v) { return v == null ? null : Math.round((target - v) * 10) / 10; };
  return {
    overKcal: Math.round(totals.kcal - share.kcalShare),
    proteinGap: gap(share.proteinShare, totals.protein_g),
    fiberGap: gap(share.fiberShare, totals.fiber_g),
  };
}

// ---------- 自煮：推薦候選池與自煮分頁共用的判斷（章程 C2） ----------

// 烹調法（可為 null）與食材的最高難度
export function maxTierRank(method, items) {
  return items.reduce(function (r, it) { return it ? Math.max(r, tierRank(it.prep_tier)) : r; },
    method ? tierRank(method.prep_tier) : 0);
}

// 自煮紀錄沒有明確的快煮/開伙來源時（推薦偏好是 auto 或退回），依最高難度推導（PRD 第 3 節）
export function deriveCookMealType(rank) {
  return isQuickTier(rank) ? "cook_quick" : "cook_full";
}

// 食安：免開火只能配不需要煮熟的食材，任一食材（蛋白質、主食、蔬菜、醬料）需要加熱就不行（章程 C4.3）
export function noCookViolation(method, items) {
  return !!method && method.id === NO_COOK_METHOD_ID && items.some(function (it) { return it && it.requires_cooking; });
}

export function archetypeHasStaple(a) {
  return !!(a && a.staple && a.staple.allow && a.staple.allow.length > 0);
}

// 自煮草稿：d = { archetype, proteins: [], staple, vegetables: [], seasoning, method, primaryScale }（飲料是選擇器共用的一步，不在自煮草稿裡）
// 蛋白質最多 2、蔬菜最多 3（COMPOSE_MAX），其餘單選。
const AXIS_FIELDS = { protein: "proteins", staple: "staple", vegetable: "vegetables", seasoning: "seasoning" };
const AXIS_LABELS = { protein: "蛋白質", staple: "主食", vegetable: "蔬菜", seasoning: "醬料" };

function onAxis(d, axis) {
  const v = d[AXIS_FIELDS[axis]];
  return Array.isArray(v) ? v : v ? [v] : [];
}

// 食材依 蛋白質 → 主食 → 蔬菜 → 醬料 的順序（MealContent 的元件順序也是這個）
export function draftIngredients(d) {
  return onAxis(d, "protein").concat(onAxis(d, "staple"), onAxis(d, "vegetable"), onAxis(d, "seasoning"));
}

// 主要槽位（被縮放的那個）：有主食槽用主食；沒有的用蛋白質，但選了 2 個蛋白質就不縮放
export function composePrimary(d) {
  if (archetypeHasStaple(d.archetype)) return d.staple || null;
  const proteins = onAxis(d, "protein");
  return proteins.length === 1 ? proteins[0] : null;
}

// 自煮分頁的一個選項能不能加進目前的草稿：回傳原因或 null。axis：protein／staple／vegetable／seasoning／method。
// opts.tier：這一餐的子切換值（"cook_quick" 時限制難度）。過敏原、飲食、不吃清單不在這裡，照舊走 passesHardFilters。
export function composeOptionProblem(item, axis, d, opts) {
  const quick = !!(opts && opts.tier === "cook_quick");
  if (axis === "method") {
    if (noCookViolation(item, draftIngredients(d))) return "已選的食材需要加熱";
    if (quick && !isQuickTier(tierRank(item.prep_tier))) return "快煮不含這個烹調法";
    return null;
  }
  if (noCookViolation(d.method, [item])) return "這個食材需要加熱";
  if (quick && !isQuickTier(tierRank(item.prep_tier))) return "快煮不含這個食材";
  const max = COMPOSE_MAX[axis];
  const selected = onAxis(d, axis);
  if (max && selected.length >= max && !selected.some(function (x) { return x.id === item.id; })) return "最多選 " + max + " 個";
  return null;
}

// 自煮草稿能不能送出：回傳原因或 null。順序固定：單品上限 → 餐型不完整 → 免開火（食安優先顯示）→ 骨架 allow → 軸上限 → 快煮難度。
// 沒選餐型時有單品（d.foods）或飲料（d.drink）就可以送出（PRD 13.4，decisions #122 修正 #45）；選了餐型就照餐型檢查，半套照樣擋。
export function composeProblem(d, opts) {
  const a = d.archetype;
  const foods = (d.foods || []).length + homeMealFoodCount(d.homeMeal); // 共餐的主食算 1 項單品，菜與湯另計（decisions #152）
  const limit = foodLimitProblem(foods);
  if (limit) return limit;
  if (!a) return foods > 0 || d.drink || homeMealParts(d.homeMeal).length > 0 ? null : "請先選餐型";
  if (onAxis(d, "protein").length === 0) return "請選蛋白質";
  if (archetypeHasStaple(a) && !d.staple) return "請選主食";
  if (!d.method) return "請選烹調法";
  const items = draftIngredients(d);
  if (noCookViolation(d.method, items)) return "免開火不能搭配需要加熱的食材，請換烹調法或換食材。";
  const axes = Object.keys(AXIS_FIELDS);
  for (let i = 0; i < axes.length; i++) {
    const allow = (a[axes[i]] && a[axes[i]].allow) || [];
    const outside = onAxis(d, axes[i]).filter(function (it) { return allow.indexOf(it.id) === -1; })[0];
    if (outside) return "「" + outside.name + "」不在「" + a.name + "」的選項裡";
  }
  if ((a.methods || []).indexOf(d.method.id) === -1) return "「" + d.method.name + "」不在「" + a.name + "」的選項裡";
  const capped = Object.keys(COMPOSE_MAX).filter(function (ax) { return onAxis(d, ax).length > COMPOSE_MAX[ax]; })[0];
  if (capped) return AXIS_LABELS[capped] + "最多選 " + COMPOSE_MAX[capped] + " 個";
  if (opts && opts.tier === "cook_quick") {
    const slow = [d.method].concat(items).filter(function (it) { return !isQuickTier(tierRank(it.prep_tier)); })[0];
    if (slow) return "快煮不含「" + slow.name + "」，請換成開伙或換掉它。";
  }
  return null;
}

function draftDefaultImplicit(d, oilHabit) {
  return defaultImplicit(d.method, d.archetype, onAxis(d, "vegetable").length > 0, !!d.seasoning, oilHabit);
}

// 用油選項（章程 B5.6）：只有烹調法本身帶用油（煎、炒）才有；預設（依用油習慣）／約 1 茶匙／約 2 茶匙，相同克數只列一次。
// 刻意沒有「不用油」（decisions #42）。回傳 [{ oil_g, is_default }]，不能選時是 []。
export function oilOptions(d, oilHabit) {
  const m = d.method;
  if (!m || !(m.implicit || []).some(function (x) { return x.ref === COOKING_OIL_ID; })) return [];
  const def = draftDefaultImplicit(d, oilHabit).oil_g;
  return [{ oil_g: def, is_default: true }].concat(OIL_TSP_OPTIONS_G.filter(function (g) { return g !== def; })
    .map(function (g) { return { oil_g: g, is_default: false }; }));
}

// 自煮實際採用的隱含成分：使用者的覆寫（d.implicitOverride = { oil_g?, seasoning? }）?? 預設。
// 覆寫不合用時退回預設：換成不能選用油的烹調法、骨架不調味（Phase 0 計畫 3-3）。沒覆寫時醬料跟著改預設清淡（decisions #28）。
export function composeImplicit(d, oilHabit) {
  const base = draftDefaultImplicit(d, oilHabit);
  const o = d.implicitOverride || {};
  const oilOk = o.oil_g != null && oilOptions(d, oilHabit).some(function (x) { return x.oil_g === o.oil_g; });
  const seasoningOk = base.seasoning != null && (o.seasoning === "light" || o.seasoning === "normal");
  return { oil_g: oilOk ? o.oil_g : base.oil_g, seasoning: seasoningOk ? o.seasoning : base.seasoning };
}

// 不進位的自煮合計。primary＝被縮放的那個食材（composePrimary）；implicit：composeImplicit 的結果；implicitItems：catalog.implicit。
// 食材任一項某欄未知，合計那一欄就是 null。
function composeContributions(d, primary, implicit, implicitItems) {
  const parts = draftIngredients(d).map(function (it) {
    const serving = it.serving_g != null ? it.serving_g : 100;
    return ingredientContribution(it, serving * (it === primary ? (d.primaryScale || 1) : 1));
  });
  parts.push(implicitContribution(implicit, implicitItems));
  return addContributions(parts);
}

export function composeTotals(d, primary, implicit, implicitItems) {
  return roundTotals(composeContributions(d, primary, implicit, implicitItems));
}

// ---------- 紀錄的加總 ----------

// 一筆紀錄的熱量（daily_log 寫入驗證保證 totals.kcal 一定是數字）
export function logKcal(l) {
  return l.totals.kcal;
}

// 顯示用的合計：任一筆這欄未知 → null
export function sumLogTotals(logs, field) {
  let sum = 0;
  for (let i = 0; i < logs.length; i++) {
    const v = logs[i].totals[field];
    if (v == null) return null;
    sum += v;
  }
  return sum;
}

// 缺口計算用：只加已知部分，另外回報幾筆未知（未知的量不能算成「已經吃到」，缺口偏大、往安全方向）
export function sumKnownLogTotals(logs, field) {
  let sum = 0;
  let missing = 0;
  logs.forEach(function (l) {
    const v = l.totals[field];
    if (v == null) missing++;
    else sum += v;
  });
  return { sum: sum, missing: missing };
}

// 推薦候選池與推薦結果只「帶著」顯示用欄位（鈉、飽和脂肪），不讀、不評分（章程 C4.14）：
// pool.js／recommend.js 一律透過這個函式複製，程式裡不直接出現欄位名稱（check-arch 會擋）。
// primary（選填）：自組食譜的主要槽位那一份，縮放時用。
export function displayFields(src, primary) {
  const out = {};
  DISPLAY_FIELDS.forEach(function (k) {
    out[k] = src[k] == null ? null : round1(src[k]);
    if (primary) out["primary_" + k] = primary[k] == null ? 0 : primary[k];
  });
  if (src.partial) out.partial = src.partial.slice();
  return out;
}

// 顯示用的鈉／飽和脂肪合計（章程 C4.5 例外）：{ value: 有資料的部分合計（全部沒資料是 null）, partial: 有沒有品項缺資料 }
export function sumDisplayLogTotals(logs, field) {
  const t = addContributions(logs.map(function (l) { return l.totals; }));
  return { value: t[field] == null ? null : round1(t[field]), partial: t.partial.indexOf(field) !== -1 };
}

// 今日已攝取（hero）：跳過 null（缺資料），不當 0 加；缺脂肪或碳水的紀錄另外算熱量給涵蓋率警語。
export function todayIntake(todayLogs) {
  const r = { protein_g: 0, carb_g: 0, fat_g: 0, fiber_g: 0, missingCoverageKcal: 0 };
  todayLogs.forEach(function (l) {
    const t = l.totals;
    r.protein_g += t.protein_g != null ? Number(t.protein_g) : 0;
    r.carb_g += t.carb_g != null ? Number(t.carb_g) : 0;
    r.fat_g += t.fat_g != null ? Number(t.fat_g) : 0;
    r.fiber_g += t.fiber_g != null ? Number(t.fiber_g) : 0;
    if (t.fat_g == null || t.carb_g == null) {
      r.missingCoverageKcal += Number(t.kcal) || 0;
    }
  });
  return r;
}

export function logsKcal(logs) {
  return logs.reduce(function (sum, l) { return sum + logKcal(l); }, 0);
}

// 今日建議卡片的熱量合計（額度用完、沒有推薦的時段不算）
export function recsKcalTotal(recs, slots) {
  let total = 0;
  slots.forEach(function (s) {
    const r = recs[s];
    if (r && !r.lowBudget && r.scaled_kcal != null) total += r.scaled_kcal;
  });
  return total;
}

// ---------- MealContent 與 daily_log（PRD 第 3 節） ----------

function productSnapshot(p) {
  return {
    name: p.name,
    kcal: p.kcal != null ? p.kcal : null,
    protein_g: p.protein_g != null ? p.protein_g : null,
    carb_g: p.carb_g != null ? p.carb_g : null,
    fat_g: p.fat_g != null ? p.fat_g : null,
    fiber_g: p.fiber_g != null ? p.fiber_g : null,
    sat_fat_g: p.sat_fat_g != null ? p.sat_fat_g : null,
    sodium_mg: p.sodium_mg != null ? p.sodium_mg : null,
  };
}

function productComponent(p, qty) {
  return { kind: "product", role: p.role, ref: p.uid, qty: qty != null ? qty : 1, snapshot: productSnapshot(p) };
}

// 草稿裡某個品項的份量（PRD 12.3）：選擇器的 qtyByUid，缺或不合法＝1
function draftQty(draft, uid) {
  const q = draft.qtyByUid && draft.qtyByUid[uid];
  return QTY_OPTIONS.indexOf(q) !== -1 ? q : 1;
}

// 份量的顯示文字：0.5「半份」、1.5／2「×1.5」「×2」、1 不顯示
export function qtyLabel(q) {
  if (q === 0.5) return "半份";
  return q != null && q !== 1 ? "×" + q : "";
}

// convenience_items.json 的 note 格式是「資料來源說明；實際內容物描述」，只取「；」後半段給使用者看（推薦卡片、複製成我的版本）。
export function contentNote(note) {
  if (!note) return null;
  const idx = note.indexOf("；");
  if (idx === -1) return null;
  return note.slice(idx + 1).trim() || null;
}

// 推薦組合 → MealContent。productsByUid：catalog 的現成品項查表（快照用）。
// 型態：時段偏好是快煮/開伙、而且沒有退回一般推薦時，就是那個偏好；否則（auto 或退回）才依難度推導（PRD 第 3 節）。
export function contentFromRec(rec, productsByUid) {
  if (rec.is_composed) {
    const comps = [];
    [["protein", rec.protein_id], ["staple", rec.staple_id], ["vegetable", rec.vegetable_id], ["seasoning", rec.sauce_id]].forEach(function (a) {
      if (!a[1]) return;
      const c = { kind: "ingredient", axis: a[0], ref: a[1] };
      if (a[0] === rec.primary_axis) { c.is_primary = true; c.scale = rec.primary_scale != null ? rec.primary_scale : rec.scale; }
      comps.push(c);
    });
    const pref = rec.source_pref;
    const fromPref = !rec.fallback_to_auto && (pref === "cook_quick" || pref === "cook_full");
    return {
      meal_type: fromPref ? pref : deriveCookMealType(rec.tier_rank),
      archetype_id: rec.archetype_id, method_id: rec.method_id,
      components: comps, implicit: rec.implicit ? { oil_g: rec.implicit.oil_g, seasoning: rec.implicit.seasoning } : null,
    };
  }
  return {
    meal_type: rec.is_convenience ? "convenience" : "delivery",
    archetype_id: null, method_id: null,
    components: rec.components.map(function (uid) { return productComponent(productsByUid[uid]); }),
    implicit: null,
  };
}

// 自煮草稿 → MealContent。primary：composePrimary(d)；implicit：實際採用的用油與調味；
// mealType：自煮分頁的子切換值（decisions #34、#47），不從食材反推。
export function contentFromCompose(d, primary, implicit, mealType) {
  if (mealType !== "cook_quick" && mealType !== "cook_full") throw new Error("[meal-content.js] 自煮的 meal_type 要由呼叫端傳入：" + mealType);
  const comps = [];
  [["protein", onAxis(d, "protein")], ["staple", onAxis(d, "staple")], ["vegetable", onAxis(d, "vegetable")], ["seasoning", onAxis(d, "seasoning")]].forEach(function (a) {
    a[1].forEach(function (it) {
      const comp = { kind: "ingredient", axis: a[0], ref: it.id };
      if (it === primary) { comp.is_primary = true; comp.scale = d.primaryScale; }
      comps.push(comp);
    });
  });
  return {
    meal_type: mealType,
    archetype_id: d.archetype ? d.archetype.id : null,
    method_id: d.method ? d.method.id : null,
    components: comps, implicit: { oil_g: implicit.oil_g, seasoning: implicit.seasoning },
  };
}

// 「找不到？直接估算」的元件：只存在這一餐，熱量取 S/M/L 常數，其餘營養素未知（章程 C4.5）
export function estimateComponent(size, name) {
  if (!ESTIMATE_SIZE_KCAL.hasOwnProperty(size)) throw new Error("[meal-content.js] 估算的份量不對：" + size);
  return {
    kind: "estimate", name: name && name.trim() ? name.trim() : "外食估算", size: size,
    snapshot: { kcal: ESTIMATE_SIZE_KCAL[size], protein_g: null, carb_g: null, fat_g: null, fiber_g: null, sat_fat_g: null, sodium_mg: null },
  };
}

// 估算草稿 → 元件。草稿帶 snapshot（與 est）時照用、不重算（預約與「記下」都走這裡，PRD 第 3 節）；
// 沒有 snapshot 的是剛按下的一般外食 S/M/L，用常數
export function estimateFromDraft(e) {
  if (!e.snapshot) return estimateComponent(e.size, e.name);
  const comp = {
    kind: "estimate", name: e.name && e.name.trim() ? e.name.trim() : "外食估算", size: e.size != null ? e.size : null,
    snapshot: Object.assign({}, e.snapshot),
  };
  if (e.est) comp.est = copyEst(e.est);
  return comp;
}

function copyEst(est) {
  return Object.assign({}, est, { cats: est.cats.slice() });
}

// ---------- 「主食＋家常菜」估算（decisions #151） ----------
// cfg（＝est）：{ n: 1–4, cats: ["veg"|"mixed"|"meat" × n], staple: white|brown|mixed|noodle|none, staple_size: S|M|L|null, dish: S|M|L, soup: boolean }
// home：catalog.homeDishes（data/home_dishes.json 正規化後：staples、classes、soup 的每 100g）。回傳選擇器的估算草稿 { size: null, name, snapshot, est }。

// 這份估算的克數：主食、菜的全分量與每道、湯（預覽「飯 160g」「菜 160g 分 2 道」用）
export function homeEstimateGrams(cfg) {
  const stapleG = cfg.staple === "none" ? 0 : EST_STAPLE_PORTIONS[cfg.staple_size] * EST_STAPLE_G_PER_PORTION[cfg.staple];
  const dishG = EST_DISH_GRAMS[cfg.dish];
  return { staple_g: stapleG, dish_total_g: dishG, per_dish_g: round1(dishG / cfg.n), soup_ml: cfg.soup ? EST_SOUP_ML : 0 };
}

// 設定不完整或資料沒載入回傳原因，否則 null
export function homeEstimateProblem(cfg, home) {
  if (!cfg || !Number.isInteger(cfg.n) || cfg.n < 1 || cfg.n > EST_DISH_MAX) return "家常菜估算：菜的道數要在 1 到 " + EST_DISH_MAX + "。";
  if (!Array.isArray(cfg.cats) || cfg.cats.length !== cfg.n || cfg.cats.some(function (k) { return EST_CATS.indexOf(k) === -1; })) return "家常菜估算：每道菜都要選類別。";
  if (EST_STAPLES.indexOf(cfg.staple) === -1) return "家常菜估算：主食不對。";
  if (cfg.staple === "none" ? cfg.staple_size !== null : EST_SIZES.indexOf(cfg.staple_size) === -1) return "家常菜估算：主食的量不對。";
  if (EST_SIZES.indexOf(cfg.dish) === -1) return "家常菜估算：菜的量不對。";
  if (typeof cfg.soup !== "boolean") return "家常菜估算：湯要選有或沒有。";
  if (!home || !home.classes) return "家常菜估算：資料還沒載入。";
  if (cfg.cats.some(function (k) { return !home.classes[k] || !home.classes[k].per_100g; })) return "家常菜估算：缺少菜的類別資料。";
  if (cfg.staple !== "none" && !(home.staples[cfg.staple] && home.staples[cfg.staple].per_100g)) return "家常菜估算：缺少主食資料。";
  if (cfg.soup && !(home.soup && home.soup.per_100g)) return "家常菜估算：缺少湯的資料。";
  return null;
}

// 估算卡打開時菜量的預設：依一天的蛋白質目標（身高、體重、目標模式算出的）換成每餐，沒有目標就中份
export function homeEstimateDefaultDish(targets) {
  const perMeal = targets && Number(targets.protein_g) > 0 ? Number(targets.protein_g) / 3 : null;
  if (perMeal === null) return "M";
  if (perMeal < EST_DEFAULT_DISH_PROTEIN_CUTS[0]) return "S";
  return perMeal > EST_DEFAULT_DISH_PROTEIN_CUTS[1] ? "L" : "M";
}

// 估算卡打開時的預設份量：菜量依蛋白質目標（homeEstimateDefaultDish），主食量選「整餐熱量最接近這個時段配額」的那一格
// （預設 1 道菜肉、白飯）。kcalShare 是這個時段的配額（slotNutrientShare），沒有或 0 就主食選中。只決定預設，使用者隨時可改
export function homeEstimateDefaults(targets, kcalShare, home) {
  const dish = homeEstimateDefaultDish(targets);
  let stapleSize = "M";
  if (Number(kcalShare) > 0 && home && home.classes && home.classes.mixed && home.staples && home.staples.white) {
    let best = null;
    EST_SIZES.forEach(function (s) {
      const e = homeEstimate({ n: 1, cats: ["mixed"], staple: "white", staple_size: s, dish: dish, soup: false }, home);
      const gap = Math.abs(e.snapshot.kcal - kcalShare);
      if (best === null || gap < best.gap) best = { size: s, gap: gap };
    });
    stapleSize = best.size;
  }
  return { dish: dish, staple_size: stapleSize };
}

export function homeEstimateName(cfg) {
  const dishes = cfg.n + " 道菜（" + cfg.cats.map(function (k) { return EST_CAT_LABELS[k]; }).join("、") + "）";
  return (cfg.staple === "none" ? "" : EST_STAPLE_LABELS[cfg.staple] + "＋") + dishes + (cfg.soup ? "＋湯" : "");
}

export function homeEstimate(cfg, home) {
  const problem = homeEstimateProblem(cfg, home);
  if (problem) throw new Error("[meal-content.js] " + problem);
  const g = homeEstimateGrams(cfg);
  const sum = { kcal: 0, protein_g: 0, carb_g: 0, fat_g: 0, fiber_g: 0, sat_fat_g: 0, sodium_mg: 0 };
  const add = function (per, grams) { Object.keys(sum).forEach(function (k) { sum[k] += per[k] * grams / 100; }); };
  if (cfg.staple !== "none") add(home.staples[cfg.staple].per_100g, g.staple_g);
  cfg.cats.forEach(function (k) { add(home.classes[k].per_100g, g.dish_total_g / cfg.n); });
  if (cfg.soup) add(home.soup.per_100g, g.soup_ml);
  const snapshot = {};
  Object.keys(sum).forEach(function (k) { snapshot[k] = round1(sum[k]); });
  const est = { n: cfg.n, cats: cfg.cats.slice(), staple: cfg.staple, staple_size: cfg.staple_size, dish: cfg.dish, soup: cfg.soup };
  return { size: null, name: homeEstimateName(cfg), snapshot: snapshot, est: est };
}

// ---------- 家庭共餐（自煮，decisions #152）：主食＋從家常菜清單選 1–4 樣＋湯，記成 food 元件（hd_ 菜、主食都用 amount 克） ----------
// form：{ staple: white|brown|mixed|noodle|none, staple_size: S|M|L|null, dish: S|M|L, dishes: [hd_ id…], soup: hd_ id | null }
// draft.homeMeal：{ staple: { item, amount } | null, dishes: [{ item, amount }], soup: { item, amount } | null }（item 是 catalog 的單品形狀）

function isHomeStapleItem(item) {
  return !!item && HOME_STAPLE_REFS.indexOf(item.uid) !== -1;
}

// 元件順序固定：主食、各道菜、湯
function homeMealParts(hm) {
  if (!hm) return [];
  return (hm.staple ? [hm.staple] : []).concat(hm.dishes || [], hm.soup ? [hm.soup] : []);
}

// 這份共餐的克數：主食、菜的全分量與每道（整數，每道＝round(全分量 ÷ N)）、湯
export function homeMealGrams(form) {
  const n = form.dishes.length;
  return {
    staple_g: form.staple === "none" ? 0 : EST_STAPLE_PORTIONS[form.staple_size] * EST_STAPLE_G_PER_PORTION[form.staple],
    dish_total_g: EST_DISH_GRAMS[form.dish], per_dish_g: n > 0 ? Math.round(EST_DISH_GRAMS[form.dish] / n) : 0, soup_ml: form.soup ? EST_SOUP_ML : 0,
  };
}

// 表單設定不完整、超過上限、被過敏原或飲食限制擋下、資料不在回傳原因，否則 null（沒選菜時回傳 null：還沒開始）
export function homeMealProblem(form, catalog, profile) {
  if (!form) return null;
  if (form.dishes.length === 0 && !form.soup) return null;
  if (EST_STAPLES.indexOf(form.staple) === -1) return "共餐：主食不對。";
  if (form.staple === "none" ? form.staple_size !== null : EST_SIZES.indexOf(form.staple_size) === -1) return "共餐：主食的量不對。";
  if (EST_SIZES.indexOf(form.dish) === -1) return "共餐：菜的量不對。";
  if (form.dishes.length > HOME_MEAL_DISH_MAX) return "共餐的菜最多選 " + HOME_MEAL_DISH_MAX + " 道。";
  if (new Set(form.dishes).size !== form.dishes.length) return "共餐：同一道菜不用選兩次。";
  const home = catalog.homeDishes && catalog.homeDishes.byId;
  if (!home) return "共餐：家常菜資料還沒載入。";
  const pf = profile || {};
  const bad = form.dishes.concat(form.soup ? [form.soup] : []).map(function (id) {
    const it = home[id];
    if (!it) return "共餐：「" + id + "」已不提供。";
    if ((it.kind === "soup") !== (id === form.soup)) return "共餐：菜與湯放錯位置。";
    const f = passesHardFilters(it, pf);
    return f.ok ? null : "「" + it.name + "」" + f.reason;
  }).filter(Boolean)[0];
  if (bad) return bad;
  if (form.staple !== "none") {
    const st = catalog.homeDishes.staples[form.staple];
    const item = st && treeById(catalog)[st.ref];
    if (!item) return "共餐：缺少主食資料。";
    const f = passesHardFilters(item, pf);
    if (!f.ok) return "「" + item.name + "」" + f.reason;
  }
  return null;
}

// form → draft.homeMeal（沒選任何菜或湯回傳 null）；有問題丟錯
export function homeMealDraftPart(form, catalog, profile) {
  if (!form || (form.dishes.length === 0 && !form.soup)) return null;
  const problem = homeMealProblem(form, catalog, profile);
  if (problem) throw new Error("[meal-content.js] " + problem);
  const g = homeMealGrams(form);
  const home = catalog.homeDishes.byId;
  const out = { staple: null, dishes: form.dishes.map(function (id) { return { item: home[id], amount: g.per_dish_g }; }), soup: form.soup ? { item: home[form.soup], amount: g.soup_ml } : null };
  if (form.staple !== "none") out.staple = { item: treeById(catalog)[catalog.homeDishes.staples[form.staple].ref], amount: g.staple_g };
  return out;
}

// draft.homeMeal → form（帶回選擇器用；主食種類與大小由克數與主食 ref 反推，找不到就用預設中份）
export function homeMealFormOf(homeMeal, catalog, base) {
  const b = base || { dish: "M" };
  if (!homeMeal) return { staple: "white", staple_size: "M", dish: b.dish, dishes: [], soup: null };
  const staples = (catalog.homeDishes && catalog.homeDishes.staples) || {};
  let staple = "none", size = null;
  if (homeMeal.staple) {
    staple = Object.keys(staples).filter(function (k) { return staples[k].ref === homeMeal.staple.item.uid; })[0] || "white";
    size = EST_SIZES.filter(function (s) { return EST_STAPLE_PORTIONS[s] * EST_STAPLE_G_PER_PORTION[staple] === homeMeal.staple.amount; })[0] || "M";
  }
  const n = homeMeal.dishes.length;
  const total = n > 0 ? homeMeal.dishes.reduce(function (a, d) { return a + d.amount; }, 0) : EST_DISH_GRAMS[b.dish];
  const dish = EST_SIZES.filter(function (s) { return Math.abs(EST_DISH_GRAMS[s] - total) <= n; })[0] || b.dish;
  return { staple: staple, staple_size: size, dish: dish, dishes: homeMeal.dishes.map(function (d) { return d.item.uid; }), soup: homeMeal.soup ? homeMeal.soup.item.uid : null };
}

// 共餐單品的名額（主食算 1 項單品，菜與湯另計，decisions #152）：選擇器算單品上限時用
export function homeMealItemCount(homeMeal) {
  return homeMeal ? (homeMeal.dishes || []).length + (homeMeal.soup ? 1 : 0) : 0;
}

export function homeMealFoodCount(homeMeal) {
  return homeMeal && homeMeal.staple ? 1 : 0;
}

// 當季的家常菜與湯（共餐清單）：依素菜／菜肉／純肉分組（分組只是標題），不當季的不列；
// 被過敏原或飲食限制擋的灰在該組最後、帶原因（章程 C4.1）。season 是 spring|summer|autumn|winter
export function homeMealChoices(catalog, season, profile, selectedIds) {
  const pf = profile || {};
  const picked = selectedIds || [];
  const home = (catalog.homeDishes && catalog.homeDishes.dishes) || [];
  const entry = function (it) { const f = passesHardFilters(it, pf); return { item: it, reason: f.ok ? null : f.reason, offSeason: (it.seasons || []).indexOf(season) === -1 }; };
  const order = function (rows) { return rows.filter(function (r) { return !r.reason; }).concat(rows.filter(function (r) { return r.reason; })); };
  // 當季的，加上「已選但不當季」的（例如夏天存的組合秋天帶入）：留在清單最後、標非當季，才取消得掉
  const listed = home.filter(function (d) { return (d.seasons || []).indexOf(season) !== -1 || picked.indexOf(d.id) !== -1; });
  const tail = function (rows) { return rows.filter(function (r) { return !r.offSeason; }).concat(rows.filter(function (r) { return r.offSeason; })); };
  return {
    groups: EST_CATS.map(function (cl) {
      return { cls: cl, label: EST_CAT_LABELS[cl], dishes: tail(order(listed.filter(function (d) { return d.kind === "dish" && d.class === cl; }).map(entry))) };
    }),
    soups: tail(order(listed.filter(function (d) { return d.kind === "soup"; }).map(entry))),
  };
}

// 打開共餐區塊時的預設：菜量依蛋白質目標、主食量選整餐熱量最接近這個時段配額的一格（decisions #151），其餘空白
export function homeMealDefaultForm(targets, kcalShare, catalog) {
  const d = homeEstimateDefaults(targets, kcalShare, catalog.homeDishes);
  return { staple: "white", staple_size: d.staple_size, dish: d.dish, dishes: [], soup: null };
}

// ---------- 單品（food 元件，PRD 13.4） ----------
// 品項形狀：{ uid, name, group?, state?, serving: { amount, unit: "g"|"ml" }, per_serving: { kcal, …七個欄位 } }。
// 分層品項（catalog.foodTree.items）本來就是這個形狀；我的食材由 my-ingredients.js 的 ingredientItem 轉成同一形狀
// （沒設一份的 serving.amount 與 per_serving 是 null，快照改用每 100g／100ml）。
// 量有兩種記法（decisions #136、#138）：qty（份數）或 amount（實際 g/ml，整數），元件恰好有一個。

// 份數 × 1 份的量（g 或 ml），進位到 0.1；記錄名稱與步進器旁的文字共用（PRD 13.4，章程 C2）
export function foodAmount(item, qty) {
  return round1(item.serving.amount * qty);
}

// 生的水果與油脂寫「可食部分」，不是生重（章程 B5.5）；步進器文字（foods.js）與記錄名稱共用這條判斷
export function isEdiblePortionItem(item) {
  return item.state === "raw" && (item.group === "fruit" || item.group === "fat");
}

// 記錄名稱的短狀態詞（decisions #122）：生的加「生」（可食部分的水果、油脂不加）、乾的加「乾」，熟食與液體不加
function foodNameState(item) {
  if (item.serving.unit === "ml") return "";
  // 名稱已經寫了（生）的（雞排肉（生）、衛福部的鯖魚(生)）不再重複
  if (item.state === "raw") return isEdiblePortionItem(item) || /[（(]生[）),，]/.test(item.name) ? "" : "生 ";
  return item.state === "dry" ? "乾 " : "";
}

// 衛福部查詢檔補 0 的欄位（decisions #137）→ 明細的一句；欄位名稱只在這裡（章程 C4.14）
const ZERO_FIELD_LABELS = { fiber_g: "纖維", sat_fat_g: "飽和脂肪", sodium_mg: "鈉" };
export function zeroFilledText(fields) {
  return fields && fields.length ? "衛福部沒有測" + fields.map(function (f) { return ZERO_FIELD_LABELS[f] || f; }).join("、") + "，依規則視為 0。" : null;
}

// 實際吃的量：amount（克數記法）或 1 份 × qty
export function foodEatenAmount(item, qty, amount) {
  return amount != null ? amount : foodAmount(item, qty);
}

// 「雞胸肉 生 120g」「白飯 160g」「全脂奶（自己倒） 480ml」：兩種記法同一格式
export function foodLogName(item, qty, amount) {
  return item.name + " " + foodNameState(item) + foodEatenAmount(item, qty, amount) + (item.serving.unit === "ml" ? "ml" : "g");
}

// 單品元件：快照是 1 份的量與營養（不乘份數，合計時才乘 qty 或 amount ÷ 快照的量）；沒設一份的我的食材快照是每 100g／100ml（審核 S3）
export function foodComponent(item, qty, amount) {
  const per100 = item.serving.amount == null;
  const ps = (per100 ? item.per_100g : item.per_serving) || {};
  const orNull = function (v) { return v != null ? v : null; };
  const c = { kind: "food", ref: item.uid };
  if (amount != null) c.amount = amount; else c.qty = qty;
  c.snapshot = {
    name: item.name, amount: per100 ? 100 : item.serving.amount, unit: item.serving.unit, kcal: ps.kcal,
    protein_g: orNull(ps.protein_g), carb_g: orNull(ps.carb_g), fat_g: orNull(ps.fat_g), fiber_g: orNull(ps.fiber_g),
    sat_fat_g: orNull(ps.sat_fat_g), sodium_mg: orNull(ps.sodium_mg),
  };
  return c;
}

// 元件的倍數：商品與份數記法是 qty，克數記法是 amount ÷ 快照的量
function componentFactor(c) {
  return c.kind === "food" && c.amount != null ? c.amount / c.snapshot.amount : c.qty;
}

// 選擇器的草稿 → MealContent（摘要與送出共用，看到的＝存下的）。
// draft.kind："products"（超商/外食分頁：items、estimates [{ size, name }]、drink）或 "cook"（自煮草稿，見 composeProblem）。
// draft.foods（選填）：[{ item, qty } | { item, amount }] 單品，三個分頁共用；元件順序：（食材｜品項）→ 估算 → 單品 → 飲料。
// draft.meal_type：分頁值或自煮子切換值，飲料與單品不影響（decisions #47、#83）。opts.oilHabit：基本資料的用油習慣。
// 自煮沒有食材（只有單品或飲料）時，餐型、烹調法是 null，implicit 恰好 { oil_g: 0, seasoning: null }（decisions #123）。
export function buildDraftContent(draft, opts) {
  const drink = draft.drink ? [productComponent(draft.drink, draftQty(draft, draft.drink.uid))] : [];
  const foods = homeMealParts(draft.homeMeal).concat(draft.foods || []).map(function (f) { return foodComponent(f.item, f.qty, f.amount); });
  if (draft.kind === "cook") {
    const content = contentFromCompose(draft, composePrimary(draft), composeImplicit(draft, opts && opts.oilHabit), draft.meal_type);
    if (content.components.length === 0) {
      content.archetype_id = null;
      content.method_id = null;
      content.implicit = { oil_g: 0, seasoning: null };
    }
    content.components = content.components.concat(foods, drink);
    return content;
  }
  const comps = (draft.items || []).map(function (p) { return productComponent(p, draftQty(draft, p.uid)); })
    .concat((draft.estimates || []).map(estimateFromDraft))
    .concat(foods, drink);
  return { meal_type: draft.meal_type, archetype_id: null, method_id: null, components: comps, implicit: null };
}

const _ingredientIndex = new WeakMap();

function ingredientIndex(catalog) {
  let idx = _ingredientIndex.get(catalog);
  if (!idx) {
    idx = {};
    catalog.ingredients.forEach(function (it) { idx[it.id] = it; });
    _ingredientIndex.set(catalog, idx);
  }
  return idx;
}

function ingredientById(catalog, id) {
  const it = ingredientIndex(catalog)[id];
  if (!it) throw new Error("[meal-content.js] 找不到食材：" + id);
  return it;
}

// 一餐 MealContent 的營養合計。商品、估算、單品一律用快照乘份數、不查 catalog（我的品項不在 catalog 裡）；
// 食材依 ref 查 catalog，只有主要槽位乘倍數，隱含成分不縮放。食材與商品各自加總（空的一組不放進來，
// 否則只有自煮的一餐會被標成鈉「部分無資料」），最後才進位一次。
export function contentTotals(content, catalog) {
  const ingredientParts = [];
  const productParts = [];
  content.components.forEach(function (c) {
    if (c.kind === "ingredient") {
      const it = ingredientById(catalog, c.ref);
      const serving = it.serving_g != null ? it.serving_g : 100;
      ingredientParts.push(ingredientContribution(it, serving * (c.is_primary ? (c.scale || 1) : 1)));
    } else {
      productParts.push(productPart(c.snapshot, componentFactor(c)));
    }
  });
  // 隱含成分只跟著食材（decisions #123）：只有單品、飲料的自煮一餐不加，跟同樣內容的超商紀錄合計相同
  if (content.implicit && ingredientParts.length > 0) ingredientParts.push(implicitContribution(content.implicit, catalog.implicit));
  const groups = [];
  if (ingredientParts.length > 0) groups.push(addContributions(ingredientParts));
  if (productParts.length > 0) groups.push(addContributions(productParts));
  return roundTotals(addContributions(groups));
}

// 一筆 daily_log（一筆一餐）。totals 是記錄當下的營養快照，食材資料之後修正也不回溯。
export function buildLogEntry(o) {
  return {
    log_date: o.date,
    slot: o.slot,
    meal_type: o.content.meal_type,
    source: o.source,
    name: o.name,
    content: o.content,
    totals: {
      kcal: o.totals.kcal,
      protein_g: o.totals.protein_g,
      carb_g: o.totals.carb_g,
      fat_g: o.totals.fat_g,
      fiber_g: o.totals.fiber_g,
      sat_fat_g: o.totals.sat_fat_g != null ? o.totals.sat_fat_g : null,
      sodium_mg: o.totals.sodium_mg != null ? o.totals.sodium_mg : null,
      partial: Array.isArray(o.totals.partial) ? o.totals.partial.slice() : [],
    },
    created_at: o.createdAt,
  };
}

// 選擇器草稿的記錄名稱（原本在 ui/meal-picker/index.js）：自煮＝餐型＋食材＋單品＋飲料（沒選餐型就從單品開始）；
// 商品＝各品項（帶份量）＋估算＋單品＋飲料，以「＋」串接。
// 份量：「便當（半份）」「茶葉蛋 ×2」（PRD 12.3）；單品寫量不寫份數：「白飯 160g」（PRD 13.4）。
export function draftLogName(d) {
  const withQty = function (p) {
    const q = draftQty(d, p.uid);
    return p.name + (q === 0.5 ? "（半份）" : q !== 1 ? " " + qtyLabel(q) : "");
  };
  const tail = (d.foods || []).map(function (f) { return foodLogName(f.item, f.qty, f.amount); }).concat(d.drink ? [withQty(d.drink)] : []);
  const homeNames = homeMealParts(d.homeMeal).filter(function (f) { return isHomeDishRef(f.item.uid); }).map(function (f) { return f.item.name; });
  if (homeNames.length > 0) tail.unshift("共餐：" + homeNames.join("＋")); // 記錄名稱不寫克數（decisions #152）
  if (d.kind === "cook") {
    return (d.archetype ? [d.archetype.name] : []).concat(draftIngredients(d).map(function (it) { return it.name; }), tail).join("＋");
  }
  return d.items.map(withQty).concat(d.estimates.map(function (x) { return x.name || "外食估算"; }), tail).join("＋");
}

// ---------- B-1a：複製成我的版本（PRD 10.2、decisions #61；有鈉與飽和脂肪，放在這裡，章程 C4.14） ----------

// 內建品項 → PRD 10.1 的我的品項記錄（「複製成我的版本」的預帶值；時間戳與 id 由 db 補）。
// 內建的過敏原「未確認」→ null（我的品項用 null 表示未確認）；note 只留內容物描述，不帶資料來源說明。
export function copyFromBuiltin(p) {
  const tags = Array.isArray(p.allergen_tags) ? p.allergen_tags : null;
  const orNull = function (v) { return v != null ? v : null; };
  return {
    name: p.name, channel: p.channel, role: p.role, valid_slots: (p.valid_slots || []).slice(), kcal: p.kcal,
    protein_g: orNull(p.protein_g), carb_g: orNull(p.carb_g), fat_g: orNull(p.fat_g), fiber_g: orNull(p.fiber_g),
    sat_fat_g: orNull(p.sat_fat_g), sodium_mg: orNull(p.sodium_mg),
    vendor: orNull(p.vendor), category: orNull(p.category), note: p.is_taiwan ? null : contentNote(p.note),
    allergen_tags: !tags || tags.indexOf(UNVERIFIED_ALLERGEN) !== -1 ? null : tags.slice(),
    vegan: (p.diet_tags || []).indexOf("全素") !== -1,
    lacto_ovo: (p.diet_tags || []).indexOf("蛋奶素") !== -1,
    copied_from: p.uid,
  };
}

const BUILTIN_VALUE_KEYS = ["kcal", "protein_g", "carb_g", "fat_g", "fiber_g", "sat_fat_g", "sodium_mg"];

// 複製來的我的品項：內建目前的數值（decisions #61）。內建已查不到回傳 null（章程 B9）。
export function builtinCurrentValues(copiedFrom, productsByUid) {
  const p = copiedFrom && productsByUid ? productsByUid[copiedFrom] : null;
  if (!p) return null;
  const out = { name: p.name, allergen_tags: Array.isArray(p.allergen_tags) ? p.allergen_tags.slice() : [UNVERIFIED_ALLERGEN] };
  BUILTIN_VALUE_KEYS.forEach(function (k) { out[k] = p[k] != null ? p[k] : null; });
  return out;
}

// ---------- 我的組合（saved_meals，PRD 11、12.6；decisions #124、#125） ----------
// 組合是單餐範本：只存 ref 與份量，營養、角色每次從 catalog 與我的品項讀。推薦、統計、hero 不讀（章程 C4.16）。
// ctx = { hidden: 隱藏的內建品項 uid, customs: 轉好的我的品項（含已封存的）, slot: 時段或 null, profile }。
// 切片 8、9 再往 ctx 加我的食材、我的料理、衛福部查詢檔（不改簽名）。

function isCookType(t) {
  return t === "cook_quick" || t === "cook_full";
}

// 紀錄或草稿的 MealContent → 組合的內容（PRD 11.1）：去掉快照、角色、縮放倍數；估算不能存（呼叫端先擋）。
// keepImplicit：使用者在選擇器裡改過用油／調味才保留，否則 null（引用時套用當下的預設）
export function toSavedContent(content, opts) {
  const comps = content.components.map(function (c) {
    if (c.kind === "ingredient") {
      const o = { kind: "ingredient", axis: c.axis, ref: c.ref };
      if (c.is_primary === true) o.is_primary = true;
      return o;
    }
    if (c.kind === "product") return { kind: c.kind, ref: c.ref, qty: c.qty != null ? c.qty : 1 };
    // 單品原樣帶 qty 或 amount，不補預設（審核 M3）
    if (c.kind === "food") return c.amount != null ? { kind: "food", ref: c.ref, amount: c.amount } : { kind: "food", ref: c.ref, qty: c.qty };
    throw new Error("[meal-content.js] 我的組合不能含「" + c.kind + "」元件");
  });
  const imp = opts && opts.keepImplicit && content.implicit ? { oil_g: content.implicit.oil_g, seasoning: content.implicit.seasoning } : null;
  return {
    meal_type: content.meal_type, archetype_id: content.archetype_id || null, method_id: content.method_id || null,
    components: comps, implicit: imp,
  };
}

function customsByUid(ctx) {
  const out = {};
  ((ctx && ctx.customs) || []).forEach(function (c) { out[c.uid] = c; });
  return out;
}

// 單品查詢表：分層品項＋內建家常菜（hd_，家庭共餐，decisions #152），組合、預約的解析共用
const _treeIndex = new WeakMap();
function treeById(catalog) {
  if (!_treeIndex.has(catalog)) {
    const home = (catalog.homeDishes && catalog.homeDishes.byId) || {};
    _treeIndex.set(catalog, Object.assign({}, home, (catalog.foodTree && catalog.foodTree.byId) || {}));
  }
  return _treeIndex.get(catalog);
}

export function isHomeDishRef(ref) {
  return typeof ref === "string" && ref.indexOf(HOME_DISH_PREFIX) === 0;
}

// 我的食材的紀錄（ctx.customIngredients：custom_ingredients 原始紀錄，含已刪除的自填）。
// fail-closed（審核 M6）：遇到 cing_ 的 ref 而 ctx 沒帶我的食材，丟錯，不能當成查不到丟掉（會讓組合悄悄掉品項）
function myIngredientRec(ctx, ref) {
  if (!ctx || !Array.isArray(ctx.customIngredients)) throw new Error("[meal-content.js] 解析含我的食材的組合要傳 ctx.customIngredients（" + ref + "）");
  return ctx.customIngredients.filter(function (r) { return r.id === ref; })[0] || null;
}
function isMyIngredientRef(ref) {
  return typeof ref === "string" && ref.indexOf("cing_") === 0;
}

// 規則 1–2（PRD 11.3）：查不到、已封存 → 丟；隱藏的內建品項有未封存的複製版本 → 換成它，否則丟。建立與引用共用。
// 回傳 { content, dropped: [{ kind, ref, name }] }（name 查得到就用現在的名稱，查不到用 ref）
export function remapSavedRefs(content, catalog, ctx) {
  const hidden = (ctx && ctx.hidden) || [];
  const customs = (ctx && ctx.customs) || [];
  const own = customsByUid(ctx);
  const ingIdx = ingredientIndex(catalog);
  const tree = treeById(catalog);
  const comps = [];
  const dropped = [];
  const drop = function (c, name) { dropped.push({ kind: c.kind, ref: c.ref, name: name || c.ref }); };
  content.components.forEach(function (c) {
    if (c.kind === "estimate") { comps.push(c); return; } // 只有預約會有（自帶快照，不查資料）
    if (c.kind === "ingredient") { if (ingIdx[c.ref]) comps.push(c); else drop(c); return; }
    if (c.kind === "food") {
      if (tree[c.ref]) { comps.push(c); return; }
      if (!isMyIngredientRef(c.ref)) { drop(c); return; }
      const rec = myIngredientRec(ctx, c.ref);
      // 衛福部來源被移除（不吃）＝紀錄不在；自填已刪除＝archived（再加回／還原就恢復）
      if (rec && rec.archived !== true) comps.push(c); else drop(c, rec ? rec.name : null);
      return;
    }
    if (c.kind !== "product") { drop(c); return; }
    const builtin = catalog.productsByUid[c.ref];
    if (builtin) {
      if (hidden.indexOf(c.ref) === -1) { comps.push(c); return; }
      const copy = customs.filter(function (x) { return !x.archived && x.copied_from === c.ref; })[0];
      if (copy) comps.push(Object.assign({}, c, { ref: copy.uid })); else drop(c, builtin.name);
      return;
    }
    const mine = own[c.ref];
    if (mine && !mine.archived) comps.push(c); else drop(c, mine ? mine.name : null);
  });
  const out = Object.assign({}, content, { components: comps });
  // 自煮的食材全部被丟掉時，跟「沒有食材的自煮」同一個形狀（沒有餐型、烹調法，implicit null，decisions #123）
  if (isCookType(content.meal_type) && !comps.some(function (c) { return c.kind === "ingredient"; })) {
    out.archetype_id = null; out.method_id = null; out.implicit = null;
  }
  return { content: out, dropped: dropped };
}

const SAVED_AXIS_MAX = { protein: COMPOSE_MAX.protein, vegetable: COMPOSE_MAX.vegetable, staple: 1, seasoning: 1 };

// 解析一個組合（PRD 11.3，所有引用都經過這裡）。saved：組合紀錄或它的 content。
// 回傳 { meal_type, archetype, method, implicit, available: [{ component, item }], blocked: [{ component, name, reason }], gone: [{ kind, ref, name }], notes }
// 規則 3 硬性過濾；規則 4 只在有食材時依目前骨架重驗（烹調法不是元件，失效時 method 為 null＋notes；快煮難度不在這裡擋）；
// 規則 5 角色依 catalog 當下的 role 與 ctx.slot（null＝主餐 2），單品比 FOOD_MAX_PER_MEAL；都依 components 順序擋後者。
export function resolveSavedMeal(saved, catalog, ctx) {
  const content = saved && saved.content ? saved.content : saved;
  const r = remapSavedRefs(content, catalog, ctx);
  const profile = (ctx && ctx.profile) || {};
  const slot = ctx && ctx.slot !== undefined ? ctx.slot : null;
  const ingIdx = ingredientIndex(catalog);
  const own = customsByUid(ctx);
  const tree = treeById(catalog);
  const cook = isCookType(content.meal_type);
  const comps = r.content.components;
  const hasIngredient = comps.some(function (c) { return c.kind === "ingredient"; });
  const notes = [];
  let archetype = null;
  let method = null;
  if (cook && hasIngredient) {
    archetype = catalog.archetypes.filter(function (a) { return a.id === content.archetype_id; })[0] || null;
    method = content.method_id ? ingIdx[content.method_id] || null : null;
    if (archetype && method && (archetype.methods || []).indexOf(method.id) === -1) {
      notes.push("烹調法「" + method.name + "」目前不在這個餐型，請重選");
      method = null;
    } else if (archetype && content.method_id && !method) {
      notes.push("原本的烹調法已不提供，請重選");
    }
  }
  const available = [];
  const blocked = [];
  const block = function (c, item, reason) { blocked.push({ component: c, name: item ? item.name : c.ref, reason: reason }); };
  const axisCount = {};
  const roleItems = [];
  let foods = 0;
  let homeDishes = 0;
  let homeSoups = 0;
  comps.forEach(function (c) {
    if (c.kind === "ingredient") {
      const it = ingIdx[c.ref];
      if (!cook) { block(c, it, "這個型態不能放自煮的食材"); return; }
      if (!archetype) { block(c, it, "這個餐型已不提供"); return; }
      const f = ingredientFilterResult(it, c.axis, profile);
      if (!f.ok) { block(c, it, f.reason); return; }
      if (((archetype[c.axis] && archetype[c.axis].allow) || []).indexOf(c.ref) === -1) { block(c, it, "這個餐型目前不提供這個食材"); return; }
      const max = SAVED_AXIS_MAX[c.axis] || 1;
      if ((axisCount[c.axis] || 0) >= max) { block(c, it, AXIS_LABELS[c.axis] + "最多選 " + max + " 個"); return; }
      if (noCookViolation(method, [it])) { block(c, it, "免開火不能搭配需要加熱的食材"); return; }
      axisCount[c.axis] = (axisCount[c.axis] || 0) + 1;
      available.push({ component: c, item: it });
      return;
    }
    if (c.kind === "food") {
      let it = tree[c.ref];
      if (!it) {
        const rec = myIngredientRec(ctx, c.ref);
        if (rec.source === "tfda" && !(ctx.tfdaLookup && ctx.tfdaLookup.byId)) { block(c, rec, "衛福部資料載入失敗，請稍後再試"); return; }
        it = ingredientItem(rec, ctx.tfdaLookup);
        if (!it) { block(c, rec, "衛福部資料已不提供"); return; }
      }
      // 份數記法但那項我的食材沒有設一份：擋下，不自動換成克數（審核 M5）
      if (c.amount == null && it.serving.amount == null) { block(c, it, "沒有設一份，請改用克數"); return; }
      const f = passesHardFilters(it, profile);
      if (!f.ok) { block(c, it, f.reason); return; }
      if (isHomeDishRef(c.ref)) {
        // 家庭共餐的菜與湯另計上限（decisions #152），不佔單品的名額
        if (it.kind === "soup" ? homeSoups >= HOME_MEAL_SOUP_MAX : homeDishes >= HOME_MEAL_DISH_MAX) { block(c, it, it.kind === "soup" ? "共餐的湯最多選 " + HOME_MEAL_SOUP_MAX + " 道" : "共餐的菜最多選 " + HOME_MEAL_DISH_MAX + " 道"); return; }
        if (it.kind === "soup") homeSoups++; else homeDishes++;
        available.push({ component: c, item: it });
        return;
      }
      if (foods >= FOOD_MAX_PER_MEAL) { block(c, it, foodLimitProblem(foods + 1)); return; }
      foods++;
      available.push({ component: c, item: it });
      return;
    }
    if (c.kind === "estimate") { available.push({ component: c, item: null }); return; } // 預約的估算（喜宴、聚餐）：沒有成分可查
    const p = catalog.productsByUid[c.ref] || own[c.ref];
    if (cook && p.role !== "drink") { block(c, p, "自煮的一餐只能帶飲料"); return; }
    const f = passesHardFilters(p, profile);
    if (!f.ok) { block(c, p, f.reason); return; }
    if (!canAddManualItem(roleItems, p, slot)) { block(c, p, manualSelectionProblem(roleItems.concat([p]), slot)); return; }
    roleItems.push(p);
    available.push({ component: c, item: p });
  });
  return {
    meal_type: content.meal_type, archetype: archetype, method: method,
    implicit: content.implicit ? { oil_g: content.implicit.oil_g, seasoning: content.implicit.seasoning } : null,
    available: available, blocked: blocked, gone: r.dropped, notes: notes,
  };
}

// 解析結果 → buildDraftContent 吃的草稿（選擇器帶入與日期切換的預選共用；只放可用元件）。
// 自煮的食材是 catalog.ingredients 裡的同一批物件（選擇器的 catalog.proteins 等清單也是，自煮分頁以物件比對選取）；
// 主要槽位從 1 倍開始（decisions #124），is_primary 不用，由 composePrimary 重算
export function savedMealDraft(resolved) {
  const cook = isCookType(resolved.meal_type);
  const d = { kind: cook ? "cook" : "products", meal_type: resolved.meal_type, items: [], estimates: [], drink: null, qtyByUid: {}, foods: [] };
  if (cook) {
    Object.assign(d, {
      archetype: resolved.archetype, proteins: [], staple: null, vegetables: [], seasoning: null, method: resolved.method, primaryScale: chosenPrimaryScale(resolved),
      implicitOverride: resolved.implicit ? { oil_g: resolved.implicit.oil_g, seasoning: resolved.implicit.seasoning } : {},
    });
  }
  const firstHome = resolved.available.findIndex(function (a) { return a.component.kind === "food" && isHomeDishRef(a.component.ref); });
  resolved.available.forEach(function (a, idx) {
    const c = a.component;
    if (c.kind === "food" && isHomeDishRef(c.ref)) {
      // 共餐：菜與湯進 homeMeal，緊接在第一道菜前的主食元件也歸共餐（元件順序固定：主食、各道菜、湯）
      d.homeMeal = d.homeMeal || { staple: null, dishes: [], soup: null };
      const part = { item: a.item, amount: c.amount };
      if (a.item.kind === "soup") d.homeMeal.soup = part; else d.homeMeal.dishes.push(part);
      return;
    }
    if (c.kind === "food" && firstHome > 0 && idx === firstHome - 1 && c.amount != null && isHomeStapleItem(a.item)) {
      d.homeMeal = d.homeMeal || { staple: null, dishes: [], soup: null };
      d.homeMeal.staple = { item: a.item, amount: c.amount };
      return;
    }
    if (c.kind === "ingredient") {
      if (c.axis === "protein") d.proteins.push(a.item);
      else if (c.axis === "vegetable") d.vegetables.push(a.item);
      else d[c.axis] = a.item;
    } else if (c.kind === "food") {
      d.foods.push(c.amount != null ? { item: a.item, amount: c.amount } : { item: a.item, qty: c.qty });
    } else if (c.kind === "estimate") {
      const draftEst = { size: c.size, name: c.name };
      if (c.snapshot) draftEst.snapshot = Object.assign({}, c.snapshot);
      if (c.est) draftEst.est = copyEst(c.est);
      d.estimates.push(draftEst);
    } else {
      if (a.item.role === "drink") d.drink = a.item; else d.items.push(a.item);
      if (c.qty !== 1) d.qtyByUid[a.item.uid] = c.qty;
    }
  });
  return d;
}

// 預約的主要槽位倍數：使用者選的（存在主要槽位的元件上）；組合沒有這個欄位，一律 1 倍
function chosenPrimaryScale(resolved) {
  const hit = resolved.available.filter(function (a) {
    return a.component.kind === "ingredient" && a.component.is_primary === true && isNum(a.component.scale);
  })[0];
  return hit ? hit.component.scale : 1;
}

// ---------- 預約（meal_plan，PRD 第 1、3 節；decisions #140–#142） ----------

// 「這餐不吃」的預約內容
export const PLAN_SKIP_CONTENT = { skip: true, meal_type: null, archetype_id: null, method_id: null, implicit: null, components: [] };

export function isSkipPlan(content) {
  return !!(content && content.skip === true);
}

// 選擇器的草稿內容 → 預約的儲存格式：組合的格式（只存 ref 與份量）＋估算帶快照＋主要槽位存使用者選的倍數（不是 1 才存）
export function toPlanContent(content, opts) {
  const rest = content.components.filter(function (c) { return c.kind !== "estimate"; });
  const base = toSavedContent(Object.assign({}, content, { components: rest }), opts);
  let i = 0;
  const comps = content.components.map(function (c) {
    if (c.kind === "estimate") {
      const o = { kind: "estimate", name: c.name, size: c.size != null ? c.size : null, snapshot: Object.assign({}, c.snapshot) };
      if (c.est) o.est = copyEst(c.est);
      return o;
    }
    const o = base.components[i++];
    if (o.kind === "ingredient" && o.is_primary === true && isNum(c.scale) && c.scale !== 1) o.scale = c.scale;
    return o;
  });
  return Object.assign(base, { components: comps });
}

// 解析一筆預約（ctx 同 resolveSavedMeal，ctx.slot 用預約的時段）。
// 回傳 { status: "skip" | "ok" | "invalid", resolved, totals }：任何元件被擋或已不提供＝整筆失效（不扣預算、該時段改推薦，設計草案第 9 節 M9）
export function resolvePlan(plan, catalog, ctx, oilHabit) {
  if (isSkipPlan(plan.content)) return { status: "skip", resolved: null, totals: zeroTotals() };
  const resolved = resolveSavedMeal(plan.content, catalog, Object.assign({}, ctx, { slot: plan.slot }));
  if (resolved.blocked.length > 0 || resolved.gone.length > 0 || resolved.notes.length > 0 || resolved.available.length === 0) {
    return { status: "invalid", resolved: resolved, totals: null };
  }
  return { status: "ok", resolved: resolved, totals: savedMealTotals(resolved, catalog, oilHabit) };
}

function zeroTotals() {
  return { kcal: 0, protein_g: 0, carb_g: 0, fat_g: 0, fiber_g: 0, sat_fat_g: 0, sodium_mg: 0, partial: [] };
}

// 今天沒有紀錄的時段的有效預約 → 暫時紀錄（只給預算、推薦、全天缺口用；不寫資料庫、不進統計，章程 C4.10）
export function planPseudoLog(plan, result) {
  if (!result || result.status === "invalid") return null;
  const content = result.status === "skip" ? { meal_type: null, archetype_id: null, method_id: null, components: [], implicit: null }
    : buildDraftContent(savedMealDraft(result.resolved));
  return { log_date: plan.date, slot: plan.slot, content: content, totals: result.totals, planned: true, skip: result.status === "skip" };
}

// 「這餐沒吃」紀錄（source skipped，decisions #140⑥）
export function skippedLogEntry(date, slot, createdAt) {
  return {
    log_date: date, slot: slot, meal_type: null, source: "skipped", name: "這餐沒吃",
    content: { meal_type: null, archetype_id: null, method_id: null, components: [], implicit: null },
    totals: zeroTotals(), created_at: createdAt,
  };
}

// ---------- 昨天的餐（隔天確認，PRD 6.1、decisions #140⑤、#142） ----------

// 推薦 → 紀錄用的三樣東西（今天「記錄這餐」與昨天「吃了」共用；推薦卡片當下也存一份給隔天用）
export function recLogParts(rec, productsByUid) {
  return {
    name: rec.name,
    content: contentFromRec(rec, productsByUid),
    totals: {
      kcal: rec.scaled_kcal, protein_g: rec.protein_g, carb_g: rec.carb_g, fat_g: rec.fat_g, fiber_g: rec.fiber_g,
      sat_fat_g: rec.sat_fat_g, sodium_mg: rec.sodium_mg, partial: rec.partial,
    },
  };
}

// 今天畫面上每個時段「最後顯示的推薦」（隔天昨天卡片用，只留真的有卡片的時段；沒有組合或配額太低的不算）
export function lastShownSlots(recs, productsByUid) {
  const out = {};
  Object.keys(recs || {}).forEach(function (slot) {
    const rec = recs[slot];
    if (!rec || rec.lowBudget) return;
    out[slot] = recLogParts(rec, productsByUid);
  });
  return out;
}

const RECALL_SIZE_NAME = { S: "小", M: "中", L: "大" };

export function recallEstimateKcal(slot, size) {
  const group = ESTIMATE_RECALL_KCAL[ESTIMATE_RECALL_GROUP[slot]];
  if (!group || !group.hasOwnProperty(size)) throw new Error("[meal-content.js] 回想估算的時段或份量不對：" + slot + "／" + size);
  return group[size];
}

// 昨天（或補記）按 S／M／L：一筆 estimate 元件（外食型態、名稱「估算（中）」），熱量依時段（decisions #142④），其餘營養素未知
export function recallEstimateLogEntry(date, slot, size, createdAt) {
  const kcal = recallEstimateKcal(slot, size);
  const comp = {
    kind: "estimate", name: "估算（" + RECALL_SIZE_NAME[size] + "）", size: size,
    snapshot: { kcal: kcal, protein_g: null, carb_g: null, fat_g: null, fiber_g: null, sat_fat_g: null, sodium_mg: null },
  };
  const content = { meal_type: "delivery", archetype_id: null, method_id: null, components: [comp], implicit: null };
  return buildLogEntry({ date: date, slot: slot, source: "backfill", name: comp.name, content: content, totals: contentTotals(content, null), createdAt: createdAt });
}

// 昨天卡片的列（純函式）：開啟中、昨天沒有紀錄的時段各一列。
//   kind "plan"（有效預約：內容｜吃了｜改）、"plan_skip"（預約不吃：一鍵確認）、"rec"（昨天最後顯示的推薦）、"none"（只有 S／M／L）
// o：{ date, enabledSlots, logs（昨天的紀錄）, plans（slot → { plan, result }，失效的預約當沒有）, lastShown（getLastShownRecs 的值或 null） }
export function yesterdayRows(o) {
  const logged = {};
  (o.logs || []).forEach(function (l) { logged[l.slot] = true; });
  const ls = o.lastShown;
  const shown = ls && ls.date === o.date ? ls.slots : ls && ls.prev && ls.prev.date === o.date ? ls.prev.slots : {};
  const rows = [];
  SLOTS.forEach(function (slot) {
    if (logged[slot] || !isSlotEnabled(o.enabledSlots, slot)) return;
    const e = o.plans && o.plans[slot];
    if (e && e.result.status === "skip") { rows.push({ slot: slot, kind: "plan_skip", name: "這餐不吃（預約）", kcal: 0 }); return; }
    if (e && e.result.status === "ok") { rows.push({ slot: slot, kind: "plan", name: e.plan.name, kcal: Math.round(e.result.totals.kcal) }); return; }
    const r = shown && shown[slot];
    if (r) { rows.push({ slot: slot, kind: "rec", name: r.name, kcal: Math.round(r.totals.kcal) }); return; }
    rows.push({ slot: slot, kind: "none", name: null, kcal: null });
  });
  return rows;
}

// 組合卡片的熱量＝帶入後選擇器摘要的合計（主要槽位 1 倍，decisions #124）
export function savedMealTotals(resolved, catalog, oilHabit) {
  return contentTotals(buildDraftContent(savedMealDraft(resolved), { oilHabit: oilHabit }), catalog);
}

// 預設名稱與卡片的內容小字：品名以「＋」串接、不寫量（decisions #124）。自煮＝餐型名＋食材名；查不到的略過（章程 B9）
export function savedMealDefaultName(content, catalog, ctx) {
  const ingIdx = ingredientIndex(catalog);
  const own = customsByUid(ctx);
  const tree = treeById(catalog);
  const names = [];
  if (isCookType(content.meal_type) && content.archetype_id) {
    const a = catalog.archetypes.filter(function (x) { return x.id === content.archetype_id; })[0];
    if (a && content.components.some(function (c) { return c.kind === "ingredient"; })) names.push(a.name);
  }
  content.components.forEach(function (c) {
    const it = c.kind === "ingredient" ? ingIdx[c.ref] : c.kind === "food" ? (tree[c.ref] || (isMyIngredientRef(c.ref) ? myIngredientRec(ctx, c.ref) : null))
      : catalog.productsByUid[c.ref] || own[c.ref];
    if (it) names.push(it.name);
  });
  return names.join("＋");
}

// 存檔前的語意驗證（入口 1、入口 2、編輯模式共用；ctx.slot 用 null）：有被擋、已不提供，或沒有可用元件時回原因清單，否則 null
export function savedMealProblem(resolved) {
  const lines = resolved.blocked.map(function (b) { return "「" + b.name + "」：" + b.reason; })
    .concat(resolved.gone.map(function (g) { return "「" + g.name + "」：已不提供"; }))
    .concat(resolved.notes);
  if (resolved.available.length === 0) lines.unshift("沒有可以存的品項。");
  return lines.length > 0 ? lines : null;
}

// 存檔前（入口 1、入口 2、編輯模式共用）：toSavedContent 的結果 → 規則 1–2 改寫 → 沒有時段的語意驗證。
// 回傳 { content: 要寫進資料庫的內容, dropped: 已不提供而沒存進去的, problems: 不能存的原因清單或 null }
export function savedMealForSave(savedContent, catalog, ctx) {
  const r = remapSavedRefs(savedContent, catalog, ctx);
  const resolved = resolveSavedMeal(r.content, catalog, Object.assign({}, ctx, { slot: null }));
  return { content: r.content, dropped: r.dropped, problems: savedMealProblem(resolved) };
}

// 卡片上的一行（PRD 11.3）：「有 N 項目前不能用：原因、原因」；全部能用回 null
export function savedMealUnavailableLine(resolved) {
  const n = resolved.blocked.length + resolved.gone.length;
  if (n === 0) return null;
  const reasons = [];
  resolved.blocked.forEach(function (b) { if (reasons.indexOf(b.reason) === -1) reasons.push(b.reason); });
  if (resolved.gone.length > 0) reasons.push("已不提供");
  return "有 " + n + " 項目前不能用：" + reasons.join("、");
}
