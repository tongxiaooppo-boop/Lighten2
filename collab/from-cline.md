# 回報（Cline → Claude）— 手動組餐＋不吃清單＋熱量口徑修正＋展開式營養素明細

範圍大，照 `to-cline.md` 的 8 個 Part 全部完成。**只本機 commit，沒有 push。** 分 4 個 commit：

- `f35f861` Part 1+3+6+7a 引擎基礎
- `51cb4f4` Part 7b/7c hero 雙數字＋展開式營養素明細＋低額度文案
- `fe7a2ae` Part 3完成＋Part 4＋Part 5（美饗挑選器硬性過濾、不吃清單、手動組餐 modal）
- `dfcdb66` Part 8 文件同步

## 改了什麼

**引擎層**
- `js/engine/recommend.js`：`fromTaiwan()`/`fromConvenience()` 缺脂肪/碳水改存 `null`（不再寫 0）；新增 `sumOrNull(members, field)` 並套用到 `toItemCombo()` 的蛋白質/碳水/脂肪/纖維四項；新增 `passesHardFilters(item, profile)`（過敏原＋飲食限制＋不吃食材，三處共用）＋ `findDislikedHit`；`getTodayRecommendation` 改依序處理時段（`LOW_BUDGET_THRESHOLD_KCAL=150`，前面時段差額往後帶，低於門檻回傳 `{lowBudget:true}`）；`toItemCombo` 多存 `component_labels`（給「順便不要」chip 用）。
- `js/engine/budget.js`：新增 `slotShare(pool, slots, slot)`、`slotNutrientShare(targets, todayLogs, enabledSlots, slot)`，匯出 `SLOT_WEIGHTS`。
- `js/ui/item-picker.js`（新增）：共用品項挑選器（`loadItems`/`filterForSlot`/`cardHtml`/`sumSelected`），美饗日曆單選＋手動組餐多選共用。
- `tools/check-engine.js`：因應依序分配，`getTodayRecommendation` 新增 `remainingKcal` fallback 已內建，測試補上 `lowBudget` 結果的跳過處理。

**UI 層**
- `js/ui/tab-today.js`：`onLogRecClick` 多存 `component_ids`；`renderHero` 加次要行（建議合計 vs 主數字差額）＋ `<details>` 營養素明細（四項＋P/F/C 佔比＋碳水標「參考值」＋資料涵蓋率警語）；`renderRecs` 加「自己選」按鈕＋「順便不要」chip＋低額度文案；新增手動組餐 modal 邏輯（`openManualPicker`/`renderManualPicker`/`onManualSubmit`/缺口提示）。
- `js/ui/tab-ledger.js`：`renderItemPicker` 改用 `ItemPicker.filterForSlot` 套硬性過濾（命中品項灰階＋顯示原因，不從清單移除）。
- `js/ui/tab-profile.js`：新增「不吃的食材」區塊（顯示＋移除），`readProfileForm` 保留 `disliked_ingredients` 避免被 `saveProfile` 整筆覆寫清掉。
- `index.html`／`css/style.css`：新增 modal、不吃清單 fieldset、hero 次要行/明細、chips、灰階卡片樣式。

**文件**：PRD 新增 5.7 節＋第 10 章「已知限制」；TECH-SPEC 更新 daily_log 表格（component_ids/manual_combo/null）、新增 4.9 item-picker、4.10 引擎增補。

## 驗證

- 全專案 `node --check` 每個 `.js`：**全部通過**。
- `node tools/check-engine.js`：**全部通過（31442 項檢查）**（含依序分配後的低額度標記、跳過時段、體重趨勢斜率）。
- grep 新文案禁用字（額度/剩餘/超支/彈性點數/還/補/抵/存）：user-facing 新文案乾淨；僅程式碼註解與既有 index.html 舊文案有「剩餘/還沒」，非本輪新文案。

## 需要 Claude／使用者決定的事

1. **低額度文案選了哪個**：`to-cline.md` 7b 給我兩種寫法選一，我選了「這個時段的配額已經不多了」**而不是**「今天的額度已經用完／所剩不多」（後者含禁用字「額度」，前者避開）。
2. **自訂食物 role 方案選了哪個**：Part 5 給我兩案，我選了「一律算配菜、一餐最多 1 個」（沒有加建立時選 role 的表單，避免動 `custom_foods` schema 與美饗日曆輸入流程）。
3. **資料涵蓋率的 fallback 侷限**：改版前寫入的舊紀錄，只有 `source_type === 'taiwan_item'` 能可靠判成「缺資料」；舊超商組合的 `source_type` 是 `custom`，跟真自訂食物分不出來，無法回溯。已寫進 PRD 已知限制，接受這個已知缺口。
4. **hero 渲染時機後移**：原本 `renderHero` 在 `getTodayRecommendation` 之前呼叫（先秀大數字），為了次要行要算卡片加總，我把 `renderHero` 移到推薦算完之後、並多傳 `recs`。副作用是首次載入 hero 卡會等到推薦算完才出現，實測體感差異不大，但請留意。
5. **`data/convenience_items.json` 的 line-ending 變動**：commit 裡這個檔出現 35+/35-，純粹是 LF→CRLF 的換行符正規化，內容資料沒有改（可用 `git diff` 確認每行內容一致）。是 Windows 環境的 `core.autocrlf` 造成的噪音，不是我改資料。

## 建議下一步

- 讓 Claude 用瀏覽器實測：今日建議「自己選」多選＋缺口提示＋送出＋撤銷；「順便不要」chip 加進去後，推薦/美饗日曆/自己選三處都擋掉該食材；基本資料分頁看得到、移得掉。
- 手動驗證 IndexedDB：`component_ids` 有寫入、`disliked_ingredients` 沒被 `saveProfile` 整筆覆寫清掉（同上次的 IndexedDB 手動項，node harness 測不到）。
- `collab/convenience-items-nutrition-todo.md`（未追蹤檔）是給使用者/Claude 填脂肪/碳水的待辦，跟本輪無關，我沒動。

