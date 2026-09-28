# book/ 參考專案分析總索引

用 `.claude/skills/diet-repo-analyzer/SKILL.md`（改編自股票量化版 stock-repo-analyzer，換成飲食/減脂領域錨點）逐一拆解 `book/` 目錄下的 8 個開源專案，判斷哪些架構可以參考、哪些資料可以用。每份完整報告都嚴格依 0-7 節框架、附檔案路徑/行號舉證，這份只是總覽，細節請點進各份報告。

對照基準：`docs/PRD.md`（Lighten2 現行權威規格）。

---

## 一句話結論

**這批參考書裡，只要沾上「AI 生成推薦/分析」，沒有一個做出結構化輸出跟硬性過濾**——一致印證我們在 PRD 裡對 AI 功能保持謹慎、優先做規則式硬性過濾的方向是對的。真正有具體東西可以搬的，是兩個跟 AI 無關的基礎設施模組：**zaofang 的 ZIP 匯出入**跟 **fatloss-plan-demo 的本地優先同步邏輯**。

---

## 總表

| 專案 | 類型 | 價值等級 | 最大亮點 | 最大缺口 | 對應 Lighten2 |
|---|---|---|---|---|---|
| [zaofang-local-recipes](zaofang-local-recipes-main-analysis.md) | 架構參考 | 中 | `backup.ts` 的 ZIP 串流匯出/還原（manifest+資料+圖片分離、增量寫入、版本與筆數驗證），本地優先、無帳號無雲端，架構乾淨可直接對照 | 「人數」只決定推薦道數，明文寫死不做份量縮放，跟我們「人口數→採買清單」的需求方向不同，這塊落空 | **平行線 B-3（資料匯出/匯入）**——直接拿它的 ZIP 分層設計當範本 |
| [fatloss-plan-demo](fatloss-plan-demo-main-analysis.md) | 架構參考 | 中 | 本地優先＋登入合併雲端的同步鏈路（`mergeByKey` 用 `updatedAt` 做 last-write-wins、失敗排隊不阻塞），乾淨無過度設計，可直接讀懂 | 外賣篩選是 6 張寫死靜態卡片，沒有真正篩選/推薦引擎也沒過敏原欄位；「常用餐食」是整餐快照複製，不是品項級可複用結構 | 未來真的要做雲端同步時的起點；「我的品項」不要學它整餐複製的做法 |
| [BasketMate](BasketMate-main-analysis.md) | 架構參考 | 中 | `compute_pending_items()` 把「彙總跨計畫食材需求→扣庫存→比價→黑名單過濾」寫成純函式，聚合骨架跟我們 `buildShoppingList()` 同構，可對照檢查分支完整性 | 為圖省事直接刪掉 `unit` 欄位、完全不做單位換算，也沒有人數/份量縮放——這兩個正是我們 PRD 5.2/5.3 最難的地方，此專案是反面教材；且它是雲端持久化+增量更新架構，跟我們「唯讀純函式重算」前提相反，不建議照搬 | **Phase 4 採買清單**——拿聚合骨架對照檢查，但單位換算/人數縮放要自己想清楚，不會有現成答案 |
| [online-nutritionist](online-nutritionist-main-analysis.md) | 架構參考（反面為主） | 中 | 用 `(userId, date, analysisType)` 當快取鍵避免重打 OpenAI API，「AI 呼叫要快取」的紀律值得學 | AI 聊天/分析/推薦全部純文字進出、無 schema、無結構化解析；整個資料模型沒有過敏原/飲食限制欄位；規則式推薦跟 LLM 推薦兩套邏輯互不呼叫、結果不一致 | 未來若做 AI 功能，快取策略可學；推薦邏輯不要學，避免重蹈「兩套推薦互相打架」 |
| [foodwake](foodwake-master-analysis.md) | 資料來源 | 中 | repo 內真的夾帶已爬妥的資料快照，去重後約 1179 筆食材、54 種營養素欄位，可實測驗證，不是空殼程式碼 | 資料來源網站著作權/使用條款完全沒交代（授權只蓋程式碼不蓋資料）；約 37.7% 欄位是「有單位無數值」的空殼，不能直接匯入 | **不直接用它的資料**，但欄位清單可以當「以後要不要做微量營養素追蹤」的參考範本 |
| [ai-diet-agent](ai-diet-agent-main-analysis.md) | 架構參考（反面） | 低 | 用 LangGraph `SqliteSaver(thread_id)` 幾乎零程式碼做出多模態圖片輸入＋多輪對話記憶骨架 | AI 輸出完全非結構化、無 schema、無信心分數、無硬性過濾、無失敗降級，跟我們 optimistic-fail-safe 原則直接衝突 | 「AI 功能不能這樣做」的反面教材 |
| [nutritious-meals-project](nutritious-meals-project-master-analysis.md) | 架構參考（反面） | 低 | 無（唯一可談的「查某天菜單」情境可對應餐點日曆回顧場景，但實作不值得抄） | 菜單內容全是自由文字，沒有任何 kcal/蛋白質/碳水/脂肪欄位；同一份資料有兩套幾乎複製貼上的平行實作 | 「多套實作各搞一套」的反面案例 |
| [xianghong-site](xianghong-site-main-analysis.md) | 不適用 | 低 | — | — | 內容是生理學/生物化學考題庫，跟飲食 App 架構無關，未套用完整框架 |

---

## 按用途分組看

**現在就能直接參考的模組（有具體檔案路徑可對照）：**
- ZIP 資料匯出/匯入 → zaofang `app/lib/backup.ts`
- 本地優先+雲端合併同步 → fatloss-plan-demo `script.js` 的 `mergeByKey`
- 採買清單聚合骨架 → BasketMate `shopping_service.py` 的 `compute_pending_items()`

**只在特定情境下才有用的東西：**
- foodwake 的 54 個營養素欄位清單 → 只有「以後要做微量營養素追蹤」才會用到，現階段不用理它
- online-nutritionist 的 AI 呼叫快取鍵設計 → 只有「以後真的要做 AI 功能」才用得到

**純粹當反面教材、提醒自己不要犯的錯：**
- ai-diet-agent、online-nutritionist：AI 輸出沒有 schema、沒有硬性過濾
- nutritious-meals-project：同一份資料兩套平行實作
- online-nutritionist：規則式推薦跟 AI 推薦互不呼叫、結果不一致
- BasketMate：為了省事直接砍掉單位換算跟份量縮放

**跟 Lighten2 無關，可忽略：**
- xianghong-site（生理學/生化考題庫，內容誤植或另有用途）

---

## 額外提醒：兩個食譜網站不能爬

使用者原本想找食譜資料來源，查了 `icook.tw` 跟 `cookpad.com` 的 `robots.txt`，兩者都明確把 ClaudeBot／其他 AI 爬蟲列入完全禁止清單，不會寫爬蟲對付這兩個網站。食譜資料的替代方向：官方公開資料（農委會/衛福部食品營養成分資料庫）、有明確授權的學術資料集，或使用者自己手動整理少量食譜後貼給我轉成 `dish_archetypes.json`/`raw_ingredients.json` 格式。

---

## 下一步（本索引不代替決策）

上面標的參考點該不該真的採用，由使用者自己決定要不要記進 `docs/PRD.md` 或之後跟 Opus 討論時當背景，這份索引跟 8 份完整報告本身不改動任何 Lighten2 的規格或程式碼。
