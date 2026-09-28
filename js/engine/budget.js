// 輕盈計畫 (Lighten Plan) — 日總額：今日餐次配額動態重算 + 完整記錄日/近N天平均共用 helper
// 對照 TECH-SPEC 4.3、PRD 5.1。此檔做「今日預算重算」與「近7天平均 vs 目標」的完整記錄日判斷。
// 紀錄一律是 daily_log 格式（營養合計在 totals）。今天日期由呼叫端傳入（章程 C1.1）。

import { SLOTS, SLOT_WEIGHTS, isSlotEnabled } from "../core/slots.js";
import { dateAddDays } from "../core/dates.js";
import { round1 } from "../core/num.js";
import { logKcal, sumLogTotals, sumKnownLogTotals } from "./meal-content.js";

// 分配邏輯：
// - 已吃餐次：配額回傳 0（不再顯示）。
// - 未吃餐次：把「剩餘熱量」依各餐次的「預設權重」在未吃餐次之間做相對加權分配。
//   例：吃完早餐後，剩餘熱量按 午0.35/晚0.30/宵0.10 的相對比例分給這三餐。
// - 吃越多 → remainingKcal 越小；未吃餐次越少 → 每餐分越多。
export function recalcTodayBudget(targetKcal, todayLogs, enabledSlots) {
  const target = Number(targetKcal);
  const base = isFinite(target) && target > 0 ? target : 0;
  const logs = Array.isArray(todayLogs) ? todayLogs : [];

  const eatenKcal = { breakfast: 0, lunch: 0, afternoon_tea: 0, dinner: 0, snack: 0 };
  const eatenSlots = {};

  // 被關閉的時段（含完全沒存過 enabled_slots 時套用 DEFAULT_ENABLED_SLOTS）視同「已處理」，
  // 排除在未吃餐次的權重分配之外
  SLOTS.forEach(function (s) {
    if (!isSlotEnabled(enabledSlots, s)) eatenSlots[s] = true;
  });

  logs.forEach(function (log) {
    if (!log || !SLOT_WEIGHTS.hasOwnProperty(log.slot)) return;
    eatenSlots[log.slot] = true;
    eatenKcal[log.slot] += logKcal(log);
  });

  const totalEaten = SLOTS.reduce(function (sum, s) {
    return sum + eatenKcal[s];
  }, 0);
  const remainingKcal = Math.max(0, base - totalEaten);

  const uneatenSlots = SLOTS.filter(function (s) {
    return !eatenSlots[s];
  });
  const totalWeight = uneatenSlots.reduce(function (sum, s) {
    return sum + SLOT_WEIGHTS[s];
  }, 0);

  const perSlotSuggestion = { breakfast: 0, lunch: 0, afternoon_tea: 0, dinner: 0, snack: 0 };
  if (totalWeight > 0) {
    uneatenSlots.forEach(function (s) {
      perSlotSuggestion[s] = remainingKcal * (SLOT_WEIGHTS[s] / totalWeight);
    });
  }

  return {
    remainingKcal: round1(remainingKcal),
    perSlotSuggestion: {
      breakfast: round1(perSlotSuggestion.breakfast),
      lunch: round1(perSlotSuggestion.lunch),
      afternoon_tea: round1(perSlotSuggestion.afternoon_tea),
      dinner: round1(perSlotSuggestion.dinner),
      snack: round1(perSlotSuggestion.snack),
    },
  };
}

// 該天是不是「完整記錄日」：所有開啟中的時段都有 daily_log 記錄。
// tdee.js 第 9 步（下修前攝取檢查）、「近7天平均 vs 目標」、纖維週日均、本週總覽都用它。
export function isCompleteLogDay(dayLogs, enabledSlots) {
  const logs = Array.isArray(dayLogs) ? dayLogs : [];
  const enabled = SLOTS.filter(function (s) {
    return isSlotEnabled(enabledSlots, s);
  });
  if (enabled.length === 0) return false;
  const logged = {};
  logs.forEach(function (l) {
    if (l && l.slot) logged[l.slot] = true;
  });
  return enabled.every(function (s) {
    return logged[s];
  });
}

// 近 N 天（預設 7 天，不含今天）平均 vs 目標：只算「完整記錄日」。
// 今天故意排除在外——今天在最後一個開啟時段吃完前，一定不是「完整記錄日」，
// 如果把今天算進窗口，過了某個時段但還沒吃完當天所有餐次時，這個統計會一直被今天
// 這個「必然不完整」的日子拖著跳「資料不足」或忽略當天，看起來像「過了餐食時間就不算」。
// 排除今天之後，這個數字只反映已經走完的日子，穩定、不會整天忽上忽下。
// 完整記錄日 < 3 天 → { status: "insufficient" }；否則回傳 { status:"ok", avgKcal, targetKcal, completeDays }。
export function computeRecentAvgVsTarget(logs, targetKcal, enabledSlots, days, today) {
  const n = typeof days === "number" && days > 0 ? days : 7;
  const list = Array.isArray(logs) ? logs : [];
  const target = Number(targetKcal) || 0;

  const byDate = {};
  list.forEach(function (l) {
    if (!l || !l.log_date) return;
    if (!byDate[l.log_date]) byDate[l.log_date] = [];
    byDate[l.log_date].push(l);
  });

  const completeDates = [];
  for (let i = 1; i <= n; i++) {
    const d = dateAddDays(today, -i);
    const dayLogs = byDate[d] || [];
    if (isCompleteLogDay(dayLogs, enabledSlots)) completeDates.push(d);
  }

  if (completeDates.length < 3) {
    return { status: "insufficient" };
  }

  let totalKcal = 0;
  completeDates.forEach(function (d) {
    totalKcal += byDate[d].reduce(function (s, l) {
      return s + logKcal(l);
    }, 0);
  });

  return {
    status: "ok",
    avgKcal: round1(totalKcal / completeDates.length),
    targetKcal: target,
    completeDays: completeDates.length,
  };
}

// 依序分配的「單一時段份額」helper（供 recommend.js 依序處理時段用）。
// pool：還沒處理時段的剩餘熱量池；slots：還沒處理的時段名單（含要算的 slot）。
// 公式跟 recalcTodayBudget 內部的權重分配一致，抽出來避免兩處各寫一份權重。
export function slotShare(pool, slots, slot) {
  const totalWeight = slots.reduce(function (sum, s) {
    return sum + (SLOT_WEIGHTS[s] || 0);
  }, 0);
  if (totalWeight <= 0) return 0;
  return pool * ((SLOT_WEIGHTS[slot] || 0) / totalWeight);
}

// 手動組餐缺口提示用的「單餐份額」。
// 跟 matcher.js 的 checkHardConstraints 是兩套刻意並存的缺口口徑：
//   - checkHardConstraints：推薦引擎排序用（全天蛋白質缺口 + 全週纖維平均缺口）
//   - slotNutrientShare：手動組餐「這個時段該補多少」用（單餐份額，kcal/蛋白質/纖維三項同權重）
// 不要把這兩套「統一」掉。草稿不塞進 todayLogs：recalcTodayBudget 看到某時段有東西就當「已吃」
// 歸零配額，拿去算這個時段自己的份額會兜死變成 0。
export function slotNutrientShare(targets, todayLogs, enabledSlots, slot) {
  const t = targets || {};
  const logs = Array.isArray(todayLogs) ? todayLogs : [];

  // 蛋白質/纖維未知的一餐不算「已經吃到」（只加已知部分，缺口偏大、往安全方向）
  const valid = logs.filter(Boolean);
  const eaten = {
    kcal: valid.reduce(function (s, l) { return s + logKcal(l); }, 0),
    protein: sumKnownLogTotals(valid, "protein_g").sum,
    fiber: sumKnownLogTotals(valid, "fiber_g").sum,
  };
  const eatenSlots = {};
  valid.forEach(function (l) {
    if (l.slot) eatenSlots[l.slot] = true;
  });

  if (eatenSlots[slot]) return { kcalShare: 0, proteinShare: 0, fiberShare: 0 };

  const targetKcal = Number(t.targetKcal) || 0;
  const targetProtein = Number(t.protein_g) || 0;
  const targetFiber = Number(t.fiber_g) || 0;

  const uneatenSlots = SLOTS.filter(function (s) {
    return !eatenSlots[s] && isSlotEnabled(enabledSlots, s);
  });
  const totalWeight = uneatenSlots.reduce(function (sum, s) {
    return sum + (SLOT_WEIGHTS[s] || 0);
  }, 0);
  const ratio = totalWeight > 0 ? ((SLOT_WEIGHTS[slot] || 0) / totalWeight) : 0;

  return {
    kcalShare: round1(Math.max(0, targetKcal - eaten.kcal) * ratio),
    proteinShare: round1(Math.max(0, targetProtein - eaten.protein) * ratio),
    fiberShare: round1(Math.max(0, targetFiber - eaten.fiber) * ratio),
  };
}

// 本週總覽：每天的熱量/蛋白質/纖維加總，以及「完整記錄日（不含今天）」的平均。
// 平均只算完整記錄日且不含今天，跟「近7天平均」同一套規則。
// 某天有一餐蛋白質（或纖維）未知，那天的這一欄是 null，平均只算這一欄已知的日子（xxxDays＝算進去的天數）。
export function summarizeWeek(logs, enabledSlots, today) {
  const logsByDate = {};
  logs.forEach(function (l) {
    if (!logsByDate[l.log_date]) logsByDate[l.log_date] = [];
    logsByDate[l.log_date].push(l);
  });
  const byDate = {};
  Object.keys(logsByDate).forEach(function (d) {
    const dayLogs = logsByDate[d];
    byDate[d] = {
      kcal: dayLogs.reduce(function (s, l) { return s + logKcal(l); }, 0),
      protein: sumLogTotals(dayLogs, "protein_g"),
      fiber: sumLogTotals(dayLogs, "fiber_g"),
    };
  });

  const completeDates = Object.keys(logsByDate).filter(function (d) {
    return d < today && isCompleteLogDay(logsByDate[d], enabledSlots);
  });
  const nComplete = completeDates.length;
  function avgOf(key) {
    const known = completeDates.filter(function (d) { return byDate[d][key] != null; });
    if (known.length === 0) return { avg: nComplete === 0 ? 0 : null, days: 0 };
    return { avg: known.reduce(function (s, d) { return s + byDate[d][key]; }, 0) / known.length, days: known.length };
  }
  const kcal = avgOf("kcal"), protein = avgOf("protein"), fiber = avgOf("fiber");
  return {
    byDate: byDate, nComplete: nComplete, avgKcal: kcal.avg,
    avgProtein: protein.avg, proteinDays: protein.days, avgFiber: fiber.avg, fiberDays: fiber.days,
  };
}
