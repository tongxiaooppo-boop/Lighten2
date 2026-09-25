// 輕盈計畫 (Lighten Plan) — 今日食譜推薦引擎
// 對照 TECH-SPEC 4.5、PRD 5.5/5.6。
// 候選池由三個來源組成，共用同一套 tier/過敏原/飲食限制/份量比對篩選與評分：
//   1. 自組食譜：data/dish_archetypes.json 定義的「餐型骨架」，組合只在餐型內部展開
//      （is_convenience=false, is_delivery=false, is_composed=true）
//   2. 超商/現成即食品項：data/convenience_items.json，含「主餐＋1~2個飲品/點心棒」的多品項組合
//      （is_convenience=true, is_delivery=false）
//   3. 台式熱門品項（外送/餐廳）：data/taiwan_items.json，透過 getTaiwanItems() 取得
//      （is_convenience=false, is_delivery=true）
// 2026-09-25 四輪修訂記錄（詳見 PRD 5.5/5.6 節、TECH-SPEC 4.5 節）：
//   - 新增「蔬菜」軸（原本三軸組出來的餐點永遠沒有實際蔬菜份量）
//   - 新增超商即食品項候選池 + 多品項組合
//   - 經 Opus 兩輪審查後：把「早/午餐自動加權超商」的軟性加分機制，改成使用者可在基本資料分頁
//     逐時段設定的硬性來源篩選（mealPrefs），並把 taiwan_items.json 正式併入候選池（標記 is_delivery）
//   - 二輪重構（Opus 兩輪磋商 + 使用者實測抓到「乳清蛋白粉+燕麥+菠菜+韓式泡菜」荒謬組合）：
//     自組食譜改用「餐型骨架」（dish_archetypes.json）取代無限制四軸笛卡爾積，槽位不對稱、
//     每個食材用自己的 serving_g 取代全軸統一份量常數，乳清蛋白粉移出正餐池（item_class=supplement，
//     這輪不提供任何出場路徑），同一天各時段不重複主蛋白質/餐型，食安 requires_cooking 過濾提前一輪已修
//   - 三輪重構（Opus 三輪磋商，使用者質疑彈性點數該看實際總量超標）：移除 uses_flex/flexLedger，
//     台式外送品項不再有額度不足就不推薦的特殊邏輯；score() 蛋白質改「夠好就好」、近期降權改綁
//     蛋白質/蔬菜來源不是綁確切組合、「喜歡」加分降低，解決「每天都推薦同一種蛋白質」的問題
// 注意：此函式需讀取 data/*.json、recipe_feedback、taiwan_items（經 database.js 快取），故為 async。

(function () {
  "use strict";

  const SLOTS = ["breakfast", "lunch", "afternoon_tea", "dinner", "snack"];
  const TIER_RANK = { "🟢": 0, "🟡": 1, "🔴": 2 };
  const RANK_TO_TIER = { 0: "🟢", 1: "🟡", 2: "🔴" };
  // 2026-09-25 二輪重構（Opus 兩輪磋商 + 使用者實測回饋）：拿掉全軸統一的份量常數
  // （原本蛋白質一律130g/主食一律150g，不分生熟/乾濕重，直接導致「乳清蛋白粉+燕麥」單早餐算出1159kcal的荒謬結果）。
  // 改成每個食材自己的 serving_g/nutrient_basis（見各 data/*.json），份量差距靠「主食/主要槽位」等比縮放去吸收，
  // 縮放範圍限制在 PRIMARY_SLOT_SCALE_RANGE 內（≈半份到兩份），不再無限制硬湊。
  const PRIMARY_SLOT_SCALE_RANGE = { min: 0.5, max: 2.0 };

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
    const [proteins, staples, sauces, rawIngredients, convenienceItems, taiwanItems, archetypes] = await Promise.all([
      fetchJson("data/protein_sources.json"),
      fetchJson("data/staples.json"),
      fetchJson("data/sauce_methods.json"),
      fetchJson("data/raw_ingredients.json"),
      fetchJson("data/convenience_items.json"),
      getTaiwanItems(), // database.js 已修正為直接 fetch + 快取，跟 feast.js/tab-ledger.js 共用同一份資料
      fetchJson("data/dish_archetypes.json"),
    ]);
    const vegetables = rawIngredients.filter(function (it) {
      return it.category === "蔬菜";
    });
    _axesCache = {
      proteins: proteins, staples: staples, sauces: sauces,
      vegetables: vegetables, convenienceItems: convenienceItems, taiwanItems: taiwanItems,
      archetypes: archetypes,
    };
    return _axesCache;
  }

  function byId(list, id) {
    for (let i = 0; i < list.length; i++) {
      if (list[i].id === id) return list[i];
    }
    return null;
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

  // 自組食譜可以靠「主要槽位」（有主食槽用主食，沒有的用蛋白質）在 PRIMARY_SLOT_SCALE_RANGE
  // 內縮放去貼近熱量預算；超商/台式外送是真實商品，不能縮放，固定用天然份量的熱量。
  // 回傳值同時給 score() 判斷貼近度、也給最終結果組裝實際要顯示的份量。
  function achievableNutrition(c, budget) {
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

  // 2026-09-25 二輪重構（Opus 三輪磋商，查證 runtime 資料管線後修正）：
  // 「每天都吃雞胸肉」的真正原因不是蛋白質加分公式，是這三處，逐一修：
  //   1. 蛋白質「越多分越高」會系統性偏好蛋白質密度最高的來源（雞胸肉/鮭魚）。改成「夠好就好」，
  //      超過 PROTEIN_SATISFICE_G 之後不再加分，讓熱量貼近度/多樣性去決定勝負，不是蛋白質本身。
  //   2. 「近期出現過降權」原本只看「這個確切組合」的 shown_count/last_shown_date，換個蔬菜就能
  //      繞過懲罰，吃的其實還是同一個蛋白質來源。新增 recencyMap（依「蛋白質來源」跟「蔬菜」
  //      分別聚合最近出現天數），額外扣分，讓懲罰跟著食材走，不是跟著組合走。
  //   3. 「喜歡」加 100 分會蓋過所有懲罰，一被按讚就永遠排第一。降到 40 分，讓多樣性懲罰
  //      （最多可疊加到 120 分）偶爾能蓋過去，被喜歡的東西還是會出現，只是不會天天都選它。
  //   另外也查出 shown_count/last_shown_date 過去只在「倒讚」時才寫入，單純顯示從沒被記錄過，
  //   這條降權邏輯其實是死碼；已在 database.js 新增 markRecipesShown()、tab-today.js 顯示時呼叫修正。
  var PROTEIN_SATISFICE_G = 25; // 約一個手掌心蛋白質的量，達到這個量之後多蛋白質不再加分
  var LIKE_BONUS = 40;

  function score(combo, fb, constraints, budget, recencyMap) {
    let s = 0;
    if (fb) {
      if (fb.rating === "like") s += LIKE_BONUS;
      s -= (fb.shown_count || 0) * 5;
      const days = daysSince(fb.last_shown_date);
      if (days < 3) s -= (3 - days) * 20; // 這個確切組合近期出現過 → 降權
    }
    if (combo.is_composed && combo.protein_name && recencyMap && recencyMap[combo.protein_name]) {
      const days = recencyMap[combo.protein_name].days;
      if (days < 3) s -= (3 - days) * 20; // 這個蛋白質來源（不管配什麼菜/主食）近期出現過 → 降權
    }
    if (combo.is_composed && combo.vegetable_name && recencyMap && recencyMap["veg:" + combo.vegetable_name]) {
      const days = recencyMap["veg:" + combo.vegetable_name].days;
      if (days < 3) s -= (3 - days) * 10; // 蔬菜也做一樣的降權，權重比蛋白質輕（蔬菜種類本來就該常換）
    }
    if (constraints.proteinGapToday > 0) s += Math.min(combo.protein_g, PROTEIN_SATISFICE_G) * 0.5;
    if (constraints.fiberGapThisWeek > 0) s += combo.fiber_g * 2;
    if (budget > 0) {
      const eff = achievableNutrition(combo, budget);
      s -= Math.abs(budget / eff.kcal - 1) * 50; // 用「縮放後貼近預算的實際熱量」評分，不是天然份量的熱量
    }
    return s;
  }

  // 依「蛋白質來源」跟「蔬菜」分別聚合候選池裡最近一次出現的天數（蔬菜 key 加 "veg:" 前綴避免
  // 跟蛋白質名稱撞到），供 score() 的降權判斷使用。只看自組食譜（is_composed），超商/台式外送不受影響。
  function buildRecencyMap(combos, feedbackMap) {
    const recency = {};
    function record(key, days) {
      const cur = recency[key];
      if (!cur || days < cur.days) recency[key] = { days: days };
    }
    combos.forEach(function (c) {
      if (!c.is_composed) return;
      const fb = feedbackMap[c.id];
      if (!fb) return;
      const days = daysSince(fb.last_shown_date);
      if (c.protein_name) record(c.protein_name, days);
      if (c.vegetable_name) record("veg:" + c.vegetable_name, days);
    });
    return recency;
  }

  // remainingBudget: budget.js 回傳的 { perSlotSuggestion }
  // hardConstraints: matcher.js 回傳的 { proteinGapToday, fiberGapThisWeek }
  // mealPrefs: profile.meal_prefs（5個時段各自的來源偏好，見上方 SOURCE_OPTIONS），可為 null（全部用預設值）
  // 2026-09-25 二輪重構：移除第6個參數 flexLedger——彈性帳本改成逐日結算（見 feast.js），
  // 台式外送品項不再有「uses_flex額度不足就不推薦」的特殊邏輯，跟其他來源一樣單純比熱量貼近度。
  async function getTodayRecommendation(remainingBudget, hardConstraints, mealPrefs, dietRestriction, allergens) {
    const axes = await loadAxes();
    const budgetBySlot = (remainingBudget && remainingBudget.perSlotSuggestion) || {};
    const constraints = hardConstraints || { proteinGapToday: 0, fiberGapThisWeek: 0 };
    const allergenList = parseAllergens(allergens);

    // ---------- 1. 自組食譜（餐型骨架，取代舊的四軸無限制笛卡爾積） ----------
    // 2026-09-25 二輪重構：組合只在每個「餐型」（dish_archetypes.json）內部展開，槽位不對稱
    // （例如早餐碗沒有蔬菜/醬料槽），不再讓任意蛋白質跟任意蔬菜/醬料亂配（乳清蛋白粉+菠菜+韓式泡菜這種）。
    // 每個食材用自己的 serving_g（見各 data/*.json）算天然一份的營養值；用「主要槽位」
    // （有主食槽的用主食、沒有主食槽的用蛋白質）在 PRIMARY_SLOT_SCALE_RANGE 內縮放去對熱量預算，
    // 蔬菜/蛋白質（非主要槽位時）維持天然份量不縮放，對應「蔬菜固定下限、蛋白質約一掌心」的份量原則。
    const combos = [];

    function itemContribution(it, servingG) {
      const r = (servingG != null ? servingG : (it.serving_g != null ? it.serving_g : 100)) / 100;
      return {
        kcal: num(it.kcal_100g) * r,
        protein_g: num(it.protein_100g) * r,
        carb_g: num(it.carb_100g) * r,
        fat_g: num(it.fat_100g) * r,
        fiber_g: num(it.fiber_100g) * r,
      };
    }

    function pickList(axesList, allowIds) {
      if (!allowIds || allowIds.length === 0) return [null];
      return allowIds.map(function (id) { return byId(axesList, id); }).filter(Boolean);
    }

    axes.archetypes.forEach(function (arche) {
      const proteinList = pickList(axes.proteins, arche.protein && arche.protein.allow);
      const stapleList = pickList(axes.staples, arche.staple && arche.staple.allow);
      // 蔬菜/醬料即使餐型有白名單，也一律附加一個「不加」的選項（null），因為它們本來就是加分項不是必要項；
      // 餐型白名單是空陣列時 pickList 已經回傳 [null]，這裡另外處理「有白名單但這次不想加」的情況。
      const vegetableList = (arche.vegetable && arche.vegetable.allow && arche.vegetable.allow.length > 0)
        ? pickList(axes.vegetables, arche.vegetable.allow).concat([null])
        : [null];
      const seasoningList = (arche.seasoning && arche.seasoning.allow && arche.seasoning.allow.length > 0)
        ? pickList(axes.sauces, arche.seasoning.allow).concat([null])
        : [null];
      const methodList = (arche.methods || []).map(function (id) { return byId(axes.sauces, id); }).filter(Boolean);

      proteinList.forEach(function (p) {
        if (!p || p.kcal_100g == null) return;
        stapleList.forEach(function (s) {
          if (s && s.kcal_100g == null) return;
          vegetableList.forEach(function (v) {
            if (v && v.kcal_100g == null) return;
            seasoningList.forEach(function (season) {
              if (season && season.kcal_100g == null) return;
              methodList.forEach(function (m) {
                // 食安：免開火只能配不需要煮熟的食材（見 P0 修正），適用於這個組合裡出現的每一個槽位。
                if (m.id === "sm_no_cook" && [p, s, v, season].some(function (it) { return it && it.requires_cooking; })) return;

                // 有主食槽的餐型用主食當「主要縮放槽位」，沒有主食槽的（例如煎蛋類）用蛋白質。
                const hasStapleSlot = !!(arche.staple && arche.staple.allow && arche.staple.allow.length > 0);
                const primaryItem = hasStapleSlot ? s : p;
                const primaryContribution = primaryItem ? itemContribution(primaryItem) : { kcal: 0, protein_g: 0, carb_g: 0, fat_g: 0, fiber_g: 0 };

                const parts = [
                  itemContribution(p),
                  s ? itemContribution(s) : null,
                  v ? itemContribution(v) : null,
                  season ? itemContribution(season) : null,
                ].filter(Boolean);
                const total = parts.reduce(function (acc, part) {
                  acc.kcal += part.kcal; acc.protein_g += part.protein_g; acc.carb_g += part.carb_g;
                  acc.fat_g += part.fat_g; acc.fiber_g += part.fiber_g;
                  return acc;
                }, { kcal: 0, protein_g: 0, carb_g: 0, fat_g: 0, fiber_g: 0 });

                const items = [p, s, v, season].filter(Boolean);
                const rank = Math.max(tierRank(m.prep_tier), items.reduce(function (r, it) { return Math.max(r, tierRank(it.prep_tier)); }, 0));
                const nameParts = [p.name, s && s.name, v && v.name, season && season.name].filter(Boolean);

                combos.push({
                  id: arche.id + "_" + p.id + "_" + (s ? s.id : "none") + "_" + (v ? v.id : "none") + "_" + (season ? season.id : "none") + "_" + m.id,
                  archetype_id: arche.id,
                  name: nameParts.join(" + "),
                  protein_name: p.name,
                  staple_name: s ? s.name : null,
                  vegetable_name: v ? v.name : null,
                  sauce_name: season ? season.name : m.name,
                  kcal: round1(total.kcal),
                  protein_g: round1(total.protein_g),
                  carb_g: round1(total.carb_g),
                  fat_g: round1(total.fat_g),
                  fiber_g: round1(total.fiber_g),
                  primary_kcal: primaryContribution.kcal,
                  primary_protein_g: primaryContribution.protein_g,
                  primary_carb_g: primaryContribution.carb_g,
                  primary_fat_g: primaryContribution.fat_g,
                  primary_fiber_g: primaryContribution.fiber_g,
                  is_composed: true,
                  tier: RANK_TO_TIER[rank],
                  tier_rank: rank,
                  diet_tags: unionTags.apply(null, items.map(function (it) { return it.diet_tags; }).concat([m.diet_tags])),
                  allergen_tags: unionTags.apply(null, items.map(function (it) { return it.allergen_tags; }).concat([m.allergen_tags])),
                  is_convenience: false,
                  is_delivery: false,
                });
              });
            });
          });
        });
      });
    });

    // ---------- 2. 超商即食品項（含「主餐＋1~2個飲品/點心棒」多品項組合） ----------
    const EXTRA_CATEGORIES = { "飲品": true, "蛋白飲/點心棒": true };

    // convenience_items.json 的 note 欄位混雜「資料來源/通路」跟「內容物描述」兩種資訊，
    // 格式固定是「...資料來源說明；實際內容物描述」，取「；」後半段給使用者看，前半段是內部備註不顯示。
    function extractContentNote(note) {
      if (!note) return null;
      const idx = note.indexOf("；");
      if (idx === -1) return null;
      const rest = note.slice(idx + 1).trim();
      return rest || null;
    }

    function toConvenienceCombo(items) {
      const tags = items.map(function (it) { return it.diet_tags; });
      const allergens2 = items.map(function (it) { return it.allergen_tags; });
      const maxTierRank = items.reduce(function (r, it) { return Math.max(r, tierRank(it.tier)); }, 0);
      const notes = items.map(function (it) { return extractContentNote(it.note); }).filter(Boolean);
      return {
        id: items.map(function (it) { return it.id; }).join("+"),
        name: items.map(function (it) { return it.name; }).join(" ＋ "),
        protein_name: null,
        content_note: notes.length > 0 ? notes.join("；") : null,
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

    // ---------- 3. 台式熱門品項（外送/餐廳） ----------
    // 2026-09-25 二輪重構：移除 uses_flex 額度判斷，改跟其他來源一樣單純比熱量貼近度，
    // 彈性帳本改成逐日結算（daily_log 本身就是唯一真相來源），不用在推薦階段另外攔一次。
    axes.taiwanItems.forEach(function (it) {
      if (isTooWideRange(it)) return; // 熱量區間太寬（無代表值且high/low≥1.5倍），不夠精準，不進推薦池
      const validSlots = TAIWAN_CATEGORY_SLOTS[it.category];
      if (!validSlots) return; // 目前沒有對應時段的分類（理論上不會發生，六類都已對照）
      const kcal = it.kcal_rep != null ? it.kcal_rep : round1((it.kcal_low + it.kcal_high) / 2);
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
        valid_slots: validSlots,
      });
    });

    // ---------- 批次讀取回饋（一次 iterate，取代逐一 getRecipeFeedback） ----------
    const feedbackMap = await getAllRecipeFeedback();
    const recencyMap = buildRecencyMap(combos, feedbackMap);

    // 2026-09-25 二輪重構：同一天的各時段之間，自組食譜不重複主蛋白質、同一餐型最多出現一次
    // （對應使用者實測抓到「早餐晚餐都乳清+燕麥+泡菜」的荒謬案例）。只影響自組食譜，
    // 超商/台式外送是真實獨立商品，不受這條限制。
    const usedProteinNames = {};
    const usedArchetypeIds = {};

    const result = {};
    SLOTS.forEach(function (slot) {
      const budget = num(budgetBySlot[slot]);
      const sourcePref = getSourcePref(mealPrefs, slot);
      const maxRank = maxRankForSource(sourcePref);

      const baseCandidates = combos.filter(function (c) {
        if (c.tier_rank > maxRank) return false;
        if (c.is_delivery && c.valid_slots.indexOf(slot) === -1) return false;
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
        if (c.is_composed) {
          if (c.protein_name && usedProteinNames[c.protein_name]) return false;
          if (c.archetype_id && usedArchetypeIds[c.archetype_id]) return false;
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
        const sa = score(a, feedbackMap[a.id], constraints, budget, recencyMap);
        const sb = score(b, feedbackMap[b.id], constraints, budget, recencyMap);
        if (sb !== sa) return sb - sa;
        return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
      });

      const top = candidates[0];
      const eff = achievableNutrition(top, budget);
      if (top.is_composed) {
        if (top.protein_name) usedProteinNames[top.protein_name] = true;
        if (top.archetype_id) usedArchetypeIds[top.archetype_id] = true;
      }
      result[slot] = Object.assign({}, top, {
        scale: round1(eff.scale),
        scaled_kcal: eff.kcal,
        protein_g: eff.protein_g,
        carb_g: eff.carb_g,
        fat_g: eff.fat_g,
        fiber_g: eff.fiber_g,
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
