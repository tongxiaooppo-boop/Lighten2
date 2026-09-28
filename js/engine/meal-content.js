// 輕盈計畫 — 一餐內容（唯一來源，章程 C2）：營養計算（含縮放、null 規則）、MealContent 與 daily_log 的建立。
// 推薦組合、「自己選」的現成品項與自己煮、今日/本週的攝取加總都走這裡；ui/ 不自己加總營養（章程 C4.11）。
//
// null 規則（章程 C4.5）：缺資料是 null，加總時 null 傳染，不當 0。
//   - 顯示用的合計（sumLogTotals、自己煮與現成品項的合計、推薦組合）：任一項未知 → null
//   - 缺口計算（sumKnownLogTotals）：未知的量不能算成「已經吃到」，只加已知部分，缺口因此偏大（往安全方向）
//   - 今日 hero 另有涵蓋率警語（todayIntake）
// ⚠️ 用油、調味的隱含成分還沒有（implicit: null），−1b 後續加入。

import { PRIMARY_SLOT_SCALE_RANGE, tierRank } from "../core/config.js";
import { round1, isNum } from "../core/num.js";

export const NUTRIENT_FIELDS = ["protein_g", "carb_g", "fat_g", "fiber_g"];
const CONTRIB_FIELDS = ["kcal"].concat(NUTRIENT_FIELDS);


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
  };
}

export const ZERO_CONTRIBUTION = { kcal: 0, protein_g: 0, carb_g: 0, fat_g: 0, fiber_g: 0 };

// 逐欄加總，任一部分是 null 那一欄就是 null
export function addContributions(parts) {
  const acc = { kcal: 0, protein_g: 0, carb_g: 0, fat_g: 0, fiber_g: 0 };
  parts.forEach(function (part) {
    CONTRIB_FIELDS.forEach(function (k) {
      acc[k] = acc[k] == null || part[k] == null ? null : acc[k] + part[k];
    });
  });
  return acc;
}

// 自組食譜可以靠「主要槽位」（有主食槽用主食，沒有的用蛋白質）在 PRIMARY_SLOT_SCALE_RANGE
// 內縮放去貼近熱量預算；超商/台式外送是真實商品，不能縮放，固定用天然份量的熱量。
// 回傳值同時給評分判斷貼近度、也給最終結果組裝實際要顯示的份量。
// maxScale（選填）：低碳時「碳水 ≤ 上限」容許的最大倍數，縮放取兩者較小者（呼叫端保證 ≥ 最小倍數）。
export function achievableNutrition(c, budget, maxScale) {
  if (!c.is_composed || !(budget > 0) || !(c.primary_kcal > 0)) {
    return { scale: 1, kcal: c.kcal, protein_g: c.protein_g, carb_g: c.carb_g, fat_g: c.fat_g, fiber_g: c.fiber_g };
  }
  const fixedKcal = c.kcal - c.primary_kcal;
  let scale = (budget - fixedKcal) / c.primary_kcal;
  scale = Math.max(PRIMARY_SLOT_SCALE_RANGE.min, Math.min(PRIMARY_SLOT_SCALE_RANGE.max, scale));
  if (maxScale != null && scale > maxScale) scale = Math.max(PRIMARY_SLOT_SCALE_RANGE.min, maxScale);
  // 主要槽位是合計的一部分：合計已知時主要槽位一定已知；合計未知就維持 null
  const scaled = function (total, primary) {
    return total == null || primary == null ? null : round1((total - primary) + primary * scale);
  };
  return {
    scale: scale,
    kcal: round1(fixedKcal + c.primary_kcal * scale),
    protein_g: scaled(c.protein_g, c.primary_protein_g),
    carb_g: scaled(c.carb_g, c.primary_carb_g),
    fat_g: scaled(c.fat_g, c.primary_fat_g),
    fiber_g: scaled(c.fiber_g, c.primary_fiber_g),
  };
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
  return {
    kcal: round1(items.reduce(function (s, it) { return s + it.kcal; }, 0)),
    protein_g: sumOrNull(items, "protein_g"),
    carb_g: sumOrNull(items, "carb_g"),
    fat_g: sumOrNull(items, "fat_g"),
    fiber_g: sumOrNull(items, "fiber_g"),
  };
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

// c = { protein, staple, vegetable, seasoning, drink, primaryScale }；primary＝被縮放的那個食材（主食或蛋白質）
// 食材與飲料任一項某欄未知，合計那一欄就是 null。
export function composeTotals(c, primary) {
  const parts = [c.protein, c.staple, c.vegetable, c.seasoning].filter(Boolean).map(function (it) {
    const serving = it.serving_g != null ? it.serving_g : 100;
    return ingredientContribution(it, serving * (it === primary ? (c.primaryScale || 1) : 1));
  });
  if (c.drink) {
    const d = c.drink;
    parts.push({ kcal: d.kcal, protein_g: d.protein_g, carb_g: d.carb_g, fat_g: d.fat_g, fiber_g: d.fiber_g });
  }
  const total = addContributions(parts);
  CONTRIB_FIELDS.forEach(function (k) { total[k] = round1OrNull(total[k]); });
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
      components: comps, implicit: null,
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

// 自己煮 → MealContent。c = { archetype, protein, staple, vegetable, seasoning, method, drink, primaryScale }
// −1a 過渡：v1 的自己煮沒有快煮/開伙的選擇，依難度推導；Phase 0 起用自煮分頁的子切換值。
export function contentFromCompose(c, primary) {
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
    components: comps, implicit: null,
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
    },
    created_at: o.createdAt,
  };
}
