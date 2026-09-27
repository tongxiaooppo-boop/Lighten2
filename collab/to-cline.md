# 目前任務（來自 Claude）— 週彈性帳本整個拆除，換成「體重趨勢自動校正」

這是三輪 Opus 獨立審核後定案的大改動（使用者質疑「週彈性1400kcal」沒有數字依據）。**完整規格跟審核過程都存在 `collab/opus-review-log/2026-09-27-tdee-calibration-offset-wiring.md`，下面是我依那份規格整理出的實作清單；如果哪個細節這份清單沒講清楚，先去看那份 log，不要自己猜。** 這輪範圍很大，切成 8 個部分，**建議每個部分一個 commit**。

核心方向：
- 週彈性帳本（`cap_kcal`/`used_kcal`）整個刪掉，不是留著不顯示。
- 大餐當天：保留「當天重新分配熱量」，另外讓預約中的大餐也影響蛋白質/纖維缺口計算（見 Part 7）。
- 長期熱量盈餘交給「體重趨勢自動校正」：新的 `tdee_state`，EWMA 平滑 + 28天斜率 + 依 goal_mode 門檻，維持模式下修需使用者按確認，其他方向自動套用，隔天生效，14天冷卻，累計 offset 上限 ±300kcal。
- 進度顯示全部改成「近7天平均 vs 目標」中性顯示，不足3天顯示「資料不足」，文案禁用「額度/剩餘/超支/彈性點數/還/補/抵/存」這些字（「還沒」「補充」這類詞裡面也含禁用字，一併避開）。
- 「預約大餐」表單/清單本身維持不動，跟熱量帳本機制脫鉤即可。

---

## Part 1：刪除週彈性帳本相關程式碼

**真的刪乾淨，不要留著不呼叫或註解掉。**

`js/engine/feast.js`：
- 刪除 `CUT_CAP_RATIO`、`FLEX_CAP_FIXED`、`DAILY_SAVE_CAP_RATIO`、`SETTLE_SLOTS` 常數。
- 刪除函式：`computeWeeklyCapKcal`、`computeDaySettlement`、`settleWeeklyLedger`、`planOverageSmoothing`、`safetyFloorFor`（如果別處沒用到）。
- 刪除對應的 `window.xxx = xxx` 匯出（`computeWeeklyCapKcal`、`settleWeeklyLedger`、`planOverageSmoothing`）。
- `reserveFeast`/`logFeastDirectly`/`confirmFeast`/`cancelFeast` 本身邏輯不變（它們現在本來就沒有直接碰 ledger）。

`js/database.js`：
- 刪除 `getWeeklyLedger`、`updateWeeklyLedger`（如果有）以及 `weekly_flex_ledger` store 相關存取函式。
- IndexedDB 裡已存在的 `weekly_flex_ledger`/`ledger_last_settled_date` 這兩筆資料**不用遷移**，直接放著不讀。

`js/ui/tab-today.js`：
- 刪除呼叫 `settleWeeklyLedger(...)` 那行（第186行附近）。
- `renderHero()` 裡刪除讀 `getWeeklyLedger`/`computeWeeklyCapKcal` 算 `flexRemaining` 那段（第131–138行）。這塊會在 Part 6 換成新內容。

`js/ui/tab-week.js`：
- 刪除讀 `getWeeklyLedger`/`computeWeeklyCapKcal` 算 `cap`/`used`/`remaining` 那段（第155–172行）以及 `#week-flex` 那行文字（第199–202行）。Part 6 會換成新內容。

`js/ui/tab-ledger.js`：
- 刪除 `render()` 裡呼叫 `settleWeeklyLedger`/`getWeeklyLedger`/`computeWeeklyCapKcal`/`updateWeeklyLedger` 那段（第252–261行），以及 `renderProgress(used, cap)` 函式本身。Part 6 會換成新內容。

**驗證：** 全專案 grep 找不到 `cap_kcal`、`used_kcal`、`weekly_flex_ledger`、`computeWeeklyCapKcal`、`computeDaySettlement`、`settleWeeklyLedger`、`planOverageSmoothing`、`getWeeklyLedger`、`updateWeeklyLedger`、`CUT_CAP_RATIO`、`FLEX_CAP_FIXED`、`DAILY_SAVE_CAP_RATIO`（HTML 裡的 `#ledger-used`/`#ledger-cap`/`#ledger-bar-fill`/`#today-hero-flex`/`#week-flex` 這些 id 會在 Part 6 處理，先不用管）。

---

## Part 2：`tdee_state` 資料結構

`js/database.js` 新增（用現有 `settings` store，key 固定字串 `"tdee_state"`，跟 `getSetting`/`setSetting` 同一套機制，不要新開 store）：

```js
async function getTdeeState() {
  const raw = await getSetting("tdee_state");
  return raw || {
    version: 1,
    offset_kcal: 0,
    prev_offset_kcal: 0,
    effective_date: null,
    last_adjusted_date: null,
    last_evaluated_date: null,
    goal_mode: null,
    mode_since_date: null,
    pending: null,
    dismissed_until: null,
    announce_until: null,
    last_result: null,
    history: [],
  };
}
async function saveTdeeState(state) {
  return await setSetting("tdee_state", state);
}
```

各欄位意義見 log 檔第1節，逐行有註解，照抄即可。

刪除舊的 `getTdeeCalibration`／`saveTdeeCalibration`／`STORE.tdeeCalibration`（`tdee_calibration_log` store 相關存取）。舊資料不遷移，放著不讀。

---

## Part 3：`js/engine/tdee.js` 整個重寫

這是本次改動最核心的邏輯，**完全依照 log 檔第3節的規格實作**，包含：
- 常數（`ALPHA`/`WINDOW_DAYS`/`ADJUST_KCAL`/`OFFSET_CAP`/`COOLDOWN_DAYS`/`DISMISS_DAYS`/`ANNOUNCE_DAYS`/`MIN_WEIGHINS`/`MIN_SPAN_DAYS`/`MAX_STALE_DAYS` 等，數值都在 log 檔裡）。
- `RULES` 門檻表（減脂/增肌/維持三種模式，維持模式下修標記 `confirm: true`）。
- EWMA 平滑（處理量測天數不固定的情況，`α_eff = 1 - (1-ALPHA)^g`）。
- 28天線性回歸算斜率（單位 kg/週）。
- `evaluateCalibration(profile, { force })`：log 檔列的 12 個步驟依序執行，包含模式切換偵測、資料不足判斷、冷卻期、累計上限 clamp、熱量下限檢查、**第9步「下修前攝取紀錄檢查」**（減脂/維持要下修時，迴歸窗內完整記錄日要 ≥14天且平均攝取 ≤ 目標×1.10，否則 `status = "intake_gap"` 不調整——這條是防止「吃多→體重沒降→目標被自動調更低」的棘輪效應，跟 PRD 一貫禁止的補償機制是同一個道理，**不要省略這步**）、pending 確認流程。
- `applyOffset(state, newOffset, source)`：隔天生效（`effective_date = today+1`）、`last_adjusted_date` 開始冷卻、更新 `history`。
- 對外函式：`ensureDailyCalibration(profile)`（同一天共用一個 Promise，避免 today/week/profile 三個分頁同時觸發三次評估）、`runCalibrationNow(profile)`、`confirmPendingCalibration()`、`dismissPendingCalibration()`、`resetCalibrationOffset()`、`getCalibratedTargets(profile, dateStr)`。
- 刪除舊的 `calibrateWeeklyTdee`、`computeTrends`、`avgInRange`、`weekStartOfToday`、`goalMultiplier`、`isMale`。

`isCompleteLogDay(dayLogs, enabledSlots)`（第9步跟 Part 6 都要用）放在 `js/engine/budget.js`，用現有的 `isSlotEnabled` 判斷「該天所有開啟時段都有記錄」。

**驗證：** 全專案 grep 找不到 `calibrateWeeklyTdee`、`saveTdeeCalibration`、`getTdeeCalibration`。

---

## Part 4：`calculateTargets` 接上 offset

`js/engine/nutrition.js`：
- 簽名改成 `calculateTargets(profile, opts)`，`opts = { offsetKcal }` 預設 0。維持純同步、不碰 DB。
- 算出 `targetKcal = tdee * multiplier` 後，先存 `baseTargetKcal = targetKcal`，再 `targetKcal += offsetKcal`，然後才做熱量下限 floor 檢查（下限永遠優先，offset 不能讓目標低於下限）。
- 脂肪/碳水用「加了 offset 之後」的 `targetKcal` 推算；蛋白質/纖維不受影響。
- 回傳值多兩個欄位：`baseTargetKcal`、`offsetKcal`。

**呼叫端改動：**

| 檔案 | 位置 | 改法 |
|---|---|---|
| `js/ui/tab-today.js` | 第166行 | `const targets = calculateTargets(profile);` → `const targets = await getCalibratedTargets(profile);` |
| `js/ui/tab-week.js` | 算 `targets` 那行 | 同上，改用 `await getCalibratedTargets(profile)` |
| `js/ui/tab-ledger.js` | Part 6 新增的近7天平均邏輯要用到目標值的地方 | 同樣用 `getCalibratedTargets(profile)` |
| `js/ui/tab-profile.js` | 見 Part 5 | — |

`js/engine/recommend.js`、`js/engine/budget.js` 不用改，它們吃的是已經算好的 `targets.targetKcal`，offset 已經在裡面反映了。

---

## Part 5：`tab-profile.js` 校正卡片（唯一能操作 offset 的地方）

`index.html` 第192行的 `#calibrated-target-row` 整個換成一張卡片 `#calibration-card`，內容：
- 目標拆解：公式目標／校正值／目前每日目標三行；如果 `effective_date` 是明天，多顯示「明天起：X kcal」。
- 趨勢：「近4週體重趨勢：+0.3 kg／週」；資料不足時顯示「需要近4週至少8次體重紀錄」。
- 狀態說明（中性語氣，對應 `last_result.status`：`cooldown`/`capped`/`at_floor`/`intake_gap`/`dismissed`/`ok`）。
- **pending 區塊**（只有 `status === "pending"` 時顯示，只有維持模式下修會進到這個狀態）：
  - 文字：「近4週體重平均每週上升 0.6 kg。如果你這段期間有重訓增肌，這可能是正常的；如果沒有，可以把每日目標下調 150 kcal（明天起生效）。」
  - 按鈕「套用」→ `confirmPendingCalibration()`，重畫卡片，顯示「明天起每日目標 X kcal」。
  - 按鈕「先不要」→ `dismissPendingCalibration()`，重畫卡片，顯示「14天內不會再提醒這件事」。
- offset 不為 0 時顯示「重設校正」按鈕 → `resetCalibrationOffset()`。

`onCalculate`、頁面載入時的 `showTargets`，都改用 `await getCalibratedTargets(profile)` 的結果；`#target-kcal` 顯示校正後的值。記錄體重成功之後、`onCalculate` 存完 profile 之後，都呼叫一次 `runCalibrationNow(profile)` 再重畫卡片（見 log 檔第4節）。

`js/app.js`：在檔案最後加一行 `window.activateTab = activateTab;`（目前 `activateTab` 沒有對外暴露，Part 6 的今日建議提示要用它切換到基本資料分頁）。

**取捨已經拍板，不用再問使用者**（我依營養師溝通角度決定，理由見下面「兩個決策」）：
1. 卡片上**直接顯示「校正 −150kcal」這個拆解數字**，不要收起來。
2. `intake_gap` 狀態的文案**要明講原因**，用中性、描述事實的語氣，例如：「近4週平均攝取略高於目前目標，這段體重變化較可能反映的是這部分，所以先不調整」——不要寫成「吃太多」這種評價語氣，也不要跟 `insufficient`（純資料不足）共用同一句文案，這兩種狀態原因不同，共用文案會讓使用者以為多記錄幾天就會變。

---

## Part 6：三個分頁的進度顯示改成「近7天平均 vs 目標」

`js/engine/budget.js` 新增共用函式：

```js
function computeRecentAvgVsTarget(logs, targetKcal, enabledSlots, days) {
  // logs: 任意天數範圍的 daily_log 陣列；days 預設 7
  // 依 log_date 分組，用 isCompleteLogDay 篩出「完整記錄日」，
  // 完整記錄日 < 3 天 → { status: "insufficient" }
  // 否則 → { status: "ok", avgKcal, targetKcal, completeDays: n }
}
```

三個分頁都改用這個函式取代舊的彈性點數顯示：

- **`tab-today.js` 頂部彙總卡**：`#today-hero-flex` 這個位置（`index.html` 第230–231行，class/id 可以改成更符合新內容的名字，例如 `#today-hero-week-avg`，記得 JS 同步改）改顯示「近7天平均 X／目標 Y kcal」；資料不足時顯示「資料不足」。同一個彙總卡也是 Part 5 提到的校正提示要出現的地方：
  - 有 pending 時顯示一行「基本資料有一項目標調整建議待你確認」，點擊呼叫 `window.activateTab("profile")`。
  - `today <= announce_until` 時顯示一行「依近4週體重趨勢，每日目標從 M/D 起調整為 X kcal」。
- **`tab-week.js`**：`#week-flex` 那行文字改用 `computeRecentAvgVsTarget` 的結果，拿掉「彈性點數：剩餘…／上限…」的文案。
- **`tab-ledger.js`**：`renderProgress`/`#ledger-used`/`#ledger-cap`/`#ledger-bar-fill` 這組進度條 UI，改成同樣的「近7天平均 vs 目標」文字顯示（不用進度條也可以，中性文字即可）。

**文案硬性規則**：全部三處都不能出現「額度/剩餘/超支/彈性點數/還/補/抵/存」這些字（含「還沒」「補充」之類詞裡帶到的字）。做完後 grep 一次確認。

---

## Part 7：大餐當天——預約中的大餐也要影響蛋白質/纖維缺口

現況：`tab-today.js` 的 `pseudoLogsForBudget`（第179–184行）已經把「今天預約中的大餐」的 **kcal** 塞進 `recalcTodayBudget`，讓其他時段的剩餘熱量配額提前反映；但 `checkHardConstraints(weekLogs, profile)`（第185行）算「今天蛋白質缺口/本週纖維缺口」時，只讀 `weekLogs`（實際 `daily_log`），**沒有**把預約中大餐的蛋白質/纖維算進去。這代表「同一天其他時段優先推薦補蛋白質/纖維」目前對「已確認/已記錄」的大餐才成立，對「還在預約中」的大餐不成立。

改法：
1. 把 `todayReservations` 裡每筆的 `item_id`/`size` 用 `resolveFeastItem(itemId, size)`（`feast.js` 已匯出）解回 `protein_g`/`fiber_g`（跟現有塞 kcal 進 `pseudoLogsForBudget` 的寫法一樣，多解一次巨量營養素）。
2. 組一份 `pseudoLogsForConstraints = weekLogs.concat(todayReservations.map(...))`（帶 `log_date: today`、`slot`、`protein_g`、`fiber_g`），傳給 `checkHardConstraints`。因為預約還沒寫進 `daily_log`，用 `concat` 不會重複計算。
3. `matcher.js` 的 `checkHardConstraints` 本身不用改，它已經是照 `log_date === today` 抓蛋白質、照 `fiberByDate` 抓纖維，塞進去的 pseudo 記錄會自然被算到。

**驗證：** 預約一筆低蛋白/低纖維的大餐後，同一天其他時段的推薦排序要能反映蛋白質/纖維缺口變大（用 node 模擬跑 `checkHardConstraints` 前後兩種輸入比對缺口數值變化即可，不用開瀏覽器）。

---

## Part 8：文件同步

`輕盈計畫PRD_v4.0.md`／`輕盈計畫_TECH-SPEC.md` 裡提到「週彈性帳本」「cap_kcal」「1400kcal固定額度」的段落，改成描述新的「體重趨勢自動校正」機制（可以直接引用 log 檔第1–5節的內容摘要）。

---

## 驗收清單（合併自 log 檔第7節，直接照抄跑一遍）

- 維持模式，斜率 +0.6 kg/週，資料充足 → 產生 pending，offset 不變；按「套用」→ 明天目標 −150，`last_adjusted_date` 更新為今天。
- 按「先不要」→ 14天內都是 `dismissed`；第15天條件仍成立 → 再次產生 pending。
- 減脂模式，斜率 −0.1 kg/週，完整記錄日 ≥14天且平均攝取 ≤ 目標×1.1 → 自動套用 −150，14天內不再調；第二次到 −300，第三次 `capped`。
- 同樣情境但完整記錄日 <14天 → `intake_gap`，offset 不變。
- 目標已在熱量下限又觸發下修 → `at_floor`。
- 切換 goal_mode → pending 清掉，之後21天內 `insufficient`，offset 保留。
- 按一次 profile「計算」後 `tdee_state` 還在（沒被 profile 整筆覆寫清掉）。
- grep 全專案：`calibrateWeeklyTdee`／`saveTdeeCalibration`／`getTdeeCalibration`／`cap_kcal`／`used_kcal`／`weekly_flex_ledger` 全部消失；`feast.js` 裡沒有任何 `calculateTargets` 呼叫。
- 三個分頁同時載入時 `evaluateCalibration` 當天只執行一次（可以暫時加 `console.count` 驗證完再拿掉）。
- grep 確認新文案沒有「額度/剩餘/超支/彈性點數/還/補/抵/存」（含「還沒」「補充」）。

---

做完後照協作規則：**只要本機 commit，不要 `git push`**，並把報告寫進 `collab/from-cline.md`。這輪範圍大，建議 Part 1+2、Part 3、Part 4+5、Part 6、Part 7+8 分開 commit，比較好追蹤跟回溯。

## 分工說明

GitHub push 與部署由 Claude 負責，Cline 只需要寫程式、本機 commit，不用處理 remote，不用管部署。
