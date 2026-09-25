# Claude 交接筆記（2026-09-25 session，token 快用完，接續用）

這份是寫給下一個 Claude session（或 compact 之後的自己）看的，不是給 Cline 的。目的是不用重新爬一次整個對話就能接手。

## 現在的狀態（最重要的先講）

1. **`collab/to-cline.md` 已經寫好一份完整任務，等使用者貼給 Cline**。內容分三部分：
   - 基本資料分頁：把「備餐時間」fieldset 換成「今日建議來源」（5個時段各自選 無偏好/超商/外送/快煮/正常煮）
   - `tab-today.js`：接新的 `getTodayRecommendation` 簽名（多了 `mealPrefs`/`flexLedger` 參數）、加「記錄這餐」按鈕（含撤銷）、fallback 訊息顯示
   - `tab-exercise.js`：**整個取代**上一輪 Cline 做的 kcal/MET 版本，改成 WHO/ACSM 的「本週活動分鐘＋肌力天數」制
   - 這份文件裡有明確列出「這輪不要動」的檔案清單（我已經直接改完驗證過的），檢查完 Cline 回報後照那份文件的驗收條件審查即可。

2. **這輪我（Claude）直接改過、已用 Node 模擬測試驗證、還沒進 git commit 的檔案**（等 Cline 下次 commit 時一起帶上，`to-cline.md` 底部有列清單）：
   - `js/database.js`：修好 `getTaiwanItems()` 從未寫入 IndexedDB 的既有 bug（改成直接 fetch JSON + 快取）；修過敏原判斷漏洞；新增 `removeDailyLog`/`getAllRecipeFeedback`
   - `js/engine/feast.js`：`resolveFeastItem` 回傳完整巨量營養素 + `usesFlex`；`reserveFeast`/`logFeastDirectly` 依 `usesFlex` 決定要不要動彈性點數；新增 `undoDailyLog`
   - `js/engine/recommend.js`：整個重寫（見下方「這輪做了什麼」）
   - `data/taiwan_items.json`：50筆補上 `allergen_tags`/`protein_g`/`fiber_g`/`uses_flex`
   - `data/protein_sources.json`/`staples.json`：補過敏原漏標（魚/黃豆）
   - `data/convenience_items.json`：這是新檔案（git status 顯示 `??`），35筆超商/連鎖品牌品項，使用者提供的三批真實市售資料
   - `css/style.css`：radio 橫排樣式、運動頁新區塊標題字體
   - PRD/TECH-SPEC 都同步更新過

3. **下次接手第一件事**：檢查 `git log --oneline -5` 看 Cline commit 了沒；如果 commit 了，照 `to-cline.md` 的驗收條件審查（`node --check` 語法、grep 評判性字眼、meal_prefs/flexLedger 參數對不對、記錄這餐按鈕邏輯）。

## 這輪從頭到尾做了什麼（時間順序，濃縮版）

這個 session 一開始是接續之前 TASK 1-12 的 Cline 協作開發（早就完成 Phase 1 六分頁），後面使用者開始**用瀏覽器實測**，抓出一連串真實 bug/缺口，逐一修：

1. 午餐配不到組合、早晚重複建議 → 根因是三軸資料 13 筆 `kcal_100g` 是 null（跳過整個組合）+ 份量換算 bug（直接加總100g值嚴重低估熱量）。已修。
2. 建議都沒蔬菜 → 三軸從沒有蔬菜這一軸，新增第4軸（取自 `raw_ingredients.json` 的 `category=蔬菜`）。
3. 超商即食選項完全沒被推薦引擎考慮 → 新增 `convenience_items.json`（後來擴充到35筆真實品牌資料，使用者分三批貼上真實市售營養數據）。
4. 早午餐應該預設當作沒空煮 → 一開始做成「早午餐自動加權超商」的軟性加分機制。
5. 使用者質疑：備餐時間+來源偏好應該整合、應該能分時段選 → **這是觸發兩輪 Opus 審核的起點**。
6. 使用者同時要求：運動紀錄加常用選項＋估算熱量消耗（明確說「跟吃什麼無關」但要「有估算」）。
7. 使用者要求：轉給 Cline 前，先讓 Opus（用 `Agent` tool, `model: "opus"`）審核兩輪，並要我解釋清楚運動功能為什麼不違反 PRD。
8. **Opus 第一輪**：時段偏好要合併成單一硬性篩選欄位（不要加分制）；`taiwan_items.json` 併入推薦池有嚴重資料坑（過敏原/tier/蛋白纖維缺失）；**運動功能判定駁回**（kcal是全App共用貨幣，架構隔離救不了心理層面的換算）。
9. 使用者決定：運動改分鐘制／taiwan_items全部進池但用 `uses_flex` 分流／來源偏好改硬性篩選。
10. **Opus 第二輪**：附條件核准，抓到 `taiwan_items` 從未寫入資料庫的既有 bug（我之前每輪審查都只驗證 JS 對照表跟 JSON 內容一致，沒驗證過資料真的有進資料庫——這是我的審查方法論漏洞，以後要記得連runtime資料管線一起查）。
11. 依兩輪意見，我直接把 `recommend.js`/`feast.js`/`database.js`/三個資料檔改完，Node 模擬測試 5+ 種情境都過。
12. 使用者：「你這串快滿token了，寫一份給claude自己的交接」→ 就是這份文件。

## 幾個容易忘記/踩雷的細節

- **`meal_style_preference` 這個欄位從來沒有真正生效過**（Opus 抓到的，我原本設計但 `tab-today.js` 從沒真的傳這個參數）。現在已經整個移除，改成 `meal_prefs`（逐時段），**不用擔心舊資料裡有這個欄位要處理，因為沒有任何使用者資料存過它**。
- **`prep_time_weekday`/`prep_time_weekend` 也整個廢除**，換成 `meal_prefs`。舊資料遷移策略是「不精細換算，直接套用 `DEFAULT_MEAL_PREFS` 新預設值」——這是刻意的簡化決定（Opus 建議做精細換算，但我們為了避免遷移邏輯本身出錯而簡化），PRD 裡有記錄這個取捨。
- **`enabled_slots`（決定要不要顯示某時段建議）沒有被移除，跟 `meal_prefs`（決定該時段偏好哪個來源）是兩個獨立設定，都要留著**，不要搞混或誤刪其中一個。
- **`taiwan_items.json` 的 id 在 `recommend.js` 組合時會加 `tw_` 前綴**（例如 `tw_ln01`），但 `logFeastDirectly`/`reserveFeast` 認的是原始 id（`ln01`），`recommend.js` 產生的 combo 上有一個 `source_id` 欄位存原始 id，`tab-today.js` 呼叫 `logFeastDirectly` 時要用 `rec.source_id` 不是 `rec.id`。
- **`getTodayRecommendation` 的第 3 個參數從 `preptimeToday`（字串）變成 `mealPrefs`（物件）**，第 6 個參數是新增的 `flexLedger`。如果之後看到有地方還在傳字串當第3參數，那是還沒更新的舊呼叫點，要修。
- **`window.MEAL_SOURCE_OPTIONS`/`window.DEFAULT_MEAL_PREFS` 是 `recommend.js` 匯出的常數**，`tab-profile.js` 要讀，注意 script 載入順序（`recommend.js` 要在 `tab-profile.js` 之前）。
- **運動功能兩版都已經被使用者/Cline實作過一次（kcal版）**，這輪要求 Cline 整個刪掉重做，不是在舊版上疊加。
- Opus 還提了幾個「不阻斷但值得之後處理」的問題，沒有寫進這輪 handoff，記在這裡免得忘記：
  - `shown_count`/`last_shown_date`（食譜降權用）只在倒讚時更新，單純顯示推薦時不會更新，所以「近期出現過降權」那段邏輯其實從未真正發生效果。
  - `planOverageSmoothing`（超額攤還）全專案沒有任何地方呼叫它，額度用罄目前沒有攤還後果。
  - 過敏原是自由文字輸入，使用者打「大豆」比對不到資料裡標的「黃豆」（同義詞問題），沒做正規化。
  - `meal_prefs` 目前沒有平日/假日的區分（Opus 建議保留但這輪為了控制範圍先跳過）。

## 記憶系統（auto-memory）目前狀態

`C:\Users\Max\.claude\projects\d--ok-lighten\memory\` 裡已經有：
- `feedback_autoproceed_handoff.md`：審查通過就直接寫下一輪交接，不用問
- `project_cline_handoff_workflow.md`：使用者手動貼 `collab/to-cline.md` 給 Cline
- `feedback_language_chinese.md`：一律中文回覆

這輪沒有新增記憶，但如果下個 session 要存新記憶，值得考慮的候選：
- 「審查 Cline 的資料驅動功能時，要連 runtime 資料管線（JSON→IndexedDB這種）一起查，不能只比對 JS 對照表跟 JSON 內容」（這輪 Opus 抓到的教訓）
- 「這個專案遇到大架構決策時，使用者會要求用 Agent(model:opus) 做獨立審核，不是我自己說服自己就好」
