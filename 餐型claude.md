# 餐型：落地規格（以輕盈計畫現有架構為準）— v2 定稿（已吸收兩輪獨立 Opus 審核）

> 狀態：**定稿，待使用者回答 §9 的產品問題後開工**。兩輪審核問答逐字存 `collab/opus-review-log/2026-10-04-archetype-review.md`（審核者第二輪結論：不需要第三輪，照 §10 驗收清單對照）。
> 根據：現有程式與資料（`data/dish_archetypes.json`、`data/ingredients.json`、`js/engine/pool.js`、`js/engine/recommend.js`、`tools/check-data.js`）、章程 B5.6／B7／C3、PRD 第 3、7 節、調研 `collab/proofs/2026-10-01-workline-a-archetype-survey.md`。
> `餐型.md`、`餐型gpt.md`、`餐型ds.md`、`餐型gemini.md` 只當參考，不當規格：它們的 JSON 欄位、食材 id、料理方式都不是我們現有的。
> v0 → v1 的主要更正：①推薦**不抽樣**，是對每筆候選算分後取最高分（`recommend.js` 207–215），所以「組合數少會被淹沒」的前提是錯的，勝負由評分決定；②刪掉蛋飯骨架與 method_boil；③method 與第一個用它的骨架同一個 commit；④鈉的處理改為骨架的 `seasoned`＋`not_included`＋method 的 `tip`，不新增調味等級。

## 1. 要解決什麼

現在午晚餐能自煮的骨架只有 4 個（炒類、烤／舒肥定食、溫沙拉，加上無主食的煎蛋類；早餐碗偏早餐），做法只有「炒」「煎／烤」。目標：**用最少的新骨架與新概念，讓「自己選」的自煮多出明顯不同的做法（蒸、滷燉），並在不動評分的前提下盡量讓推薦也有變化**。不破壞：推薦評分凍結（decisions #130，等網友回報再調）、營養不寫死（餐型只管組合邏輯）、章程 B7（allow 只引用 `ingredients.json`）、快照比對流程、共食用估算記錄（#148，取代 #132 的共食部分）。

**誠實的預期**：現況推薦本來就單調（14 天模擬，現況開伙午晚餐 28 餐裡溫沙拉 0 次，炒類與烤定食各 14 次）。這是評分造成的（纖維加分封頂 10g、蛋白質加分封頂 25g、同分依 id 字母），不是骨架數量能解決的。加骨架**保證的是「自己選」多了做法**；能不能進推薦，取決於骨架裡有沒有高纖食材與 id 的排序，見 §5、§8。

## 2. 五個維度對到我們的欄位（四份參考文件的共同原則，我們已經是這樣）

| 維度 | 問題 | 我們的落點 | 要不要動 |
|---|---|---|---|
| 餐別 | 什麼時候吃 | 骨架 `valid_slots` | 不動 |
| 餐型 | 用什麼形式吃 | 骨架 `id`／`name`（`dish_archetypes.json`） | 新增 3 個 |
| 槽位 | 由哪些食材組成 | `protein`／`staple`／`vegetable`／`seasoning` 的 `allow` | 擴充 allow |
| 料理方式 | 怎麼做 | 骨架 `methods`（`ingredients.json` 中 `axis: method`） | **補兩個：蒸、滷燉** |
| 設備 | 用什麼工具做 | 目前由 method 間接表達 | 現在不做（日後） |
| 標籤 | 這餐的特性 | 由食材 `diet_tags`、過敏原聚合；骨架不存 | 不動 |

鐵律（沿用）：設備與飲食目的（微波、氣炸、減醣、高蛋白）不獨立成餐型；新料理先歸既有骨架；骨架不存營養值。
**命名衝突**：程式裡 `meal_type` 已是「超商／外食／快煮／開伙」四個型態值，參考文件的 `meal_type` 一律不採用；骨架 id 用現有 snake_case。

## 3. 引擎事實（第一輪審核已逐項核對程式；行號為審核時的）

1. **候選池**：骨架做 蛋白質 × 主食 × 蔬菜（附「不加」）× 醬料（附「不加」）× 烹調法 的笛卡兒積（`pool.js` 59–125，「不加」在 50–55）。推薦的每一筆固定 1 個蛋白質、最多 1 個蔬菜、最多 1 個醬料；`COMPOSE_MAX`（蛋白質 2、蔬菜 3）只用在「自己選」與組合解析。免開火會剪枝（69）；營養值是 null 的食材整筆跳過（60–66）。
2. **主食槽**：`allow` 非空一定有主食（41–48；自己選也會擋，`meal-content.js` 311）。縮放範圍 0.5–2.0 是**所有**主要槽位共用（`config.js` 20、`meal-content.js` 139–142），不是「主食槽空才有」；無主食骨架在「自己選」選 2 個蛋白質時完全不縮放（279–283）；**低碳模式下無主食骨架的 lowCarbMaxScale 是 Infinity（170），不受碳水上限**。
3. **allow 只能引用 `ingredients.json`**（`check-data.js` 709–714）；不驗骨架 id 唯一與格式、name 非空、同軸 allow 重複（要加，§6）。
4. **料理方式**目前 5 個，欄位含 `implicit`（用油）、`prep_tier`（氣炸 🔴）、`tip`、`source`（必須是 assumption 並寫 ref，494）；章程 B5.6 逐一列了各 method 的用油量，**新增 method＝改章程**。
5. **引用檢查**：39 個骨架食材全被引用；`check-data` 的「沒被引用」警告把**烹調法也算進去**（720–727），所以只加 method、沒有骨架用它，會多警告。目前輸出 1 個警告（label_unsourced／estimate 待查證），不是零警告。
6. **推薦是「評分取最高、同分依 id 排序」，不抽樣**（`recommend.js` 207–215）。評分（69–87）：回饋 喜歡 +40；顯示過每天 −5；同一個確切組合 3 天內出現過扣 20×(3−天數)；同一蛋白質來源 3 天內扣 20×(3−天數)；同一種蔬菜 3 天內扣 10×(3−天數)；加分 蛋白質 min(蛋白質,25)×0.5、纖維 min(纖維,本週缺口)×2；扣分 熱量貼近度 |預算／縮放後熱量 −1|×50。**近期降權不按骨架算**；骨架只在同一天內不重複（135–136、182、219）。`grain_bowl_baked` 占自組食譜組合 77.5%，但整個候選池 3309 筆只占 43.5%，組合數多寡幾乎沒影響。
7. 14 天模擬（審核者跑的，午晚各 550 kcal，每天寫回「顯示過」）：現況 炒類 14、烤定食 14、溫沙拉 0；照 v0 全做之後，一般設定下蒸魚與蛋飯 **0 次**、滷燉 5–10 次；低碳模式蔬菜盤占一半。午餐 550 kcal 無回饋時各骨架最高分：炒類 32.5、滷燉 31.9、烤定食 31.2、溫沙拉 27.85、蒸魚 27.5、蛋飯 24.05、蔬菜盤 19.9；最高分有 68 筆同分，全是炒類。→ **骨架有沒有高纖食材（毛豆、木耳、香菇、秋葵、地瓜）基本上決定勝負；纖維缺口 0 時 id 字母順序決定結果。**

## 4. 四份參考文件：採納與不採納

| 內容 | 處理 | 理由 |
|---|---|---|
| 五維分離、不為設備或飲食目的建新餐型 | 採納（已是現況，寫進鐵律） | |
| 餐型不存營養值 | 採納 | 章程已規定 |
| 8 個核心餐型清單（GPT） | 只當檢查表 | 復熱型＝現成品項、共食＝用估算記錄（#148） |
| 復熱型 | 不做 | 本來就是超商與外食的現成品項池 |
| 共食／家庭合菜、家庭鍋湯 | 不做骨架、不建菜色資料；記錄用外食的「直接估算」S／M／L（使用者 2026-10-04，decisions #148）；骨架只考慮**單人份**湯定食 | 共食難以量化 |
| `scaling_core` 欄位 | 不採納 | 引擎已由「有沒有主食」推導 |
| Gemini 的 8 個 JSON | 不採納 | 食材 id、method 多數不存在；改 egg_pan 白名單會產生不合理組合 |
| 設備勾選篩餐型 | 現在不做 | 要動 settings key、備份版本與 fixture、推薦過濾、PRD；快煮難度過濾已部分代替；真做時把設備需求寫在 method 資料上 |

## 5. 提案（四步；每步獨立可驗收、可回退）

### 步 0：文件先行（章程 A1：先改文件再改程式）
- 章程 B5.6：加「蒸」「滷／燉」的用油（0）與說明；B12 加 §6 的新檢查規則。
- PRD 第 3 節：隱含成分的用油那句；MealContent 範例的 `arch_stir_fry` 改成實際 id `protein_stir_fry`；**補一句「滷燉定食未含滷汁拌飯」**（畫面上新出現的「未含」字樣要有 PRD 依據）。PRD 第 7 節：工作線 A 那一列寫明本批範圍、**推薦評分仍凍結在 #130**。
- decisions 新增一條：①新骨架 id 與命名規則（「主角＋做法」，跟 `protein_stir_fry` 同一族）及它在同分排序上的結果（見 §5 步 2）；②它與 #130 的關係（同分看 id，命名會實質影響推薦）；③滷與燉不拆、method_boil 延後、蛋飯刪除、鈉的處理方式；④寫明本次 C3 審核紀錄在 `collab/opus-review-log/2026-10-04-archetype-review.md`。

### 步 0.5：新檢查規則獨立一個 commit（§6 的 check-data／check-engine 規則）
- 放在步 1 之前；現有 5 個骨架已核對能通過新規則。check-engine 第 429 行的修改**不放這裡**，放在 2b。

### 步 1：只擴充既有 allow（不動 method）
- `protein_stir_fry`：蛋白質加 `egg`、`firm_tofu`；主食加 `mixed_grain_rice_cooked`。（蛋飯類由此承擔，不另建骨架。）
- `egg_pan`：蔬菜加 `shiitake`、`wood_ear`、`bean_sprout`。
- `grain_bowl_baked`：蛋白質只加 `shrimp`（不加 beef_shank：牛腱烤、氣炸、微波、煎都不成菜；不加 egg：定食的主蛋白質太弱）。
- 驗收：不動既有組合 id；快照差異逐條說明，**並列出 altDinner 的變動**（egg_pan 加 bean_sprout 後，晚餐組合 id 排序第一的組合會從 `…bell_pepper…` 變成 `…bean_sprout…`，所以步 1 本身就會改變 altDinner，這是預期的、要在 commit 訊息說明；之後步 2、3 不可再改）。每個改資料的 commit 都要 `diff-recs --update` 並更新版本字串（章程 C1.6，`stamp-version`）。

### 步 2：method_steam＋蒸魚定食（同一個 commit）、再 method_braise＋滷燉定食（另一個 commit）
- method 欄位：**比照 `method_air_fry` 逐欄複製**（name 用「蒸」「滷／燉」），只改這幾項：`id`、`prep_tier`（蒸 🟡、滷燉 🔴）、`tip`、`source`（assumption＋ref）。複製才不會漏欄位：`implicit: []`、`per_100g: null`、`requires_cooking: false`、`allergen_tags: []`、`vegan`／`lacto_ovo`（check-data 478–480 要求布林值）、basis、serving 系列、`field_sources`、`verified_at`。
- `method_steam`：蒸；用油 0。`method_braise`（滷與燉不拆；在現有模型裡兩者用油、難度、調味都一樣）：滷／燉；`tip` 用中性句，例如「配飯時不淋滷汁」，不用評判字（C4.13）。
- **蒸魚定食**（午、晚；`seasoned: true`）：蛋白質 tilapia_fillet／salmon／shrimp；主食 brown_rice_cooked／mixed_grain_rice_cooked／sweet_potato／pumpkin；蔬菜 spinach／cabbage／broccoli／luffa／eggplant／okra／snap_pea／bamboo_shoot／**shiitake／wood_ear**（拿掉 celery；香菇蒸魚、木耳蒸魚是常見做法，也是讓纖維靠近封頂的選項）；method_steam。
- **滷燉定食**（午、晚；`seasoned: true`；`not_included: ["滷汁拌飯"]`）：蛋白質 firm_tofu／chicken_thigh／beef_shank（拿掉 egg）；主食 brown_rice_cooked／mixed_grain_rice_cooked／sweet_potato（三種，不含南瓜）；蔬菜 daikon／cabbage／shiitake／wood_ear／bamboo_shoot／onion／tomato（拿掉 celery）；method_braise。牛腱的正確位置是滷燉（日後評估把牛腱移出炒類）。
- **鈉**：method 沒有鈉的接點；調味由骨架 `seasoned` 決定（`meal-content.js` 98）。不新增調味等級（會牽動 config、`db.js` SEASONING_LEVELS、composeImplicit、備份、B5.7）；用 `not_included`＋`tip` 提醒。不顯示警告（C4.14）。
- **新骨架 id 定案（審核第二輪，用 14 天模擬決定）**：蒸魚定食 `protein_steamed`、滷燉定食 `protein_braised`、低碳蛋白質蔬菜盤 `protein_veg_plate`。命名規則「主角＋做法」，跟現有 `protein_stir_fry` 同一族。接在 JSON 陣列最後（自煮分頁照陣列順序列骨架，新骨架排最後；上線後 id 不能改，回饋以組合 id 為 key）。同分排序時新骨架贏 `protein_stir_fry`、輸 `grain_bowl_baked`，**不會搶走烤定食**；步 2、3 不再改 altDinner；前綴規則通過；walkthrough 393 不受影響。
- **模擬基準**（午晚各 550 kcal、14 天、28 餐，id 組合 D；上線後當對照，見 §6 sim-rotation）：纖維缺口 10、開伙：蒸魚 3、滷燉 3；缺口 10、快煮：蒸魚 5、滷燉 0（🔴，正確）；缺口 0、開伙：蒸魚 9、滷燉 5（炒類讓位到 0，烤定食仍 14）；缺口 0、快煮：蒸魚 5；低碳模式蔬菜盤 13–14 次（與 id 無關）。對照：用 v0 的蔬菜白名單時，缺口 10 的蒸魚是 0 次——**加 shiitake、wood_ear、拿掉 celery 才讓蒸魚有機會進推薦**（被推薦的組合幾乎都靠木耳或香菇；蒸魚組合最高纖維 9.7g，到不了封頂；加板豆腐結果不變，不為分數再加不成菜的食材）。蒸魚的蛋白質 22–35g（鮭魚 27–32、鯛魚與蝦仁約 22–25），在午晚餐 25–30g 目標的下緣，可接受。
- 驗收：check-engine 為新 method 加斷言（用油 0、`oilOptions` 為空、預設調味 normal、快煮過濾正確）；**check-engine 第 429 行「其他骨架不該有 not_included」改成通用寫法，放在 2b 這個 commit**；check-data 零新警告；快照 pool／matrix／recs／**picker／ui** 的差異逐條說明；altDinner 與 `mobile-walkthrough.mjs` 393 不變；`diff-recs --update` ＋版本字串。

### 步 3：低碳蛋白質蔬菜盤（單獨一個 commit）
- 無主食；蛋白質 chicken_breast／chicken_thigh／salmon／tilapia_fillet／shrimp／firm_tofu（**拿掉 beef_shank**）；蔬菜 11–12 種；方式 pan_fry／stir_fry／air_fry；`seasoned: true`。
- 定位：**低碳使用者專用**。審核模擬：預算 600 時 252 組縮放到 2 倍後熱量最低 194、中位數 385、最高 559，只有 9 組 ≥540，一般模式永遠輸（不打擾一般使用者）；低碳模式下有主食的骨架被碳水上限壓到 0.5–0.9 倍，蔬菜盤變主力。**不改主要槽位設計**（改縮放範圍＝改 C4.6）。
- 驗收：matrix 低碳列 300／500 預算時午晚餐縮放後熱量在預算 ±15% 內；800 預算的缺口不大於現況；附 matrix 低碳列差異。不過就不做。

### 步 4（要使用者先決定口味方向）：食材缺口
- 優先順序（營養師觀點＋來源重複率）：**豬里肌、豆干、青江菜或地瓜葉、胡蘿蔔**；之後控制份量的白飯（要問）、鯖魚（鹽漬的鈉高，晚一點）、單人份湯定食。
- 每個食材走 B2／B4／B6（TFDA 來源、過敏原、素食標註），**兩步走**（先進 `ingredients.json`、再進骨架），一個食材一個樣品。
- 開工前問使用者：① 湯品；② 白飯與麵；③ 豬肉；④ 滷與湯的鈉要不要提示。我的建議全部「要」，湯品等有單人份湯定食的設計再做。

## 6. 新增檢查規則（check-data／check-engine）
- check-data：骨架 id 唯一、格式 `^[a-z][a-z0-9_]*$`、name 非空、同一軸 allow 不重複、每個 valid_slot 至少產生 1 筆組合、**骨架 id 不得是另一個骨架 id 加底線的前綴**（組合 id 用底線串接，`pool.js` 89）。
- check-engine：候選池 id 全部唯一；第 429 行「其他骨架不該有 not_included」改成通用寫法（滷燉有 `not_included`）；新 method 的斷言。
- **14 天輪替模擬做成 tools 報告**（`tools/sim-rotation.mjs`，以審核者的 `sim.mjs`／`sim2.mjs` 為底）：每天寫回「顯示過」；情境 12 列＝一般／低碳 × 纖維缺口 10／0 × 開伙／快煮／自動；預算除了 550 再加 450、700 兩組；直接 import engine 與 buildCatalog，不需要 fake-db。**不放進 pre-commit hook，也不當 CI 的 pass/fail**，手動跑或在 CI 印出結果；它是本工作線的驗收指標與上線後的對照。

## 7. 不做的事
- 不建「減醣氣炸型」「無煙微波型」「蛋包主體流」這類混維度餐型；不建復熱型、共食骨架；不建蛋飯骨架；不加 method_boil（沒有任何骨架用它）。
- 不在骨架存營養值、不加 `scaling_core`、不改 `meal_type` 的意思、不改主要槽位與縮放範圍。
- 不改評分（#130）。現況另有兩個結構問題（每餐只放 1 份蔬菜 100g、纖維封頂 10g、同分依 id）列為日後，等網友回報再重審。
- 設備勾選、調味等級加「重」、牛腱移出炒類、鯖魚、麵食：日後。

## 8. 審核結論摘要（逐字在 `collab/opus-review-log/2026-10-04-archetype-review.md`）
- 第一輪：推薦不抽樣、組合數不是問題；刪蛋飯與 method_boil；method 與骨架同一個 commit；鈉不新增調味等級；蔬菜盤定位為低碳用。
- 第二輪：M1–M15 全落實；步 1 本身會改 altDinner；新骨架 id 定案為 `protein_steamed`／`protein_braised`／`protein_veg_plate`；蒸魚值得做（要靠 shiitake、wood_ear）；不需要第三輪。

## 9. 開工前要問使用者（回答後寫進 decisions）
**口味四題**（我的建議都是「要」）：① 湯品；② 白飯與麵；③ 豬肉；④ 滷與湯的鈉要不要提示。
**審核者另外列的六題**（答案不同只影響 id 組合或 prep_tier，不用重審）：
1. 新骨架排在自煮分頁最後，可不可以接受？
2. 纖維缺口 0 時，炒類會讓位給蒸魚和滷燉（烤定食不受影響），可不可以接受？
3. 低碳蔬菜盤最多 2 份蛋白質（例：雞腿 260g，蛋白質 40–55g），可不可以接受？
4. 蒸要標 🟡（算快煮）還是 🔴？
5. 炒類的牛腱要不要移除（可以日後再問）？
6. 推薦偶爾出現蛋炒飯（步 1 把 egg 加進炒類的結果；實測缺口 10＋快煮、低碳時會出現）可不可以接受？不接受的話，步 1 就不要把 egg 加進炒類。

## 10. 驗收清單（對照這份開工與驗收）
- [ ] 步 0 文件（章程 B5.6、B12；PRD 第 3 節含「未含滷汁拌飯」、第 7 節；decisions 含審核紀錄位置）→ 通過 pre-commit。
- [ ] 步 0.5 新檢查規則 → 通過 pre-commit，現有骨架全過。
- [ ] 步 1 只擴充 allow；commit 訊息說明 altDinner 變動；快照差異逐條說明；`diff-recs --update`＋版本字串。
- [ ] 步 2a method_steam 逐欄複製 `method_air_fry`＋`protein_steamed`；步 2b method_braise＋`protein_braised`＋check-engine 第 429 行通用化；每個 commit 零新警告。
- [ ] 步 3 `protein_veg_plate`：matrix 低碳列 300／500 預算 ±15%、800 預算缺口不大於現況，附差異；不過就不做。
- [ ] `tools/sim-rotation.mjs` 報告貼進 commit 或 `collab/proofs/`，與 §5 步 2 的模擬基準對照。
- [ ] check-data、check-engine、check-arch、diff-recs、smoke、walkthrough（含 393 對應的步驟）全過；手機腳本短清單補一項（自己選的自煮分頁看到蒸魚定食、滷燉定食）。
- [ ] 步 4（食材）等口味題回答後另開，一個食材一個 commit。
