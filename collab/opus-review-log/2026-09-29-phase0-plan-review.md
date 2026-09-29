# Phase 0 實作計畫審核

日期：2026-09-29　實作者：Opus（Lighten2 主導開發）　審核者：新開的獨立 Opus agent

## 第一輪：送審問題（逐字）

你是 Lighten2（個人減脂飲食 App，純前端 vanilla JS＋IndexedDB，repo 在 `D:\ok\lighten`）Phase 0 實作計畫的獨立審核者，不是實作者。**只讀不改**任何 repo 檔案。用中文回答。

要審的是 `docs/review/2026-09-29-Phase0-實作計畫.md`。它把 round2 審核寫的 Phase 0 規格（`collab/opus-review-log/2026-09-28-prd-2.0-architecture-round2.md` 第 2 節，寫在 −1a／−1b 之前、用 v1 名稱）對照現在的程式重寫，並併入 −1b 手機實測發現的問題。

依據：`docs/PRD.md`（第 2、3、4、6、7、9、10 節）、`docs/CHARTER.md`（A、C 全部，特別是 C1、C2、C4、C5、C6）、`docs/decisions.md`、`docs/日後討論.md`（最後兩節）、現在的程式（`js/ui/manual-picker.js`、`js/ui/item-picker.js`、`js/engine/meal-content.js`、`js/engine/filters.js`、`js/engine/pool.js`、`js/data/db.js`、`js/core/config.js`、`index.html`）、測試工具（`tools/check-engine.js`、`tools/diff-recs.js`、`tools/lib/adapter-v2.js`、`tools/mobile-walkthrough.mjs`）。

請審：
1. 計畫第 2 節的範圍有沒有漏掉 PRD Phase 0 列或 round2 2.x 仍然有效的項目；有沒有做了不該在 Phase 0 做的。
2. 計畫跟 PRD、章程、decisions 有沒有衝突（例：C1 分層、C2 單一來源、C4.1 硬性過濾、C4.5 null 傳染、C4.8 手動記錄、C4.11 隱含成分、C4.12 運動脫鉤、C4.13 不評判、C4.15 picker_last_meal_type、PRD 6.1、6.3 自組原則）。
3. 第 3 節的程式結構是否合理（engine/ui 分界、要不要新資料夾、多選自煮對現有 `composeTotals`／`contentFromCompose`／推薦候選池的影響、MealContent 格式是否需要改）。
4. 第 4 節驗收清單是否足以證明做對了，特別是哪些要 check-engine 斷言、哪些靠 mobile-walkthrough。
5. 回答第 6 節列的問題 1–9。其中第 2 題（手動主餐上限）如果你判斷是產品決定、應該交給使用者，請寫出建議選項與理由。
6. 第 5 節 commit 拆法與順序是否符合章程 A1（先改 PRD/decisions 再改程式）與 C5（修 bug 先寫失敗斷言）。

格式：每個發現標【一定要改】或【建議】，附依據（檔案與行號或章節）。最後一行寫總結論（計畫可以開工／要先修改計畫）。

---

## 第一輪：審核回覆（逐字）

# Phase 0 實作計畫 獨立審核意見（第一輪）

審核對象：`docs/review/2026-09-29-Phase0-實作計畫.md`（以下簡稱「計畫」，行號指這個檔案）
我讀過的：PRD 全文、CHARTER 全文、decisions #1–#40、日後討論最後兩節、round2 全文，以及計畫依據列出的所有程式與工具。另外用 `git archive HEAD` 複製到暫存目錄跑了實驗：目前 check-engine、diff-recs 全過；刪掉 `js/ui/item-picker.js` 之後 check-engine 立刻 `ERR_MODULE_NOT_FOUND`。repo 檔案沒有改動。

---

## 1. 範圍（計畫第 2 節）

**1-1【一定要改】快速新增會讓素食使用者、有設過敏原的使用者走進死路**
- 計畫 L32 寫「過敏原預設未確認；`vegan`/`lacto_ovo` 一律 false；存完直接選中」。驗收 L65 又寫「過敏原未確認的在有設過敏原時被擋」。
- 兩者合起來：有設過敏原的人照預設存，存完那一筆馬上變灰，「直接選中」做不到。
- 素食使用者更嚴重：不管過敏原怎麼填，`vegan:false` 一律被擋。`tools/snapshots/picker.txt` 裡 `custom_a:飲食限制未確認` 就是這個情況。
- 編輯畫面要到 B-1 才有，所以使用者存完只能重建一筆。PRD 10.4（L327）承諾過「不會出現被擋住卻無處可改的死路」，這裡直接違背。
- 依據：PRD 10.1、10.4；章程 C4.1（自訂食物沒有例外，所以不能用放行來解）、B6.5。
- 要改成：
  - 表單在使用者有設過敏原或飲食限制時，送出前就用中性文字預告「以你目前的設定，這樣存會不能選」，讓他當場改填「確認不含」。
  - 使用者有設飲食限制時，表單要多「全素／蛋奶素」宣告欄。這是 PRD 0.1 第 9 點列的四個欄位以外的新增，要在 commit 1 的 PRD 10.3 一併寫進去。
  - 定義「存了但被擋」時的行為：不選中，並提示原因。

**1-2【一定要改】快速新增漏了 PRD 10.3 的「更多（選填）」**
- PRD 10.3（L323）寫「其餘欄位收在『更多（選填）』」，計畫 L32 只寫「其餘營養欄位 null」。
- 沒有蛋白質欄，B-2 的「有 kcal/protein_g 才進推薦」（PRD 10.5）就永遠不成立，要等 B-1 才能補。
- 二選一：照 PRD 做（至少蛋白質放進「更多」），或在 commit 1 修 PRD 10.3 並記 decisions。

**1-3【一定要改】用油選項違反章程 B5.6**
- 章程 B5.6（CHARTER L155）的原文是：「用煎或炒時可以改用油量，選項＝預設用油、約 1 茶匙、約 2 茶匙（相同的只列一次）」。decisions #13 也只寫 1 或 2 茶匙。
- 計畫 L29 有三處不符：
  - 多了「不用油」；
  - 沒限定只在煎、炒時出現（氣炸、微波、免開火預設本來就是 0，不該有選項）；
  - 沒寫相同的選項只列一次（少油習慣時，炒＋蔬菜的預設剛好也是 5g）。
- 加「不用油」等於修改章程，屬於 C3。但 commit 1（L74）沒有列要改 CHARTER。
- 建議：Phase 0 照 B5.6 原文做；「不用油」跟日後討論 L60 的「不加調味」放在同一批送 C3。理由見第 5 節第 6 題。

**1-4【建議】日後討論登記給「Phase 0 或 B-1」的一項沒有處理**
- 「基本資料改了設定要按『計算』才會存」（日後討論 L70）登記的去向是「Phase 0 或 B-1」，計畫沒有處理。
- 計畫第 2 節的「不做」要明寫去向，不然就懸空了（章程 A1.3 的精神）。
- 「營養素百分比誤解」屬於 today-hero，不在選擇器範圍，計畫沒收是對的，建議也在「不做」列一行。

**1-5【建議】round2 還有效、但計畫沒寫到的細節**
- 飲料步驟裡被擋的飲料要灰階並寫原因（round2 2.6）；
- 「我的品項」組預設收合（2.4）；
- `settings` 讀取失敗當空物件、不擋 modal（2.5）。計畫 L33 只寫了寫入失敗怎麼處理。
- `resolveDefaultMealType` 保留 `planned` 參數（round2 1.4 的 `({ planned, pref, lastPicked })`），Phase 2 就不用改簽名。計畫 L47 的 `(slot, mealPrefs, lastPicked)` 到時要改介面。

**1-6【建議】沒有做了不該在 Phase 0 做的事**
- 「不做」清單（L42）正確。
- 44px 與 sticky 只限選擇器也合理。「順便不要」晶片等其他地方的 44px 不在範圍，建議在「不做」註明去向。

---

## 2. 跟 PRD、章程、decisions 的衝突

**2-1【一定要改】分組方式跟 PRD 6.3 不一致**
- PRD 6.3（L228）寫「依角色分區/排序顯示（主餐、配菜在前，飲料獨立一步）」，計畫 L21 只寫依 `category` 分組、照資料順序。
- 實際資料的順序：超商依 category 會是「沙拉（配菜）→ 健身餐盒（主餐）→ … → 蛋白飲/點心棒（點心）」；台式在下午茶只有點心。
- 要嘛規定「組的順序依組內最前面的角色（main → side → snack），組內照資料原順序」，要嘛在 commit 1 修 PRD 6.3 的文字。兩者現在互相矛盾（章程 A1.2）。

**2-2【一定要改】commit 1 要改的 PRD 段落不只 Phase 0 列和第 4 節**
計畫 L74 只列這兩處，還至少要改：
- PRD 第 3 節 L120–121：自己選的 `meal_type`「看第一個主餐」與「−1a 過渡」兩條，改成「分頁／子切換的值」。decisions #34 已經預告要改。
- PRD 第 7 節 Phase 0 的驗收欄：現在寫「round2 第 2.10 節驗收清單」，要改成指向這份計畫的驗收清單。
- 如果第 5 節第 2 題改成主餐上限 2：PRD L108 與 `MANUAL_ROLE_MAX` 的說明。
- 1-2、1-3 決定後對應的 PRD 10.3 與 CHARTER B5.6。

**2-3【一定要改】自煮的送出規則（含免開火食安）留在 ui，多選後最容易出錯**
- 現在的 `composeMissingReason`（manual-picker.js L208–220）放在 ui，裡面有免開火食安檢查（L214–218），跟 pool.js L68 是同一條規則的第二份實作。
- 改成陣列之後，「任一個蛋白質或蔬菜需要加熱」要攤平判斷，這正是會漏掉第二個元素的地方。
- 章程 C4.3 要求這條有 engine 斷言，C2 要求單一來源。
- 計畫 L48 只有 `composeAxisProblem`（軸上限）。要改成 engine 的一個 `composeProblem(draft, { tier })`，一次涵蓋：
  - 必選欄位；
  - 骨架 `allow`（PRD 6.3）；
  - `COMPOSE_MAX`；
  - 免開火；
  - 快煮 tier。
- 平行工作線 C 的 `resolveSavedMeal` 之後也呼叫同一個函式。

**2-4【建議】快煮 tier 規則要有單一來源，不要從 picker.js 出口**
- `≤1` 這條規則現在有三份：recommend.js L29–31 與 L38、meal-content.js L349–351 的 `cookMealType`、pool.js L84。
- 計畫 L26 說要「搬到 engine 共用」，但 L47 放在 `engine/picker.js`。這樣推薦要 import 選擇器模組，方向怪；不 import 又變成第四份。
- 建議在 `core/config.js` 的 `tierRank` 旁邊加 `QUICK_MAX_TIER_RANK = 1` 或 `isQuickTier(rank)`，三處加上 picker 一起引用。
- 用 pool/recs 快照完全不變來證明沒改到推薦。

**2-5【建議】C4.15 的 grep 會掃到註解**
- check-arch L304–309 用 `f.src`，包含註解。
- `engine/picker.js` 連註解都不能出現 `picker_last_meal_type` 這個字串，只能收 `lastPicked` 參數。建議在計畫寫明，免得實作時被擋。

**2-6【建議】估算元件不過硬性過濾，要明寫**
- 估算是使用者自己宣告「吃了什麼」，不是 catalog 品項，沒有過敏原資料可以判斷。這不違反 C4.1，但計畫要寫一句，避免實作者去套 `passesHardFilters`。

**2-7 確認無衝突的項目**
- C1 分層；
- C4.8 手動規則；
- C4.12（check-arch 已經限制 engine 出現 exercise、`getExerciseLogs` 只能在白名單檔案用）；
- C4.13（組內照原順序、不上色）；
- PRD 6.1 飲料不做糖量警告；
- `picker_last_meal_type` 三條硬規則；
- check-arch 已預留 `js/ui/meal-picker/` 白名單（L28、L40）。

---

## 3. 程式結構（計畫第 3 節）

**3-1【一定要改】要有一條「草稿 → MealContent → 合計」的 engine 路徑，摘要和送出共用**
- 現在摘要與送出各算一次（manual-picker.js L272–329 與 L354–387）。
- Phase 0 會有三種組法：商品＋估算＋飲料、自煮＋飲料＋`implicit` 覆寫。
- 飲料搬出 `compose` 之後，`composeTotals`（meal-content.js L242–245 把 `c.drink` 算在裡面）不能再包飲料。這時 ui 很容易自己把兩個合計相加，章程 C4.11 的 check-arch 只是啟發式，擋不完整。
- 建議照 round2 2.7/2.9 的精神，在 engine 定兩個函式：
  - `buildDraftContent(state, …) → MealContent`；
  - `contentTotals(content, catalog, implicitItems)`：依元件種類加總，含主要槽位縮放、隱含成分、null／鈉規則。
- 摘要和送出都只呼叫這兩個，保證「看到的＝存下的」。Phase 2 計畫、Phase 3 日曆、平行工作線 C 的組合熱量也會用到同一個函式。

**3-2【建議】MealContent 格式不用改**
- 多個同軸的 `ingredient` 元件、`estimate`、`implicit` 都已經在 PRD 第 3 節格式與 db.js L136–161 的驗證範圍內。
- 要補的是 check-engine 斷言：「engine 產生的每一種 content 都通過 `validateDailyLog`」，涵蓋自煮 2 蛋白質＋3 蔬菜＋飲料、只有估算、估算＋商品＋飲料、只有飲料。

**3-3【建議】`implicit` 覆寫要跟預設分開存**
- 狀態存 `implicitOverride = { oil_g?, seasoning? }`，實際值＝覆寫值 ?? 預設值（`defaultImplicit`）。這樣有三個好處：
  - 換醬料時「未覆寫就跟著 decisions #28 改成清淡」自然成立；
  - 換成不能選用油的烹調法時清掉用油覆寫；
  - 平行工作線 C 的 `toSavedContent(…, { keepImplicit })` 需要知道「使用者是否改過」（PRD 11.1 入口 1），現在就有這個資訊。

**3-4【建議】手動記錄規則要認得估算**
- `manualSelectionProblem` 現在用 `items.length === 0` 判斷「沒選東西」（meal-content.js L190）。估算沒有 `role`。
- 要定義「只有估算」或「估算＋商品」怎麼算：估算不佔角色名額，但算「有選東西」。

**3-5【一定要改】自煮分頁「只有飲料」怎麼處理，要寫清楚**
- 驗收 L60 說「只選一杯飲料可以送出（任何時段）」，但沒說是哪個分頁。
- 晚餐預設停在 `cook_full`。如果自煮分頁沒選餐型、只選了飲料，會變成 `meal_type: cook_*` 加上一個沒有意義的 `implicit`。
- 建議規定：自煮分頁要餐型完整才能送出，只記飲料請到超商／外食分頁。提示文字要寫出這一點。

**3-6【建議】新資料夾 `js/ui/meal-picker/` 合理**
- check-arch 已預留；`stamp-version.js` 的 `walk` 支援子資料夾。
- `engine/picker.js` 的意見見第 5 節第 8 題。

**3-7【建議】多選對推薦候選池沒有影響，但資料備註要跟著改**
- 推薦維持單一蛋白質／蔬菜是對的，pool 快照應該完全不變。
- `protein_stir_fry` 的 note 寫「毛豆仁跟蝦仁擇一」（decisions #37）。多選之後「蝦仁＋毛豆仁」變成可行（其實就是原型食譜「清煎蝦仁毛豆炒蛋」），這句 note 會過時，順手改。
- 多個蔬菜時用油維持「有蔬菜就 +5g」（`defaultImplicit` 是布林判斷），計畫要寫一句這是刻意的。

---

## 4. 驗收清單（計畫第 4 節）

**4-1【一定要改】補明確的「不變」條件**
- 整個 Phase 0 每個 commit 的 `recs/pool/matrix/tdee` 快照都要逐字不變，只有 `picker/ui` 快照可以變。
- 驗收 L66 只提「記錄這餐不變」，不夠。

**4-2【一定要改】手機截圖發現的畫面問題要有自動檢查**
- 登記的問題是：剛打開底部溢出、步驟編號跳號、44px（日後討論 L79–81）。
- 驗收清單裡都沒有對應項目。依章程 C5.2，要在 mobile-walkthrough 加：
  - 390×844 剛打開時，「記下這餐」在視窗內，不用捲動；
  - 步驟編號連續；
  - 選擇器內元素低於 44px 從「警告」升級成「失敗」。

**4-3【建議】check-engine 至少要有這些斷言**
- `resolveDefaultMealType`：plan、pref、last、fallback 的優先順序表，含 `"auto"`、`"off"`、undefined、不合法的 last 值。
- 商品分組：
  - 分頁內沒有飲料；
  - 我的品項依 `channel` 進分頁、`role: drink` 的進飲料步驟；
  - 整份餐盒有列出；
  - 順序等於資料原順序（直接斷言「不是依熱量排」）；
  - 被擋的排在組內最後。
- 快煮 tier 與推薦一致：對候選池每個自組組合，「推薦 `cook_quick` 會收」⇔「picker 不會灰掉它任何一個元件」。
- `composeProblem`：
  - 免開火＋第二個蛋白質需要加熱 → 擋；
  - 超過 `COMPOSE_MAX`、不在 `allow` → 擋；
  - 快煮下選了 🔴 → 擋。
- 多選合計：
  - 等於各元件相加；
  - 只有主要槽位乘倍數；
  - 用油與調味不縮放（C4.6）；
  - 覆寫用油之後合計跟著變；
  - 有醬料時預設清淡。
- `contentFromCompose`：`meal_type` 等於傳入的子切換值。反例要測：全部 🟢 但選「開伙」，結果仍是 `cook_full`，不重新推導。
- 估算：
  - 快照的蛋白質、碳水、脂肪、纖維、鈉都是 null；
  - 跟商品合計時蛋白質 null 傳染，鈉照加有資料的部分並標 partial。
- 快速新增：每個時段 × 角色的預設值都通過 `validateCustomFood`，`valid_slots` 包含目前時段；有設過敏原時預設的 `null` 會被 `passesHardFilters` 擋。
- `manualSelectionProblem`：只有估算、只有飲料都要能送出。

**4-4【建議】mobile-walkthrough 要涵蓋的流程**
- 切分頁與取消後重開，停在哪一頁（不變）；送出後重開（變）。
- 飲料跨分頁保留。
- 被擋品項在組內最後。
- 快速新增後在目前分頁可見並已選中；被擋的情況見 1-1。
- 估算送出後，紀錄名稱與熱量正確。
- 快煮高 tier 灰階；已選的在切到快煮後仍可取消，送出時被擋。

**4-5【建議】驗收 13 的 grep 清單要補**
- 加上 `manual-picker.js`、`item-picker.js` 兩個檔案不存在、`manual-picker-items-mode`、`setManualMode`。
- `compose.drink` 的 grep 要同時看 tools/。

---

## 5. 第 6 節的問題

**第 1 題：推翻 round2「早午晚要 main」，改以 #20 為準——對。**
- round2 寫在 #20 之前。#20、PRD 0.1 第 6 點、章程 C4.8 都已經定案，check-engine L319 也已經斷言「早餐只記拿鐵要能送出」。
- 這不是新的推翻，不需要另開一條 decisions，引用 #20 就夠了【建議】。重複記會讓 decisions 看起來像同一件事決定了兩次。

**第 2 題：手動主餐上限——這是產品決定，交給使用者。**

資料事實：
- `conv_bx04` 即食舒肥雞胸（main）的時段是早午晚宵夜，`conv_bx05` 蒸地瓜（main）只有早餐、宵夜。兩者要同一餐只可能在早餐或宵夜。
- 台式的 `bf08` 地瓜也是 main。
- 另外，超商飯糰其實在 `taiwan_items`（`bf03`，外食分頁），不在超商分頁。

選項：
- **A. 維持主餐上限 1。** 最保守，但「雞胸＋地瓜」這種真實常見的一餐記不下來，使用者只能拆成兩餐，或用快速新增自建一筆。
- **B. 只把手動的 `MANUAL_ROLE_MAX.main` 放寬到 2（我建議這個）。**
  - 只影響記錄。章程 C4.8 只要求「有角色上限」，數字在 config，不必改章程。
  - 推薦的 C4.7 不動，快照不變。
  - 要做的事：記 decisions；改 PRD L108；改 check-engine L323 的斷言；平行工作線 C 的「角色超量依順序擋後者」自動沿用新上限。
  - 理由：手動記錄的角色上限是防誤觸，不是營養規則。#20 的精神就是「記錄要能記下實際吃的」。
- **C. 把 `bx04` 或 `bx05` 改成 side。** 會改變推薦組合（例如雞胸不能再當早餐主餐），要跑 diff-recs 差異、屬於資料角色語意的變更。為了記錄方便去動推薦，不划算，不建議。
- （延伸，不在 Phase 0）同一品項吃兩份，例如兩顆茶葉蛋，靠 `qty`。格式已經支援，UI 還沒有，可以登記日後討論。

**第 3 題：刪 `suggestFillers`——仍然成立，而且理由更充分。**
- 它從整個 `passItems` 挑建議，不管型態。三分頁之後會推薦別的分頁、甚至飲料步驟的東西。
- 它依「每 100 kcal 的營養密度」排序推銷，性質跟 C4.13／PRD 6.1 的精神衝突。
- 它就是截圖看到的底部溢出來源。
- 依章程 A1.3 要寫出原有職責去向：「提示補蛋白質／纖維」→ 保留缺口文字，不另設新家。`meal-content.js` L209–224 連同 ui 的呼叫一起刪。目前 check-engine 沒有它的斷言。
- 【建議】估算的蛋白質是 null 時，`slotGaps` 用 `|| 0`（meal-content.js L204），會對一場 1200 kcal 的喜宴顯示「蛋白質缺口約 N g」。建議 null 時改顯示「蛋白質：無資料」，不顯示缺口。估算的熱量超額那一句，建議換成 PRD 第 9 節「其他餐會自動調整」的文案。

**第 4 題：被擋品項排組內最後——夠，但建議加一行分頁層級的中性文字。**
- 實際資料的情況：蛋奶素（VEG）使用者午餐時，超商分頁幾乎全部被擋（picker 快照 `open/VEG/lunch/pass` 只剩飲料和 `conv_pk04`）。問題不在排序位置，而在「整頁都是灰的」。
- 建議在分頁頂端放一行：「灰色的 N 項因你的過敏原／飲食設定不能選」。整組都被擋時，那組收成一行「沙拉（4 項因設定不能選）」，可以展開。
- 不要寫「不顯示」，它們其實有顯示。這些文字都是中性說明，不違反 C4.13。

**第 5 題：2 個蛋白質固定各 1 份——現有的中性超額提示就夠；另外，題目的前提要更正。**
- 「雞腿＋鮭魚」屬於 `grain_bowl_baked`，它有主食槽，主要槽位是主食，滑桿照樣存在，可以把主食縮到 0.5 倍。
- 以現有資料，「沒有主食槽又選 2 個蛋白質」的情況不存在：唯一沒有主食槽的 `egg_pan`，蛋白質只有 `egg` 一個選項。
- 所以計畫 L28 那條規則目前只是防未來用。保留，但驗收 L62「單一蛋白質才有蛋白質滑桿」要改寫成可以驗證的形式（例如用 check-engine 的假骨架測），因為 walkthrough 用真實資料測不到。
- 超額提示「仍可送出」符合 C4.8 與 PRD 6.1，不要再加更強的提醒。

**第 6 題：加「不用油」——Phase 0 不加。**
- 程序面：違反章程 B5.6 的選項清單，要修章程＋C3（見 1-3）。
- 實質面：氣炸、微波、免開火的預設本來就是 0（ingredients 的 `implicit: []`），「不用油」只對煎、炒有意義。不沾鍋乾煎確實可能是 0，但 decisions #13 的出發點就是「v1 系統性少算用油」。把 0 做成一鍵選項，會重新打開低估的口子。
- 建議跟「不加調味（0 mg）」（日後討論 L60）同一批送 C3，一起決定「隱含成分可以歸零嗎」。

**第 7 題：估算的 `meal_type` 固定 `delivery`、能不能跟外食商品同一餐送出——可以。**
- PRD 第 3 節（L109）允許混合，PRD 第 8 節把外食定義成「別人做的」，估算卡片也只在外食分頁，型態一致。
- 注意兩件事：
  - 估算不佔角色名額（見 3-4）；
  - 平行工作線 C 的「送出時存成組合」遇到有估算的內容要隱藏這個選項（PRD 11.1）。現在不用做，但 3-1 的草稿函式要保留判斷估算的方法。

**第 8 題：`engine/picker.js` 放 engine——恰當。**
- 它不碰 DOM、不 import data、要被 check-engine 測，符合章程 C1。
- 條件有三個：
  - 快煮 tier 放 core，不從 picker.js 出口（2-4）；
  - 預設分頁函式只收 `lastPicked` 值，不出現 setting key 字串（2-5）；
  - 推薦的「有效偏好」解析（recommend.js L23–27 `getSourcePref`：不合法的值退回 `DEFAULT_MEAL_PREFS`）跟 PRD 第 4 節「不合法就往下找 lastPicked」刻意不同。建議在函式註解寫明，避免有人「統一」成同一個函式。

**第 9 題：其他漏掉的、跟章程衝突的**
- **【一定要改】commit 拆法跑不過 pre-commit。** 見第 6 節 6-1。
- **【建議】每個分頁各自記住選取，但送出只算目前分頁，可能無聲漏記。** 例如在超商選了東西，又切到外食選東西再送出，超商那些就沒記。建議摘要多一行中性文字「超商分頁還有 N 項沒有算進這餐」。
- **【建議】auto 時段退回超商分頁時，下午茶的超商分頁只有 1 項**（非飲料、下午茶時段可選的只有 `conv_pk03`）。宵夜也只有 3 項。PRD 4 的退回規則不用改，但要設計空狀態，並在截圖逐張看的時候特別看這兩頁。
- **【建議】快速新增的細節要定義：**
  - 角色選「飲料」時，存完應該出現在飲料步驟並選中，不是出現在分頁格子裡；
  - 同角色已經滿了的時候（例如已選一個主餐），存完不選中，並提示；
  - `valid_slots` 依角色推的對照表要寫出來（例如 main 的預設是哪幾個時段）。
- **【建議】`fitsSlot` 讓飲料不看時段**（item-picker.js L34–36），早餐也會出現珍珠奶茶（`dr01` 的時段只有下午茶）。這是既有行為，Phase 0 重做時要明確決定保留或改掉，不要默默沿用。

---

## 6. commit 拆法與順序（計畫第 5 節）

**6-1【一定要改】commit 3–5 會被 pre-commit 擋下**
- pre-commit hook（`tools/hooks/pre-commit`）每次都跑 check-engine 與 diff-recs。
- diff-recs 靠 `tools/lib/adapter-v2.js` L47 直接 import `js/ui/manual-picker.js`，並操作 `manualPicker.mode`、`compose.drinkItems`、`currentComposeTotals` 等（L162–197）。check-engine L428 直接 import `js/ui/item-picker.js`。
- commit 3「舊 modal 整個換掉」一刪檔案，兩個工具都會失敗；我實驗過，check-engine 會 `ERR_MODULE_NOT_FOUND`。章程 C6.1 禁止 `--no-verify`。
- 所以 commit 6 的工具修改必須拆進 commit 3、4、5，**跟改畫面的那個 commit 放在一起**：adapter、picker 快照、check-engine 4i 改成測 `engine/picker.js`、smoke-browser、mobile-walkthrough 第 3 節、手機實機腳本第 3 節。這也符合章程 C5.2 與 C6.3。

**6-2【一定要改】commit 2 改了 engine 介面，舊畫面要能繼續跑**
- `composeTotals`、`contentFromCompose` 改成吃陣列之後，還在的舊 manual-picker.js 傳的是單一物件，必須相容：舊畫面包成 `[x]` 傳入，或 engine 同時接受兩種形狀。
- 同時也要改 check-engine L269、L310 對 `composeTotals` 的舊呼叫。
- 好處：commit 2 的 picker、ui 快照若完全不變，正好證明 engine 的改寫沒改到行為。建議把「commit 2 所有快照不變」寫進計畫。

**6-3 A1 順序正確，但 commit 1 的內容要補**
- docs 先行符合章程 A1。
- commit 1 要補：2-2 列的 PRD 段落；1-2、1-3 的決定（如果要改 B5.6，要加 CHARTER，且屬 C3）；第 5 節第 2 題使用者的決定。
- 第 1 題不必另開推翻紀錄（引用 #20）。

**6-4 C5 只部分適用**
- 「先寫失敗斷言」（章程 C5.1）是修 bug 的規則。Phase 0 大部分是新功能，commit 2 先寫斷言是好做法，不是章程要求。
- 真正屬於 C5 的是日後討論登記的畫面 bug（溢出、跳號、44px、被擋排最底），適用 C5.2：「重現步驟加進手機實機腳本＋walkthrough」要跟修正放在同一個 commit（也就是 6-1），不能留到最後。

**6-5【建議】每個動到 `js/` 的 commit 都要跑 `node tools/stamp-version.js`**
- 章程 C1.6 由 check-arch 機器檢查。新增、刪除檔案的那幾個 commit 特別容易漏。

---

## 總表

【一定要改】
- 1-1 快速新增會讓素食、有過敏原的使用者走進死路
- 1-2 缺 PRD 10.3 的「更多（選填）」
- 1-3 用油選項違反章程 B5.6
- 2-1 分組方式跟 PRD 6.3 不一致
- 2-2 commit 1 的 PRD 修改範圍不足
- 2-3 自煮送出規則（含免開火）要搬進 engine
- 3-1 草稿 → MealContent → 合計的單一路徑
- 3-5 自煮分頁「只有飲料」的處理
- 4-1 推薦快照不變條件
- 4-2 畫面問題的自動檢查
- 6-1 commit 3–5 會被 pre-commit 擋下
- 6-2 commit 2 要讓舊畫面繼續跑

【建議】其餘各項。

**第 5 節第 2 題（主餐上限）交給使用者決定。建議選 B：手動主餐上限放寬到 2，只影響記錄，不影響推薦。**

**總結論：要先修改計畫。** 方向與範圍大致正確，但 commit 拆法照現況跑不過 pre-commit；快速新增、用油選項、分組順序三處跟 PRD／章程衝突；也缺少讓摘要與送出共用的 engine 路徑。修正上列【一定要改】並由使用者決定第 2 題之後，就可以開工。

---

## 第二輪：送審問題（逐字）

你是 Lighten2 Phase 0 實作計畫的獨立審核者（第二輪核對），不是實作者。**只讀不改**任何 repo 檔案（repo 在 `D:\ok\lighten`）。用中文回答。

第一輪審核意見全文在 `collab/opus-review-log/2026-09-29-phase0-plan-review.md`（「第一輪：審核回覆（逐字）」），結論是「要先修改計畫」，一定要改 12 項。實作者已把 `docs/review/2026-09-29-Phase0-實作計畫.md` 改成第二版，每條修訂標了第一輪的編號（例：〔1-1〕）。

請做：
1. 第一輪 12 項【一定要改】逐條一行：已解決／部分／未解決，並指出計畫第二版的哪一段。
2. 第一輪【建議】各項：已採納／刻意不採（計畫有寫理由）／漏掉。
3. 第二版有沒有引入新的問題或跟 PRD、章程、decisions 的新衝突（特別是：快速新增的「飲食宣告欄」與「送出前預告」、飲料不看時段的決定、`composeProblem` 跟 pool.js 免開火共用、`buildDraftContent`／`contentTotals` 與現有 `contentFromRec`／`sumProducts` 的關係、commit 2「所有快照不變」是否做得到）。
4. 「手動主餐上限」是使用者要決定的（計畫第 6 節），請確認計畫在 A、B 兩種決定下都能照做，沒有其他地方被這個決定卡住。

格式：每個發現標【一定要改】或【建議】，附依據。最後一行寫總結論（計畫可以開工（待使用者決定主餐上限）／要再修改）。

---

## 第二輪：審核回覆（逐字）

# Phase 0 實作計畫 獨立審核意見（第二輪核對）

審核對象：`docs/review/2026-09-29-Phase0-實作計畫.md` 第二版（以下簡稱「計畫」，行號都指這個檔）。
我逐條對照了第一輪回覆，也重新讀了這些地方：
- PRD 第 3、4、6、7、9、10 節，CHARTER B5–C6，decisions #1–#40；
- 程式：`js/engine/meal-content.js`、`pool.js`、`recommend.js`、`filters.js`，`js/data/catalog.js`、`db.js`，`js/core/config.js`、`slots.js`，`js/ui/manual-picker.js`、`item-picker.js`；
- 工具：`tools/diff-recs.js`、`tools/lib/adapter-v2.js`、`tools/check-engine.js`、`tools/check-arch.js`、`tools/snapshots/picker.txt`、`ui.txt`，以及 hook 與 CI 設定。

另外用 node 讀了 `data/dish_archetypes.json` 與 `data/ingredients.json`，確認骨架的 allow 清單和各食材是否 `requires_cooking`。repo 檔案沒有改動。

---

## 1. 第一輪 12 項【一定要改】

| 編號 | 狀態 | 計畫第二版的位置與說明 |
|---|---|---|
| 1-1 快速新增死路 | **部分** | L38–47 加了飲食宣告欄、送出前預告、「被擋或名額滿就不選中」，設計上已解決。但 `data/catalog.js` 的 `fromCustomFood` 會把角色、`channel`、`valid_slots` 寫死，也不讀 `vegan`／`lacto_ovo`，計畫沒列要改它。所以宣告欄實際上沒有作用，死路還在。見新問題 N1。 |
| 1-2 缺「更多（選填）」 | 已解決 | L42：六個營養欄位，沒填是 null。 |
| 1-3 用油違反 B5.6 | 已解決 | L32：只在煎、炒時出現；預設／1 茶匙／2 茶匙；相同的只列一次；不加「不用油」，送 C3。 |
| 2-1 分組跟 PRD 6.3 不一致 | 已解決 | L23：先依角色分區，區內再依 category 分組。「我的品項」組放在哪裡還有歧義，見 N8。 |
| 2-2 commit 1 要改的 PRD 範圍不足 | 已解決（小漏） | L112 已補第 3 節 meal_type、Phase 0 驗收欄、6.3、10.3、L108。漏了 PRD 10.6（L336「新增完直接選中」，現在改成有條件）與 10.4 的死路說法，見 N11。 |
| 2-3 自煮送出規則搬進 engine | **部分** | L71 已有 `composeProblem`，也和 pool 共用免開火判斷。但選項灰階（快煮 tier、免開火）的判斷沒搬，而且文字漏了醬料，見 N3、N4。 |
| 3-1 草稿 → MealContent → 合計單一路徑 | 已解決（要補細節） | L72 定了 `buildDraftContent`／`contentTotals`。跟 `sumProducts`／`composeTotals`／`contentFromRec` 的關係沒寫，見 N6。 |
| 3-5 自煮分頁「只有飲料」 | 已解決 | L36。 |
| 4-1 推薦快照不變條件 | 已解決 | L82。 |
| 4-2 畫面問題自動檢查 | 已解決 | L98。 |
| 6-1 commit 3–5 被 pre-commit 擋 | 已解決 | L110、L114–116：工具修改跟改畫面放同一個 commit。 |
| 6-2 commit 2 讓舊畫面照跑 | **部分** | L73、L113 有相容舊形狀，也寫了「所有快照不變」。但照目前寫法，commit 2 的快照一定會變，見 N2。 |

## 2. 第一輪【建議】

**已採納**
- 1-4、1-5（四小項都有）、1-6
- 2-4（但 pool.js 那一份其實是「算最高難度」，不是 ≤1 門檻，見 N12）
- 2-5、2-6
- 3-2（L94 斷言 10）、3-3、3-4、3-6、3-7
- 4-4、4-5
- 第 1、3、4、5、6、7、8 題
- 第 9 題：分頁殘留選取提示、空狀態、快速新增細節、飲料不看時段明確決定
- 第 2 題延伸（qty 登記日後討論）
- 6-3、6-4、6-5

**漏掉（小）**
- 4-3：沒有「自煮沒選餐型或骨架不完整 → 擋」的 `composeProblem` 斷言（3-5 的規則），斷言 4 只列了免開火、數量上限、allow、tier。
- 第 7 題：平行工作線 C 要能從草稿判斷「含估算」。現在的 content 本來就看得出 `kind: "estimate"`，可以不處理。

**刻意不採**：沒有。

---

## 3. 第二版的新問題與新衝突

**N1【一定要改】`fromCustomFood` 沒改，快速新增的角色、分頁、時段、飲食宣告都不會生效**
- 現況：`js/data/catalog.js` L55–69 把 `role` 寫死成 `"side"`、`channel: null`、`valid_slots` 全時段、`diet_tags: []`，註解還是「v1 的自訂食物沒有角色與時段」。
- 不改的後果：
  - 快速新增一筆主餐，會被當成配菜；
  - `partitionByMealType` 依 `channel` 分頁會拿到 null；
  - 宣告「全素」照樣被 `passesDiet` 擋下，1-1 的死路原封不動。
- decisions #34 已經寫明「自訂食物算外食只是 −1a 過渡，Phase 0 改用我的品項的 channel」。PRD 0.1 第 1 點也說不留 `channel: null` 分支。
- 要改：
  - 計畫第 3 節加 `data/catalog.js`：`fromCustomFood` 照 PRD 10.1 讀 `role`、`channel`、`valid_slots`，飲食標記用現有的 `dietTags(f)`。
  - 同時把 `tools/diff-recs.js` L156–159 的 `CUSTOM_FOODS` 範例改成 PRD 10.1 格式。現在的範例缺 `role`、`channel`、`valid_slots`、`allergen_tags`，連 `validateCustomFood` 都過不了。
  - 這會改變 picker 快照（`custom_a`、`custom_b` 出現在哪裡），所以要放在 commit 3 或 5，不能放 commit 2。
- engine 不能 import data（C1），所以 `quickAddProblem` 不能自己呼叫 `fromCustomFood`。建議寫明：由 ui 把草稿轉成品項形狀，再交給 engine 用 `passesHardFilters` 判斷，不要在 engine 另寫一份轉換。

**N2【一定要改】「commit 2 所有快照不變」照目前的拆法做不到**
commit 2（L113）列的 engine 變更中，有四處會改到舊畫面的 picker、ui 快照：
1. **`slotGaps` 對 null 不當 0**：`ui.txt` L1328、L1382、L1436、L1490（`items/*/custom-null`，`custom_b` 的蛋白質是 null）現在顯示「蛋白質缺口約 61g」。改完之後舊畫面的 `if (proteinGap > 0)` 不成立，這行會消失。
2. **`composeProblem` 加了 allow 檢查**：`picker.txt` L157 `compose/breakfast/no-cook-unsafe` 故意指定一個骨架 allow 以外、需要加熱的蛋白質（diff-recs L502 的註解有寫）。如果 allow 檢查排在免開火前面，提示文字會從免開火那句變成 allow 那句。另外，「請先選餐型」「請選烹調法」等文字也要跟 `composeMissingReason`（manual-picker.js L208–220）逐字相同。
3. **`contentFromCompose` 改成吃子切換值**：舊畫面沒有子切換。`picker.txt` L158、L191 的 `submit0` 記錄了 `type=cook_quick`，所以舊畫面要傳入「依難度推導」的值，engine 要保留並匯出這個推導函式。推薦的 `contentFromRec` 本來就還要用它。
4. **「飲料不再放進 `composeTotals`」**：舊畫面的 `compose/*/drink` 合計會少掉飲料。

要改：二選一，並寫進計畫。
- (a) 這四項在 commit 2 保留舊行為：`slotGaps` 的 null 處理、飲料移出 `composeTotals` 延到 commit 3；`composeProblem` 把免開火排在 allow 前面（安全理由優先顯示也比較合理）；舊畫面傳推導出的 meal_type。
- (b) commit 2 接受特定行的快照變動，附差異報告，把「所有快照不變」改成「只有下列幾行變」。

我建議 (a)，才保得住「commit 2 不改行為」這個證明。

**N3【一定要改】選項灰階（快煮 tier、免開火）要是 engine 函式，否則驗收斷言 3 測不到**
- L29 寫快煮下「tier 超過門檻的烹調法和食材要灰階」；現在的免開火灰階在 ui（manual-picker.js L110 `composeBlockedReason`），是這條規則的第三份實作。
- 驗收 L87 的斷言 3 是「推薦 `cook_quick` 會收」⇔「picker 不灰掉任何元件」。灰階判斷如果留在 ui，check-engine 根本測不到。
- 依據：章程 C2、C4.3（顯示時也要檢查，由 engine 斷言）。
- 要改：engine 提供 `composeOptionProblem(item, axis, draft, { tier })`，回傳原因或 null，涵蓋免開火、快煮 tier、已達 `COMPOSE_MAX`。`composeProblem` 內部也呼叫它；硬性過濾照舊走 `passesHardFilters`。ui 只負責顯示。

**N4【建議】`composeProblem` 的免開火範圍漏了醬料**
- L71 寫「任一蛋白質/主食/蔬菜需加熱就擋」，但 pool.js L68 與現在的 manual-picker.js L215 都包含醬料（`season`）。
- 目前沒有醬料 `requires_cooking`，所以還看不出差異。但既然要共用同一個函式，範圍必須一致，文字改成「任一食材（含醬料）」。

**N5【建議】免開火的斷言要用假骨架**
- 實際資料只有 `bowl_oat` 有免開火，它的蛋白質 allow 只有 `soy_milk`、`greek_yogurt`，兩個都不需要加熱，也沒有蔬菜槽。
- 所以斷言 4 的「免開火＋第二個蛋白質需加熱 → 擋」用真實資料組不出來，要跟第 5 題一樣寫明用 check-engine 的假骨架。

**N6【建議】`contentTotals` 跟現有函式的關係要寫清楚（第 3 題 `buildDraftContent`／`contentTotals` 與 `contentFromRec`／`sumProducts`）**
- **商品與估算一律用快照加總，不查 catalog**：`catalog.productsByUid` 不含我的品項，查 catalog 會查不到。`qty` 要乘進去，或斷言它是 1。
- **單一來源**：商品部分直接呼叫 `sumProducts`（pool.js L164 還在用），食材部分呼叫 `composeTotals`，再用 `addContributions` 合併。不要寫第三份「商品 null 傳染」。
- **推薦那條路不動**：`contentFromRec` 與 `rec_accepted` 的 totals 在 Phase 0 不改走 `contentTotals`，這一句寫進計畫，也是 recs 快照不變的理由。
- **加一條等價斷言**：用 commit 2 當時的快照案例，比對 `contentTotals(buildDraftContent(x))` 跟舊的 `sumProducts`／`composeTotals` 結果相同。不然 commit 3 改寫整份 picker 快照時，數字變動會混在一大堆差異裡看不出來。

**N7【建議】過渡相容要在 commit 3 拿掉（章程 A1.3）**
- `composeTotals`／`contentFromCompose` 接受「舊的單一物件」（L73），這只為了 commit 2 讓舊畫面能跑。舊畫面在 commit 3 刪掉後，這層相容也要刪。
- `contentFromProducts`（「看第一個主餐」）在 commit 3 也被分頁值取代，同樣要刪。
- 計畫沒寫，建議列進 commit 3，並加進 L106 的 grep 清單。

**N8【建議】「我的品項」組的位置跟角色分區互相矛盾**
- L23 說先依角色分區（主餐 → 配菜 → 點心），L25 說「我的品項」放在最後一組。我的品項本身也有角色，要寫明它是例外：永遠整組放最後、不進角色分區。
- 外食分頁把 `taiwan_items` 和 `convenience_items` 的 delivery 品項合在一起，要寫明兩個來源誰先。現況是台式在前（item-picker.js L17–29）。
- 這兩點都寫進 `groupForTab` 的斷言。

**N9【建議】meal_type 一律等於分頁值**
- L53 的「我的品項用自己的 channel」跟共用飲料步驟會衝突。例如在超商分頁只選了一杯 `channel: delivery` 的自建飲料，照這句會記成 delivery。
- 我的品項本來就依 `channel` 放進對應分頁，這個括號是多餘的，而且有歧義。建議改成「商品分頁的 meal_type＝分頁值，飲料不影響」。

**N10【建議】送出前預告的文字不要誘導改成「確認不含」**
- 預告只寫是哪個設定擋住，例如「你設了過敏原『蛋』；過敏原未確認的品項不能選」。
- 不要寫「改成確認不含就能選」這類引導。章程 C4.1 的精神是沒確認就保守排除，UI 不該讓人為了能選而去勾「確認不含」。

**N11【建議】Phase 0 到 B-1 之間仍然有死路，要登記**
- 飲食宣告欄只在使用者已經設了飲食限制時出現（L41）。之後才改成素食、或之後才設過敏原的人，以前建的品項全部變灰，要到 B-1 才有編輯畫面。
- PRD 10.4（「沒有新增入口，所以不會出現死路」）的說法在 Phase 0 之後不再成立。
- 要處理：commit 1 修改 10.4 並登記日後討論，或考慮宣告欄一律顯示。
- PRD 10.6 L336「新增完直接選中」也要跟著 L45 改寫。

**N12【建議】tier 單一來源的描述要修正**
- pool.js L84 不是 ≤1 門檻，而是「烹調法與食材的最高難度」，跟 `contentFromCompose` L405–406 重複。
- 建議除了 `isQuickTier` 之外，在 engine 加 `maxTierRank(method, items)`，讓 pool、推導 meal_type、N3 的灰階共用。
- 門檻本身在 recommend.js 有兩處（L29–31 `maxRankForSource`、L38 `filterBySource`），加上 meal-content.js 的 `cookMealType`。

**N13【建議】快速新增的全素宣告跟過敏原要一致**
- 可能出現宣告「全素」卻勾「含：蛋」，或全素但過敏原未確認。
- 章程 B1 表格規定我的品項只受 B8 驗證，B6.8 形式上不適用。但表單至少要在 `quickAddProblem` 用中性文字提示矛盾，或在計畫明寫「B6.8 不適用於我的品項」。

**N14【建議】walkthrough 的「送出後重開停在送出的分頁」只能在 auto 時段驗**
- 預設偏好中，早、午餐是超商，晚餐是開伙（`core/slots.js` L28），這三個時段都不會讀 lastPicked。
- 腳本要指定下午茶或宵夜，或先把偏好設成 auto。

**N15【建議】commit 3 到 commit 4 之間沒有自煮**
- commit 3 刪掉整個舊 modal（含自己煮），自煮分頁要到 commit 4 才有。如果推上去就會部署，中間那一版會少掉自煮記錄。
- 建議 commit 3–5 一起推，或 commit 3 保留自煮分頁的空殼與中性提示。
- `compose/*` 快照會在 commit 3 消失、commit 4 回來，差異報告要寫明。

**確認沒有衝突的**
- **飲料不看時段**：PRD、章程都沒有相反的規定（C4.8 只限角色數量）。這是既有行為，計畫也寫了理由，推薦仍照 `valid_slots`，可以。
- **估算不過硬性過濾**：不違反 C4.1，估算不是 catalog 品項。
- **`composeProblem` 與 pool 共用免開火**：方向正確，要補 N4 的範圍、N2 的判斷順序。另外 pool 在迴圈裡只能呼叫純判斷函式（例如 `noCookViolation(method, items)`），不要讓 pool 去組草稿。

---

## 4. 手動主餐上限：A、B 兩種決定下都能照做嗎

- **A（維持 1）**：計畫照寫即可，不影響其他段落。
- **B（主餐上限 2）**：也能照做，推薦與 pool 不讀 `MANUAL_ROLE_MAX`，recs、pool 快照不變。要跟著處理兩件事：
  - 【建議】`manualSelectionProblem` 的訊息「每種角色最多選 1 個。」寫死在 meal-content.js L193，B 之下會變錯，要改成依 `MANUAL_ROLE_MAX` 產生，例如「主餐最多 2 個」。
  - check-engine L323「兩個主餐要擋」要改成三個，跟常數在同一個 commit 改。現有的 picker、ui 快照沒有兩個主餐的案例，所以 commit 2 快照不變的條件不受影響。
- 快速新增的「名額已滿」、平行工作線 C 的「超量依順序擋後者」都走 `canAddManualItem`／常數，會自動跟上。
- **被卡住的只有 commit 1**：PRD L108 與 decisions 要寫哪個值。commit 2 以後都只讀常數，沒有其他地方被這個決定卡住。

---

【一定要改】共 3 項：
- N1：`fromCustomFood` 要照 PRD 10.1 改寫，並更新 diff-recs 的範例資料；
- N2：commit 2「所有快照不變」照目前的拆法做不到，要改拆法或改說法；
- N3：選項灰階的判斷要搬進 engine。

這三項都是計畫文字層級的修正，不需要改變方向。另有 1-1、2-3、6-2 三項第一輪問題因此只算部分解決，會隨這三項一起解決。

總結論：要再修改

---

## 實作者檢討（2026-09-29，兩輪都「要再修改」之後）

計畫的方向兩輪都沒被推翻，退回的都是「沒對照現有程式與工具就寫下的承諾」。共同原因：第一版是從 PRD／round2 往下寫，沒有從要動的程式往外查依賴。

| 問題 | 本來該做的查核 |
|---|---|
| 刪舊 modal 會讓 pre-commit 失敗（1輪 6-1） | 要刪／改名的檔案，先 `grep -rn "<檔名>" tools/ js/` 找出所有 import |
| `fromCustomFood` 寫死角色、channel、飲食標記（2輪 N1） | 每個新欄位追一遍資料路徑：表單 → db 驗證 → catalog 正規化 → engine 過濾（跟 −1b「taiwan_items 從未寫入 DB」同一類教訓） |
| 「commit 2 所有快照不變」做不到（2輪 N2） | 宣稱快照不變之前，逐項對照會影響哪些快照行（`grep` 快照檔裡的情境名） |
| 用油選項違反 B5.6、快速新增死路、分組違反 PRD 6.3（1輪） | 每個 UI 細節先搜章程與 PRD 有沒有現成條文，不憑記憶或 round2 的舊文字 |
| 灰階判斷留在 ui、tier 規則多份（2輪 N3、N12） | 寫「搬到 engine」時列出現有的每一份實作位置，一次收斂 |

下一版計畫（第三版）送審前，用上表逐條自查一次。
