# B-3 匯出／匯入實作計畫審核

日期：2026-09-29　實作者：Opus（Lighten2 主導開發）　審核者：新開的獨立 Opus agent

## 第一輪：送審問題（逐字）

你是 Lighten2（個人減脂飲食 App，純前端 vanilla JS＋IndexedDB，repo 在 `D:\ok\lighten`）平行工作線 B-3「匯出／匯入」實作計畫的獨立審核者，不是實作者。**只讀不改**任何 repo 檔案（需要實驗的話用 `git archive HEAD` 複製到暫存目錄再跑）。用中文回答。

要審的是 `docs/review/2026-09-29-B3-實作計畫.md`。

依據：`docs/PRD.md`（第 3 節、第 7 節 B-3／B-4a／B-4b／C 列、11.6、第 12 節）、`docs/CHARTER.md`（A、C 全部，特別是 C1.4、C1.5、C2、C3、C4.12、C4.15、C4.16、C4.17、C5、C6）、`docs/decisions.md`（#55、#67 與最後幾條）、`docs/日後討論.md` 最後一節「內建資料編輯器、分享包與投稿收錄」、現在的程式（`js/data/db.js`、`js/ui/tab-profile.js`、`js/engine/tdee.js`、`js/ui/meal-picker/index.js` 的 settings 用法、`js/ui/clock.js`、`index.html`）、測試工具（`tools/check-engine.js`、`tools/check-arch.js`、`tools/diff-recs.js`、`tools/lib/adapter-v2.js`、`tools/smoke-browser.mjs`、`tools/mobile-walkthrough.mjs`、`tools/lib/browser-harness.mjs`）。

請審：
1. 範圍（計畫第 2 節）有沒有漏掉 PRD B-3 列、11.6 要求的項目；有沒有做了不該在 B-3 做的；「預留擴充點」是否真的讓日後的分享包／合併匯入接得上而不必改格式。
2. 計畫跟 PRD、章程、decisions 有沒有衝突（特別是 C1 分層、C1.5 寫入驗證、C2 單一來源、C4.12 運動脫鉤、C4.15、C4.16、C4.17）。
3. 第 3 節的格式與分層是否合理：驗證放 db.js、`importAllData` 單一 transaction 先 clear 再 put、`location.reload()`、`<input type=file>` 不設 accept、JSON 大小。
4. 資料安全：還原（取代）有沒有會讓使用者資料遺失或壞掉、而計畫沒擋到的路徑？既有資料能不能通過匯入驗證（例如早期寫入、現在的驗證器會擋的紀錄；請實際讀驗證器與寫入端比對）。
5. 第 4 節驗收是否足以證明做對了；哪些斷言該放 check-engine、哪些放 smoke-browser／mobile-walkthrough。
6. 回答計畫第 6 節的問題 1–7。其中若有屬於產品決定、應該交給使用者的，寫出建議選項與理由。
7. 第 5 節 commit 拆法是否符合章程 A1（先改 PRD/decisions 再改程式）與 C6。

格式：每個發現標【一定要改】或【建議】，附依據（檔案與行號或章節）。最後一行寫總結論（計畫可以開工／要先修改計畫）。

---

## 第一輪：審核回覆（逐字）

# B-3 匯出／匯入實作計畫 獨立審核

審核對象是 `docs/review/2026-09-29-B3-實作計畫.md`（第一版）。我只讀了檔案，沒有改動 repo。

**先說結論：方向對，但要先改計畫。** 一共 10 項一定要改、10 項建議。其中四項最要緊：
- 匯出時沒有自我驗證。結果可能是「匯出成功，但這份備份永遠還原不了」。
- `validateProfile` 驗不過時，錯誤會被靜默吞掉。
- commit 3 會讓 diff-recs 整個載不起來。
- 全有全無的斷言實際上測不到交易本身。

---

## 1. 範圍

**【一定要改】1-1　B-1a、C、Phase 2 的新資料沒有寫明誰負責匯出匯入。**
- 計畫 2.2 寫「各自那一條工作線補（PRD B-3 列已寫）」，但 PRD L253 只指派了 B-4a、B-4b。
- 另外三項沒有人負責：
  - B-1a 的 `settings.hidden_catalog_uids`（PRD L328，11.6 L434 還要求它跟 custom_foods 在同一個 transaction）。
  - C 的 `saved_meals`。
  - Phase 2 的 `meal_plan`。
- 計畫 3.1 又規定「同版本出現不認得的 settings key 就拒絕」。所以只要 B-1a 加了隱藏清單、卻忘了補匯出，備份就會變成還原不了。
- 修法：在 commit 1 的 PRD 第 7 節 B-1a、C、Phase 2 三列都補一句：「匯出匯入涵蓋 X；`schema_version` +1；驗收做一次來回（round-trip）」。
- 「C4.17 讀取函式清單要列 `exportAllData`」應該寫進 PRD 的 B-4a 列。只寫在交接待辦（commit 4）不夠，因為 PRD 才是權威（章程 A1.2）。

**【一定要改】1-2　新增 store 或 settings key 時，要讓機器擋下「沒跟著改匯出」。**
- 計畫目前靠人記得「每次 +1、各線補上」。C2 的精神是單一來源，應該改成機器檢查。
- `importAllData` 要清空的 store 清單必須從 `STORE` 表導出，不能寫死「7 個」。
- check-engine 要斷言：`STORE` 的每一項都對應到某個區塊。
- settings 要在 db.js 設一張唯一的 `SETTING_KEYS` 表：
  - `setSetting` 拒絕表外的 key。
  - `validateSetting` 用同一張表。
- 目前 `setSetting(key)` 是公開函式，meal-picker 直接傳字串（`meal-picker/index.js` L25、L488），白名單跟寫入端會各走各的。

**【建議】1-3　「預留擴充點」大致接得上，但有兩處要改。**
- **不要讓 `scope` 決定匯入語意。**
  - 日後討論 L96 的規劃是：全勾＝完整備份，但其中「紀錄」是合併、「系統」是覆蓋。這跟 B-3「full＝取代」不同。
  - 建議檔案只描述「含哪些區塊」。取代或合併由匯入端在畫面上選。B-3 只提供「取代全部」。
  - `scope` 要嘛拿掉（它跟 `sections` 的 key 重複，C2），要嘛明寫「只是資訊，不決定語意」。
- **`recipe_feedback` 和 `settings` 改成陣列。**
  - 目前是用「key 當屬性名」的物件，建議改成 `[{ id, value… }]`。
  - 好處一：格式跟「每筆帶原始 id」一致。
  - 好處二：避開以後有 `__proto__` 這類 key 時組物件出錯的問題。
- **補一份逐 store 筆數的 manifest。** 日後討論 L10–L11 的 B-3 參考點寫了「驗證筆數跟資料一致」，計畫漏了。

**【建議】1-4　`validateBackup` 從現在起多收一個參數 `ctx`（查表用）。**
- 章程 B8 規定：B-4a／B-4b 的驗證器要由呼叫端傳入衛福部查詢表和 catalog。
- 現在先把簽名定成 `validateBackup(obj, ctx)`，之後接上就不用改呼叫端。

**【建議】1-5　`saveProfile` 加驗證屬於範圍擴大。** 做可以，但要照 4-2 的條件做。

## 2. 跟 PRD、章程、decisions 的衝突

**【一定要改】2-1　把 `backup.js` 加進 C4.12 的允許清單，是修改章程。**
- 理由：
  - C4.12（CHARTER L282）的條文直接寫死了兩個檔名。
  - 它不像 C4.16／C4.17 那樣寫「白名單職責，檔名調整不算修改」。
  - 所以這是修改 C4 規則，要走 C3。
- commit 1 目前只改 PRD 和 decisions，必須把 CHARTER 也放進來。這次審核可以當作 C3 的獨立審核，但要逐字存到 `collab/opus-review-log/`。
- 建議的最小條文：
  > 讀取運動紀錄的函式只允許出現在 `ui/tab-exercise.js`、`data/db.js` 與負責備份匯出匯入的檔案〔機：check-arch grep〕；備份畫面只顯示筆數，不顯示、不加總運動內容〔人〕；飲食畫面不出現運動內容，反之亦然〔人〕。
- 同時更新 check-arch L36 的註解。

**【一定要改】2-2　`validateProfile` 等於第一次定義 `user_profile` 的格式。**
- PRD 裡完全沒有 `user_profile` 的欄位定義（grep 不到）。
- C3 規定：「改變已存在 store 的格式……偏離 PRD 才審」。現在 PRD 沒有規格可照，所以 commit 1 要在 PRD 補一張 profile 欄位表，作為 `validateProfile` 的唯一依據。
- 列舉值也有單一來源的問題：
  - 性別、活動量、目標、飲食限制目前只存在 `index.html` 的 `<option>` 裡（L37–L184）。
  - engine/nutrition.js 另外接受別名：male／m、cut、`activity_value`。
  - 如果在 db.js 再寫一份列舉，就成了第三份。
- 兩個修法擇一：
  - 把列舉搬到 `core/config.js`。
  - 或者 check-engine 解析 `index.html` 的 `<option>`，斷言它們是驗證器列舉的子集。
- 計畫 4.3 說要測「所有下拉組合」。如果列舉在測試裡寫死，就測不到兩邊不一致。

**【一定要改】2-3　C1.6：commit 2 改了 `js/data/db.js`，但計畫到 commit 3 才跑 stamp-version。**
- pre-commit 會跑 `check-arch --staged`（`tools/hooks/pre-commit`；check-arch L211–L230），commit 2 會直接被擋下。
- 修法：commit 2 也要跑 stamp-version。

**其餘幾條沒有衝突：**
- C1 分層：驗證和匯出放 db.js，ui 補時間與版本字串，engine 不參與。沒有衝突。
- C4.15：settings 的 key 名稱只出現在 db.js。沒有衝突。
- C4.16、C4.17：已處理。
- C1.5：寫入前先驗證，而且用 transaction。計畫符合。
  - 建議 check-engine 補一條：`importAllData([])` 傳陣列要報錯（比照 check-engine L833–L838）。

## 3. 格式與分層

**【建議】3-1　驗證放 db.js、單一 transaction「先 clear 再 put」、`location.reload()`，三項都同意。**
- `withStores` 在 fn 回傳的 promise 被拒絕時會 abort（db.js L69–L85），能做到全有全無。
- 用 `put` 而不是 `add`，所以 key 重複不會報錯、只會後蓋前。因此計畫要自己檢查 id 不重複，這點是對的。
- 還要加一條：`daily_log`、`exercise_log`、`custom_foods` 必須有非空字串的 `id`。
  - 原因：`validateDailyLog` 等驗證器都不檢查 `id`（db.js L163–L219）。
  - 缺 `id` 時 `put` 會出 DataError，整筆 transaction abort。資料不會壞，但錯誤訊息使用者看不懂。
- `recipe_feedback` 要檢查 key 跟 `recipe_template_id` 一致。
- 可以考慮 `db.transaction(..., {durability: "strict"})`。

**【建議】3-2　`<input type=file>` 不設 `accept`，同意。** 另外補三點：
- 讀檔前先擋檔案大小（例如超過 20 MB 直接拒絕），以免選到影片被整個讀進記憶體。
- `JSON.parse` 前先去掉 BOM（用 Windows 記事本存過的檔案會帶 BOM）。
- `app_version` 用 `new URL(import.meta.url).searchParams.get("v")` 取得，不要寫死。

**【建議】3-3　JSON 大小：縮排 2 格可以接受。** 每年大約 2–3 MB，幾年後到 10 MB 也還行，不必處理。

**【建議】3-4　處理其他開著的分頁。**
- 只在預覽加一句說明，擋不住別的分頁拿舊的記憶體狀態寫回去：
  - 基本資料的「計算」會存舊 profile（tab-profile L291–L293）。
  - `runCalibrationNow` 會存 `tdee_state`。
- 建議用一行 `BroadcastChannel("lighten2")`，還原後通知其他分頁重新整理。

## 4. 資料安全

**【一定要改】4-1　既有的飲食紀錄可能過不了現在的驗證器，會造成「匯出成功、永遠還原不了」。**
- 驗證器後來變嚴格過，但沒有搬舊資料（`DB_VERSION` 一直是 1）。
  - `053d5d7`（09-28 18:47）起：`totals` 必須有 `sat_fat_g`、`sodium_mg`、`partial`。
  - `9aa7db0`（09-29 06:52）起：自煮必須帶 `implicit` 物件，其他型態必須是 null。
- lighten2 資料庫從 `0020b71`（09-28 13:54）就開始用。使用者 09-29 在手機上測過（日後討論 L69）。所以手機上很可能有舊格式的紀錄。
- 計畫的 check-engine 只用「現有測資」測，這種情況抓不到。
- 另外，IndexedDB 的結構化複製會保留值是 `undefined` 的欄位，JSON 會把它丟掉。像 `"archetype_id" in c` 這類用 `in` 的檢查，來回一次後就可能失敗。
- 修法：
  - (a) `exportAllData` 之後，ui 立刻對「`JSON.stringify` 再 `JSON.parse`」的結果跑 `validateBackup`。
    - 有問題就在匯出當下用中性文字列出：「有 N 筆紀錄的格式較舊，這份備份目前無法還原」。
    - 這時資料還在手機上，沒有任何損失。
  - (b) smoke-browser 對「smoke 流程實際寫進去的全部資料」做同樣的來回驗證。
  - (c) 舊紀錄怎麼處理，屬於產品決定，見第 6 節問題 2 後面的補充。

**【一定要改】4-2　`saveProfile` 加驗證後，失敗會被吞掉或沒人處理。**
- 三個呼叫點：
  - `tab-profile.js` L290–L296 的 `onCalculate`：`catch` 只有 `console.error`，接著照樣顯示目標。使用者會以為存好了，其實沒存。
  - `tab-profile.js` L54 的 `removeDisliked`：沒有 catch。
  - `tab-today.js` L246 的 `onDislikeChipClick`：沒有 catch。舊 profile 一旦驗不過，使用者就再也加不了不吃項目。
- 另外，表單設了 `novalidate`（index.html L28）。年齡填 0 或負數時，`onCalculate` 只擋 null，會一路送到 `saveProfile`。
- 修法：這三處都要把驗證錯誤顯示給使用者（alert 或狀態列）。
- 驗證器必須放行 lighten2 開始使用以來寫過的所有形狀：
  - `allergens` 是舊的自由文字字串，或含非詞彙字串的陣列（`filters.js` L22–L39 的 `normalizeAllergens`；tab-profile L113–L121 的舊資料提示）。
  - `disliked_ingredients` 裡有舊的 `type`（decisions #40）。不檢查 `type` 列舉，只檢查 `key` 是字串。
  - `meal_prefs` 的值有 `"off"`，或整個欄位缺。
  - 缺 `enabled_slots`、`oil_habit`、`low_carb`。
  - `body_fat_pct` 是 null。
- 只擋兩種情況：型別錯誤，以及 engine 會丟錯的值（`calculateTargets` 認不得的性別）。

**【建議】4-3　取代語意下，計畫沒擋到的遺失路徑。**
- (a) 還原到比較舊的檔案：筆數對照看不出來（兩邊筆數可能差不多，內容卻不同）。
  - 建議預覽加每類「最後一筆日期」（檔案 vs 目前）。
  - 目前資料有晚於 `exported_at` 的紀錄時，用中性文字點出：「目前有 X 月 X 日之後的紀錄，還原後不會保留」。
  - 還原後會變成 0 筆的類別要特別標出。
- (b) 兩台裝置同時在用：取代會丟掉另一台的資料。PRD 11.6 要寫明「還原不是同步」。
- (c)「先匯出目前的資料」在 iOS 上可能靜默失敗。要不要強制，交給使用者決定，見第 6 節問題 2。

## 5. 驗收

**【一定要改】5-1　計畫第 7 項測不到 transaction 的全有全無。**
- 第 7 項用「壞檔」測試。壞檔在 `validateBackup` 就被擋下，根本沒開 transaction。
- 修法：在頁面裡暫時把 `IDBObjectStore.prototype.put` 改成第 N 次呼叫時丟錯，然後匯入一份合法的檔案。
  - 斷言 `importAllData` 回報失敗。
  - 斷言匯入前後的 `exportAllData` 逐字相同。
- 這項要放 smoke-browser（真的 IndexedDB）。
- 壞檔在碰到資料庫前就被擋，這一條可以在 check-engine 用 node 直接測，比照 check-engine L789 的現有模式。

**【一定要改】5-2　commit 3 會讓 diff-recs 整個載不起來。**
- 原因：
  - `tools/lib/adapter-v2.js` L17–L20 把 db.js 換成 `fake-db.mjs`，L50 會載入 `tab-profile.js`。
  - `tab-profile.js` 會 import `backup.js`，`backup.js` 再從 db.js import `exportAllData` 等函式。
  - `fake-db.mjs` 沒有這些 export，ES module 連結就失敗。
- `fake-db.mjs` 的開頭註明它的寫入驗證直接用真的 db.js。所以 `saveProfile` 也要改成呼叫真的 `validateProfile`，快照才測得到新驗證。
- `backup.js` 模組頂層不能碰 `document`、`FileReader`、`location`，因為 node 的假環境裡沒有這些。
- 計畫第 7 節的自查表寫「commit 3 前查 adapter-v2」。這條要改成明確的待辦：commit 3 同時修改 `fake-db.mjs`。

**【一定要改】5-3　保證以後的版本讀得了 v1。**
- 在 `tools/fixtures/` 凍結一份 `backup-v1.json`（每類至少一筆，含 profile 是 null 的版本）。
- check-engine 永遠斷言它經過 `migrateBackup` 加 `validateBackup` 能通過。
- PRD 的承諾「之後新增的 store 接得上、缺少的當成空的」，只有這樣才能被機器證明。
- 計畫目前的 4.4 只測了「v1 原樣回傳」。

**【一定要改】5-4　mobile-walkthrough 第 10 項還原的是跟目前一模一樣的資料，等於沒測。**
- 修法：匯出後先改資料（多記一餐、改體重或不吃清單），再還原，斷言改動消失。
- 另外補幾項：
  - 「先匯出目前的資料」按鈕確實有產生下載。
  - 按取消後資料不變。
  - 匯出當下的自我驗證有結果（見 4-1）。
- smoke-browser 或 walkthrough 用 `import('./js/data/db.js')` 時要寫明走 import map，才會跟 App 是同一個模組實體。

**【建議】5-5　分工同意計畫。**
- 純函式放 check-engine。
- 真的 IndexedDB 行為放 smoke-browser。
- UI 流程和截圖放 walkthrough。
- 使用者手機短清單補一條：用 Safari／Chrome 開，不要在 LINE 等 App 內建瀏覽器裡開，那裡下載常失敗。

## 6. 計畫第 6 節問題的回答

**問題 1（C4.12）：** 算修改 C4。理由和最小條文見 2-1。C4.16 能直接加 `backup.js`，是因為它的條文本來就寫成「職責白名單」；C4.12 沒有。

**問題 2（取代 vs 合併）：** 跟 PRD 11.6 不衝突。11.6 寫的是「若匯入會重新產生 id」，是條件句。但要做兩件事：
- commit 1 同步修改 B-4a、B-4b 列（PRD L258–L259）：寫明「id 改寫的斷言」只在合併匯入上線後才適用，B-3 的取代不會重新產生 id。否則那兩條驗收會變成空轉。
- 計畫沒擋到的遺失路徑見 4-3。

有兩件事屬於產品決定，交給使用者：
- **(A) 還原前要不要強制先匯出？**
  - 選項 1：照計畫，按鈕可按可不按。
  - 選項 2：目前資料不是空的時，要按過「先匯出」或勾「目前的資料不需要保留」，才能按還原。
  - 我建議選項 2。在 iOS 上下載失敗不一定看得出來，取代又沒有復原的方法。
- **(B) 舊格式紀錄怎麼處理（4-1）？**
  - 選項 1：`migrateBackup` 只修機械上安全的缺欄。例如 `totals` 缺 `sat_fat_g`、`sodium_mg` 補 null，這符合 B5.1「未知寫 null」。其他照樣擋下。
  - 選項 2：預覽列出不合法的筆數，由使用者按「略過這 N 筆後還原」。
  - 選項 3：全部擋下。
  - 我建議先做 4-1 的匯出自我驗證，看使用者手機實際的結果再決定。如果只有 09-28／29 的測試紀錄，選項 2 最單純。

**問題 3（`validateProfile`）：** 「缺的欄位當預設值」不夠。要同時做到三件事，見 4-2 和 2-2：
- 放行舊的自由文字 `allergens` 和舊的不吃項目 `type`。
- 三個呼叫點不能吞掉錯誤。
- 列舉只能有單一來源。

**問題 4（`recipe_feedback`）：** 全部備份，同意。
- `shown_count` 會影響推薦的扣分（decisions #39）。只備份 `rating` 的話，還原後推薦就不同，計畫第 6 項「還原後逐字相同」也無法成立。
- 這些資料沒有隱私上的額外疑慮。

**問題 5（`tdee_state`）：** 要備份，同意。
- 它含 `pending`、`dismissed_until`、`offset_kcal`，以及使用者按過套用或先不要的結果（tab-profile L275–L289；`calibration.js`）。這些無法從紀錄重算。
- 驗證「物件且有 `version`」夠寬，不會誤擋。

**問題 6（`schema_version` 跟 `DB_VERSION` 分開）：** 沒問題。條件是：
- 在 db.js 的 `DB_VERSION` 旁邊定義 `BACKUP_SCHEMA_VERSION`，註解寫明什麼時候 +1。
- 配合 1-2 的「每個 store 都對應到區塊」斷言，和 5-3 的凍結 fixture。
- 驗證要求 `schema_version` 是 ≥ 1 的整數。

**問題 7（驗收是否足夠）：** 不夠，見 5-1 到 5-4。放 smoke-browser、不引入假的 IndexedDB 是合理的，不必為這個加依賴（C3）。但有兩條要補進 check-engine：
- 壞檔在碰到資料庫前就被擋（node 裡測得到）。
- 凍結的 v1 fixture。

## 7. commit 拆法

**【一定要改】7-1　commit 1（文件）要補齊三項：**
- CHARTER C4.12 的條文修改，加上 C3 審核紀錄逐字存檔（2-1）。
- PRD 的 profile 欄位表（2-2）。
- PRD B-1a、C、Phase 2、B-4a、B-4b 各列的匯出匯入責任和 C4.17 清單（1-1、問題 2）。

commit 4 只保留交接。

**【一定要改】7-2　commit 2 和 commit 3 各要補：**
- commit 2：
  - 加 stamp-version（2-3）。
  - 加 `fake-db.mjs` 的 `validateProfile`。
  - 修好三個 `saveProfile` 呼叫點的錯誤顯示（4-2）。這屬於行為改變，C6.6 要求同一個 commit 更新 PRD 對應章節，或者確認 commit 1 已經寫好。
- commit 3：
  - `fake-db.mjs` 補上新的 export（5-2）。
  - smoke-browser 和 walkthrough 的新斷言（5-1、5-4）。

依 C5 精神，commit 2 的斷言也要包含：
- 用「舊格式 profile」測資證明不會被誤擋。
- 用「舊格式 daily_log」測資，照使用者選的 4-1 方案，證明匯出自我驗證有抓到。

**總結論：先修改計畫。** 修完 10 項一定要改、使用者決定 6-2(A)(B) 後即可開工。

---

## 第二輪：送審問題（逐字）

第二輪審核。計畫已依你的第一輪意見改成第二版：`docs/review/2026-09-29-B3-實作計畫.md`（方括號〔1-1〕等標出對應你的哪一條）。你的第一輪問答已逐字存在 `collab/opus-review-log/2026-09-29-b3-plan-review.md`。

我沒有照單全收的地方，請特別判斷是否可以接受：
1. 〔2-2、4-2、1-5〕不改 `saveProfile`（三個呼叫點不動，另排到日後討論）；`validateProfile` 只給還原用，只驗型別，不在 db.js 寫選項列舉；選項值（性別、活動量、目標）改由 `backup.js` 在預覽時對檔案的 profile 呼叫 engine 的 `calculateTargets` 試算，丟錯就擋。這樣是否解決了你的「第三份列舉」與「吞錯」兩個疑慮？有沒有 `calculateTargets` 不丟錯、但 engine 其他地方會壞的 profile 值？
2. 使用者決定 A、B 先照你建議的預設實作（A 選項 2；B 先做自我驗證＋全部擋下，看手機實際結果再決定）。使用者目前不在，回來再確認。
3. 格式照你的 1-3 改了：拿掉 `scope`、recipe_feedback／settings 改 `[{id, value}]`、加 `manifest`。

請只讀不改，照第一輪格式回覆：逐條確認第一輪的【一定要改】是否已解決（已解決／部分／未解決＋理由），第二版新引入的問題標【一定要改】或【建議】，最後一行寫總結論（可以開工／要先修改計畫）。

Address this before completing your current task.

---

## 第二輪：審核回覆（逐字）

# B-3 實作計畫第二輪審核

**結論：要先修改計畫。** 第一輪 10 項一定要改，8 項已解決、2 項部分解決；第二版另有 3 項新的一定要改（N1–N3），都是小改。你特別問的第 1 點，條件式可以接受，條件見 2-2 與 N2。只讀，沒改任何檔案。

## 一、第一輪【一定要改】逐條確認

| 第一輪 | 狀態 | 理由 |
|---|---|---|
| 1-1 各工作線的匯出責任 | 已解決 | 2.1 第 11 項把 B-1a、C、Phase 2、B-4a、B-4b 都列了，也寫了 C4.17 清單與「id 改寫」適用範圍。 |
| 1-2 機器保證 store 與 key 跟上 | 已解決 | 有 `Object.values(STORE)`、`BACKUP_SECTIONS`、`SETTING_KEYS`，`setSetting` 拒絕表外 key，並有 check-engine 第 7 項。補充建議見 S1。 |
| 2-1 C4.12 改章程 | 已解決 | 條文和我提議的一致；有 decisions #72；commit 1 含 CHARTER。這一輪審核可以當作 C3 的獨立審核，前提是逐字存檔。 |
| 2-2 profile 格式與第三份列舉 | 部分 | 「第三份列舉」解決了（db.js 不寫選項）。但用 `calculateTargets` 當選項值的關卡，涵蓋範圍比計畫寫的小，見下面第二節，要改 N2。 |
| 2-3 commit 2 要跑 stamp-version | 已解決 | 第 5 節 commit 2、3 都有。 |
| 4-1 舊格式紀錄／匯出後永遠還原不了 | 已解決 | 匯出時自我驗證，check-engine 第 4 項和 smoke 第 9 項都會測。 |
| 4-2 驗證失敗被靜默吞掉 | 已解決（改用另一種方式） | 我第一輪擔心的前提是「`saveProfile` 加驗證」。第二版不改 `saveProfile`，三個呼叫點的行為就跟現在一樣，不會多出吞錯的路徑。寫入前不驗證 profile 是既有缺口（C1.5），已登記到日後討論。**可以接受。** |
| 5-1 全有全無 | 部分 | 斷言設計對了，但照現在的 `withStores` 一定會失敗，計畫沒寫要先修，見 N1。 |
| 5-2 fake-db 與 adapter | 已解決 | 補 export、`backup.js` 頂層不碰 DOM。 |
| 5-3 凍結 fixture | 已解決 | check-engine 第 6 項。 |
| 5-4 walkthrough 還原要先改資料 | 已解決 | 第 13、16 項。 |
| 7-1 commit 1 範圍 | 已解決 | — |
| 7-2 commit 2、3 範圍 | 已解決 | `saveProfile` 那部分因為決定不改而不再需要。 |

## 二、你特別問的第 1 點：`calculateTargets` 當關卡

**「第三份列舉」：解決了。** 選項值沒有在 db.js 再寫一份。

**「吞錯」：不改 `saveProfile` 就不會新增吞錯的路徑。可以接受。**

**有沒有 `calculateTargets` 不丟錯、engine 卻會出問題的 profile？有。** 依據是 `js/engine/nutrition.js` L8–L130、`filters.js` L55–L62、`today.js` L23–L37：

| 欄位 | 檔案裡的值 | engine 實際行為 |
|---|---|---|
| `goal_mode` | 不認得的值 | 不丟錯，默默當成「維持」（乘數 1.0，L99–L103）。 |
| `activity_mode` | 不認得的值 | 不丟錯，默默用久坐 1.2（L38–L46）。 |
| `age`／`height_cm`／`weight_kg` | null | `Number(null)` 是 0，是有限數字，所以不丟錯，算出一個離譜的目標。第二版的 `validateProfile` 又允許這三個是 null，兩道關卡都放行。 |
| `diet_restriction` | 不認得的值 | 不會壞，而是往保守方向走：每個候選都要帶那個標籤，結果全部被擋掉，推薦變成空的。 |
| `activity_value`、`protein_g_per_kg`、`fat_pct`、`fiber_target_g` | 表單沒有這些欄位，但 engine 會讀 | 計畫的欄位表沒提到。手改的檔案塞進數字，會影響目標，但不會丟錯。 |

所以只有「性別不認得」和「數值不是有限數字」會被 `calculateTargets` 擋下。目標、活動量、飲食限制的錯值只會變成錯的目標或空的推薦，不會讓程式崩潰。

這些情況都只會出現在手改過的檔案。App 自己寫進去的 profile 一定來自表單，而 `onCalculate` 在 L275 已經擋了 null。所以結構上可以接受，但計畫和 PRD 不能寫成「選項值由 engine 判斷」，要照 N2 修正。

## 三、第二版新引入的問題

**N1【一定要改】`withStores` 遇到同步丟錯時不會 abort，全有全無會破功。**
- 位置：`js/data/db.js` L72–L77。`fn(stores)` 是在 Promise 的 executor 裡同步呼叫的。
- 情境：`fn` 已經送出 `clear()` 和前 4 筆 `put`，第 5 筆 `put` 同步丟錯。
  - 同步丟錯只會讓外層 promise 被拒絕。
  - 不會進到 L77 的 `tx.abort()`。
  - 這時 transaction 還掛著未完成的請求，會照樣 commit，結果是「已清空、只寫了 4 筆」。
- 這不是假設的情況：IndexedDB 的 `put()` 遇到 DataError（keyPath 缺值或 key 不合法）、DataCloneError 都是同步丟錯。
- 計畫 smoke 第 11 項讓 `put` 第 5 次呼叫丟錯，正好會重現這個 bug，但計畫沒寫要修。實作者可能改成「非同步錯誤」讓測試通過，bug 就留著了。
- 修法：commit 2 把 `fn(stores)` 包進 try/catch，catch 裡 `tx.abort()` 再 reject；並照 C5 先讓第 11 項失敗、再修到通過。
- 這個測試要真的 IndexedDB，只能放 smoke-browser，所以要在計畫裡寫明第 11 項必須用同步丟錯，並附上這段說明。

**N2【一定要改】`validateProfile` 要求三個數值欄位非 null，並修正計畫與 PRD 的說法。**
- 修法一：profile 不是 null 時，`age`、`height_cm`、`weight_kg` 必須是有限正數，不能是 null。
  - 這不會誤擋既有資料：profile 只由 `onCalculate` 建立，它在 `tab-profile.js` L275 已經擋 null；`removeDisliked` 和 `onDislikeChipClick` 在沒有 profile 時直接 return。
  - `body_fat_pct` 維持可以是 null。
- 修法二：2.1 第 8 項和 PRD 的欄位表寫明：
  - 性別不認得、數值非有限數字 → 擋下。
  - 目標、活動量不認得 → engine 會退回預設值（維持、久坐），不擋。
  - 飲食限制不認得 → 保守方向，推薦會變空。
  - `activity_value` 等四個 engine 會讀的非表單欄位，列出來，只驗「數字或缺」。
- 修法三：profile 是 null 時不要呼叫 `calculateTargets`（它第一行就會丟「缺少 profile」）。

**N3【一定要改】`manifest` 的產生位置前後矛盾，smoke 第 9、10 項會失敗。**
- 3.2 寫由 ui 補 `manifest`，但 3.1 規定 `validateBackup` 要檢查 manifest 跟實際筆數一致。
- smoke 第 9、10 項把 `exportAllData()` 的原始輸出直接拿去驗證和匯入，那份輸出沒有 manifest，會被拒絕。
- 修法：讓 db.js 的 `exportAllData` 自己算 manifest。manifest 是資料推導出來的，跟 `summarizeBackup` 放同一處也符合 C2。ui 只補 `exported_at`、`app_version`。
- 同時寫明 `validateBackup` 是否要求 `exported_at`。smoke 要嘛也補上這兩個欄位，要嘛驗證器對它們放寬。

**S1【建議】`setSetting` 也跑每個 key 的驗證函式，不只是檢查 key 在不在表上。**
- C1.5 要求寫入前先驗證。照現在的做法，App 仍然寫得進備份驗證器會拒絕的值，等匯出時才被自我驗證發現。
- 目前兩個 key 的實際寫入端都符合驗證：`picker_last_meal_type` 寫的是 `content.meal_type`，屬於 `MEAL_TYPES`（meal-picker L511）。所以加上不會誤擋。
- `SETTING_KEYS` 也可以預留一個標記「只准專用函式讀寫」，給 B-4a 的 `favorite_ingredient_ids` 用（C4.17②、decisions #69）。

**S2【建議】使用者決定 A 的「目前資料不是空的」要定義清楚。**
- 新裝置打開 App 顯示推薦後，`markRecipesShown` 就會寫進 `recipe_feedback`，所以資料庫永遠不會是完全空的。
- 建議定義為：沒有 profile，而且 `daily_log`、`weight_log`、`exercise_log`、`custom_foods` 都是 0 筆。

**S3【建議】BroadcastChannel 的收發細節。**
- 同一個頁面裡，`app.js` 的接收端也會收到 `backup.js` 發出的訊息，因為它們是不同的 channel 物件。
- 建議訊息帶一個發送者 id，接收端忽略自己頁面發的；而且只在 transaction 完成後才發送。
- 沒做的話會重新載入兩次，不會壞資料。

**S4【建議】「晚於 `exported_at` 的紀錄」用哪個欄位比較，要寫明。**
- 建議用 `created_at`（`daily_log`、`custom_foods`）。
- `log_date` 可能是補記的過去日期，拿來比較會漏掉在匯出之後才補記的紀錄。

## 四、使用者決定

- A 選選項 2、B 先做自我驗證加全部擋下：同意這樣當預設。
- 計畫已寫明 A 改回選項 1 只要拿掉一個條件，B 依短清單第 18 項的結果再決定。使用者回來確認即可，不擋開工。
- 格式照 1-3 修改（拿掉 `scope`、改用陣列、加 `manifest`）：同意。唯一要處理的是 N3。

總結論：要先修改計畫（改完 N1、N2、N3 就可以開工，不需要第三輪全面審核，改完後核對一次就好）。

---

## 第三輪（核對）：送審問題（逐字）

核對。計畫已改成第三版（同一個檔案 `docs/review/2026-09-29-B3-實作計畫.md`），照你說的只需核對一次：N1（withStores 同步丟錯修正、smoke 第 11 項必須同步丟錯、C5 先失敗再修、移到 commit 2）、N2（profile 非 null 時三個數值欄位必須有限正數；calculateTargets 只在 profile 非 null 時呼叫；如實寫明哪些錯值不擋；四個非表單欄位驗數字或缺）、N3（manifest 由 exportAllData 算；exported_at／app_version 放寬），另外 S1–S4 也採納了。請只讀不改，逐條回「已解決／未解決＋理由」，若核對時發現新的【一定要改】也列出，最後一行寫總結論（可以開工／要先修改計畫）。

Address this before completing your current task.

---

## 第三輪（核對）：審核回覆（逐字）

# B-3 實作計畫第三版核對

**可以開工。** 第二輪的 N1–N3、S1–S4 都已解決，沒有新的【一定要改】。只讀，沒改任何檔案。

| 項目 | 結果 | 依據 |
|---|---|---|
| N1 `withStores` 同步丟錯 | 已解決 | 3.2 表格的 db.js 列寫了用 try/catch 包起來，同步丟錯時 `tx.abort()` 再 reject，也寫明原因（DataError、DataCloneError 是同步丟的）。<br>smoke 第 11 項明訂要「同步丟錯」，並禁止改成回傳失敗的 request。<br>照 C5 在 commit 2 先確認這條會失敗、再修到通過，同一個 commit 完成；commit 2 也會跑 smoke。<br>我推演過：在現在的 `withStores` 下，第 5 次 put 丟錯時，Promise executor 會同步拋出，已送出的 `clear()` 和前 4 筆 put 照樣 commit，所以這條斷言確實會先失敗。 |
| N2 profile 驗證 | 已解決 | 2.1 第 8 項：profile 不是 null 時，age／height／weight 必須是有限正數，理由寫得正確。`body_fat_pct` 是 null 或有限正數。<br>四個表單沒有的欄位（`activity_value`、`protein_g_per_kg`、`fat_pct`、`fiber_target_g`）驗「數字或缺」。<br>`calculateTargets` 只在 profile 不是 null 時呼叫。<br>計畫也照實寫明哪些錯值不擋：目標、活動量會退回預設，飲食限制會變成保守方向。 |
| N3 manifest | 已解決 | 3.1 下方說明：manifest 由 `exportAllData` 算，`exported_at`、`app_version` 驗證時放寬（有的話要驗、缺了放行）。smoke 第 9、10 項可以直接用 `exportAllData()` 的輸出。 |
| S1 `setSetting` 驗值 | 已解決 | 第 7 項寫了。第 12 項有斷言。<br>我查過 `tdee_state` 從 −1a（`0020b71`）起預設就有 `version: 1`，所以不會誤擋既有寫入。 |
| S2「目前是空的」 | 已解決 | 定義寫在 2.1 第 3 項（「先匯出目前資料」那一小點）。 |
| S3 BroadcastChannel | 已解決 | transaction 完成後才發送，訊息帶發送者 id，接收端忽略自己頁面發的。 |
| S4 用 `created_at` | 已解決 | 寫在 2.1 第 3 項的預覽說明。 |

**新發現：只有一個文字小瑕疵，不擋開工。** 3.2 表格 db.js 列的結尾還寫著「`setSetting` 加 key 檢查」，沒跟上第 7 項的「key 與值都檢查」。順手改成一致就好。

使用者的決定 A、B 維持第二輪結論：先照建議的預設做，使用者回來確認即可，不擋開工。

總結論：可以開工。
