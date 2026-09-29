// 輕盈計畫 — 推薦／體重校正／自己選／畫面 快照比對（章程 C6.3–C6.4）
//
// 用法：
//   node tools/diff-recs.js            跟 tools/snapshots/ 比對，不同就列出差異並 exit 1
//   node tools/diff-recs.js --update   重新錄製快照（刻意改變行為時用，快照檔的 git diff 就是差異報告）
//   node tools/diff-recs.js --full     比對時列出全部差異（預設每個檔最多列 60 行）
//
// 輸入一律是固定的 profile、紀錄、倒讚/顯示紀錄、體重與固定的日期時間（台灣時區）。
// 輸出是規範化後的文字：一行一個 key，選中的組合 id、四捨五入後的營養值、縮放倍數；
// 不比整包 JSON。快照測試資料不含預約（PRD 第 7 節 −1a）。
//
// 引擎的載入方式放在 tools/lib/adapter-v2.js（v1 的 adapter-v1.js 在 Phase −1a 改寫時換掉；情境與快照不變）。

"use strict";

const fs = require("fs");
const path = require("path");
const env = require("./lib/fake-env");

env.ensureTaipeiTZ();
env.installClock();

const ROOT = path.join(__dirname, "..");
const SNAP_DIR = path.join(__dirname, "snapshots");
const args = process.argv.slice(2);
const UPDATE = args.indexOf("--update") !== -1;
const FULL = args.indexOf("--full") !== -1;

let A = null; // main() 裡載入（ES modules 要非同步 import）

const SLOTS = ["breakfast", "lunch", "afternoon_tea", "dinner", "snack"];
const DAY = "2026-09-23"; // 週三
const NOW_DAY = DAY + "T10:00";
const NOW_NIGHT = DAY + "T03:00"; // 台灣 00:00–08:00：daysSince 時區 bug 的範圍（−1a 刻意保留，−1b 修）

// ---------- 小工具 ----------

function addDays(dateStr, n) {
  const [y, m, d] = dateStr.split("-").map(Number);
  const t = new env.RealDate(env.RealDate.UTC(y, m - 1, d + n));
  return t.getUTCFullYear() + "-" + String(t.getUTCMonth() + 1).padStart(2, "0") + "-" + String(t.getUTCDate()).padStart(2, "0");
}

// 數字統一到小數 3 位，避免浮點加總順序造成 1e-13 的假差異；null/undefined 照實寫。
function n(v) {
  if (v == null) return String(v);
  if (typeof v !== "number") return JSON.stringify(v);
  const r = Math.round(v * 1000) / 1000;
  return String(Object.is(r, -0) ? 0 : r);
}

function stable(v) {
  if (v === undefined) return "undefined";
  if (v === null || typeof v !== "object") return typeof v === "number" ? n(v) : JSON.stringify(v);
  if (Array.isArray(v)) return "[" + v.map(stable).join(",") + "]";
  return "{" + Object.keys(v).sort().map((k) => JSON.stringify(k) + ":" + stable(v[k])).join(",") + "}";
}

function normRec(r) {
  if (r === null) return "-";
  if (r === undefined) return "undefined";
  if (r.lowBudget) return "lowBudget budget=" + n(r.budget);
  return r.id + " scale=" + n(r.scale) + " kcal=" + n(r.scaled_kcal) + " base=" + n(r.kcal) +
    " P=" + n(r.protein_g) + " C=" + n(r.carb_g) + " F=" + n(r.fat_g) + " Fb=" + n(r.fiber_g) +
    " budget=" + n(r.budget) + " src=" + r.source_pref + (r.fallback_to_auto ? " fallback" : "");
}

// 顯示欄位（飽和脂肪、鈉）也要進快照，不然漏帶這兩欄時差異看不出來（−1b 驗收審核 A1）
function normTotals(t) {
  return "kcal=" + n(t.kcal) + " P=" + n(t.protein_g) + " C=" + n(t.carb_g) + " F=" + n(t.fat_g) + " Fb=" + n(t.fiber_g) +
    " SF=" + n(t.sat_fat_g) + " Na=" + n(t.sodium_mg) + (t.partial && t.partial.length ? " partial=" + t.partial.join(",") : "");
}

// MealContent 規範化：型態、餐型/烹調法、每個元件（食材 axis:ref*縮放、商品 ref×數量、估算 名稱@熱量）、隱含成分
function normContent(c) {
  const comps = c.components.map((x) => {
    if (x.kind === "ingredient") return x.axis + ":" + x.ref + (x.scale != null ? "*" + n(x.scale) : "");
    if (x.kind === "product") return x.ref + "x" + x.qty + "@" + n(x.snapshot.kcal);
    return "estimate:" + x.name + "@" + n(x.snapshot.kcal);
  });
  return c.meal_type + "|" + (c.archetype_id || "-") + "/" + (c.method_id || "-") + "|" + comps.join(",") + "|implicit=" + stable(c.implicit);
}

function normWrite(w) {
  if (w.op === "addDailyLog") {
    const e = w.entry;
    return "addDailyLog " + e.slot + " " + JSON.stringify(e.name) + " " + normTotals(e.totals) +
      " type=" + e.meal_type + " source=" + e.source + " content=" + normContent(e.content);
  }
  if (w.op === "markRecipesShown") return "markRecipesShown " + w.ids.join(",");
  return w.op + " " + stable(w);
}

// ---------- 測試資料 ----------

const BASE_PROFILE = {
  age: 35, gender: "男", height_cm: 175, weight_kg: 80, activity_mode: "輕度", goal_mode: "減脂",
  meal_prefs: null, enabled_slots: null, diet_restriction: "一般", allergens: [], disliked_ingredients: [],
};
const ALL_ON = { breakfast: true, lunch: true, afternoon_tea: true, dinner: true, snack: true };
const P = {
  M: BASE_PROFILE,
  F: Object.assign({}, BASE_PROFILE, { gender: "女", age: 30, height_cm: 160, weight_kg: 60, activity_mode: "久坐", goal_mode: "維持",
    meal_prefs: { breakfast: "auto", lunch: "auto", afternoon_tea: "auto", dinner: "auto", snack: "auto" }, enabled_slots: ALL_ON }),
  VEG: Object.assign({}, BASE_PROFILE, { diet_restriction: "蛋奶素", allergens: ["堅果"], enabled_slots: ALL_ON,
    meal_prefs: { breakfast: "convenience", lunch: "cook_quick", afternoon_tea: "auto", dinner: "cook_full", snack: "auto" } }),
  VEGAN: Object.assign({}, BASE_PROFILE, { diet_restriction: "全素", meal_prefs: { breakfast: "auto", lunch: "auto", afternoon_tea: "auto", dinner: "auto", snack: "auto" } }),
  LEGACY_ALLERGY: Object.assign({}, BASE_PROFILE, { allergens: "蝦、牛奶" }),
  ALLERGY: Object.assign({}, BASE_PROFILE, { allergens: ["蛋", "黃豆", "麩質"] }),
  DISLIKE: Object.assign({}, BASE_PROFILE, { disliked_ingredients: [
    { type: "protein", key: "chicken_breast", label: "雞胸肉" },
    { type: "vegetable", key: "broccoli", label: "花椰菜" },
    { type: "item", key: "conv_dr01", label: "統一陽光 高纖無糖豆漿" },
  ] }),
  DELIVERY: Object.assign({}, BASE_PROFILE, { meal_prefs: { breakfast: "delivery", lunch: "delivery", afternoon_tea: "delivery", dinner: "delivery", snack: "delivery" }, enabled_slots: ALL_ON }),
  QUICK: Object.assign({}, BASE_PROFILE, { meal_prefs: { breakfast: "cook_quick", lunch: "cook_quick", afternoon_tea: "cook_quick", dinner: "cook_quick", snack: "cook_quick" } }),
  LOWCARB: Object.assign({}, BASE_PROFILE, { low_carb: true }),
  LESSOIL: Object.assign({}, BASE_PROFILE, { oil_habit: "less", meal_prefs: { breakfast: "cook_quick", lunch: "cook_quick", afternoon_tea: "auto", dinner: "cook_full", snack: "auto" } }),
  BULK: Object.assign({}, BASE_PROFILE, { weight_kg: 95, activity_mode: "中度", goal_mode: "增肌" }),
  OFF: Object.assign({}, BASE_PROFILE, { enabled_slots: { breakfast: false, lunch: true, afternoon_tea: false, dinner: true, snack: false },
    meal_prefs: { breakfast: "off", lunch: "convenience", afternoon_tea: "off", dinner: "cook_full", snack: "off" } }),
};

let logSeq = 0;
function log(date, slot, kcal, p, c, f, fb, name) {
  return {
    id: "fx_" + String(++logSeq).padStart(4, "0"), log_date: date, slot: slot, source_type: "custom", item_id: null,
    item_name: name || "測試餐點", kcal: kcal, protein_g: p, carb_g: c, fat_g: f, fiber_g: fb,
    is_feast: 0, feast_reservation_id: null, component_ids: null,
  };
}

// 過去 days 天，每天記錄 slots 各一筆（預設開啟的早午晚）。fiberPerMeal 控制纖維缺口。
function history(days, opts) {
  const o = Object.assign({ slots: ["breakfast", "lunch", "dinner"], fiberPerMeal: 6, kcalShift: 0, skip: [] }, opts);
  const out = [];
  for (let i = days; i >= 1; i--) { // 由舊到新，跟 IndexedDB 依日期排序的讀取順序一致
    if (o.skip.indexOf(i) !== -1) continue;
    const d = addDays(DAY, -i);
    o.slots.forEach((s, j) => {
      out.push(log(d, s, 420 + j * 180 + i * 7 + o.kcalShift, 25 + j * 5, 50 + j * 10, 12 + j * 3, o.fiberPerMeal + (i % 3)));
    });
  }
  return out;
}

const TODAY_LOGS = {
  none: [],
  breakfast: [log(DAY, "breakfast", 420, 22, 50, 14, 5, "御飯糰＋豆漿")],
  bl: [log(DAY, "breakfast", 420, 22, 50, 14, 5, "御飯糰＋豆漿"), log(DAY, "lunch", 880, 35, 100, 30, 6, "排骨便當")],
  over: [log(DAY, "breakfast", 900, 30, 110, 35, 3, "大份早餐"), log(DAY, "lunch", 1100, 40, 130, 40, 4, "吃到飽")],
  nullmacro: [log(DAY, "breakfast", 500, null, null, null, null, "查不到的早餐")],
  all: [log(DAY, "breakfast", 420, 22, 50, 14, 5), log(DAY, "lunch", 700, 35, 80, 20, 6), log(DAY, "dinner", 650, 40, 60, 18, 8)],
};

// 我的品項（PRD 10.1 格式，要能通過 db.validateCustomFood）：外食主餐兩筆（一筆蛋白質等未填、過敏原未確認）、
// 一筆超商飲料、一筆已封存（選擇器不列出）
const CUSTOM_BASE = { protein_g: null, carb_g: null, fat_g: null, fiber_g: null, sat_fat_g: null, sodium_mg: null,
  valid_slots: ["breakfast", "lunch", "afternoon_tea", "dinner", "snack"], vegan: false, lacto_ovo: false, archived: false, copied_from: null };
const CUSTOM_FOODS = [
  Object.assign({}, CUSTOM_BASE, { id: "custom_a", name: "自製便當", kcal: 650, protein_g: 30, fat_g: 20, fiber_g: 5, role: "main", channel: "delivery", allergen_tags: [] }),
  Object.assign({}, CUSTOM_BASE, { id: "custom_b", name: "朋友家晚餐", kcal: 800, role: "main", channel: "delivery", allergen_tags: null }),
  Object.assign({}, CUSTOM_BASE, { id: "custom_c", name: "自己打的豆漿", kcal: 120, protein_g: 8, sodium_mg: 20, role: "drink", channel: "convenience", allergen_tags: ["黃豆"], vegan: true }),
  Object.assign({}, CUSTOM_BASE, { id: "custom_d", name: "停賣的便當", kcal: 700, role: "main", channel: "convenience", allergen_tags: [], archived: true }),
];

function tdeeState(extra) {
  return Object.assign({
    version: 1, offset_kcal: 0, prev_offset_kcal: 0, effective_date: null, last_adjusted_date: null,
    last_evaluated_date: DAY, goal_mode: "cut", mode_since_date: null, pending: null, dismissed_until: null,
    announce_until: null, last_result: null, history: [],
  }, extra);
}

// 固定種子的偽隨機，跟 check-engine 一樣可重現
function rng(seed) {
  let s = seed;
  return () => { s = (s * 16807) % 2147483647; return s / 2147483647 - 0.5; };
}

// 體重：從 days-1 天前到今天，每 every 天量一次；perWeek kg/週的線性趨勢＋雜訊；lastGap 讓最後一次量測停在幾天前
function weights(opts) {
  const o = Object.assign({ days: 28, every: 2, perWeek: 0, start: 80, noise: 0, seed: 11, lastGap: 0 }, opts);
  const r = rng(o.seed);
  const out = [];
  for (let i = o.days - 1; i >= o.lastGap; i -= o.every) {
    const idx = o.days - 1 - i;
    out.push({ log_date: addDays(DAY, -i), weight_kg: Math.round((o.start + (o.perWeek / 7) * idx + r() * o.noise) * 100) / 100 });
  }
  return out;
}

// ---------- 情境 ----------

const out = { pool: [], matrix: [], recs: [], tdee: [], picker: [], ui: [] };
function emit(file, key, value) { out[file].push(key + "\t" + value); }

async function snapPool() {
  env.setNow(NOW_DAY);
  A.setDb({});
  const pool = await A.pool();
  emit("pool", "count", pool.length);
  pool.slice().sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)).forEach((c) => {
    emit("pool", c.id,
      "kcal=" + n(c.kcal) + " P=" + n(c.protein_g) + " C=" + n(c.carb_g) + " F=" + n(c.fat_g) + " Fb=" + n(c.fiber_g) +
      (c.is_composed ? " primary=" + n(c.primary_kcal) + "/" + n(c.primary_protein_g) + "/" + n(c.primary_carb_g) + "/" + n(c.primary_fat_g) + "/" + n(c.primary_fiber_g) : "") +
      " tier=" + c.tier + " src=" + (c.is_composed ? "cook" : c.is_convenience ? "conv" : "deliv") +
      " slots=" + (c.valid_slots || []).join(",") + " allergen=" + (c.allergen_tags || []).join(",") +
      " diet=" + stable(c.diet_tag_sets));
  });
}

// check-engine 同一組設定矩陣：直接呼叫推薦，每個時段同一個配額
async function snapMatrix() {
  env.setNow(NOW_DAY);
  A.setDb({});
  const DIETS = ["一般", "全素", "蛋奶素", "低碳"];
  const SOURCES = ["auto", "convenience", "delivery", "cook_quick", "cook_full"];
  const BUDGETS = [150, 300, 500, 800];
  const ALLERGENS = [[], ["甲殼類"], ["魚"], ["蛋"], ["乳製品"], ["堅果"], ["麩質"], ["黃豆"], ["芝麻"], "蝦、牛奶", ["花生"], ["軟體動物"]];
  for (const diet of DIETS) for (const source of SOURCES) for (const budget of BUDGETS) for (const al of ALLERGENS) {
    const prefs = {}, perSlot = {};
    SLOTS.forEach((s) => { prefs[s] = source; perSlot[s] = budget; });
    // 「低碳」這一列是基本資料的低碳開關（decisions #26，不再是飲食型態），列名沿用以便對照
    const lowCarb = diet === "低碳";
    const recs = await A.recommendRaw({ perSlotSuggestion: perSlot }, { proteinGapToday: 30, fiberGapThisWeek: 10 }, prefs,
      lowCarb ? "一般" : diet, al, {}, undefined, lowCarb);
    emit("matrix", [diet, source, budget, typeof al === "string" ? al : al.join("+") || "無"].join("/"),
      SLOTS.map((s) => {
        const r = recs[s];
        if (!r) return s + "=-";
        if (r.lowBudget) return s + "=low";
        return s + "=" + r.id + "*" + n(r.scale) + "@" + n(r.scaled_kcal);
      }).join(" "));
  }
}

// 今日建議整頁（v1 的 buildRecommendation）：引擎輸入輸出＋畫面
async function todayScenario(name, s) {
  env.setNow(s.now || NOW_DAY);
  A.setDb({
    profile: s.profile, dailyLogs: (s.history || []).concat(s.today || []), feedback: s.feedback || {},
    tdeeState: s.tdeeState || tdeeState({ goal_mode: null }), customFoods: CUSTOM_FOODS,
  });
  const res = await A.todayPage();
  const io = A.takeEngineIO();
  const k = "today/" + name;
  emit("recs", k + "/targets", stable(io.targets));
  emit("recs", k + "/remainingBudget", stable(io.remainingBudget));
  emit("recs", k + "/hardConstraints", stable(io.hardConstraints));
  emit("recs", k + "/skip", Object.keys(io.skipSlots || {}).sort().join(","));
  SLOTS.forEach((slot) => emit("recs", k + "/" + slot, normRec(res[slot])));
  A.takeWrites().forEach((w, i) => emit("recs", k + "/write" + i, normWrite(w)));
  A.takeDom().forEach((line, i) => emit("ui", k + "/dom" + String(i).padStart(2, "0"), line));
  return res;
}

async function snapToday() {
  const base = { profile: P.M, history: history(7) };
  const baseRecs = await todayScenario("M/base", base);
  await todayScenario("M/base-night", Object.assign({}, base, { now: NOW_NIGHT }));
  await todayScenario("M/no-history", { profile: P.M });
  await todayScenario("M/low-fiber-history", { profile: P.M, history: history(7, { fiberPerMeal: 2 }) });
  await todayScenario("M/high-fiber-history", { profile: P.M, history: history(7, { fiberPerMeal: 14 }) });
  await todayScenario("M/two-complete-days", { profile: P.M, history: history(7, { skip: [1, 2, 4, 5, 6] }) });
  for (const t of ["breakfast", "bl", "over", "nullmacro", "all"]) {
    await todayScenario("M/today-" + t, Object.assign({}, base, { today: TODAY_LOGS[t] }));
  }
  await todayScenario("M/offset-minus", Object.assign({}, base, { tdeeState: tdeeState({ offset_kcal: -150, prev_offset_kcal: -150 }) }));
  await todayScenario("M/offset-plus-effective-tomorrow", Object.assign({}, base, {
    tdeeState: tdeeState({ offset_kcal: 150, prev_offset_kcal: 0, effective_date: addDays(DAY, 1), last_adjusted_date: DAY, announce_until: addDays(DAY, 3) }),
  }));
  await todayScenario("M/offset-announce", Object.assign({}, base, {
    tdeeState: tdeeState({ offset_kcal: -150, prev_offset_kcal: 0, effective_date: DAY, last_adjusted_date: addDays(DAY, -1), announce_until: addDays(DAY, 2) }),
  }));
  await todayScenario("M/pending", Object.assign({}, base, {
    tdeeState: tdeeState({ pending: { delta_kcal: -150, proposed_offset_kcal: -150, created_date: DAY, slope_kg_per_week: 0.7, ewma_latest_kg: 80, goal_mode: "maintain" } }),
  }));

  for (const key of Object.keys(P)) {
    if (key === "M") continue;
    await todayScenario(key + "/base", { profile: P[key], history: history(7) });
    await todayScenario(key + "/today-breakfast", { profile: P[key], history: history(7), today: TODAY_LOGS.breakfast });
  }

  // 倒讚、喜歡、近期顯示過：目標組合由 base 的結果推導（資料改了就跟著變，差異報告看得到）
  const chosen = SLOTS.map((s) => baseRecs[s]).filter((r) => r && !r.lowBudget).map((r) => r.id);
  const pool = await A.pool();
  const altDinner = pool.filter((c) => c.is_composed && c.valid_slots.indexOf("dinner") !== -1 && chosen.indexOf(c.id) === -1)
    .map((c) => c.id).sort()[0];
  const fb = {
    dislikeTop: Object.fromEntries(chosen.map((id) => [id, { rating: "dislike", shown_count: 1 }])),
    likeAlt: { [altDinner]: { rating: "like", shown_count: 0 } },
    shownToday: Object.fromEntries(chosen.map((id) => [id, { shown_count: 1, last_shown_date: DAY }])),
    shownYesterday: Object.fromEntries(chosen.map((id) => [id, { shown_count: 1, last_shown_date: addDays(DAY, -1) }])),
    shownOften: Object.fromEntries(chosen.map((id) => [id, { shown_count: 6, last_shown_date: addDays(DAY, -4) }])),
  };
  for (const f of Object.keys(fb)) {
    await todayScenario("M/fb-" + f, Object.assign({}, base, { feedback: fb[f] }));
    await todayScenario("M/fb-" + f + "-night", Object.assign({}, base, { feedback: fb[f], now: NOW_NIGHT }));
  }

  // 記錄推薦 → 重新整理 → 撤銷
  env.setNow(NOW_DAY);
  A.setDb({ profile: P.M, dailyLogs: history(7), tdeeState: tdeeState({ goal_mode: null }) });
  await A.todayPage();
  A.takeEngineIO(); A.takeWrites(); A.takeDom();
  await A.logRec("breakfast");
  let recs = A.currentRecs();
  A.takeEngineIO();
  A.takeWrites().forEach((w, i) => emit("recs", "flow/log-breakfast/write" + i, normWrite(w)));
  SLOTS.forEach((slot) => emit("recs", "flow/log-breakfast/" + slot, normRec(recs[slot])));
  A.takeDom().forEach((line, i) => emit("ui", "flow/log-breakfast/dom" + String(i).padStart(2, "0"), line));
  const logged = A.dailyLogsFor(DAY).find((l) => l.slot === "breakfast");
  await A.undo(logged.id);
  recs = A.currentRecs();
  A.takeEngineIO();
  A.takeWrites().forEach((w, i) => emit("recs", "flow/undo-breakfast/write" + i, normWrite(w)));
  SLOTS.forEach((slot) => emit("recs", "flow/undo-breakfast/" + slot, normRec(recs[slot])));
  A.takeDom();

  // 倒讚、「順便不要」、同一天重建（切回分頁）：卡片顯示過就會記「今天顯示過」，重建時被降權
  // 倒讚與「順便不要」先清掉「今天顯示過」，不然會被同日重建的降權效果蓋掉；另外直接斷言被排除的東西沒有再出現
  const flows = {
    "dislike-dinner": async (before) => {
      await A.dislike("dinner");
      const after = A.currentRecs();
      emit("recs", "flow/dislike-dinner/excluded", SLOTS.every((s) => !after[s] || after[s].id !== before.dinner.id) ? "ok" : "倒讚的組合又出現了");
    },
    "chip-dinner-protein": async (before) => {
      const p = before.dinner.protein_id;
      await A.dislikeChip("protein", p, before.dinner.protein_name);
      const after = A.currentRecs();
      emit("recs", "flow/chip-dinner-protein/excluded", SLOTS.every((s) => !after[s] || after[s].protein_id !== p) ? "ok" : "不吃的蛋白質又出現了");
    },
    "rebuild-same-day": async () => { await A.todayPage(); },
  };
  for (const name of Object.keys(flows)) {
    env.setNow(NOW_DAY);
    A.setDb({ profile: P.M, dailyLogs: history(7), tdeeState: tdeeState({ goal_mode: null }) });
    const before = await A.todayPage();
    A.takeEngineIO(); A.takeWrites(); A.takeDom();
    await flows[name](before);
    const r2 = A.currentRecs();
    A.takeEngineIO(); A.takeDom();
    A.takeWrites().forEach((w, i) => emit("recs", "flow/" + name + "/write" + i, normWrite(w)));
    SLOTS.forEach((slot) => emit("recs", "flow/" + name + "/" + slot, normRec(r2[slot])));
  }
}

async function tdeeScenario(name, s) {
  env.setNow(s.now || NOW_DAY);
  A.setDb({ profile: s.profile, weightLogs: s.weights || [], dailyLogs: s.logs || [], tdeeState: s.state || null });
  const actions = s.actions || ["force"];
  for (let i = 0; i < actions.length; i++) {
    const st = await A.calibrate(actions[i], s.profile);
    emit("tdee", name + "/" + i + "-" + actions[i], stable(st));
  }
  const t0 = await A.getCalibratedTargets(s.profile, DAY);
  const t1 = await A.getCalibratedTargets(s.profile, addDays(DAY, 1));
  emit("tdee", name + "/targets-today", stable(t0));
  emit("tdee", name + "/targets-tomorrow", stable(t1));
  A.takeDom();
  await A.profileCard(s.profile);
  A.takeDom().forEach((line, i) => emit("ui", "profile/" + name + "/dom" + String(i).padStart(2, "0"), line));
}

async function snapTdee() {
  env.setNow(NOW_DAY);
  A.setDb({});
  Object.keys(P).forEach((k) => {
    emit("tdee", "targets/" + k, stable(A.calculateTargets(P[k], 0)));
    emit("tdee", "targets/" + k + "/offset-300", stable(A.calculateTargets(P[k], -300)));
  });
  const WOMAN_SMALL = Object.assign({}, P.M, { gender: "女", weight_kg: 48, height_cm: 152, age: 45, activity_mode: "久坐" });
  const MAINTAIN = Object.assign({}, P.M, { goal_mode: "維持" });
  const intake = (kcalShift) => history(27, { kcalShift: kcalShift });
  const logsOk = intake(-300);       // 平均約 1790，低於減脂目標 ×1.1（約 2086）
  const logsHigh = intake(500);      // 平均約 2590，高於目標 ×1.1
  const logsShort = history(10);     // 完整記錄日 < 14

  await tdeeScenario("no-weights", { profile: P.M });
  await tdeeScenario("stale", { profile: P.M, weights: weights({ perWeek: -0.1, lastGap: 10, days: 38 }) });
  await tdeeScenario("few-weighins", { profile: P.M, weights: weights({ perWeek: -0.1, every: 5 }) });
  await tdeeScenario("cut-on-track", { profile: P.M, weights: weights({ perWeek: -0.6, noise: 0.4 }) });
  await tdeeScenario("cut-slow-log-short", { profile: P.M, weights: weights({ perWeek: -0.1, noise: 0.4 }), logs: logsShort });
  await tdeeScenario("cut-slow-adjusted", { profile: P.M, weights: weights({ perWeek: -0.1, noise: 0.4 }), logs: logsOk });
  await tdeeScenario("cut-slow-intake-high", { profile: P.M, weights: weights({ perWeek: -0.1, noise: 0.4 }), logs: logsHigh });
  await tdeeScenario("cut-fast", { profile: P.M, weights: weights({ perWeek: -1.4, noise: 0.4 }) });
  await tdeeScenario("bulk-slow", { profile: P.BULK, weights: weights({ perWeek: 0.0, start: 95, noise: 0.3 }) });
  await tdeeScenario("bulk-fast-log-short", { profile: P.BULK, weights: weights({ perWeek: 1.3, start: 95, noise: 0.3 }) });
  await tdeeScenario("bulk-fast", { profile: P.BULK, weights: weights({ perWeek: 1.3, start: 95, noise: 0.3 }), logs: logsOk });
  await tdeeScenario("maintain-up-pending", { profile: MAINTAIN, weights: weights({ perWeek: 0.8, noise: 0.3 }), logs: logsOk, state: tdeeState({ goal_mode: "maintain", last_evaluated_date: null }) });
  await tdeeScenario("maintain-pending-confirm", { profile: MAINTAIN, weights: weights({ perWeek: 0.8, noise: 0.3 }), logs: logsOk, state: tdeeState({ goal_mode: "maintain", last_evaluated_date: null }), actions: ["force", "confirm"] });
  await tdeeScenario("maintain-pending-dismiss", { profile: MAINTAIN, weights: weights({ perWeek: 0.8, noise: 0.3 }), logs: logsOk, state: tdeeState({ goal_mode: "maintain", last_evaluated_date: null }), actions: ["force", "dismiss"] });
  await tdeeScenario("maintain-dismissed", { profile: MAINTAIN, weights: weights({ perWeek: 0.8, noise: 0.3 }), logs: logsOk, state: tdeeState({ goal_mode: "maintain", dismissed_until: addDays(DAY, 5) }) });
  await tdeeScenario("maintain-down", { profile: MAINTAIN, weights: weights({ perWeek: -0.8, noise: 0.3 }), state: tdeeState({ goal_mode: "maintain" }) });
  await tdeeScenario("cooldown", { profile: P.M, weights: weights({ perWeek: -0.1, noise: 0.4 }), logs: logsOk, state: tdeeState({ offset_kcal: -150, prev_offset_kcal: 0, effective_date: addDays(DAY, -4), last_adjusted_date: addDays(DAY, -5) }) });
  await tdeeScenario("capped", { profile: P.M, weights: weights({ perWeek: -0.1, noise: 0.4 }), logs: logsOk, state: tdeeState({ offset_kcal: -300, prev_offset_kcal: -300, last_adjusted_date: addDays(DAY, -30) }) });
  await tdeeScenario("at-floor", { profile: Object.assign({}, WOMAN_SMALL, { goal_mode: "減脂" }), weights: weights({ perWeek: -0.1, start: 48, noise: 0.2 }), logs: logsOk });
  await tdeeScenario("mode-change", { profile: MAINTAIN, weights: weights({ perWeek: -0.1, noise: 0.4 }), state: tdeeState({ goal_mode: "cut", offset_kcal: -150, prev_offset_kcal: -150 }) });
  await tdeeScenario("daily-already-evaluated", { profile: P.M, weights: weights({ perWeek: -1.4, noise: 0.4 }), state: tdeeState({}), actions: ["daily"] });
  await tdeeScenario("daily-not-yet", { profile: P.M, weights: weights({ perWeek: -1.4, noise: 0.4 }), state: tdeeState({ last_evaluated_date: addDays(DAY, -1) }), actions: ["daily"] });
  await tdeeScenario("reset", { profile: P.M, state: tdeeState({ offset_kcal: -300, prev_offset_kcal: -300 }), actions: ["reset"] });
  await tdeeScenario("night-cut-fast", { profile: P.M, weights: weights({ perWeek: -1.4, noise: 0.4 }), now: NOW_NIGHT });

  // 近 7 天平均與單餐份額（engine 函式，畫面上看得到的數字）
  env.setNow(NOW_DAY);
  const t = A.calculateTargets(P.M, 0);
  [["none", []], ["h7", history(7)], ["h2", history(7, { skip: [1, 2, 3, 4, 5] })], ["h7-today", history(7).concat(TODAY_LOGS.bl)]].forEach(([k, logs]) => {
    emit("tdee", "recentAvg/" + k, stable(A.computeRecentAvgVsTarget(logs, t.targetKcal, null, 7)));
    emit("tdee", "recentAvg/" + k + "/allOn", stable(A.computeRecentAvgVsTarget(logs, t.targetKcal, ALL_ON, 7)));
  });
  for (const tk of ["none", "breakfast", "bl", "nullmacro"]) {
    SLOTS.forEach((slot) => {
      emit("tdee", "slotShare/" + tk + "/" + slot, stable(A.slotNutrientShare(t, TODAY_LOGS[tk], null, slot)));
    });
  }
}

async function snapPicker() {
  for (const pk of ["M", "VEG", "VEGAN", "ALLERGY", "LEGACY_ALLERGY", "DISLIKE"]) {
    for (const slot of SLOTS) {
      env.setNow(NOW_DAY);
      A.setDb({ profile: P[pk], dailyLogs: TODAY_LOGS.breakfast, customFoods: CUSTOM_FOODS, tdeeState: tdeeState({ goal_mode: null }) });
      const r = await A.pickerOpen(slot);
      const k = "open/" + pk + "/" + slot;
      emit("picker", k + "/tab", r.tab);
      ["convenience", "delivery", "drinks"].forEach((t) => {
        emit("picker", k + "/" + t + "/pass", r[t].pass.join(","));
        emit("picker", k + "/" + t + "/blocked", r[t].blocked.join(","));
      });
      A.takeDom();
    }
  }

  // 選品項的加總：每個時段、每個商品分頁取第一個 main/side/drink/snack 組合，另外加我的品項（蛋白質等未填）與兩個主餐
  for (const slot of SLOTS) {
    for (const tab of ["convenience", "delivery"]) {
      env.setNow(NOW_DAY);
      A.setDb({ profile: P.M, dailyLogs: TODAY_LOGS.breakfast, customFoods: CUSTOM_FOODS, tdeeState: tdeeState({ goal_mode: null }) });
      await A.pickerOpen(slot);
      A.pickerTab(tab);
      A.takeDom();
      const items = A.pickerPassItems();
      const first = (role) => (items.find((it) => it.role === role) || {}).uid;
      const mains = items.filter((it) => it.role === "main").map((it) => it.uid);
      const picks = {
        main: [first("main")],
        "main+side": [first("main"), first("side")],
        "main+side+drink": [first("main"), first("side"), first("drink")],
        "main+drink+snack": [first("main"), first("drink"), first("snack")],
        "drink-only": [first("drink")],
        "drink-tfda": [items.some((it) => it.uid === "tw_dr05") ? "tw_dr05" : null], // 有 TFDA 鈉值的飲料
        "two-mains": mains.slice(0, 2), // 早午晚可以、下午茶宵夜超量（decisions #41）
        none: [],
      };
      if (tab === "delivery") {
        picks["custom-null"] = ["custom_b", first("drink")];
        picks["custom-carb-null"] = [first("main"), "custom_a"];
      }
      for (const pkName of Object.keys(picks)) {
        const uids = picks[pkName].filter(Boolean);
        const totals = A.pickerSelectItems(uids);
        const k = "items/" + tab + "/" + slot + "/" + pkName;
        emit("picker", k, uids.join("+") + " " + (totals ? normTotals(totals) : "-"));
        A.takeDom().forEach((line, i) => {
          // 分頁、卡片清單、飲料步驟由 open/* 涵蓋，這裡只看摘要、缺口、提示與送出鈕
          if (/^#meal-picker-(panel|drinks|tabs) /.test(line)) return;
          emit("ui", "picker/" + k + "/dom" + String(i).padStart(2, "0"), line);
        });
      }
      // 送出一組，並記住這個時段送出的型態
      A.pickerSelectItems(picks["main+side+drink"].filter(Boolean));
      await A.pickerSubmit();
      A.takeWrites().forEach((w, i) => { if (w.op === "addDailyLog") emit("picker", "items/" + tab + "/" + slot + "/submit" + i, normWrite(w)); });
      A.takeAlerts().forEach((a, i) => emit("picker", "items/" + tab + "/" + slot + "/alert" + i, a));
      emit("picker", "items/" + tab + "/" + slot + "/lastPicked", stable(A.pickerLastPicked()));
      A.takeDom(); A.takeEngineIO();
    }
  }

  // 自煮分頁：每個適用的餐型，第一個蛋白質/主食/蔬菜/醬料/烹調法，各種縮放、多選、用油與調味、快煮與飲料
  for (const slot of ["breakfast", "lunch", "dinner"]) {
    env.setNow(NOW_DAY);
    A.setDb({ profile: P.M, dailyLogs: [], customFoods: CUSTOM_FOODS, tdeeState: tdeeState({ goal_mode: null }) });
    const r = await A.pickerOpen(slot);
    A.takeDom();
    const cat = r.catalog;
    const archetypes = cat.archetypes.filter((a) => (a.valid_slots || []).indexOf(slot) !== -1);
    const first = (list) => (list.length ? [list[0]] : []);
    for (const a of archetypes) {
      const al = (axis) => (a[axis] && a[axis].allow) || [];
      const methods = a.methods || [];
      const base = {
        archetype: a.id, proteins: first(al("protein")), staple: al("staple")[0], vegetables: first(al("vegetable")),
        seasoning: al("seasoning")[0], method: methods[0],
      };
      const variants = {
        s1: {}, "s0.5": { scale: 0.5 }, "s1.3": { scale: 1.3 }, s2: { scale: 2 },
        "no-veg-sauce": { vegetables: [], seasoning: null },
        drink: { drink: r.drinks.pass[0] },
        "no-method": { method: null },
        "last-protein": { proteins: [al("protein")[al("protein").length - 1]], method: methods[methods.length - 1] },
        "two-proteins": { proteins: al("protein").slice(0, 2) },
        "three-veg": { vegetables: al("vegetable").slice(0, 3) },
        "oil-10": { override: { oil_g: 10 } },
        light: { override: { seasoning: "light" } },
        quick: { tier: "cook_quick" },
      };
      for (const vn of Object.keys(variants)) {
        const sel = Object.assign({}, base, variants[vn]);
        const totals = A.pickerCompose(sel);
        const k = "compose/" + slot + "/" + a.id + "/" + vn;
        emit("picker", k, normTotals(totals));
        A.takeDom().forEach((line, i) => {
          if (/^#meal-picker-(summary|gap|hint|submit) /.test(line)) emit("ui", "picker/" + k + "/dom" + String(i).padStart(2, "0"), line);
        });
      }
    }
    // 免開火＋需要加熱的食材：擋下送出（骨架 allow 裡沒有需要加熱的蛋白質，直接指定一個，模擬選擇器以外的來源帶入）
    const noCook = archetypes.find((a) => (a.methods || []).indexOf("method_no_cook") !== -1);
    const cookNeeded = noCook && cat.proteins.find((p) => p.requires_cooking);
    if (noCook && cookNeeded) {
      A.pickerCompose({ archetype: noCook.id, proteins: [cookNeeded.id], staple: ((noCook.staple && noCook.staple.allow) || [])[0], method: "method_no_cook" });
      A.takeDom().forEach((line) => { if (line.indexOf("#meal-picker-hint") === 0) emit("picker", "compose/" + slot + "/no-cook-unsafe", line); });
    }
    // 送出一組自煮（開伙、2 個蛋白質、用油 2 茶匙、配飲料）
    const a0 = archetypes.find((a) => a.id === "protein_stir_fry") || archetypes[0];
    if (a0) {
      A.pickerCompose({ tier: "cook_full", archetype: a0.id, proteins: a0.protein.allow.slice(0, 2), staple: ((a0.staple && a0.staple.allow) || [])[0],
        vegetables: ((a0.vegetable && a0.vegetable.allow) || []).slice(0, 2), method: (a0.methods || [])[0], scale: 1.2, drink: r.drinks.pass[0], override: { oil_g: 10 } });
      await A.pickerSubmit();
      A.takeWrites().forEach((w, i) => { if (w.op === "addDailyLog") emit("picker", "compose/" + slot + "/submit" + i, normWrite(w)); });
      A.takeAlerts().forEach((m, i) => emit("picker", "compose/" + slot + "/alert" + i, m));
      emit("picker", "compose/" + slot + "/lastPicked", stable(A.pickerLastPicked()));
      A.takeDom(); A.takeEngineIO();
    }
  }

  // 外食分頁「找不到？直接估算」（decisions #46）：只有估算、估算＋外食主餐＋飲料，送出的紀錄
  const uiLines = (k) => A.takeDom().forEach((line, i) => {
    if (/^#meal-picker-(summary|gap|hint|submit) /.test(line)) emit("ui", "picker/" + k + "/dom" + String(i).padStart(2, "0"), line);
  });
  for (const slot of ["lunch", "dinner"]) {
    env.setNow(NOW_DAY);
    A.setDb({ profile: P.M, dailyLogs: TODAY_LOGS.breakfast, customFoods: [], tdeeState: tdeeState({ goal_mode: null }) });
    const r = await A.pickerOpen(slot);
    A.takeDom();
    const k = "estimate/" + slot;
    emit("picker", k + "/L-only", normTotals(A.pickerEstimate("L", " 喜宴 ")));
    uiLines(k + "/L-only");
    const main = A.pickerPassItems().find((it) => it.role === "main");
    emit("picker", k + "/L+main+drink", normTotals(A.pickerSelectItems([main.uid, r.drinks.pass[0]])));
    uiLines(k + "/L+main+drink");
    await A.pickerSubmit();
    A.takeWrites().forEach((w, i) => { if (w.op === "addDailyLog") emit("picker", k + "/submit" + i, normWrite(w)); });
    A.takeAlerts().forEach((m, i) => emit("picker", k + "/alert" + i, m));
    A.takeDom(); A.takeEngineIO();
  }

  // 「我的品項」快速新增（decisions #48）：存完能選且有名額就選中；被擋或名額滿不選中並說明；送出前預告不引導改「確認不含」
  const quickCases = [
    ["M/lunch/convenience/main", P.M, "lunch", "convenience", [], { name: "新品健身餐盒", kcal: "520", role: "main", nutrients: { protein_g: "32" } }],
    ["M/lunch/convenience/main-full", P.M, "lunch", "convenience", ["mains2"], { name: "第三個主餐", kcal: "300", role: "main" }],
    ["M/afternoon_tea/delivery/snack", P.M, "afternoon_tea", "delivery", [], { name: "巷口雞蛋糕", kcal: "250" }],
    ["M/breakfast/convenience/drink", P.M, "breakfast", "convenience", [], { name: "自己帶的黑咖啡", kcal: "5", role: "drink", allergenMode: "none" }],
    ["M/lunch/delivery/empty-name", P.M, "lunch", "delivery", [], { name: " ", kcal: "abc" }],
    ["ALLERGY/lunch/delivery/unverified", P.ALLERGY, "lunch", "delivery", [], { name: "朋友做的便當", kcal: "700" }],
    ["ALLERGY/lunch/delivery/confirmed", P.ALLERGY, "lunch", "delivery", [], { name: "確認過的便當", kcal: "700", allergenMode: "none" }],
    ["VEGAN/lunch/convenience/vegan", P.VEGAN, "lunch", "convenience", [], { name: "全素便當", kcal: "600", allergenMode: "none", diet: "vegan" }],
    ["VEGAN/lunch/convenience/undeclared", P.VEGAN, "lunch", "convenience", [], { name: "沒宣告的便當", kcal: "600", allergenMode: "none" }],
    ["M/lunch/convenience/vegan-conflict", P.M, "lunch", "convenience", [], { name: "矛盾的品項", kcal: "300", role: "side", allergenMode: "some", allergens: ["蛋"], diet: "vegan" }],
  ];
  for (const [name, profile, slot, tab, pre, values] of quickCases) {
    env.setNow(NOW_DAY);
    A.setDb({ profile: profile, dailyLogs: [], customFoods: [], tdeeState: tdeeState({ goal_mode: null }) });
    await A.pickerOpen(slot);
    A.pickerTab(tab);
    if (pre.indexOf("mains2") !== -1) A.pickerSelectItems(A.pickerPassItems().filter((it) => it.role === "main").slice(0, 2).map((it) => it.uid));
    A.takeDom();
    const res = await A.pickerQuickAdd(values);
    const k = "quickadd/" + name;
    emit("picker", k, stable(res));
    A.takeWrites().forEach((w, i) => { if (w.op === "addCustomFood") emit("picker", k + "/write" + i, stable(w.record)); });
    uiLines(k);
  }

  // 預設分頁（PRD 第 4 節）：偏好是有效型態就用偏好；auto 時用上次這個時段送出的型態；都沒有停在超商
  const last = { picker_last_meal_type: { lunch: "delivery", afternoon_tea: "delivery", dinner: "convenience" } };
  const prefProfile = (prefs) => Object.assign({}, P.M, { meal_prefs: Object.assign({}, P.M.meal_prefs, prefs) });
  const tabCases = {
    "no-last": [P.M, {}],
    "last": [P.M, last],
    "auto-last": [prefProfile({ lunch: "auto", dinner: "auto" }), last],
    "pref-delivery": [prefProfile({ afternoon_tea: "delivery" }), {}],
  };
  for (const name of Object.keys(tabCases)) {
    for (const slot of SLOTS) {
      env.setNow(NOW_DAY);
      A.setDb({ profile: tabCases[name][0], dailyLogs: [], customFoods: [], tdeeState: tdeeState({ goal_mode: null }), settings: tabCases[name][1] });
      emit("picker", "tab/" + name + "/" + slot, (await A.pickerOpen(slot)).tab);
      A.takeDom();
    }
  }
}

async function snapWeek() {
  const cases = {
    "none": [],
    "h7": history(7),
    "h7-today": history(7).concat(TODAY_LOGS.bl),
    "partial": history(7, { skip: [1, 3] }),
    "nullmacro": history(7).concat([log(addDays(DAY, -1), "snack", 300, null, null, null, null)]),
  };
  for (const name of Object.keys(cases)) {
    for (const now of [NOW_DAY, NOW_NIGHT]) {
      env.setNow(now);
      A.setDb({ profile: P.M, dailyLogs: cases[name], tdeeState: tdeeState({}) });
      await A.weekPage();
      A.takeDom().forEach((line, i) => emit("ui", "week/" + name + (now === NOW_NIGHT ? "-night" : "") + "/dom" + String(i).padStart(2, "0"), line));
    }
  }
  // 週一：本週第一天
  env.setNow("2026-09-21T10:00");
  A.setDb({ profile: P.M, dailyLogs: history(7), tdeeState: tdeeState({ last_evaluated_date: "2026-09-21" }) });
  await A.weekPage();
  A.takeDom().forEach((line, i) => emit("ui", "week/monday/dom" + String(i).padStart(2, "0"), line));
}

async function snapExercise() {
  const ex = (d, type, min, intensity, id) => ({ id: id, log_date: d, activity_type: type, duration_min: min, intensity: intensity });
  const cases = {
    none: [],
    week: [ex(addDays(DAY, -2), "快走", 40, "中", "e1"), ex(addDays(DAY, -1), "重訓", 50, "中", "e2"), ex(DAY, "慢跑", 30, "高", "e3"),
      ex(DAY, "散步", 20, "低", "e4"), ex(addDays(DAY, -9), "游泳", 45, "中", "e5")],
    streakBroken: [ex(addDays(DAY, -1), "瑜伽", 30, "低", "e6"), ex(addDays(DAY, -3), "快走", 30, "中", "e7")],
  };
  for (const name of Object.keys(cases)) {
    env.setNow(NOW_DAY);
    A.setDb({ exerciseLogs: cases[name] });
    A.takeDom();
    await A.exercisePage();
    A.takeDom().forEach((line, i) => emit("ui", "exercise/" + name + "/dom" + String(i).padStart(2, "0"), line));
  }
}

// ---------- 比對 ----------

function parse(text) {
  const map = new Map();
  text.split(/\r?\n/).forEach((line) => {
    if (!line) return;
    const i = line.indexOf("\t");
    const key = i === -1 ? line : line.slice(0, i);
    if (map.has(key)) throw new Error("快照 key 重複：" + key);
    map.set(key, i === -1 ? "" : line.slice(i + 1));
  });
  return map;
}

async function main() {
  const t0 = env.RealDate.now();
  A = await require("./lib/adapter-v2")(ROOT);
  await snapPool();
  await snapMatrix();
  await snapToday();
  await snapTdee();
  await snapPicker();
  await snapWeek();
  await snapExercise();

  if (!fs.existsSync(SNAP_DIR)) fs.mkdirSync(SNAP_DIR);
  let failed = 0;
  for (const file of Object.keys(out)) {
    const text = out[file].join("\n") + "\n";
    parse(text); // 檢查 key 不重複
    const f = path.join(SNAP_DIR, file + ".txt");
    if (UPDATE) {
      fs.writeFileSync(f, text);
      console.log("已寫入 " + path.relative(ROOT, f) + "（" + out[file].length + " 行）");
      continue;
    }
    if (!fs.existsSync(f)) {
      console.log("✗ 缺快照 " + path.relative(ROOT, f) + "（先跑 --update）");
      failed++;
      continue;
    }
    const exp = parse(fs.readFileSync(f, "utf8"));
    const act = parse(text);
    const diffs = [];
    for (const [k, v] of exp) {
      if (!act.has(k)) diffs.push("- " + k + "\t" + v);
      else if (act.get(k) !== v) diffs.push("~ " + k + "\n    預期 " + v + "\n    實際 " + act.get(k));
    }
    for (const [k, v] of act) if (!exp.has(k)) diffs.push("+ " + k + "\t" + v);
    if (diffs.length === 0) {
      console.log("✓ " + file + "（" + act.size + " 行）");
    } else {
      failed++;
      console.log("✗ " + file + "：" + diffs.length + " 處不同");
      (FULL ? diffs : diffs.slice(0, 60)).forEach((d) => console.log("  " + d));
      if (!FULL && diffs.length > 60) console.log("  …（還有 " + (diffs.length - 60) + " 處，加 --full 看全部）");
    }
  }
  console.log("（" + A.name + " adapter，" + (env.RealDate.now() - t0) + " ms）");
  process.exit(UPDATE || failed === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
