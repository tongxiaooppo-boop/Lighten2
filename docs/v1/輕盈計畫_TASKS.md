# TASKS.md — 輕盈計畫 開發任務清單

給 Cline 或 Claude Code 使用。**每次只丟一個任務**，不要把整份 TECH-SPEC.md 一次全部要求實作。每個任務做完就用「完成標準」驗證過再進下一個。

任務之間有依賴順序，請照編號執行。

---

## Phase 1：網頁版（主線，唯一必做的階段）

> 開發前已確認：**只做純網頁版**，不包裝原生 App，跨平台（含 iPhone Safari）直接開網址就能用。所以下面沒有 Capacitor / APK / SQLite 相關任務。

### TASK 1 — 專案骨架
建立 `index.html`、`css/style.css`、`js/app.js` 空殼（都放在專案根目錄，不需要 `www/` 子目錄）。六個分頁 tab（基本資料/今日建議/週彈性帳本/本週總覽/運動紀錄/採買清單），每個分頁先放 `<h2>分頁名稱</h2>` 佔位即可。

**完成標準**：瀏覽器打開能看到6個tab，點擊能切換內容區塊。

---

### TASK 2 — database.js（Phase 1 / localforage版）
安裝 localforage（CDN引入）。在 `js/database.js` 實作 TECH-SPEC.md 第4.8節列出的所有函式。`user_profile` 存取務必是單例（saveProfile 永遠 upsert 同一筆，不新增第二筆）。

**完成標準**：`await getProfile()` 初始回傳 `null`；`saveProfile()` 後能拿回資料；重複呼叫 `saveProfile()` 不會累積出第二筆。

---

### TASK 3 — 種子資料 JSON
建立 `data/protein_sources.json`、`staples.json`、`sauce_methods.json`、`raw_ingredients.json`、`taiwan_items.json`，內容從 `輕盈計畫PRD_v4.0.md` 對應章節轉錄（見 TECH-SPEC.md 第6節），不要自己編。回報各檔案轉錄筆數。

**完成標準**：所有 JSON 檔案合法，raw_ingredients 27筆、taiwan_items 40筆。

---

### TASK 4 — nutrition.js（起點值）
實作 `js/engine/nutrition.js` 的 `calculateTargets(profile)`，公式照 TECH-SPEC.md 4.1節。3組測試案例用 `console.log` 驗證：
1. 175cm/70kg/30歲/男/中度活動(1.55)/減脂 → TDEE應約2554、目標約2043
2. 同上但改「維持」→ 目標應約等於TDEE
3. 160cm/50kg/25歲/女/久坐(1.2)/減脂 → 檢查是否觸發1200kcal安全下限

**完成標準**：誤差在±5kcal內。

---

### TASK 5 — 分頁一：基本資料 + weight_log
實作 `js/ui/tab-profile.js`：PRD 2.1–2.5節輸入欄位表單，「計算」按鈕呼叫 nutrition.js 並存進 database.js；另加「今日體重回填」小元件寫入 `weight_log`。

**完成標準**：填表按計算，畫面顯示數字；重新整理頁面資料還在；回填體重後 `getWeightLogs()` 能查到當天記錄。

---

### TASK 6 — budget.js + matcher.js
實作 `js/engine/budget.js` 的 `recalcTodayBudget`（TECH-SPEC 4.3節）與 `js/engine/matcher.js` 的 `checkHardConstraints`（4.4節）。先用寫死的假 `daily_log` 資料測試：記一筆早餐後，午/晚/宵夜配額應重新分配；刻意讓本週蛋白質不足，`proteinGapToday` 應回傳正確缺口值。

**完成標準**：console.log 驗證重算邏輯正確、硬約束缺口計算正確。

---

### TASK 7 — recommend.js + 分頁二：今日建議
實作 `recommend.js`，輸入 budget.js 與 matcher.js 的輸出，過濾 `recipe_templates`（先用 TASK 3 的三軸資料在記憶體中即時組合，不需預先展開成表），依 `recipe_feedback` 排序。實作 `tab-today.js` 顯示早/午/晚/宵夜推薦。

**完成標準**：「今日建議」分頁顯示4筆推薦；備餐時間改「幾乎無」時全部只剩🟢；對某個組合按倒讚後，該組合不再出現在推薦中。

---

### TASK 8 — feast.js + 分頁三：週彈性帳本
實作 `js/engine/feast.js`（`reserveFeast`/`confirmFeast`/`cancelFeast`/`planOverageSmoothing`，TECH-SPEC 4.6節）。`weekly_flex_ledger.cap_kcal` 依 goal_mode 與熱量赤字換算（**不讀取任何運動資料**）。實作 `tab-ledger.js`：上方顯示本週彈性點數進度條，中間是「預約大餐」表單（日期/餐別/小中大），下方是已預約清單（可確認/取消）。

**完成標準**：預約後點數進度條減少；取消預約後點數釋放回復；確認預約並記錄實際攝取後，用實際值覆蓋預估值重算點數；超額時 `planOverageSmoothing` 回傳的攤還天數與比例正確（比照 PRD 6.4節，單日不超15%、不破3.4節安全下限）。

---

### TASK 9 — tdee.js（週校正）
實作 `js/engine/tdee.js` 的 `calibrateWeeklyTdee`（TECH-SPEC 4.2節）。用假資料測試：連續2週體重下降速度低於預期時，校正後 `targetKcal` 應下修；下降過快時應上修。結果寫入 `tdee_calibration_log`。

**完成標準**：兩種情境的校正方向正確；UI（可先簡單顯示在基本資料頁）只顯示校正後的 `targetKcal` 數字，不顯示運動明細。

---

### TASK 10 — 分頁五：運動紀錄（獨立頁面）
實作 `js/ui/tab-exercise.js`：記錄運動項目/時長/強度（寫入 `exercise_log`，**不含熱量欄位**），顯示連續紀錄天數。此頁面在版面配置上必須與「週彈性帳本」「今日建議」分頁明確區隔，不得共用同一個畫面區塊或顯示同一句文案。

**完成標準**：記錄運動後連續天數正確累加；畫面上找不到任何「運動可換算XX大餐」或「還差X分鐘解鎖」字樣。

---

### TASK 11 — 分頁四：本週總覽
實作 `js/ui/tab-week.js`：列出本週 `daily_log`、彈性點數剩餘、蛋白質/纖維達成率，只顯示「週平均是否仍在目標內」，**不做逐日評判性呈現**（不用紅字/驚嘆號標記超吃）。

**完成標準**：畫面文案通過檢查：全站搜尋「補償」「贖罪」「代價」等字樣應為零筆。

---

### TASK 12 — RWD 手機版面檢查
在手機瀏覽器（iPhone Safari、Android Chrome）實測六個分頁的排版，檢查小螢幕字級可讀性、觸控區塊大小是否足夠。可用瀏覽器開發者工具的裝置模擬先過一輪，再用實機複測。

**完成標準**：手機瀏覽器打開操作一輪不跑版、按鈕好點、文字不擠壓。

---

## Phase 1.5（選用）：PWA 化

> 讓使用者可以在手機「加入主畫面」、離線也能開啟App殼，但**不是必要階段**——不做這步，純網頁版本來就能直接用。

### TASK 13 — manifest.json + service-worker.js
建立 `manifest.json`（App名稱「輕盈計畫」、圖示、`display: standalone`）與最簡單的 `service-worker.js`（快取 `index.html`/`css`/`js` 靜態資源，IndexedDB資料不受影響）。在 `index.html` 註冊。

**完成標準**：iPhone Safari「加入主畫面」後圖示與名稱正確，開啟後無瀏覽器網址列（standalone模式）；關閉網路後仍能打開App殼並讀取本機已存的資料。

---

## 之後（暫不排入本次開發，先不要做）
- 超商即食品資料庫
- 拍照辨識攝取記錄
- 穿戴裝置運動數據導入（僅供 `exercise_log` 參考，仍不做即時熱量換算展示）
- Firebase 雲端同步／備份（換裝置或清瀏覽器資料會遺失，若要解決才需要，屆時才引入 `user_id` 與後端）
- 原生 App 打包（Capacitor / Android APK / iOS）：目前確認只需網頁版，若未來真的需要上架或離線推播等原生能力，再另立規格評估
