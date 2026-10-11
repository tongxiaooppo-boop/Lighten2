# 設計稿：今日建議的自煮改用新引擎，加「我的食物」☆／預設（4.2＋4.3，2026-10-11，送 Opus 審）

寫給審核者：請先讀本檔，再讀「必讀檔案」，**獨立判斷、挑毛病，不要附和**。結論與你的反駁請完整寫出來（我會逐字存進 `collab/opus-review-log/`）。

## 0. 背景與使用者已拍板

- 專案：個人減脂飲食 App（純前端、IndexedDB、engine 純函式、章程 `docs/CHARTER.md`）。
- 新自煮引擎（`js/engine/cook.js`，已上線、已 push）：四個入口——餐盒（box）、早餐盤（plate）、早餐碗（bowl）、家常餐（home）。一餐存成 food 元件加 `content.form`（編輯設定）與 `content.implicit.oil_g`。畫面已接上（自己選）。
- **現在的問題**：今日建議的自煮仍由 `pool.js` 用舊 8 個 archetype（煎蛋類、炒類、烤舒肥定食、溫沙拉、蒸魚定食、滷燉定食、低碳蛋白質蔬菜盤、早餐碗）窮舉組合、`recommend.js` 評分。使用者要求：**推薦的自煮改用新引擎配**。
- **使用者今天的決定**（直接照做，不再議）：
  1. 章程 C4.17 規定要更新：推薦可以讀「我的食物」☆（`favorite_refs`）與家常菜資料。#81（否決只推常吃）與 #128（取消常吃加分）算被推翻，由使用者知情拍板。
  2. 「都不選」的意思＝基本資料某時段的來源偏好是 `auto` 時，**先試自煮（快煮），沒有再試外食，再試超商**。
  3. 4.3 一起做：「我的食物」☆／預設決定自煮建議池；沒選的軸用預設。
  4. 這一輪整合「做完再寫文件」，但本設計要先審。
- 先前 Opus 兩輪（`collab/opus-review-log/2026-10-11-merge-into-main.md`）已建議：候選池＝☆、一軸不足 k 樣用預設補；推薦線最小切片先動食材軸、家常菜進推薦後做；每項一個 `default_pick` 旗標；`favorite_refs` 不用升備份。**本稿是把那些建議具體化，請檢查有沒有走樣或漏洞。**

## 1. 現況（推薦怎麼運作，審核者必讀）

- `pool.js`：`buildCandidatePool(catalog)`＝所有合法組合的**窮舉表**（跟預算、偏好無關，建一次）。自組食譜（archetype×蛋白質×主食×蔬菜×醬×做法）約 4000 筆；超商／外食另用同一個生成器。
- `recommend.js`：`getTodayRecommendation(o)` 依時段序處理，每個時段：用該時段配額（`budget`，前面時段的差額帶到後面）過濾（`valid_slots`、tier、低碳、硬性過濾、倒讚、同日不重複蛋白質／餐型／品項）→ 依來源偏好（`meal_prefs[slot]`：auto｜convenience｜delivery｜cook_quick｜cook_full）過濾 → 算分（回饋、近期降權、蛋白質缺口、纖維缺口、**縮放後熱量貼近預算**）→ 取第一名。自組食譜可用「主要槽位縮放」連續調份量去貼預算（`achievableNutrition`）。
- 預設來源：`DEFAULT_MEAL_PREFS = { breakfast: convenience, lunch: convenience, afternoon_tea: auto, dinner: cook_full, snack: auto }`；時段 `SLOTS = [breakfast, lunch, afternoon_tea, dinner, snack]`。
- 推薦結果物件被 `tab-today.js` 畫成卡片（名稱、tier、kcal、基準、用油、`not_included`、「順便不要」chips 靠 `protein_id`／`vegetable_id`、倒讚靠 `rec.id`）、被 `recLogParts/contentFromRec` 轉成 daily_log、被 `lastShownSlots` 存成「昨天最後顯示的推薦」（`settings.last_shown_recs`，內含 content）。回饋（喜歡／倒讚／顯示次數）以**組合 id** 為 key。
- 舊 archetype 的 `valid_slots`：早餐碗＝早餐／下午茶／宵夜；煎蛋類＝早午晚宵夜；其餘六個＝午晚。
- 章程 C4.17（§CHARTER 第 325 行）目前禁止：推薦讀 `favorite_refs`（參數名 `favoriteRefs` 只准 `engine/picker.js`）、推薦的 `pool.js／recommend.js／today.js／matcher.js` 原始碼不得出現字面量 `"food"`、`"dish"`、識別字 `foodTree`、`homeDishes`；推薦不產生 `food` 元件。check-arch 用 grep 強制。
- 另有 C4.16：「我的組合」（saved meals）只供手動引用，推薦不讀。

## 2. 我的設計提案

### 2.1 新自煮候選：**生成式、有上限**，不再窮舉成大表
舊做法是窮舉 4000 筆再評分。新結構（餐盒蛋白質 1–3 種各有做法、蔬菜各有做法、碳水份量、家常餐菜 1–4 道＋湯＋人數…）窮舉會爆炸，且很多組合不像人類會煮。提案：

- 新檔 `js/engine/cook-rec.js`（純函式）：`cookCandidates(catalog, ctx)` 針對**一個時段**產生有限個合法 form（上限約 150–300 個），每個 form 用 cook.js 的 `cookFormProblem` 驗證、用 `cookDraftPart`＋`contentTotals` 算營養（不另寫一份營養邏輯）。
- 各時段允許的入口：
  - 早餐：早餐盤、早餐碗、（家常餐的粥與整碗主食）
  - 午、晚：餐盒、家常餐
  - 下午茶、宵夜：早餐碗（免開火）為主；沿用舊 `valid_slots` 的覆蓋範圍，不新增
- **餐盒生成**：從「蛋白質池、碳水池、蔬菜池」（見 2.2）取樣：蛋白質 1 種（單一蛋白質）或 2 種（一肉一蛋／一肉一豆），碳水 1 種，蔬菜 2–3 種；每個零件的做法用「預設做法表」（每個食材一個偏好序，例：雞胸→水煮／蒸／煎；蝦→燙／煎；葉菜→燙／炒）挑第一個符合 `cookMethodProblem(quick)` 的；碳水份量 half／one、蛋白質份量 pamt 依基本資料目標模式（`goal_mode`、`low_carb`）給預設，再在 {half, one}×{1, 1.5} 小範圍內挑**最貼近預算**的一組（取代舊的連續縮放）。
- **早餐盤、早餐碗**：同理，池更小。
- **家常餐生成**：主食（糙米飯／雜糧飯／整碗／粥）＋ 1–3 道菜（主菜一道＋青菜一道［＋湯］），菜從「菜池」取；一鍋菜用半／一／一份半貼預算；人數用 cook.js 預設規則。
- **確定性輪轉**：engine 不准用 `Math.random`。候選取樣用「日期＋時段」當種子的確定性洗牌（同一天同一時段重畫結果穩定；隔天換）。近期降權沿用現有 `shown_count／last_shown_date` 機制，以**零件**為單位（蛋白質 uid、蔬菜 uid、菜 id）而不是 form 整體 id。
- **評分**沿用 `recommend.js` 的公式（熱量貼近預算、蛋白質缺口、纖維缺口、回饋、近期降權），只換候選來源；`withOilHabit` 不再需要（用油由 cook.js 依 `oilHabit` 直接算）。
- **推薦結果形狀**：新增 `rec.cook = { form, parts… }`（或 `rec.form`）加現有欄位（`name`、`tier`、`scaled_kcal`、營養、`budget`…）；`name` 用新的「餐盒（雞胸肉＋地瓜＋青花菜）」格式；`rec.id` 用 form 的確定性 hash（回饋、倒讚吃這個）；「順便不要」chips 改成零件 chips；`contentFromRec` 新增 form 路徑，直接寫 food 元件＋`form`＋`implicit`（與自己選送出的格式相同）；「自己選」按鈕**帶入同一份 form**。
- 舊 archetype 路徑：自煮推薦不再產生；`pool.js` 的 `composedCombos` 對推薦停用（資料與解析器保留給歷史紀錄、舊組合、舊預約、舊的「昨天最後顯示的推薦」）。

### 2.2 候選池來自「我的食物」：☆ ＋ 預設
- 每個軸一個池：
  - 餐盒／早餐盤：蛋白質池、碳水池、蔬菜池（食材 `fx_`／內建 id）；早餐盤另有早餐碳水（吐司等）、蛋白質含起司片／火腿；早餐碗：碗底、穀物、水果、堅果。
  - 家常餐：主食（含整碗、粥）池、菜池（依角色：主菜、蛋豆菜、青菜、小菜、湯）。
- **規則**（Opus 前兩輪建議，我採用）：某一軸的池＝使用者 ☆ 過且能用的項目（扣掉過敏原、不吃、快煮限制、季節）；**可用的 ☆ 少於 k 樣時，用預設補足**（不是只用 ☆）；完全沒 ☆ 的軸＝預設。k 暫定：蛋白質 3、碳水 2、蔬菜 4、家常主菜 4、青菜 3、湯 2，放 `core/config.js`。
- **預設**：每個品項一個 `default_pick` 旗標，只有一處定義：食材旗標在 `data/food_tree.json`（由 `tools/build-food-tree.js` 產生，初始值＝舊 archetype allow 聯集∩新引擎可用）；家常菜旗標在 `data/home_dishes.json`（由 `tools/build-home-dishes.js` 產生：原 36 道＋ tier 不是 🔴 的）。畫面現在的 `COOK_COMMON` 名單改成讀 `default_pick`（「自己選」的主列表也走同一來源：有 ☆ 顯示 ☆，沒有顯示預設，「更多」永遠全部）。check-data 檢查涵蓋度：每個軸每個季節至少 N 個預設、素食與快煮各有。
- **☆ 的意思**：從「常吃（只影響排序）」變成「我會煮（決定建議池，也決定自己選的主列表）」。畫面說明、PRD 13.6 要改。完全沒標的使用者零變化（用預設）。
- **資料與備份**：`favorite_refs` 已能放任何不重複字串，家常菜 `hd_` id 也行，**不升備份版本**。要做的：「我的食物」加家常菜子分頁；舊的 ☆（指向舊內建食材 id，例如 `chicken_breast`）對應成 `fx_` id（讀取時轉換，找不到對應的略過並提示）；匯入舊備份時一樣轉。
- **我的組合／我的料理**：保持 C4.16（推薦不讀 saved meals）。使用者說的「固定吃往前排」我解讀為：自己選的最上面一列已經是「我的組合」（已有）；推薦不讀它。**請審核者判斷這個解讀是否合理，還是該開例外。**

### 2.3 來源偏好與 `auto`
- `cook_quick`／`cook_full`：只用新自煮候選（quick 套快煮擋）。`convenience`／`delivery`：不變。
- `auto`：照使用者決定，**先試自煮（快煮），沒有可用候選再試外食，再試超商**。「可用」＝該來源有候選且熱量能貼近預算（偏差 ≤ 暫定 35%）。這會改變現有 `auto` 行為（目前是全部來源混在一起比分）。快照 `recs`、`matrix` 會大幅改變。
- 預設來源偏好表 `DEFAULT_MEAL_PREFS`（早午餐 convenience、晚餐 cook_full…）不改。

### 2.4 章程與 check-arch 要改的
- C4.17 條文：推薦可讀 `favorite_refs`（只經一個新的入口參數 `cookPools`，由 UI 層讀 db 後傳入，engine 不碰 db）、可讀 `catalog.foodTree` 與 `catalog.homeDishes` 的**池**（限 `engine/cook-rec.js`）；仍禁止：推薦讀「我的食材」「我的料理」內容、讀 `meal_plan` 元件種類、讀 saved meals（C4.16）。`recommend.js／today.js／pool.js／matcher.js` 的字面量禁用與 `favoriteRefs` 參數名限制要改成「只准 `engine/cook-rec.js` 與 `engine/picker.js`」。
- check-arch：新增「cook-rec.js 不得 import db、不得用 Math.random／Date.now」「`tab-today.js` 只讀 `getFavoriteRefs` 傳入、不自己篩選」；`FAVORITE_READER_FILES` 加 `tab-today.js`。
- decisions 新增（做完再寫）：☆ 語意變更、auto 優先序、推薦改生成式、k 值、推翻 #81／#128。

### 2.5 驗收
- 舊的 `pool` 快照（4344 行）作廢，新增 `cookpool` 快照（每個時段 × 幾種使用者設定〔無 ☆、有 ☆、素食、過敏、快煮、低碳、少油〕的候選前 N 名與其 form）；`recs`、`matrix` 快照更新並逐條說明。
- check-engine 新增不變量：每個候選 `cookFormProblem===null`；快煮候選全部 `isQuickTier`；候選全部通過硬性過濾；同一天各時段主蛋白質不重複；同種子結果穩定、換日不同；熱量落在預算 ±35% 內的比率；☆ 不足 k 時用預設補足；完全沒 ☆ 時池＝預設。
- mobile-walkthrough：今日建議出現新格式名稱；「記錄這餐」寫入 form；「自己選」帶入同一份。

### 2.6 分階段
- **S1** 資料：`default_pick` 旗標（food_tree、home_dishes build）＋涵蓋度檢查＋自己選主列表改讀它（取代 `COOK_COMMON`）。
- **S2** 「我的食物」☆：家常菜子分頁、舊 ☆ id 轉換、☆ 說明文字。
- **S3** engine：`cook-rec.js` 生成＋評分接上 `recommend.js`、`auto` 優先序、章程與 check-arch 修訂。
- **S4** UI：推薦卡、倒讚／順便不要、記錄、帶入自己選、昨天最後顯示的推薦。
- 每階段本機 commit；S3、S4 動快照，逐條說明。

## 3. 我自己最擔心的點（請特別攻擊）

1. **生成式取樣 vs 窮舉**：取樣是否會讓結果品質不穩（常推出怪組合）？有沒有更簡單、可驗證的做法？預設做法表要放哪、誰維護？
2. **`auto` 的「先自煮再外食再超商」**：用「可用」＋熱量偏差 35% 當門檻，會不會讓 auto 永遠只推自煮，等於偷偷改掉 auto 的語意？是否該用加分而非 fallback？
3. **☆ 語意變更對既有使用者的衝擊**：只 ☆ 一樣蔬菜的人、舊 ☆ 轉 `fx_` id 找不到對應的人、同時有 ☆ 與不吃的人。k 值與「補預設」是否夠？是否該讓使用者看得見「建議池」是什麼（目前沒設計畫面）？
4. **「自己選」主列表也改讀 ☆／預設**：這是否超出使用者要求（他要的是推薦）？會不會造成使用者明明沒 ☆ 卻覺得選單被縮水？（現在是「常見的」名單＋更多。）
5. **回饋 id 與歷史相容**：form hash 當 id；舊回饋 id（archetype 組合）失效；`last_shown_recs` 含舊格式 content，昨天的卡片要能解析新舊兩種；預約、組合帶入維持。有沒有漏掉的消費者？
6. **確定性輪轉**：日期＋時段種子洗牌夠不夠；「重新整理建議」按鈕現在怎麼運作（舊機制靠 `shown_count` 降權換掉？）會不會在新機制下失效？
7. **C4.16**：使用者說「固定吃（我的組合／我的料理）往前排、自動推薦排後面輪轉」，我解讀成只指自己選。如果他其實要推薦也先推他存的組合，會牴觸 C4.16 與「推薦不讀組合」，要不要開例外？
8. 範圍是否太大、階段順序對不對、有沒有更小的第一刀。

## 4. 必讀檔案

`js/engine/cook.js`、`js/engine/pool.js`、`js/engine/recommend.js`、`js/engine/today.js`、`js/engine/meal-content.js`（`cookDraftPart`、`contentFromRec`、`recLogParts`、`lastShownSlots`）、`js/ui/tab-today.js`（`renderRecs`、`dislikeChipsHtml`、記錄流程）、`js/core/config.js`（`COOK_*`）、`js/core/slots.js`、`docs/CHARTER.md`（C4.16、C4.17 在第 325 行附近）、`tools/check-arch.js`、`tools/diff-recs.js`、`collab/opus-review-log/2026-10-11-merge-into-main.md`、`collab/handoff-2026-10-11-cook-main-integration.md`。
