# 給接手的 Opus：Lighten2 交接（2026-09-28，Phase −1a 完成）

一律用中文回覆使用者。這份交接讓你不必重讀前一個 session 的對話就能接手。

## 1. 專案

- 「輕盈計畫」2.0（Lighten2）：個人減脂飲食追蹤 App，純前端 vanilla JS（ES modules）＋IndexedDB，沒有後端、單人使用。
- GitHub：`https://github.com/tongxiaooppo-boop/Lighten2`（remote `origin`）。本機 `D:\ok\lighten`，分支 `master`。v1 保存在 tag `v1-final`。
- **由 Opus 直接寫程式**（使用者 2026-09-28 拍板：「程式就你動手寫」），不交 Cline。沒有任何使用者資料需要遷移。

## 2. 目前狀態

- **Phase −1a（重構）已完成並通過獨立審核**（[審核紀錄](opus-review-log/2026-09-28-phase-1a-review.md)，兩輪，結論「可以驗收」）。
- 新結構：`js/core/`（slots、config、dates、html、num）→ `js/data/`（db.js 原生 IndexedDB `lighten2`、catalog.js）→ `js/engine/`（純函式：nutrition、budget、matcher、filters、meal-content、pool、recommend、today、tdee）→ `js/ui/`。進入點 `js/ui/app.js`，`index.html` 用 import map 帶版本字串。
- daily_log 已是新格式（PRD 第 3 節「daily_log 一筆的欄位」）。美饗日曆已完全移除。
- 同一天另外定案「我的組合」（PRD 第 11 節、decisions #31、#32，平行工作線 C，Phase 0 之後做），三輪獨立審核通過（[紀錄](opus-review-log/2026-09-28-my-combos.md)）。

## 3. 工具（每次提交都會跑）

| 指令 | 用途 |
|---|---|
| `node tools/check-engine.js` | 引擎斷言（31471 項） |
| `node tools/check-arch.js` | 章程 C1/C2/C4 的架構規則 |
| `node tools/diff-recs.js` | 推薦／體重校正／自己選／畫面快照，跟 `tools/snapshots/` 逐字比對；`--update` 重錄、`--full` 看全部差異 |
| `node tools/stamp-version.js` | **改了 js/、css/、data/ 就要跑，再 `git add index.html`**，不然 hook 會擋 |
| `node tools/smoke-browser.mjs` | 無頭 Edge 實際操作 App（約 30 秒，不在 hook 裡；Phase 驗收時跑） |

- pre-commit hook 已啟用（`git config core.hooksPath tools/hooks`），約 5 秒。禁止 `--no-verify`。
- GitHub Actions（`.github/workflows/check.yml`）還沒推上去跑過：**推送前要先問使用者**。目前本機領先 origin 很多個 commit。

## 4. 下一步：Phase −1b（修正）

規格在 PRD 第 7 節 −1b 列、[資料 review](../docs/review/2026-09-28-食物資料review.md)、[烹調油脂與鈉決策](../docs/review/2026-09-28-烹調油脂與鈉決策.md)、章程 B 全部。**每一項各自更新快照，快照 diff 就是差異報告**（章程 C6.3）。修 bug 前先寫會失敗的斷言（C5）。

−1a 刻意保留、−1b 要修的 v1 行為：
- `daysSince` 時區（`js/engine/recommend.js`）
- null 當 0（`meal-content.js` 的 `num`、`logTotal`、`composeTotals` 的 `|| 0`）
- 自訂食物跳過過敏原檢查、`unionTags` 略過缺欄成分（`filters.js`）
- 不吃清單以名稱比對（章程 C2 要改 id）

另外兩項待處理：
- **推薦重建就換掉**（`flow/rebuild-same-day` 快照）：卡片一顯示就記「今天顯示過」，同一天重建被降權。改評分屬章程 C3，要先送獨立審核。
- **運動分頁「連續紀錄 N 天」**：使用者決定先搞定飲食、運動分頁之後再議，已記在 `docs/日後討論.md`，**現在不要動**。

−1b 的資料重建（`tools/build-ingredients.js` 從 TFDA 產生、`data/reference/`、`tools/check-data.js`）是這一階段最大塊。`collab/tfdb-2025-simplified.json` 要先搬到 `data/reference/`。

## 5. 工作方式

- 參考 repo 的可用點與暫緩問題記在 `docs/日後討論.md`（不是規格，到該階段再討論）。
- 權威規格 `docs/PRD.md`；章程 `docs/CHARTER.md`；決策 `docs/decisions.md`（到 #34）。先改 PRD、記 decisions，再改程式（A1）。
- 重大設計、偏離 PRD 的格式、改推薦演算法：新開 Opus agent 獨立審核，**問答逐字存 `collab/opus-review-log/`**。
- 使用者習慣：問題附建議，常回「照建議」；只把產品決定交給使用者。可以直接 commit 到 master，訊息結尾 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`。
- 畫面流程改到時，跑 `docs/手機實機腳本.md` 對應段落。
- Windows 上用 Bash 工具寫多行 Python 時，heredoc 常被引號打斷：改成先用 Write 寫到 scratchpad 再執行。
