// 輕盈計畫 — 一餐內容（唯一來源，章程 C2）：營養計算（含縮放、null 規則）、MealContent 與 daily_log 的建立。
// 推薦組合、「自己選」的現成品項與自己煮、今日/本週的攝取加總都走這裡；ui/ 不自己加總營養（章程 C4.11）。
//
// ⚠️ Phase −1a 只搬家、不改算法（快照逐字比對）。下列 v1 行為刻意保留，−1b 修正：
//   - 食材營養用 num()：缺值當 0（章程 C4.5 要求 null 傳染）
//   - 自己煮的食材用 `|| 0`，飲料缺值才 null 傳染
//   - 今日 hero 的加總跳過 null（涵蓋率另外警語）；本週加總用 Number() || 0
//   - 用油、調味的隱含成分還沒有（implicit: null）

import { PRIMARY_SLOT_SCALE_RANGE, tierRank } from "../core/config.js";
import { round1 } from "../core/num.js";

export const NUTRIENT_FIELDS = ["protein_g", "carb_g", "fat_g", "fiber_g"];

export function num(v) {
  return typeof v === "number" && isFinite(v) ? v : 0;
}

// 組合裡只要任一成員該欄位是 null，整個組合這欄就是 null；否則才正常加總。
export function sumOrNull(members, field) {
  if (members.some(function (m) { return m[field] == null; })) return null;
  return round1(members.reduce(function (s, m) { return s + m[field]; }, 0));
}

// ---------- 自組食譜（推薦候選） ----------

// 一個食材的天然一份（或指定克數）營養值。
export function ingredientContribution(it, servingG) {
  const r = (servingG != null ? servingG : (it.serving_g != null ? it.serving_g : 100)) / 100;
  return {
    kcal: num(it.kcal_100g) * r,
    protein_g: num(it.protein_100g) * r,
    carb_g: num(it.carb_100g) * r,
    fat_g: num(it.fat_100g) * r,
    fiber_g: num(it.fiber_100g) * r,
  };
}

export const ZERO_CONTRIBUTION = { kcal: 0, protein_g: 0, carb_g: 0, fat_g: 0, fiber_g: 0 };

export function addContributions(parts) {
  return parts.reduce(function (acc, part) {
    acc.kcal += part.kcal; acc.protein_g += part.protein_g; acc.carb_g += part.carb_g;
    acc.fat_g += part.fat_g; acc.fiber_g += part.fiber_g;
    return acc;
  }, { kcal: 0, protein_g: 0, carb_g: 0, fat_g: 0, fiber_g: 0 });
}

// 自組食譜可以靠「主要槽位」（有主食槽用主食，沒有的用蛋白質）在 PRIMARY_SLOT_SCALE_RANGE
// 內縮放去貼近熱量預算；超商/台式外送是真實商品，不能縮放，固定用天然份量的熱量。
// 回傳值同時給評分判斷貼近度、也給最終結果組裝實際要顯示的份量。
export function achievableNutrition(c, budget) {
  if (!c.is_composed || !(budget > 0) || !(c.primary_kcal > 0)) {
    return { scale: 1, kcal: c.kcal, protein_g: c.protein_g, carb_g: c.carb_g, fat_g: c.fat_g, fiber_g: c.fiber_g };
  }
  const fixedKcal = c.kcal - c.primary_kcal;
  let scale = (budget - fixedKcal) / c.primary_kcal;
  scale = Math.max(PRIMARY_SLOT_SCALE_RANGE.min, Math.min(PRIMARY_SLOT_SCALE_RANGE.max, scale));
  return {
    scale: scale,
    kcal: round1(fixedKcal + c.primary_kcal * scale),
    protein_g: round1((c.protein_g - c.primary_protein_g) + c.primary_protein_g * scale),
    carb_g: round1((c.carb_g - c.primary_carb_g) + c.primary_carb_g * scale),
    fat_g: round1((c.fat_g - c.primary_fat_g) + c.primary_fat_g * scale),
    fiber_g: round1((c.fiber_g - c.primary_fiber_g) + c.primary_fiber_g * scale),
  };
}

// ---------- 現成品項多選（自己選） ----------

export function sumProducts(items) {
  return {
    kcal: round1(items.reduce(function (s, it) { return s + (Number(it.kcal) || 0); }, 0)),
    protein_g: sumOrNull(items, "protein_g"),
    carb_g: sumOrNull(items, "carb_g"),
    fat_g: sumOrNull(items, "fat_g"),
    fiber_g: sumOrNull(items, "fiber_g"),
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

function composeContribution(it, scale) {
  const serving = it.serving_g != null ? it.serving_g : 100;
  const r = serving / 100 * (scale || 1);
  return {
    kcal: (it.kcal_100g || 0) * r, protein_g: (it.protein_100g || 0) * r,
    carb_g: (it.carb_100g || 0) * r, fat_g: (it.fat_100g || 0) * r, fiber_g: (it.fiber_100g || 0) * r,
  };
}

// c = { protein, staple, vegetable, seasoning, drink, primaryScale }；primary＝被縮放的那個食材（主食或蛋白質）
// 自組食材四項營養素當作都有值；飲料可能缺值，缺值時用 null 傳染（只拖累飲料部分）。
export function composeTotals(c, primary) {
  const parts = [c.protein, c.staple, c.vegetable, c.seasoning].filter(Boolean);
  const total = { kcal: 0, protein_g: 0, carb_g: 0, fat_g: 0, fiber_g: 0 };
  parts.forEach(function (it) {
    const contrib = composeContribution(it, it === primary ? c.primaryScale : 1);
    total.kcal += contrib.kcal; total.protein_g += contrib.protein_g;
    total.carb_g += contrib.carb_g; total.fat_g += contrib.fat_g; total.fiber_g += contrib.fiber_g;
  });
  if (c.drink) {
    const d = c.drink;
    total.kcal += Number(d.kcal) || 0;
    total.protein_g = d.protein_g == null ? null : total.protein_g + d.protein_g;
    total.carb_g = d.carb_g == null ? null : total.carb_g + d.carb_g;
    total.fat_g = d.fat_g == null ? null : total.fat_g + d.fat_g;
    total.fiber_g = d.fiber_g == null ? null : total.fiber_g + d.fiber_g;
  }
  total.kcal = Math.round(total.kcal * 10) / 10;
  NUTRIENT_FIELDS.forEach(function (k) {
    if (total[k] != null) total[k] = Math.round(total[k] * 10) / 10;
  });
  return total;
}

// ---------- 紀錄的加總 ----------

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
  return logs.reduce(function (sum, l) { return sum + (Number(l.totals.kcal) || 0); }, 0);
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
