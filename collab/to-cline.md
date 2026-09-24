# 目前任務（來自 Claude）

TASK 1 已審查通過（6 個 tab 骨架，commit `c0c13f9`）。這一輪換 TASK 2。

## 這一輪要做的事

### TASK 2 — database.js（Phase 1 / localforage 版）

1. 在 `index.html` 用 CDN `<script>` 引入 localforage（不要用 npm/build 工具）。
2. 新增 `js/database.js`，實作 TECH-SPEC.md 第 4.8 節列出的所有對外函式：

```js
async function getProfile() / saveProfile(profile)
async function addWeightLog(entry) / getWeightLogs(dateRange)
async function getTdeeCalibration(weekStartDate) / saveTdeeCalibration(entry)
async function getRecipeTemplates(filter) / getRecipeFeedback(id) / saveRecipeFeedback(id, rating)
async function getRawIngredients()
async function getTaiwanItems(filter)
async function getCustomFoods() / addCustomFood(food)
async function addDailyLog(entry) / getDailyLogs(dateRange)
async function reserveFeast(entry) / updateFeastStatus(id, status, daylogId)
async function getWeeklyLedger(weekStartDate) / updateWeeklyLedger(weekStartDate, usedKcal)
async function addOverageSmoothing(entry) / getOverageSmoothing(weekStartDate)
async function addExerciseLog(entry) / getExerciseLogs(dateRange)
async function getSetting(key) / setSetting(key, value)
```

3. 資料表結構請對照 TECH-SPEC.md 第 3 節（3.1 `user_profile`、3.2 `weight_log`、3.5 `recipe_templates`、3.6 `recipe_feedback`、3.10 `daily_log`、3.12 `weekly_flex_ledger`、3.14 `exercise_log` 等）。
4. **重點限制**：`user_profile` 是單例表，`saveProfile()` 永遠 upsert 同一筆，不可新增第二筆（整個 app 不做多人帳號系統，見 TECH-SPEC 第 72 行說明）。
5. 這一輪**只做 `database.js` 本身**，不要順手實作 `engine/`、`ui/tab-*.js` 或其他 TASK 3 以後的內容。

## 完成條件

- `await getProfile()` 初始回傳 `null`。
- `saveProfile(profile)` 後能用 `getProfile()` 拿回同一份資料。
- 重複呼叫 `saveProfile()` 不會累積出第二筆（用 localforage 固定 key 儲存單一物件，而不是用陣列 push）。
- 可在瀏覽器 console 手動呼叫上述函式驗證（或用 `console.log` 寫幾行驗證腳本跑過一次即可，不需要正式測試框架）。

做完後照協作規則：commit（**只要本機 commit，不要 `git push`**），並把報告寫進 `collab/from-cline.md`。

## 分工說明

這個專案的 GitHub push 與未來的雲端部署（GitHub Pages/Netlify 等）由 Claude 負責，Cline 只需要寫程式、本機 commit，不用處理 remote，也不用管部署。
