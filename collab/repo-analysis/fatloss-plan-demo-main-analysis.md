# fatloss-plan-demo-main 分析報告

分析對象：`D:\ok\lighten\book\fatloss-plan-demo-main`
分析框架：`.claude/skills/diet-repo-analyzer/SKILL.md`
對照基準：`collab/PRD-2.0-架構草案.md` 找不到該檔案；改用權威規格 **`D:\ok\lighten\docs\PRD.md`**（狀態：設計定案，尚未實作，三輪獨立架構審核後定案）作為目標系統依據，而非 skill 檔內建摘要。以下是本報告實際比對用的關鍵設計（章節出處已標註）：
- 三層資料模型 L1（`profile.meal_prefs[slot]`）／L2（`meal_plan`，Phase 2）／L3（`daily_log`）（PRD §1）。
- 型態統一列舉 `convenience | delivery | cook_quick | cook_full`，由型態決定 UI 用商品多選還是餐型骨架食材軸（PRD §2、§0.1-7）。
- 統一 `MealContent` 格式：`ingredient`/`product`/`estimate` 三種元件＋`implicit`（用油/調味）（PRD §3）。
- 週規劃＝泛化的大餐預約，`household_size`＋逐筆 `servings` 覆蓋，`daily_log` 只記使用者自己那份（PRD §5.2）。
- 採買清單是唯讀彙總視圖（`buildShoppingList` 純函式），只彙總 `cook_quick`/`cook_full`、處理熟重換生重／可數食材單位／常備品排除（PRD §5.3，Phase 4）。
- 使用者自建品項＝「我的品項」，Phase 0 起可快速新增（名稱/熱量/角色/過敏原），完整欄位（`channel`、`role`、`valid_slots`、`allergen_tags` 等）與管理畫面在平行工作線 B-1（PRD §10）。
- 核心原則：不評判超吃／不做遵循率或紅字警示（PRD §6.1）、運動與飲食資料脫鉤（PRD §6.2）、硬性過濾 optimistic-fail-safe（`allergen_tags === null` 一律視為未確認，PRD §10.4）。

---

## 0. 摘要卡

| 項目 | 值 |
|---|---|
| 專案定位 | 面向常吃外賣年輕女性的 AI 減脂助手：拍照識餐＋飲食/體重/打卡/訓練記錄＋登入跨裝置同步 |
| 專案類型 | 架構參考型 |
| 技術棧 | 純前端 vanilla HTML/CSS/JS（單一 `script.js` 1231 行，無框架、無 build）＋ Supabase（Auth + Postgres + RLS + Edge Function）＋ DeepSeek 視覺模型做 AI 識餐 |
| 對 Lighten2 的價值等級 | 中 — 本地優先＋登入合併雲端的同步機制值得完整參考（架構乾淨、程式碼可查證），但 takeout/常用餐食兩塊比 PRD.md 的設計簡單得多，直接可搬的東西有限 |
| 最大亮點 | `mergeByKey`（`script.js:140-149`）用 `updatedAt`/`createdAt` 做 last-write-wins 合併，加上「本機先寫、雲端排隊」的 `queueCloudSync`（`script.js:207-216`），整條同步鏈路乾淨且可獨立驗證，是本地優先系統要不要加雲端層時最直接的參考範本 |
| 最大缺口/風險 | `takeout.html` 是純靜態卡片＋前端分類篩選（`script.js:953-961`），沒有真正的篩選引擎、沒有過敏原/飲食限制欄位，跟 PRD.md §2／§10.4 的「型態選擇器＋硬性過濾 optimistic-fail-safe」設計差距很大；「常用餐食」也只是整包 meal 複製，沒有可跨餐複用的品項目錄，對應不到 PRD §10「我的品項」的完整欄位需求 |

---

## 1. 架構總覽

```
輸入
 ├─ 手動填表（diet.html 熱量分配、weightForm、mealForm）
 ├─ 拍照識餐（ai-food.html #foodPhoto/#cameraPhoto → 前端壓縮成 dataURL）
 └─ 常用餐食一鍵複用（history.html #favoriteMealList）
      ↓
處理
 ├─ 本機驗證/正規化（normalizeProfile、cleanNumber、mealFromForm）
 ├─ AI 辨識：fetch → Supabase Edge Function `analyze-food`（帶 JWT）→ DeepSeek 視覺模型
 │    → 逐項 items[] 回填可編輯表單（script.js:1088-1179）
 └─ 同步：storage.set() 寫 localStorage 後，非同步 queueCloudSync() 排隊寫 Supabase
      （script.js:19-30, 207-216）
      ↓
儲存
 ├─ 本機：localStorage 扁平 key-value（'meal-logs'、'weight-logs'、'favorite-meals'、
 │        'checklist-<date>'、'workout-done-<date>'、'user-profile'）
 └─ 雲端（登入後）：Supabase Postgres 表 meal_logs / weight_logs / daily_logs /
        favorite_meals / ai_usage_daily / ai_request_logs，皆有 RLS
      ↓
輸出／畫面
 ├─ index.html 今日儀表板（renderDailyNutrition）
 ├─ diet.html 熱量分配互動、progress.html 體重圖表與週報
 ├─ takeout.html 外賣分類卡片（純靜態內容＋前端篩選）
 └─ history.html 歷史列表＋常用餐食一鍵記入
```

技術棧沒有任何建置流程，`script.js` 用一個大 IIFE 掛所有頁面共用邏輯，靠 `$('#id')` 存在與否判斷目前在哪個頁面該跑哪段程式——這點跟 Lighten2「純前端無框架」的處境高度相似，可以直接參考它怎麼在單檔案裡切頁面邏輯而不炸開。

---

## 2. 資料模型（跟我們對照）

以下皆為本機 `localStorage` schema，來源 `script.js`：

| 本機 key | 結構（節錄自程式碼） | 對照 Lighten2（PRD.md 出處） |
|---|---|---|
| `meal-logs`（`script.js:580`, `1216-1225`） | `{id, date, createdAt, updatedAt, name, type, calories, protein, carbs, fat, note, source, items:[{name, amount, calories, protein, carbs, fat}]}` | 對照 L3 `daily_log`／`MealContent`（PRD §1、§3）。但欄位是攤平的巨集營養素總量＋`items` 純陣列快照，沒有 `ingredient`/`product`/`estimate` 三種元件的區分，也沒有 `meal_type`（`convenience\|delivery\|cook_quick\|cook_full`）欄位、沒有 `implicit`（用油/調味）——`items` 就是使用者確認後的靜態文字＋數字，比 PRD §3 的分層格式（可縮放食材／固定快照商品／估算＋隱含成分）簡化很多 |
| `favorite-meals`（`script.js:581`, `583-603`） | 與 `meal-logs` 同結構，但無 `date`，多一組 `id` 去重邏輯（依 name 正規化） | 最接近 PRD §10「我的品項」（`custom_foods` 擴充）的功能定位，但單位是「一整餐」而非「單一品項」，也沒有 `channel`/`role`/`valid_slots`/`allergen_tags` 等欄位，見第 3、6 節 |
| `weight-logs`（`script.js:715-716`） | `{date, weight, updatedAt}` | 對照 L3 `daily_log` 的體重欄位 |
| `checklist-<date>` / `workout-done-<date>`（`script.js:553-577`, `689-707`） | 布林陣列 index + 布林值 | 對照打卡/訓練紀錄；PRD §6.2 明訂「運動與飲食資料脫鉤」「`meal_plan` 等新資料結構不得引用 `exercise_log`」，此專案的 `daily_logs` 雲端表把 `checklist` 與 `workout_done` 塞進同一列同一時間戳，是掛勾的做法，屬於跟我們原則相反之處，見避坑 |
| `user-profile`（`script.js:32-49`） | `{currentWeight, targetWeight, height, calorieGoal, startWeight, completedAt}` | 對照 L1 `profile`，但欄位極簡，沒有 `meal_prefs[slot]`、`household_size`、過敏原/飲食限制欄位 |

雲端 schema（`supabase/migrations/202609140001_sync_and_ai_security.sql`）：`meal_logs`／`weight_logs`／`daily_logs`／`favorite_meals` 幾乎是本機結構的鏡像，用 `client_ref`（本機 id）做 `unique(user_id, client_ref)` 對應，`weight_logs`/`daily_logs` 用 `(user_id, date)` 當主鍵。這是「本機 id 當雲端業務鍵」的典型做法，值得參考（見第 5 節）。

---

## 3. 核心邏輯（依錨點深挖）：本地優先＋登入合併雲端資料

這是本專案對 Lighten2 最有參考價值的一條鏈，逐段附證據：

**(1) 寫入攔截點統一在 storage.set**（`script.js:19-30`）
```js
const storage = {
  get(key, fallback) { try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; } },
  set(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* private mode */ }
    if (!suppressCloudSync) queueCloudSync(key, value);
  },
  ...
};
```
所有業務邏輯只呼叫 `storage.set`，不知道雲端存不存在——本機寫入永遠優先且不因雲端失敗而回滾。`suppressCloudSync` 旗標用來在「拉雲端資料寫回本機」時避免立刻又把剛拉下來的資料推回雲端造成迴圈（`script.js:349-365`）。

**(2) 佇列化推送、失敗不阻塞**（`script.js:207-216`）
```js
function queueCloudSync(key, value) {
  if (!currentSession || ...不在同步白名單...) return;
  cloudWriteChain = cloudWriteChain
    .then(() => syncKeyToCloud(key, value))
    .then(() => setSyncStatus('已同步', 'success'))
    .catch(error => { console.error(...); setSyncStatus('等待同步', 'warning'); });
}
```
用一條 Promise 鏈序列化寫入，避免併發寫壞雲端資料；失敗只更新 UI 狀態文字，**不重試、不持久化失敗佇列**——下次登入或手動「立即同步」時靠全量 `syncAllData()` 重新推送修補，而不是斷點續傳。README 對外宣稱「網路失敗時本機記錄不丟失」是成立的（本機已經寫入），但「失敗後自動補推」**程式碼未見**，屬於文件宣稱、程式碼未見的落差。

**(3) 登入時的合併演算法**（`script.js:140-149`, `324-384`）
```js
const mergeByKey = (remote, local, key) => {
  const merged = new Map(remote.map(item => [item[key], item]));
  local.forEach(item => {
    const previous = merged.get(item[key]);
    const previousTime = Date.parse(previous?.updatedAt || previous?.createdAt || 0);
    const itemTime = Date.parse(item.updatedAt || item.createdAt || 0);
    if (!previous || !Number.isFinite(previousTime) || itemTime >= previousTime) merged.set(item[key], item);
  });
  return [...merged.values()];
};
```
以 `id`（meals/favorites）或 `date`（weights）為鍵，remote 先鋪底，本機資料若 `updatedAt`/`createdAt` 較新或找不到對應 remote 項就覆蓋——是簡單的 **last-write-wins**，沒有欄位級合併、沒有衝突提示 UI，刪除操作也沒有墓碑標記（`replaceRemoteRows` 靠「本機 id 集合以外的雲端列＝過期，直接刪除」處理刪除同步，`script.js:151-168`，這代表「裝置 A 刪除、裝置 B 離線新增同 id 不會發生」的前提下才安全，多裝置同時離線編輯同一筆會有一方靜默遺失，未見任何警告）。

**(4) 登入即觸發全量合併＋必要時整頁重載**（`script.js:530-543`, `508-528`）：`onAuthStateChange` 偵測到換帳號就呼叫 `syncAllData()`，若合併後內容有變化（`before !== after` 字串比較，`script.js:382-384`）就 `window.location.reload()` 讓所有頁面用最新 localStorage 重新渲染，避免多頁面各自持有舊的記憶體狀態。這個「合併完直接重整頁面」的暴力解法簡單有效，但代價是登入瞬間會有一次可感知的頁面重載（`script.js:517`）。

**(5) 每日打卡/訓練用「單一 updated_at 時間戳」做整日覆蓋**（`script.js:182-204`, `353-364`）：`checklist-<date>` 和 `workout-done-<date>` 兩把本機 key 合併成雲端一列 `daily_logs`，同步時互相依賴彼此的最新值重組整列（`storage.get('checklist-'+date)` 讀出目前本機值一起塞進 upsert payload），代表**這兩個獨立 UI 動作在雲端其實是同一顆粒度**，值得注意：PRD §6.2 明訂「運動與飲食資料脫鉤」「新資料結構不得引用 `exercise_log`」，這裡的教訓是「共用同一個時間戳/同一列」會讓兩個本該獨立的功能在同步邏輯上被迫綁死，未來若真的替 Lighten2 加同步層要避開這種設計。

小結：如果 Lighten2 未來要加同步層，這條鏈（`storage.set` 統一攔截 → 佇列化推送 → 登入時 `mergeByKey` 全量合併 → 必要時重載）是一份可以直接讀懂、複雜度不高的參考範本，比引入 CRDT/複雜衝突解決要務實得多，但要注意它「無墓碑刪除同步」「無欄位級合併」「無離線佇列持久化」這三個簡化點是有代價的（見避坑清單）。

---

## 4. 資料可用性評估

不適用 — 本專案沒有內建營養資料庫或食物成分資料集。`meal_logs`/`favorite_meals` 的 `items` 欄位完全靠 AI 辨識或使用者手動輸入自由填寫（`script.js:987-1026`），沒有任何 `data/*.json` 等對照表可供匯入或參考欄位擴充，也沒有 `protein_g`/`carb_g`/`fat_g`/`fiber_g` 這類正式營養資料 schema——欄位是 `calories/protein/carbs/fat` 四項，且無 `fiber`。

---

## 5. 高價值模組/借鏡清單

- `script.js:19-30`（`storage` wrapper）— 「本機寫入為唯一真相來源，雲端只是附加副作用」的攔截點設計，Phase 5（若做同步）可直接參考這種「業務邏輯完全不感知雲端」的隔離方式。
- `script.js:140-168`（`mergeByKey` + `replaceRemoteRows`）— 完整、可讀的 last-write-wins 合併＋刪除同步演算法，Phase 5 同步層設計時的最小可行範本；同時也是要在 PRD 討論「刪除語意」時的具體反例（沒有墓碑，見避坑）。
- `script.js:324-384`（`syncAllData`）— 「全量拉取＋合併＋必要時整頁重載」的簡化流程，適合單人（非多人協作）減脂 App 不需要複雜衝突 UI 時參考。
- `script.js:1028-1055`（`prepareImage`）— 前端用 `<canvas>` 把使用者相片壓縮到最長邊 1280px、JPEG q=.82 再送出，是「AI 拍照識餐」若 Lighten2 之後要做的話，控制圖片大小/上傳成本的具體作法。
- `script.js:1088-1179`（AI 識餐呼叫與逾時/失敗處理）— `AbortController` + 75 秒逾時、明確區分「逾時」與「一般失敗」訊息、`disabled` 狀態管理，是 AI 功能邊界處理的具體參考（對應必查項 3）。
- `supabase/migrations/202609140001_sync_and_ai_security.sql:128-167`（`consume_ai_quota`）— 用 Postgres function 做原子計數避免併發繞過每日配額，若 Lighten2 未來真的加 AI 配額限制（目前無雲端後端），這是不需要額外佇列服務就能做到原子性的簡單模式。
- `script.js:583-609`（`addFavorite`/`logFavoriteToday`）— 「收藏＝整餐快照去重＋一鍵複製成今天新紀錄」的最小實作，可對照 PRD §10「我的品項」要做到「品項級」（含 `channel`/`role`/`allergen_tags`，可跨餐重複使用）而非「整餐級」時的差異參考（見第 6 節）。

---

## 6. 避坑清單

1. **常用餐食是整餐快照，不是可組合的品項**（`script.js:583-609`）：`addFavorite` 存的是一整餐的巨集營養總量＋`items` 陣列快照，「常用」的最小單位是「一整餐」。使用者若常吃「7-11 茶葉蛋＋无糖豆漿」但想跟別的主食組合，沒辦法只複用「茶葉蛋」這個品項，只能整包套用或整包修改。這正是 PRD §10「我的品項」刻意做成品項級（`channel`/`role`/`valid_slots` 各自獨立，可在任何一餐被選用）要避開的整餐綁死做法，是一個具體的反面案例。
2. **刪除同步沒有墓碑，靠「本機 id 集合以外者視為過期刪除」**（`replaceRemoteRows`，`script.js:151-168`）：若使用者在裝置 A 離線刪除一筆記錄，裝置 B 離線新增了另一筆不同 id 的記錄，兩台裝置各自上線同步時，行為依賴時間先後，沒有防護提示或衝突警告，資料可能被靜默覆蓋或誤刪。若之後要做同步層，這裡至少要加使用者可見的「衝突/覆蓋」提示，而不是完全靜默解決。
3. **雲端寫入失敗沒有持久化重試佇列**（`queueCloudSync`，`script.js:207-216`）：失敗只改 UI 狀態文字（"等待同步"），沒有存到 localStorage 的待重試清單；如果使用者離線後直接關掉分頁，這筆雲端寫入永遠不會自動補上，要等下次登入時 `syncAllData()` 全量比對才會修正。功能上不算資料遺失（本機已存），但「等待同步」文案給人的印象比實際保證更強。
4. **打卡與訓練完成狀態被綁進同一個雲端列/時間戳**（`script.js:182-204`）：`daily_logs` 表把 `checklist` 跟 `workout_done` 塞進同一列，同步任一項時都要重新讀出另一項現值一起 upsert。這跟 Lighten2「運動與飲食資料脫鉤」的核心原則相反——如果我們以後真的要做打卡/運動紀錄的雲端同步，不該讓兩個獨立概念共用一顆時間戳/一張表，否則之後想拆分會很痛。
5. **`takeout.html` 名不副實，沒有真正的篩選引擎**：全部 6 張卡片寫死在 HTML 裡（`takeout.html:20-32`），`filter-bar` 只是前端 `hidden` 屬性切換（`script.js:953-961`），沒有依熱量/蛋白質/過敏原做任何運算式篩選，也沒有 PRD §10.4 那種 optimistic-fail-safe 的過濾概念。如果只看 README「外卖筛选」的敘述會誤以為有推薦邏輯，**文件宣稱、程式碼未見**——實際是靜態內容頁＋分類 tab。PRD §2 的「型態決定 UI 開哪一種選擇器（商品多選 vs 餐型骨架食材軸）」若想參考跟外食（`delivery`）有關的介面，這裡能借鏡的僅止於「卡片＋一鍵複製點餐備注」這個 UX 巧思，篩選/推薦邏輯本身沒有東西可抄。
6. **無任何過敏原/飲食限制欄位**：全專案 grep 不到 `allergen`/`过敏`/`忌口`/`限制` 相關程式碼或資料欄位，`user-profile` 沒有此類欄位。跟 PRD §10.4「`allergen_tags === null` 一律視為未確認，只有使用者設過敏原/飲食限制時才會擋」的 optimistic-fail-safe 原則完全無對應實作，屬於此專案在範圍上就沒有涉及的部分，不是做錯，而是没做。

---

## 7. 一句話結論

這個 repo 對 Lighten2 現階段（PRD.md、Phase −1a 起）的直接可用價值有限（takeout/常用餐食都比 PRD §2、§10 規劃的簡化很多），但它的「本地優先＋登入合併」同步鏈路（`script.js` 的 `storage`/`mergeByKey`/`syncAllData`）程式碼乾淨、可直接讀懂運作方式，最適合留到**未來真的要決定要不要加雲端同步層時**回頭精讀，作為「不做 CRDT、只做 last-write-wins 全量合併」這條務實路線的具體範本；也可以在平行工作線 B-1「我的品項」設計整餐/品項顆粒度時，拿它的整餐級收藏當反面案例，或在未來若做 AI 拍照識餐時參考它的圖片壓縮與逾時/配額處理。
