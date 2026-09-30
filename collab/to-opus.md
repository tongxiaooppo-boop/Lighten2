# 給接手的 Opus：Lighten2 交接（2026-09-30，工作線 D 切片 −1、0、1 已推送；切片 2 計畫第一版已審，待改第二版＋問使用者 Q1、Q2）

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
| `node tools/smoke-browser.mjs` | 無頭 Edge 實際操作 App（約 30 秒；Phase 驗收時跑；B-3 起含備份還原與全有全無，B-1a 起含複製全有全無、隱藏推薦品項，26 項）。**沙箱擋外網時 Google Fonts 會報 console 錯誤（ERR_SSL_PROTOCOL_ERROR），那一項失敗是環境問題** |
| `node tools/mobile-walkthrough.mjs` | 手機實機腳本自動版：模擬手機照腳本操作＋每步截圖（約 1.5 分鐘，219 項；第 5 節資料備份、第 6–7 節我的品項）。**動到畫面流程、Phase 驗收時必跑，截圖要逐張看過**，再請使用者跑腳本開頭的「使用者短清單」（章程 C6.5） |

- pre-commit hook 約 8 秒。禁止 `--no-verify`。
- 推送前要先問使用者。2026-09-29 已推送，CI（check）通過。
- Windows 上寫多行 Python/JS 時 heredoc 常被引號打斷：先用 Write 寫到 scratchpad 再執行。

## 4. 下一步

0. **工作線 D「我的食物」（2026-09-30 起，目前主線）**：PRD 第 13 節、decisions #74–#95、章程已改（芒果、C4.3、C4.6、C4.8 單品、C4.17 改寫、B4 分層品項欄位、B6.9、B10、B12）。設計草案 [docs/review/2026-09-30-我的食物分頁-設計草案.md](../docs/review/2026-09-30-我的食物分頁-設計草案.md)；審核逐字 `collab/opus-review-log/2026-09-30-my-foods-tab-review.md`（兩輪）、`2026-09-30-workline-d-c3-review.md`（C3 專項）。
   - 已完成（2026-09-30 已推送，待使用者手機看芒果選項與「點心棒」組名）：切片 −1 文件（`3ad28af`、`26d2c4c`）、切片 0 拆「蛋白飲/點心棒」（`aafe6c3`，快照不變）、切片 1a 芒果詞彙（`5d3a082`）、1b `tw_tc08` 加未確認（`68e540a`，差異報告在 commit）、手機腳本期望更新（`6a7a350`，219 項全過）。
   - **切片 2 進行中（2026-09-30）**：實作計畫第一版 [docs/review/2026-09-30-D2-實作計畫.md](../docs/review/2026-09-30-D2-實作計畫.md) 已寫；獨立審核第一輪逐字 `collab/opus-review-log/2026-09-30-d2-plan-review.md`，結論「改完可以開工，不需要第二輪全面審核」。**下一步**：
     1. 依審核改計畫成第二版（M1–M4 一定要改、S1–S14 建議改；照慣例全部採納，理由不同意的寫出來）。重點：
        - M1：check-engine 沒有 IndexedDB → db.js 匯出純函式 `addDislikedTo`／`removeDislikedFrom`／`mergeProfileForm`，專用寫入函式與 fake-db 共用它們；真的要碰 DB 的斷言放 smoke-browser。
        - M2：明細出處改照 PRD 12.1 的中性標示（衛福部／國外資料庫／包裝或官網標示／估算／你填的／從內建複製），出處類別由 `data/catalog.js` 推導（章程 B3），**不顯示 ref**（ref 裡有「Google AI 回覆估算」等開發註記），只有 tfda 附整合編號；依類別分組顯示；明細補 `valid_slots`。已查的事實：內建品項各欄位出處 estimate 642、label_unsourced 44、derived 42（其中 ref 以衛福部整合編號開頭的 26 → 歸「衛福部」；其餘 16 是「熱量−蛋白質×4−脂肪×9」反推 → 歸「包裝或官網標示」）；**`label_unsourced` 歸哪類 PRD 沒寫，要在計畫裡定**（建議「包裝或官網標示」，因 B3 定義是「看起來來自單一商品包裝」——或保守歸「估算」，二選一寫理由）。
        - M3：開工前先改 PRD 13.2（分頁數、基本資料清單補體重回填與校正卡片）、13.9 切片 2 驗收（recs 只允許 `flow/chip-dinner-protein/write0` 的操作名稱不同，行內 `op` 出現兩次都要換；picker、ui 逐字不變），記 decisions；拿掉頂層分頁屬 A1 概念變更 → 這份審核當 C3 審核。
        - M4：walkthrough 3-2b（L299 正規式）、2-5 保留「順便不要 → 按計算 → 不會被蓋掉」回歸；`docs/手機實機腳本.md` L16、L22、L52 一起改；節次用腳本自己的編號。
        - 也要處理：S1 刪 `saveProfile`（check-engine L839、L846 改測 saveProfileForm）、S3 commit 中間狀態、S4 `tab-foods.js` 唯一 state 擁有者並避開 check-arch 重名、S7 選擇器關閉時不吃變過要重算今日建議、S9 自煮軸排序延到切片 4／5、S10 adapter 多錄 `.../disliked` 一行。
     2. **問使用者兩個決定**（還沒問）：Q1 分頁列——建議拿掉空的「採買清單」（Phase 4 才有內容）、5 個等寬不橫捲；審核補充：Phase 3 日曆、Phase 4 採買清單之後會回到 6–7 個，可以現在就定「兩者都放在本週總覽裡的子頁」讓分頁固定 5 個，或選撐得住 6–7 個的 3×2 格線。Q2——自煮子分頁延到切片 4（審核同意）。
     3. 改 PRD／decisions → 實作（commit 拆法見計畫第 5 節，依 S3 調整）→ smoke、walkthrough（390＋360 截圖逐張看）→ 手機短清單給使用者。
     - 審核附帶的資料缺陷：`tw_dr05`、`tw_dr09` 有欄位的 `derived` ref 只寫「咖啡飲品」不是公式，check-data 沒擋（記進日後討論或另開 `data(fix)`）。
   - decisions #95 的三個預設（料理可用分層品項、對不到代換表的內建食材可當單品、燕麥奶歸飲品）是照審核建議，待使用者確認。
   - 原始資料：`collab/transcripts/`（代換表 339 列／374 品名、過敏原標註合併版 `exchange_tags.json` 與審查 `exchange_tags_review.md`；第二輪審核指出的標註修正〔牛油、饅頭、瓜子、芒果類〕要在切片 3 轉入時一起做）。

1. **Phase 0 已驗收並推送**（2026-09-29，commit `402ad83`～`0d727b1`；smoke-browser 14 項、mobile-walkthrough 144 項全過）。**已驗收**：使用者 2026-09-29 用手機跑短清單通過。
   - 新架構：`js/engine/picker.js`（預設分頁、分頁、分組、快速新增預設與預告）；`js/ui/meal-picker/`（index.js 狀態與事件、product-tab.js、cook-tab.js、estimate-card.js、quick-add.js）；合計一律 `buildDraftContent`＋`contentTotals`；草稿合計凍結在 `tools/fixtures/draft-totals.json`（`node tools/check-engine.js --freeze-draft-totals` 重錄，只有刻意改資料時才用）。
2. **PRD 第 12 節「食物資料：查詢與修訂」已定案**（2026-09-29，四輪獨立審核，問答逐字在 `collab/opus-review-log/2026-09-29-food-data-review.md`；decisions #50–#70；CHARTER B1、B2、B5.6、B5.7、B8、B9、B10、B12、C1.5、C4.11、C4.16、新增 C4.17 已同步）。要點：三層資料；我的食材＝常買清單（衛福部來源只存 `tfda_id`、執行時讀 `data/tfda_lookup.json`）；我的料理＝MealContent 新元件 `dish`（store `custom_dishes`，不綁骨架、不進推薦）；我的組合可直接編輯；份量倍數 `qty`。路線圖：B-3 → B-1a → B-1b／B-1c → B-4a → B-4b；C 不依賴 B-1。
3. **B-3 匯出／匯入已實作（2026-09-29，commit `8a5035a`～`21c836c`，已推送）**：計畫 [docs/review/2026-09-29-B3-實作計畫.md](../docs/review/2026-09-29-B3-實作計畫.md)，三輪審核逐字在 `collab/opus-review-log/2026-09-29-b3-plan-review.md`；PRD 11.6、decisions #71–#72、章程 C4.12 已改。db.js：`exportAllData`／`importAllData`（一個 transaction 清空後寫入）、`validateBackup`／`migrateBackup`／`summarizeBackup`、`SETTING_KEYS`（`setSetting` 會驗 key 與值）、`BACKUP_SCHEMA_VERSION`（加 store 或 settings key 要 +1 並在 `tools/fixtures/` 凍結新 fixture）；順手修了 `withStores` 同步丟錯不 abort 的 bug。畫面在 `js/ui/backup.js`。**待使用者**：手機短清單第 4 項；決定 A 已定案（還原前要先匯出或勾「不需要保留」）、決定 B 已定案（不處理舊資料：App 還沒給別人用；維持不合法就擋下）。內建資料編輯器、分享包仍是日後討論（未定案）。
3a. **B-1a 我的品項管理＋份量倍數已實作（2026-09-29，commit `b276f39`～`6d4a317`，已推送）**：計畫 [docs/review/2026-09-29-B1a-實作計畫.md](../docs/review/2026-09-29-B1a-實作計畫.md)，兩輪審核逐字在 `collab/opus-review-log/2026-09-29-b1a-plan-review.md`；PRD 10.x／12.3、decisions #73。
   - 選擇器：已選段（清單上方）份量晶片、隱藏＋復原、複製成我的版本（`js/ui/custom-food-form.js` 完整表單）、補填（只給「成分未確認」「飲食限制未確認」）；飲料的份量在飲料步驟。
   - 基本資料「我的品項」區塊：`js/ui/profile/custom-foods.js`。
   - db：`updateCustomFood`（`applyCustomFoodPatch` 純函式）、隱藏清單專用函式（`hidden_catalog_uids` 是 dedicatedOnly，只擋在 setSetting）、`copyBuiltinToCustom`（一個 transaction 新增＋隱藏）、qty 只能 0.5／1／1.5／2、備份 v2（`tools/fixtures/backup-v2.json` 凍結自 smoke 真的匯出；`SMOKE_FREEZE_BACKUP=路徑 node tools/smoke-browser.mjs` 可重新凍結）。
   - 跟計畫不同的兩處：`copyFromBuiltin`／`builtinCurrentValues` 放 `meal-content.js`（有鈉與飽和脂肪，章程 C4.14 只准那裡處理），不是計畫寫的 picker.js；飲料份量跟品項共用 `qtyByUid`，沒有另設 `drinkQty`。
   - **待使用者**：手機短清單第 4 項（備份）、第 5 項（我的品項）；確認 decisions #73 的預設（入口在已選段、隱藏有復原、取消隱藏不擋只提示、管理區可以直接新增）。
   - **下一個**：B-1c（成分明細，只依賴 B-3）或 B-1b（食物資料查詢，要先做 `data/tfda_lookup.json` 產生工具）；平行工作線 A（擴充餐型）也可以插進來。
4. **已修並推送（2026-09-29，`ad63a06`）**：推薦卡片「配額已經不多了」「暫無適合的組合」也有「自己選」（`js/ui/tab-today.js` `pickBtnHtml`）；重現步驟 mobile-walkthrough 3-12、手機實機腳本 3-12。使用者還沒在手機上看。
5. `docs/日後討論.md`：−1b 待評估項目（送 C3）、手機截圖發現的畫面問題（百分比誤解、44px 等）。運動分頁「連續紀錄」仍暫緩。
6. `collab/pdf/` 兩份 PDF 超過 50 MB，要不要移出 repo 或改 Git LFS 待使用者決定（不急）。

## 5. 工作方式

- 權威規格 `docs/PRD.md`；章程 `docs/CHARTER.md`；決策 `docs/decisions.md`（到 #73）。先改 PRD、記 decisions，再改程式（A1）。
- 重大設計、偏離 PRD 的格式、改推薦演算法、改骨架：新開 Opus agent 獨立審核，**問答逐字存 `collab/opus-review-log/`**。
- 使用者習慣：問題附建議，常回「照建議」；只把產品決定交給使用者。可以直接 commit 到 master，訊息結尾 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`。
- 資料改動：每個 commit 附差異報告；能證明「只是重構」的，用腳本比對舊快照（例：id 改名後把舊快照套同一份改名對照再逐字比）。
- 畫面流程改到時，跑 `docs/手機實機腳本.md` 對應段落（−1b 的畫面變動已補進腳本，使用者還沒在手機上跑）。
