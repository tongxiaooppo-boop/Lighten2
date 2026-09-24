// 輕盈計畫 (Lighten Plan) — TDEE 動態週校正
// 對照 TECH-SPEC 4.2、PRD 3.7。
// 只做「7日體重移動平均 + 方向正確的校正」，不做真的統計回歸。
// dailyLogs 本輪保留參數但不使用（PRD 3.7 的攝取回歸留待日後，不影響校正方向）。

(function () {
  "use strict";

  const ADJUST_KCAL = 150; // 每次校正幅度（±100~200 範圍內取 150）

  // 各模式閾值（kg／週）。減脂/增肌/維持的方向與速度判別。
  const T = {
    cutTooSlow7d: -0.2, // 減脂：本週掉 > -0.2kg 才不算「太慢」
    cutTooSlow14d: -0.4, // 減脂：兩週累計掉 > -0.4kg 才不算「太慢」
    cutTooFast: -1.0, // 減脂：本週掉 > 1.0kg 算「太快」
    bulkTooSlow: 0.1, // 增肌：本週增 < 0.1kg 算「太慢」
    bulkTooFast: 1.0, // 增肌：本週增 > 1.0kg 算「太快」
    maintainUp: 0.5, // 維持：本週增 > 0.5kg 算偏離（應下修）
    maintainDown: -0.5, // 維持：本週掉 > 0.5kg 算偏離（應上修）
  };

  function round1(n) { return Math.round(n * 10) / 10; }

  function fmt(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return y + "-" + m + "-" + day;
  }

  function dateAddDays(dateStr, days) {
    const d = new Date(dateStr + "T00:00:00");
    d.setDate(d.getDate() + days);
    return fmt(d);
  }

  function weekStartOfToday() {
    const d = new Date();
    const day = d.getDay(); // 0=Sun
    const diff = day === 0 ? 6 : day - 1;
    d.setDate(d.getDate() - diff);
    return fmt(d);
  }

  function isMale(profile) {
    const g = String((profile && profile.gender) || "").trim().toLowerCase();
    return g === "男" || g === "male" || g === "m";
  }

  function goalMultiplier(goal) {
    if (goal === "減脂" || goal === "cut") return 0.8;
    if (goal === "增肌" || goal === "bulk") return 1.1;
    return 1.0;
  }

  function avgInRange(logs, start, end) {
    let sum = 0, count = 0;
    logs.forEach(function (l) {
      if (l && l.log_date >= start && l.log_date <= end) {
        sum += Number(l.weight_kg) || 0;
        count++;
      }
    });
    return count > 0 ? sum / count : null;
  }

  function computeTrends(logs) {
    const sorted = (Array.isArray(logs) ? logs : []).slice().sort(function (a, b) {
      return String(a.log_date).localeCompare(String(b.log_date));
    });
    const result = { weightTrend7d: 0, weightTrend14d: 0, recentAvg: null };
    if (sorted.length < 2) return result;

    const latestDate = sorted[sorted.length - 1].log_date;
    const recent = avgInRange(sorted, dateAddDays(latestDate, -6), latestDate);
    const prior = avgInRange(sorted, dateAddDays(latestDate, -13), dateAddDays(latestDate, -7));
    const older = avgInRange(sorted, dateAddDays(latestDate, -20), dateAddDays(latestDate, -14));

    result.recentAvg = recent;
    if (recent != null && prior != null) result.weightTrend7d = recent - prior;
    if (recent != null && older != null) result.weightTrend14d = recent - older;
    return result;
  }

  async function calibrateWeeklyTdee(weightLogs, dailyLogs, profile) {
    const base = calculateTargets(profile);
    const baseTdee = base.tdee;
    const goal = (profile && profile.goal_mode) || "維持";

    const trend = computeTrends(weightLogs);

    let adjustment = 0;
    let calibrationNote = "本週無需校正";

    if (goal === "減脂" || goal === "cut") {
      if (trend.weightTrend7d > T.cutTooSlow7d && trend.weightTrend14d > T.cutTooSlow14d) {
        adjustment = -ADJUST_KCAL;
        calibrationNote = "體重連續2週未如預期下降，下修" + ADJUST_KCAL + "kcal";
      } else if (trend.weightTrend7d < T.cutTooFast) {
        adjustment = ADJUST_KCAL;
        calibrationNote = "體重下降速度過快，上修" + ADJUST_KCAL + "kcal";
      }
    } else if (goal === "增肌" || goal === "bulk") {
      if (trend.weightTrend7d < T.bulkTooSlow) {
        adjustment = ADJUST_KCAL;
        calibrationNote = "增肌體重成長過慢，上修" + ADJUST_KCAL + "kcal";
      } else if (trend.weightTrend7d > T.bulkTooFast) {
        adjustment = -ADJUST_KCAL;
        calibrationNote = "增肌體重成長過快，下修" + ADJUST_KCAL + "kcal";
      }
    } else {
      if (trend.weightTrend7d > T.maintainUp) {
        adjustment = -ADJUST_KCAL;
        calibrationNote = "維持期體重上升，下修" + ADJUST_KCAL + "kcal";
      } else if (trend.weightTrend7d < T.maintainDown) {
        adjustment = ADJUST_KCAL;
        calibrationNote = "維持期體重下降，上修" + ADJUST_KCAL + "kcal";
      }
    }

    const estimatedTdee = round1(baseTdee + adjustment);
    let targetKcal = estimatedTdee * goalMultiplier(goal);

    const floor = isMale(profile) ? 1500 : 1200;
    if (targetKcal < floor) targetKcal = floor;
    targetKcal = round1(targetKcal);

    const note = "本週你的每日預算是 " + targetKcal + " kcal";

    try {
      await saveTdeeCalibration({
        week_start_date: weekStartOfToday(),
        weight_trend_7d_avg: trend.recentAvg != null ? round1(trend.recentAvg) : null,
        estimated_tdee: estimatedTdee,
        target_kcal: targetKcal,
        calibration_note: calibrationNote,
      });
    } catch (e) {
      // 寫入失敗不影響回傳
    }

    return {
      weightTrend7d: round1(trend.weightTrend7d),
      estimatedTdee: estimatedTdee,
      targetKcal: targetKcal,
      note: note,
    };
  }

  window.calibrateWeeklyTdee = calibrateWeeklyTdee;
})();
