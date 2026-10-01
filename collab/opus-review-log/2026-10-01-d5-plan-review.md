# 切片 5「常吃（選擇器）」實作計畫審核（2026-10-01）

計畫：[docs/review/2026-10-01-D5-實作計畫.md](../../docs/review/2026-10-01-D5-實作計畫.md)（第一版）。
使用者在寫計畫前已決定 U1–U4（入口兩邊都有、搬到最上面不重複、我的食物子分頁也有常吃組、數量不限），四題都選了建議。

## 第一輪：送給獨立 Opus 的問題（逐字）

```
你是獨立審核者，請用中文審核一份實作計畫。專案在 D:\ok\lighten（純前端 vanilla JS ＋ IndexedDB 的個人減脂飲食 App「Lighten2」）。

要審的計畫：docs/review/2026-10-01-D5-實作計畫.md（工作線 D 切片 5「常吃（選擇器）」）。

依據文件：docs/PRD.md 第 6.3、13.3、13.5、13.6、13.9 節；docs/decisions.md #78、#80、#81、#115、#121；docs/CHARTER.md 的 B9、C1、C2、C4.1、C4.13、C4.17（特別是 ②）。前一份同類計畫可參考格式與審核深度：docs/review/2026-10-01-C-實作計畫.md 與它的審核 collab/opus-review-log/2026-10-01-c-plan-review.md。

計畫開頭的 U1–U4 是使用者已做的產品決定，不要推翻，只能指出它們在技術上造成的問題。

請你**實際打開程式**驗證計畫第 1 節「現況」與第 6 節「自查」的每個說法，至少要看：js/data/db.js（SETTING_KEYS、changeDisliked、addDislikedIngredient、withStores、copyBuiltinToCustom、exportAllData、validateBackup、migrateBackup）、js/engine/picker.js、js/engine/filters.js、js/engine/foods.js、js/ui/meal-picker/index.js（renderPanel、renderDrinks、rebuildLists、dislikeItem、openMealPicker）、js/ui/meal-picker/product-tab.js、food-step.js、cook-tab.js、saved-row.js、js/ui/tab-foods.js、js/ui/foods/list.js、tree.js、rows.js、disliked.js、js/ui/tab-today.js（找「順便不要」與 addDislikedIngredient）、tools/lib/fake-db.mjs、tools/diff-recs.js（尤其第 482 行附近的 DOM 排除規則，以及 flow/*、saved/* 情境是否也會受影響）、tools/check-arch.js、tools/check-engine.js（隱藏清單相關斷言）。

重點請檢查：
1. 「推薦快照逐字不變」「既有 diff-recs 行逐字不變」的說法是否真的成立（有沒有哪個情境會錄到 #meal-picker-panel 以外、但這次會改到的 DOM 或 state）。
2. 常吃與不吃互斥跨 settings 與 user_profile 兩個 store 的做法是否正確、有沒有漏掉的寫入路徑（例如基本資料「計算」saveProfileForm、備份還原、推薦卡片的順便不要）。
3. 第 3 節 Q1–Q7 每題給出同意或不同意與理由。
4. 漏掉的依賴、會壞掉的呼叫端、check-arch 規則寫法是否可行、commit 拆法能不能讓每個 commit 的 hook 都通過。
5. 360 寬手機的畫面風險。

輸出格式：先一句結論（「改完可以開工」「要大改」等），然後分「必須改（M）」「建議改（S）」「問題回答（Q1–Q7）」「其他觀察」，每條都附檔案與行號證據。不要修改任何檔案，只回報。
```

## 第一輪：審核回覆（逐字）

# 工作線 D 切片 5「常吃（選擇器）」實作計畫第一版：獨立審核

**結論：改完可以開工。** 方向對：互斥在一個 transaction 裡做、只在組 HTML 時搬動。但有幾處照現在的寫法會直接打壞快照、讓 hook 失敗、畫面寫錯字，或讓使用者的常吃悄悄消失，要先改。

第 1 節現況與第 6 節自查，我都打開程式核對過。大部分屬實（逐條見最後一節）。不成立的有：
- `#meal-picker-*` 被排除，不代表「既有 diff-recs 行逐字不變」，見 M1、M4。
- 「`archetypeOptions` 組合解析也在用」不對，見 S10。

---

## 必須改（M）

**M1. fake-db 改寫入紀錄的形狀，會打壞推薦快照（違反 PRD 13.9 切片 5「推薦快照逐字不變」）**
- 第 29 項寫「不吃的兩個函式同步移除常吃；寫入紀錄 `{ op, favorites, disliked }`」。
- 「順便不要」的寫入已經錄在推薦快照：`tools/snapshots/recs.txt:512`。這一行是 `flow/chip-dinner-protein/write0 addDislikedIngredient {"disliked":[...],"op":"addDislikedIngredient"}`。
- 那一行經 `diff-recs.js:87-99` 的 `normWrite`，最後走 `stable(w)` 整個物件輸出；`adapter-v2.js:99-105` 只改寫 `addDailyLog`。所以多一個 `favorites` 欄位，這行就變。
- 也不能另外 push 一筆寫入紀錄：`recs.txt:513` 的 `write1`（markRecipesShown）編號會跟著位移。
- 改法：
  - `addDislikedIngredient`／`removeDislikedIngredient` 的寫入紀錄維持 `{ op, disliked }`（`fake-db.mjs:30-35`），常吃只在 `S().settings.favorite_refs` 裡默默改掉。
  - `{ op, favorites, disliked }` 只用在 `addFavoriteRef`／`removeFavoriteRef`。
  - 第 4 節驗收寫明 recs.txt 整檔逐字不變。

**M2. 備份 3→4 一升，第 2 個 commit 的 hook 就失敗**
- 會失敗的現有斷言有三處：
  - `tools/check-engine.js:1934` 斷言 `BACKUP_SCHEMA_VERSION === 3`。
  - `:1937` 斷言升級後 `m.schema_version === 3`。
  - `:1956-1957` 拿 `schema_version = 4` 當「較新的版本」要擋；升到 4 後它就是目前版本，不會再被擋。
- 另外 `tools/smoke-browser.mjs:326` 斷言匯出 `schema_version === 3`（不在 hook 裡，但在第 2 到第 6 個 commit 之間會是紅的）。
- 計畫只寫「先用手寫的 v4 物件驗」，沒提要改這些舊斷言。工作線 C 審核的 M2 就是同一個問題。
- 改法：這幾行一律在第 2 個 commit 改成 4／5（「較新」改用 `BACKUP_SCHEMA_VERSION + 1`）；smoke 的 326 行也一起改。

**M3. fake-db 漏掉純函式匯出，第 5 個 commit 的 diff-recs 會連結失敗**
- 第 28 項說選擇器 `dislikeItem` 要用 `removeFavoriteFrom`，而選擇器從 `../../data/db.js` import；diff-recs 用 module hook 把它換成 fake-db（`fake-db.mjs:1`）。
- 第 29 項只列了三個 async 函式。fake-db 少匯出 `removeFavoriteFrom`（`addFavoriteTo` 若有人 import 也一樣），ESM 一連結就失敗。
- 改法：在第 2 個 commit 讓 fake-db 也 re-export 這兩個純函式，比照 `fake-db.mjs:5-6`、199 的 `addDislikedTo`。

**M4. 選擇器 render 路徑不能多碰任何新的 DOM 選擇器（ui 快照的 domNN 編號會位移）**
- `fake-env.js` 的假 `document.querySelector`／`getElementById` 只要被呼叫，就會建一個元素並出現在 `dump()`（排序後的全部選擇器）。
- `diff-recs.js:480-483` 跳過 panel／drinks／tabs 那幾行，但編號 `i` 是用整份 dump 算的。所以只要 render 路徑多查一個新 id，例如 `$("#meal-picker-favorites")`，`picker/items/*/domNN` 與 `today/*` 的 ui 行就會全部位移。
- `index.js:174` 的註解（「快照的 domNN 才不會位移」）就是在防這件事。
- 改法：第 2.1 F 節加一條限制——常吃組只能寫進既有的 `#meal-picker-panel`／`#meal-picker-drinks` 的 innerHTML。`openMealPicker`、`renderPanel`、`renderDrinks`、`updateSummary` 不得新增 `$()`／`getElementById`。第 6 節自查也補上這一條。

**M5. 常吃搬走後，選擇器的空狀態提示會寫錯**
- `product-tab.js:83` 的判斷是 `total - blocked === 0`，成立時顯示「這個時段的X分頁沒有可以選的品項…」。`total` 只算傳進來的 `groups`（`groupForTab(split.rest)`）。
- 如果某時段能選的都標了常吃（例如下午茶外食只剩幾樣），常吃組上面有卡片，下面卻寫「沒有可以選的品項」。
- 第 6 節只想到「灰色的 N 項」要加總，沒想到這句。
- 改法：
  - `productTabHtml` 收常吃組的 entries（或總數），`total`、`blocked` 都含常吃組。
  - 飲品・水果步驟同理：`food-step.js` 的 `countShown` 改成排除常吃後，「家裡的飲品」標題（第 102 行）要依「常吃組也沒有」來決定畫不畫，不能只看剩下的。

**M6. 「複製成我的版本」會讓常吃悄悄消失，計畫沒處理**
- `copyBuiltinToCustom`（`db.js:841-856`）會把原內建品項寫進 `hidden_catalog_uids`。`partition`（`picker.js:45-62`）與「我的食物」（`list.js:145`）都會濾掉隱藏的。
- 所以使用者把常吃的超商品項複製成自己的版本後：
  - 原品項消失，常吃旗標留在一個看不到的 uid 上。
  - 沒有「常吃全部清單」可以移除，它就一直卡在清單裡。
  - 新的我的品項也不是常吃。
- 選擇器已選列（`product-tab.js:47-49`）跟「我的食物」明細都有這顆按鈕，很容易碰到。
- 改法（建議）：`copyBuiltinToCustom` 本來就開了 `customFoods`＋`settings`，同一個 transaction 裡把常吃的 `copied_from` 換成新 id（位置不變）；fake-db 同步改。這是產品行為，寫進 decisions #127。
- 若決定不轉移，PRD 13.6 要寫明，walkthrough 也要有一條斷言鎖住。

**M7. `favoritesFirst` 會把被擋的常吃搬到最前面，比現況更違反 PRD 13.6「被擋的仍最後」（Q5 的技術問題）**
- 第 15 項的穩定排序只看常吃，沒看擋不擋。標了常吃、但被過敏原或飲食擋的食材（不吃已由 `effectiveFavorites` 扣掉）會排第一個，而且灰著。
- 也不能拿 `optionReason`（`cook-tab.js:30-33`）來判斷：它含 `composeOptionProblem`（軸上限、免開火、快煮），選擇過程中會變。用它的話，每點一下選項就會跳位置。
- 改法：只把「常吃且 `ingredientFilterResult(...).ok`」的提前（硬性過濾只看設定，是靜態的）。被擋的常吃留在原位。非常吃的被擋選項照 Q5 不動。

---

## 建議改（S）

**S1. 畫面的常吃一律用扣掉不吃之後的清單**
- PRD 13.5：「engine 讀常吃清單時一律扣掉不吃清單」。第 21 項（`list.js`）、第 22 項（`tree.js`）、第 20 項的按鈕文字、搜尋狀態「常吃」，都沒寫要經過 `effectiveFavorites`。
- 還原一份兩邊都有的備份時，用原始清單判斷，明細會對一個標了不吃的品項顯示「取消常吃」。
- 另外寫明一件刻意的行為：兩邊都有時，按「取消不吃」後，它會以常吃的身分回來（原始清單沒改）。

**S2. 第 19 項前後矛盾**
- 前面寫「標完不捲動」，後面又寫「`scrollTo` 捲到它」。
- 建議照 #115 的做法捲到那一列（它會搬到最上面的常吃組），刪掉「不捲動」。

**S3. 飲品・水果子分頁的分層兩組沒列進要改的地方**
- 第 22 項只講 `cookSubtabHtml`。但「我的食物」飲品・水果的家裡飲品與水果在 `tree.js:103-108` 的 `drinksTreeHtml`，用的是 `notDisliked`（第 49 行）與 `majorHtml`（第 53 行），也要排除常吃，否則同一樣會出現兩次（違反 U3）。
- `list.js:158` 的「我的品項（N）」筆數也要扣掉搬到常吃組的。
- `list.js:151` 的被擋筆數要在分出常吃組之前算，或兩邊加總。

**S4. 選擇器飲品・水果步驟的常吃組要寫清楚怎麼畫**
- 這一組混了兩種卡片，事件與選取狀態不同：
  - 現成飲料是 `data-drink`，單選，要帶 `drinkUid` 的選中狀態與 `withFill` 補填。
  - 家裡飲品與水果是 `data-food-uid`，要帶「已選 · N 份」。
- 「不加」留在「現成飲料」組。
- 常吃組放在已選框（`food-step.js:100`）之後、「現成飲料」之前。
- 標題不能用 `.meal-picker-step-label`：walkthrough 第 82、1038 行會數它，見 food-step 第 63 行的註解。

**S5. Q2 的「我的品項照新到舊」只適用「我的食物」**
- 選擇器的 items 是 `getCustomFoods` 的順序（依 id），不是新到舊。
- 計畫寫成「各自照目前清單的原順序」比較準，否則實作者可能在選擇器另外排序，跟 `splitDisliked` 的保序原則不一致。

**S6. check-arch 規則的寫法**
- (a) `favorite_refs` 是字串字面量。`restrictNames` 掃的是 `f.code`（字串已去掉，`check-arch.js:241`），抓不到。要比照 C4.15（第 308-313 行）掃 `f.src`。
- (b) `getFavoriteRefs` 的白名單要含 `js/data/db.js`。
- (c) `favoriteRefs` 只掃 `layer === "engine"` 的 `f.code`。
- 每條都附像第 322-332 行那樣的自我檢查：要擋的範例要抓得到，相近寫法不能誤報。
- C2 重名檢查（第 262-275 行）會擋兩個檔案都有頂層 `favSet`、`favoriteButtonHtml` 之類的同名函式。選擇器與「我的食物」各自的小函式要取不同名字，或放進 engine 共用。

**S7. check-engine 的補強**
- 在 Node 裡跑不了 IndexedDB，`db.js` 真正的雙 store transaction 只有 smoke 測得到；check-engine 的互斥斷言測的其實是 fake-db 的重寫版，兩邊可能各寫各的。
- 建議把互斥寫成 db.js 的純函式，例如 `applyFavoriteOp({ favorites, disliked }, op, ref)`，db.js 的 transaction 與 fake-db 共用（比照 `addDislikedTo`）。
- 加上 C1.5 的「傳陣列要報錯」、空字串報錯，對象是 `addFavoriteRef`／`removeFavoriteRef`（比照 `check-engine.js:1130-1132`）。

**S8. 「兩邊都有」那筆不能放進凍結的 fixture**
- 第 11 項要 `backup-v4.json`「含一筆同時在常吃與不吃的」。但 fixture 是 smoke 真的匯出的（`smoke-browser.mjs:322`），經 UI 有互斥，不可能產生兩邊都有的資料。
- 改法：fixture 保持真匯出（含常吃）；「兩邊都有」在 check-engine 裡 clone fixture 自己加，比照 `check-engine.js:1007-1009` 的 `treeDisliked` 寫法。

**S9. 第 32 項 `fav/*` 情境：工具要另外改的地方沒列**
- `adapter-v2.js` 沒有 import `tab-foods.js`（第 34-52 行）。假 DOM 的 `querySelectorAll` 一律回 `[]`，「我的食物」在 diff-recs 裡沒辦法照現在的方式錄。
- 建議擇一：
  - 改成直接錄 engine 函式的分組結果（`splitFavorites`、`favoritesFirst`）；或
  - 把 adapter 要加的入口列進計畫。
- `fav/*` 寫進 picker.txt，不進 recs.txt。
- 常吃清單用 `setDb({ settings: { favorite_refs: [...] } })` 帶入（`adapter-v2.js:89`）。

**S10. 第 6 節有一句寫錯**
- 「`resolveSavedMeal` 用的是 `archetypeOptions`」不成立：`resolveSavedMeal` 在 engine，不能 import ui。
- `archetypeOptions` 另外只有 `index.js:779` 的 `onCookClick` 用（依 id 找，不受順序影響）。結論（只改 `axisHtml`）不變，理由要改。

**S11. walkthrough／smoke**
- 新的第 11 節要放最後：各節共用同一個瀏覽器資料庫，第 1070 行會檢查標題順序必須是「現成飲料,家裡的飲品」開頭。
- 新按鈕用獨立的 data 屬性（現有測試都用 `[data-foods-dislike]`、`[data-dislike-uid]` 選）。
- 補一條「沒有基本資料時『常吃』停用」，比照第 135-136 行。

**S12. 今日建議的「順便不要」會默默取消常吃**
- `tab-today.js:325-337` 的回饋文字不會提到（Q4 讓它拿不到這個資訊）。可以接受，但 PRD 13.6 要寫一句。
- 給切片 6 的提醒：選擇器關閉時若常吃有改，要像 `dislikedChanged`（`index.js:1037-1045`）那樣重算今日建議。

**S13. 360 寬與誤觸**
- `.selected-actions`、`.food-stepper`、`.backup-actions` 都是 `flex-wrap`，`.link-btn` 高 44px（`style.css:1147-1162`、1198-1203、288-295），橫移風險低。
- 但「常吃」「不吃」意思相反，又是相鄰的窄 link 按鈕（兩個字約 30px 寬）。建議常吃放第一個、不吃放最後，中間隔著「複製成我的版本」。
- 常吃組沒有上限（U4）而且不收合，在「我的食物」與選擇器最上面會把原本的分類往下推很多，截圖時要看長清單的情況。

---

## 問題回答（Q1–Q7）

- **Q1 同意。** 整批 `set` 確實會讓「我的食物」與選擇器各自手上的舊清單互相覆蓋。改章程 C4.17② 的同時，decisions #81 的函式名也要在 #127 註明被取代。
- **Q2 同意（照資料原順序），但措辭照 S5 改。** 標記先後要另外存時間，清單只有 id，也會變成依使用者行為排序。
- **Q3 同意（留在常吃組、灰在組尾）。** 跟 #80「不吃又被擋的留原位」做法不同，但 U2 要求不重複出現，所以合理。#127 寫明這個差異與理由。組尾的我的品項照樣要有「補填」（`withFill`）。
- **Q4 同意（回傳值不改）。** 三個呼叫端的處理確實不用動。前提是 M1：fake-db 的寫入紀錄形狀也不能變。
- **Q5 部分同意。** 非常吃的被擋選項維持原位（不改既有自煮畫面），但被擋的常吃不能提前，做法見 M7。PRD 13.6 改寫成「常吃（沒被硬性過濾擋的）排前面；被擋的位置不變」。
- **Q6 同意。** 切片 5 寫「今日建議會優先」是不實的文字。
- **Q7 同意（選擇器不加提示列與復原）。** 常吃不會讓東西消失，按鈕文字直接變就夠。「我的食物」照 S2 統一成捲到那一列＋一行訊息。

---

## 其他觀察（核對結果）

- **屬實的現況說法：**
  - `db.js:33` `BACKUP_SCHEMA_VERSION = 3`；第 425 行還是舊名 `favorite_ingredient_ids`；沒有任何常吃函式。
  - 不吃清單在 `user_profile`，只經 `changeDisliked`（第 659-668 行，只開 `userProfile`）。
  - `withStores` 支援多個 store（第 107 行；`copyBuiltinToCustom` 第 848 行在用）。
  - `exportAllData` 整個 settings store 匯出（第 983-1005 行）；`validateBackup` 每筆都呼叫 `validateSetting`（第 569-571 行）；`backup.js:3` 不逐 key 處理。
  - `splitDisliked` 不動 state（`picker.js:66-72`）；adapter 的 pass／blocked 是從 state 算（`adapter-v2.js:166-182`）。所以 picker 快照不受只在 HTML 裡搬動影響。
  - C4.17② 確實還沒實作（`check-arch.js` 只有 ③）。
- **互斥的寫入路徑：** 會寫不吃清單的只有 `changeDisliked`、`saveProfileForm`、`importAllData` 三處。
  - `saveProfileForm`（第 684-693 行）經 `mergeProfileForm` 一律保留資料庫裡的不吃清單，不會新增，不需要碰常吃。
  - `importAllData` 照 PRD 13.5 不改寫。
  - 計畫的判斷正確，沒有漏掉的寫入路徑；要另外處理的寫入只有 M6 的複製。
- **diff-recs 的其他情境：** `flow/*` 走今日建議，DOM 全錄，但 `tab-today.js` 本切片不改。`saved/*` 只錄 summary／gap／hint／submit 與 `pickerState()`（`adapter-v2.js:270-281`，不含新欄位）。`open/*` 與 `items/*` 錄的是 state。所以只要守住 M1、M4，既有行能逐字不變。
- **commit 拆法：** 第 1 個 commit 只動文件；第 2 個要含 M2、M3；第 3 個是純 engine；第 4 個的 `tab-foods.js` 不在 diff-recs 載入範圍；第 5 個依賴 M3、M4；第 6 個不動 js，不必 stamp。照這樣每個 commit 的 hook 都能過。

## Opus（主 session）的處理

M1–M7 全收，S1–S13 全收；M6 的「複製時常吃跟著轉到新的我的品項」是產品行為，照審核建議做，記 decisions #127，並告知使用者。處理對照寫在計畫第二版第 8 節。抽驗：`tools/snapshots/recs.txt:512` 的寫入紀錄、`check-engine.js:1934/1937/1956`、`smoke-browser.mjs:326` 的版本斷言都如審核所說。
