# 給接手的 Opus：Lighten2 交接（2026-09-29，Phase −1b 第二輪核對通過，待使用者跑手機實機腳本）

一律用中文回覆使用者。這份交接讓你不必重讀前一個 session 的對話就能接手。

## 1. 專案

- 「輕盈計畫」2.0（Lighten2）：個人減脂飲食追蹤 App，純前端 vanilla JS（ES modules）＋IndexedDB，沒有後端、單人使用。
- GitHub：`https://github.com/tongxiaooppo-boop/Lighten2`（remote `origin`）；網頁 https://tongxiaooppo-boop.github.io/Lighten2/ （GitHub Pages，2026-09-29 開啟，推送 master 就更新）。本機 `D:\ok\lighten`，分支 `master`。v1 保存在 tag `v1-final`。
- **由 Opus 直接寫程式**，不交 Cline。沒有任何使用者資料需要遷移（decisions #9）。
- 使用者要 Opus 以**資深營養師**的角度判斷食物資料（樣品選擇、生熟、份量、過敏原）。

## 2. 目前狀態

- **Phase −1a** 已驗收。
- **Phase −1b 所有項目已實作**，驗收審核第一輪「需再修」的必改項已修完，**第二輪核對：可以驗收（待手機實機腳本）**：紀錄在 [collab/opus-review-log/2026-09-28-phase-1b-review.md](opus-review-log/2026-09-28-phase-1b-review.md)。
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

- pre-commit hook 約 8 秒。禁止 `--no-verify`。
- 推送前要先問使用者。2026-09-29 已推送，CI（check）通過。
- Windows 上寫多行 Python/JS 時 heredoc 常被引號打斷：先用 Write 寫到 scratchpad 再執行。

## 4. 下一步

1. **−1b 驗收審核第一輪的必改 5 項（A1、A2、飲食限制、T1–T3、T8）與大部分建議項已修完**（`84a216d..HEAD`，每個 commit 都有差異報告；規格變更都先有 docs commit）。重點：
   - A1 `toPickerItem` 改成帶 catalog 全部欄位；diff-recs 的 normTotals 加了 SF/Na/partial，picker 快照多了 `drink-tfda` 情境。
   - A2 骨架新欄位 `not_included`（章程 B7.5），`ui/dom.js` 的 `notIncludedText`。
   - 飲食限制：章程 B6.8＋check-data `checkDietTags`；Soyjoy、海藻沙拉、藜麥沙拉盒、高蛋白飲、薯泥沙拉、照燒醬改非素；超商素食系列只標蛋奶素並寫「素食依據：」；台式單一成分飲料/地瓜/堅果改正面宣告。
   - 工具：`field_sources.value` 只准 null→0；check-data 開頭有「工具自我檢查」；label/official_web 現成品項做 B5.4；跨檔 id 唯一；「等」結尾的 TFDA 描述不算列有成分；note 不得出現「AI」（B2.6）；麥當勞官方值凍結 `data/reference/official_values_frozen.json`＋反推碳水公式；check-arch C4.14 收緊到整個 engine。
   - db：自煮紀錄必有 `implicit`（A4）。
   - 資料：泡菜/照燒醬加「未確認」；AI 補值段落從 note 刪掉（卡片不再顯示沒出處的鈉）；6 欄 label_unsourced 改 estimate（凍結清單 34→24）；食材 note 措辭。
   - 沒做的登記在 `docs/日後討論.md` 最後一節。smoke-browser 14 項全過。
2. **第二輪核對已回覆：−1b 可以驗收（待手機實機腳本）**，逐字在審核紀錄檔。建議 3.1–3.9 已處理（c79e909、95b48ba、a68eb60），3.6 登記在日後討論。
3. **C6.5（第二輪核對：可以驗收，待這一步）：請使用者在手機跑完整的 `docs/手機實機腳本.md`**（「自己選」2a 拿鐵鈉約 113 mg、4a 溫沙拉「未含沙拉醬」是這次新加的），留紀錄。兩者都過才算 −1b 驗收。
4. 驗收後問使用者要不要推送到 GitHub（跑 CI）。
5. 之後是 **Phase 0**（「自己選」改三分頁、我的品項快速新增、品項卡片純文字、自煮分頁的用油/調味選項）。
6. `docs/日後討論.md` 的 −1b 待評估項目（低碳主食槽、超商隔天重複、shown_count 不衰減、煎蛋清淡、不加調味、溫沙拉沙拉醬）要另外送 C3 審核。運動分頁「連續紀錄」仍暫緩。

## 5. 工作方式

- 權威規格 `docs/PRD.md`；章程 `docs/CHARTER.md`；決策 `docs/decisions.md`（到 #40）。先改 PRD、記 decisions，再改程式（A1）。
- 重大設計、偏離 PRD 的格式、改推薦演算法、改骨架：新開 Opus agent 獨立審核，**問答逐字存 `collab/opus-review-log/`**。
- 使用者習慣：問題附建議，常回「照建議」；只把產品決定交給使用者。可以直接 commit 到 master，訊息結尾 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`。
- 資料改動：每個 commit 附差異報告；能證明「只是重構」的，用腳本比對舊快照（例：id 改名後把舊快照套同一份改名對照再逐字比）。
- 畫面流程改到時，跑 `docs/手機實機腳本.md` 對應段落（−1b 的畫面變動已補進腳本，使用者還沒在手機上跑）。
