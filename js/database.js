// 輕盈計畫 (Lighten Plan) — 唯一的資料存取層（IndexedDB / localforage）
//
// 設計原則（對照 TECH-SPEC.md 第 3 節）：
// - 每個資料表對應一個 localforage store（用 createInstance 指定 storeName）。
// - 單例表（user_profile）用固定 key 存「單一物件」，永遠 upsert 同一筆，不新增第二筆。
// - 清單表（weight_log / daily_log / exercise_log / …）用固定 key `LIST_KEY` 存「陣列」。
// - 依主鍵查詢的表（tdee_calibration_log / recipe_feedback / weekly_flex_ledger / settings）
//   直接以主鍵當 localforage key 存單一物件。
// - 其他模組（engine/*、ui/*）一律只能透過本檔提供的函式讀寫，不得直接呼叫 localforage。

(function () {
  "use strict";

  if (typeof localforage === "undefined") {
    throw new Error(
      "[database.js] localforage 尚未載入，請確認 CDN <script> 在 database.js 之前載入。"
    );
  }

  const DB_NAME = "lighten";
  const LIST_KEY = "items"; // 清單型 store 內部的固定 key
  const PROFILE_KEY = "primary"; // user_profile 單例的固定 key

  const STORE = {
    userProfile: "user_profile",
    weightLog: "weight_log",
    tdeeCalibration: "tdee_calibration_log",
    recipeTemplates: "recipe_templates",
    recipeFeedback: "recipe_feedback",
    rawIngredients: "raw_ingredients",
    taiwanItems: "taiwan_items",
    customFoods: "custom_foods",
    dailyLog: "daily_log",
    feastReservation: "feast_reservation",
    weeklyFlexLedger: "weekly_flex_ledger",
    overageSmoothing: "overage_smoothing_log",
    exerciseLog: "exercise_log",
    settings: "settings",
  };

  // 每個 store 各自一個 localforage instance（可重複呼叫，會 cache）
  const _instances = {};
  function db(storeName) {
    if (!_instances[storeName]) {
      _instances[storeName] = localforage.createInstance({
        name: DB_NAME,
        storeName: storeName,
      });
    }
    return _instances[storeName];
  }

  // ---------- 工具函式（私有） ----------

  function generateId(prefix) {
    return (
      prefix +
      "_" +
      Date.now().toString(36) +
      "_" +
      Math.random().toString(36).slice(2, 8)
    );
  }

  // dateRange: { start?: 'YYYY-MM-DD', end?: 'YYYY-MM-DD' }（含當天）；省略任一側代表不限
  function inDateRange(dateStr, dateRange) {
    if (!dateRange) return true;
    const start = dateRange.start || null;
    const end = dateRange.end || null;
    if (start && dateStr < start) return false;
    if (end && dateStr > end) return false;
    return true;
  }

  // filter 為選填物件，目前支援：
  //   { slot?, tier?, dietRestriction?, excludeAllergens? }
  // 後續 recommend.js（TASK 7）若需要更複雜的過濾，再擴充這裡。
  function applyFilter(list, filter) {
    if (!filter) return list;
    return list.filter(function (item) {
      if (filter.slot && item.slot !== filter.slot) return false;
      if (filter.tier && item.tier !== filter.tier) return false;
      if (
        filter.dietRestriction &&
        item.diet_tags &&
        item.diet_tags.indexOf(filter.dietRestriction) === -1
      ) {
        return false;
      }
      if (filter.excludeAllergens) {
        const exclude = Array.isArray(filter.excludeAllergens)
          ? filter.excludeAllergens
          : [filter.excludeAllergens];
        if (exclude.length > 0) {
          // 2026-09-25 修正（Opus 審查發現的安全漏洞）：原本 `item.allergen_tags &&` 這個短路判斷，
          // 會讓「完全沒有 allergen_tags 欄位」的品項在使用者設定過敏原時直接放行（因為條件式整個是 false，
          // 不會進到過濾邏輯）。改成：只要使用者有過敏原限制，品項缺過敏原資料就保守排除，不能預設安全。
          if (!Array.isArray(item.allergen_tags)) return false;
          for (let i = 0; i < exclude.length; i++) {
            if (item.allergen_tags.indexOf(exclude[i]) !== -1) return false;
          }
        }
      }
      return true;
    });
  }

  async function readList(storeName) {
    const list = await db(storeName).getItem(LIST_KEY);
    return Array.isArray(list) ? list : [];
  }

  async function writeList(storeName, list) {
    await db(storeName).setItem(LIST_KEY, list);
    return list;
  }

  // ---------- 1. user_profile（單例） ----------

  async function getProfile() {
    return await db(STORE.userProfile).getItem(PROFILE_KEY);
  }

  async function saveProfile(profile) {
    // 單例寫入：固定 key 直接覆寫同一筆，絕不 push 進陣列。
    await db(STORE.userProfile).setItem(PROFILE_KEY, profile);
    return profile;
  }

  // ---------- 2. weight_log ----------

  async function addWeightLog(entry) {
    const list = await readList(STORE.weightLog);
    const idx = list.findIndex(function (e) {
      return e.log_date === entry.log_date;
    });
    if (idx >= 0) {
      list[idx] = entry; // 同日覆寫
    } else {
      list.push(entry);
    }
    await writeList(STORE.weightLog, list);
    return entry;
  }

  async function getWeightLogs(dateRange) {
    const list = await readList(STORE.weightLog);
    return list.filter(function (e) {
      return inDateRange(e.log_date, dateRange);
    });
  }

  // ---------- 3. tdee_calibration_log（依週一主鍵） ----------

  async function getTdeeCalibration(weekStartDate) {
    return await db(STORE.tdeeCalibration).getItem(weekStartDate);
  }

  async function saveTdeeCalibration(entry) {
    await db(STORE.tdeeCalibration).setItem(entry.week_start_date, entry);
    return entry;
  }

  // ---------- 4. recipe_templates / recipe_feedback ----------

  async function getRecipeTemplates(filter) {
    const list = await readList(STORE.recipeTemplates);
    return applyFilter(list, filter);
  }

  async function getRecipeFeedback(id) {
    return await db(STORE.recipeFeedback).getItem(id);
  }

  // 2026-09-25 新增（Opus 審查建議）：候選池規模隨蔬菜軸/超商多品項組合/台式品項越來越大，
  // 逐一 getRecipeFeedback() 對每個候選各呼叫一次 localforage 讀取效能不佳。改用 iterate 一次撈全部。
  async function getAllRecipeFeedback() {
    const map = {};
    await db(STORE.recipeFeedback).iterate(function (value, key) {
      map[key] = value;
    });
    return map;
  }

  async function saveRecipeFeedback(id, rating) {
    const existing = (await getRecipeFeedback(id)) || {};
    const updated = Object.assign({}, existing, {
      recipe_template_id: id,
      rating: rating, // 'like' / 'dislike' / null
      shown_count: (existing.shown_count || 0) + 1,
    });
    await db(STORE.recipeFeedback).setItem(id, updated);
    return updated;
  }

  // 2026-09-25 二輪重構修正既有 bug（Opus 三輪磋商時查出）：`recommend.js` 的 score() 一直有讀
  // shown_count/last_shown_date 做「近期出現過降權」，但全專案唯一會寫入這兩個欄位的地方是
  // saveRecipeFeedback()，只在使用者按「倒讚」時才呼叫——單純把某個組合顯示給使用者看，從來沒有
  // 被記錄過，導致這條降權邏輯從實作以來就是死碼（跟交接筆記裡「shown_count只在倒讚時更新」是
  // 同一個問題，這次順便修）。新增這個函式，在畫面實際渲染出推薦卡片時呼叫，只累加 shown_count/
  // 更新 last_shown_date，不動 rating；同一天重複渲染（例如記錄一餐後重新整理）不重複累加。
  function todayStr() {
    const d = new Date();
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  }

  async function markRecipesShown(ids) {
    const today = todayStr();
    for (let i = 0; i < ids.length; i++) {
      const id = ids[i];
      const existing = (await getRecipeFeedback(id)) || {};
      if (existing.last_shown_date === today) continue;
      const updated = Object.assign({}, existing, {
        recipe_template_id: id,
        shown_count: (existing.shown_count || 0) + 1,
        last_shown_date: today,
      });
      await db(STORE.recipeFeedback).setItem(id, updated);
    }
  }

  // ---------- 5. raw_ingredients / taiwan_items / custom_foods ----------

  async function getRawIngredients() {
    return await readList(STORE.rawIngredients);
  }

  // 2026-09-25 修正（Opus 審查發現的既有 bug）：taiwan_items 是靜態種子資料（data/taiwan_items.json），
  // 不是使用者會寫入的清單，本來就不該經過 IndexedDB 的 STORE.taiwanItems（那個 store 從來沒有任何程式碼
  // 寫入過，getTaiwanItems() 過去一直回傳空陣列，「台式熱門品項參考」畫面因此從未真的顯示過資料，
  // feast.js 的品項查找也一直失敗回退成小/中/大估算）。改成跟 recommend.js 讀 protein_sources.json 等
  // 種子檔一樣的做法：直接 fetch JSON、快取在記憶體，不進資料庫。
  let _taiwanItemsCache = null;
  async function getTaiwanItems(filter) {
    if (!_taiwanItemsCache) {
      const res = await fetch("data/taiwan_items.json");
      if (!res.ok) throw new Error("[database.js] 載入 taiwan_items.json 失敗");
      _taiwanItemsCache = await res.json();
    }
    return applyFilter(_taiwanItemsCache, filter);
  }

  async function getCustomFoods() {
    return await readList(STORE.customFoods);
  }

  async function addCustomFood(food) {
    const list = await readList(STORE.customFoods);
    if (!food.id) food.id = generateId("custom");
    list.push(food);
    await writeList(STORE.customFoods, list);
    return food;
  }

  // ---------- 6. daily_log ----------

  async function addDailyLog(entry) {
    const list = await readList(STORE.dailyLog);
    if (!entry.id) entry.id = generateId("day");
    list.push(entry);
    await writeList(STORE.dailyLog, list);
    return entry;
  }

  async function getDailyLogs(dateRange) {
    const list = await readList(STORE.dailyLog);
    return list.filter(function (e) {
      return inDateRange(e.log_date, dateRange);
    });
  }

  // 2026-09-25 新增（Opus 審查指出完全沒有刪除 daily_log 的函式，導致「直接記錄大餐」無法撤銷）
  async function removeDailyLog(id) {
    const list = await readList(STORE.dailyLog);
    const filtered = list.filter(function (e) { return e.id !== id; });
    await writeList(STORE.dailyLog, filtered);
    return filtered.length !== list.length;
  }

  // ---------- 7. feast_reservation ----------

  async function addFeastReservation(entry) {
    const list = await readList(STORE.feastReservation);
    if (!entry.id) entry.id = generateId("feast");
    if (!entry.status) entry.status = "reserved";
    list.push(entry);
    await writeList(STORE.feastReservation, list);
    return entry;
  }

  async function getFeastReservations(filter) {
    const list = await readList(STORE.feastReservation);
    if (!filter) return list;
    return list.filter(function (e) {
      if (filter.status && e.status !== filter.status) return false;
      if (filter.start && e.plan_date < filter.start) return false;
      if (filter.end && e.plan_date > filter.end) return false;
      return true;
    });
  }

  async function updateFeastStatus(id, status, daylogId) {
    const list = await readList(STORE.feastReservation);
    const entry = list.find(function (e) {
      return e.id === id;
    });
    if (!entry) return null;
    entry.status = status;
    if (daylogId !== undefined) entry.daily_log_id = daylogId;
    await writeList(STORE.feastReservation, list);
    return entry;
  }

  // ---------- 8. weekly_flex_ledger（依週一主鍵） ----------

  async function getWeeklyLedger(weekStartDate) {
    return await db(STORE.weeklyFlexLedger).getItem(weekStartDate);
  }

  async function updateWeeklyLedger(weekStartDate, usedKcal, capKcal) {
    const existing = (await getWeeklyLedger(weekStartDate)) || {};
    const updated = Object.assign({}, existing, {
      week_start_date: weekStartDate,
      used_kcal: usedKcal,
    });
    if (capKcal !== undefined && capKcal !== null) updated.cap_kcal = capKcal;
    await db(STORE.weeklyFlexLedger).setItem(weekStartDate, updated);
    return updated;
  }

  // ---------- 9. overage_smoothing_log ----------

  async function addOverageSmoothing(entry) {
    const list = await readList(STORE.overageSmoothing);
    if (!entry.id) entry.id = generateId("overage");
    list.push(entry);
    await writeList(STORE.overageSmoothing, list);
    return entry;
  }

  async function getOverageSmoothing(weekStartDate) {
    const list = await readList(STORE.overageSmoothing);
    return list.filter(function (e) {
      return e.origin_week_start_date === weekStartDate;
    });
  }

  // ---------- 10. exercise_log ----------

  async function addExerciseLog(entry) {
    const list = await readList(STORE.exerciseLog);
    if (!entry.id) entry.id = generateId("ex");
    list.push(entry);
    await writeList(STORE.exerciseLog, list);
    return entry;
  }

  async function getExerciseLogs(dateRange) {
    const list = await readList(STORE.exerciseLog);
    return list.filter(function (e) {
      return inDateRange(e.log_date, dateRange);
    });
  }

  // ---------- 11. settings（key-value） ----------

  async function getSetting(key) {
    return await db(STORE.settings).getItem(key);
  }

  async function setSetting(key, value) {
    await db(STORE.settings).setItem(key, value);
    return value;
  }

  // ---------- 對外暴露（bare 全域函式，供 console 驗證與其他模組使用） ----------

  const api = {
    getProfile: getProfile,
    saveProfile: saveProfile,
    addWeightLog: addWeightLog,
    getWeightLogs: getWeightLogs,
    getTdeeCalibration: getTdeeCalibration,
    saveTdeeCalibration: saveTdeeCalibration,
    getRecipeTemplates: getRecipeTemplates,
    getRecipeFeedback: getRecipeFeedback,
    getAllRecipeFeedback: getAllRecipeFeedback,
    saveRecipeFeedback: saveRecipeFeedback,
    markRecipesShown: markRecipesShown,
    getRawIngredients: getRawIngredients,
    getTaiwanItems: getTaiwanItems,
    getCustomFoods: getCustomFoods,
    addCustomFood: addCustomFood,
    addDailyLog: addDailyLog,
    getDailyLogs: getDailyLogs,
    removeDailyLog: removeDailyLog,
    addFeastReservation: addFeastReservation,
    getFeastReservations: getFeastReservations,
    updateFeastStatus: updateFeastStatus,
    getWeeklyLedger: getWeeklyLedger,
    updateWeeklyLedger: updateWeeklyLedger,
    addOverageSmoothing: addOverageSmoothing,
    getOverageSmoothing: getOverageSmoothing,
    addExerciseLog: addExerciseLog,
    getExerciseLogs: getExerciseLogs,
    getSetting: getSetting,
    setSetting: setSetting,
  };

  Object.assign(window, api);
})();
