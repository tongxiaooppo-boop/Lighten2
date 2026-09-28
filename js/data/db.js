// 輕盈計畫 — 唯一的資料存取層：瀏覽器原生 IndexedDB 的薄封裝（章程 C1.4、C1.5、C2）。
// - 資料庫名稱 lighten2；settings 的 key 一律加 "lighten2." 前綴。
// - 清單型資料（daily_log、weight_log、exercise_log、custom_foods）一筆紀錄一個 key，不整包陣列讀改寫。
// - 寫入前先驗證（驗證不過直接丟錯，不會碰到資料庫）；傳入陣列一律報錯。
// - 其他模組只能透過這裡的函式讀寫，不得直接開 IndexedDB。

import { MEAL_TYPES, LOG_SOURCES, ALLERGEN_OPTIONS, UNVERIFIED_ALLERGEN } from "../core/config.js";
import { SLOTS } from "../core/slots.js";
import { isNum } from "../core/num.js";

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

// 依舊版本分段升級：之後加 store（Phase 2 的 meal_plan、工作線 C 的 saved_meals）就在後面加一段、DB_VERSION +1。
function upgrade(db, oldVersion) {
  if (oldVersion < 1) {
    db.createObjectStore(STORE.userProfile);
    db.createObjectStore(STORE.weightLog, { keyPath: "log_date" });
    db.createObjectStore(STORE.dailyLog, { keyPath: "id" }).createIndex("log_date", "log_date");
    db.createObjectStore(STORE.exerciseLog, { keyPath: "id" }).createIndex("log_date", "log_date");
    db.createObjectStore(STORE.customFoods, { keyPath: "id" });
    db.createObjectStore(STORE.recipeFeedback);
    db.createObjectStore(STORE.settings);
  }
}

function openDb() {
  if (!_dbPromise) {
    let gaveUp = false;
    _dbPromise = new Promise(function (resolve, reject) {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = function (e) { upgrade(req.result, e.oldVersion); };
      req.onsuccess = function () {
        const db = req.result;
        if (gaveUp) { db.close(); return; } // 已經因為被擋住而放棄：晚到的連線直接關掉
        // 別的分頁要升級資料庫版本時，這邊主動關閉連線讓它升級，不要讓對方卡住；下次存取再重新開。
        db.onversionchange = function () { db.close(); _dbPromise = null; };
        resolve(db);
      };
      req.onerror = function () { _dbPromise = null; reject(req.error); };
      // 舊版本的分頁還開著、沒有關閉連線：不要無聲卡住，直接報錯讓畫面提示重新整理。
      req.onblocked = function () { gaveUp = true; _dbPromise = null; reject(new Error("[db.js] 資料庫升級被其他開著的分頁擋住，請關閉其他分頁後重新整理")); };
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
    Promise.resolve(fn(stores)).then(function (r) { result = r; }, function (err) {
      try { tx.abort(); } catch (e) { /* transaction 已經結束 */ }
      reject(err);
    });
    tx.oncomplete = function () { resolve(result); };
    tx.onerror = function (e) { reject((e && e.target && e.target.error) || tx.error); };
    tx.onabort = function (e) { reject((e && e.target && e.target.error) || tx.error || new Error("[db.js] transaction aborted")); };
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

const COMPONENT_KINDS = ["ingredient", "product", "estimate"];
const INGREDIENT_AXES = ["protein", "staple", "vegetable", "seasoning"];


function snapshotProblem(snap) {
  return !snap || typeof snap !== "object" || !isNum(snap.kcal);
}

// 一個 MealContent（PRD 第 3 節）的結構檢查，回傳問題清單
function contentProblems(c, mealType) {
  const problems = [];
  if (!c || typeof c !== "object" || !Array.isArray(c.components) || c.components.length === 0) return ["content.components"];
  if (c.meal_type !== mealType) problems.push("content.meal_type");
  if (!("archetype_id" in c) || !("method_id" in c)) problems.push("content.archetype_id/method_id");
  if (!("implicit" in c) || (c.implicit !== null && typeof c.implicit !== "object")) problems.push("content.implicit");
  c.components.forEach(function (comp, i) {
    const at = "content.components[" + i + "]";
    if (!comp || COMPONENT_KINDS.indexOf(comp.kind) === -1) { problems.push(at + ".kind"); return; }
    if (comp.kind === "ingredient") {
      if (INGREDIENT_AXES.indexOf(comp.axis) === -1) problems.push(at + ".axis");
      if (typeof comp.ref !== "string" || comp.ref === "") problems.push(at + ".ref");
      if ("scale" in comp && !isNum(comp.scale)) problems.push(at + ".scale");
    } else if (comp.kind === "product") {
      if (typeof comp.ref !== "string" || comp.ref === "") problems.push(at + ".ref");
      if (!isNum(comp.qty) || comp.qty <= 0) problems.push(at + ".qty");
      if (snapshotProblem(comp.snapshot)) problems.push(at + ".snapshot");
    } else {
      if (typeof comp.name !== "string" || comp.name === "") problems.push(at + ".name");
      if (snapshotProblem(comp.snapshot)) problems.push(at + ".snapshot");
    }
  });
  return problems;
}

export function validateDailyLog(entry) {
  assertRecord(entry, "daily_log");
  const problems = [];
  if (!isDateStr(entry.log_date)) problems.push("log_date");
  if (SLOTS.indexOf(entry.slot) === -1) problems.push("slot");
  if (MEAL_TYPES.indexOf(entry.meal_type) === -1) problems.push("meal_type");
  if (LOG_SOURCES.indexOf(entry.source) === -1) problems.push("source");
  if (typeof entry.name !== "string" || entry.name === "") problems.push("name");
  if (typeof entry.created_at !== "string" || isNaN(Date.parse(entry.created_at))) problems.push("created_at");
  Array.prototype.push.apply(problems, contentProblems(entry.content, entry.meal_type));
  const t = entry.totals;
  if (!t || typeof t !== "object" || typeof t.kcal !== "number" || !isFinite(t.kcal)) problems.push("totals.kcal");
  else {
    ["protein_g", "carb_g", "fat_g", "fiber_g", "sat_fat_g", "sodium_mg"].forEach(function (k) {
      if (!(k in t) || (t[k] !== null && (typeof t[k] !== "number" || !isFinite(t[k])))) problems.push("totals." + k);
    });
    if (!Array.isArray(t.partial)) problems.push("totals.partial");
  }
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

const PRODUCT_ROLES = ["main", "side", "snack", "drink"];
const PRODUCT_CHANNELS = ["convenience", "delivery"];
const OPTIONAL_NUTRIENTS = ["protein_g", "carb_g", "fat_g", "fiber_g", "sat_fat_g", "sodium_mg"];

// 我的品項的最低驗證（章程 B8、PRD 10.1）。allergen_tags 必有此欄：null＝未確認（表單預設）、[]＝確認不含。
export function validateCustomFood(food) {
  assertRecord(food, "custom_foods");
  const problems = [];
  if (typeof food.name !== "string" || food.name.trim() === "") problems.push("name");
  if (!isNum(food.kcal) || !(food.kcal > 0)) problems.push("kcal");
  if (PRODUCT_ROLES.indexOf(food.role) === -1) problems.push("role");
  if (PRODUCT_CHANNELS.indexOf(food.channel) === -1) problems.push("channel");
  if (!Array.isArray(food.valid_slots) || food.valid_slots.length === 0 ||
      food.valid_slots.some(function (s) { return SLOTS.indexOf(s) === -1; })) problems.push("valid_slots");
  const tags = food.allergen_tags;
  if (!("allergen_tags" in food) || (tags !== null && (!Array.isArray(tags) ||
      tags.some(function (t) { return ALLERGEN_OPTIONS.indexOf(t) === -1 && t !== UNVERIFIED_ALLERGEN; })))) problems.push("allergen_tags");
  OPTIONAL_NUTRIENTS.forEach(function (k) {
    if (!(k in food) || (food[k] !== null && (!isNum(food[k]) || food[k] < 0))) problems.push(k);
  });
  if (problems.length > 0) throw new Error("[db.js] 我的品項格式不對：" + problems.join("、"));
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
      // shown_count 只由 markRecipesShown 累加（＝顯示過的天數，推薦扣分依賴這個意義，decisions #39）
      const updated = Object.assign({}, ex, {
        recipe_template_id: id,
        rating: rating, // 'like' / 'dislike' / null
      });
      return reqPromise(store.put(updated, id)).then(function () { return updated; });
    });
  });
}

// 畫面實際渲染出推薦卡片時呼叫：累加 shown_count、更新 last_shown_date，不動 rating；同一天重複渲染不重複累加。
export async function markRecipesShown(ids, today) {
  if (!Array.isArray(ids)) throw new Error("[db.js] markRecipesShown 需要 id 陣列");
  if (!isDateStr(today)) throw new Error("[db.js] markRecipesShown 需要今天的日期字串");
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

// 新增一筆我的品項（Phase 0 的快速新增表單呼叫）。回傳寫入的紀錄。
export async function addCustomFood(food) {
  validateCustomFood(food);
  const now = new Date().toISOString();
  const record = Object.assign({ copied_from: null, archived: false, created_at: now }, food,
    { id: food.id || generateId("custom"), updated_at: now });
  await withStores([STORE.customFoods], "readwrite", function (s) {
    return reqPromise(s[STORE.customFoods].add(record));
  });
  return record;
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
