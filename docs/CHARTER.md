# Lighten2 章程

這份文件規定**之後新增或修訂食物資料、改動架構**時要照什麼規則走。它是用來防止 v1「修修補補」的狀況再發生：每一次改動都有固定的出處要求、固定的檢查、固定的紀錄方式。

- 適用對象：任何改 `data/`、`js/` 的人（Opus、Sonnet、Cline 或使用者自己）。
- 章程本身要修改，比照第 B4 節「需要獨立審核的變更」處理。
- 制定依據：[docs/review/2026-09-28-架構review.md](review/2026-09-28-架構review.md)、[docs/review/2026-09-28-食物資料review.md](review/2026-09-28-食物資料review.md)。

---

# A. 食物資料章程

## A1. 範圍

| 檔案 | 內容 | 受本章程管轄 |
|---|---|---|
| `data/ingredients.json` | 自煮用的食材、醬料、烹調法 | 是 |
| `data/dish_archetypes.json` | 餐型骨架 | 是（A7） |
| `data/convenience_items.json` | 超商與連鎖健康餐盒/宅配 | 是 |
| `data/taiwan_items.json` | 台式外食 | 是 |
| 使用者的「我的品項」（`custom_foods` store） | 使用者自建 | 否，只受 A8 的最低驗證 |

## A2. 出處分級

每一筆資料的每一個營養數字，都要能說出「從哪裡來」。出處依可信度由高到低：

| `source.type` | 說明 | 適用 | `source.ref` 要寫什麼 |
|---|---|---|---|
| `tfda` | 衛福部食品營養成分資料庫（目前版本：2025 UPDATE1） | 食材首選 | 整合編號，例如 `I04024` |
| `exchange` | 衛福部國健署食物代換表 | 份量、生熟重、購買量/可食量 | 表號＋品名，例如 `附-3-1 雞胸肉` |
| `label` | 包裝營養標示 | 超商商品首選 | 照片檔名或商品頁網址 |
| `official_web` | 品牌/連鎖店官網或官方 App 公布的營養資料 | 外食連鎖、健康餐盒 | 網址（附查詢日期） |
| `usda` | 美國農業部 FoodData Central | TFDA 沒有收錄的食材 | FDC ID |
| `derived` | 由上面的來源用明確公式推算 | 熟重數值（由生重＋吸水/失水率推算）、組合品項 | 公式與所用的來源編號，例如 `A05013 × (1/2.5)` |
| `estimate` | 依同類品項或食物代換表概算，沒有直接對應的官方數字 | 查不到的外食 | 估算方法一句話 |

**規則**：
- 有高等級來源時，不得使用低等級來源。食材在 TFDA 查得到就一定用 TFDA。
- `estimate` 不得覆蓋任何較高等級的數字（不能拿估算換掉包裝標示）。
- 「AI 回答的數字」不是出處。AI 可以幫忙找網址或整理，但寫進資料的數字必須來自上表某一種來源，否則一律標 `estimate`。
- TFDA 熱量取「熱量(kcal)」欄（不是「修正熱量」），全資料庫一致。

## A3. 可信度（現成品項）

食材一律要有 `tfda`/`exchange`/`usda`/`derived` 出處，不存在「估算的食材」。

現成品項逐欄位記可信度：`confidence: { kcal, protein_g, carb_g, fat_g, fiber_g }`，每欄的值為：

| 值 | 意義 |
|---|---|
| `verified` | 來源是 `label` 或 `official_web`，且 `source.ref` 有網址或照片 |
| `label_unsourced` | 看起來是包裝標示，但沒留出處（v1 遺留，只准減少不准新增） |
| `estimate` | 估算 |

**升級規則**：查到官方數字時，替換數值、改 `source`、把對應欄位升成 `verified`、填 `verified_at`，並在 `data/CHANGELOG.md` 記一行。

**畫面規則**：可信度不在畫面上用顏色或警告標示（避免「這個不好」的暗示），只影響「約」字與內部決策（例如「我的品項」能不能自動進推薦候選池）。

## A4. 欄位規格

### 食材（`ingredients.json`）

```js
{
  id: "chicken_breast",              // 小寫英文＋底線，全資料庫唯一，一經使用不得改名
  name: "雞胸肉",                     // 使用者看到的名稱；有常見歧義時寫清楚（「白花椰菜」不是「花椰菜」）
  axis: "protein" | "staple" | "vegetable" | "seasoning" | "method",
  basis: "raw" | "cooked" | "dry" | "as_is",   // 數值對應的狀態，必須跟來源樣品狀態一致
  per_100g: { kcal, protein_g, carb_g, fat_g, fiber_g },
  serving_g: 130,                    // 一份的克數（跟 basis 同一個狀態）
  serving_label: "1份雞胸肉（生重約130g，熟後約100g）",
  cooked_to_raw: null,               // basis=cooked 時必填：熟重 1g 對應的生重克數
  prep_tier: "🟢" | "🟡" | "🔴",
  requires_cooking: true,
  allergen_tags: [],                 // 必填，食材不允許 null（食材成分單純，一定要確認）
  diet_tags: ["高蛋白"],
  oil_g: null,                       // 只有 axis=method：這個烹調法每份隱含的用油克數
  source: { type: "tfda", ref: "I04024" },
  verified_at: "2026-09-28",
}
```

### 現成品項（`convenience_items.json`、`taiwan_items.json`）

```js
{
  id: "conv_dr01",
  name: "統一陽光 高纖無糖豆漿",
  channel: "convenience" | "delivery",
  vendor: "統一" | null,
  category: "飲品",                   // 食物類型（便當/麵食/沙拉/飲品…），不是時段
  role: "main" | "side" | "snack" | "drink",
  valid_slots: ["breakfast", ...],
  contains_drink: false,
  is_treat: false,
  kcal: 160,                         // 代表值
  kcal_range: null,                  // 選填 [低, 高]，高/低 ≥ 1.5 倍時不進推薦池
  protein_g, carb_g, fat_g, fiber_g, // 可為 null（未知），不得用 0 代替未知
  allergen_tags: null | [],          // null = 未確認（使用者有設過敏原就排除）
  diet_tags: [],
  source: { type: "label", ref: "https://..." },
  confidence: { kcal: "verified", protein_g: "verified", carb_g: "estimate", fat_g: "estimate", fiber_g: "verified" },
  verified_at: "2026-09-28" | null,
}
```

## A5. 數值規則

1. **未知寫 `null`，不寫 0。** 0 代表「確定沒有」。
2. **生熟一致**：`basis` 必須跟來源樣品狀態一致。TFDA 沒有熟重樣品時，熟重數值用 `derived`，公式寫進 `source.ref`。
3. **有效位數**：每 100g 數值保留 1 位小數；品項每份數值保留 1 位小數；熱量取整數。
4. **巨量營養素驗算**：來源是 `tfda`/`label`/`official_web`/`usda` 的數字，`蛋白質×4＋(碳水−纖維)×4＋纖維×2＋脂肪×9` 跟熱量差距超過 15% 時，要在 `source.note` 說明原因（例如含酒精、糖醇），否則視為抄錯。來源是 `estimate`/`derived` 的不做這項驗算（反推出來的數字一定會通過，驗了等於沒驗）。
5. **份量**：食材的 `serving_g` 優先對齊食物代換表的份數倍數（例如雞胸肉代換表 1 份＝生重 30g，一份 130g ≈ 4.3 份），在 `serving_label` 寫清楚生重或熟重。
6. **烹調法用油**：`sm_pan_fry`、`sm_stir_fry` 這類會用油的烹調法必須填 `oil_g`，推算熱量時當成這一餐的隱含成分；免開火、微波、氣炸填 0。

## A6. 過敏原與飲食標籤

1. 過敏原只能用固定詞彙：`甲殼類｜魚｜蛋｜乳製品｜堅果｜麩質｜黃豆｜芝麻`，外加 `未確認`。新增詞彙屬於 B4 需審核的變更。
2. 複合料理（外食、餐盒）沒有逐項確認過成分，一律含 `未確認`，不能因為「看起來沒有」就標 `[]`。
3. 飲食標籤要**正面宣告**：只有標了 `全素` 的品項才算全素，沒標就是不符合。`全素` 自動滿足 `蛋奶素`。
4. 過敏原或飲食標籤有疑義時，往保守方向標（多標、標未確認），不往寬鬆方向標。

## A7. 餐型骨架

1. 骨架每一軸的 `allow` 只能引用 `ingredients.json` 裡存在、且 `axis` 相符的 id。
2. 新增或修改骨架屬於 B4 需審核的變更（三輪審核定下的原則：不對稱槽位、每個食材自己的份量、避免無限制組合）。
3. 食材新增後沒有被任何骨架引用，`check-data.js` 會警告（不是錯誤），避免再累積沒用到的資料。

## A8. 「我的品項」的最低驗證

使用者自建品項不受出處規則管轄，但寫入前必須通過：名稱非空、`kcal` 為正數、`role` 與 `channel` 為合法值；`allergen_tags` 預設 `null`（未確認）。沒填的營養欄位是 `null`，不是 0。

## A9. 新增或修訂資料的流程

1. 查出處（依 A2 的優先順序）。
2. 依 A4 格式修改資料，填 `source`、`confidence`、`verified_at`。
3. 在 `data/CHANGELOG.md` 加一行：日期、id、改了什麼、出處。
4. 跑 `node tools/check-data.js`，必須全過。
5. 跑 `node tools/check-engine.js`，必須全過（資料改動可能影響推薦結果）。
6. 同一個 commit 提交資料與 CHANGELOG。commit 訊息寫明是「新增」「修正數值」還是「升級可信度」。
7. 一次改動超過 10 筆，或改動會讓推薦熱量系統性上升/下降（例如 A5 第 6 點的用油），要附一段前後比較（某個代表性設定下，五個時段推薦熱量的變化）。

## A10. `tools/check-data.js` 自動檢查項目

**錯誤（不通過就不能提交）**：
- 每個檔案符合 A4 格式；必填欄位齊全；列舉值合法。
- id 全資料庫唯一。
- 營養數字是 `null` 或非負數；熱量為正數。
- 食材 `allergen_tags` 不為 null；品項 `allergen_tags` 只含固定詞彙。
- `source.type` 合法；`tfda` 的 `ref` 能在 `collab/tfdb-2025-simplified.json` 找到。
- `basis = cooked` 的食材有 `cooked_to_raw`。
- 會用油的烹調法有 `oil_g`。
- 骨架 `allow` 引用的 id 都存在且 `axis` 相符。
- `kcal_range` 若有，低 ≤ 代表值 ≤ 高。
- A5 第 4 點的巨量營養素驗算（只對適用來源）。

**警告（提醒但不擋）**：
- 食材沒被任何骨架引用。
- 品項任一欄 `confidence` 是 `label_unsourced` 或 `estimate`（列出清單，方便排查證優先順序）。
- `tfda` 出處的數值跟 TFDA 樣品差距超過 5%（可能抄錯或樣品選錯）。

---

# B. 架構章程

## B1. 分層與依賴方向

```
ui/  →  engine/  →  data/  →  core/
```
- 只能往右依賴。`engine/` 不碰 DOM；`data/` 不 import `engine/`；`core/` 不依賴任何東西。
- 全部用 ES modules（`import`/`export`），不再把函式掛到 `window`。
- 例外只有一個：`ui/app.js` 可以把少數函式掛到 `window` 供 console 除錯，但任何模組不得透過 `window` 呼叫別的模組。

## B2. 單一真相來源

下列概念只能在一個地方定義，其他地方一律 import：

| 概念 | 位置 |
|---|---|
| 時段清單、中文標籤、預設權重、預設開關、時段結束時間 | `core/slots.js` |
| 型態列舉、日期工具、escape | `core/` |
| 食物資料的載入、驗證、正規化（內建＋我的品項） | `data/catalog.js` |
| IndexedDB 存取 | `data/db.js` |
| 過敏原/飲食限制/不吃清單的判斷 | `engine/filters.js` |
| 一餐內容的營養計算、骨架驗證、快照 | `engine/meal-content.js` |

新增功能時發現需要「類似的東西」，先找上表；找到就用，找不到而且確實是新概念，才新增模組並補進上表。**禁止複製一份再改。**

## B3. 不可退化的規則

以下規則是多輪審核定下的，改寫、重構時不得削弱。`tools/check-engine.js` 對每一條都要有對應的斷言。

**安全**
1. 硬性過濾「未確認就排除」：過敏原未確認、飲食標籤缺漏，只要使用者有設定就排除。
2. 飲食限制逐成分判斷，不用聯集。
3. 免開火烹調法不得搭配需要煮熟的食材，存檔與顯示時各檢查一次。
4. 計畫（meal_plan）內容在顯示時重新跑硬性過濾，被擋下顯示中性提示，不默默刪除。

**計算**
5. 缺資料是 `null`，加總時 null 傳染，不當 0。
6. 自組食譜：不對稱槽位、每個食材自己的 `serving_g`、只有主要槽位縮放且限 0.5–2.0 倍。
7. 現成品項組合：一餐恰好 1 main＋≤1 side＋≤1 drink＋≤1 snack、最多 3 件；下午茶不需要 main；飲料不單獨成一餐。
8. 近 7 天平均、纖維缺口、校正引擎的攝取檢查，只算「完整記錄日」且不含今天。
9. 計畫層（L2）不存縮放後的熱量；只有 `daily_log`（L3）算進任何統計。

**核心原則**
10. 運動與飲食脫鉤：`engine/` 底下任何模組不得 import 運動紀錄的存取函式；飲食畫面不出現運動內容，反之亦然。
11. 不評判：不顯示遵循率、「偏離計畫」、「未完成」、連續達成天數；不依型態做頻率統計配評價文字；商品清單不依熱量排序或上色；飲料不做糖量警告。
12. `picker_last_meal_type` 只有「自己選」modal 能讀，推薦引擎、統計、hero 不得讀取。

## B4. 需要獨立審核的變更

下列變更動工前，要找一個**獨立的 Opus**（新開的 agent，不是正在實作的那一個）審核，並把完整問答逐字存到 `collab/opus-review-log/YYYY-MM-DD-主題.md`（只存摘要不算）：

- 新增或移除 IndexedDB store、改變已存在 store 的資料格式。
- 修改 B3 任何一條規則，或推薦評分、預算分配、體重校正的演算法。
- 新增或修改餐型骨架。
- 新增過敏原或飲食標籤詞彙。
- 新增頂層分頁，或改變 L1/L2/L3 資料模型的解析規則。
- 修改本章程。

以下**不需要**獨立審核，照 A9 流程或一般開發即可：修正資料數值（有出處）、純 UI 文案與版面、修 bug 且不改變 B3 規則、補測試。

審核至少一輪；對方提出的問題有需要使用者決定的，先問使用者，不自行拍板。

## B5. 每次提交前的驗收

1. `node tools/check-data.js` 全過。
2. `node tools/check-engine.js` 全過。
3. 動到畫面流程時，跑一次手機實機腳本（`docs/手機實機腳本.md`，Phase −1 建立）：新使用者填資料 → 看推薦 → 記錄一餐 → 撤銷 → 自己選一餐 → 切分頁回來確認更新 → 改飲食限制 → 記體重。
4. 改動了行為，同一個 commit 更新 PRD 對應章節；PRD 跟程式不一致時，以「最近一次審核定案的規格」為準，並立刻修正落後的那一邊。

## B6. 文件位置

| 文件 | 位置 |
|---|---|
| PRD（權威規格） | `docs/PRD.md`（2.0 各 Phase 驗收後，從 `collab/PRD-2.0-架構草案.md` 併入） |
| 章程 | `docs/CHARTER.md`（本檔） |
| Review 報告 | `docs/review/` |
| 獨立審核逐字紀錄 | `collab/opus-review-log/` |
| 資料變更紀錄 | `data/CHANGELOG.md` |
| v1 舊文件 | `docs/v1/` |
