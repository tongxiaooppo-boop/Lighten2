# 工作線 C「我的組合」實作前調研（唯讀）

日期 2026-10-01。HEAD `d6679dd`。目的：給之後寫工作線 C 實作計畫用。範圍是規格與程式現況的事實整理，不做設計決定。引用格式「檔案:行號」，PRD 指 `docs/PRD.md`，CHARTER 指 `docs/CHARTER.md`，decisions 指 `docs/decisions.md`。

**最重要的前提**：HEAD 是切片 7（單品）**commit 0（只有 PRD 文件）**之後，切片 7 的程式還沒開工（`collab/to-opus.md:5`）。所以目前 `js/` 裡沒有任何 `food`、`FOOD_MAX_PER_MEAL`、`FOOD_QTY_MAX`（Grep `FOOD_MAX|FOOD_QTY` 在 `js/` 無結果；`js/data/db.js:147` `COMPONENT_KINDS = ["ingredient","product","estimate"]`）。本報告第 4 節談的 `food` 都是計畫與 PRD 的設計，不是現有程式。

---

## 1. 規格現況

### 1.1 工作線 C 的範圍（PRD:265 路線圖列）
`saved_meals` store；`toSavedContent`／`remapSavedRefs`／`resolveSavedMeal`；存成組合的兩個入口；選擇器裡的「我的組合」列；「我的食物」主分頁的管理區塊（含直接編輯內容，12.6；位置見 11.5、13.2）；今日建議日期切換的預選引用（decisions #119）；匯出匯入涵蓋 `saved_meals`（`BACKUP_SCHEMA_VERSION` +1、凍結新版 fixture）。
驗收（同列 PRD:265）：`resolveSavedMeal`／`remapSavedRefs` 的 check-engine 斷言（過敏原、隱藏後改用複製版本、下架、骨架已刪除、骨架 `allow` 失效、軸上限、免開火、角色超量依順序擋後者）；`toSavedContent` 的 `keepImplicit` 兩種情況；帶入時被擋元件不預選；自煮份量依當天預算重算；推薦引擎不讀（check-arch）。
該列也寫「組合包含我的料理要等 B-4b」（B-4b 現在是 D 切片 9，PRD:264）。

### 1.2 資料結構（PRD 11.1，PRD:375-407）
- store 名 `saved_meals`，keyPath 應為 `id`（PRD:379 `id: "saved_xxx"`；PRD:371 命名只用 `saved_meals`／`SavedMeal`）。欄位：`id`、`name`（必填、可重複、建立時自動帶「品項名稱以＋連接」，PRD:380）、`content`、`archived`（刪除＝封存，PRD:382）、`created_at`、`updated_at`（PRD:383）。
- `content` 是範本形式的 MealContent（PRD:387-398）：
  - `meal_type`：存來源那一餐的型態（PRD:391）。
  - `ingredient`：只存 `axis`、`ref`、`is_primary`，不存份量（PRD:392）。
  - `product`：只存 `ref`、`qty`，不存 `role`、`snapshot`（PRD:393）。
  - `estimate`：不允許（PRD:394）。
  - `dish`：只存 `ref`、`qty`（PRD:395）。
  - `food`：只存 `ref`、`qty`，不存 `snapshot`（PRD:396）。
  - `implicit`：入口 1 使用者改過才存值、否則 `null`；入口 2 一律 `null`（PRD:397）。
  - 營養合計不存（PRD:398）。

### 1.3 驗證規則
- 兩層（PRD:404-406；章程 C1）：db.js 寫入只做結構驗證（名稱非空、至少 1 元件、沒有 `estimate`、`product` 有 `ref`／`qty` 且無 `snapshot`／`role`、`dish`／`food` 有 `ref`／`qty` 且無 `snapshot`）。語意驗證（角色上限、骨架 `allow` 與軸上限、免開火）由 ui 在寫入前呼叫 engine，用手動記錄規則（CHARTER:298 C4.8），**不檢查時段**。
- 單一函式解析：`resolveSavedMeal(saved, catalog, profile, hidden, customFoods, customDishes, customIngredients, tfdaLookup)` 回傳「可用元件」「被擋元件與原因」「已不提供的元件」（PRD:419）。規則（PRD:421-426）：
  1. `ref` 查不到或封存 → 已不提供（`food` 引用的分層品項下架或我的食材封存也算）；
  2. `ref` 在 `hidden_catalog_uids` → 有未封存的 `copied_from === ref` 的我的品項就換成它，否則已不提供；規則 1–2 由 `remapSavedRefs` 實作（建立與引用共用）；
  3. 硬性過濾（過敏原、飲食、不吃）沒過 → 被擋＋原因；
  4. 自煮部分依目前骨架重驗：`archetype_id` 不存在 → 全部自煮元件被擋；食材不在軸 `allow` → 該元件被擋；超軸上限依 `components` 順序擋後者；免開火＋需加熱食材 → 該食材被擋；
  5. 角色用 catalog 當下的 `role`，超上限依順序擋後者；`food` 比 `FOOD_MAX_PER_MEAL`，規則 4 只檢查 `ingredient`；
  6. `valid_slots` 不是安全規則，不限制帶入。
- `remapSavedRefs(savedContent, catalog, hidden, customFoods, customDishes, customIngredients, tfdaLookup)` 回傳 `{ content, dropped }`，`dropped` 非空時存檔前用中性文字列出「以下品項已不提供，不會存進組合」（PRD:402）。`food` 的解析讀 `catalog.foodTree`，不另加參數（PRD:403）。
- 衛福部查詢檔載入失敗是錯誤狀態，不是「查不到」，也不能當成 `dropped`（PRD:520；decisions #69，decisions:75）。
- 12.5 對 `dish` 的補充：`implicit` 在組合可以是 `{0,null}` 或 `null`；含 `dish` 的一餐 `archetype_id`、`method_id` 是 null，略過規則 4（PRD:622-624）。

### 1.4 入口（PRD 11.2、11.3、12.6、13.2）
- 建立入口 1：「自己選」送出時可勾「存成組合」，名稱預填（PRD:412）。
- 建立入口 2：已記錄的一餐「存成組合」；含 `estimate` 的那一餐不提供；下架／隱藏品項走 `remapSavedRefs`；語意驗證不過用中性文字列原因、不存（PRD:413）。不得依頻率提示「要不要存成組合」、不記使用次數（PRD:415；PRD:667）。
- 引用入口 A：選擇器（「自己選」）三分頁上方一列「我的組合」，列出全部組合不分型態；卡片有名稱、型態小圖示、內容與熱量（依今天剩餘預算）；有元件不能用時加一行「有 N 項目前不能用：原因」；可用元件 0 個時整張灰階不能點；點選後切到組合的型態分頁並帶入可用元件，被擋與已不提供的不預選，已帶入的一律顯示可取消；確認後才記錄，不做一鍵記錄（PRD:429-430）。排列＝建立順序，不依熱量、不上色（PRD:432）。
- 引用入口 B：今日建議日期切換的預選：一律帶入三分頁編輯器；未來日期卡片不做預算縮放，自煮寫「份量當天決定」；填進計畫時補商品快照（PRD:431）。
- 管理：「我的食物」主分頁一個獨立的「我的組合」區塊：列表、改名、編輯內容（同一個選擇器、存回同一筆、更新 `updated_at`）、刪除（封存）／還原；不影響已記錄的餐與已排的計畫（PRD:440、PRD:630-641；decisions #54，decisions:60；#75，decisions:81）。編輯模式：沒有時段、主餐上限 2（decisions #63，decisions:69）、不套 `valid_slots`、不寫 `picker_last_meal_type`、不寫 `daily_log`、`implicit` 原本有值就帶出、改過才存值（PRD:633-638）。
- 搜尋範圍含「我的組合」（PRD:685）。

### 1.5 定位與邊界
- 推薦、統計、hero 不讀 `saved_meals`（PRD:436；CHARTER:308 C4.16）；組合是單餐範本、不是週模板（PRD:373）。每次引用都經過 `resolveSavedMeal`（CHARTER:308）。
- B9 資料下架：組合由 `resolveSavedMeal` 歸入「已不提供」並顯示中性提示；`food` 同（CHARTER:219）。
- C1.5：`saved_meals` 是清單型資料，一筆一個 key（CHARTER:254）。

### 1.6 備份升版（PRD 11.6，PRD:442-472）
- 目前是「完整備份與還原（取代）」，id 原樣保留，不需要 id 改寫（PRD:450）；id 改寫（我的品項、料理改 id 時組合 `ref` 連動）只在日後的合併匯入／分享包才適用（PRD:444）。
- `schema_version`：新增 store 就 +1，跟 `DB_VERSION` 分開計；新增元件種類（`food`）不升版（PRD:459；decisions #123，decisions:129）。
- 每版凍結 `tools/fixtures/backup-v<N>.json`，之後版本都要讀得了（PRD:471）。
- store 與 settings key 清單由 db.js 的 `STORE`、`BACKUP_SECTIONS`、`SETTING_KEYS` 決定，check-engine 斷言每個 store 都在某區塊（PRD:472）。
- 切片 7 的驗收要求「舊備份 fixture 可讀」（PRD:774）；切片 7 計畫 S11 要求交接給工作線 C：**v3 fixture 要含一筆 `food` 紀錄**（`docs/review/2026-10-01-D7-實作計畫.md:262`）。

---

## 2. 程式現況

### 2.1 已存在
| 項目 | 位置 | 現況 |
|---|---|---|
| `DB_VERSION` | `js/data/db.js:13` | `= 1`。`upgrade()`（db.js:53-63）只有 `oldVersion < 1` 一段；註解 db.js:52 寫「工作線 C 的 saved_meals 就在後面加一段、DB_VERSION +1」 |
| `STORE` | `js/data/db.js:17-25` | 7 個 store，**沒有** `saved_meals`、`meal_plan` |
| `BACKUP_SCHEMA_VERSION` | `js/data/db.js:30` | `= 2`（v2＝B-1a 的 `hidden_catalog_uids`，db.js:29）。所以工作線 C 升版後是 **v3** |
| `BACKUP_SECTIONS` | `js/data/db.js:34-42` | 沒有 `saved_meals`；`BACKUP_LABELS`（db.js:45-48）也要補；`BACKUP_MIGRATIONS = {}`（db.js:386，v1→v2 沒有步驟）；`migrateBackup`（db.js:388-406）會把舊檔缺的區塊補成空陣列並把 manifest 設 0，所以 v2→v3 不需要寫遷移步驟 |
| `validateBackup` | `js/data/db.js:410-481` | 逐 store 分派驗證器（db.js:455-465），沒有的 store 丟「沒有驗證器（新增 store 要在 validateBackup 補上）」（db.js:465）；`ctx` 參數現在沒用（db.js:410 eslint 註解） |
| `SETTING_KEYS` | `js/data/db.js:313-332` | 只有 `tdee_state`、`picker_last_meal_type`、`hidden_catalog_uids`（`dedicatedOnly`）；**沒有** `favorite_refs`（切片 5 才加）。工作線 C 本身不需要新 settings key |
| `exportAllData`／`importAllData` | `js/data/db.js:812-858` | 用 `STORE_NAMES` 全部 store 一個 transaction；新 store 加進 `STORE` 與 `BACKUP_SECTIONS` 就自動涵蓋 |
| `validateCustomFood`、`addCustomFood`、`updateCustomFood` | `js/data/db.js:231、665、678` | 可當 `saved_meals` 的 `validateSavedMeal`／`addSavedMeal`／`updateSavedMeal` 的寫法樣板（`generateId(prefix)` 在 db.js:132） |
| 備份 UI | `js/ui/backup.js:6` | import `exportAllData`、`importAllData` 等，已在 check-arch 白名單 |
| check-arch C4.16 | `tools/check-arch.js:24-34、322-323` | `SAVED_MEAL_READERS = ["listSavedMeals","getSavedMeal","exportAllData"]`；白名單檔案：`js/ui/meal-picker/`、`js/ui/foods/saved-meals.js`（檔案還不存在）、`js/ui/backup.js`、`js/data/db.js`；日期切換預選編輯的檔案「做的時候再加」（check-arch.js:29）；檢查器 `restrictNames`（check-arch.js:274-284）以字界比對名稱出現在不在白名單的檔案就失敗。**目前在 `js/` 裡這些函式名稱都不存在，所以這條是「空轉通過」** |
| check-engine 備份區 | `tools/check-engine.js:960-1083` | 有 `backup-v1.json`、`backup-v2.json` 的讀得了斷言（check-engine.js:962-991）、每個 store 要在 `BACKUP_SECTIONS` 的斷言（check-engine.js:971）；**check-engine.js:1023 的斷言「不認得的區塊：`f.sections.saved_meals = []` 應被擋」會在加上 store 後失敗，必須改掉**（`meal_plan` 的那條 :1024 同理屬於 Phase 2） |
| `tools/lib/fake-db.mjs` | `tools/lib/fake-db.mjs:1-162` | diff-recs 用的記憶體假 db，取代 `js/data/db.js`（`tools/lib/adapter-v2.js:1`、:15）；**沒有**任何 saved_meals 函式。選擇器（會被 diff-recs 載入）若新增 import `listSavedMeals` 等，fake-db 必須同步匯出，否則 Node 載入選擇器會失敗（推論，沒實際跑過） |

### 2.2 只有註解、斷言或文件，尚未實作
Grep（`saved_meals|toSavedContent|remapSavedRefs|resolveSavedMeal|keepImplicit|listSavedMeals|getSavedMeal`，檔型 js/html/json/mjs/yml/css）在 `js/`、`tools/` 的命中**只有**：
- `js/data/db.js:52`（註解）；
- `tools/check-arch.js:24-34、322-323`（讀取函式名單與白名單設定）；
- `tools/check-engine.js:1023`（「不認得的區塊」反向斷言）。

**不存在**：`toSavedContent`、`remapSavedRefs`、`resolveSavedMeal`、`keepImplicit`（`js/engine/meal-content.js` 沒有任何 `saved`／`組合`的實作命中）、`listSavedMeals`、`getSavedMeal`、`saved_meals` store、`js/ui/foods/saved-meals.js`、選擇器的「我的組合」列、「存成組合」勾選、紀錄上的「存成組合」按鈕、日期切換預選、`meal_plan` store。`index.html`、`css/`、`js/ui` 沒有「我的組合」「存成組合」字樣（Grep 無命中）。

### 2.3 可重用的既有東西
- `js/engine/meal-content.js`：`contentTotals`（:562）、`buildDraftContent`（:532）、`contentFromCompose`（:502，ingredient 元件含 `is_primary` 與 `scale`）、`manualSelectionProblem`（:206，角色上限；主餐上限由 `manualRoleMax(role, slot)`，`js/core/config.js:28-34`）、`composeProblem`（:292）、`composeOptionProblem`（:276）、`noCookViolation`（:244）、`composePrimary`（:268）、`draftLogName`（:606，自動名稱的現成來源）、`productComponent`／`productSnapshot`（:436-451，快照建構；非匯出）。
- `js/engine/filters.js:68` `passesHardFilters(item, profile)`，回傳 `{ ok, reason, code }`。`findDislikedHit`（filters.js:98-121）只認三種形狀：`is_composed`（protein_id/staple_id/…）、有 `components`、有 `uid`。
- `js/data/catalog.js`：`fromCustomFood`（:94，我的品項→品項形狀，`archived`、`uid` 都有）、`normalizeFoodTree`（:128，補 `uid`、`allergen_tags`、`diet_tags`）、`catalog.foodTree = { groups, items, byId }`（:162 附近）。

### 2.4 現有程式與 11.3 規則對不上的地方（實作要補或搬）
- **自煮單一食材的硬性過濾包裝在 ui 層**：`hardFilterReason`（`js/ui/meal-picker/cook-tab.js:29-35`）把食材包成 `is_composed` 的形狀再呼叫 `passesHardFilters`。`resolveSavedMeal` 在 engine，不能 import ui（check-arch 分層，`tools/check-arch.js:145`），所以這段要搬進 engine（章程 C2 不得重複定義）。直接把食材物件丟給 `passesHardFilters` 會讓「不吃」永遠比不中（食材物件沒有 `uid`／`components`，`findDislikedHit` 的 keys 是空的，filters.js:106-109）。這是我讀程式推論，沒實測。
- **烹調法（`method_id`）不是元件**：`ingredient` 元件只有四個軸（`INGREDIENT_AXES`，db.js:148），烹調法在 `content.method_id`。`composeProblem` 要求有烹調法、檢查 `a.methods`（meal-content.js:297、:306）；11.3 規則 4 沒寫烹調法失效怎麼辦（見第 5 節）。
- **選擇器草稿存的是物件不是 id**：`emptyCookDraft()`（`js/ui/meal-picker/index.js:50-52`）的 `archetype`、`proteins[]`、`staple`、`vegetables[]`、`seasoning`、`method` 都是 catalog 物件；超商／外食分頁的選取是 `tabs[tab].selected`（uid 陣列，index.js:38-39、:156-160），飲料是單獨的 `drinkUid`（index.js:42、:162-165）。「帶入選擇器」要寫一個由 saved content＋catalog 重建草稿的函式，並處理 `product` 元件的 `role === "drink"` 要放進飲料步驟（`role` 組合不存，從 catalog 讀）。
- **選擇器現在沒有「編輯模式」與「預載」**：`openMealPicker(slot, onLogged)`（index.js:89）一定要 slot、寫死 `todayStr()`（index.js:744）、送出一定寫 `daily_log` 與 `picker_last_meal_type`（index.js:737-758）。12.6 的編輯模式（沒時段、不寫 log、不寫 last picked、主餐上限 2）、日期切換預選與補記過去（decisions #120）都需要改這支入口。
- **「改過用油／調味」**：自煮的覆寫存在 `d.implicitOverride`（index.js:51、:597-616 增刪），`composeImplicit`（meal-content.js:332-338）在覆寫不合用時退回預設。`keepImplicit`（「使用者是否改過」）要由 ui 傳入，目前沒有現成的布林。

---

## 3. 依賴鏈（工作線 C 會動到的檔案與函式）

引用方向（ui → engine → core；ui → data；data → core，`tools/check-arch.js:145`）：

| 層 | 檔案 | 要動的事 |
|---|---|---|
| data | `js/data/db.js` | `STORE.savedMeals`、`DB_VERSION` 1→2 並在 `upgrade` 加 `oldVersion < 2` 段（db.js:53）、`BACKUP_SECTIONS`（:34）、`BACKUP_LABELS`（:45）、`BACKUP_SCHEMA_VERSION` 2→3（:30）、`validateSavedMeal`（結構驗證，不能重用 `contentProblems`，因為它要求 `product` 有 snapshot，db.js:179-182）、`validateBackup` 加分派（:455-465）、`addSavedMeal`／`updateSavedMeal`（封存／還原／改名／編輯）／`listSavedMeals`／`getSavedMeal`。`summarizeBackup`（:490）自動涵蓋（用 `created_at`） |
| data | `js/data/catalog.js` | 大概不用動（`catalog.foodTree` 已有）；`resolveSavedMeal` 的 `catalog` 參數由 `loadCatalog()` 提供 |
| engine | `js/engine/meal-content.js` | 新增 `toSavedContent`、`remapSavedRefs`、`resolveSavedMeal`（章程 C2、PRD:400）；由 saved content 重建草稿的純函式（放 engine，`picker.js` 或 `meal-content.js` 皆可，要避開 C4.14 的 `sodium|sat_fat|DISPLAY_FIELDS` 識別字限制，`docs/review/2026-10-01-D7-實作計畫.md` 第 1 節 check-arch 段）；語意驗證沿用 `manualSelectionProblem`、`composeProblem`、`noCookViolation` |
| engine | `js/engine/filters.js` 或 `picker.js` | 接收從 `cook-tab.js:29` 搬來的單一食材過濾包裝 |
| ui | `js/ui/meal-picker/index.js`（787 行）及 `product-tab.js`、`cook-tab.js` | 「我的組合」列、「存成組合」勾選與名稱欄（入口 1，送出在 `onMealSubmit` :737）、帶入、編輯模式；匯入 `listSavedMeals`（已在 check-arch 白名單，meal-picker/ 整個目錄） |
| ui | `js/ui/foods/saved-meals.js`（新） | 管理區塊（check-arch 白名單已預留名稱，check-arch.js:29） |
| ui | `js/ui/tab-foods.js`、`js/ui/foods/list.js:24-25`、`index.html:292-295` | 掛上管理區塊；`FOODS_SUBTABS` 現在只有 4 個子分頁，沒有組合的位置（見第 5 節）；搜尋範圍（PRD:685） |
| ui | `js/ui/tab-today.js` | 入口 2：已記錄一餐的「存成組合」按鈕（`loggedHtml` :48-58 是目前唯一顯示已記錄餐點的地方；`tab-today.js` **不可** import 讀取函式，但寫入函式不限，CHARTER:308），所以入口 2 的流程是：由 log 內容→`toSavedContent`→`remapSavedRefs`→語意驗證→`addSavedMeal`，整條都不需要讀 `saved_meals` |
| ui | `js/ui/backup.js` | 預覽用 `BACKUP_LABELS`／`summarizeBackup`，自動帶出；確認 UI 沒有硬編 store 清單（我沒逐行讀 backup.js） |
| tools | `tools/check-arch.js` | 更新白名單與註解（:24-34）；日期切換預選編輯檔案出現時再加；現有規則讓 `tab-today.js`、`today-hero.js`、`engine/` 不得出現讀取函式名 |
| tools | `tools/check-engine.js` | 改 :1023；新增 saved 斷言（PRD:265 列出的清單）；備份 v3 讀得了＋v2 升級後 `saved_meals` 為空；驗證器測資 |
| tools | `tools/fixtures/backup-v3.json`（新） | 凍結；內容要含：組合（含 `food`）、含 `food` 的 log（S11） |
| tools | `tools/lib/fake-db.mjs`、`tools/lib/adapter-v2.js`、`tools/diff-recs.js` | fake-db 要補 `listSavedMeals` 等；picker 快照是否新增「我的組合」情境（D7 計畫 M5 的 `foods/*` 情境是模板）；`tools/snapshots/picker.txt`、`ui.txt` 既有行必須逐字不變 |
| tools | `tools/smoke-browser.mjs`、`tools/mobile-walkthrough.mjs` | smoke 目前在 :194-219 做備份來回；mobile-walkthrough:555-590 做備份取消／還原；v3 fixture 由 smoke 真的匯出產生（check-engine.js:985 註解），所以 smoke 要先造出一筆組合與一筆 `food` 紀錄再匯出。walkthrough 要加組合流程與步驟編號檢查（D7 計畫提到 walkthrough L80 `checkStepNumbers`） |
| docs | `docs/PRD.md`、`docs/decisions.md`、`docs/手機實機腳本.md` | 比照 D7 做法 |

---

## 4. 與切片 7 的介面

### 4.1 切片 7 會產生什麼（來源：PRD:120、:721-731、D7 計畫 8.1-8.3，皆為計畫，程式未實作）
- 紀錄的 `food` 元件：`{ kind: "food", ref, qty, snapshot }`。`ref` 是分層品項 id（內建食材 id 或 `fx_` 開頭；切片 8 起還有我的食材 `cing_`，PRD:120）；`qty` 是 0.5 的倍數、0.5–12（PRD:121、:727）；快照必有 `name`、`kcal`、`amount`、`unit`，其餘營養欄位是數字或 null，`partial` 只給切片 8 起的我的食材用（PRD:727）；一餐同一個 `ref` 只有一個 `food` 元件（PRD:722）；一餐最多 4 項（`FOOD_MAX_PER_MEAL`，PRD:723）；不佔角色名額、不套 `valid_slots`、不影響 `meal_type`（PRD:120、:723）。
- 只有單品的自煮紀錄：`meal_type` 是 `cook_quick`／`cook_full`，`archetype_id`、`method_id` 是 null，`implicit` **恰好** `{ oil_g: 0, seasoning: null }`（PRD:120、:133、:725；decisions #123）；其他分頁（超商、外食）的單品紀錄 `implicit` 是 null（PRD:133 「其他型態是 null」）。
- 選擇器草稿的單品狀態 `foodSel = [{ uid, qty }]`，「就是為了讓工作線 C 帶入而設計的形狀」（D7 計畫 2.3 的工作線 C 段）。
- 切片 7 之前沒有 `saved_meals`、`meal_plan` store，不可能存在含 `food` 的組合或計畫（D7 計畫 2.3、第 1 節末）。

### 4.2 工作線 C 要接手的事（D7 計畫 2.3 與 8.3 S11 所列，加上我對照程式的補充）
1. `toSavedContent`：`food` 去 `snapshot`，只留 `ref`、`qty`（PRD:396；D7 計畫 2.3）。
2. `remapSavedRefs`／`resolveSavedMeal`：查 `catalog.foodTree.byId`（不另加參數，PRD:403；decisions #92）；下架或已封存（切片 8 後）→ 已不提供；硬性過濾用分層品項已有的 `uid`、`allergen_tags`、`diet_tags`（D7 計畫 2.3；`js/data/catalog.js:128-141`）；超 `FOOD_MAX_PER_MEAL` 依 `components` 順序擋後者（PRD:425）；規則 4 略過 `food`（PRD:425；6.3 對單品的豁免見 PRD:235-236）。
3. 入口 2 會遇到切片 7 寫下的 `food` 紀錄（D7 計畫 2.3）。紀錄裡的 `food` 元件有 `snapshot`、`qty`，轉成組合時丟掉快照（若 `ref` 之後下架，`remapSavedRefs` 會把它放進 `dropped`）。
4. 帶入選擇器：重建 `foodSel`（`uid`＋`qty`）（D7 計畫 2.3）。
5. **只有單品的自煮紀錄的 `keepImplicit`**（D7 計畫 8.3 S11）：入口 2 的 `keepImplicit` 一律 false（PRD:401），所以存成組合後 `implicit` 是 null；引用時只有單品沒有 `ingredient`，`buildDraftContent`／`composeImplicit` 在沒有烹調法時天然回 `{0,null}`（D7 計畫第 1 節 `composeImplicit` 條目，`js/engine/meal-content.js:332-338`），所以組合的 `implicit: null` 與記錄時的 `{0,null}` 不衝突。但入口 1 用 `keepImplicit` 時，使用者若選了餐型又改過用油，然後存組合，之後組合內容被編輯成只剩單品，`implicit` 的值是否該被清掉——規格沒寫（見第 5 節）。
6. db 驗證：組合的 `implicit` 對「沒有 `ingredient` 的自煮」是 `null` 或 `{0,null}`（PRD:623，原寫給 `dish`；decisions #123 說「切片 9 的 dish 同一條」被一般化到所有「沒有 ingredient 的自煮」）。組合的 `archetype_id`／`method_id` 在 11.1 表格沒有列，但規則 4 與 12.5 都用到（見第 5 節）。
7. 備份：v3 fixture 要含一筆 `food` 紀錄（D7 計畫 S11）；`food` 本身不升版（decisions #123），工作線 C 是升到 v3 的那一個。

### 4.3 PRD 11.3 規則 4、5 對 `food` 的要求（PRD:424-425）
- 規則 5：`food` 沒有角色，改比單品上限 `FOOD_MAX_PER_MEAL`，超出的依 `components` 順序歸「被擋」。
- 規則 4：骨架重新驗證**只檢查 `ingredient` 元件，`food` 略過**。
- 搭配 PRD:235-236 的 6.3：單品豁免骨架 `allow`／軸上限與免開火檢查。
- CHARTER:298 C4.8：單品不佔角色名額、不套 `valid_slots`、只有單品也成一餐（機：`manualSelectionProblem` 在第 5 項單品時回傳原因）。**但現有 `manualSelectionProblem(items, slot, opts)` 簽名（meal-content.js:206）沒有單品參數、沒有單品數量上限，D7 計畫提到會在切片 7 改**；組合的「單品超過上限」要用同一個函式或同一常數，不能另寫一份（C2）。

---

## 5. 規格裡的空白、矛盾、待決（附出處）

以下依我判斷的重要性排序。標「需使用者」是產品決定，「需 Opus」是技術決定。

1. **日期切換預選引用整件事跟工作線 C 的順序矛盾（需使用者／Opus）**。路線圖 C 列把「今日建議日期切換的預選引用」列為 C 的範圍（PRD:265），但日期切換本身是另一列、排在 C 之後（PRD:266「排在它們之後」）、並且依賴 Phase 2 的 `meal_plan`（PRD:252，目前沒實作），細節還沒定（PRD:266 的①–⑤）。decisions #118 也寫「細節做的時候定」（decisions:124）。C4.16 白名單也寫「檔案做的時候再加」（check-arch.js:29）。工作線 C 是否應該把這項明確切出去（留給日期切換那一列），規格沒說。
2. **管理區塊在「我的食物」的哪裡（需使用者）**。PRD:440 寫「主分頁一個獨立的『我的組合』區塊」；PRD:686 寫「我的組合管理直接放這裡」；但 PRD:690-695 的子分頁表只有超商、外食、自煮、飲品・水果四個（`FOODS_SUBTABS`，`js/ui/foods/list.js:24`），且「主分頁固定 5 個」（PRD:684）。「獨立區塊」是子分頁？還是頁面上獨立一段？跟「我的品項管理」「已隱藏」「不吃全部清單」（PRD:686）這類搬家區塊的呈現是否一致，沒寫。手機寬度也沒定。
3. **資料結構缺 `archetype_id`、`method_id`（需 Opus）**。11.1 表格（PRD:389-398）沒有這兩欄，但規則 4 用「`archetype_id` 已不存在」（PRD:424），12.5 說組合的 `archetype_id` 是 null（PRD:624），而 db.js 的 `contentProblems` 要求這兩個鍵存在（db.js:168）。應視為保留（PRD:391 只說「`meal_type` 存來源型態」），但沒明寫。`method_id` 失效時（烹調法不在骨架 `methods`、或需加熱與免開火衝突）規則 4 只寫「免開火不能搭配需要加熱的食材 → **食材**被擋」，沒說烹調法本身被擋時怎麼辦；快煮難度（`cook_quick` 只准 ≤🟡，meal-content.js:280、:309-312）在規則 4 也沒提。
4. **規則 5 的主餐上限沒有時段（需 Opus）**。`resolveSavedMeal` 的簽名沒有 `slot`（PRD:419），但主餐上限依時段（下午茶、宵夜 1，其餘 2，PRD:114；`js/core/config.js:28-34`）。decisions #63 只定了「編輯模式用 2」（decisions:69），PRD:406 說語意驗證「不檢查時段」。若解析用 2、但選擇器在下午茶送出時 `manualSelectionProblem` 用 1，會出現「解析判定可用、送出被擋」。要不要讓 `resolveSavedMeal` 接受可選的 `slot`，規格沒定。
5. **入口 1 的「存成組合」跟 `estimate` 的互動（需使用者）**。11.2 入口 2 明寫含 `estimate` 不提供（PRD:413），入口 1 只寫「可勾存成組合」（PRD:412）；11.1 說 `estimate` 不允許。入口 1 有估算時是隱藏勾選、停用還是存時丟掉估算？沒寫。
6. **入口 1 的寫入原子性（需 Opus）**。「勾存成組合」的送出要寫 `daily_log` 與 `saved_meals` 兩個 store。PRD 沒說必須同一個 transaction，也沒說組合存失敗時紀錄是否仍保留。CHARTER:254（C1.5）只要求「需要全有全無的批次寫入用 transaction」。
7. **入口 2 的 UI 位置與範圍（需使用者）**。PRD:413 只說「已記錄的一餐可以存成組合」。我只確認 `js/ui/tab-today.js:48-58` 的 `loggedHtml` 顯示今天的已記錄餐點＋撤銷按鈕；「本週總覽」是否列出各餐（`tab-week.js`）我沒讀。可以存「過去日期的紀錄」嗎？補記過去的一餐（decisions #120）也會產生紀錄。
8. **自動名稱（需使用者）**。PRD:380「品項名稱以＋連接」。切片 7 的紀錄名稱格式是 `<品名> <量>`（含生／乾與克數，PRD:726、decisions #122），組合只存 `qty` 不存克數，且量會隨份數改變。組合的預設名稱要不要帶克數？入口 2 從紀錄存時，預設名稱用紀錄的 `name` 快照（含量）還是重新由 `ref` 組名稱？沒寫。
9. **保存順序與 `components` 順序（需 Opus）**。規則 4、5 依 `components` 順序擋後者，但組合從選擇器草稿來的順序跟 `buildDraftContent` 一致（食材→品項→估算→飲料，meal-content.js:532-543；D7 計畫第 1 節）；切片 7 的名稱順序是「餐型與食材｜品項 → 估算 → 單品 → 飲料」（PRD:726），元件順序是否把 `food` 放在飲料前，規格沒明說（D7 計畫 2.1 有提元件順序，我沒逐字確認）。
10. **「依今天剩餘預算算熱量」卡片的計算（需 Opus）**。PRD:429 要在卡片顯示內容與熱量，自煮部分依今天剩餘預算縮放；`contentTotals` 需要 `is_primary`＋`scale`，組合沒有 `scale`（PRD:392）。縮放倍數如何算（沿用推薦的主要槽位縮放？選擇器目前的 slider `primaryScale`，index.js:51）沒有規格；`food`／`product` 是固定熱量。在「剩餘預算」已經是負數時卡片顯示什麼也沒寫。
11. **tfdaLookup／料理／我的食材的參數在 C 時還不存在（需 Opus）**。PRD:402、:419 的簽名已經包含 `customDishes`、`customIngredients`、`tfdaLookup`；這三個來源是切片 8、9 才有。工作線 C 的 `dish` 是否現在就接受？PRD:265 寫「組合包含我的料理要等 B-4b」，但現有 `check-engine.js:922`（依 D7 計畫第 1 節）還用 `kind: "dish"` 當不合法測資，D7 計畫 8.2 說切片 9 才換。需決定：C 的 `validateSavedMeal` 是否拒絕 `dish`；`remapSavedRefs` 的簽名是先留佔位參數、還是等切片 8/9 再加（要避免簽名反覆改動；`resolveSavedMeal` 的 `profile` 參數也列在簽名中）。
12. **「備份 v3」的編號在順序上的穩定性（需 Opus）**。PRD:459 與 11.6 的升版規則是「新增 store、settings key」就 +1。依 decisions #121 順序 C 在切片 5（`favorite_refs` settings key）之前，所以 C＝v3、切片 5＝v4；若 Phase 2 `meal_plan` 或切片 5 的順序變動，fixture 檔名與 `DB_VERSION` 編號會對調（Phase 2 也會加 store，要同時升 `DB_VERSION`）。PRD:263、:251 說「跟 Phase 2 誰先做，後做的那個驗收要加…斷言」只涵蓋 `dish`，沒涵蓋 `saved_meals` 與 `meal_plan` 同時升 `DB_VERSION` 的處理。
13. **決定 `decisions #31` 的舊 store 名（已被 #32 取代，低風險）**。decisions:37 寫 `meal_combos`，decisions:38 改成 `saved_meals`；PRD 與章程都用 `saved_meals`。只是文件歷史，不需決定，但實作計畫引用時以 #32 為準。
14. **章程 C4.16 白名單的職責描述跟 PRD:657 不完全同步（低）**。C4.16 寫「五類職責」（CHARTER:308），PRD 12.7 的 C4.17 白名單寫七類，含「料理編輯器」「計畫顯示模組」（PRD:657、CHARTER:309）；C4.16 沒列「計畫顯示模組」。計畫顯示不讀 `saved_meals`，推測不用加，但沒寫明。
15. **規則 4 在 `archetype_id` 為 null 的 cook 組合（已有規格，注意即可）**。PRD:624 說 `dish` 的組合略過規則 4；`food` 只有單品的組合同理（PRD:425）。但「有 `ingredient` 且 `archetype_id` 存在」與「無 `ingredient` 的 `archetype_id: null`」要用什麼條件分流（看 `archetype_id`？看有沒有 `ingredient` 元件？），寫法不同，結果會不同（例如半套餐型加單品的組合，D7 說半套餐型加單品要被擋，PRD:725）。
16. **封存的組合與「全部列出」（需使用者，低）**。PRD:429 說列出「全部組合」，PRD:440 說刪除＝封存、可還原；封存的組合在選擇器是否不顯示？沒明寫（比照封存的我的品項 PRD:614 推測不顯示）。
17. **搜尋範圍**含「我的組合」（PRD:685），但搜尋的實作 `searchFoods`（`js/engine/foods.js:27`）與頂端搜尋現況是品項層級；組合搜尋命中後怎麼顯示（結果標「子分頁與大類」，PRD:685，組合沒有子分頁）沒寫。

---

## 6. 我沒查的範圍（不要當成已查證）

- `collab/opus-review-log/2026-09-28-my-combos.md` 與其他審核逐字檔（只靠 PRD／decisions 的摘要）。
- `docs/review/*` 除了 D7 計畫以外的計畫檔；D7 計畫我只讀第 1、2.3、8.1–8.3 節與目錄，沒讀第 3–7、8.4–8.6 節。
- PRD 第 1、2、4、5、6.1、6.2、8、9、10、12.1–12.5 的全文（只讀了指定的段落與 Grep 結果）；PRD:250 前的路線圖其他列只看了標題。
- CHARTER 只讀 B8、B9、C1.5、C4.8、C4.16、C4.17 與 Grep 命中；C1、C2 全文沒讀。
- `docs/日後討論.md` 只用 Grep 看命中行。
- `collab/to-opus.md` 只讀前 30 行與 Grep 命中。
- `js/ui/backup.js`、`js/ui/tab-week.js`、`js/ui/tab-profile.js`、`js/ui/meal-picker/product-tab.js`、`quick-add.js`、`estimate-card.js` 的內文沒讀；`js/ui/meal-picker/index.js` 只讀第 1–200、720–787 行與 Grep 命中；`js/ui/tab-foods.js` 只讀前 60 行。
- `js/engine/meal-content.js` 讀了 196–345、430–644；沒讀 1–195、345–430。`js/engine/foods.js`、`picker.js`、`recommend.js`、`today.js` 只看函式清單。
- `tools/check-engine.js` 只讀備份區 955–1030；`tools/smoke-browser.mjs`、`tools/mobile-walkthrough.mjs`、`tools/diff-recs.js` 只用 Grep 看備份相關行，沒讀內容；沒實際執行任何工具或測試。
- `data/*.json`、`css/`、`index.html`（只 Grep 命中行）。
- 第 2.1 節「fake-db 必須補函式」與第 2.4 節「`passesHardFilters` 對單一食材的不吃比不中」是我由程式閱讀推論，沒有實際執行驗證。
