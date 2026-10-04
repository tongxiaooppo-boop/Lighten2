# 給接手的 Opus：Lighten2 交接（2026-10-04 晚：家常菜估算與家庭共餐完成並推送；餐型擴充 0–3 已完成；下一步見第 0 節）

## 0. 先讀這段（2026-10-04 晚收工狀態；**全部已 commit 並推送到 origin/master，最新 `ee73488`**）

一律用中文回覆使用者。使用者還沒在手機測：短清單第 12（日期切換與預約）、13（昨天的餐與補記）、14（新的自煮做法）、15（自助餐估算）、16（家庭共餐）項，以及超商分頁的飲料小類。手機腳本 `docs/手機實機腳本.md` 短清單第 84–96 行是 15、16 項。

**採買相關決定已記（decisions #153）**：共餐人數由這一餐推算（選幾道菜預設幾人、可改、取消全域 household_size）、採買以一盤為單位、調味料不列、肉類先估算；採買清單本身仍未做。

**這個 session 做完的（decisions #151、#152；設計與三輪審核紀錄都在 `collab/opus-review-log/`）**
1. **自助餐估算**（#151）：外食分頁最上面「自助餐」卡（標題展開）：主食（白飯／糙米飯／雜糧飯／白麵／不吃）＋1–4 道菜（每道素菜／菜肉／純肉）＋湯開關；數字用 `data/home_dishes.json` 的**類別平均**；`estimate` 元件多一個 `est`，`size` null，快照七欄都有數字；預約與「記下」全程沿用快照不重算（`estimateFromDraft`、`toPlanContent`、`savedMealDraft`，db 的 `estProblems`）。「找不到？直接估算」S／M／L 照舊。
2. **家庭共餐**（#152，使用者決定：共餐是**自煮**、選**真的家常菜**、採買用 B、自助餐維持估算）：自煮分頁（開伙、午晚餐）「選餐型」那排最後多「共餐」；選主食＋當季家常菜 1–4 樣＋湯至多 1 道；與餐型擇一。資料形狀是**方案 Y′**：主食、每道菜、湯都是 `food` 元件，`ref` 是 `hd_` 開頭（內建家常菜），只用 `amount`（克；湯的 ml 當克）；自煮型態、`archetype_id`／`method_id` null、`implicit` `{0,null}`；**不重用 `dish` 元件**（那是切片 9 我的料理）。預約只存 ref＋amount、**日後重新解析**（家常菜資料改了未來的預約跟著變，已記的紀錄不變；`hd_` id 凍結不重用）。記錄名稱「共餐：菜名＋菜名」不含主食、不寫克數。
3. **家常菜資料 36 道**（素菜 12、菜肉 12、純肉 8、湯 4）：`data/reference/home_dish_recipes.json`（手寫配方，每道標 `seasons`：春 3–5、夏 6–8、秋 9–11、冬 12–2 月）、`home_dish_seasonings.json`（調料選樣表，derived 只限食鹽與水）、`tools/lib/home-dish-values.js`＋`tools/build-home-dishes.js` 產生 `data/home_dishes.json`（含每道的單品欄位：過敏原＝配方聯集＋「未確認」、素食一律不標、cooked、`components` 給不吃清單）、`data/reference/home_dish_ids_frozen.json`。**改菜只能改配方檔再跑 `node tools/build-home-dishes.js`**，check-data 會比對。每季素菜／菜肉／純肉各至少 3 道、湯至少 1 道由 check-data 擋。
4. **共餐的擋法**：有設任何過敏原或素食時，家常菜**全部不能選**（成分未確認，章程 C4.1 沒有例外），改用自助餐估算；「不吃」清單有效。非當季但已選的菜（夏天存的組合秋天帶入）標「非當季」、可取消；編輯含共餐的組合、帶入到午晚餐以外的時段，共餐照樣顯示並算進去（`homeMealAllowed`、`carried`）。
5. **預設份量**（#151）：打開估算卡或共餐時，菜量依一天蛋白質目標 ÷ 3（<30g 小、30–50g 中、>50g 大），主食量選「1 道菜肉＋白飯」整餐熱量最接近這個時段配額的一格；只決定預設，記下的數字等於畫面上選的量。
6. **餐型擴充**步驟 0–3（上個 session）：`protein_steamed`、`protein_braised`、`protein_veg_plate`；低碳預算 300 的驗收沒過（見 git 訊息 `ba55fe0`），可單獨 revert。

**程式地圖**：engine `js/engine/meal-content.js`（`homeEstimate*` 自助餐、`homeMeal*` 共餐、`treeById` 併入 `catalog.homeDishes.byId`、`composeProblem` 算共餐）；畫面 `js/ui/meal-picker/estimate-card.js`（自助餐卡＋共用的 `chip`／`group`）、`home-meal.js`（共餐區塊）、`cook-tab.js`、`index.js`（`onHomeEstimateClick`、`onHomeMealClick`、`homeMealActive`、`currentHomeMeal`）；常數 `js/core/config.js`（`EST_*`、`HOME_MEAL_*`、`HOME_STAPLE_REFS`）、`seasonOfDate` 在 `js/core/dates.js`。測試：check-engine 51988、check-arch 38044、smoke 54、walkthrough 636（第 15 節自助餐、第 16 節共餐）、diff-recs（picker 快照有 `home-estimate/*`、`home-meal/*`）。

## 1. 下一步（照順序）
**A. 使用說明（已完成並推送）**：Sonnet 依 `collab/to-sonnet-manual.md` 更新 `docs/使用說明.html`（昨天的餐、補記、自助餐、共餐、新自煮做法、速查），並整合進 App：基本資料分頁「使用說明」→「打開使用說明」，用全螢幕視窗（iframe，`js/ui/help.js`）打開同一份說明書；walkthrough 第 17 節。**之後功能改了，記得回頭改 `docs/使用說明.html`**（用 Sonnet 寫、Opus 驗收）。
**B. 使用者手機測完回報後修**（短清單 12–16）。
**C. 採買清單（Phase 4）**：共餐元件已能讀出 `hd_` ref＋amount。反推算法與缺口已寫在 PRD 13.4 末「採買」：生重 g × 吃的克數 × 人數（`household_size`）÷ `cooked_g`；缺口＝可食重≠購買重（帶骨小排、鱸魚、去皮雞腿）、家裡一道菜煮一盤（建議以「盤」為單位）、配方裡的衛福部編號沒有採買品名、水鹽糖醬油油要分成不列或常備。配方不在執行時資料裡（`catalog` 只載 `home_dishes.json`），要用時另載或把生重量放進產生檔。`household_size`、`meal_plan.servings` 都還沒實作。
**D. Opus 實作審核留下的建議（沒做，在審核紀錄與 `docs/日後討論.md`）**：記錄名稱要不要含主食（建議含，等使用者）、`pickedCount` 不含主食、單品上限訊息補「共餐的主食算 1 項」、有過敏原時共餐區塊加一行指路到自助餐、`savedMealDraft` 的主食歸屬改成元件上的明確標記、季節改成食材層級（菠菜可加秋、蘆筍可加夏）、營養精修（牛腱代表牛肉片偏低、去皮雞腿偏低、滷與三杯的鈉偏高）、每道各自調克數、家常菜常吃、早餐共餐。
**E. 其他（沿用）**：`tools/sim-rotation.mjs`（規格 `餐型claude.md` §6）、餐型步 4 食材（豬里肌、豆干、青江菜或地瓜葉、胡蘿蔔、白飯；#149）、切片 9 我的料理（`dish` 元件，PRD 12.5）→ 切片 10 沖泡、decisions #95 三個預設待使用者確認、`docs/日後討論.md`。
**F. backup-v6 fixture 凍結**（日期切換用，smoke 先建預約與 skipped 再 `SMOKE_FREEZE_BACKUP=tools/fixtures/backup-v6.json`）與 `plan.txt` 快照還沒做。

## 2. 這個 session 學到的事
- **使用者會中途改設計**：共餐從外食估算改到自煮、採買從 A 改 B、季節、家常菜擴充到 32 道以上都是對話中提的；先用一句話確認、大架構照慣例先寫草案送獨立 Opus 審核（本 session 三次：家常菜估算、共餐設計、共餐實作；`SendMessage` 續用同一個 agent 或開新的，問答逐字存 `collab/opus-review-log/`）。使用者說「先審再說」「你有更好的想法就去做」。
- **推送前我曾在 walkthrough 有 1 項失敗時就推了**（預設份量改成依個人後測試寫死 160g），之後補修；**推送前一定先看 walkthrough 結尾是「全部通過」**。
- 改檔：`docs/PRD.md`、`CHARTER.md`、`js/data/db.js`、`tools/check-engine.js` 等是 CRLF，用 Python 讀成 LF、改完再轉回；含反引號或引號的多行內容一律 Write 成檔案再執行，不放 shell heredoc（`git checkout` 還原檔案會把未 commit 的改動一起丟掉，先確認）。
- 快照守則：新 UI 只在用到時才碰新 DOM id（用 data 屬性＋事件委派）；diff-recs 的 picker 快照只准新增行（本輪自助餐類別平均因菜單擴充而改變，已逐條說明在 commit）。
- 使用者習慣：問題附建議、常回「照建議」；只把產品決定交給使用者；用字中性（章程 C4.13）；手機測試直接給腳本行號；問題要用例子講，不要太抽象（使用者曾說「你寫的我看不太懂」）。

---
（以下是 2026-10-04 早上的舊交接，其中「家常菜估算開工」「餐型擴充」已完成，保留作紀錄。）


一律用中文回覆使用者。這份交接讓你不必重讀前一個 session 的對話就能接手。

## 0. 先讀這段（2026-10-04 收工狀態）

**未推送的 commit（`git log` 從 `806bad1`～`1ada6fd` 之前還有切片 0、1、2、飲料、拿鐵、日期切換切片 3）**：全部在本機 master，**推送前先問使用者**。使用者還沒在手機測：短清單第 12 項（日期切換與預約，早就給過）、第 13 項（昨天的餐與補記，腳本第 69–77 行）、第 14 項（新自煮做法）、飲料小類（超商分頁）。

**這個 session 做完的（都已 commit）**
1. **#145 隨餐飲料**（`429b1dc`、拿鐵 `4f71eaf`→`9abbdd1`）：超商 conv_dr07–20、外食 tw_dr11–19；超商通路補上 `is_treat` 過濾（decisions #146）；我的品項熱量允許 0 但只限飲料；飲料組內小類標題（`drinkSubgroups`）；CITY CAFE 拿鐵依牛奶 250ml 估蛋白質 7.8、碳水 12、脂肪 9（estimate；飽和脂肪與鈉依章程 B5.8 維持空白）。`tools/add-drinks-2026-10.js` 已執行，**不要再跑**。
2. **日期切換切片 3**（`8799e12`，decisions #147）：昨天的餐（`js/ui/today-yesterday.js`）、補記（本週總覽＋選擇器 backfill 模式）、`last_shown_recs` 的 `prev`（`nextLastShownRecs` 純函式）。比對腳本 `collab/proofs/2026-10-04-verify-date-switch-3.py`。**還沒做**：backup-v6 fixture 凍結（smoke 先建預約與 skipped 再 `SMOKE_FREEZE_BACKUP=tools/fixtures/backup-v6.json`）、`plan.txt` 快照。
3. **餐型擴充步驟 0–3**（decisions #149、#150；規格 `餐型claude.md` v2，兩輪 Opus 審核逐字 `collab/opus-review-log/2026-10-04-archetype-review.md`）：`806bad1` 文件、`c7bc8c6` 檢查規則（章程 B7.6）、`9f3068c` 擴充 allow、`0bab74b` method_steam＋`protein_steamed`、`9414667` method_braise＋`protein_braised`（not_included 未含滷汁拌飯）、`ba55fe0` `protein_veg_plate`。**低碳預算 300 的驗收沒過**（新平均 442 比舊 408 更超出預算；500、800 明顯改善；一般模式逐字不變），commit 訊息有寫，可單獨 revert，請在回報使用者時提醒。**還沒做**：`tools/sim-rotation.mjs`（14 天輪替模擬報告，規格見 `餐型claude.md` §6，審核者的 `sim.mjs`／`sim2.mjs` 在他當時的 scratchpad，已不在，要重寫）；步 4 食材（豬里肌、豆干、青江菜或地瓜葉、胡蘿蔔、白飯；使用者口味題已答「要」，#149）。
4. **共食／自助餐**：使用者決定都用估算（decisions #148 更正、#151 最終模型）；`#132`、`#133` 的共食與自助餐部分作廢，切片 9 只剩「我的料理」。

## 1. 下一步（照順序）

**A. 家常菜估算開工（設計已定稿，使用者全部答完）**
- 規格：`docs/review/2026-10-04-家常菜估算-設計草案.md`（**第 8 節 v1.1 優先**）＋審核 `collab/opus-review-log/2026-10-04-home-dish-estimate-review.md`（第二輪有 M-a–M-h 定稿清單與 27 格數字表）＋ decisions #151。**不需要第三輪審核**，照清單對照驗收。
- 模型（#151）：**主食＋N 道菜（N＝1–4），菜全分量 小／中／大＝120／160／200g 分給 N 道（每道 1/N，4 道總量不比 1 道多）**，每道選 素菜／菜肉／純肉；湯獨立開關（250ml）；主食 白飯／糙米飯／雜糧飯／白麵（熟麵條）／不吃，大小＝2／4／6 熱量份（飯 80／160／240g、熟麵 120／240／360g）。
- 步驟：**0 文件先行**（decisions 已有 #151；補 PRD 第 3 節〔est 說明、「新估算 size 是 null、份量在 est」、「預約與記下時估算快照不重算」〕、第 5 節 182 行、第 7 節 260 行、第 8 節 278 行〔我已加一句，要改成 #151 的內容〕、第 9 節 294 行估算表；章程 B1、B2、B4、B5.1〔加一列「調味料、脂肪 ≤0.5 → sat_fat_g 補 0」，C3〕、B12、C2、C4.17 ③；調料選樣表出處白名單：tfda、label，derived 只限食鹽與水）→ **1 先有斷言再接畫面（M-a、M-b）**：估算草稿帶快照與 est；`estimateComponent` 接受現成快照；`savedMealDraft`／`toPlanContent`（meal-content.js 約 965 行，審核發現它會丟掉 est）保留；db 驗證（`validateDailyLog` 248–251、預約 419–424）加 est 列舉與「七欄不能 null」；check-engine 加斷言：est 從預約一路到「記下」不變、`toSavedContent` 遇到 est 估算會丟錯（組合仍擋估算）；備份來回斷言（不升版）→ **2 來源檔、調料選樣表（醬油 P0700401、香油 M1500101、紅砂糖 N0100301、番茄醬 P1003501 補飽和脂肪 0、食鹽 derived 鈉 39,340、水 derived 0；太白粉拿掉；沙茶醬排除）、`tools/build-home-dishes.js`＋`tools/lib/home-dish-values.js`、產生檔 `data/home_dishes.json`（約 16 道：排除蒸蛋與沙茶牛肉，湯補到 3 道，兩道湯的水量與排骨可食比例寫進 note）、check-data（含自我檢查）→ **3 engine 估算函式（meal-content.js）＋config 常數＋產生檔接進 `loadCatalog`＋check-arch C4.17 ③ 識別字＋diff-recs 加估算快照（審核算 36 行，模型改成 N 道後要重算）→ **4 選擇器估算卡**（`js/ui/meal-picker/estimate-card.js` 第 15–17、24 行現在直接讀常數，要改成讀快照；log／plan／backfill 三模式都提供；昨天卡片的 S/M/L 不動；快照守則：只在選了新類型才碰新 DOM id）＋walkthrough 新一節＋手機腳本 → **5 使用說明（交 Sonnet）**。
- 每個改 data／js 的 commit：`diff-recs --update`、`check-engine --freeze-draft-totals`（新增資料才需要）、`node tools/stamp-version.js`＋`git add index.html`；commit 訊息附差異報告。

**B. `tools/sim-rotation.mjs`**（規格 `餐型claude.md` §6）；**C. 步 4 食材**（一個食材一個 commit，走 B2／B4／B6，兩步走）；**D. 使用說明更新**：任務檔 `collab/to-sonnet-manual.md`（日期切換、預約、這餐不吃、飲料分組、收合）＋之後的昨天的餐、補記、新自煮做法、家常菜估算，使用者晚上請 Sonnet 做、Opus 360 寬驗收；**E.** 切片 9 我的料理 → 切片 10 沖泡 → 採買清單；**F.** 待使用者確認 decisions #95 三個預設；**G.** 日後討論新增一節「日期切換與飲料登記的日後項目」（配額下限、校正極低日、估算卡 S/M/L 統一、飲料再查、只有熱量的飲料）與餐型的 N 項（牛腱移出炒類、調味等級「重」、設備勾選、鯖魚、麵食、早餐／下午茶／宵夜的自煮擴充、每餐只放 1 份蔬菜、纖維封頂）。

## 2. 這個 session 學到、下一位要知道的事
- **推薦是「評分取最高、同分依 id 排序」，不抽樣**（`recommend.js` 207–215）；新骨架進不進推薦由評分決定，評分凍結在 decisions #130。骨架 id 命名會影響同分誰贏。
- **快照守則**：新 UI 只在需要時才 query 新 DOM id（fake DOM 的 domNN 會位移）；非同步畫面（彙總卡校正公告）多幾個 await 會讓快照拍到寫完的樣子，不是行為改變。
- **改檔注意**：`today-plans.js` 等檔是 CRLF，Python 改檔要先轉 LF 再轉回；shell heredoc 內含引號或反引號會炸，多行內容用 Write 寫檔再執行；Windows 上 `sed` 改含中文的檔要小心。
- 使用者週額度有限：查詢、整理、文件草稿、使用說明交 Sonnet，程式 Opus 寫；大架構決策找獨立 Opus 審核（本 session 兩次：餐型、家常菜估算），問答逐字存 `collab/opus-review-log/`。審核用 `SendMessage` 續用同一個 agent（它已認識程式）。
- 使用者習慣：問題附建議、常回「照建議」「好」；只把產品決定交給使用者；用字中性（章程 C4.13）；手機測試要直接給腳本行號。

**2026-10-02 深夜 隨餐飲料（2026-10-04 已完成，以下留作紀錄；腳本已執行，不要再跑）**：
- 已完成並推送：飲料依通路分組（#143）、選擇器分類與飲料收合（#144）、飲料調查（Sonnet＋Gemini 比對，Cline 不採用，`collab/proofs/2026-10-02-drink-verdict.md`）。
- **#145 進行中**：`tools/add-drinks-2026-10.js` 已寫好、**還沒執行**（資料檔沒動）。它會把 23 項加進 `data/convenience_items.json`（conv_dr07–20）與 `data/taiwan_items.json`（dr11–19），衛福部換算的用 `computePer100g` 算，並把舊的 20 種飲料的 category 改成小類。接手步驟：
  1. `node tools/add-drinks-2026-10.js --dry` 看清單 → 不加 `--dry` 執行 → `node tools/check-data.js`（注意 note 不能出現 AI 字樣、derived 驗算、label 要有 ref）。
  2. `node tools/diff-recs.js`：pool／matrix／recs 會變（無糖的新飲料進推薦池，有加糖的 is_treat 不進）；做差異報告（哪些情境換了飲料），commit 訊息逐條說明；`--update` 重錄。我的食物的超商／外食分類名稱也會變（ui 快照）。
  3. 選擇器現成飲料步驟依 category 再分小標題（engine `drinkGroups` 回傳 subgroups，`product-tab.js` drinkGridHtml 畫小標題；小類順序照腳本 CATEGORY 與新品項的順序）。
  4. stamp-version、smoke、walkthrough（13-9／13-10 飲料分組的斷言可能要跟著改）、看截圖；commit＋push；請使用者手機看超商分頁的飲料小類。
- 使用者週額度快用完：小工作交 Sonnet；日期切換切片 3（昨天的餐、補記）在下面那段，還沒開始。

**2026-10-02 晚 日期切換**：
- 依據：decisions #140（方向）、#141（U1–U5）、#142（第一輪審核的使用者決定；**使用者決定改完 PRD 就開工，不做第二輪審核**）。設計草案 [docs/review/2026-10-02-日期切換-設計草案.md](../docs/review/2026-10-02-日期切換-設計草案.md)，**第 9 節為準**（審核 M1–M13、S1–S10 的處理與切片）。審核逐字 `collab/opus-review-log/2026-10-02-date-switch-design-review.md`（一輪）。
- `dbf157b` 修了 PRD 舊問題：5261fec 用 JS replace 寫入「$ 加反引號」，第 0.1–12 節被重複插入（788→1346 行），已還原。**腳本改文件一律 split/join 或 Python，不用 JS replace。**
- 切片 0（`d6917b1`，Sonnet 起稿、Opus 驗收）：PRD 1、3、4、5.1、6.1、6.2、7、9、11.3；章程 C1.5、C2、C4.10、C4.15–C4.17。
- 切片 1a（`7b8da4d` db）：`meal_plan`（DB v4、備份 v6；keyPath id＝日期|時段；`validateMealPlan`、`getMealPlans`、`setMealPlan`、`setMealPlanWithSavedMeal`、`deleteMealPlan`、`purgeOldMealPlans`）、`skipped` 紀錄、`last_shown_recs`（`getLastShownRecs`／`setLastShownRecs`）、`addDailyLog(entry, { today, minDate })`（`logDateProblem`）；config `LOG_SOURCES` 加 skipped、`BACKFILL_DAYS`、`ESTIMATE_RECALL_KCAL`／`ESTIMATE_RECALL_GROUP`；fake-db 同步。
- 切片 1b（`aa4f6ba` engine）：meal-content `toPlanContent`、`resolvePlan`（skip／ok／invalid）、`planPseudoLog`、`skippedLogEntry`、`PLAN_SKIP_CONTENT`／`isSkipPlan`；today `effectiveTodayLogs`、`planToday({ …, todayPlans })` 回傳 `plannedSlots`／`plannedKcal`。check-engine 43460、smoke 54、快照逐字不變。
- 跟草案的偏離：`plan.txt` 快照沒在切片 1 錄（用 check-engine 斷言代替），切片 2 跟畫面一起錄；v3→v4 升級用既有的 v1→v4 smoke 涵蓋；backup-v6 fixture 等畫面能建預約後（切片 2／3）用 `SMOKE_FREEZE_BACKUP` 凍結。
- **切片 2 已完成（`2bbe554` ui、`f98145b` tools，未推送）**：today-plans.js、日期列、未來六天、今天的預約卡片、選擇器 plan 模式、這餐不吃、彙總卡「已排」。check-engine 43460、check-arch 通過、smoke 54、walkthrough 548（第 13 節，截圖看過含 360 寬）。快照：ui 去行號後舊行全保留＋新增 301 行（#today-dates、#rec-extra-*），唯一刻意改變 today/OFF/today-breakfast（M6）；比對腳本 `collab/proofs/2026-10-02-verify-date-switch-ui.py`。手機腳本短清單第 12 項（第 61–67 行）。
  - 跟草案的偏離：`plan.txt` 快照還沒錄（預約情境由 check-engine 與 walkthrough 第 13 節涵蓋）；backup-v6 fixture 還沒凍結（切片 3 一起，smoke 要先建一筆預約與 skipped 再 `SMOKE_FREEZE_BACKUP=tools/fixtures/backup-v6.json`）。
  - 實作發現：今天那次 renderHero 是非同步的，切到未來日子後才跑完會把彙總卡打開 → today-hero `setHeroSuppressed`。
- **下一步切片 3**（草案第 9 節）：「昨天的餐」卡片（預設收合「昨天的餐（N 餐）」；每列 吃了／S M L（ESTIMATE_RECALL_KCAL 依時段）／這餐沒吃／不確定；推薦列寫品名與熱量、跟 S/M/L 同大小；放獨立容器）、`setLastShownRecs`（排在 markRecipesShown 之後，整份覆寫當天）、補記（本週總覽入口＋選擇器 backfill 模式，addDailyLog minDate＝today−7）、「改」用 backfill 模式預載預約。
- （以下是切片 2 動工前的規格，留作對照）切片 2（草案第 9 節）：新檔 `js/ui/today-plans.js`（`loadTodayPlans`：讀今天的預約 → saved-ctx → `resolvePlan` → `planPseudoLog`；加進 check-arch C4.16 白名單與 `getMealPlans` 讀取白名單）；`tab-today.js` 日期列（七個圓點、位移保存、`visibilitychange` 重畫）、`renderRecs` 順序「紀錄→預約→關閉→推薦」、預約卡片（記下／改／取消預約；失效寫 `savedMealUnavailableLine`）、今天「這餐不吃」（關掉的時段不給）、配額因預約變低時的中性句（#142②）、未來日子 `renderFutureDay`（不跑推薦、頂端「已排 N 餐，約 X kcal」）；`today-hero.js` 多一行「已排」（主數字不扣預約、allLogged 只看紀錄、差額加預約）；選擇器 `openMealPicker(slot, { date, mode: "plan", planPreset })`（打開時記 m.date；plan 不顯示份額缺口；估算卡要出現；rememberMealType 只在 log；送出寫 `setMealPlan`／`setMealPlanWithSavedMeal`）。驗收：recs、picker、tdee 逐字不變，ui 只准新增行；walkthrough 新一節、截圖逐張看；手機腳本給行號。
- 使用者週額度 2026-10-02 晚剩約 18%：不複雜的工作（文件、查詢、使用說明）交 Sonnet。**推送前先問使用者**（切片 0、1、2 都還沒推送）。

**2026-10-02 白天**：
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
