// 讀時鐘的唯一地方（engine 不得讀時鐘，章程 C1.1）：今天日期與現在時間都從這裡取，再當參數傳給 engine。

import { fmtDate } from "../core/dates.js";

export function nowMs() {
  return Date.now();
}

export function todayStr() {
  return fmtDate(new Date(nowMs()));
}

export function nowIso() {
  return new Date(nowMs()).toISOString();
}
