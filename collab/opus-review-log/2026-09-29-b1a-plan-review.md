# B-1a 我的品項管理＋份量倍數 實作計畫審核

日期：2026-09-29　實作者：Opus（Lighten2 主導開發）　審核者：新開的獨立 Opus agent

## 第一輪：送審問題（逐字）

你是 Lighten2（個人減脂飲食 App，純前端 vanilla JS＋IndexedDB，repo 在 `D:\ok\lighten`）平行工作線 B-1a「我的品項管理＋份量倍數」實作計畫的獨立審核者，不是實作者。**只讀不改**任何 repo 檔案（需要實驗的話用 `git archive HEAD` 複製到暫存目錄再跑）。用中文回答。

要審的是 `docs/review/2026-09-29-B1a-實作計畫.md`。

依據：`docs/PRD.md`（第 3 節、第 4 節、6.1、6.3、第 7 節 B-1a／B-1b／B-2 列、第 10 節全部、11.3、11.6、第 12 節 12.1–12.3）、`docs/CHARTER.md`（A、B8、B9、C 全部，特別是 C1、C2、C4.1、C4.5、C4.8、C4.11、C4.13、C5、C6）、`docs/decisions.md`（#41、#44、#47、#48、#49、#52、#61、#66、#67、#71）、`docs/日後討論.md`、上一個工作線的計畫與審核（`docs/review/2026-09-29-B3-實作計畫.md`、`collab/opus-review-log/2026-09-29-b3-plan-review.md`，看它們踩過的坑）、現在的程式（`js/data/db.js`、`js/data/catalog.js`、`js/engine/picker.js`、`js/engine/pool.js`、`js/engine/meal-content.js`、`js/engine/filters.js`、`js/engine/today.js`、`js/ui/meal-picker/*.js`、`js/ui/tab-today.js`、`js/ui/tab-profile.js`、`js/core/config.js`、`index.html`）、測試工具（`tools/check-engine.js`、`tools/check-arch.js`、`tools/diff-recs.js`、`tools/lib/adapter-v2.js`、`tools/lib/fake-db.mjs`、`tools/smoke-browser.mjs`、`tools/mobile-walkthrough.mjs`、`tools/fixtures/`）。

請審：
1. 範圍（計畫第 2 節）有沒有漏掉 PRD B-1a 列、第 10 節、12.3 要求的項目；有沒有做了不該在 B-1a 做的。
2. 計畫跟 PRD、章程、decisions 有沒有衝突（特別是 C1 分層、C1.5 寫入驗證、C2 單一來源、C4.1 預告不誘導、C4.5 null 傳染、C4.8 手動記錄規則、C4.11、C4.13 不評判、B9 下架）。
3. 第 3 節的分層與資料路徑是否合理（隱藏清單的讀取位置、`copyBuiltinToCustom` 的 transaction、`qty` 驗證、表單模組的抽取、備份 v2 的升級）。
4. 資料安全：既有資料（我的品項、daily_log、備份檔 v1）在新的驗證下會不會被擋；複製＋隱藏會不會出現半套狀態；隱藏清單與 `copied_from` 在 B9 下架時會不會出錯。
5. 第 4 節驗收是否足以證明做對了；哪些斷言該放 check-engine、哪些放 smoke-browser／mobile-walkthrough；計畫宣稱的「快照逐字不變」是否真的成立（請實際查 adapter-v2、fake-db、diff-recs 的情境）。
6. 回答計畫第 6 節的問題 1–7。屬於產品決定、應該交給使用者的，寫出建議選項與理由（使用者目前不在，實作者會先照你建議的預設做）。
7. 第 5 節 commit 拆法是否符合章程 A1 與 C6（包括 C1.6 的 stamp-version）。

格式：每個發現標【一定要改】或【建議】，附依據（檔案與行號或章節）。最後一行寫總結論（計畫可以開工／要先修改計畫）。

---

## 第一輪：審核回覆（逐字）

＃ B-1a 實作計畫獨立審核（只讀，沒改任何檔案）

**先說結論：方向對，要先改計畫再開工。** 一共 11 項【一定要改】、14 項【建議】。最要緊的五項：
- 既有的 check-engine 斷言會直接失敗（M1）
- 份量狀態在自煮分頁看不到（M4）
- 複製後自動選中沒有重新檢查（M5）
- 「補填」出現在「含過敏原」的情況，等於誘導改答案（M6）
- 選擇器的補填入口跟 PRD 10.4 不一致（M7）

---

## 1. 範圍（計畫第 2 節）

**【一定要改】M7　選擇器的補填入口跟 PRD 10.4 不一致，PRD 沒有跟著改。**
- PRD 10.4 的規定：「B-1a 的管理畫面上線後，被擋的品項灰階顯示『過敏原未填，點這裡補填』，點進去就是編輯畫面。」
- `docs/日後討論.md` L89 也寫：被擋的品項「要能直接點進編輯」。
- 計畫的做法（2.1-3 最後一項、2.2「選擇器裡直接編輯我的品項：不做」）：卡片仍不能點，只加一句「可到基本資料…補填」。這會讓使用者關掉選擇器，已選的東西全部遺失。
- 建議預設：照 PRD 做。
  - 被擋的我的品項卡片旁加一個獨立的「補填」按鈕，不能巢狀在 `disabled` 的 `<button>` 裡。
  - 按了打開同一個 `custom-food-form.js`（編輯模式）→ `updateCustomFood` → 重算 reasons。
  - 選擇器本來就為了「複製」要放完整表單，多一個編輯模式的成本很低。
- 如果堅持不在選擇器裡編輯，要在 commit 1 改 PRD 10.4，並在 decisions 記錄否決「點進去編輯」的理由（章程 A1、C6.6）。

**【建議】S1　2.2「不做」表漏了 `docs/日後討論.md` L70 的去向。**
- 那條是「基本資料改了設定要按『計算』才會存」，已經登記給 B-1。
- 驗收 16（先到基本資料設過敏原）正好會踩到這個問題。
- 要在表裡寫明留給 B-1b 或另排。

**【建議】S2　其他範圍沒問題。**
- PRD 第 7 節 B-1a 列、10.1–10.6、12.3 要求的項目都有涵蓋。
- 管理區塊的「＋新增」不在 10.6 列表裡，但 PRD 第 10 節開頭寫了「新增/編輯/刪除」，不算越界。改 PRD 時一起寫進 10.6 即可。

---

## 2. 跟 PRD、章程、decisions 的衝突

**【一定要改】M6　「補填」只能出現在「未確認」類的原因（章程 C4.1、PRD 10.3）。**
- `passesHardFilters` 會回傳四種原因（filters.js L73、L79、L86）：「成分未確認」「含過敏原」「飲食限制未確認」「你已設定不吃：X」。
- 計畫目前對所有原因都加：
  - 選擇器的「可到基本資料…補填」（2.1-3）
  - 管理區塊的「補填」按鈕（2.1-4）
- 對「含過敏原」（使用者自己勾了含蛋）或「不吃」放「補填」，意思就是「去改答案就能選」，正是 C4.1、PRD 10.3 禁止的引導。
- 修法：只在「成分未確認」「飲食限制未確認」時出現；另外兩種只寫原因。
- 補一個斷言：由 engine 函式決定要不要顯示補填，check-engine 測四種原因。

**【建議】S3　C4.11：「已選」段每行如果要顯示熱量，由 engine 提供。**
- 不要在 ui 算 `item.kcal * qty`。check-arch 的 UI_SUM_PATTERNS 只抓加法，乘法抓不到，但原則一樣。
- 最簡單的做法：每行不顯示熱量，只看摘要。

**【建議】S4　C4.13：份量晶片、隱藏、複製按鈕都不上色、不依熱量排序。**
- 管理清單照建立時間排序是 OK 的。
- 手機實機腳本加一行人工檢查。

**【建議】S5　PRD 10.1 的 `copied_from: "<內建品項 id>"` 要改寫成「uid（台式外食帶 `tw_` 前綴）」。**
- 這樣跟 `hidden_catalog_uids`、`productsByUid` 同一個命名空間（catalog.js L38）。

---

## 3. 分層與資料路徑

**【一定要改】M4　`drinkQty` 在自煮分頁是看不到的狀態。**
- 「已選」段只在超商／外食分頁（2.1-3），但飲料步驟是三分頁共用的。
- `buildDraftContent` 對 cook 草稿也會讀 `draft.drink`（meal-content.js L513）。
- 使用者在超商分頁把飲料改成 ×2，切到自煮送出，就會記下看不到的 ×2。
- 修法：
  - 飲料的份量晶片（以及隱藏、複製）放在飲料步驟裡，選中的那杯下面（`#meal-picker-drinks`，三分頁都看得到）。
  - 取消選取時刪掉 `qtyByUid[uid]`，重選回到 1。

**【一定要改】M5　複製存檔後「選中並沿用原本的份量」要照 `saveQuickAdd` 重新檢查（index.js L259–L276）。**
- 表單可以改角色、channel、`valid_slots`、過敏原。存檔後可能：
  - 被擋（例：改成含蛋）
  - 角色名額已滿（主餐改成配菜，但配菜已經選了）
  - channel 改了，要放到另一個分頁
  - 目前時段不在 `valid_slots` 裡，在這個時段看不到
  - 角色改成飲料，要進飲料步驟
- 每一種都要有中性說明、不能選中。計畫只寫了「新的我的品項選中」。
- 把這段抽成跟快速新增共用的一個函式，不要寫第二份。

**【建議】S6　`withoutHidden` 只看現成品項組合。**
- 用 `!c.is_composed` 先放行自組食譜，不要只靠 `components` 裡的 id 剛好不撞（自組的 `components` 是食材 id，pool.js L253）。
- 放的位置見問題 4。

**【建議】S7　隱藏清單讀不到時要跟 `readLastPicked` 一樣處理（index.js L59–L67）。**
- `getHiddenCatalogUids` 在 tab-today、選擇器、管理區讀取失敗時：`console.error` 後當成 `[]`，不擋推薦與選擇器。隱藏不是安全規則。

**【建議】S8　`hidden_catalog_uids` 在 `SETTING_KEYS` 標 `dedicatedOnly`（db.js L290 已預留這個概念）。**
- 讓 `setSetting` 拒絕這個 key，所有寫入都走同一個 transaction 裡的讀改寫，兩個分頁同時隱藏才不會互相蓋掉。

**【建議】S9　`custom-food-form.js` 的放法同意。**
- 用 diff-recs 既有的 quick-add 快照（`stable(w.record)`，diff-recs L585）證明快速新增的輸出不變。
- 完整表單沒有時段：
  - `valid_slots` 由勾選決定。
  - 新增時預設用角色推的時段（`quickAddSlots` 不帶目前時段）。
  - 預告不要沿用吃 `slot` 的 `quickAddRecord`。
- `custom-foods.js` 模組頂層不要碰 `document`（B-3 審核 5-2 的教訓：adapter-v2 會連 tab-profile 一起載入）。
- 檔名可以考慮用 `js/ui/profile/…`，之後 B-1b「食物資料頁」要進 C4.16／C4.17 白名單（check-arch L29 是這個慣例）。

**【建議】S10　`copyFromBuiltin` 的 `note` 只取「；」後面的內容物描述。**
- 超商 note 的格式是「資料來源；內容物」（pool.js L275–L281 的 `contentNote`）。整段抄進我的品項，資料來源說明會變成使用者的備註。
- 共用這段邏輯時注意 C2 重複名稱檢查，要搬到單一位置。

---

## 4. 資料安全

**逐項核對：**
- **既有資料在新驗證下**：
  - 使用者的 daily_log 與 `backup-v1.json` 的商品元件都是 `qty: 1`（meal-content.js L450、`contentFromRec` 也寫 1；fixture 只有一個 qty，值是 1）。改成只能 0.5／1／1.5／2 不會擋到舊紀錄。
  - fixture 的我的品項已經有 `copied_from: null`、`archived: false`，沒有 vendor／category／note，照計畫的放寬規則會通過。
- **複製＋隱藏的原子性**：一個 transaction 包住 custom_foods 與 settings，`withStores` 已經修過同步丟錯會 abort（db.js L106），不會出現半套。

**【一定要改】M8　B9 明列「我的品項的 `copied_from`」，但計畫沒有對應的機器斷言。**
- 章程 B9 要求〔機：check-engine 斷言〕程式不得因為查不到而出錯。
- 「內建目前的數值」與「已隱藏的內建品項」清單的查表目前寫在 ui（custom-foods.js），測不到。
- 修法：寫成 engine 純函式，例如：
  - `builtinCurrentValues(copiedFrom, productsByUid)`：查不到回 null
  - `hiddenEntries(hiddenUids, productsByUid)`：略過查不到的 uid
- check-engine 用不存在的 uid 斷言不拋錯、不列出、計數正確。

**【建議】S11　補兩個半套的使用情境。**
- 封存複製品時，原品項仍在隱藏清單，會兩筆都消失。封存時用中性文字提示「原本的內建品項『X』仍是隱藏的，可以在下方取消隱藏」。
- 取消隱藏原品項後再複製一次，會有兩筆 `copied_from` 相同。PRD 11.3 規則 2 的「改用那一筆」就不唯一了。在 `docs/日後討論.md` 登記給工作線 C：取建立時間最新、未封存的那一筆。

**【建議】S12　`addCustomFood` 拒絕 `copied_from` 非 null。**
- 讓「複製必定同時隱藏」只有 `copyBuiltinToCustom` 一條路（fake-db 同步）。

**【建議】S13　驗證規則的兩處補充。**
- `validateCustomFood` 順便驗 `vegan`／`lacto_ovo` 是布林或缺。catalog.js L56 註明目前不驗；既有資料都是布林，不會擋。
- `updateCustomFood` 的 patch 帶 `id`／`created_at`／`copied_from`，但值跟原本相同時放行，不同才丟錯。不然表單整筆回傳會被誤擋。

---

## 5. 驗收（第 4 節）與「快照逐字不變」

**快照不變的宣稱，我逐項查過，成立：**
- 推薦快照：
  - `withoutHidden(pool, [])` 回傳同一個陣列，而且 `planToday` 只有 tab-today 一個呼叫端（tab-today.js L179）。
  - adapter 的 `pool()`／`recommendRaw` 直接用 `buildCandidatePool`（adapter-v2.js L118–L127），不受影響。
- draft-totals：check-engine L710 呼叫 `buildDraftContent` 時沒有 `qtyByUid`，份量就是 1，不會變。
- 選擇器的 picker 快照：`partitionByMealType` 第四個參數省略時不過濾，不會變。
- **ui 快照其實預期完全不變**：
  - 選品項的情境排除了 `#meal-picker-panel|drinks|tabs`（diff-recs L469）。
  - 自煮與估算只錄 summary／gap／hint／submit（L517、L543）。
  - 所以「已選」段不會出現在 ui 快照。計畫第 4 節「其他」應該改成「ui 快照逐字不變」，出現差異就是 bug。
- 前提：「補填」提示要加在卡片渲染時，**不能改 `t.reasons` 的字串**，否則 picker 快照的 `blocked` 行（diff-recs L431）會變。

**【一定要改】M1　既有的 check-engine 斷言會失敗，計畫沒列。**
- `tools/check-engine.js` L956：`bad("不認得的 settings key", … { id: "hidden_catalog_uids" } …)`
- `tools/check-engine.js` L988–L989：`setSetting("hidden_catalog_uids", [])` 預期「沒有登記」
- 登記這個 key 之後兩條都會失敗。
- 在計畫裡寫明改成另一個真的沒登記的 key（例：`__unregistered_key`），不能刪掉斷言。

**【一定要改】M2　第 4 節有兩項在 node 裡做不到。**
- 第 1 項「合併後的紀錄過 `validateCustomFood`」：`updateCustomFood` 要先讀 IndexedDB，node 裡測不到。
  - 修法：抽出純函式 `applyCustomFoodPatch(old, patch, nowIso)`（合併、禁止改的欄位、更新 `updated_at`、驗證），export 出來讓 check-engine 直接測。
  - 真的 IndexedDB 的讀改寫放 smoke。
- 第 9 項 `logName`：它在 `js/ui/meal-picker/index.js` L478，check-engine 測不到。
  - 修法：搬進 engine（`picker.js` 或 `meal-content.js`，跟 `qtyLabel` 放一起），或改用 diff-recs 的選擇器情境驗。

**【一定要改】M3　章程 C1.5 的「傳入陣列要報錯」斷言要涵蓋每個新的寫入函式。**
- 目前只列了 `updateCustomFood`。還要加：`copyBuiltinToCustom([rec])`、`hideCatalogItem([uid])`、`unhideCatalogItem([uid])`。
- 在碰資料庫前擋下的驗證也要斷言：
  - `copyBuiltinToCustom` 缺 `copied_from` 或我的品項格式不對 → 丟驗證錯誤。
  - `hideCatalogItem("")` → 丟錯。
- `hidden_catalog_uids` 的驗證器：`[]` 通過；`["a","a"]`、`[""]`、`"a"`、`[1]` 擋下。

**【一定要改】M9　PRD 第 7 節 B-1a 列要求「驗收做一次來回」，計畫只驗了 fixture。**
- smoke-browser 的「備份與還原」段（smoke L100–L121）執行前，要先寫進：
  - 一個隱藏的 uid
  - 一筆 `copyBuiltinToCustom` 的複製品
  - 一筆 qty 2 的紀錄
- 讓真的 IndexedDB 做匯出 → 還原逐字相同。
- `backup-v2.json` 建議從這次真的匯出結果凍結，不要從 v1 手改（S14）。

**【建議】S14　其他驗收補強。**
- **smoke 第 11 項太弱**：隨便隱藏一個品項，推薦本來就可能不含它。
  - 改成隱藏「目前推薦卡片裡的品項」，斷言那張卡換掉了。
  - 另外在 check-engine 用 `planToday`（見問題 4）加一個固定輸入的斷言。
- **smoke 第 10 項**：`add` 與 `put` 都要攔，模擬失敗的位置要有兩種。
- **diff-recs 選擇器情境**：新增一組 qty 2／0.5＋送出的情境。只會新增快照行，`normContent` 已經會印出 `x2`（diff-recs L78），能照到送出的 content。
- **放置分工同意**：
  - 純函式放 check-engine：驗證、合併、隱藏過濾、`copyFromBuiltin`、份量、B9 查表。
  - 真的 IndexedDB 放 smoke：transaction、來回。
  - 畫面放 mobile-walkthrough：卡片、表單、提示。

---

## 6. 第 6 節問題 1–7

1. **入口放選擇器的「已選」段：可以，建議就照這樣做，但要補兩件事。**
   - 限制要寫進 PRD：被擋（灰色）或名額已滿、選不到的內建品項，B-1a 沒辦法隱藏或複製，要等 B-1b 的食物資料頁。
     - 這其實是好事：在灰色卡片旁放「複製成我的版本」，等於提示「複製後改成確認不含就能選」，碰到 C4.1。
   - 「隱藏」後的提示列加「復原」按鈕（呼叫 `unhideCatalogItem`），誤觸不用跑到基本資料。
   - 不建議用長按（手機上不易發現）；也不建議 B-1a 不做入口，那樣 PRD 第 7 節的隱藏與複製會沒有入口可用。
   - 「已選」段建議放在品項清單**上方**（估算卡片之下）。放在清單下面，選了上方的品項之後手機上看不到份量晶片。
   - 屬於產品決定，預設照上面做，之後告訴使用者。
2. **飲料要有份量晶片：要。**
   - PRD 12.3 的「已選的商品」包括飲料，兩瓶茶很常見。
   - 位置要放在飲料步驟（見 M4），不放「已選」段。
3. **備份版本 +1：對。**
   - PRD 11.6 規定新增 settings key 就 +1（L105、L117）。
   - 這樣舊版 App 讀到新檔時，會說「來自較新的版本」，不會誤報「不認得的 key」。
   - `BACKUP_MIGRATIONS[1]` 不必放空函式，`migrateBackup` 會跳過沒有步驟的版本（db.js L363）。在註解寫明「v1→v2 沒有資料要改」即可。
   - 要一起改掉 M1 的兩條斷言。
4. **`withoutHidden` 的位置：函式放 `pool.js`；建議在 `planToday` 裡套用（`o.hiddenUids`，缺值等於 `[]`）。**
   - 「推薦要濾掉隱藏品項」是推薦引擎的規則，放在 engine 才能用 check-engine 以固定輸入斷言，tab-today 只負責讀出清單傳進去。
   - 空清單時傳入原本的池，快照不變。
   - 放在 tab-today 也不違反章程，列為【建議】。
5. **複製後又取消隱藏原品項：不擋，照計畫在取消隱藏時用中性文字提示。**
   - 另外補 S11 的兩件事：封存複製品時提示原品項仍隱藏；同一個 `copied_from` 有多筆時，在日後討論登記給工作線 C 的選擇規則。
   - 屬於產品決定，預設照計畫。
6. **管理區塊的「＋新增我的品項」：建議做。**
   - PRD 第 10 節開頭寫了「新增/編輯/刪除」。在家整理新品不必先打開選擇器，而且共用同一個表單，成本低。
   - `valid_slots` 預設用角色推的時段（沒有「目前時段」）。
   - 要在 commit 1 寫進 PRD 10.6 與 decisions。
   - 屬於產品決定，預設做。
7. **驗收與 commit 拆法**：驗收見第 5 節，commit 拆法見第 7 節。

---

## 7. commit 拆法（計畫第 5 節）

**【一定要改】M10　章程 C1.6：commit 3、commit 4 都改到 `js/`（commit 4 還改 index.html），也要跑 stamp-version。**
- 計畫只在 commit 2 寫了。
- pre-commit 的 `check-arch --staged` 會擋，計畫要寫明，不要到時候才發現。

**【一定要改】M11　commit 1 與 commit 3 要補的東西。**
- commit 1（文件）：
  - PRD 10.4 的補填入口（M7）
  - 10.2／10.6／12.2 的入口與「被擋品項 B-1a 不能隱藏／複製」（問題 1）
  - 10.1 的 uid 說法（S5）
  - decisions 新增一條（照 A2 寫否決的做法）
- commit 3：`docs/手機實機腳本.md` 對應 mobile-walkthrough 12–14、16 的選擇器步驟要在同一個 commit（C5.2、C6.5），不要全部留到 commit 4。

**commit 2 的內容：**
- fake-db 的所有新函式 export 要在 commit 2 一次補齊（commit 3、4 的 ui 會 import，adapter-v2 L47、L50 會連帶載入）。
- `getHiddenCatalogUids` 建議讀 `S().settings.hidden_catalog_uids ?? []`，照真的語意寫，預設仍是空，快照不變。之後 diff-recs 才能加隱藏情境。
- M1 的斷言修改、M2／M3／M8 的新斷言也在 commit 2。

**其餘：** 拆成「文件 → 資料層與 engine → 選擇器 → 管理區 → 交接」，符合 A1（先改 PRD 再動程式）、C5（這次不是修 bug，不適用先寫失敗的斷言）、C6.3（快照不變就不必更新）。

---

**總結論：要先修改計畫**（M1–M11 修完、問題 1／5／6 照上面的預設寫進計畫與 PRD 後即可開工）。

---

## 第二輪：送審問題（逐字）

第二輪審核。計畫已依你的第一輪意見改成第二版：`docs/review/2026-09-29-B1a-實作計畫.md`（方括號〔M1〕〔S1〕等標出對應你的哪一條）。你的第一輪問答已逐字存在 `collab/opus-review-log/2026-09-29-b1a-plan-review.md`。

M1–M11 全部照你的修法；S1–S14 都採納；問題 1、4、5、6 照你建議的預設寫進第 6 節（使用者不在，回來再告知）。我自己多加的一項請特別判斷：`picker.js placeNewCustom`（2.1 第 15 項）把 `saveQuickAdd` 的「能選才選中」抽成 engine 純函式，快速新增、複製、補填三處共用——這會改到 Phase 0 的 `saveQuickAdd`，有沒有會讓既有行為或快照變動的地方？

請只讀不改，照第一輪格式回覆：逐條確認第一輪的【一定要改】是否已解決（已解決／部分／未解決＋理由），第二版新引入的問題標【一定要改】或【建議】，最後一行寫總結論（可以開工／要先修改計畫）。

Address this before completing your current task.

---

## 第二輪：審核回覆（逐字）

＃ B-1a 實作計畫第二輪審核（只讀，沒改任何檔案）

**結論：可以開工。**
- 第一輪 11 項【一定要改】：10 項已解決，M5 部分解決。
- 第二版有 2 項新的【一定要改】，都跟你問的 `placeNewCustom` 有關。兩項都是在計畫裡補一兩句規格，不必重送審，修進計畫即可開工。
- 另有 4 項【建議】。

---

## 一、第一輪【一定要改】逐條確認

| # | 狀態 | 理由 |
|---|---|---|
| M1 既有斷言會失敗 | 已解決 | 2.1 第 8 項改用 `__unregistered_key`、不刪；驗收 14 會照樣檢查。 |
| M2 node 裡測不到的兩項 | 已解決 | `applyCustomFoodPatch` 改成純函式（第 1 項）；`draftLogName` 搬進 engine（第 14 項）；驗收 1、13。 |
| M3 每個寫入函式都要測傳陣列 | 已解決 | 驗收 3 涵蓋四個寫入函式、碰資料庫前的驗證、`dedicatedOnly`。 |
| M4 飲料份量在自煮分頁看不到 | 已解決 | 飲料份量放在三分頁共用的飲料步驟（第 17 項）；walkthrough 19 驗切到自煮看得到、取消選取後重選回到 1。 |
| M5 複製後自動選中要重新檢查 | **部分** | `placeNewCustom` 列出的六種情況對了，但有兩個缺口，見 N1、N2。 |
| M6 補填只給未確認類原因 | 已解決 | `fillableReason`（第 12 項）＋驗收 10、22。 |
| M7 選擇器的補填入口跟 PRD 10.4 不一致 | 已解決 | 選擇器有獨立的「補填」按鈕，不巢狀在 disabled 的按鈕裡（第 20 項）；原因字串不改；commit 1 改 PRD 10.4。 |
| M8 B9 的 `copied_from` 沒有機器斷言 | 已解決 | `builtinCurrentValues`、`hiddenEntries` 改成 engine 純函式＋驗收 11。 |
| M9 備份要真的來回一次 | 已解決 | smoke 18 做真的匯出與還原，`backup-v2.json` 從這次匯出凍結。 |
| M10 每個 commit 都要 stamp-version | 已解決 | 第 5 節開頭寫明。 |
| M11 commit 1、3 要補的內容 | 已解決 | commit 1 的 PRD 章節清單齊全；commit 3 帶手機實機腳本。 |

---

## 二、你特別問的：`placeNewCustom` 會不會改到 Phase 0 的行為或快照

**不會改到的部分：**
- 快速新增的新品項，`valid_slots` 一定包含目前時段（`quickAddSlots`），channel 也一定等於目前分頁。所以「不在時段」「在別的分頁」兩個新分支，走快速新增時永遠不會觸發。
- diff-recs 的 10 個 quick-add 情境（picker.txt L464–L482）在這一點上不受影響。

**會改到行為、而且快照測不出來的有兩處，都要寫進規格：**

**N1【一定要改】① 飲料要照舊「直接取代」目前的飲料，不能套角色名額檢查。**
- 現在的 `saveQuickAdd`（index.js L263–L266）：飲料沒被擋時直接 `m.drinkUid = item.uid`，會取代已選的飲料，不做 `canAddManualItem`。
- 如果 `placeNewCustom` 對飲料也跑名額檢查（飲料上限 1），「已選一杯、再快速新增一杯」會從「換成新的」變成「不選中」。
- diff-recs 唯一的飲料情境（`M/breakfast/convenience/drink`）事先沒選飲料，所以快照照樣會過，沒有機器能發現這個變化。
- 修法：
  - 規格寫明：飲料沒被擋就取代目前的飲料，並清掉舊飲料的份量。
  - 驗收 12 加「已選一杯時再存一杯飲料 → 換成新的」。
  - 最好也加一個 diff-recs 情境把它鎖住。這個情境事先選好一杯飲料，只會新增快照行，符合「只新增、不改既有行」。

**N1【一定要改】② 說明文字要逐字不變，文字由 ui 組。**
- 快照錄的是 `message`：
  - 「已存成我的品項，並選進這一餐。」
  - 「已存成我的品項。以你目前的設定不能選：…」
  - 「已存成我的品項。午餐的主餐最多選 2 個。這次沒有幫你選。」
- 複製與補填的開頭不能是「已存成我的品項」。
- 建議：`placeNewCustom` 只回傳結構化結果，例如 `{ dest: "tab"|"drinks"|null, tab, select: bool, reason: 原因或 null, roleProblem: 字串或 null }`。
- 各入口在 ui 用自己的句型組文字；快速新增沿用現在的三個句型，一個字都不改。

**另外兩點照做就不會出事：**
- **判斷順序**要跟現在一樣：先決定放到哪裡（飲料步驟／依 channel 的分頁／不符合時段就不放），再判斷選不選中。被擋的也要放進清單並記下原因（現在 L265、L271 就是這樣），不能因為被擋就不放進清單。
- **快速新增寫入的紀錄**（快照 write0 那幾行）不能多出 `note`／`vendor`／`category` 欄位。搬 helper 到 `custom-food-form.js` 時，快速新增的組記錄不要換成完整表單的那一個。

---

## 三、第二版新引入的問題

**N2【一定要改】複製和補填時，`placeNewCustom` 的名額與清單狀態要先整理好再判斷。**
- **複製（第 19 項）**：先把原品項從選取、清單與份量裡拿掉，再呼叫 `placeNewCustom`。
  - 不然原品項還佔著名額。例：下午茶主餐上限 1，複製已選的主餐 → 新的那筆會因為「主餐最多 1 個」選不進去。
  - 份量要從舊 uid 搬到新 uid。
- **補填（第 20 項）**：品項已經在 `t.items` 裡。要**換掉同 uid 那一筆並刪掉 `reasons[uid]`**，不能再 push 一筆，否則會出現兩張卡片。
- 驗收 12 或 21 各加一個情況。

**【建議】S15　`dedicatedOnly` 只擋在 `setSetting`，不能放進 `validateSetting`。**
- `validateBackup` 與 `importAllData` 都用 `validateSetting` 驗 settings（db.js L427）。擋錯地方的話，含隱藏清單的備份會還原不了。
- 驗收 14 的 v2 fixture 會抓到，但計畫明寫可以省掉一次來回。

**【建議】S16　按「復原」後，重新跑 `partitionByMealType` 把品項放回原本的位置，不要 push 到清單最後。**
- 章程 C4.13 與 PRD 6.3 要求照資料原順序。

**【建議】S17　複製品的 channel 或時段跟原品項不同時，一樣要給中性說明。**
- 表單改了 channel，新品項會放到另一個分頁、不選中，說明它在哪個分頁。
- `valid_slots` 不含目前時段時不放進任何清單，說明「這個時段不會出現」。
- 計畫的「六種情況」已經列了，只是要確認複製流程真的會走到這兩條。

**【建議】S18　`contentNote` 搬家與 `draftLogName` 靠既有快照證明沒變，不必另外寫斷言。**
- `contentNote` 由 pool 快照證明。
- `draftLogName` 由 picker 快照裡的 `addDailyLog` 名稱證明。
- 在自查表寫一句即可。

---

**總結論：可以開工。**（開工前先把 N1、N2 補進計畫第 2.1 節第 15、19、20 項與驗收 12、21；這兩項是在計畫裡補規格，不必重送審。）
