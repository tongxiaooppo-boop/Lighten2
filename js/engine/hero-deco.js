// 輕盈計畫 — 今日建議頂部卡的裝飾元件資料（decisions #160）：已吃比例圓環、本週 7 天達標格、飯糰角色的一句話。
// 只算資料，不碰畫面；怎麼顯示由 ui/today-hero.js 與各風格的 CSS 決定。今天日期由呼叫端傳入（章程 C1.1）。
//
// 框架由 Opus 定（2026-11-21），實作者只填函式內容，不改函式名稱、參數、回傳格式；覺得要改就停下回報。

import { dateAddDays, mondayOf } from "../core/dates.js";
import { WEEK_HIT_LOW_RATIO, WEEK_HIT_HIGH_RATIO } from "../core/config.js";
import { isCompleteLogDay } from "./budget.js";
import { logKcal } from "./meal-content.js";

// 已吃熱量占目標的百分比（四捨五入成整數，可以超過 100）。目標不是正數時回傳 null。
// eatenPct(412, 1778) → 23
export function eatenPct(eatenKcal, targetKcal) {
  throw new Error("TODO eatenPct");
}

// 本週（週一到週日）每天的達標狀態。
// weekLogs：週一到今天的 daily_log 陣列（tab-today.js 已經讀好的 weekLogs）；today：YYYY-MM-DD。
// 回傳 { days: [{ date, state }] 共 7 筆（週一在前）, hits: state 為 "hit" 的天數 }。
// state：
//   "future"     date > today
//   "today"      date === today 且今天還沒記完（isCompleteLogDay 為 false）
//   "incomplete" date < today 且沒記完
//   記完的日子（含今天記完）依當天合計熱量 kcal 判斷：
//   "low"        kcal < target × WEEK_HIT_LOW_RATIO
//   "over"       kcal > target × WEEK_HIT_HIGH_RATIO
//   "hit"        其餘（兩端都算達標）
// targetKcal 不是正數時，記完的日子一律 "incomplete"、hits 0。
export function weekTargetDays(weekLogs, targetKcal, enabledSlots, today) {
  throw new Error("TODO weekTargetDays");
}

// 飯糰角色的一句話與表情。依序判斷，第一個符合的就回傳：
// input：{ loggedCount, allLogged, remainingKcal, eatenKcal, targetKcal }；N＝Math.round(remainingKcal)
//   1. allLogged 且 eatenKcal > target × WEEK_HIT_HIGH_RATIO → { text: "多一點點沒關係，明天再調整", mood: "cheer" }
//   2. allLogged 且 eatenKcal < target × WEEK_HIT_LOW_RATIO  → { text: "今天吃得有點少，記得吃飽喔", mood: "ok" }
//   3. allLogged                                               → { text: "今天都記完了，做得好！", mood: "happy" }
//   4. loggedCount === 0                                       → { text: "今天還能吃 N 大卡，慢慢來", mood: "hi" }
//   5. remainingKcal <= 0                                      → { text: "今天的份額用完了，下一餐清淡一點", mood: "cheer" }
//   6. 其餘                                                    → { text: "還能吃 N 大卡喔", mood: "ok" }
// mood 只會是 "hi" | "ok" | "happy" | "cheer"（對應 images/skins/pastel/mascot-<mood>.png）。
export function heroMessage(input) {
  throw new Error("TODO heroMessage");
}

// 給實作者：用得到的現成函式已經 import 好（dateAddDays、mondayOf、isCompleteLogDay、logKcal）。
