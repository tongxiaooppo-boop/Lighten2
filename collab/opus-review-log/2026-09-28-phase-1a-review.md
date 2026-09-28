# 獨立審核：Phase −1a 地基重構

- 日期：2026-09-28
- 審核對象：commit f3c131b..0020b71（快照工具、check-arch、hook/CI、重構本體 0020b71），以及 decisions #33 的格式細節
- 審核者：新開的 Opus agent（章程 C3；不是實作者）

## 送出的提問（逐字）

你是獨立審核者（Lighten2 章程 C3），不是實作者。請用中文回答。**只讀不改任何檔案、不 commit。**

專案：D:\ok\lighten（個人減脂飲食追蹤 App，純前端 vanilla JS＋IndexedDB，單人使用）。

背景：Phase −1a 是「純重構」：用 v1 程式錄下推薦／體重校正／自己選／畫面快照，再改寫成新結構，驗收條件是快照逐字相同（PRD 第 7 節 −1a 列、章程 C6）。實作者宣稱已完成，commit 0020b71。先讀：
- docs/PRD.md 0.1 節、第 3 節（含新增的「daily_log 一筆的欄位」段）、第 7 節 −1a/−1b 兩列、第 9 節
- docs/CHARTER.md C1、C2、C4、C5、C6
- docs/decisions.md #30–#33
- collab/to-opus.md 第 4 節（−1a 的完整要求，含「刻意保留的 v1 行為」）
- `git log --oneline b237641..HEAD`、`git show 0020b71 --stat`；v1 原始碼用 `git show v1-final:js/...` 或 `git show b767ff7:js/...` 看

請檢查：
1. **行為是否真的沒變**：快照（tools/diff-recs.js、tools/lib/adapter-v2.js、tools/snapshots/）有沒有漏掉的路徑？逐一比對 v1 與新版的 engine（recommend→pool/recommend/filters/meal-content/today、budget、matcher、tdee、nutrition）與 ui（tab-today→tab-today/today-hero/manual-picker、item-picker、tab-week、tab-profile、tab-exercise、calibration），找出快照蓋不到但行為改變的地方（例如 proteinPerKg 合併、catalog 正規化把缺 allergen_tags 改成未確認、custom foods 排序、getWeightLogs 範圍、IndexedDB 讀取順序、ensureDailyCalibration 快取、markRecipesShown 的 today 參數、tab:activated 事件、ready() 執行順序）。說明每一處是「刻意且可接受」還是「需要修」。
2. **刻意保留的 v1 bug** 是否真的保留（daysSince 時區、null 當 0、自訂食物跳過過敏原、不吃清單用名稱），沒有被順手修掉。
3. **data/db.js**：原生 IndexedDB 的 transaction 寫法（Promise 鏈裡繼續發 request 會不會遇到 transaction 已自動 commit）、錯誤處理、onupgradeneeded、store 設計（keyPath/索引）、寫入驗證是否符合 PRD 第 3 節與章程 C1.4/C1.5。
4. **章程遵循**：check-arch 的規則寫法有沒有漏洞（能輕易繞過或誤判）；C2 單一真相來源是否還有重複實作（例如日期工具、SLOTS、escape、營養加總）；美饗日曆是否移除乾淨（程式、HTML、CSS、文案），它的職責去向是否跟 PRD 第 9 節一致。
5. **decisions #33 / PRD 第 3 節新增段**（daily_log 加 `name`、meal_type 推導規則、import map 逐檔對照）：這是偏離／補充 PRD 的格式細節，是否合理、有沒有跟 PRD 其他章節或 −1b／Phase 0／我的組合（第 11 節）衝突。
6. 工具本身：diff-recs 的情境是否足以支撐 −1b 的差異報告；smoke-browser、pre-commit、CI workflow 有沒有明顯問題（例如 CI 在 ubuntu 的時區、hook 的退出碼）。

輸出格式：先列「必須修改」（每條：位置 file:line、問題、依據、建議改法），再列「建議修改」，再列「確認沒問題的項目」（簡短），最後一行結論（−1a 可以驗收／修完再驗收）。不要客套，找問題為主。

## 審核回覆（逐字）

# Phase −1a 獨立審核（C3）

我只讀沒改，也沒 commit。check-arch、diff-recs、check-engine 在本機重跑過，全部通過。diff-recs 快照 6 個檔案跟 v1 逐字相同，唯一差異就是實作者說的那 2 行紀錄 id。

## 必須修改

**M1. PRD 第 3 節新增段（`docs/PRD.md:117-121`）和 decisions #33：meal_type 的推導規則寫成了永久規則，但它跟其他章節衝突**
- 問題：
  - (a) 「我的品項算外食」跟 PRD 10.1 衝突。10.1 規定 `custom_foods` 必有 `channel`（convenience|delivery），從分頁自動帶入。
  - (b) 「自己煮：依食材與烹調法難度」跟 Phase 0 衝突。Phase 0 的自煮分頁有「快煮／開伙」子切換，型態是使用者自己選的。
  - (c) #32 否決「依 `prep_tier` 推算快煮／開伙」時寫的理由是「全 🟢 的開伙會被改判成快煮」。這個問題在 daily_log 一樣會發生，而且會經由 11.2 入口 2（從紀錄存成組合）帶進 `saved_meals`。
  - (d) 推薦的情況：時段來源偏好是 `cook_full`，推出一個全 🟢🟡 的組合，會被記成 `cook_quick`。到 Phase 2「照計畫記下」時，紀錄的型態會跟計畫的有效型態不一樣。
- 依據：PRD 10.1、第 7 節 Phase 0 列、11.1 的 `meal_type` 列、decisions #32 否決欄。
- 建議改法：PRD 和 #33 把現在的規則標成「−1a 過渡（v1 沒有型態來源時才推導）」，並寫清楚之後怎麼算：
  - Phase 0 起：自煮用子切換的值；我的品項用自己的 `channel`。
  - 推薦：來源偏好是 cook_quick 或 cook_full、而且不是 fallback 時，直接用那個偏好；只有 auto 或 fallback 才用難度推導。
  - Phase 2：照計畫記下用計畫的有效型態。
  - 對應程式在 `js/engine/meal-content.js:185-243`，程式可以等 Phase 0 再改，文件現在就要改。

**M2. C1.5 的「傳入陣列要報錯」斷言是空的（`tools/check-engine.js:266-269`）**
- 問題：Node 裡沒有 `indexedDB`，所以這幾個寫入函式不管傳什麼都會 reject。我實際測過：`addWeightLog({合法物件})` 和 `saveProfile({})` 都拋出 `indexedDB is not defined`。就算把 `assertRecord` 的陣列檢查刪掉，這 4 條斷言照樣通過。commit 訊息裡「資料庫寫入驗證 13 項」有一部分其實沒在驗。
- 依據：章程 C1.5 標的是〔機〕。
- 建議改法：`rejects()` 除了檢查有沒有丟錯，還要比對錯誤訊息含「不能傳陣列」；或者加一個 `indexedDB` 替身，並加一條「合法物件不報驗證錯」當對照。

**M3. `validateDailyLog` 沒驗完 PRD 列的欄位（`js/data/db.js:100-117`）**
- 問題：
  - 沒驗 `created_at`。PRD 第 3 節新增段把它列在欄位裡，也寫了「db.js 寫入前驗證以上欄位」。
  - `content` 只檢查 components 不是空的：
    - 元件的 `kind` 沒限定在 ingredient／product／estimate 三種；
    - product 沒檢查 `ref`／`qty`／`snapshot`；
    - ingredient 沒檢查 `axis`／`ref`；
    - estimate 沒檢查 `snapshot`；
    - `implicit` 欄位存不存在也沒檢查。
- 建議改法：補上這些結構檢查，並在 check-engine 的 broken 清單加對應案例。−1b 加用油、調味時才有依據可擋。

**M4. 審核紀錄還沒進 git（`collab/opus-review-log/2026-09-28-phase-1a-review.md` 目前是 untracked）**
- 問題：decisions #33 已經在 repo 裡連到這個檔案。C3 要求完整問答要存在 repo。另外 #33 屬於「偏離 PRD 的 store 格式」，照 C3 應該先審再實作，這次是反過來。
- 建議改法：這份回覆貼進去後，跟 M1–M3 的修正一起 commit。

## 建議修改

1. **`db.js` 的 `openDb`（29-49 行）**
   - 沒處理 `onblocked`，連線也沒掛 `onversionchange = () => db.close()`。Phase 2 加 `meal_plan`、工作線 C 加 `saved_meals` 都要升 `DB_VERSION`，那時只要舊分頁還開著，新分頁會卡在 openDb，而且沒有任何錯誤訊息。
   - `onupgradeneeded` 建議現在就改成依 `oldVersion` 分段。
2. **`db.js` 的 `withStores`（61-72 行）**
   - `tx.onerror` 用 `reject(tx.error)`，這時 `tx.error` 可能還是 null，改用 `event.target.error`。
   - `tx.abort()` 在交易已經結束時會丟錯，外面包一層 try。
   - `markRecipesShown` 應該驗 `today` 是不是日期字串。沒傳 `today` 的話會寫入 `last_shown_date: undefined`，而且每次渲染都會累加 `shown_count`。
3. **`data/*.json` 沒帶版本字串（`catalog.js:87-93`）**
   - −1b 會重建資料並凍結食材 id，新程式可能配到被快取的舊 JSON（GitHub Pages 有 10 分鐘快取）。
   - 建議 fetch 網址加上同一個 `?v=`，版本從 import map 取。**−1b 動工前要做。**
4. **check-arch 的漏洞**
   - 讀時鐘的 regex（`check-arch.js:145`）抓不到 `new Date;`、`Date()`、`performance.now()`，而且沒掃 `core/`。
   - 沒禁止 `engine/` 用 `document`／`window`。`core/html.js` 的 `$` 會碰 DOM，建議搬到 `ui/`。
   - 掛 window 的檢查抓不到 `window["x"]=` 和 `globalThis.x=`。
   - `--staged` 讀的是工作區的 index.html（164、209-225 行）。版本字串改了但沒加進暫存區，檢查照樣通過，應該改讀 `git show :index.html`。
   - C2 重複名稱只看名稱，抓不到字面量重複，例如 `catalog.js:57` 又寫了一份時段清單，應改成 import `SLOTS`。
5. **C2：紀錄層的營養加總還分散在 7 處**
   - 位置：`budget.js:31,114,152-154,186-188`、`matcher.js:22,42`、`tdee.js:312`、`meal-content.js` 的 `todayIntake`／`logsKcal`。
   - 它們對 null 的處理不一樣（`Number()||0`，另一種是跳過 null）。
   - 另外 `pool.js:161-165` 的 `toItemCombo` 重寫了一份 `sumProducts`，`manual-picker.js:300-301` 在 ui 裡算營養缺口。
   - 建議 −1b 修 null 傳染之前，先收斂成 meal-content 的一個 `sumLogTotals`。現在各處都是 `Number()||0`，只有 `todayIntake` 例外，所以這樣收斂不會改變行為。
6. **美饗日曆留下的東西（依「已決定取代就拿掉」）**
   - 名稱殘留：CSS class `feast-cancel`、`feast-item-card*`、`feast-item-picker`、`rec-reservation-note`，位置在 `tab-today.js:66,68`、`item-picker.js:80-88`、`manual-picker.js:122,336`、`index.html:381`、style.css。建議改名。
   - `FEAST_SIZE_KCAL = {S:400, M:700, L:1200}` 跟著 feast.js 一起刪了，但 PRD 第 9 節說 Phase 0 要把這組常數放進 `core/config.js`。建議現在就把數值記進 PRD 第 9 節或 config，免得到時要翻 git 歷史。
7. **diff-recs 要撐 −1b 的差異報告**
   - `normWrite` 只比時段、名稱、合計，建議加上 `meal_type`、`source`、正規化後的 `content`。不加的話，−1b 加入 implicit 的變化在寫入端看不到。
   - `fake-db.mjs:251-253` 的 `markRecipesShown` 什麼都不做，也忽略 `today` 參數。所以 `flow/log-breakfast` 那段快照跟真實行為不一樣，漏傳 `today` 的回歸也抓不到（我人工確認過 `tab-today.js:197` 有傳）。
   - 建議讓假庫照 db.js 的語意真的寫入，再開一個 tools commit 更新快照並寫明原因。
   - 還缺的情境：體重送出觸發重跑校正、倒讚按鈕、「順便不要」chip、切回分頁重建。smoke-browser 也可以加一條檢查 `recipe_feedback.last_shown_date === today`。
8. **v1 既有 bug，建議排進 −1b 清單（照 C5 先寫會失敗的斷言）**
   - 推薦卡片一渲染就會 `markRecipesShown`，當天任何一次重建（每次 `tab:activated` 切回今日建議、記錄一餐之後）都會讓剛才那組被扣 60 分以上，於是換成別的組合。
   - 快照可以佐證：`today/M/base` 跟 `today/M/fb-shownToday` 的早、午、晚三個時段全部不同。實際效果是早上看到的推薦，中午切回來就換掉了。
9. **C4.13 的禁用字抓不到運動分頁的「連續紀錄 N 天」（`tab-exercise.js:100`，v1 就有）**
   - 這個 streak 跟章程禁止的「連續達成天數」精神相同。需要使用者拍板：拿掉，或在章程裡明確豁免。
10. **小項目**
    - `matcher.js:14`：profile 是 null 時 `proteinPerKg` 會 TypeError，v1 對 null 是安全的。
    - 體重 ≤0 現在會被驗證擋下，但畫面顯示「記錄失敗，請重試」，訊息會誤導。
    - `contentFromRec` 存的 `scale` 是四捨五入到小數一位後的值，`totals` 用的是未取整的倍數，之後用 content 重算會對不上合計，要在文件寫明或改存未取整值。
    - PRD 第 3 節表格（103 行）寫「紀錄存 scale」，新增段寫「只有主要槽位存 scale」，措辭要統一。
    - catalog 把缺 `allergen_tags` 改成「未確認」：在「自己選」裡是行為改變（v1 當成 `[]` 直接放行），方向是更安全，而且 check-engine:86 保證目前每筆資料都有這個欄位，所以現在看不出差異。建議在 decisions 補記一筆。

## 確認沒問題的項目

- **engine 逐一比對**：
  - recommend 拆成 pool、recommend、filters、meal-content、today，屬於忠實搬家；評分、依序分配、fallback、跨時段不重複都一樣。
  - budget、matcher、tdee、nutrition 除了改讀 `totals.*` 之外逐行等價。
  - tdee 的 `save:false` 路徑對應 v1「當天已評估就不寫回」。
  - daily_log 改成多讀一些範圍，再由 engine 用 `windowStart` 篩，跟 v1 等價。
- **proteinPerKg 合併**：只是 matcher 多了 trim 和轉小寫，對表單送出的值沒有影響，可以接受。
- **v1 各處自寫的日期函式已收斂**：清單寫到的日期工具、SLOTS、escape 都只剩 core/ 一份（`catalog.js:57` 的時段字面量見建議 4）。
- **讀取順序**：custom foods 排序、IndexedDB 依日期再依 id 的讀取順序，因為 id 是依時間產生的，等同 v1 的插入順序；`custom_foods` 在 Phase 0 之前也是空的。
- **其他指定檢查點**：
  - `getWeightLogs` 範圍一致，tdee 會自己排序。
  - `ensureDailyCalibration` 的快取語意跟 v1 相同。
  - `tab:activated` 和各分頁初始化順序等價。
- **刻意保留的 4 個 v1 bug 都還在**：daysSince 時區（`recommend.js:44`）、null 當 0（`pool.js:141`、meal-content 的 `num`、`||0`）、自訂食物跳過過敏原（`filters.js:312`）、不吃清單用名稱比對（`filters.js:335-346`）。
- **db.js**：
  - 交易寫法是在 request success 之後的 promise 裡繼續發 request，現代瀏覽器下交易仍然是 active 的，沒問題。
  - 各 store 的 keyPath、索引、`lighten2.` 前綴、一筆一個 key 都符合 C1.4、C1.5。
- **美饗日曆**：程式、HTML、文案、預約分支都移除乾淨了；職責去向符合 PRD 第 9 節（撤銷一餐搬到 db.js、今日建議讀預約的分支已刪除）。
- **import map**：逐檔對照的解析方式正確，check-arch 會強制每個檔案都列進去。
- **CI 和 hook**：CI 跑在 ubuntu，diff-recs 會用 TZ 重新啟動自己，時區沒問題；hook 用 `set -e`，檔案權限是 755，換行固定 LF；hook 總時間約 5 秒。

**結論：修完再驗收。** 4 個必須修改都是小改動：M1 是文件，M2 是測試，M3 是驗證，M4 是 commit 審核紀錄。行為面沒有發現需要回退的地方。
