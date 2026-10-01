// 輕盈計畫 — 主分頁「我的食物」（工作線 D 切片 2；PRD 13.2、13.3、13.5）：狀態、載入、子分頁、搜尋、事件。
// 這個檔案是分頁狀態唯一的擁有者；foods/*.js 只組 HTML、做寫入動作，狀態由參數傳入（計畫 S4）。
// 不吃只經 db.js 專用函式寫入（decisions #99）；還沒有基本資料時「不吃」停用（PRD 13.5）。

import { escapeHtml } from "../core/html.js";
import { getProfile, getCustomFoods, getHiddenCatalogUids, addDislikedIngredient, removeDislikedIngredient } from "../data/db.js";
import { loadCatalog, fromCustomFood } from "../data/catalog.js";
import { onCustomFoodFormClick, customFoodNotes } from "./custom-food-form.js";
import { foodsSubtabHtml, foodsSearchHtml, foodsSubtabsHtml, FOODS_SUBTABS, FOODS_SUBTAB_LABELS } from "./foods/list.js";
import { foodsWhereOf, dislikedMessage } from "../engine/foods.js";
import {
  FOODS_FORM_ID, customFoodEditing, syncCustomFoodForm, saveCustomFoodForm, setCustomFoodArchived, unhideBuiltin,
} from "./foods/custom-foods.js";
import { refreshSavedMeals, savedSearchHtml, revealSavedMeal, initSavedMeals } from "./foods/saved-meals.js";

// openSections：可收合的組哪些展開（key 見 rows.js detailsGroup；切子分頁、搜尋後保留，審核 M3）。
// acted：剛在哪一列標了不吃或取消（明細顯示「也標不吃」「也取消」，decisions #115）；scrollTo：重畫後捲到哪一列
const foodsState = {
  loaded: false, profile: null, catalog: null, records: [], hidden: [],
  subtab: "convenience", query: "", openUid: null, editing: null, message: "",
  openSections: {}, acted: null, scrollTo: null,
};

function foodsEl(id) {
  return document.getElementById(id);
}

async function loadFoods() {
  const s = foodsState;
  const r = await Promise.all([getProfile(), loadCatalog(), getCustomFoods()]);
  s.profile = r[0] || null;
  s.catalog = r[1];
  s.records = r[2];
  // 隱藏清單讀不到不擋這個分頁（隱藏不是安全規則）
  try { s.hidden = await getHiddenCatalogUids(); } catch (err) { console.error(err); s.hidden = []; }
  s.loaded = true;
}

function renderFoods() {
  const s = foodsState;
  if (!s.loaded) return;
  syncCustomFoodForm(s, foodsEl(FOODS_FORM_ID));
  const more = document.querySelector("#" + FOODS_FORM_ID + " .quick-add-more");
  const moreOpen = !!(more && more.open);
  const tabs = foodsEl("foods-subtabs");
  if (tabs) tabs.innerHTML = foodsSubtabsHtml(s);
  const status = foodsEl("foods-status");
  if (status) status.textContent = s.message;
  const body = foodsEl("foods-body");
  // 搜尋也搜我的組合（PRD 13.2），結果放在最上面
  const savedHits = s.query.trim() ? savedSearchHtml(s.query) : "";
  if (body) body.innerHTML = s.query.trim() ? savedHits + foodsSearchHtml(s, !!savedHits) : foodsSubtabHtml(s);
  // 重畫表單時保留「更多（選填）」展開的狀態
  const after = document.querySelector("#" + FOODS_FORM_ID + " .quick-add-more");
  if (after && moreOpen) after.open = true;
  // 標不吃後那一列移到「你標了不吃」並保持展開：捲到它，提示與「也標不吃」才看得到（decisions #115）
  if (s.scrollTo && body) {
    const row = [...body.querySelectorAll("[data-foods-open]")].find(function (b) { return b.getAttribute("data-foods-open") === s.scrollTo; });
    const target = row && (row.closest(".food-row").querySelector(".foods-same-sample") || row.closest(".food-row"));
    if (target && target.scrollIntoView) target.scrollIntoView({ block: "center" });
  }
  s.scrollTo = null;
}

// 品項：現成品項或代換表分層品項（不吃只對這兩種）
function itemOf(s, uid) {
  return s.catalog.productsByUid[uid] || s.catalog.foodTree.byId[uid] || null;
}

export async function refreshFoods() {
  try { await loadFoods(); renderFoods(); } catch (err) { console.error("載入我的食物失敗", err); }
  await refreshSavedMeals();
}

// also：明細裡的「也標不吃」「也取消」——不改點開的列、不捲動（decisions #115）
async function setDisliked(uid, on, also) {
  const s = foodsState;
  if (!s.profile) { s.message = "先在基本資料填好身體數據並按計算，才能標「不吃」。"; return; }
  const item = itemOf(s, uid);
  const label = item ? item.name : uid;
  // 分層品項寫 food_tree（比對只看 key，decisions #115）
  const type = s.catalog.foodTree.byId[uid] && !s.catalog.productsByUid[uid] ? "food_tree" : "item";
  let list;
  try {
    list = on ? await addDislikedIngredient({ type: type, key: uid, label: label }) : await removeDislikedIngredient(uid);
  } catch (err) {
    console.error(err);
    s.message = "存檔失敗，請重試。";
    return;
  }
  s.profile = Object.assign({}, s.profile, { disliked_ingredients: list });
  s.message = dislikedMessage(item || { name: label }, on);
  if (!also) {
    s.openUid = uid;
    s.acted = { uid: uid };
    s.scrollTo = uid;
  }
}

// 存檔後：角色不屬於目前子分頁的（例：飲品・水果裡新增後改成主餐），說明存到哪裡（計畫 S14）
function savedMessage(s, mode, saved) {
  const head = { add: "已新增「", edit: "已更新「", fill: "已更新「", copy: "已複製成我的版本「" }[mode] + saved.name + "」。";
  const sub = foodsWhereOf(fromCustomFood(saved));
  const where = sub !== s.subtab ? "它在「" + FOODS_SUBTAB_LABELS[sub] + "」的我的品項。" : "";
  return head + where + (mode === "copy" ? "原本的內建品項已隱藏，可以在「已隱藏」取消。" : "");
}

async function onSave() {
  const s = foodsState;
  const mode = s.editing.mode;
  const saved = await saveCustomFoodForm(s);
  if (!saved) return;
  s.editing = null;
  s.message = savedMessage(s, mode, saved);
  s.openUid = saved.id;
  if (FOODS_SUBTABS.indexOf(foodsWhereOf(fromCustomFood(saved))) !== -1 && !s.query.trim()) s.subtab = foodsWhereOf(fromCustomFood(saved));
  await loadFoods();
}

function onFoodsClick(e) {
  const s = foodsState;
  const at = function (sel) { return e.target.closest(sel); };
  const done = function () { renderFoods(); };
  let el;
  if ((el = at("[data-saved-goto]"))) {
    revealSavedMeal(el.getAttribute("data-saved-goto"));
  } else if ((el = at("[data-foods-subtab]"))) {
    s.subtab = el.getAttribute("data-foods-subtab");
    s.query = "";
    const input = foodsEl("foods-search");
    if (input) input.value = "";
    s.openUid = null; s.editing = null; s.message = ""; s.acted = null;
    renderFoods();
  } else if ((el = at("[data-foods-open]"))) {
    const uid = el.getAttribute("data-foods-open");
    s.openUid = s.openUid === uid ? null : uid;
    if (s.editing && s.editing.mode !== "add") s.editing = null;
    s.message = ""; s.acted = null;
    renderFoods();
  } else if ((el = at("[data-foods-also-dislike]"))) {
    setDisliked(el.getAttribute("data-foods-also-dislike"), true, true).then(done);
  } else if ((el = at("[data-foods-also-undislike]"))) {
    setDisliked(el.getAttribute("data-foods-also-undislike"), false, true).then(done);
  } else if ((el = at("[data-foods-dislike]"))) {
    setDisliked(el.getAttribute("data-foods-dislike"), true).then(done);
  } else if ((el = at("[data-foods-undislike]"))) {
    // 全部清單裡的取消不捲走（那一列不在畫面上）
    setDisliked(el.getAttribute("data-foods-undislike"), false, !!el.closest(".foods-disliked-all")).then(done);
  } else if ((el = at("[data-foods-copy]"))) {
    s.editing = customFoodEditing(s, "copy", el.getAttribute("data-foods-copy"));
    s.message = "";
    renderFoods();
  } else if (at("[data-foods-add]")) {
    s.editing = customFoodEditing(s, "add", null);
    s.message = "";
    renderFoods();
  } else if ((el = at("[data-cf-edit]")) || (el = at("[data-cf-fill]"))) {
    const fill = el.hasAttribute("data-cf-fill");
    s.editing = customFoodEditing(s, fill ? "fill" : "edit", el.getAttribute(fill ? "data-cf-fill" : "data-cf-edit"));
    s.message = "";
    renderFoods();
  } else if ((el = at("[data-cf-archive]")) || (el = at("[data-cf-restore]"))) {
    const archive = el.hasAttribute("data-cf-archive");
    setCustomFoodArchived(s, el.getAttribute(archive ? "data-cf-archive" : "data-cf-restore"), archive)
      .then(function (msg) { s.message = msg; return loadFoods(); }).then(done);
  } else if ((el = at("[data-cf-unhide]"))) {
    unhideBuiltin(s, el.getAttribute("data-cf-unhide")).then(function (msg) { s.message = msg; return loadFoods(); }).then(done);
  } else if (s.editing && at("#" + FOODS_FORM_ID)) {
    if (at("[data-cf-cancel]")) { s.editing = null; renderFoods(); return; }
    syncCustomFoodForm(s, foodsEl(FOODS_FORM_ID));
    if (at("[data-cf-save]")) { onSave().then(done); return; }
    if (onCustomFoodFormClick(e.target, s.editing.values)) { s.editing.error = null; renderFoods(); }
  }
}

function onFoodsInput(e) {
  const s = foodsState;
  if (e.target.id === "foods-search") {
    s.query = e.target.value;
    s.message = ""; s.acted = null;
    s.openUid = null;
    if (s.editing && s.editing.mode !== "add") s.editing = null;
    renderFoods();
    return;
  }
  if (s.editing && e.target.closest("#" + FOODS_FORM_ID)) {
    syncCustomFoodForm(s, foodsEl(FOODS_FORM_ID));
    const el = document.querySelector("#" + FOODS_FORM_ID + " [data-cf-notes]");
    if (el) el.innerHTML = customFoodNotes(s.editing.values, s.profile || {}).map(function (t) { return "<p>" + escapeHtml(t) + "</p>"; }).join("");
  }
}

export function initFoodsTab() {
  const panel = foodsEl("tab-foods");
  if (!panel) return;
  panel.addEventListener("click", onFoodsClick);
  initSavedMeals();
  panel.addEventListener("input", onFoodsInput);
  // 可收合的組：記住展開狀態，重畫時照舊（toggle 不冒泡，用捕獲階段；審核 M3）
  panel.addEventListener("toggle", function (e) {
    const key = e.target && e.target.getAttribute && e.target.getAttribute("data-foods-section");
    if (!key) return;
    foodsState.openSections[key] = e.target.open;
    // 分層的大類、子類收合時沒有內容（量大，不預先畫）：打開時重畫一次補上
    if (e.target.open && e.target.hasAttribute("data-foods-lazy") && e.target.children.length <= 1) renderFoods();
  }, true);
  // 切到本分頁時重讀：選擇器、今日建議、基本資料都可能改了不吃清單、我的品項、隱藏清單、過敏原設定
  document.addEventListener("tab:activated", function (e) { if (e.detail === "foods") refreshFoods(); });
  refreshFoods();
}

