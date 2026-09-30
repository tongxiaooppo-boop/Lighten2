# 工作線 D 切片 2（我的食物分頁殼＋不吃）實作計畫審核

日期：2026-09-30　實作者：Opus（Lighten2 主導開發）　審核者：新開的獨立 Opus agent
審核對象：`docs/review/2026-09-30-D2-實作計畫.md` 第一版

## 第一輪：送審問題（逐字）

你是獨立審核者，用中文回答。專案在 D:\ok\lighten（「輕盈計畫」2.0：個人減脂飲食追蹤 App，純前端 vanilla JS ES modules＋IndexedDB，單人使用，沒有後端）。

請審核實作計畫：docs/review/2026-09-30-D2-實作計畫.md（工作線 D 切片 2：新主分頁「我的食物」分頁殼、搜尋、超商／外食／現成飲料清單與明細、不吃、我的品項管理從基本資料搬過來、已隱藏組、被擋品項可複製）。

依據文件：
- docs/PRD.md 第 6.3、10、13 節（13.9 切片表的切片 2 列是本次範圍與驗收標準）
- docs/decisions.md #73–#95
- docs/CHARTER.md（特別是 A1.3 職責搬家、B2/B3 出處與可信度、B9 下架、C1 分層、C2 唯一來源、C4.1 不引導改答案、C4.11 ui 不加總、C4.13 不評判、C4.14 鈉只在 meal-content.js、C6 快照與驗收）
- 設計草案 docs/review/2026-09-30-我的食物分頁-設計草案.md

請實際打開程式碼驗證計畫裡的說法（行號、呼叫端、快照相依），不要只讀計畫。重點檔案：js/data/db.js、js/data/catalog.js、js/engine/filters.js、js/engine/picker.js、js/engine/meal-content.js、js/ui/meal-picker/index.js、product-tab.js、cook-tab.js、js/ui/profile/custom-foods.js、js/ui/tab-profile.js、js/ui/tab-today.js、index.html、css/style.css、tools/diff-recs.js、tools/lib/adapter-v2.js、tools/lib/fake-db.mjs、tools/check-engine.js、tools/check-arch.js、tools/smoke-browser.mjs、tools/mobile-walkthrough.mjs、tools/snapshots/*.txt。

請特別檢查：
1. 依賴有沒有漏：要改或移除的函式、DOM id、CSS class 還有哪些呼叫端或測試會壞（包含 tools/ 與 docs/手機實機腳本.md）。
2. 快照預期是否正確：計畫說 pool/matrix/tdee/picker/ui 逐字不變、recs 只有一行操作名稱差異。這個判斷對嗎？有沒有其他會變的地方？
3. 不吃的語意：decisions #40 只比 key、#80 原因代碼、「又不吃又過敏留在原位」、沒有基本資料時停用；專用寫入函式與 saveProfileForm 的設計有沒有漏洞（例如競態、備份還原、profile 驗證）。
4. 職責搬家（A1.3）是否完整；移除 hideCatalogItem 是否安全。
5. 範圍是否跟 PRD 13.9 切片 2 列一致；有沒有做多或做少；兩個使用者決定（Q1 分頁列拿掉空的採買清單、Q2 自煮子分頁延到切片 4）的建議是否合理、有沒有更好的選項。
6. 明細顯示的出處與可信度是否符合章程 B2、B3、C4.14；「約」的規則。
7. 驗收是否足以抓到回歸；mobile-walkthrough／smoke 的改寫有沒有漏。
8. 任何會讓實作卡住或返工的設計問題。

輸出格式：分成【一定要改】【建議改】【問題／可以不改】三類，每條編號（M1、S1、Q1…），寫出依據（檔案:行號或文件段落）與具體改法。最後給一句結論：可以開工／改完可以開工／需要第二輪審核。不要改任何檔案。

## 第一輪：審核回覆（逐字）

# 審核：工作線 D 切片 2 實作計畫（docs/review/2026-09-30-D2-實作計畫.md）

我逐一打開程式核對了計畫裡的說法，大部分行號與呼叫端都對：index.js L54/L296/L300、picker.js L35/L59/L115、tab-today L240、tab-profile L51/L292、CSS L1046 起，還有 recs.txt L512。

快照的判斷大致正確：
- pool、matrix、tdee、ui 不會變。
- picker 快照只錄 `t.items` 依序過濾出來的 `uid:原因文字`，所以只要 state 的順序不改就不會變。
- `fromProduct` 加 `sources` 不會流進 `toMember`、`productSnapshot`、`copyFromBuiltin`。

問題主要出在四處：測試能不能真的跑、明細出處跟 PRD 12.1 不一致、文件驗收條件，以及漏列的幾個依賴。

## 【一定要改】

**M1　check-engine 沒有 IndexedDB，計畫列的 db 行為斷言跑不起來**
- 依據：`tools/check-engine.js:798`、`:1016` 都寫明「Node 沒有 indexedDB，驗證通過的寫入也會失敗」，只能比對錯誤訊息。計畫第 4 節要測的「去重只比 key、沒有 profile 丟錯、saveProfileForm 忽略傳入清單、沒有舊 profile 存 []」都得真的讀寫資料庫。
- 改法：
  - db.js 匯出三個純函式：`addDislikedTo(list, entry)`、`removeDislikedFrom(list, key)`、`mergeProfileForm(saved, form)`。三個專用寫入函式在 transaction 裡呼叫它們。
  - `fake-db.mjs` 也用同一份純函式，比照現在 `applyCustomFoodPatch` 的做法，保證 diff-recs 的語意跟真的一樣。
  - check-engine 測兩類：純函式本身；碰資料庫之前就丟的錯（缺 key、傳陣列，比照章程 C1.5 與 L1058 的寫法）。
  - 真的要碰資料庫的斷言移到 smoke-browser：沒有 profile 時丟錯、`saveProfileForm` 保留資料庫裡的不吃清單。

**M2　明細的出處標示跟 PRD 12.1 衝突，而且 `ref` 原樣顯示會把開發者註記放到畫面上**
- 依據一：PRD 12.1「出處標示」已經定了中性標示：
  - `tfda` 與由衛福部推算的 `derived` →「衛福部」；
  - `label`、`official_web` 與現成品項由標示推算的 `derived` →「包裝或官網標示」；
  - `estimate`、區間中點 →「估算」；
  - 我的品項標「你填的」，複製來的標「從內建複製」。

  計畫第 11 項另訂了 6 種標籤，還寫「`ref` 原樣顯示」；我的品項的出處寫 null，沒有給「你填的」。
- 依據二：實際 ref 內容有 71 筆「v1：Google AI 回覆估算…（AI 的數字不是出處，章程 B2.3）」、8 筆「Claude 依網路公開資料整理估算」，其他的還帶著「−1b 驗收審核 2.4」「decisions #21」這類字樣。章程 B2.6 不准 note 出現 AI 字樣，原樣顯示 ref 等於把同樣的東西放上畫面。
- 依據三：章程 C2 與 B3 規定「可信度推導」只能在 `data/catalog.js`。
- 依據四：PRD 12.2 的明細要列「能在哪些餐出現（品項列 `valid_slots`）」，計畫的明細內容漏了這一項。
- 改法：
  - catalog 依 B3 與 12.1 推導每一欄的「出處類別」（例：`source_class`）。ui 只把類別對到 12.1 的文字；ref 不顯示，只有 tfda 附整合編號（照 12.2）。
  - 計畫要明寫兩個歸類：
    - `label_unsourced` 算哪一類；
    - taiwan 那 5 筆由衛福部樣品推算的 `derived`（例：`L01021 × 2.4`）歸「衛福部」還是「包裝或官網標示」。

    規則最好是機械可判的，例如 ref 符合整合編號格式就歸衛福部。
  - 明細改成依類別分組顯示（例：「熱量、蛋白質：包裝或官網標示；碳水、脂肪：估算」），不要 7 欄各寫一次。
  - 補上 `valid_slots`。

**M3　PRD、決策紀錄與獨立審核的前置條件沒寫進計畫**
- 依據一：PRD 13.9 切片 2 的驗收是「推薦、候選池快照逐字不變」，計畫卻預期 recs 有一行差異。另外 `normWrite`（diff-recs.js L91）輸出的是 `w.op + " " + stable(w)`，操作名稱在那一行出現兩次（前綴和 JSON 裡的 `"op"`），證明用的腳本兩處都要換。
- 依據二：PRD 13.2 寫「共 6 個分頁」。
- 依據三：章程 A1.1 把「頂層分頁的移除」列為概念變更，要先改 PRD、在 decisions 記一條；章程 C3 規定 A1 變更要在改完 PRD 之後、動程式之前送獨立審核並逐字存檔。計畫第 5 節只寫「先做 PRD／decisions」，沒有 C3 審核。
- 改法：
  - 開工前先改 PRD 13.2（分頁數）和 13.9 切片 2 的驗收：recs 只允許 `flow/chip-dinner-protein/write0` 的操作名稱不同；picker、ui 逐字不變。
  - 使用者選了拿掉「採買清單」的話，把這份審核逐字存到 `collab/opus-review-log/`，當作 C3 審核。

**M4　手機腳本和 walkthrough 有漏列的依賴，還少了一條關鍵回歸測試**
- 依據一：`tools/mobile-walkthrough.mjs:299` 用正規式比對「過敏原／飲食／不吃設定」。計畫第 15 項要把這句改成只數過敏原與飲食，3-2b 會直接失敗，但計畫的 walkthrough 改寫清單沒有列 3-2b。
- 依據二：`docs/手機實機腳本.md` 漏了三處：
  - 使用者短清單第 5 項（L16，「隱藏再復原」「基本資料的我的品項」）；
  - 0-1（L22，列五個分頁）；
  - 3-2b（L52，同一句話）。

  另外，計畫寫的「第 2-5、5、6、7 節」跟這份腳本的節次對不上：腳本只有 0–6 節，第 7 節是 walkthrough 的編號。
- 依據三：現在 walkthrough L174–L178 在驗「順便不要 → 到基本資料按計算 → 資料庫仍有該項」，這正是 `saveProfileForm` 要保護的讀改寫競態。計畫把 2-5 改成「全部清單有它、取消後推薦恢復」，這條回歸測試就不見了。
- 改法：
  - 2-5 保留「按計算不會蓋掉」：順便不要 → 基本資料按計算 → 資料庫與「我的食物」的全部清單都還在。
  - 3-2b 的正規式、手機腳本的 L16、L22、L52 一併改。
  - 節次改用腳本自己的編號。

## 【建議改】

**S1　`saveProfile` 保留不用，會留下繞過專用函式的路徑**
- 依據：PRD 13.5 寫「寫入一律經過 db.js 的專用函式」；章程 A1.3 要求直接移除，不為過渡保留。改完之後 ui 不再呼叫它，只剩 check-engine L839、L846 在用。
- 改法：刪掉 `saveProfile`，這兩條斷言改測 `saveProfileForm`；fake-db 也一起換。若要保留，就在 check-arch 禁止 ui 匯入它。

**S2　漏列的連帶修改**
- `tab-profile.js` 在 L11 匯入 `profile/custom-foods.js`，L300 呼叫 `refreshCustomFoods()`，`initProfileTab` 裡呼叫 `initCustomFoods()`。git mv 的同一個 commit 要一起拿掉，不然 adapter-v2 L50 載入 tab-profile 會失敗，diff-recs 和 pre-commit 都會紅。
- `fake-db.mjs` L93 的 `hideCatalogItem` 要一起刪。
- db.js L324 的註解和 `changeHidden(uid, add)` 的參數要跟著改。
- CSS 裡會變成沒用的 class：`.disliked-ingredients-list`、`.dislike-chip-x`（L608–L613）、`.hide-notice`（L1186–L1196）、`.custom-foods-*`（L1201–L1233）。

**S3　commit 拆法有中間狀態問題**
- commit 2 拿掉基本資料的「不吃的食材」區塊，但「不吃的全部清單」要到 commit 3 才出現。commit 2 這個版本沒有任何地方能移除不吃項目，也違反 A1.3。
- 改法：把「不吃的食材」區塊的移除延到 commit 3，或把全部清單提前到 commit 2。

**S4　state 歸屬要先講清楚，也要避開 check-arch 的重名檢查**
- 依據：`custom-foods.js` 有自己的 `state`、`load`、`render`、`save`、`onClick`、`rowHtml`、`formHtml`，並綁在 `#custom-foods-*` 這些 id 上。check-arch L237 對頂層 const 和函式名做全 repo 重名檢查，白名單只有 render、init 等幾個。
- 風險：新的 `tab-foods.js` 很自然會寫 `state`、`load`、`save` 而撞名；兩份 state 各自讀 profile、我的品項、隱藏清單，也容易不同步。
- 改法：`tab-foods.js` 是唯一的 state 擁有者；`foods/custom-foods.js` 改成只輸出 HTML 與動作函式，state 由參數傳入；命名加前綴。

**S5　子分頁結構漏了兩件事**
- 我的品項的「已封存（N）」組放在哪裡沒寫。第 13 項的組順序沒有它，只在搜尋結果提到「已封存」。
- PRD 10.6 要求我的品項「新到舊」。`partition` 是照 `getCustomFoods` 的 id 排序，順序不一樣。
- 改法：兩件都在計畫裡寫明。

**S6　不吃按鈕與計數的依據**
- 明細裡「不吃／取消不吃」要看「key 在不在清單裡」，不能看 `code`：又不吃又含過敏原的品項，`code` 會是 allergen。
- 「你標了不吃（N）」只數 `code` 是 disliked 的，跟全部清單的 N 會不一樣，要說明。
- `dislikedListEntries` 要依 key 去重：舊版 `onDislikeChipClick` 用 type＋key 去重，舊資料可能有同 key 兩筆。

**S7　選擇器關閉後，今日建議不會重算**
- 依據：`closePicker`（index.js 約 L735）不會呼叫 `onLogged`。在選擇器已選段標「不吃」再按取消，今日建議卡片會繼續推薦那一項，要切分頁才更新。現在的「隱藏」也有同樣問題，只是這次會被放大。
- 改法：記一個「不吃清單變過」的旗標，關閉時有變就重算。

**S8　第 7 項前後矛盾**
- 它先說 `quickAddProblem`、`fillableReason`「改成依 code」，後面又說「不加，維持文字比對」。
- 建議定案：`quickAddProblem` 在 engine 內改用 `code` 分支；`fillableReason` 維持文字不動。

**S9　自煮軸的「不吃排到最後」超出切片 2 範圍**
- 依據：PRD 6.3 第 4 點和 13.9 切片 2 只講超商、外食分頁與飲料步驟。PRD 13.6 的「各軸內排序」屬於切片 5。
- 改法：延到切片 4／5，跟常吃排序一起做，而且排序應放在 `engine/picker.js`，不是 cook-tab 的 ui。現在灰在原位並寫原因，已經可用。

**S10　把快照不變的前提寫成規則，並加一條回歸防護**
- `splitDisliked` 只在畫面組 HTML 時用；`m.tabs[t].items` 和 `reasons` 的順序不動。這是 picker 快照不變的前提，要寫成規則。
- 建議在 adapter 的 `pickerOpen` 多錄一行 `.../disliked`（以 DISLIKE profile 為例）。這是 PRD 允許的「不吃置底」刻意差異，而且只新增、不改舊行，可以鎖住置底的語意。

**S11　smoke 補一個併發情境，並寫明寫入格式**
- 除了「順便不要」跟「我的食物」同時寫，也要測 `saveProfileForm` 跟 `addDislikedIngredient` 同時送；這才是 `onCalculate` 原本的競態。
- 寫明內建品項的 entry 是 `{ type: "item", key: uid, label: name }`，跟 `findDislikedHit`、推薦卡片晶片一致。

**S12　360 寬度的截圖要寫清楚怎麼做**
- 依據：harness 在 walkthrough L16 啟動時只設一次 390 寬。
- 改法：計畫寫明中途用 `Emulation.setDeviceMetricsOverride` 切到 360，截完再切回 390；`.tab-btn` 的 `white-space: nowrap` 也要改。

**S13　順便不要之後告訴使用者去哪裡取消**
- 基本資料的不吃區塊拿掉之後，使用者不知道要到哪裡取消（這是 Q2 的代價）。
- 建議按完晶片後給一行中性提示：「可以在『我的食物』取消」。

**S14　飲品・水果子分頁的新增預設值**
- `emptyCustomFoodValues(channel)`（custom-food-form.js L50）的角色寫死 main，要加 role 參數，`valid_slots` 用 `quickAddSlots("drink")`。
- 新增後如果角色被改成非飲料，要提示它出現在哪個子分頁。

## 【問題／可以不改】

**Q1　分頁列（使用者決定 Q1）**
- 拿掉空的「採買清單」分頁合理，也符合 A1.3 和「已決定取代就拿掉」。
- 但 check-arch 已經預留 `tab-calendar.js`（Phase 3 餐點日曆），加上 Phase 4 的採買清單，之後會回到 6–7 個分頁。
- 更好的選項：現在就在 decisions 定下日曆與採買清單的去處（例：都放在「本週總覽」裡的子頁），分頁數就固定是 5；或者直接選能撐到 6–7 個的版型（3×2 格線）。

**Q2　自煮子分頁延到切片 4**
- 同意，這跟 decisions #94「不做過渡清單」一致。「飲品・水果」這一版只有現成飲料，名稱照 PRD 就好。

**Q3　資料缺陷**
- 有 2 筆 `derived` 的 ref 是「咖啡飲品」，不是公式，不符合 B2 表，check-data 也沒擋到。可以記進日後討論，或另開 `data(fix)`。

**Q4　台式外食的熱量是區間中點**
- 明細可以加寫「區間 a–b」，屬選配。

**Q5　PRD 13.2 的基本資料清單**
- 少列了「體重回填」和「校正卡片」，順手補上。

**Q6　不吃的品項還能不能複製**
- 複製品不會繼承不吃，原品項還會被自動隱藏。可接受，但要在計畫裡寫明是刻意的。

**Q7　`sodiumText` 的位置與寫法**
- `sodiumText` 在 `ui/dom.js`，不在 meal-content.js（計畫措辭要改）。
- 明細建議用 `withReference = true`，符合 C4.14 的「鈉 約 X mg（參考 2400 mg）」。

**Q8　行號小誤差**
- `#custom-foods-section` 實際在 index.html L230–L240，計畫寫 L218–L229。

## 結論

改完可以開工。M1–M4 都是測試方式、文件與依賴清單的修正，不牽涉架構，不需要第二輪全面審核。若使用者選 Q1 拿掉分頁，請把這份審核逐字存檔，當作 C3 審核。
