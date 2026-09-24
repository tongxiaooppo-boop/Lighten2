# 來自 Cline 的報告（TASK 3）

## 這次改了什麼

新增 `data/` 下 5 個種子資料 JSON（全部合法、可 `JSON.parse`）：

| 檔案 | 筆數 | 說明 |
|---|---|---|
| `raw_ingredients.json` | **26** | 原型食材，逐筆轉錄 PRD v3.1 4.4 節 |
| `taiwan_items.json` | **40** | 台式熱門排行榜，含 `kcal_low/kcal_high/kcal_rep` |
| `protein_sources.json` | 11 | 三軸之一：蛋白質來源（8 筆缺數據） |
| `staples.json` | 8 | 三軸之一：主食（3 筆缺數據） |
| `sauce_methods.json` | 7 | 三軸之一：醬料/烹調法（2 筆缺數據） |

## 重要發現：raw_ingredients 是 26 筆，不是 27 筆

TASKS.md、TECH-SPEC 3.7 與 PRD v3.0 changelog 都寫「27 項」，但實際 PRD v3.1 4.4 節的表格**只有 26 列**（主食 10 + 蛋白質 7 + 蔬菜 4 + 脂肪 5 = 26）。我用 grep 逐列確認過（`消滅胖子PRD_v3.1.md` 第 177–202 行）。**我沒有自行補第 27 筆**（那會違反「不要自己編」），因此本檔案是 26 筆。請確認：是否 PRD 漏了一項，或「27」是筆誤。

## 轉錄規則說明

- `raw_ingredients.json`：數值完全照 4.4 節（每 100g），欄位 `kcal_100g/protein_100g/carb_100g/fat_100g/fiber_100g`。纖維有給 0 的就寫 0（不轉 null）。
- `taiwan_items.json`：`kcal_low/kcal_high` 取該品項「整份」範圍；多種變體（如火鍋個人鍋 700–950／吃到飽 1800–2400+）取整體 min/max，細項拆解放進 `note`。`kcal_rep` 只在 PRD 明確給「代表值約 X」或單一值時才填，否則 `null`（共 32 筆 null、8 筆有值：排骨便當 950、雞腿便當 810、牛肉麵 700、豆漿 125、蘿蔔糕 355、鐵板麵 450、地瓜 180、豆漿店 522）。
- 三軸表：從 PRD 附錄 A 13 道範例拆出蛋白質來源／主食／醬料-烹調法三類元件，去重後個別建表。

## 三軸表缺數據清單（`kcal_100g: null`，待決定是否補值）

**protein_sources.json（8 筆缺數據）**：乳清蛋白粉、希臘優格、鮭魚、牛肉、雞腿肉、鯛魚、蝦仁、無糖豆漿。
（4.4 有對應可引用的：雞胸肉、雞蛋、板豆腐 → 已引用 4.4 數值）

**staples.json（3 筆缺數據）**：藜麥、雜糧飯、毛豆仁。
（4.4 有對應可引用的：燕麥片、地瓜、糙米飯、南瓜 → 已引用；花椰菜米引用 4.4「花椰菜(蔬菜)」數值，因其即花椰菜切碎）

**sauce_methods.json（2 筆缺數據）**：韓式泡菜、照燒醬（市售佐料，4.4 未收錄）。
（其餘 5 筆是「烹調法」：免開火/微波/煎/炒/烤氣炸，本身不貢獻熱量，故營養欄位填 0 而非 null）

## 需要 Claude／使用者決定的事

1. **raw_ingredients 26 vs 27**：見上，需確認是否漏項或筆誤。
2. **三軸表 13 筆缺數據**：是否要補值？補值來源需可靠（PRD 未提供），建議由營養師或可靠資料庫另補，我沒有編造。
3. **三軸表的 `prep_tier`、`diet_tags`、`allergen_tags` 是我做的判斷**（PRD 只給整道食譜的 🟢/🟡/🔴，未給各軸難度貢獻；過敏原依食物已知屬性，如雞蛋→蛋、蝦仁/泡菜→甲殼類、乳清/優格→乳製品、照燒醬→麩質）。若有既定規範請告知。
4. **`taiwan_items.json` 的 `category` 我用中文「早餐/午餐/晚餐/宵夜」**；TECH-SPEC 的 recipe_templates `slot` 用英文 `breakfast/main/snack`，兩者對應關係（午餐/晚餐 → main）尚未統一，TASK 7 需決定映射。

## 驗證

- 5 個檔案皆用 Node `JSON.parse` 通過。
- `taiwan_items` = 40 筆、`raw_ingredients` = 26 筆，與上面清單一致。
- 本機 `git commit` 完成（commit `8ceb648`），未 `git push`。

## 建議下一步

- 依 TASKS.md 執行 TASK 4（`js/engine/nutrition.js` 的 `calculateTargets`，公式照 TECH-SPEC 4.1）。
