# 交接筆記（2026-09-27 整案審查後）

這份是給下一個接手的人（不管是 Claude session、Cline，還是使用者自己）看的。上一版內容（週彈性帳本重設計）已經全部做完並 push。這版整個改寫。

## 現況分工（先看這段，不要重複做）

2026-09-27 做了一次「整案審查」，找 Opus 對整個專案（不只單一功能）做獨立稽核，完整結果在 `collab/opus-review-log/2026-09-27-full-project-audit.md`。審查抓到一批真的的 bug（不是猜的，Opus 自己寫 Node 模擬腳本重現過），依嚴重度分 A（一定要修，安全/正確性）、B（文案/顯示錯誤）、C（文件不同步）、其他建議修、可以之後再說。

**分工現況**：
- **A/B 類的程式 bug（A1–A6、B1–B3）、`recommend.js` 的組合邏輯重設計** → **已完成**，commit `d11ed1b`（已 push），改了什麼見該 commit 訊息。下面各節順手做掉的項目已標成已完成。之後改 `recommend.js`／`tdee.js`／`data/*.json`，一律先跑 `node tools/check-engine.js`，全部通過才算數。
- **實機測試** → 使用者會自己跟朋友一起做，不用開發者這邊安排。
- **這份交接要處理的，是上面兩塊之外的「其他事項」**：文件同步（C1/C2）、資料品質修正、開放問題、backlog。

## 這份交接要做的事

### 1. 四個開放問題：已於 2026-09-27 拍板並實作（使用者採用 Claude 的建議）

1. **下午茶要不要主動推薦含糖／零食品項** → **不主動推**。taiwan_items.json 用 `is_treat: true` 標出含糖飲料和甜點零食，共 11 項：dr01、dr02、dr04、dr07、dr10、tc01–tc06。`recommend.js` 不會把它們放進推薦池，但美饗日曆照樣能自己選、自己記錄（不是禁止）。`tools/check-engine.js` 會檢查推薦池裡沒有這類品項。
2. **`intake_high` 要不要講原因** → **明講，但只陳述數字和規則，不做歸因**。文案是「近4週完整記錄日平均攝取 X kcal，目前目標 Y kcal。平均攝取接近目標之前，系統不會調低目標。」數字由 `tdee.js` 存在 `last_result.avg_intake_kcal`／`target_kcal`。
3. **連鎖健康餐盒／宅配健身餐** → **維持歸在「外食/外賣」**（`channel: "delivery"`），先不獨立成來源選項。等品項變多，或實測有人反映，再考慮拆出來。
4. **彙總卡標題** → **「接下來幾餐的建議熱量」**。所有開啟的時段都記錄完時，改顯示「今天的餐點都記錄完了」並隱藏數字，因為這個數字是「目標減已記錄」，記完之後仍可能是正數，繼續顯示會像在叫人再吃一餐。

### 2. PRD／TECH-SPEC 文件同步（C1／C2，完整清單見審查報告第 7 節）

**d11ed1b 讓這節的範圍變大了**：文件除了要清掉舊機制，還要把這次新增的機制寫進去，見本節最後的「新機制」清單。

**為什麼優先**：Cline（實作方）是照這兩份文件做事的，文件裡還留著大量「週彈性點數」「uses_flex」「份量縮放0.7-1.3倍」等已經被否決/刪除的舊機制描述，等於文件在教下一輪重新做回已經被推翻的設計。這不是「之後再說」等級的問題。

PRD 需要改的重點（審查報告第7節列了完整行號，這裡列大方向）：
- 核心目標、原則2、5.2節、附錄C：清掉「週彈性點數」「彈性點數已用完」「因高強度運動開啟宵夜」這類跟現況矛盾的敘述。
- 第8節系統架構圖：整張圖還畫著「日總額×週彈性點數配額分配器」「大餐預約占用/釋放彈性點數」，要依現況（TDEE動態校正）重畫。
- 第3.7節：改寫成實際做法，也就是 **28 天窗內用原始體重量測值做 OLS 線性迴歸取斜率** ＋ 門檻觸發 ＋ 每次 ±150。d11ed1b 起斜率不再用 EWMA 計算，EWMA 只用於畫面顯示趨勢體重。第6.2節如果也寫著「EWMA 斜率」，要一起改。不要保留「7日移動平均」「連續2-3週」這種舊版描述。
- 第9節開放問題：#2（份量縮放範圍）、#7、#9（依賴已刪除機制）需要更新或標記關閉；#11 補上這次新增資料的來源（衛福部台灣食品成分表2025版、nuturefit麥當勞文章、cofit超商午餐文章、國健署我的餐盤系列）。
- 缺一筆「美饗日曆」更名的 changelog 紀錄，建議開一個 v4.1 版本記錄 9/25–9/27 這幾天的變更。

TECH-SPEC 需要改的重點：
- 全文搜尋「週彈性點數」「uses_flex」「settleWeeklyLedger」「computeDaySettlement」「planOverageSmoothing」清掉或改成「已移除」。
- 資料表章節：品項數量（27/11/50項6類 → 應為42/35/69項7類；台式原本70項，d11ed1b 刪掉了重複的 bf05）、`goal_mode`實際存中文不是`'cut'/'maintain'/'bulk'`、缺`meal_prefs`/`enabled_slots`欄位說明。
- 模組介面章節：`budget.js`/`recommend.js` 的參數列表要更新成現況，包括 `enabledSlots` 參數，以及 `getTodayRecommendation` 新增的第 6 個參數 `skipSlots`。
- **不要把 `is_drink`、`bundled_drink`、`EXTRA_CATEGORIES`／`SIDE_CATEGORIES`、`BREAKFAST_DRINK_IDS`、`TAIWAN_CATEGORY_SLOTS` 寫進文件。** 這些在 d11ed1b 已經全部刪掉，被下面的統一成分模型取代；寫進文件等於教實作方把舊機制做回來。
- `輕盈計畫_TASKS.md` 也有5處「週彈性帳本」殘留字樣。

**新機制（d11ed1b），要寫進 PRD 5.5／5.6，以及 TECH-SPEC 資料表章節和 4.5 節：**
- **統一成分模型**：
  - `convenience_items.json`／`taiwan_items.json` 每筆品項都有 `role`（main/side/drink/snack）和 `valid_slots`；內含飲料的套餐另標 `contains_drink`；`convenience_items.json` 另有 `channel`（convenience/delivery）。
  - 正餐時段：恰好 1 個 main ＋ ≤1 side ＋ ≤1 drink（main 內含飲料時為 0）＋ ≤1 snack，總數 ≤3 件。
  - 下午茶：不需要 main，snack、drink 各 ≤1，至少 1 件。
  - 不同來源的品項不混搭。
- **餐型時段**：`dish_archetypes.json` 每個餐型都有 `valid_slots`。
- **飲食限制**：每個成分都要符合（烹調法不參與判斷），全素視同符合蛋奶素。
- **過敏原**：
  - 固定詞彙：甲殼類／魚／蛋／乳製品／堅果／麩質／黃豆／芝麻。`profile.allergens` 改存陣列，舊版自由文字仍然相容。
  - 沒審過成分的複合料理標「未確認」；使用者只要設了任何過敏原，這些品項就排除。
- **推薦範圍**：同一天各時段不重複成分；已記錄、已預約、已關閉的時段不推薦（`skipSlots`）。
- **纖維**：加分改成 `min(fiber, fiberGapThisWeek)*2`；纖維缺口只算完整記錄日，不含今天。
- **tdee.js 狀態**：原本的 `intake_gap` 拆成 `intake_log_short` 和 `intake_high`。
- **分頁刷新**：切換分頁時發出 `tab:activated` 事件，各分頁自己重新渲染。
- **斷言腳本**：`tools/check-engine.js`，見第 5 節。
- **不主動推薦的品項**：標了 `is_treat` 的含糖飲料／甜點零食不進推薦池，只出現在美饗日曆（見第 1 節第 1 題）。
- **彙總卡**：標題是「接下來幾餐的建議熱量」；全部時段記錄完時改顯示「今天的餐點都記錄完了」（見第 1 節第 4 題）。
- **推薦組合怎麼記錄**：單一台式品項記 `source_type:"taiwan_item"`，其他現成組合記 `custom`，自組食譜記 `recipe_template`；一律 `is_feast:0`。

### 3. 資料品質修正（審查報告第6節）

**一定要修（過敏原漏標，安全性問題）：** 下表 7 項 **d11ed1b 已全部修掉**，另外所有 `allergen_tags` 為空陣列的複合料理（便當、健康餐盒、宅配餐、沙拉等）也一律加標「未確認」。唯一還沒真正結案的是 pk01／pk02：目前標「未確認」保守排除，**還沒查包裝確認實際的蛋白來源**。
| 檔案 | 品項 | 問題 |
|---|---|---|
| convenience_items.json | conv_dr01–03 豆漿 | 漏標「黃豆」 |
| convenience_items.json | conv_bx02（內含蛋白塊） | 漏標「蛋」 |
| convenience_items.json | conv_ch01（有水煮蛋） | 漏標「蛋」 |
| convenience_items.json | conv_pk01／pk02 蛋白飲 | 標`[]`，需查包裝實際蛋白來源 |
| convenience_items.json | conv_dv01（青醬） | 通常含起司/松子，漏標「乳製品」「堅果」 |
| taiwan_items.json | bf06 蘿蔔糕 | 台式做法常加蝦米，建議保守標「甲殼類」 |
| taiwan_items.json | fw06 麥當勞沙拉 | 醬料過敏原未確認 |

**建議修（資料矛盾/估算偏差）：**
- ~~`bf05` 刪掉，只留 `dr06`~~：**已完成（d11ed1b）**。但「核對早餐店大杯實際容量（常見是450ml上下，不是300ml）」**還沒做**。
- ~~`tc03` 可頌改成 300~~：**已完成（d11ed1b）**，區間 270–320，代表值 300。
- `dr07`（含糖豆漿）數值其實是包裝產品版本，但名稱寫「早餐店常見版」，來源跟名稱對不上，建議改名或改註記。
- 台式品項普遍沒有碳水/脂肪數據（一律記0），畫面上如果有顯示這兩個數字會誤導，建議至少先不顯示或註明「無資料」。
- ~~台式多品項組合被記成 `recipe_template`~~：**已修（d11ed1b）**。單一台式品項改記 `taiwan_item`，多品項組合記 `custom`，也不再一律標 `is_feast:1`。

### 4. Backlog（可以之後再說，審查報告第8節）

- 自組食譜畫面不顯示份量/克數/縮放倍數，使用者沒辦法照著煮（Opus說這項其實接近「建議修」，優先度可以拉高一點）。
- ~~超商品項加上時段限制 `valid_slots`~~：**已完成（d11ed1b）**。
- 資料只存在瀏覽器 IndexedDB，清瀏覽器資料/換裝置就全部消失——**這條如果要讓朋友以外的人用，建議提前處理**，至少做「匯出/匯入 JSON」。
- 死碼清理：~~`uses_flex` 欄位~~、~~`overage_smoothing_log` store~~ 已在 d11ed1b 刪掉；**還剩** `recipe_templates` 表和 `LIKE_BONUS`。
- ~~效能：排序時重算 score~~：**已完成（d11ed1b）**，改成先算分再排序，候選池也改成快取。

### 5. 測試腳手架（審查報告第9節）：已完成（d11ed1b）

`tools/check-engine.js` 已經建立，在 repo 根目錄執行 `node tools/check-engine.js`。以下是原始建議，保留下來說明這支腳本檢查哪些項目：

Opus建議把這次抓bug用的模擬腳本（在它自己的scratchpad，sim.js/sim3.js）轉成repo內固定的斷言腳本（例如`tools/check-engine.js`），至少斷言：全素/蛋奶素推薦合規、過敏原不出現、任何時段不出現純飲料或兩杯飲料、跨時段不重複、已記錄時段不再推薦、TDEE斜率估計誤差<0.1kg/週。這樣以後每次改`recommend.js`/`tdee.js`都能跑一次確認沒有回歸。**如果Opus修bug時沒有一併建立這個腳本，之後要記得補。**

## 記憶系統現況

`C:\Users\Max\.claude\projects\d--ok-lighten\memory\` 裡的 `project_weekly_flex_redesign.md` 檔案已經刪除，但 `MEMORY.md` 索引還列著它；反過來，`feedback_persist_opus_logs.md` 檔案存在，索引裡卻沒有。兩處都要修正索引。`feedback_persist_opus_logs.md`（跟Opus討論要留本地log）這條規則這次審查也照做了，記錄在`collab/opus-review-log/2026-09-27-full-project-audit.md`。
