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
  const picker = await imp("js/ui/meal-picker/index.js");
  const engPicker = await imp("js/engine/picker.js");
  const quickAdd = await imp("js/ui/meal-picker/quick-add.js");
  const week = await imp("js/ui/tab-week.js");
  const profileTab = await imp("js/ui/tab-profile.js");
  const exercise = await imp("js/ui/tab-exercise.js");

  const clone = (x) => (x == null ? x : JSON.parse(JSON.stringify(x)));

  // v1 平面格式的測試紀錄 → daily_log 新格式（查不到明細的一餐＝估算元件）
  function toLog(l) {
    if (l.totals) return clone(l);
    const totals = { kcal: l.kcal, protein_g: l.protein_g, carb_g: l.carb_g, fat_g: l.fat_g, fiber_g: l.fiber_g, sat_fat_g: null, sodium_mg: null, partial: [] };
    return {
      id: l.id, log_date: l.log_date, slot: l.slot, meal_type: "delivery", source: "manual", name: l.item_name,
      content: {
        meal_type: "delivery", archetype_id: null, method_id: null,
        components: [{ kind: "estimate", name: l.item_name, size: null, snapshot: {
          kcal: totals.kcal, protein_g: totals.protein_g, carb_g: totals.carb_g, fat_g: totals.fat_g, fiber_g: totals.fiber_g, sat_fat_g: null, sodium_mg: null,
        } }],
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
        settings: clone(state.settings) || {},
        savedMeals: clone(state.savedMeals) || [],
        customIngredients: clone(state.customIngredients) || [],
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

    // ---------- 自己選（三分頁選擇器） ----------
    // 回傳打開時停的分頁，以及各分頁、飲料步驟的可選／被擋（uid:原因）
    async pickerOpen(slot) {
      await picker.openMealPicker(slot, today.buildRecommendation);
      const mp = picker.mealPicker;
      const split = (t) => ({
        pass: t.items.filter((it) => !t.reasons[it.uid]).map((it) => it.uid),
        blocked: t.items.filter((it) => t.reasons[it.uid]).map((it) => it.uid + ":" + t.reasons[it.uid]),
        // 畫面放到最下方「你標了不吃」組的（engine splitDisliked，依原因代碼；工作線 D 切片 2 計畫 S10）
        disliked: engPicker.splitDisliked(t.items, (it) => (t.codes || {})[it.uid]).disliked.map((it) => it.uid),
      });
      // 單品（工作線 D 切片 7，審核 S6）：被擋的 uid:灰字（不含標了不吃的）與標了不吃的
      const f = mp.foods;
      const foods = {
        blocked: f.items.filter((it) => f.labels[it.uid] && f.codes[it.uid] !== "disliked").map((it) => it.uid + ":" + f.labels[it.uid]),
        disliked: f.items.filter((it) => f.codes[it.uid] === "disliked").map((it) => it.uid),
      };
      return { tab: mp.tab, convenience: split(mp.tabs.convenience), delivery: split(mp.tabs.delivery), drinks: split(mp.drinks), foods: foods, catalog: mp.catalog };
    },
    pickerTab(tab) { picker.selectTab(tab); },
    // 目前分頁可選的品項＋可選的飲料
    pickerPassItems() {
      const mp = picker.mealPicker;
      const t = mp.tabs[mp.tab] || { items: [], reasons: {} };
      return t.items.concat(mp.drinks.items).filter((it) => !t.reasons[it.uid] && !mp.drinks.reasons[it.uid]).map((it) => ({ uid: it.uid, role: it.role }));
    },
    // 目前分頁的選取（飲料放進飲料步驟），回傳摘要用的合計
    pickerSelectItems(uids) {
      const mp = picker.mealPicker;
      const drinkUids = mp.drinks.items.map((d) => d.uid);
      mp.tabs[mp.tab].selected = uids.filter((u) => drinkUids.indexOf(u) === -1);
      mp.drinkUid = uids.filter((u) => drinkUids.indexOf(u) !== -1)[0] || null;
      picker.renderMealPicker();
      return picker.currentTotals();
    },
    // 自煮分頁：sel = { tier, archetype, proteins: [id], staple, vegetables: [id], seasoning, method, scale, drink, override: { oil_g?, seasoning? } }
    pickerCompose(sel) {
      const mp = picker.mealPicker;
      const cat = mp.catalog;
      const find = (list, id) => (id ? list.find((x) => x.id === id) || null : null);
      picker.selectTab("cook");
      mp.cook.tier = sel.tier || "cook_full";
      mp.cook.draft = {
        archetype: find(cat.archetypes, sel.archetype),
        proteins: (sel.proteins || []).map((id) => find(cat.ingredients, id)).filter(Boolean),
        staple: find(cat.staples, sel.staple),
        vegetables: (sel.vegetables || []).map((id) => find(cat.vegetables, id)).filter(Boolean),
        seasoning: find(cat.sauces, sel.seasoning),
        method: find(cat.sauces, sel.method),
        primaryScale: sel.scale == null ? 1 : sel.scale,
        implicitOverride: Object.assign({}, sel.override),
      };
      mp.drinkUid = sel.drink || null;
      picker.renderMealPicker();
      return picker.currentTotals();
    },
    // 外食分頁的「找不到？直接估算」
    pickerEstimate(size, name) {
      picker.selectTab("delivery");
      picker.addEstimate(size, name);
      return picker.currentTotals();
    },
    // 快速新增：values 同表單（quick-add.js emptyQuickAdd 的形狀，只給要改的欄位）；回傳送出前預告、存完的說明與目前分頁的選取
    async pickerQuickAdd(values) {
      const mp = picker.mealPicker;
      const v = Object.assign(quickAdd.emptyQuickAdd(mp.slot), values, { nutrients: Object.assign(quickAdd.emptyQuickAdd(mp.slot).nutrients, values.nutrients) });
      const notes = quickAdd.quickAddNotes(v, mp.slot, mp.tab, mp.profile);
      const saved = await picker.saveQuickAdd(v);
      const t = mp.tabs[mp.tab];
      return { notes: notes, saved: saved ? saved.id : null, message: mp.quickAddMessage, selected: t.selected.slice(), drink: mp.drinkUid };
    },
    // 份量倍數（PRD 12.3）：設定某個已選品項或飲料的份量，回傳摘要用的合計
    pickerSetQty(uid, q) {
      const mp = picker.mealPicker;
      mp.qtyByUid[uid] = q;
      picker.renderMealPicker();
      return picker.currentTotals();
    },
    // 單品（工作線 D 切片 7）：直接設已選的單品 [{ uid, qty }]，回傳摘要用的合計
    pickerFoods(sel) {
      const mp = picker.mealPicker;
      mp.foodSel = sel.map((x) => (x.amount != null ? { uid: x.uid, amount: x.amount } : { uid: x.uid, qty: x.qty }));
      picker.renderMealPicker();
      return picker.currentTotals();
    },
    pickerFoodSel: () => picker.mealPicker.foodSel.map((x) => (x.amount != null ? { uid: x.uid, amount: x.amount } : { uid: x.uid, qty: x.qty })),
    // 點一張單品卡片（同 index.js onFoodClick：第 5 項 alert、再點已選的不新增）
    pickerAddFood(uid) {
      const mp = picker.mealPicker;
      const r = engPicker.addFood(mp.foodSel, uid);
      if (r.problem) { alert(r.problem); return; }
      mp.foodSel = r.sel;
      picker.renderMealPicker();
    },
    // 我的組合（工作線 C）：組合列、帶入、入口 1 的勾選、編輯模式
    pickerSavedCards: () => clone(picker.mealPicker.savedCards),
    pickerLoadSaved(id) { return picker.loadSavedMeal(id); },
    pickerSaveAs(name) {
      picker.mealPicker.saveAs = { on: true, name: name, nameEdited: name != null };
      picker.renderMealPicker();
    },
    async pickerOpenEdit(id) {
      const rec = (globalThis.__fakeDbState.savedMeals || []).find((r) => r.id === id);
      await picker.openMealPicker(null, { savedEdit: clone(rec) });
    },
    // 帶入後的狀態：分頁、各分頁選取、飲料、份量、單品、自煮草稿（id）、說明
    pickerState() {
      const mp = picker.mealPicker;
      const d = mp.cook.draft || {};
      const ids = (l) => (l || []).map((x) => x.id);
      return {
        tab: mp.tab, tier: mp.cook.tier, selected: { convenience: mp.tabs.convenience.selected.slice(), delivery: mp.tabs.delivery.selected.slice() },
        drink: mp.drinkUid, qty: clone(mp.qtyByUid), foods: clone(mp.foodSel), inserted: clone(mp.inserted),
        cook: { archetype: d.archetype ? d.archetype.id : null, proteins: ids(d.proteins), staple: d.staple ? d.staple.id : null, vegetables: ids(d.vegetables),
          seasoning: d.seasoning ? d.seasoning.id : null, method: d.method ? d.method.id : null, override: clone(d.implicitOverride) },
        notice: mp.savedNotice,
      };
    },
    pickerSubmit: () => picker.onMealSubmit(),
    pickerLastPicked: () => clone(globalThis.__fakeDbState.settings.picker_last_meal_type) || null,

    // ---------- 本週總覽、基本資料的校正卡片、運動 ----------
    weekPage: () => week.renderWeek(),
    async profileCard(profile) {
      profileTab.showTargets(await cal.getCalibratedTargets(profile));
      await profileTab.renderCalibrationCard(profile);
    },
    exercisePage: () => exercise.renderExercise(),
  };
};
