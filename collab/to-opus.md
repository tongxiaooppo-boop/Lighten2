# 給接手的 Opus：Lighten2 交接（2026-09-28，Phase −1b 實作完成、驗收審核第一輪：需再修）

一律用中文回覆使用者。這份交接讓你不必重讀前一個 session 的對話就能接手。

## 1. 專案

- 「輕盈計畫」2.0（Lighten2）：個人減脂飲食追蹤 App，純前端 vanilla JS（ES modules）＋IndexedDB，沒有後端、單人使用。
- GitHub：`https://github.com/tongxiaooppo-boop/Lighten2`（remote `origin`）。本機 `D:\ok\lighten`，分支 `master`。v1 保存在 tag `v1-final`。
- **由 Opus 直接寫程式**，不交 Cline。沒有任何使用者資料需要遷移（decisions #9）。
- 使用者要 Opus 以**資深營養師**的角度判斷食物資料（樣品選擇、生熟、份量、過敏原）。

## 2. 目前狀態

- **Phase −1a** 已驗收。
- **Phase −1b 所有項目已實作**（`14d9b96` 之後約 30 個 commit，每個 commit 訊息都有差異報告），**正在做驗收審核**：送審問題在 [collab/opus-review-log/2026-09-28-phase-1b-review.md](opus-review-log/2026-09-28-phase-1b-review.md)。審核回覆要逐字貼進該檔，「一定要改」的照改（修 bug 先寫失敗斷言），再做第二輪核對。
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
- GitHub Actions 還沒推上去跑過：**推送前要先問使用者**。本機領先 origin 很多個 commit。
- Windows 上寫多行 Python/JS 時 heredoc 常被引號打斷：先用 Write 寫到 scratchpad 再執行。

## 4. 下一步

1. **−1b 驗收審核第一輪已回覆：需再修**（全文逐字在 `collab/opus-review-log/2026-09-28-phase-1b-review.md`）。驗收前的必改清單：
   1. **A1**：`js/ui/item-picker.js` 的 `toPickerItem` 逐欄抄營養欄位、漏了 `sat_fat_g`／`sodium_mg`，「自己選」的現成品項與自煮飲料的鈉整個遺失（寫進 daily_log 的也錯）。改成直接帶 catalog 品項全部欄位（C2），`catalog.js` 的 `fromCustomFood` 一起補；先寫會失敗的 check-engine 斷言（filterForSlot 產出的營養欄位要跟 catalog 相同、選 dr05 後鈉＝113.1）；commit 訊息更正 053d5d7「TFDA 飲品顯示實際鈉值」這句不實敘述。
   2. **A2**：溫沙拉的推薦卡片與自煮合計要註明「未含沙拉醬」（decisions #38）。
   3. **飲食限制標註**：`conv_pk03` Soyjoy、`conv_sl02` 改 vegan: false（Soyjoy 的 lacto_ovo 也保守改 false）；`conv_sl04`、`bx08`、`bx09`、`bx10`「未確認卻宣告全素」逐筆確認或改 false。
   4. **T1–T3**：`tools/lib/ingredient-values.js` 的 `field_sources.value` 覆寫只准用在參考資料原值是 null 的欄位，且值為 0，否則報錯。
   5. **T8**：check-data 對 label／official_web 出處的現成品項也做 B5.4 巨量營養素驗算。
   6. **C6.5**：修完請使用者在手機跑完整的 `docs/手機實機腳本.md`，留紀錄。
   - 建議項（可順手做或登記到 `docs/日後討論.md`）：推薦卡片 content note 顯示 AI 給的鈉數字（A3，要把內容描述跟資料沿革分開）；db 驗證要求自煮必有 implicit（A4）；vegan/過敏原一致性規則、TFDA 描述以「等」結尾視為不完整、跨檔 id 唯一、官方值凍結清單、check-arch C4.14 收緊；泡菜/照燒醬加「未確認」；木耳/泡菜 note 措辭、糙米 0.5 高估 10–25% 寫進 decisions；label_unsourced 中 .25/.75 纖維等 6 欄改 estimate；現成品項舊 note 清理；外食升級 derived 的清單登記去向。
   - 修完後開第二輪核對（逐條一行確認已解決，附 commit），回覆一樣逐字存檔。
2. 驗收後問使用者要不要推送到 GitHub（跑 CI）。
3. 之後是 **Phase 0**（「自己選」改三分頁、我的品項快速新增、品項卡片純文字、自煮分頁的用油/調味選項）。
4. `docs/日後討論.md` 有 −1b 審核登記的待評估項目（低碳下主食槽湊不到預算、超商組合隔天重複、shown_count 不衰減、煎蛋預設清淡、不加調味選項、溫沙拉沙拉醬），都要另外送 C3 審核。運動分頁「連續紀錄」仍暫緩。

## 5. 工作方式

- 權威規格 `docs/PRD.md`；章程 `docs/CHARTER.md`；決策 `docs/decisions.md`（到 #40）。先改 PRD、記 decisions，再改程式（A1）。
- 重大設計、偏離 PRD 的格式、改推薦演算法、改骨架：新開 Opus agent 獨立審核，**問答逐字存 `collab/opus-review-log/`**。
- 使用者習慣：問題附建議，常回「照建議」；只把產品決定交給使用者。可以直接 commit 到 master，訊息結尾 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`。
- 資料改動：每個 commit 附差異報告；能證明「只是重構」的，用腳本比對舊快照（例：id 改名後把舊快照套同一份改名對照再逐字比）。
- 畫面流程改到時，跑 `docs/手機實機腳本.md` 對應段落（−1b 的畫面變動已補進腳本，使用者還沒在手機上跑）。
