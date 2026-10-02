# 日期切換與預約 設計草案審核（2026-10-02）

審核對象：`docs/review/2026-10-02-日期切換-設計草案.md`（commit `2edd963`）
依據：decisions #118、#119、#120、#129、#140、#141

## 第一輪：問題（逐字）

你是獨立審核者（資深前端架構＋營養師視角），專案是 D:\ok\lighten（Lighten2，個人減脂飲食追蹤 App，vanilla JS ES modules＋IndexedDB，沒有後端、單人使用）。一律用中文回答。**只審核、不要改任何檔案。**

請先讀：
1. `docs/review/2026-10-02-日期切換-設計草案.md`（審核對象，160 行左右）
2. `docs/decisions.md` 的 #118、#119、#120、#129、#140、#141
3. `docs/PRD.md` 第 1、3、5、6、9 節（計畫層 `meal_plan` 的原始規劃）、11.3（組合引用）
4. `docs/CHARTER.md` C1、C4.11、C4.12、C4.15、C4.16、備份與 store 規則
5. 程式：`js/engine/today.js`、`js/engine/budget.js`、`js/engine/tdee.js`（第 9 步）、`js/engine/meal-content.js`（`toSavedContent`、`resolveSavedMeal`、`savedMealDraft`、`contentTotals`、`buildLogEntry`）、`js/ui/tab-today.js`、`js/ui/meal-picker/index.js`（`openMealPicker`、`onMealSubmit`、`updateSummary`）、`js/data/db.js`（`daily_log` 驗證、`SETTING_KEYS`、備份版本、`withStores`）、`js/core/slots.js`
6. 工具：`tools/diff-recs.js`（快照範圍）、`tools/check-arch.js`

請回答：
A. 草案第 6 節 T1–T12 每一題的結論（同意／改成什麼，理由一兩句）。
B. 草案沒想到、但實作一定會撞到的依賴或資料路徑（從要動的函式往外查：誰讀 `daily_log`、誰用 `todayLogs`、`isCompleteLogDay` 的所有呼叫端、備份還原、快照錄製的 fake DB）。每項給檔名與函式。
C. 營養與行為面：「沒吃」記 0 大卡、預約當暫時紀錄扣預算、自煮預約照自選份量、昨天推薦一鍵「吃了」——有沒有會讓紀錄系統性失準、或違反 PRD 6.1「不評判」的地方？
D. 第 8 節切片拆法是否合理；每片的驗收（哪些快照必須逐字不變、哪些允許新增）。
E. 分級列出必改（M）、建議（S）、可略（N），每項一行。最後一句結論：「改完可以開工」或「要第二輪」。

（你的完整回答會被逐字存進 repo 的審核紀錄，請直接輸出完整內容，不要只給摘要。）

## 第一輪：回答（逐字，新開 Opus agent，2026-10-02）

# 日期切換與預約 設計草案 — 獨立審核（第一輪）

審核者：新開的 Opus agent（資深前端架構＋營養師視角）。只審、沒改檔。
讀過：草案全文；decisions #118–#120、#129、#140、#141；PRD 第 1、3、4、6、9 節與 11.3；CHARTER C1–C6；`engine/today.js`、`budget.js`、`tdee.js` 第 9 步、`matcher.js`、`meal-content.js`（toSavedContent／remapSavedRefs／resolveSavedMeal／savedMealDraft／contentTotals／buildLogEntry）、`ui/tab-today.js`、`ui/today-hero.js`、`ui/meal-picker/index.js`、`ui/saved-ctx.js`、`ui/calibration.js`、`ui/tab-week.js`、`ui/backup.js`、`data/db.js`、`core/slots.js`、`core/config.js`、`tools/diff-recs.js`、`tools/lib/fake-db.mjs`、`tools/check-arch.js`、`tools/check-engine.js` 的備份段落。

---

## A. T1–T12 的結論

**T1 計畫內容存法：同意用組合的儲存格式、顯示時重新解析，但要改三處，不能直接套 `toSavedContent`。**
理由：C4.4 本來就要求顯示時重跑硬性過濾，跟組合共用 `resolveSavedMeal` 才不會有兩套解析（C2）。我的品項改了、熱量跟著變，正是使用者要的（他是在修正資料）。代價（排完之後熱量會變）可以接受。不過現有函式直接拿來用會壞：
1. `toSavedContent` 遇到 `estimate` 會丟錯；`remapSavedRefs` 把不是 product／ingredient／food 的元件一律歸「已不提供」；`savedMealDraft` 會把 estimate 塞進 `items`。估算（喜宴、聚餐）偏偏是預約最主要的用途。所以要另寫 `toPlanContent`，或給 `toSavedContent` 加 `opts.allowEstimate`：estimate 存 `{ kind, name, size }`（快照可以從 size 重算，也可以照 PRD 原樣存快照，二選一，寫進 PRD 3）。remap、resolve、draft 三個函式都要放行 estimate，而且 estimate 不跑硬性過濾。
2. U4 要「照選的份量」，可是 `toSavedContent` 會把 `scale` 拿掉，`savedMealDraft` 又固定 `primaryScale: 1`。計畫格式要多一個欄位（建議主要槽位的 ingredient 保留 `scale`，或頂層放 `primary_scale`），resolve 跟 draft 都要帶過去。這等於改了 C4.10「計畫層不存縮放後的熱量」的字面，見 C 段與 M3。
3. 用油、調味：照 `keepImplicitOf(d)` 處理，改過才存，沒改存 null。跟草案一致。
另外，`dish`（切片 9）目前在 `toSavedContent` 也會丟錯，計畫格式先在 PRD 預留就好，現在不用做。

**T2 一個時段一筆預約：同意。**
一餐多個品項本來就裝在一個 content 裡；預約不像紀錄需要「又多吃了一點」。主餐上限照時段（`ctx.slot`＝那個時段）。

**T3 `last_shown_recs`：放 settings（dedicatedOnly），而且建議跟著備份走，不要特地排除。**
`exportAllData` 會把 settings 全部倒出來，要排除就得在匯出加特例，`validateBackup` 也還是要認得它。資料有 `date`，讀取時一律判斷「是不是昨天」，所以還原舊備份也不會顯示錯的天。內容要存「可以直接寫進 daily_log」的形狀：`{ name, content: contentFromRec(...)（含快照）, totals }`，按「吃了」時不用重算。寫法改成**每次渲染整個換掉當天的 slots**，不要逐時段覆寫，不然某時段變成 lowBudget 或已記錄時，舊的推薦會殘留。驗證函式淺層就好（date、slot 名、name 字串、totals.kcal 數字），寫入 daily_log 時 `validateDailyLog` 會再擋一次。check-arch 要補：這個字串只准出現在 db.js；讀取函式只准今日建議與昨天卡片的模組使用；engine、hero、calibration、recommend 一律不得讀（不然會長成隱性偏好，跟 C4.15 同理）。

**T4「沒吃」紀錄：方向同意，但草案寫的格式通不過現有驗證，副作用也要列清楚。**
- `validateDailyLog` 會擋三件事：`meal_type` 必須在 `MEAL_TYPES` 裡（null 不行）、`contentProblems` 要求 `components.length > 0`、`content.meal_type` 要等於 `entry.meal_type`。`skipped` 要在 `contentProblems` 前面另開分支，其他 source 照舊至少一個元件（check-engine 現有「空元件被擋」的斷言要保留）。`LOG_SOURCES`（core/config.js）要加 `skipped`。
- 草案寫 `partial false`，型別錯了，必須是 `partial: []`（驗證要求陣列）。
- `isCompleteLogDay`、tdee 第 9 步、近 7 天平均、`summarizeWeek`、`checkHardConstraints` 的纖維週平均：有紀錄就算完整，0 會拉低那天的蛋白質與纖維合計。**真的沒吃就應該拉低**，這樣才是實際攝取，纖維缺口變大、推薦往高纖補，方向正確。
- 跟「基本資料關掉的時段」語意重疊：關掉＝平常就不吃，不算進完整日；沒吃＝這一次沒吃。**關掉的時段不要提供「沒吃」**（`isCompleteLogDay` 本來就不看那個時段，記了也只是雜訊），預約「這餐不吃」也一樣。
- 顯示：`loggedHtml` 現在會寫「已記錄：沒吃（約 0 kcal）」，要改成「這餐沒吃」加撤銷。`canSaveLog` 已經會擋空元件。
- tdee 第 9 步的窗口是 `d <= today`（含今天）。今天按了「這餐不吃」，今天可能提早變成完整日，跟「記完所有餐」是同一個語意，可以接受，寫進 PRD 就好。
- 真正的風險是**誤按「沒吃」造成少報**，見 C 段。

**T5 今天的預約被擋：同意「不扣、改推薦」，並補一條規則：只要有任何元件被擋或已不提供，整筆預約都視為失效。**
不要只拿可用的子集合去扣預算或「記下」，那等於默默改掉使用者排的那一餐（C4.4 不默默刪）。卡片上方一行中性文字（用 `savedMealUnavailableLine`），加「改」「取消預約」，下面照常推薦。預約「不吃」沒有被擋的問題。昨天卡片遇到失效的預約時，不提供「吃了」，只給「改／S／M／L／沒吃」。

**T6 預約當暫時紀錄：同意，而且一定要統一用一個 helper。**
建議兩層：
- **ui 層一個函式**（新模組，例如 `ui/today-plans.js`），把今天、沒有紀錄的時段的預約解析成暫時紀錄 `{ log_date: today, slot, content, totals, planned: true }`，解析失敗的不放進來。今日建議與選擇器（log 模式算 `slotNutrientShare`）都呼叫它，不要各解析一次。
- **engine 層** `effectiveTodayLogs(todayLogs, todayPlans)`（放 `engine/today.js` 或 `budget.js`），planToday 內部用它去餵 `recalcTodayBudget`、`skipSlots`、`loggedContents`；`checkHardConstraints` 則餵 `weekLogs.concat(todayPlans)`。纖維週平均只看 `d < today`，所以自動不含預約，不用另外寫判斷。
- 選擇器要注意：在**有預約的時段本身**打開（今天的「改」），算份額時要排除這個時段自己的預約，不然 `slotNutrientShare` 看到這個時段已處理，就回 0。
- engine 的 `today.js` 在 check-arch RECOMMEND_FILES 裡，不能出現 `"food"`、`"dish"` 字面量。暫時紀錄已經帶 totals，engine 不用看元件種類。

**T7 S／M／L 依時段分組：同意，建議三組，常數放 `core/config.js`。**
早餐 300／500／800、午晚餐 400／700／1200、下午茶宵夜 150／300／500。理由：回想式估算最重要的是 M 落在「典型一餐」。台式早餐 M 寫 700 會系統性高估約 200 kcal，近 7 天平均跟著偏高，容易誤出 `intake_high`。選擇器外食分頁的估算卡（`ESTIMATE_SIZE_KCAL`）這次先不動（動了 picker 快照會變），列日後統一；但 estimate 元件的 `name` 要寫明時段組（例如「估算（中）」對到哪一組），以免同一個字在兩處代表不同熱量。

**T8 過期計畫清理：讀取一律用日期範圍過濾，清理只是整理儲存空間。**
`getMealPlans({ start, end })` 用主鍵範圍查（key 是 `YYYY-MM-DD|slot`，`IDBKeyRange.bound(start, end + "|￿")`）。畫面永遠只讀「昨天到今天+6」，有沒有清掉都不影響顯示。清理由 ui 在今日建議初始化時呼叫 `purgeOldMealPlans(beforeDate)`，日期由呼叫端從 clock 傳入（`upperBound(yesterday, true)`，剛好不含 `昨天|…`），可以重複執行。跨日要處理：選中的日期存成「相對今天的位移」，每次渲染都重算 `todayStr()`，選中的日期早於今天就回到今天；建議加 `visibilitychange` 時重畫（手機背景放過午夜是最常見的情況）。選擇器要在**打開時**記住 `m.date`，送出時寫那一天，不要在送出時才呼叫 `todayStr()`（23:59 打開、00:01 送出會寫到另一天）。測法：fake-env `setNow` 設 23:59 渲染，再設隔天 00:01 渲染或送出，斷言日期列、昨天卡片、寫入日期。

**T9 快照：見 D 段。** 結論是「沒有預約」不足以保證逐字不變，昨天卡片與 `last_shown_recs` 的寫入會動到現有情境。

**T10 `picker_last_meal_type`：同意，只在 log 模式（今天記錄）更新。**
預約模式打開時的預設分頁用 PRD 第 4 節早就設計好的 `resolveDefaultMealType({ planned: plan?.meal_type, ... })`，這是 Phase 2 一直保留的參數。

**T11 備份 v6：同意。**
`migrateBackup` 會自動幫舊檔補空的 `meal_plan`，不用寫遷移步驟。v6 要做的事：
- 用 smoke 真的匯出凍結 `backup-v6.json`，至少含一筆預約、一筆預約不吃、一筆 skipped 紀錄、`last_shown_recs`。
- check-engine 第 2159 行斷言 `BACKUP_SCHEMA_VERSION === 5`，要改。
- `ui/backup.js` 的 `PREVIEW_STORES` 與「匯出之後有新增」的清單是寫死的，要決定 `meal_plan` 要不要列進還原預覽（建議列筆數）。
- `summarizeBackup` 的 last_date 讀 `log_date || created_at`，預約的日期欄位要能被它讀到，不然只會顯示建立日期。
- DB_VERSION 4 一上線就不能退版（decisions #125）。smoke 要測「v3 的舊資料庫升到 v4」，不能只測從空的開。

**T12 彙總卡：要另外列，而且主數字的意義要先定好。** 建議：
- 主數字「接下來幾餐的建議熱量」維持＝目標 − 已記錄（不扣預約）。沒有預約時跟現在逐字相同；有預約時下面加一行中性的「已排：晚餐 約 700 kcal」。
- `allLogged` 只看真的紀錄（預約不是吃過）。
- 「目前這幾餐建議合計」那一行的差額：卡片合計要加上預約的熱量再跟主數字比，不然每次都會多出一個 −700 的假差額。
- 營養素明細與蛋白質／纖維進度只算紀錄。
- 所以 `renderHero` 要拿到兩個預算（不含預約、含預約），不能直接用 planToday 回傳的那一個 `remainingBudget`。

---

## B. 草案沒寫到、實作一定會撞到的依賴與資料路徑

1. **`data/db.js` `validateDailyLog`** 同時被 `validateBackup`（還原）與 `tools/lib/fake-db.mjs`（每次 addDailyLog）呼叫。草案的「不能是未來、補記不能早於 7 天前」**絕對不能放進 `validateDailyLog`**：還原一年前的備份會整包被拒，diff-recs 的 `history()` 舊紀錄也可能跟著出問題。要放在 `addDailyLog(entry, { today })` 這個寫入函式裡，日期由呼叫端傳入；fake-db 的 `addDailyLog` 要做一樣的檢查。
2. **`db.js` `contentProblems` 與 `core/config.js` `LOG_SOURCES`、`MEAL_TYPES`**：skipped 的分支（見 T4）。
3. **`db.js` 新 store 的 key 名稱**：`validateBackup` 對 weight_log 以外的 store 一律檢查 `rec.id`，`exportAllData` 一律依 `id` 排序。草案用 `key` 當 keyPath，會被判成「沒有 id」，匯出排序也會亂。**改成 keyPath `id`，值＝`"2026-10-04|lunch"`**，就不用動那三個地方。`validateBackup` 的驗證分派要加 `meal_plan`（不加會丟「沒有驗證器」）；`BACKUP_SECTIONS`、`BACKUP_LABELS`、`STORE`、`upgrade()` 第 4 段都要補。
4. **`db.js` `getByDate`**：它只認 keyPath 或 `log_date` 索引，`meal_plan` 不能直接套，要另寫主鍵範圍查詢（見 T8）。
5. **`tools/lib/fake-db.mjs`**：它是靠 module hook 取代 db.js 的。今日建議與選擇器只要多 import 一個函式（`getMealPlans`、`setMealPlan`、`deleteMealPlan`、`purgeOldMealPlans`、`getLastShownRecs`、`setLastShownRecs`、`setMealPlanWithSavedMeal`），fake-db 沒有 export 就會讓 diff-recs 整個載入失敗。fake-db 要同步實作，並用真的 `validateMealPlan` 驗證（跟現在的做法一樣）。
6. **fake-db 的 `writes` 清單**：`setLastShownRecs` 跟開 App 時的清理，如果寫進 `S().writes`，每個 today 情境的 `recs …/writeN` 都會多一行。要規定：清理不進 writes；`setLastShownRecs` 一定在 `markRecipesShown` **之後**呼叫（這樣只是新增 `write1`，不會讓 `write0` 位移），或者另外 emit 到 `plan` 快照檔。
7. **`ui/tab-today.js` `renderRecs`**：程式**先判斷時段關閉，才判斷有沒有紀錄**。U2（關掉的時段也能排、到那天要顯示），以及補記或 skipped 寫到關掉時段的情況，都會被蓋成「已設定不需要這個時段的建議」。順序要改成「紀錄 → 預約 → 關閉 → 推薦」。
8. **`tab-today.js` 的模組狀態**：`currentRecs`、`lastPlan`、`lastLogsBySlot`、`saveForm`、`findTodayLog` 都假設只有今天。切到未來日子時，不能呼叫 `buildRecommendation`、`markRecipesShown`、`renderHero`；要另寫 `renderFutureDay(date)`，`currentRecs` 也要保留今天的那一份（`getCurrentRecs` 與 diff-recs 的 `A.currentRecs()` 都在用）。
9. **`ui/today-hero.js` `renderHero`**：見 T12（`allLogged`、`recsKcalTotal` 差額、`todayIntake`）。
10. **`ui/meal-picker/index.js`**：
    - `openMealPicker` 寫死 `todayStr()` 與 `getDailyLogs(today)`；`onMealSubmit` 寫死 `date: todayStr()` 與 `source: "manual"`。
    - `updateSummary` 用 `m.slot === null` 當「不算配額」的訊號（那是編輯組合模式）。預約、補記模式**有時段但不算配額**，要另外用 `m.mode` 判斷，不能沿用 slot 等於 null。
    - 估算卡用 `!m.editing` 控制只在外食分頁出現，預約模式必須顯示（排喜宴）。
    - 標題與送出鍵只在打開時寫（快照的 domNN 靠這個不位移），新文字「排進 10/4 午餐」也要只在打開時寫。
    - 預約模式勾「存成組合」：需要新的原子寫入 `setMealPlanWithSavedMeal`（比照 `addDailyLogWithSavedMeal`，decisions #125 要求全有全無）。
    - 「改」今天的預約時，`slotNutrientShare` 要排除這個時段自己的預約（T6）。
    - `rememberMealType` 只在 log 模式呼叫。
    - 補記模式不顯示缺口與配額（那是今天的數字）。
11. **`engine/meal-content.js`**：`toSavedContent`（estimate 會丟錯、scale 被拿掉）、`remapSavedRefs`（estimate 被丟掉）、`resolveSavedMeal`（estimate 會落到 product 分支，`p` 是 undefined 就壞；skip 預約 `components: []` 時 `available` 是空的）、`savedMealDraft`（estimate 塞錯位置、`primaryScale: 1`）、`savedMealProblem`（空元件會回「沒有可以存的品項」）。預約「不吃」要在解析之前就分流，不要送進 resolve。
12. **章程 C4.16、C4.17 白名單（`tools/check-arch.js`）**：解析預約要帶 `customIngredients`（M6 fail-closed，`resolveSavedMeal` 遇到 `cing_` 會丟錯），要經 `saved-ctx.js` 取得。預選編輯與計畫顯示模組要用新檔案（例如 `ui/today-plans.js`），加進 `SAVED_MEAL_READER_FILES`（只有它真的讀組合清單時才需要）；`tab-today.js` 本身照規定不得直接 import 讀取函式。另外要新增一條：**`getMealPlans` 只准今日建議的計畫模組、選擇器、備份使用**，calibration、tab-week、hero、engine 一律不得讀（把 C4.10「只有 daily_log 算進統計」機械化）。
13. **`ui/calibration.js` `ensureDailyCalibration`**：每天只評估一次並快取。今天在昨天卡片補的紀錄要到明天才會進第 9 步。可以接受（只是延一天），寫進 PRD。
14. **`ui/tab-week.js`**：週總覽會讀 `weekEnd`（含未來）的 daily_log，加了 meal_plan 也不受影響，但絕不能讀預約。補記入口要加在這裡。skipped 紀錄會讓 `nComplete` 變多，文案「當天所有開啟時段都有記錄才算」照樣成立。
15. **diff-recs 的 `history()` 測試資料**：`M/no-history`、`M/two-complete-days`（skip 含第 1 天＝昨天），還有所有沒帶 history 的情境，昨天都不完整。切片 3 一做，這些情境的 `ui …/domNN` 都會多出昨天卡片；草案寫的「沒有預約時逐字不變」不成立。見 D 段。
16. **`check-arch` BANNED_WORDS**：建議補「漏記」「忘了記」「沒記到」「還沒記」，昨天卡片最容易冒出這些字（6.1）。
17. **PRD 第 9 節**仍然寫「今天已過的時段不能預約，時段結束時間檢查沿用」。v2 沒有餐時，要刪掉。C2 表格的「時段結束時間」那格也要一起處理（`core/slots.js` 裡已經沒有這個東西）。

---

## C. 營養與行為面

1. **「沒吃」會讓 #140 的安全論證出現破口。** #140 的理由是「少記只會讓校正不動」，前提是沒記的日子不完整、不會進第 9 步。「沒吃」卻會把不完整的日子變成**完整、而且偏低**的日子：如果其實吃了東西（隨手吃的點心、忘了），誤按「沒吃」就是系統性少報，第 9 步「平均 ≤ 目標×1.10」更容易通過，目標被往下修，正好是防棘輪要防的那條路。處理：
   - （必改）每一列除了「沒吃」，還要清楚提供「不確定／跳過這一列」（不寫任何紀錄）。草案只有整張卡的「先不用」，答了幾列之後剩下的就沒有中性的出口。
   - （必改）按鈕文字寫「這餐沒吃」，不要只寫「沒吃」；跟「吃了」之間要有視覺距離，不要相鄰、同色、同大小。
   - （建議，C3 範圍）第 9 步可以考慮把「熱量 < 目標 × 0.5」的日子視為不完整（極低日在營養流行病學上是典型的少報訊號）。這是改校正演算法，要另外審，可以先記為日後討論。
2. **「昨天推薦一鍵吃了」有錨定效應。** 推薦本來就是照當天預算排的，隔天把它放在第一個選項，回想不確定時人會傾向「差不多就是那個」，結果又是「完整而且剛好達標」，跟 #140 否決的自動當吃過是同一種偏差，只是多了一次點擊。處理：（建議）推薦內容要寫具體品名與熱量（「雞胸便當＋無糖豆漿 約 620 kcal｜吃了這個」）；S／M／L 跟它同一層級、同樣大小，不要把推薦做成主要按鈕。
3. **預約當暫時紀錄扣預算，會讓人「為大餐存熱量」。** 晚上預約 L 1200（喜宴），目標 1800，早午餐只剩約 600，卡片會出現「這個時段的配額已經不多了」。這句話在早上出現，等於提示使用者少吃或不吃早餐，是節食心態裡典型的 banking 行為。PRD 9 確實鼓勵「先排進來、其他餐自動調整」，但沒想到「預先」這一層：事後調整跟事前節食的效果不一樣。處理：（建議，切片 2 前定）時段配額因**預約**而低於門檻時，換一句中性文字，例如「晚上的聚餐已經排進來了，這餐照平常吃就好」，不要用「配額已經不多了」；要不要給未預約的時段一個下限（例如平常份額的 50%）屬於預算分配演算法，要走 C3。
4. **自煮預約照自選份量（U4）**：營養上合理，排的就是要煮的量。但草案內部互相矛盾：3.3 寫「未來日子自煮用名目份量（scale 1）」，U4 寫「到當天照選的份量」，同一筆預約在未來跟當天會顯示兩個不同的熱量。**必須統一成選的份量**：使用者選的倍數不是「依未來預算縮放」，不違反 6.2 的本意；6.2 那句要改寫成「不依預算推算份量，自煮照使用者選的份量，沒選是 1 倍」。C4.10 的字面也要改成「計畫層不存依預算縮放的倍數或熱量；使用者自己選的主食倍數照存」，屬於 C4 修改，本審核涵蓋，但章程要同一批改。
5. **「沒吃」記 0 大卡，在 6.1 層面沒問題**：它是中性事實，沒有評價。不過「昨天的餐」卡片**每天都會出現**（只要昨天沒記完），長期看就是天天催，違反 #140④「不催」的精神。建議：（建議）卡片預設收合成一行，例如「昨天的餐（2 餐）」，點開才展開；不要用數字或顏色暗示「缺」；不提供也不統計「連續幾天有補」。
6. **預約「不吃」（U3）跟今天「這餐不吃」（U1）的配額重分配**：其他餐變多，總量維持目標，這是對的（避免變成過度限制）。文案不要寫「省下」「多出」這種字。
7. **S／M／L 的蛋白質與纖維是 null**：那天的蛋白質與纖維會被 `sumLogTotals` 變成 null，不算進週平均（`proteinDays` 會少一天）。這是正確的 null 傳染，不是失準；週總覽已經會寫「N 天有資料」。

---

## D. 切片拆法與驗收

整體順序合理，但要調整：

**切片 0（文件，動程式前）**：A1／C6.6 規定先改 PRD 再改程式，草案把文件放在第 4 片。PRD 1、3、5.1、6.1、6.2、7、9、11.3，CHARTER C4.10、C4.15、C4.16、C4.17、C1.5（清單 store 已經有 meal_plan），都要在切片 1 之前定稿；只有「使用說明」可以留到最後交 Sonnet。

**切片 1：db＋engine（沒有畫面）**
- 內容：meal_plan store（keyPath id）、`validateMealPlan`、skipped 驗證、`addDailyLog(entry, { today })` 的日期檢查、`last_shown_recs` key 與驗證、備份 v6 與 fixture、fake-db 同步；engine 的 `effectiveTodayLogs`、預約解析（estimate、scale、skip 三條分支）；ui 層的 `loadTodayPlans` 可以先寫但不接上畫面。
- 必須逐字不變：`recs`、`picker`、`ui`、`tdee`、`pool`、`matrix` 全部快照。這片沒有任何畫面改動，一行都不能變。
- 允許新增：新快照檔 `tools/snapshots/plan.txt`，至少包含：預約扣預算（商品、估算 L、自煮 scale 1.5、預約不吃、關掉時段的預約）下的 remainingBudget、skip、hardConstraints、五個時段 normRec；預約被擋或已不提供 → 不扣；`effectiveTodayLogs` 遇到同時段已有紀錄 → 預約不進來；skipped 對 `isCompleteLogDay`、`summarizeWeek`、`computeRecentAvgVsTarget`、tdee 第 9 步的影響。check-engine 新斷言：skipped 的合法與不合法格式、非 skipped 空元件照樣被擋、`validateBackup` 不檢查日期範圍（還原舊紀錄）、v1–v6 fixture 都能還原、v3→v4 升級。

**切片 2：日期列＋未來六天＋今天的預約卡片＋選擇器預約模式＋今天「這餐不吃」（U1）＋彙總卡「已排」那一行**
- U1 從切片 3 搬過來：它在今天的卡片上，跟預約卡片同一批 DOM，而且只需要切片 1 的 skipped 寫入。
- 必須逐字不變：`recs` 全部（沒有預約的情境）；`picker` 全部（log 模式）；`tdee`。
- `ui` 快照：日期列與「這餐不吃」按鈕一定會讓 today 情境的 DOM 變。規定兩點：新元素的 DOM 寫入排在既有寫入**之後**，所以 diff 只能是**新增的行**，不能讓舊行位移或改字；commit 說明逐條列出新增的行。
- 允許新增：`plan/*` 的 UI 情境（未來日子頂端合計、預約卡片、被擋的預約、預約模式選擇器的標題、送出鍵、沒有缺口那一行、預約模式寫入 `setMealPlan` 與 `setMealPlanWithSavedMeal`、lastPicked 不變），以及跨日測試（23:59 → 00:01）。
- 使用者手機測一次（給行號）。

**切片 3：昨天的餐＋補記＋`last_shown_recs` 寫入＋清理過期預約**
- 必須逐字不變：`picker`、`tdee`；`recs` 各情境的 targets、remainingBudget、hardConstraints、skip、五個時段。
- 允許變更、要逐條說明：
  - `recs …/write1`：新增 `setLastShownRecs`，前提是排在 `markRecipesShown` 之後。
  - `ui`：昨天不完整的情境（`M/no-history`、`M/two-complete-days`、沒帶 history 的 P 系列 base），會多出昨天卡片的 DOM 行，同樣只准新增在後面。
  - 也可以另一個做法：昨天卡片放在獨立容器，diff-recs 把它的 DOM 另外 emit 到 `plan` 檔，`ui` 檔就能逐字不變（建議用這個做法，差異報告比較乾淨）。
- 允許新增：昨天卡片各列組合（有預約、預約失效、有推薦、沒推薦、關掉的時段不列、全部已記錄不出現）；吃了／S／M／L／這餐沒吃／跳過的寫入（source、log_date＝昨天）；補記模式寫入那一天、7 天邊界被擋；`last_shown_recs` 整份覆寫與日期判斷。
- 使用者手機測一次。

**切片 4**：使用說明（Sonnet），Opus 驗收。

每一片照舊：check-data／engine／arch、diff-recs、smoke、mobile-walkthrough 逐張看截圖（含 360 寬），手機腳本給行號。

---

## E. 分級清單

**必改（M）**
- M1 skipped 紀錄：`partial: []`（不是 false）；`validateDailyLog`／`contentProblems` 要開 skipped 分支（meal_type null、components 空、totals 全 0），其他 source 照舊；`LOG_SOURCES` 加 `skipped`。
- M2 日期範圍檢查放在 `addDailyLog(entry, { today })`，不能放進 `validateDailyLog`（還原與 fake-db 都會被波及）。
- M3 U4 與草案 3.3 互相矛盾：統一成「選的份量」，計畫格式多存主食倍數；同一批改寫 PRD 3 的表、6.2 的那句與 C4.10 字面。
- M4 計畫格式要能存估算：`toSavedContent`、`remapSavedRefs`、`resolveSavedMeal`、`savedMealDraft` 都要能處理 estimate（另寫 `toPlanContent` 或加參數）；預約「不吃」在解析前分流。
- M5 meal_plan 用 keyPath `id`（＝`date|slot`），不然 `validateBackup`、`exportAllData` 排序都會出錯；`BACKUP_SECTIONS`、`BACKUP_LABELS`、驗證分派、`upgrade` v4、`ui/backup.js` 的 PREVIEW 清單都要補。
- M6 `renderRecs` 順序改成「紀錄 → 預約 → 關閉 → 推薦」，不然 U2 與關掉時段的紀錄不會顯示。
- M7 彙總卡：主數字維持「目標 − 已記錄」、加「已排」那一行、`allLogged` 只看紀錄、卡片合計差額要加預約；`renderHero` 要拿兩個預算。
- M8 選擇器：`m.mode` 與 `m.date` 在打開時決定；預約、補記模式不用 `slot === null` 判斷；預約模式顯示估算卡；勾「存成組合」時要有原子寫入 `setMealPlanWithSavedMeal`；「改」今天的預約時份額要排除這個時段自己的預約。
- M9 預約解析統一一份（ui 的 `loadTodayPlans`＋engine 的 `effectiveTodayLogs`），今日建議與選擇器共用；部分元件失效＝整筆失效（不扣、改推薦、寫原因）。
- M10 fake-db 同步所有新的 db 函式；`setLastShownRecs` 排在 `markRecipesShown` 之後，清理不進 writes；切片的快照驗收照 D 段，不再寫「沒有預約就逐字不變」。
- M11 昨天卡片每一列要有不寫紀錄的「跳過」，「這餐沒吃」要跟「吃了」在視覺上分開（防止誤按造成少報、破壞第 9 步）。
- M12 PRD 與章程（含 C4.10、C4.16、C4.17、PRD 9 的「時段結束時間」）在切片 1 之前改完（A1）。
- M13 關掉的時段不提供「沒吃」與預約「不吃」。

**建議（S）**
- S1 `last_shown_recs`：存可以直接記錄的形狀（content 含快照＋totals），每次渲染整份覆寫當天；跟著備份走；check-arch 限制誰能讀。
- S2 新增 check-arch 規則：`getMealPlans` 的讀取白名單（calibration、week、hero、engine 不得讀）。
- S3 S／M／L 依時段分三組（早餐 300／500／800、正餐 400／700／1200、點心 150／300／500）；選擇器的估算卡日後再統一。
- S4 時段配額因預約而變低時換中性文字，「下限」另走 C3。
- S5 昨天卡片預設收合成一行；BANNED_WORDS 補「漏記」「忘了記」「沒記到」「還沒記」。
- S6 昨天推薦的「吃了這個」寫品名與熱量，跟 S／M／L 同一層級。
- S7 加 `visibilitychange` 重畫，處理過午夜；選中的日期用位移保存。
- S8 昨天卡片的 DOM 放獨立容器，emit 到 `plan` 快照，讓 `ui` 快照逐字不變。
- S9 smoke 測 v3→v4 的真實升級，並凍結 backup-v6.json（含預約、預約不吃、skipped、last_shown_recs）。
- S10 第 9 步「極低熱量日不算完整」列入日後討論（C3）。

**可略（N）**
- N1 `ensureDailyCalibration` 不會在補記之後當天重算，延一天，PRD 寫明就好。
- N2 `dish` 元件在計畫格式先在 PRD 預留，切片 9 再做。
- N3 `summarizeBackup` 讓預約顯示預約日期而不是建立日期（只影響還原預覽的文字）。
- N4 昨天「吃了」用 `rec_accepted`、S／M／L 用 `backfill`、預約用 `from_plan`：可以照草案，不必再多一個 source。

結論：**要第二輪**。M1–M13 改進草案（特別是 M3、M4、M5、M10、M11）之後，請新的 Opus agent 再看一次修訂版與 PRD／章程的改動稿，通過才開工切片 1。
