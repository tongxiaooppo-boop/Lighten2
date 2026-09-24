# 目前任務（來自 Claude）

TASK 2 已審查通過（`database.js` 全部函式行為正確，commit `f85e5f7`）。這一輪換 TASK 3。

## 這一輪要做的事

### TASK 3 — 種子資料 JSON

建立以下 5 個檔案（放 `data/` 目錄）：
- `data/raw_ingredients.json`
- `data/taiwan_items.json`
- `data/protein_sources.json`
- `data/staples.json`
- `data/sauce_methods.json`

**資料來源與轉錄規則（不要自己編數值）：**

1. `raw_ingredients.json` ← PRD `輕盈計畫PRD_v4.0.md` 第 4.4 節，共 27 項。欄位對照 TECH-SPEC 3.7。
2. `taiwan_items.json` ← PRD 第 4.3 節，共 40 項，含 `kcal_low`/`kcal_high`/`kcal_rep` 三個熱量欄位（TECH-SPEC 3.8）。
3. `protein_sources.json` / `staples.json` / `sauce_methods.json` ← 這三個是新的三軸拆解表（TECH-SPEC 3.4），**PRD 沒有現成的三軸清單**，只有附錄 A 的「組合完成品」範例（例如「舒肥雞胸地瓜餐」= 蛋白質來源:舒肥雞胸 + 主食:地瓜 + 烹調法:免開火）。請這樣處理：
   - 讀 PRD 附錄 A 的每一道範例，拆出裡面出現的蛋白質來源／主食／醬料或烹調法三種元件。
   - 每個元件如果在 `raw_ingredients.json`（PRD 4.4 節）已經有對應的原型食材及其營養數值，就直接引用那份數值，**不要自己重新估算**。
   - 如果附錄 A 出現的元件在 4.4 節找不到對應（例如「照燒醬」「韓式泡菜」這類醬料/佐料，原型食材資料庫可能沒收錄），**不要編造數值**——先在該筆資料標記 `"kcal_100g": null` 之類的欄位並在報告裡列出「哪些元件缺數據」，交給我或使用者決定要不要之後另外補值。
   - 欄位結構依 TECH-SPEC 3.4：`id`、`name`、`kcal_100g`/`protein_100g`/`carb_100g`/`fat_100g`/`fiber_100g`、`diet_tags`、`allergen_tags`、`prep_tier`（🟢/🟡/🔴）。
   - `fiber_g`／`fiber_100g` 若 PRD 未提供數值，寫 `null`，不要自己估算。

## 完成標準

- 5 個 JSON 檔案格式合法（可以直接 `JSON.parse`）。
- `raw_ingredients.json` 剛好 27 筆，`taiwan_items.json` 剛好 40 筆。
- 報告裡列出各檔案轉錄筆數，以及 `protein_sources`/`staples`/`sauce_methods` 裡有多少筆缺數據（`kcal_100g: null`）。

這一輪**只做這 5 個 JSON 檔案**，不要順手寫 `recipe_templates` 的組合邏輯或任何 `engine/*.js`（那是 TASK 4 以後的事）。

做完後照協作規則：commit（**只要本機 commit，不要 `git push`**），並把報告寫進 `collab/from-cline.md`。

## 分工說明

這個專案的 GitHub push 與未來的雲端部署（GitHub Pages/Netlify 等）由 Claude 負責，Cline 只需要寫程式、本機 commit，不用處理 remote，也不用管部署。
