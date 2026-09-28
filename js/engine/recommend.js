// 輕盈計畫 (Lighten Plan) — 今日食譜推薦：評分＋依時段序分配。
// 對照 TECH-SPEC 4.5、PRD 5.5/5.6。候選池在 pool.js，硬性過濾在 filters.js，縮放在 meal-content.js。
// 純函式：資料、回饋紀錄、現在時間都由呼叫端傳入（章程 C1.1）。
//
// 設計沿革（詳見 PRD v4 5.5/5.6、TECH-SPEC 4.5）：
//   - 蛋白質「夠好就好」：超過 PROTEIN_SATISFICE_G 之後不再加分，讓熱量貼近度/多樣性決定勝負
//   - 近期降權同時看「確切組合」與「蛋白質來源／蔬菜」，懲罰跟著食材走，不是跟著組合走
//   - 「喜歡」加 40 分（不是 100），多樣性懲罰偶爾能蓋過去
//   - 纖維加分以「這週平均還差多少」封頂
//   - 已記錄的時段不推薦、跨時段不重複主蛋白質/餐型/現成品項成分
//   - 依序處理時段，前面時段挑到的真實熱量跟配額的差額帶到下一個時段

import { SLOTS, MEAL_SOURCE_OPTIONS, DEFAULT_MEAL_PREFS } from "../core/slots.js";
import { LOW_BUDGET_THRESHOLD_KCAL, LOW_CARB_MEAL_MAX_G } from "../core/config.js";
import { round1 } from "../core/num.js";
import { diffDays, fmtDate } from "../core/dates.js";
import { passesHardFilters } from "./filters.js";
import { achievableNutrition, lowCarbMaxScale, displayFields, withOilHabit } from "./meal-content.js";
import { slotShare } from "./budget.js";

const PROTEIN_SATISFICE_G = 25; // 約一個手掌心蛋白質的量，達到這個量之後多蛋白質不再加分
const LIKE_BONUS = 40;

function getSourcePref(mealPrefs, slot) {
  const prefs = mealPrefs || {};
  const v = prefs[slot];
  return MEAL_SOURCE_OPTIONS.indexOf(v) !== -1 ? v : DEFAULT_MEAL_PREFS[slot];
}

function maxRankForSource(sourcePref) {
  return sourcePref === "cook_quick" ? 1 : 2; // 其餘來源不靠 tier 限制（超商/delivery 恆為🟢；cook_full 不限）
}

function filterBySource(candidates, sourcePref) {
  if (!sourcePref || sourcePref === "auto") return candidates;
  if (sourcePref === "convenience") return candidates.filter(function (c) { return c.is_convenience; });
  if (sourcePref === "delivery") return candidates.filter(function (c) { return !!c.is_delivery; });
  if (sourcePref === "cook_quick") return candidates.filter(function (c) { return !c.is_convenience && !c.is_delivery && c.tier_rank <= 1; });
  if (sourcePref === "cook_full") return candidates.filter(function (c) { return !c.is_convenience && !c.is_delivery; });
  return candidates;
}

// 顯示紀錄的日期（本地 "YYYY-MM-DD"）距離今天幾天：兩邊都用本地日期算。
// v1 用 new Date("YYYY-MM-DD") 解析成 UTC 午夜，台灣 00:00–08:00 算出來少 1 天（今天顯示過變成 −1 天），−1b 修正。
export function daysSince(dateStr, nowMs) {
  if (!dateStr || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return Infinity;
  return diffDays(dateStr, fmtDate(new Date(nowMs)));
}

// 近期降權與累計扣分一律以「今天開始時」的狀態計算（decisions #39）：今天的顯示不算，
// 否則剛顯示的建議在同一天任何一次重建（切分頁回來、記錄一餐後）都會被降權換掉。
// 顯示日期是今天或未來（手機時鐘被調回去）都當成今天。
function shownToday(fb, nowMs) {
  return !!fb.last_shown_date && daysSince(fb.last_shown_date, nowMs) <= 0;
}

// 這個確切組合的回饋分數：喜歡加分、今天以前顯示過的天數（markRecipesShown 一天只加一次）與近期出現降權
export function feedbackScore(fb, nowMs) {
  if (!fb) return 0;
  let s = 0;
  if (fb.rating === "like") s += LIKE_BONUS;
  const today = shownToday(fb, nowMs);
  s -= Math.max(0, (fb.shown_count || 0) - (today ? 1 : 0)) * 5;
  const days = daysSince(fb.last_shown_date, nowMs);
  if (!today && days < 3) s -= (3 - days) * 20; // 這個確切組合近期出現過 → 降權
  return s;
}

function score(combo, fb, constraints, budget, recencyMap, nowMs, maxScale) {
  let s = feedbackScore(fb, nowMs);
  if (combo.is_composed && combo.protein_id && recencyMap && recencyMap[combo.protein_id]) {
    const days = recencyMap[combo.protein_id].days;
    if (days < 3) s -= (3 - days) * 20; // 這個蛋白質來源（不管配什麼菜/主食）近期出現過 → 降權
  }
  if (combo.is_composed && combo.vegetable_id && recencyMap && recencyMap["veg:" + combo.vegetable_id]) {
    const days = recencyMap["veg:" + combo.vegetable_id].days;
    if (days < 3) s -= (3 - days) * 10; // 蔬菜也做一樣的降權，權重比蛋白質輕
  }
  // 蛋白質/纖維未知（null）的組合拿不到這兩項加分，不猜它有多少
  if (constraints.proteinGapToday > 0 && combo.protein_g != null) s += Math.min(combo.protein_g, PROTEIN_SATISFICE_G) * 0.5;
  if (constraints.fiberGapThisWeek > 0 && combo.fiber_g != null) s += Math.min(combo.fiber_g, constraints.fiberGapThisWeek) * 2;
  if (budget > 0) {
    const eff = achievableNutrition(combo, budget, maxScale);
    s -= Math.abs(budget / eff.kcal - 1) * 50; // 用「縮放後貼近預算的實際熱量」評分，不是天然份量的熱量
  }
  return s;
}

// 依「蛋白質來源」跟「蔬菜」分別聚合候選池裡最近一次出現的天數（key 是食材 id；蔬菜加 "veg:" 前綴避免
// 跟蛋白質撞到）。只看自組食譜，超商/台式外送不受影響。
function buildRecencyMap(combos, feedbackMap, nowMs) {
  const recency = {};
  function record(key, days) {
    const cur = recency[key];
    if (!cur || days < cur.days) recency[key] = { days: days };
  }
  combos.forEach(function (c) {
    if (!c.is_composed) return;
    const fb = feedbackMap[c.id];
    if (!fb || shownToday(fb, nowMs)) return; // 先略過今天的顯示再取最小值，今天剛顯示的不會蓋掉昨天的紀錄
    const days = daysSince(fb.last_shown_date, nowMs);
    if (c.protein_id) record(c.protein_id, days);
    if (c.vegetable_id) record("veg:" + c.vegetable_id, days);
  });
  return recency;
}

// o = {
//   pool: buildCandidatePool(catalog)
//   feedbackMap: { comboId: { rating, shown_count, last_shown_date } }
//   remainingBudget: budget.js 回傳的 { perSlotSuggestion, remainingKcal }
//   hardConstraints: matcher.js 回傳的 { proteinGapToday, fiberGapThisWeek }
//   mealPrefs: profile.meal_prefs（可為 null）
//   dietRestriction / allergens / dislikedIngredients: profile 的硬性過濾設定
//   skipSlots: { slot: true } 不需要推薦的時段（已記錄／已關閉），回傳 null 不佔剩餘熱量池
//   lowCarb: 基本資料的低碳開關（只影響推薦）：一餐碳水 ≤ LOW_CARB_MEAL_MAX_G，自組食譜用它限制主要槽位縮放
//   oilHabit: 基本資料「家裡用油習慣」（normal | less），自組食譜的用油依它換算
//   loggedContents: 今天已記錄的每一餐 MealContent；吃過的蛋白質、餐型、品項佔住跨時段不重複的名額（decisions #39）
//   nowMs: 現在時間（毫秒）
// }
export function getTodayRecommendation(o) {
  const combos = o.oilHabit && o.oilHabit !== "normal"
    ? o.pool.map(function (c) { return withOilHabit(c, o.oilHabit); })
    : o.pool;
  const feedbackMap = o.feedbackMap || {};
  const constraints = o.hardConstraints || { proteinGapToday: 0, fiberGapThisWeek: 0 };
  const skip = o.skipSlots || {};
  const filterProfile = { diet_restriction: o.dietRestriction, allergens: o.allergens, disliked_ingredients: o.dislikedIngredients };
  const recencyMap = buildRecencyMap(combos, feedbackMap, o.nowMs);
  // 低碳：每個候選的最大縮放倍數（null＝不算低碳，直接排除）
  const carbCap = {};
  if (o.lowCarb) combos.forEach(function (c) { carbCap[c.id] = lowCarbMaxScale(c, LOW_CARB_MEAL_MAX_G); });

  // 同一天的各時段之間不重複：自組食譜不重複主蛋白質、同一餐型最多一次；現成品項任何成分只出現在一個時段
  const usedProteinIds = {};
  const usedArchetypeIds = {};
  const usedItemIds = {};
  (o.loggedContents || []).forEach(function (content) {
    if (!content) return;
    if (content.archetype_id) usedArchetypeIds[content.archetype_id] = true;
    (content.components || []).forEach(function (c) {
      if (c.kind === "ingredient" && c.axis === "protein") usedProteinIds[c.ref] = true;
      else if (c.kind === "product") usedItemIds[c.ref] = true;
    });
  });

  const result = {};
  // 全天剩餘熱量池：budget.js 已算好。依序處理時前面時段超出的差額往後帶。
  const perSlot = (o.remainingBudget && o.remainingBudget.perSlotSuggestion) || {};
  let pool = typeof (o.remainingBudget && o.remainingBudget.remainingKcal) === "number"
    ? o.remainingBudget.remainingKcal
    : SLOTS.reduce(function (sum, s) { return sum + (Number(perSlot[s]) || 0); }, 0);

  SLOTS.forEach(function (slot) {
    if (skip[slot]) {
      result[slot] = null;
      return;
    }
    // 還沒處理的時段 = 本時段 + 排在本時段之後且沒被 skip 的時段
    const idx = SLOTS.indexOf(slot);
    const remainingSlots = SLOTS.filter(function (s, i) { return i >= idx && !skip[s]; });
    const quota = slotShare(pool, remainingSlots, slot);

    // 配額低於門檻：前面時段把池子吃光了，標記「額度用完」（跟「找不到組合」是兩種不同文案）。
    if (quota < LOW_BUDGET_THRESHOLD_KCAL) {
      result[slot] = { lowBudget: true, budget: round1(quota) };
      return;
    }
    const budget = quota;
    const sourcePref = getSourcePref(o.mealPrefs, slot);
    const maxRank = maxRankForSource(sourcePref);

    const baseCandidates = combos.filter(function (c) {
      if (c.tier_rank > maxRank) return false;
      if (c.valid_slots && c.valid_slots.indexOf(slot) === -1) return false;
      if (o.lowCarb && carbCap[c.id] === null) return false;
      if (!passesHardFilters(c, filterProfile).ok) return false;
      const fb = feedbackMap[c.id];
      if (fb && fb.rating === "dislike") return false; // 倒讚永久排除
      if (c.is_composed) {
        if (c.protein_id && usedProteinIds[c.protein_id]) return false;
        if (c.archetype_id && usedArchetypeIds[c.archetype_id]) return false;
      } else if (c.components.some(function (id) { return usedItemIds[id]; })) {
        return false;
      }
      return true;
    });

    let candidates = filterBySource(baseCandidates, sourcePref);
    let usedFallback = false;
    if (candidates.length === 0 && baseCandidates.length > 0) {
      usedFallback = true;
      // 使用者明確選了 convenience/cook_quick/cook_full 卻在該來源找不到符合的組合時，
      // 退回全部候選池，但排除外食品項（除非使用者本來選的就是 delivery/auto），
      // 避免使用者沒選外食卻被推薦要花錢出門買的東西。
      candidates = (sourcePref === "delivery" || sourcePref === "auto")
        ? baseCandidates
        : baseCandidates.filter(function (c) { return !c.is_delivery; });
    }

    if (candidates.length === 0) {
      result[slot] = null;
      return;
    }

    // 分數先算好再排序，不要在比較函式裡重算（候選上千筆時會重算數十萬次）。
    const scored = candidates.map(function (c) {
      return { c: c, s: score(c, feedbackMap[c.id], constraints, budget, recencyMap, o.nowMs, o.lowCarb ? carbCap[c.id] : null) };
    });
    scored.sort(function (a, b) {
      if (b.s !== a.s) return b.s - a.s;
      return a.c.id < b.c.id ? -1 : a.c.id > b.c.id ? 1 : 0;
    });

    const top = scored[0].c;
    const eff = achievableNutrition(top, budget, o.lowCarb ? carbCap[top.id] : null);
    if (top.is_composed) {
      if (top.protein_id) usedProteinIds[top.protein_id] = true;
      if (top.archetype_id) usedArchetypeIds[top.archetype_id] = true;
    } else {
      top.components.forEach(function (id) { usedItemIds[id] = true; });
    }
    result[slot] = Object.assign({}, top, displayFields(eff), {
      budget: round1(budget),
      scale: round1(eff.scale),
      primary_scale: eff.scale, // 未取整的倍數：營養值是用它算的，記錄時存這個
      scaled_kcal: eff.kcal,
      protein_g: eff.protein_g,
      carb_g: eff.carb_g,
      fat_g: eff.fat_g,
      fiber_g: eff.fiber_g,
      source_pref: sourcePref,
      fallback_to_auto: usedFallback,
    });
    // 差額帶到下一個時段：扣掉真實品項熱量（不是原本配額）。
    pool = Math.max(0, pool - eff.kcal);
  });

  return result;
}
