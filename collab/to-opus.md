# 給接手的 Opus：Lighten2 交接（2026-09-29 中午，−1b 已驗收；Phase 0 計畫第二輪「要再修改」，待改第三版）

一律用中文回覆使用者。這份交接讓你不必重讀前一個 session 的對話就能接手。

## 1. 專案

- 「輕盈計畫」2.0（Lighten2）：個人減脂飲食追蹤 App，純前端 vanilla JS（ES modules）＋IndexedDB，沒有後端、單人使用。
- GitHub：`https://github.com/tongxiaooppo-boop/Lighten2`（remote `origin`）；網頁 https://tongxiaooppo-boop.github.io/Lighten2/ （GitHub Pages，2026-09-29 開啟，推送 master 就更新）。本機 `D:\ok\lighten`，分支 `master`。v1 保存在 tag `v1-final`。
- **由 Opus 直接寫程式**，不交 Cline。沒有任何使用者資料需要遷移（decisions #9）。
- 使用者要 Opus 以**資深營養師**的角度判斷食物資料（樣品選擇、生熟、份量、過敏原）。

## 2. 目前狀態

- **Phase −1a** 已驗收。
- **Phase −1b** 已驗收（2026-09-29：兩輪獨立審核＋使用者手機實機腳本全過）。紀錄在 [collab/opus-review-log/2026-09-28-phase-1b-review.md](opus-review-log/2026-09-28-phase-1b-review.md) 最後一節。
- −1b 期間另有一批送審（毛豆仁移軸、骨架 seasoned、同一天重建），審核紀錄 [2026-09-28-phase-1b-batch.md](opus-review-log/2026-09-28-phase-1b-batch.md)，決策 #37–#40。

−1b 做了什麼（細節看 commit 訊息）：
- 資料：`data/ingredients.json`（四個 v1 食材檔合併，TFDA 產生數值，id 已凍結在 `data/reference/ingredient_ids_frozen.json`）；現成品項 B4 格式＋逐欄出處＋`label_unsourced` 凍結清單；過敏原詞彙加花生、軟體動物，複合料理一律「未確認」；麥當勞官方脂肪復原；TFDA 飲品全欄位重算；用油（cooking_oil）與調味程度（鹽等值的鈉）。
- 工具：`tools/build-ingredients.js`（改食材數值只能改 source 再跑它）、`tools/check-data.js`（章程 B12）。
- 程式：daysSince 時區；自訂食物過敏原例外移除＋`addCustomFood`／`validateCustomFood`；不吃清單只比 key；低碳開關（`low_carb`）；null 傳染（鈉/飽和脂肪例外，`partial`）；手動記錄只限角色數量；同一天重建不整批換掉；用油習慣（`oil_habit`）與隱含成分；鈉/飽和脂肪中性顯示。

## 3. 工具（每次提交都會跑）

| 指令 | 用途 |
|---|---|
| `node tools/check-data.js` | 食物資料（章程 B12）；`--list` 列出待查證的 estimate／label_unsourced 欄位 |
| `node tools/build-ingredients.js` | 由 `data/reference/` 重算食材 per_100g（`--dry` 只列差異） |
| `node tools/check-engine.js` | 引擎斷言（約 38000 項，台灣時區跑） |
| `node tools/check-arch.js` | 章程 C1/C2/C4 的架構規則 |
| `node tools/diff-recs.js` | 快照逐字比對；`--update` 重錄、`--full` 看全部差異 |
| `node tools/stamp-version.js` | **改了 js/、css/、data/ 就要跑，再 `git add index.html`** |
| `node tools/smoke-browser.mjs` | 無頭 Edge 實際操作 App（約 30 秒；Phase 驗收時跑，−1b 已跑過 14 項全過） |
| `node tools/mobile-walkthrough.mjs` | 手機實機腳本自動版：模擬手機照腳本操作＋每步截圖（約 1 分鐘，69 項）。**動到畫面流程、Phase 驗收時必跑，截圖要逐張看過**，再請使用者跑腳本開頭的「使用者短清單」（章程 C6.5） |

- pre-commit hook 約 8 秒。禁止 `--no-verify`。
- 推送前要先問使用者。2026-09-29 已推送，CI（check）通過。
- Windows 上寫多行 Python/JS 時 heredoc 常被引號打斷：先用 Write 寫到 scratchpad 再執行。

## 4. 下一步

1. **Phase 0 計畫改第三版**：`docs/review/2026-09-29-Phase0-實作計畫.md`（第二版）。審核紀錄 `collab/opus-review-log/2026-09-29-phase0-plan-review.md`（兩輪問答逐字＋最後的「實作者檢討」自查表）。
   - 第二輪【一定要改】3 項：**N1** `data/catalog.js` 的 `fromCustomFood` 照 PRD 10.1 讀 role/channel/valid_slots/飲食標記，`tools/diff-recs.js` 的 `CUSTOM_FOODS` 範例改成 10.1 格式（會動 picker 快照，放 commit 3 或 5）；**N2** commit 2 採 (a)：slotGaps 的 null、飲料移出 composeTotals 延到 commit 3，composeProblem 免開火排在 allow 前、提示文字跟舊的逐字相同，舊畫面傳推導出的 meal_type；**N3** 選項灰階做成 engine 的 `composeOptionProblem(item, axis, draft, { tier })`。
   - 第二輪【建議】N4–N15 一併寫進第三版（醬料也算免開火、假骨架斷言、contentTotals 用 sumProducts＋composeTotals＋addContributions 且推薦路徑不動、commit 3 拿掉過渡相容與 contentFromProducts、我的品項組例外與外食來源順序、meal_type 一律等於分頁值、預告不誘導改確認不含、PRD 10.4/10.6 改寫與死路登記、maxTierRank 共用、全素宣告與過敏原矛盾提示、walkthrough 用 auto 時段驗 lastPicked、commit 3–5 一起推）。另補 `composeProblem`「餐型不完整 → 擋」的斷言。
   - 寫完用檢討表自查，再送第三輪核對（問答逐字存同一個檔）。
2. **待使用者決定：手動記錄主餐上限**（計畫第 6 節）：A 維持 1／B 放寬到 2（審核與實作者建議）／C 改角色（不建議）。使用者還沒回覆，下午接續時先問。B 的話：`manualSelectionProblem` 的訊息改依常數產生、check-engine「兩個主餐要擋」改三個。
3. 計畫通過＋使用者決定後開工，照計畫第 5 節 commit 拆法；每個畫面 commit 跑 `mobile-walkthrough` 並看截圖（章程 C6.5）。
4. `docs/日後討論.md`：−1b 待評估項目（送 C3）、手機截圖發現的畫面問題（百分比誤解、44px 等）。運動分頁「連續紀錄」仍暫緩。
5. `collab/pdf/` 兩份 PDF 超過 50 MB，要不要移出 repo 或改 Git LFS 待使用者決定（不急）。

## 5. 工作方式

- 權威規格 `docs/PRD.md`；章程 `docs/CHARTER.md`；決策 `docs/decisions.md`（到 #40）。先改 PRD、記 decisions，再改程式（A1）。
- 重大設計、偏離 PRD 的格式、改推薦演算法、改骨架：新開 Opus agent 獨立審核，**問答逐字存 `collab/opus-review-log/`**。
- 使用者習慣：問題附建議，常回「照建議」；只把產品決定交給使用者。可以直接 commit 到 master，訊息結尾 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`。
- 資料改動：每個 commit 附差異報告；能證明「只是重構」的，用腳本比對舊快照（例：id 改名後把舊快照套同一份改名對照再逐字比）。
- 畫面流程改到時，跑 `docs/手機實機腳本.md` 對應段落（−1b 的畫面變動已補進腳本，使用者還沒在手機上跑）。
