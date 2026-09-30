# 官方飲食 PDF 轉錄檔說明

本目錄存放 `collab/to-sonnet.md` 交辦的官方飲食 PDF 全文轉錄結果。**目前完成第 1、2、3、4、5、6 份，其餘 2 份尚未進行**，會在後續 commit 補上，屆時會更新這份 README。

## 已完成

| 檔案 | 對應 PDF | 頁數 | 說明 |
|---|---|---|---|
| `food_exchange_table.json` | `collab/食物代換表.pdf` | 全 12 頁 | 附-1～附-7 全部逐列轉錄，339 筆 `items`，另有 `unit_conversion`／`exchange_units`／`footnotes` |
| `daily_food_guide.json` + `.md` | `collab/pdf/每日飲食指南手冊.pdf` | 全 29 頁 | 表一～表四、六大類代換份量、三大營養素比例轉JSON；內文（序、前言、六大類食物簡介）轉md |
| `vegetarian_food_guide.json` + `.md` | `collab/pdf/素食飲食指南手冊.pdf` | 全 19 頁 | 純素/蛋素/奶素/奶蛋素四種類型的六大類份數表、豆(蛋)類與乳品類代換份量轉JSON；內文（前言、七大類食物簡介）轉md |
| `my_plate.json` + `.md` | `collab/pdf/我的餐盤手冊（全穀及未精製雜糧）v2.pdf` | 全 37 頁 | 手測量份量表、六句口訣、中式/西式/素食三種型式各三餐範例、六大類小訣竅轉JSON；內文（前言、設計理念、聰明吃）轉md |
| `senior_recipes.json` | `collab/pdf/22016.pdf`（高齡營養健康食譜） | 全 16 頁 | 12個月份食譜，各含食材／調味料／作法／推薦理由／每份熱量／我的餐盤六大類份數換算 |
| `recipes_1600_1800.json` | `collab/pdf/1600_1800_kcal_healthy_recipes.pdf` | 全 2 頁 | ⚠️來源PDF本身數字全缺（見下方說明），只轉錄了存在的文字骨架 |

### `food_exchange_table.json` 結構

- `unit_conversion`：附-1 稱量換算表，10 筆。
- `exchange_units`：附-1～附-7 各組（乳品類、豆魚蛋肉類低/中/高脂、全穀雜糧類、蔬菜類、水果類、油脂與堅果類）每份蛋白質／脂肪／醣類／熱量摘要，共 22 筆（附-1 一次列出全部 10 組，附-2～附-7 各自的標題列各補一筆方便查表）。
- `items`：逐列品項，339 筆，各表筆數：
  - 附-2 乳品類：11
  - 附-3-1 豆魚蛋肉類（低脂）：41
  - 附-3-2 豆魚蛋肉類（中脂）：30
  - 附-3-3 豆魚蛋肉類（高脂／超高脂）：16
  - 附-4 全穀雜糧類：64
  - 附-5 蔬菜類：79
  - 附-6 水果類：66（含水果與果乾兩子類）
  - 附-7 油脂與堅果類：32
- `footnotes`：各表的（註）逐字抄錄，含符號說明。

### 已知缺漏／不確定的格子

詳列在 `collab/from-sonnet.md`，重點摘要：

1. **附-3-2 頁 5 的「◎◎ 每份膽固醇含量 ≧ 100 毫」**：PDF 文字抽取在頁尾被截斷（缺「公克」二字），已依附-3-1／附-3-3 同一句補回，標記 `row_note`。
2. **附-4「＊ 米粉(濕)」**：可食重量原文為「30~50」範圍值，未挑單一數字，`raw_g` 留 `null`，範圍記在 `row_note`。
3. **附-3-1「無糖豆漿」／附-2 多個乳製品**：原表單位是「毫升」而非「公克」，`raw_g`/`edible_g` 留 `null`，數值放在 `extra.volume_ml`。
4. **附-4 footnote 提到「蒟蒻0.1」蛋白質含量，但「其他澱粉製品」欄實際沒有蒟蒻這一列**——原文本身的缺漏，未替它補列。
5. **附-6「椰棗」重複**：「其他」子類與「果乾類」子類都各列一筆「椰棗」20公克，原文如此，非轉錄錯誤。
6. **附-5「青江菜」出現兩次**：一次無標記（第9列第3欄）、一次有＊（第16列第3欄），原文如此。
7. **附-5「（番薯葉）」自成一列**：緊接在「＊地瓜葉」下一列的同一欄位，疑似原文排版把地瓜葉的別名拆成獨立一格，但版面上確實是獨立的儲存格，故照樣轉錄為獨立品項，未合併。

跟舊檔 `data/reference/food_exchange_table.json` 的比對結果也在 `collab/from-sonnet.md`。

### `daily_food_guide.json` / `.md` 結構

- JSON：`macro_nutrient_ratio`（三大營養素比例）、`portion_basis`（六類份量基準）、`healthy_weight_table`（表一，46列）、`activity_strength_table`（表二）、`calorie_needs_table`（表三）、`serving_recommendations`（表四）、`serving_definitions`（六大類代換份量／一份的定義）、`group_serving_by_kcal_detail`（各食物章節內文附的熱量對照，含比表四更詳細的文字備註）。
- md：序、前言（均衡飲食意義／規劃原則／變更概述）、如何使用指南（表一～表四的文字說明）、六大類食物簡介（全穀雜糧、豆魚蛋肉、乳品、蔬菜、水果、油脂與堅果種子的營養功能與食物簡介全文）、版權頁。

### `vegetarian_food_guide.json` / `.md` 結構

- JSON：`vegetarian_types`（五種素食分類定義）、`macro_nutrient_ratio`、`calorie_needs_table`、`food_classification_table`（食物分類主/次要營養成分）、`exchange_units`（豆(蛋)類單一級距，不像每日飲食指南分低/中/高脂）、`portion_basis`、`serving_recommendations_by_type`（純素/蛋素/奶素/奶蛋素四張表）、`serving_definitions`（七類代換份量，豆類/蛋類/乳品類為素食特有）。
- md：前言（素食分類定義）、均衡飲食意義、份量說明、如何選擇我的素食、七大類食物簡介全文、版權頁。生活活動強度表與每日飲食指南手冊相同，未重複轉錄。

### `my_plate.json` / `.md` 結構

- JSON：`six_slogans`（六句口訣）、`hand_measure_portions`（手測量份量表）、`daily_cooking_oil`、`design_rationale`（方型餐盤與六格排列的設計理由）、`meal_examples`（中式/西式/素食×早午晚，共9份範例，含菜色描述與涉及的食物分類）、`vegetarian_smart_eating_tips`、`food_group_tips`（六大類各自的簡介與小訣竅）。
- md：前言、「你的一日三餐都吃些什麼呢」、「從每日飲食指南到我的餐盤」、設計理念、一次看懂我的餐盤、聰明吃、版權頁。

### `senior_recipes.json` 結構

- `recipes`：12筆（1~12月各一道），每筆含 `month`、`name`、`servings`、`ingredients`（含 `amount_text` 原文與可解析的 `g` 公克數）、`seasonings`、`steps`、`recommendation_reasons`、`nutrition_per_serving.kcal`、`daily_kcal_reference`（固定1700大卡，高齡者每日飲食建議量基準）、`my_plate_servings_per_serving`（該食譜一人份對應「我的餐盤」六大類的份數，原文以圖示+數字表示，`None`代表原圖示是「—」）、`page`。
- 封面主題：「吃的下、吃的夠、吃的對、吃的巧」（高齡營養三好一巧）。

### `recipes_1600_1800.json` 結構 —— ⚠️ 來源 PDF 本身有缺陷

**這份 PDF 不是完整的官方文件**：全部數字（份量、克數、根數、熱量級距）在文字層與圖片裡都是空白，連標題本身的「1600」「1800」兩個熱量數字都不存在，懷疑是樣板檔案的變數欄位沒被正確填入就匯出。已逐字轉錄實際存在的文字，缺數字處一律 `null`，沒有用猜測或其他食譜的數字去填補。詳見 `collab/from-sonnet.md` #6 一節。

## 待完成

| # | 來源 | 頁數 | 輸出 |
|---|---|---|---|
| 7 | `collab/pdf/國民飲食指標手冊.pdf` | 20 | `national_dietary_indicators.md` |
| 8 | `collab/pdf/20241024102714_90531.pdf` | 66 | `90531.md` |
