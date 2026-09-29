// 輕盈計畫 — 選擇器的自煮分頁：快煮/開伙子切換 → 餐型 → 食材與烹調法 → 用油與調味 → 份量。
// 選項能不能選問 engine（composeOptionProblem：免開火、快煮難度、軸上限；passesHardFilters：過敏原、飲食、不吃），
// 送出規則是 engine 的 composeProblem；這裡只畫畫面（章程 C2、C4.3）。

import { escapeHtml } from "../../core/html.js";
import { COMPOSE_MAX } from "../../core/config.js";
import { passesHardFilters } from "../../engine/filters.js";
import { composeOptionProblem, composePrimary, archetypeHasStaple, oilOptions, composeImplicit } from "../../engine/meal-content.js";

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

// 把單一食材包成跟推薦的自組食譜一樣的形狀再過硬性過濾，讓「不吃食材」清單能正確命中
function hardFilterReason(item, axis, profile) {
  const wrapper = { is_composed: true, allergen_tags: item.allergen_tags || [], diet_tag_sets: [item.diet_tags || []] };
  wrapper[{ protein: "protein_id", staple: "staple_id", vegetable: "vegetable_id", seasoning: "sauce_id" }[axis]] = item.id;
  const r = passesHardFilters(wrapper, profile);
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
  return '<button type="button" class="' + cls + '" data-axis="' + axis + '" data-id="' + escapeHtml(id) + '"' + (disabled ? " disabled" : "") + ">" +
    escapeHtml(label) + (o.reason ? '<span class="item-card-reason">' + escapeHtml(o.reason) + "</span>" : "") + "</button>";
}

function axisHtml(label, axis, catalog, st, profile, withNone) {
  const d = st.draft;
  let html = '<div class="compose-axis"><div class="compose-axis-label">' + escapeHtml(label) + '</div><div class="compose-options">';
  if (withNone) html += optionHtml(axis, "", "不加", { selected: !d[axis] });
  archetypeOptions(catalog, axis, d.archetype).forEach(function (it) {
    html += optionHtml(axis, it.id, it.name, { selected: isSelected(d, axis, it), reason: optionReason(it, axis, d, st.tier, profile) });
  });
  return html + "</div></div>";
}

// st = { tier, draft }；回傳 { html, steps }（steps：這個分頁用掉的步驟數，飲料步驟接在後面）
export function cookTabHtml(catalog, slot, st, profile) {
  const d = st.draft;
  let n = 0;
  const step = function (label) { n++; return '<div class="meal-picker-step-label">' + n + ". " + escapeHtml(label) + "</div>"; };
  let html = '<div class="compose-step">' + step("快煮或開伙") + '<div class="compose-options">';
  ["cook_quick", "cook_full"].forEach(function (t) {
    html += '<button type="button" class="compose-option' + (st.tier === t ? " selected" : "") + '" data-tier="' + t + '">' + TIER_LABELS[t] + "</button>";
  });
  html += "</div></div>";

  html += '<div class="compose-step">' + step("選餐型") + '<div class="compose-options">';
  catalog.archetypes.filter(function (a) { return (a.valid_slots || []).indexOf(slot) !== -1; }).forEach(function (a) {
    html += optionHtml("archetype", a.id, a.name, { selected: !!(d.archetype && d.archetype.id === a.id) });
  });
  html += "</div></div>";
  if (!d.archetype) return { html: html, steps: n };

  const a = d.archetype;
  const has = function (axis) { return !!(a[axis] && a[axis].allow && a[axis].allow.length > 0); };
  html += '<div class="compose-step">' + step("選食材與烹調法");
  html += axisHtml("蛋白質（必選，最多 " + COMPOSE_MAX.protein + " 個）", "protein", catalog, st, profile, false);
  if (archetypeHasStaple(a)) html += axisHtml("主食（必選）", "staple", catalog, st, profile, false);
  if (has("vegetable")) html += axisHtml("蔬菜（選填，最多 " + COMPOSE_MAX.vegetable + " 個）", "vegetable", catalog, st, profile, false);
  if (has("seasoning")) html += axisHtml("醬料（選填）", "seasoning", catalog, st, profile, true);
  html += axisHtml("烹調法（必選）", "method", catalog, st, profile, false);
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
