// 輕盈計畫 — 今日建議頂部卡的裝飾元件資料（decisions #160）：已吃比例圓環、本週每天熱量長條、飯糰角色的一句話。
// 只算資料，不碰畫面；怎麼顯示由 ui/today-hero.js 與各風格的 CSS 決定。今天日期由呼叫端傳入（章程 C1.1）。
// 章程 C4.13 不評判：這裡不判斷「達標」「超標」「吃太少」，不計天數，台詞不評論吃多吃少。
//
// 框架由 Opus 定（2026-11-21），實作者只填函式內容，不改函式名稱、參數、回傳格式；覺得要改就停下回報。

import { dateAddDays, mondayOf } from "../core/dates.js";
import { logsKcal } from "./meal-content.js";

// 已吃熱量占目標的百分比（四捨五入成整數，可以超過 100）。目標不是正數時回傳 null。
// eatenPct(412, 1778) → 23
export function eatenPct(eatenKcal, targetKcal) {
  if (!(targetKcal > 0)) return null;
  return Math.round((eatenKcal / targetKcal) * 100);
}

// 本週（週一到週日）每天記下的熱量，給長條圖用。
// weekLogs：週一到今天的 daily_log 陣列（tab-today.js 已經讀好的 weekLogs）；today：YYYY-MM-DD。
// 回傳 7 筆（週一在前）：{ date, kcal, ratio, isToday, isFuture }
//   kcal：當天紀錄的熱量合計（logsKcal），當天沒有任何紀錄或 date > today 時 null
//   ratio：kcal ÷ targetKcal，四捨五入到小數 2 位；kcal 為 null 或目標不是正數時 null（不封頂，畫面自己封頂）
//   isToday：date === today；isFuture：date > today
export function weekKcalBars(weekLogs, targetKcal, today) {
  const monday = mondayOf(today);
  const days = [];
  for (let i = 0; i < 7; i++) {
    const date = dateAddDays(monday, i);
    const isFuture = date > today;
    const dayLogs = isFuture ? [] : (weekLogs || []).filter(function (l) { return l.log_date === date; });
    const kcal = dayLogs.length > 0 ? logsKcal(dayLogs) : null;
    const ratio = kcal != null && targetKcal > 0 ? Math.round((kcal / targetKcal) * 100) / 100 : null;
    days.push({ date: date, kcal: kcal, ratio: ratio, isToday: date === today, isFuture: isFuture });
  }
  return days;
}

// 飯糰角色的一句話與表情。依序判斷，第一個符合的就回傳：
// input：{ loggedCount, allLogged, remainingKcal }；N＝Math.round(remainingKcal)
//   1. allLogged           → { text: "今天的餐都記好了", mood: "happy" }
//   2. remainingKcal <= 0  → { text: "今天的份額已經用完了", mood: "ok" }（排在 3 前面：還沒記但份額已是負的，不會出現「還能吃 -50 大卡」）
//   3. loggedCount === 0   → { text: "今天還能吃 N 大卡，慢慢來", mood: "hi" }
//   4. 其餘                → { text: "還能吃 N 大卡喔", mood: "cheer" }
// mood 只會是 "hi" | "ok" | "happy" | "cheer"（對應 images/skins/pastel/mascot-<mood>.png）。
export function heroMessage(input) {
  const n = Math.round(input.remainingKcal);
  if (input.allLogged) return { text: "今天的餐都記好了", mood: "happy" };
  if (input.remainingKcal <= 0) return { text: "今天的份額已經用完了", mood: "ok" };
  if (input.loggedCount === 0) return { text: "今天還能吃 " + n + " 大卡，慢慢來", mood: "hi" };
  return { text: "還能吃 " + n + " 大卡喔", mood: "cheer" };
}

// 給實作者：用得到的現成函式已經 import 好（dateAddDays、mondayOf、logsKcal）。
