# Phase −1b 驗收審核

日期：2026-09-28　實作者：Opus（Lighten2 主導開發）　審核者：新開的獨立 Opus agent

## 第一輪：送審問題（逐字）

你是 Lighten2（個人減脂飲食 App，純前端 vanilla JS＋IndexedDB，repo 在 `D:\ok\lighten`）Phase −1b 的獨立驗收審核者，不是實作者。**只讀不改**任何 repo 檔案（要驗證可以把 repo 複製到 scratchpad 底下改著試）。用中文回答。

範圍：commit `14d9b96`（docs: 主食生熟基準定案）到 HEAD，共約 30 個 commit。用 `git log --stat 14d9b96^..HEAD` 看清單，每個 commit 訊息都有差異報告。

依據：`docs/PRD.md` 第 7 節 −1b 列（驗收：每一項各更新推薦快照、差異報告；check-data、check-engine 全過）、`docs/CHARTER.md`（B 全部、C1–C6）、`docs/decisions.md` #35–#40、`docs/review/2026-09-28-食物資料review.md`（含第 5、6 節）、`docs/review/2026-09-28-烹調油脂與鈉決策.md`、上一輪待審三項的審核紀錄 `collab/opus-review-log/2026-09-28-phase-1b-batch.md`。

請審：
1. **−1b 列的每一項是否都完成**，有沒有漏項或只做一半（逐項列：完成／部分／未做）。
2. **資料正確性**：抽查 `data/ingredients.json` 的 TFDA 樣品選擇（至少 10 筆，用 `data/reference/tfda-2025-update1.json` 核對）、生熟基準（decisions #35）、過敏原、複合料理判定、`label_unsourced` 分類、麥當勞與 TFDA 飲品的重算。營養師角度的判斷有沒有明顯錯誤。
3. **程式正確性**：null 傳染與鈉/飽和脂肪例外、低碳縮放上限、用油與調味（含少油換算、不縮放、紀錄快照）、同一天重建（#39）、不吃清單只比 key、手動記錄規則、自訂食物過敏原與 db 驗證。找得到會出錯的具體輸入就寫出來。
4. **工具是否真的擋得住**：check-data、check-engine、check-arch 的新規則有沒有漏洞（例如改壞資料卻通過）。
5. **章程遵守**：先改 PRD/decisions 再改程式（A1）、修 bug 先寫失敗斷言（C5）、每項各自更新快照（C6.3）、C2 單一來源、C4 各條。
6. 還有什麼應該在 −1b 修、卻留到之後的。

格式：每個發現標【一定要改】或【建議】，附檔案與行號、重現方式。最後一行寫總結論（−1b 可以驗收／需再修）。
