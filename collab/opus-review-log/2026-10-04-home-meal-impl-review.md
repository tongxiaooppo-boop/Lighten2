# 2026-10-04 家庭共餐——實作審核（Opus 獨立審核）

標記：**實作審核**（設計第一輪審核見 `2026-10-04-home-meal-cook-review.md`）
審核範圍：commit a129ec1（步 0 文件）、ea9c061（步 1 自助餐改名）、ab7f88b（步 2 資料）、be04395（步 3 engine）、a3ebd38（步 4 選擇器）。
審核方式：只讀程式與資料；另在 scratchpad 寫暫時腳本，用真實 data 建 catalog，跑共餐表單 → 草稿 → 元件 → 預約 → 解析 → 帶回的全組合來回（936 組全過），以及主食歸屬啟發式、刪除／擋下、早餐解析、季節清單的邊界。沒有改任何程式檔。

---

## 收到的完整問題（逐字）

你是獨立審核者（Opus），審核「輕盈計畫 Lighten2」（D:\ok\lighten，純前端 vanilla JS＋IndexedDB）剛做完的「家庭共餐」實作。一律用繁體中文。**只讀；唯一可以寫的檔案是審核紀錄 `D:\ok\lighten\collab\opus-review-log\2026-10-04-home-meal-impl-review.md`**（新建；把你收到的完整問題與你的完整回答逐字寫進去，標「實作審核」）。不要改其他檔案、不要 commit、不要推送；可在 scratchpad 寫暫時腳本讀 data/js 驗證。

背景：設計已經過你同類的第一輪審核（`collab/opus-review-log/2026-10-04-home-meal-cook-review.md`，建議 Y′ 與 M1–M9；設計草案 `docs/review/2026-10-04-家庭共餐-設計草案.md` 第 5 節 v1；decisions #152；PRD 13.4 末「家庭共餐」；章程 B4「家常菜估算」、B12、C4.8）。實作 commit：`git log ca6f73e..HEAD` 中從「docs: 家庭共餐步驟 0」到「feat: 家庭共餐步驟 4」共 5 個（步 0 文件、步 1 自助餐改名回外食、步 2 資料、步 3 engine、步 4 選擇器畫面）。使用者追加決定：家常菜每道標季節 `seasons`（春 3–5、夏 6–8、秋 9–11、冬 12–2 月），共餐清單只列當季；家常菜擴充到 36 道（素菜 12、菜肉 12、純肉 8、湯 4），每季素菜／菜肉／純肉各至少 3 道、湯至少 1 道。我已跑過：check-data、check-engine（51986）、check-arch（37972）、smoke 54、walkthrough 631（第 16 節）全過，diff-recs 已更新（只新增行；自助餐的類別平均因菜單擴充而改變，picker 快照 26 行數字變）。

請審核：
1. **M1–M9 對照驗收**（上一輪審核定稿清單；M1 PRD 13.4／元件說明、M2 `remapSavedRefs`／`resolveSavedMeal`／`savedMealDefaultName` 的 hd_ 處理（實作用 `treeById` 併入家常菜，請驗證沒有副作用：`catalog.foodTree.byId` 的其他用途、`foods.js` 的畫面查詢、單品選擇器會不會誤列 hd_）、M3 表單⇄元件雙向函式與 `savedMealDraft` 的主食歸屬判斷（`isHomeStapleItem` 與「緊接第一道菜前的主食」啟發式是否會把使用者自己加的單品白飯誤歸共餐、或漏掉）、M4 過敏原由產生工具推導、M5 家常菜另計上限（`resolveSavedMeal` 的 homeDishes／homeSoups 計數、`composeProblem`、`foodLimitProblem`）、M6 每道取整、M7 文件、M8 預約重新解析與暫時紀錄合計、M9 狀態不放 `foodSel`、切快煮與餐型擇一）。
2. **正確性與邊界**：`js/engine/meal-content.js` 新增的共餐函式（homeMealGrams／Problem／DraftPart／FormOf／Choices／DefaultForm、`homeEstimateDefaults`）；季節（`seasonOfDate` 與 `m.season`：預約、補記用那一天的日期、跨月邊界、時區）；`homeMealFormOf` 用克數反推主食與菜量（容差、`dish` 以 `Math.abs(...) <= n` 判斷是否會誤判）；有設過敏原或素食時全擋是否符合預期；過敏原或不吃清單設定後已存的共餐預約的行為；`hd_` id 被擋、已刪的行為。
3. **UI**：`js/ui/meal-picker/home-meal.js`、`cook-tab.js`、`index.js`（`onHomeMealClick`、`homeMealActive`、`currentHomeMeal`、`submitProblem`、`pickedCount`、`applySaved`、`cookPanelHtmlNow`）：共餐與餐型擇一是否完整（含帶入組合／預約時的狀態）、`m.cook.home` 在各路徑是否一定存在（編輯組合 `editing`、`slot === null`、早餐）、切分頁再切回、快煮、關掉再開是否重置、`renderDrinks`／`updateSummary` 呼叫、disabled 按鈕處理、存成組合（`savedMealForSave`、`canSaveLog`、`tab-today.js` 的「存成組合」對含 hd_ 的紀錄）、昨天的餐與補記、含 hd_ 的組合被引用時 `savedMealUnavailableLine` 等是否正常。
4. **資料**：36 道配方（`data/reference/home_dish_recipes.json`）以資深營養師角度抽查：食材對應（青花菜 `broccoli` 在 ingredients 是熟或生？`salmon`、`shrimp`、`beef_shank` 的 basis、帶殼帶骨）、用油量、成品重、`seasons` 是否合理（台灣產季）、類別歸屬與自動規則、過敏原聯集（用 `data/home_dishes.json` 抽 5 道比對配方）；`tools/lib/home-dish-values.js` 與 check-data 規則、自我檢查有沒有洞；`hd_` 凍結清單。
5. **回歸與架構**：自助餐估算（`est`）因類別平均改變——已存的預約與紀錄照存快照不受影響，請確認；check-arch C4.17③ 推薦檔案不讀 `homeDishes`／`"dish"` 的規則是否仍成立；C1／C2（chip／group 共用、常數只在 config.js）；PRD、章程、decisions 與程式是否一致（找出不一致處）；備份不升版是否成立。
6. **缺口與建議**：文件、測試、使用者會踩的坑；是否要問使用者的產品決定（附建議）。

最終訊息請給：結論（可以 push／要先修哪些）、依嚴重度排序的清單（必修 M、建議 S、日後 N，附檔案行號與修法）、M1–M9 對照表。

---

## 完整回答

### 結論

**先不要 push，修完 3 個必修（M-1～M-3）再推。** engine 的資料形狀、來回、解析、上限、預約重新解析都正確（我用真實資料跑了 936 種表單組合的來回，全部一致）；問題集中在選擇器「帶入」的路徑：`homeMealActive()` 用 `m.slot` 判斷要不要算共餐，但「編輯組合」的 slot 是 null、早餐等時段不是午晚餐，結果帶入的共餐**看不到，也不會算進這一餐**——編輯組合時甚至會在存回時把共餐整段刪掉。另外非當季的已選菜不會顯示，也沒辦法取消。三個都是小改動，改完補 walkthrough 斷言即可。文件有幾處 M7 沒同步完成（S-8），可以跟修正放同一個 commit。

### 依嚴重度排序

#### 必修 M

**M-1 編輯含共餐的組合：共餐看不到，存回時會被刪掉或擋下（資料遺失）**
- 位置：`js/ui/meal-picker/index.js` 164（`slot = editing ? null : slotArg`）、336（applySaved 把 `home.open` 設成 true）、382（`homeMealActive` 要求 `m.slot !== null && HOME_MEAL_SLOTS 含 slot`）、436／759（`!m.editing` 才傳 homeCtx）。
- 情境：「我的食物 → 組合 → 編輯」（`ui/foods/saved-meals.js` 157）打開一個「白飯＋番茄炒蛋＋滷雞腿＋紫菜蛋花湯」的組合。`savedMealDraft` 把主食和菜都放進 `homeMeal`（`foods` 是空的）；`homeMealActive()` 回 false，所以 `currentDraft().homeMeal` 是 null；畫面也沒有共餐區塊。摘要顯示「還沒配好」，按「存回組合」會跳出「請先選餐型」。如果組合裡另外還有一杯飲料或單品，就會**存成功、但只剩飲料或單品，共餐整段被刪掉**，而且沒有任何提示。
- 修法：在 `m.cook.home` 加一個「這個選擇器可以有共餐」的判斷，三處共用同一個函式，例如 `homeMealAllowed() = m.editing || HOME_MEAL_SLOTS 含 m.slot || m.cook.home.carried`。`homeMealActive`、`renderPanel`、`cookPanelHtmlNow` 都改用它。編輯時的 `m.season` 用今天的日期（目前已經是），再配合 M-3 讓帶入的菜一定看得到。walkthrough 加一條：存一個共餐組合 → 編輯 → 看得到 → 存回 → 元件不變。

**M-2 在早餐、下午茶、宵夜帶入含共餐的組合（或預約／補記的預選）：共餐被默默丟掉，組合卡片的熱量卻有算進去**
- 位置：`index.js` 292–301（卡片用 `resolveSavedMeal(…, slot)` 算，hd_ 不受時段限制，所以 `usable` 是 true、熱量含共餐）、336、382。
- 情境：早餐的選擇器點「家裡晚餐」組合 → 提示寫「已帶入「家裡晚餐」。」，但共餐（含白飯）不在草稿裡，摘要只剩其他東西；送出時會是「請先選餐型」，或只記到飲料。卡片上的熱量和帶入後的摘要不一樣，違反 decisions #124／#125「卡片熱量＝帶入後的摘要、解析與送出一致」。
- 修法擇一（建議 a）：
  - (a) 採上一輪的 S6：帶入的共餐在任何時段都顯示、也算進去（`applySaved` 設 `m.cook.home.carried = true`，再套 M-1 的 `homeMealAllowed`），跟「帶入的餐型不在這個時段也列出」同一個說法。
  - (b) 在 engine 擋：`resolveSavedMeal` 遇到 hd_、且 `ctx.slot` 不是 null 也不在 `HOME_MEAL_SLOTS` 時，`block(c, it, "共餐只在午餐、晚餐")`。這樣卡片會出現「有 N 項目前不能用」、提示也會列出，但預約會因此失效。
  - 不管選哪一個，PRD 13.4 都要補一句說明。

**M-3 非當季但已選的菜不會顯示，也沒辦法取消**
- 位置：`js/engine/meal-content.js` 725–737（`homeMealChoices` 只列當季的菜）、`js/ui/meal-picker/home-meal.js` 39–45。
- 情境：夏天存的組合有「清炒絲瓜」（seasons 只有 summer），秋天帶入。`form.dishes` 裡有它，草稿、熱量、記錄名稱都會算進去，畫面上卻沒有那個按鈕；「已選 3 道」只看得到 2 道，想拿掉只能把整個共餐關掉。改預約時，如果使用者改的是預約日期以外的季節，也會發生同樣的事。
- 修法：`homeMealChoices(catalog, season, profile, selectedIds)`：已選但不當季的菜照樣列在所屬分組的最後，小字寫「非當季（帶入）」，可以取消選取，取消後就不再列出。湯照同樣做法。check-engine 加斷言。

#### 建議 S

- **S-1 主食清單寫死在 engine**：`meal-content.js` 636–640 的 `_homeStapleRefs` 是 `let`、寫死四個 ref，跟 `data/home_dishes.json` 的 `staples.*.ref` 重複，違反章程 C1／C2「常數只在一處」。改法：讓 `resolveSavedMeal` 判斷時用 `catalog.homeDishes.staples` 推導（例如在 available 上標 `homeStaple: true`，`savedMealDraft` 只讀這個標記），或者放進 `config.js`，再由 check-data 斷言跟產生檔一致。另外，`let` 宣告在 `isHomeStapleItem` 之後，靠的是執行時才讀，不好讀。
- **S-2 主食歸屬啟發式**：我驗證過的結果——UI 產生的元件順序固定是（食材）→ 共餐（主食、菜、湯）→ 使用者單品 → 飲料，所以使用者自己加的白飯一定排在湯後面，**不會被誤歸共餐**；主食選「不吃」再自己加白飯，帶回時白飯留在單品（已驗證）；第一道菜被刪掉時，主食仍然正確歸到共餐（已驗證）。只有手寫或日後別的入口產生「白飯緊接在 hd_ 前面」的內容才會被吸進去，而且非標準克數（例如 150g）會被 `homeMealFormOf` 默默改成中份 160g。建議日後（N-3）在元件上加 `group: "home"` 之類的明確標記；現在不必改。
- **S-3 記錄名稱不含主食**：`draftLogName`（meal-content.js 902–903）只列 hd_，所以名稱是「共餐：番茄炒蛋＋滷雞腿」，但熱量含白飯 290 kcal；組合預設名稱（`savedMealDefaultName`）又是「白飯＋番茄炒蛋＋…」，兩邊不一致。PRD 寫的是「共餐：菜名＋菜名」，所以不算 bug。建議問使用者（見產品決定第 1 點）。
- **S-4 「已選 N 件」沒算主食**：`pickedCount`（index.js 415）用的 `homeMealItemCount` 不含主食，主食加 3 道菜加湯會顯示「已選 4 件」。建議改成算進主食（walkthrough 16-1 的「已選 4 件」跟著改成 5），或明確寫成「共餐 4 樣」。
- **S-5 共餐展開但沒選菜也沒選湯時的訊息**：只選了主食就按送出，會出現「請先選餐型」，容易誤會。建議 `submitProblem` 在 `homeMealActive()` 而且菜和湯都沒選時，回「共餐：請至少選一道菜或湯」。
- **S-6 單品上限的訊息**：共餐主食算 1 項單品，使用者自己再加 4 個單品時，送出會出現「單品最多選 4 項。」，但畫面上明明只看到 4 個。建議 `composeProblem` 在 `homeMealFoodCount > 0` 時，訊息補「（共餐的主食算 1 項）」。
- **S-7 有設過敏原或素食時的畫面說明**：現在每道菜和湯都是灰的，按鈕上的小字寫「成分未確認」，但沒有說明為什麼、也沒指路。PRD 758 寫的是「擋掉的改用外食分頁的自助餐估算」。建議在共餐區塊上方加一行：「你設了過敏原（或素食），家常菜是各家做法不同的複合料理、成分無法確認，所以不能選；可以改用外食分頁的『自助餐』估算。」
- **S-8 文件沒同步完（M7 的一部分）**：
  - PRD 123：`estimate` 的用途還寫「喜宴、朋友家、**共食**、自助餐」；第 296 行表格「（**共食**、自助餐…）」。應改成「自助餐」。
  - 章程第 48 行：`home_dishes.json` 還寫「**只供外食分頁「主食＋家常菜」估算，不供逐道選擇**」，跟 #152 直接矛盾。應改成「供自助餐估算（類別平均）與家庭共餐（逐道 hd_ 單品）」。
  - 章程第 283 行（C2 表）：缺一列「共餐表單⇄元件、克數、清單、季節」，要寫唯一實作在 `engine/meal-content.js` 的 homeMeal* 與 `core/dates.js` 的 `seasonOfDate`，常數在 `config.js` 的 `HOME_MEAL_*`。
  - PRD 755：寫「預覽（熱量、蛋白質、鈉、克數，標「估計」）→ 加入這一餐」，但實作是預覽只有克數加「估計」說明，熱量在底下的摘要列，也沒有「加入這一餐」按鈕。應照實作改寫。
  - 修 M-2 時，PRD 13.4 補帶入時段的規則。
- **S-9 id 空間的防呆**：`treeById` 用 `Object.assign({}, home, foodTree)` 合併，**撞名時 foodTree 會蓋掉 hd_**，而且不會報錯。check-data 目前只檢查家常菜 id 是 `hd_` 開頭，沒有反過來擋其他 id 空間（food_tree、ingredients、商品 uid）用 `hd_` 開頭。建議加一條，章程 B4 保留前綴表加 `hd_`（上一輪審核第 7 節第 8 點）。check-arch 的 `recommendLeaks` 也可以順便掃 `"hd_"` 字面量。
- **S-10 測試缺口**：check-engine 的來回只測一組表單，M3 要求的是「所有道數 × 菜量 × 主食 × 湯」的全組合。我的暫時腳本跑過 936 組全過，建議把同樣的迴圈放進 check-engine（只花幾毫秒）。walkthrough 建議補：（a）M-1 編輯組合；（b）M-2 早餐帶入；（c）M-3 非當季帶入；（d）設了過敏原時菜變灰、有說明（上一輪要求過，第 16 節沒有）；（e）勾「存成組合」記一餐共餐，再從組合帶回。
- **S-11 不吃清單對家常菜無效**：`findDislikedHit`（filters.js 108–129）對一般品項只比對 `item.components` 或 `uid`，hd_ 兩者都對不到。設了「不吃：雞蛋」的人照樣看得到「番茄炒蛋」可以選，設了「不吃：苦瓜」也看得到「清炒苦瓜」。上一輪把這件事列為日後（N3），但修法很便宜：產生工具在每道菜輸出 `components: [配方的食材 ref…]`（只列 ingredients、fx_ 的 id，不含 hs_ 調料），`findDislikedHit` 的比對方式不用改就能對上。建議問使用者（產品決定第 2 點）。

#### 日後 N

- N-1 「其他分頁還有 N 項沒有算進這餐」（`leftoverLine`，index.js 865–871）沒有算自煮分頁的共餐（自煮的餐型草稿本來也沒算，是原本就有的行為）。
- N-2 季節改成食材層級：同一種菜在不同道的季節不一致——絲瓜（清炒絲瓜只有夏；絲瓜炒蛋是夏、秋）、青花菜（蒜炒青花菜是春、冬；青花菜炒蝦仁是春、秋、冬）。台灣產季的其他細節：菠菜可以加秋（10 月下旬起）、蘆筍產季約 3–10 月（可以加夏）、青江菜幾乎全年都有。不影響正確性，日後改成「食材季節表＋菜的季節＝主菜食材的交集」比較好維護。
- N-3 元件加共餐群組標記（取代 S-2 的位置啟發式）；`homeMealFormOf` 遇到非標準克數時保留原克數（現在會改成中份）。
- N-4 營養師角度的資料精修（見下面第 4 題）。

### M1–M9 對照表

| 項目 | 結果 | 說明 |
|---|---|---|
| M1 方案 Y′、PRD 元件說明 | ✓ | PRD 125（food 定義含 hd_）、753–760（13.4 末）。PRD 123、296 的「共食」殘留算在 S-8 |
| M2 hd_ 解析分支 | ✓ | `remapSavedRefs` 先查 `tree`，hd_ 不需要 ctx；`resolveSavedMeal` 的 hd_ 在 `myIngredientRec` 之前；`savedMealDefaultName` 查得到。`treeById` 是模組私有函式，只在 meal-content.js 用；`catalog.foodTree.byId` 本身沒有被改（WeakMap 存的是新物件）；單品選擇器（`foodListsFor`／`foodTreeSections`）只讀 `foodTree`，**不會列出 hd_**；推薦只看 `ingredient`／`product`。斷言：已刪的 hd_ 歸已不提供、預約失效 ✓。風險：撞名時 foodTree 優先（S-9） |
| M3 表單⇄元件雙向 | ✓（engine）／✗（UI 帶入） | 全組合 936 組來回一致；`savedMealDraft` 把共餐放 `homeMeal`、不放 `foods` ✓；主食啟發式在 UI 產生的順序下安全（S-2）。但帶入選擇器時，編輯組合和非午晚餐時段會掉資料（M-1、M-2），非當季看不到（M-3） |
| M4 過敏原由工具推導 | ✓ | `computeDish` 取配方食材的聯集再加「未確認」，素食 false、composite、cooked、湯 ml；check-data 比對重算。抽 5 道比對：番茄炒蛋（蛋）、宮保雞丁（花生、麩質、黃豆）、白菜滷（蝦米→甲殼類）、青花菜炒蝦仁（甲殼類）、紫菜蛋花湯（蛋、香油→芝麻）都對 |
| M5 家常菜另計上限 | ✓ | `resolveSavedMeal` 分開計 homeDishes 和 homeSoups；`composeProblem` 把主食算 1 項；`homeMealProblem` 擋超過 4 道。訊息改善見 S-6 |
| M6 每道取整 | ✓ | `Math.round(全分量 ÷ N)`；全部元件都是整數克（已斷言）；`homeMealFormOf` 的容差 `≤ n`：每道的進位誤差最多 0.5，N 道合計最多 N/2，三種菜量相差 40g，所以不會誤判 |
| M7 文件 | 部分 | decisions #152、PRD 13.4、章程 B4、C4.8 ✓；PRD 123、296、章程 48、283 沒同步（S-8） |
| M8 預約重新解析＋暫時紀錄合計 | ✓ | PRD 759 有寫；斷言 `planPseudoLog` 合計＝`resolvePlan` 合計 ✓；元件沒有 snapshot ✓ |
| M9 不放 foodSel、快煮、擇一 | ✓ | 狀態在 `m.cook.home`；切到快煮會收起；點餐型會收起共餐，點共餐會清掉餐型；每次打開選擇器都重建 `m.cook` |

### 逐題補充

**第 2 題 正確性與邊界**
- `seasonOfDate` 只讀字串的月份，不受時區影響。`m.season` 在打開選擇器時依 `day` 決定：預約和補記用 `o.date`，今天用 `todayStr()`，跟「日期在打開時就定」一致。跨月邊界：23:59 打開、00:01 送出，季節和日期都照打開時那一天，兩者一致 ✓。
- `homeMealFormOf`：主食種類用 ref 反推（四種主食的 ref 都不一樣），大小用克數完全相等反推，對不上就用中份（N-3）；菜量的容差正確（見上表）。
- 有設過敏原或素食時全擋：符合 #152 與章程 C4.1（`passesHardFilters` 遇到「未確認」就擋，素食的原因是「飲食限制未確認」）。已存的共餐預約在之後設了過敏原會失效（有斷言）；組合卡片會出現「有 N 項目前不能用：成分未確認」；帶入時菜被擋掉，白飯會落到單品裡（first hd_ 找不到），這可以接受，提示裡會列出被擋的菜。不吃清單目前對家常菜沒有作用（S-11）。
- hd_ 用份數記法：會被擋成「沒有設一份，請改用克數」（文字是寫給我的食材的，但實際上碰不到）。已刪的 hd_ 會在 remap 時被丟掉，所以預約失效、組合寫「已不提供」✓。

**第 3 題 UI**
- `m.cook.home` 每次打開都建立，所有路徑都存在 ✓。問題在判斷條件，不在物件存不存在（M-1、M-2）。
- `onHomeMealClick` 每次點完都呼叫 `renderPanel`、`renderDrinks`、`updateSummary` ✓。被擋的按鈕：如果已經選了還是可以點掉（`!!x.reason && !on`）✓。已滿 4 道時，其他按鈕點了沒反應、也沒變灰（只有文字寫「最多 4 道」），可以接受。
- 存成組合：`toSavedContent` 照樣收 hd_ 的 food 元件；`savedMealForSave` 用 slot null 解析，hd_ 不受時段影響 ✓；`tab-today.js` 的 `canSaveLog` 只擋估算 ✓。
- 昨天的餐和補記：`today-plans.js` 56 與 `planPseudoLog` 都走 `buildDraftContent(savedMealDraft(…))`，共餐元件會依原順序重建 ✓。名稱用 `plan.name`（「共餐：…」）✓。

**第 4 題 資料（營養師角度）**
- 基準：`broccoli`、`salmon`、`shrimp`、`beef_shank`、`chicken_thigh`、`egg`、`fx_pork_rib` 都是生重；`firm_tofu` 是原樣；三種飯和熟麵是熟重。配方用的都是生重，再用成品重 `cooked_g` 換算，邏輯正確。蝦仁是冷凍保水的蝦仁，鈉 357mg/100g，已經反映在青花菜炒蝦仁。
- 帶骨帶皮：`chicken_thigh` 是**去皮去骨**雞腿肉，但滷雞腿、三杯雞一般是帶皮帶骨，脂肪和熱量偏低（滷雞腿 191 kcal/100g，帶皮通常在 210–240 左右）；豬小排 195g、鱸魚 350g 都當成可食重算。單位一致，但採買時要另外換算（PRD 5.3 已列）。屬於估計範圍，不必擋。
- 牛肉：三道快炒（蔥爆牛肉、空心菜炒牛肉、蠔油芥蘭牛肉）用的是牛腱（139 kcal，脂肪 6g），但家裡快炒多半用火鍋肉片或嫩肩、梅花，脂肪較高。熱量可能低估 15–30%。日後可以換成牛肉片類的 ref（N-4）。
- 滷、三杯的鈉：滷雞腿 728、滷豆干滷蛋 771、三杯雞 682 mg/100g，算法是假設醬油全部進到成品，**會高估**（滷汁會留在鍋裡）。方向保守，可以接受，但 note 應該寫明。
- 用油：一般青菜每 350g 用 10g 油，每 100g 成品約 3g 油，比外食少、合理；茄子 25g（茄子吸油）合理；涼拌小黃瓜用香油 5g 合理。
- 類別：麻婆豆腐算純肉、白菜滷算菜肉（蔬菜占比 0.9，但有肉和蝦米）、宮保雞丁算菜肉（蔬菜占比剛好 0.30），都符合自動規則或在邊界上，可以接受。
- 季節：大致合理，不一致的地方見 N-2。每季的道數：春 素7／菜肉9／純肉8／湯2，夏 6／6／8／2，秋 6／11／8／4，冬 7／8／8／3，都達到門檻。
- 工具與 check-data：調料的過敏原只從衛福部來源取（鹽、水是 derived，沒有過敏原，正確）；過敏原與素食的檢查是對工具產生的資料檢查，再加上「產生檔＝重算」，手改產生檔會被抓到 ✓；凍結清單的三種自我檢查都有 ✓。漏洞見 S-9（反向的 id 空間檢查）。

**第 5 題 回歸與架構**
- 自助餐的 `est`：預約和紀錄的 estimate 元件都帶 `snapshot`（和 `est`）。`remapSavedRefs` 讓估算直接通過，`contentTotals` 用快照算，所以**類別平均改變不會影響已存的預約和紀錄** ✓；只有新打開的估算卡數字會變（快照 26 行，符合預期）。
- check-arch C4.17③：四個推薦檔案仍然不碰 `homeDishes`、`"dish"`、`"food"`；`recommend.js` 141–144 只看 `ingredient`／`product`，hd_ 會被忽略 ✓。預算透過 `planPseudoLog` 的 `totals` 算進共餐預約，這是設計本意。
- C1／C2：`chip`、`group`、`PART_LABELS` 從 estimate-card.js 匯出給 home-meal.js 共用，可以接受（日後可以搬到共用的 picker-widgets）；`HOME_MEAL_*` 放在 config.js ✓；`_homeStapleRefs` 違反規則（S-1）。
- 備份不升版：food 元件的形狀沒變，`db.js` 的驗證不限制 ref 前綴，`isFoodAmount` 只收整數，hd_ 照常通過 ✓。成立。

### 要問使用者的產品決定（附建議）

1. **記錄名稱要不要含主食？** 現在是「共餐：番茄炒蛋＋滷雞腿＋紫菜蛋花湯」，但熱量含白飯。建議改成「共餐：白飯＋番茄炒蛋＋滷雞腿＋紫菜蛋花湯」（上一輪建議的格式），跟組合預設名稱一致；不吃主食時就不寫。
2. **不吃清單要不要擋家常菜？** 建議要（S-11），設了「不吃：雞蛋」卻能選番茄炒蛋，使用者會覺得 app 沒記住。成本：產生工具多輸出一個欄位、check-data 加一條，engine 不用改。
3. **在早餐帶入「家裡晚餐」組合時要怎麼處理？**（M-2）建議照樣帶入、照樣顯示共餐（a）；另一個選擇是擋下並說明「共餐只在午餐、晚餐」（b）。
4. **帶入的非當季菜**（M-3）：建議照樣顯示、標「非當季」、可以取消；不要自動拿掉（拿掉會讓組合帶入後跟卡片熱量不一致）。
