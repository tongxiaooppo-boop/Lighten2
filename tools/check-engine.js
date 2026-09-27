// 輕盈計畫 — 推薦引擎／體重校正引擎斷言腳本
// 用法：在 repo 根目錄執行 `node tools/check-engine.js`，全部通過 exit 0，任何一條失敗 exit 1。
// 每次改 js/engine/recommend.js、js/engine/tdee.js 或 data/*.json 都要跑一次。
// 來源：collab/opus-review-log/2026-09-27-full-project-audit.md 第 9 節。
// 這支只測得到引擎邏輯；分頁切換、撤銷按鈕這類畫面流程要照同一份文件的手機實機腳本手動跑。

"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.join(__dirname, "..");
const SLOTS = ["breakfast", "lunch", "afternoon_tea", "dinner", "snack"];
const MEAL_SLOTS = ["breakfast", "lunch", "dinner", "snack"];

// ---------- 瀏覽器環境替身 ----------
global.window = global;
global.fetch = async function (url) {
  const file = path.join(ROOT, url);
  return { ok: fs.existsSync(file), json: async () => JSON.parse(fs.readFileSync(file, "utf8")) };
};
const readJson = (f) => JSON.parse(fs.readFileSync(path.join(ROOT, "data", f), "utf8"));
const taiwanData = readJson("taiwan_items.json");
const convenienceData = readJson("convenience_items.json");
global.getTaiwanItems = async () => taiwanData;
global.getAllRecipeFeedback = async () => ({});

function load(rel) {
  vm.runInThisContext(fs.readFileSync(path.join(ROOT, rel), "utf8"), { filename: rel });
}
load("js/engine/nutrition.js");
load("js/engine/budget.js");
load("js/engine/recommend.js");

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
  // ---------- 1. 資料本身 ----------
  console.log("[資料]");
  const ALLOWED_ALLERGENS = window.ALLERGEN_OPTIONS.concat(["未確認"]);
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
  const pool = await window.buildRecommendCandidatePool();
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
  const DIETS = ["一般", "全素", "蛋奶素", "低碳"];
  const SOURCES = ["auto", "convenience", "delivery", "cook_quick", "cook_full"];
  const BUDGETS = [150, 300, 500, 800];
  const ALLERGEN_CASES = [[]].concat(window.ALLERGEN_OPTIONS.map((a) => [a])).concat([["蝦、牛奶"]]);
  let scenarios = 0;
  const nullByDiet = {};

  for (const diet of DIETS) {
    for (const source of SOURCES) {
      for (const budget of BUDGETS) {
        for (const allergens of ALLERGEN_CASES) {
          scenarios++;
          const prefs = {};
          const perSlot = {};
          SLOTS.forEach((s) => { prefs[s] = source; perSlot[s] = budget; });
          const allergenInput = typeof allergens[0] === "string" && allergens[0].indexOf("、") !== -1 ? allergens[0] : allergens;
          const recs = await window.getTodayRecommendation(
            { perSlotSuggestion: perSlot }, { proteinGapToday: 30, fiberGapThisWeek: 10 }, prefs, diet, allergenInput, {}
          );
          const userAllergens = window.normalizeAllergens(allergenInput).list;
          const usedItems = {};
          const tag = diet + "/" + source + "/" + budget + "/" + JSON.stringify(allergenInput);
          SLOTS.forEach((slot) => {
            const r = recs[slot];
            if (!r) {
              nullByDiet[diet + ":" + slot] = (nullByDiet[diet + ":" + slot] || 0) + 1;
              return;
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
  console.log("  跑了 " + scenarios + " 種設定組合");
  ["蛋奶素", "全素"].forEach((diet) => {
    ["lunch", "dinner"].forEach((slot) => {
      // 每種 diet 在每個時段有 5 來源 × 4 預算 × 10 過敏原 = 200 組；不能整個時段全部拿不到推薦
      check((nullByDiet[diet + ":" + slot] || 0) < 200, diet + " 使用者的" + slot + "在所有設定下都拿不到推薦");
    });
  });

  // ---------- 4. 已記錄／已預約的時段不產生推薦 ----------
  console.log("[跳過時段]");
  const skipRecs = await window.getTodayRecommendation(
    { perSlotSuggestion: { breakfast: 0, lunch: 500, afternoon_tea: 150, dinner: 500, snack: 150 } },
    { proteinGapToday: 30, fiberGapThisWeek: 10 }, null, "一般", [], { breakfast: true, dinner: true }
  );
  check(skipRecs.breakfast === null, "已記錄的早餐仍然產生推薦");
  check(skipRecs.dinner === null, "已記錄的晚餐仍然產生推薦");
  check(skipRecs.lunch !== null, "沒被跳過的午餐沒有推薦");

  // ---------- 5. 體重趨勢斜率估計 ----------
  console.log("[體重趨勢斜率]");
  await checkTdeeSlope();

  console.log("\n" + (failures === 0 ? "全部通過" : failures + " 項失敗") + "（共 " + checks + " 項檢查）");
  process.exit(failures === 0 ? 0 : 1);
}

// 模擬新使用者：每兩天量一次體重，在「剛滿足資格門檻」（第 22、28 天）跟更久之後（第 42 天）估斜率。
//   - 無雜訊的線性資料：估計值跟真實斜率誤差 < 0.1 kg/週（抓系統性偏差，例如 EWMA 暖機把斜率壓扁）
//   - 有雜訊（±0.5kg）的資料：50 組不同雜訊的平均估計值誤差 < 0.1 kg/週（估計量不偏）
async function checkTdeeSlope() {
  function fmt(d) {
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  }
  // 固定種子的偽隨機雜訊，讓結果可重現
  let seed = 7;
  function noise() {
    seed = (seed * 16807) % 2147483647;
    return (seed / 2147483647) - 0.5; // ±0.5 kg
  }

  load("js/engine/tdee.js");
  const profile = { age: 35, gender: "男", height_cm: 175, weight_kg: 90, activity_mode: "輕度", goal_mode: "減脂", enabled_slots: null };

  async function estimate(truePerWeek, days, withNoise) {
    let state = null;
    const logs = [];
    const today = new Date();
    for (let i = days - 1; i >= 0; i -= 2) {
      const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() - i);
      const dayIndex = days - 1 - i;
      logs.push({ log_date: fmt(d), weight_kg: 90 + (truePerWeek / 7) * dayIndex + (withNoise ? noise() : 0) });
    }
    global.getTdeeState = async () => state || {
      version: 1, offset_kcal: 0, prev_offset_kcal: 0, effective_date: null, last_adjusted_date: null,
      last_evaluated_date: null, goal_mode: null, mode_since_date: null, pending: null, dismissed_until: null,
      announce_until: null, last_result: null, history: [],
    };
    global.saveTdeeState = async (s) => { state = s; return s; };
    global.getWeightLogs = async () => logs;
    global.getDailyLogs = async () => [];
    const result = await window.runCalibrationNow(profile);
    return result.last_result.slope_kg_per_week;
  }

  for (const truePerWeek of [-0.3, -0.5, -1.2, 0.4]) {
    for (const days of [22, 28, 42]) {
      const clean = await estimate(truePerWeek, days, false);
      check(clean != null && Math.abs(clean - truePerWeek) < 0.1,
        "無雜訊：實際 " + truePerWeek + " kg/週、第 " + days + " 天估成 " + clean + " kg/週（誤差需 < 0.1）");
      let sum = 0;
      const RUNS = 50;
      for (let k = 0; k < RUNS; k++) sum += await estimate(truePerWeek, days, true);
      const mean = sum / RUNS;
      check(Math.abs(mean - truePerWeek) < 0.1,
        "有雜訊：實際 " + truePerWeek + " kg/週、第 " + days + " 天平均估成 " + mean.toFixed(2) + " kg/週（誤差需 < 0.1）");
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
