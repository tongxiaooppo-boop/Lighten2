# 目前任務（來自 Claude）— 今日建議：手動組餐＋不吃清單＋熱量口徑修正＋展開式營養素明細

這是兩輪 Opus 獨立審核後定案的改動（使用者實測回饋三件事：hero 熱量跟卡片對不上、有些食材不吃想自己選、想看完整營養素配比）。**完整討論過程跟每個取捨的理由都在 `collab/opus-review-log/2026-09-27-manual-meal-builder-and-hero-budget.md`，這份清單是我依那份定案整理出的實作清單；哪個細節這份清單沒講清楚，先去看那份 log，不要自己猜。** 範圍很大，切成 8 個部分，**建議每個部分一個 commit**。

核心方向：
1. 今日建議每個時段卡片旁加「自己選」，開跟美饗日曆同款式的品項挑選器，但改成可以多選、套硬性過濾（過敏原/飲食限制/新的「不吃食材」清單），選完直接寫入 daily_log，略過推薦引擎的評分。
2. 新增「不吃食材」清單（跟過敏原分開，軟性但硬過濾），接進推薦引擎候選池過濾，這是解決「有些食材不吃」的根本修法。
3. `recommend.js` 改成依序處理時段、把每個時段「真實品項熱量 vs 配額」的差額帶給下一個時段，讓卡片熱量加總更貼近剩餘預算；hero 大數字維持原本的 `remainingKcal`（不受推薦結果影響），新增次要行顯示卡片實際加總與落差。
4. hero 加一個展開區塊：完整四項營養素（蛋白質/脂肪/碳水/纖維）目標 vs 累積、P/F/C 佔比、碳水標「參考值」、資料涵蓋率警語。
5. **修一個查證出來的既有資料正確性問題**：`taiwan_items.json`／`convenience_items.json` 完全沒有 fat_g/carb_g 資料，現有程式碼把這兩項寫死成 0，等於把「未知」存成「假的已知」。這輪要全部改成 `null`，並在所有加總的地方跳過 null（不能當 0 加），這個修正**跟這次的新功能無關但必須順便做**，不然新功能會把錯的數字越存越多。

---

## Part 1：缺值改存 null，不要存 0（資料正確性，優先做，其他 Part 依賴這個）

**背景**：`js/engine/recommend.js` 的 `fromTaiwan()`（約第423-434行）把 `carb_g`/`fat_g` 寫死 `0`；`fromConvenience()`（約第412-421行）雖然讀 `it.carb_g`/`it.fat_g`，但 `data/convenience_items.json` 裡這兩欄目前全部是 `null`（`num()` 函式會把 `null`/`undefined` 轉成 `0`）。這代表任何吃了台式外送／超商品項的一餐，脂肪跟碳水在資料上就是掛零，不是估算誤差。`DEFAULT_MEAL_PREFS` 預設早餐/午餐就走 convenience 來源，影響面很大。

**改法**：
- `fromTaiwan()`：`carb_g: null, fat_g: null`（不要再寫 0）。
- `fromConvenience()`：`carb_g: it.carb_g != null ? num(it.carb_g) : null, fat_g: it.fat_g != null ? num(it.fat_g) : null`（不要透過 `num()` 把 null 轉 0）。
- `toItemCombo()`（約第436-461行）目前用 `members.reduce(...)` 直接加總 `carb_g`/`fat_g`：改成「只要組合裡任一成員該項是 `null`，整個組合這項就是 `null`；否則正常加總」。寫一個小 helper，例如：
  ```js
  function sumOrNull(members, field) {
    if (members.some(function (m) { return m[field] == null; })) return null;
    return round1(members.reduce(function (s, m) { return s + m[field]; }, 0));
  }
  ```
  蛋白質/纖維目前資料都有值，理論上不會是 null，但這個 helper 統一套用在 kcal 以外的四項（protein_g/carb_g/fat_g/fiber_g），保持一致、以後任一項缺資料都安全。
- `achievableNutrition()`（recommend.js 約第206-221行）：composed 食譜（自組食譜）的 protein/carb/fat/fiber 一定有值（來自 `data/*.json` 的 raw ingredient 軸，都有完整營養素），這條路徑不用改。但函式簽名要能正確傳遞 `null`（非 composed 分支目前是 `carb_g: c.carb_g` 直接透傳，null 會自然透傳過去，不用特別處理）。
- **全專案搜尋所有讀 `carb_g`/`fat_g` 做加總或運算的地方**（`tab-today.js` 的 hero 累積量、Part 4 新增的 P/F/C 佔比、任何 `reduce`），一律用「跳過 null，不當 0 加，另外累計『缺資料的 kcal』」的寫法，不能讓 null 直接參與加法變成 `NaN`。具體位置至少包含：`tab-today.js` `renderHero()` 裡任何以後會加的 fat/carb 累積（Part 4 會新增，寫的時候就要處理 null）。
- **舊資料相容**：這次改版**之前**已經寫進 `daily_log` 的紀錄，`carb_g`/`fat_g` 是「真的 0」還是「舊版寫死的假 0」分不出來，這種舊紀錄用 `source_type` 落在台式外送／超商（`source_type === 'taiwan_item'` 或組合裡帶 `tw_` 開頭 uid／`channel === 'delivery'`／`convenience`）當作「這筆缺資料」的 fallback 判斷依據；**改版之後**新寫入的紀錄一律看欄位是不是 `null` 就好，不用猜。這兩套判斷邏輯都要留著（新舊資料並存）。

**驗證**：改完後，讓一個候選池裡「只含台式/超商品項」的組合跑一次 `buildCandidatePool()`，確認 `carb_g`/`fat_g` 是 `null` 不是 `0`；混了自組食譜成分的組合維持正常數字。

---

## Part 2：`component_ids` 欄位 + 手動組餐的 daily_log 寫入格式

**背景**：Opus 審核要求手動組餐（Part 5）跟現有「記錄這餐」都要多存一個 `component_ids` 欄位（純 id 陣列，不建 index，UI 不讀它），因為 Part 4 的資料涵蓋率警語需要靠它才能正確判斷「這筆記錄裡有沒有缺資料的成分」，光看 `source_type` 分不出來（`manual_combo` 混著自組食譜/台式/超商/自訂食物）。

**改法**：
- `js/ui/tab-today.js` 的 `onLogRecClick()`（約第333-356行）寫入 `daily_log` 時多加一個欄位：`component_ids: rec.components || null`（`recommend.js` 產生的候選物件本來就有 `components` 陣列，見 `toItemCombo()` 跟自組食譜那段的 `components: items.map(...)`，直接透傳即可）。
- Part 5 的手動組餐送出時，同樣寫 `component_ids: [...使用者選的每個品項 uid...]`。
- `feast.js` 的 `logFeastDirectly`／`confirmFeast` 這條路徑（美饗日曆，單一品項或份量估算）目前沒有「多個成分」的概念，不用加這個欄位（維持現況）。

---

## Part 3：共用硬性過濾函式 `passesHardFilters`

**背景**：目前 `recommend.js` 的 `passesAllergens()`（約第173行）跟 `passesDiet()`（約第187行）只有推薦引擎在用。美饗日曆的品項挑選器（`tab-ledger.js`）**完全沒有**套用這兩個過濾——這是一個**既有安全漏洞**，這輪要一併修掉。Part 5 的手動組餐也要用同一份。

**改法**：
- `recommend.js` 新增並匯出 `passesHardFilters(candidateOrItem, profile)`：整合 `passesAllergens`（讀 `candidate.allergen_tags`）＋`passesDiet`（讀 `candidate.diet_tag_sets`，單一品項沒有「多成分」概念時包成 `[item.diet_tags || []]` 再丟進去）＋**新增第三個條件**：`disliked_ingredients` 檢查（見 Part 4）。回傳 `{ ok: boolean, reason: string|null }`（不只是 boolean，UI 要顯示原因，例如「含：花生」或「你已設定不吃：香菜」或「飲食限制未確認」）。
- `recommend.js` 內部 `getTodayRecommendation()` 的候選過濾（約第556-570行）改呼叫這個共用函式（行為不變，只是換個入口）。
- `tab-ledger.js` 的 `renderItemPicker()`（約第158-178行）：每張品項卡呼叫 `passesHardFilters(item, profile)`（品項是 taiwan_items/customFoods 的原始物件，不是 recommend.js 的候選物件，注意欄位名稱可能要轉接——例如 `diet_tags` 直接讀，不用轉成 `diet_tag_sets`，函式內部要能吃兩種形狀，或者寫一個小 adapter）。不通過的卡片：**不要從清單移除**，改成加 `disabled`/`is-blocked` class（灰階＋不能點），卡片上顯示 `reason`（例如小字「含：花生」）。
- **行為變更提醒（Opus 特別交代要驗收）**：這個改動生效後，原本使用者能在美饗日曆選到的品項，只要命中過敏原/飲食限制，會變成灰的選不了。**已經存在的預約/紀錄不會被追溯擋掉**，只影響「新增」時的挑選畫面。
- 自訂食物（`custom_foods`）目前的 schema 如果沒有 `allergen_tags`/`diet_tags` 欄位，過濾函式要能安全處理（視為「未確認」，飲食限制有設定時保守排除；過敏原則因為是使用者自己輸入的食物，判斷邏輯上「沒有過敏原標記」時**不要**當成未確認排除，因為使用者不會幫自己輸入的食物標過敏原——這條只套用在台式/超商品項，自訂食物的過敏原檢查略過，直接放行）。

---

## Part 4：「不吃食材」清單（軟性排除，兩態，不是三態）

**背景**：跟過敏原是兩回事——過敏原是安全性，這個是純粹習慣/喜好，但一樣要硬性套用（不是評分降權）。這是解決「有些食材不吃」抱怨的根本修法，比手動組餐更直接。**只做兩態**：現有「倒讚＝這個確切組合永遠不要」（不動）＋新增「這個食材永遠不要」。不做「今天不要」這一態。

**資料結構**：`profile.disliked_ingredients`，陣列，每項 `{ type: 'protein'|'staple'|'vegetable'|'sauce'|'item', key, label }`：
- 自組食譜的蛋白質/蔬菜：`type` 對應 `protein`/`vegetable`，`key` 用 `combo.protein_name`/`combo.vegetable_name`（字串比對，跟 `recommend.js` 的 `recencyMap` 用同一種 key 思路）。
- 現成品項組合（超商/台式）：`type: 'item'`，`key` 用成分的 `uid`（例如 `tw_ln08` 或 `conv_dr01`），一個組合可能列出多個可排除的成分（每個 `component_ids` 一個）。
- `profile.disliked_ingredients` 預設 `[]`（沒有欄位時視為空陣列，跟 `profile.allergens` 一樣不用 migration，`user_profile` 是單例整包覆寫的 schemaless store）。

**UI 入口**：今日建議每張推薦卡片（`tab-today.js` `renderRecs()`，約第163-173行）在「倒讚」按鈕旁邊，依組合內容動態列出可以「順便不要」的項目，例如：
```
[倒讚]  順便不要：[雞胸肉] [高麗菜]
```
（自組食譜列蛋白質＋蔬菜兩個 chip；現成品項組合列每個成分名稱一個 chip；沒有可拆解的成分就不顯示這排）。點擊某個 chip → 寫入 `profile.disliked_ingredients`（`saveProfile`）→ 立刻重跑 `buildRecommendation()`。

**過濾套用點**：
- `recommend.js` 的 `passesHardFilters()`（Part 3）新增第三個檢查：組合的 `protein_name`/`vegetable_name` 或任一 `components` id 命中 `profile.disliked_ingredients` 就排除，回傳 reason「你已設定不吃：{label}」。
- `tab-ledger.js` 品項挑選器（美饗日曆）**也要套用**（Opus 建議兩處一致，我方已拍板採納）——挑選器裡任何命中清單的品項一樣灰掉。
- 手動組餐（Part 5）挑選器同樣套用。

**基本資料分頁**：新增一個小區塊「不吃的食材」，列出目前 `disliked_ingredients`（chip + × 移除按鈕），沒有項目時顯示「尚未設定」。不用像過敏原那樣做固定 8 選項的 checkbox（這個清單是動態累積的，不是預先列舉）。

---

## Part 5：手動組餐（今日建議「自己選」）＋ 美饗日曆挑選器改成共用多選元件

**背景**：使用者原話拍板「自購食材要學美饗日曆自己配菜後加入，跟美饗一樣型態」。做法是把美饗日曆現有的卡片式品項挑選器，抽成一個共用元件，加一個 selection policy 參數，兩個分頁共用。

**共用元件改法**（建議放在一個新檔案 `js/ui/item-picker.js`，或視現有程式風格直接加在 `tab-ledger.js` 頂部再讓 `tab-today.js` 呼叫，Cline 自行判斷哪種比較不破壞現有結構，但**不要複製貼上兩份邏輯**）：
- 接受參數：`{ slot, profile, policy }`，`policy = { mode: 'single'|'multi', maxByRole: { main: 1, side: 1, drink: 1, snack: 1 }, requireMain: boolean }`。
- 正餐時段（早/午/晚/宵夜）：`requireMain: true`，`maxByRole` 用推薦引擎同一套規則（1主餐+1配菜+1飲料+1點心，main 已內含飲料時飲料是0）。
- 下午茶：`requireMain: false`，`maxByRole` 比照推薦引擎（不需要主餐，其他類各1）。
- **自訂食物的 role**：目前 `custom_foods` 的 schema 如果沒有 `category`/`role` 欄位，建立自訂食物時**要求使用者選一個角色**（主餐/配菜/飲料/點心），或者先簡化成「一律算配菜，一餐最多1個自訂食物」——兩個方案 Cline 選一個簡單能做的，不用回來問，但要在 `from-cline.md` 報告裡講清楚選了哪個。
- 每張卡片：呼叫 Part 3 的 `passesHardFilters()`，不通過的灰階＋顯示原因，不能被選。
- **`policy.mode === 'multi'` 時**：卡片點擊變成 toggle 選取/取消選取（不是點了就送出），選取後累計 kcal/protein_g/carb_g/fat_g/fiber_g（用 Part 1 的 `sumOrNull` 邏輯，任一選中項目缺資料，對應欄位顯示「—」不要顯示 0）。累計數字即時顯示在挑選器底部。
- **超過 `maxByRole` 上限**：不阻擋，但同角色第二個要選時，UI 提示「這個時段的配菜/飲料/點心已經選過了，要不要先取消上一個」（維持你在第二輪跟 Opus 對齊的決定：上限是 UI 選取上限，只放寬熱量限制，不放寬品項數量上限）。
- **超過這個時段的熱量配額**：非阻斷提示，例如「這組合約 850 kcal，這個時段配額約 500 kcal（+350）」，可以送出。

**缺口提示（用 Part 6 的 `slotNutrientShare`，不是 `matcher.js` 的全天/全週缺口）**：
- 使用者選完（送出前）即時顯示：這個時段依權重分到的蛋白質/纖維份額 vs 目前選取的草稿加總，有缺口時列出候選池裡「角色是配菜/飲料/點心、通過硬性過濾、加上去不超過這個時段配額＋合理誤差（例如 +100kcal 容許值）」的品項，按「每100kcal能補多少缺口」排序，取前1~2個顯示為建議加購（點擊直接加入草稿，不強迫）。

**送出**：
- `mode: 'multi'`（今日建議手動組餐）：寫**一筆** `daily_log`：`item_name` 用「＋」串接選中品項名稱、`kcal`/`protein_g`/`carb_g`/`fat_g`/`fiber_g` 用 `sumOrNull` 加總、`source_type: "manual_combo"`、`item_id: null`、`component_ids: [選中的uid...]`、`is_feast: 0`。可以撤銷（沿用現有 `undoDailyLog`，`feast_reservation_id` 為 null 就能撤銷，這條路徑本來就滿足這個條件）。
- `mode: 'single'`（美饗日曆，行為跟現在一樣）：不動，只是換成呼叫共用元件＋套用硬性過濾。

**「今日建議」頁面 UI**：每個時段卡片（`renderRecs()`）在既有「記錄這餐」按鈕旁邊加一個次要按鈕「自己選」，點開挑選器（modal 或展開區塊皆可，Cline 判斷現有 CSS 架構怎麼加比較不突兀）。已經記錄/已預約/已關閉的時段不顯示這個按鈕（跟現有「記錄這餐」按鈕一樣的顯示條件）。

---

## Part 6：`budget.js` 新增 `slotNutrientShare`（給 Part 5 缺口提示用，engine 層，不是 UI 層）

**這個函式只給「手動組餐的缺口提示」用，不改 `matcher.js`／`checkHardConstraints`，兩套缺口口徑刻意並存**（推薦引擎排序用全天/全週缺口，手動組餐提示用單餐份額）——**這個決定寫進程式碼註解，避免以後被誤以為要統一**。

```js
// targets: nutrition.js 算出的 { targetKcal, protein_g, fiber_g, ... }
// todayLogs: 今天已經寫進 daily_log 的紀錄（不含草稿）
// enabledSlots: profile.enabled_slots
// slot: 要算份額的時段
// 回傳 { kcalShare, proteinShare, fiberShare }：這個時段「不含任何草稿」按權重分到的份額
function slotNutrientShare(targets, todayLogs, enabledSlots, slot) {
  // 邏輯照 recalcTodayBudget 的權重分配，但這裡故意不把草稿塞進 todayLogs，
  // 因為 recalcTodayBudget 只要看到某時段有東西就會把它當「已吃」歸零配額，
  // 拿去算「這個時段自己的份額」邏輯會兜死變成 0（Opus 第二輪審核明確指出這個坑）。
  // 公式：份額 = 不含草稿的剩餘量 × 本時段權重 ÷（含本時段在內、所有未吃時段的權重總和）
}
```
- kcal/蛋白質/纖維三項都用同一組權重（`DEFAULT_WEIGHTS`）算。
- Part 5 呼叫時，缺口 = `share − 草稿加總`（草稿加總在 UI 層算，`slotNutrientShare` 本身不吃草稿）。
- 寫成純函式（不呼叫任何 DB 函式），方便之後寫測試。

---

## Part 7：`recommend.js` 依序分配 + Hero 兩個數字 + 展開式營養素明細

### 7a. `getTodayRecommendation` 改依序處理

**背景**：現況每個時段的 `budgetBySlot[slot]`（來自 `recalcTodayBudget` 一次性算好的 `perSlotSuggestion`）互相獨立，挑到不能縮放的超商/外送品項時，跟配額的差額不會影響其他時段——這是 hero 大數字跟卡片加總對不上的根本原因。

**改法**：把 `getTodayRecommendation()` 裡 `SLOTS.forEach` 那段（約第547-616行）改成**依固定順序**（`["breakfast","lunch","afternoon_tea","dinner","snack"]`，原本就是這個順序，不用重排）依序處理，維護一個「還沒處理時段的剩餘熱量池」：
1. 一開始剩餘熱量池 = `remainingBudget.remainingKcal`（budget.js 已經算好的全天剩餘）。
2. 每個時段開始前，用剩餘熱量池 × 本時段權重 ÷（含本時段在內、所有還沒處理時段的權重總和）算出這個時段的當下配額（這段邏輯可以直接複用/抽出 `recalcTodayBudget` 內部的分配算式，寫成一個小 helper 兩處共用，不要複製貼上）。
3. 挑到真實品項後，剩餘熱量池 -= 這個品項的 `scaled_kcal`（不是原本配額），這樣差額自然帶到下一個時段。
4. **低額度門檻**：`LOW_BUDGET_THRESHOLD_KCAL = 150`（寫成具名常數）。如果某時段當下配額低於這個門檻，**不要跑候選搜尋**，直接 `result[slot] = { lowBudget: true }`（或等效標記），UI 顯示「今天的額度已經用完／所剩不多」，跟「找不到符合的組合」是兩種不同文案（Opus 特別交代不能共用同一句）。
5. skip 的時段（已記錄/已預約/已關閉）依然回傳 `null`，不佔用剩餘熱量池（這段邏輯不變）。

`score()` 函式吃的 `budget` 參數改成「這個時段依序算出來的當下配額」，其餘評分邏輯（蛋白質封頂/纖維封頂/recency降權/喜歡加分）不用動。

### 7b. Hero 兩個數字

**主數字定義（Opus 明確要求寫死，避免歧義）**：`今天還能吃 = remainingBudget.remainingKcal`，也就是 `budget.js` 原本 `recalcTodayBudget` 算出的值，**不受 7a 依序分配的過程影響**，維持現有 `renderHero()` 的算法不變。

**次要行（新增）**：`目前這幾餐建議合計 = recs 裡每個非 null 且非 lowBudget 的卡片 scaled_kcal 加總`。跟主數字有落差時顯示 `(+Z)`/`(-Z)`；沒有落差（或落差很小，例如 <20kcal）可以不特別標示正負號，正常顯示就好。

**每張卡片展開區塊**：顯示「配額 {7a算出的當下配額} → 這組 {scaled_kcal}」，有落差時加註原因（composed 食譜縮放範圍不夠、或超商/外送品項不能縮放）。

**「找不到候選」vs「額度不足」兩種文案**（對照 7a 第4點）：
- `result[slot].lowBudget === true` → 「今天的額度已經用完／所剩不多」。
- `result[slot] === null` 且不是 lowBudget → 「這個時段沒有找到符合的組合」（沿用現有 `rec-empty` 文案位置）。

### 7c. 展開式營養素明細（對應原始問題3）

`renderHero()` 新增一個 `<details>` 展開區塊（不用額外實作 JS 開合邏輯，`<details>`/`<summary>` 原生支援）：
- 四項：蛋白質/脂肪/碳水/纖維，各自「今日已吃累積 vs `targets` 裡的目標值」（`targets.protein_g`/`fat_g`/`carb_g`/`fiber_g`，`nutrition.js` 早就算好，只是沒顯示）。
- 脂肪/碳水累積：用 Part 1 的 null-safe 加總（跳過 null，不當 0）。
- P/F/C 佔熱量百分比：`protein_g*4/targetKcal`、`fat_g*9/targetKcal`、`carb_g*4/targetKcal`，低成本，資料都有。
- 碳水明確標「參考值」，展開文字寫一句：「碳水是用目標熱量扣掉蛋白質、脂肪熱量後反推出來的，不是獨立設定的建議值」。
- **資料涵蓋率警語**：今天的 `daily_log` 裡，凡是 `fat_g == null || carb_g == null`（新紀錄）**或** `source_type` 屬於台式外送/超商且是改版前寫入的舊紀錄（Part 1 提到的 fallback 判斷），加總這些紀錄的 `kcal`，顯示一行：「今天有 {N} kcal 來自沒有脂肪/碳水資料的品項（超商即食／台式外送），這部分的脂肪、碳水沒有算進上面的數字」。`N` 是 0 就不顯示這行。

---

## Part 8：文件同步 + 已知限制章節

`輕盈計畫PRD_v4.0.md`／`輕盈計畫_TECH-SPEC.md`：
- 新增「手動組餐」「不吃食材清單」「共用硬性過濾」「daily_log 新增 component_ids」「hero 雙數字」「營養素展開區塊」的規格段落，可以直接引用 `collab/opus-review-log/2026-09-27-manual-meal-builder-and-hero-budget.md` 的結論摘要。
- 新增「已知限制」章節（如果還沒有就新開一節），至少寫：
  - 不追蹤鈉/糖/飽和脂肪/反式脂肪，也不做生重→熟重換算（資料庫目前完全沒有這些欄位）。
  - 全素/蛋奶素使用者打開手動組餐或美饗日曆挑選器時，台式/超商品項因為「成分未確認一律保守排除」，可能看到大半品項是灰的，這是刻意的保守設計，不是 bug。
  - 不做過敏原/飲食限制的「單次放行」，被擋住的品項目前沒有繞過的方式。
  - 手動組餐的個別品項明細只存 `component_ids`（id 陣列），UI 不會反查回去逐一顯示——歷史紀錄看到的是加總後的名稱字串跟總營養素，不是逐項明細。

---

## 驗收清單（照 Opus 兩輪審核的條件，直接照抄跑一遍）

- `fromTaiwan()`/`fromConvenience()` 缺值一律 `null`，不是 `0`；`toItemCombo()` 的 `sumOrNull` 只要組合裡有一項成分該欄位是 `null`，整組這欄就是 `null`。
- 全專案所有讀 `carb_g`/`fat_g` 做加總/運算的地方，缺資料時不會出現 `NaN`，也不會把 null 當 0 算進去。
- 手動組餐挑選器即時加總，缺資料時顯示「—」，不顯示 `0g`。
- `component_ids` 欄位在「記錄這餐」（推薦引擎路徑）跟「自己選」（手動組餐路徑）都有寫入。
- `passesHardFilters()` 在推薦引擎、美饗日曆挑選器、手動組餐挑選器三處回傳一致的結果（同一個過敏原/飲食限制/不吃清單設定，三處擋的品項要一樣）。
- 美饗日曆挑選器套用硬性過濾後，命中過敏原/飲食限制的品項卡片變灰、顯示原因、不能點；已存在的預約/紀錄不受影響。
- 設定一個「不吃食材」後，推薦引擎的候選池、美饗日曆挑選器、手動組餐挑選器都要排除含這個食材的組合/品項；基本資料分頁看得到、移得掉這筆設定。
- 手動組餐：正餐時段選超過 1 主餐會被 UI 擋（或至少明確提示"已經選過主餐"，不會生出兩個主餐的組合）；下午茶不需要主餐；超過熱量配額只是提示，可以送出；送出後可以用現有撤銷機制刪除。
- 缺口提示的份額用 `slotNutrientShare()`（不含草稿的剩餘量分配），不是拿 `matcher.js` 的全天/全週缺口；`matcher.js`／`checkHardConstraints` 本身完全沒改動（推薦引擎排序邏輯不受影響，跑一次現有的推薦流程確認排序沒變）。
- Hero 主數字 `today-hero-kcal-value` 維持等於 `remainingBudget.remainingKcal`（改動前後同一組輸入要算出同一個數字）；次要行是卡片加總，有落差才顯示差額。
- 某時段依序分配後配額低於 150kcal（`LOW_BUDGET_THRESHOLD_KCAL`）時顯示「額度已經用完/所剩不多」，不會誤顯示成「找不到組合」。
- 營養素展開區塊：蛋白質/脂肪/碳水/纖維四項都有顯示，碳水標「參考值」並有說明文字；資料涵蓋率警語在有缺資料紀錄的日子才出現，N=0 不顯示。
- `node --check` 全部 `.js` 通過。
- grep 全專案確認新文案沒有用到禁用字（額度/剩餘/超支/彈性點數/還/補/抵/存，含「還沒」「補充」）——**除了 Part 7b 的「今天的額度已經用完／所剩不多」這一句是刻意的例外**（這裡的「額度」指的是這個時段的剩餘配額用完了，不是彈性點數語境，跟 PRD 6.2 禁用的「彈性額度」是不同概念；如果覺得這樣寫還是會混淆，可以改成「這個時段的配額已經不多了」，兩種寫法你選一個，跟 `from-cline.md` 報告裡註明選了哪個）。

---

做完後照協作規則：**只要本機 commit，不要 `git push`**，並把報告寫進 `collab/from-cline.md`。這輪範圍大，建議 Part 1、Part 2+3、Part 4、Part 5、Part 6、Part 7、Part 8 分開 commit，比較好追蹤跟回溯。

## 分工說明

GitHub push 與部署由 Claude 負責，Cline 只需要寫程式、本機 commit，不用處理 remote，不用管部署。
