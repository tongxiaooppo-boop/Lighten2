# ai-diet-agent-main 分析報告

分析對象：`D:\ok\lighten\book\ai-diet-agent-main`（GitHub 來源見 `00.txt`：`https://github.com/HHZY-BYT/ai-diet-agent`）
分析框架：`.claude/skills/diet-repo-analyzer/SKILL.md`
目標系統對照依據：`D:\ok\lighten\docs\PRD.md`（Lighten2 PRD 2.0 權威版，2026-09-28 三輪獨立審核定案；`collab/PRD-2.0-架構草案.md` 為舊版草案，本次以 `docs/PRD.md` 為準）

## 0. 摘要卡

| 項目 | 值 |
|---|---|
| 專案定位 | 一個 LangChain/LangGraph 教學級 Demo：把食材圖片丟給多模態 LLM，靠系統提示詞讓它「識別食材→分類→營養分析→給食譜」，全部邏輯外包給模型，程式碼本身只是 agent 組裝骨架 |
| 專案類型 | 架構參考型（且極薄），不含任何營養資料庫，資料來源型不適用 |
| 技術棧 | Python 3.14 + LangChain 1.x `create_agent` + LangGraph（`checkpoint-sqlite`）+ 阿里雲 DashScope（Qwen，OpenAI 相容介面）+ Tavily 搜尋工具 |
| 對 Lighten2 的價值等級 | **低**：整個 repo 只有 6 支邏輯檔、共約 79 行程式碼（`app/agents/*.py`），沒有資料模型、沒有份量縮放、沒有推薦篩選、沒有採購清單，唯一可觀察的是「單一系統提示詞把辨識/分類/營養/食譜四步驟一次性交給 LLM」這個做法本身，可作為「AI 功能到底能不能這樣做」的反面教材 |
| 最大亮點 | 用 `create_agent` + `SqliteSaver` checkpointer 幾乎零程式碼就做出「圖片輸入＋多輪記憶」的對話式營養助手骨架，證明 LangGraph 的 `thread_id` 記憶機制很輕量 |
| 最大缺口/風險 | 沒有任何結構化資料或校驗：食材辨識結果、分類、營養數值、食譜全部是 LLM 自由文字輸出，沒有 schema、沒有信心分數、沒有 fallback、沒有硬性過濾，完全不符合 Lighten2「optimistic-fail-safe」的過敏原/限制硬性把關原則 |

## 1. 架構總覽

```
使用者輸入（文字 或 HumanMessage 內含 image_url 的多模態訊息）
        │
        ▼
app.agents.diet.agent  (langchain.agents.create_agent 組裝)
  - model:   app/agents/config.py 的 model（DashScope Qwen，openai-相容協定）
  - tools:   app/agents/tools.py 的 web_search（TavilySearch，選配）
  - system_prompt: app/agents/prompts.py（四步驟指令）
  - checkpointer: app/agents/memory.py 的 SqliteSaver（依 thread_id 存對話歷史）
        │
        ▼
LLM 依 system_prompt 一次性完成：
  1. 識別食材（純靠多模態模型的視覺理解，無 CV pipeline、無信心分數）
  2. 分類：減脂友好／需要控制／不推薦（純文字判斷，無規則表）
  3. 營養分析（純文字生成，無查表、無資料庫）
  4. 食譜建議（純文字生成）
        │
        ▼
輸出：agent.invoke()/agent.stream() 回傳的 message 串流，直接印到終端（README 範例）
無 UI、無 API endpoint、無資料落地（除了對話歷史本身存進 SQLite checkpoint）
```

沒有 Web/API 層、沒有前端、沒有獨立的營養資料庫檔案。`app/recourse/diet.db`（README 專案結構圖有提到）在 `.gitignore` 裡被 `*.db` 排除，倉庫中不存在，且其內容只會是 LangGraph checkpoint（對話狀態），**不是**營養資料庫——README 的目錄樹在這點上具有誤導性，屬於「文件宣稱、程式碼未見」。

## 2. 資料模型（跟我們對照）

實際查證結果：**這個專案沒有定義任何營養/餐點/食譜的資料結構**。

- 沒有 `models.py`、`schema.py`、pydantic model、SQL DDL，或任何 dataclass。
- 唯一持久化的資料是 LangGraph 的 checkpoint 表（由 `SqliteSaver.setup()` 在 `app/agents/memory.py:12-14` 自動建表），其欄位是 LangGraph 框架內建的 thread/checkpoint 結構（序列化的訊息歷史＋中繼資料），跟「食材」「餐點」「營養」無關，純粹是對話記憶，對照 Lighten2 沒有可比對象（我們沒有「多輪對話記憶」這個資料層）。
- 食材辨識結果、分類、營養數值、食譜文字，全部只存在於 LLM 回覆的自然語言字串裡，沒有結構化欄位可以對照 `docs/PRD.md` 第 1、3 節定義的三層資料模型（L1 `profile.meal_prefs` / L2 `meal_plan` / L3 `daily_log`）或第 3 節的統一 `MealContent` 格式（`ingredient`/`product`/`estimate` 三種 component、`implicit` 隱含成分），也對不上第 10 節的 `custom_foods`（我的品項）欄位（`allergen_tags`、`role`、`valid_slots` 等）。

**結論**：本節框架要求的「關鍵資料表/schema 逐項對照」在此專案**不適用**，因為根本沒有資料模型可比對——這本身就是要記錄的發現（見第 6 節避坑）。

## 3. 核心邏輯（依錨點深挖）

錨點檢查逐一過：

- **份量縮放**：未見。系統提示詞（`app/agents/prompts.py:3-13`）完全沒有提到份量/人數；模型輸出的「減脂友好/需要控制」判斷是定性描述，不含任何可縮放的數值欄位。
- **推薦篩選（對照 `docs/PRD.md` 第 6.3 節 `passesHardFilters`／`engine/filters.js`）**：未見任何硬性規則或程式碼層級的篩選邏輯。分類（減脂友好／需要控制／不推薦）完全由 LLM 在推論時即興判斷，沒有規則表、沒有黑名單/白名單常數、沒有信心分數，也沒有「查不到就保守排除」的程式碼路徑——如果 LLM 誤判或幻覺，沒有任何攔截機制。這與 Lighten2「未確認一律保守排除」的 optimistic-fail-safe 原則（第 6.3 節、第 10.4 節：自訂食物 `allergen_tags === null` 一律視為未確認並擋下）正相反：這裡是「什麼都敢答」。
- **AI 辨識/生成流程的邊界處理**（本專案最相關的錨點）：
  - 圖片輸入走 `HumanMessage(content=[{"type":"image_url",...}])` 多模態格式（`app/__init__.py:15-19`，README 同款範例），辨識完全委託給底層多模態模型（DashScope Qwen，`app/agents/config.py:15-20`），程式碼裡沒有做任何前處理（無壓縮/裁切/格式校驗）。
  - **沒有 fallback**：找不到任何 try/except、重試、置信度檢查、「辨識失敗時怎麼辦」的分支。`system_prompt`（`app/agents/prompts.py:12`）只寫了「不要过度搜索，不要重复思考，直接给出最终回答」，這是為了控制 token/延遲成本，但也意味著模型答錯或看不清楚食材時，沒有機制讓它承認不確定或退回保守預設。
  - **額度用完/API 失敗**：`config.py` 直接讀 `os.getenv` 組 `init_chat_model`，沒有 None 檢查；若 `DASHSCOPE_API_KEY` 缺失，會在模組載入或呼叫時直接拋例外，沒有任何優雅降級路徑。
  - `web_search` 工具（`app/agents/tools.py`）掛進 agent 的 tools 清單但 `system_prompt` 明確要求「不要过度搜索」，實際上是否會被呼叫、呼叫頻率沒有程式碼層級的限制（純靠提示詞軟性約束），也沒有處理 Tavily 查無結果或 API 失敗的分支。
- **採購清單生成**：未見，此專案完全不含此功能。

## 4. 資料可用性評估

**此節不適用**：專案不含任何營養資料庫、食材資料檔、爬蟲輸出或資料集。所有「營養分析」內容是 LLM 推論時生成的自由文字，沒有結構化欄位、沒有筆數、沒有授權來源可言，無法評估匯入 Lighten2 `data/*.json` 的可行性。README 裡的「範例輸出」（第 116-138 行）是展示用的文字稿，非真實資料樣本。

## 5. 高價值模組/借鏡清單

- `app/agents/diet.py`（`create_agent(model=model, tools=[...], checkpointer=checkpointer, system_prompt=system_prompt)`）——展示 LangChain 1.x `create_agent` 的最小組裝方式：模型／工具／記憶／提示詞四個關注點分檔案管理，如果 Lighten2 未來（Phase 5 AI 功能）要接多模態辨識，這種「單一組裝點、依賴注入」的檔案切法值得參考，比把所有邏輯塞在一個檔案裡清楚。
- `app/agents/memory.py`（`SqliteSaver` + `thread_id`）——展示用一個 SQLite 檔案就能做「多輪對話依 session 記憶」的最輕量做法，如果 Lighten2 未來做「AI 對話式輸入」（例如聊天式記錄一餐），這是成本最低的記憶層參考起點，但目前 Lighten2 是純前端 IndexedDB、無後端進程常駐，`SqliteSaver` 這種 server-side 連線模式本身不能直接搬，只能借「用 thread_id 分隔對話歷史」這個概念。
- `app/agents/prompts.py`——作為「AI 功能範圍要收多窄」的反面對照：這裡把辨識＋分類＋營養＋食譜四件事塞進一個提示詞一次做完，短期看起來省事，但完全沒有中間可驗證的結構化輸出，Lighten2 若做 AI 輔助功能，應該吸取教訓，讓每一步都有可驗證、可攔截的結構化輸出（例如強制模型回 JSON schema），而不是像這裡直接印自然語言了事。

## 6. 避坑清單

- **AI 輸出完全非結構化、無 schema 約束**（`prompts.py`、`diet.py`）：辨識結果、分類、營養數值全部是自由文字，無法程式化驗證、無法存入資料庫做後續查詢或統計。Lighten2 若做任何 AI 生成內容，務必要求模型回結構化格式（JSON + schema 驗證），並在解析失敗時有明確 fallback，不要重蹈此專案「印出來就算做完」的做法。
- **沒有任何硬性過濾/信心分數，等同於樂觀假設模型永遠對**：與 `docs/PRD.md` 第 6.3、10.4 節「optimistic-fail-safe（未確認一律保守排除）」原則直接衝突——PRD 特別點名 v1 的舊漏洞（`custom_foods` 曾用 `!item.is_custom` 例外跳過過敏原檢查）就是這種「樂觀假設」的真實教訓。這裡的分類（減脂友好/需要控制/不推薦）若被誤判，沒有任何機制攔截或標記不確定，過敏原這類高風險場景若比照此做法會重蹈覆轍——**明確避坑：AI 判斷絕不能替代硬性規則過濾，AI 輸出只能是建議層，過敏原/限制仍需程式碼層級（`engine/filters.js`）的白名單/黑名單把關。**
- **無金鑰/無網路的降級路徑完全缺失**（`config.py`、`tools.py`）：API Key 缺失或呼叫失敗會直接拋例外中斷整個 agent，沒有降級成「純規則版」或提示使用者手動輸入的備援路徑。若 Lighten2 未來把 AI 功能做成非必要的「錦上添花」層，一定要確保 AI 不可用時核心記錄功能不受影響——這呼應 `docs/PRD.md` 第 6.2 節「運動與飲食脫鉤」的精神：**AI 功能同樣該跟核心紀錄流程脫鉤，AI 掛了不能讓記一餐這件事跟著掛。**
- **README 專案結構圖與實際程式碼不符**（README 第 105-106 行提到 `app/recourse/diet.db` 是「数据库文件」，但實際上該檔案被 `.gitignore` 排除、且其內容只會是 LangGraph 對話 checkpoint，不是营养資料庫）：文件用詞會讓人誤以為專案內建營養資料庫，實際查證後發現子虛烏有，提醒之後看類似專案的 README 時不能只看目錄說明就當真。

## 7. 一句話結論

這是一個 79 行程式碼的 LangChain/LangGraph 教學骨架，對 Lighten2 現階段（`docs/PRD.md` Phase −1a 起、Phase 0 開工）幾乎沒有可直接借鏡的架構或資料——PRD 路線圖裡最接近的落點是 Phase 5（可選，自動排一週菜單）或更後的 AI 輔助功能平行線，屆時可以當一份「別這樣做」的參考：借「agent 組裝分檔案＋輕量 SQLite 記憶」的骨架概念即可，但務必補上結構化輸出、硬性過濾層（`engine/filters.js` 的 optimistic-fail-safe）與 AI 不可用時的降級路徑，這三項此專案完全沒做。
