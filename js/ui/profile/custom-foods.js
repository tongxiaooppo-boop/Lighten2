// 輕盈計畫 — 基本資料分頁的「我的品項」區塊（B-1a；PRD 10.4、10.6、decisions #61、#73）。
// 清單（搜尋、新到舊）、新增、編輯、補填、封存／還原、已隱藏的內建品項（取消隱藏）。之後 B-1b 擴大成「食物資料」查詢。
// 被擋的原因跟選擇器同一套（engine/filters.js）；「補填」只給未確認類（engine/picker.js fillableReason，章程 C4.1）。
// 模組頂層不碰 document（diff-recs 的假環境會連 tab-profile 一起載入）。

import { escapeHtml } from "../../core/html.js";
import { ROLE_LABELS } from "../../core/config.js";
import { getProfile, getCustomFoods, addCustomFood, updateCustomFood, getHiddenCatalogUids, unhideCatalogItem } from "../../data/db.js";
import { loadCatalog, fromCustomFood } from "../../data/catalog.js";
import { passesHardFilters } from "../../engine/filters.js";
import { fillableReason, hiddenEntries } from "../../engine/picker.js";
import { builtinCurrentValues } from "../../engine/meal-content.js";
import {
  CHANNEL_LABELS, valuesFromRecord, emptyCustomFoodValues, recordFromValues, customFoodNotes, customFoodFormHtml, readCustomFoodInputs, onCustomFoodFormClick,
} from "../custom-food-form.js";

const FORM_ID = "profile-custom-food-form";
const VALUE_LABELS = [["kcal", "熱量", " kcal"], ["protein_g", "蛋白質", "g"], ["carb_g", "碳水", "g"], ["fat_g", "脂肪", "g"], ["fiber_g", "纖維", "g"], ["sat_fat_g", "飽和脂肪", "g"], ["sodium_mg", "鈉", " mg"]];

const state = { records: [], profile: null, catalog: null, hidden: [], search: "", editing: null, message: "" };

function $(id) {
  return document.getElementById(id);
}

async function load() {
  const r = await Promise.all([getCustomFoods(), getProfile(), loadCatalog()]);
  state.records = r[0];
  state.profile = r[1] || {};
  state.catalog = r[2];
  // 隱藏清單讀不到不擋這個區塊（隱藏不是安全規則）
  try { state.hidden = await getHiddenCatalogUids(); } catch (err) { console.error(err); state.hidden = []; }
}

function blockedReason(rec) {
  if (rec.archived === true) return null;
  const res = passesHardFilters(fromCustomFood(rec), state.profile);
  return res.ok ? null : res.reason;
}

function metaText(rec) {
  const energy = "約 " + rec.kcal + " kcal";
  return (CHANNEL_LABELS[rec.channel] || rec.channel) + " · " + (ROLE_LABELS[rec.role] || rec.role) + " · " + energy;
}

// 複製來的品項：唯讀並列「內建目前的數值」（decisions #61）；內建已查不到時說明（章程 B9）
function compareHtml(rec) {
  if (!rec || !rec.copied_from) return "";
  const cur = builtinCurrentValues(rec.copied_from, state.catalog.productsByUid);
  if (!cur) return '<div class="builtin-compare"><p>內建已不提供這個品項。</p></div>';
  const cells = VALUE_LABELS.map(function (v) {
    return "<li>" + v[1] + "：" + (cur[v[0]] == null ? "無資料" : escapeHtml(String(cur[v[0]])) + v[2]) + "</li>";
  }).join("");
  return '<div class="builtin-compare"><p>內建目前的數值（' + escapeHtml(cur.name) + "）：</p><ul>" + cells +
    "<li>過敏原：" + escapeHtml(cur.allergen_tags.join("、") || "確認不含") + "</li></ul></div>";
}

function formHtml() {
  const e = state.editing;
  const rec = e.id ? state.records.find(function (r) { return r.id === e.id; }) : null;
  const notes = (e.error ? [e.error] : []).concat(customFoodNotes(e.values, state.profile));
  return customFoodFormHtml(e.values, {
    formId: FORM_ID, title: e.id ? (e.fill ? "補填我的品項" : "編輯我的品項") : "新增我的品項", saveLabel: "存檔",
    profile: state.profile, notes: notes, extraHtml: compareHtml(rec),
  });
}

function rowHtml(rec) {
  const reason = blockedReason(rec);
  const status = [];
  if (rec.copied_from) status.push("從內建複製");
  if (reason) status.push("以你目前的設定不能選：" + reason);
  if (rec.archived === true) status.push("已封存");
  let buttons = '<button type="button" class="secondary-btn" data-cf-edit="' + escapeHtml(rec.id) + '">編輯</button>';
  if (reason && fillableReason(reason)) buttons += '<button type="button" class="secondary-btn" data-cf-fill="' + escapeHtml(rec.id) + '">補填</button>';
  buttons += rec.archived === true
    ? '<button type="button" class="secondary-btn" data-cf-restore="' + escapeHtml(rec.id) + '">還原</button>'
    : '<button type="button" class="secondary-btn" data-cf-archive="' + escapeHtml(rec.id) + '">封存</button>';
  const editingHere = state.editing && state.editing.id === rec.id;
  return '<div class="custom-food-row" data-row-id="' + escapeHtml(rec.id) + '"><div class="custom-food-name">' + escapeHtml(rec.name) + "</div>" +
    '<div class="custom-food-meta">' + escapeHtml(metaText(rec)) + "</div>" +
    status.map(function (s) { return '<div class="custom-food-status">' + escapeHtml(s) + "</div>"; }).join("") +
    '<div class="backup-actions">' + buttons + "</div>" + (editingHere ? formHtml() : "") + "</div>";
}

function render() {
  const list = $("custom-foods-list");
  if (!list) return;
  syncForm();
  const q = state.search.trim();
  const rows = state.records.slice()
    .sort(function (a, b) { return String(b.created_at || "") < String(a.created_at || "") ? -1 : String(b.created_at || "") > String(a.created_at || "") ? 1 : 0; })
    .filter(function (r) { return q === "" || String(r.name).indexOf(q) !== -1; });
  const active = rows.filter(function (r) { return r.archived !== true; });
  const archived = rows.filter(function (r) { return r.archived === true; });
  let html = active.length ? active.map(rowHtml).join("") : '<p class="backup-note">' + (q ? "沒有符合的我的品項。" : "還沒有我的品項。可以在「自己選」裡快速新增，或按上面的「＋新增我的品項」。") + "</p>";
  if (archived.length) html += '<details class="custom-foods-archived"' + (state.editing && archived.some(function (r) { return r.id === state.editing.id; }) ? " open" : "") +
    "><summary>已封存（" + archived.length + "）</summary>" + archived.map(rowHtml).join("") + "</details>";
  list.innerHTML = html;
  const slot = $("custom-foods-form-slot");
  if (slot) slot.innerHTML = state.editing && !state.editing.id ? formHtml() : "";
  const hid = $("custom-foods-hidden");
  if (hid) {
    const entries = hiddenEntries(state.hidden, state.catalog.productsByUid);
    hid.innerHTML = entries.length === 0 ? "" : '<details class="custom-foods-hidden"><summary>已隱藏的內建品項（' + entries.length + "）</summary>" +
      entries.map(function (e) {
        return '<div class="custom-food-row"><div class="custom-food-name">' + escapeHtml(e.name) + "</div>" +
          '<div class="backup-actions"><button type="button" class="secondary-btn" data-cf-unhide="' + escapeHtml(e.uid) + '">取消隱藏</button></div></div>';
      }).join("") + "</details>";
  }
  const status = $("custom-foods-status");
  if (status) status.textContent = state.message;
}

function syncForm() {
  if (state.editing) readCustomFoodInputs(document.getElementById(FORM_ID), state.editing.values);
}

async function save() {
  const e = state.editing;
  syncForm();
  const r = recordFromValues(e.values);
  if (r.errors.length > 0) { e.error = r.errors.join("；"); return; }
  try {
    const saved = e.id ? await updateCustomFood(e.id, r.record) : await addCustomFood(r.record);
    state.message = (e.id ? "已更新「" : "已新增「") + saved.name + "」。";
  } catch (err) {
    console.error(err);
    e.error = "存檔失敗，請重試。";
    return;
  }
  state.editing = null;
  await load();
}

async function setArchived(id, archived) {
  let saved;
  try { saved = await updateCustomFood(id, { archived: archived }); } catch (err) { console.error(err); state.message = "存檔失敗，請重試。"; return; }
  state.message = (archived ? "已封存「" : "已還原「") + saved.name + "」。";
  // 封存複製品時，原本的內建品項仍是隱藏的（兩筆都看不到），中性提示（B-1a 計畫 S11）
  if (archived && saved.copied_from && state.hidden.indexOf(saved.copied_from) !== -1) {
    const p = state.catalog.productsByUid[saved.copied_from];
    if (p) state.message += "原本的內建品項「" + p.name + "」仍是隱藏的，可以在下方取消隱藏。";
  }
  await load();
}

async function unhide(uid) {
  try { await unhideCatalogItem(uid); } catch (err) { console.error(err); state.message = "取消隱藏失敗，請重試。"; return; }
  const p = state.catalog.productsByUid[uid];
  state.message = "已取消隱藏「" + (p ? p.name : uid) + "」。";
  const copy = state.records.find(function (r) { return r.copied_from === uid && r.archived !== true; });
  if (copy) state.message += "你有一筆從它複製的我的品項「" + copy.name + "」。";
  await load();
}

function onClick(e) {
  const at = function (sel) { return e.target.closest(sel); };
  let el;
  const recOf = function (id) { return state.records.find(function (r) { return r.id === id; }); };
  const done = function () { render(); };
  if (at("#custom-foods-add")) {
    state.editing = { id: null, fill: false, values: emptyCustomFoodValues("convenience"), error: null };
    state.message = "";
    render();
  } else if ((el = at("[data-cf-edit]")) || (el = at("[data-cf-fill]"))) {
    const id = el.getAttribute("data-cf-edit") || el.getAttribute("data-cf-fill");
    const rec = recOf(id);
    if (rec) state.editing = { id: id, fill: el.hasAttribute("data-cf-fill"), values: valuesFromRecord(rec), error: null };
    state.message = "";
    render();
  } else if ((el = at("[data-cf-archive]"))) {
    setArchived(el.getAttribute("data-cf-archive"), true).then(done);
  } else if ((el = at("[data-cf-restore]"))) {
    setArchived(el.getAttribute("data-cf-restore"), false).then(done);
  } else if ((el = at("[data-cf-unhide]"))) {
    unhide(el.getAttribute("data-cf-unhide")).then(done);
  } else if (state.editing && at("#" + FORM_ID)) {
    if (at("[data-cf-cancel]")) { state.editing = null; render(); }
    else if (at("[data-cf-save]")) save().then(done);
    else {
      syncForm();
      if (onCustomFoodFormClick(e.target, state.editing.values)) { state.editing.error = null; keepMoreOpen(render); }
    }
  }
}

// 重畫表單時保留「更多（選填）」展開的狀態
function keepMoreOpen(fn) {
  const more = document.querySelector("#" + FORM_ID + " .quick-add-more");
  const open = !!(more && more.open);
  fn();
  const after = document.querySelector("#" + FORM_ID + " .quick-add-more");
  if (after && open) after.open = true;
}

export async function refreshCustomFoods() {
  try { await load(); render(); } catch (err) { console.error("載入我的品項失敗", err); }
}

export function initCustomFoods() {
  const section = $("custom-foods-section");
  if (!section) return;
  section.addEventListener("click", onClick);
  section.addEventListener("input", function (e) {
    if (e.target.id === "custom-foods-search") { state.search = e.target.value; render(); return; }
    if (state.editing && e.target.closest("#" + FORM_ID)) {
      syncForm();
      const el = document.querySelector("#" + FORM_ID + " [data-cf-notes]");
      if (el) el.innerHTML = customFoodNotes(state.editing.values, state.profile).map(function (t) { return "<p>" + escapeHtml(t) + "</p>"; }).join("");
    }
  });
  // 切回基本資料時重讀（選擇器裡剛新增、複製、補填的，以及剛改的過敏原設定）
  document.addEventListener("tab:activated", function (e) { if (e.detail === "profile") refreshCustomFoods(); });
  refreshCustomFoods();
}
