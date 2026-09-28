# BasketMate-main 分析報告

> 分析對象：`D:\ok\lighten\book\BasketMate-main`
> 對照基準：**`D:\ok\lighten\docs\PRD.md`**（Lighten2 開發期間唯一權威規格，第 5 節「週規劃、人口數、採買清單」，2026-09-28 定案版；`collab/PRD-2.0-架構草案.md` 已是舊版草案，本次以 `docs/PRD.md` 為準，取代原先用 skill 檔摘要對照的版本）
> 分析框架：`.claude/skills/diet-repo-analyzer/SKILL.md`

---

## 0. 摘要卡

| 項目 | 值 |
|---|---|
| 專案定位 | 個人／家庭用的食材庫存＋菜譜＋採購清單管理 App，含小票 OCR 匯入與 LLM Agent 對話操作 |
| 專案類型 | 架構參考型 |
| 技術棧 | Next.js（App Router）＋ FastAPI＋ Supabase(PostgreSQL)＋ LangChain/LangGraph（AI Agent）＋ 百度 OCR＋ Docker Compose |
| 對 Lighten2 的價值等級 | **中**：採購清單「彙總—比對庫存—生成待購」的推導鏈可對照參考，但 BasketMate 是「持久化的可變清單」（存 `purchase_tasks` 表、支援增量更新／來源追蹤），Lighten2 PRD 5.3 明確要的是「唯讀彙總視圖，不存資料，純函式 `buildShoppingList()` 重算」——架構前提就不同，不能整段搬；且 BasketMate **明確放棄了單位換算**，而 Lighten2 PRD 5.3 已經自己想清楚並定義了 `cooked_to_raw`／`purchase_unit`／`g_per_unit`／`pantry` 這套欄位，此專案在這塊只能當「反面對照」，不是「解法參考」。 |
| 最大亮點 | 用 `ingredient_id` 分組彙總「跨 recipe、跨計畫的需求量」再跟庫存比對出「缺口」的推導骨架（`compute_pending_items()`），跟 Lighten2 PRD 5.3 的聚合虛擬碼「依 `purchase_key` 彙總 → 熟重換生重 → 可數單位取整」是同一種形狀的問題，可以直接對照检查 Lighten2 規劃是否有遺漏分支（例如「庫存/常備品排除」這塊 BasketMate 有現成的黑名單／庫存扣除思路可對照）。 |
| 最大缺口/風險 | BasketMate 完全沒有「人數縮放」（recipe 食材量寫死絕對值），也在 2026-06-04 把 `ingredients.unit` 欄位**直接刪除**、宣告「以後任何代碼都不應該再使用單位」（`docs/DEPRECATED.md:1-9`）——這兩塊正好是 Lighten2 PRD 5.2／5.3 已經設計好對應機制（`household_size`＋逐筆 `servings` 覆蓋；`cooked_to_raw`／`purchase_unit`／`g_per_unit`）的地方，代表 BasketMate 在採購清單這個錨點上，能抄的是「聚合骨架」，抄不到「難點解法」。 |

---

## 1. 架構總覽

```
使用者（瀏覽器）
   │
   ▼
Next.js 前端 (frontend/, port 3000)
   │  RESTful API（fetch → lib/api-client.ts）
   ▼
FastAPI 後端 (backend/, port 8000)
   │
   ├─ routers/*.py          純 CRUD／業務端點（ingredients, recipes, plans, prices, shops, shopping, import_records, blacklist, user_profile）
   ├─ services/shopping_service.py   採購清單核心運算（純函式，unit test 友善）
   ├─ services/ocr_service.py        小票 OCR 全流程（解析→匹配→合併→過濾）
   ├─ ai/agent.py + routers/ai_tools.py   LangGraph ReAct Agent，53 個工具函式，SSE 串流對話
   │
   ▼
Supabase (PostgreSQL)
   ├─ 一般表：ingredients / recipes / plans / prices / shops / import_records / blacklist / user_profiles
   ├─ purchase_tasks（未在 schema.sql 定義，純代碼使用的 JSONB 大表）
   └─ migrations/001-014：一系列 PL/pgSQL RPC 函式，把「寫操作＋連動更新」包成單一事務（見第 3、6 節）
```

輸入 → 處理 → 儲存 → 輸出鏈（以採購清單為例）：
1. 使用者建立 `plans`（哪天吃哪些 `recipes`）
2. 建立/更新/刪除 plan 時觸發 `shopping_service.update_pending_items_for_plan`（增量）或 `refresh_purchase_task`（全量）
3. 彙總所有未來 plan 引用的 recipe 食材需求 → 減去 `ingredients.quantity`（庫存）→ 產生 `pending_items`
4. 寫回 `purchase_tasks`（單一活躍任務的 JSONB 陣列）
5. 前端 `shopping-page.tsx` 讀取顯示，使用者勾選完成後呼叫 `complete_purchase_task` RPC，原子性地把勾選項目寫回庫存並歸檔

---

## 2. 資料模型（跟我們對照）

| BasketMate 表/型別 | 關鍵欄位 | 對照 Lighten2 |
|---|---|---|
| `ingredients`（`backend/app/models.py:42-65`）| `id, name, quantity(float), alias` — **無 unit** | 對照 `custom_foods`／食材主檔，但沒有 `protein_g` 等營養欄位，純庫存數量表，跟我們的營養資料庫定位不同 |
| `recipes`（`models.py:84-113`）| `ingredients: [{ingredient_id, quantity, name?}]` | 對照「自煮開伙」餐型的骨架食材軸，但這裡的 `quantity` 是**絕對數字**，不是「每人份量」，沒有 serving 概念 |
| `plans`（`models.py:116-139`）| `date, breakfast_recipe_id, meal_ids[]` | 對照 `meal_plan`（L2 週計畫），但無人口數欄位、無型態選擇器 |
| `purchase_tasks`（`docs/DATABASE_SCHEMA.md:125-160`）| `pending_items[], custom_items[], completed_items[], removed_ingredient_ids[]`，JSONB，`pending_items` 內含 `sources: {plan_id: qty}` | 對照 PRD.md 第 5.3 節的「採買清單」，但**架構前提相反**：BasketMate 把整份清單當成持久化、可變、需要事務保護的資料表；PRD.md 明訂「採買清單本身不存資料，是一個純函式 `buildShoppingList(meal_plan 條目[], 日期範圍) → 清單列[]`，計畫一改就重新算」，唯一要存的狀態只有「打勾」。BasketMate 的 `sources`/`removed_ingredient_ids`/`custom_items` 這些額外持久狀態，對應到 Lighten2 就只剩「打勾狀態」一項有必要，其餘是雲端多用戶＋事務約束下才需要的複雜度，見第 3.6 節 |
| `import_records`（`DATABASE_SCHEMA.md:163-184`）| `items(jsonb), status, deleted_patterns[]` | 對照 AI 辨識/OCR 落地資料，Lighten2 目前完全沒有這塊，可作為「要不要做 OCR」的參考範本 |
| `user_profiles`（`DATABASE_SCHEMA.md:202-224`）| `favorite_recipes[], favorite_ingredients[], disliked_ingredients[]` | 對照我們的「硬性過濾（過敏原/飲食限制）」，但這裡是「軟性偏好排序」而非「硬性排除」，且用陣列存名稱字串，沒有結構化的過敏原分類 |

**未確認/查無**：`schema.sql` 本身並不完整（`docs/DATABASE_SCHEMA.md:239-244` 自陳 `purchase_tasks`、`blacklist` 兩表未在 schema.sql 中定義，僅代碼中使用），代表這份 schema 文件是事後補寫、不是唯一事實來源，交叉比對時要小心。

---

## 3. 核心邏輯（採購清單推導 + 單位/合併處理）—— 深挖

### 3.1 採購清單怎麼從「要煮的餐」推導出「要買的東西」

核心函式：`compute_pending_items()`，`backend/app/services/shopping_service.py:130-238`。

推導鏈（純函式，輸入輸出皆為 dict/list，方便單元測試）：

```python
# shopping_service.py:142-147
filtered_plans = [p for p in plan_rows if p.get("date") and p["date"] >= today]
```
1. **先用日期過濾**：只彙總「今天以後」的計畫，過去的計畫不會被算進採購清單（`shopping_service.py:142-147`）。
2. **彙總食材需求**（`shopping_service.py:154-173`）：遍歷每個 plan 的 `breakfast_recipe_id` 與 `meal_ids[]`，查出對應 recipe 的 `ingredients` 陣列，把同一個 `ingredient_id` 的 `quantity` 直接**加總**（`need_by_ing_id[ing_id] += qty`）。這裡就是「重複品項合併」的地方——合併鍵是 `ingredient_id`，跨 recipe、跨 plan 的同一食材會被自動加總成一個數字。
3. **跟庫存比對**（`shopping_service.py:200-225`）：
   ```python
   stock = ing.get("quantity", 0)
   if stock >= need_qty:
       continue  # 庫存充足，不列入採購
   need_purchase = need_qty - stock
   ```
   邏輯是「總需求 − 現有庫存 = 待購量」，庫存夠就整項跳過，不會產生「部分夠、部分不夠」的混合狀態（因為輸出只有一個 `need_quantity` 數字）。
4. **配比價**（`shopping_service.py:186-193, 216`）：對每個 `ingredient_id` 找**所有店家報價中最低價**（`price_map` 用 `if p < price_map[ing_id][0]` 持續更新），採購清單只顯示「最便宜的一家」，不做多店比較展示。
5. **黑名單排除**（`shopping_service.py:200-203`）：使用者手動刪除過的 `ingredient_id` 會被加進 `blacklist`（存在 `purchase_tasks.removed_ingredient_ids`），下次重算時直接 `continue` 跳過，即使需求還在也不會再冒出來——這是「使用者主動排除某項」的持久化機制。

### 3.2 增量更新（單一計畫變動時，不整表重算）

`update_pending_items_with_sources()`（`shopping_service.py:328-502`）是本專案工程上最有巧思的部分：

- `pending_items` 每一項多存一個 `sources: {plan_id: qty}` 欄位（`shopping_service.py:345, 393`），記錄「這個食材的待購量是由哪些計畫、各貢獻多少」組成。
- 新增/更新一個計畫時：只更新 `sources[this_plan_id] = new_qty`，然後 `total_needed = sum(sources.values())` 重新跟庫存比對（`shopping_service.py:432-442`）。
- 刪除一個計畫時：`sources.pop(plan_id)`，如果 `sources` 變空就整項移除，否則用剩下的來源重新算 `need_quantity`（`shopping_service.py:465-494`）。
- 失敗時的 fallback：`update_pending_items_for_plan()`（`shopping_service.py:80-116`）在 `try/except` 裡，若增量計算拋例外，直接**回退到全量 `refresh_purchase_task`**（`shopping_service.py:112-113`），犧牲效能換正確性——這是「精細化優化失敗時要有保底路徑」的具體案例。

### 3.3 單位換算——本專案的做法是「直接不做」，PRD.md 已經正面解掉這題

`docs/DEPRECATED.md:1-9` 明文記載：
> `ingredients.unit` 字段 — 廢棄時間 2026-06-04，原因：不再使用單位字段，處理：已從資料庫中刪除該列，禁止任何代碼再引用。

`frontend/lib/types.ts:1` 與 `backend/app/models.py:5` 都在檔案最頂端寫死警語「IMPORTANT: ingredients 表的 unit 字段已永久廢棄」。

實際效果：`ingredients.quantity`、`recipes.ingredients[].quantity`、`pending_items.need_quantity` 全部都是**裸的 float**，沒有配套單位。系統假設「使用者對同一個食材，永遠用同一種計量方式記錄」（例如「雞蛋」永遠用「顆」，「米」永遠用「克」），一旦使用者某次用克某次用顆記同一食材，數字會直接錯誤疊加而不會有任何提示或轉換。`frontend/lib/ingredient-stock.ts:14` 的庫存判斷 `row.quantity >= Math.max(1, Math.floor(ing.quantity))` 也只是裸數字比較，同樣不處理單位。

對照組：Lighten2 `docs/PRD.md` 第 5.3 節「已知的隱藏複雜度」明確列出且已定名了對應機制——
- **熟重換生重**：用食材的 `cooked_to_raw`（章程 B4，Phase −1b 就補上）換算，避免「糙米飯 1050g」直接誤導使用者去買多快一倍的生米。
- **可數食材用單位**：蛋顯示「顆」不是克，Phase 4 補 `purchase_unit` / `g_per_unit`，且**要對總數取整，不是逐餐取整再加總**。
- **常備品排除**：`pantry: true` 標記的品項（燕麥、醬油、鹽、油）分「要買」「家裡常備」兩區，不算進「要買」總量。

這代表 Lighten2 已經在規格層面走得比 BasketMate 遠，BasketMate 選擇整個放棄單位、Lighten2 選擇正面定義換算欄位——**BasketMate 在這裡提供不了實作方案**，唯一的參考價值是「反面案例」：它的放棄印證了這確實是一個容易被砍掉的難點（見第 6 節避坑），PRD.md 已經預先把換算欄位定名，Phase 4 實作時要小心不要重蹈覆轍（例如換算表覆蓋率不足時，不要選擇「乾脆全部當生重」這種 BasketMate 式的簡化）。

### 3.4 份量／人數縮放——BasketMate 完全沒有，Lighten2 已定案 `household_size` + 逐筆 `servings`

通讀 `models.py`（`RecipeBase`, `PlanBase`）、`plans.py`、`recipes.py`、`shopping_service.py` 全部欄位，**沒有任何「人數」「份數」「serving」欄位或參數**。Recipe 的 `ingredients[].quantity` 是固定絕對值（例如「番茄炒蛋」固定用 2 顆蛋），不會因為計劃多煮幾人份而縮放，也沒有「一人一盤 vs 三菜一湯共食」的模型選擇。

對照組：`docs/PRD.md` 第 5.2 節已經明確定案——
- `profile.household_size`（預設 1，全域預設值）。
- `meal_plan` 條目可逐筆覆蓋 `servings`（早餐通常只有自己吃、晚餐才是全家，不能只有一個全域值）。
- 明確排除「三菜一湯大家夾」的台式共食模型，只做「每人一盤同樣的菜，份量依人數放大」（`docs/PRD.md:151-153, 240`）。
- `daily_log` 只記使用者自己那一份，家人吃的不算進使用者的營養/熱量計算。

BasketMate 在這塊**查無此邏輯，非「未確認」而是「確定不存在」**，代表 Lighten2 的目標複雜度本來就比 BasketMate 高一截，此節無法從 BasketMate 借鏡任何實作細節。

### 3.6 聚合鍵的關鍵差異：`ingredient_id` vs `purchase_key`

BasketMate 的彙總是以資料庫食材 id 為 key（`need_by_ing_id: Dict[str, float]`，`shopping_service.py:151`），一個 `ingredient_id` 對應唯一一條庫存/採購行。Lighten2 `docs/PRD.md:169` 的聚合虛擬碼明確寫「依『採買身分』（`purchase_key`）彙總，**不是**依食材資料庫的 id」——代表 Lighten2 已經預見「同一個 `purchase_key` 可能對應多個食材 id（例如熟食與生食、不同烹調法產生的同一種採買品項）」這個 BasketMate 完全沒遇到、也沒能力遇到的問題（因為 BasketMate 的 `ingredients` 表本身就是庫存表，庫存跟採買身分是同一個東西；Lighten2 的食材資料庫與「要去買什麼」是兩層概念，需要額外的 `purchase_key` 映射層）。這點提醒 Phase 4 實作時，`purchase_key` 的映射表設計要單獨測試，不能套用 BasketMate「用資料庫 id 分組」的簡化假設。

### 3.5 AI OCR 的品項合併與模糊比對（跟第 3.1 節的合併是兩套獨立邏輯，不要混淆）

`backend/app/services/ocr_service.py` 的小票辨識流程（`recognize_receipt()`, `ocr_service.py:960-1084`）：

```
OCR(百度) → 標準解析/智能列解析（規則式）→ LLM纠错(可選) → 食材匹配(別名+模糊) → 同名合併 → 黑名單過濾
```

- **名稱匹配**：`match_ingredients()`（`ocr_service.py:503-549`）先查精確別名表 `ALIAS_MAP`，查不到則用 `difflib.SequenceMatcher` 做模糊比對，閾值 `0.8`（`ocr_service.py:522-536`）。
- **合併規則**：`merge_items()`（`ocr_service.py:432-500`）**只對有 `ingredient_id`（已匹配到標準食材）的項目做合併**，用 `ingredient_id` 當 key，`quantity` 累加、`price` 用加權平均（`total_price / total_qty`），沒匹配到食材的商品維持獨立不合併（`ocr_service.py:472-479`）。這跟第 3.1 節「recipe 需求彙總」是完全不同的合併邏輯（一個是解析小票時的同商品去重，一個是採購清單彙總時的跨 recipe 需求加總），程式碼路徑互不呼叫，分析時不能混為一談。
- **解析三層 fallback**：規則解析 `parse_receipt`（有「品名/貨號」表頭格式）→ 規則解析 `parse_receipt_smart`（智能列辨識表頭順序）→ 都失敗才呼叫 LLM `call_llm_clean()`（`ocr_service.py:996-1017`）。這是「先便宜規則、失敗才上 LLM」的成本控制範式，值得 Lighten2 未來若做圖片辨識時參考。
- **邊界處理**：OCR API Key 未配置直接回空陣列並記 log（`ocr_service.py:973-975`），LLM 纠错回傳格式錯誤時保留原資料不阻斷流程（`ocr_service.py:871-874`），且有 `is_safe_correction()` 做編輯距離安全閥（`ocr_service.py:791-806`）防止 LLM 亂改品名。

---

## 4. 資料可用性評估

不適用。本專案不含現成的營養資料庫或可匯入的結構化食材資料集——`ingredients` 表只有 `name/quantity/alias`，沒有熱量、三大營養素等欄位；`common_ocr_errors` 只是一份寫死在 `ocr_service.py:560-789` 的 OCR 錯字對照表（约150組中文詞形近字校正，非營養資料），與我們 `data/*.json` 的欄位需求無交集，此節按框架規定省略深入比對。

---

## 5. 高價值模組/借鏡清單

| 檔案路徑 | 函式/元件 | 為什麼值得參考 |
|---|---|---|
| `backend/app/services/shopping_service.py:130-238` | `compute_pending_items()` | 「彙總需求→減庫存→配比價→黑名單過濾」的全量推導鏈，邏輯單純、無外部依賴（純函式），跟 PRD.md 5.3 的 `buildShoppingList()` 是同構問題（輸入計畫集合、輸出清單列），可以直接拿來對照检查 Lighten2 的聚合虛擬碼有沒有漏掉「庫存/常備品排除」這類分支——**但 BasketMate 的全量版本才是跟 Lighten2 對應的那個**，見下一列的保留意見 |
| `backend/app/services/shopping_service.py:328-502` | `update_pending_items_with_sources()`（**參考時要保留判斷，不建議直接借鏡**） | `sources: {plan_id: qty}` 的來源追蹤設計，是為了解決「每次改一個計畫就要重新打一輪 Supabase 查詢（庫存、菜譜、價格）成本太高」這個**雲端多表 round-trip** 問題。Lighten2 是本地 IndexedDB、PRD.md 5.3 明訂「計畫一改就重新算」的純函式模型，沒有網路延遲成本，全量重算大概率比維護一份 `sources` 增量狀態更簡單也更不容易出錯。這裡的教訓是：**BasketMate 為了解決自己的架構限制（雲端延遲）而做的增量優化，不該被當成「更先進的做法」照搬**，Lighten2 若沒有效能證據顯示全量重算太慢，應該優先選 PRD.md 已經定案的簡單純函式版本 |
| `backend/app/services/shopping_service.py:80-116` | `update_pending_items_for_plan()` 的 `try/except` fallback | 「精細優化失敗時整表重算保底」的容錯模式本身是好的通用教訓，但如上一列所述，Lighten2 大概率一開始就不需要那層精細優化，此模式參考價值在於「如果未來真的要做增量優化，記得配保底路徑」，而非現在就用 |
| `backend/app/services/ocr_service.py:960-1084` | `recognize_receipt()` 三層 fallback（規則→規則→LLM） | 對應 PRD 2.0「AI 辨識邊界處理」必查項；示範了「先用便宜規則、失敗才耗費 LLM 額度」的成本控制思路，Lighten2 若做圖片辨識/OCR 可直接借鏡此分層策略 |
| `backend/app/services/ocr_service.py:791-806` | `is_safe_correction()` | LLM 糾錯結果的編輯距離安全閥，防止模型過度改寫，對應「AI 生成內容要有防幻覺機制」的通用模式 |
| `docs/operation-impact-analysis.md` 全篇 | 系統操作影響分析報告 | 這份文件本身是一種好的工程習慣：把「哪個寫操作會連動影響哪張表」列成表格逐一排查優先級，Lighten2 未來資料模型變複雜（例如 daily_log 寫入要不要連動 meal_plan 快照）時，可借鏡這種「連動影響清單」的排查方法，而非只借鏡它的技術結論 |
| `supabase/migrations/007_complete_purchase_task.sql`、`011_confirm_import_transaction.sql` | 事務性 RPC 函式 | 示範「多表寫操作包成一個原子事務」的做法；雖然 Lighten2 是本地 IndexedDB（可用單一 `readwrite` transaction 達到類似效果），但這種「先想清楚哪些寫操作必須全成功或全回滾」的分析方法值得參考，見第 6 節同時也是避坑對照 |

---

## 6. 避坑清單

1. **單位換算問題選擇「整個放棄」而非「解決」**（`docs/DEPRECATED.md`, `models.py:5`, `types.ts:1`）：這是本專案對 Lighten2 最重要的反面參考。BasketMate 一開始應該也想處理過單位（廢棄記錄暗示曾經有 `unit` 欄位），最後選擇刪除整個概念、要求使用者自律用同一種單位記錄同一食材。Lighten2 `docs/PRD.md` 5.3 已經正面定義 `cooked_to_raw`／`purchase_unit`／`g_per_unit` 這套解法，**不需要參考 BasketMate 的『放棄』作為技術方案，但要引以為戒**：如果換算表設計不完整、覆蓋率不夠，很容易演變成「乾脆不做」的技術債陷阱（PRD.md 已預先把「Phase 4 再補採買專用欄位」寫清楚，代表這是被承認的已知風險而非疏漏），Phase 4 實作時換算表最好從一開始就限定範圍（只覆蓋 MVP 會用到的常備食材），而不是想著做通用換算引擎。

2. **完全沒有份量/人數縮放，卻仍宣稱是「採購清單」功能**：Recipe 食材量寫死，無法因應「今晚有客人多煮兩份」的情境，也沒有「一人一盤 vs 共食」的模型區分。Lighten2 `docs/PRD.md` 5.2 已經定案 `household_size` + 逐筆 `servings` 覆蓋、並明確排除共食模型，範圍界定得比 BasketMate 清楚。若日後參考 `compute_pending_items()` 的資料結構時，切記它的 `recipe.ingredients[].quantity` 是絕對值，Lighten2 對應的 `serving_g`（名目份量）要記得乘上 `servings` 才能得到 BasketMate 那種「絕對需求量」，兩者不是同一層級的數字，不能直接套用同一個聚合函式。

3. **雙路徑並行維護造成的邏輯重複＋文件與代碼不同步的高風險**：`shopping.py` 的 `refresh_purchase_task` 路由（`backend/app/routers/shopping.py:240-331`）與 `shopping_service.py` 的同名函式（`shopping_service.py:9-77`）幾乎是同一段邏輯（查庫存→查菜譜→查計畫→查價格→算 pending_items）被**複製貼上兩份**，一份在 router 直接寫、一份在 service 封裝。從 `conversion/采购记录逻辑问题排查.md` 的對話記錄可看出，這種重複導致除錯時要同時改兩處，且該對話記錄本身反覆出現「AttributeError: module has no attribute 'router'」被同一個問題卡住至少 5 次來回（見該檔第 819-1021 行），代表這個專案在後端路由/工具模組拆分上有結構性混亂，值得 Lighten2 引以為戒：**同一段業務邏輯只能有一個實作位置**，router 應該只做 orchestration、呼叫 service，不該自己重寫一份。

4. **非事務性操作被自己列為已知風險但長期未修**：`docs/operation-impact-analysis.md:155-166` 專案自陳「complete_purchase 先更新庫存、再更新任務，中間失敗會資料不一致」「delete_ingredient 依序更新多表，中間失敗會不一致」，雖然後續用 Supabase RPC 補了幾個事務函式（`docs/operation-impact-analysis.md:229-260`），但「價格變更聯動採購清單」「店鋪刪除聯動採購清單」「菜譜變更聯動採購清單」等仍標記「未處理」（`operation-impact-analysis.md:36-39, 47, 101-111`）。這說明「資料連動」問題會隨著功能增加而指數增長，且容易「先上線、之後再補」而一直沒補完。Lighten2 若也走「L1→L2→L3 多層快照」設計，任何一層修改都要先想清楚連動範圍，最好一開始就用單一 IndexedDB transaction 包住相關的多個 store 寫入，而不是像本專案一樣事後才用 RPC 補救。

5. **AI Agent 開發過程中大量重複指令、卡在同一個錯誤循環**（`conversion/采购记录逻辑问题排查.md` 全篇）：這份對話記錄顯示使用者對同一個 AttributeError 連續貼了近乎一字不差的長指令 5 次以上，Assistant 也重複給出「清理 Docker 快取」等相同建議，顯示 AI 協作開發若沒有先定位根因就重試表面修法，會陷入無效迴圈。這是流程面的教訓：卡住時要先讓 Agent 讀日誌/實際錯誤堆疊定位根因（後來確實是 `create_react_agent()` 不支援 `state_modifier` 參數這種更底層的問題），而不是反覆重跑同一個修復指令。

未發現「資料未對齊就上線」或「optimistic-fail-safe」相關的具體反例——本專案不涉及過敏原/飲食限制這類硬性過濾情境，`user_profile_service.py` 的忌口過濾是軟性排除（過濾掉含忌口食材的菜譜，`filter_recipes_by_preference()`, `user_profile_service.py:38-112`），跟我們的「未確認一律保守排除」原則沒有直接可比對之處，此點列為背景資訊不特別歸類避坑。

---

## 7. 一句話結論

BasketMate 的 `compute_pending_items()` 全量聚合骨架（彙總需求→減庫存→常備/黑名單排除）跟 `docs/PRD.md` 5.3 的 `buildShoppingList()` 是同構問題，值得在 **Phase 4 設計採買清單聚合函式時**拿來對照檢查分支是否齊全；但它用「刪除單位欄位」跟「完全不做人數縮放」迴避了 PRD.md 5.2/5.3 已經正面解決的兩個難點（`household_size`/`servings` 縮放、`cooked_to_raw`/`purchase_unit`/`g_per_unit` 換算），且它的「來源追蹤＋增量更新」是為了解決 Lighten2 用不到的雲端延遲問題而生的複雜度，不宜照搬——Lighten2 應優先採用 PRD.md 已定案的「純函式全量重算＋只存打勾狀態」路線。此份參考書真正的價值是**驗證聚合骨架的完整性**與**印證單位/人數是真實存在的難點**，不是提供這兩題的現成解法；AI OCR 的三層 fallback 與 LLM 安全閥設計則可留給「AI 辨識要不要做」的討論（對應平行線 B／未來評估）。
