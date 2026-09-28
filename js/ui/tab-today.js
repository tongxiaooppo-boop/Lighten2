// 輕盈計畫 (Lighten Plan) — 分頁二：今日建議（推薦卡片＋流程）。
// 彙總卡在 today-hero.js，「自己選」在 manual-picker.js；推薦流程本身是 engine/today.js 的純函式。

import { SLOTS, SLOT_LABELS, isSlotEnabled } from "../core/slots.js";
import { dateAddDays, mondayOf } from "../core/dates.js";
import { escapeHtml } from "../core/html.js";
import { $ } from "./dom.js";
import {
  getProfile, saveProfile, getDailyLogs, addDailyLog, undoDailyLog,
  getAllRecipeFeedback, saveRecipeFeedback, markRecipesShown,
} from "../data/db.js";
import { loadCatalog } from "../data/catalog.js";
import { buildCandidatePool } from "../engine/pool.js";
import { planToday } from "../engine/today.js";
import { contentFromRec, logsKcal, buildLogEntry } from "../engine/meal-content.js";
import { getCalibratedTargets } from "./calibration.js";
import { renderHero } from "./today-hero.js";
import { openManualPicker, initManualPicker } from "./manual-picker.js";
import { todayStr, nowMs, nowIso } from "./clock.js";

// 蛋白質食材 id → 食材縮圖（用 id 對照，食材改名不影響；查不到就用時段插畫墊底）。
// Phase 0 品項卡片改純文字時，推薦卡片只保留 5 張時段插畫（PRD 第 8 節），這張表會移除。
const PROTEIN_IMAGE = {
  chicken_breast: "images/food/chicken-breast.jpg",
  egg: "images/food/egg.jpg",
  greek_yogurt: "images/food/greek-yogurt.jpg",
  salmon: "images/food/salmon.jpg",
  beef_shank: "images/food/beef.jpg",
  chicken_thigh: "images/food/chicken-thigh.jpg",
  tilapia_fillet: "images/food/tilapia.jpg",
  firm_tofu: "images/food/tofu.jpg",
  shrimp: "images/food/shrimp.jpg",
  soy_milk: "images/food/soy-milk.jpg",
};

// 時段 → 預設插畫（找不到具體食物照片時墊底用）。5 張同一套手繪風格，只有時段場景不同。
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
function loggedHtml(logs) {
  const total = logsKcal(logs);
  const names = logs.map(function (l) { return l.name || "已記錄的餐點"; }).join("、");
  let html = '<p class="rec-logged-note">已記錄：' + escapeHtml(names) + "（約 " + Math.round(total) + " kcal）</p>";
  logs.forEach(function (l) {
    html += '<button type="button" class="undo-btn rec-undo-btn" data-log-id="' + escapeHtml(l.id) + '">撤銷' +
      (logs.length > 1 ? "「" + escapeHtml(l.name || "") + "」" : "") + "</button>";
  });
  return html;
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

function renderRecs(recs, profile, logsBySlot) {
  SLOTS.forEach(function (slot) {
    const body = $("#rec-" + slot);
    if (!body) return;
    const isEnabled = !profile || isSlotEnabled(profile.enabled_slots, slot);
    if (!isEnabled) {
      body.innerHTML = '<p class="rec-empty">已設定不需要這個時段的建議，可到基本資料分頁調整</p>';
      return;
    }
    const slotLogs = logsBySlot && logsBySlot[slot];
    if (slotLogs && slotLogs.length > 0) {
      body.innerHTML = loggedHtml(slotLogs);
      return;
    }
    const rec = recs[slot];
    if (!rec) {
      body.innerHTML = '<p class="rec-empty">暫無適合的組合</p>';
      return;
    }
    // 依序分配後配額低於門檻（不是「找不到組合」，是「配額被前面時段用完了」）
    if (rec.lowBudget) {
      body.innerHTML = '<p class="rec-empty">這個時段的配額已經不多了</p>';
      return;
    }
    const imgSrc = PROTEIN_IMAGE[rec.protein_id] || MEAL_DEFAULT_IMAGE[slot];
    const imgHtml = imgSrc
      ? '<img class="rec-card-img" src="' + imgSrc + '" alt="' + escapeHtml(rec.protein_name || SLOT_LABELS[slot] || "") + '" loading="lazy">'
      : "";
    const fallbackNote = rec.fallback_to_auto
      ? '<p class="rec-fallback-note">今天這個來源沒有合適的選擇，已改為一般推薦</p>'
      : "";
    const contentNote = rec.content_note
      ? '<p class="rec-content-note">' + escapeHtml(rec.content_note) + "</p>"
      : "";
    body.innerHTML =
      imgHtml +
      fallbackNote +
      '<div class="rec-name">' + escapeHtml(rec.name) + "</div>" +
      contentNote +
      '<div class="rec-meta">' +
      escapeHtml(rec.tier) + " · 約 " + rec.scaled_kcal + " kcal" +
      '<span class="rec-base">（基準 ' + rec.kcal + " kcal" + (rec.implicit && rec.implicit.oil_g > 0 ? "，含用油約 " + rec.implicit.oil_g + "g" : "") + "）</span>" +
      (rec.budget != null ? '<span class="rec-base"> · 配額 ' + Math.round(rec.budget) + " kcal</span>" : "") +
      "</div>" +
      dislikeChipsHtml(rec) +
      '<button type="button" class="dislike-btn" data-id="' + escapeHtml(rec.id) + '">倒讚</button>' +
      '<button type="button" class="secondary-btn rec-log-btn" data-slot="' + escapeHtml(slot) + '">記錄這餐</button>' +
      '<button type="button" class="secondary-btn rec-pick-btn" data-slot="' + escapeHtml(slot) + '">自己選</button>';
  });
}

export async function buildRecommendation() {
  setStatus("載入中…");
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
  const today = todayStr();
  // 近7天平均不含今天，窗口往前多抓一天。
  const [todayLogs, weekLogs, recentLogs, feedbackMap, catalog] = await Promise.all([
    getDailyLogs({ start: today, end: today }),
    getDailyLogs({ start: mondayOf(today), end: today }),
    getDailyLogs({ start: dateAddDays(today, -7), end: today }),
    getAllRecipeFeedback(),
    loadCatalog(),
  ]);

  const plan = planToday({
    profile: profile, targets: targets, todayLogs: todayLogs, weekLogs: weekLogs,
    feedbackMap: feedbackMap, pool: buildCandidatePool(catalog), today: today, nowMs: nowMs(),
  });
  const recs = plan.recs;
  currentRecs = recs;
  lastPlan = { targets: targets, plan: plan };

  renderHero(plan.remainingBudget, targets, todayLogs, recentLogs, profile, recs, today).catch(function (err) { console.error(err); });

  renderRecs(recs, profile, plan.logsBySlot);
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

export async function onDislikeChipClick(chip) {
  const entry = { type: chip.getAttribute("data-type"), key: chip.getAttribute("data-key"), label: chip.getAttribute("data-label") };
  const profile = await getProfile();
  if (!profile) return;
  const list = Array.isArray(profile.disliked_ingredients) ? profile.disliked_ingredients : [];
  const exists = list.some(function (d) { return d.type === entry.type && d.key === entry.key; });
  if (!exists) {
    list.push(entry);
    profile.disliked_ingredients = list;
    await saveProfile(profile);
  }
  await buildRecommendation();
}

export function initTodayTab() {
  const refreshBtn = $("#today-refresh");
  if (refreshBtn) {
    refreshBtn.addEventListener("click", function () {
      buildRecommendation();
    });
  }

  const grid = $("#today-recs");
  if (grid) {
    grid.addEventListener("click", function (e) {
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
      const logBtn = e.target.closest(".rec-log-btn");
      if (logBtn && logBtn.getAttribute("data-slot")) {
        const slot = logBtn.getAttribute("data-slot");
        const rec = currentRecs[slot];
        if (rec) onLogRecClick(slot, rec, logBtn);
        return;
      }
      const pickBtn = e.target.closest(".rec-pick-btn");
      if (pickBtn && pickBtn.getAttribute("data-slot")) {
        openManualPicker(pickBtn.getAttribute("data-slot"), buildRecommendation);
        return;
      }
      const chipBtn = e.target.closest(".dislike-chip");
      if (chipBtn && chipBtn.getAttribute("data-key")) {
        onDislikeChipClick(chipBtn);
      }
    });
  }

  initManualPicker();

  // 從其他分頁切回來（記錄／改基本資料之後）要重新算，不能停在載入時的畫面。
  document.addEventListener("tab:activated", function (e) {
    if (e.detail === "today") buildRecommendation();
  });

  buildRecommendation();
}
