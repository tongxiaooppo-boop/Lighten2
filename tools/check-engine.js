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
    myIng: await imp("js/engine/my-ingredients.js"),
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
    // 現成飲料分組（decisions #143）：全部照列；超商分頁超商在前，外食與自煮手搖飲那組在前；我的品項最後
    const dcf = Object.assign({}, cf, { uid: "custom_drink", role: "drink" });
    const drinks143 = M.picker.partitionByMealType(catalog.products, [dcf], "lunch").drinks;
    const keys = (tab) => M.picker.drinkGroups(drinks143, tab).map((g) => g.key).join(",");
    const flat = (tab) => M.picker.drinkGroups(drinks143, tab).reduce((a, g) => a.concat(g.items), []);
    check(keys("convenience") === "convenience,delivery,mine" && keys("delivery") === "delivery,convenience,mine" && keys("cook") === "delivery,convenience,mine",
      "飲料分組順序不對：" + keys("convenience") + " / " + keys("delivery"));
    check(flat("convenience").length === drinks143.length && M.picker.drinkGroups(drinks143, "convenience")[0].items.every((p) => !p.is_taiwan && p.channel === "convenience"),
      "超商分頁的飲料要全部照列、第一組只有超商飲料");
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

  // ---------- 9. 代換表分層資料（工作線 D 切片 3，decisions #92、#103） ----------
  console.log("[代換表分層資料]");
  {
    const raw = { ingredients: readJson("ingredients.json"), convenienceItems: convenienceData, taiwanItems: taiwanData, archetypes: readJson("dish_archetypes.json") };
    const tree = readJson("food_tree.json");
    const withTree = M.catalog.buildCatalog(Object.assign({}, raw, { foodTree: tree }));
    const without = M.catalog.buildCatalog(raw);
    check(without.foodTree.items.length === 0 && without.foodTree.groups.length === 0, "沒傳分層資料時 foodTree 要是空的");
    ["ingredients", "proteins", "staples", "vegetables", "sauces", "implicit", "products", "productsByUid", "archetypes"].forEach((k) => {
      check(JSON.stringify(withTree[k]) === JSON.stringify(without[k]), "載入分層資料後 catalog." + k + " 變了（分層資料不能影響既有欄位）");
    });
    const ft = withTree.foodTree;
    check(ft.items.length === tree.items.length && ft.items.length > 300, "分層品項筆數不對：" + ft.items.length);
    check(ft.items.every((it) => it.uid === it.id && ft.byId[it.id] === it), "每一筆 uid 要等於 id、byId 要涵蓋全部");
    check(ft.items.every((it) => Array.isArray(it.allergen_tags)), "分層品項的 allergen_tags 要是陣列");
    check(ft.items.every((it) => JSON.stringify(it.diet_tags) === JSON.stringify(it.vegan ? ["全素"] : it.lacto_ovo ? ["蛋奶素"] : [])), "diet_tags 要由 vegan／lacto_ovo 推導（全素 ⊃ 蛋奶素）");
    const noTags = M.catalog.buildCatalog(Object.assign({}, raw, { foodTree: { groups: [], items: [{ id: "fx_x", vegan: true, lacto_ovo: true }] } }));
    check(noTags.foodTree.items[0].allergen_tags.join() === "未確認", "分層品項缺 allergen_tags 要當未確認（decisions #77）");
    // 共用內建 id：per_100g 等於內建；1 份 30g＝round1(內建 × 0.3)（decisions #103，跟 engine 同一條路徑）
    const cb = ft.byId.chicken_breast, ing = withTree.ingredients.find((x) => x.id === "chicken_breast");
    check(cb && cb.builtin && JSON.stringify(cb.per_100g) === JSON.stringify(ing.per_100g), "分層雞胸肉的 per_100g 要等於內建");
    check(cb && ["kcal", "protein_g", "fat_g", "sodium_mg"].every((k) => cb.per_serving[k] === Math.round(ing.per_100g[k] * 0.3 * 10) / 10), "分層雞胸肉 1 份 30g 要等於內建 × 0.3");
    // fx_ 跟現成品項同一段換算：代換表全脂奶 240ml ＝ 外帶鮮奶一杯 tw_dr08（decisions #85、#103）
    const milk = ft.byId.fx_whole_milk, dr08 = withTree.productsByUid.tw_dr08;
    check(milk && ["kcal", "protein_g", "carb_g", "fat_g", "fiber_g", "sat_fat_g", "sodium_mg"].every((k) => milk.per_serving[k] === dr08[k]), "代換表全脂奶 240ml 跟 tw_dr08 的數值要完全相同");
    check(milk && milk.same_sample_products.indexOf("tw_dr08") !== -1, "全脂奶的 same_sample_products 要有 tw_dr08");
    // id 不相交（decisions #78）；硬性過濾吃得下分層品項（切片 4 會用）
    check(ft.items.every((it) => !withTree.productsByUid[it.id]), "分層 id 不能等於任何 catalog uid");
    check(ft.items.filter((it) => /^fx_/.test(it.id)).every((it) => !withTree.ingredients.some((x) => x.id === it.id)), "fx_ id 不能等於內建食材 id");
    const oil = ft.byId.fx_soybean_oil;
    check(oil && !ft.byId.cooking_oil && oil.allergen_tags.length === 0, "大豆油用 fx_ id、不共用 cooking_oil、標註跟內建一樣是 []（decisions #102、#89）");
    check(!M.filters.passesHardFilters(ft.byId.fx_irwin_mango, { allergens: ["芒果"] }).ok, "愛文芒果對芒果過敏要被擋");
    check(!M.filters.passesHardFilters(ft.byId.fx_whole_milk, { disliked_ingredients: [{ type: "item", key: "fx_whole_milk", label: "全脂奶" }] }).ok, "分層品項標不吃要被擋（只比 key）");
    check(M.filters.passesHardFilters(ft.byId.fx_cooked_rice, { diet_restriction: "全素" }).ok, "白飯（全素）全素使用者可以選");
  }

  // ---------- 10. 我的食物：分層（工作線 D 切片 4，計畫 docs/review/2026-09-30-D4-實作計畫.md 第 4 節） ----------
  console.log("[我的食物：分層]");
  checkFoodTreeViews(M.catalog.buildCatalog({ ingredients: readJson("ingredients.json"), convenienceItems: convenienceData, taiwanItems: taiwanData,
    archetypes: readJson("dish_archetypes.json"), foodTree: readJson("food_tree.json") }), readJson("food_tree.json"));

  // ---------- 11. 單品（工作線 D 切片 7） ----------
  console.log("[單品]");
  checkSingleFoods(M.catalog.buildCatalog({ ingredients: readJson("ingredients.json"), convenienceItems: convenienceData, taiwanItems: taiwanData,
    archetypes: readJson("dish_archetypes.json"), foodTree: readJson("food_tree.json") }), candidatePool);
  checkSingleFoodsDb(M.catalog.buildCatalog({ ingredients: readJson("ingredients.json"), convenienceItems: convenienceData, taiwanItems: taiwanData,
    archetypes: readJson("dish_archetypes.json"), foodTree: readJson("food_tree.json") }));

  // ---------- 12. 我的組合（工作線 C） ----------
  console.log("[我的組合]");
  checkSavedMeals(M.catalog.buildCatalog({ ingredients: readJson("ingredients.json"), convenienceItems: convenienceData, taiwanItems: taiwanData,
    archetypes: readJson("dish_archetypes.json"), foodTree: readJson("food_tree.json") }));
  checkSavedMealsDb(M.catalog.buildCatalog({ ingredients: readJson("ingredients.json"), convenienceItems: convenienceData, taiwanItems: taiwanData,
    archetypes: readJson("dish_archetypes.json"), foodTree: readJson("food_tree.json") }));

  // ---------- 13. 常吃（工作線 D 切片 5，計畫 docs/review/2026-10-01-D5-實作計畫.md） ----------
  console.log("[常吃]");
  await checkFavorites(M.catalog.buildCatalog({ ingredients: readJson("ingredients.json"), convenienceItems: convenienceData, taiwanItems: taiwanData,
    archetypes: readJson("dish_archetypes.json"), foodTree: readJson("food_tree.json") }));

  // ---------- 14. 我的食材與單品克數記法（工作線 D 切片 8b，計畫 docs/review/2026-10-02-D8b-實作計畫.md） ----------
  console.log("[我的食材與克數記法]");
  checkMyIngredients(M.catalog.buildCatalog({ ingredients: readJson("ingredients.json"), convenienceItems: convenienceData, taiwanItems: taiwanData,
    archetypes: readJson("dish_archetypes.json"), foodTree: readJson("food_tree.json") }));

  console.log("\n" + (failures === 0 ? "全部通過" : failures + " 項失敗") + "（共 " + checks + " 項檢查）");
  process.exit(failures === 0 ? 0 : 1);
}

function checkMyIngredients(catalog) {
  const mc = M.mc, pk = M.picker, fd = M.foods, mi = M.myIng;
  const errOf = (fn) => { try { fn(); return null; } catch (e) { return String(e.message); } };
  const lookup = M.catalog.normalizeTfdaLookup(readJson("tfda_lookup.json"));
  const b = catalog.foodTree.byId;
  const T0 = "2026-10-02T00:00:00.000Z";
  const tfdaRec = (tfda, extra) => Object.assign({ id: "cing_" + tfda.toLowerCase(), source: "tfda", tfda_id: tfda, tfda_version: "2025-update1", name: lookup.byId[tfda].name,
    default_amount: null, note: null, created_at: T0, updated_at: T0 }, extra || {});
  const userRec = Object.assign({ id: "cing_u_t1", source: "user", name: "某牌豆干", group: "protein", drink: false, state: "as_is",
    per_100g: { kcal: 190, protein_g: 17, carb_g: 5, fat_g: 11, fiber_g: null, sat_fat_g: null, sodium_mg: 600 },
    default_amount: 40, allergen_tags: null, vegan: false, lacto_ovo: false, note: null, archived: false, created_at: T0, updated_at: T0 });

  // 1. 查詢檔正規化與 ingredientItem
  check(lookup.items.length === 2213 && lookup.byId.K0112102 && lookup.items.filter((x) => x.listed).length === 1887, "查詢檔 2213 筆、listed 1887");
  const egg = mi.ingredientItem(tfdaRec("K0112102"), lookup);
  check(egg && egg.uid === "cing_k0112102" && egg.id === egg.uid && egg.origin === "tfda" && egg.serving.amount === null && egg.serving.unit === "g" &&
    egg.per_serving === null && egg.per_100g === lookup.byId.K0112102.per_100g && egg.allergen_tags.join() === "蛋" && egg.diet_tags.join() === "蛋奶素" &&
    egg.tfda.name === "茶葉蛋(浸泡隔夜)" && mi.isMyIngredient(egg) && fd.isFoodTreeItem(egg), "衛福部茶葉蛋的品項形狀");
  check(mi.ingredientItem(tfdaRec("K0112102"), null) === null && mi.ingredientItem(Object.assign(tfdaRec("K0112102"), { tfda_id: "Z9999999", id: "cing_z9999999" }), lookup) === null,
    "衛福部來源查不到（沒載或下架）回 null");
  const drinkId = lookup.items.find((x) => x.listed && x.drink && x.category === "乳品類").id;
  const milk = mi.ingredientItem(tfdaRec(drinkId, { default_amount: 240 }), lookup);
  check(milk.serving.unit === "ml" && milk.home_drink === true && Math.abs(milk.per_serving.kcal - lookup.byId[drinkId].per_100g.kcal * 2.4) < 1e-9, "液體是 ml、1 份＝每 100 × 2.4（不進位）");
  const tofu = mi.ingredientItem(userRec, null);
  check(tofu.origin === "user" && tofu.allergen_tags.join() === "未確認" && tofu.serving.amount === 40 && tofu.per_serving.kcal === 76 && tofu.per_serving.fiber_g === null,
    "自填：未確認一律陣列、1 份＝每 100 × 0.4、null 照實");
  check(!mi.isMyIngredient(b.chicken_breast) && fd.isFoodTreeItem(b.chicken_breast), "分層品項不是我的食材");

  // 2. 克數記法：快照、名稱、合計（克數＝份數 × 1 份時完全相同）
  const ck = b.chicken_breast;
  const cq = mc.foodComponent(ck, 4), ca = mc.foodComponent(ck, null, 120);
  check(Object.keys(cq).join() === "kind,ref,qty,snapshot" && Object.keys(ca).join() === "kind,ref,amount,snapshot" && ca.amount === 120 && JSON.stringify(ca.snapshot) === JSON.stringify(cq.snapshot),
    "克數記法的元件只換 qty 成 amount，快照相同");
  check(mc.foodLogName(ck, 4) === "雞胸肉 生 120g" && mc.foodLogName(ck, null, 120) === "雞胸肉 生 120g" && mc.foodLogName(ck, null, 95) === "雞胸肉 生 95g", "兩種記法名稱同一格式");
  const tot = (comps) => mc.contentTotals({ meal_type: "delivery", archetype_id: null, method_id: null, components: comps, implicit: null }, catalog);
  let diff = 0;
  catalog.foodTree.items.forEach((it) => [1, 2, 3].forEach((q) => {
    const amt = it.serving.amount * q;
    if (!Number.isInteger(amt)) return;
    if (JSON.stringify(tot([mc.foodComponent(it, q)])) !== JSON.stringify(tot([mc.foodComponent(it, null, amt)]))) diff++;
  }));
  check(diff === 0, "克數＝份數 × 1 份時，兩種記法合計完全相同（不同 " + diff + " 筆）");
  const eggC = mc.foodComponent(egg, null, 55);
  check(eggC.snapshot.amount === 100 && eggC.snapshot.kcal === lookup.byId.K0112102.per_100g.kcal && Math.abs(tot([eggC]).kcal - Math.round(lookup.byId.K0112102.per_100g.kcal * 0.55 * 10) / 10) < 0.051,
    "沒設一份的快照是每 100g，合計乘 amount/100");
  check(mc.foodLogName(egg, null, 55) === "茶葉蛋 55g" || mc.foodLogName(egg, null, 55) === "茶葉蛋(浸泡隔夜) 55g", "衛福部食材的名稱：" + mc.foodLogName(egg, null, 55));
  const d = { kind: "products", meal_type: "delivery", items: [], estimates: [], foods: [{ item: ck, amount: 95 }, { item: b.fx_whole_milk, qty: 1 }] };
  const dc = mc.buildDraftContent(d, {});
  check(dc.components[0].amount === 95 && !("qty" in dc.components[0]) && dc.components[1].qty === 1 && mc.draftLogName(d) === "雞胸肉 生 95g＋全脂奶（自己倒） 240ml",
    "草稿：克數與份數混用、名稱照實際量");

  // 3. 選取：addFood 預設、步進器不動克數、份／克切換
  check(JSON.stringify(pk.addFood([], "chicken_breast", ck).sel) === '[{"uid":"chicken_breast","qty":1}]' &&
    JSON.stringify(pk.addFood([], egg.uid, egg).sel) === '[{"uid":"cing_k0112102","amount":100}]', "addFood：有 1 份的從 1 份開始，沒有的 100");
  const selA = [{ uid: "chicken_breast", amount: 95 }];
  check(JSON.stringify(pk.stepFood(selA, "chicken_breast", 1)) === JSON.stringify(selA), "步進器不動克數記法");
  check(JSON.stringify(pk.toggleFoodMode([{ uid: "chicken_breast", qty: 1.5 }], "chicken_breast", ck)) === '[{"uid":"chicken_breast","amount":45}]' &&
    JSON.stringify(pk.toggleFoodMode(selA, "chicken_breast", ck)) === '[{"uid":"chicken_breast","qty":3}]' &&
    JSON.stringify(pk.toggleFoodMode([{ uid: "chicken_breast", amount: 1 }], "chicken_breast", ck)) === '[{"uid":"chicken_breast","qty":0.5}]' &&
    JSON.stringify(pk.toggleFoodMode([{ uid: "chicken_breast", amount: 3000 }], "chicken_breast", ck)) === '[{"uid":"chicken_breast","qty":12}]',
    "份→克取整數、克→份取最接近的 0.5（0.5–12）");
  check(JSON.stringify(pk.toggleFoodMode([{ uid: egg.uid, amount: 55 }], egg.uid, egg)) === '[{"uid":"cing_k0112102","amount":55}]', "沒有 1 份的不能切成份");
  check(JSON.stringify(pk.setFoodAmount(selA, "chicken_breast", "130")) === '[{"uid":"chicken_breast","amount":130}]' &&
    pk.setFoodAmount(selA, "chicken_breast", 0)[0].amount === 1 && pk.setFoodAmount(selA, "chicken_breast", 99999)[0].amount === 3000 &&
    pk.setFoodAmount(selA, "chicken_breast", "abc")[0].amount === 95 && pk.setFoodAmount(selA, "chicken_breast", 12.6)[0].amount === 13, "克數輸入夾在 1–3000、取整數、不是數字不改");

  // 4. 組合：amount 原樣保存；我的食材的解析（fail-closed、移除、沒設一份、查詢檔沒載）
  const saved = mc.toSavedContent(dc);
  check(JSON.stringify(saved.components) === '[{"kind":"food","ref":"chicken_breast","amount":95},{"kind":"food","ref":"fx_whole_milk","qty":1}]', "toSavedContent：amount 原樣（審核 M3）");
  const withIng = { meal_type: "delivery", archetype_id: null, method_id: null, implicit: null,
    components: [{ kind: "food", ref: "cing_k0112102", amount: 55 }, { kind: "food", ref: "cing_u_t1", qty: 2 }] };
  check(/customIngredients/.test(errOf(() => mc.resolveSavedMeal(withIng, catalog, { hidden: [], customs: [], slot: null, profile: {} })) || ""), "ctx 沒帶我的食材要丟錯（fail-closed，審核 M6）");
  const ctx = { hidden: [], customs: [], slot: null, profile: {}, customIngredients: [tfdaRec("K0112102"), userRec], tfdaLookup: lookup };
  const r1 = mc.resolveSavedMeal(withIng, catalog, ctx);
  check(r1.available.length === 2 && r1.blocked.length === 0 && r1.gone.length === 0, "我的食材的組合解析：兩項都可用");
  const dr = mc.savedMealDraft(r1);
  check(dr.foods[0].amount === 55 && !("qty" in dr.foods[0]) && dr.foods[1].qty === 2 && mc.savedMealDefaultName(withIng, catalog, ctx) === "茶葉蛋(浸泡隔夜)＋某牌豆干",
    "帶入草稿保留 amount；預設名稱含我的食材");
  const r2 = mc.resolveSavedMeal(withIng, catalog, Object.assign({}, ctx, { customIngredients: [userRec] }));
  check(r2.gone.length === 1 && r2.gone[0].ref === "cing_k0112102" && r2.available.length === 1, "衛福部來源被移除 → 已不提供");
  const r3 = mc.resolveSavedMeal(withIng, catalog, Object.assign({}, ctx, { customIngredients: [tfdaRec("K0112102"), Object.assign({}, userRec, { archived: true })] }));
  check(r3.gone.length === 1 && r3.gone[0].name === "某牌豆干", "自填已刪除 → 已不提供（名稱照紀錄）");
  const r4 = mc.resolveSavedMeal(withIng, catalog, Object.assign({}, ctx, { customIngredients: [tfdaRec("K0112102"), Object.assign({}, userRec, { default_amount: null })] }));
  check(r4.blocked.length === 1 && /沒有設一份/.test(r4.blocked[0].reason), "份數記法但沒設一份 → 擋下（審核 M5）");
  const r5 = mc.resolveSavedMeal(withIng, catalog, Object.assign({}, ctx, { tfdaLookup: null }));
  check(r5.blocked.length === 1 && /載入失敗/.test(r5.blocked[0].reason) && r5.gone.length === 0, "查詢檔沒載到 → 擋下「載入失敗」，不當已不提供");
  const r6 = mc.resolveSavedMeal(withIng, catalog, Object.assign({}, ctx, { profile: { allergens: ["蛋"] } }));
  check(r6.blocked.length === 2 && r6.blocked[0].name === "茶葉蛋(浸泡隔夜)" && /含過敏原/.test(r6.blocked[0].reason) && /成分未確認/.test(r6.blocked[1].reason), "我的食材照過敏原擋（自填未確認也擋）：" + JSON.stringify(r6.blocked.map((x) => x.reason)));

  // 5. 我的食物的灰字與位置（審核 N1）
  const vegan = { diet_restriction: "vegan" };
  check(fd.foodsBlockLabel(egg, vegan) === "不符合你的飲食設定" && fd.foodsBlockLabel(Object.assign({}, tofu, { allergen_tags: [] }), vegan) === "飲食限制未確認",
    "衛福部食材說「不符合」、自填說「未確認」");
  check(fd.foodsWhereOf(egg) === "cook" && fd.foodsWhereOf(milk) === "drinks", "我的食材的子分頁：液體在飲品・水果");
  check(!/只擋這一項/.test(fd.dislikedMessage(egg, true)), "dislikedMessage 不把我的食材當分層");

  // 6. 新增食材（8b-2）：搜尋、分類、參考句、自填換算、分組、名稱
  const s1 = mi.tfdaSearch(lookup, "鯖魚", null, ["J0414701"]);
  check(s1.items.length > 5 && s1.items.every((x) => x.row.listed && /鯖魚/.test(x.row.name + x.row.aliases.join())) && s1.items.find((x) => x.row.id === "J0414701").added &&
    !s1.items.find((x) => x.row.id === "J0414808").added, "tfdaSearch：鯖魚只列 listed、已加入的標出來");
  check(mi.tfdaSearch(lookup, "", null, []).items.length === 0 && mi.tfdaSearch(lookup, "雞胸肉", null, []).items.every((x) => x.row.listed), "tfdaSearch：空字串不列、代換表已用的不列");
  const s2 = mi.tfdaSearch(lookup, "", "加工調理食品及其他類", []);
  check(s2.items.length === mi.TFDA_SEARCH_LIMIT && s2.more > 0 && s2.items.every((x) => x.row.category === "加工調理食品及其他類"), "tfdaSearch：分類篩選、上限 100＋還有幾筆");
  const cats = mi.tfdaCategories(lookup);
  check(cats.length === 18 && cats.reduce((n, c) => n + c.count, 0) === 1887, "tfdaCategories：18 類、共 1887 筆");
  const p100 = mi.per100FromServing({ kcal: 76, protein_g: 6.8, carb_g: null, fat_g: "", fiber_g: 0, sat_fat_g: null, sodium_mg: 240 }, 40);
  check(p100.kcal === 190 && p100.protein_g === 17 && p100.carb_g === null && p100.fat_g === null && p100.fiber_g === 0 && p100.sodium_mg === 600, "per100FromServing：每份 40g 換每 100g：" + JSON.stringify(p100));
  check(fd.AMOUNT_HINT_REFS.every((h) => b[h[3]] && !b[h[3]].serving.builtin_meal), "參考句的代表品項都在代換表、不是內建一餐");
  check(fd.defaultAmountHint(lookup.byId.J0414701, catalog.foodTree) === "參考：代換表 1 份「虱目魚」是生重 35g" && fd.defaultAmountHint(lookup.byId.J0414808, catalog.foodTree) === null &&
    fd.defaultAmountHint(lookup.byId.C0500101, catalog.foodTree) === null, "參考句：生魚有、熟魚沒有、歸到全穀雜糧的栗子沒有（N2）");
  const eggHints = lookup.items.filter((x) => x.listed && x.category === "蛋類").map((x) => fd.defaultAmountHint(x, catalog.foodTree));
  check(eggHints.every((h) => h === "參考：代換表 1 份「雞蛋」是生重 55g"), "參考句：蛋類一律用雞蛋 55g");
  const secs = fd.ingredientSections([egg, milk, tofu, mi.ingredientItem(tfdaRec("R0100101"), lookup)]);
  const uids = [].concat(...Object.values(secs.cook)).concat(...secs.other.map((o) => o.items), secs.drinks).map((x) => x.uid);
  check(secs.cook.protein.length === 2 && secs.drinks[0] === milk && secs.other[0].name === "加工調理食品及其他類" && new Set(uids).size === uids.length && uids.length === 4,
    "ingredientSections：大類、其他依衛福部分類、液體在飲品，每個只出現一次（S-c）");
  check(fd.ingredientMeta(egg) === "衛福部 · 每 100g 約 " + Math.round(egg.per_100g.kcal) + " kcal" && fd.ingredientMeta(tofu) === "自填 · 1 份 40g · 約 76 kcal", "ingredientMeta");
  check(/已從我的食材移除「茶葉蛋」/.test(fd.ingredientRemovedMessage("茶葉蛋", 0)) && /2 個組合會顯示已不提供/.test(fd.ingredientRemovedMessage("茶葉蛋", 2)), "移除訊息提組合（S9）");
  const mackerel = mi.ingredientItem(tfdaRec("J0414701"), lookup);
  check(mc.foodLogName(mackerel, null, 150) === "鯖魚(生) 150g" && mc.foodLogName(b.fx_chicken_steak_raw, 4).indexOf("雞排肉（生） 生") === -1, "名稱已寫（生）的不再重複「生」");
  check(lookup.byId.J0414808.state === "cooked" && lookup.byId.K0150201.state === "cooked" && lookup.byId.R0100101.state === "as_is", "新鮮食材品名寫烹調法的算熟（decisions #139）");
}

async function checkFavorites(catalog) {
  const db = M.db, pk = M.picker, fd = M.foods;
  const clone = (x) => JSON.parse(JSON.stringify(x));
  const errOf = (fn) => { try { fn(); return null; } catch (e) { return String(e && e.message); } };
  async function errorOf(fn) { try { await fn(); } catch (e) { return String(e && e.message); } return null; }
  const dis = (key) => ({ type: "item", key: key, label: key });

  // 1. 純函式：加、重複加、移除、不存在的移除；都回新陣列、不改輸入
  const f0 = ["a"];
  const f1 = db.addFavoriteTo(f0, "b");
  check(f1.join() === "a,b" && f0.join() === "a" && f1 !== f0, "addFavoriteTo 加在最後、不改輸入");
  check(db.addFavoriteTo(f1, "a").join() === "a,b" && db.addFavoriteTo(null, "x").join() === "x", "addFavoriteTo 重複不加、沒有清單從空的開始");
  check(db.removeFavoriteFrom(f1, "a").join() === "b" && db.removeFavoriteFrom(f1, "zz").join() === "a,b" && db.removeFavoriteFrom(undefined, "a").length === 0, "removeFavoriteFrom");
  check(db.replaceFavoriteRef(["a", "b", "c"], "b", "custom_1").join() === "a,custom_1,c", "replaceFavoriteRef 位置不變");
  check(db.replaceFavoriteRef(["a", "b"], "x", "y").join() === "a,b" && db.replaceFavoriteRef(["a", "b", "y"], "b", "y").join() === "a,y", "replaceFavoriteRef 沒有舊的不動、新的已在只拿掉舊的");

  // 2. 互斥（PRD 13.5）
  const st = { favorites: ["a"], disliked: [dis("b"), dis("c")] };
  const fav = db.applyFavoriteOp(st, "favorite", "b");
  check(fav.favorites.join() === "a,b" && fav.disliked.map((d) => d.key).join() === "c" && st.disliked.length === 2, "標常吃要移出不吃、不改輸入");
  check(db.applyFavoriteOp(st, "unfavorite", "a").favorites.length === 0 && db.applyFavoriteOp(st, "unfavorite", "a").disliked.length === 2, "取消常吃不碰不吃");
  check(db.applyFavoriteOp(st, "dislike", "a").favorites.length === 0, "標不吃要移出常吃");
  check(/op/.test(errOf(() => db.applyFavoriteOp(st, "x", "a")) || ""), "applyFavoriteOp 不認得的 op 要丟錯");

  // 3. 寫入函式：傳陣列、空字串報錯（C1.5）；setSetting 擋下；驗證器
  check(/陣列/.test(await errorOf(() => db.addFavoriteRef(["a"])) || "") && /陣列/.test(await errorOf(() => db.removeFavoriteRef(["a"])) || ""), "常吃寫入函式傳陣列沒有報錯");
  check(/id/.test(await errorOf(() => db.addFavoriteRef("")) || "") && /id/.test(await errorOf(() => db.removeFavoriteRef("")) || ""), "常吃寫入函式空字串沒有報錯");
  check(/專用函式/.test(await errorOf(() => db.setSetting("favorite_refs", [])) || ""), "setSetting 寫常吃沒有擋下（只能用專用函式）");
  check(db.SETTING_KEY_NAMES.indexOf("favorite_refs") !== -1 && errOf(() => db.validateSetting("favorite_refs", ["conv_bx04", "fx_rice"])) === null, "合法的常吃清單被擋下");
  [["a", "a"], [""], "a", [1], null].forEach((v) => check(errOf(() => db.validateSetting("favorite_refs", v)) !== null, "不合法的常吃清單 " + JSON.stringify(v) + " 沒有擋下"));

  // 4. fake-db（diff-recs 用）：互斥兩個方向、addDislikedIngredient 的寫入紀錄形狀不變（推薦快照錄了它，審核 M1）、複製轉移
  const fdb = await imp("tools/lib/fake-db.mjs");
  globalThis.__fakeDbState = { profile: { disliked_ingredients: [dis("conv_bx04")] }, settings: { favorite_refs: ["fx_rice"] }, customFoods: [], writes: [] };
  const r1 = await fdb.addFavoriteRef("conv_bx04");
  check(r1.favorites.join() === "fx_rice,conv_bx04" && r1.disliked.length === 0 && globalThis.__fakeDbState.profile.disliked_ingredients.length === 0, "fake-db 標常吃要移出不吃");
  await fdb.addDislikedIngredient(dis("fx_rice"));
  const w = globalThis.__fakeDbState.writes.filter((x) => x.op === "addDislikedIngredient");
  check(globalThis.__fakeDbState.settings.favorite_refs.join() === "conv_bx04" && w.length === 1 && Object.keys(w[0]).sort().join() === "disliked,op", "fake-db 標不吃要移出常吃、寫入紀錄只有 op 與 disliked");
  const copied = await fdb.copyBuiltinToCustom(M.mc.copyFromBuiltin(catalog.productsByUid.conv_bx04));
  check(globalThis.__fakeDbState.settings.favorite_refs.join() === copied.id, "fake-db 複製成我的版本時常吃要換成新的我的品項");
  check((await fdb.removeFavoriteRef(copied.id)).length === 0 && (await fdb.getFavoriteRefs()).length === 0, "fake-db 取消常吃");
  globalThis.__fakeDbState = { profile: null, settings: {}, customFoods: [], writes: [] };
  check((await fdb.addFavoriteRef("fx_rice")).disliked === null, "沒有基本資料時標常吃只寫常吃（disliked 回 null）");
  delete globalThis.__fakeDbState;

  // 5. engine：有效常吃扣掉不吃；分組保序；空清單時 rest 跟輸入逐項相同
  const eff = pk.effectiveFavorites(["a", "b", "gone"], [dis("b")]);
  check(eff.a === true && !eff.b && eff.gone === true && Object.keys(pk.effectiveFavorites(null, null)).length === 0, "effectiveFavorites 扣掉不吃");
  const items = catalog.products.filter((p) => p.channel === "convenience").slice(0, 8);
  const none = pk.splitFavorites(items, {});
  check(none.favorites.length === 0 && none.rest.length === items.length && none.rest.every((it, i) => it === items[i]), "沒有常吃時 rest 跟輸入逐項相同");
  const sp = pk.splitFavorites(items, { [items[5].uid]: true, [items[1].uid]: true });
  check(sp.favorites.map((x) => x.uid).join() === [items[1].uid, items[5].uid].join() && sp.rest.length === 6 && sp.rest[1] === items[2], "splitFavorites 兩邊保持原順序");
  const ent = pk.favoriteEntries([items[0], items[1], items[2]], (it) => (it === items[0] ? "擋" : null));
  check(ent.map((e) => e.item.uid).join() === [items[1].uid, items[2].uid, items[0].uid].join() && ent[2].reason === "擋", "favoriteEntries 被擋的在組尾");
  const opts = [{ id: "p1" }, { id: "p2" }, { id: "p3" }, { id: "p4" }];
  const ff = pk.favoritesFirst(opts, { p3: true, p4: true }, (o) => o.id, (o) => o.id !== "p4");
  check(ff.map((o) => o.id).join() === "p3,p1,p2,p4", "favoritesFirst 只提前沒被擋的常吃，被擋的常吃留原位");
  check(pk.favoritesFirst(opts, {}, (o) => o.id, () => true).map((o) => o.id).join() === "p1,p2,p3,p4", "favoritesFirst 沒有常吃時原順序");

  // 6. 訊息與明細文字（decisions #127 ⑥）
  const b = catalog.foodTree.byId;
  check(fd.favoriteMessage(b.fx_rice, true, false) === "已標常吃「白米」，自己選會放在最上面。" && /原本標的不吃已取消/.test(fd.favoriteMessage(b.fx_rice, true, true)), "標常吃的訊息");
  check(fd.favoriteMessage(b.fx_rice, false) === "已取消常吃「白米」。" && fd.favoriteEffectText() === "常吃只影響自己選的排列。", "取消常吃與作用文字");
  check(/原本標的常吃已取消/.test(fd.dislikedMessage(b.fx_rice, true, true)) && !/常吃/.test(fd.dislikedMessage(b.fx_rice, true, false)), "標不吃時原本是常吃要補一句");

  // 7. 備份 v4：v3 升上來沒有這個 key 也合法；重複擋下；兩邊都有照樣還原、engine 以不吃為準（審核 S8）
  const v3 = JSON.parse(fs.readFileSync(path.join(ROOT, "tools", "fixtures", "backup-v3.json"), "utf8"));
  const up = db.migrateBackup(v3);
  check(up.schema_version === db.BACKUP_SCHEMA_VERSION && db.validateBackup(up).length === 0 && !up.sections.system.settings.some((x) => x.id === "favorite_refs"), "v3 升到 v4 不需要常吃 key");
  const withFav = clone(up);
  withFav.sections.system.settings.push({ id: "favorite_refs", value: ["fx_rice", "conv_bx04"] });
  withFav.manifest.settings = withFav.sections.system.settings.length;
  check(db.validateBackup(withFav).length === 0, "含常吃的 v4 備份不能還原：" + db.validateBackup(withFav).slice(0, 2).join("；"));
  const dupFav = clone(withFav);
  dupFav.sections.system.settings.find((x) => x.id === "favorite_refs").value.push("fx_rice");
  check(db.validateBackup(dupFav).some((x) => /favorite_refs/.test(x)), "備份裡的常吃清單重複沒有擋下");
  const both = clone(withFav);
  both.sections.system.user_profile.disliked_ingredients = [{ type: "food_tree", key: "fx_rice", label: "白米" }];
  check(db.validateBackup(both).length === 0, "常吃與不吃兩邊都有的備份要能還原（匯入不改寫）");
  const effBoth = pk.effectiveFavorites(both.sections.system.settings.find((x) => x.id === "favorite_refs").value, both.sections.system.user_profile.disliked_ingredients);
  check(!effBoth.fx_rice && effBoth.conv_bx04, "兩邊都有時 engine 以不吃為準");
  // 凍結的 v4 fixture（smoke 真的匯出：常吃有白米與複製後轉移的我的品項；審核 S8：兩邊都有的不放進 fixture，上面自己加）
  const fixtureV4 = JSON.parse(fs.readFileSync(path.join(ROOT, "tools", "fixtures", "backup-v4.json"), "utf8"));
  const v4fav = fixtureV4.sections.system.settings.find((x) => x.id === "favorite_refs");
  check(fixtureV4.schema_version === 4 && db.validateBackup(db.migrateBackup(fixtureV4)).length === 0, "凍結的 backup-v4.json 不能還原：" + db.validateBackup(db.migrateBackup(fixtureV4)).slice(0, 2).join("；"));
  check(!!v4fav && v4fav.value.indexOf("fx_rice") !== -1 && v4fav.value.some((u) => fixtureV4.sections.custom_foods.some((r) => r.id === u && r.copied_from === "conv_bx02")) &&
    v4fav.value.indexOf("conv_bx02") === -1, "backup-v4.json 缺常吃白米或複製後轉移的我的品項");
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
  // 工作線 D 切片 4（審核 S13）：不吃清單有分層 type 與已下架的 fx_ key，備份照樣能還原（驗證只看 key）
  const treeDisliked = clone(fixtureV2);
  treeDisliked.sections.system.user_profile.disliked_ingredients = [{ type: "food_tree", key: "fx_whole_milk", label: "全脂奶（自己倒）" }, { type: "food_tree", key: "fx_dried_fish", label: "魚脯" }];
  check(problemsOf(treeDisliked).length === 0, "不吃清單有 food_tree type 與已下架 fx_ key 的備份不能還原");
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
  bad("不認得的區塊", (f) => { f.sections.unknown_block = []; }, /不認得的資料區塊「unknown_block」/);
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

// 工作線 D 切片 4：我的食物的分層（計畫 docs/review/2026-09-30-D4-實作計畫.md 第 4 節；decisions #114–#117）
function checkFoodTreeViews(catalog, rawTree) {
  const fd = M.foods;
  const ft = catalog.foodTree, b = ft.byId;
  // 1. 位置與分組
  check(ft.items.every((it) => fd.isFoodTreeItem(it)) && catalog.products.every((p) => !fd.isFoodTreeItem(p)), "isFoodTreeItem 要只認分層品項");
  const oldWhere = (item) => (item.role === "drink" ? "drinks" : item.is_taiwan || item.channel === "delivery" ? "delivery" : "convenience");
  check(catalog.products.every((p) => fd.foodsWhereOf(p) === oldWhere(p)), "foodsWhereOf 對現成品項要跟切片 2 的 foodsSubtabOf 相同");
  check(["soy_milk", "fx_whole_milk", "fx_irwin_mango"].every((id) => fd.foodsWhereOf(b[id]) === "drinks"), "無糖豆漿、全脂奶、水果要在飲品・水果");
  check(["fx_cheese_slice", "fx_evaporated_milk", "chicken_breast"].every((id) => fd.foodsWhereOf(b[id]) === "cook"), "起司片、蒸發奶、雞胸要在自煮");
  const cook = fd.foodTreeSections(ft, "cook"), drinks = fd.foodTreeSections(ft, "drinks");
  const listed = [];
  cook.forEach((g) => g.subgroups.forEach((s) => s.items.forEach((it) => listed.push(it.id))));
  const cookCount = listed.length;
  drinks.homeDrinks.forEach((it) => listed.push(it.id));
  drinks.fruit.subgroups.forEach((s) => s.items.forEach((it) => listed.push(it.id)));
  check(listed.length === ft.items.length && new Set(listed).size === ft.items.length, "自煮＋飲品・水果要恰好涵蓋全部分層品項一次（" + listed.length + "／" + ft.items.length + "）");
  check(cookCount === ft.items.filter((it) => it.group !== "fruit" && !it.home_drink).length, "自煮的筆數不對");
  check(drinks.homeDrinks.every((it) => it.home_drink) && drinks.homeDrinks.length === ft.items.filter((it) => it.home_drink).length, "家裡的飲品只看 home_drink");
  check(drinks.fruit.subgroups.every((s) => s.items.every((it) => it.group === "fruit")) && cook.every((g) => g.code !== "fruit"), "水果只在飲品・水果");
  const order = rawTree.groups.map((g) => g.code).filter((c) => c !== "fruit");
  check(cook.map((g) => g.code).join() === order.filter((c) => cook.some((g) => g.code === c)).join(), "自煮大類順序要照 groups");
  cook.concat([drinks.fruit]).forEach((g) => {
    const def = rawTree.groups.find((x) => x.code === g.code);
    const subOrder = (def.subgroups.length ? def.subgroups.map((s) => s.code) : [null]);
    check(g.subgroups.map((s) => s.code).join() === subOrder.filter((c) => g.subgroups.some((s) => s.code === c)).join(), g.code + " 子類順序要照 groups");
    g.subgroups.forEach((s) => {
      check(s.items.length > 0, g.code + "/" + s.code + " 空子類不該回");
      check(s.items.slice().sort(fd.compareFoodTreeItems).map((x) => x.id).join() === s.items.map((x) => x.id).join(), g.code + "/" + s.code + " 組內要依名稱（collator）、同名依 id 排");
    });
  });
  check(cook.find((g) => g.code === "dairy").subgroups.length === 1 && cook.find((g) => g.code === "dairy").subgroups[0].code === null, "乳品類沒有子類（一個 code null）");
  const same = [{ id: "z_b", name: "同名" }, { id: "z_a", name: "同名" }];
  check(same.sort(fd.compareFoodTreeItems).map((x) => x.id).join() === "z_a,z_b", "同名依 id 排");
  // 2. 份量、今日建議的一餐、出處、含糖、過敏原摘要
  const sv = (id) => fd.foodTreeServingText(b[id]);
  check(sv("chicken_breast") === "1 份（代換表）＝生重 30g", "雞胸份量要寫生重：" + sv("chicken_breast"));
  check(sv("quinoa") === "內建一餐：乾重 45g（今日建議會依你的熱量調整）", "藜麥（內建一餐）份量：" + sv("quinoa"));
  check(sv("fx_cooked_rice").indexOf("熟重 40g") !== -1, "白飯要寫熟重 40g：" + sv("fx_cooked_rice"));
  const banana = ft.items.find((it) => it.name === "香蕉");
  check(!!banana && fd.foodTreeServingText(banana).indexOf("可食部分 70g") !== -1 && fd.foodTreeServingText(banana).indexOf("購買量約 95g") !== -1, "香蕉要寫可食部分與購買量");
  check(sv("fx_whole_milk") === "1 份（代換表）＝240ml（1杯）", "全脂奶份量：" + sv("fx_whole_milk"));
  check(sv("fx_pork_loin").indexOf("生重 35g，煮熟約 30g") !== -1, "豬大里肌要有生重與煮熟約：" + sv("fx_pork_loin"));
  check(sv("brown_rice_cooked") === "內建一餐：熟重 150g（今日建議會依你的熱量調整）", "糙米飯份量：" + sv("brown_rice_cooked"));
  check(fd.foodTreeServingShort(b.chicken_breast) === "代換表 1 份 · 生重 30g" && fd.foodTreeServingShort(b.brown_rice_cooked) === "內建一餐 · 熟重 150g", "列上的簡寫份量");
  check(fd.builtinMealLine(b.chicken_breast, catalog) === "今日建議的一餐：生重 130g（約 4.5 份代換表）", "雞胸今日建議的一餐：" + fd.builtinMealLine(b.chicken_breast, catalog));
  check(fd.builtinMealLine(b.fx_rice, catalog) === null && fd.builtinMealLine(b.brown_rice_cooked, catalog) === null, "fx_ 與內建一餐不寫今日建議的一餐");
  ft.items.forEach((it) => {
    const t = fd.foodTreeSourceText(it).join("\n");
    if (/TFDA|decisions|×|#\d|填 0/.test(t)) check(false, it.id + " 的出處文字有開發註記：" + t);
  });
  const src = (id) => fd.foodTreeSourceText(b[id]).join("\n");
  check(src("fx_whole_milk").indexOf("L01021") !== -1 && src("fx_whole_milk").indexOf("等值") === -1, "全脂奶出處要有編號、不是等值推算");
  check(src("fx_congee").indexOf("生熟等值推算") !== -1, "白粥要寫生熟等值推算");
  check(src("brown_rice_cooked").indexOf("由生米樣品") !== -1 && src("brown_rice_cooked").indexOf("1 份的量照食物代換表") === -1, "糙米飯要寫由生米推算、不寫代換表份量");
  check(src("greek_yogurt").indexOf("美國農業部") !== -1, "希臘優格出處要寫美國農業部");
  check(src("chicken_breast").indexOf("纖維：衛福部沒有這一欄；動物性食材不含纖維，以 0 計") !== -1, "雞胸要說明纖維以 0 計");
  check(ft.items.filter((it) => it.source.derivation).map((it) => it.id).sort().join() === "brown_rice_cooked,fx_congee,fx_cooked_noodles,fx_fresh_noodles,mixed_grain_rice_cooked", "source.derivation 非 null 的要恰好 5 筆（decisions #116）");
  check(fd.sugarLine(b.fx_dried_guava) === "衛福部樣品：有加糖" && fd.sugarLine(b.fx_raisin) === "衛福部樣品：無加糖" && fd.sugarLine(b.fx_cooked_rice) === null, "sugarLine");
  check(fd.allergenSummary(b.fx_dinner_roll.allergen_tags) === "過敏原：麩質、乳製品、蛋；其他成分未確認", "餐包的過敏原摘要：" + fd.allergenSummary(b.fx_dinner_roll.allergen_tags));
  check(fd.allergenSummary(["未確認"]) === "過敏原：未確認" && fd.allergenSummary([]) === "過敏原：確認不含" && fd.allergenSummary(null) === "過敏原：未確認", "allergenSummary 只有未確認、確認不含、缺欄");
  // 3. 灰字（decisions #117）
  const egg = { allergens: ["蛋"] }, lo = { diet_restriction: "蛋奶素" };
  check(fd.foodsBlockLabel(b.fx_mayonnaise, egg) === "含過敏原" && fd.foodsBlockLabel(b.fx_turnip_cake, egg) === "成分未確認", "過敏原灰字要分含過敏原與成分未確認");
  check(fd.foodsBlockLabel(b.chicken_breast, lo) === "不符合你的飲食設定" && fd.foodsBlockLabel(b.fx_vegetarian_nugget, lo) === "飲食限制未確認", "飲食灰字要分不符合與未確認");
  check(fd.foodsBlockLabel(b.fx_rice, { disliked_ingredients: [{ type: "food_tree", key: "fx_rice", label: "白米" }] }) === "你標了不吃" && fd.foodsBlockLabel(b.fx_rice, {}) === null, "不吃灰字、沒被擋回 null");
  check(fd.foodBlockText(b.fx_mayonnaise, egg) === "你設了過敏原「蛋」，含有它的品項不能選。", "美乃滋（蛋＋未確認）設蛋時明細要寫含有它：" + fd.foodBlockText(b.fx_mayonnaise, egg));
  check(fd.foodBlockText(b.fx_turnip_cake, egg) === "你設了過敏原「蛋」，過敏原未確認的品項不能選。", "蘿蔔糕設蛋時明細要寫未確認");
  check(fd.foodBlockText(b.chicken_breast, lo) === "你設了飲食限制「蛋奶素」，這一項不符合。" && fd.foodBlockText(b.fx_vegetarian_nugget, lo) === "你設了飲食限制「蛋奶素」，沒有宣告符合的品項不能選。", "飲食的明細句子要分不符合與沒有宣告");
  // 4. 同樣本（decisions #85、#108）
  const ss = (uid, dis) => fd.sameSampleEntries(uid, catalog, dis || []);
  check(ss("fx_whole_milk").some((e) => e.uid === "tw_dr08" && e.kind === "sample") && ss("tw_dr08").some((e) => e.uid === "fx_whole_milk" && e.kind === "sample"), "全脂奶與外帶鮮奶要互相配對");
  check(ss("soy_milk").some((e) => e.uid === "tw_dr06") && ss("tw_dr06").some((e) => e.uid === "soy_milk"), "無糖豆漿與外帶豆漿要互相配對");
  check(ss("fx_rice").map((e) => e.uid + ":" + e.kind).join() === "fx_congee:form", "白米的其他形式要只有白粥");
  check(ss("fx_brown_rice").some((e) => e.uid === "brown_rice_cooked"), "糙米要配到糙米飯");
  check(["fx_dried_noodles", "fx_fresh_noodles", "fx_cooked_noodles"].every((id) => ss(id).length === 2), "乾、濕、熟麵條要互相配對");
  check(ss("greek_yogurt").length === 0 && ss("fx_soybean_oil").every((e) => e.uid !== "cooking_oil"), "tfda_id null 不配對；大豆油不配烹調用油");
  check(ss("fx_rice", [{ type: "food_tree", key: "fx_congee", label: "白粥" }])[0].disliked === true, "sameSampleEntries 要標出已標不吃");
  check(ss("conv_bx04").length === 0 && ss("no_such").length === 0, "沒有同樣本回 []");
  // 5. 不吃清單查分層、訊息、搜尋
  const ents = fd.dislikedListEntries([{ type: "food_tree", key: "fx_whole_milk", label: "舊名" }, { type: "food_tree", key: "fx_dried_fish", label: "魚脯" }], catalog);
  check(ents[0].name === b.fx_whole_milk.name && !ents[0].gone && ents[1].gone, "dislikedListEntries 要查得到分層、已下架的 fx_ 是 gone");
  check(fd.dislikedMessage(b.chicken_breast, true).indexOf("推薦與「自己選」都不會再選它") !== -1 && fd.dislikedMessage(b.fx_rice, true).indexOf("不影響推薦裡的其他食物") !== -1, "標不吃訊息要依共用 id／fx_ 分兩種");
  check(fd.dislikedMessage(catalog.productsByUid.tw_dr08, true).indexOf("推薦與「自己選」都不會再選它") !== -1 && fd.dislikedMessage(b.fx_rice, false) === "已取消不吃「白米」。", "現成品項與取消的訊息");
  const hits = fd.searchFoods(ft.items, "水餃皮");
  check(hits.length === 1 && hits[0].id === "fx_dumpling_wrapper" && hits[0].matchedAlias === "水餃皮", "搜尋水餃皮要找到餃子皮並標別名");
  check(fd.searchFoods(ft.items, "餃子皮")[0].matchedAlias === undefined, "名稱命中不標別名");
  const milk = fd.searchFoods(ft.items.concat(catalog.products), "鮮奶").map((e) => e.uid);
  check(milk.indexOf("fx_whole_milk") !== -1 && milk.indexOf("tw_dr08") !== -1, "搜尋鮮奶要有全脂奶與外帶鮮奶");
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

// 工作線 D 切片 7：單品 food 元件的 engine（計畫 docs/review/2026-10-01-D7-實作計畫.md 第 4 節、第 8 節）
function checkSingleFoods(catalog, candidatePool) {
  const mc = M.mc, pk = M.picker, fd = M.foods, cfg = M.config;
  const ft = catalog.foodTree, b = ft.byId;
  const same = (a, x) => JSON.stringify(a) === JSON.stringify(x);
  const NUTR = ["kcal", "protein_g", "carb_g", "fat_g", "fiber_g", "sat_fat_g", "sodium_mg"];
  const latte = catalog.productsByUid["tw_dr05"];
  const ing = (id) => catalog.ingredients.find((x) => x.id === id);
  const arch = (id) => catalog.archetypes.find((a) => a.id === id);
  const F = (id, qty) => ({ item: b[id], qty: qty });

  // 1. 常數與份量
  check(cfg.FOOD_MAX_PER_MEAL === 4 && cfg.FOOD_QTY_MAX === 12 && cfg.FOOD_QTY_STEP === 0.5, "單品常數（4 項、0.5–12）");
  [0.5, 1, 2.5, 12].forEach((q) => check(cfg.isFoodQty(q), "isFoodQty 要接受 " + q));
  [0, 0.25, 12.5, 13, -1, "2", null, undefined, NaN, Infinity].forEach((q) => check(!cfg.isFoodQty(q), "isFoodQty 要拒絕 " + String(q)));

  // 2. foodComponent：333 個分層品項的快照逐欄等於 serving 與 per_serving
  let bad = 0;
  ft.items.forEach((it) => [1, 12].forEach((q) => {
    const c = mc.foodComponent(it, q);
    const s = c.snapshot;
    if (c.kind !== "food" || c.ref !== it.id || c.qty !== q || s.name !== it.name || s.amount !== it.serving.amount || s.unit !== it.serving.unit) bad++;
    if (!NUTR.every((k) => s[k] === (it.per_serving[k] != null ? it.per_serving[k] : null)) || typeof s.kcal !== "number") bad++;
    if (Object.keys(c).sort().join() !== "kind,qty,ref,snapshot" || "partial" in s) bad++;
  }));
  check(ft.items.length > 300 && bad === 0, "foodComponent 的快照要逐欄等於分層品項（不一致 " + bad + " 處）");
  check(ft.items.filter((it) => mc.foodComponent(it, 1).snapshot.unit === "ml").map((it) => it.id).sort().join() ===
    "fx_evaporated_milk,fx_lowfat_milk,fx_skim_milk,fx_whole_milk,soy_milk", "ml 的單品要恰好 5 筆");
  check(mc.foodComponent(b.brown_rice_cooked, 1).snapshot.amount === 150 && mc.foodComponent(b.quinoa, 1).snapshot.amount === 45, "內建一餐的單品 1 份＝內建克數");

  // 3. contentTotals：快照乘 qty、null 傳染、鈉與飽和脂肪 partial
  const cont = (tab, foods, extra) => mc.buildDraftContent(Object.assign(tab === "cook"
    ? { kind: "cook", meal_type: "cook_quick", archetype: null, proteins: [], staple: null, vegetables: [], seasoning: null, method: null, primaryScale: 1 }
    : { kind: "products", meal_type: tab, items: [], estimates: [] }, { foods: foods }, extra || {}), { oilHabit: "normal" });
  const tot = (tab, foods, extra) => mc.contentTotals(cont(tab, foods, extra), catalog);
  const rice = b.fx_cooked_rice;
  const t25 = tot("convenience", [F("fx_cooked_rice", 2.5)]);
  check(NUTR.every((k) => t25[k] === (rice.per_serving[k] == null ? null : Math.round(rice.per_serving[k] * 2.5 * 10) / 10)), "單一單品 qty 2.5 的合計要等於快照 ×2.5");
  const two = tot("delivery", [F("fx_cooked_rice", 4), F("fx_whole_milk", 2)], { drink: latte });
  const sum = (k) => [rice.per_serving[k] * 4, b.fx_whole_milk.per_serving[k] * 2, latte[k]].reduce((s, v) => s + v, 0);
  check(["kcal", "protein_g", "carb_g", "fat_g"].every((k) => Math.abs(two[k] - Math.round(sum(k) * 10) / 10) < 1e-9), "兩個單品＋飲料的合計要等於逐項相加");
  const ham = tot("convenience", [F("fx_ham", 1)]);
  check(ham.fiber_g === null && typeof ham.kcal === "number", "纖維無資料的單品（火腿）讓合計纖維是 null、熱量照算");
  const taroRice = tot("convenience", [F("fx_taro", 1), F("fx_cooked_rice", 1)]);
  check(taroRice.sat_fat_g != null && taroRice.partial.indexOf("sat_fat_g") !== -1, "飽和脂肪缺資料的單品要記進 partial、有資料的部分照加");
  // M1：同一個單品在超商與自煮分頁的合計逐欄相同（隱含成分只跟著食材）
  ["fx_ham", "fx_taro", "fx_cooked_rice", "chicken_breast"].forEach((id) => {
    const a = tot("convenience", [F(id, 1.5)]), c = tot("cook", [F(id, 1.5)]);
    check(same(a, c), id + "：超商與自煮分頁只有單品時合計要相同（" + JSON.stringify(a) + " vs " + JSON.stringify(c) + "）");
  });
  check(tot("cook", [F("fx_cooked_rice", 1)]).partial.length === 0, "只有單品的自煮合計不能多出 partial");

  // 4. buildDraftContent
  ["convenience", "delivery", "cook"].forEach((tab) => {
    const c = cont(tab, [F("fx_cooked_rice", 4)]);
    check(c.meal_type === (tab === "cook" ? "cook_quick" : tab) && c.archetype_id === null && c.method_id === null, tab + "：只有單品時 meal_type 是分頁值、沒有餐型與烹調法");
    check(tab === "cook" ? same(c.implicit, { oil_g: 0, seasoning: null }) : c.implicit === null, tab + "：只有單品時 implicit 不對：" + JSON.stringify(c.implicit));
    check(c.components.length === 1 && c.components[0].kind === "food" && c.components[0].qty === 4, tab + "：只有單品的元件不對");
  });
  const fd2 = cont("delivery", [F("fx_cooked_rice", 1), F("fx_banana", 1.5)], { items: [catalog.productsByUid.tw_bf03], estimates: [{ size: "S" }], drink: latte });
  check(fd2.components.map((c) => c.kind + ":" + (c.ref || c.size)).join() === "product:tw_bf03,estimate:S,food:fx_cooked_rice,food:fx_banana,product:tw_dr05", "元件順序：品項 → 估算 → 單品 → 飲料");
  const stir = arch("protein_stir_fry");
  const full = { kind: "cook", meal_type: "cook_full", archetype: stir, proteins: [ing(stir.protein.allow[0])], staple: ing(stir.staple.allow[0]),
    vegetables: [ing(stir.vegetable.allow[0])], seasoning: null, method: ing("method_stir_fry"), primaryScale: 1.2, drink: latte };
  check(mc.composeProblem(full, { tier: "cook_full" }) === null, "測試前提：快炒完整");
  const plain = mc.buildDraftContent(full, { oilHabit: "normal" });
  const withF = mc.buildDraftContent(Object.assign({}, full, { foods: [F("fx_cooked_rice", 2), F("fx_whole_milk", 1)] }), { oilHabit: "normal" });
  check(withF.implicit.oil_g > 0 && same(withF.implicit, plain.implicit) && withF.archetype_id === stir.id, "完整餐型＋單品：implicit 照餐型（有用油）");
  check(withF.components.map((c) => c.kind).join() === "ingredient,ingredient,ingredient,food,food,product", "完整餐型＋單品的元件順序：食材 → 單品 → 飲料");
  check(same(mc.buildDraftContent(Object.assign({}, full, { foods: [] }), { oilHabit: "normal" }), plain) &&
    same(mc.buildDraftContent(Object.assign({}, full, { foods: undefined }), { oilHabit: "normal" }), plain), "foods 是 [] 或 undefined 時跟沒有這個欄位逐字相同");
  const drinkOnly = cont("cook", [], { drink: latte });
  check(same(drinkOnly.implicit, { oil_g: 0, seasoning: null }) && drinkOnly.archetype_id === null, "自煮只有飲料：implicit 恰好 0 與 null（S3）");
  const halfMethod = cont("cook", [F("fx_cooked_rice", 1)], { archetype: stir, method: ing("method_stir_fry") });
  check(same(halfMethod.implicit, { oil_g: 0, seasoning: null }) && halfMethod.archetype_id === null && halfMethod.method_id === null, "自煮沒有食材時不帶餐型、烹調法與用油");

  // 5. 送出規則
  const R = (role, uid) => ({ role: role, uid: uid || role });
  check(mc.manualSelectionProblem([], "lunch", { foods: 1 }) === null, "只有單品可以送出");
  check(mc.manualSelectionProblem([], "lunch", { foods: 4 }) === null, "4 項單品可以送出");
  check(/4/.test(mc.manualSelectionProblem([], "lunch", { foods: 5 }) || ""), "5 項單品要擋，訊息寫出 4");
  check(mc.manualSelectionProblem([R("main", "a"), R("main", "b"), R("side"), R("drink"), R("snack")], "lunch", { foods: 4 }) === null, "單品不佔角色名額（4 項單品＋2 主餐＋配菜＋飲料＋點心）");
  check(mc.manualSelectionProblem([], "lunch", { foods: 0 }) !== null && mc.manualSelectionProblem([], "lunch") !== null, "什麼都沒選仍然擋");
  check(mc.manualSelectionProblem([R("main", "a"), R("main", "b")], "afternoon_tea", { foods: 1 }) !== null, "有單品時角色上限照擋");
  const cd = (o) => Object.assign({ archetype: null, proteins: [], staple: null, vegetables: [], seasoning: null, method: null, primaryScale: 1 }, o);
  check(mc.composeProblem(cd({ foods: [F("fx_cooked_rice", 1)] })) === null, "自煮沒餐型有單品可以送出");
  check(mc.composeProblem(cd({})) === "請先選餐型" && mc.composeProblem(cd({ foods: [] })) === "請先選餐型", "自煮什麼都沒選：請先選餐型");
  check(mc.composeProblem(cd({ drink: latte })) === null, "自煮只選飲料可以送出（S3，修正 #45）");
  check(mc.composeProblem(cd({ archetype: stir, foods: [F("fx_cooked_rice", 1)] })) === "請選蛋白質", "半套餐型加單品照樣擋");
  const five = ["fx_cooked_rice", "fx_banana", "fx_whole_milk", "fx_ham", "fx_taro"].map((id) => F(id, 1));
  check(/4/.test(mc.composeProblem(cd({ foods: five })) || "") && /4/.test(mc.composeProblem(Object.assign({}, full, { foods: five }), { tier: "cook_full" }) || ""), "自煮 5 項單品要擋");
  check(mc.composeProblem(Object.assign({}, full, { foods: five.slice(0, 4) }), { tier: "cook_full" }) === null, "完整餐型＋4 項單品可以送出");

  // 6. 記錄名稱
  const nm = (d) => mc.draftLogName(d);
  check(nm({ kind: "cook", archetype: null, proteins: [], staple: null, vegetables: [], seasoning: null, foods: [F("fx_cooked_rice", 4)] }) === "白飯 160g", "只有單品（自煮、沒有餐型）的名稱");
  check(nm({ kind: "products", items: [], estimates: [], foods: [F("fx_whole_milk", 2), F("fx_cooked_rice", 4)] }) === "全脂奶（自己倒） 480ml＋白飯 160g", "單品名稱照點選順序");
  check(nm({ kind: "products", items: [], estimates: [], foods: [F("chicken_breast", 4)], drink: latte }) === "雞胸肉 生 120g＋" + latte.name, "單品＋飲料：生的加「生」");
  check(mc.foodLogName(b.quinoa, 1) === "藜麥 乾 45g" && mc.foodLogName(b.fx_orange, 4) === "柳丁 520g" && mc.foodLogName(b.fx_whole_milk_powder, 1) === "全脂奶粉 30g", "名稱的狀態詞：乾加「乾」、可食部分的水果不加、as_is 不加");
  check(mc.foodLogName(b.fx_soybean_oil, 0.5) === "大豆油 2.5g", "名稱的量進位到 0.1");
  const fullName = nm(Object.assign({}, full, { foods: [F("fx_cooked_rice", 2)] }));
  check(fullName === [stir.name].concat(mc.draftIngredients(full).map((x) => x.name), ["白飯 80g", latte.name]).join("＋"), "自煮完整＋單品的名稱順序：" + fullName);
  check(nm({ kind: "products", items: [], estimates: [{ name: "喜宴", size: "L" }], foods: [F("fx_banana", 1)] }) === "喜宴＋香蕉 70g", "估算在單品前面");

  // 7. picker.js 選取
  let s = [];
  s = pk.addFood(s, "a").sel; s = pk.addFood(s, "b").sel;
  const again = pk.addFood(s, "a");
  check(again.existed && again.sel === s && again.problem === null, "addFood 再點已選的不新增、回 existed");
  s = pk.addFood(pk.addFood(s, "c").sel, "d").sel;
  const fifth = pk.addFood(s, "e");
  check(fifth.problem === mc.foodLimitProblem(5) && fifth.sel.length === 4 && !fifth.existed, "addFood 第 5 項回原因");
  check(s.map((f) => f.uid + f.qty).join() === "a1,b1,c1,d1", "addFood 照點選順序、份量 1");
  let t = s;
  for (let i = 0; i < 30; i++) t = pk.stepFood(t, "b", 1);
  check(t.find((f) => f.uid === "b").qty === 12 && s[1].qty === 1, "stepFood ＋ 夾在 12、不改輸入");
  for (let i = 0; i < 40; i++) t = pk.stepFood(t, "b", -1);
  check(t.find((f) => f.uid === "b").qty === 0.5 && t.length === 4, "stepFood － 停在 0.5、不會變成 0 或移除");
  check(pk.removeFood(t, "b").map((f) => f.uid).join() === "a,c,d" && pk.removeFood(null, "x").length === 0, "removeFood 保留其他項順序");

  // 8. 步進器旁的份量文字（計畫 8.2 M2–M3、8.6；測資 collab/proofs/2026-10-01-d7-serving-text-cases.md）
  const qt = (id, q) => fd.foodQtyText(b[id], q);
  [["fx_cooked_rice", 4, "4 份＝熟重 160g（1碗）"], ["fx_cooked_rice", 1, "1 份＝熟重 40g（1/4碗）"], ["fx_rice", 3, "3 份＝生重 60g（3/8杯(米杯)）"],
    ["fx_whole_milk", 2, "2 份＝480ml（2杯）"], ["fx_evaporated_milk", 3, "3 份＝360ml（1 1/2 杯）"], ["fx_banana", 2, "2 份＝可食部分 140g（購買量約 190g）"],
    ["fx_banana", 1, "1 份＝可食部分 70g（大的 1/2 根或小的 1 根，購買量約 95g）"], ["brown_rice_cooked", 1, "1 份＝內建一餐 熟重 150g"],
    ["brown_rice_cooked", 2, "2 份＝熟重 300g（1 份是內建一餐 熟重 150g）"], ["quinoa", 1, "1 份＝內建一餐 乾重 45g"],
    ["fx_orange", 4, "4 份＝可食部分 520g（4個，購買量約 680g）"], ["fx_oyster", 4, "4 份＝生重 260g（煮熟約 140g）"], ["fx_soybean_oil", 0.5, "0.5 份＝2.5g（1/2茶匙）"],
  ].forEach((x) => check(qt(x[0], x[1]) === x[2], "foodQtyText " + x[0] + " ×" + x[1] + "：「" + qt(x[0], x[1]) + "」應為「" + x[2] + "」"));
  // 家用量乘法（審核 M3 列的反例與 8.6 的界線）
  const hh = (h, q) => fd.scaleHousehold(h, q);
  [["1/8杯(米杯)", 0.5, null], ["1/8杯(米杯)", 2.5, null], ["1/8杯(米杯)", 2, "1/4杯(米杯)"], ["1/8杯(米杯)", 12, "1 1/2杯(米杯)"],
    ["1/3杯", 2, "2/3杯"], ["1/3杯", 0.5, null], ["1/10片", 0.5, null], ["1/10片", 2.5, "1/4片"], ["3張", 1.5, null], ["3張", 2, "6張"],
    ["9個", 0.5, null], ["13個", 2.5, null], ["1個", 0.5, "1/2個"], ["1 1/2張", 0.5, "3/4張"], ["2/3根", 2.5, "1 2/3根"], ["2/5個", 2, null],
    ["1/3個(小)", 3, "1個(小)"], ["2.5湯匙", 1.5, "3 3/4湯匙"], ["1/2 盒", 3, "1 1/2 盒"], ["40粒", 0.5, "20粒"],
    ["大的 1/2 根或小的 1 根", 2, null], ["1/2~1/3片", 3, null], ["3-7張", 2, null], ["1 片（25×3.5×0.1 公分）", 1.5, null], ["小1個", 2, null], ["2 湯匙（1/6 個）", 2, null], [null, 2, null],
  ].forEach((x) => check(hh(x[0], x[1]) === x[2], "scaleHousehold「" + x[0] + "」×" + x[1] + "：" + hh(x[0], x[1]) + " 應為 " + x[2]));
  let hhBad = 0;
  ft.items.forEach((it) => [0.5, 1.5, 2, 2.5, 4.5, 12].forEach((q) => {
    const v = hh(it.serving.household, q);
    if (v !== null && /\d\.\d/.test(v)) hhBad++; // 不寫小數
    if (/份＝.*NaN|undefined/.test(fd.foodQtyText(it, q))) hhBad++;
  }));
  check(hhBad === 0, "全部分層品項的份量文字不能有小數家用量、NaN 或 undefined（" + hhBad + " 處）");

  // 9. 硬性過濾：分層品項直接用 passesHardFilters
  const pass = (id, p) => M.filters.passesHardFilters(b[id], p).ok;
  check(!pass("fx_mayonnaise", { allergens: ["蛋"] }), "設蛋過敏要擋美乃滋單品");
  const unv = ft.items.find((it) => it.allergen_tags.indexOf("未確認") !== -1);
  check(unv && !pass(unv.id, { allergens: ["蛋"] }), "設了過敏原要擋標未確認的單品");
  check(!pass("chicken_breast", { diet_restriction: "蛋奶素" }), "蛋奶素要擋雞胸單品");
  check(!pass("chicken_breast", { disliked_ingredients: [{ type: "protein", key: "chicken_breast", label: "雞胸肉" }] }), "標雞胸不吃（protein）要擋共用 id 的雞胸單品");
  check(!pass("fx_rice", { disliked_ingredients: [{ type: "food_tree", key: "fx_rice", label: "白米" }] }) && pass("fx_cooked_rice", { disliked_ingredients: [{ type: "food_tree", key: "fx_rice", label: "白米" }] }), "標白米不吃只擋白米單品");

  // 10. 推薦不讀單品（PRD 13.4 刻意的行為）
  const rec = (logged) => M.recommend.getTodayRecommendation({
    pool: candidatePool, feedbackMap: {}, remainingBudget: { perSlotSuggestion: { breakfast: 400, lunch: 600, dinner: 600 } },
    hardConstraints: { proteinGapToday: 30, fiberGapThisWeek: 10 }, mealPrefs: {}, dietRestriction: "一般", allergens: [], skipSlots: {},
    lowCarb: false, nowMs: Date.parse("2026-10-01T04:00:00Z"), loggedContents: logged,
  });
  const foodOnly = cont("cook", [F("chicken_breast", 4), F("fx_cooked_rice", 4)]);
  check(same(rec([foodOnly]), rec([])) && same(rec([cont("convenience", [F("chicken_breast", 4)])]), rec([])), "今天記了單品（雞胸）時推薦要逐字不變");
}

// 工作線 D 切片 7：daily_log 的 food 元件驗證與備份（計畫第 4 節「db 與備份」、8.3 S7）
function checkSingleFoodsDb(catalog) {
  const mc = M.mc, db = M.db;
  const b = catalog.foodTree.byId;
  const clone = (x) => JSON.parse(JSON.stringify(x));
  const errOf = (entry) => { try { db.validateDailyLog(entry); return null; } catch (e) { return e.message; } };
  const entryOf = (draft, name) => {
    const content = mc.buildDraftContent(draft, { oilHabit: "normal" });
    return mc.buildLogEntry({ date: "2026-10-01", slot: "lunch", source: "manual", name: name || mc.draftLogName(draft), content: content,
      totals: mc.contentTotals(content, catalog), createdAt: "2026-10-01T04:00:00.000Z" });
  };
  const cookBase = { kind: "cook", archetype: null, proteins: [], staple: null, vegetables: [], seasoning: null, method: null, primaryScale: 1 };
  const prodBase = (tab) => ({ kind: "products", meal_type: tab, items: [], estimates: [] });

  // 1. 333 個分層品項 × qty 0.5／1／12 建成紀錄，全部通過驗證
  let bad = 0;
  catalog.foodTree.items.forEach((it) => [0.5, 1, 12].forEach((q) => {
    if (errOf(entryOf(Object.assign(prodBase("convenience"), { foods: [{ item: it, qty: q }] }))) !== null) bad++;
  }));
  check(bad === 0, "每個分層品項建成的單品紀錄都要通過寫入驗證（失敗 " + bad + " 筆）");
  // 三種型態只有單品
  const rice = { item: b.fx_cooked_rice, qty: 4 };
  const ok = {
    convenience: entryOf(Object.assign(prodBase("convenience"), { foods: [rice] })),
    delivery: entryOf(Object.assign(prodBase("delivery"), { foods: [rice, { item: b.fx_banana, qty: 1.5 }] })),
    cook_quick: entryOf(Object.assign({}, cookBase, { meal_type: "cook_quick", foods: [rice] })),
    cook_full: entryOf(Object.assign({}, cookBase, { meal_type: "cook_full", foods: [rice] })),
  };
  Object.keys(ok).forEach((k) => check(errOf(ok[k]) === null, "只有單品的紀錄（" + k + "）被擋下：" + errOf(ok[k])));
  check(errOf(entryOf(Object.assign({}, cookBase, { meal_type: "cook_full", drink: catalog.productsByUid.tw_dr05 }))) === null, "自煮只有飲料的紀錄要通過（S3）");

  // 2. 壞的 food 元件：訊息指到欄位
  const good = ok.convenience;
  const withFood = (patch, snapPatch) => {
    const e = clone(good);
    const c = e.content.components[0];
    Object.assign(c, patch);
    if (snapPatch) Object.keys(snapPatch).forEach((k) => { if (snapPatch[k] === undefined) delete c.snapshot[k]; else c.snapshot[k] = snapPatch[k]; });
    if (patch && "ref" in patch && patch.ref === undefined) delete c.ref;
    if (patch && "snapshot" in patch && patch.snapshot === undefined) delete c.snapshot;
    return e;
  };
  const AT = "content\\.components\\[0\\]";
  const broken = [
    ["沒有 ref", withFood({ ref: undefined }), AT + "\\.ref"],
    ["ref 空字串", withFood({ ref: "" }), AT + "\\.ref"],
    ...[0, 0.25, 12.5, 13, "2", null].map((q) => ["qty " + JSON.stringify(q), withFood({ qty: q }), AT + "\\.qty"]),
    ["沒有 snapshot", withFood({ snapshot: undefined }), AT + "\\.snapshot"],
    ["snapshot 沒有 name", withFood({}, { name: undefined }), AT + "\\.snapshot\\.name"],
    ["snapshot 沒有 kcal", withFood({}, { kcal: undefined }), AT + "\\.snapshot"],
    ["snapshot 沒有 amount", withFood({}, { amount: undefined }), AT + "\\.snapshot\\.amount"],
    ["snapshot amount 0", withFood({}, { amount: 0 }), AT + "\\.snapshot\\.amount"],
    ["snapshot 沒有 unit", withFood({}, { unit: undefined }), AT + "\\.snapshot\\.unit"],
    ["snapshot unit oz", withFood({}, { unit: "oz" }), AT + "\\.snapshot\\.unit"],
    ["snapshot 營養欄位是字串", withFood({}, { protein_g: "3" }), AT + "\\.snapshot\\.protein_g"],
    ["snapshot 少了纖維欄位（要寫 null）", withFood({}, { fiber_g: undefined }), AT + "\\.snapshot\\.fiber_g"],
    ["snapshot 少了鈉欄位", withFood({}, { sodium_mg: undefined }), AT + "\\.snapshot\\.sodium_mg"],
    ["snapshot partial 不是陣列", withFood({}, { partial: "sat_fat_g" }), AT + "\\.snapshot\\.partial"],
  ];
  broken.forEach((x) => check(new RegExp(x[2]).test(errOf(x[1]) || ""), "單品元件 " + x[0] + " 沒有被擋下或訊息不對：" + errOf(x[1])));
  check(errOf(withFood({}, { partial: ["sat_fat_g"] })) === null && errOf(withFood({}, { fiber_g: null })) === null, "snapshot 的 partial 陣列、營養欄位 null 要接受");

  // 3. 自煮沒有食材：餐型、烹調法是 null，implicit 恰好 0 與 null（decisions #123）
  const cookPatch = (patch) => { const e = clone(ok.cook_quick); Object.assign(e.content, patch); return e; };
  [["用油 5", { implicit: { oil_g: 5, seasoning: null } }], ["調味 light", { implicit: { oil_g: 0, seasoning: "light" } }],
    ["有餐型", { archetype_id: "protein_stir_fry" }], ["有烹調法", { method_id: "method_stir_fry" }],
    ["implicit 多一個欄位", { implicit: { oil_g: 0, seasoning: null, x: 1 } }], ["implicit 是 null", { implicit: null }],
  ].forEach((x) => check(/content\.(implicit|archetype_id)/.test(errOf(cookPatch(x[1])) || ""), "自煮沒有食材但" + x[0] + "要擋下：" + errOf(cookPatch(x[1]))));
  check(errOf(cookPatch({})) === null, "自煮沒有食材、implicit 恰好 0 與 null 要通過");
  const conv = clone(good);
  conv.content.implicit = { oil_g: 0, seasoning: null };
  check(/content\.implicit/.test(errOf(conv) || ""), "超商只有單品帶 implicit 要擋下");

  // 4. 備份：v2 加一筆單品紀錄照樣能還原，不升版（Q2）
  const fixtureV2 = JSON.parse(fs.readFileSync(path.join(ROOT, "tools", "fixtures", "backup-v2.json"), "utf8"));
  const withLog = (log) => {
    const f = clone(fixtureV2);
    const logs = f.sections.logs.daily_log;
    logs.push(Object.assign(clone(log), { id: "log_slice7_" + logs.length }));
    f.manifest.daily_log = logs.length;
    return f;
  };
  const fv = withLog(ok.cook_full);
  check(db.validateBackup(db.migrateBackup(fv)).length === 0, "v2 備份加一筆單品紀錄不能還原：" + db.validateBackup(db.migrateBackup(fv)).slice(0, 2).join("；"));
  // 單品本身不升版；v2→v3（工作線 C）只多了空的 saved_meals 區塊與版本號
  const mfv = db.migrateBackup(fv);
  const strip = clone(mfv);
  delete strip.sections.saved_meals; delete strip.manifest.saved_meals; delete strip.sections.custom_ingredients; delete strip.manifest.custom_ingredients; delete strip.sections.meal_plan; delete strip.manifest.meal_plan; strip.schema_version = fv.schema_version;
  check(JSON.stringify(strip) === JSON.stringify(fv) && mfv.sections.saved_meals.length === 0 && mfv.manifest.saved_meals === 0, "v2 升級後除了空的 saved_meals 與版本號，其他（含單品紀錄）要原樣");
  check(db.summarizeBackup(fv).daily_log.count === db.summarizeBackup(fixtureV2).daily_log.count + 1, "summarizeBackup 單品紀錄的筆數");
  const badQty = clone(ok.convenience);
  badQty.content.components[0].qty = 13;
  const n = fixtureV2.sections.logs.daily_log.length + 1;
  check(db.validateBackup(db.migrateBackup(withLog(badQty))).some((x) => new RegExp("飲食紀錄第 " + n + " 筆.*qty").test(x)), "單品 qty 13 的備份要擋下並指出第 " + n + " 筆");
}

// 工作線 C：我的組合的 engine（計畫 docs/review/2026-10-01-C-實作計畫.md 第 4 節、第 8 節）
function checkSavedMeals(catalog) {
  const mc = M.mc, cfg = M.config, flt = M.filters;
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const throwsOf = (fn) => { try { fn(); return null; } catch (e) { return String(e && e.message); } };
  const ing = (id) => catalog.ingredients.find((x) => x.id === id);
  const arch = (id) => catalog.archetypes.find((a) => a.id === id);
  const P = catalog.products;
  const tree = catalog.foodTree.byId;
  const byRole = (role, ok) => P.filter((p) => p.role === role && (!ok || ok(p)));
  const clean = (p) => (p.allergen_tags || []).indexOf("未確認") === -1;
  const mains = byRole("main").slice(0, 3); // profile 沒設過敏原，未確認的照樣可用
  const drink = catalog.productsByUid.tw_dr05;
  const ctx0 = { hidden: [], customs: [], slot: null, profile: {} };

  // 1. 主餐上限：null＝沒有時段（2）；undefined 照舊（1）
  check(cfg.manualRoleMax("main", null) === 2 && cfg.manualRoleMax("main", undefined) === 1 && cfg.manualRoleMax("side", null) === 1, "manualRoleMax 的 null／undefined");
  check(mc.manualSelectionProblem(mains.slice(0, 2), null) === null && /最多選 2 個/.test(mc.manualSelectionProblem(mains, null) || ""), "沒有時段時主餐上限 2");

  // 2. 單一食材的硬性過濾（從 cook-tab 搬來）：不吃食材比得中 id
  const breast = ing("chicken_breast");
  check(!flt.ingredientFilterResult(breast, "protein", { disliked_ingredients: [{ type: "protein", key: "chicken_breast", label: "雞胸" }] }).ok, "ingredientFilterResult 標雞胸不吃要擋");
  check(flt.ingredientFilterResult(breast, "protein", {}).ok && flt.passesHardFilters(breast, { disliked_ingredients: [{ type: "protein", key: "chicken_breast", label: "雞胸" }] }).ok === true, "ingredientFilterResult 沒設定要通過（直接丟食材進 passesHardFilters 比不中不吃，所以要包裝）");

  // 3. toSavedContent
  const prodDraft = { kind: "products", meal_type: "convenience", items: mains.slice(0, 2), estimates: [], drink: drink, qtyByUid: { [mains[0].uid]: 2 },
    foods: [{ item: tree.fx_cooked_rice, qty: 4 }] };
  const prodContent = mc.buildDraftContent(prodDraft, { oilHabit: "normal" });
  const before = JSON.stringify(prodContent);
  const sp = mc.toSavedContent(prodContent, { keepImplicit: false });
  check(JSON.stringify(prodContent) === before, "toSavedContent 改到了輸入");
  check(same(sp, { meal_type: "convenience", archetype_id: null, method_id: null, components: [
    { kind: "product", ref: mains[0].uid, qty: 2 }, { kind: "product", ref: mains[1].uid, qty: 1 }, { kind: "food", ref: "fx_cooked_rice", qty: 4 },
    { kind: "product", ref: "tw_dr05", qty: 1 }], implicit: null }), "toSavedContent 商品＋單品＋飲料：" + JSON.stringify(sp));
  const stir = arch("protein_stir_fry");
  const cookDraft = { kind: "cook", meal_type: "cook_full", archetype: stir, proteins: [ing(stir.protein.allow[0])], staple: ing(stir.staple.allow[0]),
    vegetables: [ing(stir.vegetable.allow[0])], seasoning: null, method: ing("method_stir_fry"), primaryScale: 1.3, implicitOverride: { oil_g: 10 },
    drink: drink, foods: [{ item: tree.fx_whole_milk, qty: 2 }] };
  const cookContent = mc.buildDraftContent(cookDraft, { oilHabit: "normal" });
  const sc = mc.toSavedContent(cookContent, { keepImplicit: true });
  check(sc.archetype_id === stir.id && sc.method_id === "method_stir_fry" && same(sc.implicit, cookContent.implicit) && sc.implicit.oil_g === 10, "toSavedContent keepImplicit 保留用油與餐型");
  check(sc.components.every((c) => !("scale" in c) && !("snapshot" in c) && !("role" in c)) && sc.components.filter((c) => c.is_primary === true).length === 1 &&
    sc.components.every((c) => Object.keys(c).every((k) => c[k] !== undefined)), "toSavedContent 不留縮放、快照、角色，沒有 undefined 鍵");
  check(mc.toSavedContent(cookContent, { keepImplicit: false }).implicit === null && mc.toSavedContent(cookContent).implicit === null, "toSavedContent keepImplicit false／缺 → implicit null");
  check(/estimate/.test(throwsOf(() => mc.toSavedContent(mc.buildDraftContent({ kind: "products", meal_type: "delivery", items: [], estimates: [{ size: "S" }] }), { keepImplicit: false })) || ""), "toSavedContent 含估算要丟錯");

  // 4. remapSavedRefs（規則 1–2）
  const hiddenP = mains[0];
  const copy = { uid: "custom_copy", name: "我的版本", role: "main", channel: "convenience", archived: false, copied_from: hiddenP.uid, allergen_tags: [], diet_tags: [], kcal: 400 };
  const archivedOwn = { uid: "custom_old", name: "舊品項", role: "side", channel: "convenience", archived: true, allergen_tags: [], diet_tags: [], kcal: 100 };
  const S = (comps, mt, extra) => Object.assign({ meal_type: mt || "convenience", archetype_id: null, method_id: null, components: comps, implicit: null }, extra || {});
  const pc = (ref, qty) => ({ kind: "product", ref: ref, qty: qty || 1 });
  let r = mc.remapSavedRefs(S([pc(hiddenP.uid, 2), pc("nope_x"), pc("custom_old"), { kind: "food", ref: "fx_gone" }, { kind: "ingredient", axis: "protein", ref: "gone_ing" }]), catalog,
    { hidden: [hiddenP.uid], customs: [copy, archivedOwn] });
  check(same(r.content.components, [{ kind: "product", ref: "custom_copy", qty: 2 }]), "remapSavedRefs 隱藏且有複製版本要換成它（份量保留）：" + JSON.stringify(r.content.components));
  check(r.dropped.map((d) => d.ref).join() === "nope_x,custom_old,fx_gone,gone_ing" && r.dropped[1].name === "舊品項", "remapSavedRefs 查不到、已封存、分層下架、食材下架要丟：" + JSON.stringify(r.dropped));
  r = mc.remapSavedRefs(S([pc(hiddenP.uid)]), catalog, { hidden: [hiddenP.uid], customs: [Object.assign({}, copy, { archived: true })] });
  check(r.content.components.length === 0 && r.dropped[0].name === hiddenP.name, "remapSavedRefs 複製版本已封存時要丟，名稱用內建的");

  // 5. resolveSavedMeal（規則 3–6）
  const res = (content, ctx, cat) => mc.resolveSavedMeal({ content: content }, cat || catalog, Object.assign({}, ctx0, ctx));
  const egg = P.find((p) => p.role === "main" && (p.allergen_tags || []).indexOf("蛋") !== -1);
  const cleanMain = byRole("main", clean).find((p) => p.uid !== egg.uid);
  let x = res(S([pc(egg.uid), pc(cleanMain.uid)]), { profile: { allergens: ["蛋"] } });
  check(x.blocked.length === 1 && x.blocked[0].component.ref === egg.uid && x.available.length === 1, "resolveSavedMeal 過敏原要擋該元件");
  const cookSaved = mc.toSavedContent(cookContent, { keepImplicit: false });
  x = res(cookSaved, { profile: { disliked_ingredients: [{ type: "protein", key: cookDraft.proteins[0].id, label: "x" }] } });
  check(x.blocked.length === 1 && x.blocked[0].component.ref === cookDraft.proteins[0].id && /不吃/.test(x.blocked[0].reason), "resolveSavedMeal 不吃的食材要擋：" + JSON.stringify(x.blocked));
  x = res(Object.assign({}, cookSaved, { archetype_id: "gone_arch" }));
  check(x.archetype === null && x.blocked.filter((b) => b.reason === "這個餐型已不提供").length === 3 && x.available.length === 2, "骨架已刪除：自煮元件全被擋、飲料與單品照樣可用");
  const notAllowed = catalog.proteins.find((p) => stir.protein.allow.indexOf(p.id) === -1);
  x = res(S([{ kind: "ingredient", axis: "protein", ref: notAllowed.id }].concat(cookSaved.components), "cook_full", { archetype_id: stir.id, method_id: "method_stir_fry" }));
  check(x.blocked.length === 1 && x.blocked[0].reason === "這個餐型目前不提供這個食材", "食材不在 allow 要擋");
  const p3 = stir.protein.allow.slice(0, 3).map((id) => ({ kind: "ingredient", axis: "protein", ref: id }));
  x = res(S(p3, "cook_full", { archetype_id: stir.id, method_id: "method_stir_fry" }));
  check(stir.protein.allow.length >= 3 && x.blocked.length === 1 && x.blocked[0].component.ref === stir.protein.allow[2] && /最多選 2 個/.test(x.blocked[0].reason), "軸上限依順序擋後者");
  // 免開火：假骨架（真資料的免開火骨架食材都不需加熱）
  const hot = catalog.proteins.find((p) => p.requires_cooking);
  const cold = catalog.proteins.find((p) => !p.requires_cooking);
  const fakeArch = { id: "fake_nocook", name: "假骨架", protein: { allow: [cold.id, hot.id] }, staple: { allow: [] }, vegetable: { allow: [] }, seasoning: { allow: [] },
    methods: ["method_no_cook", "method_pan_fry"], seasoned: false, valid_slots: ["lunch"] };
  const fakeCat = Object.assign({}, catalog, { archetypes: catalog.archetypes.concat([fakeArch]) });
  x = res(S([{ kind: "ingredient", axis: "protein", ref: cold.id }, { kind: "ingredient", axis: "protein", ref: hot.id }], "cook_quick", { archetype_id: "fake_nocook", method_id: "method_no_cook" }), {}, fakeCat);
  check(x.method && x.method.id === "method_no_cook" && x.blocked.length === 1 && x.blocked[0].component.ref === hot.id && x.blocked[0].reason === "免開火不能搭配需要加熱的食材", "免開火擋需要加熱的食材、烹調法保留");
  x = res(Object.assign({}, cookSaved, { method_id: "method_no_cook" }));
  check(x.method === null && x.notes.length === 1 && /烹調法/.test(x.notes[0]) && x.blocked.length === 0, "烹調法不在骨架：method null＋說明，不算被擋");
  // 快煮難度不在解析時擋；valid_slots 不擋
  const red = catalog.proteins.find((p) => stir.protein.allow.indexOf(p.id) !== -1 && !cfg.isQuickTier(cfg.tierRank(p.prep_tier)));
  if (red) {
    x = res(S([{ kind: "ingredient", axis: "protein", ref: red.id }], "cook_quick", { archetype_id: stir.id, method_id: "method_stir_fry" }));
    check(x.blocked.length === 0 && x.available.length === 1, "快煮難度不在解析時擋（Q2）");
  }
  const lunchOnly = P.find((p) => p.role === "main" && p.valid_slots.indexOf("afternoon_tea") === -1);
  x = res(S([pc(lunchOnly.uid)]), { slot: "afternoon_tea" });
  check(x.available.length === 1, "valid_slots 不擋帶入（規則 6）");
  // 角色依順序擋後者；主餐上限依 slot
  const three = S(mains.map((p) => pc(p.uid)).concat([pc("tw_dr05"), pc("tw_dr05")]));
  x = res(three, { slot: null });
  check(x.blocked.map((b) => b.component.ref).join() === mains[2].uid + ",tw_dr05" && x.available.length === 3, "沒有時段：第 3 個主餐、第 2 杯飲料被擋：" + JSON.stringify(x.blocked.map((b) => b.reason)));
  x = res(three, { slot: "afternoon_tea" });
  check(x.blocked.filter((b) => /主餐最多選 1 個/.test(b.reason)).length === 2, "下午茶：第 2、3 個主餐被擋（解析與送出一致）");
  // 單品：第 5 項被擋；只有單品的自煮略過規則 4
  const five = ["fx_cooked_rice", "fx_banana", "fx_whole_milk", "fx_soft_tofu", "fx_skim_milk"].map((id) => ({ kind: "food", ref: id, qty: 1 }));
  x = res(S(five, "cook_quick"));
  check(x.available.length === 4 && x.blocked.length === 1 && x.blocked[0].component.ref === "fx_skim_milk" && x.archetype === null, "第 5 項單品被擋、只有單品的自煮不看餐型");
  x = res(S([pc(mains[0].uid)], "cook_full"));
  check(x.blocked.length === 1 && x.available.length === 0, "自煮組合裡的非飲料商品要擋");

  // 6. savedMealDraft、savedMealTotals、來回
  const rp = res(mc.toSavedContent(prodContent, { keepImplicit: false }), { slot: "lunch" });
  const dp = mc.savedMealDraft(rp);
  check(dp.kind === "products" && dp.items.map((p) => p.uid).join() === mains.slice(0, 2).map((p) => p.uid).join() && dp.drink === drink &&
    same(dp.qtyByUid, { [mains[0].uid]: 2 }) && dp.foods.length === 1 && dp.foods[0].item === tree.fx_cooked_rice && dp.foods[0].qty === 4, "savedMealDraft 商品組合");
  check(same(mc.toSavedContent(mc.buildDraftContent(dp, { oilHabit: "normal" }), { keepImplicit: false }), mc.toSavedContent(prodContent, { keepImplicit: false })), "商品組合來回不變");
  const rc = res(mc.toSavedContent(cookContent, { keepImplicit: true }));
  const dc = mc.savedMealDraft(rc);
  check(dc.kind === "cook" && dc.archetype === stir && catalog.proteins.indexOf(dc.proteins[0]) !== -1 && catalog.staples.indexOf(dc.staple) !== -1 &&
    dc.primaryScale === 1 && same(dc.implicitOverride, cookContent.implicit) && dc.drink === drink && dc.foods[0].qty === 2, "savedMealDraft 自煮組合（同一批食材物件、1 倍、用油覆寫）");
  check(same(mc.toSavedContent(mc.buildDraftContent(dc, { oilHabit: "normal" }), { keepImplicit: true }), mc.toSavedContent(cookContent, { keepImplicit: true })), "自煮組合來回不變");
  const t1 = mc.savedMealTotals(rc, catalog, "normal");
  check(same(t1, mc.contentTotals(mc.buildDraftContent(Object.assign({}, cookDraft, { primaryScale: 1 }), { oilHabit: "normal" }), catalog)), "savedMealTotals＝帶入後 1 倍的合計");
  check(mc.savedMealTotals(res(S([pc("nope_x")])), catalog, "normal").kcal === 0, "全部已不提供時 savedMealTotals 不丟錯（章程 B9）");

  // 7. 名稱與說明
  check(mc.savedMealDefaultName(mc.toSavedContent(prodContent), catalog, ctx0) === [mains[0].name, mains[1].name, "白飯", drink.name].join("＋"), "預設名稱只寫品名、不寫量");
  check(mc.savedMealDefaultName(sc, catalog, ctx0) === [stir.name].concat(mc.draftIngredients(cookDraft).map((i) => i.name), ["全脂奶（自己倒）", drink.name]).join("＋") , "自煮預設名稱：餐型＋食材＋品項（照元件順序）");
  check(mc.savedMealDefaultName(S([pc("nope_x"), pc("custom_copy")]), catalog, { customs: [copy] }) === "我的版本", "預設名稱略過查不到的、認得我的品項");
  x = res(three, { slot: null });
  check(/^有 2 項目前不能用：/.test(mc.savedMealUnavailableLine(x)) && mc.savedMealUnavailableLine(res(S([pc(mains[0].uid)]))) === null, "savedMealUnavailableLine");
  check(mc.savedMealProblem(res(S([pc(mains[0].uid)]))) === null && mc.savedMealProblem(x).length === 2 && mc.savedMealProblem(res(S([pc("nope_x")])))[0] === "沒有可以存的品項。", "savedMealProblem");
  // 8. 存檔前（入口 1、2、編輯共用）：食材全部下架的自煮 → 沒有餐型、烹調法、用油；有被擋的不能存；下架的列在 dropped
  const goneCook = Object.assign({}, cookSaved, { components: [{ kind: "ingredient", axis: "protein", ref: "gone_ing" }, { kind: "food", ref: "fx_cooked_rice", qty: 1 }], implicit: { oil_g: 10, seasoning: null } });
  let fs1 = mc.savedMealForSave(goneCook, catalog, ctx0);
  check(fs1.content.archetype_id === null && fs1.content.method_id === null && fs1.content.implicit === null && fs1.problems === null &&
    fs1.dropped.map((d) => d.ref).join() === "gone_ing", "savedMealForSave：食材全部下架的自煮變成沒有食材的形狀、可以存");
  check(M.db && (() => { try { M.db.validateSavedMeal({ id: "saved_x", name: "x", archived: false, created_at: "2026-10-01T00:00:00.000Z", updated_at: "2026-10-01T00:00:00.000Z", content: fs1.content }); return true; } catch (e) { return false; } })(),
    "savedMealForSave 的結果要通過寫入驗證");
  fs1 = mc.savedMealForSave(S(mains.map((p) => pc(p.uid))), catalog, Object.assign({}, ctx0, { slot: "afternoon_tea" }));
  check(fs1.problems && fs1.problems.length === 1 && /主餐最多選 2 個/.test(fs1.problems[0]), "savedMealForSave 一律用沒有時段（主餐 2）驗證：" + JSON.stringify(fs1.problems));
}

// 工作線 C：saved_meals 的寫入驗證與備份 v3（計畫第 4 節、8.2 M2、M7）
function checkSavedMealsDb(catalog) {
  const mc = M.mc, db = M.db;
  const clone = (x) => JSON.parse(JSON.stringify(x));
  const errOf = (fn) => { try { fn(); return null; } catch (e) { return String(e && e.message); } };
  const tree = catalog.foodTree.byId;
  const main = catalog.products.find((p) => p.role === "main");
  const now = "2026-10-01T04:00:00.000Z";
  const rec = (content, extra) => Object.assign({ id: "saved_t1", name: "測試組合", content: content, archived: false, created_at: now, updated_at: now }, extra || {});
  const prod = mc.toSavedContent(mc.buildDraftContent({ kind: "products", meal_type: "convenience", items: [main], estimates: [], drink: catalog.productsByUid.tw_dr05,
    qtyByUid: { [main.uid]: 2 }, foods: [{ item: tree.fx_cooked_rice, qty: 4 }] }), { keepImplicit: false });
  const stir = catalog.archetypes.find((a) => a.id === "protein_stir_fry");
  const ing = (id) => catalog.ingredients.find((x) => x.id === id);
  const cook = mc.toSavedContent(mc.buildDraftContent({ kind: "cook", meal_type: "cook_full", archetype: stir, proteins: [ing(stir.protein.allow[0])], staple: ing(stir.staple.allow[0]),
    vegetables: [], seasoning: null, method: ing("method_stir_fry"), primaryScale: 1, implicitOverride: { oil_g: 10 } }), { keepImplicit: true });
  const foodsOnly = mc.toSavedContent(mc.buildDraftContent({ kind: "cook", meal_type: "cook_quick", archetype: null, proteins: [], staple: null, vegetables: [], seasoning: null,
    method: null, primaryScale: 1, foods: [{ item: tree.fx_cooked_rice, qty: 1 }] }), { keepImplicit: false });
  [["商品＋單品＋飲料", prod], ["自煮（保留用油）", cook], ["只有單品的自煮", foodsOnly], ["只有單品的自煮 implicit {0,null}", Object.assign({}, foodsOnly, { implicit: { oil_g: 0, seasoning: null } })]]
    .forEach((g) => check(errOf(() => db.validateSavedMeal(rec(g[1]))) === null, "合法的組合（" + g[0] + "）被擋：" + errOf(() => db.validateSavedMeal(rec(g[1])))));
  const withComp = (base, i, patch) => { const c = clone(base); Object.assign(c.components[i], patch); return c; };
  const broken = [
    ["名稱空白", rec(prod, { name: "  " }), /name/],
    ["沒有 id", rec(prod, { id: "" }), /id/],
    ["archived 不是布林", rec(prod, { archived: "false" }), /archived/],
    ["created_at 只有日期以外的字", rec(prod, { created_at: "昨天" }), /created_at/],
    ["沒有元件", rec(Object.assign({}, prod, { components: [] })), /content\.components/],
    ["估算", rec(Object.assign({}, prod, { components: [{ kind: "estimate", name: "喜宴", size: "L" }] })), /kind/],
    ["料理（切片 9 才收）", rec(Object.assign({}, prod, { components: [{ kind: "dish", ref: "dish_x", qty: 1 }] })), /kind/],
    ["商品帶快照", rec(withComp(prod, 0, { snapshot: { kcal: 1 } })), /snapshot/],
    ["商品帶角色", rec(withComp(prod, 0, { role: "main" })), /role/],
    ["商品份量 3", rec(withComp(prod, 0, { qty: 3 })), /qty/],
    ["單品帶快照", rec(withComp(prod, 1, { snapshot: { kcal: 1 } })), /snapshot/],
    ["單品份量 13", rec(withComp(prod, 1, { qty: 13 })), /qty/],
    ["食材帶縮放", rec(withComp(cook, 0, { scale: 1.2 })), /scale/],
    ["食材 is_primary 不是布林", rec(withComp(cook, 0, { is_primary: "yes" })), /is_primary/],
    ["食材 axis 不合法", rec(withComp(cook, 0, { axis: "method" })), /axis/],
    ["沒有 archetype_id 鍵", rec((() => { const c = clone(prod); delete c.archetype_id; return c; })()), /archetype_id/],
    ["超商帶 implicit", rec(Object.assign({}, prod, { implicit: { oil_g: 5, seasoning: null } })), /implicit/],
    ["只有單品的自煮 implicit 有用油", rec(Object.assign({}, foodsOnly, { implicit: { oil_g: 5, seasoning: null } })), /implicit/],
    ["只有單品的自煮帶餐型", rec(Object.assign({}, foodsOnly, { archetype_id: "protein_stir_fry" })), /archetype_id/],
    ["型態不在列舉", rec(Object.assign({}, prod, { meal_type: "cook" })), /meal_type/],
  ];
  broken.forEach((b) => check(b[2].test(errOf(() => db.validateSavedMeal(b[1])) || ""), "組合「" + b[0] + "」沒有擋下或訊息不對：" + errOf(() => db.validateSavedMeal(b[1]))));
  check(/不能傳陣列/.test(errOf(() => db.validateSavedMeal([rec(prod)])) || ""), "validateSavedMeal 傳陣列要擋");
  // applySavedMealPatch：改名、封存、改內容；id、created_at 不能改；自己補 updated_at；不改輸入
  const old = rec(prod);
  const later = "2026-10-02T04:00:00.000Z";
  const renamed = db.applySavedMealPatch(old, { name: "新名字", archived: true }, later);
  check(renamed.name === "新名字" && renamed.archived === true && renamed.updated_at === later && renamed.created_at === now && old.name === "測試組合", "applySavedMealPatch 改名與封存");
  check(/id/.test(errOf(() => db.applySavedMealPatch(old, { id: "saved_x" }, later)) || "") && /created_at/.test(errOf(() => db.applySavedMealPatch(old, { created_at: later }, later)) || ""), "applySavedMealPatch 不能改 id、created_at");
  check(db.applySavedMealPatch(old, { id: old.id, content: cook }, later).content === cook, "applySavedMealPatch 相同的 id 放行、可以改內容");
  check(/content/.test(errOf(() => db.applySavedMealPatch(old, { content: Object.assign({}, prod, { components: [] }) }, later)) || ""), "applySavedMealPatch 壞內容要擋");

  // 備份 v3（切片 5 起目前版本是 v4，v3 的檔案照樣升級後讀得了）
  check(db.BACKUP_SCHEMA_VERSION === 6 && db.BACKUP_SECTIONS.saved_meals.join() === "saved_meals" && db.STORE_NAMES.indexOf("saved_meals") !== -1, "備份 v6 與 saved_meals 區塊");
  ["backup-v1.json", "backup-v2.json"].forEach((f) => {
    const m = db.migrateBackup(JSON.parse(fs.readFileSync(path.join(ROOT, "tools", "fixtures", f), "utf8")));
    check(m.schema_version === db.BACKUP_SCHEMA_VERSION && Array.isArray(m.sections.saved_meals) && m.sections.saved_meals.length === 0 && m.manifest.saved_meals === 0 &&
      db.validateBackup(m).length === 0, f + " 升級後要有空的 saved_meals 並且讀得了");
  });
  const v3 = db.migrateBackup(JSON.parse(fs.readFileSync(path.join(ROOT, "tools", "fixtures", "backup-v2.json"), "utf8")));
  v3.sections.saved_meals = [rec(prod), rec(cook, { id: "saved_t2", archived: true })];
  v3.manifest.saved_meals = 2;
  check(db.validateBackup(v3).length === 0, "含組合的 v3 備份不能還原：" + db.validateBackup(v3).slice(0, 2).join("；"));
  check(db.summarizeBackup(v3).saved_meals.count === 2 && db.summarizeBackup(v3).saved_meals.label === "我的組合", "summarizeBackup 我的組合筆數");
  const bad1 = clone(v3); bad1.sections.saved_meals[1].content.components[0].scale = 2;
  check(db.validateBackup(bad1).some((x) => /我的組合第 2 筆.*scale/.test(x)), "壞的組合要指出「我的組合第 2 筆」");
  const dup = clone(v3); dup.sections.saved_meals[1].id = "saved_t1";
  check(db.validateBackup(dup).some((x) => /我的組合第 2 筆：id 重複/.test(x)), "組合 id 重複要擋");
  // 凍結的 v3 fixture（smoke 真的匯出：含單品的組合、從推薦存的自煮組合、單品紀錄；切片 7 S11）
  const fixtureV3 = JSON.parse(fs.readFileSync(path.join(ROOT, "tools", "fixtures", "backup-v3.json"), "utf8"));
  check(fixtureV3.schema_version === 3 && db.validateBackup(db.migrateBackup(fixtureV3)).length === 0, "凍結的 backup-v3.json 不能還原：" + db.validateBackup(db.migrateBackup(fixtureV3)).slice(0, 2).join("；"));
  const sm = fixtureV3.sections.saved_meals;
  check(sm.some((r) => r.content.components.some((c) => c.kind === "food")) && sm.some((r) => r.content.meal_type.indexOf("cook") === 0 && r.content.archetype_id) &&
    fixtureV3.sections.logs.daily_log.some((l) => l.content.components.some((c) => c.kind === "food")), "backup-v3.json 缺含單品的組合、自煮組合或單品紀錄");
  check(sm.every((r) => mc.resolveSavedMeal(r, catalog, { hidden: [], customs: fixtureV3.sections.custom_foods.map(M.catalog.fromCustomFood), slot: null, profile: {} }).available.length > 0), "v3 fixture 的組合解析後要有可用元件");
  // ---- 切片 8b：我的食材（custom_ingredients）與單品克數記法（decisions #138） ----
  check(db.BACKUP_SECTIONS.custom_ingredients.join() === "custom_ingredients" && db.STORE_NAMES.indexOf("custom_ingredients") !== -1, "備份 v5 有 custom_ingredients 區塊");
  const fixtureV4 = JSON.parse(fs.readFileSync(path.join(ROOT, "tools", "fixtures", "backup-v4.json"), "utf8"));
  const up5 = db.migrateBackup(fixtureV4);
  check(up5.schema_version === db.BACKUP_SCHEMA_VERSION && Array.isArray(up5.sections.custom_ingredients) && up5.sections.custom_ingredients.length === 0 && up5.manifest.custom_ingredients === 0 &&
    db.validateBackup(up5).length === 0, "v4 升到 v5 補空的我的食材並且讀得了");
  const fixtureV5 = JSON.parse(fs.readFileSync(path.join(ROOT, "tools", "fixtures", "backup-v5.json"), "utf8"));
  check(fixtureV5.schema_version === 5 && Array.isArray(fixtureV5.sections.custom_ingredients) && db.validateBackup(db.migrateBackup(fixtureV5)).length === 0,
    "凍結的 backup-v5.json（smoke 真的匯出）要能還原：" + db.validateBackup(db.migrateBackup(fixtureV5)).slice(0, 2).join("；"));
  const T0 = "2026-10-02T00:00:00.000Z";
  const tfdaIng ={ id: "cing_k0112102", source: "tfda", tfda_id: "K0112102", tfda_version: "2025-update1", name: "茶葉蛋", default_amount: null, note: null, created_at: T0, updated_at: T0 };
  const userIng = { id: "cing_u_abc", source: "user", name: "某牌豆干", group: "protein", drink: false, state: "as_is",
    per_100g: { kcal: 190, protein_g: 17, carb_g: 5, fat_g: 11, fiber_g: null, sat_fat_g: null, sodium_mg: 600 },
    default_amount: 40, allergen_tags: null, vegan: false, lacto_ovo: false, note: null, archived: false, created_at: T0, updated_at: T0 };
  check(!errOf(() => db.validateCustomIngredient(tfdaIng)) && !errOf(() => db.validateCustomIngredient(userIng)), "我的食材：合法的衛福部來源與自填要過");
  check(!errOf(() => db.validateCustomIngredient(Object.assign({}, tfdaIng, { id: "cing_a05001", tfda_id: "A05001" }))), "我的食材：6 碼的平均值編號要過");
  check(/id/.test(errOf(() => db.validateCustomIngredient(Object.assign({}, tfdaIng, { id: "cing_abc" }))) || ""), "我的食材：衛福部來源 id 跟整合編號對不上要擋（審核 M9）");
  check(/tfda_id/.test(errOf(() => db.validateCustomIngredient(Object.assign({}, tfdaIng, { tfda_id: "k0112102" }))) || ""), "我的食材：整合編號格式不對要擋");
  check(/allergen_tags/.test(errOf(() => db.validateCustomIngredient(Object.assign({}, tfdaIng, { allergen_tags: [] }))) || ""), "我的食材：衛福部來源不能存過敏原（跟著查詢檔）");
  check(/id/.test(errOf(() => db.validateCustomIngredient(Object.assign({}, userIng, { id: "cing_abc" }))) || ""), "我的食材：自填 id 要 cing_u_ 開頭");
  check(/default_amount/.test(errOf(() => db.validateCustomIngredient(Object.assign({}, userIng, { default_amount: 0 }))) || "") &&
    !errOf(() => db.validateCustomIngredient(Object.assign({}, userIng, { default_amount: null }))), "我的食材：一份 null 可以、0 不行");
  check(/per_100g.kcal/.test(errOf(() => db.validateCustomIngredient(Object.assign({}, userIng, { per_100g: Object.assign({}, userIng.per_100g, { kcal: -1 }) }))) || "") &&
    !errOf(() => db.validateCustomIngredient(Object.assign({}, userIng, { per_100g: Object.assign({}, userIng.per_100g, { kcal: 0 }) }))), "我的食材：自填熱量可以是 0、不能是負的");
  check(/只能改/.test(errOf(() => db.applyCustomIngredientPatch(tfdaIng, { state: "raw" }, T0)) || "") &&
    db.applyCustomIngredientPatch(tfdaIng, { name: "家裡的茶葉蛋", default_amount: 55 }, "2026-10-03T00:00:00.000Z").default_amount === 55, "我的食材：衛福部來源只能改名稱、一份、備註");
  check(/id/.test(errOf(() => db.applyCustomIngredientPatch(userIng, { id: "cing_u_x" }, T0)) || "") &&
    db.applyCustomIngredientPatch(userIng, { archived: true }, T0).archived === true, "我的食材：自填不能改 id、可以刪除（archived）");
  const v5 = clone(up5); v5.sections.custom_ingredients = [tfdaIng, userIng]; v5.manifest.custom_ingredients = 2;
  check(db.validateBackup(v5).length === 0 && db.summarizeBackup(v5).custom_ingredients.label === "我的食材", "含我的食材的 v5 備份要能還原：" + db.validateBackup(v5).slice(0, 2).join("；"));
  const badIng = clone(v5); badIng.sections.custom_ingredients[0].id = "cing_zzz";
  check(db.validateBackup(badIng).some((x) => /我的食材第 1 筆/.test(x)), "壞的我的食材要指出「我的食材第 1 筆」");
  // 單品的 amount：紀錄與組合都是 qty 或 amount 恰好一個（整數 1–3000）
  const foodLog = clone(fixtureV3.sections.logs.daily_log.filter((l) => l.content.components.some((c) => c.kind === "food"))[0]);
  const fi = foodLog.content.components.findIndex((c) => c.kind === "food");
  const withAmount = (v) => { const l = clone(foodLog); delete l.content.components[fi].qty; l.content.components[fi].amount = v; return l; };
  check(!errOf(() => db.validateDailyLog(withAmount(120))), "單品紀錄用 amount 要過：" + errOf(() => db.validateDailyLog(withAmount(120))));
  check([0, 3001, 12.5, "120"].every((v) => /amount/.test(errOf(() => db.validateDailyLog(withAmount(v))) || "")), "單品 amount 要是整數 1–3000");
  const both = clone(foodLog); both.content.components[fi].amount = 100;
  const neither = clone(foodLog); delete neither.content.components[fi].qty;
  check(/qty\/amount/.test(errOf(() => db.validateDailyLog(both)) || "") && /qty\/amount/.test(errOf(() => db.validateDailyLog(neither)) || ""), "單品 qty 與 amount 要恰好一個");
  const smFood = clone(sm.filter((r) => r.content.components.some((c) => c.kind === "food"))[0]);
  const si = smFood.content.components.findIndex((c) => c.kind === "food");
  delete smFood.content.components[si].qty; smFood.content.components[si].amount = 150;
  check(!errOf(() => db.validateSavedMeal(smFood)), "組合的單品可以是 amount：" + errOf(() => db.validateSavedMeal(smFood)));
  smFood.content.components[si].qty = 1;
  check(/qty\/amount/.test(errOf(() => db.validateSavedMeal(smFood)) || ""), "組合的單品 qty 與 amount 不能同時有");
  // ---- 日期切換（decisions #140–#142）：skipped 紀錄、寫入日期、預約、昨天的推薦、備份 v6 ----
  console.log("[日期切換：資料]");
  const zeroT = { kcal: 0, protein_g: 0, carb_g: 0, fat_g: 0, fiber_g: 0, sat_fat_g: 0, sodium_mg: 0, partial: [] };
  const skipLog = { log_date: "2026-10-02", slot: "breakfast", meal_type: null, source: "skipped", name: "這餐沒吃",
    content: { meal_type: null, archetype_id: null, method_id: null, components: [], implicit: null }, totals: clone(zeroT), created_at: T0 };
  check(!errOf(() => db.validateDailyLog(skipLog)), "skipped 紀錄要過：" + errOf(() => db.validateDailyLog(skipLog)));
  const skipBad = (f) => { const l = clone(skipLog); f(l); return errOf(() => db.validateDailyLog(l)) || ""; };
  check(/content/.test(skipBad((l) => { l.content.components = [{ kind: "estimate", name: "x", snapshot: { kcal: 1 } }]; })) &&
    /totals/.test(skipBad((l) => { l.totals.kcal = 100; })) && /totals/.test(skipBad((l) => { l.totals.partial = ["protein_g"]; })) &&
    /meal_type/.test(skipBad((l) => { l.meal_type = "delivery"; })) && /content/.test(skipBad((l) => { l.content.note = "x"; })), "skipped：有元件、熱量不是 0、有型態都要擋");
  check(/meal_type/.test(skipBad((l) => { l.source = "manual"; })) && /content\.components/.test(skipBad((l) => { l.source = "manual"; l.meal_type = "delivery"; l.content.meal_type = "delivery"; })),
    "不是 skipped 的紀錄照舊要有型態與至少 1 個元件");
  check(db.logDateProblem({ log_date: "2026-10-03" }, { today: "2026-10-02" }) && db.logDateProblem({ log_date: "2026-09-24" }, { today: "2026-10-02", minDate: "2026-09-25" }) &&
    db.logDateProblem({ log_date: "2026-09-25" }, { today: "2026-10-02", minDate: "2026-09-25" }) === null && db.logDateProblem({ log_date: "2020-01-01" }) === null,
    "addDailyLog 的日期範圍：不能未來、不早於 minDate，沒給就不檢查");
  check(!errOf(() => db.validateDailyLog(Object.assign(clone(skipLog), { log_date: "2020-01-01" }))), "validateDailyLog 不檢查日期範圍（還原舊備份）");
  const plan = (content, extra) => Object.assign({ id: "2026-10-04|lunch", date: "2026-10-04", slot: "lunch", name: "測試預約", content: content, created_at: T0, updated_at: T0 }, extra || {});
  const estPlan = { meal_type: "delivery", archetype_id: null, method_id: null, implicit: null,
    components: [{ kind: "estimate", name: "喜宴", size: "L", snapshot: { kcal: 1200, protein_g: null, carb_g: null, fat_g: null, fiber_g: null, sat_fat_g: null, sodium_mg: null } }] };
  const skipPlan = { skip: true, meal_type: null, archetype_id: null, method_id: null, implicit: null, components: [] };
  check(!errOf(() => db.validateMealPlan(plan(prod))) && !errOf(() => db.validateMealPlan(plan(cook))) && !errOf(() => db.validateMealPlan(plan(estPlan))) && !errOf(() => db.validateMealPlan(plan(skipPlan))),
    "預約：現成、自煮、估算、預約不吃都要過：" + [prod, cook, estPlan, skipPlan].map((c) => errOf(() => db.validateMealPlan(plan(c)))).filter(Boolean).join("；"));
  const pi = cook.components.findIndex((c) => c.kind === "ingredient" && c.is_primary === true);
  const ni = cook.components.findIndex((c) => c.kind === "ingredient" && c.is_primary !== true);
  const scaled = clone(cook); if (pi >= 0) scaled.components[pi].scale = 1.5;
  const scaledBad = clone(cook); if (ni >= 0) scaledBad.components[ni].scale = 1.5;
  check(pi >= 0 && ni >= 0 && !errOf(() => db.validateMealPlan(plan(scaled))) && /scale/.test(errOf(() => db.validateMealPlan(plan(scaledBad))) || "") &&
    /scale/.test(errOf(() => db.validateSavedMeal(rec(scaled))) || ""), "預約：主要槽位可以存使用者選的 scale（組合照舊不行）");
  check(/kind/.test(errOf(() => db.validateSavedMeal(rec(estPlan))) || "") && /skip|components/.test(errOf(() => db.validateSavedMeal(rec(skipPlan))) || ""), "組合照舊不收估算與預約不吃");
  check(/id/.test(errOf(() => db.validateMealPlan(plan(prod, { id: "2026-10-04|dinner" }))) || "") &&
    /skip/.test(errOf(() => db.validateMealPlan(plan(Object.assign(clone(skipPlan), { components: estPlan.components })))) || "") &&
    /skip/.test(errOf(() => db.validateMealPlan(plan(Object.assign(clone(prod), { skip: false })))) || "") &&
    /size/.test(errOf(() => db.validateMealPlan(plan({ meal_type: "delivery", archetype_id: null, method_id: null, implicit: null, components: [Object.assign(clone(estPlan.components[0]), { size: "XL" })] }))) || ""),
    "預約：id 要等於日期|時段、預約不吃不能有元件、skip 只能是 true、估算大小只能 S/M/L/null");
  const lsr = { date: "2026-10-02", slots: { lunch: { name: "雞胸便當", content: prod, totals: { kcal: 620 } } } };
  check(!errOf(() => db.validateSetting("last_shown_recs", lsr)) && errOf(() => db.validateSetting("last_shown_recs", { date: "2026-10-02", slots: { brunch: lsr.slots.lunch } })) &&
    errOf(() => db.validateSetting("last_shown_recs", { date: "x", slots: {} })), "last_shown_recs：時段名稱與日期要對");
  const v6 = clone(v5); v6.sections.meal_plan = [plan(prod), plan(skipPlan, { id: "2026-10-05|breakfast", date: "2026-10-05", slot: "breakfast" })]; v6.manifest.meal_plan = 2;
  v6.sections.logs.daily_log.push(Object.assign(clone(skipLog), { id: "log_skip1" })); v6.manifest.daily_log += 1;
  v6.sections.system.settings.push({ id: "last_shown_recs", value: lsr }); v6.manifest.settings += 1;
  check(db.validateBackup(v6).length === 0, "含預約、skipped、昨天推薦的 v6 備份要能還原：" + db.validateBackup(v6).slice(0, 2).join("；"));
  check(db.summarizeBackup(v6).meal_plan.count === 2 && db.summarizeBackup(v6).meal_plan.last_date === "2026-10-05" && db.summarizeBackup(v6).meal_plan.label === "預約", "summarizeBackup 預約筆數與日期");
  check(Array.isArray(up5.sections.meal_plan) && up5.sections.meal_plan.length === 0 && up5.manifest.meal_plan === 0, "舊備份升級補空的預約");
  const badPlan = clone(v6); badPlan.sections.meal_plan[0].id = "2026-10-04|dinner";
  check(db.validateBackup(badPlan).some((x) => /預約第 1 筆/.test(x)), "壞的預約要指出「預約第 1 筆」");
  // ---- 日期切換：引擎（toPlanContent、resolvePlan、planPseudoLog、planToday 收預約） ----
  console.log("[日期切換：引擎]");
  const pctx = { hidden: [], customs: [], customIngredients: [], profile: {} };
  const estDraft = mc.buildDraftContent({ kind: "products", meal_type: "delivery", items: [], estimates: [{ size: "L", name: "喜宴" }], drink: null, qtyByUid: {}, foods: [] });
  const estPc = mc.toPlanContent(estDraft, { keepImplicit: false });
  check(estPc.components[0].kind === "estimate" && estPc.components[0].snapshot.kcal === 1200 && !errOf(() => db.validateMealPlan(plan(estPc))), "toPlanContent 保留估算與快照：" + errOf(() => db.validateMealPlan(plan(estPc))));
  const cookDraft = (scale) => mc.buildDraftContent({ kind: "cook", meal_type: "cook_full", archetype: stir, proteins: [ing(stir.protein.allow[0])], staple: ing(stir.staple.allow[0]),
    vegetables: [], seasoning: null, method: ing("method_stir_fry"), primaryScale: scale, implicitOverride: {} });
  const cook15 = mc.toPlanContent(cookDraft(1.5), { keepImplicit: false }), cook1 = mc.toPlanContent(cookDraft(1), { keepImplicit: false });
  check(cook15.components.some((c) => c.is_primary && c.scale === 1.5) && !cook1.components.some((c) => "scale" in c) && !errOf(() => db.validateMealPlan(plan(cook15))),
    "toPlanContent 主要槽位存使用者選的倍數（1 倍不存）");
  check(JSON.stringify(mc.toPlanContent(mc.buildDraftContent({ kind: "products", meal_type: "convenience", items: [main], estimates: [], drink: catalog.productsByUid.tw_dr05,
    qtyByUid: { [main.uid]: 2 }, foods: [{ item: tree.fx_cooked_rice, qty: 4 }] }), { keepImplicit: false })) === JSON.stringify(prod), "toPlanContent 沒有估算與倍數時跟 toSavedContent 相同");
  const rp = (content, slot, ctxPatch) => mc.resolvePlan(plan(content, { slot: slot || "lunch", id: "2026-10-04|" + (slot || "lunch") }), catalog, Object.assign({}, pctx, ctxPatch || {}), "normal");
  const rSkip = rp(skipPlan), rEst = rp(estPc), rProd = rp(prod), r15 = rp(cook15), r1 = rp(cook1);
  check(rSkip.status === "skip" && rSkip.totals.kcal === 0 && rEst.status === "ok" && rEst.totals.kcal === 1200 && rProd.status === "ok" &&
    rProd.totals.kcal === mc.savedMealTotals(mc.resolveSavedMeal(prod, catalog, Object.assign({}, pctx, { slot: "lunch" })), catalog, "normal").kcal,
    "resolvePlan：預約不吃 0、估算 1200、現成照組合合計");
  check(r15.status === "ok" && r1.status === "ok" && r15.totals.kcal > r1.totals.kcal, "resolvePlan：自煮照使用者選的倍數（1.5 倍比 1 倍多）：" + (r15.totals && r15.totals.kcal) + " vs " + (r1.totals && r1.totals.kcal));
  const mainProd = catalog.productsByUid[prod.components.find((c) => c.kind === "product" && catalog.productsByUid[c.ref].role !== "drink").ref];
  const rHidden = rp(prod, "lunch", { hidden: [mainProd.uid] });
  check(rHidden.status === "invalid" && rHidden.totals === null, "resolvePlan：有元件已不提供＝整筆失效");
  const pseudo = mc.planPseudoLog(plan(prod), rProd), pseudoSkip = mc.planPseudoLog(plan(skipPlan, { slot: "dinner", id: "2026-10-04|dinner" }), rSkip);
  check(pseudo.planned === true && pseudo.slot === "lunch" && pseudo.totals.kcal === rProd.totals.kcal && pseudoSkip.skip === true && pseudoSkip.totals.kcal === 0 &&
    mc.planPseudoLog(plan(prod), rHidden) === null, "planPseudoLog：有效的變暫時紀錄、失效的不算");
  check(!errOf(() => db.validateDailyLog(mc.skippedLogEntry("2026-10-02", "lunch", T0))), "skippedLogEntry 要通過寫入驗證");
  const pool8 = M.pool.buildCandidatePool(catalog);
  const prof8 = { age: 35, gender: "男", height_cm: 175, weight_kg: 80, activity_mode: "輕度", goal_mode: "減脂", meal_prefs: null, enabled_slots: null, diet_restriction: "一般", allergens: [], disliked_ingredients: [] };
  const tg8 = M.nutrition.calculateTargets(prof8);
  const pt = (plans, logs) => M.today.planToday({ profile: prof8, targets: tg8, todayLogs: logs || [], weekLogs: logs || [], feedbackMap: {}, pool: pool8, today: "2026-10-04",
    nowMs: new Date(2026, 9, 4, 6, 0).getTime(), todayPlans: plans });
  const base8 = M.today.planToday({ profile: prof8, targets: tg8, todayLogs: [], weekLogs: [], feedbackMap: {}, pool: pool8, today: "2026-10-04", nowMs: new Date(2026, 9, 4, 6, 0).getTime() });
  check(JSON.stringify(pt([])) === JSON.stringify(base8) && JSON.stringify(pt(undefined)) === JSON.stringify(base8), "planToday 沒有預約時跟日期切換之前相同");
  const estPseudo = mc.planPseudoLog(plan(estPc, { slot: "dinner", id: "2026-10-04|dinner" }), rEst);
  const withEst = pt([estPseudo]);
  check(withEst.skipSlots.dinner === true && !withEst.recs.dinner && Math.abs(withEst.remainingBudget.remainingKcal - Math.max(0, base8.remainingBudget.remainingKcal - 1200)) < 0.2 &&
    withEst.plannedKcal === 1200 && withEst.plannedSlots.dinner === estPseudo && !withEst.logsBySlot.dinner, "planToday：晚餐預約 1200 扣預算、晚餐不推薦、不算紀錄");
  const withSkip = pt([pseudoSkip]);
  check(withSkip.skipSlots.dinner === true && withSkip.remainingBudget.remainingKcal === base8.remainingBudget.remainingKcal &&
    withSkip.remainingBudget.perSlotSuggestion.lunch > base8.remainingBudget.perSlotSuggestion.lunch, "planToday：預約不吃晚餐，配額分給其他餐");
  const realDinner = Object.assign(clone(skipLog), { log_date: "2026-10-04", slot: "dinner", id: "log_d" });
  check(M.today.effectiveTodayLogs([realDinner], [estPseudo]).length === 1 && pt([estPseudo], [realDinner]).plannedKcal === undefined, "已有紀錄的時段，預約不算（紀錄優先）");
  const newer = clone(v3); newer.schema_version = db.BACKUP_SCHEMA_VERSION + 1;
  check(db.validateBackup(newer).some((x) => /較新的版本/.test(x)), "比目前新一版的檔案要擋（較新的版本）");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
