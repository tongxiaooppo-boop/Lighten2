# Lighten2 章程

這份文件規定**之後改產品概念、新增或修訂食物資料、改動程式架構**時要照什麼規則走，目的是防止 v1「概念一改再改、程式修修補補」的狀況再發生。

- 適用對象：任何改 `docs/PRD.md`、`data/`、`js/` 的人（Opus、Sonnet、Cline 或使用者自己）。
- 章程本身要修改，比照 C3「需要獨立審核的變更」處理。
- 制定依據：[review/2026-09-28-架構review.md](review/2026-09-28-架構review.md)、[review/2026-09-28-食物資料review.md](review/2026-09-28-食物資料review.md)、[review/2026-09-28-烹調油脂與鈉決策.md](review/2026-09-28-烹調油脂與鈉決策.md)、獨立審核 [collab/opus-review-log/2026-09-28-lighten2-review-and-charter.md](../collab/opus-review-log/2026-09-28-lighten2-review-and-charter.md)。

每條規則後面標註它怎麼被檢查：**〔機〕**＝自動檢查程式會擋；**〔人〕**＝寫在手機實機腳本或審核清單裡，靠人檢查。沒有標註檢查方式的規則不應該存在。

---

# A. 產品概念變更

v1 重來的根本原因是「概念一改再改」，所以概念層的規則放在最前面。

## A1. 先改 PRD，再改程式

1. 下列變更屬於「概念變更」，**必須先改 `docs/PRD.md`、在 `docs/decisions.md` 記一條，才能動程式碼**〔人〕：
   - 型態（超商／外食／自煮）的定義或列舉
   - L1／L2／L3 資料模型與解析規則
   - 一餐內容（MealContent）的格式
   - 頂層分頁的新增、移除、合併
   - 任何「X 取代 Y」的決定
2. `docs/PRD.md` 是開發期間唯一的權威規格。程式跟 PRD 不一致時，PRD 為準；PRD 自己前後矛盾時，先修 PRD〔人〕。
3. 決定取代或移除一個功能時，同一次決定要列出它**原有的每一項職責搬到哪裡**，然後直接移除，不為了過渡期保留（例外：該職責的新家還沒做好，且使用者明確要求保留）〔人〕。

## A2. 決策紀錄 `docs/decisions.md`

- 一行一條：日期、決定了什麼、否決了什麼、為什麼、出處（對話或審核紀錄）〔人〕。
- 同一個問題再被提出時，先查這份紀錄；要推翻舊決定，要新增一條並寫明「推翻 #N，原因是前提改變了什麼」〔人〕。

---

# B. 食物資料章程

## B1. 範圍

| 檔案 | 內容 | 受本章程管轄 |
|---|---|---|
| `data/ingredients.json` | 自煮用的食材、醬料、烹調法、隱含成分（用油、調味程度） | 是 |
| `data/dish_archetypes.json` | 餐型骨架 | 是（B7） |
| `data/convenience_items.json` | 超商與連鎖健康餐盒/宅配 | 是 |
| `data/taiwan_items.json` | 台式外食 | 是 |
| `data/reference/` | TFDA 資料庫等參考資料（檢查程式依賴，版本管理） | 是（B10） |
| `data/tfda_lookup.json` | 衛福部全表的精簡查詢檔（由 `tools/` 從 `data/reference/` 產生，PRD 12.2） | 是（數值必須跟參考資料算出來的完全相等） |
| `data/food_tree.json` | 代換表分層品項（由 `tools/` 從 `data/reference/` 的代換表轉錄、對應表、標註產生，PRD 13.3） | 是（B4「分層品項」、B6、B12）。代換表完整轉錄搬進 `data/reference/` 時取代舊的部分轉錄 `food_exchange_table.json`，decisions #35 引用的欄位要相容 |
| 使用者的「我的品項」（`custom_foods` store） | 使用者自建 | 否，只受 B8 的最低驗證 |
| 使用者的「我的食材」「我的料理」（`custom_ingredients`、`custom_dishes` store，PRD 12.4、12.5） | 使用者自建 | 否，只受 B8 的最低驗證；B6.8 不適用 |

## B2. 出處

每一個營養數字都要能說出「從哪裡來」。食材和現成品項的出處順序不同，分開規定：

**食材**：`tfda` ＞ `usda` ＞ `derived`。`ingredients.json` 裡不存在「估算的食材」〔機〕（使用者的我的食材可以自填，不在此限）。

**現成品項**：`label` ≈ `official_web` ＞ `derived` ＞ `estimate`。

| `type` | 說明 | `ref` 要寫什麼 |
|---|---|---|
| `tfda` | 衛福部食品營養成分資料庫（目前版本 2025 UPDATE1） | 整合編號，例如 `I04024` |
| `usda` | 美國農業部 FoodData Central（TFDA 沒收錄時才用） | FDC ID |
| `label` | 包裝營養標示 | 照片檔名或商品頁網址 |
| `official_web` | 品牌/連鎖店官網、官方 App 或其公開的營養資料 | 網址（附查詢日期） |
| `derived` | 由上列來源用明確公式推算（熟重、TFDA 每 100g × 份量、官方蛋白質/脂肪 ＋ 熱量扣減求碳水；代換表分層品項的 1 份＝整合編號 × 代換表可食克數，液體依附-1「1 杯＝240 公克」換算，衛福部沒有熟樣品時依代換表同一食物的生熟等值列推算） | 公式與所用來源，例如 `A05013 ÷ 2.5`；分層品項的 `ref` 一律是機器可讀的「整合編號 × 倍數」（倍數＝克數 ÷ 100，跟現成品項同形），說明寫在 `note`：`ref: "H1150201 × 1.9"`、`note: "附-3-1 無糖豆漿 190ml，附-1「1 杯＝240 公克」換算"`；`ref: "R2000101 × 0.2"`、`note: "附-4 麵條(熟) 60g＝麵條(乾) 20g"`（decisions #103） |
| `estimate` | 依同類品項或食物代換表概算 | 估算方法一句話 |
| `exchange` | 食物代換表。**只用於份量、生熟重、購買量/可食量**，不作為營養數值的出處 | 表號＋品名，例如 `附-3-1 雞胸肉` |
| `assumption` | **只用於隱含成分的「量」**（每份用油克數、調味程度的鈉毫克數）：這些是對一般做法的假設，不是測得的數值 | 假設依據，例如「一般＝鹽 1g（390 mg）＋醬油 5g（250 mg）≈ 640，取 700」；營養換算仍用 TFDA（油＝M1100101） |

規則：
1. 有高順位出處時，不得使用低順位出處；TFDA 查得到的食材一定用 TFDA〔機：格式——`tfda` 以外的食材出處要在 `source.note` 寫「TFDA 無此品項」；〔人〕：這句話是否屬實〕。（只適用 `ingredients.json`；分層品項的出處由 B12「對應編號存在」管）
2. **低順位不得覆蓋高順位**：已有 `label`/`official_web` 的數字，不得被 `estimate` 或反推值取代〔機：凍結清單比對〕。來源是二手整理、整筆標 `estimate` 的官方數字（例：麥當勞 7 筆的熱量、蛋白質、脂肪）也列入凍結清單 `data/reference/official_values_frozen.json`，要改必須同一個 commit 改清單並說明；用「熱量 − 蛋白質×4 − 脂肪×9」反推的碳水要跟公式相差 ≤0.05，凍結清單裡沒有列碳水的品項，碳水出處必須維持這個反推（不能改標 estimate 繞過）〔機〕。
3. 「AI 回答的數字」不是出處。AI 可以幫忙找網址，但寫進資料的數字必須來自上表，否則一律 `estimate`〔人〕。
4. TFDA 熱量取「熱量(kcal)」欄，不取「修正熱量」〔機〕。
5. 一筆資料的欄位出處不同時（例如熱量來自包裝、碳水是估算），用 `source` 當預設，`field_sources` 逐欄覆寫〔機：格式〕。
6. 現成品項的 `note` 格式是「資料來源；內容描述」，推薦卡片只顯示第一個「；」之後的內容描述。出處與沿革寫在 `source`／`field_sources`，不寫進內容描述；AI 回答的數字（B2.3）不寫進 `note`〔機：`note` 不得出現 AI、Claude、GPT、Gemini（不分大小寫）〕。

## B3. 可信度（由出處推導，不另外存）

可信度**不存欄位**，由 catalog 依每個欄位的出處推導〔機〕：

| 推導結果 | 條件 |
|---|---|
| `verified` | 出處是 `tfda`／`usda`／`label`／`official_web`，且 `ref` 有值 |
| `derived` | 出處是 `derived` |
| `label_unsourced` | v1 遺留、看起來來自單一商品包裝但沒留出處。**只准減少不准新增**〔機：對 `data/reference/label_unsourced_frozen.json` 比對〕 |
| `estimate` | 出處是 `estimate`；**多個商品合併的一筆、以品牌/整份菜單為單位的一筆，一律屬於此級** |

- **升級**：查到更高順位出處時，替換數值與出處，commit 訊息用 `data(upgrade): <id> <欄位> → <type>`〔人〕。
- **畫面**：可信度不在畫面上用顏色或警告表示，只決定熱量前面是否加「約」〔人〕。

## B4. 欄位規格

### 食材（`ingredients.json`）

```js
{
  id: "chicken_breast",                // 小寫英文＋底線，全資料庫唯一；Phase −1b 完成時凍結，之後不得改名
  name: "雞胸肉",                       // 有常見歧義時寫清楚（「白花椰菜」「青花菜」分開）
  axis: "protein" | "staple" | "vegetable" | "seasoning" | "method" | "implicit",
  basis: "raw" | "cooked" | "dry" | "as_is",   // 必須跟來源樣品狀態一致
  per_100g: { kcal, protein_g, carb_g, fat_g, fiber_g, sat_fat_g, sodium_mg },
  serving_g: 130,                      // 跟 basis 同一個狀態
  serving_label: "1份雞胸肉（生重約130g，約4份代換表蛋白質）",
  cooked_to_raw: null,                 // basis=cooked 時必填：熟重 1g 對應的生重克數
  prep_tier: "🟢" | "🟡" | "🔴",
  requires_cooking: true,
  allergen_tags: [],                   // 必填，食材不允許 null
  vegan: true | false,                 // 全素
  lacto_ovo: true | false,             // 蛋奶素
  implicit: [],                        // 只有 axis=method：[{ ref: "cooking_oil", g: 5, veg_add_g: 0 }]
  source: { type: "tfda", ref: "I04024", note: null },
  field_sources: {},
  verified_at: "2026-09-28",
}
```

- **營養數值由程式產生，不手抄**：`source.type = tfda` 的食材，`per_100g` 由 `tools/build-ingredients.js` 從 `data/reference/` 的 TFDA 資料產生；檢查程式要求數值跟 TFDA 四捨五入後**完全相等**，不相等就是錯誤〔機〕。
- `axis: "implicit"` 是一餐的隱含成分：`cooking_oil`（TFDA M1100101 大豆油）、`seasoning_light`／`seasoning_normal`（調味程度，用 `per_serving: { sodium_mg }`）。

### 現成品項（`convenience_items.json`、`taiwan_items.json`）

```js
{
  id: "conv_dr01",
  name: "統一陽光 高纖無糖豆漿",
  channel: "convenience" | "delivery",
  vendor: "統一" | null,
  category: "飲品",                     // 食物類型（便當/麵食/沙拉/飲品…），不是時段
  role: "main" | "side" | "snack" | "drink",
  valid_slots: ["breakfast", ...],
  contains_drink: false,
  is_treat: false,
  kcal: 160,
  kcal_basis: "stated" | "midpoint",   // midpoint＝由區間取中點
  kcal_range: null | [低, 高],
  protein_g, carb_g, fat_g, fiber_g, sat_fat_g, sodium_mg,   // 未知寫 null
  allergen_tags: null | [...],         // null＝未確認
  vegan: false, lacto_ovo: false,
  source: { type: "label", ref: "https://..." },
  field_sources: { carb_g: { type: "estimate", ref: "..." } },
  verified_at: "2026-09-28" | null,
}
```

- **推薦池門檻**（保留 v1 語意）：`kcal_basis = "midpoint"` 且高/低 ≥ 1.5 倍的品項不進推薦池，手動選照樣可用〔機〕。

### 分層品項（`food_tree.json`，PRD 13.3）

每一筆：`id`（對得到內建食材的用內建食材 id，其餘 `fx_` 開頭，凍結清單 `data/reference/food_tree_ids_frozen.json`）、`group`（代換表大類）、`subgroup`、`name`（畫面名稱，去掉代換表符號與附註）、`aliases`（代換表原列文字、衛福部俗名、合併重複列保留的名稱）、`exchange`（表號與原列文字）、`serving`（1 份的可食量 `amount` 與 `unit: g|ml`、家用單位、顯示用的熟重或購買量）、`per_serving` 與 `per_100g`（七個營養欄位，tools 預先算好；`per_100g` 給我的料理用）、`tfda_id`（結構化的衛福部整合編號）、`source`（B2，`derived` 寫公式；`derivation`：`equivalent`＝代換表生熟等值推算、`cooked_from_raw`＝共用內建熟食由生樣品推算、其餘 null，decisions #116）、`state`（`raw｜cooked｜dry｜wet｜as_is`）、`sugar`（`added｜none｜null`，只給代換表註明含糖或無糖的）、`allergen_tags`、`vegan`、`lacto_ovo`、`composite`（照 B6.3）、`tags`（例：`高鈣深色蔬菜`）、`note`（明細說明，例：「原料：小麥麩質」）、`builtin`（是否就是內建食材）、`same_sample_products`（同一衛福部樣品的現成品項 uid，由 tools 從現成品項的出處公式推出，給 PRD 13.3 的配對用）。對不到代換表的內建食材也列一筆（`id`、分類、`builtin: true`，1 份＝內建 `serving_g`）。B5.3 的 `cooked_to_raw` 只適用 `ingredients.json`；分層品項的熟重推算寫在 `source` 公式。對應理由、狀態比對與不收清單放在 `data/reference/`〔機：格式〕。

- **檔案**（decisions #101–#111）：代換表轉錄 `data/reference/food_exchange_table.json`、過敏原與素食標註 `data/reference/food_exchange_tags.json`、人工對應表 `data/reference/food_tree_map.json`（374 個代換表品名每個一筆 `item`／`merge`／`exclude`，加上 `builtin_only`；用括號並列的品名以 `split` 拆出；每筆寫理由）、凍結清單 `data/reference/food_tree_ids_frozen.json`（`ids` 與 `retired`，見 B10）。`tools/build-food-tree.js` 產生 `data/food_tree.json`，演算法在 `tools/lib/food-tree-values.js`，check-data 用同一份重算比對。
- **不列在分層**：烹調法、隱含成分、醬料三軸的內建食材（decisions #102）。
- **數值的兩條路徑**（decisions #103）：`fx_` 品項用現成品項同一段換算（`computePer100g`，TFDA 未進位值 × 倍數再進位）；共用內建 id 與 `builtin_only` 用內建已進位的 `per_100g` × 克數再進位（跟 engine 相同）。
- **選樣**：有平均值用平均值；同名樣品沒有平均值時取最新取樣的一筆；只有各月份樣品的取土植樣品裡熱量居中的一筆；品種名對不上的取最常見的品種或平均值——每一筆的選擇理由寫在對應表〔人：抽查審核〕。
- 其他欄位：`home_drink`（「家裡的飲品」，不依單位猜）；`serving.builtin_meal`（`builtin_only` 的 1 份＝內建 `serving_g`）；`serving.display`（「煮熟約 Ng」「購買量約 Ng」）；檔頭 `version`（從參考檔讀）與 `groups`（大類、子類的順序與名稱，本 App 自加的子類標 `app_defined`）。
- `tfda_id` 只有 `builtin_only` 且內建出處是 `usda` 的可以是 null（希臘優格）；這種品項跳過同樣本、狀態、描述關鍵字的檢查〔機〕。
- **資料檔不排序**：`items` 照對應表的順序（代換表原順序）；「組內依名稱排序」是顯示的事，由 engine 以 `Intl.Collator` 排、同名以 id 為次要鍵（decisions #111：不同機器的 ICU 排序不同，資料檔排序會讓 CI 誤報）。

## B5. 數值規則

1. **未知寫 `null`，不寫 0**；0 代表「確定沒有」〔機：格式；計算規則見 C4.5〕。例外：TFDA 值是 null、但實際上接近 0 的（例如油的鈉、蔬菜的飽和脂肪），可以用 `field_sources` 標 `derived` 填 0，並在 `note` 說明理由〔機：填 0 必有說明〕。理由只能是下表四類，條件看衛福部樣品的「食品分類」，不看代換表分組（decisions #107）；加工調理食品類一律不准填〔機：`ingredients.json` 與 `food_tree.json` 都驗〕：

| 理由（`ref`） | 衛福部食品分類 | 只能填 |
|---|---|---|
| 動物性食材 | 肉類、魚貝類、蛋類、乳品類 | `fiber_g` |
| 蔬菜 | 蔬菜類、菇類，且脂肪 ≤ 0.5 g/100g | `sat_fat_g` |
| 水果 | 水果類，且脂肪 ≤ 0.5 g/100g | `sat_fat_g` |
| 油脂 | 油脂類 | `fiber_g`、`sodium_mg` |
2. **熱量非負**；除了 `method` 和調味程度以外的食材熱量必須大於 0〔機〕。
3. **生熟**：`basis` 必須跟來源樣品一致；TFDA 沒有熟樣品時，熟重數值用 `derived` 並寫公式〔機：`cooked` 必有 `cooked_to_raw` 與公式〕。**蔬菜一律用生重**，不做蔬菜的生熟換算〔機〕。
4. **巨量營養素驗算**：出處是 `tfda`／`usda`／`label`／`official_web` 的數字，`蛋白質×4＋(碳水−纖維)×4＋纖維×2＋脂肪×9` 跟熱量差距超過 15% 要在 `note` 說明，否則視為抄錯〔機〕。`derived`／`estimate` 不驗（反推值必然通過）。
5. **份量**：`serving_label` 註明生重或熟重、約幾份代換表份數〔人〕。
6. **用油**（2026-09-28 拍板）〔機：計算斷言〕：
   - 烹調法用 `implicit` 引用 `cooking_oil`：煎 5g、炒 5g＋有蔬菜再加 5g、免開火與微波 0、氣炸與烤 0（實際 0–2g，取下限）。量的出處是 `assumption`，熱量與脂肪用 TFDA M1100101 換算（5g ≈ 44.2 kcal）。
   - 基本資料設定「家裡用油習慣：少／一般」，少＝上列克數減半。**「預設用油」＝依這個設定算出的克數**，推薦卡片、計畫、自己選的預設值都用它。
   - 「自己選」用煎或炒時可以改用油量，選項＝預設用油、約 1 茶匙（5g）、約 2 茶匙（10g）（相同的只列一次）。
   - 用油**不跟主要槽位一起縮放**；實際採用的克數記進這一餐的內容快照。
   - 使用者的「我的料理」（PRD 12.5）：用油是使用者輸入的整份食譜克數（可以是 0），預設 5g × 份數 × 用油習慣，出處 `assumption`；不是「自己選」的一鍵選項，不受上面選項清單限制。
   - 算的是吃進去的油，不是下鍋的油。
   - 推薦熱量的實際變化（主食被縮放吸收多少、哪些組合超出縮放範圍）以 −1b 的 `diff-recs` 差異報告為準，不預先宣稱「上升多少」。
7. **自煮調味的鈉**：`seasoned: true` 的餐型加調味程度：`seasoning_light`（約 300 mg）或 `seasoning_normal`（約 700 mg），出處 `assumption` 並寫明依據。**這一餐已選了醬料軸（照燒醬、泡菜等）時預設清淡，否則預設一般**；「自己選」可切換；記進快照〔機〕。我的料理一律帶調味（每份加、不除以份數），預設比照本條：料理含醬料軸食材時清淡，否則一般（PRD 12.5）。
8. **鈉與飽和脂肪**：食材取 TFDA 欄位；超商取包裝標示；外食沒有出處就寫 `null`，不填沒根據的數字〔機：出處檢查〕。

## B6. 過敏原與飲食限制

1. **過敏原固定詞彙**：`甲殼類｜軟體動物｜魚｜蛋｜乳製品｜花生｜堅果｜麩質｜黃豆｜芝麻｜芒果`，外加 `未確認`〔機〕。花生與堅果分開（台灣法規如此）；軟體動物指蚵、花枝、章魚、貝類；芒果 2026-09-30 加入（台灣過敏原標示規定，decisions #88），名稱或別名含「芒果」的食材、品項與分層品項，`allergen_tags` 必須含「芒果」或「未確認」〔機〕。由大豆製得之高度提煉大豆油依同一規定不必標黃豆（decisions #89）。詞彙擴充不回溯改變使用者既有的「確認不含」〔人：刻意的行為，decisions #88〕。新增詞彙屬於 C3 需審核的變更。
2. **含麩質穀物包含燕麥**（台灣過敏原標示規定）〔機：名稱含「燕麥」的食材與品項，`allergen_tags` 必須含「麩質」或「未確認」；食材與分層品項的衛福部樣品名稱或描述含「燕麥」「麥片」的也一樣（decisions #101：雜糧飯的樣品五穀米含麥片卻標不含）〕。衛福部樣品名稱與描述出現其他過敏原關鍵字、標註卻沒有也沒有未確認的，列為警告〔機〕；**分層品項**（樣品已選定、人工標）描述明寫的過敏原一律要標，「未確認」不能代替，醬油、麵衣算麩質〔機：錯誤；decisions #112〕；大豆油與純大豆提煉的烤酥油是 B6.1 的刻意例外。
3. **複合料理**（外食、餐盒、醬料）沒逐項確認成分的，一律含 `未確認`。品項與醬料要標 `composite: true|false`〔機：`composite: true` 的品項若 `allergen_tags` 不含未確認，必須有 `label`／`official_web` 出處證明是官方成分表，或 `tfda` 出處且該樣品的內容物描述列有完整成分；成分清單裡出現「等」（例：「(醬油,糖等)」）代表沒列完，不算〕。
4. **組合的過敏原**：任一成分 `allergen_tags` 缺欄或含 `未確認`，整組就是未確認〔機〕。
5. **飲食限制**只有 `全素`、`蛋奶素` 兩種人工標註，而且要正面宣告：`vegan: true` 才算全素；全素自動滿足蛋奶素；沒標就是不符合〔機〕。全素＝不含動物性成分，**不判斷五辛**（decisions #91）。
6. **「低碳」「高蛋白」不人工標註**，由數值自動判定〔機〕：
   - 低碳是基本資料裡的**獨立開關**（不放在飲食型態下拉選單，可以跟全素、蛋奶素同時開）。
   - 低碳**只影響推薦，不影響「自己選」**（不是安全問題，不當硬性過濾）。
   - 推薦時：這一餐碳水上限 `LOW_CARB_MEAL_MAX_G`（`core/config.js`，初始 30g）。自組食譜的主要槽位縮放倍數取「熱量需要的倍數」與「碳水 ≤ 上限容許的最大倍數」兩者較小者；壓到 0.5 倍仍超過上限就排除。現成品項組合碳水超過上限就排除。碳水是 null 就不算低碳。
   - 高蛋白：只用於顯示，這一餐蛋白質 ≥ 20g。
7. 有疑義時往保守方向標〔人〕。
8. **飲食限制要跟過敏原一致**〔機〕：`vegan: true` 不得含蛋、乳製品、魚、甲殼類、軟體動物，也不得含 `未確認`（成分沒確認就不能宣告全素）；`lacto_ovo: true` 不得含魚、甲殼類、軟體動物；`lacto_ovo: true` 而過敏原含 `未確認` 的，`note` 要寫「素食依據：」（例：超商素食系列，包裝依法標示素食）。過敏原詞彙沒有畜肉、禽肉，所以另加啟發式檢查：名稱或 `note` 含雞、豬、牛、肉、火腿、培根、魚、蝦又標素的，也要寫「素食依據：」〔機〕；依據內容對不對靠人審〔人〕。
9. **同一個衛福部樣品只有一種標註**：所有指向同一個 `tfda_id` 的內建食材與分層品項（包括分層品項彼此，例：麵條(乾)、麵條(熟)），`allergen_tags`、`vegan`、`lacto_ovo` 必須相同〔機〕。分層品項的標註照本節規則人工標，複合加工品含 `未確認`；沒有標註的一律當未確認（decisions #77）。

## B7. 餐型骨架

1. 每一軸的 `allow` 只能引用存在、且 `axis` 相符的食材 id〔機〕。
2. 每個骨架必填 `seasoned: true|false`〔機〕。
3. 食材沒被任何骨架引用 → 警告〔機〕。
4. 新增或修改骨架屬於 C3 需審核的變更，可以**一批一起審**。
5. 骨架算不到、使用者常會另外加的東西（例：溫沙拉的沙拉醬），寫在選填的 `not_included`（字串陣列）；推薦卡片與自煮合計照它顯示「未含 X」，畫面不得寫死骨架 id〔機：格式〕。

## B8. 「我的品項」最低驗證

寫入前必須通過：名稱非空、`kcal` 為正數、`role` 與 `channel` 合法、有 `allergen_tags` 欄位（表單預設「未確認」＝`null`）；沒填的營養欄位是 `null`〔機：`data/db.js` 寫入驗證〕。它進不進推薦候選池，依 PRD 10.5 的條件判斷，不看本章程的可信度。

**我的食材**（PRD 12.4）：名稱非空；`source` 是 `tfda` 或 `user`；`tfda` 時有 `tfda_id`、`per_100g` 是 `null`、`filled` 只能填衛福部是 null 的欄位（衛福部改版後違反的欄位在更新時先自動清掉），更新時不得修改 `source`、`tfda_id`；`user` 時 `per_100g` 七個欄位齊全，`kcal` 必須是數字且 ≥ 0（跟我的品項要求正數不同：鹽、黑咖啡可以是 0），其餘是 ≥ 0 的數字或 `null`；`filled` 的鍵只能是那七個欄位、值是 ≥ 0 的數字；`state` 合法；`default_g > 0`；有 `allergen_tags` 欄位，只用 B6.1 的詞。驗證函式是不碰資料庫的純函式，衛福部查詢表、catalog、我的食材由呼叫端當參數傳入〔機：`data/db.js` 寫入驗證＋check-engine 斷言〕。

**我的料理**（PRD 12.5）：名稱非空；食材至少 1 項、每項 `grams > 0`、`ref` 存在且是蛋白質／主食／蔬菜／醬料軸的內建食材或我的食材；`oil_g ≥ 0`；`seasoning` 是 `light` 或 `normal`；`servings` 是 ≥ 1 的整數；`role` 與 `valid_slots` 合法；查表由呼叫端當參數傳入〔機：`data/db.js` 寫入驗證〕。

## B9. 資料下架

刪除一個食材或品項時，`meal_plan`、`daily_log` 快照、「我的品項」的 `copied_from`、「我的組合」（`saved_meals`）、「我的料理」（`custom_dishes`）、常吃清單（`settings.favorite_refs`）、不吃清單、單品（`food` 元件）若還指著它（分層品項也算「一個食材」）：紀錄照樣用快照顯示；計畫顯示中性提示「這個品項已不提供」；組合由 `resolveSavedMeal` 歸入「已不提供」並顯示中性提示；料理的任一食材查不到時整道歸「已不提供」、不做部分加總（衛福部查詢檔載入失敗不算查不到，暫停料理相關動作）；常吃與不吃清單略過查不到的 id（「我的食物」的不吃全部清單列「已不提供」可移除）；組合與計畫裡的 `food` 歸「已不提供」；程式不得因為查不到而出錯〔機：check-engine 斷言，含組合引用已刪除 id 時解析不拋錯並回報缺少的元件；傳入「查詢檔載入失敗」時料理不歸已不提供〕。

## B10. 參考資料與 TFDA 改版

- 檢查程式依賴的參考資料放 `data/reference/`（TFDA json、`label_unsourced` 凍結清單），不放 `collab/`〔機〕。TFDA 改版後**舊版參考檔保留不刪**：`tfda_lookup.json` 裡標了已下架的編號要跟它最後出現的那一版比對（B12）。
- TFDA 出新版時：放進新檔 → 重跑 `tools/build-ingredients.js` 與 `data/tfda_lookup.json` 的產生工具 → 列出所有數值差異與消失的編號（查詢檔保留消失的編號並標已下架，使用者的我的食材不會失去數值，PRD 12.2）→ 重新產生 `data/food_tree.json`（對應的編號消失時，那一筆分層品項照 B9 下架，id 從 `ids` 移到 `retired`（附日期與理由），不重用；對應表把某一筆改成 `exclude` 或 `merge` 時也一樣〔機：`retired` 的 id 不得出現在 `food_tree.json`、兩份清單不重疊〕）→ 逐項確認後提交，commit 訊息 `data(tfda): 升級到 <版本>`〔人〕。

## B11. 修改資料的流程

1. 依 B2 查出處。
2. 依 B4 修改；TFDA 食材改 `source.ref` 後重跑 `tools/build-ingredients.js`，不手改數值。
3. `node tools/check-data.js`、`node tools/check-engine.js` 全過。
4. `node tools/diff-recs.js` 產生推薦快照差異；一次改超過 10 筆、或差異報告顯示推薦熱量系統性變動時，把差異報告附在 commit 說明〔機：CI 會輸出差異〕。
5. commit 訊息格式：`data(add|fix|upgrade|remove): <id> <摘要>（出處 <type> <ref>）`。git log 就是資料變更紀錄，不另外維護 CHANGELOG。

## B12. `tools/check-data.js` 檢查項目

**錯誤**：格式與必填欄位、列舉值、id 唯一；熱量非負（B5.2）；null 規則；TFDA 食材數值與參考資料完全相等；`tfda_lookup.json` 逐筆與參考資料算出來的值完全相等（現行編號比對最新版；標了已下架的編號比對它最後出現的那一版，B10）；出處順位（B2.1、B2.2）；`label_unsourced` 凍結清單只減不增；`cooked` 有 `cooked_to_raw` 與公式；蔬菜為 `raw`；烹調法有 `implicit`；骨架有 `seasoned`、`allow` 引用正確；過敏原詞彙、複合料理未確認規則（B6.3）、飲食限制與過敏原一致（B6.8）；巨量營養素驗算（B5.4）；`kcal_range` 低 ≤ 代表值 ≤ 高。**分層品項**（`food_tree.json`）：對應表 374 個代換表品名齊全不重複、`merge` 的目標是 `item`、被併入者標註相同、`exclude` 有理由；`data/food_tree.json` 等於工具重算的結果（逐筆逐欄、含順序）；`tfda_id` 存在（B4 的 USDA 例外）；樣品狀態：在衛福部「樣品狀態」去掉括號內的成分清單後找關鍵字（濕→wet；熟→cooked；乾貨、果乾、乾麵條→dry；生、未烹調→raw；冷凍包裝、包裝產品、罐頭、瓶裝、糖漬、醃漬、鹽漬→as_is；生熟乾濕優先於包裝型態；有樣品狀態但沒有關鍵字的水果、蔬菜、菇類→raw；生熟等值推算的品項不比），推得出時跟對應表記的狀態一致，推不出的對應表要有理由欄〔機：理由非空；理由對不對〔人〕〕；共用內建 id 的狀態等於內建 `basis`；含糖：`sugar: none` 的樣品描述不得有加糖字眼、`sugar: added` 的必須有；缺值填 0 照 B5.1 白名單；1 份熱量超出代換表名目熱量（含附註的碳水、脂肪）0.6–1.6 倍的，對應表要有 `nominal_reason`；主要營養素（豆魚蛋肉的蛋白質 7g、全穀雜糧與水果的碳水 15g 加附註、油脂的脂肪 5g）超出 0.6–1.6 倍的也一樣（decisions #112）；果乾標 `sugar: none` 要衛福部樣品寫「無加糖」「無糖」（decisions #109、#112）；1 份與每 100g 的營養跟參考資料算出來的完全相等（兩條路徑見 B4）；`fx_` id 格式 `^fx_[a-z0-9_]+$`、凍結、`retired` 不重用（B10）；烹調法、隱含成分、醬料的 id 不得出現在分層；唯一性：分層 id 不等於任何 catalog uid、`fx_` id 不等於任何內建食材 id、分層 id 等於內建食材 id 時必須 `builtin: true` 且只出現一次、分層 id 不用 `custom_`／`cdish_`／`cing_`／`saved_` 前綴；B6.2、B6.3、B6.8、B6.9 與芒果規則（B6.1）照常適用；沒有重複品項（同一個 `tfda_id` 加同一個可食克數，或同一大類下同一個畫面名稱）；`same_sample_products` 跟現成品項的出處公式一致；decisions #35 引用的代換表數字在轉錄檔裡仍成立。

**警告**：食材沒被骨架引用；列出所有 `label_unsourced`、`estimate` 欄位（查證優先順序用）；衛福部樣品描述的過敏原關鍵字跟標註對不上（B6.2）。

---

# C. 架構章程

## C1. 分層與依賴方向

```
ui/  →  engine/  →  core/
ui/  →  data/    →  core/
```
1. `engine/` 是純函式：只能 import `core/` 和 `engine/`，**不得 import `data/`**；需要的資料由 `ui/` 讀好傳入〔機：`tools/check-arch.js`〕。**engine 不得自己讀時鐘**：今天日期與現在時間一律由呼叫端當參數傳入〔機：check-arch 禁止 `engine/` 出現 `Date.now` 與無參數的 `new Date()`〕。
2. `data/` 不 import `engine/`；`core/` 不 import 任何東西〔機〕。
3. 全部使用 ES modules，不把函式掛到 `window`；唯一例外是 `ui/app.js` 掛少數除錯函式〔機〕。
4. 儲存層使用瀏覽器原生 IndexedDB 加一層薄的封裝（`data/db.js`），不使用 localforage；資料庫名稱 `lighten2`，`settings` 與任何 localStorage key 一律加 `lighten2.` 前綴〔機〕。
5. 清單型資料（`daily_log`、`meal_plan`、`weight_log`、`exercise_log`、`custom_foods`、`saved_meals`、`custom_ingredients`、`custom_dishes`）一筆紀錄一個 key，需要全有全無的批次寫入用 IndexedDB transaction〔機：check-engine 對 db.js 的寫入函式斷言「傳入陣列會報錯」；〔人〕：審查 db.js〕。
6. 部署時用一個版本字串統一帶進所有模組（import map），不靠使用者手動重新整理〔機：本次提交改到 `js/`、`css/`、`data/` 而 import map 的版本字串沒變就失敗〕。本機開發要用本機 server 開，不能用 `file://`。

## C2. 單一真相來源

下列概念只能在一個地方定義，其他地方一律 import〔機：check-arch 檢查重複的函式名與常數名，常見名稱（`render`、`init` 等）列白名單〕：

| 概念 | 位置 |
|---|---|
| 時段清單、中文標籤、預設權重、預設開關、時段結束時間 | `core/slots.js` |
| 型態列舉、門檻常數（低碳、低預算等）、日期工具、escape | `core/` |
| 食物資料的載入、驗證、正規化、可信度推導 | `data/catalog.js` |
| IndexedDB 存取 | `data/db.js` |
| 過敏原／飲食限制／不吃清單判斷 | `engine/filters.js` |
| 一餐內容的營養計算（含用油、調味、縮放、null 傳染）、驗證、快照 | `engine/meal-content.js` |
| 代換表分層品項的 1 份營養（預先算好，前端不換算） | `tools/` 產生 `data/food_tree.json`；`data/catalog.js` 載入、正規化 `diet_tags` |

「不吃清單」「倒讚紀錄」一律以 id 為 key，不用名稱〔機：check-engine 斷言——把食材改名後，不吃清單仍然命中〕。

## C3. 需要獨立審核的變更

動工前找一個**新開的 Opus agent**（不是正在實作的那一個）審核，完整問答逐字存到 `collab/opus-review-log/YYYY-MM-DD-主題.md`〔人〕：

- A1 列的概念變更（PRD 改完後、動程式前審）。
- 修改 C4 任何一條規則，或推薦評分、預算分配、體重校正的演算法。
- 新增 IndexedDB store 或改變已存在 store 的格式——**照已定案的 PRD 實作的不必再審**，偏離 PRD 才審。
- 新增或修改餐型骨架（可一批一起審）。
- 新增過敏原或飲食限制詞彙、新增外部函式庫（CDN）。
- 修改本章程。

不需要獨立審核：有出處的資料數值修正、純 UI 文案與版面、依 C5 流程修 bug 且不改變 C4 規則、補測試。

## C4. 不可退化的規則

**安全**
1. 硬性過濾「未確認就排除」：過敏原未確認、飲食標註缺漏，只要使用者有設定就排除；**自訂食物沒有例外**〔機〕。
2. 飲食限制逐成分判斷，不用聯集〔機〕。
3. 免開火不得搭配需要煮熟的食材，存檔與顯示時各檢查一次；只檢查餐型骨架的 `ingredient` 元件（`dish`、`food` 不宣告烹調方式，PRD 6.3）〔機：engine 斷言；〔人〕：畫面兩處都有呼叫〕。
4. 計畫內容在顯示時重新跑硬性過濾，被擋下顯示中性提示，不默默刪除〔機＋人〕。

**計算**
5. 缺資料是 `null`，加總時 null 傳染，不當 0〔機〕。**例外：鈉與飽和脂肪**只用於顯示、不參與任何計算，加總時「有資料的部分照加，另外記下有幾項沒有資料」，畫面顯示「鈉 約 X mg（部分品項無資料）」〔機〕。
6. 自組食譜：不對稱槽位、每個食材自己的 `serving_g`、只有主要槽位縮放且限 0.5–2.0 倍；用油與調味不縮放；`dish`、`food` 元件不參與縮放〔機〕。
7. **推薦生成規則**：一餐恰好 1 main＋≤1 side＋≤1 drink＋≤1 snack、最多 3 件；下午茶不需要 main；飲料不單獨成一餐〔機〕。
8. **手動記錄規則**比推薦寬：只限制每個角色的數量上限，不要求必須有主餐（一杯拿鐵可以記成一餐），也不套用低碳〔機〕。單品（`food` 元件）另有上限（一餐最多 `FOOD_MAX_PER_MEAL`＝4 項，`core/config.js`），不佔角色名額、不套 `valid_slots`，只有單品也可以成為一餐（PRD 13.4）〔機：`manualSelectionProblem` 在第 5 項單品時回傳原因、只有單品時回傳 null〕。
9. 近 7 天平均、纖維缺口、校正引擎的攝取檢查，只算完整記錄日且不含今天〔機〕。
10. 計畫層不存縮放後的熱量；只有 `daily_log` 算進任何統計〔機〕。
11. 自煮一律包含用油與調味兩個隱含成分（我的料理的用油與調味已含在 `dish` 元件的快照裡，那一餐的 `implicit` 記 0 與 null，PRD 12.5；只有單品的自煮一餐同樣記 0 與 null，單品快照不含烹調用油，PRD 13.4），推薦、自己選、計畫、採買清單都走 `engine/meal-content.js`〔機：check-engine 斷言隱含成分；check-arch 禁止 `ui/` 出現營養加總寫法（`kcal +=`、`protein_g +` 等；啟發式檢查，不是完整證明）；`data/db.js` 寫入驗證自煮紀錄必有 `implicit`〕。

**核心原則**
12. 運動與飲食脫鉤：讀取運動紀錄的函式（包括整批匯出）只允許出現在 `ui/tab-exercise.js`、`data/db.js` 與負責備份匯出匯入的檔案〔機：check-arch grep〕；備份畫面只顯示筆數與日期，不顯示、不加總運動內容〔人〕；飲食畫面不出現運動內容，反之亦然〔人〕。
13. 不評判：不顯示遵循率、「偏離計畫」、「未完成」、連續達成天數；不依型態做頻率統計配評價文字；商品不依熱量排序或上色；飲料不做糖量警告〔機：check-arch 對 `ui/` 做禁用字 grep；〔人〕：配色與排序〕。
14. 鈉只中性顯示「鈉 約 X mg（參考 2400 mg）」：不上色、不警告、不做頻率統計、不參與推薦評分、不跟某天體重連在一起提示；用油選項只寫克數或茶匙〔機：顯示欄位（鈉、飽和脂肪）只在 `engine/meal-content.js` 處理，其他 engine 模組只能把 `displayFields(...)` 原封併進輸出物件；啟發式檢查；〔人〕：畫面〕。
15. `picker_last_meal_type` 只有「自己選」modal 能讀，推薦、統計、hero 不得讀取〔機：check-arch grep——這個 key 只允許出現在 `data/db.js` 與「自己選」modal 的檔案〕。
16. 「我的組合」（`saved_meals`）只供手動引用，推薦、統計、hero 不得讀取〔機：check-arch——`data/db.js` 的讀取函式 `listSavedMeals`、`getSavedMeal`（以及之後任何會回傳 `saved_meals` 內容的函式，包括整批匯出）只允許白名單檔案 import；白名單寫在 `tools/check-arch.js` 的設定裡，只能加入負責「選擇器、組合管理區、餐點日曆、食物資料頁（「我的食物」主分頁）、備份匯出匯入」這五類職責的檔案，檔名調整不算修改本章程；寫入函式不限〕。每次引用都經過 `engine/meal-content.js` 的 `resolveSavedMeal`（元件級的硬性過濾、依目前骨架重新驗證含免開火與軸上限、下架與隱藏處理）〔機：check-engine 對 `resolveSavedMeal` 斷言；〔人〕：ui 引用時都呼叫它〕。
17. 「我的食材」「我的料理」（`custom_ingredients`、`custom_dishes`）只供手動使用，推薦、統計、hero 不得讀取內容；推薦不產生 `food` 元件、不依 `food` 的 `ref` 做任何判斷，預算與統計只經由 `totals`，或用「不是 `ingredient` 就用快照」的泛用寫法加總（不寫字面量 `"food"`）；常吃清單（`settings.favorite_refs`）只能用來排序與推薦加分〔機：check-arch——① `data/db.js` 裡凡是會回傳這兩個 store 內容的函式（包括整批匯出）都列進讀取函式清單，只允許白名單檔案 import，白名單寫在 `tools/check-arch.js`，只能加入負責「選擇器、料理編輯器、食物資料頁（「我的食物」主分頁）、組合管理區、餐點日曆、計畫顯示模組、備份匯出匯入」的檔案，`js/ui/tab-today.js`、`js/ui/today-hero.js` 與 `engine/` 一律不得 import；② 常吃清單只能用 `data/db.js` 的 `getFavoriteRefs`／`setFavoriteRefs` 讀寫，`favorite_refs` 字串只准出現在 `data/db.js`；`getFavoriteRefs` 只准選擇器、料理編輯器、「我的食物」與 `js/ui/tab-today.js` import（備份走 `exportAllData`，由 ① 管）；engine 的參數名 `favoriteRefs` 只准出現在 `engine/picker.js`（只做排序與分組）、`engine/today.js`（原封傳遞）、`engine/recommend.js`（只在 `getTodayRecommendation` 取出參數、呼叫 `score(...)` 與 `score` 函式本體內，只准加分，不得用於過濾、產生候選或另外排序；check-arch 以函式起訖行判斷，屬啟發式檢查，取別名可繞過，比照 C4.11、C4.14）；③ 啟發式輔助：`engine/pool.js`、`recommend.js`、`today.js`、`matcher.js` 的原始碼（不去掉字串）不得出現字面量 `"dish"`、`"food"`，也不得出現識別字 `foodTree`（分層資料掛在 `catalog.foodTree`，推薦候選池不讀）〕（PRD 12.1、12.5、12.7、13.4、13.6；decisions #81、#82、#92）。

## C5. 修 bug 的規則

1. **先寫一條會失敗的斷言**（check-engine、check-data 或 check-arch），確認它失敗，再修程式讓它通過，同一個 commit 提交〔人：審 commit；〔機〕：CI 保證斷言之後不會再退化〕。
2. 畫面層的 bug 測不到時，把重現步驟加進 `docs/手機實機腳本.md`，能自動化的同時加進 `tools/mobile-walkthrough.mjs`〔人〕。
3. 同一類 bug 第二次出現，代表 C2 的單一真相來源沒守住，要找出重複的那份並合併，不是再補一次〔人〕。

## C6. 提交前的驗收

1. **本機 pre-commit hook** 跑 `check-data`、`check-engine`、`check-arch`、`diff-recs`，不通過就不能提交〔機〕。hook 放在 repo 的 `tools/hooks/`，clone 後執行一次 `git config core.hooksPath tools/hooks` 啟用（交辦給 Cline 時寫明）。hook 總時間超過約 30 秒時，hook 只跑較快的檢查，完整版交給 CI，避免有人用 `--no-verify` 跳過；禁止使用 `--no-verify`〔人〕。
2. **GitHub Actions** 每次 push 再跑一次同樣的檢查，當第二道防線。CI 紅燈時，**下一個 commit 必須是修復**，修好前不做其他改動〔人〕。
3. **`diff-recs` 的通過條件**：repo 裡有一份「預期推薦快照」（`tools/snapshots/`）；實際輸出跟它不同就失敗。刻意改變推薦結果時（例如 −1b 的修正），同一個 commit 更新快照檔，快照檔的差異就是給人看的差異報告〔機〕。
4. 快照在 engine 介面層錄製：輸入是固定的 profile、各餐紀錄合計、倒讚紀錄與**固定的日期時間**；比對規範化後的輸出（選中的組合 id、四捨五入後的營養值、縮放倍數），不比整包 JSON。推薦與體重校正都要有快照〔機〕。
5. 動到畫面流程時、每個 Phase 驗收時，實作者先跑 `node tools/mobile-walkthrough.mjs`（模擬手機照腳本操作＋截圖），**逐張看過截圖**、修好問題，再請使用者用手機跑腳本開頭的「使用者短清單」（只含自動測不到的：真的手機快取、手感、看不看得懂）〔機＋人〕。
6. 改到行為時，同一個 commit 更新 `docs/PRD.md` 對應章節〔人〕。

## C7. 文件位置

| 文件 | 位置 |
|---|---|
| PRD（權威規格） | `docs/PRD.md` |
| 決策紀錄 | `docs/decisions.md` |
| 章程 | `docs/CHARTER.md`（本檔） |
| Review 報告 | `docs/review/` |
| 手機實機腳本 | `docs/手機實機腳本.md` |
| 獨立審核逐字紀錄 | `collab/opus-review-log/` |
| 參考資料 | `data/reference/` |
| v1 舊文件 | `docs/v1/` |
