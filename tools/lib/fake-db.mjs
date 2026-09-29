// diff-recs 用的記憶體假資料庫：取代 js/data/db.js（由 adapter-v2 的 module hook 換掉），介面相同。
// 讀取順序照 IndexedDB：依日期範圍讀的依 log_date、再依 id 排序；custom_foods 依 id 排序。
// 寫入驗證直接用真的 db.js（validateDailyLog 等），確保快照走的是同一套格式檢查。

import { validateDailyLog, validateWeightLog, validateExerciseLog, validateCustomFood } from "../../js/data/db.js";

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
export function __resetSeq() { seq = 0; }

export { validateDailyLog, validateWeightLog, validateExerciseLog, validateCustomFood };

export async function getProfile() { return clone(S().profile); }
export async function saveProfile(p) {
  S().profile = clone(p);
  S().writes.push({ op: "saveProfile", disliked: clone(p.disliked_ingredients) });
  return p;
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
  const now = new Date().toISOString();
  const record = Object.assign({ copied_from: null, archived: false, created_at: now }, clone(food),
    { id: food.id || "custom_" + String(++seq).padStart(4, "0"), updated_at: now });
  S().customFoods.push(record);
  S().writes.push({ op: "addCustomFood", record: clone(record) });
  return clone(record);
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
export async function setSetting(key, value) { S().settings[key] = clone(value); return value; }
