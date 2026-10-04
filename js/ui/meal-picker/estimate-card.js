// 輕盈計畫 — 外食分頁最上方的「找不到？直接估算」（PRD 第 9 節、decisions #46、#151）：
// 兩種：①名稱（選填）＋ S/M/L → estimate 元件；②主食＋家常菜（共食、自助餐）：主食、道數、每道的類別、菜量、湯 → 七欄營養由 engine 算。
// 只存在這一餐，不存成品項；估算是使用者自己宣告吃了什麼，不過硬性過濾。按鈕一律用 data 屬性＋事件委派（沒有新的 DOM id）。

import { escapeHtml } from "../../core/html.js";
import {
  ESTIMATE_SIZE_KCAL, EST_SIZES, EST_CATS, EST_STAPLES, EST_DISH_MAX, EST_DISH_GRAMS, EST_STAPLE_PORTIONS, EST_STAPLE_G_PER_PORTION,
  EST_SOUP_ML, EST_CAT_LABELS, EST_STAPLE_LABELS,
} from "../../core/config.js";
import { homeEstimate, homeEstimateGrams, homeEstimateProblem } from "../../engine/meal-content.js";

const SIZE_LABELS = { S: "小份", M: "一般", L: "大餐" };
const PART_LABELS = { S: "小", M: "中", L: "大" };

// 「主食＋家常菜」表單的初始設定
export function emptyHomeEst() {
  return { mode: "plain", name: "", cfg: { n: 1, cats: ["mixed"], staple: "white", staple_size: "M", dish: "M", soup: false } };
}

// 改設定後讓 cfg 保持一致：道數改變時補或裁 cats；不吃主食時 staple_size 是 null，改回有主食時預設中份
export function normalizeHomeCfg(cfg) {
  const cats = cfg.cats.slice(0, cfg.n);
  while (cats.length < cfg.n) cats.push(cats.length ? cats[cats.length - 1] : "mixed");
  const size = cfg.staple === "none" ? null : (cfg.staple_size || "M");
  return Object.assign({}, cfg, { cats: cats, staple_size: size });
}

function chip(attr, value, selected, label, sub) {
  return '<button type="button" class="compose-option' + (selected ? " selected" : "") + '" ' + attr + '="' + escapeHtml(String(value)) + '">' + escapeHtml(label) +
    (sub ? '<span class="item-card-kcal">' + escapeHtml(sub) + "</span>" : "") + "</button>";
}

function group(title, inner) {
  return '<div class="meal-picker-estimate-sub">' + escapeHtml(title) + '</div><div class="compose-options">' + inner + "</div>";
}

function homeFormHtml(cfg, home) {
  const g = homeEstimateGrams(cfg);
  let html = group("主食", EST_STAPLES.map(function (k) { return chip("data-home-staple", k, cfg.staple === k, EST_STAPLE_LABELS[k]); }).join(""));
  if (cfg.staple !== "none") {
    html += group("主食量", EST_SIZES.map(function (s) {
      return chip("data-home-staple-size", s, cfg.staple_size === s, PART_LABELS[s], EST_STAPLE_PORTIONS[s] * EST_STAPLE_G_PER_PORTION[cfg.staple] + "g");
    }).join(""));
  }
  html += group("幾道菜", [1, 2, 3, 4].filter(function (n) { return n <= EST_DISH_MAX; }).map(function (n) { return chip("data-home-n", n, cfg.n === n, n + " 道"); }).join(""));
  cfg.cats.forEach(function (cat, i) {
    html += group(cfg.n === 1 ? "菜的類別" : "第 " + (i + 1) + " 道", EST_CATS.map(function (k) { return chip("data-home-cat", i + ":" + k, cat === k, EST_CAT_LABELS[k]); }).join(""));
  });
  html += '<p class="meal-picker-note">純肉＝肉、魚、蛋、豆腐為主。</p>';
  html += group("菜量（全部的菜合計" + (cfg.n > 1 ? "，分給 " + cfg.n + " 道" : "") + "）", EST_SIZES.map(function (s) {
    return chip("data-home-dish", s, cfg.dish === s, PART_LABELS[s], EST_DISH_GRAMS[s] + "g");
  }).join(""));
  html += group("湯", chip("data-home-soup", cfg.soup ? "off" : "on", cfg.soup, cfg.soup ? "有湯（" + EST_SOUP_ML + "ml）" : "加湯（" + EST_SOUP_ML + "ml）"));
  const problem = homeEstimateProblem(cfg, home);
  if (problem) return html + '<p class="meal-picker-note">' + escapeHtml(problem) + "</p>";
  const e = homeEstimate(cfg, home), s = e.snapshot;
  const parts = [];
  if (g.staple_g) parts.push(EST_STAPLE_LABELS[cfg.staple] + " " + g.staple_g + "g");
  parts.push("菜 " + g.dish_total_g + "g" + (cfg.n > 1 ? "，每道約 " + g.per_dish_g + "g" : ""));
  if (g.soup_ml) parts.push("湯 " + g.soup_ml + "ml");
  const preview = "約 " + Math.round(s.kcal) + " kcal · 蛋白質 " + Math.round(s.protein_g) + " g · 鈉 " + Math.round(s.sodium_mg) + " mg（" + parts.join("、") + "）";
  html += '<p class="meal-picker-note">' + escapeHtml(preview) + "<br>" + escapeHtml("估計：依常見家常菜的平均算出，不是這一餐的實際數字。") + "</p>";
  return html + '<button type="button" class="compose-option" data-home-add="1">' + escapeHtml("加入這一餐：" + e.name) + "</button>";
}

// estimates：這一餐已加入的估算 [{ size, name, snapshot?, est? }]；homeEst：表單狀態（emptyHomeEst）；home：catalog.homeDishes
export function estimateCardHtml(estimates, homeEst, home) {
  const st = homeEst || emptyHomeEst();
  let html = '<div class="meal-picker-estimate"><div class="meal-picker-estimate-title">找不到？直接估算</div>' +
    '<p class="meal-picker-note">有聚餐？先記下來，其他餐會自動調整。</p>' +
    '<div class="compose-options">' + chip("data-estimate-mode", "plain", st.mode === "plain", "一般外食") + chip("data-estimate-mode", "home", st.mode === "home", "主食＋家常菜") + "</div>" +
    '<input type="text" id="meal-picker-estimate-name" class="meal-picker-input" maxlength="30" placeholder="名稱（選填，例：喜宴）" value="' + escapeHtml(st.name || "") + '">';
  if (st.mode === "home") {
    html += homeFormHtml(st.cfg, home);
  } else {
    html += '<div class="compose-options">';
    Object.keys(ESTIMATE_SIZE_KCAL).forEach(function (size) {
      html += '<button type="button" class="compose-option" data-estimate-size="' + size + '">' + size + " " + SIZE_LABELS[size] +
        '<span class="item-card-kcal">約 ' + ESTIMATE_SIZE_KCAL[size] + " kcal</span></button>";
    });
    html += "</div>";
  }
  if (estimates.length > 0) {
    html += '<div class="meal-picker-estimate-list">';
    estimates.forEach(function (e, i) {
      const kcal = e.snapshot ? Math.round(e.snapshot.kcal) : ESTIMATE_SIZE_KCAL[e.size];
      html += '<button type="button" class="compose-option selected" data-estimate-remove="' + i + '">' +
        escapeHtml((e.name || "外食估算") + "（" + (e.size ? e.size + "，" : "") + "約 " + kcal + " kcal）") + " ×</button>";
    });
    html += "</div>";
  }
  return html + "</div>";
}
