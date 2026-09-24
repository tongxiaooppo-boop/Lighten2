# 來自 Cline 的報告（TASK 5）

## 這次改了什麼

- `index.html`（修改）：`#tab-profile` 區塊填入完整表單 + 計算結果區 + 今日體重回填小元件；並在 script 區加入 `js/engine/nutrition.js` 與 `js/ui/tab-profile.js`（載入順序：localforage → database.js → nutrition.js → tab-profile.js → app.js）。
- `js/ui/tab-profile.js`（新增）：分頁一邏輯（載入回填、計算+存檔、體重回填）。
- `css/style.css`（修改）：新增表單/結果卡/體重回填的樣式（fieldset、form-row、form-field、primary-btn、targets-result、weight-widget）。

## 表單欄位（與 nutrition.js/database.js 對齊，已定案不再變體）

`age`、`gender`（'男'/'女'）、`height_cm`、`weight_kg`、`body_fat_pct`（選填，留空存 null）、`activity_mode`（'久坐'/'輕度'/'中度'/'高度'）、`special_activity_kcal`（選填，留空存 null）、`diet_restriction`（select：一般/蛋奶素/全素/低碳/無特殊限制）、`allergens`（文字輸入）、`prep_time_weekday`、`prep_time_weekend`（select：幾乎無/5分鐘內/15分鐘內/30分鐘以上）、`goal_mode`（'減脂'/'維持'/'增肌'）。

## 行為

1. 載入時 `getProfile()` → 有資料就回填表單（重新整理資料還在）。
2. 「計算」按鈕：讀表單 → 組 `profile` → `calculateTargets(profile)` → 顯示 BMR/TDEE/目標熱量/蛋白質/脂肪/碳水/纖維/淨碳水（`flooredWarning` 為 true 時另顯示安全下限提示）→ `saveProfile(profile)` 存檔。
3. 「今日體重回填」：日期（預設今天）+ 體重 → `addWeightLog({ log_date, weight_kg })`，送出後顯示「已記錄 …」。

## 驗證

- `node --check js/ui/tab-profile.js` 語法通過（exit 0）。
- 用 grep 確認表單 12 個 profile 欄位 + weight 表單 2 個欄位的 `name` 全部到位，且與 `readProfileForm()`／`nutrition.js` 讀取的欄位名一致。
- 手動追蹤「計算」流程：`gender='男'`→male、`activity_mode='中度'`→1.55、`goal_mode='減脂'`→0.8 等對應正確。
- **未做真實瀏覽器端到端驗證**（本機無 headless 瀏覽器/jsdom）。完成標準的「畫面顯示數字」「重新整理資料還在」需在瀏覽器實測；邏輯上已透過上面的欄位對齊與語法檢查。

## 需要 Claude／使用者決定的事

- 無重大事項。以下幾點屬實作選擇，供參考：
  1. 表單用了 `novalidate`，所以年齡/身高/體重改由 JS 手動檢查（空值會 alert 提示），HTML 的 `min/max` 僅作輸入提示。
  2. `body_fat_pct` / `special_activity_kcal` 留空時存 `null`（`calculateTargets` 對 `special_activity_kcal` 會當 0；`body_fat_pct` 本輪不參與計算，PRD 2.1 的 Deurenberg 推估未實作）。
  3. 過敏原用「文字輸入（逗號分隔）」存字串，未做 checkbox 多選（PRD 2.3 說「先做選項/文字輸入」，故取最簡的文字輸入）。

## 建議下一步

- 依 TASKS.md 執行 TASK 6（`js/engine/budget.js` 的 `recalcTodayBudget` + `js/engine/matcher.js` 的 `checkHardConstraints`）。
