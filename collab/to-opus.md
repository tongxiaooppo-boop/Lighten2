# 給接手的 Opus：Lighten2 交接（2026-10-02 收工：切片 8 我的食材完成、推送、使用者手機測過；下一步日期切換與預約）

一律用中文回覆使用者。這份交接讓你不必重讀前一個 session 的對話就能接手。

**2026-10-02 最新（先讀）**：
- 已推送：`f9200bf` 8a 衛福部查詢檔（`data/tfda_lookup.json`、`tools/build-tfda-lookup.js`、`data/reference/tfda_tags.json`／`tfda_groups.json`）；`1286f63` 查詢檔缺值補 0；`8f11984` 8b 計畫第三版。decisions #134（使用者：分類篩選、顯示位置、衛福部／自填標示、生熟固定、說法統一）、#135（8a 技術）、#136（使用者：克數記法全部單品、一份留空＋參考、衛福部過敏原不能改）、#137（補 0）；#138 留給 8b 技術定案。
- **8b 計畫** [docs/review/2026-10-02-D8b-實作計畫.md](../docs/review/2026-10-02-D8b-實作計畫.md)：兩輪審核逐字 `collab/opus-review-log/2026-10-02-d8b-plan-review.md`；**第 8、9 節為準**。拆 8b-1（db、engine 克數記法、份／克切換、說法統一 → 使用者手機測一次）與 8b-2（新增食材、自填、我的食材組）。
- **8b-1 已完成（commit ①–⑥：`docs PRD #138`、`34e6cc7` db、`621f2b2` engine、`9cf017e` 說法統一、`8f9618d` 份／克切換＋saved-ctx、`eb9493c` tools）**：check-engine 43k、smoke 51、walkthrough 489 全過，截圖看過（含 360 寬）；快照只新增 amount/mixed 7 行。手機腳本短清單第 10 項＝這次要測的。使用說明交 Sonnet 改（說法＋份／克），Opus 驗收後 commit（已完成、已推送）。
- **8b-1 使用者 2026-10-02 手機測過**（短清單第 10 項）。
- **8b-2 已完成並推送（`c55107d` ui＋engine＋查詢檔熟樣品規則 #139、`9400add` tools、`421f517` 使用說明；2026-10-02 推送）**：check-engine 43432、check-arch 33141、smoke 54（含查詢檔載入失敗→重試、移除→復原、同樣品不能加兩次）、walkthrough 521（第 12 節我的食材，截圖看過含 360 寬），快照逐字不變。手機腳本短清單第 11 項＝這次要測的（第 53–59 行）。使用說明已更新。**使用者 2026-10-02 手機測過短清單第 11 項。**
  - 實作時的發現：衛福部熟的魚、蛋原本被標「照現狀」→ decisions #139 改成品名有烹調法的新鮮食材算熟；walkthrough 的 8-5 偶發失敗是「我的食物」重讀前就點了舊畫面 → refreshFoods 期間 #foods-body 標 data-loading，foodsSub 等它消失。
  - 已知、刻意：自填表單的數字欄只有 placeholder（填了以後看不到欄位名稱），跟我的品項表單一致；使用者覺得難懂再改。
- **接下來的順序（使用者定，不變）**：日期切換與預約（#118、#129；克數記法的元件形狀 `{ ref, qty | amount }` 預約沿用）→ 擴充餐型 → 切片 9 我的料理（料理引用衛福部食材用 id 反推整合編號讀查詢檔，PRD 12.4 已寫）→ 切片 10 沖泡 → 採買清單。
- 使用者說週額度剩 29%：查詢、整理、使用說明這類小工作交 Sonnet。
- 使用說明 `docs/使用說明.html` 已跟著說法統一與我的食材改好（`421f517`）；之後功能改了照樣交 Sonnet、Opus 360 寬驗收。

**2026-10-01 收工時的狀態（舊）**

**已完成、已推送、使用者手機測過**：切片 7 單品、工作線 C 我的組合（短清單第 8 項）、切片 5 常吃（選擇器，短清單第 9 項）。`docs/使用說明.html`（分頁版使用說明，跟 App 一樣的分頁與子分頁）已寫到常吃；**功能改了要回頭改它**（交 Sonnet 寫、Opus 在 360 寬驗收；注意頁內 `#xxx` 連結會被分頁切換程式攔截，只能用分頁名稱開頭的 hash）。

**2026-10-01 使用者定的事（decisions #128–#133）**：
- #128 **常吃不進推薦，切片 6 取消**（計畫與審核留作紀錄）；章程 C4.17② 與 check-arch 已收緊（`favoriteRefs` 只准 engine/picker.js，`getFavoriteRefs` 不給 tab-today）。
- #129 日期切換的方向：未來六天每一餐（五餐）先預約餐型，自煮可以再選內容；推薦只在今天；當天有內容照內容、只有餐型照餐型推薦、沒預約照基本資料；採買清單之後由自煮預約產生。
- #130 **推薦定調為輪替**；推薦評分（同分依 id 字母排序造成晚餐天天糙米飯、纖維與蛋白質加分主導、扣分看「顯示過」不是「吃過」）**等網友回報再調，不要主動改**。細節在 `docs/日後討論.md` 最後一節。
- #131 切片 8 我的食材：衛福部搜尋只列代換表沒用到的約 1895 筆；過敏原與素食帶入 `collab/transcripts/tfda_tags_merged.json`；「一份幾克」選填，記錄時可以直接輸入克數（`food` 元件要加克數記法）。
- #132 自助餐／共餐併進切片 9「我的料理」。
- #133 切片 9 細節：油量選一般／少油；一餐最多 6 樣（含湯，現行 `FOOD_MAX_PER_MEAL = 4` 要改，計畫確認範圍）；1 份＝菜熟重 80g、湯 1 碗約 250ml（使用者確認照 Opus 建議）。

**接下來的順序（使用者定）**：
1. **切片 8 我的食材（明天開始）**：先處理 `collab/transcripts/tfda_tags_review.md`「還沒解決」第 2、3、4、7 點（標註說明 11 詞→12 詞、`composite` 與「等」字規則、check-data 芒果同義字誤判「檸檬果乾」、自製茶葉蛋）；照 #131 改 PRD 12.4、13.4、13.8；寫 `data/tfda_lookup.json` 產生工具（排除代換表已用樣品）；寫實作計畫（格式比照 `docs/review/2026-10-01-D5-實作計畫.md`），送獨立 Opus 審核（問答逐字存 `collab/opus-review-log/`），產品問題問使用者並附建議（例：「一份幾克」要不要預填——Opus 先前建議：代換表沒有的留空、附一句參考，不要一律 100g）。克數記法要讓日期切換的預約能沿用。
2. **日期切換與預約**（#118、#129）：先寫設計草案、改 PRD 第 5 節與第 7 節、#118 的待定細節，送 Opus 審核（大架構），再寫實作計畫。
3. **擴充餐型**（工作線 A）：調研 `collab/proofs/2026-10-01-workline-a-archetype-survey.md`；開工時先問使用者四個口味方向（湯品、白飯與麵、豬肉、滷與湯的鈉提示）；改骨架送 Opus 審核。
4. **切片 9 我的料理（含自助餐／共餐）**：家常菜調研 `collab/proofs/2026-10-01-home-dishes-survey.md`；PRD 排除共食的寫法、Phase 5「自助餐支援」要改寫；處理日後討論的「醬料熱量與調味鈉」。
5. 切片 10 沖泡 → 採買清單。

**還沒問完的**：decisions #95 的三個預設（料理可用分層品項、對不到代換表的內建食材可當單品、燕麥奶歸飲品）照審核建議，使用者還沒確認（Opus 建議照預設）。

**新 session 接手的做法**：先讀本段；寫計畫前從要動的函式往外查依賴（記憶：寫計畫前先查依賴）。實作注意：①含反引號的腳本先寫成檔案再跑；②選擇器、今日建議的 render 路徑不能無條件 query 新的 DOM id（快照 fake DOM 的 domNN 會位移）；fake-db 寫入紀錄的形狀不能變（推薦快照錄了它）；③每個 commit 的 hook 跑 check-data、check-engine、check-arch、diff-recs；改 js/css 要 stamp-version＋git add index.html；④畫面改動跑 smoke 與 mobile-walkthrough 並逐張看截圖；⑤使用者測試時直接告訴他手機實機腳本的行號（文件很長）；⑥推送前先問使用者；⑦一律用中文，選擇題也是。

**2026-10-01 Sonnet 做好的外圍準備（都在 `collab/proofs/`，Opus 已抽驗）**：`2026-10-01-d7-serving-text-cases.md`（切片 7 份量文字測資）、`2026-10-01-d7-phone-script-draft.md`（切片 7 手機腳本草稿，實作後搬進正式腳本的第 8 節）、`2026-10-01-workline-c-survey.md`（工作線 C 調研，17 條規格空白；寫 C 計畫時整理成問題問使用者，例如管理區塊放哪）、`2026-10-01-workline-a-archetype-survey.md`（工作線 A 擴充餐型調研：13 個候選骨架，瓶頸是缺「蒸、水煮／燙、滷／燉」三個烹調法；建議先做清蒸魚定食、滷燉定食、蛋飯類；口味方向〔湯品、麵食、豬肉、滷與湯的鈉〕要問使用者）。`collab/to-ai-allergen-tagging.md` 已改成 12 詞通用版。

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
| `node tools/check-engine.js` | 引擎斷言（約 43432 項，台灣時區跑；切片 7 起有「單品」、工作線 C 起有「我的組合」、切片 5 起有「常吃」一節） |
| `node tools/check-arch.js` | 章程 C1/C2/C4 的架構規則 |
| `node tools/diff-recs.js` | 快照逐字比對；`--update` 重錄、`--full` 看全部差異 |
| `node tools/stamp-version.js` | **改了 js/、css/、data/ 就要跑，再 `git add index.html`** |
| `node tools/smoke-browser.mjs` | 無頭 Edge 實際操作 App（約 30 秒；Phase 驗收時跑；B-3 起含備份還原與全有全無，B-1a 起含複製全有全無、隱藏推薦品項；切片 7 起含單品寫入與備份來回；工作線 C 起含資料庫 v1→v2 升級、組合全有全無；切片 5 起含常吃互斥、全有全無、複製轉移，50 項；`SMOKE_FREEZE_BACKUP=tools/fixtures/backup-v4.json` 重凍目前版本的 fixture）。**沙箱擋外網時 Google Fonts 會報 console 錯誤（ERR_SSL_PROTOCOL_ERROR），那一項失敗是環境問題** |
| `node tools/mobile-walkthrough.mjs` | 手機實機腳本自動版：模擬手機照腳本操作＋每步截圖（約 2.5 分鐘，521 項；第 5 節資料備份、第 6–7 節我的品項、第 8 節我的食物、第 9 節單品、第 10 節我的組合、第 11 節常吃、第 12 節我的食材）。**動到畫面流程、Phase 驗收時必跑，截圖要逐張看過**，再請使用者跑腳本開頭的「使用者短清單」（章程 C6.5） |

- pre-commit hook 約 8 秒。禁止 `--no-verify`。
- 推送前要先問使用者。2026-09-29 已推送，CI（check）通過。
- Windows 上寫多行 Python/JS 時 heredoc 常被引號打斷：先用 Write 寫到 scratchpad 再執行。

## 4. 下一步

0. **工作線 D「我的食物」（2026-09-30 起，目前主線）**：PRD 第 13 節、decisions #74–#95、章程已改（芒果、C4.3、C4.6、C4.8 單品、C4.17 改寫、B4 分層品項欄位、B6.9、B10、B12）。設計草案 [docs/review/2026-09-30-我的食物分頁-設計草案.md](../docs/review/2026-09-30-我的食物分頁-設計草案.md)；審核逐字 `collab/opus-review-log/2026-09-30-my-foods-tab-review.md`（兩輪）、`2026-09-30-workline-d-c3-review.md`（C3 專項）。
   - 已完成（2026-09-30 已推送，待使用者手機看芒果選項與「點心棒」組名）：切片 −1 文件（`3ad28af`、`26d2c4c`）、切片 0 拆「蛋白飲/點心棒」（`aafe6c3`，快照不變）、切片 1a 芒果詞彙（`5d3a082`）、1b `tw_tc08` 加未確認（`68e540a`，差異報告在 commit）、手機腳本期望更新（`6a7a350`，219 項全過）。
   - **切片 2 已實作（2026-09-30，commit `b157ac2`～`5743d89`，2026-09-30 已推送，CI 通過）**：計畫第二版 [docs/review/2026-09-30-D2-實作計畫.md](../docs/review/2026-09-30-D2-實作計畫.md)（第 8 節是第一輪審核意見的處理對照）；審核逐字 `collab/opus-review-log/2026-09-30-d2-plan-review.md`（兼 C3 審核）。使用者決定：分頁固定 5 個、日曆與採買清單將來放本週總覽子頁（#96）；自煮子分頁切片 4（#97）；衛福部全表瀏覽／「代換表 400／全部」切換留日後討論。
     - 做了什麼：`b157ac2` 文件（PRD 7、12.1、13.2、13.3、13.9，decisions #96–#100）；`84478e1` check-data 限定現成品項 derived 三種寫法（審核 Q3 說的 `tw_dr05/09` 纖維是章程 B5.1 缺值填 0 的既有寫法，資料沒改）；`33b11da` engine（原因代碼、`splitDisliked`、`partitionAllChannels`、`engine/foods.js`、catalog `source_class`、db 不吃純函式＋專用函式）；`5743d89` 畫面（我的食物分頁、選擇器不吃組、刪 `saveProfile`／`hideCatalogItem`）。
     - 快照：recs 只有 `write0` 操作名稱（已證明）；picker 新增 15 行 `.../disliked`。smoke 29、walkthrough 280 全過，截圖看過。
     - 事實：內建 104 筆的營養欄位出處＝估算 693、衛福部 35、沒有包裝或官網標示——明細幾乎都寫「估算」（記進日後討論）。
     - **待使用者**：手機短清單第 6 項（分頁列、我的食物、標不吃與取消、搜尋）＋第 5 項（已改成「不吃」）。辨認新版：上方有「我的食物」。
   - 切片 3、4 照使用者決定一起推送（2026-09-30），使用者只在手機測一次。
   - **切片 3 已實作（2026-09-30，commit `9b4a918`～`80afeeb`，已跟切片 4 一起推送）**：計畫第二版 [docs/review/2026-09-30-D3-實作計畫.md](../docs/review/2026-09-30-D3-實作計畫.md)（第 8 節是審核意見對照）；審核逐字 `collab/opus-review-log/2026-09-30-d3-plan-review.md`（一輪，「改完就能開工」）；decisions #101–#111。
     - `9b4a918` 文件（PRD 13.3、13.9；章程 B2、B4、B5.1、B6.2、B10、B12）。
     - `d6dd570` **data(fix) 安全修正**：內建 `mixed_grain_rice_cooked`（雜糧飯）改 `["麩質","未確認"]`、拿掉素食（樣品五穀米含麥片）。快照刻意差異：pool 360、matrix 256、recs 8、ui 4 行；比對腳本 `collab/proofs/2026-09-30-verify-grain-fix.js`。**素食與任何過敏原設定的推薦會變（雜糧飯→糙米飯／藜麥），手機測時要知道**。
     - `ac501cc` check-arch C4.17 ③（`"dish"`、`"food"`、`foodTree`）＋自我檢查。
     - `b8ba0bc` `data/reference/food_exchange_table.json` 換完整轉錄（蒸發奶 PDF 原文就是「1 1/2 杯」＝原表誤植）、`food_exchange_tags.json`（標註搬進 reference 並修正）。
     - `58af925` **分層資料**：`data/reference/food_tree_map.json`（374 品名人工對應＋理由；318 收、2 筆 split、6 併入、50 不收；10 筆只列內建）、`food_tree_ids_frozen.json`（293 個 fx_）、`tools/build-food-tree.js`（`--dry`、`--report`）、`tools/lib/food-tree-values.js`、`data/food_tree.json`（330 筆，297KB／gzip 32KB）、check-data 分層規則＋自我檢查 31 條。對應時再修標註 3 筆（通心粉加蛋、牛油＝奶油標乳製品、南瓜子改未確認）。
     - `80afeeb` `catalog.foodTree`（`normalizeFoodTree`）＋check-engine 25 項；快照逐字不變；smoke 29 全過。
     - **改對應**：直接改 `data/reference/food_tree_map.json`（或標註檔）→ `node tools/build-food-tree.js` → check-data。撰寫稿只在舊 session 的 scratchpad，已不需要。
   - **切片 3 抽查審核已完成（2026-09-30，commit `6040ceb`、`c9b04f3`，已推送）**：逐字 `collab/opus-review-log/2026-09-30-d3-spotcheck-review.md`，結論「小修後通過」；decisions #112–#113。魚脯下架（retired）、烏魚改鯔平均值、改收芭樂乾／鳳梨乾（含糖）／餃子皮／芋頭糕（333 筆）、14 筆補過敏原、酪梨改名「酪梨（台灣品種）」。check-data 新規則：分層品項描述明寫的過敏原一律要標（未確認不能代替）、主要營養素比名目、果乾無糖要正面證據；`--report` 加不收品名搜衛福部、有平均值沒用的清單。**以後改對應表或換樣品，先看 `--report` 這兩段**。smoke 29 全過、快照不變。
   - **審核留給切片 4 的事**：共用內建 id 的品項一定寫「1 份（代換表）＝30g」，不能只寫「1 份」（今日建議一餐是內建克數，例雞胸 130g）；分層的 `note` 要在明細顯示（牛蒡、桃子、文蛤、酪梨、梅花肉、黑木耳〔鮮〕靠它說明）；nominal_reason 使用者看不到，要不要統一提示在明細設計時決定（日後討論 T6）；素料對素食使用者被擋是刻意的（#113）。
   - **切片 4 已實作（2026-09-30，commit `2ddab7f`～`dc0bd00`；切片 3＋4 於 2026-09-30 推送到 `bfd7abd`，CI 通過）**：計畫第二版 [docs/review/2026-09-30-D4-實作計畫.md](../docs/review/2026-09-30-D4-實作計畫.md)（第 8 節審核對照、第 9 節實作時的偏離）；審核逐字 `collab/opus-review-log/2026-09-30-d4-plan-review.md`（一輪，「改完可以開工」）；decisions #114–#117。
     - `2ddab7f` 文件（PRD 13.3、章程 B4 `source.derivation`）；`e48d7ff` data(format) `source.derivation`（等值推算 3 筆、由生米推算 2 筆）；`79a27e9` engine（`js/engine/foods.js`：`foodsWhereOf`、`foodTreeSections`、份量量詞、出處文字、`allergenSummary`、`foodsBlockLabel`、`sameSampleEntries`、`dislikedMessage`；不吃清單查分層）；`dc0bd00` 畫面（新檔 `js/ui/foods/rows.js`、`tree.js`；子分頁四個；兩層收合＋`openSections`；標不吃捲到該列、明細裡「也標不吃」「也取消」；搜尋含分層與別名）。
     - 使用者決定：鮮奶兩筆不改名、「家裡的飲品」緊接「現成飲料」（#114）；標不吃後自動捲到那一列（#115）。
     - 驗證：check-engine 43095、check-arch、smoke 31、mobile-walkthrough 329（新增 0-2 自煮、2-5、8-7～8-11）全過，截圖看過；快照逐字不變。walkthrough 8-5 開發時偶發失敗一次（記在日後討論）。
     - **待使用者**：手機實機腳本「使用者短清單」第 6 項（已改寫成切片 3＋4 的版本，含雜糧飯修正的推薦影響：設了全素、蛋奶素或麩質過敏時推薦不再出現雜糧飯）。辨認新版：「我的食物」下面有「自煮」。使用者回報問題先修，再開切片 5。
     - **待使用者決定（2026-09-30 晚）**：使用者問「自煮的各大類可以看，哪裡可以用？」——目前只能看與標不吃（共用內建 id 的約 37 種會擋推薦與自己選；其餘 fx_ 要等切片 7 單品才有作用）。已問使用者：照原順序先做切片 5 常吃，還是把**切片 7 單品記錄**提前（不依賴常吃，但動 MealContent、db 寫入驗證、記錄名稱，要先寫計畫送審）。使用者還沒回答，接手時先問這題。
     - **使用者新定案（2026-09-30 晚，decisions #118）**：今日建議加日期切換（一條線七個圓點＝今天＋未來 6 天，每一餐可先自選或跳過），排在其他已定案工作之後、日後討論之前；PRD 第 7 節路線圖最後一列有 5 個做的時候再定的細節。**週格子（Phase 3 餐點日曆）不做**，由日期切換取代，每一天跟今日建議同一個風格（decisions #119）。**補記過去的一餐**另外定案（decisions #120）：「本週總覽」按鈕＋系統日期選擇器（不做圖形），只能選過去 7 天，選時段 → 三分頁選擇器 → 確認寫 daily_log；**複製上週不做**。兩者都在 PRD 第 7 節路線圖最後兩列。使用者也說這週做不完是正常的，還在想優先順序，不用現在排。
     - **下一步：切片 5 常吃（選擇器）**（PRD 13.6、13.9）：新 settings key `favorite_refs`、專用函式、備份升版與 fixture；選擇器各分頁最上面「常吃」組；推薦快照逐字不變。要先寫實作計畫送審。
   - **切片 7 單品已實作（2026-10-01，commit `6970979`～`e6d6ff9`，已推送、使用者手機測過）**：計畫 [docs/review/2026-10-01-D7-實作計畫.md](../docs/review/2026-10-01-D7-實作計畫.md)（第 8 節為準）；PRD 13.4 已在 `12926cf` 改好；decisions #121–#123（實作沒有新增決策）。
     - `6970979` engine：`config` FOOD 常數與 `isFoodQty`；`meal-content` 的 `foodComponent`／`foodAmount`／`foodLogName`／`foodLimitProblem`、草稿 `foods`（估算之後、飲料之前）、自煮沒有食材時 implicit 恰好 {0,null}、`contentTotals` 只在有食材時加隱含成分（M1）、`composeProblem` 沒餐型時有單品或飲料可送出（S3）；`picker` 的 `addFood`／`stepFood`／`removeFood`；`foods` 的 `foodQtyText`、`scaleHousehold`（Sonnet 測資 1062 格全對）。
     - `0c5651f` db：`food` 元件驗證（快照七個營養欄位必有）、自煮沒有食材的 implicit 規則；備份不升版。
     - `9db2cb7` 畫面：新檔 `js/ui/meal-picker/food-step.js`；兩步一次寫進 `#meal-picker-drinks`；已選框步進器；捲動補償；搜尋；自煮再點餐型取消；`drinkStepHtml` 改成 `drinkGridHtml`。
     - `e6d6ff9` 工具：diff-recs 只新增 98 行（`foods/*`、`open/*/foods/*`）；smoke 35、walkthrough 405 全過，截圖看過（含 360 寬）；手機實機腳本新第 8 節（程式裡是 9-x）、短清單第 7 項。
     - **留給工作線 C 的接縫**（計畫 2.3、8.3 S11）：`toSavedContent` 把 `food` 變成只存 `ref`、`qty`；`remapSavedRefs`／`resolveSavedMeal` 查 `catalog.foodTree.byId`；單品上限用 `FOOD_MAX_PER_MEAL`、骨架重新驗證略過 `food`；「已記錄的一餐存成組合」會碰到只有單品的自煮紀錄（`archetype_id` null、implicit {0,null}，`keepImplicit` 要處理）；「帶入選擇器」預載 `mealPicker.foodSel = [{ uid, qty }]`；含單品的組合引用時重算過敏原與不吃；v3 備份 fixture 要含一筆 `food` 紀錄。
     - 已知行為（刻意）：推薦跨時段不重複不看單品；只記單品的一餐也會記住分頁型態（下次停在那個分頁）；纖維 null 的 15 個加工肉等品項讓那一餐纖維「無資料」。
   - **切片 5 常吃（選擇器）已實作（2026-10-01 晚，已推送 `1a15ea8`；使用者手機短清單第 9 項測過）**：計畫第二版 [docs/review/2026-10-01-D5-實作計畫.md](../docs/review/2026-10-01-D5-實作計畫.md)（第 8 節是審核對照）；審核逐字 `collab/opus-review-log/2026-10-01-d5-plan-review.md`（一輪，「改完可以開工」，M1–M7、S1–S13 全收）；decisions #126（使用者 U1–U4：兩邊都能標、搬到最上面不重複、我的食物子分頁也有常吃組、不限數量）、#127（技術）。
     - db：`favorite_refs`（dedicatedOnly）、`getFavoriteRefs`／`addFavoriteRef`／`removeFavoriteRef`、純函式 `addFavoriteTo`／`removeFavoriteFrom`／`applyFavoriteOp`／`replaceFavoriteRef`；`addDislikedIngredient` 同一個 transaction 移出常吃（回傳值不變）；`copyBuiltinToCustom` 把常吃換成新的我的品項；備份 v4（`tools/fixtures/backup-v4.json` smoke 凍結）。
     - engine `picker.js`：`effectiveFavorites`（扣不吃）、`splitFavorites`、`favoriteEntries`（被擋的組尾）、`favoritesFirst`（自煮軸只提前沒被擋的）；`foods.js`：`favoriteMessage`、`favoriteEffectText`、`dislikedMessage` 第三參數。
     - 畫面：我的食物（`rows.js` 常吃組、按鈕；`list.js`、`tree.js` 搬過去不重複、搜尋狀態）、選擇器（`product-tab.js` 常吃組與已選列按鈕、`food-step.js` 兩個共用步驟的常吃組、`cook-tab.js` 排序、`index.js` 讀寫）。按鈕順序「常吃 → 複製成我的版本 → 不吃」。
     - 工具：check-engine「常吃」一節、check-arch C4.17 ②（含自我檢查）、diff-recs `fav/*`（picker.txt 只新增 11 行，recs.txt 逐字不變）、smoke 50、walkthrough 477（第 11 節，截圖看過含 360 寬）；手機實機腳本第 10 節、短清單第 9 項。
     - **留給切片 6**：`tab-today.js` 已在 `getFavoriteRefs` 白名單；`today.js` 原封傳 `favoriteRefs`、`recommend.js` 只在 `score` 裡加分（check-arch 的函式範圍檢查要到時補）；選擇器關閉時若常吃有改要像 `dislikedChanged` 一樣重算今日建議（審核 S12）；明細作用文字依品項能不能進推薦分兩種（decisions #127 ⑥）。
   - **工作線 C 我的組合已實作（2026-10-01，commit `49f50d4`～`32e991b`，已推送；使用者 2026-10-01 手機短清單第 8 項測過）**：計畫第二版 [docs/review/2026-10-01-C-實作計畫.md](../docs/review/2026-10-01-C-實作計畫.md)（第 8 節為準）；審核逐字 `collab/opus-review-log/2026-10-01-c-plan-review.md`（一輪，「改完可以開工」）；decisions #124（使用者：管理區塊在我的食物最上方、入口 2 只在今天的卡片、名稱只寫品名、日期切換的預選移走、卡片熱量＝帶入後 1 倍、型態寫字）、#125（技術）。
     - `a5892ef` engine：`toSavedContent`／`remapSavedRefs`／`resolveSavedMeal`（`ctx = { hidden, customs, slot, profile }`）／`savedMealDraft`／`savedMealTotals`／`savedMealDefaultName`／`savedMealProblem`／`savedMealUnavailableLine`；`ingredientFilterResult` 搬到 filters；`manualRoleMax(role, null)`＝主餐 2；`fromCustomFood` 帶 `copied_from`。
     - `c359c32` db：`saved_meals`（DB_VERSION 2，部署後不能退回 1）、`validateSavedMeal`、`applySavedMealPatch`、`listSavedMeals`／`getSavedMeal`／`addSavedMeal`／`updateSavedMeal`／`addDailyLogWithSavedMeal`（同 transaction）；備份 v3；舊分頁 VersionError 提示重新整理。
     - `8d24c59` 畫面：選擇器組合列（`saved-row.js`）、帶入（取代目標分頁＋共用飲料與單品；插進清單的品項標「從我的組合帶入」）、「存成組合」勾選、編輯模式 `openMealPicker(null, { savedEdit, onSaved })`；今日建議「存成組合」；`js/ui/foods/saved-meals.js` 管理區塊與搜尋；`savedMealForSave`。快照只有 `flow/log-breakfast/dom01` 一行刻意改變（多了「存成組合」鈕）。
     - `32e991b` 工具：diff-recs `saved/*`（只新增）、smoke 43、walkthrough 441（截圖看過，含 360 寬）、`tools/fixtures/backup-v3.json`（smoke 凍結）、check-arch C4.16 自我檢查；手機實機腳本第 9 節、短清單第 8 項。
     - **留給日期切換（#118）的接縫**：預選引用組合用 `resolveSavedMeal`（`ctx.slot` 給那一餐的時段）→ `savedMealDraft`；未來日期卡片不做預算縮放（PRD 11.3）；C4.16 白名單到時加日期切換的檔案。
     - **留給切片 8、9**：組合含我的食材、我的料理時往 `ctx` 加 `customIngredients`、`customDishes`、`tfdaLookup`，`validateSavedMeal` 收 `dish`；DB_VERSION、備份版本照做的先後各自 +1。
   - decisions #109（果乾只有無加糖樣品的名稱加「（無加糖）」收進來；優格(無糖)、優酪乳(無糖)不收）：**使用者 2026-09-30 已確認照預設**。
   - decisions #95 的三個預設（料理可用分層品項、對不到代換表的內建食材可當單品、燕麥奶歸飲品）是照審核建議，待使用者確認。
   - 原始資料：`collab/transcripts/`（代換表 339 列／374 品名、過敏原標註合併版 `exchange_tags.json` 與審查 `exchange_tags_review.md`；第二輪審核指出的標註修正〔牛油、饅頭、瓜子、芒果類〕要在切片 3 轉入時一起做）。
   - **衛福部全表剩餘 1895 筆的過敏原／素食標註已合併（2026-10-01，commit `3cbf1e0`）**：`collab/transcripts/tfda_tags_merged.json`＋審查 `tfda_tags_review.md`（Cline、Sonnet 兩份比對，1562 一致、333 裁決，一致的抽查改正 11 筆、補芒果 14 筆）。**還沒進 App**，給切片 8「我的食材」預帶用；排到切片 8 時先看審查檔「還沒解決」第 2、3、4、7 點（標註說明還是 11 詞、`composite` 與「等」字規則、check-data 芒果同義字會誤判「檸檬果乾」、自製茶葉蛋）。第 1 點使用者已決定維持保守（沒確認的不讓勾過敏原的人點，日後有成分再翻案）。

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

- 權威規格 `docs/PRD.md`；章程 `docs/CHARTER.md`；決策 `docs/decisions.md`（到 #139）。先改 PRD、記 decisions，再改程式（A1）。
- 重大設計、偏離 PRD 的格式、改推薦演算法、改骨架：新開 Opus agent 獨立審核，**問答逐字存 `collab/opus-review-log/`**。
- 使用者習慣：問題附建議，常回「照建議」；只把產品決定交給使用者。可以直接 commit 到 master，訊息結尾 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`。
- 資料改動：每個 commit 附差異報告；能證明「只是重構」的，用腳本比對舊快照（例：id 改名後把舊快照套同一份改名對照再逐字比）。
- 畫面流程改到時，跑 `docs/手機實機腳本.md` 對應段落（−1b 的畫面變動已補進腳本，使用者還沒在手機上跑）。
