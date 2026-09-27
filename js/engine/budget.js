// 輕盈計畫 (Lighten Plan) — 日總額：今日餐次配額動態重算 + 完整記錄日/近N天平均共用 helper
// 對照 TECH-SPEC 4.3、PRD 5.1。此檔做「今日預算重算」與「近7天平均 vs 目標」的完整記錄日判斷。

(function () {
  "use strict";

  const SLOTS = ["breakfast", "lunch", "afternoon_tea", "dinner", "snack"];

  // 無紀錄時的預設切分比例（PRD 5.1：早20%／午30%／下午茶10%／晚30%／宵夜10%）
  const DEFAULT_WEIGHTS = {
    breakfast: 0.20,
    lunch: 0.30,
    afternoon_tea: 0.10,
    dinner: 0.30,
    snack: 0.10,
  };

  // 今日建議時段的預設開關（早/午/晚預設開啟，下午茶/宵夜預設關閉）。
  // 這是唯一來源，tab-profile.js／tab-today.js 都引用 window.DEFAULT_ENABLED_SLOTS，
  // 避免「勾選框顯示的預設值」跟「實際判斷用的預設值」兩邊各存一份、以後改一邊忘了改另一邊。
  const DEFAULT_ENABLED_SLOTS = { breakfast: true, lunch: true, afternoon_tea: false, dinner: true, snack: false };

  function isSlotEnabled(enabledSlots, slot) {
    const slots = enabledSlots || {};
    return slots.hasOwnProperty(slot) ? slots[slot] !== false : DEFAULT_ENABLED_SLOTS[slot];
  }

  // 分配邏輯（報告會說明）：
  // - 已吃餐次：配額回傳 0（不再顯示）。
  // - 未吃餐次：把「剩餘熱量」依各餐次的「預設權重」在未吃餐次之間做相對加權分配。
  //   例：吃完早餐後，剩餘熱量按 午0.35/晚0.30/宵0.10 的相對比例分給這三餐。
  // - 吃越多 → remainingKcal 越小；未吃餐次越少 → 每餐分越多。
  function recalcTodayBudget(targetKcal, todayLogs, enabledSlots) {
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
      if (!log || !DEFAULT_WEIGHTS.hasOwnProperty(log.slot)) return;
      eatenSlots[log.slot] = true;
      eatenKcal[log.slot] += Number(log.kcal) || 0;
    });

    const totalEaten = SLOTS.reduce(function (sum, s) {
      return sum + eatenKcal[s];
    }, 0);
    const remainingKcal = Math.max(0, base - totalEaten);

    const uneatenSlots = SLOTS.filter(function (s) {
      return !eatenSlots[s];
    });
    const totalWeight = uneatenSlots.reduce(function (sum, s) {
      return sum + DEFAULT_WEIGHTS[s];
    }, 0);

    const perSlotSuggestion = { breakfast: 0, lunch: 0, afternoon_tea: 0, dinner: 0, snack: 0 };
    if (totalWeight > 0) {
      uneatenSlots.forEach(function (s) {
        perSlotSuggestion[s] = remainingKcal * (DEFAULT_WEIGHTS[s] / totalWeight);
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

  function round1(n) {
    return Math.round(n * 10) / 10;
  }

  function localDateStr() {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return y + "-" + m + "-" + day;
  }

  function dateAddDays(dateStr, days) {
    const d = new Date(dateStr + "T00:00:00");
    d.setDate(d.getDate() + days);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return y + "-" + m + "-" + day;
  }

  // 該天是不是「完整記錄日」：所有開啟中的時段都有 daily_log 記錄。
  // tdee.js 第 9 步（下修前攝取檢查）跟「近7天平均 vs 目標」都用它。
  function isCompleteLogDay(dayLogs, enabledSlots) {
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
  function computeRecentAvgVsTarget(logs, targetKcal, enabledSlots, days) {
    const n = typeof days === "number" && days > 0 ? days : 7;
    const list = Array.isArray(logs) ? logs : [];
    const target = Number(targetKcal) || 0;
    const today = localDateStr();

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
        return s + (Number(l.kcal) || 0);
      }, 0);
    });

    return {
      status: "ok",
      avgKcal: round1(totalKcal / completeDates.length),
      targetKcal: target,
      completeDays: completeDates.length,
    };
  }

  window.recalcTodayBudget = recalcTodayBudget;
  window.DEFAULT_ENABLED_SLOTS = DEFAULT_ENABLED_SLOTS;
  window.isSlotEnabled = isSlotEnabled;
  window.isCompleteLogDay = isCompleteLogDay;
  window.computeRecentAvgVsTarget = computeRecentAvgVsTarget;
})();
