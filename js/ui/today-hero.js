// 輕盈計畫 — 今日建議頂部彙總卡：接下來幾餐的建議熱量、今天已攝取的蛋白質/纖維、近7天平均、體重趨勢校正提示。

import { SLOTS, SLOT_LABELS, isSlotEnabled } from "../core/slots.js";
import { shortDate } from "../core/dates.js";
import { escapeHtml } from "../core/html.js";
import { $, sodiumText, satFatText } from "./dom.js";
import { computeRecentAvgVsTarget } from "../engine/budget.js";
import { todayIntake, recsKcalTotal, sumDisplayLogTotals } from "../engine/meal-content.js";
import { loadTdeeState, getCalibratedTargets } from "./calibration.js";
import { activateTab } from "./tabs.js";

// planned：今天的有效預約 { kcal, slots: { slot: 暫時紀錄 } } 或 null；plannedShown：上次有沒有顯示「已排」那一行
// （沒有預約也沒顯示過就不碰那個元素，快照的 domNN 才不會位移）。主數字一律是「目標 − 已記錄」（設計草案第 9 節 M7）
// 切到未來日子時不准再打開彙總卡（今天那次的 renderHero 是非同步的，可能在切換之後才跑完）
let suppressed = false;
export function setHeroSuppressed(v) {
  suppressed = !!v;
}

export async function renderHero(remainingBudget, targets, todayLogs, recentLogs, profile, recs, today, planned, plannedShown) {
  const hero = $("#today-hero");
  if (!hero) return;
  const eaten = todayIntake(todayLogs);
  // 所有開啟的時段都記錄完時，「接下來幾餐」已經不存在，改顯示記錄完成、不顯示數字
  // （這個數字是「目標減已記錄」，記完之後仍可能是正數，繼續顯示會像在叫人再吃一餐）。
  const loggedSlots = {};
  todayLogs.forEach(function (l) { loggedSlots[l.slot] = true; });
  const allLogged = SLOTS.every(function (s) {
    return !isSlotEnabled(profile.enabled_slots, s) || loggedSlots[s];
  });
  $("#today-hero-label").textContent = allLogged ? "今天的餐點都記錄完了" : "接下來幾餐的建議熱量";
  $("#today-hero-kcal").hidden = allLogged;
  $("#today-hero-kcal-value").textContent = Math.round(remainingBudget.remainingKcal);
  $("#today-hero-protein").textContent = Math.round(eaten.protein_g) + " / " + Math.round(targets.protein_g) + "g";
  $("#today-hero-fiber").textContent = Math.round(eaten.fiber_g) + " / " + Math.round(targets.fiber_g) + "g";

  // 次要行「目前這幾餐建議合計」，跟主數字有落差時顯示差額。
  const subEl = $("#today-hero-kcal-sub");
  if (subEl) {
    if (!allLogged && recs) {
      const cardTotal = Math.round(recsKcalTotal(recs, SLOTS) + (planned ? planned.kcal : 0));
      if (cardTotal > 0) {
        const diff = cardTotal - Math.round(remainingBudget.remainingKcal);
        $("#today-hero-kcal-sub-value").textContent = cardTotal + (Math.abs(diff) >= 20 ? "（" + (diff > 0 ? "+" : "") + Math.round(diff) + "）" : "");
        subEl.hidden = false;
      } else { subEl.hidden = true; }
    } else { subEl.hidden = true; }
  }

  if (planned || plannedShown) {
    const plannedEl = $("#today-hero-planned");
    if (plannedEl) {
      plannedEl.textContent = planned ? "已排：" + SLOTS.filter(function (s) { return planned.slots[s]; }).map(function (s) {
        const p = planned.slots[s];
        return p.skip ? SLOT_LABELS[s] + "不吃" : SLOT_LABELS[s] + " 約 " + Math.round(p.totals.kcal) + " kcal";
      }).join("、") : "";
      plannedEl.hidden = !planned;
    }
  }

  // 營養素明細（<details> 展開區塊）
  const nutritionEl = $("#today-hero-nutrition");
  const sodium = sumDisplayLogTotals(todayLogs, "sodium_mg");
  const satFat = sumDisplayLogTotals(todayLogs, "sat_fat_g");
  if (nutritionEl) {
    const body = $("#today-hero-nutrition-body");
    if (body) {
      body.innerHTML =
        '<div class="today-hero-stat"><span class="today-hero-stat-label">蛋白質</span><span class="today-hero-stat-value">' + Math.round(eaten.protein_g) + " / " + Math.round(targets.protein_g) + "g（" + Math.round(eaten.protein_g * 4 / targets.targetKcal * 100) + "%）</span></div>" +
        '<div class="today-hero-stat"><span class="today-hero-stat-label">脂肪</span><span class="today-hero-stat-value">' + Math.round(eaten.fat_g) + " / " + Math.round(targets.fat_g) + "g（" + Math.round(eaten.fat_g * 9 / targets.targetKcal * 100) + "%）</span></div>" +
        '<div class="today-hero-stat"><span class="today-hero-stat-label">碳水（參考值）</span><span class="today-hero-stat-value">' + Math.round(eaten.carb_g) + " / " + Math.round(targets.carb_g) + "g（" + Math.round(eaten.carb_g * 4 / targets.targetKcal * 100) + "%）</span></div>" +
        '<div class="today-hero-stat"><span class="today-hero-stat-label">纖維</span><span class="today-hero-stat-value">' + Math.round(eaten.fiber_g) + " / " + Math.round(targets.fiber_g) + "g</span></div>" +
        '<p class="today-hero-display">' + escapeHtml(sodiumText(sodium.value, sodium.partial, true)) + "　" + escapeHtml(satFatText(satFat.value, satFat.partial)) + "</p>" +
        '<p class="taiwan-ref-note">碳水是用目標熱量扣掉蛋白質、脂肪熱量後反推出來的，不是獨立設定的建議值。</p>';
    }
    nutritionEl.hidden = false;
  }
  // 資料涵蓋率警語
  const coverageEl = $("#today-hero-coverage-warn");
  if (coverageEl) {
    if (eaten.missingCoverageKcal > 0) {
      coverageEl.textContent = "今天有 " + Math.round(eaten.missingCoverageKcal) + " kcal 來自沒有脂肪/碳水資料的品項（超商即食／台式外送），這部分的脂肪、碳水沒有算進上面的數字。";
      coverageEl.hidden = false;
    } else { coverageEl.hidden = true; }
  }

  const recent = computeRecentAvgVsTarget(recentLogs, targets.targetKcal, profile.enabled_slots, 7, today);
  const avgEl = $("#today-hero-week-avg");
  if (avgEl) {
    avgEl.textContent = recent.status === "ok"
      ? "近7天平均 " + Math.round(recent.avgKcal) + "／目標 " + Math.round(recent.targetKcal) + " kcal"
      : "資料不足";
  }

  // 校正提示：pending 或自動調整告知，只顯示其中一個。
  const promptEl = $("#today-hero-calibration");
  if (promptEl) {
    let html = "";
    try {
      const state = await loadTdeeState();
      if (state.pending) {
        html = '<button type="button" class="today-cal-link" id="today-cal-pending">基本資料有一項目標調整建議待你確認</button>';
      } else if (state.announce_until && today <= state.announce_until && state.offset_kcal !== 0) {
        const newTargets = await getCalibratedTargets(profile, state.effective_date);
        html = '<p class="today-cal-announce">依近4週體重趨勢，每日目標從 ' + shortDate(state.effective_date) + ' 起調整為 ' + Math.round(newTargets.targetKcal) + ' kcal</p>';
      }
    } catch (err) {
      console.error(err);
    }
    promptEl.innerHTML = html;
    promptEl.hidden = html === "";
    const pendingBtn = promptEl.querySelector("#today-cal-pending");
    if (pendingBtn) {
      pendingBtn.addEventListener("click", function () {
        activateTab("profile");
      });
    }
  }

  if (!suppressed) hero.hidden = false;
}
