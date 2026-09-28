# 給接手的 Opus：Lighten2 開工交接（2026-09-28）

一律用中文回覆使用者。這份交接的目的是讓你不必重讀前一個 session 的對話，就能直接接手。

## 1. 你接手的是什麼

- 專案：「輕盈計畫」2.0（Lighten2）。個人減脂飲食追蹤 App，純前端 vanilla JS＋IndexedDB，沒有後端、單人使用。
- GitHub：`https://github.com/tongxiaooppo-boop/Lighten2`（remote `origin`）；舊版 repo 是 `v1-origin`，不再更新。
- 本機 repo：`D:\ok\lighten`，分支 `master`。
- 由 Opus 主導開發（之前是 Sonnet）。**沒有任何使用者資料需要遷移**，所以不寫相容層、不寫遷移程式。

## 2. 目前狀態

**設計與規範階段已結束，三輪獨立 Opus 審核的結論是「可以開工」。還沒有寫任何 2.0 的程式碼。**

- v1 程式碼在根目錄（`js/`、`data/`、`css/`、`index.html`、`tools/`），是改寫的起點。v1 的最終狀態保存在 git tag `v1-final`。
- `node tools/check-engine.js` 目前 31442 項全過（v1 的引擎斷言）。

## 3. 開工前必讀（依序）

1. [docs/PRD.md](../docs/PRD.md)：**唯一的權威規格**。先讀 0.1 節「開工前修訂」，再讀第 3 節（MealContent）、第 7 節（路線圖）、第 9 節（美饗日曆的職責去向）。
2. [docs/CHARTER.md](../docs/CHARTER.md)：章程。A 概念變更、B 食物資料、C 架構。每條規則標了〔機〕（自動檢查）或〔人〕（人工檢查）。**動手前一定要讀 C1（分層）、C2（單一真相來源）、C4（不可退化規則）、C5（修 bug 規則）、C6（驗收）。**
3. [docs/decisions.md](../docs/decisions.md)：30 條決策，一行一條。遇到「這個為什麼這樣定」先查這裡，不要重新討論。
4. [docs/review/](../docs/review/)：架構 review、食物資料 review、烹調油脂與鈉決策。每份末尾都有「獨立審核後的修正」節，**以修正節為準**。
5. 有疑問時才查 [collab/opus-review-log/](opus-review-log/)（逐字審核紀錄）。今天最相關的是 `2026-09-28-lighten2-review-and-charter.md`（三輪審核）；PRD 的原始設計是 `2026-09-28-prd-2.0-architecture-round1~3.md`。

## 4. 下一步：Phase −1a（重構）

詳細規格在 PRD 第 7 節的 −1a 那一列和章程 C6。順序很重要：

1. **先做工具，並用還沒動過的 v1 程式錄快照**，然後才能動任何重構：
   - `tools/diff-recs.js`：在 engine 介面層錄推薦與體重校正的規範化輸出，包括選中的組合 id、四捨五入後的營養值、縮放倍數。輸入是固定的 profile、各餐紀錄合計、倒讚紀錄，以及**固定的日期時間**。v1 的 `Date.now()`、`new Date()` 要在 vm 環境裡固定住。測試資料**不含預約**。快照存在 `tools/snapshots/`。
   - 另外錄一組「自己選」挑選器結果加營養加總的快照。
   - `tools/check-arch.js`：檢查依賴方向、禁止 engine 讀時鐘、grep 規則（運動紀錄、`picker_last_meal_type`、ui 裡的營養加總寫法、禁用字），以及重複函式名（附白名單）。
   - `tools/hooks/pre-commit` 加上 GitHub Actions workflow。量一下 hook 的總執行時間，超過約 30 秒就只在 hook 跑快的檢查，完整版交給 CI。
2. 重構內容：
   - 改成 ES modules；建立 `core/`（slots、config、dates、html）。
   - engine 改純函式：不 import `data/`，不讀時鐘。
   - `data/catalog.js` 接上**現有資料**，−1a 不改資料。
   - 4 份營養計算收斂到 `engine/filters.js` 和 `engine/meal-content.js`。
   - `data/db.js`：原生 IndexedDB 薄封裝、DB 名稱 `lighten2`、一筆紀錄一個 key、`daily_log` 改新格式、`undoDailyLog` 搬進來。
   - 部署用 import map 統一版本字串。
3. 移除美饗日曆（`tab-ledger.js`、`feast.js`、`feast_reservation`、`index.html` 裡的分頁），以及 `tab-today.js` 裡讀預約的分支（約 355–378 行）。
4. **刻意保留**的 v1 行為：`recommend.js` 的 `daysSince` 時區 bug、null 被當 0、自訂食物跳過過敏原檢查。這些到 −1b 才修，−1a 修掉會讓快照對不上。
5. 驗收：推薦與體重校正快照**逐字相同**；check-engine 全過；美饗日曆移除是刻意的行為變更，不算違反「行為不變」。

−1a 完成後是 −1b（修正：資料重建、用油、鈉、過敏原、低碳等，每項更新快照、附差異報告），然後是 Phase 0。

## 5. 工作方式（使用者的習慣與規則）

- **分工**：前一個 session 建議由你直接寫 −1a，使用者要求寫這份交接、沒有表示反對。開工前用一句話跟使用者確認即可，不需要再解釋理由。−1b 的資料重建這類機械性工作，可以考慮寫成任務交給 Cline（`collab/to-cline.md` 是交接格式；使用者會手動把它貼給 Cline，所以內容必須自成一體）。現有的 `collab/to-cline.md`（b535443，「刪除現成品項模式」）已經作廢，不要交出去。
- **重大設計要找獨立 Opus 審**（章程 C3）：用 `Agent` 工具（`model: opus`）新開一個 agent，完整問答逐字存到 `collab/opus-review-log/YYYY-MM-DD-主題.md`，只存摘要不算。使用者問過「你自己審不行嗎」，回答是自審看不到自己的盲點，第一輪審核確實抓到很多自審漏掉的問題（decisions #23）。
- **使用者拍板的方式**：提出問題時，每一題都附上建議，使用者常回「照建議」。只把真正需要產品決定的問題交給使用者，技術面的自己決定就好。
- **先改 PRD、記 decisions.md，再改程式**（章程 A1）。決定移除一個功能時，要列出它每一項職責搬到哪裡（前一個 session 在這裡漏過兩次）。
- **修 bug 要先寫一條會失敗的斷言**（章程 C5）。
- **commit**：可以直接提交到 master。訊息結尾加 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`。資料變更的 commit 訊息照章程 B11.5 的格式。推送到 GitHub 前先問使用者，除非使用者已經說過要推。

## 6. 容易踩的坑

- 美饗日曆已經決定被超商／外食分頁取代。不要再把它當成要維護或要修的東西（使用者問過「怎麼還在」）。
- 營養數值不要手抄：TFDA 食材由 `tools/build-ingredients.js` 從 `data/reference/` 產生（−1b 才做，要先把 `collab/tfdb-2025-simplified.json` 搬到 `data/reference/`）。
- 食材權威來源：TFDA 2025 xlsx（`collab/食品營養成分資料庫2025版UPDATE1EXCEL(另開新視窗).xlsx`，2213 筆、111 欄）與 `collab/食物代換表.pdf`。代換表只用在份量和生熟重，不當營養數值的出處。
- 本機開發 ES modules 要用本機 server 開，不能用 `file://`。
- 在 Windows 上用 Bash 工具時，不要在 heredoc 以外的地方寫 `cat > 檔案`，它會卡住等 stdin。
