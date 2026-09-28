// diff-recs 的 v2 adapter：載入 Phase −1a 改寫後的 ES modules，js/data/db.js 換成記憶體假資料庫（fake-db.mjs）。
// 介面跟 v1 adapter 相同，快照檔不變：改寫前後逐字比對（章程 C6.3）。
// 測試資料的紀錄是 v1 的平面格式，這裡轉成 daily_log 新格式（PRD 第 3 節）再放進假資料庫。

"use strict";

const fs = require("fs");
const path = require("path");
const { pathToFileURL } = require("url");
const Module = require("module");
const { createFakeDocument } = require("./fake-env");

module.exports = async function createV2Adapter(ROOT) {
  const realDb = pathToFileURL(path.join(ROOT, "js", "data", "db.js")).href;
  const fakeDb = pathToFileURL(path.join(__dirname, "fake-db.mjs")).href;
  Module.registerHooks({
    resolve(specifier, context, nextResolve) {
      const r = nextResolve(specifier, context);
      if (r.url === realDb && context.parentURL !== fakeDb) return Object.assign({}, r, { url: fakeDb, shortCircuit: true });
      return r;
    },
  });

  const dom = createFakeDocument();
  global.window = global;
  global.document = dom.document;
  global.fetch = async function (url) {
    const file = path.join(ROOT, url);
    return { ok: fs.existsSync(file), json: async () => JSON.parse(fs.readFileSync(file, "utf8")) };
  };
  const alerts = [];
  global.alert = (msg) => { alerts.push(String(msg)); };

  const imp = (rel) => import(pathToFileURL(path.join(ROOT, rel)).href);
  const fdb = await import(fakeDb);
  const catalogMod = await imp("js/data/catalog.js");
  const pool = await imp("js/engine/pool.js");
  const recommend = await imp("js/engine/recommend.js");
  const nutrition = await imp("js/engine/nutrition.js");
  const budget = await imp("js/engine/budget.js");
  const matcher = await imp("js/engine/matcher.js");
  const filters = await imp("js/engine/filters.js");
  const mc = await imp("js/engine/meal-content.js");
  const clock = await imp("js/ui/clock.js");
  const cal = await imp("js/ui/calibration.js");
  const today = await imp("js/ui/tab-today.js");
  const picker = await imp("js/ui/manual-picker.js");
  const week = await imp("js/ui/tab-week.js");
  const profileTab = await imp("js/ui/tab-profile.js");
  const exercise = await imp("js/ui/tab-exercise.js");

  const clone = (x) => (x == null ? x : JSON.parse(JSON.stringify(x)));

  // v1 平面格式的測試紀錄 → daily_log 新格式（查不到明細的一餐＝估算元件）
  function toLog(l) {
    if (l.totals) return clone(l);
    const totals = { kcal: l.kcal, protein_g: l.protein_g, carb_g: l.carb_g, fat_g: l.fat_g, fiber_g: l.fiber_g };
    return {
      id: l.id, log_date: l.log_date, slot: l.slot, meal_type: "delivery", source: "manual", name: l.item_name,
      content: {
        meal_type: "delivery", archetype_id: null, method_id: null,
        components: [{ kind: "estimate", name: l.item_name, size: null, snapshot: Object.assign({ sat_fat_g: null, sodium_mg: null }, totals) }],
        implicit: null,
      },
      totals: totals, created_at: l.log_date + "T12:00:00.000Z",
    };
  }
  const toLogs = (logs) => (logs || []).map(toLog);

  let io = {};
  const fakeBtn = () => ({ disabled: false });

  return {
    name: "v2",

    setDb(state) {
      globalThis.__fakeDbState = {
        profile: clone(state.profile) || null,
        dailyLogs: toLogs(state.dailyLogs),
        weightLogs: clone(state.weightLogs) || [],
        feedback: clone(state.feedback) || {},
        customFoods: clone(state.customFoods) || [],
        tdeeState: clone(state.tdeeState) || null,
        exerciseLogs: clone(state.exerciseLogs) || [],
        settings: {},
        writes: [],
      };
      fdb.__resetSeq();
      alerts.length = 0;
      io = {};
      dom.reset();
      cal.clearCalibrationCache();
    },
    takeWrites() {
      return globalThis.__fakeDbState.writes.splice(0).map((w) => {
        if (w.op !== "addDailyLog") return w;
        const e = w.entry;
        return { op: w.op, entry: { slot: e.slot, name: e.name, totals: e.totals, meal_type: e.meal_type, source: e.source, content: e.content } };
      });
    },
    takeAlerts() { return alerts.splice(0); },
    takeDom() { const d = dom.dump(); dom.reset(); return d; },
    takeEngineIO() {
      const lp = today.getLastPlan();
      const r = lp && io.fromToday ? {
        targets: clone(lp.targets), remainingBudget: clone(lp.plan.remainingBudget),
        hardConstraints: clone(lp.plan.hardConstraints), skipSlots: clone(lp.plan.skipSlots),
      } : {};
      io = {};
      return r;
    },
    dailyLogsFor: (date) => clone(globalThis.__fakeDbState.dailyLogs.filter((l) => l.log_date === date)),

    // ---------- engine 層 ----------
    pool: async () => pool.buildCandidatePool(await catalogMod.loadCatalog()),
    async recommendRaw(remainingBudget, constraints, prefs, diet, allergens, skip, disliked, lowCarb) {
      return recommend.getTodayRecommendation({
        pool: pool.buildCandidatePool(await catalogMod.loadCatalog()),
        feedbackMap: clone(globalThis.__fakeDbState.feedback),
        remainingBudget: remainingBudget, hardConstraints: constraints, mealPrefs: prefs,
        dietRestriction: diet, allergens: allergens, skipSlots: skip, dislikedIngredients: disliked, lowCarb: !!lowCarb,
        nowMs: clock.nowMs(),
      });
    },
    calculateTargets: (profile, offsetKcal) => nutrition.calculateTargets(profile, { offsetKcal: offsetKcal }),
    recalcTodayBudget: (t, logs, enabled) => budget.recalcTodayBudget(t, toLogs(logs), enabled),
    checkHardConstraints: (logs, profile) => matcher.checkHardConstraints(toLogs(logs), profile, clock.todayStr()),
    slotNutrientShare: (targets, logs, enabled, slot) => budget.slotNutrientShare(targets, toLogs(logs), enabled, slot),
    computeRecentAvgVsTarget: (logs, target, enabled, days) => budget.computeRecentAvgVsTarget(toLogs(logs), target, enabled, days, clock.todayStr()),
    passesHardFilters: (item, profile) => filters.passesHardFilters(item, profile),

    async calibrate(action, profile) {
      if (action === "daily") await cal.ensureDailyCalibration(profile);
      else if (action === "force") await cal.runCalibrationNow(profile);
      else if (action === "confirm") await cal.confirmPendingCalibration();
      else if (action === "dismiss") await cal.dismissPendingCalibration();
      else if (action === "reset") await cal.resetCalibrationOffset();
      else throw new Error("未知的 calibrate action：" + action);
      return clone(globalThis.__fakeDbState.tdeeState);
    },
    getCalibratedTargets: (profile, dateStr) => cal.getCalibratedTargets(profile, dateStr),

    // ---------- 今日建議頁 ----------
    async todayPage() {
      await today.buildRecommendation();
      io.fromToday = true;
      return today.getCurrentRecs();
    },
    currentRecs: () => today.getCurrentRecs(),
    async logRec(slot) { await today.onLogRecClick(slot, today.getCurrentRecs()[slot], fakeBtn()); io.fromToday = true; },
    async undo(logId) { await today.onUndoClick(logId, fakeBtn()); io.fromToday = true; },
    async dislike(slot) { await today.onDislikeClick(today.getCurrentRecs()[slot].id); io.fromToday = true; },
    async dislikeChip(type, key, label) {
      const attrs = { "data-type": type, "data-key": key, "data-label": label };
      await today.onDislikeChipClick({ getAttribute: (k) => attrs[k] });
      io.fromToday = true;
    },

    // ---------- 自己選 ----------
    async pickerOpen(slot) {
      await picker.openManualPicker(slot, today.buildRecommendation);
      const mp = picker.manualPicker;
      return {
        pass: mp.passItems.map((it) => it.uid),
        blocked: mp.blockedItems.map((b) => b.item.uid + ":" + b.reason),
        drinks: mp.compose.drinkItems.map((it) => it.uid),
        axes: mp.compose.axes,
      };
    },
    pickerPassItems: () => picker.manualPicker.passItems.map((it) => ({ uid: it.uid, role: it.role })),
    pickerSelectItems(uids) {
      const mp = picker.manualPicker;
      mp.mode = "items";
      mp.selectedUids = uids.slice();
      picker.renderManualPicker();
      return mc.sumProducts(mp.passItems.filter((it) => uids.indexOf(it.uid) !== -1));
    },
    pickerCompose(sel) {
      const mp = picker.manualPicker;
      const c = mp.compose;
      const ax = c.axes;
      const find = (list, id) => (id ? list.find((x) => x.id === id) || null : null);
      mp.mode = "compose";
      c.archetype = find(ax.archetypes, sel.archetype);
      c.protein = find(ax.proteins, sel.protein);
      c.staple = find(ax.staples, sel.staple);
      c.vegetable = find(ax.vegetables, sel.vegetable);
      c.seasoning = find(ax.sauces, sel.seasoning);
      c.method = find(ax.sauces, sel.method);
      c.primaryScale = sel.scale == null ? 1 : sel.scale;
      c.drink = sel.drink ? c.drinkItems.find((d) => d.uid === sel.drink) || null : null;
      picker.renderManualPicker();
      return picker.currentComposeTotals();
    },
    pickerSubmit: () => picker.onManualSubmit(),

    // ---------- 本週總覽、基本資料的校正卡片、運動 ----------
    weekPage: () => week.renderWeek(),
    async profileCard(profile) {
      profileTab.showTargets(await cal.getCalibratedTargets(profile));
      await profileTab.renderCalibrationCard(profile);
    },
    exercisePage: () => exercise.renderExercise(),
  };
};
