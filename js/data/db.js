// 輕盈計畫 — 唯一的資料存取層：瀏覽器原生 IndexedDB 的薄封裝（章程 C1.4、C1.5、C2）。
// - 資料庫名稱 lighten2；settings 的 key 一律加 "lighten2." 前綴。
// - 清單型資料（daily_log、weight_log、exercise_log、custom_foods）一筆紀錄一個 key，不整包陣列讀改寫。
// - 寫入前先驗證（驗證不過直接丟錯，不會碰到資料庫）；傳入陣列一律報錯。
// - 其他模組只能透過這裡的函式讀寫，不得直接開 IndexedDB。

import { MEAL_TYPES, LOG_SOURCES, ALLERGEN_OPTIONS, UNVERIFIED_ALLERGEN, QTY_OPTIONS } from "../core/config.js";
import { SLOTS } from "../core/slots.js";
import { isNum } from "../core/num.js";
import { fmtDate } from "../core/dates.js";

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

// 備份檔的格式版本（PRD 11.6）：新增 store、新增 settings key、改變區塊結構就 +1，並在 tools/fixtures/ 凍結一份新版 fixture。
// 跟 DB_VERSION 分開計：資料庫升級不一定改備份格式。
// v2（B-1a）：settings 多了 hidden_catalog_uids；v1→v2 沒有資料要改（v1 檔只是沒有這個 key），BACKUP_MIGRATIONS 不放步驟。
export const BACKUP_SCHEMA_VERSION = 2;
const BACKUP_FORMAT = "lighten2-backup";

// 每個 store 在備份檔裡的位置（sections 底下的路徑）。新增 store 一定要加在這裡（check-engine 斷言每個 store 都有位置）。
export const BACKUP_SECTIONS = {
  user_profile: ["system", "user_profile"],
  settings: ["system", "settings"],
  recipe_feedback: ["system", "recipe_feedback"],
  daily_log: ["logs", "daily_log"],
  weight_log: ["logs", "weight_log"],
  exercise_log: ["logs", "exercise_log"],
  custom_foods: ["custom_foods"],
};
export const STORE_NAMES = Object.values(STORE);

const BACKUP_LABELS = {
  user_profile: "基本資料", settings: "設定", recipe_feedback: "推薦紀錄", daily_log: "飲食紀錄",
  weight_log: "體重紀錄", exercise_log: "運動紀錄", custom_foods: "我的品項",
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
// fn 同步丟錯（例：put() 的 DataError、DataCloneError）也要 abort，不然已送出的請求會照樣 commit。
async function withStores(names, mode, fn, options) {
  const db = await openDb();
  return new Promise(function (resolve, reject) {
    const tx = options ? db.transaction(names, mode, options) : db.transaction(names, mode);
    const stores = {};
    names.forEach(function (n) { stores[n] = tx.objectStore(n); });
    let result;
    function abortWith(err) {
      try { tx.abort(); } catch (e) { /* transaction 已經結束 */ }
      reject(err);
    }
    let ret;
    try { ret = fn(stores); } catch (err) { abortWith(err); return; }
    Promise.resolve(ret).then(function (r) { result = r; }, abortWith);
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


const COOK_TYPES = ["cook_quick", "cook_full"];
const SEASONING_LEVELS = ["light", "normal", null];

function implicitProblem(imp) {
  return !imp || typeof imp !== "object" || !isNum(imp.oil_g) || imp.oil_g < 0 ||
    !("seasoning" in imp) || SEASONING_LEVELS.indexOf(imp.seasoning) === -1;
}

function snapshotProblem(snap) {
  return !snap || typeof snap !== "object" || !isNum(snap.kcal);
}

// 一個 MealContent（PRD 第 3 節）的結構檢查，回傳問題清單
function contentProblems(c, mealType) {
  const problems = [];
  if (!c || typeof c !== "object" || !Array.isArray(c.components) || c.components.length === 0) return ["content.components"];
  if (c.meal_type !== mealType) problems.push("content.meal_type");
  if (!("archetype_id" in c) || !("method_id" in c)) problems.push("content.archetype_id/method_id");
  // 自煮一律帶實際採用的用油與調味（章程 C4.11），其他型態是 null
  if (!("implicit" in c)) problems.push("content.implicit");
  else if (COOK_TYPES.indexOf(mealType) !== -1 ? implicitProblem(c.implicit) : c.implicit !== null) problems.push("content.implicit");
  c.components.forEach(function (comp, i) {
    const at = "content.components[" + i + "]";
    if (!comp || COMPONENT_KINDS.indexOf(comp.kind) === -1) { problems.push(at + ".kind"); return; }
    if (comp.kind === "ingredient") {
      if (INGREDIENT_AXES.indexOf(comp.axis) === -1) problems.push(at + ".axis");
      if (typeof comp.ref !== "string" || comp.ref === "") problems.push(at + ".ref");
      if ("scale" in comp && !isNum(comp.scale)) problems.push(at + ".scale");
    } else if (comp.kind === "product") {
      if (typeof comp.ref !== "string" || comp.ref === "") problems.push(at + ".ref");
      if (QTY_OPTIONS.indexOf(comp.qty) === -1) problems.push(at + ".qty"); // 只能是 0.5／1／1.5／2（PRD 12.3）
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
  ["archived", "vegan", "lacto_ovo"].forEach(function (k) {
    if (food[k] !== undefined && typeof food[k] !== "boolean") problems.push(k);
  });
  if (food.copied_from !== undefined && food.copied_from !== null && (typeof food.copied_from !== "string" || food.copied_from === "")) problems.push("copied_from");
  ["vendor", "category", "note"].forEach(function (k) {
    if (food[k] !== undefined && food[k] !== null && typeof food[k] !== "string") problems.push(k);
  });
  if (problems.length > 0) throw new Error("[db.js] 我的品項格式不對：" + problems.join("、"));
}

function isPlainObject(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

// 修改我的品項的純函式（check-engine 直接測）：合併 → 不能改的欄位跟原值不同就丟錯（相同放行，表單整筆回傳不誤擋）
// → 更新 updated_at → 寫入驗證。回傳新紀錄，不改輸入。
const CUSTOM_FOOD_FIXED = ["id", "created_at", "copied_from"];
export function applyCustomFoodPatch(old, patch, nowIso) {
  assertRecord(old, "custom_foods");
  assertRecord(patch, "custom_foods 的修改");
  CUSTOM_FOOD_FIXED.forEach(function (k) {
    if (k in patch && patch[k] !== old[k]) throw new Error("[db.js] 我的品項的 " + k + " 不能修改");
  });
  const next = Object.assign({}, old, patch, { updated_at: nowIso });
  validateCustomFood(next);
  return next;
}

function isPositive(v) {
  return isNum(v) && v > 0;
}

// 基本資料（PRD 11.6 的欄位表）：只驗型別，選項值不在這裡另列——認不得的性別由 engine 的 calculateTargets 丟錯（還原預覽時試算）。
// 放行 lighten2 開始使用以來寫過的舊形狀：自由文字 allergens、舊 type 的不吃項目、缺 −1b 新欄位。
function profileProblems(p) {
  if (!isPlainObject(p)) return ["不是物件"];
  const problems = [];
  ["age", "height_cm", "weight_kg"].forEach(function (k) { if (!isPositive(p[k])) problems.push(k); });
  if (p.body_fat_pct != null && !isPositive(p.body_fat_pct)) problems.push("body_fat_pct");
  ["gender", "activity_mode", "goal_mode", "diet_restriction", "oil_habit"].forEach(function (k) {
    if (p[k] !== undefined && p[k] !== null && typeof p[k] !== "string") problems.push(k);
  });
  ["activity_value", "protein_g_per_kg", "fat_pct", "fiber_target_g"].forEach(function (k) {
    if (p[k] !== undefined && p[k] !== null && !isNum(p[k])) problems.push(k);
  });
  if (p.low_carb !== undefined && typeof p.low_carb !== "boolean") problems.push("low_carb");
  const al = p.allergens;
  if (al !== undefined && al !== null && typeof al !== "string" &&
      !(Array.isArray(al) && al.every(function (x) { return typeof x === "string"; }))) problems.push("allergens");
  const dis = p.disliked_ingredients;
  if (dis !== undefined && dis !== null && !(Array.isArray(dis) &&
      dis.every(function (d) { return isPlainObject(d) && typeof d.key === "string"; }))) problems.push("disliked_ingredients");
  ["meal_prefs", "enabled_slots"].forEach(function (k) {
    if (p[k] !== undefined && p[k] !== null && !isPlainObject(p[k])) problems.push(k);
  });
  return problems;
}

export function validateProfile(profile) {
  assertRecord(profile, "user_profile");
  const problems = profileProblems(profile);
  if (problems.length > 0) throw new Error("[db.js] 基本資料格式不對：" + problems.join("、"));
}

// settings 的每個 key 都要登記在這裡（附驗證）；setSetting 拒絕沒登記的 key 與不合法的值，備份也用同一張表。
// 之後加 key（例：B-1a 的 hidden_catalog_uids）要登記並把 BACKUP_SCHEMA_VERSION +1；
// dedicatedOnly：只准專用函式讀寫的 key（B-4a 的 favorite_ingredient_ids，章程 C4.17②）。
const SETTING_KEYS = {
  tdee_state: {
    validate: function (v) { return isPlainObject(v) && "version" in v; },
  },
  picker_last_meal_type: {
    validate: function (v) {
      return isPlainObject(v) && Object.keys(v).every(function (slot) {
        return SLOTS.indexOf(slot) !== -1 && MEAL_TYPES.indexOf(v[slot]) !== -1;
      });
    },
  },
  // 隱藏的內建品項（PRD 10.2）：只能用 hideCatalogItem／unhideCatalogItem 寫（同一個 transaction 讀改寫，兩個分頁同時隱藏不互蓋）
  hidden_catalog_uids: {
    dedicatedOnly: true,
    validate: function (v) {
      return Array.isArray(v) && v.every(function (u, i) { return typeof u === "string" && u !== "" && v.indexOf(u) === i; });
    },
  },
};
export const SETTING_KEY_NAMES = Object.keys(SETTING_KEYS);

function hasOwn(obj, k) {
  return Object.prototype.hasOwnProperty.call(obj, k);
}

export function validateSetting(key, value) {
  if (typeof key !== "string" || !hasOwn(SETTING_KEYS, key)) throw new Error("[db.js] 設定「" + key + "」沒有登記在 SETTING_KEYS");
  if (!SETTING_KEYS[key].validate(value)) throw new Error("[db.js] 設定「" + key + "」的值格式不對");
}

function recipeFeedbackProblems(entry) {
  if (!isPlainObject(entry) || typeof entry.id !== "string" || entry.id === "" || !isPlainObject(entry.value)) return ["格式應為 { id, value }"];
  const v = entry.value;
  const problems = [];
  if (v.recipe_template_id !== undefined && v.recipe_template_id !== entry.id) problems.push("recipe_template_id 跟 id 不同");
  if (v.rating !== undefined && v.rating !== null && v.rating !== "like" && v.rating !== "dislike") problems.push("rating");
  if (v.shown_count !== undefined && !(Number.isInteger(v.shown_count) && v.shown_count >= 0)) problems.push("shown_count");
  if (v.last_shown_date !== undefined && !isDateStr(v.last_shown_date)) problems.push("last_shown_date");
  return problems;
}

// ---------- 備份（PRD 11.6：完整備份與還原＝取代） ----------

function getPath(obj, path) {
  let cur = obj;
  for (const k of path) {
    if (!isPlainObject(cur) || !hasOwn(cur, k)) return undefined;
    cur = cur[k];
  }
  return cur;
}

function setPath(obj, path, value) {
  let cur = obj;
  path.slice(0, -1).forEach(function (k) {
    if (!isPlainObject(cur[k])) cur[k] = {};
    cur = cur[k];
  });
  cur[path[path.length - 1]] = value;
}

function sectionCount(store, v) {
  if (store === STORE.userProfile) return v ? 1 : 0;
  return Array.isArray(v) ? v.length : 0;
}

function errText(e) {
  return String(e && e.message || e).replace(/^\[db\.js\] /, "");
}

// 逐版升級（比照 upgrade）：BACKUP_MIGRATIONS[n] 把 v(n) 的檔案升到 v(n+1)。v1 沒有步驟。
// 升級後補上舊檔沒有的區塊（當成空的）。回傳深拷貝，不改輸入。
const BACKUP_MIGRATIONS = {};

export function migrateBackup(obj) {
  const out = JSON.parse(JSON.stringify(obj === undefined ? null : obj));
  if (!isPlainObject(out) || !Number.isInteger(out.schema_version) || out.schema_version < 1 ||
      out.schema_version >= BACKUP_SCHEMA_VERSION) return out;
  for (let v = out.schema_version; v < BACKUP_SCHEMA_VERSION; v++) {
    if (BACKUP_MIGRATIONS[v]) BACKUP_MIGRATIONS[v](out);
  }
  if (!isPlainObject(out.sections)) out.sections = {};
  const manifest = isPlainObject(out.manifest) ? out.manifest : {};
  STORE_NAMES.forEach(function (store) {
    if (getPath(out.sections, BACKUP_SECTIONS[store]) === undefined) {
      setPath(out.sections, BACKUP_SECTIONS[store], store === STORE.userProfile ? null : []);
      manifest[store] = 0;
    }
  });
  out.manifest = manifest;
  out.schema_version = BACKUP_SCHEMA_VERSION;
  return out;
}

// 純函式：回傳問題清單（空陣列＝可以還原）。ctx 先留空，B-4a 起傳衛福部查詢表與 catalog（章程 B8）。
// 檔案只描述內容，不描述匯入語意（decisions #71）。
export function validateBackup(obj, ctx) { // eslint-disable-line no-unused-vars
  if (!isPlainObject(obj) || obj.format !== BACKUP_FORMAT) return ["檔案不是輕盈計畫的備份"];
  const v = obj.schema_version;
  if (!Number.isInteger(v) || v < 1) return ["備份的版本號不對"];
  if (v > BACKUP_SCHEMA_VERSION) return ["這個備份來自較新的版本，請重新整理頁面後再試"];
  if (v < BACKUP_SCHEMA_VERSION) return ["備份還沒有升級到目前的格式（要先經過 migrateBackup）"];
  const problems = [];
  if (obj.exported_at !== undefined && (typeof obj.exported_at !== "string" || isNaN(Date.parse(obj.exported_at)))) problems.push("匯出時間格式不對");
  if (obj.app_version !== undefined && typeof obj.app_version !== "string") problems.push("版本字串格式不對");
  if (!isPlainObject(obj.sections)) return problems.concat(["缺少資料區塊"]);

  // 不認得的區塊：比對 BACKUP_SECTIONS 推出來的合法路徑
  const known = {};
  STORE_NAMES.forEach(function (store) {
    const path = BACKUP_SECTIONS[store];
    for (let i = 1; i <= path.length; i++) known[path.slice(0, i).join(".")] = i === path.length ? "leaf" : "branch";
  });
  (function walk(node, prefix) {
    Object.keys(node).forEach(function (k) {
      const p = prefix ? prefix + "." + k : k;
      if (!known[p]) problems.push("不認得的資料區塊「" + p + "」");
      else if (known[p] === "branch" && isPlainObject(node[k])) walk(node[k], p);
    });
  })(obj.sections, "");

  const counts = {};
  STORE_NAMES.forEach(function (store) {
    const label = BACKUP_LABELS[store] || store;
    const val = getPath(obj.sections, BACKUP_SECTIONS[store]);
    if (val === undefined) { problems.push("缺少「" + label + "」"); return; }
    if (store === STORE.userProfile) {
      counts[store] = val ? 1 : 0;
      if (val !== null) profileProblems(val).forEach(function (p) { problems.push(label + "：" + p); });
      return;
    }
    if (!Array.isArray(val)) { problems.push("「" + label + "」應該是清單"); return; }
    counts[store] = val.length;
    const seen = {};
    val.forEach(function (rec, i) {
      const at = label + "第 " + (i + 1) + " 筆：";
      const key = store === STORE.weightLog ? rec && rec.log_date : rec && rec.id;
      if (store !== STORE.weightLog && (typeof key !== "string" || key === "")) problems.push(at + "沒有 id");
      else if (seen[key]) problems.push(at + (store === STORE.weightLog ? "日期重複" : "id 重複"));
      else seen[key] = true;
      try {
        if (store === STORE.settings) {
          if (!isPlainObject(rec) || !("value" in rec)) throw new Error("格式應為 { id, value }");
          validateSetting(rec.id, rec.value);
        } else if (store === STORE.recipeFeedback) {
          const rp = recipeFeedbackProblems(rec);
          if (rp.length) throw new Error(rp.join("、"));
        } else if (store === STORE.dailyLog) validateDailyLog(rec);
        else if (store === STORE.weightLog) validateWeightLog(rec);
        else if (store === STORE.exerciseLog) validateExerciseLog(rec);
        else if (store === STORE.customFoods) validateCustomFood(rec);
        else throw new Error("沒有驗證器（新增 store 要在 validateBackup 補上）");
      } catch (e) {
        problems.push(at + errText(e));
      }
    });
  });

  const m = obj.manifest;
  if (!isPlainObject(m)) problems.push("缺少筆數清單（manifest）");
  else {
    Object.keys(m).forEach(function (k) { if (STORE_NAMES.indexOf(k) === -1) problems.push("筆數清單有不認得的「" + k + "」"); });
    STORE_NAMES.forEach(function (store) {
      if (counts[store] !== undefined && m[store] !== counts[store]) problems.push("「" + (BACKUP_LABELS[store] || store) + "」的筆數跟筆數清單不一致（檔案可能被截斷或改過）");
    });
  }
  return problems;
}

// ISO 時間（UTC）→ 本地日期字串
function dateOfIso(s) {
  if (typeof s !== "string" || isNaN(Date.parse(s))) return null;
  return fmtDate(new Date(s));
}

// 純函式：各類筆數、最後一筆日期（紀錄用 log_date、我的品項用 created_at）、最新的 created_at（還原預覽比對「匯出之後新增的紀錄」）。
export function summarizeBackup(obj) {
  const out = {};
  STORE_NAMES.forEach(function (store) {
    const val = isPlainObject(obj) ? getPath(obj.sections, BACKUP_SECTIONS[store]) : undefined;
    const list = Array.isArray(val) ? val : [];
    let lastDate = null;
    let lastCreatedAt = null;
    list.forEach(function (r) {
      if (!r) return;
      const d = r.log_date || dateOfIso(r.created_at);
      if (typeof d === "string" && (lastDate === null || d > lastDate)) lastDate = d;
      if (typeof r.created_at === "string" && (lastCreatedAt === null || r.created_at > lastCreatedAt)) lastCreatedAt = r.created_at;
    });
    out[store] = { label: BACKUP_LABELS[store] || store, count: sectionCount(store, val), last_date: lastDate, last_created_at: lastCreatedAt };
  });
  return out;
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
  if (food.copied_from != null) throw new Error("[db.js] 複製內建品項要用 copyBuiltinToCustom（會同時隱藏原品項）");
  const now = new Date().toISOString();
  const record = Object.assign({ copied_from: null, archived: false, created_at: now }, food,
    { id: food.id || generateId("custom"), updated_at: now });
  await withStores([STORE.customFoods], "readwrite", function (s) {
    return reqPromise(s[STORE.customFoods].add(record));
  });
  return record;
}

// 修改我的品項（B-1a 的編輯、補填、封存／還原）。一個 transaction 讀改寫；找不到 id 丟錯。
export async function updateCustomFood(id, patch) {
  if (typeof id !== "string" || id === "") throw new Error("[db.js] updateCustomFood 需要品項 id");
  assertRecord(patch, "custom_foods 的修改");
  const now = new Date().toISOString();
  return withStores([STORE.customFoods], "readwrite", function (s) {
    const store = s[STORE.customFoods];
    return reqPromise(store.get(id)).then(function (old) {
      if (!old) throw new Error("[db.js] 找不到我的品項：" + id);
      const next = applyCustomFoodPatch(old, patch, now);
      return reqPromise(store.put(next)).then(function () { return next; });
    });
  });
}

const HIDDEN_KEY = SETTING_PREFIX + "hidden_catalog_uids";

function hiddenFrom(v) {
  return Array.isArray(v) ? v.slice() : [];
}

// 隱藏的內建品項清單（沒存過回傳 []）
export async function getHiddenCatalogUids() {
  const v = await withStores([STORE.settings], "readonly", function (s) {
    return reqPromise(s[STORE.settings].get(HIDDEN_KEY));
  });
  return hiddenFrom(v);
}

function checkUid(uid, fn) {
  if (typeof uid !== "string" || uid === "") throw new Error("[db.js] " + fn + " 需要品項 uid" + (Array.isArray(uid) ? "，不能傳陣列" : ""));
}

function changeHidden(uid, add) {
  return withStores([STORE.settings], "readwrite", function (s) {
    const store = s[STORE.settings];
    return reqPromise(store.get(HIDDEN_KEY)).then(function (v) {
      const list = hiddenFrom(v).filter(function (u) { return u !== uid; });
      if (add) list.push(uid);
      return reqPromise(store.put(list, HIDDEN_KEY)).then(function () { return list; });
    });
  });
}

export async function hideCatalogItem(uid) {
  checkUid(uid, "hideCatalogItem");
  return changeHidden(uid, true);
}

export async function unhideCatalogItem(uid) {
  checkUid(uid, "unhideCatalogItem");
  return changeHidden(uid, false);
}

// 複製成我的版本（PRD 10.2）：一個 transaction 新增我的品項並隱藏原品項（全有全無）。回傳寫入的紀錄。
export async function copyBuiltinToCustom(food) {
  validateCustomFood(food);
  if (typeof food.copied_from !== "string" || food.copied_from === "") throw new Error("[db.js] 複製的品項要有 copied_from");
  const now = new Date().toISOString();
  const record = Object.assign({ archived: false, created_at: now }, food, { id: food.id || generateId("custom"), updated_at: now });
  await withStores([STORE.customFoods, STORE.settings], "readwrite", function (s) {
    s[STORE.customFoods].add(record);
    const settings = s[STORE.settings];
    return reqPromise(settings.get(HIDDEN_KEY)).then(function (v) {
      const list = hiddenFrom(v).filter(function (u) { return u !== record.copied_from; });
      list.push(record.copied_from);
      settings.put(list, HIDDEN_KEY);
    });
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
  validateSetting(key, value);
  if (SETTING_KEYS[key].dedicatedOnly) throw new Error("[db.js] 設定「" + key + "」只能用專用函式寫入");
  await withStores([STORE.settings], "readwrite", function (s) {
    return reqPromise(s[STORE.settings].put(value, SETTING_PREFIX + key));
  });
  return value;
}

// ---------- 9. 備份匯出與還原（PRD 11.6） ----------

function sortBy(key) {
  return function (a, b) { return a[key] < b[key] ? -1 : a[key] > b[key] ? 1 : 0; };
}

// 讀出全部 store（一個 readonly transaction），組成備份檔的內容（不含 exported_at、app_version，由畫面補）。
// 陣列依 id（體重依日期）排序，同一份資料匯出兩次內容相同。
export async function exportAllData() {
  const raw = await withStores(STORE_NAMES, "readonly", function (s) {
    const out = {};
    return Promise.all(STORE_NAMES.map(function (name) {
      const store = s[name];
      if (name === STORE.userProfile) return reqPromise(store.get(PROFILE_KEY)).then(function (v) { out[name] = v === undefined ? null : v; });
      if (store.keyPath) return reqPromise(store.getAll()).then(function (v) { out[name] = v; });
      return Promise.all([reqPromise(store.getAllKeys()), reqPromise(store.getAll())]).then(function (r) {
        out[name] = r[0].map(function (k, i) {
          return { id: name === STORE.settings ? String(k).replace(SETTING_PREFIX, "") : k, value: r[1][i] };
        });
      });
    })).then(function () { return out; });
  });
  const sections = {};
  const manifest = {};
  STORE_NAMES.forEach(function (name) {
    let v = raw[name];
    if (Array.isArray(v)) v = v.slice().sort(sortBy(name === STORE.weightLog ? "log_date" : "id"));
    setPath(sections, BACKUP_SECTIONS[name], v);
    manifest[name] = sectionCount(name, v);
  });
  return { format: BACKUP_FORMAT, schema_version: BACKUP_SCHEMA_VERSION, manifest: manifest, sections: sections };
}

// 還原＝取代（decisions #71）：先升級、驗證，有問題就丟錯、完全不碰資料庫；
// 沒問題才在一個 transaction 裡清空全部 store 再逐筆寫入（全有全無）。回傳還原內容的摘要。
export async function importAllData(obj) {
  assertRecord(obj, "備份");
  const data = migrateBackup(obj);
  const problems = validateBackup(data);
  if (problems.length > 0) throw new Error("[db.js] 備份不能還原：" + problems.slice(0, 5).join("；"));
  await withStores(STORE_NAMES, "readwrite", function (s) {
    STORE_NAMES.forEach(function (name) { s[name].clear(); });
    STORE_NAMES.forEach(function (name) {
      const val = getPath(data.sections, BACKUP_SECTIONS[name]);
      const store = s[name];
      if (name === STORE.userProfile) { if (val) store.put(val, PROFILE_KEY); return; }
      val.forEach(function (rec) {
        if (name === STORE.settings) store.put(rec.value, SETTING_PREFIX + rec.id);
        else if (name === STORE.recipeFeedback) store.put(rec.value, rec.id);
        else store.put(rec);
      });
    });
  }, { durability: "strict" });
  return summarizeBackup(data);
}
