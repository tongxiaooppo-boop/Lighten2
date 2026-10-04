# 家庭共餐（自煮）設計草案 v0 獨立審核紀錄

# 第一輪

日期：2026-10-04。審核者：獨立 Opus agent（非實作者）。只讀程式與資料，在 scratchpad 寫暫時腳本讀 `data/*.json` 算反推與過敏原；唯一寫入 repo 的檔案是本紀錄。

## 一、收到的完整問題（逐字）

### 協調者訊息

你是獨立審核者（Opus），審核「輕盈計畫 Lighten2」（D:\ok\lighten，純前端 vanilla JS＋IndexedDB）的一份設計草案。請一律用繁體中文。**只讀；唯一可以寫的檔案是審核紀錄 `D:\ok\lighten\collab\opus-review-log\2026-10-04-home-meal-cook-review.md`**（新建；把你收到的完整問題與你的完整回答逐字寫進去，標「第一輪」）。不要改任何其他檔案、不要 commit。可以在 scratchpad 寫暫時腳本讀 data/*.json、js/ 驗證，不改 repo。

待審：`D:\ok\lighten\docs\review\2026-10-04-家庭共餐-設計草案.md`（請先完整讀它，裡面有背景、使用者決定、方案 X／Y、六個問題）。
背景資料請讀：`docs/PRD.md`（第 3 節 MealContent 與 `dish`／`food`／`estimate` 元件、第 5 節採買清單、第 11 節組合與計畫、12.5 我的料理、13.4 單品）、`docs/CHARTER.md`（B4 家常菜估算、B6.3 複合料理過敏原未確認、C1／C2、C4.5、C4.11、C4.13、C4.17）、`docs/decisions.md` #62、#96、#133、#136、#148、#151、先前兩輪審核 `collab/opus-review-log/2026-10-04-home-dish-estimate-review.md` 與實作審核 `2026-10-04-home-dish-estimate-impl-review.md`；程式：`js/engine/meal-content.js`（buildDraftContent、contentTotals、toSavedContent、toPlanContent、resolveSavedMeal、savedMealDraft、foodComponent／foodAmount、homeEstimate*）、`js/data/db.js`（COMPONENT_KINDS、validateDailyLog、savedContentProblems、noIngredientCookProblems、foodAmountProblems）、`js/ui/meal-picker/`、`js/data/catalog.js`、`data/home_dishes.json`、`data/reference/home_dish_recipes.json`、`tools/check-arch.js` 的 C4.17③。

要求：
1. 逐題回答草案 §4 的六題，點名檔案與行號；特別是 Y 與切片 9「我的料理」（PRD 12.5）的相容性、`dish` 元件目前在 db／engine 預留到什麼程度（實際讀程式，不要只信文件）、過敏原與素食的處理建議、採買反推算法與資料缺口（用 `data/home_dishes.json`、配方檔實際算幾道菜的反推結果當例子）。
2. 指出草案有沒有漏的架構問題（例如：快照 `amount` 記法對湯的毫升、`dish` 的 ref 前綴與 `cing_`／`fx_` 的 id 空間、`hd_` 家常菜資料改動後已存預約與紀錄的行為、既有 est 家庭共食資料改名自助餐的牽動範圍、diff-recs／walkthrough／check-arch 要動哪些）。
3. 給「定稿清單」M（必改）／S（建議）／N（日後），與「可以開工的條件」，以及要問使用者的產品決定（附你的建議）。若你認為需要第二輪，請明說；否則說「不需要第二輪，照清單對照驗收」。
最終訊息請給：結論、方案選擇（X／Y 或你的第三案）、M／S／N 清單、開工切法（每步獨立可驗收、pre-commit 能過）。

### 草案 §4 原文

## 4. 給審核者的問題
1. 方案 Y（重用 `dish`＋`food`）與方案 X，哪個對？Y 會不會把切片 9 的設計綁死（PRD 12.5 `dish` 的 `qty` 倍數 vs 這裡的 `amount` 克）？`hd_` 內建家常菜與使用者的 `cdish_` 同一元件會有什麼衝突（db 驗證、快照 name、備份、`remapSavedRefs`）？
2. 每道菜快照存「1 份的量與營養」（`amount` 記法）夠嗎？預約只存 ref＋amount、日後家常菜資料改了怎麼辦（食材重算）——跟 food 元件的作法一致嗎？
3. 過敏原與素食怎麼處理（§3.3 最後一點）：複合料理一律未確認；有設過敏原的使用者要不要擋？建議值是什麼？
4. 採買反推（§3.4）的算法與資料缺口：配方 ref 中衛福部編號、調料、水、鹽怎麼進採買？`cooked_g` 當分母合理嗎（滷汁、湯的水量假設）？人數要不要由使用者在共餐表單選（而不是全域 household_size）？
5. 這一輪的切法與順序（文件先行 → db／engine 斷言 → 選擇器畫面 → 採買純函式）是否能每個 commit 通過 pre-commit？現有 `est` 的家庭共食要改成自助餐，哪些程式／文件／快照／walkthrough 會被牽動？
6. 還有沒有要問使用者的產品決定（共餐只午晚餐？每道菜各自調份量？共餐的菜要不要有「常吃」？）。

（草案全文見 `docs/review/2026-10-04-家庭共餐-設計草案.md`，本輪審的是該檔當下的版本。）

## 二、完整回答（逐字）

### 0. 結論

方向可以做，使用者的四個決定都能落地；但 **Y（重用 `dish`）不是最好的選擇**。我建議第三案 **Y′：共餐的每道菜、湯都當成 `food` 元件（`ref` 是 `hd_` 開頭、只用 `amount` 克／毫升記法），主食也是 `food`**。理由很簡單：`hd_` 家常菜的性質跟 `food` 一模一樣（固定的每 100g、用克數記、沒有角色、硬性過濾看品項自己的標籤），跟 PRD 12.5 的我的料理（營養由使用者食材即時算、`qty` 倍數、有角色上限、沒有成品重）反而不像。Y′ 的好處：`js/data/db.js` **一行都不用改**、備份不受影響、切片 9 的 `dish` 設計原封不動、`check-engine` 拿 `"dish"` 當不合法元件的兩條測資也不用換。

開工前必須先處理的事（細節見 M 清單）：
1. **章程 C4.1 會擋**：草案提的「有設過敏原也不擋、只顯示未確認」違反 C4.1「未確認就排除，自訂食物沒有例外」（`docs/CHARTER.md` 第 303 行）。共餐的菜是有 `ref` 的具體品項，不是匿名估算，所以要照擋。過敏原標籤由配方推導（聯集＋「未確認」），素食一律「未宣告」。
2. **重新打開預約時表單要能還原**：草案沒提到。預約只存 `ref`＋`amount`，從預約／組合帶回選擇器（`savedMealDraft`，`js/engine/meal-content.js` 1003–1031 行）時，必須能從元件反推回「主食、主食量、哪幾道、菜量、湯」；不然 hd_ 會被當成一般單品塞進 `foodSel`，而 `m.foods.byId` 裡沒有 hd_ 會被**默默丟掉**（`js/ui/meal-picker/index.js` 276、325 行）。
3. **解析路徑碰到 hd_ 會丟錯**：`resolveSavedMeal` 的 food 分支裡，分層查不到就直接呼叫 `myIngredientRec`（968–973 行：`const rec = myIngredientRec(ctx, c.ref); if (rec.source === ...)`）；hd_ 在沒帶 `customIngredients` 時會丟錯，帶了則 `rec` 是 null，`rec.source` 會 TypeError。`remapSavedRefs`（877–914 行）會把 hd_ 當成查不到丟掉，預約因此失效。
4. **決策與文件互相矛盾**：decisions #148「不建菜色資料」、#151「只供估算、不供逐道選擇」、PRD 第 184 行（5.2「不是三菜一湯大家夾…明確排除在 2.0 之外」）、第 280 行（第 8 節）、章程第 48 行（`home_dishes.json`「不供逐道選擇」）都要由新的決策 #152 明確取代。
5. **單品上限**：主食＋4 道＋湯＝6 個 `food`，超過 `FOOD_MAX_PER_MEAL = 4`（`js/core/config.js` 第 51 行、章程 C4.8）。要定規則（建議：家常菜另計，菜 ≤ 4、湯 ≤ 1，主食算 1 項單品）。
6. **每道克數要是整數**：`isFoodAmount` 只收整數（config 62–63 行），160g 分 3 道＝53.33g 不合法。要定「每道＝Math.round(全分量 ÷ N)，合計以存下的克數為準」。

做完 M 清單就可以開工。**不需要第二輪，照清單對照驗收**（前提是協調者採用 Y′；如果仍選 Y，M 清單另附的 Y 專屬項目也都要做，同樣不需要第二輪）。

### 1. 第 1 題：X、Y 還是第三案？Y 會不會綁死切片 9？

**先回答「`dish` 目前預留到什麼程度」——實際上只在文件裡，程式裡什麼都沒有：**
- `js/data/db.js` 第 172 行 `COMPONENT_KINDS = ["ingredient", "product", "estimate", "food"]`，沒有 `dish`。
- `contentProblems`（242–275 行）的分支是 ingredient／product／food／**其他一律當估算**（268–272 行的 `else` 要求頂層 `name`、跑 `estProblems`）。如果只把 `dish` 加進 `COMPONENT_KINDS`、不加分支，`dish` 會被當成估算驗證——頂層沒有 `name` 就報錯，是很容易踩到的坑。
- `savedContentProblems`（418–461 行）第 448 行只收 `ingredient`／`product`／`food`，`dish` 一律報 `.kind`。
- `meal-content.js`：`toSavedContent`（836–853 行）遇到 `dish` 會丟錯「我的組合不能含…」；`remapSavedRefs` 第 897 行 `if (c.kind !== "product") { drop(c); return; }` 把 `dish` 當成已不提供；`resolveSavedMeal` 最後的 `else` 把所有其他種類當商品處理；`savedMealDraft` 1025 行的 `else` 也把它當商品。
- `tools/check-engine.js` 第 1190 行與第 2161 行**拿 `kind: "dish"` 當不合法元件的測資**（PRD 第 270 行已經提醒切片 9 要換）。
- `js/ui/tab-today.js` 85–88 行 `canSaveLog` 只排除 `estimate`；一筆含 `dish` 的紀錄按「存成組合」會讓 `toSavedContent` 丟錯。
- 唯一「預留」的是 C4.17 ③ 的啟發式檢查（`tools/check-arch.js` 125–135 行，推薦的四個檔不得出現字面量 `"dish"`）。

所以草案寫「`validateDailyLog` 等已預留 kind」不正確：Y 的工作量等於把切片 9 的 `dish` 元件提前做一半。

**Y 對切片 9 的影響**：PRD 12.5（第 640–642 行）的 `dish` 是「快照一份、`qty` 只能 0.5／1／1.5／2、受角色上限（第 636 行，`custom_dishes.role`）、硬性過濾由食材即時推導、組合裡只存 `ref`＋`qty`」。hd_ 需要的是「克數、沒有角色、固定每 100g、標籤寫在資料裡」。Y 要把 12.5 改成「`qty`／`amount` 擇一、內建 hd_ 免角色上限、快照多 `amount`／`unit`」。而我的料理**沒有成品重**（12.5 的資料只有食材生重與 `servings`），`amount` 記法對 `cdish_` 根本沒意義——結果是同一個 `kind` 底下兩種互斥的語意，靠 ref 前綴分流。這不是綁死，但是把 12.5 審過兩輪的定義改掉，沒有換到好處。

**X 的問題**：自煮型態放行 `estimate`、採買要讀 `est`、`est` 形狀從 6 鍵改成另一種（`estProblems` 第 203 行鎖 6 鍵），又跟自助餐的 `est` 混在一起。而且 PRD 第 123 行定的「估算快照全程照存、不重算」，跟採買要「依 ref 回查配方」是兩套心智模型。不建議。

**第三案 Y′（建議）：hd_ 當 `food`**
- 元件：`{ kind: "food", ref: "hd_tomato_egg", amount: 53, snapshot: { name, amount: 100, unit: "g", 七欄 } }`；湯 `unit: "ml"`、`amount: 250`；主食 `{ kind: "food", ref: "fx_cooked_rice", amount: 160, snapshot: … }`（分層裡本來就有，四種主食的每 100g 跟 `home_dishes.json` 的 staples 逐欄相同，我用腳本比過）。
- 現有程式已經支援的：`foodComponent`（673–685 行，`serving.amount` 為 null 時快照用每 100g）、`componentFactor`（688–690 行）、`contentTotals`、`foodAmountProblems`／`foodSnapshotProblems`（db.js 210–230 行）、只有 food 的自煮一餐（`noIngredientCookProblems`，232–239 行，`archetype_id`／`method_id` null、`implicit` 0／null）、`toSavedContent` 的 food 分支（845 行）、`toPlanContent`、`resolveSavedMeal` 的「份數記法但沒設一份就擋」（976 行，剛好讓 hd_ 只能用克數）、`passesHardFilters`。
- 要補的：`catalog.js` 的 `normalizeHomeDishes`（145–150 行）把每道菜轉成單品形狀（`uid`、`serving: { amount: null, unit }`、`per_100g`、`state: "cooked"`、`allergen_tags`、`diet_tags`、`composite`、`source`）；`remapSavedRefs`、`resolveSavedMeal`、`savedMealDefaultName`（1181 行）在分層、`cing_` 之前加一個 hd_ 分支；`savedMealDraft` 把 hd_ 與它前面的共餐主食放進草稿的共餐欄位（不是 `d.foods`）。
- `state` 一定要是 `cooked`（或 `as_is`）：`foodNameState`（649–654 行）遇到 `raw` 會在名稱前加「生 」。

**hd_ 跟 `cdish_` 的衝突**（題目問的四點；Y′ 下大多消失）：
- db 驗證：Y 要加 `dish` 分支；Y′ 不用動。
- 快照 name：兩案都存當下的名稱，紀錄改名不回溯（跟 food 一樣）。
- 備份：Y 是格式放寬（舊版 App 讀不了新備份裡的 `dish`），要補來回斷言；Y′ 沒有新種類。
- `remapSavedRefs`：Y′ 的分流順序建議 `tree[ref]` → `hd_` → `cing_` → 丟掉；hd_ 不需要 ctx，查 `catalog.homeDishes.byId`。

### 2. 第 2 題：快照、預約與資料改版

- **快照存「每 100g（或 100ml）」夠用**，跟沒設一份的我的食材同一套（PRD 第 125 行）。
- **預約只存 `ref`＋`amount`、重新解析，跟 food 完全一致**（PRD 第 114 行）。資料改了，未來的預約跟著新數字；已記下的紀錄用快照，不變；這跟目前自助餐估算的「照存不重算」不同，PRD 要寫清楚這是刻意的。
- **刪掉一道 hd_**：預約歸「已不提供」→ 整筆失效、改推薦、寫中性原因（`resolvePlan`，1070–1077 行）。紀錄照快照顯示。
- **hd_ id 不能重用**：如果某天把 `hd_braised_tofu` 改成另一道菜，舊預約會悄悄換菜。建議比照 `food_tree_ids_frozen.json` 加一個 hd_ 凍結清單（S）。
- **湯的毫升**：`food` 快照本來就允許 `unit: "ml"`（db.js 216 行）；但 `home_dishes.json` 的每 100g 是以克為基準，湯當 100ml 用就是「1ml≈1g」的假設，現在的估算也一樣（`homeEstimate` 625 行用 `EST_SOUP_ML` 乘每 100g）。要寫進章程 B4 家常菜那一段與 config 註解。名稱會是「蘿蔔排骨湯 250ml」。
- **每道克數要整數**：`isFoodAmount`（config 62–63 行）。小／中／大 120／160／200 分 3 道＝40／53.33／66.67。規則：每道 `Math.round(全分量 ÷ N)`，合計與名稱一律以存下的整數為準（160 分 3 道合計 159g、200 分 3 道合計 201g），預覽寫「每道約 53g」。要有 check-engine 斷言。

### 3. 第 3 題：過敏原與素食

**草案的「不擋只顯示」不能照做**：C4.1 寫「過敏原未確認、飲食標註缺漏，只要使用者有設定就排除；自訂食物沒有例外」。外食估算不過濾是因為它沒有品項；共餐的菜有 `ref`、有成分，比較像單品。要放寬得走 C3 改章程，我不建議。

**我用配方實際推導了 17 道的過敏原**（配方每一項的 `allergen_tags` 都查得到：內建食材、分層、衛福部查詢檔都有這欄，調料選樣表照它的衛福部編號查）：

| 家常菜 | 配方推出的過敏原 | 配方推出的素食 |
|---|---|---|
| 蒜炒高麗菜、蒜炒青江菜、蒜蓉地瓜葉 | 無 | 全素 |
| 涼拌小黃瓜 | 黃豆、麩質、芝麻、未確認（烏醋） | 否 |
| 番茄炒蛋 | 蛋、未確認（番茄醬） | 否 |
| 青椒肉絲 | 黃豆、麩質 | 否 |
| 宮保雞丁 | 花生、黃豆、麩質、未確認 | 否 |
| 蠔油芥蘭牛肉 | 軟體動物、未確認（蠔油） | 否 |
| 白菜滷 | 甲殼類（蝦米）、黃豆、麩質 | 否 |
| 麻婆豆腐 | 黃豆、芝麻、麩質、未確認（豆瓣醬） | 否 |
| 清蒸鱸魚 | 魚、黃豆、麩質 | 否 |
| 滷豆干滷蛋 | 黃豆、蛋、麩質、未確認 | 否 |
| 紅燒豆腐 | 黃豆、麩質 | 全素 |
| 滷雞腿 | 黃豆、麩質 | 否 |
| 蘿蔔排骨湯、白菜燉雞湯 | 無 | 否 |
| 紫菜蛋花湯 | 蛋、芝麻 | 蛋奶素 |

**建議值**：
- `allergen_tags`＝配方聯集 **再加「未確認」**（章程 B6.3：各家做法不同，配方只是代表做法，沒有逐項確認使用者家裡那一盤）。有設任何過敏原的人，共餐的菜整排變灰字（理由「成分未確認」，跟其他單品一樣），共餐區塊上方一句中性說明：「家常菜各家做法不同，過敏原當作未確認；可以改用外食的自助餐估算，或之後用我的料理記自己家的做法」。聯集仍然有用：明細可以寫「代表做法含：花生、黃豆、麩質」。
- `vegan`／`lacto_ovo` 一律 `false`（未宣告）：章程 B6.5 要「正面宣告」，代表配方推出全素不等於使用者家那盤是全素（有人炒青菜用豬油、加蝦米）。
- 由 `tools/lib/home-dish-values.js` 推導、寫進 `home_dishes.json`，check-data 重算比對（不手寫）；`composite: true`。
- 不吃清單：v1 只比 hd_ 自己的 id（S：之後可以比配方的蛋白質與蔬菜 id，比照 12.5）。
- 主食照分層的標籤擋（雜糧飯本來就是「麩質、未確認」）。

### 4. 第 4 題：採買反推

**算法**：草案的公式「配方生重 × (吃的克數 × 人數 ÷ `cooked_g`)」算術上沒問題，而且**分母用 `cooked_g` 是對的**——營養也是用同一個 `cooked_g` 算的，採買跟營養用同一個假設才一致（章程 C2）；滷汁、湯的水量假設錯了，營養跟採買會一起偏，這是可以接受的。

**我實際算的例子**（腳本讀 `home_dish_recipes.json`）：

晚餐 4 人、菜量中（160g 分 3 道，每道 53g）＋湯 250ml：
- 蒜炒高麗菜（成品 282g，用掉配方的 0.75 批）：高麗菜 301g、大蒜 7.5g、鹽 1.5g、油 7.5g
- 番茄炒蛋（391g，0.54 批）：雞蛋 90g（約 1.6 顆）、番茄 136g、青蔥 5g、糖 2.7g、鹽 1.1g、番茄醬 5g、油 8g
- 滷雞腿（400g，0.53 批）：去皮雞腿肉 212g、醬油 26.5g、糖 8g、青蔥 10.6g、嫩薑 5.3g、水 212g
- 蘿蔔排骨湯（1500g，0.67 批）：豬小排 130g（**可食部分**）、白蘿蔔 333g、嫩薑 10g、鹽 3.3g、水 800g

1 人、菜量中、單點 1 道：
- 滷豆干滷蛋：小方豆干 67g、雞蛋 73g（約 1.3 顆）、醬油 20g、糖 5g、水 200g
- 清蒸鱸魚：鱸魚 170g（**去頭尾內臟骨刺的可食部分**）、青蔥 14.5g、嫩薑 7g、醬油 12g、油 5g

**看出來的資料缺口**：
1. **可食重 ≠ 購買重**：鱸魚（配方註明去頭尾內臟骨刺）、豬小排（195g 是帶骨 300g 的 65%）、滷雞腿用去皮雞腿肉代表（實際買帶骨帶皮雞腿）——三道差到 1.5–2 倍。PRD 5.3 把「削皮去骨損耗」列為 MVP 不做，但家常菜這三道不處理，清單第一眼就誤導人。需要在配方加購買換算（例如 `buy_factor` 或 `buy_note`）。
2. **整批 vs 比例**：全家 4 人、每人 53g，算出來只要 0.53–0.75 批；但家裡實際是一道菜煮一盤。照比例算會少買 25–47%。建議 Phase 4 以「盤」（配方一批）為單位：每個預約的每道菜至少 1 盤，人數 × 吃的量超過一盤才加到 1.5、2 盤。這是產品決定，要問使用者。
3. **衛福部編號的名稱**：配方用到 8 個衛福部編號（大蒜 E2100101、青蔥 E23001、乾辣椒 E7510101、嫩薑 E1900101、蝦米 J2300201、豬絞肉 I03104、鱸魚 J0404301、紫菜 F0210101），查詢檔的名稱是「青蔥平均值」「豬絞肉平均值」「尖嘴鱸(含皮)」，不能直接當採買品名；而且它們沒有 `purchase_key`。
4. **分類**：水 → 不列；鹽、糖、醬油、醬料、香油、烹調油 → 常備（PRD 5.3 已有 `pantry` 的概念）；蔥、薑、蒜、乾辣椒 → 少量，建議另一區「辛香料」或也算常備；蛋要用「顆」（PRD 5.3 已列 `purchase_unit`／`g_per_unit`）。
5. **配方不在執行時資料裡**：`catalog.js` 只載 `data/home_dishes.json`（187 行），配方在 `data/reference/`，產生檔沒有 `recipe` 欄。採買要讀配方，就得讓產生工具把配方（ref、生重、角色、顯示名稱、購買換算）寫進產生檔或另一個執行時檔。
6. **主食不進清單**：主食是一般 `food`，跟其他單品一樣不在採買 MVP 裡（米是常備品，可以接受）。

**人數**：不要在共餐表單另開。PRD 5.2（186–188 行）早就設計了 `profile.household_size`（全域預設）加 `meal_plan.servings`（每筆覆蓋），兩者都還沒實作（程式裡搜不到）。採買只讀預約，人數用預約的 `servings`，自組餐型跟共餐共用。這一輪什麼都不用加。

**這一輪要不要寫 `dishPurchaseLines` 純函式**：不要。算術很簡單，難的都是資料（購買換算、單位、常備、品名），而 `purchase_key`／`pantry`／`g_per_unit` 還沒設計；現在寫的函式到 Phase 4 多半要重寫。這一輪只要保證「預約裡的共餐存的是 hd_ 的 ref＋克數」（Y′ 天生就是），再把算法與上面的缺口寫進 PRD 5.3 當 Phase 4 的待辦就好（S）。

### 5. 第 5 題：切法、pre-commit、自助餐改名的牽動範圍

pre-commit（`tools/hooks/pre-commit`）跑 check-data → check-engine → check-arch --staged → diff-recs；diff-recs 只要輸出跟 `tools/snapshots/*.txt` 不同就失敗，所以**每一個會改到畫面或計算的 commit，都要在同一個 commit 跑 `diff-recs --update` 並附上快照差異**。草案的順序大致對，但「採買純函式」這一步建議拿掉（見第 4 題），而且自助餐改名要獨立成一步。開工切法見第 8 節。

**「家庭共食」估算改成「自助餐」的牽動範圍**（使用者說沒有舊資料需要遷移；開發機上已存的估算紀錄用快照，不受影響）：
- `js/ui/meal-picker/index.js` 第 47 行 `TAB_LABELS` 改回「外食」（等於把 1b5b688 的程式部分 revert）。
- `js/ui/meal-picker/estimate-card.js` 第 2、71–75 行：卡片標題「家庭共食／自助餐」→「自助餐」、名稱欄的 placeholder。
- `js/engine/meal-content.js` 612–615 行 `homeEstimateName`：如果預設名稱要變「自助餐：白飯＋2 道菜（…）」，要改這裡（章程 C2），不要在 ui 拼。
- 快照：`tools/snapshots/ui.txt`（第 2869 行「外食/共餐分頁還有 1 項沒有算進這餐」）、`tools/snapshots/picker.txt`（`home-estimate/card-*` 與名稱相關的行）。
- `tools/mobile-walkthrough.mjs` 第 1726 行一帶（15-1 的說明文字）、`docs/手機實機腳本.md` 第 84 行（第 15 節「共食、自助餐用直接估算」）。
- 文件：PRD 第 123 行（`estimate` 的用途「喜宴、朋友家、共食、自助餐」）、第 184 行（5.2）、第 280 行（第 8 節）、1b5b688 改的兩處「外食/共餐」；章程第 48 行、第 282 行（C2 表）、B4 家常菜那一段的用途說明；decisions #151 的「共食」部分由 #152 取代。
- `index.html` 的版本戳記照 stamp-version 流程。

**check-arch**：Y′ 不用加新規則（`homeDishes` 已經禁止出現在推薦的四個檔，`tools/check-arch.js` 131–132 行；選擇器與 engine/meal-content.js 本來就能讀）。Y 的話也不用加，`"dish"` 字面量已經擋了。

**diff-recs**：要在 `tools/lib/adapter-v2.js` 加共餐的情境（自煮分頁、開伙、午餐、3 道＋湯＋主食：合計、記錄名稱、寫入的紀錄、預約內容），錄進 `picker.txt`。

**walkthrough**：第 15 節改成自助餐；新增一節共餐：開伙才有、早餐沒有、選 3 道＋湯送出、紀錄名稱與熱量、預約模式存完再打開能還原表單、有設過敏原時菜變灰字。

### 6. 第 6 題：要問使用者的產品決定（附建議）

1. **有設過敏原或素食時，共餐的菜會變灰字不能選**（章程 C4.1），改用自助餐估算或之後的我的料理。建議：照擋。順便問：你自己有沒有設過敏原或素食？沒有的話這一條對你沒影響。
2. **共餐能不能「存成組合」**：Y′ 下幾乎免費（`toSavedContent` 本來就收 food）。建議：可以（具體的菜不是一次性估算，「家裡常吃那幾樣」很實用）；但帶回選擇器要能還原共餐表單（M3）。如果要縮小範圍，就跟估算一樣先不開放，並在 `tab-today.js` 85–88 行與選擇器的勾選框一起擋。
3. **共餐能不能跟餐型自組放在同一餐**：建議擇一（跟 12.5 的我的料理同一個說法），畫面比較單純。資料層不需要擋。
4. **每道各自調克數**：建議 v1 不做（均分）。Y′ 的資料本來就是每道各自的克數，日後要做只改畫面。
5. **只午餐、晚餐**：建議是；早餐配稀飯的家常菜日後再說。
6. **家常菜要不要「常吃」／「不吃」**：建議日後（`favorite_refs` 的格式不用改就能收 hd_，但「我的食物」要多一個清單）。
7. **採買用「盤」還是按比例**：Phase 4 再定，建議「每道至少一盤」。
8. **記錄名稱的格式**：建議「共餐：白飯＋番茄炒蛋＋蒜炒高麗菜＋滷雞腿＋蘿蔔排骨湯」不寫克數（克數在明細），否則名稱太長。

### 7. 草案漏掉的架構問題

1. 帶回選擇器的還原（M3）：`savedMealDraft`、`index.js` 276／325 行會默默丟掉 hd_。
2. 解析會丟錯（M2）：`resolveSavedMeal` 968–973 行、`remapSavedRefs` 891 行。
3. `planPseudoLog`（1084–1089 行）用 `buildDraftContent(savedMealDraft(…))` 算暫時紀錄；共餐的草稿欄位如果 `buildDraftContent` 沒展開，今天的預約扣預算會少算。要斷言「暫時紀錄的合計＝`resolvePlan` 的合計」。
4. 單品上限（M5）、整數克數（M6）。
5. `foodSel` 三個分頁共用（index.js 58 行）：共餐的主食與菜不能放進 `foodSel`，否則切到外食分頁會跟過去。共餐的狀態要放在自煮分頁自己的草稿裡，只有 `buildDraftContent` 的 cook 分支展開。
6. 快煮切換：已選了共餐再切到快煮，要清掉或擋送出（「快煮沒有共餐」）。
7. 「估計」標示：hd_ 的出處是 `assumption`，紀錄與摘要要像估算一樣標「估計」，PRD 要寫。
8. id 空間：hd_ 跟內建食材、分層 `fx_`、商品 uid、`cing_`、`cdish_`、`custom_`、`saved_` 不相交；check-data 目前的保留前綴清單（章程 B4 分層段落）要加 hd_。
9. `tab-today.js` 85–88 行的 `canSaveLog`：Y 的話一定要改（不然按「存成組合」會丟錯）；Y′ 的話看第 6 題第 2 點的決定。
10. 摘要的「X 分頁還有 N 項沒有算進這餐」與 `pickedCount`（index.js 394 行）要算進共餐。

### 8. 定稿清單

**M（必改，開工前寫進草案或 PRD）**
- M1 方案定為 Y′（hd_ 當 `food`、只用 `amount`、主食也是 `food`）。PRD 第 3 節 `food` 的定義（第 99–100、125 行）與 13.4 加「內建家常菜 hd_（複合料理，只能用克數）」；12.5 不動。
- M2 engine 的 hd_ 分支：`remapSavedRefs`、`resolveSavedMeal`（放在 `myIngredientRec` 之前，hd_ 不需要 ctx）、`savedMealDefaultName`；check-engine 斷言：沒帶 `customIngredients` 也不丟錯、刪掉的 hd_ 歸已不提供、預約失效。
- M3 共餐表單 ⇄ 元件的雙向純函式（放 `engine/meal-content.js`）：表單 → 元件（主食 food、各道 food、湯 food，**順序固定且連續**）；元件 → 表單（帶回時用）；check-engine 來回斷言（所有道數 × 菜量 × 主食 × 湯的組合）。`savedMealDraft` 把共餐元件放進草稿的共餐欄位，不放 `d.foods`。
- M4 過敏原與素食：產生工具推導 `allergen_tags`（聯集＋未確認）、`vegan: false`、`lacto_ovo: false`、`composite: true`、`state: "cooked"`、`serving.unit`（湯 ml），寫進 `home_dishes.json`；check-data 重算比對；硬性過濾照 C4.1 擋；草案 §3.3 的「不擋只顯示」刪掉。
- M5 單品上限：共餐的家常菜另計（菜 ≤ `EST_DISH_MAX`、湯 ≤ 1），主食算 1 項單品；章程 C4.8 加一句、`resolveSavedMeal` 與送出檢查同一個函式。
- M6 每道克數＝`Math.round(全分量 ÷ N)`，合計以存下的整數為準；湯「1ml≈1g」寫進章程 B4 與 config 註解。
- M7 新決策 #152：取代 #148「不建菜色資料」、#151「只供估算、不供逐道選擇」與「家庭共食走外食估算」；PRD 第 123、184、280 行、1b5b688 的兩處、章程第 48、282 行與 B4 用途同步。
- M8 預約的行為寫進 PRD（第 3 節表格）：共餐預約只存 ref＋amount、重新解析（跟 food 一樣，**不是**估算的照存不重算）；暫時紀錄合計＝`resolvePlan` 合計的斷言。
- M9 共餐的狀態不放 `foodSel`（index.js 58 行），只在自煮分頁草稿；快煮切換清掉或擋送出。
- （若仍選 Y，另加）MY1 `COMPONENT_KINDS` 加 `dish` 並在 `contentProblems` 加獨立分支（否則落進估算分支）；MY2 `savedContentProblems` 收 `dish`；MY3 PRD 12.5 改成 `qty`／`amount` 擇一、hd_ 免角色上限；MY4 check-engine 第 1190、2161 行換一個不合法的種類；MY5 `toSavedContent`、`savedMealDraft`、`tab-today.js` `canSaveLog`；MY6 備份來回斷言。

**S（建議）**
- S1 hd_ id 凍結清單（比照 `food_tree_ids_frozen.json`），check-data 擋重用與跟其他 id 空間撞名。
- S2 hd_ 單品形狀的轉換放 `catalog.js` 的 `normalizeHomeDishes`，不另外掛進 `foodTree.byId`（免得出現在加點單品清單，也守住 C4.17 ③）。
- S3 共餐的菜與紀錄標「估計」；明細寫「代表做法含：…」。
- S4 PRD 5.3 寫入反推公式與第 4 題的六個資料缺口，當 Phase 4 待辦。
- S5 記錄名稱「共餐：…」不寫克數（engine 產生，C2）。
- S6 共餐的帶回：帶入的組合／預約在早餐等時段也顯示共餐區塊（比照「帶入的餐型不在這個時段也列出」），不在解析時擋時段。

**N（日後）**
- N1 採買反推純函式、`purchase_key`、購買換算、以盤為單位（Phase 4）。
- N2 每道各自調克數。
- N3 家常菜的常吃／不吃、不吃清單比對配方食材。
- N4 早餐的共餐。
- N5 共餐跟我的料理（切片 9）同一餐。

### 9. 可以開工的條件

1. 協調者確定 Y′（或 Y＋MY1–MY6），並把 M1–M9 寫進草案 v1／PRD／章程／決策 #152。
2. 使用者回答第 6 題的第 1、2、3 點（其餘可以照建議）。
3. 第一步（文件）的 diff 由協調者對照本清單驗收，不需要第二輪審核。

### 10. 開工切法（每一步獨立可驗收、pre-commit 能過）

- **步驟 0 文件**：決策 #152、PRD（第 3 節 food、第 3 節表格、5.2、5.3 待辦、第 8 節、13.4）、章程（第 48、282 行、B4 家常菜、C4.8）。只改文件，pre-commit 不受影響。
- **步驟 1 自助餐改名**（可以跟步驟 0 對調）：TAB_LABELS 改回「外食」、估算卡改名「自助餐」、`homeEstimateName` 預設名稱；`diff-recs --update`（ui.txt、picker.txt），walkthrough 第 15 節、手機腳本第 84 行。驗收：快照差異只有名稱。
- **步驟 2 資料**：`tools/lib/home-dish-values.js` 推導標籤、`state`、`serving.unit`；`build-home-dishes.js` 重產；check-data 規則（重算、B6.3、hd_ 凍結與 id 空間）；`catalog.js` 轉單品形狀。驗收：check-data 過、diff-recs 不變（自助餐估算只讀每 100g）。
- **步驟 3 engine**：M2、M3、M5、M6、M8 的函式與 check-engine 斷言（來回、解析、失效、過敏原擋、上限、整數克數、暫時紀錄合計）；不接畫面。驗收：check-engine 新斷言全過、diff-recs 不變。
- **步驟 4 選擇器**：自煮分頁的共餐區塊（開伙、午晚餐、表單、灰字、預覽、跟餐型擇一、快煮清掉）、預約與補記、帶回還原；adapter-v2 的共餐情境、`diff-recs --update`（新增行）；walkthrough 新一節；先自己跑 mobile-walkthrough 看截圖，再給使用者帶行號的短清單。
- **（Phase 4）採買**：不在這一輪。
