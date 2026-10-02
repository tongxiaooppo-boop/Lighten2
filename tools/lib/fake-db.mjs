// diff-recs 用的記憶體假資料庫：取代 js/data/db.js（由 adapter-v2 的 module hook 換掉），介面相同。
// 讀取順序照 IndexedDB：依日期範圍讀的依 log_date、再依 id 排序；custom_foods 依 id 排序。
// 寫入驗證直接用真的 db.js（validateDailyLog 等），確保快照走的是同一套格式檢查。

import { validateDailyLog, validateWeightLog, validateExerciseLog, validateCustomFood, validateSetting, applyCustomFoodPatch,
  addDislikedTo, removeDislikedFrom, mergeProfileForm, validateSavedMeal, applySavedMealPatch,
  addFavoriteTo, removeFavoriteFrom, applyFavoriteOp, replaceFavoriteRef, validateCustomIngredient, applyCustomIngredientPatch } from "../../js/data/db.js";

const S = () => globalThis.__fakeDbState;
const clone = (x) => (x == null ? x : JSON.parse(JSON.stringify(x)));

function inRange(d, r) {
  if (!r) return true;
  if (r.start && d < r.start) return false;
  if (r.end && d > r.end) return false;
  return true;
}

function byDateThenId(a, b) {
  if (a.log_date !== b.log_date) return a.log_date < b.log_date ? -1 : 1;
  const ai = String(a.id || ""), bi = String(b.id || "");
  return ai < bi ? -1 : ai > bi ? 1 : 0;
}

let seq = 0;
let savedSeq = 0; // 我的組合的 id 自己一套序號（不影響既有紀錄的 id，審核建議 15）
export function __resetSeq() { seq = 0; savedSeq = 0; }

export { validateDailyLog, validateWeightLog, validateExerciseLog, validateCustomFood };

export async function getProfile() { return clone(S().profile); }
// 不吃清單的專用寫入（語意用 db.js 同一份純函式；寫入紀錄 { op, disliked }）
function writeDisliked(op, list) {
  if (!S().profile) throw new Error("[db.js] " + op + "：還沒有基本資料");
  S().profile = Object.assign({}, S().profile, { disliked_ingredients: clone(list) });
  S().writes.push({ op: op, disliked: clone(list) });
  return clone(list);
}
export async function addDislikedIngredient(entry) {
  const list = addDislikedTo(S().profile ? S().profile.disliked_ingredients : [], entry);
  // 常吃同一個 key 默默移出（寫入紀錄的形狀不變：推薦快照錄了這一行，審核 M1）
  const fav = S().settings.favorite_refs;
  if (Array.isArray(fav) && fav.indexOf(entry.key) !== -1) S().settings.favorite_refs = applyFavoriteOp({ favorites: fav, disliked: list }, "dislike", entry.key).favorites;
  return writeDisliked("addDislikedIngredient", list);
}
export async function removeDislikedIngredient(key) {
  if (typeof key !== "string" || key === "") throw new Error("[db.js] removeDislikedIngredient 需要 key");
  return writeDisliked("removeDislikedIngredient", removeDislikedFrom(S().profile ? S().profile.disliked_ingredients : [], key));
}
export async function saveProfileForm(form) {
  const next = mergeProfileForm(S().profile, form);
  S().profile = clone(next);
  S().writes.push({ op: "saveProfileForm", disliked: clone(next.disliked_ingredients) });
  return clone(next);
}

export async function addWeightLog(entry) {
  validateWeightLog(entry);
  S().weightLogs = S().weightLogs.filter((e) => e.log_date !== entry.log_date).concat([clone(entry)]);
  return entry;
}
export async function getWeightLogs(r) {
  return clone(S().weightLogs.filter((e) => inRange(e.log_date, r)).sort(byDateThenId));
}

export async function getTdeeState() { return clone(S().tdeeState) || null; }
export async function saveTdeeState(s) { S().tdeeState = clone(s); return s; }

export async function getAllRecipeFeedback() { return clone(S().feedback); }
export async function saveRecipeFeedback(id, rating) {
  const ex = S().feedback[id] || {};
  S().feedback[id] = Object.assign({}, ex, { recipe_template_id: id, rating: rating, shown_count: (ex.shown_count || 0) + 1 });
  S().writes.push({ op: "saveRecipeFeedback", id: id, rating: rating });
}
// 照 db.js 的語意寫入：累加 shown_count、更新 last_shown_date，同一天不重複累加
export async function markRecipesShown(ids, today) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(today))) throw new Error("[fake-db] markRecipesShown 需要今天的日期字串");
  S().writes.push({ op: "markRecipesShown", ids: ids.slice() });
  ids.forEach((id) => {
    const ex = S().feedback[id] || {};
    if (ex.last_shown_date === today) return;
    S().feedback[id] = Object.assign({}, ex, { recipe_template_id: id, shown_count: (ex.shown_count || 0) + 1, last_shown_date: today });
  });
}

export async function getCustomFoods() {
  return clone(S().customFoods.slice().sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)));
}

// 照 db.js：寫入驗證（章程 B8）＋補 copied_from、archived、時間戳
export async function addCustomFood(food) {
  validateCustomFood(food);
  if (food.copied_from != null) throw new Error("[fake-db] 複製內建品項要用 copyBuiltinToCustom");
  const now = new Date().toISOString();
  const record = Object.assign({ copied_from: null, archived: false, created_at: now }, clone(food),
    { id: food.id || "custom_" + String(++seq).padStart(4, "0"), updated_at: now });
  S().customFoods.push(record);
  S().writes.push({ op: "addCustomFood", record: clone(record) });
  return clone(record);
}

// B-1a：修改、取消隱藏、複製成我的版本（照 db.js 的語意）
export async function updateCustomFood(id, patch) {
  const i = S().customFoods.findIndex((f) => f.id === id);
  if (i === -1) throw new Error("[fake-db] 找不到我的品項：" + id);
  const next = applyCustomFoodPatch(S().customFoods[i], patch, new Date().toISOString());
  S().customFoods[i] = clone(next);
  S().writes.push({ op: "updateCustomFood", id: id, record: clone(next) });
  return clone(next);
}
// 我的食材（PRD 12.4、decisions #138；照 db.js 的語意，驗證用真的 db.js）
export { validateCustomIngredient, applyCustomIngredientPatch };
const ingList = () => (S().customIngredients = S().customIngredients || []);
export async function getCustomIngredients() {
  return clone(ingList().slice().sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)));
}
export async function addCustomIngredient(rec) {
  const now = new Date().toISOString();
  const base = rec.source === "tfda" ? { id: "cing_" + String(rec.tfda_id || "").toLowerCase() } : { id: "cing_u_" + String(++seq).padStart(4, "0"), archived: false };
  const record = Object.assign({ note: null }, clone(rec), base, { created_at: now, updated_at: now });
  validateCustomIngredient(record);
  if (ingList().some((x) => x.id === record.id)) throw new Error("[fake-db] 我的食材已存在：" + record.id);
  ingList().push(record);
  S().writes.push({ op: "addCustomIngredient", record: clone(record) });
  return clone(record);
}
export async function updateCustomIngredient(id, patch) {
  const i = ingList().findIndex((x) => x.id === id);
  if (i === -1) throw new Error("[fake-db] 找不到我的食材：" + id);
  const next = applyCustomIngredientPatch(ingList()[i], patch, new Date().toISOString());
  ingList()[i] = clone(next);
  S().writes.push({ op: "updateCustomIngredient", id: id, record: clone(next) });
  return clone(next);
}
export async function removeTfdaIngredient(id) {
  const i = ingList().findIndex((x) => x.id === id && x.source === "tfda");
  if (i === -1) throw new Error("[fake-db] 不是衛福部來源的我的食材：" + id);
  const old = ingList().splice(i, 1)[0];
  const fav = S().settings.favorite_refs;
  if (Array.isArray(fav) && fav.indexOf(id) !== -1) S().settings.favorite_refs = removeFavoriteFrom(fav, id);
  S().writes.push({ op: "removeTfdaIngredient", id: id });
  return clone(old);
}
export async function restoreTfdaIngredient(old) {
  const record = Object.assign(clone(old), { updated_at: new Date().toISOString() });
  validateCustomIngredient(record);
  if (ingList().some((x) => x.id === record.id)) throw new Error("[fake-db] 我的食材已存在：" + record.id);
  ingList().push(record);
  S().writes.push({ op: "restoreTfdaIngredient", record: clone(record) });
  return clone(record);
}

// 常吃（PRD 13.6；語意用 db.js 同一份純函式；寫入紀錄 { op, favorites, disliked }）
export { addFavoriteTo, removeFavoriteFrom, applyFavoriteOp, replaceFavoriteRef };
export async function getFavoriteRefs() {
  const v = S().settings.favorite_refs;
  return Array.isArray(v) ? v.slice() : [];
}
function checkRef(ref, fn) {
  if (typeof ref !== "string" || ref === "") throw new Error("[db.js] " + fn + " 需要一個 id" + (Array.isArray(ref) ? "，不能傳陣列" : ""));
}
export async function addFavoriteRef(ref) {
  checkRef(ref, "addFavoriteRef");
  const p = S().profile;
  const next = applyFavoriteOp({ favorites: S().settings.favorite_refs, disliked: p ? p.disliked_ingredients : [] }, "favorite", ref);
  S().settings.favorite_refs = clone(next.favorites);
  if (p) S().profile = Object.assign({}, p, { disliked_ingredients: clone(next.disliked) });
  const out = { favorites: next.favorites, disliked: p ? next.disliked : null };
  S().writes.push({ op: "addFavoriteRef", favorites: clone(out.favorites), disliked: clone(out.disliked) });
  return clone(out);
}
export async function removeFavoriteRef(ref) {
  checkRef(ref, "removeFavoriteRef");
  const list = applyFavoriteOp({ favorites: S().settings.favorite_refs, disliked: [] }, "unfavorite", ref).favorites;
  S().settings.favorite_refs = clone(list);
  S().writes.push({ op: "removeFavoriteRef", favorites: clone(list), disliked: clone(S().profile ? S().profile.disliked_ingredients : null) });
  return list.slice();
}
export async function getHiddenCatalogUids() {
  const v = S().settings.hidden_catalog_uids;
  return Array.isArray(v) ? v.slice() : [];
}
export async function unhideCatalogItem(uid) {
  const list = (await getHiddenCatalogUids()).filter((u) => u !== uid);
  S().settings.hidden_catalog_uids = list;
  S().writes.push({ op: "unhideCatalogItem", uid: uid });
  return list.slice();
}
export async function copyBuiltinToCustom(food) {
  validateCustomFood(food);
  if (!food.copied_from) throw new Error("[fake-db] 複製的品項要有 copied_from");
  const now = new Date().toISOString();
  const record = Object.assign({ archived: false, created_at: now }, clone(food),
    { id: food.id || "custom_" + String(++seq).padStart(4, "0"), updated_at: now });
  S().customFoods.push(record);
  S().settings.hidden_catalog_uids = (await getHiddenCatalogUids()).filter((u) => u !== record.copied_from).concat([record.copied_from]);
  if (Array.isArray(S().settings.favorite_refs)) S().settings.favorite_refs = replaceFavoriteRef(S().settings.favorite_refs, record.copied_from, record.id);
  S().writes.push({ op: "copyBuiltinToCustom", record: clone(record) });
  return clone(record);
}

// ---------- 我的組合（工作線 C；語意照 db.js，寫入驗證用真的 validateSavedMeal） ----------
const savedOf = () => S().savedMeals || (S().savedMeals = []);
function newSaved(rec) {
  const now = new Date().toISOString();
  const record = Object.assign({ archived: false }, clone(rec), { id: rec.id || "saved_" + String(++savedSeq).padStart(4, "0"), created_at: now, updated_at: now });
  validateSavedMeal(record);
  return record;
}
export { validateSavedMeal, applySavedMealPatch };
export async function listSavedMeals() {
  return clone(savedOf().slice().sort((a, b) => (a.created_at !== b.created_at ? (a.created_at < b.created_at ? -1 : 1) : a.id < b.id ? -1 : a.id > b.id ? 1 : 0)));
}
export async function getSavedMeal(id) { return clone(savedOf().find((r) => r.id === id)) || null; }
export async function addSavedMeal(rec) {
  const record = newSaved(rec);
  savedOf().push(record);
  S().writes.push({ op: "addSavedMeal", record: clone(record) });
  return clone(record);
}
export async function updateSavedMeal(id, patch) {
  const i = savedOf().findIndex((r) => r.id === id);
  if (i === -1) throw new Error("[fake-db] 找不到我的組合：" + id);
  const next = applySavedMealPatch(savedOf()[i], patch, new Date().toISOString());
  savedOf()[i] = clone(next);
  S().writes.push({ op: "updateSavedMeal", id: id, record: clone(next) });
  return clone(next);
}
export async function addDailyLogWithSavedMeal(entry, rec) {
  validateDailyLog(entry);
  const saved = newSaved(rec);
  const log = Object.assign({}, clone(entry), { id: entry.id || "log_" + String(++seq).padStart(4, "0") });
  S().dailyLogs.push(log);
  savedOf().push(saved);
  S().writes.push({ op: "addDailyLog", entry: clone(log) });
  S().writes.push({ op: "addSavedMeal", record: clone(saved) });
  return { log: clone(log), saved: clone(saved) };
}

export async function addDailyLog(entry) {
  validateDailyLog(entry);
  const record = Object.assign({}, clone(entry), { id: entry.id || "log_" + String(++seq).padStart(4, "0") });
  S().dailyLogs.push(record);
  S().writes.push({ op: "addDailyLog", entry: clone(record) });
  return record;
}
export async function getDailyLogs(r) {
  return clone(S().dailyLogs.filter((e) => inRange(e.log_date, r)).sort(byDateThenId));
}
export async function undoDailyLog(id) {
  const entry = S().dailyLogs.find((l) => l.id === id);
  if (!entry) return null;
  S().dailyLogs = S().dailyLogs.filter((l) => l.id !== id);
  S().writes.push({ op: "removeDailyLog", id: id });
  return clone(entry);
}

export async function addExerciseLog(entry) {
  validateExerciseLog(entry);
  const record = Object.assign({}, clone(entry), { id: entry.id || "ex_" + String(++seq).padStart(4, "0") });
  S().exerciseLogs.push(record);
  return record;
}
export async function getExerciseLogs(r) {
  return clone(S().exerciseLogs.filter((e) => inRange(e.log_date, r)).sort(byDateThenId));
}

export async function getSetting(key) { return clone(S().settings[key]) ?? null; }
export async function setSetting(key, value) { validateSetting(key, value); S().settings[key] = clone(value); return value; }

// 備份（PRD 11.6）：純函式直接用真的 db.js；讀寫資料庫的兩個函式 diff-recs 不會呼叫，只為了讓模組連結得起來。
export { BACKUP_SCHEMA_VERSION, migrateBackup, validateBackup, summarizeBackup, validateProfile, applyCustomFoodPatch } from "../../js/data/db.js";
export async function exportAllData() { throw new Error("[fake-db] 不支援 exportAllData"); }
export async function importAllData() { throw new Error("[fake-db] 不支援 importAllData"); }
