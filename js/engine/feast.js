// 輕盈計畫 (Lighten Plan) — 大餐預約/確認/取消 + 超額攤還（週彈性帳本）
// 對照 TECH-SPEC 4.6、PRD 6.2–6.4。cap_kcal 只依 goal_mode 與熱量赤字換算，不讀運動資料。

(function () {
  "use strict";

  // 小/中/大份量 → 估算 kcal（對照 TECH-SPEC 3.11 範例 S=400/M=700/L=1200）
  const FEAST_SIZE_KCAL = { S: 400, M: 700, L: 1200 };
  const CUT_CAP_RATIO = 0.4; // 減脂：取週熱量赤字的 40% 當週彈性上限
  const FLEX_CAP_FIXED = 1400; // 維持/增肌：固定額度（約 1 餐大份大餐 + 小彈性）

  function round1(n) { return Math.round(n * 10) / 10; }

  function fmt(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return y + "-" + m + "-" + day;
  }

  function weekStartOf(dateStr) {
    const d = new Date(dateStr + "T00:00:00");
    if (isNaN(d.getTime())) return dateStr;
    const day = d.getDay(); // 0=Sun
    const diff = day === 0 ? 6 : day - 1;
    d.setDate(d.getDate() - diff);
    return fmt(d);
  }

  function computeWeeklyCapKcal(profile) {
    const goal = (profile && profile.goal_mode) || "維持";
    if (goal === "減脂" || goal === "cut") {
      const t = calculateTargets(profile);
      const weeklyDeficit = (t.tdee - t.targetKcal) * 7;
      return Math.round(weeklyDeficit * CUT_CAP_RATIO);
    }
    return FLEX_CAP_FIXED;
  }

  async function reserveFeast(planDate, slot, size) {
    const profile = await getProfile();
    const estimatedKcal = FEAST_SIZE_KCAL.hasOwnProperty(size) ? FEAST_SIZE_KCAL[size] : FEAST_SIZE_KCAL.M;

    const entry = { plan_date: planDate, slot: slot, size: size, estimated_kcal: estimatedKcal, status: "reserved" };
    const saved = await addFeastReservation(entry);

    const weekStart = weekStartOf(planDate);
    const ledger = await getWeeklyLedger(weekStart);
    const cap = ledger && ledger.cap_kcal != null ? ledger.cap_kcal : computeWeeklyCapKcal(profile);
    const prevUsed = ledger ? (ledger.used_kcal || 0) : 0;
    await updateWeeklyLedger(weekStart, prevUsed + estimatedKcal, cap);

    return saved;
  }

  async function confirmFeast(reservationId, actualDailyLogEntry) {
    const reservations = await getFeastReservations();
    const res = reservations.find(function (r) { return r.id === reservationId; });
    if (!res) return null;

    const actual = actualDailyLogEntry || {};
    const actualKcal = Number(actual.kcal) || res.estimated_kcal || 0;

    let daylogId = actual.id;
    if (!daylogId) {
      const entry = Object.assign({}, actual, {
        kcal: actualKcal,
        is_feast: 1,
        feast_reservation_id: reservationId,
        log_date: actual.log_date || res.plan_date,
        slot: actual.slot || res.slot,
      });
      daylogId = (await addDailyLog(entry)).id;
    }
    await updateFeastStatus(reservationId, "confirmed", daylogId);

    const weekStart = weekStartOf(res.plan_date);
    const ledger = await getWeeklyLedger(weekStart);
    if (ledger) {
      const newUsed = Math.max(0, (ledger.used_kcal || 0) - (res.estimated_kcal || 0) + actualKcal);
      await updateWeeklyLedger(weekStart, newUsed, ledger.cap_kcal);
    }
    return res;
  }

  async function cancelFeast(reservationId) {
    const reservations = await getFeastReservations();
    const res = reservations.find(function (r) { return r.id === reservationId; });
    if (!res) return null;

    await updateFeastStatus(reservationId, "cancelled");

    const weekStart = weekStartOf(res.plan_date);
    const ledger = await getWeeklyLedger(weekStart);
    if (ledger) {
      const newUsed = Math.max(0, (ledger.used_kcal || 0) - (res.estimated_kcal || 0));
      await updateWeeklyLedger(weekStart, newUsed, ledger.cap_kcal);
    }
    return res;
  }

  function planOverageSmoothing(overageKcal, upcomingDaysBudget, safetyFloor) {
    const raw = Array.isArray(upcomingDaysBudget) ? upcomingDaysBudget : [];
    const days = raw.map(function (d, i) {
      if (typeof d === "number") return { date: "day" + (i + 1), budget: d };
      return { date: d.date || ("day" + (i + 1)), budget: Number(d.budget) || 0 };
    });
    const floor = Number(safetyFloor) || 0;
    const DAILY_CAP_PCT = 0.15; // 單日攤還幅度上限 15%
    const MAX_DAYS = 3; // 1–3 天攤還

    let remaining = Math.max(0, Number(overageKcal) || 0);
    const appliedDates = [];
    let smoothingDays = 0;

    for (let i = 0; i < Math.min(days.length, MAX_DAYS) && remaining > 0; i++) {
      const budget = days[i].budget;
      if (budget <= 0) continue;
      const capacity = Math.min(budget * DAILY_CAP_PCT, Math.max(0, budget - floor));
      if (capacity <= 0) continue;
      const reduce = Math.min(capacity, remaining);
      remaining -= reduce;
      smoothingDays++;
      appliedDates.push({ date: days[i].date, reduce_kcal: round1(reduce), new_budget: round1(budget - reduce) });
    }

    return {
      smoothingDays: smoothingDays,
      dailyCapPct: DAILY_CAP_PCT,
      appliedDates: appliedDates,
      remainingKcal: round1(remaining),
    };
  }

  window.reserveFeast = reserveFeast;
  window.confirmFeast = confirmFeast;
  window.cancelFeast = cancelFeast;
  window.planOverageSmoothing = planOverageSmoothing;
  window.computeWeeklyCapKcal = computeWeeklyCapKcal;
  window.FEAST_SIZE_KCAL = FEAST_SIZE_KCAL;
})();
