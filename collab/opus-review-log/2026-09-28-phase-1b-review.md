# Phase −1b 驗收審核

日期：2026-09-28　實作者：Opus（Lighten2 主導開發）　審核者：新開的獨立 Opus agent

## 第一輪：送審問題（逐字）

你是 Lighten2（個人減脂飲食 App，純前端 vanilla JS＋IndexedDB，repo 在 `D:\ok\lighten`）Phase −1b 的獨立驗收審核者，不是實作者。**只讀不改**任何 repo 檔案（要驗證可以把 repo 複製到 scratchpad 底下改著試）。用中文回答。

範圍：commit `14d9b96`（docs: 主食生熟基準定案）到 HEAD，共約 30 個 commit。用 `git log --stat 14d9b96^..HEAD` 看清單，每個 commit 訊息都有差異報告。

依據：`docs/PRD.md` 第 7 節 −1b 列（驗收：每一項各更新推薦快照、差異報告；check-data、check-engine 全過）、`docs/CHARTER.md`（B 全部、C1–C6）、`docs/decisions.md` #35–#40、`docs/review/2026-09-28-食物資料review.md`（含第 5、6 節）、`docs/review/2026-09-28-烹調油脂與鈉決策.md`、上一輪待審三項的審核紀錄 `collab/opus-review-log/2026-09-28-phase-1b-batch.md`。

請審：
1. **−1b 列的每一項是否都完成**，有沒有漏項或只做一半（逐項列：完成／部分／未做）。
2. **資料正確性**：抽查 `data/ingredients.json` 的 TFDA 樣品選擇（至少 10 筆，用 `data/reference/tfda-2025-update1.json` 核對）、生熟基準（decisions #35）、過敏原、複合料理判定、`label_unsourced` 分類、麥當勞與 TFDA 飲品的重算。營養師角度的判斷有沒有明顯錯誤。
3. **程式正確性**：null 傳染與鈉/飽和脂肪例外、低碳縮放上限、用油與調味（含少油換算、不縮放、紀錄快照）、同一天重建（#39）、不吃清單只比 key、手動記錄規則、自訂食物過敏原與 db 驗證。找得到會出錯的具體輸入就寫出來。
4. **工具是否真的擋得住**：check-data、check-engine、check-arch 的新規則有沒有漏洞（例如改壞資料卻通過）。
5. **章程遵守**：先改 PRD/decisions 再改程式（A1）、修 bug 先寫失敗斷言（C5）、每項各自更新快照（C6.3）、C2 單一來源、C4 各條。
6. 還有什麼應該在 −1b 修、卻留到之後的。

格式：每個發現標【一定要改】或【建議】，附檔案與行號、重現方式。最後一行寫總結論（−1b 可以驗收／需再修）。

---

## 第一輪：審核回覆（逐字）

# Phase −1b 驗收審核意見（獨立審核者）

審核者：新開的獨立 Opus agent，不是實作者。全程沒有改 repo 裡的任何檔案。要實驗時，我用 `git archive HEAD` 把 repo 複製到 scratchpad 的 `review1b\`，在那裡改著跑。

## 審核方法

- **讀過的文件**：送審說明列的全部依據，包括 CHARTER B、C1–C6，PRD 第 3 節與第 7 節 −1b 列，decisions #13–#40，食物資料 review 第 0–6 節，烹調油脂與鈉決策，以及 `phase-1b-batch` 審核紀錄。另外讀了 22 個 commit 的訊息與差異報告。
- **讀過的程式**：`js/engine/{filters,meal-content,pool,recommend,today,budget,matcher}.js`、`js/data/{catalog,db}.js`、`js/ui/{item-picker,manual-picker,tab-today,today-hero,dom,tab-profile}.js`、`tools/{check-data,check-engine,check-arch,build-ingredients}.js`、`tools/lib/ingredient-values.js`。
- **跑過的工具**：在 repo 原地跑 `check-data`、`check-engine`、`check-arch`、`diff-recs`，四支全過。
- **實驗**：
  - 資料改壞 15 種，看工具擋不擋得住（第 4 節）。
  - 用真實的 catalog 跑 `item-picker.filterForSlot → sumProducts / composeTotals`，重現鈉遺失的 bug（第 3 節 A1）。
  - 把三個修 bug 的 commit 的 engine 換回修正前的版本，跑同一個 commit 的 check-engine，確認斷言在修正前真的會失敗（C5.1）。

---

## 1. −1b 列逐項完成度

| 項目 | 判定 | 說明 |
|---|---|---|
| 由 TFDA 重建 `ingredients.json`（build-ingredients、check-data） | 完成 | 47 筆的來源分布：tfda 42（含用油）、usda 1、derived 2（糙米飯、雜糧飯）、assumption 7（5 種烹調法＋2 個調味程度）。資料跟參考資料完全相等 |
| 現成品項改 B4 格式、官方數字、過敏原、複合料理加「未確認」 | 大致完成 | 格式、麥當勞 7 筆、TFDA 飲品 5 筆、composite 都做了。**殘留**：飲食限制標註與 `label_unsourced` 分類有錯（第 2 節），畫面顯示的 note 還帶著 AI 給的鈉數字（第 3 節 A3） |
| 過敏原詞彙加花生、軟體動物 | 完成 | `core/config.js` 是唯一來源，基本資料的勾選框由它產生 |
| 用油與調味隱含成分、基本資料「用油習慣」 | 完成（程式）／部分（畫面） | engine、候選池、紀錄快照都正確。decisions #38 要求畫面註明溫沙拉「未含沙拉醬」，**沒做**（A2） |
| 鈉與飽和脂肪（顯示規則） | **部分** | engine 的加總正確，hero 與推薦紀錄也正確。**「自己選」的現成品項與自煮裡的飲料，鈉和飽和脂肪整個遺失**（A1） |
| null 傳染修正 | 完成 | meal-content、budget、matcher、本週總覽都改了，也有斷言 |
| 自訂食物過敏原：拿掉例外＋`db.js` 寫入驗證 | 完成 | `fromCustomFood` 沒帶鈉與飽和脂肪欄位（B6，同一類遺漏） |
| 低碳獨立開關與縮放上限 | 完成 | 實測藜麥烤鮭魚：預算 500、800 時縮放都被壓在 0.997 倍，碳水正好 30g；預算 300 時照熱量縮成 0.537 倍 |
| 手動記錄放寬 | 完成 | `manualSelectionProblem`、`canAddManualItem` 搬進 engine，有斷言 |
| `daysSince` 時區 | 完成 | 凌晨、白天、深夜三個時間點都有斷言 |
| 食材 id 定案並凍結 | 完成 | 凍結清單 47 筆跟資料完全一致，check-data 會擋改名 |
| 同一天重建（#39） | 完成 | 三個必改點都做了，另有三條先失敗的斷言，也拿掉了 `clearShown` 繞道 |
| 毛豆仁移軸、骨架 `seasoned`（#37、#38） | 完成（資料） | 同 A2：「未含沙拉醬」沒上畫面 |
| 驗收：每項各自更新快照並附差異報告 | 完成 | 每個 commit 都有差異報告，品質很好。第 3 項 A1 的差異報告有一句與事實不符 |
| 驗收：check-data、check-engine 全過 | 完成 | — |

---

## 2. 資料正確性

### 2.1 TFDA 樣品選擇抽查（逐筆對 `tfda-2025-update1.json` 的樣品名稱、狀態、內容物描述）

| id | 樣品 | 狀態 | 判定 |
|---|---|---|---|
| chicken_breast | I04024 去皮清肉平均值 | 生、雞胸 | 正確。市售多為肉雞，可考慮改 I0402402，差 2 kcal，不影響判斷 |
| egg | K01001 雞蛋平均值 | 生、去殼 | 正確 |
| salmon | J0402402 大西洋鮭魚切片（中段） | 生 | 正確，照上一輪審核意見 |
| beef_shank | I0108301 牛後腿腱子心 | 生、冷凍 | 正確，note 說明了捨棄 I0108302 的理由 |
| chicken_thigh | I0404501 去皮去骨雞腿（肉雞） | 生 | 正確 |
| tilapia_fillet | J0412003 台灣鯛魚片 | 生、冷凍 | 正確 |
| shrimp | J2200601 鳳尾蝦仁 | 生、冷凍 | 正確。蛋白質 13.4g/100g 跟代換表吻合 |
| edamame | H1100301 冷凍毛豆仁 | 冷凍、as_is | 正確 |
| oats | A0810201 即食燕麥片 | dry | 正確 |
| sweet_potato | B0400601 黃肉甘藷 | 生 | 正確。note 的「台農57號」TFDA 沒寫，屬於推測 |
| quinoa | A1100101 紅藜麥 | 生（乾） | 【建議】台灣紅藜跟市售進口白藜麥不同種，熱量接近，note 要寫明是代用 |
| broccoli | E5800402 青花菜 | 生 | 正確，修掉了 v1 誤用白花椰菜數值的問題 |
| bell_pepper / onion | E7500201 紅甜椒／E2400301 黃洋蔥 | 生 | 正確 |
| bamboo_shoot | E1200101 烏殼綠竹筍 | 生 | 正確 |
| kimchi / teriyaki_sauce | R4400301 / P1002901 | — | 數值正確；過敏原判斷見 2.3 |
| cooking_oil | M1100101 大豆油 | — | 正確 |
| 現成品項 dr05–dr09 | O0700301×4、H1150201×3、R5000101×3、L01021×2.4、O0700101×4.5 | — | 七個欄位我逐一乘算，全部相符 |
| greek_yogurt | USDA FDC 170903 | — | 我查了 TFDA，只有凝態發酵乳，沒有希臘優格，所以用 USDA 合理 |

結論：抽查 22 筆，樣品選擇沒有錯。`per_100g` 經 check-data 確認跟參考資料四捨五入後完全相等。

**【建議】`wood_ear` 的 note 理由寫錯**（`data/ingredients.json` wood_ear）
- note 寫「TFDA 熱量已依纖維換算」。事實相反：TFDA 的「熱量(kcal)」欄是蛋白質、總碳水、脂肪各乘 4/4/9，沒有扣纖維；扣纖維的是「修正熱量」。
- 驗算差 −33% 的原因，是章程 B5.4 的驗算公式有扣纖維，TFDA 的熱量欄沒扣。
- 數值本身沒問題，只要改 note 措辭。`kimchi` 的 note「發酵蔬菜高纖」也是同樣的誤解。

### 2.2 生熟基準（decisions #35）

- 資料跟 #35 一致：米飯類熟重、`cooked_to_raw` 0.5 且公式倍數一致；地瓜、南瓜生重；毛豆仁 as_is；藜麥乾重；蔬菜一律生重。
- 【建議】#35 說熟重係數 0.5「略保守（熱量偏高估）」，實際偏差不只「略」：
  - TFDA 白飯 A0550601 是「白米加 1.1 倍水」煮的，183 kcal。
  - 糙米一般加 1.3–1.5 倍水，熟重係數約 0.40–0.45，也就是每 100g 約 146–164 kcal。
  - 目前 182.1 kcal 大約高估 10–25%。
  - 方向安全（主食會被縮小），但 decisions 或 note 要寫出幅度，免得之後有人拿 0.5 當準確值。

### 2.3 過敏原與複合料理

- 燕麥類都標了麩質；花生、軟體動物已套用（蚵仔煎、海鮮粥、涼麵、堅果）；55 筆複合料理加了「未確認」。
- **【建議，安全方向】`kimchi`、`teriyaki_sauce` 標了 `composite: true` 卻沒有「未確認」**
  - 依據是 TFDA 內容物描述有列成分（B6.3 的例外條款），但兩筆的描述都以「…等」結尾，不是完整成分表。
  - 實作者自己也因為「傳統做法常加蝦醬」替泡菜加了甲殼類，這表示成分會因商品而異。
  - App 裡的泡菜與照燒醬是使用者自己買的商品，不是 TFDA 那一個樣品。
  - 依 B6.7「有疑義往保守」，我建議兩筆都加「未確認」。影響很小：這兩個都是選填的醬料軸，不加醬料的組合照樣可推薦。
  - 如果決定維持現狀，check-data 至少要擋描述裡有「等」的樣品（見第 4 節）。
- **【一定要改】飲食限制標註有明顯錯誤（B6.5）**：

| 品項 | 目前標註 | 問題 |
|---|---|---|
| `conv_pk03` Soyjoy 大豆營養棒 | vegan: true | Soyjoy 多數口味的成分含雞蛋與乳成分。只要沒設過敏原，全素使用者就會拿到這筆推薦（「未確認」只擋有設過敏原的人）。要改 vegan: false；拿到成分表確認前，lacto_ovo 也要保守標 false |
| `conv_sl02` 日式海藻沙拉 | vegan: true，含「未確認」 | 和風醬常用柴魚。成分都沒確認，就不能正面宣告全素，要改 false |
| `taiwan dr06` 無糖豆漿、`dr09` 美式、`dr03` 無糖茶、`bf08` 地瓜 | vegan: false、lacto_ovo: false | 往保守方向錯，不是安全問題，但全素與蛋奶素使用者因此拿不到這些。同一種地瓜在超商 `conv_bx05` 標 vegan: true，前後不一致 |

- 另外，`conv_sl04`、`conv_bx08`、`conv_bx09`、`conv_bx10` 都是「過敏原未確認、卻正面宣告全素」。這個組合本身就互相矛盾，要逐筆確認或改 false，並加一條 check-data 規則（第 4 節 T5）。

### 2.4 `label_unsourced` 分類（B3、decisions #21）

【建議】下面這些不可能是單一包裝上抄來的數字，應該從凍結清單移除、改標 `estimate`：
- 纖維帶 .25 或 .75：`conv_bx01.fiber_g` 4.75（note 自己寫「兩批資料取平均」）、`conv_bx06.fiber_g` 5.75、`conv_bx10.fiber_g` 9.75、`conv_bx12.fiber_g` 4.25。包裝標示只到小數 1 位，這是平均值。
- `conv_pk03` Soyjoy 熱量 137.5 kcal：是整條產品線多種口味，屬於 #21 說的品牌等級品項。
- `conv_bx13`：vendor 是 null，note 寫「萊爾富/7-11」，很可能是兩家通路的不同商品合在一筆。

影響只有畫面上的「約」和查證的先後順序，所以列建議。

### 2.5 麥當勞與 TFDA 飲品重算

- 7 筆麥當勞：碳水＝(熱量 − 蛋白質×4 − 脂肪×9)÷4，逐筆驗算都相符（例：bf11 (343−72−144)/4＝31.75，取 31.8）。整筆標 `estimate`，因為來源是營養師網站整理的二手資料，這個判斷正確。
- 【建議】這 12 筆的 `note` 還留著舊文字，例如「2026-09-27補碳水/脂肪：依食物代換表…反推估算，假設脂肪佔熱量約30%」，跟現在的官方值、TFDA 值矛盾。note 要改寫，免得下一個人照 note 再覆蓋一次（v1 就是這樣出事的）。

---

## 3. 程式正確性

### A1【一定要改】「自己選」的現成品項與自煮裡的飲料，鈉和飽和脂肪整個遺失

- **位置**：`js/ui/item-picker.js:32-39` 的 `toPickerItem`。它只複製 kcal、蛋白質、碳水、脂肪、纖維，沒有複製 `sat_fat_g`、`sodium_mg`。
- **影響**：
  - `manual-picker` 的 `sumProducts(selItems)`、`contentFromProducts` 的快照、`composeTotals` 的 `c.drink`（`meal-content.js:242`）拿到的都是 undefined。
  - 結果是「部分品項無資料」或 null，**寫進 daily_log 的鈉是錯的**。
- **重現**（scratchpad 的 `t1.mjs`、`t2.mjs`）：
  - 早餐自己選「拿鐵咖啡（無糖，大杯）」：catalog 裡鈉是 113.1 mg，`sumProducts` 回傳 `sodium_mg: null`，商品快照的 `sodium_mg` 也是 null。
  - 自煮燕麥碗加飲料「鮮奶」（TFDA 鈉 89.8、飽和脂肪 5.9）：合計鈉 7.8 mg、飽和脂肪 1.9g，兩欄都被標成「部分品項無資料」。
- **沒被抓到的原因**：
  - 053d5d7 的差異報告寫「TFDA 飲品顯示實際鈉值」，跟實際行為不符。ui 快照在品項模式裡從來沒選過 dr05–dr09，所以每一行都是「鈉 無資料」，差異看不出來。
  - 手機實機腳本「自己選」第 2 步（「已選 1 件…鈉 約 N mg」）如果真的跑過，就會發現。
- **性質**：這是章程 C2 的問題。catalog 已經正規化過，`toPickerItem` 又做了一份，只抄部分欄位，漏的就是新加的欄位。依 C5.3，要讓 picker 直接帶 catalog 的品項（或 spread 後再加 picker 專用欄位），不要逐欄抄。
- **要補**：一條先失敗的 check-engine 斷言：「`filterForSlot` 產出的品項，所有營養欄位都跟 `catalog.productsByUid` 相同」，以及「選 dr05 後 `sumProducts` 的鈉＝113.1」。
- **同一類**：`js/data/catalog.js:57-66` 的 `fromCustomFood` 也沒帶 `sat_fat_g`、`sodium_mg`，但 −1b 已經在 `validateCustomFood` 要求這兩欄存在。Phase 0 開放新增前要一起修（【建議】現在就修）。

### A2【一定要改】溫沙拉「未含沙拉醬」沒有出現在畫面上

上一輪審核第 2 項的【一定要改】(a) 要求「PRD 與卡片說明寫『未含沙拉醬』」，decisions #38 也寫「（畫面註明）」。
- PRD 第 3 節和骨架 note 有寫。
- `grep 沙拉醬 js/ index.html` 沒有結果：推薦卡片（`tab-today.js:135` 只寫「含用油約 Ng」）和自己選都沒有註明。

這是上一輪必改項沒做完，要補到溫沙拉的推薦卡片與自煮合計上。

### A3【建議，優先】推薦卡片把 AI 給的鈉數字顯示給使用者

- `js/engine/pool.js:140-155` 的 `contentNote` 取 note「；」後半段顯示在推薦卡片上。
- 35 筆超商品項裡，有 33 筆的後半段是「2026-09-27補碳水/脂肪：Google AI回覆估算值…（飽和脂肪0.6g/糖0g/鈉380mg，供參考）」。ui 快照 `today/M/base/dom01` 就能看到。
- 這跟 B2.3（AI 的數字不是出處）、B5.8（沒出處的鈉是 null）直接矛盾：同一個 App 在明細顯示「鈉 無資料」，卡片上卻寫「鈉380mg」。
- 修法：把 note 的內容物描述跟資料沿革分開（例如新增 `content_desc` 欄位），沿革文字不上畫面。

### A4【建議】`daily_log` 驗證接受「自煮但 `implicit: null`」

- `validateDailyLog` 只檢查 `implicit` 是物件或 null。check-engine 的合法範例 `tools/check-engine.js:491` 甚至把 `meal_type: "cook_quick"` 配 `implicit: null` 當成格式正確。那是 −1a 的過渡格式（PRD 第 125 行）。
- C4.11 規定「自煮一律包含用油與調味」，−1b 之後應該改成：`cook_*` 必須有 `{oil_g: 非負數, seasoning: "light"|"normal"|null}`，並把這個範例改成反例。
- 目前的寫入端都有帶 implicit，所以沒有實際錯誤；但 Phase 0 的自煮分頁、Phase 2 照計畫記錄都會新增寫入點。

### 其他實測後正確的部分（不列問題）

- **null 傳染與鈉例外**：`addContributions` 的 partial 規則、`sumDisplayLogTotals`、縮放時顯示欄位只縮放有資料的部分，都正確。
- **低碳**：`lowCarbMaxScale` 與 `achievableNutrition` 取兩者較小者，評分與最後份量用同一個上限；現成品項以 Infinity 表示不受限，碳水 null 就排除。
- **用油**：`withOilHabit` 只改固定部分，主要槽位不動；少油換算與快照的克數一致。
- **#39**：我推演了「昨天、今天都顯示過的組合」這個 v3 情境。今天顯示過的組合在重建時分數只會變高，不會被別的換掉，所以 v2 的修法足夠。
- **不吃清單只比 key**：已確認修正前的程式確實會失敗那條換軸斷言。

---

## 4. 工具擋不擋得住（在 scratchpad 改壞資料實測）

| # | 改壞方式 | check-data | check-engine | diff-recs |
|---|---|---|---|---|
| T1 | 雞胸 `field_sources.fat_g={value:1.0,…}`，脂肪從 2.1 改成 1.0 | **通過** | 通過 | 擋（快照變動） |
| T1b | 雞胸鈉用 value 覆寫成 5 | **通過** | 通過 | 只有 ui 變 |
| T2 | `cooking_oil` 飽和脂肪 16.1 用 value 覆寫成 0 | **通過** | **通過** | **通過** |
| T3 | dr06 鈉用 value 覆寫成 0 | **通過** | **通過** | **通過** |
| T4 | bf11 碳水改 80（derived 反推值不符） | **通過** | 通過 | pool 1 行 |
| T5 | 雞蛋 vegan: true；含蛋的 conv_sl03 標 vegan | **通過** | 通過 | 快照變動 |
| T6 | 泡菜拿掉「魚」；照燒醬過敏原清空 | **通過** | 通過 | 快照變動 |
| T7 | 排骨便當 composite: false、拿掉未確認 | **通過** | 通過 | 快照變動 |
| T8 | conv_dr01 升級成 label 出處，蛋白質亂改成 50 | **通過** | 通過 | 快照變動 |
| T13 | 超商新增一筆 id＝`egg`（跟食材 id 撞號） | **通過** | 通過 | 快照變動 |
| T14 | 麥當勞官方蛋白質 bf11 從 18 改成 10 | **通過** | 通過 | pool 1 行 |

diff-recs 只保證「有變動會被看到」，不保證變動是對的：刻意修改時快照在同一個 commit 更新，而且差異可能淹沒在上千行裡。所以下面幾項是 check-data 自己的漏洞。

- **【一定要改】T1–T3：`field_sources.value` 可以覆寫任何欄位，繞過「跟 TFDA 完全相等」**
  - 位置：`tools/lib/ingredient-values.js:71`。只要附一句 note，任何欄位都能被換成任意數字；build 會照寫，check 也照過。
  - T2、T3 甚至連快照都沒變。
  - 章程 B5.1 只允許「TFDA 值是 null、實際接近 0」時填 0。
  - 修法：覆寫只在參考資料原值是 null 時才准，且值必須是 0（或另有明確白名單），否則報錯。食材與現成品項共用這套算法，所以兩邊一起修好。
- **【一定要改】T8：B5.4 的巨量營養素驗算沒有套用到現成品項**
  - 章程 B5.4 與 B12 要求 `label`／`official_web` 出處的數字要驗算，但 `check-data.js:145` 只驗食材。
  - 目前沒有 label 或 official_web 的現成品項，所以還沒有實際錯誤；但第一筆升級上來的資料就不會被檢查，而升級正是章程要大家做的事。
- **【建議】T4、T14：derived 反推公式與「官方值不被覆蓋」都沒有機械保護**
  - `field_sources.carb_g` 的公式可以機械驗算：`(kcal − P×4 − F×9)/4`，跟實際值差 0.05 以內。
  - 麥當勞的官方蛋白質與脂肪因為整筆標 `estimate`，B2.2 的凍結清單保護不到。v1 就是在這裡被覆蓋的。
  - 建議加一份「官方值凍結清單」（id.欄位＝值），或把這幾欄的 `field_sources` 標成可以辨識的類型。
- **【建議】T5**：加一致性規則。vegan: true 時不得含蛋、乳製品、魚、甲殼類、軟體動物；lacto_ovo: true 時不得含魚、甲殼類、軟體動物；「未確認」加 vegan: true 要在 note 寫依據。這樣 2.3 的 Soyjoy 問題會被擋下。
- **【建議】T6**：B6.3 例外條款的判斷只看描述有沒有「括號加逗號」（`check-data.js:139`），描述以「等」結尾的也算通過。建議改成：以「等」結尾就視為不完整，必須含「未確認」。
- **【建議】T13**：#40 讓不吃清單只比 key，前提是「id 全資料庫唯一」，但 check-data 只檢查同一個檔案內不重複（`ids[file+p.id]`）。要加一條跨檔檢查：食材 id 與現成品項 uid（含 `tw_` 前綴）不得重複。
- **【建議】check-arch C4.14**：`check-arch.js:286-289` 只 grep recommend.js 與 pool.js 有沒有出現字串 `sodium`。透過 `DISPLAY_FIELDS[1]` 取值，或在 meal-content.js 寫個函式給評分用，都擋不到。建議改成：engine 裡讀 `DISPLAY_FIELDS` 或 `sodium` 的地方只允許 meal-content.js 的 `displayFields`、`addContributions`、`scaledDisplay`、`implicitContribution`、`sumDisplayLogTotals`，而且 recommend.js 不得 import 這些名稱以外的顯示欄位工具。
- **【建議】check-arch C4.11** 的 grep 有已知繞法，例如 `.map(x=>x.kcal).reduce((s,v)=>s+v)`。它是啟發式檢查，保留即可，但要在章程或腳本註明它不是完整證明。

---

## 5. 章程遵守

- **A1（先改 PRD 與 decisions 再動程式）**：#37–#40 的 docs commit（a41dd17）在 ab14d9a、6d492e0、5fca5e2 之前；其他項目在 PRD 與章程裡早已定案。符合。
- **C5.1（修 bug 先寫失敗斷言）**：
  - 6edfe1f、a8a2b90、88cd318、7380bb6、ab14d9a、6d492e0 都在同一個 commit 加了斷言，commit 訊息也寫了修前失敗的數量。
  - 我抽查三筆，把 engine 換回修正前的版本跑同一個 commit 的斷言：6d492e0 失敗 1 項（換軸），ab14d9a 與 6edfe1f 因為函式還不存在直接報錯。都符合「先失敗」。
  - 【建議】9895948（推薦卡片的圖片對照）沒有斷言，也沒有依 C5.2 在手機實機腳本加重現步驟。另外它是「用名稱當 key」的 C2 問題在 88cd318 之後第二次出現，依 C5.3 應該 grep 一遍還有沒有其他用名稱查表的地方。我查過目前沒有了。
- **C6.3（每項各自更新快照並附差異報告）**：每個改變行為的 commit 都附了快照與差異報告，品質好。例外是 053d5d7 那句不實的描述（A1）。
- **C2（單一來源）**：`toPickerItem` 重做了一次品項正規化，造成 A1，違反 C2。
- **C4**：
  - C4.1、C4.2、C4.3、C4.5、C4.6、C4.7、C4.8：程式與斷言到位。
  - C4.11：engine 到位；db 驗證沒有要求自煮必須有隱含成分（A4）。
  - C4.14：符合（中性顯示、不評分），但 A3 讓畫面出現沒有出處的鈉數字。
- **C6.5（Phase 驗收跑完整的手機實機腳本）**：repo 裡看不到有跑過的紀錄。只要跑「自己選」段落，A1 就會現形。**−1b 驗收前要實際跑一次。**
- **B7.4、C3**：毛豆仁移軸與 seasoned 經過一批獨立審核，符合。

---

## 6. 應該在 −1b 修、卻留到之後的

1. **A1、A2**：屬於 −1b 範圍內的「鈉與飽和脂肪」與 #38，必須在 −1b 修。
2. **2.3 的飲食限制標註錯誤**：−1b 的「修正現成品項」包含 B6，應該一起修。
3. **T1–T3 的覆寫漏洞、T8 的現成品項驗算**：這是 check-data 本身的完成度，B12 列為錯誤級檢查，屬於 −1b 交付的工具。
4. 【建議】**現成品項 note 清理**（A3、2.5）：−1b 重整了現成品項格式，note 是同一批要清的遺留。
5. 【建議】**食物資料 review 第 5 節第 3 點**「可以用 TFDA 樣品升級成 derived 的外食」（飯糰、水餃、小籠包、鍋貼、蚵仔煎、油條、茶葉蛋、豆花、手搖奶茶，例如 TFDA O0702201 珍珠奶茶全糖大杯）：−1b 只做了 5 杯飲品，剩下的沒有排進 `docs/日後討論.md` 或任何 Phase。PRD −1b 列沒有明文要求，所以不算漏項，但至少要登記去向，避免被遺忘。
6. 【建議】A4 的 db 驗證收緊、`fromCustomFood` 帶齊欄位：Phase 0 開放新增前一定要做，放在 −1b 做成本最低。
7. 已正確登記、另外送審的（不算遺漏）：低碳下有主食槽的骨架湊不到預算、超商組合隔天重複出現、`shown_count` 不衰減、煎蛋預設清淡調味、「不加調味」選項、溫沙拉的沙拉醬。

---

## 必改清單（驗收前）

1. **A1**：`item-picker.js` 的 `toPickerItem` 改成直接帶 catalog 品項的所有營養欄位（C2），同一次補 `fromCustomFood`；先寫會失敗的斷言；修正 053d5d7 差異報告的敘述（在下一個 commit 訊息更正即可）。
2. **A2**：畫面註明溫沙拉「未含沙拉醬」（decisions #38、上一輪必改項）。
3. **2.3**：`conv_pk03` Soyjoy、`conv_sl02` 改 vegan: false；逐筆確認「未確認加 vegan: true」的其餘 4 筆。
4. **T1–T3**：`ingredient-values.js` 的 value 覆寫只准用在參考資料是 null 的欄位。
5. **T8**：check-data 對 label／official_web 的現成品項做 B5.4 驗算。
6. **C6.5**：修完後跑一次完整的手機實機腳本，並留下紀錄。

其餘標【建議】的項目，可以在 −1b 順手做，或登記到 `docs/日後討論.md`。

總結論：**−1b 需再修**。主體工作紮實、差異報告詳盡，但上面 6 項必改完成後才能驗收。

---

## 第二輪：送審問題（逐字，2026-09-29）

你是 Lighten2（個人減脂飲食 App，純前端 vanilla JS＋IndexedDB，repo 在 `D:\ok\lighten`）Phase −1b 驗收審核的**第二輪核對**審核者，不是實作者。**只讀不改**任何 repo 檔案（要驗證可以用 `git archive HEAD` 複製到 scratchpad 底下改著試）。用中文回答。

第一輪審核意見全文在 `collab/opus-review-log/2026-09-28-phase-1b-review.md`（「第一輪：審核回覆（逐字）」一節），結論是「需再修」，必改 6 項＋多項建議。實作者修正的 commit 範圍是 `84a216d..HEAD`（`git log 84a216d..HEAD`，約 20 個 commit，每個 commit 訊息都有差異報告）。

請做：
1. **必改清單逐條核對**（A1、A2、2.3 飲食限制、T1–T3、T8；C6.5 手機實機腳本由使用者跑，只需確認腳本已補上對應步驟）：每條一行，寫「已解決／部分／未解決」＋對應 commit＋你怎麼驗證的（例：把修正換回修正前跑斷言確實失敗、在 scratchpad 改壞資料確實被擋）。
2. **建議項核對**：第一輪列的建議（A3、A4、T4、T5、T6、T13、T14、C4.14、C4.11 註明、2.1 note 措辭、2.2 糙米係數、2.4 label_unsourced、2.5 舊 note、6.5 外食升級登記、9895948）逐條一行：已做／已登記到 `docs/日後討論.md`／沒處理。
3. **修正本身有沒有引入新問題**：特別看
   - `js/ui/item-picker.js` 改成 `Object.assign({}, p, …)` 之後，picker 品項多帶的欄位（note、kcal_low/high、tier…）會不會影響 `passesHardFilters`、`manual-picker` 或寫進 daily_log 的快照
   - `data/` 的飲食限制更正（台式飲料改全素/蛋奶素、超商素食系列改只標蛋奶素並寫「素食依據：」）營養師角度是否合理
   - 泡菜、照燒醬加「未確認」、照燒醬改非素，對全素/蛋奶素/有過敏原設定的推薦影響（差異報告說只有「低碳／外食／300／麩質」的宵夜失去推薦）
   - `tools/check-arch.js` C4.14 新規則的正規式、`tools/check-data.js` 新規則（B6.8、B2.6、B2.2 凍結清單、T8 自我檢查、跨檔 id）有沒有誤擋或漏洞
   - 刪掉超商 note 的 AI 段落時，有沒有誤刪內容描述或殘句
4. **章程遵守**：先改 PRD/章程再改程式（A1）、修 bug 先寫失敗斷言（C5.1）、每項各自更新快照並附差異報告（C6.3）、commit 訊息的差異報告有沒有與事實不符。

在 repo 原地跑 `node tools/check-data.js`、`node tools/check-engine.js`、`node tools/check-arch.js`、`node tools/diff-recs.js` 確認全過。

格式：每個發現標【一定要改】或【建議】，附檔案與行號、重現方式。最後一行寫總結論（−1b 可以驗收（待使用者跑完手機實機腳本）／需再修）。
