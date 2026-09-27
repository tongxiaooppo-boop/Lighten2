// 輕盈計畫 (Lighten Plan) — 體重趨勢自動校正每日目標熱量
// 對照 TECH-SPEC 4.2、PRD 3.7，以及 collab/opus-review-log/2026-09-27-tdee-calibration-offset-wiring.md 第 3 節。
// 長期熱量盈餘不再用週彈性帳本處理：看 28 天內原始體重量測的線性回歸斜率（EWMA 只用於顯示），
// 依 goal_mode（減脂/維持/增肌）各自不同的觸發門檻做校正。維持模式「下修」目標熱量必須使用者按確認，
// 其他方向（減脂/增肌的校正、維持模式的上修）自動套用。每次調整幅度上限 ±300kcal（累計 offset），
// 修正後 14 天冷卻期，隔天生效不中途改當天配額。

(function () {
  "use strict";

  const ALPHA = 0.1;            // 每日 EWMA 係數
  const MAX_GAP_DAYS = 7;       // 缺測天數上限，用來限制補量權重
  const LOOKBACK_DAYS = 56;     // 讀 56 天體重：前 28 天讓 EWMA 暖機，後 28 天做迴歸
  const WINDOW_DAYS = 28;
  const ADJUST_KCAL = 150;
  const OFFSET_CAP = 300;
  const COOLDOWN_DAYS = 14;
  const DISMISS_DAYS = 14;
  const ANNOUNCE_DAYS = 3;
  const MIN_WEIGHINS = 8;       // 28 天窗內至少 8 次量測
  const MIN_SPAN_DAYS = 21;     // 窗內第一次到最後一次量測至少相隔 21 天
  const MAX_STALE_DAYS = 7;     // 最後一次量測距今不超過 7 天

  // 門檻表：28 天迴歸斜率，單位 kg/週。維持模式下修要使用者確認（confirm: true）。
  const RULES = {
    cut: [
      { when: function (s) { return s > -0.2; }, delta: -150 }, // 下降太慢
      { when: function (s) { return s < -1.0; }, delta: +150 }, // 下降太快
    ],
    bulk: [
      { when: function (s) { return s < 0.1; }, delta: +150 },  // 增加太慢
      { when: function (s) { return s > 1.0; }, delta: -150 },  // 增加太快
    ],
    maintain: [
      { when: function (s) { return s > 0.5; }, delta: -150, confirm: true }, // 維持模式下修，要確認
      { when: function (s) { return s < -0.5; }, delta: +150 },               // 維持模式上修，自動
    ],
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

  function diffDays(a, b) {
    const da = new Date(a + "T00:00:00");
    const db = new Date(b + "T00:00:00");
    return Math.round((db - da) / 86400000);
  }

  function clamp(n, lo, hi) {
    return Math.min(hi, Math.max(lo, n));
  }

  // goal_mode 中英文 key 正規化，跟 nutrition.js 同一套對照（減脂→cut、增肌→bulk、其他→maintain）。
  function normalizeGoal(goal) {
    const g = String(goal || "").trim().toLowerCase();
    if (g === "減脂" || g === "cut") return "cut";
    if (g === "增肌" || g === "bulk") return "bulk";
    return "maintain";
  }

  // 取某一天生效的 offset：effective_date 之前（含今天）用 prev_offset_kcal，之後用 offset_kcal。
  function offsetForDate(state, dateStr) {
    if (state.effective_date && dateStr < state.effective_date) return state.prev_offset_kcal;
    return state.offset_kcal;
  }

  function pushHistory(state, entry) {
    if (!Array.isArray(state.history)) state.history = [];
    state.history.push(entry);
    if (state.history.length > 20) state.history = state.history.slice(-20);
  }

  // EWMA：處理量測天數不固定的情況。初始值取最早 3 筆量測平均，逐日推進到今天，
  // 有量測的那天用 α_eff = 1 - (1-ALPHA)^g（g = 距上次量測天數，上限 7）更新，沒量測就沿用前一天。
  function buildEwmaByDate(sorted) {
    const ewmaByDate = {};
    if (sorted.length === 0) return ewmaByDate;

    const byDate = {};
    sorted.forEach(function (l) {
      byDate[l.log_date] = Number(l.weight_kg) || 0;
    });

    const init = sorted.slice(0, 3);
    let ewma = init.reduce(function (s, l) { return s + (Number(l.weight_kg) || 0); }, 0) / init.length;

    const firstDate = sorted[0].log_date;
    const today = fmt(new Date());
    let lastMeasureDate = null;

    for (let d = firstDate; d <= today; d = dateAddDays(d, 1)) {
      if (byDate.hasOwnProperty(d)) {
        const w = byDate[d];
        let g = lastMeasureDate == null ? 1 : diffDays(lastMeasureDate, d);
        if (g > MAX_GAP_DAYS) g = MAX_GAP_DAYS;
        if (g < 1) g = 1;
        const alphaEff = 1 - Math.pow(1 - ALPHA, g);
        ewma += alphaEff * (w - ewma);
        lastMeasureDate = d;
      }
      ewmaByDate[d] = ewma;
    }
    return ewmaByDate;
  }

  // 28 天線性回歸（OLS），直接用窗內的「原始量測值」做迴歸，回傳斜率（kg/週）。
  // 2026-09-27 整案審查 A6：原本用每天的 EWMA 值做迴歸，EWMA 在資格門檻剛滿足時還沒暖機完成，
  // 斜率被系統性壓扁（實際 −1.2 kg/週在第 22–28 天只估出 −0.7），新使用者會被誤判成「下降太慢」而自動下修。
  // OLS 本身就能平均掉單次水腫雜訊；EWMA 只留給畫面顯示「目前趨勢體重」用。
  function slopePerWeek(measurements) {
    if (measurements.length < 2) return null;
    const origin = measurements[0].log_date;
    let sx = 0, sy = 0, sxy = 0, sxx = 0;
    const n = measurements.length;
    measurements.forEach(function (m) {
      const x = diffDays(origin, m.log_date);
      const y = Number(m.weight_kg) || 0;
      sx += x;
      sy += y;
      sxy += x * y;
      sxx += x * x;
    });
    const denom = n * sxx - sx * sx;
    if (denom === 0) return 0;
    const slopePerDay = (n * sxy - sx * sy) / denom;
    return slopePerDay * 7;
  }

  // 評估校正（log 檔第 3 節列的 12 個步驟依序執行）。
  async function evaluateCalibration(profile, opts) {
    const force = !!(opts && opts.force);
    const today = fmt(new Date());
    const state = await getTdeeState();
    const result = {
      date: today,
      status: "ok",
      slope_kg_per_week: null,
      ewma_latest_kg: null,
      n_weighins: 0,
      note: "",
    };

    // 第 1 步：profile 不存在直接 return。
    if (!profile) {
      state.last_result = result;
      await saveTdeeState(state);
      return state;
    }

    const goalMode = normalizeGoal(profile.goal_mode);

    // 第 2 步：偵測模式切換（offset 保留，pending 清掉，迴歸窗從 mode_since_date 起算）。
    if (state.goal_mode !== goalMode) {
      if (state.goal_mode != null) {
        state.mode_since_date = today;
        state.pending = null;
        state.dismissed_until = null;
        pushHistory(state, { date: today, from: state.goal_mode, to: goalMode, source: "mode_change", slope_kg_per_week: null });
      }
      state.goal_mode = goalMode;
    }

    // 第 3 步：每日防重跑（force 才強制重跑）。
    if (!force && state.last_evaluated_date === today) {
      return state;
    }

    // 第 4 步：讀體重、算 EWMA 與斜率、資料不足判斷。
    const lookbackStart = dateAddDays(today, -(LOOKBACK_DAYS - 1));
    const weightLogs = await getWeightLogs({ start: lookbackStart });
    const sorted = (Array.isArray(weightLogs) ? weightLogs : []).slice().sort(function (a, b) {
      return String(a.log_date).localeCompare(String(b.log_date));
    });

    const regStart = dateAddDays(today, -(WINDOW_DAYS - 1));
    const windowStart = state.mode_since_date && state.mode_since_date > regStart ? state.mode_since_date : regStart;

    const ewmaByDate = buildEwmaByDate(sorted);
    const ewmaLatest = ewmaByDate.hasOwnProperty(today)
      ? ewmaByDate[today]
      : (sorted.length ? Number(sorted[sorted.length - 1].weight_kg) || 0 : null);

    const measurements = sorted.filter(function (l) {
      return l.log_date >= windowStart && l.log_date <= today;
    });
    const slope = slopePerWeek(measurements);
    const nWeighins = measurements.length;
    let spanDays = 0;
    if (measurements.length >= 2) {
      spanDays = diffDays(measurements[0].log_date, measurements[measurements.length - 1].log_date);
    }
    const lastDate = sorted.length ? sorted[sorted.length - 1].log_date : null;
    const staleDays = lastDate ? diffDays(lastDate, today) : Infinity;

    result.slope_kg_per_week = slope == null ? null : round1(slope);
    result.ewma_latest_kg = ewmaLatest == null ? null : round1(ewmaLatest);
    result.n_weighins = nWeighins;

    const insufficient =
      nWeighins < MIN_WEIGHINS || spanDays < MIN_SPAN_DAYS || staleDays > MAX_STALE_DAYS;

    if (insufficient) {
      if (state.pending) {
        pushHistory(state, { date: today, from: state.offset_kcal, to: state.offset_kcal, source: "expired", slope_kg_per_week: result.slope_kg_per_week });
        state.pending = null;
      }
      result.status = "insufficient";
      state.last_result = result;
      state.last_evaluated_date = today;
      await saveTdeeState(state);
      return state;
    }

    // 第 5 步：找符合的規則。
    const rules = RULES[goalMode] || [];
    let rule = null;
    for (let i = 0; i < rules.length; i++) {
      if (slope != null && rules[i].when(slope)) {
        rule = rules[i];
        break;
      }
    }

    if (!rule) {
      if (state.pending) {
        pushHistory(state, { date: today, from: state.offset_kcal, to: state.offset_kcal, source: "expired", slope_kg_per_week: result.slope_kg_per_week });
        state.pending = null;
      }
      result.status = "ok";
      state.last_result = result;
      state.last_evaluated_date = today;
      await saveTdeeState(state);
      return state;
    }

    const delta = rule.delta;
    const needsConfirm = !!rule.confirm;

    // 第 6 步：冷卻期。
    if (state.last_adjusted_date && diffDays(state.last_adjusted_date, today) < COOLDOWN_DAYS) {
      if (state.pending) {
        pushHistory(state, { date: today, from: state.offset_kcal, to: state.offset_kcal, source: "expired", slope_kg_per_week: result.slope_kg_per_week });
        state.pending = null;
      }
      result.status = "cooldown";
      state.last_result = result;
      state.last_evaluated_date = today;
      await saveTdeeState(state);
      return state;
    }

    // 第 7 步：累計上限 clamp（±300）。
    const proposed = clamp(state.offset_kcal + delta, -OFFSET_CAP, OFFSET_CAP);
    if (proposed === state.offset_kcal) {
      if (state.pending) {
        pushHistory(state, { date: today, from: state.offset_kcal, to: state.offset_kcal, source: "expired", slope_kg_per_week: result.slope_kg_per_week });
        state.pending = null;
      }
      result.status = "capped";
      state.last_result = result;
      state.last_evaluated_date = today;
      await saveTdeeState(state);
      return state;
    }

    // 第 8 步：已到熱量下限。
    if (delta < 0) {
      const cur = calculateTargets(profile, { offsetKcal: offsetForDate(state, today) }).targetKcal;
      const nxt = calculateTargets(profile, { offsetKcal: proposed }).targetKcal;
      if (nxt >= cur) {
        if (state.pending) {
          pushHistory(state, { date: today, from: state.offset_kcal, to: state.offset_kcal, source: "expired", slope_kg_per_week: result.slope_kg_per_week });
          state.pending = null;
        }
        result.status = "at_floor";
        state.last_result = result;
        state.last_evaluated_date = today;
        await saveTdeeState(state);
        return state;
      }
    }

    // 第 9 步：下修前的攝取紀錄檢查（防「吃多→體重沒降→目標被自動調更低」的棘輪）。
    if (delta < 0) {
      const dailyLogs = await getDailyLogs({ start: windowStart, end: today });
      const byDate = {};
      dailyLogs.forEach(function (l) {
        if (!l || !l.log_date) return;
        if (!byDate[l.log_date]) byDate[l.log_date] = [];
        byDate[l.log_date].push(l);
      });
      const completeDates = Object.keys(byDate).filter(function (d) {
        return d >= windowStart && d <= today && isCompleteLogDay(byDate[d], profile.enabled_slots);
      });
      const completeDays = completeDates.length;
      let avgIntake = 0;
      if (completeDays > 0) {
        let total = 0;
        completeDates.forEach(function (d) {
          total += byDate[d].reduce(function (s, l) { return s + (Number(l.kcal) || 0); }, 0);
        });
        avgIntake = total / completeDays;
      }
      const curTarget = calculateTargets(profile, { offsetKcal: offsetForDate(state, today) }).targetKcal;
      if (completeDays < 14 || avgIntake > curTarget * 1.10) {
        if (state.pending) {
          pushHistory(state, { date: today, from: state.offset_kcal, to: state.offset_kcal, source: "expired", slope_kg_per_week: result.slope_kg_per_week });
          state.pending = null;
        }
        // 「記錄天數不夠」跟「攝取偏高」分開，畫面才不會對只是記錄不完整的人說攝取偏高（整案審查 B2）。
        result.status = completeDays < 14 ? "intake_log_short" : "intake_high";
        if (result.status === "intake_high") {
          // 給畫面直接陳述數字與規則用，不做「體重變化是因為吃多」這種歸因。
          result.avg_intake_kcal = Math.round(avgIntake);
          result.target_kcal = Math.round(curTarget);
        }
        state.last_result = result;
        state.last_evaluated_date = today;
        await saveTdeeState(state);
        return state;
      }
    }

    // 第 10 步：需要確認的情況（只有維持模式下修）。
    if (needsConfirm) {
      if (state.dismissed_until && today < state.dismissed_until) {
        if (state.pending) {
          pushHistory(state, { date: today, from: state.offset_kcal, to: state.offset_kcal, source: "expired", slope_kg_per_week: result.slope_kg_per_week });
          state.pending = null;
        }
        result.status = "dismissed";
        state.last_result = result;
        state.last_evaluated_date = today;
        await saveTdeeState(state);
        return state;
      }
      if (state.pending) {
        state.pending.slope_kg_per_week = round1(slope);
        state.pending.ewma_latest_kg = ewmaLatest == null ? null : round1(ewmaLatest);
      } else {
        state.pending = {
          delta_kcal: delta,
          proposed_offset_kcal: proposed,
          created_date: today,
          slope_kg_per_week: round1(slope),
          ewma_latest_kg: ewmaLatest == null ? null : round1(ewmaLatest),
          goal_mode: goalMode,
        };
      }
      result.status = "pending";
      state.last_result = result;
      state.last_evaluated_date = today;
      await saveTdeeState(state);
      return state;
    }

    // 第 11 步：自動套用。
    applyOffset(state, proposed, "auto");
    result.status = "adjusted";
    state.last_result = result;
    state.last_evaluated_date = today;
    await saveTdeeState(state);
    return state;
  }

  // 套用一個新 offset：隔天生效，開始 14 天冷卻期，更新 history。
  function applyOffset(state, newOffset, source) {
    const today = fmt(new Date());
    const prev = offsetForDate(state, today);
    state.prev_offset_kcal = prev;
    state.offset_kcal = newOffset;
    state.effective_date = dateAddDays(today, 1);
    state.last_adjusted_date = today;
    state.pending = null;
    state.dismissed_until = null;
    state.announce_until = dateAddDays(state.effective_date, ANNOUNCE_DAYS - 1);
    pushHistory(state, { date: today, from: prev, to: newOffset, source: source, slope_kg_per_week: state.last_result ? state.last_result.slope_kg_per_week : null });
  }

  // 同一天共用一個 Promise，避免 today/week/profile 三個分頁同時觸發三次評估。
  // 注意：刻意不用 async，讓呼叫端拿到的就是同一個 Promise 物件（不是 async 包一層新 wrapper）。
  let dailyCalibration = null;
  function ensureDailyCalibration(profile) {
    const today = fmt(new Date());
    if (dailyCalibration && dailyCalibration.date === today) return dailyCalibration.promise;
    // 評估失敗時清掉快取再往外丟：原本失敗的 Promise 會被快取一整天，當天所有取目標的地方都跟著失敗。
    const promise = evaluateCalibration(profile, { force: false }).catch(function (err) {
      if (dailyCalibration && dailyCalibration.promise === promise) dailyCalibration = null;
      throw err;
    });
    dailyCalibration = { date: today, promise: promise };
    return promise;
  }

  // 記錄體重成功／onCalculate 存完 profile 後呼叫：強制重跑一次評估。
  async function runCalibrationNow(profile) {
    dailyCalibration = null;
    return evaluateCalibration(profile, { force: true });
  }

  async function confirmPendingCalibration() {
    const state = await getTdeeState();
    if (!state.pending) return state;
    applyOffset(state, state.pending.proposed_offset_kcal, "confirmed");
    state.last_result = {
      date: fmt(new Date()),
      status: "adjusted",
      slope_kg_per_week: state.history.length ? state.history[state.history.length - 1].slope_kg_per_week : null,
      ewma_latest_kg: null,
      n_weighins: 0,
      note: "已套用調整",
    };
    await saveTdeeState(state);
    return state;
  }

  async function dismissPendingCalibration() {
    const state = await getTdeeState();
    if (!state.pending) return state;
    const today = fmt(new Date());
    state.pending = null;
    state.dismissed_until = dateAddDays(today, DISMISS_DAYS);
    pushHistory(state, { date: today, from: state.offset_kcal, to: state.offset_kcal, source: "dismissed", slope_kg_per_week: null });
    state.last_result = {
      date: today,
      status: "dismissed",
      slope_kg_per_week: null,
      ewma_latest_kg: null,
      n_weighins: 0,
      note: "",
    };
    await saveTdeeState(state);
    return state;
  }

  async function resetCalibrationOffset() {
    const state = await getTdeeState();
    applyOffset(state, 0, "reset");
    state.last_result = {
      date: fmt(new Date()),
      status: "ok",
      slope_kg_per_week: null,
      ewma_latest_kg: null,
      n_weighins: 0,
      note: "已重設校正",
    };
    await saveTdeeState(state);
    return state;
  }

  // 取得校正後的目標（含 offset）。所有分頁取目標都應走這個函式。
  async function getCalibratedTargets(profile, dateStr) {
    await ensureDailyCalibration(profile);
    const state = await getTdeeState();
    return calculateTargets(profile, { offsetKcal: offsetForDate(state, dateStr || fmt(new Date())) });
  }

  window.ensureDailyCalibration = ensureDailyCalibration;
  window.runCalibrationNow = runCalibrationNow;
  window.confirmPendingCalibration = confirmPendingCalibration;
  window.dismissPendingCalibration = dismissPendingCalibration;
  window.resetCalibrationOffset = resetCalibrationOffset;
  window.getCalibratedTargets = getCalibratedTargets;
})();
