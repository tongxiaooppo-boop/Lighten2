# 切片 8b 實作計畫審核（2026-10-02）

送審：`docs/review/2026-10-02-D8b-實作計畫.md` 第一版（HEAD `f9200bf`）。審核者：獨立 Opus agent（只讀，不改檔）。

## 第一輪：問題（逐字）

你是獨立審核者（資深前端工程師＋營養資料把關）。請用中文回覆。專案在 d:\ok\lighten（「輕盈計畫」2.0：純前端 vanilla JS ES modules＋IndexedDB，個人減脂飲食追蹤，沒有後端）。

請審核實作計畫 `docs/review/2026-10-02-D8b-實作計畫.md`（工作線 D 切片 8b：我的食材＋單品克數記法＋畫面說法統一）。前置的 8a 已完成：commit f9200bf（`data/tfda_lookup.json`、`tools/lib/tfda-lookup-values.js`、`data/reference/tfda_tags.json`、`tfda_groups.json`、check-data）。

權威文件：`docs/PRD.md`（尤其 3、11.1、11.3、12.2、12.4、13.3、13.4、13.8）、`docs/CHARTER.md`（章程，尤其 B8、B9、B10、C1、C2、C4.1、C4.5、C4.8、C4.11、C4.16、C4.17）、`docs/decisions.md`（#121–#135；計畫內的 U1–U3 會記成 #136）。過去計畫的審核範例：`collab/opus-review-log/2026-10-01-d5-plan-review.md`。

要求：
1. **一定要打開程式碼核對**計畫第 1 節「現況」與第 6 節「自查」的說法（js/data/db.js、js/data/catalog.js、js/engine/meal-content.js、picker.js、foods.js、filters.js、js/ui/meal-picker/*、js/ui/foods/*、js/ui/tab-foods.js、tab-today.js、backup.js、tools/lib/fake-db.mjs、tools/lib/adapter-v2.js、tools/diff-recs.js、tools/check-engine.js、tools/check-arch.js、tools/smoke-browser.mjs）。找出計畫漏掉的依賴、會讓既有快照或驗證壞掉的地方、資料形狀的漏洞（尤其：food 元件的 qty/amount 擇一、衛福部來源用確定性 id `cing_`+整合編號、移除後再加回、查詢檔懶載與載入失敗、組合解析、備份 v5 與 DB_VERSION 3、常吃互斥）。
2. 對第 3 節 Q1–Q9 逐題表態（同意／修改＋理由）。
3. 以營養資料角度檢查：克數記法與份數記法合計是否必然一致、液體（ml）與衛福部每 100g 的單位問題（衛福部飲料是每 100g，計畫說我的食材 unit 一律 g）、沒有 1 份的品項快照用 100g 是否合理、U2 參考句的數字。
4. 範圍是否太大、commit 拆法是否可行（每個 commit 都要過 pre-commit hook：check-data、check-engine、check-arch、diff-recs）。
5. 不要改任何檔案。

輸出格式：先一句總結論（例如「改完可以開工」或「要改第二版再審」）；然後「必改 M1…」「建議 S1…」兩個清單，每條寫：問題、證據（檔案:行號）、建議改法；最後 Q1–Q9 表態表。控制在約 300 行以內。

## 第一輪：回覆（逐字）

# D8b 實作計畫審核（Opus 獨立審核，2026-10-02）

**總結論：要改第二版再審。** 架構方向（`amount`／`qty` 擇一、確定性 id、查詢檔懶載、移除＝刪紀錄）都對；但 Q7 的理由跟資料不符（查詢檔裡動物性食材的纖維大量是 null，會讓整天纖維變未知）、液體單位前後矛盾（U1 說液體是毫升，2.1-B 說我的食材一律 g）、還有幾個沒列到的呼叫點會讓組合悄悄掉品項或把量改成 1 份，commit 2 也會被 hook 擋。以下全部打開程式碼核對過（行號以 HEAD f9200bf 為準）；計畫第 1 節列的行號大致正確，第 6 節有兩處說法不實（見 M6、M10）。

---

## 必改

**M1. 衛福部動物性食材的纖維是 null，會讓整餐、整天的纖維變成未知（Q7 理由錯）**
- 問題：Q7 說「飽和脂肪、纖維 null 的多半是加工品」。實測 listed 1887 筆裡 `fiber_g` null 698 筆，其中**肉類 111、魚貝 304、蛋 67、乳品 55＝537 筆動物性**，加工調理只有 60。纖維是 null 傳染欄位（meal-content.js:22–23 `CONTRIB_FIELDS`、:66–83 `addContributions`），不是鈉/飽和脂肪那種只標 partial——記一筆衛福部的鯖魚或雞蛋，那一餐、那一天的纖維就變成 null。而代換表同類品項是 0（food_tree `fx_whole_milk` `fiber_g: 0`，依章程 B5.1「動物性食材 只能填 fiber_g」補過），同一種東西兩條路數字不一致。蛋白質 null 30、脂肪 null 50（糖、茶飲）也會傳染，但量少且性質上是「沒測」，可接受。
- 證據：`data/tfda_lookup.json` 實測；CHARTER.md:162–170（B5.1 四類補 0 規則）；diff-recs.js:719 已有 `foods/nullfiber` 情境（fx_ham）說明傳染在這裡是看得到的。
- 建議改法：8b 開頭加一個 `data` commit——`tools/lib/tfda-lookup-values.js` 套用 B5.1 同一張表（肉類、魚貝類、蛋類、乳品類的 `fiber_g`；油脂類的 `fiber_g`、`sodium_mg`；蔬菜/菇/水果脂肪 ≤0.5 的 `sat_fat_g`）填 0，查詢檔每筆加 `derived_fields: [...]`（明細寫「衛福部未測、依規則視為 0」），check-data 用同一算法重算比對；decisions 記一條（8a 補件）。`filled`（Q7）照樣延後即可，但理由要改寫。

**M2. 液體單位矛盾：U1「液體是毫升」 vs 2.1-B／D1 我的食材 `serving.unit: "g"`**
- 問題：listed 裡 `drink: true` 120 筆（豆漿、鮮乳、飲料類）會放在「飲品・水果」步驟，跟代換表「全脂奶 240ml」並排；若寫 g，同一步驟一半 ml 一半 g。自填液體更糟：台灣包裝飲料營養標示是「每 100 毫升」，表單卻寫「每 100g」，使用者會照抄 ml 的數字。
- 證據：food_tree `fx_whole_milk` 的 `source.note`「附-1『1 杯＝240 公克』換算」、`derived L01021 × 2.4`——專案已採用 1ml≈1g 的慣例；meal-content.js:556、foods.js:142 的狀態詞與名稱邏輯已支援 ml。
- 建議改法：`drink: true` 的我的食材 `unit: "ml"`，衛福部每 100g 直接當每 100ml（同 fx_whole_milk 慣例；乳品/豆漿/果汁密度 1.00–1.05，誤差 ≤5%），明細一句「衛福部是每 100g，這裡視為每 100ml」；自填表單勾液體時欄位標「每 100ml」「每份幾 ml」。`default_g` 欄位名照舊但語意寫成「g 或 ml」（或改名 `default_amount`，第二版定）。PRD 13.4、12.4 寫明。

**M3. `toSavedContent` 會把克數記法悄悄改成 1 份**
- 問題：meal-content.js:734 `qty: c.qty != null ? c.qty : 1`——`amount` 元件沒有 qty，存成組合變成 `{ ref, qty: 1 }`，不報錯、量就錯了。
- 建議改法：計畫 D2 明寫 food 元件原樣帶 `qty` 或 `amount`（擇一，不補預設），check-engine 斷言「amount 元件存成組合後仍是 amount」。

**M4. 計畫漏列的 food 呼叫點（每一個都要改，否則克數或我的食材會壞）**
- meal-content.js:590 `buildDraftContent`：`foodComponent(f.item, f.qty)` 要傳 amount。
- meal-content.js:679 `draftLogName`：`foodLogName(f.item, f.qty)`。
- meal-content.js:881 `savedMealDraft`：`d.foods.push({ item, qty: c.qty })` 要帶 amount——連帶 `savedMealTotals`（:891）卡片熱量。
- meal-content.js:906 `savedMealDefaultName`：food 只查 `tree[c.ref]`（第 1 節有列、D2 修改清單沒列）——不改的話卡片內容小字與入口 1 預設名稱會漏掉我的食材，只有我的食材時名稱是空字串。
- food-step.js:16 `qtyOf`、:24（`foodTreeServingShort`、`item.per_serving.kcal`）、:28（「已選 · N 份」）、:95–100：沒有 1 份的品項 `per_serving` 是 null → 卡片直接丟錯；要「每 100g 約 N kcal」「已選 · 120g」。
- tools/lib/adapter-v2.js:248、:252、:271（`pickerFoods`/`pickerFoodSel`/`pickerState` 都 map 成 `{ uid, qty }`，會丟掉 amount）——第 1 節有列，2.1-F 工具清單沒列。
- tools/diff-recs.js:80–81 `normContent`：計畫有寫 `food:ref=Ng`，注意現在 amount 元件會印成 `xundefined`，一定要在 ing/* 之前改。
- 建議：第 6 節自查補上這些點並各自寫在哪個 commit。

**M5. 已存成 `{ ref, qty }` 的我的食材，之後 `default_g` 變 null 會壞**
- 問題：使用者把一份幾克清掉，或衛福部食材移除後再加回（新紀錄 `default_g` null），舊組合的 `{ ref, qty: 2 }` 解析時 `serving.amount` 是 null → `foodComponent` 寫出 `snapshot.amount: null` → db 驗證擋下，結果是「記錄失敗」。
- 建議改法：`resolveSavedMeal` 對「qty 記法但品項沒有 1 份」的元件歸 blocked，原因「沒有設一份，請改用克數」（不自動換算成克數，免得悄悄改量）；check-engine 斷言。另外在 PRD 11.3 寫明：`default_g` 從 40 改成 60，組合的「2 份」會跟著變 120g（照 PRD「數值引用當下讀」，屬預期）。

**M6. 組合 ctx 沒有共用建立點；漏帶 `customIngredients` 會讓組合悄悄掉品項**
- 問題：第 6 節說「抽一個 `savedCtx` 共用（index.js 已有）」，但 index.js:236 的 `savedCtx` 讀的是選擇器 state；tab-today.js:95–101 `saveCtx()`、saved-meals.js:22–26 各自組 ctx，沒有共用函式。任何一處沒帶 `customIngredients`，`remapSavedRefs` 會把 `cing_` 當成查不到丟掉 → `savedMealForSave` 把少了品項的內容寫進資料庫（入口 2 tab-today.js:128 只顯示「已不提供」）——這是資料遺失。
- 建議改法：(a) ui/ 一個共用 `async loadSavedMealCtx({ slot, needLookup })`（讀 customs、hidden、profile、customIngredients，必要時查詢檔），三處都改用它；(b) engine 端 fail-closed：`ctx.customIngredients === undefined` 而遇到 `cing_` 開頭的 ref 時丟錯，不當成 gone。check-engine 斷言。

**M7. `loadTfdaLookup` 失敗後不能重試**
- 問題：計畫「只載一次（模組內快取 promise）」，但新增食材畫面有「重試」鈕；若失敗的 promise 也被快取，重試永遠失敗。
- 證據：catalog.js:179–181 `loadCatalog` 在 catch 裡 `_catalog = null` 再丟。
- 建議改法：照同一寫法（失敗清快取）；smoke「載入失敗」情境接著測「重試成功」。

**M8. 衛福部「不吃（移除）」的復原會遺失使用者改過的欄位**
- 問題：2.1-E3 寫「已從我的食材移除…＋復原」，但 db 函式清單沒有復原用的函式。若用 `addCustomIngredient` 重加，使用者改過的 `name`、`default_g`、`note`、`created_at` 全掉；且「衛福部來源已存在就丟錯」會跟復原時序互相干擾。
- 建議改法：加 `restoreTfdaIngredient(oldRecord)`（原樣 put 回去，驗證 id 與 tfda_id 對得上，`updated_at` 更新；常吃照「還原時不放回」）。「＋新增食材」再加回則是新紀錄（明細寫一句「名稱與一份幾克要重設」）。

**M9. id 規則要進驗證器**
- 問題：計畫自填 id 文字寫「`cing_` + 時間戳亂數」、範例寫 `cing_u_xxx`；衛福部來源 `cing_`+小寫編號只在註解。備份匯入可以塞進 `{ id: "cing_abc", source: "tfda", tfda_id: "K0112102" }`，同一樣品變兩筆。
- 建議改法：`validateCustomIngredient` 加：tfda → `id === "cing_" + tfda_id.toLowerCase()` 且 `tfda_id` 符合 `/^[A-Z][0-9A-Z]{6,8}$/`；user → `id` 以 `cing_u_` 開頭（db 用 `generateId("cing_u")`）。

**M10. commit 拆法會被 hook 擋**
- commit 2（db）把 `BACKUP_SCHEMA_VERSION` 改 5，但 check-engine.js:2030 斷言 `BACKUP_SCHEMA_VERSION === 4` → 失敗。要在 commit 2 一起改這條斷言、v4→v5 升級斷言也在 commit 2；backup-v5.json 由 smoke 凍結可以留後面，但 check-engine 不能在 commit 2 就讀它。
- smoke-browser.mjs:31 斷言 `version === 2`（不在 hook，但 commit 2 之後就一直失敗）：commit 2 改成升到 3 並斷言有 `custom_ingredients`。
- mobile-walkthrough.mjs:780–798 斷言「已封存」「已隱藏」「仍是隱藏的」「取消隱藏」——commit 4（說法統一）之後就失敗：同一個 commit 改。
- M1 的 data commit 要排在 commit 1 前後，check-data 才會過。
- 每個 commit 都要確認 fake-db 匯出名跟 ui import 一致（commit 5、6 的 ui 會 import db 函式；fake-db 要在 commit 2 先匯出——計畫有寫，保留）。

**M11. Q9 的前提不成立**
- 問題：`grep` `tools/snapshots/*.txt` 裡「封存」「隱藏」「取消隱藏」「已刪除」都是 0 筆（picker.txt 只有 5 處「不吃」，不受影響）；選擇器 HTML 也不進 ui 快照（diff-recs.js:481–482 跳過 panel/drinks/tabs，report() 只取卡片 id）。
- 建議改法：Q9 改寫成「說法統一不改任何 diff-recs 快照（commit 4 必須 0 行差異）；受影響的是 walkthrough 780–798、手機腳本、使用說明」。這反而是更強的保證：commit 4 斷言 diff-recs 完全不變。

**M12. 我的食材的 `isFoodTreeItem` 會讓灰字與排序走錯分支**
- 問題：foods.js:91 用「有 `group`」判斷分層品項——`ingredientItem` 給了 `group`，所以我的食材被當成分層品項：(a) foods.js:296 會讓自填食材在沒勾素食時顯示「不符合你的飲食設定」，但審核 S4 的原則是只有人工確認過的才能這樣說，自填應寫「飲食限制未確認」（衛福部來源有 8a 的人工標註，可維持「不符合」）；(b) foods.js:105 `compareFoodTreeItems` 同名時比 `a.id`，`ingredientItem` 沒給 `id`；(c) foods.js:327 `dislikedMessage` 也走分層分支（目前沒入口，但說法統一會碰到）。
- 建議改法：`ingredientItem` 多給 `id`（＝uid）與 `source: "tfda"|"user"`，`foodsBlockLabel` 的 diet 分支在 `source === "user"` 時回「飲食限制未確認」；check-engine 斷言。

---

## 建議

**S1. 克數記法合計「完全相同」要寫清楚成立條件**：只有 `amount === qty × serving.amount` 且為整數時才完全相同；`toggleFoodMode` 份→克用 `round`（35g × 1.5 = 52.5 → 53）合計會差約 1%。check-engine 斷言限定整數情況；PRD 13.4 寫「切換時量會取整數克」。

**S2. 我的食材的 `per_serving` 不要先進位**：計畫 D1 寫 `per_100g × default_g / 100` 進位——`default_g` 很小（1–5g 的調味、油）時，進位到 0.1 再乘回克數會放大誤差（例 `default_g: 2`、amount 300 → 誤差最多 0.05 × 150 ≈ 7.5 kcal）。建議 `per_serving` 保留原值、只在 `roundTotals` 與顯示時進位（meal-content.js:177 本來就是最後才進位一次的原則）；快照驗證只要求是數字，不受影響。

**S3. 沒有 1 份的品項快照用 100g（per_100g）**：合理且精確（倍數＝amount/100）；但 B4「`snapshot.amount` 是 1 份的量」要改寫成「1 份的量；沒設一份的是 100（g 或 ml）」，PRD 3 的註解同步。

**S4. U2 參考句的數字建議**（代換表 2019 每份大致量）：protein（生）肉魚約 30–35g（plan 的「約 35g（生）」可）；protein 蛋類「1 份＝1 顆約 55g」；protein 豆類製品「傳統豆腐約 80g、豆漿約 190ml」；grain 乾約 20g、熟（飯）約 40g（1/4 碗）、生根莖約 55–90g；vegetable 生 100g；fruit 種類差很多，建議回 null 或「可食部分約 100g 上下」；dairy 液體 240ml、奶粉約 25–30g、起司約 2 片；fat 油 5g、堅果約 7–10g；other null。參考句依 `group`×`state`，查詢檔 `state` 還有 `dry`（84）、`wet`（7）要涵蓋。**最好由 engine 從 `catalog.foodTree` 同大類同狀態的 `serving.amount` 推出來，不要手寫**，至少 check-engine 比對手寫表跟 food_tree 一致（C2 唯一來源）。

**S5. 打開選擇器不要等查詢檔**：有衛福部食材時，先畫選擇器、我的食材那一組顯示「載入中」，載好再重畫，避免 100KB 讓「自己選」打開變慢。

**S6. 自填食材「刪除」時常吃的處理跟我的品項一致**：我的品項封存時不會移出常吃（db.js:843–862 不碰 favorites；`effectiveFavorites` 對懸空 ref 本來就無害）。計畫第 6 節寫「自填刪除時同一個 transaction 移出、還原不放回」——兩者不一致。建議自填照我的品項（封存不動常吃，還原後常吃自然回來）；只有衛福部「移除」要同一個 transaction 移出（因為 id 會重用）。

**S7. 為切片 9 留一句前向相容**：PRD 12.4／12.5 原寫「封存的食材料理照樣讀得到」；衛福部來源移除＝刪紀錄後，切片 9 的料理若引用 `cing_k...`，可以直接從 id 反推 `tfda_id` 讀查詢檔——建議 PRD 12.4 加一句「料理引用衛福部食材不依賴紀錄存在」，免得切片 9 重新討論。

**S8. 範圍偏大，建議拆兩次交使用者測**：8b-1＝M1 資料＋db＋engine 克數記法（全部單品）＋說法統一；8b-2＝新增食材、自填表單、我的食物與選擇器的我的食材組。中間讓使用者先在手機測「份／克切換」與新說法，降低一次要驗的畫面數量。commit 拆法照原順序即可，只是在 commit 4 後插一個驗收點。

**S9. `removeTfdaIngredient` 的訊息提到組合**：移除前若有組合引用它，訊息補一句「用到它的組合會顯示已不提供，再加回來就恢復」（中性）；只需讀組合清單，不在移除時掃描改寫（Q5 照舊）。注意 check-arch C4.16 白名單（我的食物管理區已在白名單 saved-meals.js；新檔若讀組合要放在白名單內的檔案）。

**S10. `ingredientItem` 把查詢檔 `allergen_tags: ["未確認"]` 原樣傳下去**：不要轉成 null；`passesHardFilters`（filters.js:73）兩者都吃，但 `allergenSummary`/明細文字只認陣列形狀。自填的 null 也在 `ingredientItem` 轉成 `["未確認"]`，讓下游只有一種形狀。

---

## Q1–Q9 表態

| # | 表態 | 理由 |
|---|---|---|
| Q1 | 同意（擇一） | 既有紀錄、快照不動；但必須一起修 M3（`toSavedContent` 預設 1）與 M4 所有呼叫點；db 驗證「恰好一個」要寫成斷言 |
| Q2 | 同意（整數 1–3000） | 鹽、香料 <1g 無法記，影響可忽略；ml 也適用（3000ml 合理） |
| Q3 | 同意（100） | 跟每 100g（ml）明細對得上；選擇性：液體預設 240ml 比較接近一杯，但多一條規則，不強求 |
| Q4 | 同意，但要補 M9 | 確定性 id 是對的；id 與 `tfda_id` 對應、自填前綴要進驗證器，備份匯入才擋得住 |
| Q5 | 同意（gone，再加回自動恢復） | 但要補 M5（再加回後 `default_g` null，舊 qty 記法要歸 blocked）與 S9 的提示 |
| Q6 | 同意（分開懶載） | 補 M7（失敗不快取）與 S5（不阻塞選擇器打開）；tab-today 只在組合有 `cing_` 時才載，同意 |
| Q7 | 修改 | `filled` 延後可以，但理由錯（M1）：537 筆動物性食材纖維 null 會讓整天纖維變未知——先在查詢檔套 B5.1 補 0 規則（data commit＋check-data＋decisions） |
| Q8 | 同意 | 每個大類最後一組「我的食材」、常吃照切片 5 搬到最上面；空組不輸出（diff-recs 卡片 id 才不會變）；液體依 M2 放「飲品・水果」並用 ml |
| Q9 | 修改 | 前提不成立（M11）：快照裡沒有任何「封存」「隱藏」文字；改成「commit 4 diff-recs 必須 0 行差異」，walkthrough 780–798 在 commit 4 一起改（M10） |

**U2 參考句**：例句「代換表 1 份約 35g（生）」可用；其餘大類照 S4 表，水果建議不給數字（回 null）；整張表要跟 food_tree.json 對照或直接由它推出。
