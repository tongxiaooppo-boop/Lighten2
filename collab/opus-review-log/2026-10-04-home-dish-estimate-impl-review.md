# 家常菜估算 — 實作審核（Opus 獨立審核，2026-10-04）

> 範圍：`git log ca6f73e^..3a01a73`（步 0–4，5 個 commit）。依據：設計草案 `docs/review/2026-10-04-家常菜估算-設計草案.md`（第 8 節 v1.1 優先）、第二輪審核 `collab/opus-review-log/2026-10-04-home-dish-estimate-review.md`（M-a～M-h、Q4 表）、decisions #151。
> 審核者自己重跑：`check-data`（通過，1 個既有警告）、`check-engine`（51955 項全過）、`check-arch`（37267 項全過）、`diff-recs`（matrix／recs／tdee／picker／ui 全部 ✓）。smoke 與 walkthrough 需要瀏覽器，沒有重跑。另在 scratchpad 用 engine 的 `homeEstimate` 與 `data/home_dishes.json` 重算 27 格＋4 個組合，並逐一列出 17 道配方每個 ref 的 basis／state。
> 只讀；本檔是唯一寫入的檔案。

## 一、收到的問題（逐字）

你是獨立審核者（Opus），審核「輕盈計畫 Lighten2」（D:\ok\lighten，純前端 vanilla JS＋IndexedDB）剛做完的「家常菜估算」實作。請一律用繁體中文。**只讀；唯一可以寫的檔案是審核紀錄 `D:\ok\lighten\collab\opus-review-log\2026-10-04-home-dish-estimate-impl-review.md`**（新建；把你收到的完整問題與你的完整回答逐字寫進去，標「實作審核」）。不要改任何其他檔案、不要 commit、不要推送。可以在 scratchpad 寫暫時腳本讀 data/*.json 與 js/ 驗算，不改 repo。

## 背景
- 設計已定稿且已經過兩輪獨立 Opus 審核：`docs/review/2026-10-04-家常菜估算-設計草案.md`（**第 8 節 v1.1 優先**）、審核逐字 `collab/opus-review-log/2026-10-04-home-dish-estimate-review.md`（第二輪的 M-a～M-h 定稿清單與 Q4 數字表）、`docs/decisions.md` #151。模型：主食（白飯／糙米飯／雜糧飯／白麵／不吃，小中大＝2／4／6 熱量份）＋N 道菜（N＝1–4；菜全分量小中大＝120／160／200g 分給 N 道，每道 1/N；每道選素菜／菜肉／純肉）＋湯獨立開關（250ml）。est 形狀 `{ n, cats[], staple, staple_size, dish, soup }`，`size` 一律 null，快照七欄都要有數字；估算快照在草稿→預約→暫時紀錄→「記下」全程不重算。
- 這一輪做了 5 個 commit（`git log ca6f73e^..3a01a73`）：`ca6f73e` 步 0 文件（PRD、章程 B1/B4/B5.1/B12/C2/C4.17③）；`427bb5b` 步 1（快照路徑：`estimateFromDraft`、`toPlanContent`、`savedMealDraft`、db 的 `estProblems`、check-engine 斷言）；`00dfb50` 步 2（`data/reference/home_dish_recipes.json`、`home_dish_seasonings.json`、`tools/lib/home-dish-values.js`、`tools/build-home-dishes.js`、產生檔 `data/home_dishes.json`、check-data 規則與自我檢查）；`881aee6` 步 3（`homeEstimate*` 在 `js/engine/meal-content.js`、`core/config.js` 常數、`catalog.homeDishes`、check-arch C4.17③）；`3a01a73` 步 4（`js/ui/meal-picker/estimate-card.js`、`index.js` 的 `addHomeEstimate`／`onHomeEstimateClick`、diff-recs 快照、walkthrough 第 15 節、手機腳本短清單第 15 項）。
- 專案規則：章程 `docs/CHARTER.md`（尤其 B4「家常菜估算」、B5.1、B12、C1 依賴方向、C2 單一真相來源、C4.5 null 傳染、C4.11 ui 不自己加總營養、C4.13 不評判用字、C4.17③ 推薦不得讀家常菜資料）、PRD 第 3、5、7、8、9 節。工具：`node tools/check-data.js`、`check-engine.js`、`check-arch.js`、`diff-recs.js`、`smoke-browser.mjs`、`mobile-walkthrough.mjs`（我已全跑過且全過：check-engine 51955 項、check-arch 37236、smoke 54、walkthrough 608；你可以自己再跑 check-*，smoke 與 walkthrough 需要瀏覽器、可略過）。

## 請審核（逐項回答，點名檔案與行號）
1. **M-a～M-h 對照驗收**：逐項說有沒有真的做到、做對（M-a toPlanContent 保留 est＋斷言；M-b est 規則；M-c 調料選樣表含番茄醬且飽和脂肪 0 走章程 B5.1「調味料」新列；M-d 章程 B4/B12 出處白名單與 check-data 擋 derived；M-e 兩道湯的假設寫進 note、類別平均對照 Q4 表；M-f 產生檔接進 loadCatalog＋diff-recs 快照；M-g 每個 commit 都 stamp-version；M-h 不吃飯選項）。
2. **正確性**：①`js/data/db.js` 的 `estProblems`（紀錄與預約兩處都呼叫？舊的無 est 估算相容？`size` 必須 null 的規則會不會誤擋舊資料或「昨天的餐」S/M/L 回想估算 `recallEstimate`）；②`estimateFromDraft`／`savedMealDraft`／`toPlanContent` 路徑有沒有漏的地方（例如 `js/ui/today-plans.js`、`js/ui/today-yesterday.js`、`remapSavedRefs`、`resolveSavedMeal`、`planPseudoLog`、`toSavedContent`（組合仍擋估算）、選擇器第 ~333 行從預約帶回估算）；③`homeEstimate` 數字（用 `data/home_dishes.json` 自己重算幾格對照 Q4 表）；④`tools/lib/home-dish-values.js` 的算法與 check-data 規則有沒有漏洞（例如 ref 分類順序造成同名撞到、`seasoningValues` 補 0 的條件、`derived` 白名單被繞過、自我檢查的案例有沒有真的會失敗）。
3. **UI**：`estimate-card.js`／`index.js` 的狀態管理（`homeEst` 在關閉再開時重置？切換模式、改道數時 cats 補裁、不吃主食時 staple_size 為 null、加入後保留 cfg 但清名稱、名稱輸入在重畫時是否遺失、`m.catalog.homeDishes` 未載入時會不會壞）；三種模式（log／plan／backfill）與編輯模式（本來不顯示估算卡）；事件委派會不會誤吃其他按鈕（`onHomeEstimateClick` 在 `onProductExtrasClick` 最前面被呼叫，對每一次點擊都先跑一串 `closest`，有沒有效能或誤判問題）；用字是否符合章程 C4.13（不評判）。
4. **章程／架構**：C1 依賴方向（ui 的 estimate-card.js 直接 import engine/meal-content.js 算預覽是否合規、C4.11）、C2 單一真相來源（常數是否只在 config.js）、C4.17③、章程與 PRD 文字是否跟程式一致、decisions #151 有沒有與實作不符處。
5. **回歸風險**：快照（pool／matrix／recs／tdee／ui 逐字不變、picker 只新增 26 行）是否真的證明沒有改到既有行為；備份不升版是否成立（`validateBackup`／`migrateBackup` 路徑）；舊預約、舊紀錄相容。
6. **資料**：17 道配方的食材對應是否合理（營養師角度：牛肉用牛腱、雞腿去皮、白菜燉雞湯水量假設 600g、排骨可食 65%）；類別歸類；有沒有該警告卻沒警告的。
7. **還有什麼缺口**：文件（PRD 11.2 是否要補一句、`docs/日後討論.md` 要不要加項）、測試缺口、使用者之後會踩到的坑。需要問使用者的產品決定（若有）列出並附建議。

## 輸出
最終訊息請給：①結論（可以 push／要先修哪些）②依嚴重度排序的清單，分「必修（M）」「建議（S）」「日後（N）」，每項附檔案行號與修法③M-a～M-h 對照表。審核紀錄檔同樣內容逐字存檔。

## 二、完整回答（逐字，實作審核）

### ① 結論

**架構、資料管線、數字都對，可以 push；建議先用一個小 commit 修掉 M1、M2（文件 4 處＋程式 1 行），修完不需要再審。**

- 快照路徑：草稿→預約→暫時紀錄→記下全程沒有重算，est 與快照都保留，我逐一追過所有呼叫點，沒有漏的路徑。
- 資料管線：產生檔確實由 `loadCatalog` 載入（`js/data/catalog.js` 第 187、189 行），推薦讀不到（check-arch C4.17③ 有斷言）。
- 數字：用 engine 加產生檔重算，27 格全部對得上第二輪的 Q4 表，差異只在小數 1 位的進位。
- 食材：17 道配方的每個 ref 都是生重或「原樣」的樣品，沒有把熟重的營養乘上生重。
- 沒有會擋 push 的錯誤。M1 是文件跟程式說法不一致，M2 是一個會把舊名稱寫進紀錄的小 bug。

### ② 清單

#### 必修（M）

**M1 文件跟程式不一致（4 處，純文件）**
1. `docs/PRD.md` 第 123 行寫「①一般外食 S／M／L（…熱量常數 `ESTIMATE_SIZE_KCAL`，**其餘欄位依常數**）」，這句是錯的。`estimateComponent`（`js/engine/meal-content.js` 第 537–543 行）其餘六欄都是 null。
   - 改法：改成「其餘欄位是 null（未知，章程 C4.5）」。
2. `docs/CHARTER.md` 第 69 行把 `assumption` 限定「**只用於隱含成分的『量』**」。但產生檔每道菜的 `source` 預設是 `{ type: "assumption", … }`（`tools/lib/home-dish-values.js` 第 191 行，`data/home_dishes.json` 每道菜都有），跟章程字面衝突。
   - 改法（二選一）：
     - 在第 69 行補「及家常菜配方的配比與成品重（decisions #151）」；
     - 或者產生檔不寫 `source.type`，只留 note。
   - 建議用前者，一句話的事。
3. `docs/CHARTER.md` 第 249 行（B12「家常菜估算」）把「`cooked_g` 與食材總重合理」寫在錯誤清單的語氣裡，但實作只在成品重低於食材總重 40% 時給**警告**（`home-dish-values.js` 第 188 行）。設計草案 §2.2 寫的也是警告。
   - 改法：改成「成品重低於食材總重（含水）40% →警告」，並移到「警告」段落；同一段補上「類別手動標與自動規則不一致→警告」（第 252 行已有，對照即可）。
4. `docs/日後討論.md` 第 129 行「共食當自助餐、共用家常菜食譜庫」還寫「已排進切片 9…目前照原定案：PRD 第 178、273 行排除共食」。這已經被 #148→#151 取代（記憶規則「已決定取代就拿掉」）。
   - 改法：整條改成一行「已由 decisions #151 取代（外食『主食＋家常菜』估算）」，或刪掉；新的日後項目見 N1–N5。

**M2 一般外食估算會沿用上一次的名稱（小，但會寫進紀錄）**
- 位置：`js/ui/meal-picker/index.js` 第 971–974 行（`data-estimate-size` 分支）。
- 重現步驟：
  1. 在一般外食輸入「喜宴」；
  2. 點「主食＋家常菜」，再點回「一般外食」，這時名稱已同步到 `m.homeEst.name`；
  3. 按 L → 加入「喜宴」；
  4. 重畫後輸入框的 `value` 仍是 `m.homeEst.name`＝「喜宴」（`estimate-card.js` 第 72 行）；
  5. 再按 M，第二筆也叫「喜宴」。
- 改版前重畫後輸入框是空的，所以這是回歸。只在切換過模式後才會發生。
- 改法：在這個分支 `addEstimate(...)` 之前加 `m.homeEst.name = "";`。walkthrough 第 15 節可以補一個步驟：切模式→加一般估算→輸入框是空的。

#### 建議（S）

- **S1 鈉的顯示格式（C4.14、C2）**：`estimate-card.js` 第 61 行自己組「鈉 N mg」，少了「約」。全站共用的格式在 `js/ui/dom.js` 第 10 行的 `sodiumText`（「鈉 約 X mg」）。
  - 改法：預覽改用 `sodiumText(s.sodium_mg, false, false)`。
- **S2 重複定義（C2）**：
  - `estimate-card.js` 第 42 行的主食克數（`EST_STAPLE_PORTIONS[s] * EST_STAPLE_G_PER_PORTION[staple]`）跟 engine 的 `homeEstimateGrams`（`meal-content.js` 第 566–571 行）是同一個算式。
  - 第 13 行的 `PART_LABELS` 跟 engine 第 1099 行的 `RECALL_SIZE_NAME`（小／中／大）重複。
  - 第 45 行的 `[1, 2, 3, 4]` 寫死了，沒有用 `EST_DISH_MAX` 產生。
  - 改法：engine 匯出 `homeStapleGrams(staple, size)`；「小中大」標籤放進 `config.js`（例如 `EST_SIZE_LABELS`）兩邊共用；道數用 `EST_DISH_MAX` 產生。
- **S3 est 要明列欄位**：`homeEstimate` 回傳的 `est: copyEst(cfg)`（`meal-content.js` 第 603、557 行）會把 cfg 多出來的鍵一起帶走。我實測帶 `extra: 1` 會留下來，但 db 的 `estProblems` 第 203 行要求剛好 6 個鍵，送出時才會報錯。
  - 改法：`homeEstimate` 明列 6 個欄位組 est，或在 `homeEstimateProblem` 也擋多餘的鍵，讓預覽與送出用同一套規則。
- **S4 配方可以繞過調料選樣表**：`resolveRef`（`home-dish-values.js` 第 118 行起）接受任何衛福部編號，配方可以直接寫 `P0700401`（醬油）而不經過 `hs_`。現在是因為那筆的飽和脂肪剛好不是 null 才沒出事；蠔油這類有 null 的會被「是 null」擋下。
  - 改法：衛福部食品分類是「調味料及香辛料類」的編號，只能經由 `hs_` 引用，並加一個自我檢查案例。
- **S5 自我檢查還缺的案例**（`tools/check-data.js` 第 405–426 行）：
  - 產生檔被手改、跟重算不同（現在是 `fileText` 傳 null，這條沒被測到）；
  - `label` 出處缺欄位；
  - 「調味料」理由用在脂肪大於 0.5 的樣品；
  - 理由拿去補不准補的欄位（例如用「調味料」補 `sodium_mg`）；
  - 衛福部編號在查詢檔找不到；
  - 主食 ref 失效；
  - `g ≤ 0`、`cooked_g ≤ 0`。
  - 每條規則都應該有一個「刻意改壞要被擋」的案例。
- **S6 配方 note 補兩個假設（營養師角度）**：
  - 滷雞腿（醬油 50g、成品 400g → 鈉 728 mg/100g）等於假設滷汁全被肉吸收。實際上會留一部分在鍋裡，鈉可能偏高三到五成。滷豆干滷蛋的 note 有寫「收乾」，滷雞腿沒寫。
  - 蠔油芥蘭牛肉用牛腱（139 kcal/100g）代表，店家常用的牛肉片比較肥，熱量偏低估。
  - 改法：兩道的 note 各補一句，不改數字。
- **S7 PRD 第 140 行的 db 驗證段**：補「估算有 `est` 時：`size` 是 null、n 與 cats 一致、列舉值、不吃時 `staple_size` 是 null、七欄快照不得是 null、est 剛好 6 個欄位」。設計 §6 步 0 列過「137 行附近」，這一處沒補到。
- **S8 快照覆蓋**：diff-recs 只有 log 模式送出含 est 的估算。建議再補兩行：
  - plan 模式送出（`toPlanContent`→`addMealPlan` 的寫入）；
  - 從預約帶回選擇器（`applySaved`，第 334 行）後的估算卡 HTML。
  - 這兩條現在只有 check-engine 的純函式斷言加 walkthrough 保護。
- **S9 `onHomeEstimateClick` 的寫法**：`index.js` 第 758–759 行先用 8 個 `closest` 判斷要不要讀名稱，接著又逐個再判斷一次。
  - 效能可以忽略（一次點擊最多 16 次 `closest`）。屬性名稱都是專用的（`[data-home-staple]` 不會比對到 `data-home-staple-size`），也不會誤吃其他按鈕：前面的 `onB1aClick` 只認 `data-*-uid`。
  - 建議合併成一個選擇器字串，比較好讀。
  - 另外，名稱只在點估算卡按鈕時才同步。在家常菜模式打了名稱後去點下面的品項卡，重畫後名稱會不見。這是改版前就有的行為；可以改成在輸入框的 `input` 事件時就同步。
- **S10 小整理**：`js/core/config.js` 第 124 行 `ESTIMATE_RECALL_GROUP ={` 少一個空白（步 1 搬動時造成的）。

#### 日後（N，建議寫進 `docs/日後討論.md`）

- **N1** 沙茶醬找到市售標示（`label`）後，把沙茶牛肉炒空心菜加回。第二輪的 N-a。
- **N2** 逐道菜選擇（同一份 `home_dishes.json` 往上升級）。第二輪的 N-b。
- **N3** 純肉類目前 5 道都是家常做法（滷、蒸、紅燒、麻婆），**沒有炸物、三杯、糖醋**。自助餐的主菜常是炸排骨、炸雞腿，純肉平均 162 kcal/100g 對自助餐可能偏低；素菜也只有 4 道（第二輪 S-b）。日後補菜時先補素菜與炸物。
- **N4** 新模型的「4 道＋湯、飯中、菜中」是 547 kcal（舊模型「4 菜 1 湯」是 720），因為使用者決定 4 道總量不比 1 道多（160g）。上線用一陣子後再看菜量常數要不要調，只改 `EST_DISH_GRAMS`。
- **N5** `loadCatalog` 把 `home_dishes.json` 放在同一個 `Promise.all`，這個檔讀不到會讓整個 catalog 失敗。目前所有資料檔都這樣，可以接受；日後可以讓非必要的資料檔失敗時退回空資料（`normalizeHomeDishes` 已經處理空值，畫面會顯示「缺少菜的類別資料」而不會壞）。
- **N6** 已加入的估算列表只寫「名稱（約 N kcal）」，沒有「估計」字樣。PRD 第 123 行說「估算一律標『估計』」，預覽有標，列表與今天的紀錄沒有。改版前的 S/M/L 也一樣，可以日後一起處理。
- **N7** 使用說明（設計 §6 步 5）還沒寫（`collab/to-sonnet-manual.md` 第 8、9 項已列）。不擋 push，但要在請使用者手機測之前補上。

#### 需要問使用者的（都不擋 push，附建議預設）

1. **菜量常數**：4 道合計 160g（中）、200g（大），自助餐夾 4 樣可能不只這樣。建議先照定案（#151），用一兩週後再談，記在 N4。
2. **白菜滷歸「菜肉」**：依規則它是菜肉（只有 60g 五花肉與蝦米），但使用者在自助餐可能把它當青菜。建議維持；如果使用者常這樣選，類別小字可以補「有一點肉也算菜肉」。

### ③ 逐題回答

**1. M-a～M-h 對照表**

| 項 | 做到了嗎 | 依據與意見 |
|---|---|---|
| M-a `toPlanContent` 保留 est＋斷言 | ✓ | `meal-content.js` 第 1030–1034 行；check-engine 第 2350–2367 行整條鏈都有斷言：buildDraftContent → toPlanContent → validateMealPlan → resolvePlan → savedMealDraft → buildDraftContent（記下）→ validateDailyLog → planPseudoLog。另有「含 est 的估算 toSavedContent 丟錯」（第 2372 行）。 |
| M-b est 規則 | ✓（依 v1.1 新形狀） | `db.js` 第 191–206 行：size 必須 null、n 在 1–4、cats 長度等於 n 且值在列舉內、staple 列舉、不吃時 staple_size 為 null、dish、soup 是布林、剛好 6 個鍵、七欄快照非 null；每條都有斷言（第 2373–2387 行）。 |
| M-c 番茄醬＋B5.1「調味料」新列 | ✓ | 選樣表有 `hs_ketchup`（P1003501）；蠔油、烏醋、番茄醬都用 `field_sources.sat_fat_g` 引用理由「調味料」；lib 第 95–97 行會驗衛福部分類是「調味料及香辛料類」、脂肪 ≤0.5、只准補 `sat_fat_g`；章程 B5.1 表有新列（CHARTER 第 178 行）。 |
| M-d 出處白名單＋check-data 擋 | ✓ | 章程 B4 第 28 行；lib 的 `DERIVED_SEASONINGS` 以 id 鎖定，七欄數字也鎖死，`tfda/label/derived` 以外一律報錯；自我檢查有「derived 不是鹽與水」「鹽的鈉被改」「出處種類不在白名單」。缺口見 S4（配方可以直接寫衛福部調料編號，繞過選樣表）。 |
| M-e 湯的假設寫進 note＋對照 Q4 | ✓ | 排骨湯 note 寫可食 65% 與帶骨全算的對照；白菜燉雞湯 note 寫官方食譜沒有水量、自設 600g、不加水的對照。類別平均素菜 64.6／菜肉 142.4／純肉 161.9／湯 32.1，跟 Q4 逐位相同（菜肉鈉 328.9 對 329、純肉鈉 539.7 對 540，是進位）。 |
| M-f loadCatalog＋diff-recs 快照 | ✓（時間點有偏差，可接受） | loadCatalog 在步 3 接上（`catalog.js` 第 187、189 行）。diff-recs 情境延到步 4 才加（24 個設定＋2 行估算卡 HTML＋送出寫入），步 3 改用 check-engine 的 Q4 15 格斷言保護，commit 訊息有寫明。模型改成 N 道之後 36 行不再適用，24 行的覆蓋合理。 |
| M-g 每個 commit 更新版本字串 | ✓ | 改到 `data/` 或 `js/` 的 4 個 commit（427bb5b、00dfb50、881aee6、3a01a73）都改了 `index.html` 的 import map；ca6f73e 只改文件，不需要。 |
| M-h 不吃飯＋數字給使用者看 | ✓ | `EST_STAPLES` 含 `none`，畫面有「不吃」，選了之後主食量那一排會隱藏；decisions #151 記錄使用者已答「不吃飯、麵、全分量、4 道不加量」都好。注意：使用者看過的是舊模型的 Q4 表，新模型「4 道＋湯」只有 547 kcal（見 N4），手機測時可以順便讓他看一眼。 |

**2. 正確性**

① `estProblems`：
- 紀錄在 `contentProblems` 第 271 行呼叫，預約在 `savedContentProblems` 第 445 行呼叫。
- 規則只在有 `est` 這個鍵時才啟動（第 192 行），所以舊估算、預約裡 `size: null` 又沒有 est 的估算、`recallEstimateLogEntry`（`meal-content.js` 第 1108–1116 行，size 是 S／M／L、沒有 est）都不受影響，不會誤擋。
- 組合（`plan=false`）照舊在第 449 行以 kind 擋掉估算。
- 備份還原走 `validateDailyLog`／`validateMealPlan`（`db.js` 第 747 行起），所以也會驗 est。

② 路徑：
- 選擇器送出：`buildDraftContent` 第 685 行改走 `estimateFromDraft`。
- 預約：`toPlanContent` 第 1030 行。
- `remapSavedRefs` 第 861 行與 `resolveSavedMeal` 第 958 行把估算原樣傳過去。
- `savedMealDraft` 第 994–998 行帶著快照與 est。
- `planPseudoLog` 第 1061 行與今天的「記下」（`today-plans.js` 第 56 行）都走 `buildDraftContent(savedMealDraft(...))`。昨天的餐的「吃了」用同一個 `logPlanEntry`。
- 選擇器第 334 行 `t.estimates = d.estimates.slice()` 保留整個物件，`estimate-card.js` 第 86 行列表改讀快照。
- 沒有漏的路徑。一個行為差異（無害）：從預約帶回選擇器的舊 S/M/L 估算，現在用存下的快照，不再用常數重算；目前數字相同，而且符合 PRD「不重算」。

③ 數字（engine＋產生檔重算，格式為 熱量／蛋白質／鈉）：
- 素菜、飯中、菜 S（120g）：370.5／8.0／490.4（Q4：371／8.0／490）
- 菜肉：463.8／15.6／397.9（464／15.6／398）
- 純肉：487.2／23.3／650.8（487／23.3／651）
- 素菜、飯小、菜 M（160g）：249.8／6.5／651.2（250／6.5／651）
- 菜肉、飯大、菜 M：667.3／21.7／531（667／21.7／531）
- 純肉、飯中、菜 M：552.0／29.4／866.7（552／29.4／867）
- 新模型的組合：
  - 4 道（素素菜肉純肉）＋湯、飯中、菜中：546.6 kcal／蛋白質 22.9／鈉 1037；
  - 不吃主食＋2 道（素菜、純肉）菜中：181.2／14.2／757；
  - 白麵大＋純肉大＋湯：824.2／50.9／1876。
- 量級合理。

④ lib 與 check-data：
- ref 的分類順序是 `hs_` 開頭 → 食材 → 分層 → 衛福部，不會撞名：
  - 衛福部編號是大寫英數，食材與 `fx_` id 是小寫；
  - 分層 id 等於食材 id 時，章程要求是同一筆 `builtin`，數值相同。
- 補 0 的條件是：衛福部該欄是 null、`field_sources` 寫的理由在白名單裡、`value` 是 0、食品分類相符、脂肪 ≤ 上限、欄位在可補清單裡。衛福部有值卻又寫補 0 也會報錯。這部分是嚴的。
- derived 白名單沒辦法從選樣表這邊繞過，但配方可以直接引用衛福部的調料編號（S4）。
- 自我檢查 20 個案例我逐一看過，改壞之後都會觸發對應的錯誤訊息（正規式都比對得到實際訊息）；「原資料不報錯」與「自動規則不一致只警告」兩個反向案例也有。缺的案例見 S5。
- 17 道配方的 ref 我逐一查過：全部是 raw、as_is 或 dry（大蒜、乾辣椒、蝦米、紫菜是 dry，符合配方用量）；主食四種都是熟重。**沒有生熟錯配。**

**3. UI**
- `homeEst` 在 `openMealPicker` 第 208 行重置，關掉再開會回到預設。切分頁時保留；切模式時保留 cfg。
- `normalizeHomeCfg`（`estimate-card.js` 第 24–29 行）：道數變少就裁掉 cats，變多就用最後一道的類別補；不吃主食時 `staple_size` 設 null，改回有主食時預設中份。
- `addHomeEstimate`（`index.js` 第 741–750 行）加入後保留 cfg 並清掉名稱；推進列表的 est 是複本，不會互相影響。名稱的問題見 M2 與 S9。
- `homeDishes` 沒載入時，`homeEstimateProblem` 回傳原因，畫面顯示文字、不出「加入」按鈕，不會壞。
- 三種模式共用同一個選擇器：log 走 buildLogEntry；plan 走第 1170 行 toPlanContent；backfill 同 log。編輯模式不顯示估算卡（第 430 行）。存成組合遇到估算照舊擋住（第 1172、1206 行，`tab-today.js` 第 87 行）。
- 事件委派不會誤吃其他按鈕（見 S9）。
- 用字中性，符合 C4.13：「純肉＝肉、魚、蛋、豆腐為主」「估計：依常見家常菜的平均算出，不是這一餐的實際數字」，錯誤訊息只講事實。鈉的格式見 S1。

**4. 章程／架構**
- C1：ui → engine 是章程允許的方向（C1 圖第一列）；data/catalog.js 沒有 import engine。
- C4.11：ui 沒有自己加總營養，預覽與快照都由 engine 的 `homeEstimate` 算，列表只讀快照。
- C2：
  - 常數都在 `config.js` 第 111–123 行，db、engine、ui 都從這裡 import；
  - tools 端的 `STAPLES`、`CLASSES` 是 CommonJS 另寫一份，但 diff-recs 與 check-engine 會在跑全部主食與類別時發現對不上，可以接受；
  - ui 的重複見 S2。
- C4.17③：check-arch 第 131–132 行掃 `homeDishes` 與 `home_dishes`，有三個自我檢查案例。
- 章程與 PRD 的文字有 4 處跟程式不一致（M1）。decisions #151 跟實作一致：模型、主食份量、全分量、湯、est、size null、不重算都相符。

**5. 回歸風險**
- diff-recs 我重跑全部 ✓。pool、matrix、recs、tdee、ui 逐字不變，可以證明推薦、預算、首頁沒有被動到。
- picker 只新增行，可以證明既有的選擇器送出沒變。
- normContent 只在有 est 時多輸出（diff-recs 第 84 行），不影響舊行。
- 改到的共用函式（`buildDraftContent`、`savedMealDraft`、`toPlanContent`）只在「草稿帶快照」與「元件有 est」時多做事；舊行為由 check-engine 第 2370–2371 行兩條斷言保護（帶快照的舊式估算照快照；沒快照的 S/M/L 仍是 700）。
- 備份不升版成立：
  - 沒有新的 store 或設定鍵，est 只是元件裡的選填欄位；
  - `migrateBackup` 對 v6 不做事，`validateBackup` 逐筆走 db 驗證；
  - check-engine 有含 est 的預約與紀錄來回斷言（第 2431–2435 行）。
  - 反方向（新的備份匯入舊版程式）：舊版的預約驗證不檢查多餘的鍵，est 會被忽略、快照照用，可以平順降級。
- 舊預約、舊紀錄不需要遷移。

**6. 資料（營養師角度）**
- 牛腱：瘦，店家牛肉片較肥，熱量偏低估，建議 note 寫明（S6）。
- 去皮雞腿：家常滷雞腿多帶皮，但跟 NTU 的 205 只差 −7%，可以接受，note 已寫。
- 白菜燉雞湯加水 600g：家常鍋具合理；note 有寫不加水時的對照。
- 排骨可食 65%：小排骨頭約占 20–35%，65% 偏保守（肉算少），湯每 100g 本來就低，影響小，note 已寫。
- 歸類：14 道的手動類別跟自動規則全部一致（check-data 沒有出警告）。宮保雞丁的蔬菜占比 0.303，剛好在分界上，note 有寫。白菜滷依規則是菜肉，使用者可能認知不同（問題 2）。
- 該警告卻沒警告的：
  - 滷類「滷汁全吸收」的鈉假設（S6）；
  - 調料繞過選樣表（S4）；
  - 成品重沒有「過高」檢查（大於食材總重，例如抄錯多一個 0）。最後這項可以加一條警告：`cooked_g` 大於食材總重 1.05 倍。

**7. 缺口**
- 文件：
  - M1 的 4 處；S7 的 PRD 第 140 行。
  - PRD 11.2（第 402、420 行）寫的是所有 `estimate` 都不能存組合，已經涵蓋家常菜估算，不必補；想寫清楚的話，在第 402 行括號加「含主食＋家常菜」。
  - 使用說明還沒寫（N7）。
  - `docs/日後討論.md`：取代第 129 行（M1-4），新增 N1–N5。
- 測試：S5、S8；M2 修好後在 walkthrough 加一步。
- 使用者會踩到的坑：
  - M2 的名稱沿用；
  - S9 名稱在點品項後消失；
  - N4 菜量偏少的感覺；
  - N3 吃炸物時估太低。
