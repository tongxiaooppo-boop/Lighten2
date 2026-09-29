// 輕盈計畫 — 「自己選」選擇器：超商｜外食｜自煮三個型態分頁＋共用的飲料步驟（PRD 第 2、4 節、6.3；Phase 0 計畫）。
// 分頁、分組、預設分頁、送出規則、合計都呼叫 engine（engine/picker.js、engine/meal-content.js），這裡只管狀態、畫面與事件；
// ui 不自己加總營養（章程 C4.11）。

import { SLOT_LABELS, DEFAULT_MEAL_PREFS } from "../../core/slots.js";
import { escapeHtml } from "../../core/html.js";
import { $, sodiumText, notIncludedText } from "../dom.js";
import { getProfile, getDailyLogs, getCustomFoods, addDailyLog, addCustomFood, getSetting, setSetting, getHiddenCatalogUids } from "../../data/db.js";
import { loadCatalog, fromCustomFood } from "../../data/catalog.js";
import { passesHardFilters } from "../../engine/filters.js";
import { slotNutrientShare } from "../../engine/budget.js";
import {
  buildDraftContent, contentTotals, buildLogEntry, manualSelectionProblem, canAddManualItem, slotGaps,
  composeProblem, composeImplicit, oilOptions, draftLogName,
} from "../../engine/meal-content.js";
import { resolveDefaultMealType, tabOfMealType, partitionByMealType, groupForTab, placeNewCustom } from "../../engine/picker.js";
import { productTabHtml, drinkStepHtml } from "./product-tab.js";
import { cookTabHtml, archetypeOptions, optionReason } from "./cook-tab.js";
import { estimateCardHtml } from "./estimate-card.js";
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
  // 自煮分頁：tier＝快煮/開伙子切換（就是這餐的 meal_type，decisions #34）；draft＝engine 的自煮草稿
  cook: { tier: "cook_full", draft: null },
  // 快速新增表單（null＝收起）：{ tab, values }；quickAddMessage：存完之後的中性說明
  quickAdd: null,
  quickAddMessage: null,
};

function emptyCookDraft() {
  return { archetype: null, proteins: [], staple: null, vegetables: [], seasoning: null, method: null, primaryScale: 1, implicitOverride: {} };
}

function reasonsFor(items, profile) {
  const out = {};
  items.forEach(function (it) {
    const r = passesHardFilters(it, profile);
    if (!r.ok) out[it.uid] = r.reason;
  });
  return out;
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

// onLogged：記錄成功後要做的事（今日建議重新整理）
export async function openMealPicker(slot, onLogged) {
  let profile;
  try { profile = await getProfile(); } catch (e) { console.error(e); return; }
  if (!profile) { alert("請先到「基本資料」分頁填寫並按「計算」。"); return; }
  const targets = await getCalibratedTargets(profile);
  const today = todayStr();
  const todayLogs = await getDailyLogs({ start: today, end: today });
  const catalog = await loadCatalog();
  const customs = (await getCustomFoods()).map(fromCustomFood);
  const lastPicked = await readLastPicked();
  // 隱藏清單讀不到不擋選擇器（比照 readLastPicked），當成沒有隱藏
  let hiddenUids = [];
  try { hiddenUids = await getHiddenCatalogUids(); } catch (err) { console.error(err); }
  const parts = partitionByMealType(catalog.products, customs, slot, hiddenUids);

  const m = mealPicker;
  m.slot = slot; m.profile = profile; m.targets = targets; m.todayLogs = todayLogs; m.catalog = catalog;
  m.onLogged = onLogged || null; m.lastPicked = lastPicked;
  ["convenience", "delivery"].forEach(function (t) {
    m.tabs[t] = { items: parts[t], reasons: reasonsFor(parts[t], profile), selected: [] };
  });
  m.tabs.delivery.estimates = [];
  m.drinks = { items: parts.drinks, reasons: reasonsFor(parts.drinks, profile) };
  m.drinkUid = null;
  m.qtyByUid = {}; // 份量倍數（PRD 12.3）：uid → 0.5／1.5／2，缺＝1；商品分頁的品項與飲料共用
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
  };

  const labelEl = $("#meal-picker-slot-label");
  if (labelEl) labelEl.textContent = SLOT_LABELS[slot] || slot;
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

// 目前分頁的草稿（摘要與送出共用同一份，看到的＝存下的）；meal_type 一律是分頁值（decisions #47）；估算只在外食分頁（decisions #46）
export function currentDraft() {
  const m = mealPicker;
  const qtyByUid = Object.assign({}, m.qtyByUid);
  if (m.tab === "cook") return Object.assign({ kind: "cook", meal_type: m.cook.tier, drink: selectedDrink(), qtyByUid: qtyByUid }, m.cook.draft);
  return {
    kind: "products", meal_type: m.tab, items: selectedItems(m.tab),
    estimates: m.tab === "delivery" ? m.tabs.delivery.estimates.slice() : [], drink: selectedDrink(), qtyByUid: qtyByUid,
  };
}

// 送出規則用的品項（角色上限含飲料）
function draftRoleItems(d) {
  return d.items.concat(d.drink ? [d.drink] : []);
}

export function currentTotals() {
  return contentTotals(buildDraftContent(currentDraft(), { oilHabit: mealPicker.profile.oil_habit }), mealPicker.catalog);
}

// 自煮分頁要餐型完整才能送出，只記飲料請到超商／外食分頁（decisions #45）
function submitProblem(d) {
  if (d.kind === "cook") {
    const p = composeProblem(d, { tier: d.meal_type });
    return p && !d.archetype && d.drink ? p + "（只記飲料請到超商或外食分頁）" : p;
  }
  return manualSelectionProblem(draftRoleItems(d), mealPicker.slot, { estimates: d.estimates.length });
}

function pickedCount(d) {
  return d.kind === "cook" ? 0 : d.items.length + d.estimates.length + (d.drink ? 1 : 0);
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
  if (m.tab === "cook") {
    const r = cookTabHtml(m.catalog, m.slot, m.cook, m.profile);
    m.cookSteps = r.steps;
    panel.innerHTML = r.html;
    bindSlider();
    return;
  }
  syncQuickAdd();
  const t = m.tabs[m.tab];
  const groups = groupForTab(t.items, function (it) { return t.reasons[it.uid]; });
  let html = m.tab === "delivery" ? estimateCardHtml(t.estimates) : "";
  html += '<div class="meal-picker-step-label">1. 選品項（可以多選）</div>' + productTabHtml(groups, t.selected, TAB_LABELS[m.tab]);
  if (m.quickAddMessage) html += '<p class="meal-picker-note">' + escapeHtml(m.quickAddMessage) + "</p>";
  html += m.quickAdd && m.quickAdd.tab === m.tab
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
  const entries = m.drinks.items.map(function (it) { return { item: it, reason: m.drinks.reasons[it.uid] || null }; });
  el.innerHTML = drinkStepHtml(entries, m.drinkUid, m.tab === "cook" ? (m.cookSteps || 2) + 1 : 2);
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
  updateSummary();
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
  const place = placeInPicker(item);
  m.quickAdd = null;
  m.quickAddMessage = place.reason ? "已存成我的品項。以你目前的設定不能選：" + place.reason
    : place.roleProblem ? "已存成我的品項。" + place.roleProblem + "這次沒有幫你選。" : "已存成我的品項，並選進這一餐。";
  renderMealPicker();
  return saved;
}

// 新存的我的品項放進選擇器（快速新增、複製、補填共用；engine placeNewCustom 決定放哪裡、選不選中）。
// 飲料沒被擋就取代目前的飲料（舊飲料的份量清掉）。回傳 placeNewCustom 的結果，說明文字由呼叫端組。
function placeInPicker(item) {
  const m = mealPicker;
  const place = placeNewCustom(item, { slot: m.slot, currentTab: m.tab, profile: m.profile, roleItems: draftRoleItems(currentDraft()) });
  if (place.dest === "drinks") {
    m.drinks.items.push(item);
    if (place.reason) m.drinks.reasons[item.uid] = place.reason;
    else {
      if (m.drinkUid) delete m.qtyByUid[m.drinkUid];
      m.drinkUid = item.uid;
    }
  } else if (place.dest === "tab") {
    const t = m.tabs[place.tab];
    t.items.push(item);
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
  const totals = currentTotals();
  const summaryEl = $("#meal-picker-summary");
  const isCook = d.kind === "cook";
  const lead = isCook ? (composeProblem(d, { tier: d.meal_type }) ? "還沒配好 · " : "已配好 · ") : "已選 " + pickedCount(d) + " 件 · ";
  if (summaryEl && isCook && !d.archetype && !d.drink) {
    summaryEl.innerHTML = "還沒配好";
  } else if (summaryEl) {
    const oil = isCook && d.method ? composeImplicit(d, m.profile.oil_habit).oil_g : 0;
    summaryEl.innerHTML = lead + "約 " + Math.round(totals.kcal) + " kcal" + (oil > 0 ? "（含用油約 " + oil + "g）" : "") +
      " · 蛋白質 " + fmtNutrient(totals.protein_g) +
      " · 碳水 " + fmtNutrient(totals.carb_g) +
      " · 脂肪 " + fmtNutrient(totals.fat_g) +
      " · 纖維 " + fmtNutrient(totals.fiber_g) +
      " · " + escapeHtml(sodiumText(totals.sodium_mg, totals.partial.indexOf("sodium_mg") !== -1, false)) +
      (isCook && d.archetype && notIncludedText(d.archetype.not_included) ? " · " + escapeHtml(notIncludedText(d.archetype.not_included)) : "");
  }

  const gapEl = $("#meal-picker-gap");
  if (gapEl) {
    const lines = [];
    if (isCook ? !!d.archetype : pickedCount(d) > 0) {
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
  const d = m.cook.draft;
  const tierBtn = e.target.closest("[data-tier]");
  const oilBtn = e.target.closest("[data-oil]");
  const levelBtn = e.target.closest("[data-seasoning-level]");
  const btn = e.target.closest("[data-axis]");
  if (tierBtn) {
    m.cook.tier = tierBtn.getAttribute("data-tier");
  } else if (oilBtn) {
    const g = oilBtn.getAttribute("data-oil");
    if (g === "") delete d.implicitOverride.oil_g; else d.implicitOverride.oil_g = parseFloat(g);
  } else if (levelBtn) {
    d.implicitOverride.seasoning = levelBtn.getAttribute("data-seasoning-level");
  } else if (btn && !btn.disabled) {
    const axis = btn.getAttribute("data-axis");
    const id = btn.getAttribute("data-id");
    if (axis === "archetype") {
      m.cook.draft = emptyCookDraft();
      m.cook.draft.archetype = m.catalog.archetypes.filter(function (a) { return a.id === id; })[0] || null;
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
  if ((el = at("[data-estimate-size]"))) {
    const nameEl = document.getElementById("meal-picker-estimate-name");
    addEstimate(el.getAttribute("data-estimate-size"), nameEl ? nameEl.value : "");
    return true;
  }
  if ((el = at("[data-estimate-remove]"))) {
    m.tabs.delivery.estimates.splice(parseInt(el.getAttribute("data-estimate-remove"), 10), 1);
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

function onPanelClick(e) {
  if (mealPicker.tab === "cook") { onCookClick(e); return; }
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
  }
  renderPanel();
  updateSummary();
}

function onDrinkClick(e) {
  const btn = e.target.closest("[data-drink]");
  if (!btn || btn.disabled) return;
  mealPicker.drinkUid = btn.getAttribute("data-drink") || null;
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

export async function onMealSubmit() {
  const m = mealPicker;
  const d = currentDraft();
  const problem = submitProblem(d);
  if (problem) { alert(problem); return; }
  const content = buildDraftContent(d, { oilHabit: m.profile.oil_habit });
  const entry = buildLogEntry({
    date: todayStr(), slot: m.slot, source: "manual", name: draftLogName(d),
    content: content, totals: contentTotals(content, m.catalog), createdAt: nowIso(),
  });
  try {
    await addDailyLog(entry);
  } catch (err) {
    console.error(err);
    alert("記錄失敗，請重試。");
    return;
  }
  await rememberMealType(m.slot, content.meal_type);
  const overlay = $("#meal-picker-overlay");
  if (overlay) overlay.hidden = true;
  if (m.onLogged) await m.onLogged();
}

function closePicker() {
  const overlay = $("#meal-picker-overlay");
  if (overlay) overlay.hidden = true;
}

export function initMealPicker() {
  const overlay = $("#meal-picker-overlay");
  if (overlay) overlay.addEventListener("click", function (e) { if (e.target === overlay) closePicker(); });
  const tabs = $("#meal-picker-tabs");
  if (tabs) tabs.addEventListener("click", onTabClick);
  const panel = $("#meal-picker-panel");
  if (panel) {
    panel.addEventListener("click", onPanelClick);
    panel.addEventListener("input", function (e) { if (e.target.closest && e.target.closest("#quick-add-form")) refreshQuickAddNotes(); });
  }
  const drinks = $("#meal-picker-drinks");
  if (drinks) drinks.addEventListener("click", onDrinkClick);
  const cancel = $("#meal-picker-cancel");
  if (cancel) cancel.addEventListener("click", closePicker);
  const submit = $("#meal-picker-submit");
  if (submit) submit.addEventListener("click", onMealSubmit);
}
