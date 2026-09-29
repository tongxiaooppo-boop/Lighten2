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
  PRIMARY_SLOT_SCALE_RANGE, COOKING_OIL_ID, OIL_HABIT_FACTOR, SEASONING_IDS, NO_COOK_METHOD_ID, COMPOSE_MAX, ESTIMATE_SIZE_KCAL,
  ROLE_LABELS, tierRank, isQuickTier, manualRoleMax,
} from "../core/config.js";
import { SLOT_LABELS } from "../core/slots.js";
import { round1, isNum } from "../core/num.js";

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

// 可以送出回傳 null，否則回傳原因。opts.estimates：這一餐的「直接估算」筆數（不佔角色名額，但算有選東西）
export function manualSelectionProblem(items, slot, opts) {
  const estimates = (opts && opts.estimates) || 0;
  if (items.length === 0 && estimates === 0) return "請至少選一個品項。";
  const n = roleCounts(items);
  const over = Object.keys(n).filter(function (r) { return n[r] > manualRoleMax(r, slot); })[0];
  if (!over) return null;
  return (SLOT_LABELS[slot] ? SLOT_LABELS[slot] + "的" : "") + (ROLE_LABELS[over] || over) + "最多選 " + manualRoleMax(over, slot) + " 個。";
}

export function canAddManualItem(items, item, slot) {
  return (roleCounts(items)[item.role] || 0) < manualRoleMax(item.role, slot);
}

// 自己選的單餐缺口提示：熱量超出份額多少、蛋白質/纖維還差多少（share 來自 budget.js slotNutrientShare）
export function slotGaps(share, totals) {
  return {
    overKcal: Math.round(totals.kcal - share.kcalShare),
    proteinGap: Math.round((share.proteinShare - (totals.protein_g || 0)) * 10) / 10,
    fiberGap: Math.round((share.fiberShare - (totals.fiber_g || 0)) * 10) / 10,
  };
}

// 營養缺口的「可以考慮加」：配菜/飲料/點心裡，這個欄位每 100 kcal 含量最高的前 3 個，
// 加進去後熱量不超過單餐份額 +100。
export function suggestFillers(passItems, selItems, gap, field, share) {
  const out = [];
  passItems.forEach(function (it) {
    if (selItems.indexOf(it) !== -1) return;
    if (["side", "drink", "snack"].indexOf(it.role) === -1) return;
    if (it[field] == null || it[field] <= 0) return;
    const cur = sumProducts(selItems);
    if (cur.kcal + (it.kcal || 0) > share.kcalShare + 100) return;
    const per100 = it[field] / Math.max(1, it.kcal || 100) * 100;
    out.push({ label: it.name + "（+" + Math.round(it[field]) + "g）", score: per100 });
  });
  out.sort(function (a, b) { return b.score - a.score; });
  return out.slice(0, 3).map(function (o) { return o.label; });
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

// 自煮草稿：d = { archetype, proteins: [], staple, vegetables: [], seasoning, method, primaryScale, drink }
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

// 自煮草稿能不能送出：回傳原因或 null。順序固定：餐型不完整 → 免開火（食安優先顯示）→ 骨架 allow → 軸上限 → 快煮難度。
export function composeProblem(d, opts) {
  const a = d.archetype;
  if (!a) return "請先選餐型";
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

// 自煮的隱含成分：目前一律用預設（用油與調味的選項在 Phase 0 的自煮分頁）
export function composeImplicit(d, oilHabit) {
  return defaultImplicit(d.method, d.archetype, onAxis(d, "vegetable").length > 0, !!d.seasoning, oilHabit);
}

// 不進位的自煮合計。primary＝被縮放的那個食材（composePrimary）；implicit：composeImplicit 的結果；implicitItems：catalog.implicit。
// 食材與飲料任一項某欄未知，合計那一欄就是 null。
function composeContributions(d, primary, implicit, implicitItems) {
  const parts = draftIngredients(d).map(function (it) {
    const serving = it.serving_g != null ? it.serving_g : 100;
    return ingredientContribution(it, serving * (it === primary ? (d.primaryScale || 1) : 1));
  });
  parts.push(implicitContribution(implicit, implicitItems));
  if (d.drink) parts.push(productPart(d.drink, 1));
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

function productComponent(p) {
  return { kind: "product", role: p.role, ref: p.uid, qty: 1, snapshot: productSnapshot(p) };
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

// 自己選的現成品項 → MealContent。型態看第一個主餐（沒有主餐看第一件）的來源。
// −1a 過渡：v1 的自訂食物沒有 channel，暫算外食；Phase 0 起「我的品項」用自己的 channel（PRD 10.1）。
export function contentFromProducts(items) {
  const lead = items.filter(function (it) { return it.role === "main"; })[0] || items[0];
  return {
    meal_type: lead && lead.channel === "convenience" ? "convenience" : "delivery",
    archetype_id: null, method_id: null,
    components: items.map(productComponent),
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
  if (d.drink) comps.push(productComponent(d.drink));
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

// 選擇器的草稿 → MealContent（摘要與送出共用，看到的＝存下的）。
// draft.kind："products"（超商/外食分頁：items、estimates [{ size, name }]、drink）或 "cook"（自煮草稿，見 composeProblem）。
// draft.meal_type：分頁值或自煮子切換值，飲料不影響（decisions #47）。opts.oilHabit：基本資料的用油習慣。
export function buildDraftContent(draft, opts) {
  if (draft.kind === "cook") {
    const implicit = composeImplicit(draft, opts && opts.oilHabit);
    return contentFromCompose(draft, composePrimary(draft), implicit, draft.meal_type);
  }
  const comps = (draft.items || []).map(productComponent)
    .concat((draft.estimates || []).map(function (e) { return estimateComponent(e.size, e.name); }))
    .concat(draft.drink ? [productComponent(draft.drink)] : []);
  return { meal_type: draft.meal_type, archetype_id: null, method_id: null, components: comps, implicit: null };
}

const _ingredientIndex = new WeakMap();

function ingredientById(catalog, id) {
  let idx = _ingredientIndex.get(catalog);
  if (!idx) {
    idx = {};
    catalog.ingredients.forEach(function (it) { idx[it.id] = it; });
    _ingredientIndex.set(catalog, idx);
  }
  const it = idx[id];
  if (!it) throw new Error("[meal-content.js] 找不到食材：" + id);
  return it;
}

// 一餐 MealContent 的營養合計。商品與估算一律用快照乘份數、不查 catalog（我的品項不在 catalog 裡）；
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
      productParts.push(productPart(c.snapshot, c.qty));
    }
  });
  if (content.implicit) ingredientParts.push(implicitContribution(content.implicit, catalog.implicit));
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
