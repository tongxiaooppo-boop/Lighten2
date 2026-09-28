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

import { PRIMARY_SLOT_SCALE_RANGE, MANUAL_ROLE_MAX, COOKING_OIL_ID, OIL_HABIT_FACTOR, SEASONING_IDS, tierRank } from "../core/config.js";
import { round1, isNum } from "../core/num.js";

export const NUTRIENT_FIELDS = ["protein_g", "carb_g", "fat_g", "fiber_g"];
const CONTRIB_FIELDS = ["kcal"].concat(NUTRIENT_FIELDS);
// 只用於顯示的欄位（不 null 傳染）
export const DISPLAY_FIELDS = ["sat_fat_g", "sodium_mg"];


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

// 熱量是現成品項與我的品項的必填欄位（章程 B4、B8），不會是 null
export function sumProducts(items) {
  const display = addContributions(items.map(function (it) { return { sat_fat_g: it.sat_fat_g, sodium_mg: it.sodium_mg }; }));
  return {
    kcal: round1(items.reduce(function (s, it) { return s + it.kcal; }, 0)),
    protein_g: sumOrNull(items, "protein_g"),
    carb_g: sumOrNull(items, "carb_g"),
    fat_g: sumOrNull(items, "fat_g"),
    fiber_g: sumOrNull(items, "fiber_g"),
    sat_fat_g: round1OrNull(display.sat_fat_g),
    sodium_mg: round1OrNull(display.sodium_mg),
    partial: display.partial,
  };
}

// ---------- 手動記錄規則（章程 C4.8） ----------
// 比推薦寬：只限制每個角色的數量，不要求主餐（一杯拿鐵可以記成一餐），不看時段、不套用低碳。

function roleCounts(items) {
  const n = {};
  items.forEach(function (it) { n[it.role] = (n[it.role] || 0) + 1; });
  return n;
}

// 可以送出回傳 null，否則回傳原因
export function manualSelectionProblem(items) {
  if (items.length === 0) return "請至少選一個品項。";
  const n = roleCounts(items);
  const over = Object.keys(n).filter(function (r) { return n[r] > (MANUAL_ROLE_MAX[r] || 1); });
  return over.length > 0 ? "每種角色最多選 1 個。" : null;
}

export function canAddManualItem(items, item) {
  return (roleCounts(items)[item.role] || 0) < (MANUAL_ROLE_MAX[item.role] || 1);
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

// ---------- 自己煮（自己選） ----------

// 自己煮的隱含成分：目前一律用預設（用油與調味的選項在 Phase 0 的自煮分頁）
export function composeImplicit(c, oilHabit) {
  return defaultImplicit(c.method, c.archetype, !!c.vegetable, !!c.seasoning, oilHabit);
}

// c = { protein, staple, vegetable, seasoning, drink, primaryScale }；primary＝被縮放的那個食材（主食或蛋白質）
// implicit：composeImplicit 的結果；implicitItems：catalog.implicit。
// 食材與飲料任一項某欄未知，合計那一欄就是 null。
export function composeTotals(c, primary, implicit, implicitItems) {
  const parts = [c.protein, c.staple, c.vegetable, c.seasoning].filter(Boolean).map(function (it) {
    const serving = it.serving_g != null ? it.serving_g : 100;
    return ingredientContribution(it, serving * (it === primary ? (c.primaryScale || 1) : 1));
  });
  parts.push(implicitContribution(implicit, implicitItems));
  if (c.drink) {
    const d = c.drink;
    parts.push({ kcal: d.kcal, protein_g: d.protein_g, carb_g: d.carb_g, fat_g: d.fat_g, fiber_g: d.fiber_g, sat_fat_g: d.sat_fat_g, sodium_mg: d.sodium_mg });
  }
  const total = addContributions(parts);
  CONTRIB_FIELDS.concat(DISPLAY_FIELDS).forEach(function (k) { total[k] = round1OrNull(total[k]); });
  return total;
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

function cookMealType(maxTierRank) {
  return maxTierRank <= 1 ? "cook_quick" : "cook_full";
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
      meal_type: fromPref ? pref : cookMealType(rec.tier_rank),
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

// 自己煮 → MealContent。c = { archetype, protein, staple, vegetable, seasoning, method, drink, primaryScale }；implicit：實際採用的用油與調味
// −1a 過渡：v1 的自己煮沒有快煮/開伙的選擇，依難度推導；Phase 0 起用自煮分頁的子切換值。
export function contentFromCompose(c, primary, implicit) {
  const comps = [];
  const ingredients = [["protein", c.protein], ["staple", c.staple], ["vegetable", c.vegetable], ["seasoning", c.seasoning]];
  ingredients.forEach(function (a) {
    if (!a[1]) return;
    const comp = { kind: "ingredient", axis: a[0], ref: a[1].id };
    if (a[1] === primary) { comp.is_primary = true; comp.scale = c.primaryScale; }
    comps.push(comp);
  });
  if (c.drink) comps.push(productComponent(c.drink));
  const items = ingredients.map(function (a) { return a[1]; }).filter(Boolean);
  const rank = Math.max(c.method ? tierRank(c.method.prep_tier) : 0,
    items.reduce(function (r, it) { return Math.max(r, tierRank(it.prep_tier)); }, 0));
  return {
    meal_type: cookMealType(rank),
    archetype_id: c.archetype ? c.archetype.id : null,
    method_id: c.method ? c.method.id : null,
    components: comps, implicit: { oil_g: implicit.oil_g, seasoning: implicit.seasoning },
  };
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
