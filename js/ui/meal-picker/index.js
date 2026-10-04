// 輕盈計畫 — 「自己選」選擇器：超商｜外食｜自煮三個型態分頁＋共用的「加飲品・水果」「加點單品」兩步（PRD 第 2、4 節、6.3、13.4；Phase 0 計畫）。
// 分頁、分組、預設分頁、送出規則、合計都呼叫 engine（engine/picker.js、engine/meal-content.js），這裡只管狀態、畫面與事件；
// ui 不自己加總營養（章程 C4.11）。

import { SLOT_LABELS, DEFAULT_MEAL_PREFS } from "../../core/slots.js";
import { escapeHtml } from "../../core/html.js";
import { $, sodiumText, notIncludedText } from "../dom.js";
import { getCustomIngredients,
  getProfile, getDailyLogs, getCustomFoods, addDailyLog, addCustomFood, getSetting, setSetting,
  getHiddenCatalogUids, copyBuiltinToCustom, updateCustomFood, addDislikedIngredient, removeDislikedIngredient,
  getFavoriteRefs, addFavoriteRef, removeFavoriteRef, removeFavoriteFrom,
  listSavedMeals, addDailyLogWithSavedMeal, updateSavedMeal, setMealPlan, setMealPlanWithSavedMeal,
} from "../../data/db.js";
import { loadTfdaLookup, loadCatalog, fromCustomFood } from "../../data/catalog.js";
import { passesHardFilters } from "../../engine/filters.js";
import { slotNutrientShare } from "../../engine/budget.js";
import { effectiveTodayLogs } from "../../engine/today.js";
import { shortDate, weekdayLabel, dateAddDays } from "../../core/dates.js";
import { BACKFILL_DAYS, HOME_MEAL_SLOTS, HOME_MEAL_DISH_MAX } from "../../core/config.js";
import {
  buildDraftContent, contentTotals, buildLogEntry, manualSelectionProblem, canAddManualItem, slotGaps,
  composeProblem, oilOptions, draftLogName, copyFromBuiltin,
  resolveSavedMeal, savedMealDraft, savedMealTotals, savedMealDefaultName, savedMealUnavailableLine, toSavedContent, savedMealForSave,
  toPlanContent, homeEstimate, homeEstimateDefaults, homeMealDefaultForm, homeMealDraftPart, homeMealProblem, homeMealFormOf, homeMealItemCount,
} from "../../engine/meal-content.js";
import {
  resolveDefaultMealType, tabOfMealType, partitionByMealType, partitionAllChannels, groupForTab, placeNewCustom, fillableReason, splitDisliked,
  effectiveFavorites, splitFavorites, favoriteEntries, drinkGroups,
  addFood, stepFood, removeFood, setFoodAmount, toggleFoodMode,
} from "../../engine/picker.js";
import { savedRowHtml, saveAsHtml } from "./saved-row.js";
import { ingredientSections, foodTreeSections, foodsBlockLabel } from "../../engine/foods.js";
import { ingredientItem } from "../../engine/my-ingredients.js";
import { productTabHtml, drinkGridHtml, drinkCardHtml, selectedSectionHtml, selectedRowHtml, dislikeNoticeHtml, dislikedGroupHtml } from "./product-tab.js";
import { drinksFruitStepHtml, addFoodsStepHtml, foodSearchResultsHtml } from "./food-step.js";
import { valuesFromRecord, recordFromValues, customFoodNotes, customFoodFormHtml, readCustomFoodInputs, onCustomFoodFormClick } from "../custom-food-form.js";
import { cookTabHtml, archetypeOptions, optionReason } from "./cook-tab.js";
import { seasonOfDate } from "../../core/dates.js";
import { estimateCardHtml, emptyHomeEst, normalizeHomeCfg } from "./estimate-card.js";
import { emptyQuickAdd, quickAddRecord, quickAddNotes, quickAddFormHtml, readQuickAddInputs } from "./quick-add.js";
import { getCalibratedTargets } from "../calibration.js";
import { todayStr, nowIso } from "../clock.js";

// 選擇器記住「這個時段上次送出的型態」：只有送出成功才寫，只決定打開時停在哪一頁（PRD 第 4 節、章程 C4.15）
const LAST_PICKED_KEY = "picker_last_meal_type";

const TABS = ["convenience", "delivery", "cook"];
const TAB_LABELS = { convenience: "超商", delivery: "外食", cook: "自煮" };

export const mealPicker = {
  slot: null, tab: "convenience", profile: null, targets: null, todayLogs: null, catalog: null, onLogged: null,
  lastPicked: {},
  tabs: {
    convenience: { items: [], reasons: {}, selected: [] },
    delivery: { items: [], reasons: {}, selected: [], estimates: [] },
  },
  drinks: { items: [], reasons: {} },
  drinkUid: null,
  // 單品（工作線 D 切片 7）：foods＝分層品項與被擋的灰字、code；foodSel＝[{ uid, qty }]，三個分頁共用、自己一套份量（不用 qtyByUid）
  foods: { items: [], byId: {}, labels: {}, codes: {} },
  foodSections: null, foodSel: [], foodOpen: {}, foodQuery: "",
  // 常吃（工作線 D 切片 5）：getFavoriteRefs 的原樣清單；畫面一律經 pickerFavSet 扣掉不吃。只影響組 HTML，state 的 items、reasons 不動
  favorites: [],
  // 我的組合（工作線 C）：savedCards＝選擇器最上面一列（打開時解析一次，rebuildLists 重算）；savedNotice＝帶入後的說明；
  // saveAs＝入口 1 的勾選與名稱（nameEdited：使用者改過名稱就不再跟著選取更新）；editing＝編輯中的組合（沒有時段）；
  // inserted＝帶入時插進清單的品項（uid → 分頁或 "drinks"，選擇器關閉前保留）
  savedRecords: [], savedCards: [], savedNotice: null, saveAs: { on: false, name: "", nameEdited: false }, editing: null, onSaved: null, inserted: {},
  // 自煮分頁：tier＝快煮/開伙子切換（就是這餐的 meal_type，decisions #34）；draft＝engine 的自煮草稿
  cook: { tier: "cook_full", draft: null },
  // 快速新增表單（null＝收起）：{ tab, values }；quickAddMessage：存完之後的中性說明
  quickAdd: null,
  quickAddMessage: null,
};

function emptyCookDraft() {
  return { archetype: null, proteins: [], staple: null, vegetables: [], seasoning: null, method: null, primaryScale: 1, implicitOverride: {} };
}

// 被擋的原因（uid → 文字，picker 快照錄這個）與原因代碼（uid → code，ui 依代碼決定位置，decisions #80）
function reasonsFor(items, profile) {
  const out = {};
  items.forEach(function (it) {
    const r = passesHardFilters(it, profile);
    if (!r.ok) out[it.uid] = r.reason;
  });
  return out;
}

function codesFor(items, profile) {
  const out = {};
  items.forEach(function (it) {
    const r = passesHardFilters(it, profile);
    if (!r.ok) out[it.uid] = r.code;
  });
  return out;
}

// 單品：分層品項＋我的食材（切片 8b-2；衛福部來源要查詢檔，還沒載好就先不列）。灰字照「我的食物」的寫法（foodsBlockLabel，decisions #117）
function myIngredientList() {
  const m = mealPicker;
  return (m.customIngredients || []).filter(function (r) { return r.archived !== true; })
    .map(function (r) { const it = ingredientItem(r, m.tfdaLookup); return it ? Object.assign(it, { aliases: it.tfda ? [it.tfda.name] : [] }) : null; })
    .filter(Boolean);
}

function foodListsFor(catalog, profile) {
  const ft = catalog.foodTree || { items: [], byId: {} };
  const mine = myIngredientList();
  const items = ft.items.concat(mine);
  const byId = Object.assign({}, ft.byId || {});
  mine.forEach(function (it) { byId[it.uid] = it; });
  const labels = {};
  items.forEach(function (it) {
    const label = foodsBlockLabel(it, profile);
    if (label) labels[it.uid] = label;
  });
  return { items: items, byId: byId, labels: labels, codes: codesFor(items, profile), mine: ingredientSections(mine) };
}

// 有衛福部來源的我的食材時才載查詢檔（PRD 12.2）；選擇器先畫，載好再補我的食材（審核 S5），失敗寫一行
function ensurePickerLookup() {
  const m = mealPicker;
  if (m.tfdaLookup || !(m.customIngredients || []).some(function (r) { return r.source === "tfda"; })) return;
  m.lookupState = "loading";
  loadTfdaLookup().then(function (l) {
    m.tfdaLookup = l; m.lookupState = "ok";
    m.foods = foodListsFor(m.catalog, m.profile);
    renderDrinks();
  }, function (err) {
    console.error(err);
    m.lookupState = "failed";
    renderDrinks();
  });
}

// 選擇器 state 的 items、reasons 不動，只在組 HTML 時把標了不吃的分出來（picker 快照不變的前提）
function splitOf(list) {
  return splitDisliked(list.items, function (it) { return list.codes ? list.codes[it.uid] : null; });
}

// 常吃（扣掉不吃，PRD 13.5）
function pickerFavSet() {
  const m = mealPicker;
  return effectiveFavorites(m.favorites, m.profile ? m.profile.disliked_ingredients : []);
}

async function readLastPicked() {
  try {
    const v = await getSetting(LAST_PICKED_KEY);
    return v && typeof v === "object" ? v : {};
  } catch (e) {
    console.error(e); // 讀不到就當沒有記錄，不擋選擇器
    return {};
  }
}

// opts：{ onLogged（記錄成功後要做的事，今日建議重新整理）, savedEdit（要編輯的組合紀錄：沒有時段、不寫紀錄，PRD 12.6）, onSaved,
//         mode（"log" 今天記錄＝預設；"plan" 排預約；"backfill" 補記過去的一餐，日期切換）, date（plan、backfill 的日期）, planPreset（改預約時帶入的預約紀錄）,
//         todayPlans（今天的暫時紀錄：log 模式算這個時段的配額時扣掉其他時段的預約） }；
// 模式與日期在打開時就定（23:59 打開、00:01 送出也寫同一天，設計草案第 9 節 S7）。舊的呼叫方式 openMealPicker(slot, onLogged) 照樣可以用
export async function openMealPicker(slotArg, opts) {
  const o = typeof opts === "function" ? { onLogged: opts } : (opts || {});
  const editing = o.savedEdit || null;
  const slot = editing ? null : slotArg;
  let profile;
  try { profile = await getProfile(); } catch (e) { console.error(e); return; }
  if (!profile) { alert("請先到「基本資料」分頁填寫並按「計算」。"); return; }
  const targets = await getCalibratedTargets(profile);
  const mode = editing ? "edit" : o.mode === "plan" ? "plan" : o.mode === "backfill" ? "backfill" : "log";
  const today = todayStr();
  const day = (mode === "plan" || mode === "backfill") && o.date ? o.date : today;
  const todayLogs = mode === "log" ? effectiveTodayLogs(await getDailyLogs({ start: today, end: today }), o.todayPlans) : [];
  const catalog = await loadCatalog();
  const rawCustoms = await getCustomFoods();
  const customs = rawCustoms.map(fromCustomFood);
  let customIngredients = [];
  try { customIngredients = await getCustomIngredients(); } catch (err) { console.error(err); }
  const lastPicked = await readLastPicked();
  // 隱藏清單讀不到不擋選擇器（比照 readLastPicked），當成沒有隱藏
  let hiddenUids = [];
  try { hiddenUids = await getHiddenCatalogUids(); } catch (err) { console.error(err); }
  const parts = editing ? partitionAllChannels(catalog.products, customs, hiddenUids) : partitionByMealType(catalog.products, customs, slot, hiddenUids);
  // 組合讀不到不擋選擇器，當成沒有組合
  let savedList = [];
  if (!editing) { try { savedList = await listSavedMeals(); } catch (err) { console.error(err); } }
  // 常吃讀不到不擋選擇器，當成沒有常吃
  let favorites = [];
  try { favorites = await getFavoriteRefs(); } catch (err) { console.error(err); }

  const m = mealPicker;
  m.slot = slot; m.profile = profile; m.targets = targets; m.todayLogs = todayLogs; m.catalog = catalog;
  m.onLogged = o.onLogged || null; m.lastPicked = lastPicked;
  m.editing = editing; m.onSaved = o.onSaved || null; m.inserted = {}; m.savedNotice = null;
  m.mode = mode; m.date = day;
  m.saveAs = { on: false, name: "", nameEdited: false };
  m.savedRecords = savedList.filter(function (r) { return !r.archived; });
  // B-1a：隱藏、復原、複製、補填之後要重新分頁，所以留著我的品項（原始紀錄與轉好的品項）與隱藏清單
  m.customRecords = {};
  rawCustoms.forEach(function (r) { m.customRecords[r.id] = r; });
  m.customs = customs; m.hiddenUids = hiddenUids.slice(); m.favorites = favorites;
  // 我的食材（切片 8b）：組合解析要帶（審核 M6）；查詢檔在 8b-2 有衛福部來源時才載
  m.customIngredients = customIngredients; m.tfdaLookup = null; m.lookupState = "idle";
  m.editForm = null; m.notice = null; m.drinkNotice = null;
  m.dislikedChanged = false; // 不吃清單在選擇器裡改過：關閉時今日建議要重算（計畫 S7）
  ["convenience", "delivery"].forEach(function (t) {
    m.tabs[t] = { items: parts[t], reasons: reasonsFor(parts[t], profile), codes: codesFor(parts[t], profile), selected: [] };
  });
  m.tabs.delivery.estimates = [];
  const homeShare = slot ? slotNutrientShare(targets, mode === "log" ? todayLogs : [], profile.enabled_slots, slot).kcalShare : 0; // 預約、補記看整天的時段份額（那天的紀錄不在 todayLogs）
  m.homeEst = emptyHomeEst(homeEstimateDefaults(targets, homeShare, catalog.homeDishes)); // 「主食＋家常菜」估算表單（decisions #151），關掉選擇器再開回到預設
  m.drinks = { items: parts.drinks, reasons: reasonsFor(parts.drinks, profile), codes: codesFor(parts.drinks, profile) };
  m.drinkUid = null;
  m.qtyByUid = {}; // 份量倍數（PRD 12.3）：uid → 0.5／1.5／2，缺＝1；商品分頁的品項與飲料共用
  m.foods = foodListsFor(catalog, profile);
  m.foodSections = { cook: foodTreeSections(catalog.foodTree, "cook"), drinks: foodTreeSections(catalog.foodTree, "drinks") };
  m.foodSel = []; m.foodOpen = {}; m.foodQuery = "";
  m.groupOpen = {}; // 品項分類與現成飲料分組的收合（decisions #144），關掉選擇器再開回到預設
  ensurePickerLookup();
  m.quickAdd = null;
  m.quickAddMessage = null;
  // 沒存過的時段用預設偏好（跟推薦、基本資料表單顯示的一樣）；不合法的值（含 auto）由 engine 往下找上次送出的型態
  const prefs = Object.assign({}, DEFAULT_MEAL_PREFS, profile.meal_prefs);
  const mealType = resolveDefaultMealType({ planned: null, pref: prefs[slot], lastPicked: lastPicked[slot] });
  m.tab = tabOfMealType(mealType);
  // 子切換的預設：預設型態就是自煮時用它；否則用這個時段上次送出的自煮型態；都沒有用開伙（不預先灰掉任何選項）
  m.cook = {
    tier: tabOfMealType(mealType) === "cook" ? mealType : tabOfMealType(lastPicked[slot]) === "cook" ? lastPicked[slot] : "cook_full",
    draft: emptyCookDraft(),
    home: { open: false, form: homeMealDefaultForm(targets, homeShare, catalog) }, // 共餐（decisions #152）：預設份量同估算卡（#151）
  };
  m.season = seasonOfDate(day); // 共餐清單只列這一餐那天的當季菜

  computeSavedCards();
  if (editing) applySaved(editing);
  else if ((mode === "plan" || mode === "backfill") && o.planPreset) applySaved(o.planPreset);
  // 標題與送出鈕只在打開時寫（render 路徑不寫，快照的 domNN 才不會位移，審核第 4 節）
  const titleEl = $("#meal-picker-title");
  if (titleEl) {
    titleEl.innerHTML = (editing ? "編輯組合：" : mode === "plan" ? "排進 " + shortDate(day) + "（" + weekdayLabel(day) + "）：" : mode === "backfill" ? "補記 " + shortDate(day) + "（" + weekdayLabel(day) + "）：" : "自己選這一餐：") + '<span id="meal-picker-slot-label">' +
      escapeHtml(editing ? editing.name : SLOT_LABELS[slot] || slot) + "</span>";
  }
  const submitEl = $("#meal-picker-submit");
  if (submitEl) submitEl.textContent = editing ? "存回組合" : mode === "plan" ? "排進預約" : mode === "backfill" ? "補記這餐" : "記下這餐";
  renderMealPicker();
  const overlay = $("#meal-picker-overlay");
  if (overlay) overlay.hidden = false;
  const body = $("#meal-picker-body");
  if (body) body.scrollTop = 0;
}

export function selectTab(tab) {
  if (TABS.indexOf(tab) === -1) return;
  syncQuickAdd();
  mealPicker.tab = tab;
  mealPicker.quickAddMessage = null;
  renderMealPicker();
  const body = $("#meal-picker-body");
  if (body) body.scrollTop = 0;
}

function passItemsOf(t) {
  return t.items.filter(function (it) { return !t.reasons[it.uid]; });
}

function selectedItems(tab) {
  const t = mealPicker.tabs[tab];
  if (!t) return [];
  return passItemsOf(t).filter(function (it) { return t.selected.indexOf(it.uid) !== -1; });
}

function selectedDrink() {
  const m = mealPicker;
  return m.drinkUid ? m.drinks.items.filter(function (d) { return d.uid === m.drinkUid && !m.drinks.reasons[d.uid]; })[0] || null : null;
}

// 已選的單品（還能選的），照點選順序：[{ item, qty } | { item, amount }]
function selectedFoods() {
  const m = mealPicker;
  return m.foodSel.filter(function (f) { return m.foods.byId[f.uid] && !m.foods.labels[f.uid]; })
    .map(function (f) { return f.amount != null ? { item: m.foods.byId[f.uid], amount: f.amount } : { item: m.foods.byId[f.uid], qty: f.qty }; });
}

// ---------- 我的組合（工作線 C；PRD 11.2、11.3、12.6） ----------

// 跟 saved-ctx.js 同一批欄位（含我的食材，切片 8b 審核 M6），取自選擇器打開時讀好的 state
function savedCtx(slot) {
  const m = mealPicker;
  return { hidden: m.hiddenUids, customs: m.customs, slot: slot, profile: m.profile, customIngredients: m.customIngredients, tfdaLookup: m.tfdaLookup };
}

// 選擇器最上面一列：每個組合用這個時段解析（解析與送出一致，decisions #125），熱量＝帶入後的摘要（decisions #124）
function computeSavedCards() {
  const m = mealPicker;
  m.savedCards = m.editing ? [] : m.savedRecords.map(function (rec) {
    const r = resolveSavedMeal(rec, m.catalog, savedCtx(m.slot));
    const unavailable = [savedMealUnavailableLine(r)].concat(r.notes).filter(Boolean).join("；");
    return {
      id: rec.id, name: rec.name, meal_type: rec.content.meal_type, contentText: savedMealDefaultName(rec.content, m.catalog, savedCtx(m.slot)),
      kcal: savedMealTotals(r, m.catalog, m.profile.oil_habit).kcal, unavailable: unavailable || null, usable: r.available.length > 0,
    };
  });
}

// 帶入的品項不在目標清單裡（時段、管道改過…）：插進清單最後並記住（rebuildLists 會保留，審核 M6）
function ensureListed(where, item) {
  const m = mealPicker;
  const list = where === "drinks" ? m.drinks : m.tabs[where];
  if (!list.items.some(function (x) { return x.uid === item.uid; })) {
    list.items.push(item);
    m.inserted[item.uid] = where;
  }
}

function insertedNote(uid) {
  return mealPicker.inserted[uid] ? "從我的組合帶入（這個時段平常不列出）" : null;
}

// 帶入一個組合：取代目標分頁的選取與共用的飲料、單品；其他分頁的選取保留（decisions #125）。被擋、已不提供的不預選，寫在說明裡
function applySaved(rec) {
  const m = mealPicker;
  const r = resolveSavedMeal(rec, m.catalog, savedCtx(m.slot));
  const d = savedMealDraft(r);
  const tab = d.kind === "cook" ? "cook" : d.meal_type;
  m.tab = tab;
  m.quickAdd = null; m.quickAddMessage = null; m.editForm = null; m.notice = null; m.drinkNotice = null;
  if (m.drinkUid) delete m.qtyByUid[m.drinkUid];
  m.drinkUid = null;
  m.foodSel = d.foods.map(function (f) { return f.amount != null ? { uid: f.item.uid, amount: f.amount } : { uid: f.item.uid, qty: f.qty }; });
  if (tab === "cook") {
    m.cook.tier = d.meal_type;
    m.cook.draft = {
      archetype: d.archetype, proteins: d.proteins, staple: d.staple, vegetables: d.vegetables, seasoning: d.seasoning, method: d.method,
      primaryScale: d.primaryScale, implicitOverride: d.implicitOverride,
    };
    // 共餐帶回：表單還原並展開（decisions #152）；沒有共餐就維持收起
    if (d.homeMeal) m.cook.home = { open: true, carried: true, form: homeMealFormOf(d.homeMeal, m.catalog, { dish: m.cook.home.form.dish }) };
  } else {
    const t = m.tabs[tab];
    t.selected.forEach(function (u) { delete m.qtyByUid[u]; });
    if (tab === "delivery") t.estimates = d.estimates.slice();
    d.items.forEach(function (it) { ensureListed(tab, it); });
    t.selected = d.items.map(function (it) { return it.uid; });
  }
  if (d.drink) { ensureListed("drinks", d.drink); m.drinkUid = d.drink.uid; }
  Object.assign(m.qtyByUid, d.qtyByUid);
  const skipped = r.blocked.map(function (b) { return "「" + b.name + "」" + b.reason.replace(/。$/, ""); })
    .concat(r.gone.map(function (g) { return "「" + g.name + "」已不提供"; }));
  m.savedNotice = (m.editing ? "編輯「" : "已帶入「") + rec.name + "」" +
    (skipped.length ? "，有 " + skipped.length + " 項" + (m.editing ? "不會存進組合" : "沒有帶入") + "：" + skipped.join("、") + "。" : "。") +
    (r.notes.length ? r.notes.join("；") + "。" : "");
}

// 入口 1 的預設名稱：目前草稿的品名以「＋」串接（decisions #124）；有估算或沒選東西時是空字串
function currentSaveName() {
  const m = mealPicker;
  const d = currentDraft();
  if ((d.estimates || []).length > 0) return "";
  const content = buildDraftContent(d, { oilHabit: m.profile.oil_habit });
  if (content.components.length === 0) return "";
  return savedMealDefaultName(toSavedContent(content, { keepImplicit: false }), m.catalog, savedCtx(null));
}

// 使用者改過用油／調味＝覆寫不是空的（換餐型會清空；審核建議 6）
function keepImplicitOf(d) {
  return d.kind === "cook" && Object.keys(d.implicitOverride || {}).length > 0;
}

// 目前分頁的草稿（摘要與送出共用同一份，看到的＝存下的）；meal_type 一律是分頁值（decisions #47）；估算只在外食分頁（decisions #46）
export function currentDraft() {
  const m = mealPicker;
  const qtyByUid = Object.assign({}, m.qtyByUid);
  if (m.tab === "cook") return Object.assign({ kind: "cook", meal_type: m.cook.tier, drink: selectedDrink(), qtyByUid: qtyByUid, foods: selectedFoods(), homeMeal: currentHomeMeal() }, m.cook.draft);
  return {
    kind: "products", meal_type: m.tab, items: selectedItems(m.tab),
    estimates: m.tab === "delivery" ? m.tabs.delivery.estimates.slice() : [], drink: selectedDrink(), qtyByUid: qtyByUid, foods: selectedFoods(),
  };
}

// 共餐在目前的選擇器裡有沒有效：開伙、午餐或晚餐、展開了、至少選一道菜或湯；有問題（過敏原等）不進草稿，由 submitProblem 說明
// 共餐區塊可不可以用：午餐、晚餐；編輯組合（沒有時段）也要顯示，不然組合裡的共餐存回時會被刪掉；
// 帶入含共餐的組合或預約到別的時段時照樣顯示（carried），數字才跟卡片一致（審核 M-1、M-2）
function homeMealAllowed() {
  const m = mealPicker;
  return !!m.cook.home && (m.editing || (m.slot !== null && HOME_MEAL_SLOTS.indexOf(m.slot) !== -1) || m.cook.home.carried === true);
}

function homeMealActive() {
  const m = mealPicker;
  return m.tab === "cook" && m.cook.tier === "cook_full" && homeMealAllowed() && m.cook.home.open;
}

function currentHomeMeal() {
  const m = mealPicker;
  if (!homeMealActive()) return null;
  try { return homeMealDraftPart(m.cook.home.form, m.catalog, m.profile); } catch (e) { return null; }
}

// 送出規則用的品項（角色上限含飲料）
function draftRoleItems(d) {
  return d.items.concat(d.drink ? [d.drink] : []);
}

export function currentTotals() {
  return contentTotals(buildDraftContent(currentDraft(), { oilHabit: mealPicker.profile.oil_habit }), mealPicker.catalog);
}

// 自煮分頁：選了餐型要配完整；沒選餐型時有單品或飲料就可以送出（PRD 13.4，decisions #122 修正 #45）
function submitProblem(d) {
  if (d.kind === "cook") {
    if (homeMealActive()) {
      const hp = homeMealProblem(mealPicker.cook.home.form, mealPicker.catalog, mealPicker.profile);
      if (hp) return hp;
    }
    if (homeMealActive() && !d.homeMeal && !d.archetype && d.foods.length === 0 && !d.drink) return "共餐：請至少選一道菜或湯。";
    const p = composeProblem(d, { tier: d.meal_type });
    return p && d.archetype && d.foods.length > 0 ? p + "（只記單品可以再點一次「" + d.archetype.name + "」取消餐型）" : p;
  }
  return manualSelectionProblem(draftRoleItems(d), mealPicker.slot, { estimates: d.estimates.length, foods: d.foods.length });
}

// 摘要的「已選 N 件」（自煮分頁有餐型時寫「還沒配好／已配好」，不用這個）
function pickedCount(d) {
  return (d.kind === "cook" ? homeMealItemCount(d.homeMeal) : d.items.length + d.estimates.length) + d.foods.length + (d.drink ? 1 : 0);
}

function fmtNutrient(v) { return v == null ? "—" : Math.round(v) + "g"; }

function renderTabs() {
  const bar = $("#meal-picker-tabs");
  if (!bar) return;
  bar.innerHTML = TABS.map(function (t) {
    const sel = t === mealPicker.tab;
    return '<button type="button" role="tab" class="meal-picker-tab' + (sel ? " selected" : "") + '" data-tab="' + t +
      '" aria-selected="' + (sel ? "true" : "false") + '">' + TAB_LABELS[t] + "</button>";
  }).join("");
}

function renderPanel() {
  const panel = $("#meal-picker-panel");
  if (!panel) return;
  const m = mealPicker;
  const top = m.editing ? (m.savedNotice ? '<p class="meal-picker-note">' + escapeHtml(m.savedNotice) + "</p>" : "") : savedRowHtml(m.savedCards, m.savedNotice);
  if (m.tab === "cook") {
    const r = cookTabHtml(m.catalog, m.slot, m.cook, m.profile, pickerFavSet(), homeMealAllowed() ? { season: m.season } : null);
    m.cookSteps = r.steps;
    panel.innerHTML = top + r.html;
    bindSlider();
    return;
  }
  syncQuickAdd();
  const t = m.tabs[m.tab];
  const split = splitOf(t);
  // 常吃搬到「1. 選品項」最上面（decisions #126 ②）；只在組 HTML 時分，state 不動
  const fav = pickerFavSet();
  const favSplit = splitFavorites(split.rest, fav);
  const reasonOf = function (it) { return t.reasons[it.uid]; };
  const groups = groupForTab(favSplit.rest, reasonOf);
  syncEditForm();
  // 編輯組合：不顯示估算（組合不收估算）與快速新增（沒有時段，審核 M4）
  let html = top + (m.tab === "delivery" && !m.editing ? estimateCardHtml(t.estimates, m.homeEst, m.catalog.homeDishes) : "");
  html += m.notice && !m.notice.drink ? dislikeNoticeHtml(m.notice) : "";
  html += selectedSectionHtml(selectedItems(m.tab), m.qtyByUid, insertedNote, fav);
  html += '<div class="meal-picker-step-label">1. 選品項（可以多選）</div>' +
    productTabHtml(groups, t.selected, TAB_LABELS[m.tab], fillableReason, favoriteEntries(favSplit.favorites, reasonOf), m.groupOpen) +
    dislikedGroupHtml(split.disliked, false);
  if (m.quickAddMessage) html += '<p class="meal-picker-note">' + escapeHtml(m.quickAddMessage) + "</p>";
  if (m.editing && !m.editForm) { panel.innerHTML = html; return; }
  html += m.editForm && !m.editForm.drink ? editFormHtml() : m.quickAdd && m.quickAdd.tab === m.tab
    ? quickAddFormHtml(m.quickAdd.values, TAB_LABELS[m.tab], m.profile, quickAddNotes(m.quickAdd.values, m.slot, m.tab, m.profile))
    : '<button type="button" class="secondary-btn meal-picker-add-btn" data-quick-add-open>＋新增到我的' + TAB_LABELS[m.tab] + "品項</button>";
  panel.innerHTML = html;
}

// 快速新增表單的文字欄位在重畫前先讀回來，重畫不會吃掉使用者打的字
function syncQuickAdd() {
  const m = mealPicker;
  if (m.quickAdd && m.quickAdd.tab === m.tab) readQuickAddInputs(document.getElementById("quick-add-form"), m.quickAdd.values);
}

function refreshQuickAddNotes() {
  const m = mealPicker;
  if (!m.quickAdd) return;
  syncQuickAdd();
  const el = document.getElementById("quick-add-notes");
  if (el) el.innerHTML = quickAddNotes(m.quickAdd.values, m.slot, m.quickAdd.tab, m.profile).map(function (t) { return "<p>" + escapeHtml(t) + "</p>"; }).join("");
}

function renderDrinks() {
  const el = $("#meal-picker-drinks");
  if (!el) return;
  const m = mealPicker;
  syncEditForm();
  const split = splitOf(m.drinks);
  const fav = pickerFavSet();
  const favSplit = splitFavorites(split.rest, fav);
  const drinkReason = function (it) { return m.drinks.reasons[it.uid] || null; };
  const ownGroup = m.tab === "convenience" ? "convenience" : "delivery";
  const groups = drinkGroups(favSplit.rest, m.tab).map(function (g) {
    const key = "drinks:" + g.key;
    const hasSel = g.items.some(function (it) { return it.uid === m.drinkUid; });
    const toEntry = function (it) { return { item: it, reason: drinkReason(it) }; };
    return { key: key, label: g.label, entries: g.items.map(toEntry),
      subgroups: g.subgroups.map(function (s) { return { label: s.label, entries: s.items.map(toEntry) }; }),
      open: key in m.groupOpen ? m.groupOpen[key] : g.key === ownGroup || hasSel };
  });
  // 選中那杯的份量與動作放在飲料步驟（三分頁都看得到，B-1a 計畫 2.1 第 17 項）
  const drink = selectedDrink();
  let extra = drink ? '<div class="meal-picker-selected">' + selectedRowHtml(drink, m.qtyByUid[drink.uid] || 1, insertedNote(drink.uid), !!fav[drink.uid]) + "</div>" : "";
  if (m.notice && m.notice.drink) extra += dislikeNoticeHtml(m.notice);
  if (m.drinkNotice) extra += '<p class="meal-picker-note">' + escapeHtml(m.drinkNotice) + "</p>";
  if (m.editForm && m.editForm.drink) extra += editFormHtml();
  const stepNo = m.tab === "cook" ? (m.cookSteps || 2) + 1 : 2;
  const st = foodStepState();
  // 兩個共用步驟一次寫進 #meal-picker-drinks（計畫 8.2 M4：這條路徑只碰既有的選擇器，快照的 fake DOM 也會跑）
  const hasEstimates = m.tab === "delivery" && m.tabs.delivery.estimates.length > 0;
  if (m.saveAs.on && !m.saveAs.nameEdited) m.saveAs.name = currentSaveName();
  const favDrinks = favSplit.favorites.map(function (it) { return { item: it, reason: drinkReason(it) }; });
  const drinkCard = function (e) { return drinkCardHtml(e, m.drinkUid, fillableReason); };
  el.innerHTML = drinksFruitStepHtml(st, stepNo, drinkGridHtml(groups, m.drinkUid, fillableReason), extra, split.disliked, favDrinks, drinkCard) +
    addFoodsStepHtml(st, stepNo + 1) + (m.editing ? "" : saveAsHtml(m.saveAs, hasEstimates));
}

function foodStepState() {
  const m = mealPicker;
  return { foods: m.foods, sections: Object.assign({ mine: m.foods.mine }, m.foodSections), sel: m.foodSel, open: m.foodOpen, query: m.foodQuery, fav: pickerFavSet(),
    lookupNote: m.lookupState === "loading" ? "你加的衛福部食材載入中…" : m.lookupState === "failed" ? "衛福部資料載入失敗，你加的衛福部食材這次不能選，請稍後再試。" : null };
}

// ---------- B-1a：份量、不吃、複製成我的版本、補填 ----------

const EDIT_FORM_ID = "picker-custom-food-form";

function editFormHtml() {
  const f = mealPicker.editForm;
  const title = f.mode === "copy" ? "複製成我的版本" : "補填我的品項";
  const notes = (f.error ? [f.error] : []).concat(customFoodNotes(f.values, mealPicker.profile));
  return customFoodFormHtml(f.values, { formId: EDIT_FORM_ID, title: title, saveLabel: f.mode === "copy" ? "存成我的品項" : "存檔", profile: mealPicker.profile, notes: notes });
}

// 表單的文字欄位在重畫前先讀回來
function syncEditForm() {
  const f = mealPicker.editForm;
  if (f) readCustomFoodInputs(document.getElementById(EDIT_FORM_ID), f.values);
}

// 依目前的我的品項、隱藏清單與不吃清單重新分頁；還在、還能選的選取與份量保留（不吃、復原、複製之後用）
function rebuildLists() {
  const m = mealPicker;
  const parts = m.editing ? partitionAllChannels(m.catalog.products, m.customs, m.hiddenUids) : partitionByMealType(m.catalog.products, m.customs, m.slot, m.hiddenUids);
  Object.keys(m.inserted).forEach(function (uid) {
    const it = m.catalog.productsByUid[uid] || m.customs.filter(function (c) { return c.uid === uid && !c.archived; })[0];
    const list = parts[m.inserted[uid]];
    if (it && list && !list.some(function (x) { return x.uid === uid; })) list.push(it);
  });
  ["convenience", "delivery"].forEach(function (t) {
    const old = m.tabs[t];
    const reasons = reasonsFor(parts[t], m.profile);
    m.tabs[t] = Object.assign({}, old, { items: parts[t], reasons: reasons, codes: codesFor(parts[t], m.profile),
      selected: old.selected.filter(function (u) { return parts[t].some(function (it) { return it.uid === u; }) && !reasons[u]; }) });
  });
  m.drinks = { items: parts.drinks, reasons: reasonsFor(parts.drinks, m.profile), codes: codesFor(parts.drinks, m.profile) };
  if (m.drinkUid && !selectedDrink()) m.drinkUid = null;
  // 單品：灰字與 code 重算；已經不能選的從已選拿掉（已選框、摘要件數跟 currentDraft 一致，計畫 8.4）
  m.foods = foodListsFor(m.catalog, m.profile);
  m.foodSel = m.foodSel.filter(function (f) { return m.foods.byId[f.uid] && !m.foods.labels[f.uid]; });
  computeSavedCards();
  const keep = {};
  ["convenience", "delivery"].forEach(function (t) { m.tabs[t].selected.forEach(function (u) { keep[u] = true; }); });
  if (m.drinkUid) keep[m.drinkUid] = true;
  Object.keys(m.qtyByUid).forEach(function (u) { if (!keep[u]) delete m.qtyByUid[u]; });
}

function unselect(uid) {
  const m = mealPicker;
  ["convenience", "delivery"].forEach(function (t) {
    const i = m.tabs[t].selected.indexOf(uid);
    if (i !== -1) m.tabs[t].selected.splice(i, 1);
  });
  if (m.drinkUid === uid) m.drinkUid = null;
  delete m.qtyByUid[uid];
}

// 已選段的「不吃」（取代原本的「隱藏」，decisions #99）：寫進不吃清單，這一項移到最下方的不吃組
async function dislikeItem(uid) {
  const m = mealPicker;
  const p = m.catalog.productsByUid[uid];
  if (!p) return;
  let list;
  try { list = await addDislikedIngredient({ type: "item", key: uid, label: p.name }); } catch (err) { console.error(err); alert("存檔失敗，請重試。"); return; }
  m.profile = Object.assign({}, m.profile, { disliked_ingredients: list });
  // 標不吃時 db 已在同一個 transaction 移出常吃（PRD 13.5），這裡跟著更新
  m.favorites = removeFavoriteFrom(m.favorites, uid);
  m.dislikedChanged = true;
  unselect(uid);
  rebuildLists();
  m.notice = { uid: uid, name: p.name, drink: p.role === "drink" };
}

// 取消不吃（提示列的「復原」、不吃組的「取消不吃」）：放回原本的位置並可以選（PRD 6.3）
async function undislikeItem(uid) {
  const m = mealPicker;
  let list;
  try { list = await removeDislikedIngredient(uid); } catch (err) { console.error(err); alert("存檔失敗，請重試。"); return; }
  m.profile = Object.assign({}, m.profile, { disliked_ingredients: list });
  m.dislikedChanged = true;
  rebuildLists();
  m.notice = null;
}

// 已選列與單品已選框的「常吃／取消常吃」（PRD 13.6、decisions #126 ①）：已選的不會取消，常吃組只在組 HTML 時重排。
// 不出提示列與復原（decisions #127 ⑧）；標常吃時原本是不吃的會被移出不吃（互斥），要重新分頁並讓今日建議重算
async function setFavoriteInPicker(uid, on) {
  const m = mealPicker;
  try {
    if (on) {
      const r = await addFavoriteRef(uid);
      m.favorites = r.favorites;
      const before = (m.profile.disliked_ingredients || []).length;
      if (r.disliked && r.disliked.length !== before) {
        m.profile = Object.assign({}, m.profile, { disliked_ingredients: r.disliked });
        m.dislikedChanged = true;
        rebuildLists();
      }
    } else {
      m.favorites = await removeFavoriteRef(uid);
    }
  } catch (err) { console.error(err); alert("存檔失敗，請重試。"); }
}

// 複製、補填存完之後的說明（快速新增有自己的句型，在 saveQuickAdd）
function placedMessage(head, place, name) {
  const m = mealPicker;
  if (place.reason) return head + "。以你目前的設定不能選：" + place.reason;
  if (place.roleProblem) return head + "。" + place.roleProblem + "這次沒有幫你選。";
  if (place.dest === null) return head + "，但它適合的時段不含" + (SLOT_LABELS[m.slot] || m.slot) + "，這個時段不會出現。";
  if (place.dest === "tab" && place.tab !== m.tab) return head + "，在「" + TAB_LABELS[place.tab] + "」分頁。";
  return head + "，並選進這一餐。";
}

async function saveEditForm() {
  const m = mealPicker;
  const f = m.editForm;
  syncEditForm();
  const r = recordFromValues(f.values);
  if (r.errors.length > 0) { f.error = r.errors.join("；"); return; }
  let saved;
  let head;
  let oldQty = null;
  try {
    if (f.mode === "copy") {
      const base = copyFromBuiltin(m.catalog.productsByUid[f.uid]);
      saved = await copyBuiltinToCustom(Object.assign({}, base, r.record, { copied_from: f.uid }));
      head = "已複製成我的版本「" + saved.name + "」";
    } else {
      saved = await updateCustomFood(f.uid, r.record);
      head = "已更新「" + saved.name + "」";
    }
  } catch (err) {
    console.error(err);
    f.error = "存檔失敗，請重試。";
    return;
  }
  const item = fromCustomFood(saved);
  m.customRecords[saved.id] = saved;
  let keepIndex = null;
  if (f.mode === "copy") {
    // 先把原品項從選取、清單與份量拿掉（不然原品項還佔著名額），份量搬到新的那筆
    oldQty = m.qtyByUid[f.uid] || null;
    unselect(f.uid);
    if (m.hiddenUids.indexOf(f.uid) === -1) m.hiddenUids.push(f.uid);
    rebuildLists();
    m.customs.push(item);
  } else {
    // 補填：換掉同 uid 那一筆（不另外 push，否則兩張卡片），位置不變
    unselect(f.uid);
    m.customs = m.customs.map(function (c) { return c.uid === item.uid ? item : c; });
    keepIndex = removeFromLists(item.uid);
  }
  const place = placeInPicker(item, keepIndex);
  if (place.select && oldQty) m.qtyByUid[item.uid] = oldQty;
  const msg = placedMessage(head, place, saved.name);
  if (f.drink) m.drinkNotice = msg; else m.quickAddMessage = msg;
  m.editForm = null;
  m.notice = null;
}

// 從清單拿掉某個 uid（補填前），回傳它原本在哪個清單的第幾個
function removeFromLists(uid) {
  const m = mealPicker;
  let where = null;
  [["convenience", m.tabs.convenience], ["delivery", m.tabs.delivery], ["drinks", m.drinks]].forEach(function (x) {
    const i = x[1].items.findIndex(function (it) { return it.uid === uid; });
    if (i !== -1) { where = { list: x[0], index: i }; x[1].items.splice(i, 1); delete x[1].reasons[uid]; }
  });
  return where;
}

// 份量、不吃、取消不吃、複製、補填、表單的點擊（商品分頁與飲料步驟共用）。有處理回傳 true。
function onB1aClick(e) {
  const m = mealPicker;
  const at = function (sel) { return e.target.closest(sel); };
  let el;
  if ((el = at("[data-qty-uid]"))) {
    const q = Number(el.getAttribute("data-qty"));
    const uid = el.getAttribute("data-qty-uid");
    if (q === 1) delete m.qtyByUid[uid]; else m.qtyByUid[uid] = q;
    rerender();
    return true;
  }
  if ((el = at("[data-dislike-uid]"))) { dislikeItem(el.getAttribute("data-dislike-uid")).then(rerender); return true; }
  if ((el = at("[data-undislike-uid]"))) { undislikeItem(el.getAttribute("data-undislike-uid")).then(rerender); return true; }
  if ((el = at("[data-favorite-uid]"))) { setFavoriteInPicker(el.getAttribute("data-favorite-uid"), true).then(rerender); return true; }
  if ((el = at("[data-unfavorite-uid]"))) { setFavoriteInPicker(el.getAttribute("data-unfavorite-uid"), false).then(rerender); return true; }
  if ((el = at("[data-copy-uid]"))) {
    const p = m.catalog.productsByUid[el.getAttribute("data-copy-uid")];
    if (!p) return true;
    m.quickAdd = null; m.quickAddMessage = null; m.drinkNotice = null;
    m.editForm = { mode: "copy", uid: p.uid, drink: p.role === "drink", values: valuesFromRecord(copyFromBuiltin(p)), error: null };
    rerender();
    return true;
  }
  if ((el = at("[data-fill-uid]"))) {
    const raw = m.customRecords[el.getAttribute("data-fill-uid")];
    if (!raw) return true;
    m.quickAdd = null; m.quickAddMessage = null; m.drinkNotice = null;
    m.editForm = { mode: "fill", uid: raw.id, drink: raw.role === "drink", values: valuesFromRecord(raw), error: null };
    rerender();
    return true;
  }
  if (!m.editForm || !at("#" + EDIT_FORM_ID)) return false;
  if (at("[data-cf-cancel]")) { m.editForm = null; rerender(); return true; }
  if (at("[data-cf-save]")) { saveEditForm().then(rerender); return true; }
  syncEditForm();
  if (onCustomFoodFormClick(e.target, m.editForm.values)) { m.editForm.error = null; rerender(); return true; }
  return false;
}

function rerender() {
  // 重畫表單時保留「更多（選填）」展開的狀態
  const more = document.querySelector("#" + EDIT_FORM_ID + " .quick-add-more");
  const moreOpen = !!(more && more.open);
  renderPanel();
  renderDrinks();
  updateSummary();
  const moreAfter = document.querySelector("#" + EDIT_FORM_ID + " .quick-add-more");
  if (moreAfter && moreOpen) moreAfter.open = true;
}

export function renderMealPicker() {
  renderTabs();
  renderPanel();
  renderDrinks();
  updateSummary();
}

// 「找不到？直接估算」：加一筆估算到這一餐（外食分頁）
export function addEstimate(size, name) {
  mealPicker.tabs.delivery.estimates.push({ size: size, name: name && name.trim() ? name.trim() : "" });
  renderPanel();
  renderDrinks(); // 有估算時「存成組合」不能勾（decisions #124）
  updateSummary();
}

// 自煮分頁（含共餐區塊）目前的 HTML（測試用，diff-recs 的快照）
export function cookPanelHtmlNow() {
  const m = mealPicker;
  return cookTabHtml(m.catalog, m.slot, m.cook, m.profile, pickerFavSet(), m.slot !== null && HOME_MEAL_SLOTS.indexOf(m.slot) !== -1 && !m.editing ? { season: m.season } : null).html;
}

// 估算卡目前的 HTML（測試用，diff-recs 的快照）
export function estimateCardHtmlNow() {
  const m = mealPicker;
  return estimateCardHtml(m.tabs.delivery.estimates, m.homeEst, m.catalog.homeDishes);
}

// 「主食＋家常菜」估算（decisions #151）：表單狀態在 m.homeEst，按「加入這一餐」才由 engine 算出快照與 est 加進這一餐
export function addHomeEstimate(name) {
  const m = mealPicker;
  const e = homeEstimate(m.homeEst.cfg, m.catalog.homeDishes);
  if (name && name.trim()) e.name = name.trim();
  m.tabs.delivery.estimates.push(e);
  m.homeEst = Object.assign(emptyHomeEst(), { open: true, cfg: m.homeEst.cfg });
  renderPanel();
  renderDrinks();
  updateSummary();
}

// 估算卡的「主食＋家常菜」按鈕：改設定後重畫；有處理回傳 true
function onHomeEstimateClick(e) {
  const m = mealPicker;
  const at = function (sel) { return e.target.closest(sel); };
  const attr = function (el, name) { return el.getAttribute(name); };
  let el;
  const nameEl = (at("[data-home-toggle]") || at("[data-home-staple]") || at("[data-home-staple-size]") || at("[data-home-n]") || at("[data-home-cat]") ||
    at("[data-home-dish]") || at("[data-home-soup]") || at("[data-home-add]")) ? document.getElementById("meal-picker-home-name") : null;
  if (nameEl) m.homeEst.name = nameEl.value;
  const set = function (patch) {
    m.homeEst.cfg = normalizeHomeCfg(Object.assign({}, m.homeEst.cfg, patch));
    renderPanel();
  };
  if (at("[data-home-toggle]")) { m.homeEst.open = !m.homeEst.open; renderPanel(); return true; }
  if ((el = at("[data-home-staple]"))) { set({ staple: attr(el, "data-home-staple") }); return true; }
  if ((el = at("[data-home-staple-size]"))) { set({ staple_size: attr(el, "data-home-staple-size") }); return true; }
  if ((el = at("[data-home-n]"))) { set({ n: parseInt(attr(el, "data-home-n"), 10) }); return true; }
  if ((el = at("[data-home-cat]"))) {
    const parts = attr(el, "data-home-cat").split(":");
    const cats = m.homeEst.cfg.cats.slice();
    cats[parseInt(parts[0], 10)] = parts[1];
    set({ cats: cats });
    return true;
  }
  if ((el = at("[data-home-dish]"))) { set({ dish: attr(el, "data-home-dish") }); return true; }
  if ((el = at("[data-home-soup]"))) { set({ soup: attr(el, "data-home-soup") === "on" }); return true; }
  if (at("[data-home-add]")) { addHomeEstimate(m.homeEst.name); return true; }
  return false;
}

// 存成我的品項（PRD 10.3）：寫入 → 放進目前分頁（飲料進飲料步驟）→ 能選且有名額就選中，否則不選中並說明原因
export async function saveQuickAdd(values) {
  const m = mealPicker;
  const tab = m.tab;
  const r = quickAddRecord(values, m.slot, tab);
  if (r.errors.length > 0) {
    m.quickAddMessage = r.errors.join("；");
    renderPanel();
    return null;
  }
  let saved;
  try {
    saved = await addCustomFood(r.record);
  } catch (err) {
    console.error(err);
    m.quickAddMessage = "存檔失敗，請重試。";
    renderPanel();
    return null;
  }
  const item = fromCustomFood(saved);
  m.customRecords[saved.id] = saved;
  m.customs.push(item);
  const place = placeInPicker(item);
  m.quickAdd = null;
  m.quickAddMessage = place.reason ? "已存成我的品項。以你目前的設定不能選：" + place.reason
    : place.roleProblem ? "已存成我的品項。" + place.roleProblem + "這次沒有幫你選。" : "已存成我的品項，並選進這一餐。";
  renderMealPicker();
  return saved;
}

// 新存的我的品項放進選擇器（快速新增、複製、補填共用；engine placeNewCustom 決定放哪裡、選不選中）。
// 飲料沒被擋就取代目前的飲料（舊飲料的份量清掉）。回傳 placeNewCustom 的結果，說明文字由呼叫端組。
function placeInPicker(item, keepIndex) {
  const m = mealPicker;
  const place = placeNewCustom(item, { slot: m.slot, currentTab: m.tab, profile: m.profile, roleItems: draftRoleItems(currentDraft()) });
  const insert = function (list, name) {
    if (keepIndex && keepIndex.list === name) list.splice(keepIndex.index, 0, item); else list.push(item);
  };
  if (place.dest === "drinks") {
    insert(m.drinks.items, "drinks");
    if (place.reason) m.drinks.reasons[item.uid] = place.reason;
    else {
      if (m.drinkUid) delete m.qtyByUid[m.drinkUid];
      m.drinkUid = item.uid;
    }
  } else if (place.dest === "tab") {
    const t = m.tabs[place.tab];
    insert(t.items, place.tab);
    if (place.reason) t.reasons[item.uid] = place.reason;
    else if (place.select) t.selected.push(item.uid);
  }
  return place;
}

// 其他分頁還有選取時提醒一行（送出只算目前分頁＋飲料）
function leftoverLine() {
  const m = mealPicker;
  const count = function (t) { return selectedItems(t).length + (t === "delivery" ? m.tabs.delivery.estimates.length : 0); };
  return ["convenience", "delivery"].filter(function (t) { return t !== m.tab && count(t) > 0; }).map(function (t) {
    return TAB_LABELS[t] + "分頁還有 " + count(t) + " 項沒有算進這餐";
  });
}

export function updateSummary() {
  const m = mealPicker;
  const d = currentDraft();
  const content = buildDraftContent(d, { oilHabit: m.profile.oil_habit });
  const totals = contentTotals(content, m.catalog);
  const summaryEl = $("#meal-picker-summary");
  const isCook = d.kind === "cook";
  const lead = isCook && d.archetype ? (composeProblem(d, { tier: d.meal_type }) ? "還沒配好 · " : "已配好 · ") : "已選 " + pickedCount(d) + " 件 · ";
  if (summaryEl && isCook && !d.archetype && !d.drink && d.foods.length === 0 && !d.homeMeal) {
    summaryEl.innerHTML = "還沒配好";
  } else if (summaryEl) {
    const oil = isCook && content.implicit ? content.implicit.oil_g : 0;
    summaryEl.innerHTML = lead + "約 " + Math.round(totals.kcal) + " kcal" + (oil > 0 ? "（含用油約 " + oil + "g）" : "") +
      " · 蛋白質 " + fmtNutrient(totals.protein_g) +
      " · 碳水 " + fmtNutrient(totals.carb_g) +
      " · 脂肪 " + fmtNutrient(totals.fat_g) +
      " · 纖維 " + fmtNutrient(totals.fiber_g) +
      " · " + escapeHtml(sodiumText(totals.sodium_mg, totals.partial.indexOf("sodium_mg") !== -1, false)) +
      (isCook && d.archetype && notIncludedText(d.archetype.not_included) ? " · " + escapeHtml(notIncludedText(d.archetype.not_included)) : "");
  }

  // 入口 1 的名稱還沒改過就跟著選取更新（只在勾選後才碰這個元素，fake DOM 守則，審核 M8）
  if (m.saveAs.on && !m.saveAs.nameEdited) {
    m.saveAs.name = currentSaveName();
    const nameEl = document.getElementById("meal-picker-save-name");
    if (nameEl && nameEl.value !== m.saveAs.name) nameEl.value = m.saveAs.name;
  }

  const gapEl = $("#meal-picker-gap");
  if (gapEl) {
    const lines = [];
    if (m.slot === null) {
      lines.push("編輯組合不計算時段的配額。");
    } else if (m.mode === "plan") {
      lines.push("預約不計算配額；到那天，其他餐會照這一餐自動調整。");
    } else if (m.mode === "backfill") {
      lines.push("補記過去的一餐，不計算配額。");
    } else if (isCook && d.archetype ? true : pickedCount(d) > 0) {
      const share = slotNutrientShare(m.targets, m.todayLogs, m.profile.enabled_slots, m.slot);
      const gaps = slotGaps(share, totals);
      if (gaps.overKcal > 0 && !isCook && d.estimates.length > 0) {
        // 估算的一餐（聚餐、喜宴）：延續 PRD 第 9 節的說法
        lines.push("這餐約 " + Math.round(totals.kcal) + " kcal，這個時段配額約 " + Math.round(share.kcalShare) + " kcal（+" + gaps.overKcal + "），先記下來，其他餐會自動調整。");
      } else if (gaps.overKcal > 0) {
        lines.push("這組合約 " + Math.round(totals.kcal) + " kcal，這個時段配額約 " + Math.round(share.kcalShare) + " kcal（+" + gaps.overKcal + "），仍可送出。");
      }
      if (gaps.proteinGap == null) lines.push("蛋白質：無資料");
      else if (gaps.proteinGap > 0) lines.push("蛋白質缺口約 " + gaps.proteinGap + "g");
      if (gaps.fiberGap == null) lines.push("纖維：無資料");
      else if (gaps.fiberGap > 0) lines.push("纖維缺口約 " + gaps.fiberGap + "g");
    }
    leftoverLine().forEach(function (t) { lines.push(t); });
    gapEl.innerHTML = lines.map(function (t) { return "<p>" + escapeHtml(t) + "</p>"; }).join("");
  }

  const problem = submitProblem(d);
  const submitBtn = $("#meal-picker-submit");
  if (submitBtn) submitBtn.disabled = problem != null;
  const hint = $("#meal-picker-hint");
  if (hint) {
    hint.hidden = problem == null;
    if (problem) hint.textContent = problem;
  }
}

// 自煮分頁的點選：子切換、餐型、食材（蛋白質/蔬菜多選，其餘單選）、烹調法、用油、調味
function onCookClick(e) {
  const m = mealPicker;
  if (onHomeMealClick(e)) return;
  const d = m.cook.draft;
  const tierBtn = e.target.closest("[data-tier]");
  const oilBtn = e.target.closest("[data-oil]");
  const levelBtn = e.target.closest("[data-seasoning-level]");
  const btn = e.target.closest("[data-axis]");
  if (tierBtn) {
    m.cook.tier = tierBtn.getAttribute("data-tier");
    if (m.cook.tier !== "cook_full") m.cook.home.open = false; // 共餐只在開伙；切到快煮就收起（已選的菜不再算進這一餐）
  } else if (oilBtn) {
    const g = oilBtn.getAttribute("data-oil");
    if (g === "") delete d.implicitOverride.oil_g; else d.implicitOverride.oil_g = parseFloat(g);
  } else if (levelBtn) {
    d.implicitOverride.seasoning = levelBtn.getAttribute("data-seasoning-level");
  } else if (btn && !btn.disabled) {
    const axis = btn.getAttribute("data-axis");
    const id = btn.getAttribute("data-id");
    if (axis === "archetype") {
      const again = !!(d.archetype && d.archetype.id === id);
      m.cook.home.open = false; // 共餐與餐型擇一
      m.cook.draft = emptyCookDraft();
      if (!again) m.cook.draft.archetype = m.catalog.archetypes.filter(function (a) { return a.id === id; })[0] || null;
    } else {
      const item = id ? archetypeOptions(m.catalog, axis, d.archetype).filter(function (x) { return x.id === id; })[0] : null;
      if (axis === "protein" || axis === "vegetable") {
        const key = axis === "protein" ? "proteins" : "vegetables";
        const i = d[key].indexOf(item);
        if (i !== -1) d[key].splice(i, 1);
        else if (item && !optionReason(item, axis, d, m.cook.tier, m.profile)) d[key].push(item);
      } else {
        d[axis] = item && d[axis] === item ? null : item;
        // 換成不能選用油的烹調法時清掉用油覆寫（Phase 0 計畫 3-3）
        if (axis === "method" && oilOptions(d, m.profile.oil_habit).length === 0) delete d.implicitOverride.oil_g;
      }
    }
  } else {
    return;
  }
  renderPanel();
  renderDrinks();
  updateSummary();
}

// 共餐區塊的點選（decisions #152）；有處理回傳 true
function onHomeMealClick(e) {
  const m = mealPicker;
  const at = function (sel) { return e.target.closest(sel); };
  const home = m.cook.home;
  let el;
  if (at("[data-hm-toggle]")) {
    home.open = !home.open;
    if (home.open) m.cook.draft = emptyCookDraft(); // 與餐型擇一
  } else if ((el = at("[data-hm-staple]"))) {
    const k = el.getAttribute("data-hm-staple");
    home.form.staple = k;
    home.form.staple_size = k === "none" ? null : (home.form.staple_size || "M");
  } else if ((el = at("[data-hm-staple-size]"))) {
    home.form.staple_size = el.getAttribute("data-hm-staple-size");
  } else if ((el = at("[data-hm-size]"))) {
    home.form.dish = el.getAttribute("data-hm-size");
  } else if ((el = at("[data-hm-dish]"))) {
    if (el.disabled) return true;
    const id = el.getAttribute("data-hm-dish");
    const i = home.form.dishes.indexOf(id);
    if (i !== -1) home.form.dishes.splice(i, 1);
    else if (home.form.dishes.length < HOME_MEAL_DISH_MAX) home.form.dishes.push(id);
  } else if ((el = at("[data-hm-soup]"))) {
    if (el.disabled) return true;
    home.form.soup = el.getAttribute("data-hm-soup") || null;
  } else {
    return false;
  }
  renderPanel();
  renderDrinks();
  updateSummary();
  return true;
}

function bindSlider() {
  const slider = document.getElementById("compose-scale-slider");
  if (!slider || !slider.addEventListener) return;
  slider.addEventListener("input", function () {
    mealPicker.cook.draft.primaryScale = parseFloat(slider.value);
    const v = document.getElementById("compose-scale-value");
    if (v) v.textContent = mealPicker.cook.draft.primaryScale.toFixed(1) + " 倍";
    updateSummary();
  });
}

// 估算卡片與快速新增表單的點選；有處理回傳 true
function onProductExtrasClick(e) {
  const m = mealPicker;
  const q = m.quickAdd && m.quickAdd.values;
  const at = function (sel) { return e.target.closest(sel); };
  let el;
  if (onHomeEstimateClick(e)) return true;
  if ((el = at("[data-estimate-size]"))) {
    const nameEl = document.getElementById("meal-picker-estimate-name");
    addEstimate(el.getAttribute("data-estimate-size"), nameEl ? nameEl.value : "");
    return true;
  }
  if ((el = at("[data-estimate-remove]"))) {
    m.tabs.delivery.estimates.splice(parseInt(el.getAttribute("data-estimate-remove"), 10), 1);
    renderDrinks();
  } else if (at("[data-quick-add-open]")) {
    m.quickAdd = { tab: m.tab, values: emptyQuickAdd(m.slot) };
    m.quickAddMessage = null;
  } else if (at("[data-qa-cancel]")) {
    m.quickAdd = null;
  } else if (at("[data-qa-save]")) {
    syncQuickAdd();
    saveQuickAdd(q);
    return true;
  } else if (q && (el = at("[data-qa-role]"))) {
    q.role = el.getAttribute("data-qa-role");
  } else if (q && (el = at("[data-qa-allergen-mode]"))) {
    q.allergenMode = el.getAttribute("data-qa-allergen-mode");
  } else if (q && (el = at("[data-qa-allergen]"))) {
    const a = el.getAttribute("data-qa-allergen");
    const i = q.allergens.indexOf(a);
    if (i === -1) q.allergens.push(a); else q.allergens.splice(i, 1);
  } else if (q && (el = at("[data-qa-diet]"))) {
    q.diet = el.getAttribute("data-qa-diet");
  } else {
    return false;
  }
  // 重畫表單時保留「更多（選填）」展開的狀態
  const more = document.querySelector("#quick-add-form .quick-add-more");
  const moreOpen = !!(more && more.open);
  renderPanel();
  updateSummary();
  const moreAfter = document.querySelector("#quick-add-form .quick-add-more");
  if (moreAfter && moreOpen) moreAfter.open = true;
  return true;
}

// 點組合卡片：帶入（只認還能用的；快照工具也直接呼叫）。回傳有沒有帶入
export function loadSavedMeal(id) {
  const m = mealPicker;
  const card = m.savedCards.filter(function (c) { return c.id === id; })[0];
  const rec = m.savedRecords.filter(function (r) { return r.id === id; })[0];
  if (!card || !card.usable || !rec) return false;
  applySaved(rec);
  renderMealPicker();
  return true;
}

function onPanelClick(e) {
  const savedCard = e.target.closest("[data-saved-id]");
  if (savedCard) {
    if (!savedCard.disabled && loadSavedMeal(savedCard.getAttribute("data-saved-id"))) {
      const body = $("#meal-picker-body");
      if (body) body.scrollTop = 0;
    }
    return;
  }
  if (mealPicker.tab === "cook") { onCookClick(e); return; }
  if (onB1aClick(e)) return;
  if (onProductExtrasClick(e)) return;
  const card = e.target.closest(".item-card");
  if (!card || card.disabled) return;
  const m = mealPicker;
  const t = m.tabs[m.tab];
  if (!t) return;
  const uid = card.getAttribute("data-uid");
  const it = passItemsOf(t).filter(function (x) { return x.uid === uid; })[0];
  if (!it) return;
  const idx = t.selected.indexOf(uid);
  if (idx === -1) {
    const d = currentDraft();
    if (!canAddManualItem(draftRoleItems(d), it, m.slot)) {
      alert(manualSelectionProblem(draftRoleItems(d).concat([it]), m.slot));
      return;
    }
    t.selected.push(uid);
  } else {
    t.selected.splice(idx, 1);
    delete m.qtyByUid[uid];
  }
  renderPanel();
  updateSummary();
}

// 單品卡片、步進器、移除（兩個共用步驟與搜尋結果）。有處理回傳 true。捲動只在這裡（瀏覽器），不在 render 路徑
function onFoodClick(e) {
  const m = mealPicker;
  let el;
  if ((el = e.target.closest("[data-food-step]"))) {
    if (!el.disabled) m.foodSel = stepFood(m.foodSel, el.getAttribute("data-food-step"), Number(el.getAttribute("data-dir")));
  } else if ((el = e.target.closest("[data-food-mode]"))) {
    if (el.disabled) return true;
    const uid = el.getAttribute("data-food-mode");
    m.foodSel = toggleFoodMode(m.foodSel, uid, m.foods.byId[uid]);
  } else if ((el = e.target.closest("[data-food-amount]"))) {
    return true; // 克數輸入框：點擊不重畫（會失去焦點），改值聽 change
  } else if ((el = e.target.closest("[data-food-remove]"))) {
    m.foodSel = removeFood(m.foodSel, el.getAttribute("data-food-remove"));
  } else if ((el = e.target.closest("[data-food-uid]"))) {
    if (el.disabled) return true;
    const uid = el.getAttribute("data-food-uid");
    const r = addFood(m.foodSel, uid, m.foods.byId[uid]);
    if (r.problem) { alert(r.problem); return true; }
    if (r.existed) {
      // 再點已選的：不新增，捲到它的步進器（PRD 13.4）
      const row = document.getElementById("food-sel-" + uid);
      if (row && row.scrollIntoView) row.scrollIntoView({ block: "center" });
      return true;
    }
    m.foodSel = r.sel;
    // 已選框在卡片上方長出一列：補回捲動距離，點的卡片留在原位（審核 S2）
    const inResults = !!el.closest("#meal-picker-food-results");
    const before = el.getBoundingClientRect().top;
    renderDrinks();
    updateSummary();
    const after = Array.prototype.filter.call(document.querySelectorAll('#meal-picker-drinks [data-food-uid="' + uid + '"]'), function (x) {
      return !!x.closest("#meal-picker-food-results") === inResults;
    })[0];
    const body = $("#meal-picker-body");
    if (after && body) body.scrollTop += after.getBoundingClientRect().top - before;
    return true;
  } else {
    return false;
  }
  renderDrinks();
  updateSummary();
  return true;
}

function onDrinkClick(e) {
  const m = mealPicker;
  // 「存成組合」勾選框（點文字也會再觸發一次 input 的 click，只認 input 本身）
  if (e.target.matches && e.target.matches("[data-save-as]")) {
    m.saveAs.on = !!e.target.checked;
    renderDrinks();
    updateSummary();
    if (m.saveAs.on) {
      const nameEl = document.getElementById("meal-picker-save-name");
      if (nameEl && nameEl.scrollIntoView) nameEl.scrollIntoView({ block: "center" });
    }
    return;
  }
  if (onFoodClick(e)) return;
  if (onB1aClick(e)) return;
  const btn = e.target.closest("[data-drink]");
  if (!btn || btn.disabled) return;
  const next = btn.getAttribute("data-drink") || null;
  if (mealPicker.drinkUid && mealPicker.drinkUid !== next) delete mealPicker.qtyByUid[mealPicker.drinkUid]; // 換掉或取消，重選回到 1
  mealPicker.drinkUid = next;
  renderDrinks();
  updateSummary();
}

function onTabClick(e) {
  const btn = e.target.closest("[data-tab]");
  if (btn) selectTab(btn.getAttribute("data-tab"));
}

async function rememberMealType(slot, mealType) {
  try {
    const next = Object.assign({}, await readLastPicked());
    next[slot] = mealType;
    await setSetting(LAST_PICKED_KEY, next);
  } catch (e) {
    console.error(e); // 記不住只影響下次停在哪一頁，不影響這筆紀錄
  }
}

// 編輯組合的「存回組合」：同一個選擇器的草稿 → 組合內容，存回同一筆（PRD 12.6）。不寫 daily_log、不寫 picker_last_meal_type
async function saveEditedMeal() {
  const m = mealPicker;
  const d = currentDraft();
  const problem = submitProblem(d);
  if (problem) { alert(problem); return; }
  const content = buildDraftContent(d, { oilHabit: m.profile.oil_habit });
  const s = savedMealForSave(toSavedContent(content, { keepImplicit: keepImplicitOf(d) }), m.catalog, savedCtx(null));
  if (s.problems) { alert("不能存回組合：" + s.problems.join("；")); return; }
  try {
    await updateSavedMeal(m.editing.id, { content: s.content });
  } catch (err) {
    console.error(err);
    alert("存檔失敗，請重試。");
    return;
  }
  const overlay = $("#meal-picker-overlay");
  if (overlay) overlay.hidden = true;
  if (m.onSaved) await m.onSaved();
}

// 排預約（日期切換）：草稿 → 預約的儲存格式 → 寫 meal_plan（同一個時段覆蓋）。不寫 daily_log、不寫 picker_last_meal_type（章程 C4.15）
async function savePlan() {
  const m = mealPicker;
  const d = currentDraft();
  const problem = submitProblem(d);
  if (problem) { alert(problem); return; }
  const content = buildDraftContent(d, { oilHabit: m.profile.oil_habit });
  const rec = { date: m.date, slot: m.slot, name: draftLogName(d), content: toPlanContent(content, { keepImplicit: keepImplicitOf(d) }) };
  let savedRec = null;
  if (m.saveAs.on && (d.estimates || []).length === 0) {
    const name = (m.saveAs.name || "").trim();
    if (!name) { alert("請填組合名稱。"); return; }
    const s = savedMealForSave(toSavedContent(content, { keepImplicit: keepImplicitOf(d) }), m.catalog, savedCtx(null));
    if (s.problems) { alert("不能存成組合：" + s.problems.join("；") + "。取消勾選「存成組合」就只排預約。"); return; }
    savedRec = { name: name, content: s.content };
  }
  try {
    if (savedRec) await setMealPlanWithSavedMeal(rec, savedRec);
    else await setMealPlan(rec);
  } catch (err) {
    console.error(err);
    alert("存檔失敗，請重試。");
    return;
  }
  const overlay = $("#meal-picker-overlay");
  if (overlay) overlay.hidden = true;
  if (m.onSaved) await m.onSaved();
}

export async function onMealSubmit() {
  const m = mealPicker;
  if (m.editing) { await saveEditedMeal(); return; }
  if (m.mode === "plan") { await savePlan(); return; }
  const d = currentDraft();
  const problem = submitProblem(d);
  if (problem) { alert(problem); return; }
  const content = buildDraftContent(d, { oilHabit: m.profile.oil_habit });
  const backfill = m.mode === "backfill";
  const dateOpts = backfill ? { today: todayStr(), minDate: dateAddDays(todayStr(), -BACKFILL_DAYS) } : { today: m.date };
  const entry = buildLogEntry({
    date: m.date, slot: m.slot, source: backfill ? "backfill" : "manual", name: draftLogName(d),
    content: content, totals: contentTotals(content, m.catalog), createdAt: nowIso(),
  });
  const saving = m.saveAs.on && (d.estimates || []).length === 0;
  let savedRec = null;
  if (saving) {
    const name = (m.saveAs.name || "").trim();
    if (!name) { alert("請填組合名稱。"); return; }
    const s = savedMealForSave(toSavedContent(content, { keepImplicit: keepImplicitOf(d) }), m.catalog, savedCtx(null));
    if (s.problems) { alert("不能存成組合：" + s.problems.join("；") + "。取消勾選「存成組合」就只記這一餐。"); return; }
    savedRec = { name: name, content: s.content };
  }
  try {
    if (savedRec) await addDailyLogWithSavedMeal(entry, savedRec, dateOpts);
    else await addDailyLog(entry, dateOpts);
  } catch (err) {
    console.error(err);
    alert(savedRec ? "記錄失敗，請重試。取消勾選「存成組合」就只記這一餐。" : "記錄失敗，請重試。");
    return;
  }
  if (!backfill) await rememberMealType(m.slot, content.meal_type); // 補記不算「上次選過」（章程 C4.15）
  const overlay = $("#meal-picker-overlay");
  if (overlay) overlay.hidden = true;
  if (m.onLogged) await m.onLogged();
}

// 關閉（取消）：選擇器裡改過不吃清單的話，今日建議馬上重算，不用切分頁（計畫 S7）
export async function closePicker() {
  const m = mealPicker;
  const overlay = $("#meal-picker-overlay");
  if (overlay) overlay.hidden = true;
  if (m.dislikedChanged) {
    m.dislikedChanged = false;
    if (m.onLogged) await m.onLogged();
  }
}

// 品項分類與飲料分組的收合：記住這次選擇器裡的狀態，重畫時照舊（decisions #144）
function rememberGroupToggle(e) {
  const key = e.target && e.target.getAttribute && e.target.getAttribute("data-pick-group");
  if (key && mealPicker.groupOpen) mealPicker.groupOpen[key] = e.target.open;
}

export function initMealPicker() {
  const overlay = $("#meal-picker-overlay");
  if (overlay) overlay.addEventListener("click", function (e) { if (e.target === overlay) closePicker(); });
  const tabs = $("#meal-picker-tabs");
  if (tabs) tabs.addEventListener("click", onTabClick);
  const panel = $("#meal-picker-panel");
  if (panel) {
    panel.addEventListener("click", onPanelClick);
    panel.addEventListener("toggle", rememberGroupToggle, true);
    panel.addEventListener("input", function (e) { if (e.target.closest && e.target.closest("#quick-add-form")) refreshQuickAddNotes(); });
  }
  const drinks = $("#meal-picker-drinks");
  if (drinks) {
    drinks.addEventListener("click", onDrinkClick);
    // 搜尋只換結果，不重畫輸入框（不會失去焦點）
    drinks.addEventListener("input", function (e) {
      if (e.target.id === "meal-picker-save-name") {
        mealPicker.saveAs.name = e.target.value;
        mealPicker.saveAs.nameEdited = true;
        return;
      }
      if (e.target.id !== "meal-picker-food-search") return;
      mealPicker.foodQuery = e.target.value;
      const res = document.getElementById("meal-picker-food-results");
      if (res) res.innerHTML = foodSearchResultsHtml(foodStepState());
    });
    // 單品克數：失焦或 Enter 才寫回並重畫（decisions #136；input 事件不重畫，打字不會失去焦點）
    drinks.addEventListener("change", function (e) {
      const uid = e.target && e.target.getAttribute && e.target.getAttribute("data-food-amount");
      if (!uid) return;
      mealPicker.foodSel = setFoodAmount(mealPicker.foodSel, uid, e.target.value);
      renderDrinks();
      updateSummary();
    });
    drinks.addEventListener("toggle", rememberGroupToggle, true);
    // 大類、子類收合：記住展開狀態；收合時沒有內容，打開時重畫補上（toggle 不冒泡，用捕獲階段，比照 tab-foods.js）
    drinks.addEventListener("toggle", function (e) {
      const key = e.target && e.target.getAttribute && e.target.getAttribute("data-food-section");
      if (!key) return;
      mealPicker.foodOpen[key] = e.target.open;
      if (e.target.open && e.target.children.length <= 1) renderDrinks();
    }, true);
  }
  const cancel = $("#meal-picker-cancel");
  if (cancel) cancel.addEventListener("click", closePicker);
  const submit = $("#meal-picker-submit");
  if (submit) submit.addEventListener("click", onMealSubmit);
}
