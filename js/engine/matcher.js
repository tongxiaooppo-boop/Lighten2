// 輕盈計畫 (Lighten Plan) — 蛋白質(日)／纖維(週日均) 硬約束缺口計算
// 對照 TECH-SPEC 4.4、PRD 5.6。回傳值供 recommend.js 優先安排高蛋白/高纖組合。

(function () {
  "use strict";

  const FIBER_FLOOR_G = 25; // 纖維週日均下限（PRD 5.6：25–35g，取下限 25 當硬約束）

  function localDateStr() {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return y + "-" + m + "-" + day;
  }

  // 蛋白質 g/kg 目標：比照 nutrition.js 定案規則（增肌 2.0、維持/減脂 1.8，可用 profile.protein_g_per_kg 覆寫）
  function proteinPerKg(profile) {
    if (
      profile &&
      typeof profile.protein_g_per_kg === "number" &&
      profile.protein_g_per_kg > 0
    ) {
      return profile.protein_g_per_kg;
    }
    if (profile && (profile.goal_mode === "bulk" || profile.goal_mode === "增肌")) {
      return 2.0;
    }
    return 1.8;
  }

  function checkHardConstraints(weekLogs, profile) {
    const logs = Array.isArray(weekLogs) ? weekLogs : [];
    const weightKg = Number((profile && profile.weight_kg) || 0);

    const proteinTarget = proteinPerKg(profile) * weightKg;
    const today = localDateStr();

    let todayProtein = 0;
    const fiberByDate = {};

    logs.forEach(function (log) {
      if (!log) return;
      if (log.log_date === today) {
        todayProtein += Number(log.protein_g) || 0;
      }
      if (log.log_date) {
        fiberByDate[log.log_date] =
          (fiberByDate[log.log_date] || 0) + (Number(log.fiber_g) || 0);
      }
    });

    // 蛋白質缺口：目標 − 今日已攝取；已達標回傳 0（不做負缺口）
    let proteinGapToday = proteinTarget - todayProtein;
    if (proteinGapToday < 0) proteinGapToday = 0;

    // 纖維週日均：以「有記錄的天數」取平均（每日纖維總量 ÷ 有記錄的天數）
    const dates = Object.keys(fiberByDate);
    const avgFiber =
      dates.length > 0
        ? dates.reduce(function (sum, d) {
            return sum + fiberByDate[d];
          }, 0) / dates.length
        : 0;
    const fiberGapThisWeek = avgFiber < FIBER_FLOOR_G ? FIBER_FLOOR_G - avgFiber : 0;

    return {
      proteinGapToday: round1(proteinGapToday),
      fiberGapThisWeek: round1(fiberGapThisWeek),
    };
  }

  function round1(n) {
    return Math.round(n * 10) / 10;
  }

  window.checkHardConstraints = checkHardConstraints;
})();
