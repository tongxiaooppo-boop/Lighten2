// 輕盈計畫 — 今日建議的「昨天的餐」卡片（隔天確認，PRD 6.1；decisions #140⑤、#142；設計草案第 1.4、9 節）。
// 昨天開啟中、沒有紀錄的時段各一列：吃了（預約或推薦）／S M L／這餐沒吃／不確定（只收起，不寫紀錄）。
// 預設收合成一行；用字中性，不寫漏掉、不寫沒做完。讀 last_shown_recs 只准這個檔案與 tab-today.js、today-plans.js（章程）。

import { SLOT_LABELS } from "../core/slots.js";
import { dateAddDays } from "../core/dates.js";
import { BACKFILL_DAYS } from "../core/config.js";
import { escapeHtml } from "../core/html.js";
import { $ } from "./dom.js";
import { getDailyLogs, addDailyLog, getLastShownRecs } from "../data/db.js";
import { loadDayPlans, logPlanEntry } from "./today-plans.js";
import { openMealPicker } from "./meal-picker/index.js";
import {
  yesterdayRows, buildLogEntry, skippedLogEntry, recallEstimateLogEntry, recallEstimateKcal,
} from "../engine/meal-content.js";
import { nowIso } from "./clock.js";

let open = false;          // 卡片展開與否（預設收合）
let closedFor = null;      // 「先不用」：收起這一天的整張卡
const dismissed = {};      // 「不確定」：{ 日期: { 時段: true } }，只在這次開啟 App 期間有效（不寫資料庫）
let shown = false;         // 容器目前有內容（沒內容也沒顯示過就完全不碰 DOM，快照守則）
let listening = false;
let ctx = null;            // 最近一次畫的資料

function ydayRowHtml(r) {
  const label = '<span class="yday-slot">' + escapeHtml(SLOT_LABELS[r.slot] || r.slot) + "</span>";
  const slot = escapeHtml(r.slot);
  const btn = function (act, text, cls) {
    return '<button type="button" class="' + (cls || "secondary-btn") + ' yday-btn" data-yday="' + act + '" data-slot="' + slot + '">' + text + "</button>";
  };
  const unsure = btn("unsure", "不確定", "undo-btn");
  const none = btn("skipped", "這餐沒吃", "undo-btn yday-skip");
  if (r.kind === "plan_skip") {
    return '<div class="yday-row">' + label + '<span class="yday-name">預約這餐不吃</span><div class="yday-actions">' +
      btn("skipped", "沒吃（照預約）", "secondary-btn") + unsure + "</div></div>";
  }
  if (r.kind === "plan") {
    return '<div class="yday-row">' + label + '<span class="yday-name">' + escapeHtml(r.name) + "（預約，約 " + r.kcal + " kcal）</span>" +
      '<div class="yday-actions">' + btn("eat-plan", "吃了", "primary-btn") + btn("edit-plan", "改") + none + unsure + "</div></div>";
  }
  const sizes = ["S", "M", "L"].map(function (z) { return btn("est-" + z, z); }).join("");
  const hint = '<span class="yday-hint">S／M／L 約 ' + ["S", "M", "L"].map(function (z) { return recallEstimateKcal(r.slot, z); }).join("／") + " kcal</span>";
  const rec = r.kind === "rec"
    ? '<span class="yday-name">昨天看到的建議：' + escapeHtml(r.name) + "（約 " + r.kcal + " kcal）</span>" : "";
  return '<div class="yday-row">' + label + rec + '<div class="yday-actions">' + (r.kind === "rec" ? btn("eat-rec", "吃了", "primary-btn") : "") +
    sizes + none + unsure + "</div>" + hint + "</div>";
}

function paint() {
  const el = $("#today-yesterday");
  if (!el || !ctx) return;
  const gone = dismissed[ctx.yesterday] || {};
  const rows = ctx.rows.filter(function (r) { return !gone[r.slot]; });
  if (rows.length === 0 || closedFor === ctx.yesterday) { el.hidden = true; el.innerHTML = ""; shown = false; return; }
  el.hidden = false;
  el.innerHTML = '<details class="yday-card"' + (open ? " open" : "") + "><summary>昨天的餐（" + rows.length + " 餐）</summary>" +
    '<p class="yday-note">昨天這幾餐還沒有紀錄。想補就按一下，不確定可以略過。</p>' +
    rows.map(ydayRowHtml).join("") + '<button type="button" class="undo-btn" data-yday="close">先不用</button></details>';
  shown = true;
}

// 今日建議每次重畫呼叫。refresh：寫入後重新畫今日建議
export async function renderYesterday(today, profile, refresh) {
  const yesterday = dateAddDays(today, -1);
  let rows = [];
  let plans = {};
  let lastShown = null;
  try {
    const logs = await getDailyLogs({ start: yesterday, end: yesterday });
    plans = await loadDayPlans(yesterday, profile.oil_habit || "normal");
    lastShown = await getLastShownRecs();
    rows = yesterdayRows({ date: yesterday, enabledSlots: profile.enabled_slots, logs: logs, plans: plans, lastShown: lastShown });
  } catch (err) {
    console.error(err);
    rows = [];
  }
  if (rows.length === 0 && !shown) return;
  ctx = { today: today, yesterday: yesterday, rows: rows, plans: plans, lastShown: lastShown, oilHabit: profile.oil_habit || "normal", refresh: refresh };
  paint();
  listen();
}

// 切到未來日子時收起（只在有內容時才碰 DOM）
export function hideYesterday() {
  if (!shown) return;
  const el = $("#today-yesterday");
  if (el) { el.hidden = true; el.innerHTML = ""; }
  shown = false;
}

function shownSlot(slot) {
  const ls = ctx.lastShown;
  const s = ls && ls.date === ctx.yesterday ? ls.slots : ls && ls.prev && ls.prev.date === ctx.yesterday ? ls.prev.slots : {};
  return s[slot] || null;
}

async function act(kind, slot, btn) {
  if (!ctx) return;
  const date = ctx.yesterday;
  const opts = { today: ctx.today, minDate: dateAddDays(ctx.today, -BACKFILL_DAYS) };
  try {
    if (kind === "unsure") {
      (dismissed[date] || (dismissed[date] = {}))[slot] = true;
      paint();
      return;
    }
    if (kind === "close") { closedFor = date; paint(); return; }
    if (kind === "edit-plan") {
      const e = ctx.plans[slot];
      openMealPicker(slot, { mode: "backfill", date: date, planPreset: e && e.plan, onLogged: ctx.refresh });
      return;
    }
    btn.disabled = true;
    if (kind === "skipped") await addDailyLog(skippedLogEntry(date, slot, nowIso()), opts);
    else if (kind === "eat-plan") await logPlanEntry(ctx.plans[slot], date, ctx.oilHabit, ctx.today);
    else if (kind === "eat-rec") {
      const r = shownSlot(slot);
      if (!r) throw new Error("找不到昨天的推薦");
      await addDailyLog(buildLogEntry({ date: date, slot: slot, source: "rec_accepted", name: r.name, content: r.content, totals: r.totals, createdAt: nowIso() }), opts);
    } else if (kind.indexOf("est-") === 0) await addDailyLog(recallEstimateLogEntry(date, slot, kind.slice(4), nowIso()), opts);
    if (ctx.refresh) await ctx.refresh();
  } catch (err) {
    console.error(err);
    alert("記錄失敗，請重試。");
    btn.disabled = false;
  }
}

function listen() {
  if (listening) return;
  const el = $("#today-yesterday");
  if (!el) return;
  listening = true;
  el.addEventListener("click", function (e) {
    const b = e.target.closest("[data-yday]");
    if (b) act(b.getAttribute("data-yday"), b.getAttribute("data-slot"), b);
  });
  el.addEventListener("toggle", function (e) { if (e.target.classList && e.target.classList.contains("yday-card")) open = e.target.open; }, true);
}
