# 工作線 D 切片 7（單品 `food` 元件，只做紀錄）實作計畫審核

日期：2026-10-01　計畫初稿：Claude Sonnet agent（使用者同意交給 Sonnet 寫）　主導與驗證：Opus　審核者：新開的獨立 Opus agent
審核對象：`docs/review/2026-10-01-D7-實作計畫.md` 第一版

## 第一輪：送審問題（逐字）

你是獨立審核者（資深前端架構師＋資深營養師＋行動版 UX），用中文回答。專案在 D:\ok\lighten（Lighten2：純前端 vanilla JS＋IndexedDB 的個人減脂飲食 App，台灣使用者，主要在手機上用）。請審核「工作線 D 切片 7：單品 `food` 元件（只做紀錄）」實作計畫第一版：

  docs/review/2026-10-01-D7-實作計畫.md

這份計畫初稿由 Claude Sonnet 撰寫，主導開發的 Opus 抽驗過部分依賴（COMPONENT_KINDS、recommend.js 只讀 ingredient/product、再點餐型＝重置草稿、food_tree 有 10 筆 builtin_meal 與 5 筆 ml），其餘沒有逐一核對，請特別嚴格驗證計畫的主張。

必讀依據：docs/PRD.md 第 3 節（MealContent、food 元件、daily_log）、第 7 節路線圖、11.1／11.3／11.6、12.3、第 13 節（特別是 13.4、13.5、13.9 切片 7 的驗收列）；docs/CHARTER.md 的 B4、B8、B9、C1、C2、C4.5、C4.8、C4.11、C4.13、C4.14、C4.17、C6.5；docs/decisions.md #74–#121（特別是 #82、#83、#92、#95、#121：順序改成切片 7 → 工作線 C → 切片 5）；前一切片計畫 docs/review/2026-09-30-D4-實作計畫.md 與審核 collab/opus-review-log/2026-09-30-d4-plan-review.md。

程式與資料：js/engine/meal-content.js、js/engine/picker.js、js/engine/foods.js、js/engine/recommend.js、js/engine/today.js、js/engine/filters.js、js/core/config.js、js/data/db.js、js/data/catalog.js、js/ui/meal-picker/（index.js、cook-tab.js、product-tab.js 等）、js/ui/tab-today.js、js/ui/tab-week.js（紀錄怎麼顯示）、index.html、css/style.css、data/food_tree.json、tools/check-engine.js、tools/check-arch.js、tools/diff-recs.js、tools/lib/adapter-v2.js、tools/lib/fake-env.js、tools/smoke-browser.mjs、tools/mobile-walkthrough.mjs、tools/fixtures/、docs/手機實機腳本.md。

請自己讀程式與資料驗證計畫的主張，不要只看計畫文字。例如：「contentTotals 非 ingredient 一律走 productPart，所以 food 不用改」「composeImplicit 沒烹調法時天然回 {0,null}」「全 js/ 沒有別處讀 content.components」（注意紀錄顯示、撤銷、編輯、同一天重建、今日已記錄的名額計算、成分明細等路徑）「diff-recs 的 items 情境排除 #meal-picker-drinks 所以既有快照不變」「舊備份 v1/v2 讀得了」「自煮只有飲料的紀錄一直被擋，所以 implicit 新規則不會擋到舊資料」。可以用 node 跑腳本抽查。**不要修改任何 repo 檔案**；腳本放 C:\Users\Max\AppData\Local\Temp\claude\d--ok-lighten\89bfef84-6faa-470e-8696-6a31bdd9e194\scratchpad\review7\（Windows 上多行腳本先寫成檔案再用 node 執行，不要用 node -e 夾帶含反引號的文字）。

請輸出：
1. 結論（可以開工／改完可以開工／要重寫）。
2. 【一定要改】編號 M1…：問題、證據（檔案:行號或腳本結果）、建議改法。
3. 【建議改】編號 S1…。
4. 對計畫第 3 節 Q1–Q10 逐題回答（同意或不同意＋理由）；Q1、Q4、Q6 是給使用者的產品決定，請給你的建議讓使用者參考。
5. 行動版 UX 與營養師角度：單品份量文字（共用內建 id 的「1 份＝代換表 30g」vs 內建一餐、液體毫升、household 乘份數會不會算錯或誤導）、步進器 0.5–8、兩個步驟在手機上的長度、只有單品的一餐、不評判原則（C4.13）。
6. 計畫漏掉的依賴或驗收項目。

回答要具體，引用證據。你的最終回覆會被逐字存進審核紀錄，請把完整審核報告當作最終回覆輸出（不要只給摘要）。

## 第一輪：審核回覆（逐字）

# 工作線 D 切片 7「單品 `food` 元件（只做紀錄）」實作計畫第一版：獨立審核

審核者：新開的獨立 Opus agent（資深前端架構師＋營養師＋行動版 UX）
審核方式：計畫列的程式、資料、文件都讀過，另外用 node 跑了抽查腳本，放在 scratchpad/review7/：data1.js 看資料分布，totals.mjs 跑真的 `contentTotals`／`composeImplicit`／`validateDailyLog`，fixtures.js 看舊備份，hh.js 照 Q5 規則模擬 household 乘份數。沒有修改任何 repo 檔案。

---

## 1. 結論：**改完可以開工**

大方向是對的：
- `food` 走快照乘 `qty`。
- 推薦四個檔案完全不碰。
- db 驗證跟備份不升版。
- 單品狀態自己一套。

第 1 節的現況核對大部分成立，逐條結果見第 0 節。

但有幾件事會讓計畫裡寫的斷言失敗，或讓使用者看到錯的量，要先改：
- 「`contentTotals` 不必改」不成立。只有單品的自煮一餐，飽和脂肪會變成「0（部分無資料）」，跟同一個品項在超商分頁的結果不同。
- 份量文字跟記錄名稱沒有生熟乾重。Q5 的分數規則會產生錯的量。
- diff-recs 的 ui 行用「第幾個被碰過的元素」編號。計畫給的實作守則（「渲染路徑只能用 `$`、`getElementById`」）照做反而會改到既有快照行。
- PRD 13.9 要求的 picker 新情境，計畫第 4 節沒有列出來。

這些都是補規格、補驗收，不必重寫。

### 0. 計畫主張的驗證結果

| 主張 | 結果 | 證據 |
|---|---|---|
| `contentTotals` 非 ingredient 一律走 `productPart`，`food` 不用改 | **程式路徑成立，結論不成立** | meal-content.js L562–L580：`else` 分支確實走 `productPart(c.snapshot, c.qty)`。但 L576 `if (content.implicit)` 會把 `{0,null}` 的隱含成分推進 ingredientParts。`implicitContribution` 在 parts 為空時把 sat_fat、sodium 設成 0（L110），等於多了一筆「已知 0」。見 M1 |
| `composeImplicit` 沒烹調法時天然回 `{0,null}` | **成立，而且比計畫說的更穩** | totals.mjs：空草稿帶 `implicitOverride: {oil_g:10, seasoning:"light"}`，結果仍是 `{"oil_g":0,"seasoning":null}`。原因是 `oilOptions` 為空、`base.seasoning` 為 null，覆寫不被採用 |
| 全 js/ 沒有別處讀 `content.components` | **成立** | grep：只有 db.js L166–L173、recommend.js L141。紀錄顯示（tab-today.js L50–L58）只讀 `l.name`、`l.totals`。撤銷（db.js L760）只用 id。本週、hero、校正只讀 `totals`。沒有編輯紀錄的功能。成分明細（B-1c）還沒做 |
| 今日已記錄的名額只認 ingredient／product | **成立** | recommend.js L138–L145。today.js L39 原樣傳 content |
| diff-recs items 情境排除 `#meal-picker-drinks`，既有快照不變 | **有條件成立** | L471 確實排除，但 `dom` 編號是排序後所有被碰過的元素的序號（含被排除的）。見 M4 |
| 舊備份 v1、v2 讀得了 | **成立** | fixtures.js：v1 有 3 筆（`convenience`／product、`cook_quick` egg_pan 有 ingredient、`delivery`／estimate），v2 有 2 筆（`cook_full` bowl_oat 有 ingredient＋implicit {0,null}、convenience）。沒有「自煮沒有 ingredient」的紀錄，新 implicit 規則不會擋到 |
| 自煮只有飲料的紀錄一直被擋，所以 implicit 新規則擋不到舊資料 | **成立（UI 層）** | index.js L188–L193 擋。但 db 層目前放行（totals.mjs：`cook_full`＋只有 product＋`{0,null}` 通過 `validateDailyLog`），所以「沒有」靠的是 UI 從來沒產生過，不是 db 擋過 |
| food_tree 333 筆、ml 5、builtin_meal 10、household 134、fiber／sat_fat 各 15 null | **成立** | data1.js 逐項吻合；內建沒進分層的 10 個 id 也吻合 |
| 再點同一個餐型＝重置草稿 | **成立** | index.js L591–L593 |
| walkthrough 不依賴「再點同一餐型」 | **成立** | mobile-walkthrough.mjs L383–L442 每次都點不同餐型 |
| `draftLogName` 呼叫端 | **漏列一個** | 第 7 節自查漏了 smoke-browser.mjs L185（`mc.draftLogName({ kind: 'products', … })`，沒有 `foods` 欄）。不會壞，但要列 |
| smoke「1.5 份全脂奶摘要約 227」 | **不成立** | 151.7×1.5＝227.55，round1 後是 227.6，`Math.round` 後是 **228**。見 S9 |

---

## 2. 【一定要改】

### M1. 只有單品的自煮一餐，飽和脂肪／鈉會被一筆「已知 0」的隱含成分污染；計畫的斷言會失敗

- **證據**（totals.mjs，同一份 2 份芋頭 `fx_taro`，sat_fat_g 是 null）：
  - 自煮：`{"sat_fat_g":0, … ,"partial":["sat_fat_g"]}`，畫面會寫「飽和脂肪 0g（部分無資料）」。
  - 超商：`{"sat_fat_g":null, … ,"partial":[]}`，畫面寫「無資料」。
  - 原因：meal-content.js L576 只要 `content.implicit` 是 truthy 就推一筆 `implicitContribution`，而 L110 在沒有任何隱含成分時把 sat_fat、sodium 設為 0。
- 計畫第 4 節「只有單品的自煮合計沒有多出 `partial`」碰到 15 個 sat_fat null 的品項（芋頭、饅頭、拉麵、冬粉、紅毛丹…）就會失敗。
- 這也違反 check-engine L729 既有的精神：「只有自煮、沒有飲料的一餐不能被標部分無資料」。
- **改法**：`contentTotals` 改成「有 `ingredient` 元件時才加隱含成分」，判斷寫成 `ingredientParts.length > 0` 之後再 push。
  - 安全性：draft-totals.json 的 `cook:*` 都來自有食材的組合（check-engine L711–L722），推薦組合也一定有食材，所以凍結值與快照不變。
  - 切片 9 的 `dish`（同樣是 `{0,null}`）也因此正確。
  - 斷言：同一個單品在超商分頁與自煮分頁的 `contentTotals` 逐欄相同（三種 null 情境：fiber null、sat_fat null、都有值）。
  - 計畫第 1 節與第 2.1 節第 8 項「`contentTotals` 不改程式」要改寫。

### M2. 份量文字與記錄名稱沒有生重／熟重／乾重，會讓使用者記錯量

- **證據**：
  - 計畫 Q5 的例子（「4 份＝1碗，160g」「3/8杯(米杯)」）都沒有狀態詞。
  - foods.js L163–L176 的 `stateWord`、`amountText` 已經有「生重／熟重／乾重／濕重／可食部分」。PRD 13.3 明寫「克數前寫生重、熟重、乾重、濕重或（水果）可食部分」，章程 B5.5 也要求。
  - 資料：raw 211 筆，其中 16 筆有「煮熟約 Ng」、46 筆有「購買量約 Ng」；dry 26 筆。
  - 會出事的例子：雞胸肉 1 份＝生重 30g；藜麥內建一餐＝**乾重** 45g（煮熟約 2.5–3 倍）；白米乾重 20g；香蕉可食部分 70g、購買量約 95g。
- 營養上的後果：使用者秤熟雞胸 120g，以為「4 份＝120g」，實際只記到生重 120g（熟重約 90g），少記約 25–30%。看到「藜麥 45g」，以為是一碗煮好的，實際是一碗多的量。
- **改法**：
  - `foodQtyText` 一律用 `stateWord`，`serving.display` 也照份數乘。例：「4 份＝生重 140g（煮熟約 120g）」「2 份＝可食部分 140g（購買量約 190g），大的 1 根或小的 2 根」（後者見 M3，只在乘得乾淨時寫）。
  - `builtin_meal` 寫「1 份＝內建一餐 熟重 150g」「藜麥 1 份＝內建一餐 乾重 45g」。
  - 記錄名稱：PRD 的「飯 160g」照舊，但 `raw`／`dry` 的品項建議加短狀態詞（「雞胸肉 生 120g」或「藜麥 乾重 45g」）。這要在 commit 0 寫進 PRD 13.4，交給使用者決定字樣。
  - `foodAmountText`（名稱用）與 `foodQtyText`（步進器旁）共用同一個量的函式（`foods.js` 可以 import `meal-content.js`，engine 對 engine），兩邊的進位才不會不一致（章程 C2）。

### M3. Q5 的「以 1/8 為單位、除不盡寫小數一位」會寫出錯的或奇怪的家用量

- **證據**（hh.js 照計畫規則跑 118 筆可乘的 household × 份數 {0.5, 1.5, 2, 2.5, 3, 4.5, 8}）：**80 組出現小數**。
  - 「白米 1/8杯(米杯) ×0.5 → 0.1杯」：實際 0.0625，誤差 60%。
  - 「×2.5 → 0.3杯」：實際 0.3125。
  - 「1/3杯 ×2 → 0.7杯」。
  - 「1/10片（鳳梨）×0.5 → 0.1片」：實際 0.05。
  - 可數單位乘出半個：「餃子皮 3張 ×1.5 → 4 1/2張」「黑棗 9個 ×0.5 → 4 1/2個」「葡萄 13個 ×2.5 → 32 1/2個」。
- **改法**（仍是純函式，逐類斷言）：
  1. 用有理數算：household＝a/b，份數＝k/2，結果的分母一定是 2b，約分後判斷。
  2. 約分後分母 ∈ {1, 2, 3, 4} 才寫家用量（米杯可放寬到 8），否則只寫克數或毫升。
  3. 單位是「個、粒、張、片、根、顆」這類可數單位、而且原值是 ≥2 的整數時，只有結果是整數才寫。
  4. 不寫小數的家用量。
  5. 份數 1 時原樣寫，這點同意。
- 斷言加上上面這些反例，各一條。

### M4. diff-recs 的 ui 行編號會被「新碰到的選擇器」位移；計畫給的實作守則是錯的

- **證據**：
  - fake-env.js L76–L80：`querySelector`／`getElementById` 只要被呼叫就建立紀錄，即使只是讀。
  - L86–L96：`dump()` 依選擇器排序輸出所有被碰過的元素。
  - diff-recs.js L469–L473、L517–L519：`"dom" + String(i)` 的 `i` 是在整份 dump 裡的序號，被排除的行也算。
  - 實例：ui.txt L1237–L1240 是 dom01／02／04／05，跳掉的 03 就是被排除的 `#meal-picker-drinks`。
  - 所以 render 或 `updateSummary` 路徑只要多碰一個新 id，例如 `getElementById("meal-picker-food-results")` 讀搜尋框值，或重畫後 `.focus()`，排序在 `#meal-picker-gap` 之前的新鍵就會讓既有的 gap／hint／submit／summary 行全部改名。這違反「既有行逐字不變」。
- 計畫第 1 節寫「渲染路徑只能用 `$`、`innerHTML`、`getElementById`」，照做反而會中。
- **改法**：
  - 寫明 `renderMealPicker`／`renderDrinks`／`updateSummary` 路徑**只准碰現有的選擇器**。兩個新步驟完全由 `#meal-picker-drinks` 一次 `innerHTML` 產生。
  - 搜尋字從 `mealPicker.foodQuery` 讀，不從 DOM 讀。只更新結果容器、恢復 focus、`scrollIntoView` 都只放在瀏覽器事件處理裡。
  - commit 3 的驗證已經有「快照逐字不變」，加一行說明失敗時先查這個。

### M5. 第 4 節沒有列出 diff-recs 的新 picker 情境；PRD 13.9 的驗收列沒對上

- **證據**：
  - PRD 13.9 切片 7 列要求：「picker 既有情境不變，新增只有單品（三分頁各一）、自煮加單品、qty 上限、液體單位」。
  - 計畫第 2.1 節第 23 項寫「新增 picker 單品情境（第 4 節）」，但第 4 節快照段只有「新行前綴是 `.../foods/`」。
  - 「只有第 5 個 commit 新增行」跟第 5 節的編號（0–5，工具在 commit 4）對不上。
  - 「附在原內容後面」也不準：snapPicker 之後還有 snapWeek、snapExercise（diff-recs.js L703–L705），ui.txt 是照產生順序寫的，新 picker 行會插在中間。驗收靠「沒有 `-` 行」仍然成立，只是說法要改。
- **改法**：第 4 節列出 key 與內容。建議至少要有：
  - `foods/<tab>/<slot>/only`（三分頁各一；超商選全脂奶 2 份，外食選香蕉 1.5 份，自煮選白飯 4 份）：錄合計、ui 的 summary／gap／hint／submit、送出的 `normWrite`（含 `meal_type`、`implicit`、`archetype_id`、名稱）、lastPicked。
  - `foods/cook/<slot>/compose+food`：完整餐型加 2 項單品＋飲料，元件順序、implicit 有用油。
  - `foods/cook/<slot>/half+food`：hint 文字。
  - `foods/limit`：第 5 項的 alert、qty 8 的合計、qty 0.5。
  - `foods/ml`：全脂奶與無糖豆漿的名稱單位。
  - `foods/nullfiber`：火腿單品的「纖維：無資料」與 M1 的飽和脂肪。
  - 每組都放在 snapPicker 最後並先 `setDb`，`takeWrites`／`takeDom` 清乾淨，不干擾前面的情境。

---

## 3. 【建議改】

- **S1. 「加點單品」的搜尋只搜那一步的品項，會搜不到牛奶、香蕉**：使用者在搜尋框打「鮮奶」「牛奶」「香蕉」最自然，但這些在「飲品・水果」那一步。建議一個搜尋框搜全部 333 筆（名稱＋別名，`searchFoods`），結果直接可以點選，標出「在飲品・水果」。或者兩步各一個搜尋框。至少要有「找不到？水果與家裡的飲品在上一步」的中性提示。
- **S2. 「已選」框插在步驟頂端，每點一張卡片，下面的清單就往下跳一行**：
  - `renderDrinks` 整段 `innerHTML` 重畫。iOS Safari 沒有 scroll anchoring；Chrome 的 anchoring 碰到節點被替換也常失效。結果是在展開的子類中段連點兩張卡，第二下會點偏。
  - 建議在瀏覽器 handler 裡自己做錨點：重畫前記下被點卡片的 `getBoundingClientRect().top`，重畫後找回同一張卡，調整 `#meal-picker-body.scrollTop` 補回差值。
  - 被選的卡片本身加 `.selected`，寫「已選 · 2 份」。
  - 這也讓「再點一次捲到步進器」變成補充，不是唯一的回饋。
- **S3. 「飲品・水果」同一步裡同一種牛奶的規則不一致**：在自煮分頁只選現成「鮮奶（一杯，約240ml，全脂）」`tw_dr08` 會被擋（「只記飲料請到超商或外食分頁」），只選「全脂奶（自己倒）」`fx_whole_milk` 卻可以送出。兩者營養完全相同（decisions #85、#103），而且相鄰顯示。#45 擋自煮只記飲料的理由（沒意義的隱含成分）已經被 #83 解決（`{0,null}`）。建議交給使用者決定：自煮分頁只有現成飲料也能送出，PRD 13.4 送出條件加「或至少 1 杯飲料」，db 規則不必變。不改的話，hint 要寫成「只記現成飲料請到超商或外食分頁；家裡的飲品可以直接記」。
- **S4. 新的「已選」框不要用 `.meal-picker-step-label`**：walkthrough L80 的 `checkStepNumbers` 會對所有看得到的 `.meal-picker-step-label` 做 `parseInt`。現有 `selectedSectionHtml` 已經用這個 class 寫「已選（可以改份量）」（product-tab.js L48），只是目前測的時候剛好沒有選取。9-1 如果在選了單品之後檢查會得到 NaN。新框改用別的 class，或者 9-1 明訂在沒選單品時檢查。
- **S5. 合併「你標了不吃」組時不要直接沿用 `dislikedGroupHtml(items, true)`**：它會用 `cardHtml(it, {drink: true})` 把分層品項畫成 `data-drink="fx_…"`，而且分層品項沒有 `item.kcal`，所以不顯示熱量（product-tab.js L13–L19、L67–L74），同一組裡的卡片樣子不一樣。卡片雖然是 disabled、點不到，但 `data-drink` 的語意錯了。建議 food-step.js 有自己的單品卡片函式，用 `per_serving.kcal`、`data-food-uid`，合併組逐項分流。
- **S6. picker 的過敏原／飲食／不吃過濾對單品沒有快照鎖**：現有 `open/<pk>/<slot>/{convenience,delivery,drinks}/{pass,blocked,disliked}` 是安全快照，`m.foods` 沒錄。check-engine 有四條硬性過濾斷言，但選擇器真的用了 `m.foods.reasons` 沒有，只有 walkthrough 9-6 會發現。建議新增 `open/<pk>/<slot>/foods/{blocked,disliked}`（只錄被擋的 uid:原因，避免 333 筆 pass 行太長），這是章程 C4.1 的範圍。
- **S7. db 對快照營養欄位要求「必有欄位、值是數字或 null」**，不要只寫「若存在」。理由：跟 `totals`（db.js L203–L206）一致，切片 8 的我的食材轉形狀時漏欄位能被擋下。`productPart` 對 undefined 雖然也當 null，但紀錄格式應該完整。
- **S8. 步進器到下限時 − 要 disabled**（跟 ＋ 在 8 一致），不要「按了不變」。
- **S9. 驗收數字**：smoke「摘要熱量約 227」應為 **228**。9-2 的 303 正確（303.4）。建議斷言用 `contentTotals` 算出的值，再用同一條 `Math.round` 比對，不寫死。
- **S10. 文件**：
  - PRD 3 第 133 行（`implicit` 那一條）也要改成「自煮而且沒有 `ingredient` 時恰好 `{0,null}`」，不只改第 134 行。
  - PRD 13.4「1 份＝內建一餐 130g」的例子資料裡不存在（builtin_meal 是 45／100／120／150g），改成「糙米飯 熟重 150g」。
- **S11. 給工作線 C 的交接加一條**：C 會把備份升到 v3 並凍結 `backup-v3.json`，那份 fixture 要含一筆 `food` 紀錄。本切片不升版，所以現有 v2 fixture 沒有單品，v2→v3 的升級路徑對單品就沒被凍結驗過。
- **S12. 第 5 項單品**：除了 alert，建議也把其餘卡片灰掉、寫「單品最多 4 項」，比照自煮的 `composeOptionProblem` 寫原因。手機上 alert 比較打斷。可以留到之後做。

---

## 4. Q1–Q10 逐題

- **Q1（使用者）內建一餐那 10 項當單品：建議同意，但份量文字要強化。**「一碗糙米飯」「一盒希臘優格」確實是常見的單獨記錄（#95）。風險在同一個子類裡「份」的意思不同：白飯 1 份＝熟重 40g（1/4 碗），糙米飯 1 份＝熟重 150g（約一碗）。習慣白飯按到 4 份的人，在糙米飯按到 4 就是 600g、約 1093 kcal。建議：
  - 卡片沿用 `foodTreeServingShort` 的「內建一餐 · 熟重 150g」。
  - 步進器旁一律以克數為主：「1 份＝內建一餐 熟重 150g」「2 份＝熟重 300g」。
  - 藜麥一定要寫乾重（M2）。
  - 不必另外處理資料。
- **Q2 不升 `BACKUP_SCHEMA_VERSION`：同意。** 升版條件是 store、settings key、區塊結構，這次都沒有。#88 是同類先例，PRD 11.6 補一句即可。代價是舊版 App 讀新備份會報「content.components[i].kind」，單人、自動更新，影響小。附帶 S11。
- **Q3 規則寫成「自煮且沒有 `ingredient`」：同意。** 一般化後切片 9 的 `dish` 直接適用。v1、v2 fixture 沒有這種紀錄（已驗證）。重複 ref、超過 4 項放在 engine 不放 db，也同意：PRD 13.4 的 db 驗證清單本來就沒列，手改的備份多出單品也不影響計算。補一點：這條規則同時要求 `archetype_id`、`method_id` 是 null，可以擋到「取消餐型時只清 archetype、沒清 method」這種實作錯誤，很有價值，保留。
- **Q4（使用者）可以取消已選的餐型：建議同意，用「再點一次取消」。** 現行「再點同一個＝重置草稿」本來就會清掉整份草稿，改成連餐型一起取消，誤觸的代價沒有變大。走查沒有依賴舊行為（已驗證）。另外：
  - hint 那句改成「只記單品可以再點一次「X」取消餐型」，比「先取消餐型」更具體。
  - 已選的餐型按鈕可以加「（再點取消）」小字，或用 `aria-pressed`。
- **Q5 household 乘份數：部分同意。** 只乘「開頭是數字、後面是單純單位」的、份數 1 原樣寫、其他只寫克數，都同意。分數規則要照 M3 換成有理數、加可數單位規則，狀態詞與 display 照 M2。
- **Q6（使用者）已選單品的位置：建議同意「各步驟頂端各自一框」，但一定要配 S2 的錨點補償與卡片上的 `.selected`。** 集中放在「加點單品」會讓牛奶、水果的步進器離卡片很遠，不建議。「再點一次不新增、捲到步進器」同意，符合 PRD 13.4。−／＋／移除各 ≥44px。移除不要用確認對話框。
- **Q7 三分頁共用 `foodSel`：同意。** PRD「兩個共用步驟」，跟 `drinkUid` 一致，`leftoverLine` 不提單品也對，因為單品本來就算進這餐。
- **Q8 畫在 `#meal-picker-drinks` 裡：同意。** 前提是 M4 的「渲染路徑不碰新選擇器」。
- **Q9 只有單品也照分頁記 `picker_last_meal_type`：同意。** 跟只記飲料的現行行為一致。
- **Q10 15 個 null 的品項：照 C4.5 不補值，同意。** 但第 2.3 節「纖維缺口偏大、往安全方向」低估了影響：
  - 那一天整天的纖維變未知，從本週纖維平均剔除（budget.js L195–L207、matcher.js L35–L38）。
  - 那 15 項裡有火腿、培根、香腸、熱狗這些台灣家庭早餐常見的東西。天天吃的人，完整記錄日會全部被剔除，`avgFiber` 退回 0，`fiberGapThisWeek` 卡在最大值，本週總覽的纖維寫「無資料」。
  - 這是 C4.5 的設計，不在本切片改。手機短清單要寫「吃火腿、培根、香腸這類加工肉後，本週纖維可能顯示無資料」，並記進日後討論。
  - 另外飽和脂肪那 15 項要配 M1 一起看。

---

## 5. 行動版 UX 與營養師角度

- **份量文字**：
  - 共用內建 id 的雞胸肉：1 份是代換表 30g，今日建議一餐 130g，約 4.5 份。
  - 內建一餐的糙米飯：1 份＝150g。
  - 這兩種「份」並存是最大的誤導來源，對策是 Q1、M2：克數為主、狀態詞必寫、份數為輔。
  - 液體：ml 正確，快照已換算（全脂奶 240ml＝151.7 kcal，跟外帶鮮奶相同）。名稱寫「480ml」好懂。無糖豆漿 1 份是 190ml，沒有 household，只寫毫升即可。
  - 雞蛋：1 份＝生重 55g，household 是 null，畫面會寫「2 份＝生重 110g」而不是「2 顆」。這是資料缺口，記進日後的資料修正，本切片不動資料。
- **步進器 0.5–8**：
  - 對多數品項夠：蔬菜 800g、白飯 320g（2 碗）、油 40g。
  - 對蛋白質偏緊：雞胸 8 份＝生重 240g、牛腱 280g、鮭魚 280g。健身族一餐 250–300g 雞胸記不下，同一個 ref 又不能出現兩次。
  - 建議請使用者考慮把 `FOOD_QTY_MAX` 提高到 10 或 12。這是 PRD 常數，改 PRD 13.4 與 decisions 即可，章程 C4.8 只寫了 `FOOD_MAX_PER_MEAL`。
  - 按的次數：雞胸從 1 到 4.5 份要按 7 下、白飯到 4 份要按 6 下，可以接受。日後可以加點數字直接輸入。
- **一餐最多 4 項**：家常一餐「白飯＋滷雞腿＋炒高麗菜＋荷包蛋」已經 4 項。計畫自己的說明又鼓勵「有用油可以加油脂類」，加了油就是第 5 項。而且今日建議一個時段記過之後就沒有「自己選」入口（tab-today.js L88–L91，只顯示已記錄＋撤銷），沒辦法分兩筆記。這是 C4.8 定的值，要改得走 C3。建議把「家常一餐 4 項不夠」與「已記錄的時段沒辦法再加一項（飯後水果）」一起列給使用者決定。單品最自然的用法正是補記一顆水果、一杯牛奶。
- **兩個步驟在手機上的長度**：
  - 大類、子類預設收合、標題帶筆數，可以接受。
  - 自煮分頁選了完整餐型後，步驟會到 6、7。只記單品的人可以不選餐型，直接往下捲過「選餐型」（第 2 步）。
  - 建議在自煮分頁「選餐型」那一步上方加一行「只記單品可以不選餐型，直接到下面加點單品」，用中性文字。
  - 截圖要看：360 寬時已選框加上步進器那一行不換成三行；summary／gap 在 foot 變高時，「取消」「記下這餐」仍在第一屏。
- **只有單品的一餐**：
  - 型態照分頁、不顯示圖示：現在 ui 沒有任何依 `meal_type` 畫圖示的程式（grep 確認），自然成立。
  - 名稱用「＋」串、照順序：今日建議卡片「已記錄：全脂奶（自己倒） 480ml＋白飯 160g…」4 項時會很長，截圖要看換行。
- **不評判（C4.13）**：
  - 步進器、已選框、份量文字都沒有評價字眼或顏色，第 5 項的 alert 也是中性的。
  - 要避免的：不要因為份數多就變色；「8 份」到上限只停用 ＋、不寫「太多」；纖維「無資料」不寫成警告。
  - 「單品不含烹調用油；有用油可以加油脂類」是中性說明，符合。

---

## 6. 計畫漏掉的依賴或驗收項目

1. M1 的 `contentTotals` 修改與跨分頁一致性斷言。目前第 4 節那條「沒有多出 partial」會失敗。
2. M4 的 fake DOM 選擇器限制，要寫進第 1 節與 commit 3 的驗證。
3. M5 的 diff-recs 情境清單（PRD 13.9 四類），commit 編號改成 4。
4. 第 7 節呼叫端漏列 smoke-browser.mjs L185（`draftLogName`）。
5. `rebuildLists`（取消不吃之後）除了重算 `m.foods`，也要把 `foodSel` 裡已經不能選的去掉。`currentDraft` 雖然有過濾，但已選框與摘要件數要一致。
6. S6：選擇器單品過濾的快照。
7. walkthrough：`checkStepNumbers` 與「已選」框的 class（S4）。9-3「再點已選卡片→捲到步進器」要斷言捲動後步進器在 viewport 裡，不只斷言數量不變。9-2、9-3 加一張連點兩張卡片後的截圖，對應 S2。
8. 手機實機腳本第 3 節 3-5a（自煮只選飲料的提示）要看 S3 的決定是否改字。第 3 節 3-4「最後是加飲料」要改成新步驟名稱與編號（計畫列了 3-1、2a、3-4、8，3-4 的文字在第 67 行也要改）。
9. PRD 3 第 133 行（S10）。PRD 13.4 寫 M2 的狀態詞規則、M3 的分數規則、Q4 的取消方式、Q6 的位置。
10. 交接給工作線 C：v3 fixture 要含單品（S11）。「已記錄的一餐存成組合」會遇到只有單品的自煮紀錄（`archetype_id` null、`implicit {0,null}`），`toSavedContent` 的 `keepImplicit` 要能處理這種形狀。
11. 給使用者的產品決定清單裡加三題，不阻擋開工：`FOOD_QTY_MAX` 是否提高、4 項上限、已記錄時段能不能再加一筆。
12. 每個改到 `js/` 的 commit（1、2、3）都要跑 stamp-version。第 5 節開頭寫了，但第 2.1 節第 21 項只放在 D 段，容易誤會成只有 commit 3 要跑。
