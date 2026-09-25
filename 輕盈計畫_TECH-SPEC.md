# 輕盈計畫 (Lighten Plan) — 技術架構與規格書（開發用最終版）

> 本文件是給 VSCode + Cline 或 VSCode + Claude Code 的實作規格。業務邏輯（計算公式、推薦邏輯、週彈性點數與大餐預約制度）完整定義於 `輕盈計畫PRD_v4.0.md`，此文件**只定義如何把那份 PRD 變成程式**：架構、檔案結構、資料表、模組介面。實作時兩份文件都要看。

---

## 1. 技術棧決策（已定案，不需再討論）

| 項目 | 選擇 | 理由 |
|---|---|---|
| 前端 | **Vanilla JavaScript**，無框架 | 與既有專案一致，維護成本低 |
| 部署形態 | **純網頁 (Web App)**，不包裝原生 App | 開發前確認：只需要網頁版即可，跨平台（含 iPhone Safari）直接開網址就能用，不需要 Xcode/Apple Developer 年費，也不需要處理 Google Play 上架 |
| 資料庫 | **IndexedDB（localforage）**，單一儲存層，不預留 SQLite 遷移 | 瀏覽器本機儲存已足夠；沒有原生殼就不需要 SQLite |
| Build 工具 | **無**，純 `<script>` 標籤載入 | 降低環境問題 |
| 後端伺服器 | **無**（MVP 階段） | 單人使用的個人工具，見第 3 節「一人一帳」設計 |
| 發佈方式 | 部署到任一靜態網頁空間（例如 GitHub Pages / Netlify 免費方案），瀏覽器打開網址即可用；**可選**加上 PWA manifest 讓使用者「加入主畫面」，體感像 App 但完全免費、無需審核 | 個人使用，兩端（iOS/Android）用同一套網址 |
| 雲端同步 | 列為 Phase 2+（Firebase，選用） | MVP 不做，仍是本機資料為主 |

**架構鐵律**：
- 所有資料庫操作都**只能透過 `database.js` 存取**。
- 不使用任何前端框架，純 DOM 操作。
- 不引入 build 工具鏈。

**分工（比照 `collab/to-cline.md` 規則）**：Cline 只負責寫程式與**本機** `git commit`；GitHub remote push 與未來的雲端部署（GitHub Pages / Netlify 等）一律由 Claude Code 負責，Cline 不執行 `git push`、不碰部署設定。專案已建立公開 GitHub repo：https://github.com/tongxiaooppo-boop/lighten

---

## 2. 專案目錄結構

```
lighten/
├── index.html
├── css/
│   └── style.css
├── js/
│   ├── database.js         ← 唯一的資料存取層（IndexedDB / localforage）
│   ├── engine/
│   │   ├── nutrition.js    ← BMR/TDEE起點值/目標熱量/四大營養素（PRD 第3節）
│   │   ├── tdee.js         ← TDEE動態校正：體重趨勢+攝取記錄回歸（PRD 3.7節，新增）
│   │   ├── budget.js       ← 日總額×週彈性點數動態配額重算（PRD 5.1節，新增，取代固定比例）
│   │   ├── recommend.js    ← 今日食譜推薦邏輯（PRD 第5節）
│   │   ├── matcher.js      ← 蛋白質(日)/纖維(週)硬約束過濾（PRD 5.6節，新增）
│   │   ├── feast.js        ← 大餐預約/確認/取消 + 超額攤還（PRD 6.3–6.4節，新增，取代舊flex.js的運動換算部分）
│   │   └── shopping.js     ← 採買清單彙整邏輯（PRD 第7節）
│   ├── ui/
│   │   ├── tab-profile.js
│   │   ├── tab-today.js
│   │   ├── tab-ledger.js   ← 週彈性點數進度＋大餐預約（原 tab-flex.js 改名）
│   │   ├── tab-week.js
│   │   ├── tab-exercise.js ← 運動獨立紀錄頁（新增，與飲食頁面分離，PRD 6.5節）
│   │   └── tab-shopping.js
│   └── app.js
├── data/                   ← 種子資料
│   ├── protein_sources.json / staples.json / sauce_methods.json  ← 食譜模板前三軸（PRD 4.2節，取代舊recipes.json）
│   ├── raw_ingredients.json← 原型食材資料庫（PRD 4.4節，27項；2026-09-25起其中4項「蔬菜」同時是食譜模板第4軸）
│   ├── convenience_items.json← 超商/現成即食品項（2026-09-25新增，11項，跟四軸組合併入同一候選池）
│   └── taiwan_items.json   ← 台式熱門排行榜（PRD 4.3節，50項含熱量估算，含早/午/晚/宵夜/飲料/西式速食6類）
├── manifest.json            ← （可選，Phase 1.5）PWA 設定，讓使用者可在手機「加入主畫面」
├── service-worker.js        ← （可選，Phase 1.5）離線快取
├── 輕盈計畫PRD_v4.0.md          ← 業務邏輯規格（唯一真相來源）
├── 輕盈計畫_TECH-SPEC.md         ← 本文件
└── 輕盈計畫_TASKS.md             ← 給 Cline/Claude Code 的任務清單
```

**與 v4.0 初版的差異**：拿掉 `www/` 子目錄、`android/`、`capacitor.config.json` ——這些原本只是為了讓 Capacitor 把網頁包成原生 App 而存在。既然開發前就確認只需要網頁版，直接拿掉這層，所有檔案放在專案根目錄即可，減少一層無意義的路徑巢狀。

---

## 3. 資料表設計（IndexedDB / localforage 結構）

### 「一人一帳」設計原則

這是單人使用的個人工具，**不做多人帳號系統**：整個本機資料庫（瀏覽器的 IndexedDB）本身就代表「這個人的一筆帳」，所有資料表都不需要 `user_id` 外鍵。`user_profile` 表規定只允許存在一筆 row（單例寫入，`saveProfile()` 永遠是 upsert 同一筆）。所有紀錄（體重、飲食、運動、彈性點數）都直接歸屬這個唯一的本機帳本。若之後（Phase 2+）要做跨裝置同步，才需要引入帳號與 `user_id`／後端資料庫，MVP 不做。

**注意**：資料存在使用者瀏覽器的 IndexedDB 裡，換裝置或清瀏覽器資料會遺失，這是純網頁版的已知取捨（比包裝原生 App 簡單很多，但沒有雲端備份）。若之後需要「不怕換手機/清資料」，屬於 Phase 2+ 的 Firebase 雲端同步範疇。

每個資料表對應一個 localforage store，用陣列存 JSON；`database.js` 是唯一的存取層，其他模組一律透過它讀寫，不直接呼叫 localforage API。

### 3.1 `user_profile`（單筆，全域設定）
| 欄位 | 型別 | 說明 |
|---|---|---|
| age / gender / height_cm / weight_kg / body_fat_pct | — | 同 PRD 2.1節 |
| activity_mode / activity_value | — | PRD 2.2節，二擇一 |
| goal_mode | TEXT | 'cut' / 'maintain' / 'bulk' |
| diet_restriction / allergens | — | PRD 2.3節 |
| preptime_weekday / preptime_weekend | — | PRD 2.4節 |
| fiber_target_g | INTEGER | 預設30，範圍25–35，週日均值判定用 |

### 3.2 `weight_log`（新增，v4.0）
| 欄位 | 型別 | 說明 |
|---|---|---|
| log_date | TEXT PK | ISO日期 |
| weight_kg | REAL | 定期回填，供 `tdee.js` 計算7日移動平均 |

### 3.3 `tdee_calibration_log`（新增，v4.0）
| 欄位 | 型別 | 說明 |
|---|---|---|
| week_start_date | TEXT PK | 該週週一 |
| weight_trend_7d_avg | REAL | 7日體重移動平均 |
| estimated_tdee | REAL | 校正後 TDEE |
| target_kcal | REAL | 校正後每日預算，UI直接顯示這個數字 |
| calibration_note | TEXT | 內部除錯用（例如「體重連續2週未如預期下降，下修200kcal」），**不對使用者展示逐項運動明細** |

### 3.4 `protein_sources` / `staples` / `sauce_methods`（新增，v4.0，取代 `recipes`；2026-09-25 新增第4軸「蔬菜」，取自 `raw_ingredients.json` 的 `category=蔬菜`）
四軸各自一張小表：`id`、`name`、`kcal_100g`/`protein_100g`/`carb_100g`/`fat_100g`/`fiber_100g`（或每份標準克數的營養值）、`diet_tags`、`allergen_tags`、`prep_tier`（🟢/🟡/🔴，該軸帶來的備餐難度貢獻）。「蔬菜」軸沒有獨立的 JSON 檔，直接從 `raw_ingredients.json`（3.7節）篩 `category === "蔬菜"` 取得（目前 4 種：花椰菜/菠菜/芹菜/春筍）。

### 3.5 `recipe_templates`（模板組合，可即時生成或預先展開存表）
| 欄位 | 型別 | 說明 |
|---|---|---|
| id | TEXT PK | `{protein_id}_{staple_id}_{vegetable_id}_{sauce_id}`（2026-09-25 新增 vegetable_id） |
| slot | TEXT | 'breakfast'/'main'/'snack' |
| tier | TEXT | 由四軸最高難度決定 |
| kcal / protein_g / carb_g / fat_g / fiber_g | REAL | 四軸加總計算（依各軸假設份量換算，見 4.5 節） |
| diet_tags / allergen_tags | TEXT | 四軸聯集 |

### 3.6 `recipe_feedback`（新增，v4.0，供 5.5節評分+降權排序）
| 欄位 | 型別 | 說明 |
|---|---|---|
| recipe_template_id | TEXT PK | |
| rating | TEXT | 'like' / 'dislike' / null(未評分) |
| last_shown_date | TEXT | 用於「近期出現降權」 |
| shown_count | INTEGER | |

### 3.7 `raw_ingredients`（原型食材，27項，同 v3.1；2026-09-25 起其中 `category=蔬菜` 的 4 項（花椰菜/菠菜/芹菜/春筍）補上 `diet_tags`/`allergen_tags`/`prep_tier`，供 `recommend.js` 當第4軸使用）
### 3.8 `taiwan_items`（台式熱門排行榜，50項，`kcal_low/kcal_high/kcal_rep`；原 v3.1 早/午/晚/宵夜 40 項，2026-09-25 新增飲料/西式速食類共 10 項，補上手搖飲料與連鎖速食的缺口，見 PRD「尚待解決問題」新增項）。**2026-09-25 再次修訂**：正式併入「今日建議」推薦候選池（4.5 節），新增 `allergen_tags`（過敏原）、`protein_g`/`fiber_g`（估算值）、`uses_flex`（是否消耗週彈性點數，15筆大餐類為`true`，其餘35筆日常品項為`false`）三種欄位；資料改由 `database.js` 的 `getTaiwanItems()` 直接 fetch `data/taiwan_items.json` 並快取（不再依賴從未被寫入過的 IndexedDB `taiwan_items` store，這是修正過去的既有 bug，見 4.6 節）。
### 3.9 `custom_foods`（個人自訂，同 v3.1；2026-09-25 起接上 UI，欄位：`id`/`name`/`kcal`/`protein_g`/`fiber_g`，讓使用者在「預約大餐」找不到對應台式品項時自行輸入）

### 3.10 `daily_log`（實際攝取記錄）
| 欄位 | 型別 | 說明 |
|---|---|---|
| id | TEXT PK | |
| log_date / slot | — | |
| source_type | TEXT | 'recipe_template'/'taiwan_item'/'custom' |
| item_id / item_name | — | |
| kcal / protein_g / carb_g / fat_g / fiber_g | REAL | |
| is_feast | INTEGER | 0/1 |
| feast_reservation_id | TEXT NULL | 若由預約轉正式記錄，關聯 3.11 |
| uses_flex | INTEGER NULL | **（2026-09-25 新增）** 0/1，這筆記錄當初是否消耗了週彈性點數（依來源的 `uses_flex` 判斷，見 3.8/3.9/4.6 節），`undoDailyLog()` 撤銷時要看這個欄位決定要不要把點數退回 `weekly_flex_ledger` |

### 3.11 `feast_reservation`（新增，v4.0，取代舊 flex_quota_log 的預約角色）
| 欄位 | 型別 | 說明 |
|---|---|---|
| id | TEXT PK | |
| plan_date / slot | — | slot 現支援 5 種：breakfast/lunch/afternoon_tea/dinner/snack（2026-09-25 新增 afternoon_tea） |
| size | TEXT NULL | 'S'/'M'/'L'，對應概略估算 kcal（見 `FEAST_SIZE_KCAL` 常數，S=400/M=700/L=1200）。**2026-09-25 起改為選填**，選了 `item_id` 就不需要 size |
| item_id | TEXT NULL | **（2026-09-25 新增，命名比照 3.10 `daily_log` 的 `item_id`）** 若使用者選了實際品項（而非小/中/大概略份量），存對應的 id——可能來自 `taiwan_items.id` 或 `custom_foods.id`（兩者 id 前綴不重疊，查詢時兩個 store 都查一次即可判斷來源，不用另存 `source_type`） |
| item_name | TEXT NULL | **（2026-09-25 新增）** 對應品項的顯示名稱（`taiwan_items.name` 或 `custom_foods.name`），畫面上顯示用 |
| estimated_kcal | REAL | 有 `item_id` 就用該品項的代表熱量（`taiwan_items.kcal_rep`，無則取 `kcal_low`/`kcal_high` 中間值；或 `custom_foods.kcal`）；否則依 size 換算或使用者微調 |
| uses_flex | INTEGER | **（2026-09-25 新增）** 同 3.10，這筆預約是否消耗彈性點數：`taiwan_items` 依資料裡的 `uses_flex`；`custom_foods` 跟純 size 估算固定為 1（使用者主動走這個流程，視為額外餐點） |
| status | TEXT | 'reserved' / 'confirmed' / 'cancelled' |
| daily_log_id | TEXT NULL | confirmed 後關聯 3.10 |

### 3.12 `weekly_flex_ledger`（新增，v4.0，取代舊 flex_quota_log 的額度角色）
| 欄位 | 型別 | 說明 |
|---|---|---|
| week_start_date | TEXT PK | |
| cap_kcal | REAL | 依 goal_mode 與熱量赤字換算的週彈性點數上限，**與運動無關** |
| used_kcal | REAL | 已確認的 feast + 台式原版選擇累計消耗點數 |

### 3.13 `overage_smoothing_log`（新增，v4.0）
| 欄位 | 型別 | 說明 |
|---|---|---|
| id | TEXT PK | |
| origin_week_start_date | TEXT | |
| overage_kcal | REAL | 超出週彈性點數的量 |
| smoothing_days | INTEGER | 1–3 |
| daily_cap_pct | REAL | ≤15% |
| applied_dates_json | TEXT | 已攤還到哪幾天，避免重複扣 |
| resolved | INTEGER | 0/1 |

### 3.14 `exercise_log`（獨立追蹤，v4.0；2026-09-25 修訂）
| 欄位 | 型別 | 說明 |
|---|---|---|
| id | TEXT PK | |
| log_date / activity_type / duration_min / intensity | — | 供成就系統與 `tdee.js` 週校正輸入 |

**2026-09-25 修訂**：`activity_type` 改用常用項目下拉選單（散步/快走/慢跑/腳踏車/游泳/羽毛球/籃球/重訓/瑜伽/其他）。

**2026-09-25 第二版修訂（取代第一版的 MET×體重×時長 kcal 估算，理由見 PRD 2.2 節）**：完全不用 kcal 當單位，改用 WHO/ACSM 的時間與強度指標，**不存進資料表、不需要 `profile.weight_kg`**，每次顯示時用當週 `exercise_log` 即時算出來：
```js
const WEEKLY_ACTIVITY_TARGET = { moderateMinutes: 150, strengthDays: 2 }; // WHO/ACSM 一般性建議，跟 goal_mode 脫鉤
const INTENSITY_MULTIPLIER = { "低": 0, "中": 1, "高": 2 }; // 低強度不計入累計分鐘，另外顯示「輕度活動」
```
- 每筆紀錄依 `intensity` 算入本週「等效中等強度分鐘數」（`duration_min × INTENSITY_MULTIPLIER[intensity]`），`activity_type === "重訓"` 的紀錄改成算「本週不重複的紀錄天數」，不併入分鐘數。
- 運動紀錄頁顯示「本週已活動 X 分鐘・肌力訓練 Y 天」＋進度條，達標給正向文案；未達標**只顯示目前進度，不寫「還差 Z」這種缺口式文案**。
- 低強度紀錄不計入 150 分鐘目標，但另外顯示「本週輕度活動 X 分鐘」，避免使用者覺得低強度活動「白做」。
- 這些數字**完全不寫回 `daily_log`、不影響 `weekly_flex_ledger`／`budget.js`／`recommend.js`／`feast.js` 的任何計算**，架構上跟飲食/熱量預算隔離；因為徹底不使用 kcal 當單位，也杜絕了使用者拿運動頁的數字去對照飲食頁 kcal 做心算式換算的可能性（這是撤回第一版 kcal 設計的主因，純架構隔離不足以避免使用者心理層面的換算）。

### 3.15 `settings`（key-value）
存放小設定，例如 feast size→kcal 對照表、資料版本號。

---

## 4. 核心模組介面定義

### 4.1 `engine/nutrition.js`
```js
function calculateTargets(profile) {
  // 回傳: { bmr, tdee, targetKcal, flooredWarning, protein_g, fat_g, carb_g, fiber_g, netCarb_g }
  // 僅作起點值，PRD 第3節1–6項
}
```

### 4.2 `engine/tdee.js`（新增）
```js
// 輸入：weight_log 近8週資料、daily_log 近8週熱量加總
// 回傳：{ weightTrend7d, estimatedTdee, targetKcal, note }
function calibrateWeeklyTdee(weightLogs, dailyLogs, profile) {
  // 邏輯對照 PRD 3.7節：7日體重移動平均 + 實際攝取回歸校正
  // 寫入 tdee_calibration_log，UI 只顯示 targetKcal，不顯示逐項運動明細
}
```

### 4.3 `engine/budget.js`（新增，取代原固定比例拆解）
```js
// 輸入：targetKcal(當週校正值)、今日已記錄的 daily_log
// 回傳：{ remainingKcal, perSlotSuggestion: {breakfast, lunch, dinner, snack} }
function recalcTodayBudget(targetKcal, todayLogs) {
  // 邏輯對照 PRD 5.1節：無記錄時用 25/35/30/10 預設值切分；
  // 每筆記錄寫入後，剩餘熱量重新分配給未吃餐次
}
```

### 4.4 `engine/matcher.js`（新增）
```js
// 輸入：本週 daily_log、profile
// 回傳：{ proteinGapToday, fiberGapThisWeek }
function checkHardConstraints(weekLogs, profile) {
  // 邏輯對照 PRD 5.6節：蛋白質日底線 1.6-2.0g/kg、纖維週日均 25-35g
  // 回傳值供 recommend.js 優先安排高蛋白/高纖組合
}
```

### 4.5 `engine/recommend.js`
```js
function getTodayRecommendation(remainingBudget, hardConstraints, preptimeToday, dietRestriction, allergens) {
  // 過濾 recipe_templates，依 recipe_feedback 的評分+近期降權排序
  // 優先滿足 matcher.js 回傳的蛋白質/纖維缺口
}
```

**份量換算（2026-09-25 初版，已於同日二輪重構取代，見下方「餐型骨架」）**：原本 `recommend.js` 內部依「蛋白質來源 130g／主食 150g／蔬菜 100g／醬料或烹調法 20g」全軸統一的假設份量換算（`PROTEIN_SERVING_G`/`STAPLE_SERVING_G`/`VEGETABLE_SERVING_G`/`SAUCE_SERVING_G` 常數）。這組常數已完全移除——不分生熟/乾濕重、不分食材種類的統一份量，會導致「130g乳清蛋白粉＋150g乾燕麥」這種單筆早餐就超過1000kcal的離譜結果。

**蔬菜軸（2026-09-25 新增，四軸笛卡爾積架構下）**：原本三軸（蛋白質×主食×醬料）組出來的餐點永遠沒有實際蔬菜份量。新增第4軸取自 `raw_ingredients.json` 的 `category=蔬菜`（花椰菜/菠菜/芹菜/春筍）。**這個「四軸無條件笛卡爾積」的架構已於同日二輪重構整個取代，見下方「餐型骨架」小節。**

**餐型骨架 `data/dish_archetypes.json`（2026-09-25 二輪重構，取代上面「四軸無條件笛卡爾積」的架構）**：

使用者實測抓到系統推薦「乳清蛋白粉＋燕麥片＋菠菜＋韓式泡菜」這種組合，追查後發現根因是四軸笛卡爾積本身不管「食材搭不搭」，只看數字湊配額——`protein_sources.json`/`staples.json`/`raw_ingredients.json`（蔬菜軸）/`sauce_methods.json` 這 4 個檔案的品項原本是從約 10 道具名種子食譜（附錄 A）拆解出來的，每個品項只在「它出自的那道食譜」裡驗證過合理性，笛卡爾積把它們重新自由排列組合後就會產生這種問題。經與 Opus 兩輪磋商（引用美國 MyPlate、台灣「我的餐盤」、日本食事バランスガイド的份量與搭配原則）後改版：

- **`dish_archetypes.json` 結構**：陣列，每筆一個餐型，`{id, name, protein:{allow:[ids]}, staple:{allow:[ids]}, vegetable:{allow:[ids]}, seasoning:{allow:[ids]}, methods:[ids], note}`。`allow` 是白名單（對照 id），空陣列代表這個餐型沒有這個槽位（例如 `bowl_oat` 早餐碗沒有 `vegetable`/`seasoning` 槽）。目前 5 個餐型：`bowl_oat`（早餐碗）/`egg_pan`（煎蛋類）/`protein_stir_fry`（炒類）/`grain_bowl_baked`（烤／舒肥定食）/`warm_salad`（溫沙拉），對照附錄 A 原本約 10 道種子食譜歸納而成。
- **組合只在餐型內部展開**：`recommend.js` 改成先 `axes.archetypes.forEach`，再對每個餐型分別做「該餐型允許的蛋白質 × 主食 × 蔬菜(含不加) × 醬料(含不加) × 烹調法」的巢狀迴圈，取代原本對全部 proteins/staples/vegetables/sauces 陣列做無條件笛卡爾積。蔬菜/醬料槽即使白名單非空，也一律多一個「不加」的選項（本來就是加分項不是必要項）。
- **`serving_g`/`nutrient_basis`/`serving_label`**：`protein_sources.json`（11筆）/`staples.json`（8筆）/`raw_ingredients.json` 蔬菜軸（4筆）/`sauce_methods.json` 的 `sm_kimchi`/`sm_teriyaki`（2筆）都補上這三個欄位，逐筆依真實食物份量人工填寫（例如雞胸肉生重130g、燕麥片乾重40g、糙米飯熟重150g），`nutrient_basis` 標示 `kcal_100g` 對應的狀態（`raw`/`cooked`/`dry`/`as_is`），避免生熟重混算。取代原本全軸統一的份量常數。
- **`sauce_methods.json` 加 `kind` 欄位**：`"method"`（純烹調法，免開火/微波/煎/炒/烤氣炸，`kcal_100g` 恆為0）vs `"seasoning"`（真的有熱量的醬料，韓式泡菜/照燒醬）——原本這兩種角色不同的東西混在同一軸，餐型骨架的 `methods` 只填 method 的 id，`seasoning.allow` 只填 seasoning 的 id，兩者不再互相干擾。
- **份量縮放邏輯（取代原本整餐等比縮放 0.7–1.3 倍）**：每個餐型指定一個「主要槽位」（有主食槽的用主食、沒有的用蛋白質，例如 `egg_pan` 沒有主食槽就用蛋白質當主要槽位），`achievableNutrition(combo, budget)` 只縮放這個槽位去貼近熱量配額，範圍限制在 `PRIMARY_SLOT_SCALE_RANGE = {min:0.5, max:2.0}`（約半份到兩份）；蔬菜與非主要蛋白質維持天然份量（`serving_g`）不縮放。`score()` 的熱量貼近度評分也改用縮放後的「可達成熱量」而非天然份量的基準熱量，避免評分跟實際會顯示的熱量脫節。原本的候選前置篩選 `SCALE_MIN/MAX=0.7/1.3`（篩選前的硬性排除）已完全移除，改成全部交給縮放+評分處理，避免「篩選」與「縮放」兩套機制各自為政、互相打架。
- **乳清蛋白粉移出正餐候選池**：`protein_sources.json` 的 `ps_whey` 新增 `item_class: "supplement"`，且不出現在任何餐型的 `protein.allow` 白名單裡——不是資料庫刪除，是候選池生成階段直接不會被選中。這輪**不提供任何開關讓乳清出現**（例如綁 `profile.goal_mode`），因為 `goal_mode` 的列舉值本身中英文混用（`matcher.js` 判斷 `"bulk"`、`nutrition.js` 轉小寫查 `"maintain"`），且「目標是減脂/增肌」跟「有沒有在喝乳清」是意圖與行為兩件不能劃等號的事；之後若使用者反映需求，再另外設計 opt-in 欄位。
- **同一天各時段不重複主蛋白質/餐型**：`getTodayRecommendation()` 內用兩個物件 `usedProteinNames`/`usedArchetypeIds` 依 `SLOTS` 處理順序（早→午→下午茶→晚→宵夜）累積，後面時段的候選池會排除已出現過的 `protein_name`/`archetype_id`（只影響自組食譜，`is_composed` 為 true 才檢查；超商/台式外送不受影響）。這條規則可能讓後面的時段因為候選池被排除到只剩 0 筆而回報「暫無適合的組合」，這是刻意的取捨（不為了硬湊而犧牲多樣性）。
- **已知限制/延後項目**：水果軸未納入（不影響一餐是否合理，優先度較低）；`sm_microwave` 微波整塊生肉的中心溫度風險未處理（P0 這輪只擋「免開火」配生鮮/需煮熟食材）；`raw_ingredients.json` 跟 `protein_sources.json`/`staples.json` 部分品項（雞胸肉/雞蛋/板豆腐/糙米飯/燕麥片/地瓜/南瓜）數值重複存在兩處，尚未收斂成單一權威來源，之後修改其中一份營養值時要記得同步。

**超商即食品項（2026-09-25 新增，2026-09-25 second pass 改版，`data/convenience_items.json`）**：欄位 `id`/`name`/`category`/`kcal`/`protein_g`/`carb_g`/`fat_g`/`fiber_g`/`tier`/`diet_tags`/`allergen_tags`/`note`，**跟四軸組合不同，是固定套裝值，不套用 `PROTEIN_SERVING_G` 等份量換算**。`recommend.js` 的 `loadAxes()` 多讀這個檔案，組合完四軸笛卡爾積後，直接把這些品項也 push 進同一個 `combos` 陣列（`is_convenience: true`，四軸組合是 `is_convenience: false`），一起進入後面的 tier/過敏原/飲食限制篩選與 `score()` 評分——不是另開分支或另一個推薦來源。目前 35 筆，分 10 類（`category`：飲品/沙拉/健身餐盒/蔬食餐盒/減醣餐盒/蛋白質單品/原型主食/連鎖健康餐盒/宅配健身餐/蛋白飲點心棒；2026-09-25 分三批資料陸續補上：超商即食單品→健身餐盒/蔬食/減醣主食→連鎖健康餐盒品牌與宅配健身餐），**改用真實市售品牌與產品名稱**（統一陽光/義美/光泉/OATLY/萬歲牌/全家健身G肉餐盒等）——這是使用者提供的實測營養數據（2026-09-25），比先前版本的通用估算值精確，尤其纖維量差異很大（例如高纖豆漿纖維量普遍在9–10g，遠高於先前估算的4g）。跟 `taiwan_items.json` 手搖飲/速食類「刻意不寫品牌」的原則不同：這裡是個人自用資料、且數據來源是使用者自己提供的實測值，直接沿用品牌名稱以利辨識實際商品，不算前述原則的例外違反（那條原則是針對「找不到來源、怕誤導」的估算值）。部分品項的 `carb_g`/`fat_g` 未提供（原始資料只給熱量/蛋白質/纖維），存 `null`，不要自己估算填入。

**超商品項多品項組合（2026-09-25 新增）**：單一超商即食品項最高熱量約 500kcal，湊不滿午/晚餐常見的 700+ kcal 熱量配額（份量比對規則要求候選熱量落在配額的 70%–130% 之間）。改成允許「主餐＋1～2 個飲品/點心棒」的組合一起進入候選池（例如「全家健身G肉餐盒 ＋ 統一陽光高纖無糖豆漿」）：
- `convenience_items.json` 的 `category` 分成兩組：`EXTRA_CATEGORIES = {"飲品":true, "蛋白飲/點心棒":true}` 是「配角」，其餘（健身餐盒/連鎖健康餐盒/蔬食餐盒/減醣餐盒/沙拉/蛋白質單品/原型主食/宅配健身餐）是「主餐」。
- 只生成「主餐＋1個配角」「主餐＋2個配角」的組合，**不生成「兩份主餐疊在一起」或「純配角湊兩三份」**，避免不合理的組合（兩個正餐盒、或三瓶飲料當一餐）。
- `toConvenienceCombo(items)` 共用函式把多個品項的熱量/巨量營養素加總、`tier` 取最高難度、`diet_tags`/`allergen_tags` 取聯集，`id`/`name` 用 `+`／`＋` 串接，回傳的形狀跟單一品項、四軸組合完全一致，一樣進同一個 `combos` 陣列跟 `score()` 排序，不是另開分支。

**時段來源偏好（2026-09-25 三輪修訂後最終版，取代前兩版的「早午餐超商加權」與「用餐風格偏好」）**：`getTodayRecommendation(remainingBudget, hardConstraints, mealPrefs, dietRestriction, allergens, flexLedger)` 的第 3、6 個參數是這版新增/改變的：
- `mealPrefs`：`profile.meal_prefs`，物件 `{breakfast, lunch, afternoon_tea, dinner, snack}`，每個值是 `window.MEAL_SOURCE_OPTIONS = ["auto","convenience","delivery","cook_quick","cook_full"]` 其中之一。缺欄位或值不合法時，`getSourcePref()` 用 `window.DEFAULT_MEAL_PREFS`（`{breakfast:"convenience", lunch:"convenience", afternoon_tea:"auto", dinner:"cook_full", snack:"auto"}`）補上，取代原本 `preptimeToday`（全域一個值）的角色。
- `flexLedger`：本週 `weekly_flex_ledger`（`{cap_kcal, used_kcal}`），用來算 `flexRemaining`，決定「大餐類」台式品項是否還有額度可推薦（見下方）。
- **`filterBySource(candidates, sourcePref)`：硬性篩選，不是加分**——`convenience` 只留 `is_convenience`、`delivery` 只留 `is_delivery`、`cook_quick`/`cook_full` 只留自組食譜（差別在 `tier_rank` 上限）、`auto` 不篩。篩完是空的（但篩選前的候選池不是空的），才 fallback 回篩選前的候選池；**fallback 池會排除 `is_delivery` 的候選，除非使用者選的來源本來就是 `delivery` 或 `auto`**，避免使用者沒選外送卻被意外推薦、進而誤扣彈性點數。`result[slot].fallback_to_auto` 標記這個情況，UI 要顯示「{來源}中沒有符合今日配額的選擇，改為一般推薦」。
- 已完全移除前兩版的 `CONVENIENCE_BIAS_SLOTS`/`BIAS_SCORE`/`MEAL_STYLE_OPTIONS`/`matchesBias`/`combo.is_whole_food_style`，`score()` 恢復成原本單純的「回饋+蛋白質/纖維缺口+熱量貼近度」，不再有任何加分邏輯跟來源綁定——來源篩選在 `score()` 之前就做完了。
- **profile 舊資料遷移**：`prep_time_weekday`/`prep_time_weekend`/`meal_style_preference` 三個舊欄位廢除不再讀取（`meal_style_preference` 經確認從未真正接上引擎，沒有任何使用者資料用到它，不用特別遷移）。沒有 `meal_prefs` 的舊 profile，`getSourcePref()` 的預設值 fallback 邏輯會直接套用 `DEFAULT_MEAL_PREFS`，不做舊備餐時間值的精細換算（簡化的遷移策略：接受預設值可能跟使用者舊設定的下廚意願不完全一致，換取不用維護一套容易出錯的換算規則；使用者下次進基本資料分頁看到新的逐時段設定就能自行調整）。

**台式熱門品項併入候選池，視為「外送」來源（2026-09-25 新增）**：
- `loadAxes()` 呼叫全域 `getTaiwanItems()`（`database.js` 已修正為直接 fetch `data/taiwan_items.json` 並快取，見 3.8 節；`recommend.js`／`feast.js`／`tab-ledger.js` 現在共用同一份資料，不會有版本不同步的問題）。
- **資料品質修正**（Opus 審查抓到的 3 個阻斷問題，已修正）：
  1. 50 筆全部補上 `allergen_tags`（過敏原字彙擴充 `黃豆`/`魚`/`芝麻`，跟 `convenience_items.json` 一致）、`protein_g`/`fiber_g`（依常見營養資料估算）、`uses_flex`（詳下）。
  2. 組成 combo 時 `tier` 統一指定 `"🟢"`（不讀 JSON 裡沒有的欄位，也不受 `prep_tier` 缺失影響）——外送品項對使用者來說零烹調成本，這是刻意的設計，不是 bug。
  3. `database.js` 的 `applyFilter()` 過敏原判斷原本 `filter.excludeAllergens && item.allergen_tags` 這個短路寫法，會讓完全沒有 `allergen_tags` 欄位的品項在使用者設定過敏原時直接放行；已修正成「使用者有過敏限制、品項缺過敏原資料 → 保守排除」。
- **`uses_flex`**：`taiwan_items.json` 新增欄位，`true` 的 15 筆是「大餐類」（鹹酥雞、串燒燒烤、派克炸雞排、甜湯豆花、火鍋、夜市小吃、珍珠奶茶、手搖水果茶、西式速食5項），選中/記錄這些品項才會消耗週彈性點數；其餘35筆（無糖豆漿、地瓜、健康餐盒等日常可接受品項）`uses_flex=false`，走一般每日熱量預算，不動彈性點數——維持 PRD 5.1 節「早餐都走健康模板」的精神。
- **熱量太不精準的品項不進推薦池**：沒有 `kcal_rep`、且 `kcal_high/kcal_low ≥ 1.5` 倍的品項（`isTooWideRange()`），熱量區間太寬（例如「家常菜（熱炒）」200–1100kcal），當成「精準建議」推出來會嚴重誤導，排除在推薦候選外（仍可在「台式熱門品項參考」／預約大餐/直接記錄使用，那邊本來就是給使用者自己抓大概）。
- **時段對照**：`TAIWAN_CATEGORY_SLOTS` 沿用 `tab-ledger.js` 的 `SLOT_TO_TAIWAN_CATEGORY` 精神（早餐→breakfast、午餐→lunch、晚餐→dinner、宵夜→snack、飲料→afternoon_tea），另外「西式速食」對照到 `[lunch, dinner]`（原本沒有對照，50筆裡的5筆西式速食會進不了推薦池，這輪一併補上）。
- **彈性點數額度檢查**：`flexRemaining = flexLedger.cap_kcal - flexLedger.used_kcal`（沒有 `flexLedger` 資料時視為無限制，例如尚未計算過目標的新使用者）；候選是 `is_delivery && uses_flex` 且 `kcal > flexRemaining` 時直接排除，不會推薦使用者已經沒有額度負擔的大餐類外送。
- **id 前綴**：combo 的 `id` 是 `"tw_" + taiwan_items.id`（例如 `tw_ln01`），額外存 `source_id`（原始 id）供之後呼叫 `logFeastDirectly(planDate, slot, null, source_id)` 記錄用，避免跟其他候選池的 id 撞號。
- **`protein_sources.json`/`staples.json` 過敏原補正**：Opus 審查也發現既有三軸資料裡「毛豆仁」「無糖豆漿」「板豆腐」缺「黃豆」標籤、「鮭魚」「鯛魚」缺「魚」標籤（`unionTags` 遇到缺過敏原標記的原始食材不會主動補上，這幾筆是標記時的疏漏），已一併修正。
- **效能**：`getAllRecipeFeedback()`（`database.js` 新增，用 localforage `iterate` 一次撈全部 `recipe_feedback`）取代原本逐一 `getRecipeFeedback(id)`，避免逐筆讀取 IndexedDB 的效能問題。**（2026-09-25 二輪重構後更新）** 改用餐型骨架後候選池規模大幅縮小（組合只在每個餐型內部展開，不再是全域自由笛卡爾積），Node 模擬測試 3 種情境（無偏好/cook_full/cook_quick，含硬性篩選/fallback/過敏原/彈性點數額度不足/食安免開火過濾/同日多樣性）都符合預期，單次呼叫約 40ms，效能無虞。
```

### 4.6 `engine/feast.js`（新增，取代舊 flex.js 的運動換算函式；2026-09-25 大幅擴充；2026-09-25 二輪重構）
```js
// resolveFeastItem(itemId, size)：共用的品項解析函式，reserveFeast/logFeastDirectly/confirmFeast 都呼叫它，
// 回傳 { kcal, name, sourceType, protein_g, carb_g, fat_g, fiber_g }。
// 2026-09-25 修正：taiwan_item 來源現在也回傳 protein_g/fiber_g（原本只有 custom 食物有）。
// 2026-09-25 二輪重構：移除回傳值裡的 usesFlex——彈性帳本改成逐日結算，不用再幫食物分「會不會扣點數」。
async function resolveFeastItem(itemId, size) { /* ... */ }

async function reserveFeast(planDate, slot, size, itemId) {
  /* 寫入 feast_reservation，狀態 reserved。2026-09-25 二輪重構：不再占用 weekly_flex_ledger
     （帳本已經是逐日結算算出來的），tab-today.js 的 buildRecommendation() 會把當天「reserved」
     狀態的預約當成暫時記錄餵給 recalcTodayBudget，讓其他時段配額提前反映 */
}
async function logFeastDirectly(planDate, slot, size, itemId) {
  /* 不經過 feast_reservation，直接寫 daily_log（is_feast:1, feast_reservation_id:null）。
     2026-09-25 二輪重構：不再更新 weekly_flex_ledger，daily_log 寫進去之後隔天結算自然算得到 */
}
async function undoDailyLog(dailyLogId) {
  /* 撤銷一筆 logFeastDirectly 產生的記錄——刪除該筆 daily_log。2026-09-25 二輪重構：不用再退點數。
     已知限制：如果撤銷的是「已經結算過」的舊日期記錄，差額不會反映在過去已結算的週數字上
     （結算游標只往前走，這輪不支援回溯重新結算，範圍外）*/
}
async function confirmFeast(reservationId, actualDailyLogEntry) {
  /* 狀態改 confirmed，寫入實際 daily_log。2026-09-25 修正既有 bug：改用 resolveFeastItem 查回
     protein_g/carb_g/fat_g/fiber_g 當預設值（原本 UI「確認」按鈕不帶 actualDailyLogEntry 時，
     這幾個欄位全是 undefined，導致週總覽的蛋白質/纖維永遠是0）。2026-09-25 二輪重構：不再更新 ledger */
}
async function cancelFeast(reservationId) { /* 狀態改 cancelled。2026-09-25 二輪重構：不用再退點數（本來就沒扣過）*/ }

// 2026-09-25 二輪重構新增：逐日結算彈性帳本，取代舊的「食物標籤即時扣款」設計（PRD 6.2節）。
// safetyFloorFor(profile)：女1200/男1500，同 nutrition.js calculateTargets() 的安全下限。
function safetyFloorFor(profile) { /* ... */ }

// 結算「一天」：目標 vs 實際攝取。當天開啟的時段全部有記錄 → 用真實總量；
// 只要有時段沒記錄 → 假設沒記錄的部分照計畫吃（=目標），已記錄部分若已超標則如實反映。
// 回傳 { deposit, overage }：deposit 是可以存回額度的量（已套用15%單日上限+安全下限保護），
// overage 是超標量；兩者恰好一個非零（同一天不可能又存款又超標）。
async function computeDaySettlement(dateStr, profile, targetKcal) { /* ... */ }

// 用 settings（key='ledger_last_settled_date'）存一個跨週的結算游標，每次呼叫從游標隔天
// 補到「昨天」為止（今天還沒過完不結算）。第一次呼叫（沒有游標）直接把游標設到昨天，
// 不會回頭清算使用者過去所有歷史資料。tab-today.js/tab-ledger.js 進分頁時都會呼叫一次，
// 已經結算過的日子會被游標跳過，重複呼叫是安全的（idempotent）。
async function settleWeeklyLedger(profile) { /* ... */ }

// 2026-09-25 二輪重構：全專案目前沒有任何地方呼叫 planOverageSmoothing，維持既有狀態不變動——
// 6.2節新的逐日存款規則已經涵蓋「超額緩慢消化、不強制單日補回」的核心精神，這個函式暫不啟用。
function planOverageSmoothing(overageKcal, upcomingDaysBudget, safetyFloor) { /* ... */ }
```

### 4.7 `database.js` 相關修正（2026-09-25，Opus 審查發現的既有 bug）
- **`getTaiwanItems()`**：原本讀 IndexedDB 的 `taiwan_items` store，但全專案從沒有任何程式碼寫入過這個 store，過去一直回傳空陣列——「台式熱門品項參考」畫面因此從未真的顯示過資料，`feast.js` 的品項查找也一直失敗、只能回退成小/中/大估算。改成直接 fetch `data/taiwan_items.json` 並在記憶體快取（跟 `recommend.js` 讀 `protein_sources.json` 等種子檔的做法一致），不再經過 IndexedDB。
- **`applyFilter()` 過敏原判斷**：原本 `filter.excludeAllergens && item.allergen_tags` 的短路寫法，會讓完全沒有 `allergen_tags` 欄位的品項在使用者設定過敏原時直接放行（因為整個條件式是 `false`，根本不會執行過濾）。已修正成「使用者有過敏限制、品項缺過敏原資料 → 保守排除」。
- **新增 `removeDailyLog(id)`**：原本整個專案沒有任何刪除 `daily_log` 的函式，`undoDailyLog()` 撤銷功能需要它。
- **新增 `getAllRecipeFeedback()`**：用 localforage 的 `iterate()` 一次撈出全部 `recipe_feedback`，取代 `recommend.js` 原本逐一 `getRecipeFeedback(id)` 呼叫（候選池變大後效能考量，見 4.5 節）。

### 4.7 `engine/shopping.js`
（同 v3.1，輸入來源改為 recipe_templates 展開後的食材清單）

### 4.8 `database.js`（對外函式）
```js
async function getProfile() / saveProfile(profile)
async function addWeightLog(entry) / getWeightLogs(dateRange)
async function getTdeeCalibration(weekStartDate) / saveTdeeCalibration(entry)
async function getRecipeTemplates(filter) / getRecipeFeedback(id) / saveRecipeFeedback(id, rating)
async function getRawIngredients()
async function getTaiwanItems(filter)
async function getCustomFoods() / addCustomFood(food)
async function addDailyLog(entry) / getDailyLogs(dateRange)
async function reserveFeast(entry) / updateFeastStatus(id, status, daylogId)
async function getWeeklyLedger(weekStartDate) / updateWeeklyLedger(weekStartDate, usedKcal)
async function addOverageSmoothing(entry) / getOverageSmoothing(weekStartDate)
async function addExerciseLog(entry) / getExerciseLogs(dateRange)
async function getSetting(key) / setSetting(key, value)
```

---

## 5. 開發階段

| 階段 | 內容 | 完成標準 |
|---|---|---|
| **Phase 1（網頁版，主線）** | 純網頁 + IndexedDB，六個分頁（基本資料/今日建議/週彈性帳本/本週總覽/運動紀錄/採買清單）全部可跑，手機/電腦瀏覽器都能用 | 輸入資料→算出目標→看到今日推薦→預約一次大餐→確認記錄→看到帳本更新；在手機 Safari/Chrome 打開網址操作一輪不跑版 |
| **Phase 1.5（PWA 化，選用）** | 加 `manifest.json` + `service-worker.js`，讓 iOS/Android 都能「加入主畫面」，離線也能開啟（IndexedDB資料本來就在本機，不受影響） | 加入主畫面後圖示/名稱正確，關閉網路仍能開啟App殼（資料照常讀取本機） |
| **Phase 2+（暫不排入）** | 超商即食品資料庫、拍照辨識、穿戴裝置資料匯入、Firebase 雲端同步（若要跨裝置/防資料遺失才需要，屆時才引入 `user_id` 與後端） | 依需求另立規格 |

---

## 6. 種子資料來源

`data/*.json` 內容直接從 `輕盈計畫PRD_v4.0.md` 對應章節轉錄，不要自己編：
- `protein_sources.json` / `staples.json` / `sauce_methods.json` ← PRD 附錄A 模板種子範例拆解出前三軸；第4軸「蔬菜」共用下面的 `raw_ingredients.json`，不用另建檔案
- `raw_ingredients.json` ← PRD 4.4節（27項）
- `taiwan_items.json` ← PRD 4.3節（50項，含飲料/西式速食新增類別）

`fiber_g` 若 PRD 未提供數值，寫 `null`，不要自己估算填入。
