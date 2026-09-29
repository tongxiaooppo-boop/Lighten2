// 輕盈計畫 — 「自己選」選擇器：超商｜外食｜自煮三個型態分頁＋共用的飲料步驟（PRD 第 2、4 節、6.3；Phase 0 計畫）。
// 分頁、分組、預設分頁、送出規則、合計都呼叫 engine（engine/picker.js、engine/meal-content.js），這裡只管狀態、畫面與事件；
// ui 不自己加總營養（章程 C4.11）。

import { SLOT_LABELS, DEFAULT_MEAL_PREFS } from "../../core/slots.js";
import { escapeHtml } from "../../core/html.js";
import { $, sodiumText } from "../dom.js";
import { getProfile, getDailyLogs, getCustomFoods, addDailyLog, getSetting, setSetting } from "../../data/db.js";
import { loadCatalog, fromCustomFood } from "../../data/catalog.js";
import { passesHardFilters } from "../../engine/filters.js";
import { slotNutrientShare } from "../../engine/budget.js";
import { buildDraftContent, contentTotals, buildLogEntry, manualSelectionProblem, canAddManualItem, slotGaps } from "../../engine/meal-content.js";
import { resolveDefaultMealType, tabOfMealType, partitionByMealType, groupForTab } from "../../engine/picker.js";
import { productTabHtml, drinkStepHtml } from "./product-tab.js";
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
    delivery: { items: [], reasons: {}, selected: [] },
  },
  drinks: { items: [], reasons: {} },
  drinkUid: null,
};

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
  const parts = partitionByMealType(catalog.products, customs, slot);

  const m = mealPicker;
  m.slot = slot; m.profile = profile; m.targets = targets; m.todayLogs = todayLogs; m.catalog = catalog;
  m.onLogged = onLogged || null; m.lastPicked = lastPicked;
  ["convenience", "delivery"].forEach(function (t) {
    m.tabs[t] = { items: parts[t], reasons: reasonsFor(parts[t], profile), selected: [] };
  });
  m.drinks = { items: parts.drinks, reasons: reasonsFor(parts.drinks, profile) };
  m.drinkUid = null;
  // 沒存過的時段用預設偏好（跟推薦、基本資料表單顯示的一樣）；不合法的值（含 auto）由 engine 往下找上次送出的型態
  const prefs = Object.assign({}, DEFAULT_MEAL_PREFS, profile.meal_prefs);
  m.tab = tabOfMealType(resolveDefaultMealType({ planned: null, pref: prefs[slot], lastPicked: lastPicked[slot] }));

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
  mealPicker.tab = tab;
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

// 目前分頁的草稿（摘要與送出共用同一份，看到的＝存下的）；meal_type 一律是分頁值（decisions #47）
export function currentDraft() {
  const m = mealPicker;
  if (m.tab === "cook") return null;
  return { kind: "products", meal_type: m.tab, items: selectedItems(m.tab), estimates: [], drink: selectedDrink() };
}

// 送出規則用的品項（角色上限含飲料）
function draftRoleItems(d) {
  return d.items.concat(d.drink ? [d.drink] : []);
}

export function currentTotals() {
  const d = currentDraft();
  return d ? contentTotals(buildDraftContent(d), mealPicker.catalog) : null;
}

function submitProblem(d) {
  if (!d) return "自煮分頁還沒做好，請先用超商或外食分頁。";
  return manualSelectionProblem(draftRoleItems(d), mealPicker.slot, { estimates: d.estimates.length });
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
    panel.innerHTML = '<p class="meal-picker-note">自煮分頁還沒做好。</p>';
    return;
  }
  const t = m.tabs[m.tab];
  const groups = groupForTab(t.items, function (it) { return t.reasons[it.uid]; });
  panel.innerHTML = '<div class="meal-picker-step-label">1. 選品項（可以多選）</div>' + productTabHtml(groups, t.selected, TAB_LABELS[m.tab]);
}

function renderDrinks() {
  const el = $("#meal-picker-drinks");
  if (!el) return;
  const m = mealPicker;
  if (m.tab === "cook") { el.innerHTML = ""; return; }
  const entries = m.drinks.items.map(function (it) { return { item: it, reason: m.drinks.reasons[it.uid] || null }; });
  el.innerHTML = drinkStepHtml(entries, m.drinkUid, 2);
}

export function renderMealPicker() {
  renderTabs();
  renderPanel();
  renderDrinks();
  updateSummary();
}

// 其他分頁還有選取時提醒一行（送出只算目前分頁＋飲料）
function leftoverLine() {
  const m = mealPicker;
  return ["convenience", "delivery"].filter(function (t) { return t !== m.tab && selectedItems(t).length > 0; }).map(function (t) {
    return TAB_LABELS[t] + "分頁還有 " + selectedItems(t).length + " 項沒有算進這餐";
  });
}

export function updateSummary() {
  const m = mealPicker;
  const d = currentDraft();
  const totals = currentTotals();
  const summaryEl = $("#meal-picker-summary");
  if (summaryEl) {
    summaryEl.innerHTML = !totals ? "" :
      "已選 " + (d.items.length + d.estimates.length + (d.drink ? 1 : 0)) + " 件 · 約 " + Math.round(totals.kcal) + " kcal" +
      " · 蛋白質 " + fmtNutrient(totals.protein_g) +
      " · 碳水 " + fmtNutrient(totals.carb_g) +
      " · 脂肪 " + fmtNutrient(totals.fat_g) +
      " · 纖維 " + fmtNutrient(totals.fiber_g) +
      " · " + escapeHtml(sodiumText(totals.sodium_mg, totals.partial.indexOf("sodium_mg") !== -1, false));
  }

  const gapEl = $("#meal-picker-gap");
  if (gapEl) {
    const lines = [];
    if (totals && (d.items.length + d.estimates.length + (d.drink ? 1 : 0)) > 0) {
      const share = slotNutrientShare(m.targets, m.todayLogs, m.profile.enabled_slots, m.slot);
      const gaps = slotGaps(share, totals);
      if (gaps.overKcal > 0) lines.push("這組合約 " + Math.round(totals.kcal) + " kcal，這個時段配額約 " + Math.round(share.kcalShare) + " kcal（+" + gaps.overKcal + "），仍可送出。");
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

function onPanelClick(e) {
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

function logName(d) {
  return d.items.map(function (it) { return it.name; })
    .concat(d.estimates.map(function (x) { return x.name || "外食估算"; }), d.drink ? [d.drink.name] : []).join("＋");
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
    date: todayStr(), slot: m.slot, source: "manual", name: logName(d),
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
  if (panel) panel.addEventListener("click", onPanelClick);
  const drinks = $("#meal-picker-drinks");
  if (drinks) drinks.addEventListener("click", onDrinkClick);
  const cancel = $("#meal-picker-cancel");
  if (cancel) cancel.addEventListener("click", closePicker);
  const submit = $("#meal-picker-submit");
  if (submit) submit.addEventListener("click", onMealSubmit);
}
