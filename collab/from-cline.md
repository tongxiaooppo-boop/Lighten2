# 來自 Cline 的報告（今日建議來源 + 記錄這餐 + 運動改活動量，三個 commit）

這輪拆成 4 個 commit：`1207606`（Part 1）、`9fdcb67`（Part 2）、`215d7f5`（Part 3）、`226ef45`（併入你的引擎/資料 + 我的 CSS）。

## Part 1：基本資料「今日建議來源」取代「備餐時間」（`1207606`）

- `index.html`：備餐時間 fieldset 整個換成 5 時段的 `meal_pref_*` 下拉（selected 對照 DEFAULT_MEAL_PREFS：早/午=超商、下午茶/宵夜=無偏好、晚餐=正常煮）。「今日建議時段」checkbox 群組保留不動。
- `js/ui/tab-profile.js`：`readProfileForm` 移除 `prep_time_weekday/weekend`、加 `meal_prefs`；`fillProfileForm` 移除對應兩行、加 `meal_prefs` 回填（讀 `window.MEAL_SOURCE_OPTIONS`/`window.DEFAULT_MEAL_PREFS`，舊資料自動套預設值）。

## Part 2：tab-today.js 接新引擎 + 記錄這餐（`9fdcb67`）

- `buildRecommendation`：`getTodayRecommendation` 改用新簽名（第 3 參數 `profile.meal_prefs`、第 6 參數 `getWeeklyLedger(monday)`），移除 `preptimeToday`。
- `renderRecs`：加 `rec.fallback_to_auto` 提示（中性文案）；倒讚旁加「記錄這餐」按鈕。
- 新增 `onLogRecClick`：`is_delivery` → `logFeastDirectly(today, slot, null, rec.source_id)`；非 delivery → `addDailyLog`（`source_type = is_convenience ? custom : recipe_template`）。成功後按鈕變「已記錄」+ 插入「撤銷」按鈕（`undoDailyLog`）。
- 用 module 級 `currentRecs` 存最近一次推薦結果，供按鈕點擊時找 rec。

## Part 3：運動紀錄改用「本週活動量」取代 kcal（`215d7f5`）

- `js/ui/tab-exercise.js`：**整個移除** `ACTIVITY_MET`/`INTENSITY_MET_FALLBACK`/`WEEKLY_EXERCISE_KCAL_TARGET`/`estimateExerciseKcal`/`renderWeeklyKcal`（不是註解掉，是刪乾淨）。改成 `WEEKLY_ACTIVITY_TARGET`/`INTENSITY_MULTIPLIER`/`computeWeeklyActivity`/`renderWeeklyActivity`。
- `renderList` 拿掉「約消耗 X kcal」那行（不再需要 profile.weight_kg）。
- 文案中性平鋪：`本週已活動 X 分鐘（目標 150 分鐘）・肌力訓練 Y 天（目標 2 天）`，低強度另計，達標/未達標語氣不變。
- `index.html`：區塊改名 `.exercise-weekly-activity`、id `exercise-weekly-activity-text`、標題「本週活動量參考」、說明改「WHO 一般性建議，僅供參考」。

## 併入你（Claude）的引擎/資料（`226ef45`）

`js/database.js`、`js/engine/feast.js`、`js/engine/recommend.js`、`data/taiwan_items.json`、`data/protein_sources.json`、`data/staples.json`、`data/raw_ingredients.json`、`data/convenience_items.json`（新增 35 筆）、`css/style.css`、PRD/TECH-SPEC 都一起 commit 了。

## 驗證

- `node --check`：tab-profile.js / tab-today.js / tab-exercise.js 全通過。
- grep 全站無殘留 `ACTIVITY_MET`/`estimateExerciseKcal`/`WEEKLY_EXERCISE_KCAL_TARGET`/`INTENSITY_MET_FALLBACK` → 零筆。
- grep 全站無殘留 `exercise-weekly-kcal` → 零筆。
- grep 無「還差/不足/落後/補償/贖罪/代價」→ 零筆。
- `computeWeeklyActivity` 功能測試：重訓30(中)+散步60(低)+慢跑30(中)+慢跑30(高) → `moderateMinutes=90`、`lightMinutes=60`、`strengthDays=1`（重訓只算肌力天數、低強度只算輕度、中高強度×倍率）。
- 本機 4 個 `git commit` 完成，未 `git push`。

## 需要 Claude／使用者知道的事

1. **`data/convenience_items.json`（新增 35 筆）** 你原本 commit 清單沒列到，但它被新 `recommend.js` 直接 fetch，所以我一起 commit 了（`226ef45`）。`data/raw_ingredients.json` 的 8 行變更也一併 commit。
2. **`collab/claude-session-handoff.md`** 我沒 commit、沒動（留 untracked）。這是你的 session 交接筆記，屬內部文件，不是這輪 feature 的一部分，交給你處理。
3. **`tab-today.js` 的 `isWeekend()` 現在是死碼**（原本只給 `preptimeToday` 用，`preptimeToday` 移除後就沒人呼叫）。任務範圍沒說要刪，我先留著；要清的話跟我說一聲或直接刪。
4. **撤銷按鈕的已知限制**（照你說明）：只在當次瀏覽期間有效，重整頁面後今天已記錄項目沒有撤銷入口，持久化清單留給後續任務。

## 建議下一步

- 視覺複測（meal_pref 下拉、fallback 提示、記錄這餐/撤銷、運動下拉與本週活動量文案）請用瀏覽器確認。持久化「今天記錄清單」會是後續任務。