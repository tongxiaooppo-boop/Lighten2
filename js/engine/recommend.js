// 輕盈計畫 (Lighten Plan) — 今日食譜推薦引擎
// 對照 TECH-SPEC 4.5、PRD 5.5/5.6。
// 候選池由三個來源組成，共用同一套 tier/過敏原/飲食限制/份量比對篩選與評分：
//   1. 自組食譜：data/dish_archetypes.json 定義的「餐型骨架」，組合只在餐型內部展開
//      （is_convenience=false, is_delivery=false, is_composed=true）
//   2. 超商即食品項：data/convenience_items.json 裡 channel=convenience 的品項（is_convenience=true）
//   3. 外食／外賣：data/taiwan_items.json（透過 getTaiwanItems() 取得），加上 convenience_items.json 裡
//      channel=delivery 的連鎖健康餐盒／宅配健身餐（is_delivery=true）
//   2、3 共用同一個「統一成分模型」生成器：品項在資料裡標 role/valid_slots，依一張規則表組合。
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
//   - 2026-09-27 整案審查（collab/opus-review-log/2026-09-27-full-project-audit.md）：飲食限制改逐成分判斷、
//     過敏原改固定詞彙＋「未確認」保守排除、現成品項改統一成分模型、已記錄時段不再推薦、跨時段不重複成分、
//     纖維加分封頂
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

  // 品項能出現在哪些時段、扮演什麼角色（主餐/配菜/飲料/點心），一律看資料本身的 valid_slots/role，
  // 見下方「統一成分模型」那段；這裡不再用分類名稱對照時段。
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

  // 過敏原固定詞彙（基本資料分頁的勾選框選項，資料裡的 allergen_tags 也只用這些詞）。
  const ALLERGEN_OPTIONS = ["甲殼類", "魚", "蛋", "乳製品", "堅果", "麩質", "黃豆", "芝麻"];
  // 複合料理沒人逐項審過過敏原時標這個；使用者只要設了任何過敏原，這類品項一律排除。
  const UNVERIFIED_ALLERGEN = "未確認";
  // 舊版是自由文字輸入，常見寫法對回固定詞彙（打「蝦」比對不到資料裡的「甲殼類」）。
  const ALLERGEN_SYNONYMS = {
    "蝦": "甲殼類", "蝦子": "甲殼類", "蝦仁": "甲殼類", "蟹": "甲殼類", "螃蟹": "甲殼類", "甲殼": "甲殼類",
    "魚類": "魚", "海鮮": "甲殼類",
    "雞蛋": "蛋", "蛋類": "蛋",
    "牛奶": "乳製品", "奶": "乳製品", "乳": "乳製品", "乳糖": "乳製品", "奶製品": "乳製品", "起司": "乳製品",
    "花生": "堅果", "杏仁": "堅果", "核桃": "堅果",
    "小麥": "麩質", "麵粉": "麩質",
    "大豆": "黃豆", "豆漿": "黃豆", "豆腐": "黃豆", "黃豆製品": "黃豆",
  };

  // 回傳 { list: 固定詞彙陣列, unknown: 對不回固定詞彙的舊文字 }。
  // 接受新版陣列，也接受舊版自由文字字串（逗號/頓號/空白分隔）。
  function normalizeAllergens(input) {
    const raw = Array.isArray(input)
      ? input
      : String(input || "").split(/[,、，;；\s]+/);
    const list = [];
    const unknown = [];
    raw.forEach(function (x) {
      const t = String(x || "").trim();
      if (!t) return;
      const mapped = ALLERGEN_OPTIONS.indexOf(t) !== -1 ? t : ALLERGEN_SYNONYMS[t];
      if (mapped) {
        if (list.indexOf(mapped) === -1) list.push(mapped);
      } else if (unknown.indexOf(t) === -1) {
        unknown.push(t);
      }
    });
    return { list: list, unknown: unknown };
  }

  // 使用者有設任何過敏原（含對不回固定詞彙的舊文字）→ 未確認的品項排除；命中任一過敏原 → 排除。
  function passesAllergens(allergenTags, userAllergens) {
    if (userAllergens.list.length === 0 && userAllergens.unknown.length === 0) return true;
    if (allergenTags.indexOf(UNVERIFIED_ALLERGEN) !== -1) return false;
    return !userAllergens.list.some(function (a) { return allergenTags.indexOf(a) !== -1; });
  }

  function tagSatisfies(tags, restriction) {
    const t = tags || [];
    if (t.indexOf(restriction) !== -1) return true;
    return restriction === "蛋奶素" && t.indexOf("全素") !== -1; // 全素一定也符合蛋奶素
  }

  // 2026-09-27 整案審查 A1：組合的飲食標記原本是所有成分的「聯集」，只要其中一樣（例如豆漿）帶全素，
  // 整組雞肉炒飯就通過全素篩選。改成「每個成分都要符合」，烹調法（kind=method）不是食物不參與判斷。
  function passesDiet(dietTagSets, dietRestriction) {
    if (!dietRestriction || dietRestriction === "一般" || dietRestriction === "無特殊限制") {
      return true;
    }
    return dietTagSets.length > 0 && dietTagSets.every(function (tags) {
      return tagSatisfies(tags, dietRestriction);
    });
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
    // 纖維加分以「這週平均還差多少」封頂：原本每克 ×2 沒有上限，高纖豆漿＋海藻沙拉能多拿 30 分，
    // 等於 60% 的熱量偏差，結果幾乎每一餐都變成「沙拉＋高纖豆漿」（2026-09-27 整案審查第 3 節）。
    if (constraints.fiberGapThisWeek > 0) s += Math.min(combo.fiber_g, constraints.fiberGapThisWeek) * 2;
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

  // 候選池只跟種子資料有關（跟預算、偏好、回饋都無關），建一次就快取。
  // 也給 tools/check-engine.js 直接檢查整個候選池用（不是只看最後被挑中的那幾組）。
  let _poolCache = null;
  async function buildCandidatePool() {
    if (_poolCache) return _poolCache;
    const axes = await loadAxes();
    const combos = [];

    // ---------- 1. 自組食譜（餐型骨架，取代舊的四軸無限制笛卡爾積） ----------
    // 2026-09-25 二輪重構：組合只在每個「餐型」（dish_archetypes.json）內部展開，槽位不對稱
    // （例如早餐碗沒有蔬菜/醬料槽），不再讓任意蛋白質跟任意蔬菜/醬料亂配（乳清蛋白粉+菠菜+韓式泡菜這種）。
    // 每個食材用自己的 serving_g（見各 data/*.json）算天然一份的營養值；用「主要槽位」
    // （有主食槽的用主食、沒有主食槽的用蛋白質）在 PRIMARY_SLOT_SCALE_RANGE 內縮放去對熱量預算，
    // 蔬菜/蛋白質（非主要槽位時）維持天然份量不縮放，對應「蔬菜固定下限、蛋白質約一掌心」的份量原則。

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
                  valid_slots: arche.valid_slots || null, // 餐型自己標適用時段（例如熱炒定食不會出現在早餐／下午茶）
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
                  components: items.map(function (it) { return it.id; }),
                  diet_tag_sets: items.map(function (it) { return it.diet_tags || []; }), // 烹調法 m 不是食物，不參與飲食限制判斷
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

    // ---------- 2. 現成品項（超商／外食外賣）：統一成分模型、單一生成器 ----------
    // 2026-09-27 整案審查（opus-review-log/2026-09-27-full-project-audit.md 第 3 節）重設計：
    // 原本同一個「這是主餐還是飲料、能出現在哪個時段」的概念分散在分類名稱、is_drink、bundled_drink、
    // 寫死的早餐飲料 id 清單、分類→時段對照表等 7 套機制裡，每修一個 bug 就多一條規則。
    // 現在每個品項在資料裡自己標 role（main/side/drink/snack）與 valid_slots，這裡只有一張規則表：
    //   - 正餐時段（早/午/晚/宵夜）：恰好 1 個 main，+ ≤1 side，+ ≤1 drink（main 已內含飲料時為 0），
    //     + ≤1 snack，總數 ≤3 件。飲料不會單獨成為一餐，一餐也不會出現兩杯飲料。
    //   - 下午茶：不需要 main，snack、drink 各 ≤1，至少 1 件。
    // 每個成分都要在該時段的 valid_slots 裡才會被拿來組合；不同來源（超商／外食）不互相混搭。
    function contentNote(note) {
      // convenience_items.json 的 note 格式是「資料來源說明；實際內容物描述」，只取「；」後半段給使用者看。
      if (!note) return null;
      const idx = note.indexOf("；");
      if (idx === -1) return null;
      return note.slice(idx + 1).trim() || null;
    }

    function fromConvenience(it) {
      return {
        uid: it.id, source_id: it.id, name: it.name, role: it.role, valid_slots: it.valid_slots || [],
        contains_drink: !!it.contains_drink, channel: it.channel === "delivery" ? "delivery" : "convenience",
        kcal: num(it.kcal), protein_g: num(it.protein_g), carb_g: num(it.carb_g), fat_g: num(it.fat_g), fiber_g: num(it.fiber_g),
        tier_rank: tierRank(it.tier), diet_tags: it.diet_tags || [],
        allergen_tags: Array.isArray(it.allergen_tags) ? it.allergen_tags : [UNVERIFIED_ALLERGEN],
        note: contentNote(it.note), is_taiwan: false,
      };
    }

    function fromTaiwan(it) {
      return {
        uid: "tw_" + it.id, source_id: it.id, name: it.name, role: it.role, valid_slots: it.valid_slots || [],
        contains_drink: !!it.contains_drink, channel: "delivery",
        kcal: it.kcal_rep != null ? it.kcal_rep : round1((it.kcal_low + it.kcal_high) / 2),
        protein_g: num(it.protein_g), carb_g: 0, fat_g: 0, fiber_g: num(it.fiber_g),
        tier_rank: 0, // 外食品項對使用者來說零烹調成本
        diet_tags: [], // 台式品項沒有飲食限制標記：有設定飲食限制的使用者一律看不到，刻意的保守預設
        allergen_tags: Array.isArray(it.allergen_tags) ? it.allergen_tags : [UNVERIFIED_ALLERGEN],
        note: null, is_taiwan: true,
      };
    }

    function toItemCombo(members) {
      const maxTierRank = members.reduce(function (r, m) { return Math.max(r, m.tier_rank); }, 0);
      const notes = members.map(function (m) { return m.note; }).filter(Boolean);
      const single = members.length === 1 ? members[0] : null;
      return {
        id: members.map(function (m) { return m.uid; }).join("+"),
        // 單一台式品項記錄時用 source_id 對回 taiwan_items；多品項組合沒有單一對應，直接記組合本身的數字。
        source_id: single && single.is_taiwan ? single.source_id : null,
        components: members.map(function (m) { return m.uid; }),
        name: members.map(function (m) { return m.name; }).join(" ＋ "),
        protein_name: null,
        content_note: notes.length > 0 ? notes.join("；") : null,
        kcal: round1(members.reduce(function (s, m) { return s + m.kcal; }, 0)),
        protein_g: round1(members.reduce(function (s, m) { return s + m.protein_g; }, 0)),
        carb_g: round1(members.reduce(function (s, m) { return s + m.carb_g; }, 0)),
        fat_g: round1(members.reduce(function (s, m) { return s + m.fat_g; }, 0)),
        fiber_g: round1(members.reduce(function (s, m) { return s + m.fiber_g; }, 0)),
        tier: RANK_TO_TIER[maxTierRank],
        tier_rank: maxTierRank,
        diet_tag_sets: members.map(function (m) { return m.diet_tags; }),
        allergen_tags: unionTags.apply(null, members.map(function (m) { return m.allergen_tags; })),
        is_convenience: members[0].channel === "convenience",
        is_delivery: members[0].channel === "delivery",
        valid_slots: [],
      };
    }

    // 依規則表對一組同來源的品項展開所有合法組合；同一個組合在多個時段合法時只產生一次，valid_slots 累加。
    function generateItemCombos(items) {
      const byId = {};
      function add(members, slot) {
        const id = members.map(function (m) { return m.uid; }).join("+");
        if (!byId[id]) byId[id] = toItemCombo(members);
        byId[id].valid_slots.push(slot);
      }
      SLOTS.forEach(function (slot) {
        const here = items.filter(function (it) { return it.valid_slots.indexOf(slot) !== -1; });
        const ofRole = function (role) { return here.filter(function (it) { return it.role === role; }); };
        const mains = ofRole("main"), sides = ofRole("side"), drinks = ofRole("drink"), snacks = ofRole("snack");
        if (slot === "afternoon_tea") {
          snacks.forEach(function (sn) { add([sn], slot); });
          drinks.forEach(function (dr) { add([dr], slot); });
          snacks.forEach(function (sn) {
            drinks.forEach(function (dr) { add([sn, dr], slot); });
          });
          return;
        }
        mains.forEach(function (main) {
          const drinkOpts = main.contains_drink ? [null] : [null].concat(drinks);
          [null].concat(sides).forEach(function (side) {
            drinkOpts.forEach(function (drink) {
              [null].concat(snacks).forEach(function (snack) {
                const members = [main, side, drink, snack].filter(Boolean);
                if (members.length <= 3) add(members, slot);
              });
            });
          });
        });
      });
      return Object.keys(byId).map(function (id) { return byId[id]; });
    }

    const convenienceItems = axes.convenienceItems
      .filter(function (it) { return it.kcal != null; })
      .map(fromConvenience);
    const taiwanItems = axes.taiwanItems
      .filter(function (it) { return !isTooWideRange(it); }) // 熱量區間太寬，不夠精準，不進推薦池
      .map(fromTaiwan);
    // 超商品項、宅配／連鎖健康餐盒（channel=delivery）、台式外食各自獨立展開，不跨來源混搭。
    [
      convenienceItems.filter(function (it) { return it.channel === "convenience"; }),
      convenienceItems.filter(function (it) { return it.channel === "delivery"; }),
      taiwanItems,
    ].forEach(function (group) {
      Array.prototype.push.apply(combos, generateItemCombos(group));
    });

    _poolCache = combos;
    return combos;
  }

  // remainingBudget: budget.js 回傳的 { perSlotSuggestion }
  // hardConstraints: matcher.js 回傳的 { proteinGapToday, fiberGapThisWeek }
  // mealPrefs: profile.meal_prefs（5個時段各自的來源偏好，見上方 SOURCE_OPTIONS），可為 null（全部用預設值）
  // allergens: profile.allergens（新版為固定詞彙陣列，舊版自由文字字串也接受）
  // skipSlots: { slot: true } 不需要推薦的時段（已記錄／已預約／已關閉）。這些時段直接回傳 null，
  //   也不佔用跨時段的多樣性限制（2026-09-27 整案審查 A3：已吃的時段原本還會被推薦一個約 770 kcal 的新組合）。
  async function getTodayRecommendation(remainingBudget, hardConstraints, mealPrefs, dietRestriction, allergens, skipSlots) {
    const budgetBySlot = (remainingBudget && remainingBudget.perSlotSuggestion) || {};
    const constraints = hardConstraints || { proteinGapToday: 0, fiberGapThisWeek: 0 };
    const userAllergens = normalizeAllergens(allergens);
    const skip = skipSlots || {};

    const combos = await buildCandidatePool();

    // ---------- 批次讀取回饋（一次 iterate，取代逐一 getRecipeFeedback） ----------
    const feedbackMap = await getAllRecipeFeedback();
    const recencyMap = buildRecencyMap(combos, feedbackMap);

    // 同一天的各時段之間不重複：
    //   - 自組食譜：不重複主蛋白質、同一餐型最多出現一次（2026-09-25，使用者實測「早餐晚餐都乳清+燕麥+泡菜」）
    //   - 現成品項：任何一個成分（品項 id）只出現在一個時段（2026-09-27 整案審查 A5：原本只管自組食譜，
    //     結果午餐跟晚餐推薦一模一樣的「炊飯＋海藻沙拉＋高纖豆漿」）
    const usedProteinNames = {};
    const usedArchetypeIds = {};
    const usedItemIds = {};

    const result = {};
    SLOTS.forEach(function (slot) {
      if (skip[slot]) {
        result[slot] = null;
        return;
      }
      const budget = num(budgetBySlot[slot]);
      const sourcePref = getSourcePref(mealPrefs, slot);
      const maxRank = maxRankForSource(sourcePref);

      const baseCandidates = combos.filter(function (c) {
        if (c.tier_rank > maxRank) return false;
        if (c.valid_slots && c.valid_slots.indexOf(slot) === -1) return false;
        if (!passesAllergens(c.allergen_tags, userAllergens)) return false;
        if (!passesDiet(c.diet_tag_sets, dietRestriction)) return false;
        const fb = feedbackMap[c.id];
        if (fb && fb.rating === "dislike") return false; // 倒讚永久排除
        if (c.is_composed) {
          if (c.protein_name && usedProteinNames[c.protein_name]) return false;
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
        return { c: c, s: score(c, feedbackMap[c.id], constraints, budget, recencyMap) };
      });
      scored.sort(function (a, b) {
        if (b.s !== a.s) return b.s - a.s;
        return a.c.id < b.c.id ? -1 : a.c.id > b.c.id ? 1 : 0;
      });

      const top = scored[0].c;
      const eff = achievableNutrition(top, budget);
      if (top.is_composed) {
        if (top.protein_name) usedProteinNames[top.protein_name] = true;
        if (top.archetype_id) usedArchetypeIds[top.archetype_id] = true;
      } else {
        top.components.forEach(function (id) { usedItemIds[id] = true; });
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
  window.buildRecommendCandidatePool = buildCandidatePool;
  window.RECOMMEND_SLOTS = SLOTS;
  window.RECOMMEND_SLOT_LABELS = { breakfast: "早餐", lunch: "午餐", afternoon_tea: "下午茶", dinner: "晚餐", snack: "宵夜" };
  window.MEAL_SOURCE_OPTIONS = SOURCE_OPTIONS;
  window.DEFAULT_MEAL_PREFS = DEFAULT_MEAL_PREFS;
  window.ALLERGEN_OPTIONS = ALLERGEN_OPTIONS;
  window.normalizeAllergens = normalizeAllergens;
})();
