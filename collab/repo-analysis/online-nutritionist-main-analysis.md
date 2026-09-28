# online-nutritionist-main 分析報告

分析對象：`D:\ok\lighten\book\online-nutritionist-main`
對照基準：`D:\ok\lighten\docs\PRD.md`（Lighten2 PRD 2.0，讀取成功，本報告以此為準）

---

## 0. 摘要卡

| 項目 | 值 |
|---|---|
| 專案定位 | 全端「線上營養師」App：飲食記錄＋TDEE/營養需求計算＋AI 聊天／分析／推薦＋統計圖表，帳號制、資料存中央 Postgres |
| 專案類型 | 架構參考型（AI 對話/推薦邊界處理是本次重點錨點；無獨立資料集，不算資料來源型） |
| 技術棧 | React 19 + Vite 7 + Redux Toolkit（前端）／Express 5 + Prisma 6 + PostgreSQL + OpenAI SDK（後端），JWT 驗證 |
| 對 Lighten2 的價值等級 | **中**——後端全端帳密制架構跟我們純前端 IndexedDB 差異巨大，但「AI 輸出無 schema、無硬性過濾」這條線索被完整驗證存在且比 ai-diet-agent-main 更徹底（連過敏原欄位都不存在），是很扎實的「avoid this」教材 |
| 最大亮點 | 兩層快取式設計：`AiAnalysis` 表把 `(userId, date, analysisType)` 的 AI 回覆快取起來避免重複呼叫 OpenAI（`backend/src/services/aiAnalysisService.ts:24-42`），這個「AI 呼叫要快取」的紀律值得參考 |
| 最大缺口/風險 | AI 聊天／分析／推薦三條鏈全部是「組 prompt → 呼叫 OpenAI → 存純文字 → 前端當 Markdown 渲染」，全程沒有 schema、沒有結構化輸出解析、也沒有任何過敏原/飲食限制欄位可供過濾——資料模型裡「過敏原」這個概念根本不存在 |

---

## 1. 架構總覽

```
[前端 React SPA]
  FoodLogPage / MealSuggestionPage / AIChatPage / StatisticsPage / ProfilePage
        │ axios (JWT in header, token 存 localStorage)
        ▼
[Express API] ──authMiddleware──▶ controllers ──▶ services ──▶ Prisma ──▶ PostgreSQL
        │
        └─ aiChatService / aiAnalysisService / aiRecommendationService
                 │ 組字串 prompt（含使用者資料＋今日飲食記錄＋20筆食物庫存）
                 ▼
              OpenAI Chat Completions (gpt-4o-mini)
                 │ 回傳自然語言（含 Markdown）
                 ▼
        直接存 AiChatMessage.content / AiAnalysis.aiResponse.content（純字串）
                 ▼
        前端用 ReactMarkdown 原樣渲染，不解析、不驗證
```

輸入 → 處理 → 儲存 → 輸出全鏈路完全是「伺服器為唯一真相」，沒有離線能力：`frontend/src/components/layout/AuthSync.tsx:1-4` 的註解直接寫「解決：電腦改姓名後，手機重新整理仍顯示舊資料（localStorage 依裝置分開）」——這裡的「同步」只是登入後重新 fetch 一次使用者資料，不是本地資料與雲端資料的合併，因為前端根本沒有本地資料副本（只存 JWT token）。**跟 Lighten2「離線優先＋跨裝置同步」的取捨完全不是同一類問題**，這條錨點在此專案上查無對應設計，見第 6 節說明。

---

## 2. 資料模型（跟我們對照）

關鍵 schema：`backend/prisma/schema.prisma`

| 表 | 欄位重點 | 對照 Lighten2 |
|---|---|---|
| `Food`（第 107-144 行） | `calories/protein/carbohydrates/fat/fiber/sugar`（`baseUnit` 為 g/ml/serving，皆是「每 100 基準單位」或「每份」），`category: String[]`，`isCustom`＋`createdBy` | 對照 `ingredients.json`/`convenience_items.json`。**沒有 `sat_fat_g`、沒有 `sodium_mg`、沒有任何過敏原欄位**——比我們現有 `protein_g/carb_g/fat_g/fiber_g/sat_fat_g/sodium_mg` 少兩項，且完全沒有 `allergen_tags` 這個概念 |
| `FoodLog`（第 149-177 行） | 一筆一個食物＋`mealType`（breakfast/lunch/dinner/snack）＋`quantity`/`unit`＋快照的四大營養素 | 對照 `daily_log`，但只有「單品項＋單一時段」粒度，沒有「一餐內多元件」的概念，跟我們的 `MealContent`（PRD 第 3 節，`components[]` 混合 ingredient/product/estimate）差一個抽象層級 |
| `AiChatSession` / `AiChatMessage`（180-209 行） | 純聊天記錄，`content` 是自由字串 | 我們目前無對應功能；若要做 AI 對話，這是「不要學」的參考（見第 6 節） |
| `AiAnalysis`（214-229 行） | `inputData: Json?`／`aiResponse: Json?`，用 `(userId, date, analysisType)` 索引當快取鍵 | 沒有直接對照物件，但「用結構化 input 快照＋快取鍵防止重複呼叫」的思路，若 Lighten2 未來做 AI 功能（Phase 5）可以參考快取設計，不是資料格式本身 |
| `User`／`BodyComposition`／`Goal`／`NutritionRequirement`（19-102 行） | TDEE 計算輸入輸出分開存表 | 對照我們 `profile`，但欄位分散在 4 張表，是關聯式資料庫的正常做法，跟我們單一 `profile` store 的取捨不同（多使用者 vs 單機） |

**未見**：`meal_plan`（週計畫）、`custom_foods` 的過敏原欄位、任何「型態」（超商/外食/自煮）分類、任何份量縮放係數欄位。此專案的 `Food.category` 是六大類食物分類（全穀雜糧/豆魚蛋肉/…），跟我們的「型態」（通路/烹調方式）是完全不同維度的分類，不能互換參考。

---

## 3. 核心邏輯（依錨點深挖）：AI 推薦/對話的邊界處理

這是使用者要求對照 ai-diet-agent-main 問題的重點錨點，深挖三條鏈：

### 3.1 AI 聊天（`backend/src/services/aiChatService.ts`）

- `sendMessage()`（155-327 行）流程：組一個含使用者身體組成／目標／今日飲食記錄／營養達標百分比／最多 15 筆資料庫食物的巨大字串 system prompt（199-269 行），呼叫 `openai.chat.completions.create({ model: 'gpt-4o-mini', temperature: 0.7, max_tokens: 2000 })`（273-281 行），把 `completion.choices[0]?.message?.content` **原封不動**存進 `AiChatMessage.content`（292-298 行）。
- **沒有 `response_format: { type: "json_schema" }` 或任何 function calling／tool use**。OpenAI SDK 版本是 `^6.16.0`（`backend/package.json:32`），這個版本完全支援 structured output，但專案沒有使用。
- 唯一的「防呆」是 try/catch 呼叫失敗時回退成固定字串「抱歉，我目前無法回應」（310-326 行）——這只防 API 呼叫失敗，不防 AI 回覆內容本身的正確性或安全性。
- 前端 `frontend/src/components/features/ai/AIMealRecommendation.tsx:171-209` 直接用 `<ReactMarkdown>{recommendation.recommendation}</ReactMarkdown>` 渲染，等於**信任 AI 輸出的任意 Markdown/文字內容**，沒有做內容過濾或結構驗證。

### 3.2 AI 餐點推薦（`backend/src/services/aiRecommendationService.ts`）

- `getMealRecommendation()`（19-206 行）：組 prompt 时把「使用者資訊」「目標」「營養需求」「已攝取」「剩餘營養」「今日已記錄飲食」全部塞進純文字（95-150 行），要求 AI「請提供 1.具體餐點建議 2.營養資訊 3.推薦理由...」（143-150 行），但**沒有任何機制驗證 AI 推薦的食物是否真的在資料庫裡、營養數字是否跟資料庫一致**——AI 完全可以憑空編造食物名稱和熱量，系統不會發現。
- 唯一的「篩選」動作是取資料庫食物清單塞進 prompt 給 AI參考（本檔案沒有這段，是 `aiChatService.ts:132-136` 的 `getUserContext()` 才有：`searchFoods({ limit: 20, isCustom: false })`），這是**無任何條件的固定 20 筆**，不篩過敏原（因為根本沒有過敏原欄位可篩）、不篩飲食限制、不篩「不吃清單」。
- 有做 AI 呼叫快取（26-52 行，比對 `(userId, date, mealType)` 找到既有記錄就直接回傳，不重打 OpenAI）——**這是本專案在 AI 邊界處理上做得最好的一點**，值得抄「呼叫要快取」這個紀律本身（不是抄格式）。

### 3.3 對照：本專案是否存在「硬性過濾」？

**不存在，而且比 ai-diet-agent-main 更徹底地不存在**：

- `Prisma schema` 全文搜尋確認 `Food`／`User`／自訂食物都沒有 `allergen`／`過敏原`／`diet restriction` 相關欄位（用 grep 驗證，見下方查證紀錄）。
- 唯一含「限制」語意的欄位是 `Goal.goalType`（增重/減重/維持），跟過敏原、飲食禁忌完全無關。
- 換句話說，這個專案連「未確認 vs 確認不含 vs 含有」這三態的資料位置都不存在，不是「篩選邏輯寫錯」，是**資料模型從一開始就沒有這個維度**——比我們 PRD 第 10.4 節提到 v1 `passesHardFilters` 對自訂食物「跳過檢查」的漏洞（至少欄位存在、只是例外沒擋）還要原始一階。

**查證方式**：`grep -rn "allerg|過敏|禁忌"` 全 repo，只命中 4 個檔案（`foodLogRoutes.ts`、`foodLogService.ts`、`mealService.ts`、`SWAGGER_SETUP.md`），逐一開啟確認皆為誤判（`過`/`敏`等字元出現在其他詞彙或文件範例裡，非過敏原欄位）——**未確認、程式碼未見**，確定不存在硬性過濾機制。

### 3.4 額外發現：兩套平行的「餐點推薦」互不相通

- `backend/src/services/mealService.ts:getMealSuggestions()`（43-215 行）是**規則式、非 AI** 的推薦：依 `mealRatio`（早25%/午35%/晚30%/點10%，92-97 行）算目標熱量區間，用 Prisma `where.calories.gte/.lte`（110-116 行）查詢±30%範圍內的食物，找不到 3 筆就放寬到±50%（166-212 行），排序用 `createdAt desc`（不是相關度）。
- `backend/src/services/aiRecommendationService.ts:getMealRecommendation()` 是**LLM 自由文字**推薦。
- 兩者路由分開（`/api/meals/suggestions` vs `/api/ai/recommendations/meals`），**程式碼裡互不呼叫**，也沒有共用同一份「篩選/推薦」邏輯——這正是 skill 提醒的「同名功能、多套平行實作」陷阱，兩條路徑都各自不做過敏原/飲食限制篩選（因為根本沒有欄位）。

---

## 4. 資料可用性評估

**本節大部分省略**：此專案不是資料來源型專案，`Food` 表資料是種子腳本 `backend/prisma/seed.ts` 手動鍵入的常見食物（`grep -c "name:"` 統計 136 筆，第 1116 行 `main()` 執行寫入），無授權來源說明、無官方數字佐證（不像 TFDA 或政府開放資料），且欄位比我們現有 `data/*.json` 少（缺 `sat_fat_g`、`sodium_mg`、過敏原）、單位口徑不同（每 100g/ml 或每份，需要換算）。**不建議匯入**，僅供「別人常見食物清單長什麼樣子」的背景參考。

---

## 5. 高價值模組/借鏡清單

| 檔案路徑 | 為什麼值得參考 |
|---|---|
| `backend/src/services/aiAnalysisService.ts:24-42`、`aiRecommendationService.ts:26-52` | 「同一天同類型分析先查快取表，有就直接回傳不重打 API」的紀律——如果 Lighten2 未來 Phase 5 做 AI 功能且要控制 API 成本，這個「以 (使用者,日期,類型) 為鍵快取 AI 呼叫」的模式可以參考（僅供之後做 Phase 5 AI 功能參考，目前 PRD 完全沒有 AI 對話/推薦規劃） |
| `backend/src/utils/calculateTDEE.ts:22-97` | 標準 Mifflin-St Jeor BMR 公式＋活動係數表＋依減重/增重調整巨量營養素比例，是教科書級寫法，可作為「這是業界常見算法長相」的對照，但跟我們既有推薦引擎（PRD 說「經多輪審核定案」）比較，不是要替換 |
| `backend/prisma/schema.prisma:214-229`（`AiAnalysis`） | `inputData`／`aiResponse` 都存成 `Json?`快照，讓「AI 回覆是根據當時哪些輸入產生的」可回溯——若我們做 AI 功能，這種「輸入快照＋輸出分開存」的資料設計值得參考，避免像本專案的聊天訊息只存最終文字、無法回溯當時上下文 |

**不列入清單但要記住的反例**（見第 6 節）：`aiChatService.ts`、`aiRecommendationService.ts` 的 prompt 組裝與輸出處理方式，是「不要這樣做」的具體案例，不是可以直接借鏡的正面模組。

---

## 6. 避坑清單

1. **AI 輸出無 schema、無結構化解析**：`sendMessage()`／`getMealRecommendation()`／`analyzeNutrition()` 三條鏈全部把 OpenAI 回傳的自由文字直接存檔、直接渲染成 Markdown，前端無法知道 AI 究竟推薦了資料庫裡的哪個食物 ID、多少份量，使用者也無法把 AI 推薦「一鍵加入」飲食記錄（因為AI 回的是文字不是資料）。**Lighten2 若做 AI 功能，輸出必須是可解析的結構（JSON schema 或 function calling 對應到既有的 `MealContent` 格式），不能重蹈這個「AI 講什麼就存什麼」的覆轍。**
2. **完全沒有過敏原/飲食限制的資料維度**：不是篩選邏輯寫壞，是資料模型從頭到尾不存在這個欄位，AI 提示詞裡也完全沒提使用者過敏原（因為沒得提）。這跟我們 PRD 章程 B5-B8「optimistic-fail-safe：未確認一律保守排除」的立場是直接對照組——**做 AI 功能之前，硬性過濾要先於「AI 推薦精不精準」被解決，這個專案完全沒有處理，是負面教材而非參考對象**。
3. **AI 推薦食物真實性不驗證**：LLM 可以推薦資料庫裡不存在、或營養數字跟資料庫記錄不符的食物，系統沒有任何機制比對或提示「這是 AI 生成、未經驗證」。我們若做類似功能，任何 AI 提及的品項都必須能對應回實際資料筆（或明確標示為估算，類似 PRD 第 3 節的 `estimate` 元件精神）。
4. **兩套推薦邏輯互不相通**（`mealService.ts` 規則式 vs `aiRecommendationService.ts` LLM式）：使用者從不同入口拿到不一致的推薦結果，且沒有一個單一真相來源。我們 PRD 已經用「引擎完全不改演算法，只多一個輸入」的方式避免這個問題（PRD 第1節），這裡是一個「沒有及早收斂成單一邏輯」的反例佐證。
5. **`getMealSuggestions()` 用 `createdAt desc` 排序推薦結果**（`mealService.ts:122-124`, `176-178`）：跟「營養配比」完全無關的排序依據，卻寫在 `reason` 文案裡宣稱「營養配比完美符合您的需求」（`mealService.ts:136-137`）——文案與實際邏輯不一致，是個小但值得注意的坑：**推薦理由的文案要跟實際排序/篩選邏輯對齊，不要寫「看起來很聰明」但其實邏輯是任意排序**。

**未發現**跟「份量/人數縮放」「採買清單」相關的功能——此專案完全沒有這兩塊，PRD 錨點 2、5 在此專案查無對應設計，非「做壞了」，是「根本沒做」。

---

## 7. 一句話結論

這份 repo 對 Lighten2 現階段（PRD 2.0，Phase 0 起）沒有可直接借鏡的架構或資料，唯一價值是**用扎實的程式碼證據坐實了「AI 輸出無 schema、無硬性過濾」是這類專案的共通通病**（甚至比 ai-diet-agent-main 更原始，因為連過敏原欄位都不存在）；若 Lighten2 未來真的要做 AI 對話/推薦功能（目前 PRD 無此規劃），回頭參考此專案時要把它當「反面案例清單」用——AI 輸出必須先過結構化 schema 與既有硬性過濾（`passesHardFilters`）才能進入使用者可見的建議，`AiAnalysis` 表「輸入快照＋快取鍵」的資料設計手法則可以正面參考。
