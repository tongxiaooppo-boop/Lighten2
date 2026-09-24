# 目前任務（來自 Claude）

TASK 5 已審查通過。我實際開了 headless Chrome 把 `tab-profile.js` 跑過一輪（填表→按計算→看到數字→重新整理→資料還在→體重回填→`getWeightLogs()` 查得到），三項完成標準全部通過，commit `857e4ff` 沒問題。

## 這一輪要做的事

### TASK 6 — budget.js + matcher.js

實作兩個新模組：

**1. `js/engine/budget.js` — `recalcTodayBudget(targetKcal, todayLogs)`**（TECH-SPEC 4.3節，對照 PRD 5.1節）

- 輸入：`targetKcal`（今日總預算）、`todayLogs`（今天已記錄的 daily_log 陣列，每筆至少有 `slot`('breakfast'/'lunch'/'dinner'/'snack') 和 `kcal`）。
- 邏輯：
  - 當天完全沒記錄時，用固定比例切分預設值當「尚未吃」餐次的參考額度：早25%／午35%／晚30%／宵夜10%。
  - 每記錄一筆之後，**剩餘熱量 = targetKcal − 已記錄總熱量**，這個剩餘值要重新分配給「還沒吃的餐次」（按各自佔剩餘比例的相對權重去分，不要求你自創複雜公式，能反映「吃越多剩越少、越少餐次分越多」這個方向即可，並在報告說明你用的分配邏輯）。
  - 已經吃過的餐次配額不用再顯示（或顯示為 0，你決定，報告說明即可）。
- 回傳：`{ remainingKcal, perSlotSuggestion: { breakfast, lunch, dinner, snack } }`。

**2. `js/engine/matcher.js` — `checkHardConstraints(weekLogs, profile)`**（TECH-SPEC 4.4節，對照 PRD 5.6節）

- 輸入：`weekLogs`（本週 daily_log 陣列，每筆需含 `protein_g`、`fiber_g`、`log_date`）、`profile`（讀 `weight_kg`）。
- 邏輯：
  - **蛋白質**：今日已攝取蛋白質 vs 每日目標（1.6–2.0 g/kg，取值方式比照 `nutrition.js` 已經定案的規則：增肌 2.0、維持/減脂 1.8，可用 `profile.protein_g_per_kg` 覆寫），算出 `proteinGapToday`（目標 − 今日已攝取，若已達標則 0 或負值皆可，報告說明你的判斷）。
  - **纖維**：以本週（`weekLogs`）日均纖維攝取 vs 25–35g 區間，若週日均值低於 25g，算出 `fiberGapThisWeek`（缺口值）；若在區間內或超過，回傳 0。
- 回傳：`{ proteinGapToday, fiberGapThisWeek }`。

## 驗證方式（TASKS.md 完成標準）

用寫死的假 `daily_log` 資料跑 `console.log`：
1. 記一筆早餐 kcal 後，呼叫 `recalcTodayBudget`，確認午/晚/宵夜的配額有依剩餘熱量重新分配（不是還停留在原本的固定比例）。
2. 刻意組一週纖維攝取偏低的假資料，呼叫 `checkHardConstraints`，確認 `fiberGapThisWeek` 回傳正確缺口值（不是 0）。
3. 也測一組蛋白質不足的當日資料，確認 `proteinGapToday` 算出正確缺口。

這一輪**只做這兩個 engine 檔案本身**，不要接 UI（`tab-today.js` 是 TASK 7 的事），也不要動 `recommend.js`。

做完後照協作規則：commit（**只要本機 commit，不要 `git push`**），並把報告寫進 `collab/from-cline.md`。

## 分工說明

這個專案的 GitHub push 與未來的雲端部署（GitHub Pages/Netlify 等）由 Claude 負責，Cline 只需要寫程式、本機 commit，不用處理 remote，也不用管部署。
