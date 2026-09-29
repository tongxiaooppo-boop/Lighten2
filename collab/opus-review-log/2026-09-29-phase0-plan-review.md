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
