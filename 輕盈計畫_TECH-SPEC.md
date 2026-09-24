# 輕盈計畫 (Lighten Plan) — 技術架構與規格書（開發用最終版）

> 本文件是給 VSCode + Cline 或 VSCode + Claude Code 的實作規格。業務邏輯（計算公式、推薦邏輯、週彈性點數與大餐預約制度）完整定義於 `輕盈計畫PRD_v4.0.md`，此文件**只定義如何把那份 PRD 變成程式**：架構、檔案結構、資料表、模組介面。實作時兩份文件都要看。

---

## 1. 技術棧決策（已定案，不需再討論）

| 項目 | 選擇 | 理由 |
|---|---|---|
| 前端 | **Vanilla JavaScript**，無框架 | 與既有專案一致，維護成本低 |
| 部署形態 | **純網頁 (Web App)**，不包裝原生 App | 開發前確認：只需要網頁版即可，跨平台（含 iPhone Safari）直接開網址就能用，不需要 Xcode/Apple Developer 年費，也不需要處理 Google Play 上架 |
| 資料庫 | **IndexedDB（localforage）**，單一儲存層，不預留 SQLite 遷移 | 瀏覽器本機儲存已足夠；沒有原生殼就不需要 SQLite |
| Build 工具 | **無**，純 `<script>` 標籤載入 | 降低環境問題 |
| 後端伺服器 | **無**（MVP 階段） | 單人使用的個人工具，見第 3 節「一人一帳」設計 |
| 發佈方式 | 部署到任一靜態網頁空間（例如 GitHub Pages / Netlify 免費方案），瀏覽器打開網址即可用；**可選**加上 PWA manifest 讓使用者「加入主畫面」，體感像 App 但完全免費、無需審核 | 個人使用，兩端（iOS/Android）用同一套網址 |
| 雲端同步 | 列為 Phase 2+（Firebase，選用） | MVP 不做，仍是本機資料為主 |

**架構鐵律**：
- 所有資料庫操作都**只能透過 `database.js` 存取**。
- 不使用任何前端框架，純 DOM 操作。
- 不引入 build 工具鏈。

---

## 2. 專案目錄結構

```
lighten/
├── index.html
├── css/
│   └── style.css
├── js/
│   ├── database.js         ← 唯一的資料存取層（IndexedDB / localforage）
│   ├── engine/
│   │   ├── nutrition.js    ← BMR/TDEE起點值/目標熱量/四大營養素（PRD 第3節）
│   │   ├── tdee.js         ← TDEE動態校正：體重趨勢+攝取記錄回歸（PRD 3.7節，新增）
│   │   ├── budget.js       ← 日總額×週彈性點數動態配額重算（PRD 5.1節，新增，取代固定比例）
│   │   ├── recommend.js    ← 今日食譜推薦邏輯（PRD 第5節）
│   │   ├── matcher.js      ← 蛋白質(日)/纖維(週)硬約束過濾（PRD 5.6節，新增）
│   │   ├── feast.js        ← 大餐預約/確認/取消 + 超額攤還（PRD 6.3–6.4節，新增，取代舊flex.js的運動換算部分）
│   │   └── shopping.js     ← 採買清單彙整邏輯（PRD 第7節）
│   ├── ui/
│   │   ├── tab-profile.js
│   │   ├── tab-today.js
│   │   ├── tab-ledger.js   ← 週彈性點數進度＋大餐預約（原 tab-flex.js 改名）
│   │   ├── tab-week.js
│   │   ├── tab-exercise.js ← 運動獨立紀錄頁（新增，與飲食頁面分離，PRD 6.5節）
│   │   └── tab-shopping.js
│   └── app.js
├── data/                   ← 種子資料
│   ├── protein_sources.json / staples.json / sauce_methods.json  ← 食譜模板三軸（PRD 4.2節，取代舊recipes.json）
│   ├── raw_ingredients.json← 原型食材資料庫（PRD 4.4節，27項）
│   └── taiwan_items.json   ← 台式熱門排行榜（PRD 4.3節，40項含熱量估算）
├── manifest.json            ← （可選，Phase 1.5）PWA 設定，讓使用者可在手機「加入主畫面」
├── service-worker.js        ← （可選，Phase 1.5）離線快取
├── 輕盈計畫PRD_v4.0.md          ← 業務邏輯規格（唯一真相來源）
├── 輕盈計畫_TECH-SPEC.md         ← 本文件
└── 輕盈計畫_TASKS.md             ← 給 Cline/Claude Code 的任務清單
```

**與 v4.0 初版的差異**：拿掉 `www/` 子目錄、`android/`、`capacitor.config.json` ——這些原本只是為了讓 Capacitor 把網頁包成原生 App 而存在。既然開發前就確認只需要網頁版，直接拿掉這層，所有檔案放在專案根目錄即可，減少一層無意義的路徑巢狀。

---

## 3. 資料表設計（IndexedDB / localforage 結構）

### 「一人一帳」設計原則

這是單人使用的個人工具，**不做多人帳號系統**：整個本機資料庫（瀏覽器的 IndexedDB）本身就代表「這個人的一筆帳」，所有資料表都不需要 `user_id` 外鍵。`user_profile` 表規定只允許存在一筆 row（單例寫入，`saveProfile()` 永遠是 upsert 同一筆）。所有紀錄（體重、飲食、運動、彈性點數）都直接歸屬這個唯一的本機帳本。若之後（Phase 2+）要做跨裝置同步，才需要引入帳號與 `user_id`／後端資料庫，MVP 不做。

**注意**：資料存在使用者瀏覽器的 IndexedDB 裡，換裝置或清瀏覽器資料會遺失，這是純網頁版的已知取捨（比包裝原生 App 簡單很多，但沒有雲端備份）。若之後需要「不怕換手機/清資料」，屬於 Phase 2+ 的 Firebase 雲端同步範疇。

每個資料表對應一個 localforage store，用陣列存 JSON；`database.js` 是唯一的存取層，其他模組一律透過它讀寫，不直接呼叫 localforage API。

### 3.1 `user_profile`（單筆，全域設定）
| 欄位 | 型別 | 說明 |
|---|---|---|
| age / gender / height_cm / weight_kg / body_fat_pct | — | 同 PRD 2.1節 |
| activity_mode / activity_value | — | PRD 2.2節，二擇一 |
| goal_mode | TEXT | 'cut' / 'maintain' / 'bulk' |
| diet_restriction / allergens | — | PRD 2.3節 |
| preptime_weekday / preptime_weekend | — | PRD 2.4節 |
| fiber_target_g | INTEGER | 預設30，範圍25–35，週日均值判定用 |

### 3.2 `weight_log`（新增，v4.0）
| 欄位 | 型別 | 說明 |
|---|---|---|
| log_date | TEXT PK | ISO日期 |
| weight_kg | REAL | 定期回填，供 `tdee.js` 計算7日移動平均 |

### 3.3 `tdee_calibration_log`（新增，v4.0）
| 欄位 | 型別 | 說明 |
|---|---|---|
| week_start_date | TEXT PK | 該週週一 |
| weight_trend_7d_avg | REAL | 7日體重移動平均 |
| estimated_tdee | REAL | 校正後 TDEE |
| target_kcal | REAL | 校正後每日預算，UI直接顯示這個數字 |
| calibration_note | TEXT | 內部除錯用（例如「體重連續2週未如預期下降，下修200kcal」），**不對使用者展示逐項運動明細** |

### 3.4 `protein_sources` / `staples` / `sauce_methods`（新增，v4.0，取代 `recipes`）
三軸各自一張小表：`id`、`name`、`kcal_100g`/`protein_100g`/`carb_100g`/`fat_100g`/`fiber_100g`（或每份標準克數的營養值）、`diet_tags`、`allergen_tags`、`prep_tier`（🟢/🟡/🔴，該軸帶來的備餐難度貢獻）。

### 3.5 `recipe_templates`（模板組合，可即時生成或預先展開存表）
| 欄位 | 型別 | 說明 |
|---|---|---|
| id | TEXT PK | `{protein_id}_{staple_id}_{sauce_id}` |
| slot | TEXT | 'breakfast'/'main'/'snack' |
| tier | TEXT | 由三軸最高難度決定 |
| kcal / protein_g / carb_g / fat_g / fiber_g | REAL | 三軸加總計算 |
| diet_tags / allergen_tags | TEXT | 三軸聯集 |

### 3.6 `recipe_feedback`（新增，v4.0，供 5.5節評分+降權排序）
| 欄位 | 型別 | 說明 |
|---|---|---|
| recipe_template_id | TEXT PK | |
| rating | TEXT | 'like' / 'dislike' / null(未評分) |
| last_shown_date | TEXT | 用於「近期出現降權」 |
| shown_count | INTEGER | |

### 3.7 `raw_ingredients`（原型食材，27項，同 v3.1）
### 3.8 `taiwan_items`（台式熱門排行榜，40項，同 v3.1，`kcal_low/kcal_high/kcal_rep`）
### 3.9 `custom_foods`（個人自訂，同 v3.1）

### 3.10 `daily_log`（實際攝取記錄）
| 欄位 | 型別 | 說明 |
|---|---|---|
| id | TEXT PK | |
| log_date / slot | — | |
| source_type | TEXT | 'recipe_template'/'taiwan_item'/'custom' |
| item_id / item_name | — | |
| kcal / protein_g / carb_g / fat_g / fiber_g | REAL | |
| is_feast | INTEGER | 0/1 |
| feast_reservation_id | TEXT NULL | 若由預約轉正式記錄，關聯 3.11 |

### 3.11 `feast_reservation`（新增，v4.0，取代舊 flex_quota_log 的預約角色）
| 欄位 | 型別 | 說明 |
|---|---|---|
| id | TEXT PK | |
| plan_date / slot | — | |
| size | TEXT | 'S'/'M'/'L'，對應概略估算 kcal（見 `settings` 內建對照表，例如 S=400/M=700/L=1200） |
| estimated_kcal | REAL | 依 size 換算或使用者微調 |
| status | TEXT | 'reserved' / 'confirmed' / 'cancelled' |
| daily_log_id | TEXT NULL | confirmed 後關聯 3.10 |

### 3.12 `weekly_flex_ledger`（新增，v4.0，取代舊 flex_quota_log 的額度角色）
| 欄位 | 型別 | 說明 |
|---|---|---|
| week_start_date | TEXT PK | |
| cap_kcal | REAL | 依 goal_mode 與熱量赤字換算的週彈性點數上限，**與運動無關** |
| used_kcal | REAL | 已確認的 feast + 台式原版選擇累計消耗點數 |

### 3.13 `overage_smoothing_log`（新增，v4.0）
| 欄位 | 型別 | 說明 |
|---|---|---|
| id | TEXT PK | |
| origin_week_start_date | TEXT | |
| overage_kcal | REAL | 超出週彈性點數的量 |
| smoothing_days | INTEGER | 1–3 |
| daily_cap_pct | REAL | ≤15% |
| applied_dates_json | TEXT | 已攤還到哪幾天，避免重複扣 |
| resolved | INTEGER | 0/1 |

### 3.14 `exercise_log`（獨立追蹤，v4.0，不含熱量換算欄位）
| 欄位 | 型別 | 說明 |
|---|---|---|
| id | TEXT PK | |
| log_date / activity_type / duration_min / intensity | — | 供成就系統與 `tdee.js` 週校正輸入，**不存 kcal 換算值**，不做逐筆熱量展示 |

### 3.15 `settings`（key-value）
存放小設定，例如 feast size→kcal 對照表、資料版本號。

---

## 4. 核心模組介面定義

### 4.1 `engine/nutrition.js`
```js
function calculateTargets(profile) {
  // 回傳: { bmr, tdee, targetKcal, flooredWarning, protein_g, fat_g, carb_g, fiber_g, netCarb_g }
  // 僅作起點值，PRD 第3節1–6項
}
```

### 4.2 `engine/tdee.js`（新增）
```js
// 輸入：weight_log 近8週資料、daily_log 近8週熱量加總
// 回傳：{ weightTrend7d, estimatedTdee, targetKcal, note }
function calibrateWeeklyTdee(weightLogs, dailyLogs, profile) {
  // 邏輯對照 PRD 3.7節：7日體重移動平均 + 實際攝取回歸校正
  // 寫入 tdee_calibration_log，UI 只顯示 targetKcal，不顯示逐項運動明細
}
```

### 4.3 `engine/budget.js`（新增，取代原固定比例拆解）
```js
// 輸入：targetKcal(當週校正值)、今日已記錄的 daily_log
// 回傳：{ remainingKcal, perSlotSuggestion: {breakfast, lunch, dinner, snack} }
function recalcTodayBudget(targetKcal, todayLogs) {
  // 邏輯對照 PRD 5.1節：無記錄時用 25/35/30/10 預設值切分；
  // 每筆記錄寫入後，剩餘熱量重新分配給未吃餐次
}
```

### 4.4 `engine/matcher.js`（新增）
```js
// 輸入：本週 daily_log、profile
// 回傳：{ proteinGapToday, fiberGapThisWeek }
function checkHardConstraints(weekLogs, profile) {
  // 邏輯對照 PRD 5.6節：蛋白質日底線 1.6-2.0g/kg、纖維週日均 25-35g
  // 回傳值供 recommend.js 優先安排高蛋白/高纖組合
}
```

### 4.5 `engine/recommend.js`
```js
function getTodayRecommendation(remainingBudget, hardConstraints, preptimeToday, dietRestriction, allergens) {
  // 過濾 recipe_templates，依 recipe_feedback 的評分+近期降權排序
  // 優先滿足 matcher.js 回傳的蛋白質/纖維缺口
}
```

### 4.6 `engine/feast.js`（新增，取代舊 flex.js 的運動換算函式）
```js
async function reserveFeast(planDate, slot, size) { /* 寫入 feast_reservation，狀態 reserved，占用 weekly_flex_ledger.used_kcal */ }
async function confirmFeast(reservationId, actualDailyLogEntry) { /* 狀態改 confirmed，用實際值取代預估值，重算 ledger */ }
async function cancelFeast(reservationId) { /* 狀態改 cancelled，釋放已占用點數 */ }

// 輸入：週彈性點數超額量
// 回傳：{ smoothingDays, dailyCapPct, appliedDates }
function planOverageSmoothing(overageKcal, upcomingDaysBudget, safetyFloor) {
  // 邏輯對照 PRD 6.4節：1-3天攤還、單日≤15%、不得低於3.4節安全下限
}
```

### 4.7 `engine/shopping.js`
（同 v3.1，輸入來源改為 recipe_templates 展開後的食材清單）

### 4.8 `database.js`（對外函式）
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

---

## 5. 開發階段

| 階段 | 內容 | 完成標準 |
|---|---|---|
| **Phase 1（網頁版，主線）** | 純網頁 + IndexedDB，六個分頁（基本資料/今日建議/週彈性帳本/本週總覽/運動紀錄/採買清單）全部可跑，手機/電腦瀏覽器都能用 | 輸入資料→算出目標→看到今日推薦→預約一次大餐→確認記錄→看到帳本更新；在手機 Safari/Chrome 打開網址操作一輪不跑版 |
| **Phase 1.5（PWA 化，選用）** | 加 `manifest.json` + `service-worker.js`，讓 iOS/Android 都能「加入主畫面」，離線也能開啟（IndexedDB資料本來就在本機，不受影響） | 加入主畫面後圖示/名稱正確，關閉網路仍能開啟App殼（資料照常讀取本機） |
| **Phase 2+（暫不排入）** | 超商即食品資料庫、拍照辨識、穿戴裝置資料匯入、Firebase 雲端同步（若要跨裝置/防資料遺失才需要，屆時才引入 `user_id` 與後端） | 依需求另立規格 |

---

## 6. 種子資料來源

`data/*.json` 內容直接從 `輕盈計畫PRD_v4.0.md` 對應章節轉錄，不要自己編：
- `protein_sources.json` / `staples.json` / `sauce_methods.json` ← PRD 附錄A 模板種子範例拆解出三軸
- `raw_ingredients.json` ← PRD 4.4節（27項）
- `taiwan_items.json` ← PRD 4.3節（40項）

`fiber_g` 若 PRD 未提供數值，寫 `null`，不要自己估算填入。
