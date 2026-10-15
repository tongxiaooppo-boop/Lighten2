// 輕盈計畫 (Lighten Plan) — 分頁六：食譜（家常菜作法、減重推薦套組）
// 唯讀參考頁：資料來自 data/recipes_guide.json（tools/build-recipes-guide.js 產生），不影響記錄與建議。

import { escapeHtml } from "../core/html.js";
import { $ } from "./dom.js";

const ENTRY_LABELS = { plate: "早餐盤", bowl: "早餐碗", box: "餐盒" };
const SECTIONS = [["dish", "家常菜"], ["plate", "早餐盤"], ["bowl", "早餐碗"], ["box", "餐盒"]];

let guide = null;
let loading = false;
let section = "dish";
let query = "";
let roleFilter = "";

async function load() {
  if (guide || loading) return;
  loading = true;
  setRecipesStatus("載入中…");
  try {
    const res = await fetch("data/recipes_guide.json");
    if (!res.ok) throw new Error("HTTP " + res.status);
    guide = await res.json();
    setRecipesStatus("");
  } catch (e) {
    setRecipesStatus("食譜載入失敗，請稍後再試。");
  }
  loading = false;
  render();
}

function setRecipesStatus(t) {
  const el = $("#recipes-status");
  if (el) el.textContent = t;
}

function nutLine(n) {
  return "約 " + Math.round(n.kcal) + " kcal・蛋白質 " + Math.round(n.protein_g) + " g・碳水 " + Math.round(n.carb_g) +
    " g・脂肪 " + Math.round(n.fat_g) + " g" + (n.fiber_g != null ? "・纖維 " + Math.round(n.fiber_g) + " g" : "");
}

function ingList(items) {
  return '<ul class="recipe-ing">' + items.map((i) => "<li>" + escapeHtml(i[0]) + " " + escapeHtml(String(i[1])) + (i[2] || "g") + "</li>").join("") + "</ul>";
}

function stepsList(steps) {
  return '<ol class="recipe-steps">' + steps.map((s) => "<li>" + escapeHtml(s) + "</li>").join("") + "</ol>";
}

function dishCard(d) {
  return '<details class="recipe-card"><summary><strong>' + escapeHtml(d.name) + "</strong>" +
    '<span class="recipe-meta">' + escapeHtml(d.role + "・" + d.method + "・" + d.mins + " 分・" + d.serv + " 份") + "</span></summary>" +
    '<p class="recipe-nut">每份' + escapeHtml(nutLine(d.per_serving)) + "</p>" +
    "<h4>食材（可食生重，總量 " + d.serv + " 份）</h4>" + ingList(d.ing) +
    (d.oil_g ? '<p class="recipe-note">另加下鍋油約 ' + d.oil_g + " g</p>" : "") +
    (d.buy ? '<p class="recipe-note">採買：' + escapeHtml(d.buy) + "</p>" : "") +
    "<h4>作法</h4>" + stepsList(d.steps) +
    (d.tip ? '<p class="recipe-tip">小撇步：' + escapeHtml(d.tip) + "</p>" : "") + "</details>";
}

function setCard(s) {
  return '<details class="recipe-card"><summary><strong>' + escapeHtml(s.name) + "</strong>" +
    '<span class="recipe-meta">' + escapeHtml(s.type + "・" + s.prep_min + " 分・" + Math.round(s.nutrition.kcal) + " kcal") + "</span></summary>" +
    '<p class="recipe-why">' + escapeHtml(s.why) + "</p>" +
    '<p class="recipe-nut">' + escapeHtml(nutLine(s.nutrition)) + "</p>" +
    "<h4>食材與份量</h4>" + ingList(s.items) +
    "<h4>作法</h4>" + stepsList(s.steps) +
    (s.keep ? '<p class="recipe-note">保存：' + escapeHtml(s.keep) + "</p>" : "") +
    (s.tip ? '<p class="recipe-tip">小撇步：' + escapeHtml(s.tip) + "</p>" : "") + "</details>";
}

function render() {
  const body = $("#recipes-body");
  const tabs = $("#recipes-subtabs");
  if (!body || !tabs) return;
  tabs.innerHTML = SECTIONS.map((s) => '<button type="button" class="meal-picker-tab' + (s[0] === section ? " selected" : "") + '" data-sec="' + s[0] + '">' + s[1] + "</button>").join("");
  const tools = $("#recipes-tools");
  if (!guide) { body.innerHTML = ""; return; }
  if (section === "dish") {
    const roles = Array.from(new Set(guide.dishes.map((d) => d.role)));
    tools.hidden = false;
    $("#recipes-role").innerHTML = '<option value="">全部類別</option>' + roles.map((r) => '<option value="' + escapeHtml(r) + '"' + (r === roleFilter ? " selected" : "") + ">" + escapeHtml(r) + "</option>").join("");
    const list = guide.dishes.filter((d) => (!query || d.name.indexOf(query) !== -1) && (!roleFilter || d.role === roleFilter));
    body.innerHTML = list.length ? list.map(dishCard).join("") : '<p class="rec-empty">找不到符合的菜</p>';
  } else {
    tools.hidden = true;
    const list = guide.sets.filter((s) => s.entry === section);
    body.innerHTML = '<p class="backup-note">' + escapeHtml(ENTRY_LABELS[section]) + "的減重推薦套組。營養為依衛福部食材資料換算，實際以你的份量為準。</p>" + list.map(setCard).join("");
  }
}

export function initRecipesTab() {
  const tabs = $("#recipes-subtabs");
  tabs.addEventListener("click", function (e) {
    const b = e.target.closest("[data-sec]");
    if (!b) return;
    section = b.getAttribute("data-sec");
    render();
  });
  $("#recipes-search").addEventListener("input", function (e) { query = e.target.value.trim(); render(); });
  $("#recipes-role").addEventListener("change", function (e) { roleFilter = e.target.value; render(); });
  document.addEventListener("tab:activated", function (e) { if (e.detail === "recipes") load(); });
  render();
}
