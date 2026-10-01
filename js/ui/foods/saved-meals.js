// 輕盈計畫 — 「我的食物」最上方的「我的組合」管理區塊（工作線 C；PRD 11.5、12.6、13.2；decisions #124）。
// 列表、改名、編輯內容（同一個選擇器的編輯模式）、刪除（封存，有復原）、還原；頂端搜尋也搜組合名稱。
// 這個檔案自己擁有區塊的狀態，畫在 #foods-saved；讀取組合只准這裡與選擇器、備份（章程 C4.16）。

import { escapeHtml } from "../../core/html.js";
import { getProfile, getCustomFoods, getHiddenCatalogUids, listSavedMeals, updateSavedMeal } from "../../data/db.js";
import { loadCatalog, fromCustomFood } from "../../data/catalog.js";
import { resolveSavedMeal, savedMealTotals, savedMealDefaultName, savedMealUnavailableLine } from "../../engine/meal-content.js";
import { openMealPicker } from "../meal-picker/index.js";
import { SAVED_TYPE_LABELS } from "../meal-picker/saved-row.js";

// open：區塊與「已刪除」是否展開；renaming：{ id, name }；undo：剛刪除的 { id, name }（顯示「復原」）
const savedState = { loaded: false, records: [], rows: {}, open: false, archivedOpen: false, renaming: null, undo: null, message: "" };

function savedEl() {
  return document.getElementById("foods-saved");
}

export async function refreshSavedMeals() {
  const s = savedState;
  try {
    const r = await Promise.all([listSavedMeals(), loadCatalog(), getCustomFoods(), getProfile()]);
    let hidden = [];
    try { hidden = await getHiddenCatalogUids(); } catch (err) { console.error(err); }
    const catalog = r[1];
    const ctx = { hidden: hidden, customs: r[2].map(fromCustomFood), slot: null, profile: r[3] || {} };
    const oilHabit = (r[3] || {}).oil_habit;
    s.records = r[0];
    s.rows = {};
    s.records.forEach(function (rec) {
      const res = resolveSavedMeal(rec, catalog, ctx);
      s.rows[rec.id] = {
        contentText: savedMealDefaultName(rec.content, catalog, ctx),
        kcal: savedMealTotals(res, catalog, oilHabit).kcal,
        unavailable: [savedMealUnavailableLine(res)].concat(res.notes).filter(Boolean).join("；") || null,
      };
    });
    s.loaded = true;
  } catch (err) {
    console.error("載入我的組合失敗", err);
  }
  renderSavedMeals();
}

function rowHtml(rec, archived) {
  const s = savedState;
  const row = s.rows[rec.id] || {};
  const id = escapeHtml(rec.id);
  let html = '<div class="saved-item" id="saved-item-' + id + '"><div class="saved-item-name">' + escapeHtml(rec.name) + "</div>" +
    '<div class="food-meta">' + escapeHtml((SAVED_TYPE_LABELS[rec.content.meal_type] || "") + " · 約 " + Math.round(row.kcal || 0) + " kcal") + "</div>" +
    (row.contentText && row.contentText !== rec.name ? '<div class="food-meta">' + escapeHtml(row.contentText) + "</div>" : "") +
    (row.unavailable ? '<div class="food-status">' + escapeHtml(row.unavailable) + "</div>" : "");
  if (archived) return html + '<div class="selected-actions"><button type="button" class="link-btn" data-saved-restore="' + id + '">還原</button></div></div>';
  if (s.renaming && s.renaming.id === rec.id) {
    return html + '<div class="saved-rename"><input type="text" class="foods-search" id="saved-rename-input" maxlength="40" value="' + escapeHtml(s.renaming.name) + '">' +
      '<button type="button" class="secondary-btn" data-saved-rename-save="' + id + '">存</button>' +
      '<button type="button" class="secondary-btn" data-saved-rename-cancel>取消</button></div></div>';
  }
  return html + '<div class="selected-actions"><button type="button" class="link-btn" data-saved-rename="' + id + '">改名</button>' +
    '<button type="button" class="link-btn" data-saved-edit="' + id + '">編輯內容</button>' +
    '<button type="button" class="link-btn" data-saved-archive="' + id + '">刪除</button></div></div>';
}

export function renderSavedMeals() {
  const el = savedEl();
  const s = savedState;
  if (!el || !s.loaded) return;
  const active = s.records.filter(function (r) { return !r.archived; });
  const archived = s.records.filter(function (r) { return r.archived; });
  let inner = s.message ? '<p class="meal-picker-note">' + escapeHtml(s.message) + "</p>" : "";
  if (s.undo) {
    inner += '<div class="meal-picker-note dislike-notice"><p>已刪除「' + escapeHtml(s.undo.name) + "」。</p>" +
      '<button type="button" class="secondary-btn" data-saved-restore="' + escapeHtml(s.undo.id) + '">復原</button></div>';
  }
  if (active.length === 0) {
    inner += '<p class="meal-picker-note">還沒有組合。在「自己選」記下一餐時勾「存成組合」，或在今日建議已記錄的一餐按「存成組合」。</p>';
  }
  inner += active.map(function (r) { return rowHtml(r, false); }).join("");
  if (archived.length > 0) {
    inner += '<details class="foods-group foods-folded" data-saved-section="archived"' + (s.archivedOpen ? " open" : "") + "><summary>已刪除（" + archived.length + "）</summary>" +
      archived.map(function (r) { return rowHtml(r, true); }).join("") + "</details>";
  }
  el.innerHTML = '<details class="foods-group foods-folded saved-block" data-saved-section="main"' + (s.open ? " open" : "") + ">" +
    "<summary>我的組合（" + active.length + "）</summary>" + inner + "</details>";
}

// 頂端搜尋（PRD 13.2）：組合名稱，標「我的組合」，點了展開管理區塊並捲到那一筆
export function savedSearchHtml(query) {
  const q = String(query || "").trim().toLowerCase();
  if (!q || !savedState.loaded) return "";
  const hits = savedState.records.filter(function (r) { return !r.archived && r.name.toLowerCase().indexOf(q) !== -1; });
  if (hits.length === 0) return "";
  return '<section class="foods-group">' + hits.map(function (r) {
    return '<div class="food-row"><button type="button" class="food-row-main" data-saved-goto="' + escapeHtml(r.id) + '">' +
      '<span class="food-name">' + escapeHtml(r.name) + '</span><span class="food-meta">我的組合 · ' + escapeHtml(SAVED_TYPE_LABELS[r.content.meal_type] || "") + "</span></button></div>";
  }).join("") + "</section>";
}

export function revealSavedMeal(id) {
  savedState.open = true;
  renderSavedMeals();
  const row = document.getElementById("saved-item-" + id);
  if (row && row.scrollIntoView) row.scrollIntoView({ block: "center" });
}

async function setArchived(id, archived) {
  const s = savedState;
  const rec = s.records.filter(function (r) { return r.id === id; })[0];
  try {
    await updateSavedMeal(id, { archived: archived });
  } catch (err) {
    console.error(err);
    s.message = "存檔失敗，請重試。";
    renderSavedMeals();
    return;
  }
  s.undo = archived && rec ? { id: id, name: rec.name } : null;
  s.message = archived ? "" : rec ? "已還原「" + rec.name + "」。" : "";
  await refreshSavedMeals();
}

async function saveRename(id) {
  const s = savedState;
  const name = (s.renaming && s.renaming.name || "").trim();
  if (!name) { s.message = "請填組合名稱。"; renderSavedMeals(); return; }
  try {
    await updateSavedMeal(id, { name: name });
  } catch (err) {
    console.error(err);
    s.message = "存檔失敗，請重試。";
    renderSavedMeals();
    return;
  }
  s.renaming = null;
  s.message = "已改名為「" + name + "」。";
  await refreshSavedMeals();
}

function onSavedClick(e) {
  const s = savedState;
  const at = function (sel) { return e.target.closest(sel); };
  let el;
  if ((el = at("[data-saved-rename]"))) {
    const rec = s.records.filter(function (r) { return r.id === el.getAttribute("data-saved-rename"); })[0];
    if (rec) { s.renaming = { id: rec.id, name: rec.name }; s.message = ""; s.undo = null; renderSavedMeals(); }
  } else if ((el = at("[data-saved-rename-save]"))) {
    saveRename(el.getAttribute("data-saved-rename-save"));
  } else if (at("[data-saved-rename-cancel]")) {
    s.renaming = null; renderSavedMeals();
  } else if ((el = at("[data-saved-archive]"))) {
    setArchived(el.getAttribute("data-saved-archive"), true); // 刪除＝封存，不跳確認，有「復原」（PRD 11.5）
  } else if ((el = at("[data-saved-restore]"))) {
    setArchived(el.getAttribute("data-saved-restore"), false);
  } else if ((el = at("[data-saved-edit]"))) {
    const rec = s.records.filter(function (r) { return r.id === el.getAttribute("data-saved-edit"); })[0];
    if (!rec) return;
    s.message = ""; s.undo = null;
    openMealPicker(null, {
      savedEdit: rec,
      onSaved: function () { s.message = "已存回「" + rec.name + "」。"; return refreshSavedMeals(); },
    });
  }
}

export function initSavedMeals() {
  const el = savedEl();
  if (!el) return;
  el.addEventListener("click", onSavedClick);
  el.addEventListener("input", function (e) {
    if (e.target.id === "saved-rename-input" && savedState.renaming) savedState.renaming.name = e.target.value;
  });
  // 收合狀態：toggle 不冒泡，用捕獲階段（比照 tab-foods.js）
  el.addEventListener("toggle", function (e) {
    const key = e.target && e.target.getAttribute && e.target.getAttribute("data-saved-section");
    if (key === "main") savedState.open = e.target.open;
    else if (key === "archived") savedState.archivedOpen = e.target.open;
  }, true);
}
