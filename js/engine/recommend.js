// 輕盈計畫 (Lighten Plan) — 今日食譜推薦引擎
// 對照 TECH-SPEC 4.5、PRD 5.5/5.6。
// 三軸（蛋白質×主食×醬料/烹調法）做笛卡爾積組合，依熱量/難度/飲食限制/過敏原/回饋排序。
// 注意：此函式需讀取 data/*.json 與 recipe_feedback，故為 async（回傳 Promise）。

(function () {
  "use strict";

  const SLOTS = ["breakfast", "lunch", "afternoon_tea", "dinner", "snack"];
  const TIER_RANK = { "🟢": 0, "🟡": 1, "🔴": 2 };
  const RANK_TO_TIER = { 0: "🟢", 1: "🟡", 2: "🔴" };
  // 備餐時間 → 可接受難度上限（rank）。「幾乎無」只給 🟢；其餘級距自行訂定。
  const PREPTIME_MAX_RANK = {
    "幾乎無": 0,
    "5 分鐘內": 1,
    "15 分鐘內": 2,
    "30 分鐘以上": 2,
  };
  const SCALE_MIN = 0.7;
  const SCALE_MAX = 1.3;

  // 份量換算（2026-09-25 修正）：三軸資料是「每 100g」營養值，實際一餐不會只吃 100g。
  // 直接把三個 100g 值相加會嚴重低估總熱量（例如雞胸肉+燕麥片最高只有 529kcal，
  // 導致熱量配額較高的午餐永遠配不到組合）。改用實際份量估算：
  // 蛋白質來源約 130g、主食約 150g、醬料/烹調法屬調味用量約 20g（烹調技法本身
  // kcal_100g 為 0，不受此換算影響）。
  const PROTEIN_SERVING_G = 130;
  const STAPLE_SERVING_G = 150;
  const SAUCE_SERVING_G = 20;

  let _axesCache = null;

  async function fetchJson(url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error("[recommend.js] 載入種子資料失敗：" + url);
    return await res.json();
  }

  async function loadAxes() {
    if (_axesCache) return _axesCache;
    const [proteins, staples, sauces] = await Promise.all([
      fetchJson("data/protein_sources.json"),
      fetchJson("data/staples.json"),
      fetchJson("data/sauce_methods.json"),
    ]);
    _axesCache = { proteins: proteins, staples: staples, sauces: sauces };
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

  async function getTodayRecommendation(remainingBudget, hardConstraints, preptimeToday, dietRestriction, allergens) {
    const axes = await loadAxes();
    const budgetBySlot = (remainingBudget && remainingBudget.perSlotSuggestion) || {};
    const constraints = hardConstraints || { proteinGapToday: 0, fiberGapThisWeek: 0 };
    const maxRank = PREPTIME_MAX_RANK.hasOwnProperty(preptimeToday)
      ? PREPTIME_MAX_RANK[preptimeToday]
      : 2;
    const allergenList = parseAllergens(allergens);

    // 笛卡爾積；任一軸 kcal 為 null 就跳過（無法計算熱量，無法判斷份量）
    const combos = [];
    axes.proteins.forEach(function (p) {
      axes.staples.forEach(function (s) {
        axes.sauces.forEach(function (m) {
          if (p.kcal_100g == null || s.kcal_100g == null || m.kcal_100g == null) return;
          const rank = Math.max(tierRank(p.prep_tier), tierRank(s.prep_tier), tierRank(m.prep_tier));
          // 份量比例（每 100g 營養值 × 實際份量／100）
          const pr = PROTEIN_SERVING_G / 100;
          const sr = STAPLE_SERVING_G / 100;
          const mr = SAUCE_SERVING_G / 100;
          combos.push({
            id: p.id + "_" + s.id + "_" + m.id,
            name: p.name + " + " + s.name + " + " + m.name,
            protein_name: p.name,
            staple_name: s.name,
            sauce_name: m.name,
            kcal: round1(num(p.kcal_100g) * pr + num(s.kcal_100g) * sr + num(m.kcal_100g) * mr),
            protein_g: round1(num(p.protein_100g) * pr + num(s.protein_100g) * sr + num(m.protein_100g) * mr),
            carb_g: round1(num(p.carb_100g) * pr + num(s.carb_100g) * sr + num(m.carb_100g) * mr),
            fat_g: round1(num(p.fat_100g) * pr + num(s.fat_100g) * sr + num(m.fat_100g) * mr),
            fiber_g: round1(num(p.fiber_100g) * pr + num(s.fiber_100g) * sr + num(m.fiber_100g) * mr),
            tier: RANK_TO_TIER[rank],
            tier_rank: rank,
            diet_tags: unionTags(p.diet_tags, s.diet_tags, m.diet_tags),
            allergen_tags: unionTags(p.allergen_tags, s.allergen_tags, m.allergen_tags),
          });
        });
      });
    });

    // 一次抓所有候選的回饋（rating / shown_count / last_shown_date）
    const feedbackMap = {};
    await Promise.all(
      combos.map(async function (c) {
        try {
          const fb = await getRecipeFeedback(c.id);
          if (fb) feedbackMap[c.id] = fb;
        } catch (e) {
          /* 忽略單筆錯誤 */
        }
      })
    );

    const result = {};
    SLOTS.forEach(function (slot) {
      const budget = num(budgetBySlot[slot]);

      const candidates = combos.filter(function (c) {
        if (c.tier_rank > maxRank) return false;
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
      const scale = budget > 0 ? budget / top.kcal : 1;
      result[slot] = Object.assign({}, top, {
        scale: round1(scale),
        scaled_kcal: round1(top.kcal * scale),
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
})();
