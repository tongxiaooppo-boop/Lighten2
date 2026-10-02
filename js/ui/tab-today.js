// 輕盈計畫 (Lighten Plan) — 分頁二：今日建議（推薦卡片＋流程）。
// 彙總卡在 today-hero.js，「自己選」在 meal-picker/；推薦流程本身是 engine/today.js 的純函式。

import { SLOTS, SLOT_LABELS, isSlotEnabled } from "../core/slots.js";
import { dateAddDays, mondayOf, shortDate, weekdayLabel } from "../core/dates.js";
import { escapeHtml } from "../core/html.js";
import { $, notIncludedText } from "./dom.js";
import {
  getProfile, addDislikedIngredient, getDailyLogs, addDailyLog, undoDailyLog,
  getAllRecipeFeedback, saveRecipeFeedback, markRecipesShown, getHiddenCatalogUids, addSavedMeal,
} from "../data/db.js";
import { loadCatalog } from "../data/catalog.js";
import { loadSavedMealCtx } from "./saved-ctx.js";
import { loadDayPlans, pseudoLogsOf, plannedSummary, logPlanEntry, cancelPlan, skipToday, purgePlans, planDatesInRange, setSkipPlan } from "./today-plans.js";
import { buildCandidatePool } from "../engine/pool.js";
import { planToday } from "../engine/today.js";
import { contentFromRec, logsKcal, buildLogEntry, toSavedContent, savedMealDefaultName, savedMealForSave } from "../engine/meal-content.js";
import { getCalibratedTargets } from "./calibration.js";
import { renderHero, setHeroSuppressed } from "./today-hero.js";
import { openMealPicker, initMealPicker } from "./meal-picker/index.js";
import { todayStr, nowMs, nowIso } from "./clock.js";

// 時段 → 插畫（decisions #8：推薦卡片只用這 5 張，不逐品項配圖）。5 張同一套手繪風格，只有時段場景不同。
const MEAL_DEFAULT_IMAGE = {
  breakfast: "images/gemini/meal-default-breakfast.jpg",
  lunch: "images/gemini/meal-default-lunch.jpg",
  afternoon_tea: "images/gemini/meal-default-afternoon-tea.jpg",
  dinner: "images/gemini/meal-default-dinner.jpg",
  snack: "images/gemini/meal-default-snack.jpg",
};

// 最近一次的推薦結果，供「記錄這餐」按鈕找到對應 slot 的組合
let currentRecs = {};
// 最近一次的目標與推薦流程中間值（預算、缺口、跳過的時段），diff-recs 快照用
let lastPlan = null;
// 入口 2「存成組合」（工作線 C；PRD 11.2）：展開中的名稱欄 { logId, name, message, done }；重畫後照舊（審核建議 11）
let saveForm = null;
let lastLogsBySlot = {};
// 日期切換（decisions #140）：選中的日子存成「相對今天的位移」（0＝今天，1–6＝未來），跨日回到今天（設計草案 S7）
const DAYS_AHEAD = 6;
let dayOffset = 0;
let renderedToday = null;
// 今天的預約（loadDayPlans 的結果）、今天的暫時紀錄（給選擇器算配額）、未來那天的預約
let todayPlans = {};
let todayPseudo = [];
let futurePlans = {};
let futureShown = false;
let heroPlannedShown = false;

export function getCurrentRecs() {
  return currentRecs;
}

export function getLastPlan() {
  return lastPlan;
}

function setStatus(msg) {
  const el = $("#today-status");
  if (el) el.textContent = msg || "";
}

// 這個時段已經記錄過：顯示記了什麼＋撤銷，不再推薦新的組合。
// 撤銷按鈕跟著卡片一起渲染（用 daily_log 的 id），所以任何重新整理都不會把它吃掉。
// 「存成組合」：含估算的那一餐不提供（PRD 11.2 入口 2）；只在今天的卡片（decisions #124）
function loggedHtml(logs) {
  if (logs.length === 1 && logs[0].source === "skipped") {
    return '<p class="rec-logged-note">這餐沒吃</p><button type="button" class="undo-btn rec-undo-btn" data-log-id="' + escapeHtml(logs[0].id) + '">撤銷</button>';
  }
  const total = logsKcal(logs);
  const names = logs.map(function (l) { return l.name || "已記錄的餐點"; }).join("、");
  let html = '<p class="rec-logged-note">已記錄：' + escapeHtml(names) + "（約 " + Math.round(total) + " kcal）</p>";
  logs.forEach(function (l) {
    const which = logs.length > 1 ? "「" + escapeHtml(l.name || "") + "」" : "";
    html += '<button type="button" class="undo-btn rec-undo-btn" data-log-id="' + escapeHtml(l.id) + '">撤銷' + which + "</button>";
    if (canSaveLog(l)) {
      html += '<button type="button" class="undo-btn rec-save-btn" data-save-log-id="' + escapeHtml(l.id) + '">存成組合' + which + "</button>";
    }
    if (saveForm && saveForm.logId === l.id) html += saveFormHtml(saveForm);
  });
  return html;
}

function canSaveLog(l) {
  return !!(l.content && Array.isArray(l.content.components) && l.content.components.length > 0 &&
    !l.content.components.some(function (c) { return c.kind === "estimate"; }));
}

function saveFormHtml(f) {
  if (f.done) return '<p class="rec-save-note">' + escapeHtml(f.message) + "</p>";
  return '<div class="rec-save-form"><input type="text" class="foods-search" id="rec-save-name" maxlength="40" placeholder="組合名稱" value="' + escapeHtml(f.name) + '">' +
    '<button type="button" class="secondary-btn" data-save-confirm="' + escapeHtml(f.logId) + '">存</button>' +
    '<button type="button" class="secondary-btn" data-save-cancel>取消</button>' +
    (f.message ? '<p class="rec-save-note">' + escapeHtml(f.message) + "</p>" : "") + "</div>";
}

function findTodayLog(logId) {
  let hit = null;
  Object.keys(lastLogsBySlot).forEach(function (slot) {
    (lastLogsBySlot[slot] || []).forEach(function (l) { if (l.id === logId) hit = l; });
  });
  return hit;
}

function rerenderLoggedSlot(slot) {
  const body = $("#rec-" + slot);
  const logs = lastLogsBySlot[slot];
  if (body && logs && logs.length > 0) body.innerHTML = loggedHtml(logs);
}

// 組合的 ctx 一律從 saved-ctx.js 拿（含我的食材，切片 8b 審核 M6）
function saveCtx() {
  return loadSavedMealCtx({ slot: null });
}

// 點「存成組合」：展開名稱欄，預填品名（只寫品名、不寫量，decisions #124）
async function onSaveLogClick(logId) {
  const log = findTodayLog(logId);
  if (!log) return;
  try {
    const c = await saveCtx();
    saveForm = { logId: logId, name: savedMealDefaultName(toSavedContent(log.content, { keepImplicit: false }), c.catalog, c.ctx), message: null, done: false };
  } catch (err) {
    console.error(err);
    saveForm = { logId: logId, name: "", message: null, done: false };
  }
  rerenderLoggedSlot(log.slot);
  const input = document.getElementById("rec-save-name");
  if (input && input.focus) input.focus();
}

// 存：紀錄的內容 → 組合（入口 2 一律不保留用油調味）→ 已下架、隱藏的照規則 1–2 → 語意驗證（沒有時段）→ 寫入
async function onSaveLogConfirm(logId) {
  const log = findTodayLog(logId);
  if (!log || !saveForm) return;
  const name = (saveForm.name || "").trim();
  if (!name) { saveForm.message = "請填組合名稱。"; rerenderLoggedSlot(log.slot); return; }
  try {
    const c = await saveCtx();
    const s = savedMealForSave(toSavedContent(log.content, { keepImplicit: false }), c.catalog, c.ctx);
    if (s.problems) {
      saveForm.message = "不能存成組合：" + s.problems.join("；");
    } else {
      await addSavedMeal({ name: name, content: s.content });
      saveForm = { logId: logId, done: true, message: "已存成組合「" + name + "」，在「自己選」最上面。" +
        (s.dropped.length ? "以下品項已不提供，沒有存進組合：" + s.dropped.map(function (d) { return d.name; }).join("、") + "。" : "") };
    }
  } catch (err) {
    console.error(err);
    saveForm.message = "存檔失敗，請重試。";
  }
  rerenderLoggedSlot(log.slot);
}

// 依組合內容列出可以「順便不要」的項目：
//   自組食譜 → 蛋白質 + 蔬菜兩個 chip；現成品項組合 → 每個成分名稱一個 chip；沒有可拆解成分就不顯示。
function dislikeChipsHtml(rec) {
  const entries = [];
  if (rec.is_composed) {
    if (rec.protein_id) entries.push({ type: "protein", key: rec.protein_id, label: rec.protein_name });
    if (rec.vegetable_id) entries.push({ type: "vegetable", key: rec.vegetable_id, label: rec.vegetable_name });
  } else if (Array.isArray(rec.component_labels)) {
    rec.component_labels.forEach(function (c) { entries.push({ type: "item", key: c.uid, label: c.label }); });
  }
  if (entries.length === 0) return "";
  const chips = entries.map(function (e) {
    return '<button type="button" class="dislike-chip" data-type="' + escapeHtml(e.type) +
      '" data-key="' + escapeHtml(e.key) + '" data-label="' + escapeHtml(e.label) + '">' + escapeHtml(e.label) + "</button>";
  }).join("");
  return '<div class="dislike-chips"><span class="dislike-chips-label">順便不要：</span>' + chips + "</div>";
}

// 預約卡片（今天）：有效的顯示內容與記下；失效的寫原因，下面照常推薦
function planCardHtml(entry, slot) {
  const plan = entry.plan;
  const st = entry.result.status;
  const head = st === "skip" ? '<div class="rec-name">這餐不吃（預約）</div>'
    : '<div class="rec-name">' + escapeHtml(plan.name) + '</div><div class="rec-meta">預約 · 約 ' + Math.round(entry.result.totals.kcal) + " kcal</div>";
  return '<div class="rec-plan">' + head +
    '<button type="button" class="secondary-btn" data-plan-log="' + escapeHtml(slot) + '">記下</button>' +
    '<button type="button" class="secondary-btn" data-plan-edit="' + escapeHtml(slot) + '">改</button>' +
    '<button type="button" class="undo-btn" data-plan-cancel="' + escapeHtml(plan.id) + '">取消預約</button></div>';
}

function planInvalidHtml(entry) {
  return '<div class="rec-plan rec-plan-invalid"><p class="rec-empty">預約「' + escapeHtml(entry.plan.name) + "」" + escapeHtml(entry.unavailable) + "，這餐先照建議。</p>" +
    '<button type="button" class="secondary-btn" data-plan-edit="' + escapeHtml(entry.plan.slot) + '">改</button>' +
    '<button type="button" class="undo-btn" data-plan-cancel="' + escapeHtml(entry.plan.id) + '">取消預約</button></div>';
}

// 配額因預約而變低時的中性句（decisions #142②）：寫哪幾餐排了，不寫「配額不多」
function plannedLowText(plannedSlots) {
  const names = SLOTS.filter(function (s) { return plannedSlots[s] && !plannedSlots[s].skip; }).map(function (s) { return SLOT_LABELS[s]; });
  return names.length ? names.join("、") + "已經排進來了，這餐照平常吃就好" : null;
}

function renderRecs(recs, profile, logsBySlot, plan) {
  const plannedSlots = (plan && plan.plannedSlots) || {};
  const lowText = plannedLowText(plannedSlots);
  SLOTS.forEach(function (slot) {
    const body = $("#rec-" + slot);
    const extra = $("#rec-extra-" + slot);
    if (extra) extra.innerHTML = "";
    if (!body) return;
    const isEnabled = !profile || isSlotEnabled(profile.enabled_slots, slot);
    const slotLogs = logsBySlot && logsBySlot[slot];
    if (slotLogs && slotLogs.length > 0) {
      body.innerHTML = loggedHtml(slotLogs);
      return;
    }
    const entry = todayPlans[slot];
    if (entry && entry.result.status !== "invalid") {
      body.innerHTML = planCardHtml(entry, slot);
      return;
    }
    if (!isEnabled) {
      body.innerHTML = '<p class="rec-empty">已設定不需要這個時段的建議，可到基本資料分頁調整</p>';
      return;
    }
    // 這餐不吃（decisions #141①）：只給開啟中的時段（關掉的時段本來就不算，審核 M13）
    if (extra) extra.innerHTML = '<button type="button" class="undo-btn rec-skip-btn" data-skip-slot="' + escapeHtml(slot) + '">這餐不吃</button>';
    const invalidHtml = entry ? planInvalidHtml(entry) : "";
    const rec = recs[slot];
    // 沒有推薦卡片時仍要能「自己選」，不然這個時段無法手動記錄
    if (!rec) {
      body.innerHTML = invalidHtml + '<p class="rec-empty">暫無適合的組合</p>' + pickBtnHtml(slot);
      return;
    }
    // 依序分配後配額低於門檻（不是「找不到組合」，是「配額被前面時段用完了」）；是預約造成的就換中性句
    if (rec.lowBudget) {
      body.innerHTML = invalidHtml + '<p class="rec-empty">' + escapeHtml(lowText || "這個時段的配額已經不多了") + "</p>" + pickBtnHtml(slot);
      return;
    }
    const imgSrc = MEAL_DEFAULT_IMAGE[slot];
    const imgHtml = imgSrc
      ? '<img class="rec-card-img" src="' + imgSrc + '" alt="' + escapeHtml(SLOT_LABELS[slot] || "") + '" loading="lazy">'
      : "";
    const fallbackNote = rec.fallback_to_auto
      ? '<p class="rec-fallback-note">今天這個來源沒有合適的選擇，已改為一般推薦</p>'
      : "";
    const contentNote = rec.content_note
      ? '<p class="rec-content-note">' + escapeHtml(rec.content_note) + "</p>"
      : "";
    body.innerHTML = invalidHtml +
      imgHtml +
      fallbackNote +
      '<div class="rec-name">' + escapeHtml(rec.name) + "</div>" +
      contentNote +
      '<div class="rec-meta">' +
      escapeHtml(rec.tier) + " · 約 " + rec.scaled_kcal + " kcal" +
      '<span class="rec-base">（基準 ' + rec.kcal + " kcal" + (rec.implicit && rec.implicit.oil_g > 0 ? "，含用油約 " + rec.implicit.oil_g + "g" : "") +
      (notIncludedText(rec.not_included) ? "，" + escapeHtml(notIncludedText(rec.not_included)) : "") + "）</span>" +
      (rec.budget != null ? '<span class="rec-base"> · 配額 ' + Math.round(rec.budget) + " kcal</span>" : "") +
      "</div>" +
      dislikeChipsHtml(rec) +
      '<button type="button" class="dislike-btn" data-id="' + escapeHtml(rec.id) + '">倒讚</button>' +
      '<button type="button" class="secondary-btn rec-log-btn" data-slot="' + escapeHtml(slot) + '">記錄這餐</button>' +
      pickBtnHtml(slot);
  });
}

// 日期列：今天＋未來 6 天；有預約的日子加一個小點（中性，不是完成度）
function renderDateStrip(today, planDates) {
  const el = $("#today-dates");
  if (!el) return;
  let html = "";
  for (let i = 0; i <= DAYS_AHEAD; i++) {
    const d = dateAddDays(today, i);
    html += '<button type="button" class="today-date' + (i === dayOffset ? " is-active" : "") + '" data-day-offset="' + i + '"' +
      (i === dayOffset ? ' aria-current="date"' : "") + '><span class="today-date-wd">' + (i === 0 ? "今天" : weekdayLabel(d)) + '</span><span class="today-date-md">' + shortDate(d) + "</span>" +
      '<span class="today-date-dot"' + (planDates[d] ? ' aria-label="有預約"' : " hidden") + "></span></button>";
  }
  el.innerHTML = html;
}

// 未來日子：不跑推薦、不算配額、不顯示目標（PRD 6.2），只顯示預約與已排的合計熱量
async function renderFutureDay(today, profile) {
  const date = dateAddDays(today, dayOffset);
  futurePlans = await loadDayPlans(date, profile.oil_habit || "normal");
  const hero = $("#today-hero");
  if (hero) hero.hidden = true;
  const sum = plannedSummary(futurePlans);
  const sumEl = $("#today-day-summary");
  if (sumEl) {
    sumEl.textContent = weekdayLabel(date) + " " + shortDate(date) + "：" + (sum.count ? "已排 " + sum.count + " 餐，約 " + Math.round(sum.kcal) + " kcal" : "還沒排任何一餐") + "。當天其他餐會照預約自動調整。";
    sumEl.hidden = false;
  }
  futureShown = true;
  const refresh = $("#today-refresh");
  if (refresh) refresh.hidden = true; // 未來日子沒有推薦可以重新整理
  SLOTS.forEach(function (slot) {
    const body = $("#rec-" + slot);
    const extra = $("#rec-extra-" + slot);
    if (extra) extra.innerHTML = "";
    if (!body) return;
    const e = futurePlans[slot];
    const enabled = isSlotEnabled(profile.enabled_slots, slot);
    let html;
    if (e) {
      const head = e.result.status === "skip" ? '<div class="rec-name">這餐不吃（預約）</div>'
        : e.result.status === "ok" ? '<div class="rec-name">' + escapeHtml(e.plan.name) + '</div><div class="rec-meta">約 ' + Math.round(e.result.totals.kcal) + " kcal</div>"
          : '<div class="rec-name">' + escapeHtml(e.plan.name) + '</div><p class="rec-empty">' + escapeHtml(e.unavailable) + "</p>";
      html = '<div class="rec-plan">' + head +
        (e.result.status === "skip" ? "" : '<button type="button" class="secondary-btn" data-plan-edit="' + escapeHtml(slot) + '">改</button>') +
        '<button type="button" class="undo-btn" data-plan-cancel="' + escapeHtml(e.plan.id) + '">取消預約</button></div>';
    } else {
      html = '<p class="rec-empty">還沒排</p><button type="button" class="secondary-btn" data-plan-pick="' + escapeHtml(slot) + '">自己選</button>' +
        (enabled ? '<button type="button" class="undo-btn" data-plan-skip="' + escapeHtml(slot) + '">這餐不吃</button>' : "");
    }
    body.innerHTML = html;
  });
}

function pickBtnHtml(slot) {
  return '<button type="button" class="secondary-btn rec-pick-btn" data-slot="' + escapeHtml(slot) + '">自己選</button>';
}

export async function buildRecommendation() {
  setStatus("載入中…");
  const todayNow = todayStr();
  if (renderedToday !== null && renderedToday !== todayNow) dayOffset = 0; // 跨日（背景放過午夜）回到今天
  renderedToday = todayNow;
  let profile;
  try {
    profile = await getProfile();
  } catch (e) {
    console.error(e);
    setStatus("讀取基本資料失敗。");
    return;
  }

  if (!profile) {
    setStatus("請先到「基本資料」分頁填寫並按「計算」後，再回來看今日建議。");
    currentRecs = {};
    SLOTS.forEach(function (slot) {
      const body = $("#rec-" + slot);
      if (body) body.innerHTML = "";
    });
    const hero = $("#today-hero");
    if (hero) hero.hidden = true;
    return;
  }

  let targets;
  try {
    targets = await getCalibratedTargets(profile);
  } catch (e) {
    console.error(e);
    setStatus("計算今日目標失敗，請重新整理頁面。");
    return;
  }
  const today = todayNow;
  setHeroSuppressed(dayOffset > 0);
  if (dayOffset > 0) {
    try {
      renderDateStrip(today, await planDatesInRange(today, dateAddDays(today, DAYS_AHEAD)));
      await renderFutureDay(today, profile);
      setStatus("");
    } catch (err) {
      console.error(err);
      setStatus("讀取預約失敗，請重試。");
    }
    return;
  }
  // 近7天平均不含今天，窗口往前多抓一天。
  const [todayLogs, weekLogs, recentLogs, feedbackMap, catalog] = await Promise.all([
    getDailyLogs({ start: today, end: today }),
    getDailyLogs({ start: mondayOf(today), end: today }),
    getDailyLogs({ start: dateAddDays(today, -7), end: today }),
    getAllRecipeFeedback(),
    loadCatalog(),
  ]);

  // 隱藏清單讀不到不擋推薦（隱藏不是安全規則），當成沒有隱藏
  let hiddenUids = [];
  try { hiddenUids = await getHiddenCatalogUids(); } catch (err) { console.error(err); }
  // 今天的預約（讀不到不擋推薦，當成沒有預約）
  let planDates = {};
  try {
    todayPlans = await loadDayPlans(today, profile.oil_habit || "normal");
    planDates = await planDatesInRange(today, dateAddDays(today, DAYS_AHEAD));
  } catch (err) { console.error(err); todayPlans = {}; }
  todayPseudo = pseudoLogsOf(todayPlans);
  const plan = planToday({
    profile: profile, targets: targets, todayLogs: todayLogs, weekLogs: weekLogs,
    feedbackMap: feedbackMap, pool: buildCandidatePool(catalog), hiddenUids: hiddenUids, today: today, nowMs: nowMs(),
    todayPlans: todayPseudo,
  });
  const recs = plan.recs;
  currentRecs = recs;
  lastPlan = { targets: targets, plan: plan };

  renderDateStrip(today, planDates);
  if (futureShown) {
    const sumEl = $("#today-day-summary");
    if (sumEl) sumEl.hidden = true;
    const refresh = $("#today-refresh");
    if (refresh) refresh.hidden = false;
    futureShown = false;
  }
  // 彙總卡：主數字不扣預約；有預約時多一行「已排」（只在有預約或剛撤掉時才碰這個元素，快照守則）
  const planned = plan.plannedKcal != null ? { kcal: plan.plannedKcal, slots: plan.plannedSlots } : null;
  renderHero(plan.loggedBudget || plan.remainingBudget, targets, todayLogs, recentLogs, profile, recs, today, planned, heroPlannedShown).catch(function (err) { console.error(err); });
  heroPlannedShown = !!planned;

  lastLogsBySlot = plan.logsBySlot || {};
  if (saveForm && !findTodayLog(saveForm.logId)) saveForm = null; // 撤銷了就收起來
  renderRecs(recs, profile, plan.logsBySlot, plan);
  // 在畫面實際渲染出卡片的當下記錄「這個組合今天被顯示過」，同一天重複整理不重複累加。
  const shownIds = Object.keys(recs).map(function (slot) { return recs[slot] && recs[slot].id; }).filter(Boolean);
  if (shownIds.length > 0) markRecipesShown(shownIds, today).catch(function (err) { console.error(err); });
  setStatus("");
}

// 推薦的組合照組合本身算好的數字記錄。記錄完重新渲染，這個時段會改顯示「已記錄＋撤銷」。
export async function onLogRecClick(slot, rec, btnEl) {
  btnEl.disabled = true; // 防連點
  try {
    const catalog = await loadCatalog();
    await addDailyLog(buildLogEntry({
      date: todayStr(), slot: slot, source: "rec_accepted", name: rec.name,
      content: contentFromRec(rec, catalog.productsByUid),
      totals: {
        kcal: rec.scaled_kcal, protein_g: rec.protein_g, carb_g: rec.carb_g, fat_g: rec.fat_g, fiber_g: rec.fiber_g,
        sat_fat_g: rec.sat_fat_g, sodium_mg: rec.sodium_mg, partial: rec.partial,
      },
      createdAt: nowIso(),
    }));
    await buildRecommendation();
  } catch (err) {
    console.error(err);
    alert("記錄失敗，請重試。");
    btnEl.disabled = false;
  }
}

export async function onUndoClick(logId, btnEl) {
  btnEl.disabled = true;
  try {
    await undoDailyLog(logId);
    await buildRecommendation();
  } catch (err) {
    console.error(err);
    alert("撤銷失敗，請重試。");
    btnEl.disabled = false;
  }
}

export function onDislikeClick(id) {
  return saveRecipeFeedback(id, "dislike").then(function () {
    return buildRecommendation();
  }).catch(function (e) {
    console.error(e);
    setStatus("倒讚記錄失敗。");
  });
}

// 「順便不要」：寫入走 db.js 專用函式（一個 transaction 讀改寫、只比 key，decisions #99）。
// 基本資料的不吃清單已搬到「我的食物」，按完告訴使用者去哪裡取消（計畫 S13）。
export async function onDislikeChipClick(chip) {
  const entry = { type: chip.getAttribute("data-type"), key: chip.getAttribute("data-key"), label: chip.getAttribute("data-label") || "" };
  try {
    await addDislikedIngredient(entry);
  } catch (err) {
    console.error(err);
    setStatus("存檔失敗，請重試。");
    return;
  }
  await buildRecommendation();
  setStatus("已標不吃「" + (entry.label || entry.key) + "」，可以在「我的食物」取消。");
}

async function onPlanLog(slot, btn) {
  const entry = todayPlans[slot];
  if (!entry) return;
  btn.disabled = true;
  try {
    const profile = await getProfile();
    await logPlanEntry(entry, todayStr(), (profile && profile.oil_habit) || "normal");
    await buildRecommendation();
  } catch (err) {
    console.error(err);
    alert("記錄失敗，請重試。");
    btn.disabled = false;
  }
}

async function onPlanCancel(id, btn) {
  btn.disabled = true;
  try {
    await cancelPlan(id);
    await buildRecommendation();
  } catch (err) {
    console.error(err);
    alert("取消失敗，請重試。");
    btn.disabled = false;
  }
}

async function onSkipToday(slot, btn) {
  btn.disabled = true;
  try {
    await skipToday(todayStr(), slot);
    await buildRecommendation();
  } catch (err) {
    console.error(err);
    alert("記錄失敗，請重試。");
    btn.disabled = false;
  }
}

// 未來日子預約「這餐不吃」（decisions #141③）
async function onPlanSkip(slot, btn) {
  btn.disabled = true;
  try {
    await setSkipPlan(dateAddDays(todayStr(), dayOffset), slot);
    await buildRecommendation();
  } catch (err) {
    console.error(err);
    alert("存檔失敗，請重試。");
    btn.disabled = false;
  }
}

// 排預約或改預約：選擇器的 plan 模式（日期在打開時定）
function openPlanPicker(slot) {
  const date = dateAddDays(todayStr(), dayOffset);
  const entry = dayOffset === 0 ? todayPlans[slot] : futurePlans[slot];
  const preset = entry && entry.result.status !== "skip" ? entry.plan : null;
  openMealPicker(slot, { mode: "plan", date: date, planPreset: preset, onSaved: buildRecommendation });
}

export function initTodayTab() {
  const refreshBtn = $("#today-refresh");
  if (refreshBtn) {
    refreshBtn.addEventListener("click", function () {
      buildRecommendation();
    });
  }

  const dates = $("#today-dates");
  if (dates) {
    dates.addEventListener("click", function (e) {
      const b = e.target.closest("[data-day-offset]");
      if (!b) return;
      dayOffset = Number(b.getAttribute("data-day-offset")) || 0;
      buildRecommendation();
    });
  }
  // 手機背景放過午夜再打開：日期列與今天要跟著換（設計草案 S7）
  document.addEventListener("visibilitychange", function () {
    if (!document.hidden && renderedToday !== null && todayStr() !== renderedToday) buildRecommendation();
  });

  const grid = $("#today-recs");
  if (grid) {
    grid.addEventListener("click", function (e) {
      const planLog = e.target.closest("[data-plan-log]");
      if (planLog) { onPlanLog(planLog.getAttribute("data-plan-log"), planLog); return; }
      const planEdit = e.target.closest("[data-plan-edit]");
      if (planEdit) { openPlanPicker(planEdit.getAttribute("data-plan-edit")); return; }
      const planPick = e.target.closest("[data-plan-pick]");
      if (planPick) { openPlanPicker(planPick.getAttribute("data-plan-pick")); return; }
      const planCancel = e.target.closest("[data-plan-cancel]");
      if (planCancel) { onPlanCancel(planCancel.getAttribute("data-plan-cancel"), planCancel); return; }
      const planSkip = e.target.closest("[data-plan-skip]");
      if (planSkip) { onPlanSkip(planSkip.getAttribute("data-plan-skip"), planSkip); return; }
      const skipBtn = e.target.closest("[data-skip-slot]");
      if (skipBtn) { onSkipToday(skipBtn.getAttribute("data-skip-slot"), skipBtn); return; }
      const dislikeBtn = e.target.closest(".dislike-btn");
      if (dislikeBtn && dislikeBtn.getAttribute("data-id")) {
        onDislikeClick(dislikeBtn.getAttribute("data-id"));
        return;
      }
      const undoBtn = e.target.closest(".rec-undo-btn");
      if (undoBtn && undoBtn.getAttribute("data-log-id")) {
        onUndoClick(undoBtn.getAttribute("data-log-id"), undoBtn);
        return;
      }
      const saveBtn = e.target.closest("[data-save-log-id]");
      if (saveBtn) { onSaveLogClick(saveBtn.getAttribute("data-save-log-id")); return; }
      const saveOk = e.target.closest("[data-save-confirm]");
      if (saveOk) { onSaveLogConfirm(saveOk.getAttribute("data-save-confirm")); return; }
      if (e.target.closest("[data-save-cancel]")) {
        const log = saveForm && findTodayLog(saveForm.logId);
        saveForm = null;
        if (log) rerenderLoggedSlot(log.slot);
        return;
      }
      const logBtn = e.target.closest(".rec-log-btn");
      if (logBtn && logBtn.getAttribute("data-slot")) {
        const slot = logBtn.getAttribute("data-slot");
        const rec = currentRecs[slot];
        if (rec) onLogRecClick(slot, rec, logBtn);
        return;
      }
      const pickBtn = e.target.closest(".rec-pick-btn");
      if (pickBtn && pickBtn.getAttribute("data-slot")) {
        openMealPicker(pickBtn.getAttribute("data-slot"), { onLogged: buildRecommendation, todayPlans: todayPseudo });
        return;
      }
      const chipBtn = e.target.closest(".dislike-chip");
      if (chipBtn && chipBtn.getAttribute("data-key")) {
        onDislikeChipClick(chipBtn);
      }
    });
  }

  if (grid) {
    grid.addEventListener("input", function (e) {
      if (e.target.id === "rec-save-name" && saveForm) saveForm.name = e.target.value;
    });
  }

  initMealPicker();
  purgePlans(todayStr());

  // 從其他分頁切回來（記錄／改基本資料之後）要重新算，不能停在載入時的畫面。
  document.addEventListener("tab:activated", function (e) {
    if (e.detail === "today") buildRecommendation();
  });

  buildRecommendation();
}
