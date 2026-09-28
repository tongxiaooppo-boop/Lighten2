# zaofang-local-recipes-main 分析報告

## 0. 摘要卡

| 項目 | 值 |
|---|---|
| 專案定位 | 本地優先、無帳號無雲端的中文菜譜 App（PWA + Capacitor/Android），CRUD 菜譜、規則式推薦搭配、可選 AI 生成菜譜/圖片辨識 |
| 專案類型 | 架構參考型 |
| 技術棧 | Next.js 16（vinext/Vite RSC）+ React 19 + IndexedDB（純前端）+ Capacitor 8（Android）+ fflate（ZIP）+ Cloudflare Worker（僅作 AI API Key 代理與圖片優化，非資料庫） |
| 對 Lighten2 的價值等級 | 中 |
| 最大亮點 | ZIP 串流備份/還原機制（`app/lib/backup.ts`）設計嚴謹：manifest+data.json+images 分離、增量寫入不爆記憶體、Android 端另有分塊寫入 Native Plugin，直接對應 B-3 平行線的實作範本 |
| 最大缺口/風險 | 「人數」只決定**推薦道數**（people+1），完全不做**份量縮放**——UI 明文寫死「用量按原菜谱记录，不随推荐人数自动换算」（`RecipeApp.tsx:726`），這跟 Lighten2 PRD 5.2「一人一盤、份量按人數放大」的核心需求方向不同，不能直接對照 |

## 1. 架構總覽

```
輸入：使用者填菜譜（食材/步驟/口味/標籤/餐次）或 AI 生成草稿（圖片/文字 → LLM → 草稿）
  ↓
處理：
  - CRUD：app/lib/recipe-library.ts 操作 Recipe 物件
  - 推薦：app/lib/recommendation.ts 純函式，依 meal/flavors/tags 打分排序
  - 營養估算：app/lib/nutrition.ts 用 IngredientfoodId 對照 USDA 本地表算加總
  - 圖片：HEIC 轉檔（Android 原生 → Canvas → heic2any 三層 fallback），Blob 直接存 IndexedDB
  ↓
儲存：app/lib/storage.ts，純 IndexedDB（DB_NAME=zaofan-local），4 個 store：recipes / settings / history / logs
  ↓
輸出／畫面：app/components/RecipeApp.tsx 單一巨型元件驅動全部 UI；
匯出：app/lib/backup.ts 串流 ZIP（manifest.json + data.json + images/*）；
PWA：public/sw.js 做 shell cache-then-network + fallback；
Android：capacitor/ + android/ 打包，NativeBackupFile plugin 負責原生檔案分塊寫入
```

worker/index.ts、db/schema.ts、drizzle/、examples/d1/ 是 vinext 官方模板殘留的**未啟用**雲端範例（`db/schema.ts` 內容僅為註解「Intentionally empty by default... Add Drizzle tables here when the site actually needs a database」），worker 唯一實際用途是代理 AI API 請求（隱藏 API Key）與圖片優化，**不構成雲端資料庫**，`RecipeApp.tsx` 只 import `lib/storage`，兩套實作互不呼叫。這點呼應 skill 的「多套平行實作」提醒——確認過後排除，不誤判為雲端同步層。

## 2. 資料模型（跟我們對照）

| 專案資料結構 | 位置 | 對照 Lighten2 |
|---|---|---|
| `Recipe`（含 `ingredients: Ingredient[]`、`meals`、`flavors`、`tags`、`dietType`） | `app/lib/types.ts:34-51` | 對照 `custom_foods` / 餐型骨架概念，但無「角色」「軸」分類，是扁平標籤系統，跟 Lighten2 的 `axis`/`allow` 骨架不同層級 |
| `Ingredient`（`grams?`, `foodId?`, `nutritionMatch: "confirmed"\|"suggested"\|"unmatched"`） | `types.ts:6-16` | 對照 MealContent 的 `ingredient` 元件；`nutritionMatch` 的三態設計（已確認/建議/未匹配）值得參考，跟 Lighten2「未確認一律保守排除」的 optimistic-fail-safe 精神一致，但這裡是「顯示提示」而非「排除」 |
| `NutrientValues`（`energyKcal/proteinG/carbohydrateG/fatG/fiberG/sodiumMg`） | `types.ts:20-27` | 對照 `protein_g/carb_g/fat_g/fiber_g`；**沒有飽和脂肪欄位**，Lighten2 PRD 有 `sat_fat_g` 需求，這點他們沒做 |
| `RecommendationRequest/Result`（`people/meal/flavors/tags` → `targetCount/recipes/shortage`） | `types.ts:55-67` | 對照今日建議引擎輸出，但無「型態」「硬性過濾」「預算」概念 |
| `AppSettings.nutrition.estimatePeople`（預設 2，用途見第 3 節） | `types.ts:29-32` | 不對應 `household_size`——這是 AI 生成時「猜克數」用的假設人數，跟推薦引擎的 `people` 是兩個獨立欄位，互不影響 |
| `BackupManifest`（`format/version/recipeCount/imageFiles`） | `types.ts:106-113` | 對照 B-3 匯出/匯入需要的 manifest 設計 |
| IndexedDB stores：`recipes/settings/history/logs` | `app/lib/storage.ts:8` | 對照 Lighten2 的 IndexedDB stores 設計（`profile/meal_plan/daily_log/settings`），皆為 keyPath 單筆一個 key，風格一致 |

## 3. 核心邏輯（依錨點深挖）

### 3.1「按人數推薦道數」—— 只算道數，不算份量

`app/lib/recommendation.ts:33-70`：

```ts
const targetCount = request.people + 1;
```

UI 文案直接印出這條規則：`app/components/RecipeApp.tsx:961` — `<small>默认推荐 {people + 1} 道菜</small>`。

推薦邏輯本身是純打分排序（`scoreRecipe`，`recommendation.ts:3-12`）：
- 餐次不符直接 `-1` 淘汰（`recipe.meals.includes(request.meal)`）。
- 口味命中 +14/個、標籤命中 +10/個、近 5 次推薦歷史沒出現過 +8、菜譜完整（`!incomplete`）+4。
- 用 `seededTie`（`recommendation.ts:14-23`，FNV/xorshift 風格雜湊）做同分時的可重現隨機排序（給定 `salt` 可重播）。
- 取排序後前 `targetCount` 筆，不足則回傳 `shortage` 與提示文案。

**關鍵限制（也是最大缺口）**：`app/components/RecipeApp.tsx:726` 明文寫「用量按原菜谱记录，不随推荐人数自动换算」——`Recipe.ingredients` 沒有 base-servings 欄位，`recommendRecipes` 完全不碰 `Ingredient.grams`，人數只決定「選幾道菜」，不決定「每道菜份量隨人數放大」。這跟 Lighten2 PRD 2.0 第 5.2 節「一人一盤，份量依人數放大」的情境（`household_size` × `serving_g`）方向不同：這個專案假設的是「N 人吃 N+1 道共食菜」的台式共食模型，而 PRD 已在第 8 節明確排除共食模型。**這個專案的推薦邏輯不能直接對照份量縮放需求，只有「用打分＋近期歷史去重＋可重播亂數」這個推薦框架本身可參考**。

### 3.2 本地營養估算

`app/lib/nutrition.ts:121-140`（`calculateRecipeNutrition`）：
- 逐 `Ingredient` 用 `foodId` 查 `foodById`（USDA 表，`nutrition.ts:24`），無 `foodId` 則用 `grams`/`amount+unit` 算，查不到食材直接跳過（`nutrients: undefined`），不會讓整筆計算報錯。
- 換算公式：`nutrients[key] = food.nutrients[key] * grams / 100`（每 100g 營養值換算），逐項加總 `totals`。
- `complete` 欄位：只有當「所有非空食材都有算出值」才算 `complete`，否則视为部分缺資料（`calculatedCount === ingredients.filter(...).length`）——**沒有 null 傳染機制**，缺資料的食材直接被忽略加總，總和會偏低但不會顯示警示，這跟 Lighten2 PRD「鈉/飽和脂肪部分缺資料要顯示『部分品項無資料』」的處理原則不同（[避坑]，見第 6 節）。
- `proteinDensity`：`totals.proteinG / totals.energyKcal * 100`，是這個專案特有的衍生指標（蛋白質密度），Lighten2 目前無此欄位，可列入 3.x 平行線的參考點子（不影響現有 Phase）。
- 中文食材名稱透過 `CHINESE_SEARCH_TERMS` 字典（`nutrition.ts:26-45`，約 60 組別名）做關鍵字對照英文 USDA 食品名，`searchFoods`/`suggestIngredientNutrition` 用簡單字串比對評分（完全相等 120、前綴 100、包含 80、全詞包含 60），非語意搜尋。

### 3.3 ZIP 本地匯出入機制

`app/lib/backup.ts` 全文即核心邏輯：
- `streamBackup`（29-128 行）：用 `fflate` 的 `Zip`/`ZipDeflate`/`ZipPassThrough` 建立串流 ZIP，分三部分寫入——`manifest.json`（`BackupManifest`：format/version/createdAt/recipeCount/imageFiles）、`data.json`（`recipes`（去除 `image` 欄位，換成 `imagePath`）＋`settings`＋`history`）、`images/<id>.<ext>`（每張圖用 `blob.stream()` 逐塊讀取寫入，`BACKUP_STREAM_CHUNK_BYTES = 256KB`）。
- 好處：不會把所有圖片一次載進記憶體再打包，適合手機環境；`sink` callback 讓呼叫端決定要寫進 Blob（Web）或呼叫 Android Native Plugin 分塊落地檔案（`app/lib/native-backup.ts:26-42`，`saveBackupWithAndroid`）。
- `parseBackup`（143-177 行）：還原時先驗證 `manifest.format==="zaofan-backup"`、`version===1`、`recipeCount===payload.recipes.length` 才繼續，圖片缺件直接丟錯（`缺少图片 ${imagePath}`），不會靜默產生殘缺菜譜。
- `streamUnzip`（179-239 行）：用 `fflate` 的 `Unzip`/`UnzipInflate` 邊讀邊解壓，用 `activeEntries` 計數＋`queueMicrotask` 偵測「輸入結束但還有未完成的 entry」來抓 ZIP 資料不完整的狀況，並拋出明確錯誤（`ZIP 数据不完整`），不是每個 unzip 實作都會做這一層防呆。
- Android 端 `app/lib/native-backup.ts`：`beginZip/appendZipChunk/finishZip/abortZip` 四段式介面，跟 Web 端共用同一份 `streamBackup` 產生的 bytes，只是 sink 換成呼叫原生 plugin 分塊寫檔＋最後核對 `expectedBytes`，失敗會呼叫 `abortZip` 清理暫存——這是「Web 與 Android 共用核心邏輯、只換底層 I/O」的乾淨模式，值得對照 Lighten2 未來若要做 Web + Capacitor 雙平台匯出時的介面切分方式。

### 3.4 純本地優先的資料結構設計

`app/lib/storage.ts`：
- 單一 IndexedDB 資料庫 `zaofan-local`，`DB_VERSION=1`，`openDatabase` 用 `onupgradeneeded` 建四個 store，`recipes`/`history`/`logs` 用 `keyPath:"id"`（一筆一個 key，跟 Lighten2 `daily_log` 的「一筆一個 key」設計理念一致），`settings` 是單一 key（`"app"`）存整包設定物件。
- `transact()`（37-57 行）統一包一層 `Promise` 化 IndexedDB 交易，並把所有錯誤轉成 `AppError("STORAGE", ...)`，這是簡單但乾淨的錯誤邊界收斂寫法。
- **完全沒有雲端同步層**——沒有帳號、沒有登入、沒有背景同步程式碼，`clearBusinessData()`（158-163 行）是唯一的「清空」操作，用於還原備份前或使用者主動清除。跟 Lighten2 目前的技術路線（純 IndexedDB、無多端同步）完全一致，代表這個專案**沒有「同步衝突怎麼解」的參考價值**（PRD 篩子問題 1 在此專案答案是「未做」，不是「做壞了」）。
- 圖片直接用 `Blob` 存進 `Recipe.image` 欄位（`types.ts:46`），IndexedDB 原生支援 Blob 存取，不用額外轉 base64——這點如果 Lighten2 未來有品項圖片需求（目前 PRD 明確排除，見 8. 圖片政策）可以參考，但目前不適用。

## 4. 資料可用性評估

- **欄位**：`energyKcal, proteinG, carbohydrateG, fatG, fiberG, sodiumMg`，每 100g 基準（`app/data/nutrition-foods.json`）。**無飽和脂肪欄位**。
- **筆數**：7,342 筆（`app/data/README.md:3`，與 `LOCAL_NUTRITION_DATA_INFO.count` 一致，`nutrition.ts:147-150`）。
- **來源**：USDA FoodData Central 的 Foundation Foods（2026-04-30）與 SR Legacy（2018-04）官方下載集，CC0 公共領域授權（`app/data/README.md:3-8`）——**授權完全開放，理論上可直接引用**。
- **語言/涵蓋範圍問題**：食品名稱全為英文（如 `"Abiyuch, raw"`, `"Acorn stew (Apache)"`），是美式飲食資料庫，涵蓋大量美國本土/移民社群食品（Alaska Native、Apache 等傳統食物），**對台灣飲食場景（便當、滷味、台式小吃、超商即食品）覆蓋率低**，專案自建 60 組中文別名字典（`nutrition.ts:26-45`）做橋接，但字典本身只涵蓋常見食材（雞蛋、雞胸肉、米飯等基礎詞彙），對台灣特有品項（滷肉飯、蔥抓餅等）無對照。
- **跟我們 `data/*.json` 的對照**：Lighten2 目前走 TFDA（台灣食品營養成分資料庫）路線（`collab/tfdb-2025-simplified.json` 已在專案內），TFDA 對台灣飲食場景覆蓋更準確、且已是決策路線（decisions.md 提及 TFDA 產生數值）。USDA 這份資料**不建議整批匯入**取代 TFDA，但因為 CC0 授權完全無限制，未來若要擴充「地中海/西式食材」品項或需要飽和脂肪以外的稀有營養素比對，可以當作**補充查詢來源**參考，不是 schema 或欄位設計上的參考重點——欄位設計本身（6 個營養素、每 100g 基準）跟 Lighten2 現有結構高度重疊，沒有新資訊。

## 5. 高價值模組/借鏡清單

- `app/lib/backup.ts`（`streamBackup`/`parseBackup`/`streamUnzip`）——ZIP 串流匯出入的完整實作，manifest+data+images 三段式結構、版本號驗證、資料筆數交叉驗證、ZIP 完整性偵測，是平行線 B-3「資料匯出/匯入」最直接可讀的參考範本。
- `app/lib/native-backup.ts`（`beginAndroidBackup`/`saveBackupWithAndroid`）——Web 與 Android 共用核心備份邏輯、只在 I/O 層抽換的介面切分方式，若 Lighten2 未來真的要 Capacitor 打包 Android 版，這是「不要為 Android 另寫一份匯出邏輯」的具體示範。
- `app/lib/images.ts`（`normalizeRecipeImageFile`）——HEIC 轉檔三層 fallback（Android 原生 → Canvas 解碼 → heic2any），每層失敗都收集 `failureSummary` 而不是直接報錯，這種「多層 fallback＋累積錯誤訊息供除錯」的寫法值得參考（雖然 Lighten2 目前無圖片功能）。
- `app/lib/recommendation.ts`（`seededTie`）——用雜湊函式做「同分時可重播的隨機排序」，如果 Lighten2 推薦引擎的快照比對（Phase −1a 的 `tools/diff-recs.js`）需要處理隨機排序但要求「逐字相同」的重播能力，這是一個簡單、無外部依賴的做法範例。
- `app/lib/storage.ts`（`transact` 包裝函式）——IndexedDB 交易統一 Promise 化＋統一錯誤轉型，程式碼量小、可直接讀懂其收斂寫法。

## 6. 避坑清單

- **「人數」語意混淆的陷阱**：這個專案有兩個完全獨立、意義不同的「人數」欄位——`RecommendationRequest.people`（決定推薦道數 people+1，不影響份量）與 `AppSettings.nutrition.estimatePeople`（只在 AI 生成菜譜時提示 LLM 用多少人份量猜食材克數，`app/lib/ai.ts:225,229`）。兩者互不呼叫、互不同步。如果只看 UI 或只看 README 容易誤以為這個專案做了「人數→份量縮放」，實際上讀原始碼才發現是兩條無關的邏輯線（[避坑]：文件/UI 沒說清楚時，一定要追函式呼叫鏈，不能只看欄位名稱猜語意）。
- **營養加總的「靜默跳過」設計**：`calculateRecipeNutrition` 遇到查不到營養資料的食材直接跳過不計入 `totals`，不會用 null 標記或警示「這道菜熱量被低估」，只有一個籠統的 `complete: boolean`。如果使用者只看熱量數字，會誤以為是準確值。Lighten2 PRD 對「部分品項無資料」有明確的顯示規則（章程 C4.5），是刻意比這個專案更嚴謹的地方，繼續維持即可。
- **中文食材對照字典是寫死的關鍵字表**，沒有模糊搜尋或同義詞擴展機制，食材名稱打法稍有不同（例如「鷄胸肉」而非「鸡胸肉」、簡繁體混用）就可能完全查不到對照，只能靠 `searchFoods` 的字串包含比對硬湊，準確率高度依賴使用者輸入是否命中字典键——這是「規則式關鍵字對照」在跨語言資料橋接時的通病，Lighten2 若未來要做類似「使用者輸入品名 → 對照資料庫食材」的功能，要避免只做單層字典，需考慮拼音/簡繁轉換或允許使用者手動綁定並記住綁定結果。
- 未發現嚴重的架構層級地雷（無雲端同步、無多用戶衝突之類的風險，因為這個專案根本沒做這些）。

## 7. 一句話結論

這個 repo 對 Lighten2 現階段（PRD 2.0 Phase 0 起）**直接可用的部分很窄**——它的「人數推薦」不是份量縮放而是道數挑選，跟 PRD 5.2 的核心需求方向不同，此時不必回頭參考；真正有價值的是 `app/lib/backup.ts` 與 `app/lib/native-backup.ts` 的 ZIP 串流匯出入設計，**建議留到平行工作線 B-3（資料匯出/匯入）啟動時**再回頭精讀這兩個檔案作為實作範本。
