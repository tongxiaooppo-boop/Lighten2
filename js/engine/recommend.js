// 輕盈計畫 (Lighten Plan) — 今日食譜推薦引擎
// 對照 TECH-SPEC 4.5、PRD 5.5/5.6。
// 候選池由三個來源組成，共用同一套 tier/過敏原/飲食限制/份量比對篩選與評分：
//   1. 自組食譜：蛋白質×主食×蔬菜×醬料/烹調法 四軸笛卡爾積（is_convenience=false, is_delivery=false）
//   2. 超商/現成即食品項：data/convenience_items.json，含「主餐＋1~2個飲品/點心棒」的多品項組合
//      （is_convenience=true, is_delivery=false）
//   3. 台式熱門品項（外送/餐廳）：data/taiwan_items.json，透過 getTaiwanItems() 取得
//      （is_convenience=false, is_delivery=true）
// 2026-09-25 三輪修訂記錄（詳見 PRD 5.5/5.6 節、TECH-SPEC 4.5 節）：
//   - 新增「蔬菜」軸（原本三軸組出來的餐點永遠沒有實際蔬菜份量）
//   - 新增超商即食品項候選池 + 多品項組合
//   - 經 Opus 兩輪審查後：把「早/午餐自動加權超商」的軟性加分機制，改成使用者可在基本資料分頁
//     逐時段設定的硬性來源篩選（mealPrefs），並把 taiwan_items.json 正式併入候選池（標記 is_delivery），
//     依 uses_flex 決定要不要消耗週彈性點數、依 cap-used 檢查是否還有額度
// 注意：此函式需讀取 data/*.json、recipe_feedback、taiwan_items（經 database.js 快取），故為 async。

(function () {
  "use strict";

  const SLOTS = ["breakfast", "lunch", "afternoon_tea", "dinner", "snack"];
  const TIER_RANK = { "🟢": 0, "🟡": 1, "🔴": 2 };
  const RANK_TO_TIER = { 0: "🟢", 1: "🟡", 2: "🔴" };
  const SCALE_MIN = 0.7;
  const SCALE_MAX = 1.3;

  // 份量換算：三軸資料是「每 100g」營養值，實際一餐不會只吃 100g，直接相加會嚴重低估總熱量。
  // 蛋白質來源約 130g、主食約 150g、蔬菜約 100g、醬料/烹調法屬調味用量約 20g。
  const PROTEIN_SERVING_G = 130;
  const STAPLE_SERVING_G = 150;
  const SAUCE_SERVING_G = 20;
  const VEGETABLE_SERVING_G = 100;

  // 2026-09-25 新增：每個時段的「來源偏好」（profile.meal_prefs[slot]），取代舊的
  // prep_time_weekday/weekend（全域）+ meal_style_preference（全域）兩個各自為政的機制。
  //   "auto"：無偏好，tier 上限採中等難度（🟢🟡），不特別篩來源
  //   "convenience"：只看超商/現成即食品項（不含台式外送）
  //   "delivery"：只看台式熱門外送/餐廳品項
  //   "cook_quick"：只看自組食譜，且 tier 上限 🟢🟡（≈15分鐘內）
  //   "cook_full"：只看自組食譜，tier 不限（含🔴）
  const SOURCE_OPTIONS = ["auto", "convenience", "delivery", "cook_quick", "cook_full"];
  const DEFAULT_MEAL_PREFS = { breakfast: "convenience", lunch: "convenience", afternoon_tea: "auto", dinner: "cook_full", snack: "auto" };

  function getSourcePref(mealPrefs, slot) {
    const prefs = mealPrefs || {};
    const v = prefs[slot];
    return SOURCE_OPTIONS.indexOf(v) !== -1 ? v : DEFAULT_MEAL_PREFS[slot];
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

  // 台式熱門品項（外送/餐廳）→ 適用時段對照。「西式速食」沒有專屬時段，比照常見食用情境歸到午/晚餐。
  const TAIWAN_CATEGORY_SLOTS = {
    "早餐": ["breakfast"],
    "午餐": ["lunch"],
    "晚餐": ["dinner"],
    "宵夜": ["snack"],
    "飲料": ["afternoon_tea"],
    "西式速食": ["lunch", "dinner"],
  };
  const WIDE_RANGE_RATIO = 1.5; // 沒有 kcal_rep、且 high/low ≥ 1.5 倍的品項熱量太不精準，不進推薦池（仍可在預約/直接記錄使用）

  function isTooWideRange(it) {
    if (it.kcal_rep != null) return false;
    if (it.kcal_low == null || it.kcal_high == null || it.kcal_low <= 0) return true;
    return it.kcal_high / it.kcal_low >= WIDE_RANGE_RATIO;
  }

  let _axesCache = null;

  async function fetchJson(url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error("[recommend.js] 載入種子資料失敗：" + url);
    return await res.json();
  }

  async function loadAxes() {
    if (_axesCache) return _axesCache;
    const [proteins, staples, sauces, rawIngredients, convenienceItems, taiwanItems] = await Promise.all([
      fetchJson("data/protein_sources.json"),
      fetchJson("data/staples.json"),
      fetchJson("data/sauce_methods.json"),
      fetchJson("data/raw_ingredients.json"),
      fetchJson("data/convenience_items.json"),
      getTaiwanItems(), // database.js 已修正為直接 fetch + 快取，跟 feast.js/tab-ledger.js 共用同一份資料
    ]);
    const vegetables = rawIngredients.filter(function (it) {
      return it.category === "蔬菜";
    });
    _axesCache = {
      proteins: proteins, staples: staples, sauces: sauces,
      vegetables: vegetables, convenienceItems: convenienceItems, taiwanItems: taiwanItems,
    };
    return _axesCache;
  }

  function num(v) {
    return typeof v === "number" && isFinite(v) ? v : 0;
  }

  function tierRank(t) {
    return TIER_RANK.hasOwnProperty(t) ? TIER_RANK[t] : 2;
  }

  function unionTags() {
    const set = {};
    for (let i = 0; i < arguments.length; i++) {
      const tags = arguments[i];
      if (Array.isArray(tags)) {
        tags.forEach(function (t) {
          if (t) set[t] = true;
        });
      }
    }
    return Object.keys(set);
  }

  function parseAllergens(s) {
    if (!s) return [];
    return String(s)
      .split(/[,、，;；\s]+/)
      .map(function (x) {
        return x.trim();
      })
      .filter(Boolean);
  }

  function passesDiet(dietTags, dietRestriction) {
    if (!dietRestriction || dietRestriction === "一般" || dietRestriction === "無特殊限制") {
      return true;
    }
    return dietTags.indexOf(dietRestriction) !== -1;
  }

  function daysSince(dateStr) {
    if (!dateStr) return Infinity;
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return Infinity;
    return Math.floor((Date.now() - d.getTime()) / 86400000);
  }

  function score(combo, fb, constraints, budget) {
    let s = 0;
    if (fb) {
      if (fb.rating === "like") s += 100;
      s -= (fb.shown_count || 0) * 5;
      const days = daysSince(fb.last_shown_date);
      if (days < 3) s -= (3 - days) * 20; // 近期出現過 → 降權
    }
    if (constraints.proteinGapToday > 0) s += combo.protein_g * 0.5;
    if (constraints.fiberGapThisWeek > 0) s += combo.fiber_g * 2;
    if (budget > 0) s -= Math.abs(budget / combo.kcal - 1) * 50; // 越接近配額越好
    return s;
  }

  // remainingBudget: budget.js 回傳的 { perSlotSuggestion }
  // hardConstraints: matcher.js 回傳的 { proteinGapToday, fiberGapThisWeek }
  // mealPrefs: profile.meal_prefs（5個時段各自的來源偏好，見上方 SOURCE_OPTIONS），可為 null（全部用預設值）
  // flexLedger: 本週 weekly_flex_ledger，如 { cap_kcal, used_kcal }；用來檢查台式外送品項是否還有彈性點數額度
  async function getTodayRecommendation(remainingBudget, hardConstraints, mealPrefs, dietRestriction, allergens, flexLedger) {
    const axes = await loadAxes();
    const budgetBySlot = (remainingBudget && remainingBudget.perSlotSuggestion) || {};
    const constraints = hardConstraints || { proteinGapToday: 0, fiberGapThisWeek: 0 };
    const allergenList = parseAllergens(allergens);
    const flexRemaining = (flexLedger && flexLedger.cap_kcal != null)
      ? Math.max(0, flexLedger.cap_kcal - (flexLedger.used_kcal || 0))
      : Infinity; // 沒有帳本資料時不做額度限制（例如尚未計算過目標的新使用者）

    // ---------- 1. 自組食譜（四軸笛卡爾積） ----------
    const combos = [];
    const pr = PROTEIN_SERVING_G / 100;
    const sr = STAPLE_SERVING_G / 100;
    const mr = SAUCE_SERVING_G / 100;
    const vr = VEGETABLE_SERVING_G / 100;
    axes.proteins.forEach(function (p) {
      axes.staples.forEach(function (s) {
        axes.vegetables.forEach(function (v) {
          axes.sauces.forEach(function (m) {
            if (p.kcal_100g == null || s.kcal_100g == null || v.kcal_100g == null || m.kcal_100g == null) return;
            const rank = Math.max(tierRank(p.prep_tier), tierRank(s.prep_tier), tierRank(v.prep_tier), tierRank(m.prep_tier));
            combos.push({
              id: p.id + "_" + s.id + "_" + v.id + "_" + m.id,
              name: p.name + " + " + s.name + " + " + v.name + " + " + m.name,
              protein_name: p.name,
              staple_name: s.name,
              vegetable_name: v.name,
              sauce_name: m.name,
              kcal: round1(num(p.kcal_100g) * pr + num(s.kcal_100g) * sr + num(v.kcal_100g) * vr + num(m.kcal_100g) * mr),
              protein_g: round1(num(p.protein_100g) * pr + num(s.protein_100g) * sr + num(v.protein_100g) * vr + num(m.protein_100g) * mr),
              carb_g: round1(num(p.carb_100g) * pr + num(s.carb_100g) * sr + num(v.carb_100g) * vr + num(m.carb_100g) * mr),
              fat_g: round1(num(p.fat_100g) * pr + num(s.fat_100g) * sr + num(v.fat_100g) * vr + num(m.fat_100g) * mr),
              fiber_g: round1(num(p.fiber_100g) * pr + num(s.fiber_100g) * sr + num(v.fiber_100g) * vr + num(m.fiber_100g) * mr),
              tier: RANK_TO_TIER[rank],
              tier_rank: rank,
              diet_tags: unionTags(p.diet_tags, s.diet_tags, v.diet_tags, m.diet_tags),
              allergen_tags: unionTags(p.allergen_tags, s.allergen_tags, v.allergen_tags, m.allergen_tags),
              is_convenience: false,
              is_delivery: false,
            });
          });
        });
      });
    });

    // ---------- 2. 超商即食品項（含「主餐＋1~2個飲品/點心棒」多品項組合） ----------
    const EXTRA_CATEGORIES = { "飲品": true, "蛋白飲/點心棒": true };

    function toConvenienceCombo(items) {
      const tags = items.map(function (it) { return it.diet_tags; });
      const allergens2 = items.map(function (it) { return it.allergen_tags; });
      const maxTierRank = items.reduce(function (r, it) { return Math.max(r, tierRank(it.tier)); }, 0);
      return {
        id: items.map(function (it) { return it.id; }).join("+"),
        name: items.map(function (it) { return it.name; }).join(" ＋ "),
        protein_name: null,
        kcal: round1(items.reduce(function (s, it) { return s + num(it.kcal); }, 0)),
        protein_g: round1(items.reduce(function (s, it) { return s + num(it.protein_g); }, 0)),
        carb_g: round1(items.reduce(function (s, it) { return s + num(it.carb_g); }, 0)),
        fat_g: round1(items.reduce(function (s, it) { return s + num(it.fat_g); }, 0)),
        fiber_g: round1(items.reduce(function (s, it) { return s + num(it.fiber_g); }, 0)),
        tier: RANK_TO_TIER[maxTierRank],
        tier_rank: maxTierRank,
        diet_tags: unionTags.apply(null, tags),
        allergen_tags: unionTags.apply(null, allergens2),
        is_convenience: true,
        is_delivery: false,
      };
    }

    const validConvenienceItems = axes.convenienceItems.filter(function (it) { return it.kcal != null; });
    validConvenienceItems.forEach(function (it) {
      combos.push(toConvenienceCombo([it]));
    });
    const mains = validConvenienceItems.filter(function (it) { return !EXTRA_CATEGORIES[it.category]; });
    const extras = validConvenienceItems.filter(function (it) { return EXTRA_CATEGORIES[it.category]; });
    mains.forEach(function (main) {
      extras.forEach(function (extra) {
        combos.push(toConvenienceCombo([main, extra]));
      });
      for (let i = 0; i < extras.length; i++) {
        for (let j = i + 1; j < extras.length; j++) {
          combos.push(toConvenienceCombo([main, extras[i], extras[j]]));
        }
      }
    });

    // ---------- 3. 台式熱門品項（外送/餐廳），依 uses_flex 決定是否受週彈性點數額度限制 ----------
    axes.taiwanItems.forEach(function (it) {
      if (isTooWideRange(it)) return; // 熱量區間太寬（無代表值且high/low≥1.5倍），不夠精準，不進推薦池
      const validSlots = TAIWAN_CATEGORY_SLOTS[it.category];
      if (!validSlots) return; // 目前沒有對應時段的分類（理論上不會發生，六類都已對照）
      const kcal = it.kcal_rep != null ? it.kcal_rep : round1((it.kcal_low + it.kcal_high) / 2);
      const usesFlex = it.uses_flex !== false;
      combos.push({
        id: "tw_" + it.id,
        source_id: it.id,
        name: it.name,
        protein_name: null,
        kcal: kcal,
        protein_g: num(it.protein_g),
        carb_g: 0,
        fat_g: 0,
        fiber_g: num(it.fiber_g),
        tier: "🟢", // 外送/餐廳品項對使用者來說零烹調成本，跟菜色本身好不好做無關
        tier_rank: 0,
        diet_tags: [], // 台式品項目前沒有飲食限制標記：有設定飲食限制的使用者一律看不到，這是刻意的保守預設
        allergen_tags: it.allergen_tags || [],
        is_convenience: false,
        is_delivery: true,
        uses_flex: usesFlex,
        valid_slots: validSlots,
      });
    });

    // ---------- 批次讀取回饋（一次 iterate，取代逐一 getRecipeFeedback） ----------
    const feedbackMap = await getAllRecipeFeedback();

    const result = {};
    SLOTS.forEach(function (slot) {
      const budget = num(budgetBySlot[slot]);
      const sourcePref = getSourcePref(mealPrefs, slot);
      const maxRank = maxRankForSource(sourcePref);

      const baseCandidates = combos.filter(function (c) {
        if (c.tier_rank > maxRank) return false;
        if (c.is_delivery && c.valid_slots.indexOf(slot) === -1) return false;
        if (c.is_delivery && c.uses_flex && c.kcal > flexRemaining) return false; // 彈性點數額度不足，不推薦
        if (
          allergenList.some(function (a) {
            return c.allergen_tags.indexOf(a) !== -1;
          })
        ) {
          return false;
        }
        if (!passesDiet(c.diet_tags, dietRestriction)) return false;
        const fb = feedbackMap[c.id];
        if (fb && fb.rating === "dislike") return false; // 倒讚永久排除
        if (budget > 0) {
          const scale = budget / c.kcal;
          if (scale < SCALE_MIN || scale > SCALE_MAX) return false;
        }
        return true;
      });

      let candidates = filterBySource(baseCandidates, sourcePref);
      let usedFallback = false;
      if (candidates.length === 0 && baseCandidates.length > 0) {
        usedFallback = true;
        // 使用者明確選了 convenience/cook_quick/cook_full 卻在該來源找不到符合的組合時，
        // 退回全部候選池，但排除台式外送品項（除非使用者本來選的就是 delivery/auto），
        // 避免使用者沒選外送卻被意外推薦、進而扣到彈性點數。
        candidates = (sourcePref === "delivery" || sourcePref === "auto")
          ? baseCandidates
          : baseCandidates.filter(function (c) { return !c.is_delivery; });
      }

      if (candidates.length === 0) {
        result[slot] = null;
        return;
      }

      candidates.sort(function (a, b) {
        const sa = score(a, feedbackMap[a.id], constraints, budget);
        const sb = score(b, feedbackMap[b.id], constraints, budget);
        if (sb !== sa) return sb - sa;
        return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
      });

      const top = candidates[0];
      const scale = (budget > 0 && !top.is_delivery && !top.is_convenience) ? budget / top.kcal : 1;
      result[slot] = Object.assign({}, top, {
        scale: round1(scale),
        scaled_kcal: round1(top.kcal * scale),
        source_pref: sourcePref,
        fallback_to_auto: usedFallback,
      });
    });

    return result;
  }

  function round1(n) {
    return Math.round(n * 10) / 10;
  }

  window.getTodayRecommendation = getTodayRecommendation;
  window.RECOMMEND_SLOTS = SLOTS;
  window.RECOMMEND_SLOT_LABELS = { breakfast: "早餐", lunch: "午餐", afternoon_tea: "下午茶", dinner: "晚餐", snack: "宵夜" };
  window.MEAL_SOURCE_OPTIONS = SOURCE_OPTIONS;
  window.DEFAULT_MEAL_PREFS = DEFAULT_MEAL_PREFS;
})();
