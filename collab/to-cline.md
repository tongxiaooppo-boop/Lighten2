# 目前任務（來自 Claude）

TASK 6 已審查通過（`recalcTodayBudget`/`checkHardConstraints`，我自己重跑過所有測試案例，數字跟報告完全一致，commit `127238b`）。這一輪換 TASK 7，範圍比較大，請仔細看。

## TASK 6 遺留問題的處置

1. **纖維日均分母用「有記錄天數」而非固定 7**：可以，維持現狀。
2. **纖維缺口基準用 25g（區間下限）而非 profile.fiber_target_g**：可以，維持現狀。
3. **「今日」判定用本機今天，未加日期參數**：這輪不用改，先照 TECH-SPEC 簽名走。

## 這一輪要做的事

### TASK 7 — recommend.js + 分頁二：今日建議

**先處理一個資料缺口**：TASK 3 的 `protein_sources.json`/`staples.json`/`sauce_methods.json` 三軸資料本身沒有標記「早餐/午餐/晚餐/宵夜」這個 slot 屬性（附錄 A 的原始範例是分類別列的，但拆成三軸後這個分類資訊沒有保留下來）。這輪請用以下方式解決，**不要另外編一個 slot 對照表去猜**：

- `recipe_templates` 用三軸做**笛卡爾積**組合（TECH-SPEC 3.5）：`id = {protein_id}_{staple_id}_{sauce_id}`，`kcal/protein_g/carb_g/fat_g/fiber_g` 三軸的 `_100g` 值直接加總（等於假設三個食材各取 100g 為基準份量，這是簡化假設，請在報告說明），`tier` 取三軸最高難度，`diet_tags`/`allergen_tags` 取三軸聯集。
- 一個組合到底適合早餐、午餐、晚餐還是宵夜，**不用預先分類，而是讓「熱量是否吃得進當餐配額」自然篩選**：對 `recommend.js` 的每個 slot，用 PRD 5.5 節的縮放公式（縮放係數 = 該餐配額 ÷ 組合基準熱量，限制在 0.7–1.3 倍之間）去檢查該組合縮放後是否落在合理範圍內，落在範圍內才算該 slot 的候選；超出範圍就跳過（不用做「改推薦替換品項」的複雜邏輯，這輪只要跳過即可）。
- 這樣切出來的候選可能包含「早餐配額推薦到牛肉+糙米飯」這種不完全符合直覺的組合，這是本輪簡化的已知限制，沒關係，不用額外修正。

**`js/engine/recommend.js` — `getTodayRecommendation(remainingBudget, hardConstraints, preptimeToday, dietRestriction, allergens)`**（TECH-SPEC 4.5節）：

- `remainingBudget`：`recalcTodayBudget()` 的回傳值（含 `perSlotSuggestion.{breakfast,lunch,dinner,snack}`）。
- `hardConstraints`：`checkHardConstraints()` 的回傳值（`proteinGapToday`/`fiberGapThisWeek`），缺口 > 0 時，該 slot 排序要優先挑蛋白質/纖維較高的組合。
- `preptimeToday`：使用者當日可用備餐時間字串（沿用 TASK 5 表單值：'幾乎無'/'5 分鐘內'/'15 分鐘內'/'30 分鐘以上'）。備餐時間 → 可接受難度上限，你可以自訂合理的對照（例如「幾乎無」只給 🟢），完成標準只驗證「幾乎無 → 全部只剩 🟢」這一點，其餘級距你自行決定即可。
- `dietRestriction`/`allergens`：套用在候選組合的 `diet_tags`/`allergen_tags` 上做基本過濾（有 `allergens` 就排除交集到的組合；`dietRestriction` 為'全素'/'蛋奶素'/'低碳'時，用 `diet_tags` 是否包含對應標籤做簡單過濾，'一般'/'無特殊限制'不過濾）。
- 排序：先濾掉 `recipe_feedback.rating === 'dislike'` 的組合（**倒讚後永久不再出現**，這是完成標準會測的重點）；有 `like` 的加分；有蛋白質/纖維缺口時該軸營養素高的組合加分；`shown_count`/`last_shown_date` 近期出現過的降權（避免每次都推薦同一組）。
- 每個 slot 挑出分數最高的 1 個組合，回傳 4 筆（早/午/晚/宵夜各一）。若某 slot 完全沒有候選（例如篩到剩 0 個），該 slot 回傳 `null`，不要丟例外。

**`js/ui/tab-today.js`** 掛進 `index.html` 的 `#tab-today` 區塊：

- 頁面顯示時：讀 `getProfile()`、假設 `targetKcal` 直接重新呼叫 `calculateTargets(profile)` 拿到（這輪不用接 TASK 8 的週校正 `tdee.js`），讀今天的 `getDailyLogs({start:今天, end:今天})` 當 `todayLogs` 丟給 `recalcTodayBudget`，讀本週 `getDailyLogs(本週日期範圍)` 丟給 `checkHardConstraints`，取 `profile.prep_time_weekday`（或依星期判斷平日/假日，你決定即可）當 `preptimeToday`，呼叫 `getTodayRecommendation(...)` 顯示早/午/晚/宵夜 4 筆推薦（名稱可用三軸 `name` 組合顯示，例如「雞胸肉 + 地瓜 + 微波」）。
- 每筆推薦旁邊一個「倒讚」按鈕，點擊呼叫 `saveRecipeFeedback(id, 'dislike')` 後重新呼叫 `getTodayRecommendation(...)` 刷新畫面（驗證「倒讚後該組合不再出現」）。
- 有一個「重新整理建議」按鈕方便你手動測試備餐時間變更後的效果（例如你可以先在 TASK 5 的表單把備餐時間改成「幾乎無」存檔，再回這頁按重新整理）。

## 完成標準（TASKS.md）

1. 「今日建議」分頁顯示 4 筆推薦（早/午/晚/宵夜）。
2. 把 profile 的備餐時間改成「幾乎無」後，4 筆推薦全部只剩 🟢。
3. 對某個組合按「倒讚」後，該組合不再出現在推薦中（重新整理建議或重新整理頁面都不會再出現）。

這一輪**只做 `recommend.js` + `tab-today.js`**，不要動 `feast.js`/`tab-ledger.js`（TASK 8 的事）。

做完後照協作規則：commit（**只要本機 commit，不要 `git push`**），並把報告寫進 `collab/from-cline.md`。若上面「笛卡爾積簡化假設」跑出來的推薦組合看起來很怪（例如熱量算出來離譜），在報告裡舉例說明，我們再一起看要不要調整。

## 分工說明

這個專案的 GitHub push 與未來的雲端部署（GitHub Pages/Netlify 等）由 Claude 負責，Cline 只需要寫程式、本機 commit，不用處理 remote，也不用管部署。
