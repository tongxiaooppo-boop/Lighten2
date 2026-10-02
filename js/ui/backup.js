// 輕盈計畫 — 基本資料分頁的「資料備份」：完整備份匯出與還原（PRD 11.6、decisions #71、B-3 實作計畫）。
// - 還原＝取代這台裝置上的所有資料，不是合併也不是同步；驗證、清空、寫入都在 data/db.js。
// - 這裡不逐 key 處理 settings（章程 C4.15）；備份畫面只顯示筆數與日期，不顯示運動內容（章程 C4.12）。
// - 模組頂層不碰 document、FileReader、location（diff-recs 的假環境也會載入這個模組）。

import { exportAllData, importAllData, migrateBackup, validateBackup, summarizeBackup } from "../data/db.js";
import { calculateTargets } from "../engine/nutrition.js";
import { escapeHtml } from "../core/html.js";
import { shortDate, fmtDate } from "../core/dates.js";
import { todayStr, nowIso } from "./clock.js";

const APP_VERSION = new URL(import.meta.url).searchParams.get("v") || "";
const MAX_FILE_BYTES = 20 * 1024 * 1024;
const CHANNEL_NAME = "lighten2";
const PREVIEW_STORES = ["user_profile", "daily_log", "weight_log", "exercise_log", "custom_foods", "saved_meals", "custom_ingredients"];

let channel = null;
let pending = null; // 預覽中的備份（已升級、已驗證）
let exportedThisPreview = false;

function $(id) {
  return document.getElementById(id);
}

function setBackupStatus(text, isError) {
  const el = $("backup-status");
  if (!el) return;
  el.textContent = text;
  el.classList.toggle("is-error", !!isError);
}

// 匯出當下對「JSON 來回一次」的結果跑還原時同一套驗證（PRD 11.6：還原不了要在資料還在時就知道）
async function buildBackupFile() {
  const data = await exportAllData();
  const file = {
    format: data.format, schema_version: data.schema_version, exported_at: nowIso(), app_version: APP_VERSION,
    manifest: data.manifest, sections: data.sections,
  };
  const text = JSON.stringify(file, null, 2);
  const problems = validateBackup(migrateBackup(JSON.parse(text)));
  return { text: text, problems: problems, summary: summarizeBackup(file) };
}

function download(text, filename) {
  const blob = new Blob([text], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.hidden = true;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(function () { URL.revokeObjectURL(url); }, 60000);
}

function countsText(summary) {
  return ["daily_log", "weight_log", "custom_foods", "saved_meals", "custom_ingredients"].map(function (k) {
    return summary[k].label + " " + summary[k].count + " 筆";
  }).join("、");
}

async function onExport() {
  const btn = $("backup-export-btn");
  if (btn) btn.disabled = true;
  try {
    const built = await buildBackupFile();
    const filename = "lighten2-backup-" + todayStr() + ".json";
    download(built.text, filename);
    if (built.problems.length > 0) {
      setBackupStatus("已下載 " + filename + "，但這份備份目前無法還原：有 " + built.problems.length + " 個問題（" +
        built.problems.slice(0, 3).join("；") + "）。資料仍在這台裝置上，沒有任何損失。", true);
    } else {
      setBackupStatus("已下載 " + filename + "（" + countsText(built.summary) + "）。", false);
    }
    return built.problems.length === 0;
  } catch (err) {
    console.error(err);
    setBackupStatus("匯出失敗，請重試。", true);
    return false;
  } finally {
    if (btn) btn.disabled = false;
  }
}

function readFileText(file) {
  return new Promise(function (resolve, reject) {
    const r = new FileReader();
    r.onload = function () { resolve(String(r.result)); };
    r.onerror = function () { reject(r.error); };
    r.readAsText(file);
  });
}

// 日期「2026-09-29」或 ISO 時間（UTC，先換成本地日期）→「09/29」
function mmdd(s) {
  if (!s) return "";
  const str = String(s);
  return shortDate(str.length > 10 ? fmtDate(new Date(str)) : str);
}

function cellText(s) {
  if (s.label === "基本資料") return s.count ? "有" : "沒有";
  return s.count + " 筆" + (s.last_date ? "（最後 " + mmdd(s.last_date) + "）" : "");
}

function hasUserData(summary) {
  return PREVIEW_STORES.some(function (k) { return summary[k].count > 0; });
}

function renderProblems(problems) {
  const box = $("backup-preview");
  box.hidden = false;
  box.innerHTML = '<p class="backup-preview-title">這個檔案不能還原：</p><ul class="backup-problems">' +
    problems.slice(0, 5).map(function (p) { return "<li>" + escapeHtml(p) + "</li>"; }).join("") +
    (problems.length > 5 ? "<li>還有 " + (problems.length - 5) + " 個問題</li>" : "") + "</ul>" +
    '<button type="button" class="secondary-btn" data-backup-cancel>關閉</button>';
}

function renderPreview(data, fileSum, curSum) {
  const box = $("backup-preview");
  const rows = PREVIEW_STORES.map(function (k) {
    const f = fileSum[k];
    const c = curSum[k];
    const drop = f.count === 0 && c.count > 0 ? '<span class="backup-drop">還原後會變成 0 筆</span>' : "";
    return "<tr><th>" + escapeHtml(f.label) + "</th><td>" + escapeHtml(cellText(f)) + "</td><td>" + escapeHtml(cellText(c)) + drop + "</td></tr>";
  }).join("");
  const notes = [];
  const exportedAt = typeof data.exported_at === "string" ? data.exported_at : null;
  if (exportedAt) {
    const newer = ["daily_log", "custom_foods", "saved_meals", "custom_ingredients"].some(function (k) { return curSum[k].last_created_at && curSum[k].last_created_at > exportedAt; });
    if (newer) notes.push("目前有 " + mmdd(exportedAt) + " 匯出這份備份之後新增的紀錄，還原後不會保留。");
  }
  notes.push("還原會取代這台裝置上的所有資料，不是同步。其他開著這個 App 的分頁會自動重新整理。");
  const needGuard = hasUserData(curSum);
  box.hidden = false;
  box.innerHTML =
    '<p class="backup-preview-title">備份檔' + (exportedAt ? "（" + escapeHtml(mmdd(exportedAt)) + " 匯出）" : "") + "</p>" +
    '<table class="backup-table"><thead><tr><th></th><th>備份檔</th><th>目前</th></tr></thead><tbody>' + rows + "</tbody></table>" +
    notes.map(function (n) { return '<p class="backup-note">' + escapeHtml(n) + "</p>"; }).join("") +
    (needGuard
      ? '<div class="backup-guard"><button type="button" class="secondary-btn" data-backup-export-current>先匯出目前的資料</button>' +
        '<label class="backup-skip"><input type="checkbox" data-backup-skip> 目前的資料不需要保留</label></div>'
      : "") +
    '<div class="backup-actions"><button type="button" class="primary-btn" data-backup-restore' + (needGuard ? " disabled" : "") + ">還原</button>" +
    '<button type="button" class="secondary-btn" data-backup-cancel>取消</button></div>';
}

function updateRestoreEnabled() {
  const box = $("backup-preview");
  const btn = box && box.querySelector("[data-backup-restore]");
  if (!btn) return;
  const skip = box.querySelector("[data-backup-skip]");
  const guarded = !!box.querySelector("[data-backup-export-current]");
  btn.disabled = guarded && !exportedThisPreview && !(skip && skip.checked);
}

function closePreview() {
  pending = null;
  exportedThisPreview = false;
  const box = $("backup-preview");
  if (box) { box.hidden = true; box.innerHTML = ""; }
  const input = $("backup-file-input");
  if (input) input.value = "";
}

async function onFileChosen(input) {
  const file = input.files && input.files[0];
  if (!file) return;
  closePreview();
  setBackupStatus("", false);
  if (file.size > MAX_FILE_BYTES) { renderProblems(["檔案太大（超過 20 MB），不是這個 App 的備份"]); return; }
  let parsed;
  try {
    parsed = JSON.parse((await readFileText(file)).replace(/^﻿/, ""));
  } catch (err) {
    renderProblems(["無法讀取檔案內容，不是這個 App 的備份"]);
    return;
  }
  const data = migrateBackup(parsed);
  const problems = validateBackup(data);
  const profile = problems.length === 0 ? data.sections.system.user_profile : null;
  if (profile) {
    try { calculateTargets(profile); } catch (err) { problems.push("基本資料無法計算目標（" + String(err && err.message || err) + "）"); }
  }
  if (problems.length > 0) { renderProblems(problems); return; }
  let current;
  try {
    current = summarizeBackup(await exportAllData());
  } catch (err) {
    console.error(err);
    renderProblems(["讀取目前資料失敗，請重新整理頁面後再試"]);
    return;
  }
  pending = data;
  exportedThisPreview = false;
  renderPreview(data, summarizeBackup(data), current);
}

async function onRestore(btn) {
  if (!pending) return;
  btn.disabled = true;
  try {
    await importAllData(pending);
  } catch (err) {
    console.error(err);
    setBackupStatus("還原失敗，資料沒有變動：" + String(err && err.message || err).replace(/^\[db\.js\] /, ""), true);
    btn.disabled = false;
    return;
  }
  // transaction 完成後才通知其他分頁（BroadcastChannel 不會送回給發送的這個物件）
  try { if (channel) channel.postMessage({ type: "restored" }); } catch (e) { /* 通知失敗只影響其他分頁 */ }
  location.reload();
}

export function initBackup() {
  const section = $("backup-section");
  if (!section) return;

  if (typeof BroadcastChannel !== "undefined") {
    try {
      channel = new BroadcastChannel(CHANNEL_NAME);
      channel.onmessage = function (e) { if (e.data && e.data.type === "restored") location.reload(); };
    } catch (e) { channel = null; }
  }

  const exportBtn = $("backup-export-btn");
  if (exportBtn) exportBtn.addEventListener("click", onExport);
  const input = $("backup-file-input");
  if (input) input.addEventListener("change", function () { onFileChosen(input); });

  const box = $("backup-preview");
  if (box) {
    box.addEventListener("click", async function (e) {
      if (e.target.closest("[data-backup-cancel]")) { closePreview(); return; }
      const cur = e.target.closest("[data-backup-export-current]");
      if (cur) {
        cur.disabled = true;
        await onExport();
        exportedThisPreview = true; // 下載有沒有真的存下來 App 看不到；按過就算，覺得沒存到可以再按一次
        cur.disabled = false;
        cur.textContent = "已匯出目前的資料（可再按一次）";
        updateRestoreEnabled();
        return;
      }
      const restore = e.target.closest("[data-backup-restore]");
      if (restore && !restore.disabled) onRestore(restore);
    });
    box.addEventListener("change", function (e) {
      if (e.target.closest("[data-backup-skip]")) updateRestoreEnabled();
    });
  }
}
