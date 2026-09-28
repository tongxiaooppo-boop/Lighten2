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
  const custom = (tags) => M.catalog.fromCustomFood(Object.assign({ id: "custom_x", name: "x", kcal: 100 }, tags === undefined ? {} : { allergen_tags: tags }));
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

  // ---------- 4e. null 傳染（章程 C4.5）：缺資料不當 0 ----------
  console.log("[null 傳染]");
  {
    const mc = M.mc;
    const ing = (o) => Object.assign({ id: "x", name: "x", serving_g: 100, kcal_100g: 100, protein_100g: 10, carb_100g: 10, fat_100g: 1, fiber_100g: 1 }, o);
    check(mc.ingredientContribution(ing({ protein_100g: null })).protein_g === null, "食材蛋白質未知，一份的蛋白質要是 null");
    check(mc.ingredientContribution(ing({})).protein_g === 10, "食材蛋白質已知時照常計算");
    const t = mc.composeTotals({ protein: ing({ fiber_100g: null }), staple: ing({ id: "s" }), primaryScale: 1 }, null);
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
    const ct = mc.composeTotals({ protein: ing({ sodium_100g: 50 }), staple: ing({ id: "s", sodium_100g: null }), primaryScale: 1 }, null);
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
    check(mc.manualSelectionProblem([it("main", "a"), it("main", "b")]) !== null, "兩個主餐超過角色上限要擋");
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

  // ---------- 4i. 「自己選」的品項帶齊 catalog 的營養欄位（章程 C2；−1b 驗收審核 A1） ----------
  console.log("[自己選的營養欄位]");
  {
    const picker = await imp("js/ui/item-picker.js");
    const FIELDS = ["kcal", "protein_g", "carb_g", "fat_g", "fiber_g", "sat_fat_g", "sodium_mg"];
    let compared = 0;
    SLOTS.forEach((slot) => {
      const r = picker.filterForSlot(catalog, [], slot, {});
      r.pass.concat(r.blocked.map((b) => b.item)).forEach((it) => {
        const src = catalog.productsByUid[it.uid];
        FIELDS.forEach((k) => {
          compared++;
          check(it[k] === src[k], "自己選 " + slot + " 的 " + it.uid + "." + k + " 跟 catalog 不同（" + it[k] + " vs " + src[k] + "）");
        });
      });
    });
    check(compared > 0, "測試前提：自己選要有品項");
    const latte = picker.filterForSlot(catalog, [], "breakfast", {}).pass.find((it) => it.uid === "tw_dr05");
    check(latte && M.mc.sumProducts([latte]).sodium_mg === 113.1, "自己選拿鐵（tw_dr05），合計鈉要是 113.1（實際 " + (latte && M.mc.sumProducts([latte]).sodium_mg) + "）");
    const cf = M.catalog.fromCustomFood({ id: "custom_y", name: "y", kcal: 100, protein_g: 1, carb_g: 1, fat_g: 1, fiber_g: 0, sat_fat_g: 0.4, sodium_mg: 250, allergen_tags: [] });
    check(cf.sat_fat_g === 0.4 && cf.sodium_mg === 250, "我的品項要帶飽和脂肪與鈉（實際 " + cf.sat_fat_g + "、" + cf.sodium_mg + "）");
    const cfPicked = picker.filterForSlot(catalog, [{ id: "custom_y", name: "y", kcal: 100, sat_fat_g: 0.4, sodium_mg: 250, allergen_tags: [] }], "lunch", {}).pass.find((it) => it.uid === "custom_y");
    check(cfPicked && cfPicked.sodium_mg === 250, "自己選裡的我的品項要帶鈉");
  }

  // ---------- 5. 體重趨勢斜率估計 ----------
  console.log("[體重趨勢斜率]");
  checkTdeeSlope();

  // ---------- 6. 資料庫寫入驗證（章程 C1.5：一筆一個 key，傳入陣列要報錯） ----------
  console.log("[資料庫寫入驗證]");
  await checkDbValidation();

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
    components: [{ kind: "ingredient", axis: "protein", ref: "egg", is_primary: true, scale: 1.25 }], implicit: null,
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
  await notValidationError(() => db.saveProfile({ age: 30 }), "合法的 profile 被驗證擋下");

  // C1.5：一筆一個 key，傳入陣列要報錯
  const ARRAY = /不能傳陣列/;
  await rejectsWith(() => db.addDailyLog([good]), ARRAY, "addDailyLog 傳入陣列沒有報「不能傳陣列」");
  await rejectsWith(() => db.addWeightLog([{ log_date: "2026-09-23", weight_kg: 70 }]), ARRAY, "addWeightLog 傳入陣列沒有報「不能傳陣列」");
  await rejectsWith(() => db.addExerciseLog([{ log_date: "2026-09-23", activity_type: "快走" }]), ARRAY, "addExerciseLog 傳入陣列沒有報「不能傳陣列」");
  await rejectsWith(() => db.saveProfile([{}]), ARRAY, "saveProfile 傳入陣列沒有報「不能傳陣列」");
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

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
