// 輕盈計畫 — 選擇器的自煮分頁：快煮/開伙子切換 → 餐型 → 食材與烹調法 → 用油與調味 → 份量。
// 選項能不能選問 engine（composeOptionProblem：免開火、快煮難度、軸上限；passesHardFilters：過敏原、飲食、不吃），
// 送出規則是 engine 的 composeProblem；這裡只畫畫面（章程 C2、C4.3）。

import { escapeHtml } from "../../core/html.js";
import { COMPOSE_MAX } from "../../core/config.js";
import { ingredientFilterResult } from "../../engine/filters.js";
import { composeOptionProblem, composePrimary, archetypeHasStaple, oilOptions, composeImplicit } from "../../engine/meal-content.js";
import { favoritesFirst } from "../../engine/picker.js";
import { homeMealToggleHtml, homeMealStepHtml } from "./home-meal.js";
import { cookEntryHtml, cookFormsHtml } from "./cook-forms.js";

export const TIER_LABELS = { cook_quick: "快煮（簡單料理）", cook_full: "開伙" };

function pickIds(list, ids) {
  const map = {};
  list.forEach(function (it) { map[it.id] = it; });
  return (ids || []).map(function (id) { return map[id]; }).filter(Boolean);
}

export function archetypeOptions(catalog, axis, archetype) {
  if (axis === "method") return pickIds(catalog.sauces, archetype.methods);
  const list = axis === "protein" ? catalog.proteins : axis === "staple" ? catalog.staples : axis === "vegetable" ? catalog.vegetables : catalog.sauces;
  return pickIds(list, (archetype[axis] && archetype[axis].allow) || []);
}

// 單一食材的硬性過濾在 engine（我的組合的解析也用，章程 C2）
function hardFilterReason(item, axis, profile) {
  const r = ingredientFilterResult(item, axis, profile);
  return r.ok ? null : r.reason;
}

export function optionReason(item, axis, d, tier, profile) {
  if (axis === "method") return composeOptionProblem(item, axis, d, { tier: tier });
  return composeOptionProblem(item, axis, d, { tier: tier }) || hardFilterReason(item, axis, profile);
}

function isSelected(d, axis, item) {
  const v = axis === "protein" ? d.proteins : axis === "vegetable" ? d.vegetables : d[axis];
  return Array.isArray(v) ? v.some(function (x) { return x.id === item.id; }) : !!(v && v.id === item.id);
}

function optionHtml(axis, id, label, o) {
  const cls = "compose-option" + (o.selected ? " selected" : "") + (o.reason ? " is-blocked" : "");
  // 已選的選項即使現在不合法（例：切到快煮）也要能點掉，送出時由 composeProblem 擋
  const disabled = o.reason && !o.selected;
  // 餐型再點一次＝取消（decisions #122），用 aria-pressed 讓讀屏知道它是開關
  const pressed = axis === "archetype" ? ' aria-pressed="' + (o.selected ? "true" : "false") + '"' : "";
  return '<button type="button" class="' + cls + '" data-axis="' + axis + '" data-id="' + escapeHtml(id) + '"' + pressed + (disabled ? " disabled" : "") + ">" +
    escapeHtml(label) + (o.reason ? '<span class="item-card-reason">' + escapeHtml(o.reason) + "</span>" : "") + "</button>";
}

// favSet：扣掉不吃之後的常吃；常吃且沒被硬性過濾擋的排前面（只看設定，選擇過程中不會跳位置），被擋的位置不變（decisions #127 ⑤）
function axisHtml(label, axis, catalog, st, profile, withNone, favSet) {
  const d = st.draft;
  let html = '<div class="compose-axis"><div class="compose-axis-label">' + escapeHtml(label) + '</div><div class="compose-options">';
  if (withNone) html += optionHtml(axis, "", "不加", { selected: !d[axis] });
  const ok = function (it) { return axis === "method" || !hardFilterReason(it, axis, profile); };
  favoritesFirst(archetypeOptions(catalog, axis, d.archetype), favSet, function (it) { return it.id; }, ok).forEach(function (it) {
    html += optionHtml(axis, it.id, it.name, { selected: isSelected(d, axis, it), reason: optionReason(it, axis, d, st.tier, profile) });
  });
  return html + "</div></div>";
}

// st = { tier, draft }；favSet：常吃（可省略）；回傳 { html, steps }（steps：這個分頁用掉的步驟數，飲料步驟接在後面）
// homeCtx（選填）：{ season }，帶入舊共餐（decisions #152）時才顯示舊畫面；新入口在 st.nc（cook-forms.js）
export function cookTabHtml(catalog, slot, st, profile, favSet, homeCtx) {
  const d = st.draft;
  let n = 0;
  const step = function (label) { n++; return '<div class="meal-picker-step-label">' + n + ". " + escapeHtml(label) + "</div>"; };
  let html = '<div class="compose-step">' + step("快煮或開伙") + '<div class="compose-options">';
  ["cook_quick", "cook_full"].forEach(function (t) {
    html += '<button type="button" class="compose-option' + (st.tier === t ? " selected" : "") + '" data-tier="' + t + '">' + TIER_LABELS[t] + "</button>";
  });
  html += "</div></div>";

  // 新的四個入口（餐盒、早餐盤、早餐碗、家常餐）；舊餐型與舊共餐只在帶入舊組合、預約或推薦時顯示成已選，點掉就回到新入口
  const nc = st.nc;
  html += '<div class="compose-step">' + step("怎麼吃") +
    '<p class="meal-picker-note">只記單品可以不選，直接到下面加點單品。</p><div class="compose-options">' + cookEntryHtml(slot, nc);
  if (d.archetype) html += optionHtml("archetype", d.archetype.id, d.archetype.name, { selected: true });
  const showHome = !!homeCtx && !!st.home && st.home.open;
  if (showHome) html += homeMealToggleHtml(true);
  html += "</div></div>";
  if (nc.entry) {
    html += cookFormsHtml(catalog, { nc: nc, tier: st.tier, pf: profile, fav: favSet }, n + 1 + ". " + (nc.entry === "home" ? "選主食與菜" : "填格子"));
    return { html: html, steps: n + 1 };
  }
  if (showHome && !d.archetype) {
    html += homeMealStepHtml(st.home, { catalog: catalog, profile: profile, season: homeCtx.season }, n + 1 + ". 選家常菜");
    return { html: html, steps: n + 1 };
  }
  if (!d.archetype) return { html: html, steps: n };

  const a = d.archetype;
  const has = function (axis) { return !!(a[axis] && a[axis].allow && a[axis].allow.length > 0); };
  html += '<div class="compose-step">' + step("選食材與烹調法");
  html += axisHtml("蛋白質（必選，最多 " + COMPOSE_MAX.protein + " 個）", "protein", catalog, st, profile, false, favSet);
  if (archetypeHasStaple(a)) html += axisHtml("主食（必選）", "staple", catalog, st, profile, false, favSet);
  if (has("vegetable")) html += axisHtml("蔬菜（選填，最多 " + COMPOSE_MAX.vegetable + " 個）", "vegetable", catalog, st, profile, false, favSet);
  if (has("seasoning")) html += axisHtml("醬料（選填）", "seasoning", catalog, st, profile, true, favSet);
  html += axisHtml("烹調法（必選）", "method", catalog, st, profile, false, favSet);
  html += "</div>";

  const oils = oilOptions(d, profile.oil_habit);
  const imp = composeImplicit(d, profile.oil_habit);
  if (oils.length > 0 || a.seasoned) {
    html += '<div class="compose-step">' + step("用油與調味");
    if (oils.length > 0) {
      html += '<div class="compose-axis"><div class="compose-axis-label">用油</div><div class="compose-options">';
      oils.forEach(function (o) {
        const label = o.is_default ? "預設（" + o.oil_g + "g，依用油習慣）" : o.oil_g === 5 ? "約 1 茶匙（5g）" : o.oil_g === 10 ? "約 2 茶匙（10g）" : o.oil_g + "g";
        html += '<button type="button" class="compose-option' + (imp.oil_g === o.oil_g ? " selected" : "") + '" data-oil="' + (o.is_default ? "" : o.oil_g) + '">' + escapeHtml(label) + "</button>";
      });
      html += "</div></div>";
    }
    if (a.seasoned) {
      html += '<div class="compose-axis"><div class="compose-axis-label">調味</div><div class="compose-options">';
      [["light", "清淡"], ["normal", "一般"]].forEach(function (x) {
        html += '<button type="button" class="compose-option' + (imp.seasoning === x[0] ? " selected" : "") + '" data-seasoning-level="' + x[0] + '">' + x[1] + "</button>";
      });
      html += "</div></div>";
    }
    html += "</div>";
  }

  const primary = composePrimary(d);
  if (primary) {
    html += '<div class="compose-step">' + step("份量（" + primary.name + "）") + '<div class="compose-scale">' +
      '<input type="range" min="0.5" max="2.0" step="0.1" value="' + d.primaryScale + '" id="compose-scale-slider">' +
      '<span id="compose-scale-value">' + d.primaryScale.toFixed(1) + " 倍</span></div></div>";
  }
  return { html: html, steps: n };
}
