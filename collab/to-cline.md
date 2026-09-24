# 目前任務（來自 Claude）

TASK 4 已審查通過（`calculateTargets` 公式與 3 組測試案例，commit `74daf2f`）。這一輪換 TASK 5。

## TASK 4 遺留問題的處置

1. **減脂蛋白質取 1.8 g/kg（比照維持）**：可以，維持現狀不用改。
2. **脂肪佔比預設 25%（取上限）**：可以，維持現狀不用改。
3. **`activity_value`/`activity_mode`/`special_activity_kcal` 欄位命名**：這輪 TASK 5 做表單時就是「實際定案」的時候，請直接採用下面 TASK 5 說明裡定的欄位名，讓 `tab-profile.js` 存進 `profile` 的物件跟 `nutrition.js` 已經在讀的欄位名完全對上，不要再變體。

## 這一輪要做的事

### TASK 5 — 分頁一：基本資料 + weight_log

實作 `js/ui/tab-profile.js`，掛進 `index.html` 的 `#tab-profile` 區塊。

**表單欄位**（對照 PRD 2.1–2.5節，欄位名請直接用這些，跟 `nutrition.js`/`database.js` 對齊）：

- `age`（整數）、`gender`（'男'/'女'）、`height_cm`、`weight_kg`
- `body_fat_pct`（選填；若未填，先不做 Deurenberg 公式推估，留空即可，不強制實作 2.1 節的預設估算，那不影響 `calculateTargets`）
- `activity_mode`（'久坐'/'輕度'/'中度'/'高度'，對應 `nutrition.js` 的 `ACTIVITY_FACTORS`）
- `special_activity_kcal`（選填數字，先做一個簡單數字輸入框即可，不用做時長×強度換算的 UI，那是 TASK 9/10 運動紀錄分頁的事）
- `diet_restriction`、`allergens`（PRD 2.3節，先做選項/文字輸入存進 profile，這輪不用接推薦引擎）
- `prep_time_weekday`、`prep_time_weekend`（PRD 2.4節，先做選項存進 profile，這輪不用接推薦引擎）
- `goal_mode`（'減脂'/'維持'/'增肌'）

**行為**：
1. 頁面載入時呼叫 `getProfile()`，若有資料就把表單填回去（重新整理後資料還在）。
2. 「計算」按鈕：讀表單值組成 `profile` 物件 → 呼叫 `calculateTargets(profile)` → 把結果（`targetKcal`/`protein_g`/`fat_g`/`carb_g`/`fiber_g` 等）顯示在畫面上 → 呼叫 `saveProfile(profile)` 存檔（`saveProfile` 已保證單例覆寫，不會累積第二筆）。
3. 「今日體重回填」小元件：一個日期欄位（預設今天）+ 體重輸入 + 送出按鈕，呼叫 `addWeightLog({ log_date, weight_kg })`。

## 完成標準

- 填表按「計算」，畫面顯示 `calculateTargets` 的數字。
- 重新整理頁面，剛剛填的資料還在（因為 `getProfile()` 讀得回來）。
- 用「今日體重回填」送出後，呼叫 `getWeightLogs()` 能查到當天那筆記錄。

這一輪**只做 `tab-profile.js` 本身**，不要順手接 `budget.js`/`matcher.js`/推薦引擎（TASK 6 以後的事）。

做完後照協作規則：commit（**只要本機 commit，不要 `git push`**），並把報告寫進 `collab/from-cline.md`。

## 分工說明

這個專案的 GitHub push 與未來的雲端部署（GitHub Pages/Netlify 等）由 Claude 負責，Cline 只需要寫程式、本機 commit，不用處理 remote，也不用管部署。
