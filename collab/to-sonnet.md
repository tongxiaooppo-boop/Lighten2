# 給 Claude Sonnet：把 collab 裡的官方飲食 PDF 全部轉成可讀的 JSON／Markdown

一律用中文回覆。這份是獨立任務說明，不需要讀其他交接檔。（這個檔案上一版是 v1 時期的舊任務，已經做完，內容在 git 歷史裡，不用管。）

## 背景

專案是個人減脂飲食 App（`D:\ok\lighten`，分支 `master`）。接下來要用衛福部《食物代換表》當食材挑選的主體：分類與「一份多大」照代換表，營養數值照衛福部營養成分資料庫。Opus 要逐列核對代換表、判斷分類與份量，所以需要**完整、逐字、可以用程式讀取**的轉錄。

現況：只有 `data/reference/food_exchange_table.json` 轉了一部分（全穀雜糧只有 12 個例子、蔬菜只列了標＊的品項）。其他 PDF 都沒有轉。

**你的工作只有「轉錄」**：照原文搬過來，不判斷、不修正、不補資料、不改任何程式或 `data/` 底下的檔案。

## 要轉的檔案（依優先順序）

| # | 來源 | 頁數 | 輸出 | 重點 |
|---|---|---|---|---|
| 1 | `collab/食物代換表.pdf` | 12 | `collab/transcripts/food_exchange_table.json` | **最重要，每一列都要有**，格式見下 |
| 2 | `collab/pdf/每日飲食指南手冊.pdf` | 29 | `collab/transcripts/daily_food_guide.json` ＋ `.md` | 各熱量級距的六大類建議份數表、一份的定義、三大營養素比例轉成 JSON；其餘內文轉 md |
| 3 | `collab/pdf/素食飲食指南手冊.pdf` | 19 | `collab/transcripts/vegetarian_food_guide.json` ＋ `.md` | 同上，注意豆類和蛋類分開的地方 |
| 4 | `collab/pdf/我的餐盤手冊（全穀及未精製雜糧）v2.pdf` | 37 | `collab/transcripts/my_plate.json` ＋ `.md` | 每一份餐點範例（中式、西式、素食）的食材與份量轉成 JSON |
| 5 | `collab/pdf/22016.pdf`（高齡營養健康食譜） | 16 | `collab/transcripts/senior_recipes.json` | 每道食譜的食材、克數、每人份營養 |
| 6 | `collab/pdf/1600_1800_kcal_healthy_recipes.pdf` | 2 | `collab/transcripts/recipes_1600_1800.json` | 每餐的內容與份量 |
| 7 | `collab/pdf/國民飲食指標手冊.pdf` | 20 | `collab/transcripts/national_dietary_indicators.md` | 只轉 md：12 條指標原文＋每條的重點段落 |
| 8 | `collab/pdf/20241024102714_90531.pdf`（幸福營養好食光） | 66 | `collab/transcripts/90531.md` | 只轉 md。**先比對它跟 #2 重複的部分**，重複的寫「同每日飲食指南第 N 頁」，只轉不一樣的內容 |

不用轉：`collab/食品營養成分資料庫2025版UPDATE1EXCEL(另開新視窗).xlsx`（已經轉成 `data/reference/tfda-2025-update1.json`）。

另外寫 `collab/transcripts/README.md`：列出每個檔案對應哪一份 PDF、哪幾頁，說明格式和已知的缺漏。

## 怎麼讀 PDF（Windows 上已經踩過的坑）

- **用 PyMuPDF**（`import pymupdf`，已安裝 1.28.2）。不要用 pdftotext／poppler：中文字型會變亂碼，而且這台沒裝 poppler。
- **終端機輸出中文會變亂碼**（主控台是 Big5）。一律**寫成 UTF-8 檔案再用 Read 工具讀**，不要 print 到終端機；或者先設 `PYTHONIOENCODING=utf-8`。
- 很多頁的**表格是圖片或排版複雜**，抽出來的文字欄位順序會亂掉，例如《我的餐盤》37 頁只抽得到約 9000 字。**表格一律渲染成圖片，用 Read 工具看圖轉錄**：`page.get_pixmap(dpi=150).save(...)`，存到你的 scratchpad，不要存進 repo。文字抽取只當輔助。
- 在 Windows 上寫多行 Python 時，heredoc 常被引號打斷：先用 Write 把腳本寫進 scratchpad，再執行。

## 食物代換表的格式（#1）

代換表共 12 頁：附-1 總表與稱量換算、附-2 乳品、附-3-1／3-2／3-3 豆魚蛋肉（低脂／中脂／高脂與超高脂）、附-4 全穀雜糧、附-5 蔬菜、附-6 水果、附-7 油脂與堅果。

```json
{
  "_source": "衛生福利部國民健康署《食物代換表》collab/食物代換表.pdf",
  "_transcribed_at": "2026-MM-DD",
  "unit_conversion": [ { "from": "1杯", "to": "16湯匙", "page": 1 } ],
  "exchange_units": [ { "table": "附-1", "group": "豆魚蛋肉類", "tier": "低脂", "protein_g": 7, "fat_g": 3, "fat_note": "以下", "carb_g": null, "kcal": 55, "page": 1 } ],
  "items": [
    {
      "table": "附-3-2",
      "group": "豆魚蛋肉類",
      "tier": "中脂",
      "subgroup": "水產",
      "row_text": "虱目魚、烏魚、肉鯽、鹹馧魚、鮭魚",
      "names": ["虱目魚", "烏魚", "肉鯽", "鹹馧魚", "鮭魚"],
      "portion_text": null,
      "buy_g": null,
      "edible_g": null,
      "raw_g": 35,
      "cooked_g": 30,
      "extra": { "carb_g": null, "fat_g": null, "protein_g": null },
      "marks": [],
      "row_note": null,
      "order": 1,
      "page": 5
    }
  ],
  "footnotes": [ { "table": "附-3-1", "text": "（逐字）", "page": 4 } ]
}
```

規則：
- **每一列都要轉**，包括全穀雜糧約 120 項、蔬菜約 80 個名稱、水果全部。蔬菜沒有個別克數：`edible_g` 填 100，`order` 保留表上的排列順序（原表依鉀含量排列，順序有意義）。
- `row_text` 逐字照抄那一列的品名（含括號，例如「柳丁(4個/斤)」）。`names` 是拆開的品名，**只有原文用「、」或「／」分隔時才拆**，不要自己合併或改名。
- 欄位名稱照表頭對應：可食部分生重 → `raw_g`、可食部分熟重 → `cooked_g`、購買量 → `buy_g`、可食量 → `edible_g`、份量（1/4碗、1個、1茶匙）→ `portion_text`。表上沒有的欄位填 `null`，不要推算。數字照抄，分數或「約」這類字保留在 `portion_text`。
- 品名旁邊的「(+5公克碳水化合物)」這類附註拆進 `extra`，原文同時留在 `row_text`。
- 符號：＊、◎、◎◎ 等原樣放進 `marks`，意義寫在 `footnotes`（照該表的註腳逐字抄）。
- `subgroup` 照表上左側的分組欄（例如水產、家畜、家禽、內臟、蛋、黃豆製品；全穀雜糧的米類、根莖類等）。表上沒有分組就填 `null`。
- 現有的 `data/reference/food_exchange_table.json` **不要改**。新檔完成後，拿舊檔裡有的品項逐一比對，數字不一致的列在報告裡（以 PDF 為準）。

## 指南與食譜的格式（#2–#6）

- JSON 放表格型的資料，每筆都帶 `page`。例如熱量級距份數表寫成 `[{ "kcal_level": 1500, "全穀雜糧類_碗": 2.5, ... }]`，欄位名稱照原表，單位寫進欄位名稱。
- 食譜寫成 `{ "name", "servings", "ingredients": [{ "name", "amount_text", "g" }], "steps": [...], "nutrition_per_serving": { ... }, "page" }`。原文沒寫的欄位填 `null`。
- md 保留原本的章節標題層級，只轉內文重點，不轉封面、目錄、版權頁、純裝飾的圖說。原文的數字一律逐字保留。
- 不要改寫成自己的話，也不要加上「建議」「可用於 App」這類評論。要評論的話寫在報告裡。

## 自我檢查（做完每個檔案都要跑）

1. **逐頁看圖對照**：每一個 JSON 列都要跟渲染出來的頁面圖核對過，包括品名、每一個數字、符號。
2. 寫一支小腳本統計：每張表的列數、`null` 欄位數、`page` 的範圍，確認 JSON 可以用 `JSON.parse` 讀。
3. 看不清楚或不確定的格子，值填 `null`，另外記在 `row_note`（例如「PDF 模糊，疑似 35」），不要猜。

## 交付

1. 檔案放 `collab/transcripts/`。**不要動** `data/`、`js/`、`docs/`、`tools/`。
2. 在 `collab/from-sonnet.md` 寫報告：
   - 每個檔案轉了幾筆、對應 PDF 哪幾頁；
   - 代換表每張表的列數；
   - 不確定的格子清單（檔案、頁碼、列、原因）；
   - 跟舊的 `food_exchange_table.json` 不一致的地方；
   - PDF 裡看到、但沒放進 JSON 的東西。
3. 可以 commit 到 master，訊息例如 `collab: 官方飲食 PDF 全文轉錄（代換表等 8 份）`，結尾加：
   ```
   Co-Authored-By: Claude Sonnet <noreply@anthropic.com>
   ```
   pre-commit hook 約 8 秒，**禁止 `--no-verify`**。**不要 push**，推送由使用者決定。
4. 檔案很多的話，可以先交 #1（代換表）並 commit，再做其餘的。#1 的優先度遠高於其他。
