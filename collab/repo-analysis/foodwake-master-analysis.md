# foodwake-master 分析報告

## 0. 摘要卡

| 項目 | 值 |
|---|---|
| 專案定位 | 用 Scrapy 爬取 foodwake.com（中國「食物營養成分與科學食療方案」網站）逐一食材頁面的營養成分，寫入 MySQL/JSON |
| 專案類型 | 資料來源型 |
| 技術棧 | Python 3.4 + Scrapy + pymysql/twisted adbapi（MySQL），無前端、無 App 邏輯 |
| 對 Lighten2 的價值等級 | **中**（有具體資料快照可查證，但欄位單位、命名地區、資料完整度都跟我們現有資料庫落差大，需要大量清洗才能用；程式碼本身跟 Lighten2 架構無關） |
| 最大亮點 | repo 裡直接夾帶已爬妥的資料快照（`data.json` 1085 行、`new_data.json` 558 行，去重後約 1179 筆食材），不是只有空的爬蟲骨架，可以立刻查驗欄位長相 |
| 最大缺口/風險 | 54 個微量營養素欄位裡近 4 成是「有單位無數值」的空欄（`"蛋白質": "克"`），且資料來源網站的著作權/使用條款未見任何說明，直接引用有法律風險；中國食材命名與台灣慣用語/在地食材（例如台式超商品項、醬料）幾乎不重疊 |

## 1. 架構總覽

```
輸入：foodwake.com 食材分類頁 (http://www.foodwake.com/category/food-class/0)
  ↓ Scrapy Spider (spiders/foodwake.py)
    parse()          → 走訪分類頁，取得各食材連結
    parse_item()      → 走訪食材子分類/列表頁，取得個別食材頁連結
    parse_item_info() → 對每個食材頁抓取 name/nickname/info（三欄表格逐列解析成 dict）
  ↓ Item (items.py: FoodwakespiderItem { name, nickname, info, url })
  ↓ Pipeline (pipelines.py)
    FoodwakespiderPipeline → 寫成 data.json（一行一筆 JSON）
    DbScrapyPipeline       → INSERT INTO foodwake (name, nickname, info, url) 到 MySQL
輸出：MySQL 表 foodwake（單表，無正規化） 或 JSON Lines 檔案
```

沒有任何 App 層、API 層、推薦邏輯、UI；純粹是「網頁 → 結構化 JSON/DB 一行紀錄」的單向管線，跟 Lighten2 的三層資料模型、型態選擇器、採買清單完全無對應關係。第 1 節必查項（本地優先/雲端同步、份量縮放、AI辨識、推薦篩選、採購清單）在本專案**全部不適用**——它不是產品，是資料採集腳本。

## 2. 資料模型（跟我們對照）

`foodwakeSpider/foodwakeSpider/items.py`（`FoodwakespiderItem`）只有 4 個欄位：

| foodwake 欄位 | 說明 | 對照 Lighten2 |
|---|---|---|
| `name` | 食材名稱（簡體中文，如「蔓越莓（熟）」） | 對照 `raw_ingredients.json` / `taiwan_items.json` 的 `name` |
| `nickname` | USDA 式英文學名的中譯別名（如「豆类，蔓越莓（罗马），成熟的种子，熟，煮，加盐（U）」），常見值為「无」 | 我們沒有對應欄位，也不需要 |
| `info` | 陣列，每個元素是 `{營養素名稱: "數值+單位"}`，共 54 種營養素鍵 | 對照 `raw_ingredients.json` 的 `kcal_100g/protein_100g/carb_100g/fat_100g/fiber_100g`，但 foodwake 把「單位」跟「數值」黏在同一個字串裡（`"136千卡"`、`"9.34克"`），沒有分離的數值型欄位，也沒有明確標示每 100 克為基準（僅可從網站慣例推測，程式碼本身未寫死此假設，屬**未確認**） |
| `url` | 食材頁來源網址 | 我們現有 7 個資料檔皆無來源 URL 欄位（`v1-legacy` 遺留下來的資料都是內部估算＋手動 note，例如 `taiwan_items.json` 裡的「依食物代換表份量概念＋熱量平衡反推估算」），這點 foodwake 比我們嚴謹（至少可追溯來源頁面），但來源網站本身的原始出處未标示（是否轉載自 USDA FoodData Central 等公開資料庫，程式碼與 README 均未說明，**未確認**） |

沒有 schema 定義檔（無 ORM model、無 SQL DDL 檔案），MySQL 表結構是在 `pipelines.py:68` 的 SQL 字串裡隱含推斷：`foodwake (name, nickname, info, url)`，`info` 欄位存的是整個列表的字串化結果（`str(infoList)`，`spiders/foodwake.py:51`），不是正規化的多欄位表——這代表資料庫裡 `info` 是一個大字串，還要二次解析才能用，不是開箱即用的結構化欄位。

## 3. 核心邏輯（依錨點深挖，簡短帶過）

因為是資料來源型專案，核心邏輯只需點出「怎麼爬到、怎麼防擋」：

- `spiders/foodwake.py:13-21`：兩層分類頁遍歷（`parse` → `parse_item`），逐層 `yield scrapy.Request` 追蹤連結，沒有分頁邏輯、沒有去重機制（靠 Scrapy 內建的 URL 去重）。
- `spiders/foodwake.py:34-47`：核心解析邏輯——對每個食材頁的 `<table class="table table-hover">` 逐 `<tr>` 取 3 個 `<td>`（營養素名稱、單位、數值），用 `try/except` 吞掉取不到值的例外（`td_value = td_unit`，此時該筆的值其實只有單位、沒有數字），這正是造成前述「54 個微量營養素裡近 4 成是空值」的原因。
- `middlewares.py:13-18` + `user_agent.py`：隨機 User-Agent 輪換防封鎖；`spiders/foodwake.py:54` 每爬一筆隨機睡 1–15 秒；`settings.py:21` 有開 `ROBOTSTXT_OBEY = True`（遵守 robots.txt，這點值得注意，見第 6 節）。
- 無重試、無斷點續爬、無增量更新機制；`data.json`/`new_data.json` 是兩次分開執行留下的部分快照（前者 1085 行、後者 558 行，去重後名稱重疊 324 筆，代表這是同一次爬蟲工作分批跑出的不完整資料，並非全站完整覆蓋）。

以上跟 Lighten2 的份量縮放/推薦篩選/採購清單邏輯完全無交集，此節不需深挖。

## 4. 資料可用性評估

**實測方式**：直接開啟並解析 `foodwakeSpider/foodwakeSpider/data.json`（1085 行）與 `new_data.json`（558 行），而非只讀 README。

- **筆數**：`data.json` 981 筆去重食材名稱，`new_data.json` 522 筆，兩者合併去重約 **1179 筆不重複食材名稱**。這是實際爬到的資料快照，不是空殼——README 宣稱的格式與實際檔案內容一致。
- **欄位/單位**：每筆食材的 `info` 陣列統計出 **54 種不同營養素鍵**，涵蓋：
  - 巨量營養素：能量、蛋白質、脂肪、碳水化合物、粗纖維
  - 脂肪細分：單/多不飽和脂肪酸、反式脂肪酸及其占比、膽固醇、植物固醇
  - 礦物質：鈣、鎂、鈉、鉀、磷、硫、氯、鐵、碘、鋅、硒、銅、錳、氟
  - 維生素：A、C、D、E、K、P（類黄酮）、B1、B2、B3、B4（膽鹼）、B5、B6、B7、B9（葉酸）、B12、B14（甜菜鹼）
  - 胺基酸：亮氨酸、蛋氨酸、蘇氨酸、賴氨酸、色氨酸、纈氨酸、組氨酸、異亮氨酸、苯丙氨酸
  - 色素類：胡蘿蔔素、葉黃素類、番茄紅素

  **確認第 1 點：是的，foodwake 的營養素欄位涵蓋度遠比我們現有資料庫完整。** 我們目前 7 份資料檔（`D:\ok\lighten\data\*.json`）逐一檢查後，欄位最多的是 `raw_ingredients.json`／`protein_sources.json`／`taiwan_items.json`，共通核心只有 `kcal_100g` / `protein_100g` / `carb_100g` / `fat_100g` / `fiber_100g`（或無 `_100g` 後綴的等價欄位），另外有 `allergen_tags`、`diet_tags`、`prep_tier`、`requires_cooking`、`nutrient_basis`、`serving_g`、`valid_slots`、`item_class` 等**工程用途欄位**（供 `recommend.js` 之類的邏輯判斷用），但**完全沒有任何維生素/礦物質/胺基酸欄位**。foodwake 有的 49 個微量營養素欄位（54 減掉 5 個巨量營養素），我們一個都沒有。

  但單位不是每格都乾淨的數值：對 `data.json` 1085 筆的 58,590 個欄位槽位做正則檢查（是否含數字），**填值率僅 62.3%**，其餘約 37.7% 是「只有單位字串、沒有數字」的空欄（例如範例中的 `{"脂肪": "克"}`），代表微量元素部分覆蓋率並不完整，不能假設「有這個鍵就等於有這個數值」。

- **授權/來源合法性**：`LICENSE` 是 Apache 2.0，**只授權這份爬蟲程式碼本身**（Source/Object Work 是這個 repo 的程式碼），不授權 foodwake.com 網站的營養資料內容——Apache 授權方（`guyongjie`，見 `00.txt` 的 GitHub 來源）並非該網站資料的著作權人。網站本身的使用條款/資料授權，repo 內**未見任何說明**（無 robots.txt 抓取記錄、無資料來源聲明、無「資料引用自 USDA」之類的免責聲明）。`settings.py:21` 雖然設了 `ROBOTSTXT_OBEY = True`，但這只代表「有沒有守 robots.txt 規則」，不等於「網站條款允許重製/再散布其資料庫內容」。**結論：不能直接把 `data.json`/`new_data.json` 的內容當作可自由使用的資料源匯入 Lighten2**，若要用，需要先自行查證 foodwake.com 目前（2026年）的使用條款，或改為向已知授權清楚的公開資料庫（如台灣衛福部「食品營養成分資料庫」、USDA FoodData Central）取數據。
- **是程式碼還是資料快照**：**兩者都有**。這點更正原先預期（單純程式碼、無資料）——repo 裡確實夾帶 `data.json`（1085 行）與 `new_data.json`（558 行）兩份實際爬取輸出，但這是專案作者自己測試/開發時留下的部分快照，非官方公開資料集，且如上所述**未附使用授權**。若要重新完整爬取全站（網站宣稱涵蓋所有食材分類），仍需重新執行爬蟲，而且爬蟲程式碼是 2018 年（`main.py:3` 註解 `2018/7/11`）針對當時網站 HTML 結構寫的 XPath 選擇器（`spiders/foodwake.py:14,19,26,29,34`），網站改版後大機率會失效，需要重新除錯。

- **能否直接擴充 `raw_ingredients.json`**：**不建議直接匯入，只能當參考**，理由：
  1. 授權未清（見上）。
  2. 命名體系不合：foodwake 是簡體中文＋USDA英文譯名（如「蔓越莓」「鴨蛋」這類基礎食材尚可對照，但更多是美式食品資料庫特有品項，跟台灣在地食材/超商品項重疊率低，未逐一比對但從樣本看交集有限）。
  3. 欄位單位需要二次解析（字串裡數字+中文單位混合，如 `"136千卡"`、`"50毫克"`），要寫轉換腳本才能變成我們要的 `kcal_100g` 數值型欄位，且 62.3% 填值率代表大量欄位要處理缺值。
  4. 我們現有資料庫的核心欄位（`allergen_tags`、`prep_tier`、`requires_cooking`、`valid_slots` 這些跟 App 邏輯強綁定的欄位）foodwake 完全沒有，匯入後仍要人工/半自動補齊這些欄位才能被 `recommend.js` 等邏輯使用。
  5. **結論對應第 3 點**：foodwake 資料**不能**直接拿來擴充 `raw_ingredients.json` 這種「馬上要被程式邏輯吃」的資料表；比較合理的定位是「未來如果要做更細緻的營養素追蹤（維生素/礦物質層級）時，可以參考它的 54 個欄位分類方式跟資料結構長相」，屬於**背景參考**而非**可匯入資料源**。

## 5. 高價值模組/借鏡清單

- `foodwakeSpider/foodwakeSpider/data.json`、`new_data.json`：**[資料可用，但需授權查證]** 唯一有實質參考價值的檔案——可以打開看「一個完整微量營養素欄位表長什麼樣子」，若 Lighten2 未來真的要做維生素/礦物質追蹤（PRD 目前未規劃此範圍），這是欄位命名/分類方式的參考範本，不是可以直接匯入的資料源。
- `foodwakeSpider/foodwakeSpider/items.py`：**[背景]** 4 欄位的最簡 Item 定義，說明「原始爬蟲資料通常是半結構化字串，需要二次 ETL 才能變成可查詢的正規化欄位」——這對我們評估「要不要直接抓外部資料源」是個提醒：抓到的東西往往不是拿來即用的。

其餘檔案（`spiders/foodwake.py` 的 XPath 選擇器、`pipelines.py` 的 MySQL 寫入邏輯、`middlewares.py` 的 User-Agent 輪換）都是 2018 年針對特定網站的爬蟲工程細節，跟 Lighten2（無爬蟲需求、資料手動維護＋估算）完全無關，**[不需要]**。

## 6. 避坑清單

- **[避坑] 資料授權空窗**：這個專案完全沒有處理「爬別人網站的資料能不能重新散布/商用」這個問題，`LICENSE` 只蓋到程式碼、蓋不到資料本身。我們如果未來要擴充營養資料庫，要優先找有明確授權（政府公開資料、CC 授權資料集）的來源，而不是抄一個 2018 年沒交代授權的爬蟲快照。
- **[避坑] 空值處理過於寬鬆**：`spiders/foodwake.py:41-46` 用 `try/except` 把「抓不到數值」直接吞掉、退化成「只有單位沒有數字」的字串（`{"脂肪": "克"}`），而不是標記為 `null`/缺失。這造成下游（我們若拿來用）很難分辨「這個食材真的脂肪含量是 0」還是「這格資料根本沒抓到」。Lighten2 現有資料的作法（`taiwan_items.json` 的 `note` 欄位老實寫「依熱量平衡反推估算，非官方數據」）反而更誠實，值得繼續維持——寧可備註不確定性，也不要留一個看起來像正常值、實際上是空殼的欄位。
- 未發現其他明顯地雷（因為專案範圍極小、單一用途，沒有複雜的同步/推薦/AI邏輯可以踩雷）。

## 7. 一句話結論

foodwake-master 對 Lighten2 現階段（PRD Phase 0 起步、聚焦三層資料模型與型態選擇器）沒有架構參考價值，唯一價值是它示範了「一份含 54 種微量營養素的食材資料長什麼樣子」；只有在**未來真的要做維生素/礦物質級別的營養追蹤**（目前 PRD 未規劃，屬於假設性的遠期擴充）時才值得回頭參考它的欄位分類，屆時仍必須先解決資料授權問題、重新爬取或改用有明確授權的公開資料庫，而不是直接沿用 repo 裡夾帶的兩份未授權快照。
