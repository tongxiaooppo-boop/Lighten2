// 輕盈計畫 — 推薦引擎／體重校正引擎斷言腳本
// 用法：在 repo 根目錄執行 `node tools/check-engine.js`，全部通過 exit 0，任何一條失敗 exit 1。
// 每次改 js/engine/、js/data/ 或 data/*.json 都要跑一次（pre-commit hook 會跑）。
// 來源：collab/opus-review-log/2026-09-27-full-project-audit.md 第 9 節。
// 這支只測得到引擎邏輯；分頁切換、撤銷按鈕這類畫面流程要照手機實機腳本手動跑。
// 直接 import 跟瀏覽器同一批 ES modules（engine 是純函式，資料由這裡讀好傳入）。

"use strict";

const fs = require("fs");
const path = require("path");
const { pathToFileURL } = require("url");

// 日期運算依賴本機時區，一律在台灣時區跑（CI 在 UTC，時區 bug 在那裡測不出來）
require("./lib/fake-env").ensureTaipeiTZ();

const ROOT = path.join(__dirname, "..");
const SLOTS = ["breakfast", "lunch", "afternoon_tea", "dinner", "snack"];
const MEAL_SLOTS = ["breakfast", "lunch", "dinner", "snack"];

const readJson = (f) => JSON.parse(fs.readFileSync(path.join(ROOT, "data", f), "utf8"));
const taiwanData = readJson("taiwan_items.json");
const convenienceData = readJson("convenience_items.json");

const imp = (rel) => import(pathToFileURL(path.join(ROOT, rel)).href);
let M = null; // main() 裡載入

// ---------- 成分資料對照（給斷言查 role / 標記用） ----------
const itemByUid = {};
convenienceData.forEach((it) => { itemByUid[it.id] = it; });
taiwanData.forEach((it) => { itemByUid["tw_" + it.id] = it; });

let failures = 0;
let checks = 0;
function check(cond, msg) {
  checks++;
  if (!cond) {
    failures++;
    console.log("  ✗ " + msg);
  }
}

function tagOk(tags, restriction) {
  const t = tags || [];
  return t.indexOf(restriction) !== -1 || (restriction === "蛋奶素" && t.indexOf("全素") !== -1);
}

function drinkCount(combo) {
  if (combo.is_composed) return 0;
  return combo.components.reduce((n, uid) => {
    const it = itemByUid[uid];
    return n + (it.role === "drink" ? 1 : 0) + (it.contains_drink ? 1 : 0);
  }, 0);
}

function mainCount(combo) {
  if (combo.is_composed) return 1;
  return combo.components.filter((uid) => itemByUid[uid].role === "main").length;
}

async function main() {
  M = {
    catalog: await imp("js/data/catalog.js"),
    db: await imp("js/data/db.js"),
    pool: await imp("js/engine/pool.js"),
    recommend: await imp("js/engine/recommend.js"),
    filters: await imp("js/engine/filters.js"),
    tdee: await imp("js/engine/tdee.js"),
    dates: await imp("js/core/dates.js"),
    config: await imp("js/core/config.js"),
    mc: await imp("js/engine/meal-content.js"),
    budget: await imp("js/engine/budget.js"),
    matcher: await imp("js/engine/matcher.js"),
    today: await imp("js/engine/today.js"),
    nutrition: await imp("js/engine/nutrition.js"),
    picker: await imp("js/engine/picker.js"),
    foods: await imp("js/engine/foods.js"),
  };
  const catalog = M.catalog.buildCatalog({
    ingredients: readJson("ingredients.json"), convenienceItems: convenienceData, taiwanItems: taiwanData,
    archetypes: readJson("dish_archetypes.json"),
  });
  const candidatePool = M.pool.buildCandidatePool(catalog);
  const recommendFor = (remainingBudget, constraints, prefs, diet, allergens, skip, lowCarb) => M.recommend.getTodayRecommendation({
    pool: candidatePool, feedbackMap: {}, remainingBudget: remainingBudget, hardConstraints: constraints,
    mealPrefs: prefs, dietRestriction: diet, allergens: allergens, skipSlots: skip, lowCarb: !!lowCarb, nowMs: Date.now(),
  });

  // ---------- 1. 資料本身 ----------
  console.log("[資料]");
  const ALLOWED_ALLERGENS = M.config.ALLERGEN_OPTIONS.concat(["未確認"]);
  convenienceData.concat(taiwanData).forEach((it) => {
    check(["main", "side", "drink", "snack"].indexOf(it.role) !== -1, it.id + " 缺 role 或 role 不合法");
    check(Array.isArray(it.valid_slots) && it.valid_slots.length > 0 && it.valid_slots.every((s) => SLOTS.indexOf(s) !== -1),
      it.id + " valid_slots 不合法");
    check(Array.isArray(it.allergen_tags), it.id + " 缺 allergen_tags");
    (it.allergen_tags || []).forEach((a) => check(ALLOWED_ALLERGENS.indexOf(a) !== -1, it.id + " 過敏原「" + a + "」不在固定詞彙內"));
    check(!(it.role === "drink" && it.contains_drink), it.id + " 是飲料又標 contains_drink");
  });

  readJson("dish_archetypes.json").forEach((a) => {
    check(Array.isArray(a.valid_slots) && a.valid_slots.length > 0 && a.valid_slots.every((s) => SLOTS.indexOf(s) !== -1),
      "餐型 " + a.id + " valid_slots 不合法");
  });

  // ---------- 2. 整個候選池的結構規則 ----------
  console.log("[候選池結構]");
  const pool = candidatePool;
  check(pool.length > 0, "候選池是空的");
  const ids = {};
  pool.forEach((c) => {
    check(!ids[c.id], "候選 id 重複：" + c.id);
    ids[c.id] = true;
    check(Array.isArray(c.valid_slots) && c.valid_slots.length > 0, c.id + " 沒有適用時段");
    if (c.is_composed) return;
    check(c.components.length <= 3, c.id + " 超過 3 件");
    check(!c.components.some((uid) => itemByUid[uid].is_treat), c.id + " 含不主動推薦的含糖/零食品項");
    check(drinkCount(c) <= 1, c.id + " 一個組合裡有兩杯以上飲料");
    c.valid_slots.forEach((slot) => {
      c.components.forEach((uid) => check(itemByUid[uid].valid_slots.indexOf(slot) !== -1, c.id + " 的成分 " + uid + " 不適用 " + slot));
      if (slot === "afternoon_tea") {
        check(mainCount(c) === 0, c.id + " 下午茶組合含主餐");
      } else {
        check(mainCount(c) === 1, c.id + " 在 " + slot + " 不是恰好一個主餐（純飲料或兩個主餐）");
      }
    });
    const channels = {};
    c.components.forEach((uid) => { channels[uid.indexOf("tw_") === 0 ? "tw" : (itemByUid[uid].channel || "convenience")] = true; });
    check(Object.keys(channels).length === 1, c.id + " 混了不同來源的品項");
  });

  // ---------- 3. 各種使用者設定下的實際推薦 ----------
  console.log("[實際推薦]");
  const DIETS = ["一般", "全素", "蛋奶素"];
  const LOW_CARB_MAX = M.config.LOW_CARB_MEAL_MAX_G;
  const SOURCES = ["auto", "convenience", "delivery", "cook_quick", "cook_full"];
  const BUDGETS = [150, 300, 500, 800];
  const ALLERGEN_CASES = [[]].concat(M.config.ALLERGEN_OPTIONS.map((a) => [a])).concat([["蝦、牛奶"]]);
  let scenarios = 0;
  const nullByDiet = {};

  for (const lowCarb of [false, true]) {
  for (const diet of DIETS) {
    for (const source of SOURCES) {
      for (const budget of BUDGETS) {
        for (const allergens of ALLERGEN_CASES) {
          scenarios++;
          const prefs = {};
          const perSlot = {};
          SLOTS.forEach((s) => { prefs[s] = source; perSlot[s] = budget; });
          const allergenInput = typeof allergens[0] === "string" && allergens[0].indexOf("、") !== -1 ? allergens[0] : allergens;
          const recs = recommendFor(
            { perSlotSuggestion: perSlot }, { proteinGapToday: 30, fiberGapThisWeek: 10 }, prefs, diet, allergenInput, {}, lowCarb
          );
          const userAllergens = M.filters.normalizeAllergens(allergenInput).list;
          const usedItems = {};
          const tag = (lowCarb ? "低碳+" : "") + diet + "/" + source + "/" + budget + "/" + JSON.stringify(allergenInput);
          SLOTS.forEach((slot) => {
            const r = recs[slot];
            if (!r) {
              nullByDiet[diet + ":" + slot] = (nullByDiet[diet + ":" + slot] || 0) + 1;
              return;
            }
            // 依序分配後，時段配額可能低於門檻，回傳 { lowBudget: true } 而非候選組合。
            // 這不是「找不到組合」，是「額度用完」，不做結構斷言。
            if (r.lowBudget) return;
            if (lowCarb) {
              check(r.carb_g != null && r.carb_g <= LOW_CARB_MAX + 1e-6, tag + " " + slot + " 開了低碳卻推薦碳水 " + r.carb_g + "g 的組合：" + r.name);
            }
            if (diet !== "一般") {
              check(r.diet_tag_sets.length > 0 && r.diet_tag_sets.every((t) => tagOk(t, diet)), tag + " " + slot + " 推薦了不符合" + diet + "的成分：" + r.name);
            }
            if (userAllergens.length > 0) {
              check(r.allergen_tags.indexOf("未確認") === -1, tag + " " + slot + " 設了過敏原卻推薦過敏原未確認的品項：" + r.name);
              userAllergens.forEach((a) => check(r.allergen_tags.indexOf(a) === -1, tag + " " + slot + " 推薦含" + a + "的品項：" + r.name));
            }
            if (!r.is_composed) {
              check(drinkCount(r) <= 1, tag + " " + slot + " 兩杯飲料：" + r.name);
              if (MEAL_SLOTS.indexOf(slot) !== -1) check(mainCount(r) === 1, tag + " " + slot + " 純飲料或沒有主餐：" + r.name);
              r.components.forEach((uid) => {
                check(!usedItems[uid], tag + " " + slot + " 跟前面時段重複成分 " + uid + "：" + r.name);
                usedItems[uid] = true;
              });
            }
          });
        }
      }
    }
  }
  }
  console.log("  跑了 " + scenarios + " 種設定組合");
  const perDietSlot = scenarios / DIETS.length; // 每種 diet 在每個時段跑的設定數
  ["蛋奶素", "全素"].forEach((diet) => {
    ["lunch", "dinner"].forEach((slot) => {
      // 不能整個時段在所有設定下全部拿不到推薦
      check((nullByDiet[diet + ":" + slot] || 0) < perDietSlot, diet + " 使用者的" + slot + "在所有設定下都拿不到推薦");
    });
  });
  // 低碳不是安全規則：開了低碳，午晚餐也要在一般設定下拿得到推薦
  {
    const prefs = {}, perSlot = {};
    SLOTS.forEach((s) => { prefs[s] = "auto"; perSlot[s] = 500; });
    const recs = recommendFor({ perSlotSuggestion: perSlot }, { proteinGapToday: 30, fiberGapThisWeek: 10 }, prefs, "一般", [], {}, true);
    ["lunch", "dinner"].forEach((slot) => check(recs[slot] && !recs[slot].lowBudget, "開了低碳，一般設定的" + slot + "拿不到推薦"));
  }

  // ---------- 4. 已記錄的時段不產生推薦 ----------
  console.log("[跳過時段]");
  const skipRecs = recommendFor(
    { perSlotSuggestion: { breakfast: 0, lunch: 500, afternoon_tea: 150, dinner: 500, snack: 150 } },
    { proteinGapToday: 30, fiberGapThisWeek: 10 }, null, "一般", [], { breakfast: true, dinner: true }
  );
  check(skipRecs.breakfast === null, "已記錄的早餐仍然產生推薦");
  check(skipRecs.dinner === null, "已記錄的晚餐仍然產生推薦");
  check(skipRecs.lunch !== null, "沒被跳過的午餐沒有推薦");

  // ---------- 4b. 「幾天前顯示過」用本地日期算（−1b 修 v1 時區 bug） ----------
  console.log("[近期顯示的天數]");
  const at = (y, m, d, h) => new Date(y, m - 1, d, h, 0).getTime();
  [[3, "凌晨"], [10, "白天"], [23, "深夜"]].forEach(([h, label]) => {
    const now = at(2026, 9, 23, h);
    check(M.recommend.daysSince("2026-09-23", now) === 0, label + " " + h + " 點：今天顯示過應是 0 天前（實際 " + M.recommend.daysSince("2026-09-23", now) + "）");
    check(M.recommend.daysSince("2026-09-22", now) === 1, label + " " + h + " 點：昨天顯示過應是 1 天前（實際 " + M.recommend.daysSince("2026-09-22", now) + "）");
    check(M.recommend.daysSince("2026-09-20", now) === 3, label + " " + h + " 點：3 天前顯示過應是 3（實際 " + M.recommend.daysSince("2026-09-20", now) + "）");
  });
  check(M.recommend.daysSince(null, at(2026, 9, 23, 10)) === Infinity, "沒有顯示紀錄應是 Infinity");

  // ---------- 4c. 自訂食物與組合的過敏原（章程 C4.1、B6.4） ----------
  console.log("[自訂食物與組合的過敏原]");
  const allergic = { allergens: ["蛋"] };
  const customRec = { id: "custom_x", name: "x", kcal: 100, role: "side", channel: "convenience", valid_slots: SLOTS.slice() };
  const custom = (tags) => M.catalog.fromCustomFood(Object.assign({}, customRec, tags === undefined ? {} : { allergen_tags: tags }));
  check(!M.filters.passesHardFilters(custom(["蛋"]), allergic).ok, "自訂食物含使用者的過敏原卻沒被擋（不能有自訂食物例外）");
  check(!M.filters.passesHardFilters(custom(null), allergic).ok, "自訂食物過敏原未確認（null）卻沒被擋");
  check(!M.filters.passesHardFilters(custom(undefined), allergic).ok, "自訂食物沒有 allergen_tags 欄位卻沒被擋");
  check(M.filters.passesHardFilters(custom([]), allergic).ok, "自訂食物確認不含過敏原（[]）卻被擋");
  check(M.filters.passesHardFilters(custom(null), {}).ok, "沒設過敏原的使用者，未確認的自訂食物不該被擋");
  check(M.filters.unionTags(["蛋"], undefined).indexOf("未確認") !== -1, "組合裡有成分缺 allergen_tags，整組要是未確認");
  check(M.filters.unionTags(["蛋"], null).indexOf("未確認") !== -1, "組合裡有成分 allergen_tags 是 null，整組要是未確認");
  check(M.filters.unionTags(["蛋"], []).join() === "蛋", "成分都有 allergen_tags 時是聯集");

  // ---------- 4d. 不吃清單以 id 為 key（章程 C2）：食材改名後仍然命中 ----------
  console.log("[不吃清單用 id]");
  {
    const renamed = readJson("ingredients.json").map((it) => it.axis === "protein" ? Object.assign({}, it, { name: it.name + "（改名）" }) : it);
    const renamedCatalog = M.catalog.buildCatalog({
      ingredients: renamed, convenienceItems: convenienceData, taiwanItems: taiwanData,
      archetypes: readJson("dish_archetypes.json"),
    });
    const renamedPool = M.pool.buildCandidatePool(renamedCatalog);
    const target = renamed.find((it) => renamedPool.some((c) => c.is_composed && c.protein_id === it.id));
    const disliked = [{ type: "protein", key: target.id, label: "改名前的名稱" }];
    const hits = renamedPool.filter((c) => c.is_composed && c.protein_id === target.id);
    check(hits.length > 0, "測試前提：候選池裡要有用到 " + target.id + " 的組合");
    check(hits.every((c) => !M.filters.passesHardFilters(c, { disliked_ingredients: disliked }).ok),
      "不吃清單用 id「" + target.id + "」，食材改名後沒有命中");
    // 換軸（例：毛豆仁從主食移到蛋白質，decisions #37）後，舊的 {type: 別的軸, key} 仍然命中：只比 key（decisions #40）
    const otherAxis = [{ type: "staple", key: target.id, label: "換軸前存的" }];
    check(hits.every((c) => !M.filters.passesHardFilters(c, { disliked_ingredients: otherAxis }).ok),
      "不吃清單存的軸跟目前不同（換軸），仍然要命中 " + target.id);
    const others = renamedPool.filter((c) => c.is_composed && c.protein_id !== target.id).slice(0, 50);
    check(others.every((c) => M.filters.passesHardFilters(c, { disliked_ingredients: disliked }).ok), "不吃清單誤擋了其他蛋白質的組合");
  }
  // decisions #101：雜糧飯（樣品五穀米含麥片）對麩質過敏、全素、蛋奶素都要擋
  {
    const grain = catalog.ingredients.find((it) => it.id === "mixed_grain_rice_cooked");
    check(grain && grain.allergen_tags.indexOf("麩質") !== -1 && grain.diet_tags.length === 0, "雜糧飯要標麩質、不能宣告素食（decisions #101）");
    const withGrain = M.pool.buildCandidatePool(catalog).filter((c) => c.is_composed && c.staple_id === "mixed_grain_rice_cooked");
    check(withGrain.length > 0, "測試前提：候選池裡要有用到雜糧飯的組合");
    [{ allergens: ["麩質"] }, { diet_restriction: "全素" }, { diet_restriction: "蛋奶素" }].forEach((p) => {
      check(withGrain.every((c) => !M.filters.passesHardFilters(c, p).ok), "雜糧飯的組合沒被擋：" + JSON.stringify(p));
    });
  }

  // ---------- 4e. null 傳染（章程 C4.5）：缺資料不當 0 ----------
  console.log("[null 傳染]");
  {
    const mc = M.mc;
    const ing = (o) => Object.assign({ id: "x", name: "x", serving_g: 100, kcal_100g: 100, protein_100g: 10, carb_100g: 10, fat_100g: 1, fiber_100g: 1 }, o);
    check(mc.ingredientContribution(ing({ protein_100g: null })).protein_g === null, "食材蛋白質未知，一份的蛋白質要是 null");
    check(mc.ingredientContribution(ing({})).protein_g === 10, "食材蛋白質已知時照常計算");
    const t = mc.composeTotals({ proteins: [ing({ fiber_100g: null })], staple: ing({ id: "s" }), primaryScale: 1 }, null);
    check(t.fiber_g === null, "自己煮：任一食材纖維未知，合計纖維要是 null（實際 " + t.fiber_g + "）");
    check(t.protein_g === 20, "自己煮：已知欄位照常加總（實際 " + t.protein_g + "）");

    const conv = convenienceData.map((it) => it.id === "conv_bx04" ? Object.assign({}, it, { protein_g: null, fiber_g: null }) : it);
    const nullCatalog = M.catalog.buildCatalog({
      ingredients: readJson("ingredients.json"), convenienceItems: conv, taiwanItems: taiwanData,
      archetypes: readJson("dish_archetypes.json"),
    });
    const withIt = M.pool.buildCandidatePool(nullCatalog).filter((c) => c.components.indexOf("conv_bx04") !== -1);
    check(withIt.length > 0, "測試前提：候選池要有含 conv_bx04 的組合");
    check(withIt.every((c) => c.protein_g === null && c.fiber_g === null), "現成品項蛋白質/纖維未知，含它的推薦組合要是 null，不能當 0");

    const combo = { is_composed: true, kcal: 500, protein_g: null, carb_g: 50, fat_g: 10, fiber_g: 5,
      primary_kcal: 200, primary_protein_g: 5, primary_carb_g: 40, primary_fat_g: 1, primary_fiber_g: 2 };
    const eff = mc.achievableNutrition(combo, 600);
    check(eff.protein_g === null, "縮放時蛋白質未知要維持 null（實際 " + eff.protein_g + "）");
    check(eff.carb_g === 50 - 40 + 40 * eff.scale, "縮放時已知欄位照常計算");

    const L = (date, slot, p, fb) => ({ log_date: date, slot: slot, totals: { kcal: 500, protein_g: p, carb_g: 50, fat_g: 10, fiber_g: fb } });
    check(mc.sumLogTotals([L("2026-09-22", "lunch", 20, 5), L("2026-09-22", "dinner", null, 5)], "protein_g") === null, "紀錄合計：任一筆蛋白質未知，合計要是 null");
    check(mc.sumLogTotals([L("2026-09-22", "lunch", 20, 5), L("2026-09-22", "dinner", 30, 5)], "protein_g") === 50, "紀錄合計：都已知時照常加總");
    const week = M.budget.summarizeWeek([
      L("2026-09-21", "breakfast", 20, 5), L("2026-09-21", "lunch", 20, null), L("2026-09-21", "dinner", 20, 5),
      L("2026-09-22", "breakfast", 30, 6), L("2026-09-22", "lunch", 30, 6), L("2026-09-22", "dinner", 30, 6),
    ], null, "2026-09-23");
    check(week.byDate["2026-09-21"].fiber === null, "本週總覽：某天有一餐纖維未知，那天的纖維要是 null（實際 " + week.byDate["2026-09-21"].fiber + "）");
    check(week.avgFiber === 18 && week.fiberDays === 1, "本週總覽：纖維平均只算纖維已知的完整記錄日（實際 " + week.avgFiber + "，" + week.fiberDays + " 天）");
    check(week.avgProtein === 75 && week.proteinDays === 2, "本週總覽：蛋白質平均照常（實際 " + week.avgProtein + "）");
    // 缺口：未知的量不能算成「已經吃到」，只加已知部分（缺口偏大、往安全方向）
    const gap = M.matcher.checkHardConstraints([L("2026-09-23", "breakfast", 20, 5), L("2026-09-23", "lunch", null, 5)],
      { weight_kg: 80, goal_mode: "減脂", enabled_slots: null }, "2026-09-23");
    check(gap.proteinGapToday === 80 * 1.8 - 20, "蛋白質缺口：未知的一餐不算已吃到（實際 " + gap.proteinGapToday + "）");
    // 例外：鈉與飽和脂肪只用於顯示，有資料的部分照加、另外記 partial（章程 C4.5）
    const N = (na, partial) => ({ totals: { kcal: 1, sodium_mg: na, sat_fat_g: null, partial: partial || [] } });
    const na1 = mc.sumDisplayLogTotals([N(300), N(null)], "sodium_mg");
    check(na1.value === 300 && na1.partial === true, "鈉：一筆 300、一筆沒資料 → 約 300 且註明部分無資料（實際 " + JSON.stringify(na1) + "）");
    const na2 = mc.sumDisplayLogTotals([N(300), N(200, ["sodium_mg"])], "sodium_mg");
    check(na2.value === 500 && na2.partial === true, "鈉：紀錄本身是部分無資料，合計也要註明（實際 " + JSON.stringify(na2) + "）");
    check(mc.sumDisplayLogTotals([N(null), N(null)], "sodium_mg").value === null, "鈉：全部沒資料是 null");
    check(mc.sumDisplayLogTotals([N(300), N(200)], "sodium_mg").partial === false, "鈉：全部有資料不註明");
    const ct = mc.composeTotals({ proteins: [ing({ sodium_100g: 50 })], staple: ing({ id: "s", sodium_100g: null }), primaryScale: 1 }, null);
    check(ct.sodium_mg === 50 && ct.partial.indexOf("sodium_mg") !== -1 && ct.protein_g === 20, "自己煮：一個食材沒鈉資料，鈉照加有資料的部分並註明（實際 " + JSON.stringify(ct) + "）");
  }

  // ---------- 4f. 手動記錄規則（章程 C4.8）：只限制每個角色的數量，不要求主餐 ----------
  console.log("[手動記錄規則]");
  {
    const mc = M.mc;
    const it = (role, uid) => ({ uid: uid || role, role: role });
    check(mc.manualSelectionProblem([it("drink")]) === null, "早餐只記一杯拿鐵（只有飲料、沒有主餐）要可以送出");
    check(mc.manualSelectionProblem([it("snack")]) === null, "只記一份點心要可以送出");
    check(mc.manualSelectionProblem([it("main"), it("side"), it("drink"), it("snack")]) === null, "四種角色各一件要可以送出（手動不限 3 件）");
    check(mc.manualSelectionProblem([]) !== null, "什麼都沒選不能送出");
    check(mc.manualSelectionProblem([it("main", "a"), it("main", "b")], "afternoon_tea") !== null, "下午茶兩個主餐超過角色上限要擋（早午晚的上限 2 見 4j）");
    check(mc.canAddManualItem([it("drink", "a")], it("drink", "b")) === false, "已經選了飲料，再加一杯要擋");
    check(mc.canAddManualItem([it("drink", "a")], it("main", "b")) === true, "已經選了飲料，加主餐要可以");
  }

  // ---------- 4g. 同一天重建不換掉剛看到的建議（decisions #39） ----------
  console.log("[同一天重建]");
  {
    const TODAY = "2026-09-23";
    const nowMs = new Date(2026, 8, 23, 10, 0).getTime();
    const yesterday = "2026-09-22";
    // 近期降權以「今天開始時」計算：今天那一次不算
    check(M.recommend.feedbackScore({ shown_count: 2, last_shown_date: yesterday }, nowMs) === -50, "昨天顯示過（共 2 天）要扣 40＋5×2＝50（實際 " + M.recommend.feedbackScore({ shown_count: 2, last_shown_date: yesterday }, nowMs) + "）");
    check(M.recommend.feedbackScore({ shown_count: 2, last_shown_date: TODAY }, nowMs) === -5, "今天也顯示過（共 2 天）只扣今天以前那 1 天的 5 分（實際 " + M.recommend.feedbackScore({ shown_count: 2, last_shown_date: TODAY }, nowMs) + "）");
    check(M.recommend.feedbackScore({ shown_count: 1, last_shown_date: "2026-09-25" }, nowMs) === 0, "顯示日期在未來（時鐘被調回去）當成今天（實際 " + M.recommend.feedbackScore({ shown_count: 1, last_shown_date: "2026-09-25" }, nowMs) + "）");
    check(M.recommend.feedbackScore({ rating: "like", shown_count: 0 }, nowMs) === 40, "喜歡加 40");

    const profiles = [
      { age: 35, gender: "男", height_cm: 175, weight_kg: 80, activity_mode: "輕度", goal_mode: "減脂", meal_prefs: null, enabled_slots: null, diet_restriction: "一般", allergens: [], disliked_ingredients: [] },
      { age: 30, gender: "女", height_cm: 160, weight_kg: 60, activity_mode: "久坐", goal_mode: "維持", meal_prefs: { breakfast: "auto", lunch: "auto", afternoon_tea: "auto", dinner: "auto", snack: "auto" }, enabled_slots: null, diet_restriction: "一般", allergens: [], disliked_ingredients: [] },
      { age: 35, gender: "男", height_cm: 175, weight_kg: 80, activity_mode: "輕度", goal_mode: "減脂", meal_prefs: { breakfast: "cook_quick", lunch: "cook_quick", afternoon_tea: "auto", dinner: "cook_full", snack: "auto" }, enabled_slots: null, diet_restriction: "全素", allergens: [], disliked_ingredients: [] },
    ];
    const markShown = (fbMap, recs) => Object.keys(recs).forEach((slot) => {
      const r = recs[slot];
      if (!r || r.lowBudget) return;
      const ex = fbMap[r.id] || {};
      if (ex.last_shown_date === TODAY) return;
      fbMap[r.id] = Object.assign({}, ex, { shown_count: (ex.shown_count || 0) + 1, last_shown_date: TODAY });
    });
    const ids = (recs) => SLOTS.map((s) => (recs[s] && !recs[s].lowBudget ? recs[s].id : "-")).join(" | ");
    profiles.forEach((profile, pi) => {
      const targets = M.nutrition.calculateTargets(profile);
      const fb = {};
      const plan = (todayLogs) => M.today.planToday({ profile, targets, todayLogs, weekLogs: todayLogs, feedbackMap: JSON.parse(JSON.stringify(fb)), pool: candidatePool, today: TODAY, nowMs });
      const first = plan([]).recs;
      markShown(fb, first);
      const again = plan([]).recs;
      check(ids(first) === ids(again), "profile " + pi + "：同一天再開一次今日建議，推薦整批換掉了（第一次 " + ids(first) + "；再一次 " + ids(again) + "）");
      // 照推薦記錄早餐：午晚餐的額度不變，推薦也不該變
      const b = first.breakfast;
      if (b && !b.lowBudget) {
        const log = { log_date: TODAY, slot: "breakfast", meal_type: "delivery", source: "rec_accepted", name: b.name,
          content: M.mc.contentFromRec(b, catalog.productsByUid),
          totals: { kcal: b.scaled_kcal, protein_g: b.protein_g, carb_g: b.carb_g, fat_g: b.fat_g, fiber_g: b.fiber_g } };
        const after = plan([log]).recs;
        ["lunch", "dinner"].forEach((slot) => {
          const x = first[slot], y = after[slot];
          check((x && x.id) === (y && y.id), "profile " + pi + "：記錄推薦的早餐之後，" + slot + " 換掉了（" + (x && x.id) + " → " + (y && y.id) + "）");
        });
      }
    });
  }

  // ---------- 4h. 自煮的隱含成分：用油與調味（章程 B5.6–B5.7、C4.11） ----------
  console.log("[用油與調味]");
  {
    const mc = M.mc;
    const byId = (id) => catalog.ingredients.find((x) => x.id === id);
    const arch = (id) => catalog.archetypes.find((a) => a.id === id);
    const stir = byId("method_stir_fry"), pan = byId("method_pan_fry"), air = byId("method_air_fry"), nocook = byId("method_no_cook");
    const imp = (m, a, veg, sauce, habit) => mc.defaultImplicit(m, arch(a), veg, sauce, habit);
    check(imp(stir, "protein_stir_fry", true, false, "normal").oil_g === 10, "炒＋有蔬菜：用油 5＋5＝10g");
    check(imp(stir, "protein_stir_fry", false, false, "normal").oil_g === 5, "炒、沒有蔬菜：用油 5g");
    check(imp(stir, "protein_stir_fry", true, false, "less").oil_g === 5, "少油習慣：炒＋蔬菜減半成 5g");
    check(imp(pan, "egg_pan", true, false, "normal").oil_g === 5, "煎：用油 5g（有蔬菜也不加）");
    check(imp(air, "grain_bowl_baked", true, false, "normal").oil_g === 0, "氣炸：用油 0");
    check(imp(nocook, "bowl_oat", false, false, "normal").oil_g === 0, "免開火：用油 0");
    check(imp(stir, "protein_stir_fry", true, false, "normal").seasoning === "normal", "有調味的骨架、沒選醬料：預設一般");
    check(imp(stir, "protein_stir_fry", true, true, "normal").seasoning === "light", "有調味的骨架、選了醬料：預設清淡（decisions #28）");
    check(imp(nocook, "bowl_oat", false, false, "normal").seasoning === null, "燕麥碗不加調味");
    const ic = mc.implicitContribution({ oil_g: 10, seasoning: "normal" }, catalog.implicit);
    check(Math.abs(ic.kcal - 88.4) < 0.05 && ic.fat_g === 10 && ic.sodium_mg === 700, "10g 油＋一般調味 ＝ 88.4 kcal、脂肪 10g、鈉 700 mg（實際 " + JSON.stringify(ic) + "）");

    // 候選池：每個自組食譜都帶隱含成分，熱量含用油（C4.11）
    const composed = candidatePool.filter((c) => c.is_composed);
    check(composed.every((c) => c.implicit && typeof c.implicit.oil_g === "number" && "seasoning" in c.implicit), "有自組食譜沒有 implicit");
    const stirCombo = composed.find((c) => c.method_id === "method_stir_fry" && c.vegetable_id);
    check(stirCombo && stirCombo.implicit.oil_g === 10, "炒＋蔬菜的候選用油要是 10g");
    // 用油不跟主要槽位縮放
    const e1 = mc.achievableNutrition(stirCombo, 400), e2 = mc.achievableNutrition(stirCombo, 800);
    const fixed = (e) => e.kcal - stirCombo.primary_kcal * e.scale;
    check(Math.abs(fixed(e1) - fixed(e2)) < 0.2, "用油不能跟主要槽位一起縮放（固定部分 " + fixed(e1) + " vs " + fixed(e2) + "）");
    // 少油習慣：推薦出來的份量用油減半
    const lessPool = mc.withOilHabit(stirCombo, "less");
    check(lessPool.implicit.oil_g === 5 && Math.abs((stirCombo.kcal - lessPool.kcal) - 44.2) < 0.1, "少油習慣：用油 10→5g、熱量少 44.2 kcal（實際 " + lessPool.implicit.oil_g + "g、差 " + (stirCombo.kcal - lessPool.kcal) + "）");
    // 推薦記錄下來的 MealContent 帶實際採用的用油與調味
    const rc = mc.contentFromRec(Object.assign({}, lessPool, { primary_scale: 1, source_pref: "cook_full" }), catalog.productsByUid);
    check(rc.implicit && rc.implicit.oil_g === 5 && rc.implicit.seasoning === lessPool.implicit.seasoning, "推薦記錄的 implicit 要是實際採用的克數與程度");

    // 溫沙拉未含沙拉醬：候選池與推薦結果都帶骨架的 not_included，畫面照它註明（decisions #38、章程 B7.5）
    const salads = composed.filter((c) => c.archetype_id === "warm_salad");
    check(salads.length > 0 && salads.every((c) => (c.not_included || []).join() === "沙拉醬"), "溫沙拉的候選要帶 not_included: [沙拉醬]");
    check(composed.filter((c) => c.archetype_id !== "warm_salad").every((c) => c.not_included === null), "其他骨架不該有 not_included");
    const perSlot = {}, prefs = {};
    SLOTS.forEach((s) => { perSlot[s] = 500; prefs[s] = "auto"; });
    const saladRecs = M.recommend.getTodayRecommendation({
      pool: salads, feedbackMap: {}, remainingBudget: { perSlotSuggestion: perSlot }, hardConstraints: { proteinGapToday: 30, fiberGapThisWeek: 10 },
      mealPrefs: prefs, dietRestriction: "一般", allergens: [], skipSlots: {}, lowCarb: false, nowMs: Date.now(),
    });
    check(saladRecs.lunch && (saladRecs.lunch.not_included || []).join() === "沙拉醬", "推薦結果要保留溫沙拉的 not_included（卡片靠它顯示「未含沙拉醬」）");
  }

  // ---------- 4i. 我的品項照 PRD 10.1 讀進來、選擇器的品項帶齊 catalog 的營養欄位（章程 C2；Phase 0 計畫 N1） ----------
  console.log("[我的品項與選擇器的營養欄位]");
  {
    const rec = (o) => Object.assign({ id: "custom_y", name: "y", kcal: 100, protein_g: 1, carb_g: 1, fat_g: 1, fiber_g: 0, sat_fat_g: 0.4, sodium_mg: 250,
      role: "main", channel: "delivery", valid_slots: ["lunch", "dinner"], allergen_tags: [], vegan: false, lacto_ovo: false, archived: false }, o);
    let valid = true;
    try { M.db.validateCustomFood(rec({})); } catch (e) { valid = false; }
    check(valid, "測試前提：PRD 10.1 格式的我的品項要通過寫入驗證");
    const cf = M.catalog.fromCustomFood(rec({}));
    check(cf.role === "main" && cf.channel === "delivery" && cf.valid_slots.join() === "lunch,dinner", "我的品項要讀記錄的角色、分頁、時段（實際 " + cf.role + "、" + cf.channel + "、" + cf.valid_slots + "）");
    check(cf.sat_fat_g === 0.4 && cf.sodium_mg === 250, "我的品項要帶飽和脂肪與鈉（實際 " + cf.sat_fat_g + "、" + cf.sodium_mg + "）");
    check(M.filters.passesHardFilters(M.catalog.fromCustomFood(rec({ vegan: true })), { diet_restriction: "全素" }).ok, "宣告全素的我的品項，全素使用者可以選");
    check(M.filters.passesHardFilters(M.catalog.fromCustomFood(rec({ lacto_ovo: true })), { diet_restriction: "蛋奶素" }).ok, "宣告蛋奶素的我的品項，蛋奶素使用者可以選");
    check(!M.filters.passesHardFilters(M.catalog.fromCustomFood(rec({ vegan: "false" })), { diet_restriction: "全素" }).ok, "vegan 是字串 \"false\" 不能當成全素");
    check(M.catalog.fromCustomFood(rec({ archived: true })).archived === true && M.catalog.fromCustomFood(rec({ archived: "yes" })).archived === false, "archived 只認 true");
    check(!M.filters.passesHardFilters(cf, { diet_restriction: "全素" }).ok, "沒宣告的我的品項，全素使用者不能選");
    const t = M.picker.partitionByMealType(catalog.products, [cf], "lunch");
    check(t.delivery.indexOf(cf) !== -1 && t.convenience.indexOf(cf) === -1, "我的品項依 channel 進外食分頁");
    check(M.picker.partitionByMealType(catalog.products, [cf], "breakfast").delivery.indexOf(cf) === -1, "我的品項照自己的時段");
    // 選擇器的品項就是 catalog 的品項本身（章程 C2：不逐欄抄）
    SLOTS.forEach((slot) => {
      const p = M.picker.partitionByMealType(catalog.products, [], slot);
      check(p.convenience.concat(p.delivery, p.drinks).every((it) => catalog.productsByUid[it.uid] === it), slot + "：選擇器的品項要是 catalog 的同一個物件");
    });
    const latte = catalog.productsByUid["tw_dr05"];
    check(M.mc.sumProducts([latte]).sodium_mg === 113.1, "自己選拿鐵（tw_dr05），合計鈉要是 113.1（實際 " + M.mc.sumProducts([latte]).sodium_mg + "）");
    check(M.mc.slotGaps({ kcalShare: 600, proteinShare: 30, fiberShare: 8 }, { kcal: 800, protein_g: null, fiber_g: 3 }).proteinGap === null, "蛋白質合計未知時缺口是 null，不當 0");
  }

  // ---------- 4j. Phase 0 選擇器的 engine（Phase 0 計畫第 4 節斷言 1–13） ----------
  console.log("[Phase 0 選擇器]");
  {
    const mc = M.mc;
    const pk = M.picker;
    const ing = (id) => catalog.ingredients.find((x) => x.id === id);
    const arch = (id) => catalog.archetypes.find((a) => a.id === id);

    // 1. 預設分頁：計畫 → 偏好 → 上次 → 超商；auto、off、undefined、不合法值都往下找
    const R = (planned, pref, lastPicked) => pk.resolveDefaultMealType({ planned, pref, lastPicked });
    check(R(null, "cook_full", "delivery") === "cook_full", "預設分頁：有效偏好優先於上次");
    check(R("delivery", "cook_full", "convenience") === "delivery", "預設分頁：計畫優先於偏好");
    check(R(null, "auto", "delivery") === "delivery", "預設分頁：偏好 auto 時用上次");
    check(R(null, "off", "cook_quick") === "cook_quick", "預設分頁：偏好不合法時用上次");
    check(R(null, undefined, "bogus") === "convenience", "預設分頁：上次不合法時退回超商");
    check(R(null, "auto", undefined) === "convenience", "預設分頁：都沒有時退回超商");
    check(R() === "convenience", "預設分頁：沒傳參數退回超商");
    check(pk.tabOfMealType("cook_quick") === "cook" && pk.tabOfMealType("cook_full") === "cook" && pk.tabOfMealType("delivery") === "delivery", "快煮、開伙都在自煮分頁");

    // 2. 分頁與分組
    const own = (o) => Object.assign({ uid: o.id, is_custom: true, archived: false, valid_slots: SLOTS.slice(), allergen_tags: [], diet_tags: [], category: null }, o);
    const customs = [
      own({ id: "c_conv_main", role: "main", channel: "convenience" }),
      own({ id: "c_del_side", role: "side", channel: "delivery" }),
      own({ id: "c_drink", role: "drink", channel: "delivery" }),
      own({ id: "c_gone", role: "main", channel: "convenience", archived: true }),
      own({ id: "c_dinner_only", role: "main", channel: "convenience", valid_slots: ["dinner"] }),
    ];
    SLOTS.forEach((slot) => {
      const t = pk.partitionByMealType(catalog.products, customs, slot);
      check(t.convenience.concat(t.delivery).every((it) => it.role !== "drink"), slot + "：分頁內不能有飲料");
      check(t.drinks.every((it) => it.role === "drink"), slot + "：飲料步驟只有飲料");
      check(t.drinks.length === catalog.products.filter((p) => p.role === "drink").length + 1, slot + "：飲料不看時段、我的品項的飲料也在（不分 channel）");
      check(t.convenience.concat(t.delivery).concat(t.drinks).every((it) => it.uid !== "c_gone"), slot + "：封存的我的品項不列出");
      check(t.convenience.some((it) => it.uid === "c_conv_main") && t.delivery.some((it) => it.uid === "c_del_side"), slot + "：我的品項依 channel 進分頁");
      check(t.convenience.some((it) => it.uid === "c_dinner_only") === (slot === "dinner"), slot + "：我的品項照 valid_slots");
      check(t.convenience.concat(t.delivery).every((it) => it.is_custom || it.valid_slots.indexOf(slot) !== -1), slot + "：內建品項照 valid_slots");
      check(t.convenience.every((it) => it.is_custom || (!it.is_taiwan && it.channel === "convenience")), slot + "：超商分頁只有超商品項");
      const del = t.delivery.filter((it) => !it.is_custom);
      const firstNonTw = del.findIndex((it) => !it.is_taiwan);
      check(firstNonTw === -1 || del.slice(firstNonTw).every((it) => !it.is_taiwan), slot + "：外食分頁台式在前、宅配/連鎖餐盒在後");
      ["convenience", "delivery"].forEach((tab) => {
        const items = t[tab];
        const blockedUids = {};
        items.filter((it, i) => i % 3 === 0).forEach((it) => { blockedUids[it.uid] = true; });
        const groups = pk.groupForTab(items, (it) => (blockedUids[it.uid] ? "測試用原因" : null));
        const flat = [].concat(...groups.map((g) => g.entries.map((e) => e.item)));
        check(flat.length === items.length, slot + "/" + tab + "：分組後品項數不變");
        const roleRank = { main: 0, side: 1, snack: 2 };
        const builtinGroups = groups.filter((g) => !g.is_custom);
        check(builtinGroups.every((g, i) => i === 0 || roleRank[builtinGroups[i - 1].role] <= roleRank[g.role]), slot + "/" + tab + "：角色分區順序 主餐 → 配菜 → 點心");
        const customIdx = groups.findIndex((g) => g.is_custom);
        check(customIdx === -1 || customIdx === groups.length - 1, slot + "/" + tab + "：我的品項整組在最後");
        groups.forEach((g) => {
          const firstBlocked = g.entries.findIndex((e) => e.reason);
          check(firstBlocked === -1 || g.entries.slice(firstBlocked).every((e) => e.reason), slot + "/" + tab + "：被擋的排組內最後");
          check(g.blocked === g.entries.filter((e) => e.reason).length, slot + "/" + tab + "：被擋數量");
          // 組內可選的、被擋的各自照資料原順序（不是依熱量）
          [g.entries.filter((e) => !e.reason), g.entries.filter((e) => e.reason)].forEach((part) => {
            const pos = part.map((e) => items.indexOf(e.item));
            check(pos.every((p, i) => i === 0 || pos[i - 1] < p), slot + "/" + tab + "：組內照資料原順序");
          });
        });
      });
    });
    const lunch = pk.partitionByMealType(catalog.products, [], "lunch");
    check(lunch.convenience.concat(lunch.delivery).some((it) => /餐盒/.test(it.category || "")), "整份餐盒要列出（不再排除）");
    check(lunch.delivery.some((it) => it.is_taiwan && it.role === "main"), "台式主餐要列出（不再只留飲料）");

    // 3. 快煮一致：推薦 cook_quick 會收 ⇔ 自煮分頁快煮下不灰掉它任何元件與烹調法
    const composed = candidatePool.filter((c) => c.is_composed);
    const draftOf = (c, drink) => ({
      archetype: arch(c.archetype_id), proteins: [ing(c.protein_id)], staple: c.staple_id ? ing(c.staple_id) : null,
      vegetables: c.vegetable_id ? [ing(c.vegetable_id)] : [], seasoning: c.sauce_id ? ing(c.sauce_id) : null,
      method: ing(c.method_id), primaryScale: 1, drink: drink || null,
    });
    let quickMismatch = 0;
    composed.forEach((c) => {
      const d = draftOf(c);
      const axes = [["protein", d.proteins[0]], ["staple", d.staple], ["vegetable", d.vegetables[0]], ["seasoning", d.seasoning]].filter((a) => a[1]);
      const clean = axes.every((a) => mc.composeOptionProblem(a[1], a[0], d, { tier: "cook_quick" }) === null) &&
        mc.composeOptionProblem(d.method, "method", d, { tier: "cook_quick" }) === null;
      if (clean !== M.config.isQuickTier(c.tier_rank)) quickMismatch++;
      // 5（部分）：共用的難度與免開火判斷跟候選池一致
      if (mc.maxTierRank(d.method, mc.draftIngredients(d)) !== c.tier_rank) quickMismatch++;
      if (mc.noCookViolation(d.method, mc.draftIngredients(d))) quickMismatch++;
      if (mc.composeProblem(d, { tier: M.config.isQuickTier(c.tier_rank) ? "cook_quick" : "cook_full" }) !== null) quickMismatch++;
    });
    check(composed.length > 0 && quickMismatch === 0, "候選池的自組組合：快煮灰階、最高難度、免開火、送出規則要跟推薦一致（不一致 " + quickMismatch + " 處）");

    // 4. composeProblem（假骨架：真實資料的免開火骨架只有燕麥碗，它的蛋白質都不需加熱）
    const fake = (o) => Object.assign({ id: "x", name: "x", prep_tier: "🟢", requires_cooking: false, serving_g: 100,
      kcal_100g: 100, protein_100g: 10, carb_100g: 10, fat_100g: 1, fiber_100g: 1, sat_fat_100g: 0, sodium_100g: 0 }, o);
    const p1 = fake({ id: "fp1", name: "免煮蛋白" }), p2 = fake({ id: "fp2", name: "生肉", requires_cooking: true });
    const p3 = fake({ id: "fp3", name: "第三個蛋白" }), hot = fake({ id: "fs1", name: "要煮的醬", requires_cooking: true });
    const red = fake({ id: "fp4", name: "費工蛋白", prep_tier: "🔴" });
    const nocook = ing("method_no_cook");
    const fakeArch = { id: "fake", name: "假骨架", protein: { allow: ["fp1", "fp2", "fp3", "fp4"] }, staple: { allow: [] },
      vegetable: { allow: [] }, seasoning: { allow: ["fs1"] }, methods: ["method_no_cook", "method_pan_fry"], seasoned: false };
    const D = (o) => Object.assign({ archetype: fakeArch, proteins: [p1], staple: null, vegetables: [], seasoning: null, method: nocook, primaryScale: 1 }, o);
    check(mc.composeProblem(D({ archetype: null })) === "請先選餐型", "餐型不完整：沒選餐型");
    check(mc.composeProblem(D({ proteins: [] })) === "請選蛋白質", "餐型不完整：沒蛋白質");
    check(mc.composeProblem({ archetype: arch("grain_bowl_baked"), proteins: [ing(arch("grain_bowl_baked").protein.allow[0])], vegetables: [] }) === "請選主食", "餐型不完整：有主食槽沒主食");
    check(mc.composeProblem(D({ method: null })) === "請選烹調法", "餐型不完整：沒烹調法");
    const NOCOOK_TEXT = "免開火不能搭配需要加熱的食材，請換烹調法或換食材。";
    check(mc.composeProblem(D({ proteins: [p1, p2] })) === NOCOOK_TEXT, "免開火＋第二個蛋白質需加熱要擋");
    check(mc.composeProblem(D({ seasoning: hot })) === NOCOOK_TEXT, "免開火＋需加熱的醬料要擋");
    check(mc.composeProblem(D({ proteins: [fake({ id: "outside", requires_cooking: true })] })) === NOCOOK_TEXT, "同時不在 allow 又違反免開火：先回免開火");
    check(/不在/.test(mc.composeProblem(D({ proteins: [fake({ id: "outside" })] })) || ""), "不在 allow 要擋");
    check(/不在/.test(mc.composeProblem(D({ method: ing("method_stir_fry") })) || ""), "烹調法不在骨架裡要擋");
    check(/最多選 2 個/.test(mc.composeProblem(D({ proteins: [p1, p3, red] })) || ""), "超過 COMPOSE_MAX 要擋");
    check(/快煮/.test(mc.composeProblem(D({ proteins: [red] }), { tier: "cook_quick" }) || ""), "快煮選了 🔴 要擋");
    check(mc.composeProblem(D({ proteins: [red] }), { tier: "cook_full" }) === null, "開伙可以選 🔴");
    check(mc.composeProblem(D({ proteins: [p1, p3], method: ing("method_pan_fry") })) === null, "合法的兩個蛋白質可以送出");

    // 5. composeOptionProblem
    check(mc.composeOptionProblem(p2, "protein", D({}), {}) === "這個食材需要加熱", "免開火下需加熱的食材要灰");
    check(mc.composeOptionProblem(nocook, "method", D({ method: null, proteins: [p2] }), {}) === "已選的食材需要加熱", "已選需加熱的食材時，免開火要灰");
    check(/最多選 2 個/.test(mc.composeOptionProblem(red, "protein", D({ proteins: [p1, p3] }), {}) || ""), "達上限時未選的選項要灰");
    check(mc.composeOptionProblem(p3, "protein", D({ proteins: [p1, p3] }), {}) === null, "已選的選項不因上限被標");
    check(mc.composeOptionProblem(red, "protein", D({ proteins: [] }), { tier: "cook_quick" }) === "快煮不含這個食材", "快煮下 🔴 食材要灰");

    // 6. 多選合計：等於各元件相加；只有主要槽位乘倍數；用油與調味不縮放；有醬料預設清淡；無主食槽選 2 個蛋白質不縮放
    const bowl = arch("grain_bowl_baked");
    const md = (scale, extra) => Object.assign({ kind: "cook", meal_type: "cook_full", archetype: bowl,
      proteins: bowl.protein.allow.slice(0, 2).map(ing), staple: ing(bowl.staple.allow[0]),
      vegetables: bowl.vegetable.allow.slice(0, 3).map(ing), seasoning: null, method: ing("method_pan_fry"), primaryScale: scale }, extra);
    const t1 = mc.contentTotals(mc.buildDraftContent(md(1), { oilHabit: "normal" }), catalog);
    const t2 = mc.contentTotals(mc.buildDraftContent(md(2), { oilHabit: "normal" }), catalog);
    const byHand = mc.addContributions(mc.draftIngredients(md(1)).map((it) => mc.ingredientContribution(it))
      .concat([mc.implicitContribution(mc.composeImplicit(md(1), "normal"), catalog.implicit)]));
    check(Math.abs(t1.kcal - byHand.kcal) < 0.051, "多選合計等於各元件相加（" + t1.kcal + " vs " + byHand.kcal + "）");
    const staple1 = mc.ingredientContribution(md(1).staple);
    check(Math.abs((t2.kcal - t1.kcal) - staple1.kcal) < 0.11, "倍數只乘主要槽位（主食），蛋白質、蔬菜、用油不縮放");
    check(mc.composeImplicit(md(1, { seasoning: ing(bowl.seasoning.allow[0]) }), "normal").seasoning === "light", "有醬料時預設清淡");
    const twoP = D({ proteins: [p1, p3], method: ing("method_pan_fry") });
    check(mc.composePrimary(twoP) === null && mc.composePrimary(D({ method: ing("method_pan_fry") })) === p1, "無主食槽：選 1 個蛋白質才有主要槽位，2 個不縮放");

    // 6b. 用油與調味的選項（章程 B5.6、decisions #42）：只在煎、炒出現、相同克數只列一次、沒有「不用油」；覆寫後合計跟著變；
    //     換成不能選用油的烹調法時覆寫不生效；沒覆寫時醬料讓調味預設清淡
    const egg = arch("egg_pan");
    const ed = (o) => Object.assign({ kind: "cook", meal_type: "cook_quick", archetype: egg, proteins: [ing(egg.protein.allow[0])], staple: null,
      vegetables: [], seasoning: null, method: ing("method_pan_fry"), primaryScale: 1, implicitOverride: {} }, o);
    check(JSON.stringify(mc.oilOptions(ed({}), "normal")) === JSON.stringify([{ oil_g: 5, is_default: true }, { oil_g: 10, is_default: false }]), "煎、一般用油習慣：預設 5g 與 1 茶匙相同只列一次，另有 2 茶匙");
    check(mc.oilOptions(ed({}), "less").map((o) => o.oil_g).join() === "2.5,5,10", "煎、少油：預設 2.5g、1 茶匙、2 茶匙");
    check(mc.oilOptions(ed({ method: ing("method_air_fry") }), "normal").length === 0 && mc.oilOptions(ed({ method: null }), "normal").length === 0, "氣炸、沒選烹調法：沒有用油選項");
    check(mc.oilOptions(ed({}), "normal").every((o) => o.oil_g > 0), "沒有「不用油」選項");
    const tEgg = (o) => mc.contentTotals(mc.buildDraftContent(ed(o), { oilHabit: "normal" }), catalog);
    check(Math.abs(tEgg({ implicitOverride: { oil_g: 10 } }).kcal - tEgg({}).kcal - 44.2) < 0.11, "覆寫用油 5→10g，熱量多約 44.2 kcal");
    check(tEgg({ method: ing("method_air_fry"), implicitOverride: { oil_g: 10 } }).kcal === tEgg({ method: ing("method_air_fry") }).kcal, "換成氣炸後用油覆寫不生效");
    check(mc.composeImplicit(ed({ implicitOverride: { oil_g: 7 } }), "normal").oil_g === 5, "不在選項裡的克數不生效");
    check(Math.round(tEgg({}).sodium_mg - tEgg({ implicitOverride: { seasoning: "light" } }).sodium_mg) === 400, "調味改清淡，鈉少 400 mg");
    check(mc.composeImplicit(ed({ archetype: arch("bowl_oat"), implicitOverride: { seasoning: "normal" } }), "normal").seasoning === null, "不調味的骨架，調味覆寫不生效");

    // 7. meal_type 由呼叫端傳入，不從食材反推
    const green = composed.find((c) => c.tier_rank === 0);
    const gd = draftOf(green);
    check(mc.contentFromCompose(gd, mc.composePrimary(gd), mc.composeImplicit(gd, "normal"), "cook_full").meal_type === "cook_full", "全 🟢 選開伙仍是 cook_full");
    check(mc.deriveCookMealType(0) === "cook_quick" && mc.deriveCookMealType(1) === "cook_quick" && mc.deriveCookMealType(2) === "cook_full", "依難度推導：≤🟡 快煮、🔴 開伙");
    let threw = false;
    try { mc.contentFromCompose(gd, null, { oil_g: 0, seasoning: null }); } catch (e) { threw = true; }
    check(threw, "自煮沒傳 meal_type 要報錯");

    // 8. 估算：營養素未知是 null；跟商品合計時蛋白質 null、鈉照加並標 partial
    const est = mc.estimateComponent("L", "  喜宴 ");
    check(est.snapshot.kcal === 1200 && est.name === "喜宴" && ["protein_g", "carb_g", "fat_g", "fiber_g", "sodium_mg"].every((k) => est.snapshot[k] === null), "估算：熱量 1200、其他營養素 null");
    check(mc.estimateComponent("S", "").name === "外食估算", "估算沒填名稱用「外食估算」");
    const latte = catalog.productsByUid["tw_dr05"];
    const et = mc.contentTotals(mc.buildDraftContent({ kind: "products", meal_type: "delivery", items: [], estimates: [{ size: "M" }], drink: latte }), catalog);
    check(et.kcal === 700 + latte.kcal && et.protein_g === null && et.sodium_mg === latte.sodium_mg && et.partial.indexOf("sodium_mg") !== -1, "估算＋拿鐵：蛋白質 null、鈉照加並標部分無資料（實際 " + JSON.stringify(et) + "）");

    // 9. 快速新增
    const profileEgg = { allergens: ["蛋"] };
    SLOTS.forEach((slot) => {
      ["main", "side", "snack", "drink"].forEach((role) => {
        ["convenience", "delivery"].forEach((channel) => {
          const rec = Object.assign(pk.quickAddDefaults(slot, role, channel), { name: "測試", kcal: 300 });
          let ok = true;
          try { M.db.validateCustomFood(rec); } catch (e) { ok = false; }
          check(ok, "快速新增預設要通過寫入驗證：" + slot + "/" + role + "/" + channel);
          check(rec.valid_slots.indexOf(slot) !== -1, "快速新增的 valid_slots 要含目前時段：" + slot + "/" + role);
        });
      });
      check(pk.quickAddDefaults(slot, null, "convenience").role === (slot === "afternoon_tea" || slot === "snack" ? "snack" : "main"), "快速新增的預設角色：" + slot);
    });
    const unverified = M.catalog.fromCustomFood(Object.assign(pk.quickAddDefaults("lunch", "main", "convenience"), { id: "custom_q", name: "q", kcal: 300 }));
    const qp = pk.quickAddProblem(unverified, profileEgg);
    check(qp.blocked && /未確認/.test(qp.blocked) && !/確認不含/.test(qp.blocked), "有設過敏原時預告過敏原未確認會被擋，不引導改填確認不含（實際 " + qp.blocked + "）");
    check(pk.quickAddProblem(unverified, {}).blocked === null, "沒設過敏原時不預告");
    check(pk.quickAddProblem({ allergen_tags: ["蛋"], diet_tags: ["全素"] }, {}).conflict !== null, "宣告全素又含蛋要提示矛盾");
    check(pk.quickAddProblem({ allergen_tags: ["乳製品"], diet_tags: ["蛋奶素"] }, {}).conflict === null, "蛋奶素含乳製品不矛盾");
    check(pk.quickAddProblem({ allergen_tags: null, diet_tags: ["全素"] }, {}).conflict === null, "全素但過敏原未確認不提示");

    // 10. 手動記錄的角色上限依時段（decisions #41）
    const R2 = (role, uid) => ({ uid: uid, role: role });
    const mains = (n) => Array.from({ length: n }, (_, i) => R2("main", "m" + i));
    ["breakfast", "lunch", "dinner"].forEach((slot) => {
      check(mc.manualSelectionProblem(mains(2), slot) === null, slot + "：兩個主餐可以");
      check(/最多選 2 個/.test(mc.manualSelectionProblem(mains(3), slot) || ""), slot + "：三個主餐要擋，訊息寫出上限 2");
      check(mc.canAddManualItem(mains(1), R2("main", "x"), slot) === true && mc.canAddManualItem(mains(2), R2("main", "x"), slot) === false, slot + "：第二個主餐可加、第三個不行");
    });
    ["afternoon_tea", "snack"].forEach((slot) => {
      check(/最多選 1 個/.test(mc.manualSelectionProblem(mains(2), slot) || ""), slot + "：兩個主餐要擋，訊息寫出上限 1");
    });
    check(mc.manualSelectionProblem([], "lunch", { estimates: 1 }) === null, "只有估算可以送出");
    check(mc.manualSelectionProblem([R2("drink", "d")], "breakfast") === null, "只有飲料可以送出");
    check(/最多選 1 個/.test(mc.manualSelectionProblem([R2("drink", "a"), R2("drink", "b")], "lunch") || ""), "兩杯飲料要擋");
    const chicken = catalog.productsByUid["conv_bx04"], potato = catalog.productsByUid["conv_bx05"];
    check(chicken.role === "main" && potato.role === "main" && potato.valid_slots.indexOf("breakfast") !== -1 &&
      mc.manualSelectionProblem([chicken, potato], "breakfast") === null, "早餐「雞胸＋蒸地瓜」要能記成一餐");

    // 11–12. engine 產生的每種 content 都通過寫入驗證；存下的 totals 就是 contentTotals
    const stir = arch("protein_stir_fry");
    const bigCook = { kind: "cook", meal_type: "cook_full", archetype: stir, proteins: stir.protein.allow.slice(0, 2).map(ing),
      staple: ing(stir.staple.allow[0]), vegetables: stir.vegetable.allow.slice(0, 3).map(ing), seasoning: null,
      method: ing("method_stir_fry"), primaryScale: 1.3, drink: latte };
    check(mc.composeProblem(bigCook, { tier: "cook_full" }) === null, "測試前提：快炒 2 蛋白質＋3 蔬菜合法");
    const drafts = {
      "自煮 2 蛋白質＋3 蔬菜＋飲料": bigCook,
      "只有估算": { kind: "products", meal_type: "delivery", items: [], estimates: [{ size: "L", name: "喜宴" }] },
      "估算＋商品＋飲料": { kind: "products", meal_type: "delivery", items: [catalog.productsByUid["tw_bf03"] || lunch.delivery[0]], estimates: [{ size: "S" }], drink: latte },
      "只有飲料": { kind: "products", meal_type: "convenience", items: [], drink: latte },
    };
    Object.keys(drafts).forEach((k) => {
      const content = mc.buildDraftContent(drafts[k], { oilHabit: "less" });
      const totals = mc.contentTotals(content, catalog);
      const entry = mc.buildLogEntry({ date: "2026-09-29", slot: "lunch", source: "manual", name: k, content: content, totals: totals, createdAt: "2026-09-29T04:00:00.000Z" });
      let err = null;
      try { M.db.validateDailyLog(entry); } catch (e) { err = e.message; }
      check(err === null, k + "：要通過 daily_log 寫入驗證（" + err + "）");
      check(JSON.stringify(mc.contentTotals(entry.content, catalog)) === JSON.stringify(totals), k + "：存下的內容重算合計要等於摘要看到的");
    });
    check(mc.contentTotals(mc.buildDraftContent(bigCook, { oilHabit: "less" }), catalog).partial.indexOf("sodium_mg") === -1 ||
      latte.sodium_mg == null, "有鈉資料的自煮＋飲料不該標部分無資料");

    // 13. 等價：新的草稿路徑逐欄等於舊的合計（含兩位小數的飲料 conv_dr05），並跟凍結的參考值比
    const drinks = [null].concat(catalog.products.filter((p) => p.role === "drink"));
    check(drinks.some((d) => d && d.uid === "conv_dr05"), "測試前提：飲料要含 conv_dr05（纖維 3.25）");
    const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
    const lines = {};
    let oldMismatch = 0, soloPartial = 0;
    drinks.forEach((drink) => {
      const key = drink ? drink.uid : "none";
      const cookLines = [], itemLines = [];
      composed.forEach((c) => {
        [1, 1.7].forEach((scale) => {
          const d = Object.assign(draftOf(c, drink), { kind: "cook", meal_type: M.config.isQuickTier(c.tier_rank) ? "cook_quick" : "cook_full", primaryScale: scale });
          const nt = mc.contentTotals(mc.buildDraftContent(d, { oilHabit: "normal" }), catalog);
          if (!drink && nt.partial.length > 0 && mc.composeTotals(d, mc.composePrimary(d), mc.composeImplicit(d, "normal"), catalog.implicit).partial.length === 0) soloPartial++;
          // 沒有飲料時自煮合計仍等於 composeTotals（飲料從 commit 3 起不在 composeTotals 裡，有飲料的組合靠下面的凍結值）
          if (!drink && !same(nt, mc.composeTotals(d, mc.composePrimary(d), mc.composeImplicit(d, "normal"), catalog.implicit))) oldMismatch++;
          cookLines.push(c.id + "@" + scale + "=" + JSON.stringify(nt));
        });
      });
      catalog.products.filter((p) => p.role !== "drink").forEach((p) => {
        const nt = mc.contentTotals(mc.buildDraftContent({ kind: "products", meal_type: "delivery", items: [p], drink: drink }), catalog);
        if (!same(nt, mc.sumProducts(drink ? [p, drink] : [p]))) oldMismatch++;
        itemLines.push(p.uid + "=" + JSON.stringify(nt));
      });
      lines["cook:" + key] = cookLines;
      lines["items:" + key] = itemLines;
    });
    check(oldMismatch === 0, "草稿路徑的合計要逐欄等於 composeTotals（無飲料）／sumProducts（不一致 " + oldMismatch + " 組）");
    check(soloPartial === 0, "只有自煮、沒有飲料的一餐不能被標部分無資料（" + soloPartial + " 組）");
    const hashes = {};
    Object.keys(lines).forEach((k) => { hashes[k] = require("crypto").createHash("sha256").update(lines[k].join("\n")).digest("hex").slice(0, 16); });
    const refPath = path.join(ROOT, "tools", "fixtures", "draft-totals.json");
    if (process.argv.indexOf("--freeze-draft-totals") !== -1) {
      fs.mkdirSync(path.dirname(refPath), { recursive: true });
      fs.writeFileSync(refPath, JSON.stringify(hashes, null, 2) + "\n");
      console.log("  已凍結草稿合計參考值：" + path.relative(ROOT, refPath));
    }
    const ref = fs.existsSync(refPath) ? JSON.parse(fs.readFileSync(refPath, "utf8")) : null;
    check(ref !== null, "缺凍結的草稿合計參考值（tools/fixtures/draft-totals.json）");
    if (ref) {
      const diff = Object.keys(Object.assign({}, ref, hashes)).filter((k) => ref[k] !== hashes[k]);
      check(diff.length === 0, "草稿合計跟凍結的參考值不同（" + diff.join("、") + "）；食材或品項資料刻意改動時才用 --freeze-draft-totals 重錄，並附差異報告");
    }
  }

  // ---------- 5. 體重趨勢斜率估計 ----------
  console.log("[體重趨勢斜率]");
  checkTdeeSlope();

  // ---------- 6. 資料庫寫入驗證（章程 C1.5：一筆一個 key，傳入陣列要報錯） ----------
  console.log("[資料庫寫入驗證]");
  await checkDbValidation();

  // ---------- 7. 備份格式（PRD 11.6、decisions #71；純函式，碰資料庫的部分在 smoke-browser） ----------
  console.log("[備份格式]");
  await checkBackupFormat();

  // ---------- 8. 我的品項管理＋份量倍數（B-1a） ----------
  console.log("[我的品項管理與份量]");
  await checkMyItems(catalog, candidatePool);

  console.log("[我的食物與不吃]");
  await checkMyFoods(catalog, convenienceData);

  console.log("\n" + (failures === 0 ? "全部通過" : failures + " 項失敗") + "（共 " + checks + " 項檢查）");
  process.exit(failures === 0 ? 0 : 1);
}

// 模擬新使用者：每兩天量一次體重，在「剛滿足資格門檻」（第 22、28 天）跟更久之後（第 42 天）估斜率。
//   - 無雜訊的線性資料：估計值跟真實斜率誤差 < 0.1 kg/週（抓系統性偏差，例如 EWMA 暖機把斜率壓扁）
//   - 有雜訊（±0.5kg）的資料：50 組不同雜訊的平均估計值誤差 < 0.1 kg/週（估計量不偏）
function checkTdeeSlope() {
  const fmt = M.dates.fmtDate;
  // 固定種子的偽隨機雜訊，讓結果可重現
  let seed = 7;
  function noise() {
    seed = (seed * 16807) % 2147483647;
    return (seed / 2147483647) - 0.5; // ±0.5 kg
  }

  const profile = { age: 35, gender: "男", height_cm: 175, weight_kg: 90, activity_mode: "輕度", goal_mode: "減脂", enabled_slots: null };

  function estimate(truePerWeek, days, withNoise) {
    const logs = [];
    const today = new Date();
    for (let i = days - 1; i >= 0; i -= 2) {
      const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() - i);
      const dayIndex = days - 1 - i;
      logs.push({ log_date: fmt(d), weight_kg: 90 + (truePerWeek / 7) * dayIndex + (withNoise ? noise() : 0) });
    }
    const result = M.tdee.evaluateCalibration(null, profile, logs, [], fmt(today), { force: true });
    return result.state.last_result.slope_kg_per_week;
  }

  for (const truePerWeek of [-0.3, -0.5, -1.2, 0.4]) {
    for (const days of [22, 28, 42]) {
      const clean = estimate(truePerWeek, days, false);
      check(clean != null && Math.abs(clean - truePerWeek) < 0.1,
        "無雜訊：實際 " + truePerWeek + " kg/週、第 " + days + " 天估成 " + clean + " kg/週（誤差需 < 0.1）");
      let sum = 0;
      const RUNS = 50;
      for (let k = 0; k < RUNS; k++) sum += estimate(truePerWeek, days, true);
      const mean = sum / RUNS;
      check(Math.abs(mean - truePerWeek) < 0.1,
        "有雜訊：實際 " + truePerWeek + " kg/週、第 " + days + " 天平均估成 " + mean.toFixed(2) + " kg/週（誤差需 < 0.1）");
    }
  }
}

// db.js 的寫入驗證在碰到 IndexedDB 之前就擋下，所以 Node 裡直接測得到。
// Node 沒有 indexedDB，驗證通過的寫入也會失敗（indexedDB is not defined），所以一律比對錯誤訊息，
// 並用「合法物件不會丟驗證錯誤」當對照，避免斷言空轉。
async function checkDbValidation() {
  const db = M.db;
  async function errorOf(fn) {
    try { await fn(); } catch (e) { return String(e && e.message); }
    return null;
  }
  async function rejectsWith(fn, pattern, label) {
    const msg = await errorOf(fn);
    check(msg !== null && pattern.test(msg), label + "（實際：" + msg + "）");
  }
  async function notValidationError(fn, label) {
    const msg = await errorOf(fn);
    check(msg === null || !/\[db\.js\]/.test(msg), label + "（實際：" + msg + "）");
  }
  const content = {
    meal_type: "convenience", archetype_id: null, method_id: null,
    components: [{ kind: "product", role: "main", ref: "conv_bx04", qty: 1, snapshot: { name: "x", kcal: 120 } }], implicit: null,
  };
  const good = {
    log_date: "2026-09-23", slot: "lunch", meal_type: "convenience", source: "manual", name: "x",
    content: content, totals: { kcal: 120, protein_g: 23, carb_g: null, fat_g: 2.8, fiber_g: 0, sat_fat_g: null, sodium_mg: 380, partial: [] }, created_at: "2026-09-23T04:00:00.000Z",
  };
  const cook = Object.assign({}, good, { meal_type: "cook_quick", content: {
    meal_type: "cook_quick", archetype_id: "egg_pan", method_id: "method_pan_fry",
    components: [{ kind: "ingredient", axis: "protein", ref: "egg", is_primary: true, scale: 1.25 }], implicit: { oil_g: 5, seasoning: "normal" },
  } });
  const estimate = Object.assign({}, good, { meal_type: "delivery", content: {
    meal_type: "delivery", archetype_id: null, method_id: null,
    components: [{ kind: "estimate", name: "喜宴", size: "L", snapshot: { kcal: 1200 } }], implicit: null,
  } });

  // 對照：合法的紀錄與物件不會丟驗證錯誤
  [["現成品項", good], ["自煮", cook], ["估算", estimate]].forEach(function (g) {
    let msg = null;
    try { db.validateDailyLog(g[1]); } catch (e) { msg = e.message; }
    check(msg === null, "格式正確的 daily_log（" + g[0] + "）被驗證擋下：" + msg);
  });
  await notValidationError(() => db.addWeightLog({ log_date: "2026-09-23", weight_kg: 70 }), "合法的 weight_log 被驗證擋下");
  await notValidationError(() => db.addExerciseLog({ log_date: "2026-09-23", activity_type: "快走" }), "合法的 exercise_log 被驗證擋下");
  await notValidationError(() => db.saveProfileForm({ age: 30 }), "合法的 profile 被驗證擋下");

  // C1.5：一筆一個 key，傳入陣列要報錯
  const ARRAY = /不能傳陣列/;
  await rejectsWith(() => db.addDailyLog([good]), ARRAY, "addDailyLog 傳入陣列沒有報「不能傳陣列」");
  await rejectsWith(() => db.addWeightLog([{ log_date: "2026-09-23", weight_kg: 70 }]), ARRAY, "addWeightLog 傳入陣列沒有報「不能傳陣列」");
  await rejectsWith(() => db.addExerciseLog([{ log_date: "2026-09-23", activity_type: "快走" }]), ARRAY, "addExerciseLog 傳入陣列沒有報「不能傳陣列」");
  await rejectsWith(() => db.saveProfileForm([{}]), ARRAY, "saveProfileForm 傳入陣列沒有報「不能傳陣列」");
  await rejectsWith(() => db.markRecipesShown(["a"]), /日期/, "markRecipesShown 沒傳今天日期沒有報錯");

  const withContent = (patch) => Object.assign({}, good, { content: Object.assign({}, content, patch) });
  const withComp = (comp) => withContent({ components: [comp] });
  const broken = [
    ["沒有 meal_type", Object.assign({}, good, { meal_type: undefined }), /meal_type/],
    ["meal_type 不在列舉", Object.assign({}, good, { meal_type: "cook" }), /meal_type/],
    ["source 不在列舉", Object.assign({}, good, { source: "custom" }), /source/],
    ["沒有 name", Object.assign({}, good, { name: "" }), /name/],
    ["沒有 created_at", Object.assign({}, good, { created_at: undefined }), /created_at/],
    ["日期格式錯", Object.assign({}, good, { log_date: "2026/09/23" }), /log_date/],
    ["content 沒有元件", withContent({ components: [] }), /content\.components/],
    ["content 型態跟紀錄不一致", Object.assign({}, good, { meal_type: "delivery" }), /content\.meal_type/],
    ["content 沒有 implicit 欄位", Object.assign({}, good, { content: { meal_type: "convenience", archetype_id: null, method_id: null, components: content.components } }), /implicit/],
    // 自煮一律包含用油與調味（章程 C4.11、−1b 驗收審核 A4）；−1a 的 implicit: null 過渡格式不再接受
    ["自煮的 implicit 是 null", Object.assign({}, cook, { content: Object.assign({}, cook.content, { implicit: null }) }), /implicit/],
    ["自煮的用油不是非負數", Object.assign({}, cook, { content: Object.assign({}, cook.content, { implicit: { oil_g: -5, seasoning: "normal" } }) }), /implicit/],
    ["自煮沒有調味欄位", Object.assign({}, cook, { content: Object.assign({}, cook.content, { implicit: { oil_g: 5 } }) }), /implicit/],
    ["自煮的調味不在列舉", Object.assign({}, cook, { content: Object.assign({}, cook.content, { implicit: { oil_g: 5, seasoning: "heavy" } }) }), /implicit/],
    ["現成品項帶了 implicit", withContent({ implicit: { oil_g: 5, seasoning: "normal" } }), /implicit/],
    ["元件 kind 不合法", withComp({ kind: "dish", ref: "x" }), /kind/],
    ["商品元件沒有 ref", withComp({ kind: "product", qty: 1, snapshot: { kcal: 1 } }), /ref/],
    ["商品元件沒有 qty", withComp({ kind: "product", ref: "x", snapshot: { kcal: 1 } }), /qty/],
    ["商品元件沒有快照", withComp({ kind: "product", ref: "x", qty: 1 }), /snapshot/],
    ["食材元件 axis 不合法", withComp({ kind: "ingredient", axis: "method", ref: "x" }), /axis/],
    ["食材元件沒有 ref", withComp({ kind: "ingredient", axis: "protein" }), /ref/],
    ["估算元件沒有快照", withComp({ kind: "estimate", name: "喜宴" }), /snapshot/],
    ["totals 沒有 kcal", Object.assign({}, good, { totals: { protein_g: 1, carb_g: 1, fat_g: 1, fiber_g: 1 } }), /totals\.kcal/],
    ["totals 營養欄位缺欄（要寫 null 不能省略）", Object.assign({}, good, { totals: { kcal: 100, protein_g: 1 } }), /totals\.carb_g/],
    ["totals 沒有鈉欄位", Object.assign({}, good, { totals: { kcal: 100, protein_g: 1, carb_g: 1, fat_g: 1, fiber_g: 1, sat_fat_g: null, partial: [] } }), /totals\.sodium_mg/],
    ["totals 沒有 partial", Object.assign({}, good, { totals: { kcal: 100, protein_g: 1, carb_g: 1, fat_g: 1, fiber_g: 1, sat_fat_g: null, sodium_mg: null } }), /totals\.partial/],
  ];
  for (const b of broken) await rejectsWith(() => db.validateDailyLog(b[1]), b[2], "daily_log " + b[0] + " 沒有被擋下");

  // 我的品項（章程 B8）：名稱、正數熱量、role、channel、allergen_tags 欄位必有（null＝未確認）、營養欄位缺值是 null
  const food = { name: "新品飯糰", channel: "convenience", role: "main", valid_slots: ["breakfast"], kcal: 250,
    protein_g: null, carb_g: null, fat_g: null, fiber_g: null, sat_fat_g: null, sodium_mg: null,
    allergen_tags: null, vegan: false, lacto_ovo: false };
  [["過敏原未確認", food], ["確認不含", Object.assign({}, food, { allergen_tags: [] })], ["含蛋", Object.assign({}, food, { allergen_tags: ["蛋"] })]].forEach(function (g) {
    let msg = null;
    try { db.validateCustomFood(g[1]); } catch (e) { msg = e.message; }
    check(msg === null, "格式正確的我的品項（" + g[0] + "）被驗證擋下：" + msg);
  });
  await rejectsWith(() => db.addCustomFood([food]), ARRAY, "addCustomFood 傳入陣列沒有報「不能傳陣列」");
  const brokenFoods = [
    ["沒有名稱", Object.assign({}, food, { name: " " }), /name/],
    ["熱量不是正數", Object.assign({}, food, { kcal: 0 }), /kcal/],
    ["熱量沒填", Object.assign({}, food, { kcal: null }), /kcal/],
    ["role 不合法", Object.assign({}, food, { role: "dessert" }), /role/],
    ["channel 不合法", Object.assign({}, food, { channel: null }), /channel/],
    ["沒有 allergen_tags 欄位", (() => { const f = Object.assign({}, food); delete f.allergen_tags; return f; })(), /allergen_tags/],
    ["過敏原不在固定詞彙", Object.assign({}, food, { allergen_tags: ["蝦"] }), /allergen_tags/],
    ["營養欄位省略（要寫 null）", (() => { const f = Object.assign({}, food); delete f.protein_g; return f; })(), /protein_g/],
    ["營養欄位是負數", Object.assign({}, food, { fat_g: -1 }), /fat_g/],
  ];
  for (const b of brokenFoods) await rejectsWith(() => db.validateCustomFood(b[1]), b[2], "我的品項 " + b[0] + " 沒有被擋下");
}

// 備份檔的驗證、升級、摘要都是純函式；importAllData 在碰 IndexedDB 之前就驗證，所以壞檔在 Node 裡也擋得到。
async function checkBackupFormat() {
  const db = M.db;
  const FIXTURE = path.join(ROOT, "tools", "fixtures", "backup-v1.json");
  const fixtureV1 = JSON.parse(fs.readFileSync(FIXTURE, "utf8"));
  // 壞檔測試用「目前版本」的檔案當底（舊版檔案會先升級，舊檔沒有的區塊當成空的，缺區塊不算壞）
  const fixture = db.migrateBackup(fixtureV1);
  const clone = (x) => JSON.parse(JSON.stringify(x));
  const problemsOf = (obj) => db.validateBackup(db.migrateBackup(obj));

  // 每個 store 都有備份位置、每個 settings key 都有驗證（之後加 store 或 key 卻沒補匯出就在這裡失敗）
  db.STORE_NAMES.forEach((name) => check(Array.isArray(db.BACKUP_SECTIONS[name]), "store「" + name + "」沒有登記在 BACKUP_SECTIONS（新增 store 要補匯出匯入）"));
  check(db.SETTING_KEY_NAMES.length > 0, "SETTING_KEYS 是空的");
  db.SETTING_KEY_NAMES.forEach((k) => {
    let msg = null;
    try { db.validateSetting(k, undefined); } catch (e) { msg = e.message; }
    check(msg !== null && msg.indexOf("沒有登記") === -1, "settings key「" + k + "」沒有自己的驗證函式");
  });

  // 凍結的 v1 fixture：之後的每個版本都要讀得了（PRD 11.6）
  let p = problemsOf(fixtureV1);
  check(p.length === 0, "凍結的 backup-v1.json 升級後不能還原：" + p.slice(0, 3).join("；"));
  check(fixture.schema_version === db.BACKUP_SCHEMA_VERSION, "backup-v1.json 升級後的版本號不是目前版本");
  const migrated = db.migrateBackup(fixtureV1);
  check(migrated !== fixtureV1 && JSON.stringify(fixtureV1) === JSON.stringify(JSON.parse(fs.readFileSync(FIXTURE, "utf8"))), "migrateBackup 改到了輸入");
  // 目前版本（v2）的凍結 fixture：由 smoke-browser 真的匯出（含隱藏清單、複製品、份量 ×2 的紀錄）
  const fixtureV2 = JSON.parse(fs.readFileSync(path.join(ROOT, "tools", "fixtures", "backup-v2.json"), "utf8"));
  p = problemsOf(fixtureV2);
  check(p.length === 0, "凍結的 backup-v2.json 不能還原：" + p.slice(0, 3).join("；"));
  const v2hidden = fixtureV2.sections.system.settings.find((x) => x.id === "hidden_catalog_uids");
  check(!!v2hidden && fixtureV2.sections.custom_foods.some((x) => x.copied_from) &&
    fixtureV2.sections.logs.daily_log.some((l) => l.content.components.some((c) => c.qty === 2)), "backup-v2.json 缺隱藏清單、複製品或份量 ×2 的紀錄");
  const dupHidden = clone(fixtureV2);
  dupHidden.sections.system.settings.find((x) => x.id === "hidden_catalog_uids").value.push(v2hidden.value[0]);
  check(problemsOf(dupHidden).some((x) => /hidden_catalog_uids/.test(x)), "備份裡的隱藏清單重複沒有擋下");
  const noProfile = clone(fixture);
  noProfile.sections.system.user_profile = null;
  noProfile.manifest.user_profile = 0;
  p = problemsOf(noProfile);
  check(p.length === 0, "基本資料是 null 的備份不能還原：" + p.join("；"));
  const sum = db.summarizeBackup(fixture);
  check(sum.daily_log.count === 3 && sum.daily_log.last_date === "2026-09-29" && sum.daily_log.last_created_at === "2026-09-29T11:00:00.000Z" &&
    sum.user_profile.count === 1 && sum.weight_log.last_date === "2026-09-29" && sum.custom_foods.last_date === "2026-09-29",
    "summarizeBackup 的筆數或日期不對：" + JSON.stringify(sum));

  // 壞檔：每一種都要回報，而且指出是哪一類第幾筆
  const bad = (label, mutate, pattern) => {
    const f = clone(fixture);
    const out = mutate(f);
    const ps = problemsOf(out === undefined ? f : out);
    check(ps.length > 0 && ps.some((x) => pattern.test(x)), "壞檔「" + label + "」沒有擋下或訊息不對：" + JSON.stringify(ps.slice(0, 3)));
  };
  const L = fixture.sections.logs;
  bad("不是物件", () => [], /不是輕盈計畫的備份/);
  bad("format 不對", (f) => { f.format = "other"; }, /不是輕盈計畫的備份/);
  bad("版本號不是整數", (f) => { f.schema_version = "1"; }, /版本號/);
  bad("版本號小於 1", (f) => { f.schema_version = 0; }, /版本號/);
  bad("版本較新", (f) => { f.schema_version = db.BACKUP_SCHEMA_VERSION + 1; }, /較新的版本/);
  bad("缺 sections", (f) => { delete f.sections; }, /缺少資料區塊/);
  bad("不認得的區塊", (f) => { f.sections.saved_meals = []; }, /不認得的資料區塊「saved_meals」/);
  bad("不認得的巢狀區塊", (f) => { f.sections.logs.meal_plan = []; }, /不認得的資料區塊「logs\.meal_plan」/);
  bad("缺一類", (f) => { delete f.sections.logs.exercise_log; }, /缺少「運動紀錄」/);
  bad("不認得的 settings key", (f) => { f.sections.system.settings.push({ id: "__unregistered_key", value: [] }); f.manifest.settings++; }, /設定第 3 筆.*沒有登記/);
  bad("settings 值不合法", (f) => { f.sections.system.settings[0].value = { lunch: "cook" }; }, /設定第 1 筆.*值格式不對/);
  bad("manifest 跟實際不符", (f) => { f.manifest.daily_log = 2; }, /飲食紀錄」的筆數跟筆數清單不一致/);
  bad("缺 manifest", (f) => { delete f.manifest; }, /manifest/);
  bad("匯出時間不是日期", (f) => { f.exported_at = "昨天"; }, /匯出時間/);
  bad("daily_log 缺 totals.kcal", (f) => { delete f.sections.logs.daily_log[1].totals.kcal; }, /飲食紀錄第 2 筆.*totals\.kcal/);
  bad("daily_log 缺 id", (f) => { delete f.sections.logs.daily_log[0].id; }, /飲食紀錄第 1 筆：沒有 id/);
  bad("daily_log id 重複", (f) => { f.sections.logs.daily_log[2].id = L.daily_log[0].id; }, /飲食紀錄第 3 筆：id 重複/);
  bad("weight_log 同一天兩筆", (f) => { f.sections.logs.weight_log[1].log_date = L.weight_log[0].log_date; }, /體重紀錄第 2 筆：日期重複/);
  bad("exercise_log 缺 activity_type", (f) => { delete f.sections.logs.exercise_log[0].activity_type; }, /運動紀錄第 1 筆/);
  bad("custom_foods 缺 allergen_tags", (f) => { delete f.sections.custom_foods[0].allergen_tags; }, /我的品項第 1 筆.*allergen_tags/);
  bad("recipe_feedback rating 亂字串", (f) => { f.sections.system.recipe_feedback[1].value.rating = "meh"; }, /推薦紀錄第 2 筆.*rating/);
  bad("recipe_feedback id 跟 recipe_template_id 不同", (f) => { f.sections.system.recipe_feedback[0].id = "combo_x"; }, /推薦紀錄第 1 筆.*recipe_template_id/);
  bad("profile age 是負數", (f) => { f.sections.system.user_profile.age = -3; }, /基本資料：age/);
  bad("profile 身高是 null", (f) => { f.sections.system.user_profile.height_cm = null; }, /基本資料：height_cm/);
  bad("profile allergens 是數字", (f) => { f.sections.system.user_profile.allergens = 3; }, /基本資料：allergens/);
  bad("profile 表單外的數值欄位是字串", (f) => { f.sections.system.user_profile.fat_pct = "0.3"; }, /基本資料：fat_pct/);
  // 舊格式的飲食紀錄（驗證器在 053d5d7、9aa7db0 變嚴之前寫入的）→ 匯出時的自我驗證要抓得到（PRD 11.6）
  bad("舊格式：totals 沒有鈉與飽和脂肪", (f) => { const t = f.sections.logs.daily_log[0].totals; delete t.sat_fat_g; delete t.sodium_mg; delete t.partial; }, /飲食紀錄第 1 筆/);
  bad("舊格式：自煮沒有 implicit", (f) => { delete f.sections.logs.daily_log[1].content.implicit; }, /飲食紀錄第 2 筆.*implicit/);

  // validateProfile 放行 lighten2 以來寫過的舊形狀
  const baseProfile = fixture.sections.system.user_profile;
  const legacy = [
    ["自由文字過敏原", { allergens: "蝦、花生" }],
    ["過敏原含詞彙外字串", { allergens: ["蝦"] }],
    ["舊 type 的不吃項目", { disliked_ingredients: [{ type: "staple", key: "edamame", label: "毛豆仁" }] }],
    ["缺 −1b 新欄位", { oil_habit: undefined, low_carb: undefined, enabled_slots: undefined, meal_prefs: undefined }],
    ["時段偏好是 off", { meal_prefs: { breakfast: "off" } }],
    ["體脂 null", { body_fat_pct: null }],
  ];
  legacy.forEach((g) => {
    const prof = JSON.parse(JSON.stringify(Object.assign({}, baseProfile, g[1])));
    let msg = null;
    try { db.validateProfile(prof); } catch (e) { msg = e.message; }
    check(msg === null, "舊形狀的基本資料（" + g[0] + "）被擋下：" + msg);
  });

  // 寫入端：setSetting 拒絕沒登記的 key 與不合法的值（C1.5）；合法值不會丟驗證錯誤
  async function errorOf(fn) { try { await fn(); } catch (e) { return String(e && e.message); } return null; }
  let msg = await errorOf(() => db.setSetting("__unregistered_key", []));
  check(msg !== null && /沒有登記/.test(msg), "setSetting 沒登記的 key 沒有擋下（實際：" + msg + "）");
  msg = await errorOf(() => db.setSetting("picker_last_meal_type", "xxx"));
  check(msg !== null && /值格式不對/.test(msg), "setSetting 不合法的值沒有擋下（實際：" + msg + "）");
  msg = await errorOf(() => db.setSetting("picker_last_meal_type", { lunch: "delivery" }));
  check(msg === null || !/\[db\.js\]/.test(msg), "setSetting 合法的值被驗證擋下（實際：" + msg + "）");
  msg = await errorOf(() => db.saveTdeeState(M.tdee.defaultTdeeState()));
  check(msg === null || !/\[db\.js\]/.test(msg), "saveTdeeState 的預設狀態被驗證擋下（實際：" + msg + "）");

  // importAllData：陣列報錯；壞檔在碰資料庫之前就丟驗證錯誤（Node 沒有 indexedDB，丟的若是 indexedDB is not defined 就代表沒先驗證）
  msg = await errorOf(() => db.importAllData([fixture]));
  check(msg !== null && /不能傳陣列/.test(msg), "importAllData 傳入陣列沒有報「不能傳陣列」（實際：" + msg + "）");
  const broken = clone(fixture);
  broken.sections.logs.daily_log[0].slot = "brunch";
  msg = await errorOf(() => db.importAllData(broken));
  check(msg !== null && /備份不能還原：飲食紀錄第 1 筆/.test(msg), "importAllData 壞檔沒有在碰資料庫前擋下（實際：" + msg + "）");
  msg = await errorOf(() => db.importAllData(fixture));
  check(msg === null || !/\[db\.js\]/.test(msg), "importAllData 合法的 fixture 被驗證擋下（實際：" + msg + "）");
}

// B-1a 我的品項管理＋份量倍數（PRD 10.x、12.3；B-1a 計畫第 4 節 1–14）。碰 IndexedDB 的部分在 smoke-browser。
async function checkMyItems(catalog, candidatePool) {
  const db = M.db, mc = M.mc, pk = M.picker;
  async function errorOf(fn) { try { await fn(); } catch (e) { return String(e && e.message); } return null; }
  const throwsOf = (fn) => { try { fn(); return null; } catch (e) { return String(e && e.message); } };
  const base = { id: "custom_x1", name: "新品飯糰", channel: "convenience", role: "main", valid_slots: ["breakfast", "lunch"], kcal: 250,
    protein_g: null, carb_g: null, fat_g: null, fiber_g: null, sat_fat_g: null, sodium_mg: null,
    allergen_tags: null, vegan: false, lacto_ovo: false, copied_from: null, archived: false,
    created_at: "2026-09-29T01:00:00.000Z", updated_at: "2026-09-29T01:00:00.000Z" };

  // 1. applyCustomFoodPatch：合併後過驗證；不能改的欄位改成不同值丟錯、相同值放行；updated_at 更新；不改輸入
  const patched = db.applyCustomFoodPatch(base, { kcal: 300, archived: true }, "2026-09-29T02:00:00.000Z");
  check(patched.kcal === 300 && patched.archived === true && patched.updated_at === "2026-09-29T02:00:00.000Z" && base.kcal === 250, "applyCustomFoodPatch 合併或 updated_at 不對，或改到了輸入");
  ["id", "created_at", "copied_from"].forEach((k) => {
    check(/不能修改/.test(throwsOf(() => db.applyCustomFoodPatch(base, { [k]: "other" }, "x")) || ""), "applyCustomFoodPatch 改 " + k + " 沒有擋下");
    check(throwsOf(() => db.applyCustomFoodPatch(base, { [k]: base[k] }, "2026-09-29T02:00:00.000Z")) === null, "applyCustomFoodPatch 帶相同的 " + k + " 被誤擋");
  });
  check(/kcal/.test(throwsOf(() => db.applyCustomFoodPatch(base, { kcal: 0 }, "x")) || ""), "applyCustomFoodPatch 合併後不合法沒有擋下");

  // 2. validateCustomFood 補驗；舊的快速新增紀錄（沒有 vendor／category／note）照樣通過
  [["archived 是字串", { archived: "false" }, /archived/], ["vegan 是數字", { vegan: 1 }, /vegan/], ["note 是數字", { note: 3 }, /note/],
   ["copied_from 是空字串", { copied_from: "" }, /copied_from/], ["vendor 是物件", { vendor: {} }, /vendor/]].forEach((b) => {
    check(b[2].test(throwsOf(() => db.validateCustomFood(Object.assign({}, base, b[1]))) || ""), "我的品項 " + b[0] + " 沒有擋下");
  });
  const legacy = Object.assign({}, base); delete legacy.copied_from; delete legacy.archived;
  check(throwsOf(() => db.validateCustomFood(legacy)) === null, "舊的快速新增紀錄被新的驗證擋下");

  // 3. 寫入函式傳陣列丟錯（C1.5）；碰資料庫前的驗證
  const ARR = /陣列/;
  check(ARR.test(await errorOf(() => db.updateCustomFood("custom_x1", [{}])) || ""), "updateCustomFood 傳陣列沒有報錯");
  check(ARR.test(await errorOf(() => db.copyBuiltinToCustom([base])) || ""), "copyBuiltinToCustom 傳陣列沒有報錯");
  check(ARR.test(await errorOf(() => db.unhideCatalogItem(["a"])) || ""), "unhideCatalogItem 傳陣列沒有報錯");
  check(/uid/.test(await errorOf(() => db.unhideCatalogItem("")) || ""), "unhideCatalogItem(\"\") 沒有報錯");
  check(db.hideCatalogItem === undefined && db.saveProfile === undefined, "hideCatalogItem、saveProfile 應該已移除（decisions #99）");
  check(/copied_from/.test(await errorOf(() => db.copyBuiltinToCustom(Object.assign({}, base, { copied_from: null }))) || ""), "copyBuiltinToCustom 缺 copied_from 沒有報錯");
  check(/格式不對/.test(await errorOf(() => db.copyBuiltinToCustom(Object.assign({}, base, { copied_from: "conv_bx04", kcal: -1 }))) || ""), "copyBuiltinToCustom 格式不對沒有報錯");
  check(/copyBuiltinToCustom/.test(await errorOf(() => db.addCustomFood(Object.assign({}, base, { copied_from: "conv_bx04" }))) || ""), "addCustomFood 帶 copied_from 沒有擋下（複製只能走 copyBuiltinToCustom）");
  check(/專用函式/.test(await errorOf(() => db.setSetting("hidden_catalog_uids", [])) || ""), "setSetting 寫隱藏清單沒有擋下（只能用專用函式）");

  // 4. 隱藏清單的驗證器（validateSetting 不看 dedicatedOnly，備份還原才讀得回來）
  check(throwsOf(() => db.validateSetting("hidden_catalog_uids", [])) === null && throwsOf(() => db.validateSetting("hidden_catalog_uids", ["conv_bx04", "tw_dr05"])) === null, "合法的隱藏清單被擋下");
  [["a", "a"], [""], "a", [1], null].forEach((v) => check(throwsOf(() => db.validateSetting("hidden_catalog_uids", v)) !== null, "不合法的隱藏清單 " + JSON.stringify(v) + " 沒有擋下"));

  // 5. qty 只能是 0.5／1／1.5／2
  const logWith = (qty) => ({ log_date: "2026-09-23", slot: "lunch", meal_type: "convenience", source: "manual", name: "x",
    content: { meal_type: "convenience", archetype_id: null, method_id: null, implicit: null,
      components: [{ kind: "product", role: "main", ref: "conv_bx04", qty: qty, snapshot: { name: "x", kcal: 120 } }] },
    totals: { kcal: 120, protein_g: null, carb_g: null, fat_g: null, fiber_g: null, sat_fat_g: null, sodium_mg: null, partial: [] },
    created_at: "2026-09-23T04:00:00.000Z" });
  [0.5, 1, 1.5, 2].forEach((q) => check(throwsOf(() => db.validateDailyLog(logWith(q))) === null, "份量 " + q + " 被擋下"));
  [0, 3, 0.25, "2", null].forEach((q) => check(/qty/.test(throwsOf(() => db.validateDailyLog(logWith(q))) || ""), "份量 " + JSON.stringify(q) + " 沒有擋下"));

  // 6. 份量合計：qty 2 每個欄位 2 倍、null 照 null；0.5 的部分無資料照樣記 partial；沒有 qtyByUid 跟 1 相同
  const main = catalog.products.find((p) => p.uid === "conv_bx04");
  const totalsOf = (items, qtyByUid) => mc.contentTotals(mc.buildDraftContent({ kind: "products", meal_type: "convenience", items: items, estimates: [], drink: null, qtyByUid: qtyByUid }), catalog);
  const one = totalsOf([main]);
  const two = totalsOf([main], { conv_bx04: 2 });
  ["kcal", "protein_g", "carb_g", "fat_g", "fiber_g", "sat_fat_g", "sodium_mg"].forEach((k) => {
    check(one[k] == null ? two[k] == null : Math.abs(two[k] - 2 * one[k]) < 0.11, "份量 ×2 的 " + k + " 不是兩倍（" + one[k] + " → " + two[k] + "）");
  });
  check(JSON.stringify(totalsOf([main], {})) === JSON.stringify(one) && JSON.stringify(totalsOf([main], { conv_bx04: 1 })) === JSON.stringify(one), "沒有份量或份量 1 跟預設不同");
  // 只有台式外食的飲料有鈉資料：半份主餐（沒有鈉）＋有鈉的飲料 → 鈉記部分無資料
  const sodiumDrink = catalog.products.find((p) => p.role === "drink" && p.sodium_mg != null);
  check(!!sodiumDrink && main.sodium_mg == null, "找不到有鈉資料的飲料或主餐已有鈉（測試前提不成立）");
  if (sodiumDrink) {
    const half = mc.contentTotals(mc.buildDraftContent({ kind: "products", meal_type: "convenience", items: [main], estimates: [], drink: sodiumDrink, qtyByUid: { conv_bx04: 0.5 } }), catalog);
    check(half.partial.indexOf("sodium_mg") !== -1 && half.sodium_mg === sodiumDrink.sodium_mg, "半份的品項鈉無資料時沒有記 partial：" + JSON.stringify(half));
  }
  const content2 = mc.buildDraftContent({ kind: "products", meal_type: "convenience", items: [main], estimates: [], drink: null, qtyByUid: { conv_bx04: 2 } });
  check(content2.components[0].qty === 2, "草稿的份量沒有寫進元件 qty");

  // 7. withoutHidden 與 planToday
  const hidden = ["conv_bx04", "不存在的_uid"];
  const filtered = M.pool.withoutHidden(candidatePool, hidden);
  check(filtered.every((c) => c.is_composed || c.components.indexOf("conv_bx04") === -1), "withoutHidden 後還有含隱藏品項的現成組合");
  check(filtered.filter((c) => c.is_composed).length === candidatePool.filter((c) => c.is_composed).length, "withoutHidden 影響到自組食譜");
  check(filtered.length < candidatePool.length, "withoutHidden 沒有拿掉任何組合（測試前提不成立）");
  check(M.pool.withoutHidden(candidatePool, []) === candidatePool && M.pool.withoutHidden(candidatePool) === candidatePool, "withoutHidden 空清單沒有回傳同一個池");
  const prof = { age: 35, gender: "男", height_cm: 175, weight_kg: 80, activity_mode: "輕度", goal_mode: "減脂", meal_prefs: null, enabled_slots: null, diet_restriction: "一般", allergens: [], disliked_ingredients: [] };
  const targets = M.nutrition.calculateTargets(prof);
  const nowMs7 = new Date(2026, 8, 23, 6, 0).getTime();
  const planWith = (h) => M.today.planToday({ profile: prof, targets, todayLogs: [], weekLogs: [], feedbackMap: {}, pool: candidatePool, hiddenUids: h, today: "2026-09-23", nowMs: nowMs7 });
  const plain = M.today.planToday({ profile: prof, targets, todayLogs: [], weekLogs: [], feedbackMap: {}, pool: candidatePool, today: "2026-09-23", nowMs: nowMs7 });
  check(JSON.stringify(plain.recs) === JSON.stringify(planWith([]).recs), "planToday 不帶 hiddenUids 跟帶 [] 不同");
  const target = SLOTS.map((s) => plain.recs[s]).find((r) => r && !r.lowBudget && !r.is_composed && Array.isArray(r.components));
  check(!!target, "找不到現成品項的推薦（測試前提不成立）");
  if (target) {
    const uid = target.components[0];
    const after = planWith([uid]).recs;
    check(SLOTS.every((s) => !after[s] || after[s].lowBudget || after[s].is_composed || after[s].components.indexOf(uid) === -1), "隱藏推薦裡的品項 " + uid + " 之後，推薦還含它");
  }

  // 8. partitionByMealType 帶隱藏：內建隱藏品項（含飲料）不出現；我的品項不受影響；第四參數缺＝不過濾
  const drinkUid = catalog.products.find((p) => p.role === "drink" && (p.valid_slots || []).indexOf("lunch") !== -1).uid;
  const own = [Object.assign(M.catalog.fromCustomFood(Object.assign({}, base, { id: "conv_bx04_mine", valid_slots: ["lunch"] })))];
  const all = pk.partitionByMealType(catalog.products, own, "lunch");
  const hid = pk.partitionByMealType(catalog.products, own, "lunch", ["conv_bx04", drinkUid]);
  const uidsOf = (parts) => parts.convenience.concat(parts.delivery, parts.drinks).map((it) => it.uid);
  check(uidsOf(all).indexOf("conv_bx04") !== -1 && uidsOf(hid).indexOf("conv_bx04") === -1 && uidsOf(hid).indexOf(drinkUid) === -1, "partitionByMealType 沒有濾掉隱藏的內建品項或飲料");
  check(uidsOf(hid).indexOf("conv_bx04_mine") !== -1, "partitionByMealType 隱藏影響到我的品項");
  check(uidsOf(hid).length === uidsOf(all).length - 2, "partitionByMealType 隱藏後的數量不對");

  // 9. copyFromBuiltin：每一筆內建都通過寫入驗證；未確認 → null；素食照 diet_tags；note 只剩內容物；copied_from 是 uid
  catalog.products.forEach((p) => {
    const r = mc.copyFromBuiltin(p);
    const err = throwsOf(() => db.validateCustomFood(r));
    check(err === null, "複製內建 " + p.uid + " 不通過驗證：" + err);
    check(r.copied_from === p.uid, "複製內建 " + p.uid + " 的 copied_from 不是 uid");
    check((p.allergen_tags || []).indexOf("未確認") !== -1 ? r.allergen_tags === null : Array.isArray(r.allergen_tags), "複製內建 " + p.uid + " 的過敏原轉換不對");
    check(r.vegan === (p.diet_tags || []).indexOf("全素") !== -1, "複製內建 " + p.uid + " 的全素宣告不對");
    check(r.note === null || r.note.indexOf("；") === -1, "複製內建 " + p.uid + " 的 note 還帶資料來源說明");
  });
  check(catalog.products.some((p) => p.is_taiwan && mc.copyFromBuiltin(p).copied_from.indexOf("tw_") === 0), "台式外食的 copied_from 沒有 tw_ 前綴");

  // 10. fillableReason：只有未確認類
  check(pk.fillableReason("成分未確認") && pk.fillableReason("飲食限制未確認") && !pk.fillableReason("含過敏原") && !pk.fillableReason("你已設定不吃：鮭魚") && !pk.fillableReason(null),
    "fillableReason 對四種原因的判斷不對（只有未確認類可以補填）");

  // 11. B9：查不到的 uid 不拋錯、不列出
  const cur = mc.builtinCurrentValues("conv_bx04", catalog.productsByUid);
  check(cur && cur.kcal === main.kcal && "sodium_mg" in cur, "builtinCurrentValues 的內建數值不對");
  check(mc.builtinCurrentValues("已下架_uid", catalog.productsByUid) === null && mc.builtinCurrentValues(null, catalog.productsByUid) === null, "builtinCurrentValues 查不到時沒有回傳 null");
  const he = pk.hiddenEntries(["conv_bx04", "已下架_uid", "tw_dr05"], catalog.productsByUid);
  check(he.length === 2 && he[0].uid === "conv_bx04" && he[1].uid === "tw_dr05", "hiddenEntries 沒有略過查不到的 uid 或順序不對：" + JSON.stringify(he));
  check(pk.hiddenEntries(undefined, catalog.productsByUid).length === 0, "hiddenEntries 沒有清單時出錯");

  // 12. placeNewCustom
  const item = (patch) => M.catalog.fromCustomFood(Object.assign({}, base, { valid_slots: ["lunch"] }, patch));
  const ctx = (patch) => Object.assign({ slot: "lunch", currentTab: "convenience", profile: prof, roleItems: [] }, patch);
  const pl = (it, c) => pk.placeNewCustom(it, c);
  let r = pl(item({}), ctx());
  check(r.dest === "tab" && r.tab === "convenience" && r.select && !r.reason, "placeNewCustom 可選的品項沒有選中：" + JSON.stringify(r));
  r = pl(item({}), ctx({ profile: Object.assign({}, prof, { allergens: ["蛋"] }) }));
  check(r.dest === "tab" && !r.select && r.reason === "成分未確認", "placeNewCustom 被擋的品項沒有放進清單並記原因：" + JSON.stringify(r));
  r = pl(item({ valid_slots: ["breakfast"] }), ctx());
  check(r.dest === null && !r.select, "placeNewCustom 不在這個時段的品項被放進清單：" + JSON.stringify(r));
  const mains = catalog.products.filter((p) => !p.is_taiwan && p.role === "main" && (p.valid_slots || []).indexOf("afternoon_tea") !== -1).slice(0, 1);
  r = pl(item({ valid_slots: ["afternoon_tea"] }), ctx({ slot: "afternoon_tea", roleItems: mains.length ? mains : [main] }));
  check(r.dest === "tab" && !r.select && typeof r.roleProblem === "string" && r.roleProblem.length > 0, "placeNewCustom 名額已滿沒有說明：" + JSON.stringify(r));
  r = pl(item({ channel: "delivery" }), ctx());
  check(r.dest === "tab" && r.tab === "delivery" && !r.select, "placeNewCustom 別的分頁的品項被選中或放錯分頁：" + JSON.stringify(r));
  r = pl(item({ role: "drink" }), ctx({ roleItems: [catalog.productsByUid[drinkUid]] }));
  check(r.dest === "drinks" && r.select, "placeNewCustom 已選一杯飲料時，新的飲料沒有取代（不跑角色名額）：" + JSON.stringify(r));
  // 複製時原品項已從選取拿掉：下午茶主餐上限 1，仍能選進新的那筆（ui 先拿掉再呼叫）
  r = pl(item({ valid_slots: ["afternoon_tea"] }), ctx({ slot: "afternoon_tea", roleItems: [] }));
  check(r.select, "placeNewCustom 名額空出來後沒有選中");

  // 13. qtyLabel 與 draftLogName
  check(mc.qtyLabel(0.5) === "半份" && mc.qtyLabel(1) === "" && mc.qtyLabel(1.5) === "×1.5" && mc.qtyLabel(2) === "×2", "qtyLabel 的文字不對");
  const egg = catalog.products.find((p) => p.role === "side") || main;
  const nm = mc.draftLogName({ kind: "products", items: [main, egg], estimates: [{ name: "喜宴", size: "L" }], drink: catalog.productsByUid[drinkUid], qtyByUid: { conv_bx04: 0.5, [egg.uid]: 2 } });
  check(nm === main.name + "（半份）＋" + egg.name + " ×2＋喜宴＋" + catalog.productsByUid[drinkUid].name, "draftLogName 的份量文字不對：" + nm);
}

// 工作線 D 切片 2：我的食物與不吃（計畫 docs/review/2026-09-30-D2-實作計畫.md 第 4 節）
async function checkMyFoods(catalog, convenienceData) {
  const db = M.db, pk = M.picker, fd = M.foods, flt = M.filters;
  async function errorOf(fn) { try { await fn(); } catch (e) { return String(e && e.message); } return null; }
  const throwsOf = (fn) => { try { fn(); return null; } catch (e) { return String(e && e.message); } };
  const P = catalog.products;
  const soy = P.find((p) => (p.allergen_tags || []).indexOf("黃豆") !== -1 && (p.allergen_tags || []).indexOf("未確認") === -1);
  const unver = P.find((p) => (p.allergen_tags || []).indexOf("未確認") !== -1);
  const nonVeg = P.find((p) => (p.allergen_tags || []).indexOf("未確認") === -1 && (p.diet_tags || []).join() === "蛋奶素"); // 設全素時被飲食擋
  const dis = (uid) => ({ type: "item", key: uid, label: catalog.productsByUid[uid].name });

  // 1. 原因代碼（decisions #80）：原因文字不變，code 跟文字一一對應
  const profiles = [{}, { allergens: ["蛋"] }, { allergens: ["黃豆"] }, { diet_restriction: "全素" }, { diet_restriction: "蛋奶素" },
    { disliked_ingredients: P.slice(0, 30).map((p) => dis(p.uid)) }, { allergens: ["乳製品"], diet_restriction: "全素", disliked_ingredients: P.map((p) => dis(p.uid)) }];
  const CODE_OF = { "成分未確認": "allergen", "含過敏原": "allergen", "飲食限制未確認": "diet" };
  profiles.forEach((prof, pi) => P.forEach((p) => {
    const r = flt.passesHardFilters(p, prof);
    const want = r.ok ? null : (CODE_OF[r.reason] || (/^你已設定不吃：/.test(r.reason) ? "disliked" : "?"));
    check(r.code === want, "passesHardFilters 的 code 跟原因對不上：profile " + pi + " " + p.uid + " " + r.reason + " / " + r.code);
  }));
  if (soy && unver && nonVeg) {
    check(flt.passesHardFilters(soy, { allergens: ["黃豆"], disliked_ingredients: [dis(soy.uid)] }).code === "allergen", "又不吃又含過敏原應該回 allergen（留在原位）");
    check(flt.passesHardFilters(nonVeg, { diet_restriction: "全素", disliked_ingredients: [dis(nonVeg.uid)] }).code === "diet", "又不吃又飲食未確認應該回 diet");
    // quickAddProblem 改用 code 後輸出不變（句型逐字）
    check(pk.quickAddProblem(unver, { allergens: ["蛋"] }).blocked === "你設了過敏原「蛋」，過敏原未確認的品項不能選。", "quickAddProblem 未確認的句子變了");
    check(pk.quickAddProblem(soy, { allergens: ["黃豆"] }).blocked === "你設了過敏原「黃豆」，含有它的品項不能選。", "quickAddProblem 含過敏原的句子變了");
    check(pk.quickAddProblem(nonVeg, { diet_restriction: "全素" }).blocked === "你設了飲食限制「全素」，沒有宣告符合的品項不能選。", "quickAddProblem 飲食的句子變了");
    check(pk.quickAddProblem(soy, { disliked_ingredients: [dis(soy.uid)] }).blocked === "你已設定不吃：" + soy.name, "quickAddProblem 不吃的句子變了");
  } else check(false, "找不到測試用品項（黃豆、未確認、無飲食宣告）");

  // 2. splitDisliked：保持順序、只移 disliked
  const items = P.slice(0, 12);
  const dset = {}; [1, 4, 9].forEach((i) => { dset[items[i].uid] = true; });
  const sp = pk.splitDisliked(items, (it) => (dset[it.uid] ? "disliked" : it.uid === items[2].uid ? "allergen" : null));
  check(sp.disliked.map((x) => x.uid).join() === [1, 4, 9].map((i) => items[i].uid).join(), "splitDisliked 不吃組的順序不對");
  check(sp.rest.map((x) => x.uid).join() === items.filter((it) => !dset[it.uid]).map((x) => x.uid).join(), "splitDisliked 其餘的順序不對或 allergen 被移走");
  const empty = pk.splitDisliked([], () => "disliked");
  check(empty.rest.length === 0 && empty.disliked.length === 0, "splitDisliked 空清單");

  // 3. partitionAllChannels：不套時段、隱藏與封存的不列；每個時段的結果 ⊆ 全部
  const breakfastOnly = P.find((p) => p.role !== "drink" && p.valid_slots.length === 1 && p.valid_slots[0] === "breakfast");
  const hiddenUid = P.find((p) => p.role === "main").uid;
  const customs = [
    { uid: "custom_a", name: "我的A", channel: "convenience", role: "main", valid_slots: ["lunch"], is_custom: true, archived: false },
    { uid: "custom_b", name: "我的B", channel: "delivery", role: "main", valid_slots: ["dinner"], is_custom: true, archived: true },
    { uid: "custom_c", name: "我的C", channel: "delivery", role: "drink", valid_slots: ["breakfast"], is_custom: true, archived: false },
  ];
  const all = pk.partitionAllChannels(P, customs, [hiddenUid]);
  const allUids = {};
  ["convenience", "delivery", "drinks"].forEach((t) => all[t].forEach((x) => { allUids[x.uid] = t; }));
  check(!breakfastOnly || !!allUids[breakfastOnly.uid], "partitionAllChannels 漏了只有早餐的品項");
  check(!allUids[hiddenUid], "partitionAllChannels 列出了隱藏的品項");
  check(!allUids.custom_b && allUids.custom_a === "convenience" && allUids.custom_c === "drinks", "partitionAllChannels 的我的品項分錯或列出了封存的");
  check(Object.keys(allUids).length === P.length - 1 + 2, "partitionAllChannels 的總數不對：" + Object.keys(allUids).length);
  SLOTS.forEach((slot) => {
    const part = pk.partitionByMealType(P, customs, slot, [hiddenUid]);
    ["convenience", "delivery", "drinks"].forEach((t) => part[t].forEach((x) => check(allUids[x.uid] === t, "partitionByMealType(" + slot + ") 的 " + x.uid + " 不在 partitionAllChannels 的同一分頁")));
  });

  // 4. 不吃的純函式（decisions #99）
  const e1 = { type: "item", key: "conv_bx04", label: "舊名" };
  const l0 = [e1];
  const l1 = db.addDislikedTo(l0, { type: "protein", key: "conv_bx04", label: "x" });
  check(l1.length === 1 && l1 !== l0, "addDislikedTo 同 key 不同 type 不該新增，而且要回新陣列");
  const l2 = db.addDislikedTo(l0, { type: "protein", key: "chicken_breast", label: "雞胸肉" });
  check(l2.length === 2 && l0.length === 1 && l2[1].key === "chicken_breast", "addDislikedTo 新增不對或改到了輸入");
  check(db.addDislikedTo(null, e1).length === 1, "addDislikedTo 沒有清單時要從空的開始");
  [["缺 key", { type: "item", label: "a" }], ["key 空字串", { type: "item", key: "", label: "a" }], ["缺 type", { key: "a", label: "a" }],
   ["label 不是字串", { type: "item", key: "a", label: 3 }], ["不是物件", "a"], ["陣列", [e1]]].forEach((b) => {
    check(throwsOf(() => db.addDislikedTo([], b[1])) !== null, "addDislikedTo " + b[0] + " 沒有擋下");
  });
  const dup = [e1, { type: "protein", key: "chicken_breast", label: "雞胸肉" }, { type: "protein", key: "conv_bx04", label: "舊" }];
  check(db.removeDislikedFrom(dup, "conv_bx04").map((d) => d.key).join() === "chicken_breast" && dup.length === 3, "removeDislikedFrom 沒有移除全部同 key，或改到了輸入");
  check(db.removeDislikedFrom(dup, "nope").length === 3 && db.removeDislikedFrom(null, "a").length === 0, "removeDislikedFrom 不存在的 key 或沒有清單");
  const merged = db.mergeProfileForm({ age: 40, disliked_ingredients: [e1] }, { age: 30, disliked_ingredients: [] });
  check(merged.age === 30 && merged.disliked_ingredients.length === 1 && merged.disliked_ingredients[0].key === "conv_bx04", "mergeProfileForm 沒有保留資料庫的不吃清單");
  check(db.mergeProfileForm(null, { age: 30, disliked_ingredients: [e1] }).disliked_ingredients.length === 0, "mergeProfileForm 沒有舊資料時要存 []");
  // 專用函式：參數錯在碰資料庫前就丟（Node 沒有 IndexedDB，真正讀寫在 smoke-browser）
  check(/缺 key/.test(await errorOf(() => db.addDislikedIngredient({ type: "item", label: "a" })) || ""), "addDislikedIngredient 缺 key 沒有在碰資料庫前報錯");
  check(/陣列/.test(await errorOf(() => db.removeDislikedIngredient(["a"])) || ""), "removeDislikedIngredient 傳陣列沒有報錯");
  check(/key/.test(await errorOf(() => db.removeDislikedIngredient("")) || ""), "removeDislikedIngredient(\"\") 沒有報錯");
  check(/陣列/.test(await errorOf(() => db.saveProfileForm([{}])) || ""), "saveProfileForm 傳陣列沒有報錯");
  const msg = await errorOf(() => db.saveProfileForm({ age: 30 }));
  check(msg === null || !/\[db\.js\]/.test(msg), "合法的 profile 被 saveProfileForm 的驗證擋下（實際：" + msg + "）");

  // 5. engine/foods.js
  const ing = catalog.ingredients.find((x) => x.axis === "protein");
  const fakeCat = { productsByUid: Object.assign({}, catalog.productsByUid, { conv_bx04: Object.assign({}, catalog.productsByUid.conv_bx04, { name: "改名後" }) }), ingredients: catalog.ingredients };
  const ents = fd.dislikedListEntries([e1, { type: "protein", key: ing.id, label: "舊食材名" }, { type: "item", key: "gone_x", label: "下架品" }, { type: "protein", key: "conv_bx04", label: "重複" }], fakeCat);
  check(ents.length === 3, "dislikedListEntries 沒有依 key 去重");
  check(ents[0].name === "改名後" && !ents[0].gone, "dislikedListEntries 品項要用 catalog 現在的名稱");
  check(ents[1].name === ing.name && !ents[1].gone, "dislikedListEntries 食材 id 查不到");
  check(ents[2].gone && ents[2].name === null && ents[2].label === "下架品", "dislikedListEntries 查不到的 key 要 gone");
  const sEnts = [{ uid: "a", name: "無糖豆漿" }, { uid: "b", name: "Soyjoy 點心棒" }, { uid: "c", name: "雞胸", aliases: ["雞胸肉"] }];
  check(fd.searchFoods(sEnts, "").length === 0 && fd.searchFoods(sEnts, "   ").length === 0, "searchFoods 空字串要回 []");
  check(fd.searchFoods(sEnts, " 豆漿 ").map((x) => x.uid).join() === "a", "searchFoods 前後空白");
  check(fd.searchFoods(sEnts, "SOYJOY").map((x) => x.uid).join() === "b", "searchFoods 不分大小寫");
  check(fd.searchFoods(sEnts, "雞胸肉").map((x) => x.uid).join() === "c", "searchFoods 別名");
  check(fd.searchFoods(sEnts, "牛排").length === 0, "searchFoods 無結果");
  if (soy && unver && nonVeg) {
    check(fd.foodBlockText(soy, {}) === null, "foodBlockText 沒被擋要回 null");
    check(fd.foodBlockText(unver, { allergens: ["蛋"] }) === pk.quickAddProblem(unver, { allergens: ["蛋"] }).blocked, "foodBlockText 過敏原要沿用 quickAddProblem 的句子");
    check(fd.foodBlockText(nonVeg, { diet_restriction: "全素" }) === pk.quickAddProblem(nonVeg, { diet_restriction: "全素" }).blocked, "foodBlockText 飲食要沿用 quickAddProblem 的句子");
    check(fd.foodBlockText(soy, { disliked_ingredients: [dis(soy.uid)] }) === "你標了不吃（只擋這一項）", "foodBlockText 不吃的句子");
  }
  const recs = [{ id: "custom_b", created_at: "2026-09-29T01:00:00.000Z" }, { id: "custom_a", created_at: "2026-09-30T01:00:00.000Z" }, { id: "custom_c", created_at: "2026-09-29T01:00:00.000Z" }];
  check(fd.customFoodsNewestFirst(recs).map((r) => r.id).join() === "custom_a,custom_c,custom_b" && recs[0].id === "custom_b", "customFoodsNewestFirst 新到舊（同時間依 id 倒序），不改輸入");

  // 6. 出處類別（decisions #98）
  const FIELDS = ["kcal", "protein_g", "carb_g", "fat_g", "fiber_g", "sat_fat_g", "sodium_mg"];
  P.forEach((p) => check(p.source_class && FIELDS.every((k) => ["tfda", "label", "estimate"].indexOf(p.source_class[k]) !== -1), p.uid + " 的 source_class 不完整"));
  const sc = (u) => catalog.productsByUid[u].source_class;
  check(FIELDS.every((k) => sc("tw_dr05")[k] === "tfda") && catalog.productsByUid.tw_dr05.tfda_ids.join() === "O0700301", "tw_dr05 整筆衛福部換算（含缺值填 0 的纖維）要是 tfda 並附編號");
  check(sc("tw_bf11").carb_g === "estimate", "tw_bf11 反推的碳水要承襲熱量的估算");
  const srcOf = (p, k) => ((p.field_sources || {})[k] || p.source).type;
  const luItem = convenienceData.find((p) => FIELDS.some((k) => srcOf(p, k) === "label_unsourced"));
  const luField = FIELDS.find((k) => srcOf(luItem, k) === "label_unsourced");
  check(sc(luItem.id)[luField] === "estimate", "label_unsourced 要歸估算：" + luItem.id + "." + luField);
  const mid = P.find((p) => p.kcal_basis === "midpoint");
  check(mid && sc(mid.uid).kcal === "estimate", "區間中點的熱量要歸估算");
  // 人造品項：包裝標示、反推碳水承襲最弱
  const synth = (patch) => M.catalog.buildCatalog({ ingredients: [], archetypes: [], taiwanItems: [],
    convenienceItems: [Object.assign({ id: "zz1", name: "測試", channel: "convenience", role: "main", valid_slots: ["lunch"], kcal: 300, kcal_basis: "stated",
      protein_g: 10, carb_g: 40, fat_g: 10, fiber_g: 1, sat_fat_g: 2, sodium_mg: 300, allergen_tags: [], source: { type: "label", ref: "x.jpg" } }, patch)] }).products[0].source_class;
  check(FIELDS.every((k) => synth({})[k] === "label"), "包裝標示的品項要是 label");
  check(synth({ source: { type: "official_web", ref: "u" } }).kcal === "label", "official_web 要是 label");
  const inh = synth({ field_sources: { protein_g: { type: "estimate", ref: "e" }, carb_g: { type: "derived", ref: "（熱量 − 蛋白質×4 − 脂肪×9）÷ 4" } } });
  check(inh.carb_g === "estimate" && inh.kcal === "label", "反推的碳水要承襲三欄最弱的類別");
  check(synth({ field_sources: { carb_g: { type: "derived", ref: "（熱量 − 蛋白質×4 − 脂肪×9）÷ 4" } } }).carb_g === "label", "三欄都是包裝時反推碳水是 label");
  check(M.catalog.fromCustomFood({ id: "custom_x", name: "a", channel: "convenience", role: "main", kcal: 1 }).source_class === null, "我的品項 source_class 要是 null");
  const g = fd.sourceClassGroups({ source_class: { kcal: "label", protein_g: "label", carb_g: "estimate", fat_g: "estimate", fiber_g: "tfda", sat_fat_g: "estimate", sodium_mg: "label" } });
  check(JSON.stringify(g) === JSON.stringify([{ cls: "tfda", fields: ["fiber_g"] }, { cls: "label", fields: ["kcal", "protein_g", "sodium_mg"] }, { cls: "estimate", fields: ["carb_g", "fat_g", "sat_fat_g"] }]), "sourceClassGroups 分組或順序不對：" + JSON.stringify(g));
  check(fd.sourceClassGroups({ source_class: null }).length === 0, "sourceClassGroups 我的品項要回 []");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
