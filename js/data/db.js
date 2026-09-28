// 輕盈計畫 — 唯一的資料存取層：瀏覽器原生 IndexedDB 的薄封裝（章程 C1.4、C1.5、C2）。
// - 資料庫名稱 lighten2；settings 的 key 一律加 "lighten2." 前綴。
// - 清單型資料（daily_log、weight_log、exercise_log、custom_foods）一筆紀錄一個 key，不整包陣列讀改寫。
// - 寫入前先驗證（驗證不過直接丟錯，不會碰到資料庫）；傳入陣列一律報錯。
// - 其他模組只能透過這裡的函式讀寫，不得直接開 IndexedDB。

import { MEAL_TYPES, LOG_SOURCES } from "../core/config.js";
import { SLOTS } from "../core/slots.js";

const DB_NAME = "lighten2";
const DB_VERSION = 1;
const SETTING_PREFIX = "lighten2.";
const PROFILE_KEY = "primary";

const STORE = {
  userProfile: "user_profile",       // 單例，key = "primary"
  weightLog: "weight_log",           // keyPath log_date（同一天覆寫）
  dailyLog: "daily_log",             // keyPath id，索引 log_date
  exerciseLog: "exercise_log",       // keyPath id，索引 log_date
  customFoods: "custom_foods",       // keyPath id
  recipeFeedback: "recipe_feedback", // key = 推薦組合 id
  settings: "settings",              // key = "lighten2." + 名稱
};

let _dbPromise = null;

function openDb() {
  if (!_dbPromise) {
    _dbPromise = new Promise(function (resolve, reject) {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = function () {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE.userProfile)) db.createObjectStore(STORE.userProfile);
        if (!db.objectStoreNames.contains(STORE.weightLog)) db.createObjectStore(STORE.weightLog, { keyPath: "log_date" });
        if (!db.objectStoreNames.contains(STORE.dailyLog)) {
          db.createObjectStore(STORE.dailyLog, { keyPath: "id" }).createIndex("log_date", "log_date");
        }
        if (!db.objectStoreNames.contains(STORE.exerciseLog)) {
          db.createObjectStore(STORE.exerciseLog, { keyPath: "id" }).createIndex("log_date", "log_date");
        }
        if (!db.objectStoreNames.contains(STORE.customFoods)) db.createObjectStore(STORE.customFoods, { keyPath: "id" });
        if (!db.objectStoreNames.contains(STORE.recipeFeedback)) db.createObjectStore(STORE.recipeFeedback);
        if (!db.objectStoreNames.contains(STORE.settings)) db.createObjectStore(STORE.settings);
      };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { _dbPromise = null; reject(req.error); };
    });
  }
  return _dbPromise;
}

function reqPromise(req) {
  return new Promise(function (resolve, reject) {
    req.onsuccess = function () { resolve(req.result); };
    req.onerror = function () { reject(req.error); };
  });
}

// 在一個 transaction 裡做事；fn(stores) 回傳的值在 transaction 完成後 resolve（全有全無）。
async function withStores(names, mode, fn) {
  const db = await openDb();
  return new Promise(function (resolve, reject) {
    const tx = db.transaction(names, mode);
    const stores = {};
    names.forEach(function (n) { stores[n] = tx.objectStore(n); });
    let result;
    Promise.resolve(fn(stores)).then(function (r) { result = r; }, function (err) { tx.abort(); reject(err); });
    tx.oncomplete = function () { resolve(result); };
    tx.onerror = function () { reject(tx.error); };
    tx.onabort = function () { reject(tx.error || new Error("transaction aborted")); };
  });
}

function rangeFor(dateRange) {
  const r = dateRange || {};
  if (r.start && r.end) return IDBKeyRange.bound(r.start, r.end);
  if (r.start) return IDBKeyRange.lowerBound(r.start);
  if (r.end) return IDBKeyRange.upperBound(r.end);
  return null;
}

// 依日期範圍讀（含兩端）；結果依 log_date、再依主鍵排序。
async function getByDate(storeName, dateRange) {
  return withStores([storeName], "readonly", function (s) {
    const src = s[storeName].keyPath === "log_date" ? s[storeName] : s[storeName].index("log_date");
    return reqPromise(src.getAll(rangeFor(dateRange)));
  });
}

// 紀錄 id：時間（base36，長度固定所以字典序＝時間序）＋隨機碼
function generateId(prefix) {
  return prefix + "_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 8);
}

function assertRecord(value, what) {
  if (Array.isArray(value)) throw new Error("[db.js] " + what + " 一次只能寫一筆，不能傳陣列");
  if (!value || typeof value !== "object") throw new Error("[db.js] " + what + " 必須是物件");
}

function isDateStr(v) {
  return typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);
}

// ---------- 寫入驗證（不碰資料庫，check-engine 直接測） ----------

export function validateDailyLog(entry) {
  assertRecord(entry, "daily_log");
  const problems = [];
  if (!isDateStr(entry.log_date)) problems.push("log_date");
  if (SLOTS.indexOf(entry.slot) === -1) problems.push("slot");
  if (MEAL_TYPES.indexOf(entry.meal_type) === -1) problems.push("meal_type");
  if (LOG_SOURCES.indexOf(entry.source) === -1) problems.push("source");
  if (typeof entry.name !== "string" || entry.name === "") problems.push("name");
  const c = entry.content;
  if (!c || typeof c !== "object" || !Array.isArray(c.components) || c.components.length === 0) problems.push("content.components");
  else if (c.meal_type !== entry.meal_type) problems.push("content.meal_type");
  const t = entry.totals;
  if (!t || typeof t !== "object" || typeof t.kcal !== "number" || !isFinite(t.kcal)) problems.push("totals.kcal");
  else ["protein_g", "carb_g", "fat_g", "fiber_g"].forEach(function (k) {
    if (!(k in t) || (t[k] !== null && (typeof t[k] !== "number" || !isFinite(t[k])))) problems.push("totals." + k);
  });
  if (problems.length > 0) throw new Error("[db.js] daily_log 格式不對：" + problems.join("、"));
}

export function validateWeightLog(entry) {
  assertRecord(entry, "weight_log");
  if (!isDateStr(entry.log_date) || typeof entry.weight_kg !== "number" || !(entry.weight_kg > 0)) {
    throw new Error("[db.js] weight_log 需要 log_date 與正數 weight_kg");
  }
}

export function validateExerciseLog(entry) {
  assertRecord(entry, "exercise_log");
  if (!isDateStr(entry.log_date) || typeof entry.activity_type !== "string" || entry.activity_type === "") {
    throw new Error("[db.js] exercise_log 需要 log_date 與 activity_type");
  }
}

// ---------- 1. user_profile（單例） ----------

export async function getProfile() {
  const v = await withStores([STORE.userProfile], "readonly", function (s) {
    return reqPromise(s[STORE.userProfile].get(PROFILE_KEY));
  });
  return v === undefined ? null : v;
}

export async function saveProfile(profile) {
  assertRecord(profile, "user_profile");
  await withStores([STORE.userProfile], "readwrite", function (s) {
    return reqPromise(s[STORE.userProfile].put(profile, PROFILE_KEY));
  });
  return profile;
}

// ---------- 2. weight_log ----------

// 同一天覆寫
export async function addWeightLog(entry) {
  validateWeightLog(entry);
  await withStores([STORE.weightLog], "readwrite", function (s) {
    return reqPromise(s[STORE.weightLog].put(entry));
  });
  return entry;
}

export function getWeightLogs(dateRange) {
  return getByDate(STORE.weightLog, dateRange);
}

// ---------- 3. 體重趨勢校正狀態（settings） ----------

// 沒有存過時回傳 null（預設值由 engine/tdee.js 的 defaultTdeeState 決定）
export async function getTdeeState() {
  const v = await getSetting("tdee_state");
  return v == null ? null : v;
}

export function saveTdeeState(state) {
  return setSetting("tdee_state", state);
}

// ---------- 4. recipe_feedback（推薦組合的倒讚與顯示紀錄，key = 組合 id） ----------

export async function getAllRecipeFeedback() {
  return withStores([STORE.recipeFeedback], "readonly", function (s) {
    const store = s[STORE.recipeFeedback];
    return Promise.all([reqPromise(store.getAllKeys()), reqPromise(store.getAll())]).then(function (r) {
      const map = {};
      r[0].forEach(function (k, i) { map[k] = r[1][i]; });
      return map;
    });
  });
}

export async function saveRecipeFeedback(id, rating) {
  return withStores([STORE.recipeFeedback], "readwrite", function (s) {
    const store = s[STORE.recipeFeedback];
    return reqPromise(store.get(id)).then(function (existing) {
      const ex = existing || {};
      const updated = Object.assign({}, ex, {
        recipe_template_id: id,
        rating: rating, // 'like' / 'dislike' / null
        shown_count: (ex.shown_count || 0) + 1,
      });
      return reqPromise(store.put(updated, id)).then(function () { return updated; });
    });
  });
}

// 畫面實際渲染出推薦卡片時呼叫：累加 shown_count、更新 last_shown_date，不動 rating；同一天重複渲染不重複累加。
export async function markRecipesShown(ids, today) {
  if (!Array.isArray(ids)) throw new Error("[db.js] markRecipesShown 需要 id 陣列");
  return withStores([STORE.recipeFeedback], "readwrite", function (s) {
    const store = s[STORE.recipeFeedback];
    return Promise.all(ids.map(function (id) {
      return reqPromise(store.get(id)).then(function (existing) {
        const ex = existing || {};
        if (ex.last_shown_date === today) return null;
        return reqPromise(store.put(Object.assign({}, ex, {
          recipe_template_id: id,
          shown_count: (ex.shown_count || 0) + 1,
          last_shown_date: today,
        }), id));
      });
    }));
  });
}

// ---------- 5. custom_foods（我的品項） ----------

export async function getCustomFoods() {
  return withStores([STORE.customFoods], "readonly", function (s) {
    return reqPromise(s[STORE.customFoods].getAll());
  });
}

// ---------- 6. daily_log（一筆一餐，格式見 PRD 第 3 節） ----------

export async function addDailyLog(entry) {
  validateDailyLog(entry);
  const record = Object.assign({}, entry, { id: entry.id || generateId("log") });
  await withStores([STORE.dailyLog], "readwrite", function (s) {
    return reqPromise(s[STORE.dailyLog].add(record));
  });
  return record;
}

export function getDailyLogs(dateRange) {
  return getByDate(STORE.dailyLog, dateRange);
}

// 撤銷一餐（原本在 feast.js，PRD 第 9 節）。回傳被刪掉的紀錄，找不到回傳 null。
export async function undoDailyLog(id) {
  if (typeof id !== "string") throw new Error("[db.js] undoDailyLog 需要紀錄 id");
  return withStores([STORE.dailyLog], "readwrite", function (s) {
    const store = s[STORE.dailyLog];
    return reqPromise(store.get(id)).then(function (entry) {
      if (!entry) return null;
      return reqPromise(store.delete(id)).then(function () { return entry; });
    });
  });
}

// ---------- 7. exercise_log ----------

export async function addExerciseLog(entry) {
  validateExerciseLog(entry);
  const record = Object.assign({}, entry, { id: entry.id || generateId("ex") });
  await withStores([STORE.exerciseLog], "readwrite", function (s) {
    return reqPromise(s[STORE.exerciseLog].add(record));
  });
  return record;
}

export function getExerciseLogs(dateRange) {
  return getByDate(STORE.exerciseLog, dateRange);
}

// ---------- 8. settings（key-value，key 自動加 lighten2. 前綴） ----------

export async function getSetting(key) {
  const v = await withStores([STORE.settings], "readonly", function (s) {
    return reqPromise(s[STORE.settings].get(SETTING_PREFIX + key));
  });
  return v === undefined ? null : v;
}

export async function setSetting(key, value) {
  await withStores([STORE.settings], "readwrite", function (s) {
    return reqPromise(s[STORE.settings].put(value, SETTING_PREFIX + key));
  });
  return value;
}
