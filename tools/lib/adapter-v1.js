// diff-recs 的 v1 adapter：用 vm 載入還沒改寫的 v1 程式（IIFE＋window 全域），資料庫換成記憶體假資料。
// 今日建議、本週總覽、「自己選」直接跑 v1 自己的流程（不另寫一份仿製版），只在檔尾注入幾個私有函式的出口。
// Phase −1a 重構完成後，這支換成 adapter-v2（同樣的介面、讀新模組），快照檔不變。

"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { createFakeDocument } = require("./fake-env");

module.exports = function createV1Adapter(ROOT) {
  const readJson = (f) => JSON.parse(fs.readFileSync(path.join(ROOT, "data", f), "utf8"));
  const taiwanData = readJson("taiwan_items.json");

  const dom = createFakeDocument();
  global.window = global;
  global.document = dom.document;
  global.fetch = async function (url) {
    const file = path.join(ROOT, url);
    return { ok: fs.existsSync(file), json: async () => JSON.parse(fs.readFileSync(file, "utf8")) };
  };
  const alerts = [];
  global.alert = (msg) => { alerts.push(String(msg)); };

  // ---------- 假資料庫（行為照 js/database.js） ----------
  const clone = (x) => (x == null ? x : JSON.parse(JSON.stringify(x)));
  let db = null;
  const writes = [];
  function inDateRange(dateStr, r) {
    if (!r) return true;
    if (r.start && dateStr < r.start) return false;
    if (r.end && dateStr > r.end) return false;
    return true;
  }
  let idSeq = 0;
  Object.assign(global, {
    getProfile: async () => clone(db.profile),
    saveProfile: async (p) => { db.profile = clone(p); writes.push({ op: "saveProfile", disliked: clone(p.disliked_ingredients) }); return p; },
    getDailyLogs: async (r) => clone(db.dailyLogs.filter((e) => inDateRange(e.log_date, r))),
    addDailyLog: async (entry) => {
      if (!entry.id) entry.id = "day_" + (++idSeq);
      db.dailyLogs.push(clone(entry));
      writes.push({ op: "addDailyLog", entry: clone(entry) });
      return entry;
    },
    removeDailyLog: async (id) => {
      const n = db.dailyLogs.length;
      db.dailyLogs = db.dailyLogs.filter((e) => e.id !== id);
      writes.push({ op: "removeDailyLog", id: id });
      return db.dailyLogs.length !== n;
    },
    getWeightLogs: async (r) => clone(db.weightLogs.filter((e) => inDateRange(e.log_date, r))),
    getAllRecipeFeedback: async () => clone(db.feedback),
    saveRecipeFeedback: async (id, rating) => {
      const ex = db.feedback[id] || {};
      db.feedback[id] = Object.assign({}, ex, { recipe_template_id: id, rating: rating, shown_count: (ex.shown_count || 0) + 1 });
      writes.push({ op: "saveRecipeFeedback", id: id, rating: rating });
    },
    markRecipesShown: async (ids) => { writes.push({ op: "markRecipesShown", ids: ids.slice() }); },
    getCustomFoods: async () => clone(db.customFoods),
    getTaiwanItems: async () => taiwanData,
    getFeastReservations: async () => [], // 快照測試資料不含預約（PRD 第 7 節 −1a 驗收）
    resolveFeastItem: async () => { throw new Error("快照測試不應該走到預約分支"); },
    undoDailyLog: async (id) => {
      const entry = db.dailyLogs.find((l) => l.id === id);
      if (!entry) return null;
      if (entry.feast_reservation_id) throw new Error("[feast.js] 這筆記錄關聯到一筆預約，請改用取消預約。");
      await global.removeDailyLog(id);
      return entry;
    },
    getTdeeState: async () => clone(db.tdeeState) || defaultTdeeState(),
    saveTdeeState: async (s) => { db.tdeeState = clone(s); return s; },
  });

  function defaultTdeeState() {
    return {
      version: 1, offset_kcal: 0, prev_offset_kcal: 0, effective_date: null, last_adjusted_date: null,
      last_evaluated_date: null, goal_mode: null, mode_since_date: null, pending: null, dismissed_until: null,
      announce_until: null, last_result: null, history: [],
    };
  }

  function load(rel, exportsExpr) {
    let src = fs.readFileSync(path.join(ROOT, rel), "utf8");
    if (exportsExpr) {
      const i = src.lastIndexOf("})();");
      if (i === -1) throw new Error(rel + " 找不到 IIFE 結尾");
      src = src.slice(0, i) + exportsExpr + "\n" + src.slice(i);
    }
    vm.runInThisContext(src, { filename: rel });
  }

  load("js/engine/nutrition.js");
  load("js/engine/budget.js");
  load("js/engine/matcher.js");
  load("js/engine/recommend.js");
  load("js/ui/item-picker.js");
  load("js/engine/tdee.js");
  load("js/ui/tab-today.js",
    "window.__today = { buildRecommendation: buildRecommendation, getCurrentRecs: function () { return currentRecs; }," +
    " manualPicker: manualPicker, openManualPicker: openManualPicker, renderManualPicker: renderManualPicker," +
    " updateManualSummary: updateManualSummary, composeTotals: composeTotals, onLogRecClick: onLogRecClick," +
    " onUndoClick: onUndoClick, onManualSubmit: onManualSubmit };");
  load("js/ui/tab-week.js", "window.__week = { render: render };");

  const T = global.__today;

  // 監看今日建議流程呼叫引擎的輸入輸出（v1 的畫面用裸全域名稱呼叫，所以包一層就攔得到）。
  let io = {};
  function spy(name, onCall) {
    const orig = global[name];
    global[name] = function () {
      const r = orig.apply(this, arguments);
      onCall(r, arguments);
      return r;
    };
  }
  spy("recalcTodayBudget", (r) => { io.remainingBudget = clone(r); });
  spy("checkHardConstraints", (r) => { io.hardConstraints = clone(r); });
  spy("getTodayRecommendation", (r, a) => { io.skipSlots = clone(a[5]); });
  // getCalibratedTargets 每次重載 tdee.js 都會被覆寫，改在 freshTdee() 之後包
  function spyTargets() {
    const orig = global.getCalibratedTargets;
    global.getCalibratedTargets = async function (profile, dateStr) {
      const r = await orig(profile, dateStr);
      if (dateStr === undefined) io.targets = clone(r);
      return r;
    };
  }

  // 每個情境重新載入 tdee.js：ensureDailyCalibration 以日期快取 Promise，不重載會沿用上一個情境的結果。
  function freshTdee() { load("js/engine/tdee.js"); spyTargets(); }

  const fakeBtn = () => ({ disabled: false });

  return {
    name: "v1",

    setDb(state) {
      db = {
        profile: clone(state.profile) || null,
        dailyLogs: clone(state.dailyLogs) || [],
        weightLogs: clone(state.weightLogs) || [],
        feedback: clone(state.feedback) || {},
        customFoods: clone(state.customFoods) || [],
        tdeeState: clone(state.tdeeState) || null,
      };
      writes.length = 0;
      alerts.length = 0;
      idSeq = 0;
      dom.reset();
      freshTdee();
    },
    takeWrites() { const w = writes.splice(0); return w; },
    takeAlerts() { const a = alerts.splice(0); return a; },
    takeDom() { const d = dom.dump(); dom.reset(); return d; },
    takeEngineIO() { const r = io; io = {}; return r; },
    dailyLogsFor: (date) => clone(db.dailyLogs.filter((l) => l.log_date === date)),

    // ---------- engine 層 ----------
    pool: () => global.buildRecommendCandidatePool(),
    recommendRaw: (budget, constraints, prefs, diet, allergens, skip, disliked) =>
      global.getTodayRecommendation(budget, constraints, prefs, diet, allergens, skip, disliked),
    calculateTargets: (profile, offsetKcal) => global.calculateTargets(profile, { offsetKcal: offsetKcal }),
    recalcTodayBudget: (t, logs, enabled) => global.recalcTodayBudget(t, logs, enabled),
    checkHardConstraints: (logs, profile) => global.checkHardConstraints(logs, profile),
    slotNutrientShare: (targets, logs, enabled, slot) => global.slotNutrientShare(targets, logs, enabled, slot),
    computeRecentAvgVsTarget: (logs, target, enabled, days) => global.computeRecentAvgVsTarget(logs, target, enabled, days),
    passesHardFilters: (item, profile) => global.passesHardFilters(item, profile),

    // 體重校正：action = daily | force | confirm | dismiss | reset
    async calibrate(action, profile) {
      if (action === "daily") await global.ensureDailyCalibration(profile);
      else if (action === "force") await global.runCalibrationNow(profile);
      else if (action === "confirm") await global.confirmPendingCalibration();
      else if (action === "dismiss") await global.dismissPendingCalibration();
      else if (action === "reset") await global.resetCalibrationOffset();
      else throw new Error("未知的 calibrate action：" + action);
      return clone(db.tdeeState);
    },
    getCalibratedTargets: (profile, dateStr) => global.getCalibratedTargets(profile, dateStr),

    // ---------- 今日建議頁 ----------
    async todayPage() {
      await T.buildRecommendation();
      return T.getCurrentRecs();
    },
    currentRecs: () => T.getCurrentRecs(),
    logRec: (slot) => T.onLogRecClick(slot, T.getCurrentRecs()[slot], fakeBtn()),
    undo: (logId) => T.onUndoClick(logId, fakeBtn()),

    // ---------- 自己選 ----------
    async pickerOpen(slot) {
      await T.openManualPicker(slot);
      const mp = T.manualPicker;
      return {
        pass: mp.passItems.map((it) => it.uid),
        blocked: mp.blockedItems.map((b) => b.item.uid + ":" + b.reason),
        drinks: mp.compose.drinkItems.map((it) => it.uid),
        axes: mp.compose.axes,
      };
    },
    pickerPassItems: () => T.manualPicker.passItems.map((it) => ({ uid: it.uid, role: it.role })),
    pickerSelectItems(uids) {
      const mp = T.manualPicker;
      mp.mode = "items";
      mp.selectedUids = uids.slice();
      T.renderManualPicker();
      return global.ItemPicker.sumSelected(mp.passItems.filter((it) => uids.indexOf(it.uid) !== -1));
    },
    // sel = { archetype, protein, staple, vegetable, seasoning, method, scale, drink }（皆為 id，drink 為 uid）
    pickerCompose(sel) {
      const mp = T.manualPicker;
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
      T.renderManualPicker();
      return T.composeTotals();
    },
    pickerSubmit: () => T.onManualSubmit(),

    // ---------- 本週總覽 ----------
    weekPage: () => global.__week.render(),
  };
};
