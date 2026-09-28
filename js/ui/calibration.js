// 體重趨勢校正的流程：讀資料庫 → engine/tdee.js 純函式計算 → 寫回。
// 同一天共用一次評估（今日建議、本週總覽、基本資料三個分頁同時要目標時不重複評估）。

import { dateAddDays } from "../core/dates.js";
import { getTdeeState, saveTdeeState, getWeightLogs, getDailyLogs } from "../data/db.js";
import {
  evaluateCalibration, confirmPending, dismissPending, resetOffset, calibratedTargets,
  defaultTdeeState, LOOKBACK_DAYS, WINDOW_DAYS,
} from "../engine/tdee.js";
import { todayStr } from "./clock.js";

export async function loadTdeeState() {
  return (await getTdeeState()) || defaultTdeeState();
}

async function evaluate(profile, force) {
  const today = todayStr();
  const [state, weightLogs, dailyLogs] = await Promise.all([
    loadTdeeState(),
    getWeightLogs({ start: dateAddDays(today, -(LOOKBACK_DAYS - 1)) }),
    getDailyLogs({ start: dateAddDays(today, -(WINDOW_DAYS - 1)), end: today }),
  ]);
  const r = evaluateCalibration(state, profile, weightLogs, dailyLogs, today, { force: force });
  if (r.save) await saveTdeeState(r.state);
  return r.state;
}

let dailyCalibration = null;

// 刻意不用 async，讓同一天的呼叫端拿到同一個 Promise 物件。
export function ensureDailyCalibration(profile) {
  const today = todayStr();
  if (dailyCalibration && dailyCalibration.date === today) return dailyCalibration.promise;
  // 評估失敗時清掉快取再往外丟：不然失敗的 Promise 會被快取一整天，當天所有取目標的地方都跟著失敗。
  const promise = evaluate(profile, false).catch(function (err) {
    if (dailyCalibration && dailyCalibration.promise === promise) dailyCalibration = null;
    throw err;
  });
  dailyCalibration = { date: today, promise: promise };
  return promise;
}

// 清掉「今天已評估」的快取（資料整批換掉時用，例如之後的匯入；diff-recs 每個情境也用它）。
export function clearCalibrationCache() {
  dailyCalibration = null;
}

// 記錄體重成功／按「計算」存完 profile 後：強制重跑一次評估。
export function runCalibrationNow(profile) {
  dailyCalibration = null;
  return evaluate(profile, true);
}

async function applyAction(fn) {
  const state = await loadTdeeState();
  const next = fn(state, todayStr());
  if (!next) return state;
  await saveTdeeState(next);
  return next;
}

export function confirmPendingCalibration() { return applyAction(confirmPending); }
export function dismissPendingCalibration() { return applyAction(dismissPending); }
export function resetCalibrationOffset() { return applyAction(resetOffset); }

// 取得校正後的目標（含 offset）。所有分頁取目標都走這個函式；dateStr 省略＝今天。
export async function getCalibratedTargets(profile, dateStr) {
  await ensureDailyCalibration(profile);
  const state = await loadTdeeState();
  return calibratedTargets(profile, state, dateStr || todayStr());
}
