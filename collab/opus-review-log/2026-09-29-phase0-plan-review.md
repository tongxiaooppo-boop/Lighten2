# Phase 0 實作計畫審核

日期：2026-09-29　實作者：Opus（Lighten2 主導開發）　審核者：新開的獨立 Opus agent

## 第一輪：送審問題（逐字）

你是 Lighten2（個人減脂飲食 App，純前端 vanilla JS＋IndexedDB，repo 在 `D:\ok\lighten`）Phase 0 實作計畫的獨立審核者，不是實作者。**只讀不改**任何 repo 檔案。用中文回答。

要審的是 `docs/review/2026-09-29-Phase0-實作計畫.md`。它把 round2 審核寫的 Phase 0 規格（`collab/opus-review-log/2026-09-28-prd-2.0-architecture-round2.md` 第 2 節，寫在 −1a／−1b 之前、用 v1 名稱）對照現在的程式重寫，並併入 −1b 手機實測發現的問題。

依據：`docs/PRD.md`（第 2、3、4、6、7、9、10 節）、`docs/CHARTER.md`（A、C 全部，特別是 C1、C2、C4、C5、C6）、`docs/decisions.md`、`docs/日後討論.md`（最後兩節）、現在的程式（`js/ui/manual-picker.js`、`js/ui/item-picker.js`、`js/engine/meal-content.js`、`js/engine/filters.js`、`js/engine/pool.js`、`js/data/db.js`、`js/core/config.js`、`index.html`）、測試工具（`tools/check-engine.js`、`tools/diff-recs.js`、`tools/lib/adapter-v2.js`、`tools/mobile-walkthrough.mjs`）。

請審：
1. 計畫第 2 節的範圍有沒有漏掉 PRD Phase 0 列或 round2 2.x 仍然有效的項目；有沒有做了不該在 Phase 0 做的。
2. 計畫跟 PRD、章程、decisions 有沒有衝突（例：C1 分層、C2 單一來源、C4.1 硬性過濾、C4.5 null 傳染、C4.8 手動記錄、C4.11 隱含成分、C4.12 運動脫鉤、C4.13 不評判、C4.15 picker_last_meal_type、PRD 6.1、6.3 自組原則）。
3. 第 3 節的程式結構是否合理（engine/ui 分界、要不要新資料夾、多選自煮對現有 `composeTotals`／`contentFromCompose`／推薦候選池的影響、MealContent 格式是否需要改）。
4. 第 4 節驗收清單是否足以證明做對了，特別是哪些要 check-engine 斷言、哪些靠 mobile-walkthrough。
5. 回答第 6 節列的問題 1–9。其中第 2 題（手動主餐上限）如果你判斷是產品決定、應該交給使用者，請寫出建議選項與理由。
6. 第 5 節 commit 拆法與順序是否符合章程 A1（先改 PRD/decisions 再改程式）與 C5（修 bug 先寫失敗斷言）。

格式：每個發現標【一定要改】或【建議】，附依據（檔案與行號或章節）。最後一行寫總結論（計畫可以開工／要先修改計畫）。
