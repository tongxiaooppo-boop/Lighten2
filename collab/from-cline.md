# 來自 Cline 的報告（TASK 2）

## 這次改了什麼

- `index.html`（修改）：在 `js/app.js` 之前加入 localforage CDN（jsdelivr 1.10.0）與 `js/database.js` 的 `<script>`。
- `js/database.js`（新增）：唯一的資料存取層，實作 TECH-SPEC 4.8 節列出的**全部 26 個對外函式**（getProfile/saveProfile、weight_log、tdee_calibration_log、recipe_templates/feedback、raw_ingredients、taiwan_items、custom_foods、daily_log、feast_reservation、weekly_flex_ledger、overage_smoothing_log、exercise_log、settings）。

## 實作決策（對照 TECH-SPEC 第 3 節）

- **user_profile 單例**：固定 key `"primary"` 直接 `setItem` 覆寫，絕不 push 進陣列，保證只有一筆。
- **清單表**（weight_log / daily_log / exercise_log / recipe_templates / raw_ingredients / taiwan_items / custom_foods / feast_reservation / overage_smoothing_log）用固定 key `"items"` 存陣列。
- **主鍵查詢表**（tdee_calibration_log / recipe_feedback / weekly_flex_ledger / settings）直接以主鍵當 localforage key 存單一物件。
- 每個 store 用 `localforage.createInstance({ name: "lighten", storeName })` 建立，instance 有 cache。
- `weight_log` 採「同日覆寫」（同日重複回填體重只保留最後一筆）。
- `addDailyLog` / `addCustomFood` / `addExerciseLog` / `reserveFeast` / `addOverageSmoothing` 若未帶 id 會自動產生 `{prefix}_{時間戳36}_{隨機}`。
- 對外函式以 `Object.assign(window, api)` 暴露成 bare 全域函式，方便 console 直接 `await getProfile()` 驗證，也供後續 engine/ui 模組呼叫。

## 跑過的驗證

- `node --check js/database.js`：語法檢查通過。
- 用 Node + in-memory localforage mock 跑了功能驗證（暫存測試檔跑完已刪除），**全部通過**：
  - 初始 `getProfile()` 回傳 `null` ✓
  - `saveProfile()` 後 `getProfile()` 拿回同一份資料 ✓
  - 重複 `saveProfile()` 三次後，user_profile store 仍只有 1 個 key（不累積第二筆）✓
  - weight_log 同日覆寫、日期範圍過濾 ✓
  - daily_log 自動 id + 日期過濾 ✓
  - feast_reservation reserve→updateFeastStatus(confirmed, 關聯 daily_log_id) ✓
  - weekly_flex_ledger get 初始 null、update 後可讀 ✓
  - settings / recipe_feedback（shown_count 累加）/ overage_smoothing / exercise_log ✓
  - 空清單表的 get 回傳 `[]` 而非 null ✓
- 本機 `git commit` 完成（commit `f85e5f7`），未 `git push`。

## 需要 Claude／使用者決定的事

1. **`weekly_flex_ledger.cap_kcal` 沒有對應的 DB 寫入函式**：TECH-SPEC 4.8 只列了 `updateWeeklyLedger(weekStartDate, usedKcal)`（只能寫 used_kcal）。但 TASK 8 的 `feast.js` 需要依 goal_mode 換算 `cap_kcal` 並寫入。目前 `updateWeeklyLedger` 用 `Object.assign` 保留既有欄位，所以 cap_kcal 若不存在會是 undefined。**建議 TASK 8 時擴充**（例如讓 `updateWeeklyLedger` 接受第三個選填參數 `capKcal`，或新增 `setWeeklyLedgerCap()`），此處先照 4.8 字面實作。
2. **`getRecipeTemplates(filter)` / `getTaiwanItems(filter)` 的 filter 形狀**：TECH-SPEC 未定義。我先支援 `{ slot?, tier?, dietRestriction?, excludeAllergens? }` 四種，TASK 7 若需要不同欄位再擴充。

## 建議下一步

- 依 TASKS.md 執行 TASK 3（建立 `data/*.json` 種子資料，從 PRD 轉錄三軸、27 項原型食材、40 項台式排行）。
