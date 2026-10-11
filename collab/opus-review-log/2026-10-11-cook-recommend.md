# Opus 審核：今日建議的自煮改用新引擎、「我的食物」☆／預設（2026-10-11，第一輪）

送審稿：`collab/plan-2026-10-11-cook-recommend.md`。使用者已拍板：章程 C4.17 更新（推翻 #81／#128）、auto＝先自煮快煮→外食→超商、4.3 一起做、先審後做。審核者唯讀，已實際讀檔並用 node 實測。

## Opus 回答（逐字摘要自報告全文，結構未改）

### 結論先行
1. 方向對，但稿有 5 處事實錯誤。
2. 最大結構問題：回饋 id 用 form hash，做不出「以零件為單位的近期降權」（`recipe_feedback` 只存 id、rating、shown_count、last_shown_date）。id 要改成看得懂、能拆回零件、不含份量的字串。
3. 「生成式取樣＋日期種子洗牌」不需要：候選池被 ☆／預設限成小集合，可在固定模板裡窮舉，用既有近期降權輪轉。
4. 章程連動漏三條：C4.17「推薦不產生 food 元件」本身要改；C4.3 免開火條文與新引擎（food 帶 method，含 raw／cold）脫節；C4.6 縮放條文不適用新自煮。
5. 讓 `recommend.js`／`today.js` 保持不碰 ☆、foodTree，只有新的 `cook-rec.js` 讀，C4.17③ 的 grep 防線幾乎原封保留。
6. 稿的 S3（engine）與 S4（UI）不能分開 commit，改依「可單獨驗收的行為差異」切刀。

### 一、稿中事實核對
| 稿中說法 | 實際 | 影響 |
|---|---|---|
| 舊 ☆ 指向舊內建食材 id，要轉成 `fx_` | food_tree 的 37 個內建食材全部用原 id 收錄（帶 builtin 欄），`cookOptions` 的 uid 就是原 id | 不用做轉換（前兩輪 Opus 這說法也錯）；S2 變小 |
| 舊 pool 快照 4344 行作廢 | 其中自組食譜 2892 行、超商外食 1451 行 | 超商外食那 1451 行仍有效，只拿掉 `src=cook` |
| 食材池要扣季節、check-data 每季至少 N 個預設 | food_tree 品項沒有季節欄位，只有家常菜有 `seasons` | 食材季節從稿中刪掉 |
| 「自己選」帶入同一份 form 像改造既有行為 | `tab-today.js:611-613` 的「自己選」現在完全不帶推薦內容 | 是新功能、有 UX 代價，獨立一顆按鈕或延後 |
| check-arch 新增 cook-rec 不得用 Date.now | `check-arch.js:171-180` 已對整個 engine、core 擋時鐘；Math.random 沒檢查 | 時鐘不用另加；不取樣就不用為這次加 Math.random 禁令 |
另兩處內部漂移：`slots.js:25` 註解說 auto 上限 🟢🟡，但 `recommend.js:30-32` 對 auto 回 2；`picker.js:102` 註解寫 favoriteRefs 只准 picker/today/recommend，與章程 C4.17② 與 check-arch 第 52 行（只准 picker.js）矛盾。

### 二、逐點回答 8 點
1. **生成式取樣 vs 窮舉**：不要取樣，改「固定模板＋小池子窮舉」。預設池蛋白質約 9、碳水約 7、蔬菜約 11；餐盒模板「1 蛋白質＋1 碳水（或不要）＋2 蔬菜」約 3465 組，與舊池同量級。實測 2000 次 `cookFormProblem`＋`cookFormParts` 25ms（桌機），手機 5–10 倍，所以候選要快取，cook.js 補 uid→entry 索引（`cookOptionByUid` 目前線性掃）。取樣壞處：結果隨種子跳動、測的是亂數器不是品質、好組合被丟掉。推薦模板刻意比自己選窄（餐盒單一蛋白質、蔬菜 2 種、不加飲品水果；早餐盤＝蛋或豆＋早餐碳水＋1 蔬菜；早餐碗＝碗底＋穀物＋水果 1＋堅果；家常餐＝主食＋主菜 1＋青菜 1＋湯 0/1）。預設做法不要建每食材偏好序表，改全域偏好序放 config（蛋白質 `[boil, steam, pan]`、蔬菜 `[boil, stir]`，取第一個通過 `cookMethodProblem`），至多加子類例外小表；做法可作 variant 讓熱量貼近度去選；做法不放進 id。
2. **auto**：「先試…沒有再試」＝依序 fallback，不用加分。「可用」要用最佳候選選定 variant 後的熱量算偏差，不是基準份量。下午茶、宵夜 auto 預設：早餐碗無可縮放份量，150–200 kcal 配額易超 35%，會掉到外食，變成「下午茶推你去買台式外食」；建議第二順位改「超商與外食一起比分」。auto 走自煮時 `meal_type` 不能用舊的 `deriveCookMealType(tier_rank)`（家常菜 `passive`），改用 `cookFormProblem(form,…,"cook_quick")===null`；卡片 🟢🟡🔴 需 `cookFormRank(form)`。cook.js 目前沒有 rank 與 quick 判斷函式。
3. **☆ 語意**：同時 ☆＋不吃資料上已互斥（`applyFavoriteOp`）；舊 ☆ 不用轉；「補預設」要定成「補到 k 樣」不是「☆＋全部預設」：☆≥k 池＝☆；0<☆<k 池＝☆＋預設依序補到 k；☆=0 池＝預設。可用 ☆ 依入口與快煮與否分別算，池子在 engine 解析。預設要有順序（boolean 做不到）。☆ 意思依類別不同：自煮食材 ☆ 決定建議池；超商與我的品項 ☆ 仍只排序，說明文字要分開寫（`engine/foods.js` 的 `favoriteEffectText()`）。建議池不另做畫面，「我的食物」各軸上方一行文字即可。
4. **自己選主列表**：稿說法會讓選單縮水（現在 `pickList` 主列表＝☆∪常見名單∪已選）。建議維持聯集，只把常見名單來源換成預設 id 清單；順手修既有 bug：`COOK_COMMON` 有 3 個名稱對不到選項（碳水「紫米」、蔬菜「紅蘿蔔」「四季豆」）。自己選與建議池共用同一份預設（單一來源），但規則不同（聯集 vs 補到 k），寫進 decisions。
5. **回饋 id 與歷史**：id 不能用 hash；建議 `cook|box|chicken_breast|brown_rice_cooked|broccoli+cabbage`（入口與品項排序後，不放份量、人數、做法）。舊回饋 id 留著當孤兒。「昨天最後顯示的推薦」不用解析新舊兩種（存的是 `recLogParts` 產好的 `{name,content,totals}`，`today-yesterday.js` 不讀 content 內部）。**漏掉的消費者**：(a) `recommend.js:138-145` `loggedContents` 跨時段不重複只認 `kind==="ingredient"&&axis==="protein"` 與 `archetype_id`，**今天已用新格式記的自煮餐完全不占名額**（c55ec12 起的既有 bug），要改成 `c.part && c.role==="protein"`（避開 "food" 字面量）；(b) `today-hero.js:40-41` `recsKcalTotal` 讀 `scaled_kcal`；(c) `recLogParts` totals 要改用 `contentTotals(content, catalog)`，`contentFromRec` 簽章要帶 catalog，三個呼叫點都改；(d) `diff-recs.js:299-300` `altDinner` 挑 `is_composed`、`:340-344` chip 流程讀 `protein_id`；(e) `tools/lib/adapter-v2.js` 的 `pool`、`recommendRaw`；(f) 零件 chip 用 `type:"food_tree"`、key＝uid，與 `tab-foods.js:114` 一致；家常菜 chip 的 key 是 `hd_`，但「我的食物」目前沒有家常菜子分頁，不吃清單的 `hd_` 會顯示不出或取消不了，家常菜進推薦前子分頁要先上。
6. **輪轉、「重新整理建議」**：現在只重跑 `buildRecommendation()`；依 decisions #39，近期降權以「今天開始時」計算，同一天重跑本來就該得到同樣結果，按鈕不會失效。驗收不要寫「同種子穩定、換日不同」，要寫 **7 天模擬**：每天記錄並 `markRecipesShown`，主蛋白質不連續兩天相同、7 天內至少 3 種。
7. **C4.16／固定吃**：交接檔原話「固定吃＝自煮裡使用者自己設定的餐（我的組合／我的料理），在**選擇清單**中往前排，我做的自動推薦排在後面並輪轉」，稿只解讀前半。判讀：自己選的自煮分頁上方列我的組合、下面列幾個每天輪轉的「建議自煮」；不牴觸 C4.16（自己選本來可讀我的組合，推薦引擎不讀，只把 cook-rec 前 N 名交給自己選顯示）；不建議為今日建議卡開例外。
8. **範圍／階段**：S3、S4 不能分開（結果形狀一換，卡片、chips、記錄、快照當場壞）。更小第一刀：預設清單單一來源重構，零行為差異。

### 三、稿中沒提到的漏洞
**章程連動**：(1) C4.17 原文「推薦不產生 food 元件、不依 food 的 ref 做判斷」本身要改成「推薦產生的 food 元件只能經由 `engine/cook.js` 與 `meal-content.js` 的 `cookDraftPart`／`buildDraftContent`」；(2) C4.3 免開火條文只檢查 ingredient 元件，新 food 元件帶 method（含 raw、cold），規則實際在 `cookMethodProblem`（`cook.js:139-149`），章程與 check-engine 要補「推薦候選的 raw 只出現在 RAW_OK_VEG、cold 只出現在 ready 品項」；(3) C4.6 縮放條文要加適用範圍說明（新自煮是離散份量）；(4) check-arch 第 373-376 行自我檢查明文斷言 tab-today 不在 `FAVORITE_READER_FILES`、recommend／today 不在 `FAVORITE_PARAM_ENGINE_FILES`，改白名單要同步改；(5) 字面量 grep 逐檔掃，`recommend.js` 只要 import `cook-rec.js` 就能間接碰 foodTree，要加正向規則：`cook-rec.js` 只能被 `ui/tab-today.js`（及自己選相關檔）import，`recommend.js`、`today.js` 不得 import `cook.js`、`cook-rec.js`。
**資料**：(6) 家常菜對設過敏原或素食的人全不能用（`vegan:false`、過敏原含「未確認」，#152），素食／過敏的午晚餐自煮只剩餐盒；「同一餐型一天最多一次」若沿用為硬過濾，晚餐會直接沒推薦，只能當軟性扣分；(7) 預設家常菜「原 36＋非 🔴」：主菜 🟡 15 道、🔴 21 道，cook_full 與 cook_quick 建議幾乎一樣，可接受但要寫明刻意；(8) 單一 boolean `default_pick` 不夠：`COOK_COMMON` 本來就分 `protein`（餐盒）與 `plateProtein`（早餐盤含起司片、火腿），且補到 k 需要順序；(9) 舊 archetype allow 聯集有 2 項蛋白質不在新清單（`soy_milk`、`greek_yogurt`），「聯集∩新引擎可用」要用 `cookFormProblem` 驗證；(10) 餐盒排除只能滷燉蛋白質的規則現在寫在 UI（`cook-forms.js:92,98`），推薦也需要，要搬進 cook.js（C2 單一來源）。
**評分、低碳、畫面**：(11) `LOW_CARB_MEAL_MAX_G=30`，餐盒半份糙米（75g，約 29g 碳水）加蔬菜就超過，低碳使用者實際只能 carbAmt `none`；variant 要含 `none` 並在 variant 層級過濾碳水≤30（取代 `lowCarbMaxScale`），家常餐有飯就超過；(12) 推薦卡要多一行零件明細（由 engine 產字串，例「雞胸肉 120g 水煮・糙米飯 75g・青花菜 100g 燙」），舊卡「基準 X kcal」在離散份量下沒意義要改文案；(13) 候選要用「catalog＋設定簽章」記憶化（取決於 catalog、☆、過敏原與飲食、不吃、季節、用油習慣），不吃與倒讚在候選建好後再過濾；(14) 章程 C6.6 要求改行為時同 commit 更新 PRD，與使用者「做完再寫文件」衝突，照使用者指示做，交接記一行「C6.6 這一輪暫緩，最後一次補齊」。

### 四、替代方案
**架構**：`engine/cook-rec.js`（純函式）`cookRecCandidates({ catalog, profile, favoriteRefs, date, oilHabit })`，只有它（加 `picker.js`）可用 `favoriteRefs` 參數名、讀 `catalog.foodTree`／`homeDishes`；負責池解析、模板窮舉、選做法、份量 variant、`cookFormProblem` 驗證、`cookFormParts`＋`contentTotals` 算營養、id、名稱、零件明細。候選形狀只用泛用欄位：`id`、`valid_slots`、`tier`／`tier_rank`、`quick_ok`、`part_refs`、`main_protein_ref`、`variants:[{form,kcal,…}]`、`is_cook_form:true`、`allergen_tags`。`tab-today.js` 讀 `getFavoriteRefs()`，呼叫 `cookRecCandidates`，把 `buildCandidatePool`（只剩超商外食）與自煮候選合併傳給 `planToday`；`today.js`、`recommend.js` 看不到 ☆ 與 foodTree。`recommend.js` 只改四件：`achievableNutrition` 加 variants 分支（選最貼近預算；低碳只看碳水≤30）；來源過濾（cook_quick 看 `quick_ok`；auto 依序自煮→外食→超商）；跨時段不重複改看 `main_protein_ref`、`loggedContents` 認新格式；零件級近期降權（拆 `cook|…` 開頭的 feedback key，純函式放 cook-rec.js）。`contentFromRec` 新路徑走 `buildDraftContent({kind:"cook", cook: cookDraftPart(variant.form,…), meal_type})`，與自己選送出格式逐字相同。刪除：`pool.js` 的 `composedCombos`、`meal-content.js` 的 `withOilHabit`、`cook.js` 的 `COOK_COMMON`；`dish_archetypes.json` 保留給歷史。預設清單：`core/config.js` 一個 `COOK_DEFAULTS`，依軸列有序 id（`box_protein`、`plate_protein`、`carb`、`plate_carb`、`veg`、`bowl_base`、`bowl_grain`、`bowl_fruit`、`bowl_nut`、`home_staple`、`home_main`、`home_veg`、`home_soup`），不在 food_tree／home_dishes build 裡加 boolean；check-data／check-engine 驗證 id 存在、至少一個做法能過快煮、每軸≥k、蛋奶素／全素／快煮可用數、家常菜每季≥N。
**階段**：
- C1 `COOK_DEFAULTS` 取代 `COOK_COMMON`；「只能滷燉蛋白質不進餐盒」搬進 cook.js；cook.js 補 uid 索引、`cookFormRank`、`cookFormQuickOk`；自己選主列表維持聯集。驗收：recs／matrix／pool 零差異；picker 快照只多紫米、紅蘿蔔、四季豆。
- C2 `cook-rec.js` 本體（先只用預設，`favoriteRefs` 固定空）＋ check-engine 不變量（候選 `cookFormProblem===null`、raw／cold 合法、`quick_ok` 可過快煮、硬性過濾全過、id 不含份量、各入口候選數在上下限、效能預算）。尚未接 recommend，快照零差異。
- C3 接上推薦（只限明確設定 cook_quick／cook_full 的時段）：recommend variants 與 `main_protein_ref`、`loggedContents` 認新格式（修既有 bug）、`contentFromRec` 新路徑、卡片名稱與零件明細、零件 chips、hero；刪 `composedCombos`、`withOilHabit`；章程 C4.17／C4.3／C4.6 與 check-arch 同 commit 改。驗收：diff-recs 只有自煮時段變動；pool 快照只少 `src=cook` 的 2892 行；改寫 `altDinner` 與 chip 流程；新增「記餐盒雞胸後晚餐不推雞胸」；7 天模擬；mobile-walkthrough 看截圖。
- C4 auto 依序（自煮快煮→外食→超商）、下午茶宵夜依拍板處理；差異只在 auto 情境。
- C5 ☆ 進推薦（tab-today 讀 `getFavoriteRefs`、補到 k）；C4.17② 改寫、check-arch 白名單與自我檢查同步。沒有 ☆ 的情境快照零差異。
- C6 「我的食物」家常菜子分頁（含 `hd_` 的 ☆ 與不吃）、☆ 說明文字分「自煮食材」與「其他」。
- C7（選做）自己選的自煮分頁「我的組合」下方加「建議自煮」N 個；推薦卡「改一下」按鈕帶入 form。

### 五、需要使用者拍板（附建議答案）
1. 「固定吃往前排、自動推薦排後面並輪轉」＝自己選的自煮分頁上方列我的組合、下面列每天輪轉的「建議自煮」嗎？建議：是，做成 C7；今日建議卡不讀我的組合，C4.16 不開例外。
2. auto 在下午茶、宵夜也照「自煮→外食→超商」嗎？建議：自煮（早餐碗）仍優先；不可用時第二順位改「超商與外食一起比分」。早午晚照原決定。
3. 自煮「可用」的熱量門檻：建議配額 ±35%，配額低於 250 kcal 的時段放寬到 ±50%；使用者只要確認「寧可推自煮、熱量差一點也沒關係」。
4. ☆ 不足 k 樣：建議「補到 k 樣」（蛋白質 3、碳水 2、蔬菜 4、主菜 4、青菜 3、湯 2）。
5. 自己選主列表：建議維持「☆＋預設＋更多」聯集，☆ 只決定建議池。
6. 推薦卡「改一下」按鈕：建議要，放 C7。

### 六、第一個 commit
C1：預設清單單一來源，零推薦差異（內容見上方 C1）。不碰章程、推薦、☆，失敗可直接 revert。

## 協調者核對與立場（事後，見對話）
（由協調者在下方補寫核對結果與我自己的意見。）
