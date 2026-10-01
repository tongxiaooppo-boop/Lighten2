# 工作線 C「我的組合」實作計畫第一版：獨立審核（2026-10-01）

審核對象：`docs/review/2026-10-01-C-實作計畫.md` 第一版。審核者：獨立 Opus agent（general-purpose，只讀）。以下是送出的問題與審核者回報，逐字保存。處理對照寫在計畫第 8 節。

## 問題（逐字）

你是 Lighten2 專案（D:\ok\lighten，純前端 vanilla JS＋IndexedDB 的個人減脂飲食追蹤 App）的獨立審核者。請用中文回答。不要修改任何檔案，只讀與回報。

要審的是「工作線 C 我的組合」的實作計畫第一版：docs/review/2026-10-01-C-實作計畫.md。背景與規格：docs/PRD.md 第 3、11（11.1–11.6）、12.6、13.2、13.4 節，docs/decisions.md（#31、#32、#54、#63、#92、#118–#123），docs/CHARTER.md（C1、C1.5、C2、C4.8、C4.11、C4.14、C4.16、C4.17），調研 collab/proofs/2026-10-01-workline-c-survey.md（第 5 節 17 條規格空白；注意它寫於切片 7 實作前，切片 7 現在已實作完成）。前一份同類計畫與審核可參考格式：docs/review/2026-10-01-D7-實作計畫.md 第 8 節、collab/opus-review-log/2026-10-01-d7-plan-review.md。

請實際打開程式核對計畫第 1 節的現況描述與第 2 節要動的地方，至少：js/data/db.js、js/engine/meal-content.js、js/engine/filters.js、js/core/config.js、js/ui/meal-picker/index.js、cook-tab.js、food-step.js、js/ui/tab-today.js、js/ui/tab-foods.js、js/ui/backup.js、tools/check-arch.js、tools/lib/fake-db.mjs、tools/lib/adapter-v2.js、tools/diff-recs.js（snapPicker 與 takeDom 的 domNN 編號機制）、tools/check-engine.js 備份段。

請回報：
1. 一定要改（會造成錯誤、違反章程或 PRD、快照會被打壞、資料遺失風險）——每條附檔案:行號與具體改法。
2. 建議改。
3. 第 3 節 Q1–Q10 逐題：同意預設或建議另一個，一兩句理由；Q6、Q7 若涉及使用者決定，請寫成給使用者看的白話選項＋建議。
4. 漏掉的依賴、呼叫端、測試或驗收項目（特別是：選擇器 render 路徑加組合列對 diff-recs domNN 的影響、openMealPicker 參數改動的所有呼叫端、DB_VERSION 升級在已有使用者資料的手機上的行為、fake-db 要補的函式、walkthrough 現有第 5 節備份測試的期望值）。
5. 結論：「可以開工」「改完可以開工」或「要重寫」。

使用者已決定的事（不要再推翻）：管理區塊在「我的食物」頁面最上方收合；入口 2 只在今日建議今天已記錄的卡片；預設名稱只寫品名不寫量；日期切換的預選引用移出工作線 C；入口 1 有估算時不能勾；封存的組合不出現在選擇器；搜尋也搜組合名稱。

## 審核者回報（逐字）

# 工作線 C「我的組合」實作計畫第一版：獨立審核

計畫第 1 節講的現況，大部分跟程式對得上。核對過的有：`DB_VERSION`、`STORE`、`contentProblems`、`COMPONENT_KINDS`、`hardFilterReason`、check-arch 的白名單、`fake-db` 缺組合函式，還有 `domNN` 的編號機制。

但第 4、5 節寫的「既有快照逐字不變、每個 commit hook 全過」**做不到**，還有幾個會直接出錯的地方。

## 1. 一定要改

**M1. 入口 2 一定會改到一行既有的 ui 快照，計畫的驗收條件不成立**
- `js/ui/tab-today.js:48-58` 的 `loggedHtml` 已經被錄進 ui 快照，有 21 行含 `rec-undo-btn`。
- 其中 20 行來自 `todayScenario`。這些測資經 `adapter-v2.js` 的 `toLog` 轉成估算元件，照計畫「含估算不顯示」所以不變。
- 但 `flow/log-breakfast/dom01`（`tools/snapshots/ui.txt:931`）是記錄推薦後的那一餐（`rec_accepted`，不含估算），加了「存成組合」鈕後這一行一定會變。
- 改法：
  - 第 4 節改寫成「`ui` 只允許這一行刻意改變，其他逐字不變」。
  - commit 3 就要跑 `diff-recs --update`，並在 commit 訊息說明。
  - 另外加一個今天有非估算紀錄的 today 情境（例如自己選送出後重建），讓入口 2 的按鈕有正面的快照。

**M2. commit 2、3 的 hook 會失敗（`tools/hooks/pre-commit` 每次都跑 check-engine 與 diff-recs）**
1. `tools/check-engine.js:1711` 有 `check(db.BACKUP_SCHEMA_VERSION === 2, "切片 7 不升備份版本")`，備份版本升到 v3 就失敗。
2. `tools/check-engine.js:1717` 斷言 `migrateBackup(fv)` 不改 v2 檔。升到 v3 後一定會補 `saved_meals` 區塊、改 `schema_version`，這條也會失敗。
   - 計畫只提到第 1030 行「不認得的區塊」那條。
   - 改法：1711 改成「單品紀錄不需要升版」的寫法或刪掉；1717 改成比對升級後只多了 `saved_meals: []` 與 `manifest.saved_meals: 0`。這兩條都放進 commit 2。
3. `fake-db.mjs`、`adapter-v2.js` 排在 commit 4，但 commit 3 的 `meal-picker/index.js`、`tab-today.js` 已經 import `listSavedMeals`、`addSavedMeal`、`addDailyLogWithSavedMeal`、`updateSavedMeal`。ESM 連結時找不到匯出就會失敗，diff-recs 跑不起來。
   - 改法：fake-db 與 adapter 的「讓它載得起來」那部分移到 commit 3（新情境可以留在 commit 4）。

**M3. 我的品項轉成品項形狀後沒有 `copied_from`，規則 2 做不了**
- `js/data/catalog.js:94-107` 的 `fromCustomFood` 不帶 `copied_from`，而 engine 不能 import data（章程 C1）。
- 第 9 項的 `ctx.customFoods` 沒寫清楚是原始紀錄還是轉好的品項：規則 2 要原始紀錄的 `copied_from` 和 `archived`，帶入草稿又要轉好的品項物件。
- 改法擇一：
  - `fromCustomFood` 加 `copied_from: orNull(f.copied_from)`。商品快照只取固定欄位，picker 快照不受影響。
  - 或 `ctx` 同時傳 `customRecords`（原始紀錄，含已封存的，給 `dropped` 取名稱用）與 `customs`（轉好的品項）。

**M4. 編輯模式（沒有時段）會走到很多依時段的路徑，計畫只處理了主餐上限與清單**
`m.slot = null` 會影響下面這些地方：
- `cook-tab.js:75`：餐型依 `valid_slots.indexOf(slot)` 過濾，`null` 時一個餐型都不顯示。
- `index.js:146` `resolveDefaultMealType`；`index.js:155` 標題的時段文字會顯示成 "null"。
- `index.js:600` `slotNutrientShare(..., null)`：缺口與「這個時段配額」是沒有意義的數字。
- `index.js:265` 快速新增：`quickAddDefaults(null)` 產生 `valid_slots: [null]`，`validateCustomFood` 會擋，存不進去。
- `engine/picker.js:178` `placeNewCustom`：`fitsSlot(item, null)` 是 false，複製、補填後的訊息會寫「適合的時段不含null」。
- `index.js:257`：外食分頁的估算卡片照樣出現。加了估算再「存回組合」，`toSavedContent` 會丟錯。

改法：在第 20 項逐條寫明：
- 餐型全部列出；
- 不算缺口；
- 隱藏估算卡片與快速新增；
- `fitsSlot` 在 `slot === null` 時視為符合（跟 `partitionAllChannels` 一致）；
- 標題改寫 `#meal-picker-title` 時要保留或還原 `#meal-picker-slot-label` 這個 span（寫 textContent 會把它清掉，下次一般打開就找不到）。

**M5. 帶入時，不在目前時段的餐型看不到、取消不了**
- 跟 M4 同一個原因（`cook-tab.js:75`）：下午茶帶入一個午餐才有的餐型，草稿裡有這個餐型，但餐型按鈕不在畫面上，使用者取消不了。
- PRD 11.3 第 6 點「帶入的元件不受時段限制」也適用在這裡。
- 改法：`cookTabHtml` 一律列出草稿裡已選的那個餐型。

**M6. 帶入的商品不在目標分頁清單裡時會被默默丟掉**
- `index.js:205` `selectedItems` 只從 `passItemsOf(tabs[tab])` 取。所以 uid 不在那個分頁清單裡，就不算選取。
- 計畫第 17 項只處理 `valid_slots` 的情況。但我的品項改過 `channel`（`updateCustomFood` 可以改），也會出現「組合是外食、品項現在在超商清單」。結果卡片說可用，帶入後卻沒有選到（看到的不等於存下的）。
- 改法：只要不在目標分頁清單裡（任何原因），都插進那個分頁並標示。check-engine 或快照加一個 channel 改過的情境。

**M7. `validateSavedMeal` 的時間格式寫成「日期字串」**
- db.js 的 `isDateStr` 是 `YYYY-MM-DD`，但 `addSavedMeal` 會寫 ISO 時間。
- 另外 `summarizeBackup`（`dateOfIso`）與 `backup.js` 的「比較新」判斷都把 `created_at` 當 ISO。
- 改法：明寫 `created_at`、`updated_at` 是 ISO 字串，比照 `validateDailyLog`（`Date.parse`）；並寫明 `addSavedMeal` 是先補欄位再驗證。

**M8. 入口 1 的名稱欄放在 `#meal-picker-drinks`，重畫就會吃掉使用者打的字**
- `renderDrinks`（`index.js:283`）每次都整個 `innerHTML` 重寫；點單品、飲料、自煮選項都會觸發。
- 改法：
  - 名稱與勾選狀態存在 `mealPicker` 的 state，由 drinks 的 `input` 監聽（`index.js:869` 目前只處理搜尋框）寫回；或比照 `syncQuickAdd`，重畫前先讀回。
  - 讀回時**只在勾選後才 query 那個元素**：假 DOM 對任何 `getElementById` 都會建一個元素並 dump 成 "(untouched)" 一行，會多出 `picker/.../domNN` 行。
  - 這條守則也適用在今日建議與選擇器的所有 render 路徑：不要無條件 query 新的 id。

**M9. Q6 若照預設，PRD 要改兩處**
- 不只 11.3，PRD 11.1 表格 `ingredient` 那一列也寫「引用當天依剩餘預算算主要槽位縮放」，帶入時的倍數也一起變了。
- 第 2.1 節 A.4 要加 11.1。Q6 給使用者的選項也要講清楚：帶入時滑桿從 1 倍開始。

## 2. 建議改

1. **`openMealPicker` 改簽名**：用 `openMealPicker(slot, opts)`，`opts = { onLogged, savedEdit, onSaved }`。
   - 呼叫端：`tab-today.js:285`（只有一處，第 6 節寫「兩處」不對）、`tools/adapter-v2.js:166`，再加上新的 `saved-meals.js`。
   - 每次打開都要重設編輯模式欄位、勾選框、名稱、帶入提示，不然編輯過組合之後一般打開會停在編輯模式。
2. **點擊分派**：`onPanelClick`（`index.js:726`）在自煮分頁一進來就交給 `onCookClick`。組合卡片的點擊要放在函式最前面先判斷。
   - 卡片不要用 `.item-card`、`.compose-option`、`.compose-step`、`.meal-picker-group` 這些 class，walkthrough 的選擇器會誤中。
3. **卡片結果要快取**：卡片的解析與熱量在 open 時算一次；不吃、複製、補填之後跟 `rebuildLists` 一起重算。不要每次 `renderPanel` 都對每個組合跑 `resolveSavedMeal`。
4. **`savedMealDraft` 回傳 engine 草稿的形狀**：直接回傳 `buildDraftContent` 吃的形狀（items、drink、`foods: [{item, qty}]`、自煮欄位），再由 ui 薄薄轉成選擇器的 uid 狀態。
   - 否則 `savedMealTotals` 還要把 uid 換回物件，等於在 engine 重寫一次 `currentDraft`。
   - 自煮食材要用 `catalog.proteins` 等清單裡的同一批物件：`onCookClick` 用 `indexOf(item)` 比對物件本身（目前 `ofAxis` 是同一批物件，可以成立，寫進註解）。
5. **import 循環**：`resolveSavedMeal` 若 import `engine/foods.js` 的 `foodsBlockLabel`，會形成 meal-content → foods → picker → meal-content 的循環。
   - 擋不擋只要用 `passesHardFilters`；灰字文字可以把 `foodsBlockLabel` 搬到 `filters.js`，或由 ui 顯示時再補。
6. **「改過用油／調味」不用另外加旗標**：直接用 `Object.keys(cook.draft.implicitOverride).length > 0` 判斷就好。override 只在使用者點按時寫，換餐型會清空，換到不能選用油的烹調法也會清掉 `oil_g`；加一個 `implicitTouched` 反而多一份要同步的狀態。
7. **`toSavedContent` 不要寫 `is_primary: undefined` 這種鍵**：IndexedDB 的結構化複製會保留這個鍵，`validateSavedMeal` 的「若有是布林」會擋下。
   - 也寫明 `is_primary` 帶入時不用，主要槽位由 `composePrimary` 重新算。來回測試（第 4 節）只用選擇器來源的內容，或把 `is_primary` 正規化後再比。
8. **`validateSavedMeal` 補一條**：自煮沒有 `ingredient` 時，`archetype_id`、`method_id` 必須是 null（比照 `noIngredientCookProblems`）。
9. **時間戳由 db 補**：`updateSavedMeal` 由 `applySavedMealPatch(old, patch, nowIso)` 自己補 `updated_at`，第 20 項不要由呼叫端傳。
10. **入口 1 的細節**：
    - 名稱在使用者還沒改過前要跟著選取更新（記一個「改過名稱」的旗標）。
    - 名稱清空時給中性提示，不要丟錯。
    - `savedMealProblem` 用 `ctx.slot = null`。
    - 失敗訊息加一句「取消勾選即可只記這一餐」。
11. **入口 2 需要的資料**：`tab-today.js` 要多 import `getCustomFoods`、`fromCustomFood`（都不是組合讀取函式，不違反 C4.16）。
    - 要保存 `plan.logsBySlot` 才能用 log id 找回內容。
    - 展開中的名稱欄狀態存在模組變數，`buildRecommendation` 重畫後才不會不見。
12. **舊分頁與部署**：
    - 舊版程式的分頁在升級後會收到 `onversionchange` 而關閉連線，之後再用 version 1 開，會得到 VersionError，畫面只會出現「記錄失敗」。建議 `openDb` 認出 VersionError 時改成「請重新整理頁面」，或在 `onversionchange` 時提示重新整理。
    - 部署後如果要退版，`DB_VERSION` 不能退回 1（全部使用者都會打不開）；把這點寫進計畫。
13. **check-arch 自我檢查**：`restrictNames` 直接走訪 `files`，不是純函式。第 24 項要先把它拆成「對一段原始碼回傳命中」的函式，自我檢查才寫得出來。
14. **文件**：
    - PRD 11.6 的檔案格式範例與「目前資料不是空的」那句要加「我的組合」（`backup.js` 的 `hasUserData` 用 `PREVIEW_STORES`，加了之後只有組合也算有資料）。
    - `savedMealDefaultName` 的參數也改成 `(content, catalog, ctx)`，跟 Q3 一致。
15. **假資料庫的寫入紀錄**：fake-db 的 `addDailyLogWithSavedMeal` 推兩筆寫入 `{op:"addDailyLog"}` 與 `{op:"addSavedMeal"}`，既有的 `normWrite` 和 `w.op === "addDailyLog"` 過濾就能直接用。組合 id 用另外的前綴，不要共用 `seq`。

## 3. Q1–Q10

- **Q1 同意**：烹調法不算元件；`method` 設為 null 加說明；免開火衝突擋食材，符合 PRD 原文。
- **Q2 同意**：快煮限制是選擇器子切換的規則，送出時 `composeProblem` 會擋；解析時擋反而會讓卡片和帶入結果不一致。
- **Q3 同意**：改用 `ctx` 物件，避免切片 8、9 反覆改簽名。`ctx` 的欄位要寫清楚，見 M3。
- **Q4 同意**：選擇器帶入用當下時段，解析與送出才一致；其餘用 `null`（主餐 2）。`manualRoleMax` 要用 `slot === null` 嚴格判斷，check-engine 有多處用 `undefined` 當時段的既有測試，不能被影響。
- **Q5 同意**：同一個 transaction。
  - 先 `validateDailyLog`、`validateSavedMeal` 都過，才開 transaction。
  - smoke 模擬「寫組合失敗」可以用已存在的組合 id 讓 `add` 丟 ConstraintError，不用改正式程式。
- **Q6（要使用者決定）**，白話選項：
  - A（建議）：組合卡片上的熱量＝「帶入後選擇器會顯示的熱量」，自煮的主食份量從 1 倍開始，想吃多一點少一點自己拉滑桿。好處是卡片上看到的就是帶入後的數字，選擇器本來就不會自動幫你縮放份量。
  - B：照原 PRD，依今天剩下的熱量自動算份量。卡片數字每天都不一樣，而且要另外接推薦的縮放邏輯，剩餘熱量是負數時還要再定怎麼顯示。
  - 建議 A。選了 A，PRD 11.1 與 11.3 都要改（M9）。
- **Q7（使用者，低）**，白話選項：
  - A（建議）：卡片寫文字「超商／外食／快煮／開伙」。
  - B：另外畫四個小圖示，但 App 目前完全沒有這類圖示。
  - 建議 A，之後要做圖示再一起換。
- **Q8 同意取代**。補一句：取代的是組合要去的那個分頁，加上共用的飲料與單品；其他分頁的選取保留，由 `leftoverLine` 提示。
- **Q9 同意 `#meal-picker-drinks` 尾端**，但一定要做 M8 的狀態同步；編輯模式不輸出。
- **Q10 同意**：已核對 `buildDraftContent` 的元件順序是「食材｜品項 → 估算 → 單品 → 飲料」，計畫寫得正確。補一句：來自推薦的紀錄裡，role 為 drink 的商品夾在品項中間；`savedMealDraft` 依 catalog 目前的 role 把它放進飲料步驟，第二杯以後被擋。

## 4. 漏掉的依賴、呼叫端、測試

- **diff-recs 的 domNN**：
  - picker 的 ui 行只錄 `summary`、`gap`、`hint`、`submit`，但編號 `i` 算的是全部 dump 出來的行。所以把組合列併進 panel 的同一次 `innerHTML` 是對的。
  - 風險在三種寫法：任何新的 `$()`／`getElementById` 查詢（假 DOM 會多建一行）；在 render 路徑寫 `#meal-picker-title`、`#meal-picker-submit` 的文字（`#meal-picker-submit` 會被錄進快照）；寫新的狀態元素。標題、送出鈕文字只能在 `openMealPicker` 裡寫。
  - today 那一行見 M1。
- **`openMealPicker` 呼叫端**：`tab-today.js:285`、`adapter-v2.js:166`、新的 `saved-meals.js`。smoke 與 walkthrough 是透過按鈕，不用改。
- **`DB_VERSION` 1→2 在已有資料的手機上**：`upgrade` 只建 store，資料不受影響。風險是舊分頁的 VersionError 與不能退版，見建議 12。smoke 的升級測試要先用 raw API 建一個 v1 資料庫，再載入 App。
- **fake-db 要補的**：
  - 函式：`listSavedMeals`、`getSavedMeal`、`addSavedMeal`、`updateSavedMeal`、`addDailyLogWithSavedMeal`；並 re-export `validateSavedMeal`、`applySavedMealPatch`。
  - `adapter-v2.js` 的 `setDb` 要加 `savedMeals: clone(state.savedMeals) || []`，而且 fake 的讀取在沒有這個欄位時要回 `[]`（既有情境都沒傳）。
  - `takeWrites` 要處理新的 op。
- **walkthrough 第 5 節**：期望值不受影響。
  - 5-4 檢查「飲食紀錄」「體重紀錄」「不是同步」，以及沒有 kcal 或分鐘；5-7 比對 `sections` 整包相等，`saved_meals: []` 來回一樣。
  - 第 10 節在第 5 節之後，所以第 5 節時沒有組合。
  - 建議 5-4 加一條：預覽有「我的組合」列。
- **index.html**：管理區塊要在 `#foods-search` 與 `#foods-subtabs` 之間（`index.html:292-293`）新增一個容器，計畫沒列。
- **check-engine**：章程 B9 要求「組合引用已刪除 id 時解析不拋錯」，包含 `savedMealDefaultName` 與 `savedMealTotals` 遇到查不到的 ref；計畫列了 remap，這兩個也要測。

## 5. 結論

**改完可以開工。** 架構方向和 Q1–Q10 的預設大致正確。不需要重寫，但 M1–M9 要先改進計畫：M1、M2 照現在的寫法會讓 hook 與驗收失敗；M3–M8 會在實作時直接出錯；M9 是 PRD 要一起改的地方。Q6、Q7 要請使用者決定（建議都選 A）。
