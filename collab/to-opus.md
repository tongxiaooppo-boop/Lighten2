# 給接手的 Opus：Lighten2 交接（2026-09-29 下午，Phase 0 計畫第三版三輪審核通過，可以開工）

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

1. **Phase 0 計畫第三版已定案，可以開工**：`docs/review/2026-09-29-Phase0-實作計畫.md`。三輪審核問答逐字＋實作者處理在 `collab/opus-review-log/2026-09-29-phase0-plan-review.md`（第三輪只有 F1 一定要改，已改，審核者說不用送第四輪）。
   - 開工前重讀計畫第 3 節（engine 函式與單一來源）、第 4 節（斷言 1–13、walkthrough）、第 5 節（commit 拆法）。重點提醒：commit 2 保留四項舊行為、所有快照逐字不變；舊畫面用 `toDraft` 轉形狀、engine 不留相容分支；`sumProducts`／`composeTotals` 拆出不進位內部函式、`contentTotals` 只進位一次；斷言 13 在 commit 2 凍結參考值；commit 3–5 一起推。
2. **手動記錄主餐上限（使用者 2026-09-29 決定）：早餐、午餐、晚餐 2；下午茶、宵夜 1**（計畫第 6 節，`MANUAL_MAIN_MAX_BY_SLOT = { breakfast: 2, lunch: 2, dinner: 2 }`）。「雞胸＋蒸地瓜」早餐要能記成一餐。
3. 照計畫第 5 節 commit 拆法開工，從 commit 1（docs：PRD、decisions #41 起、日後討論）開始；每個畫面 commit 跑 `mobile-walkthrough` 並看截圖（章程 C6.5）。
4. `docs/日後討論.md`：−1b 待評估項目（送 C3）、手機截圖發現的畫面問題（百分比誤解、44px 等）。運動分頁「連續紀錄」仍暫緩。
5. `collab/pdf/` 兩份 PDF 超過 50 MB，要不要移出 repo 或改 Git LFS 待使用者決定（不急）。

## 5. 工作方式

- 權威規格 `docs/PRD.md`；章程 `docs/CHARTER.md`；決策 `docs/decisions.md`（到 #40）。先改 PRD、記 decisions，再改程式（A1）。
- 重大設計、偏離 PRD 的格式、改推薦演算法、改骨架：新開 Opus agent 獨立審核，**問答逐字存 `collab/opus-review-log/`**。
- 使用者習慣：問題附建議，常回「照建議」；只把產品決定交給使用者。可以直接 commit 到 master，訊息結尾 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`。
- 資料改動：每個 commit 附差異報告；能證明「只是重構」的，用腳本比對舊快照（例：id 改名後把舊快照套同一份改名對照再逐字比）。
- 畫面流程改到時，跑 `docs/手機實機腳本.md` 對應段落（−1b 的畫面變動已補進腳本，使用者還沒在手機上跑）。
