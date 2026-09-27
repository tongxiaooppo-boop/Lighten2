# 2026-09-27 Opus 第三輪審核：體重校正結果怎麼寫回每日目標

背景：前兩輪 Opus 審核已定案「週彈性帳本整個刪除，長期熱量盈餘交給體重趨勢自動校正」的方向（見 `collab/claude-session-handoff.md`）。這一輪只聚焦一個具體缺口：`calibrateWeeklyTdee` 算出來的校正結果目前只顯示、沒有真正寫回 `targetKcal`，這輪要設計資料流。

## 送審 prompt（我方）

你是被找來做獨立架構審核的 Opus，這是「輕盈計畫」(D:\ok\lighten) 減重/健身記錄 app 的第三輪審核，接續前兩輪已經定案的方向。這次只聚焦一個具體的資料流缺口，不要重新討論已經定案的大方向。

### 背景（前兩輪已定案，不要重新辯論）

使用者質疑「週彈性帳本」(`cap_kcal`/`used_kcal`，維持模式固定1400kcal) 沒有數字依據，前兩輪 Opus 審核後定案方向：
1. 大餐當天：保留現有「當天重新分配熱量」機制（`js/engine/budget.js` 的 `recalcTodayBudget`，跟今天已吃/預約的熱量算剩餘配額，按權重分給還沒吃的時段），同一天其他時段的推薦邏輯改成優先推薦補蛋白質/纖維，不是單純少給熱量。
2. 長期熱量盈餘不再用週帳本處理，改成「體重趨勢自動校正每日目標熱量」：重寫 `js/engine/tdee.js` 的 `calibrateWeeklyTdee`——體重用 EWMA 平滑掉單次水腫雜訊，看 28 天線性回歸斜率，依 `goal_mode`（減脂/維持/增肌）各自不同觸發門檻做校正。維持模式「下修」目標熱量必須使用者按確認（避免跟重訓增肌的正常體重上升搞混），其他方向（減脂/增肌的校正、維持模式的上修）自動套用。每次調整幅度上限 ±300kcal（這是「累計 offset」的上限，不是單次調整量的上限），修正後 14 天內不再調整（冷卻期）。
3. 週彈性帳本相關函式/常數全部刪除（`cap_kcal`/`used_kcal`/`computeWeeklyCapKcal`/`computeDaySettlement`/`settleWeeklyLedger`/`planOverageSmoothing`/`getWeeklyLedger`/`updateWeeklyLedger`/`CUT_CAP_RATIO`/`FLEX_CAP_FIXED`/`DAILY_SAVE_CAP_RATIO`），真的刪乾淨，不是留著不顯示。IndexedDB 裡已存在的 `weekly_flex_ledger`/`ledger_last_settled_date` 不用遷移。
4. 進度顯示改成「近7天平均 vs 目標」的中性顯示（今日建議彙總卡＋`tab-ledger.js`＋`tab-week.js`都要改），只用「完整記錄日」（該天所有開啟時段都有記錄）算平均，不足3天顯示「資料不足」，文案禁用「額度/剩餘/超支/彈性點數/還/補/抵/存」這些字。
5. 「預約大餐」表單/清單（`tab-ledger.js`）維持不動。

### 我發現的具體缺口，需要你設計解決

我讀了現有程式碼，發現一個資料流斷點：目前 `calibrateWeeklyTdee(weightLogs, dailyLogs, profile)`（`js/engine/tdee.js`）算出的校正結果，只被 `js/ui/tab-profile.js` 的 `refreshCalibration()` 拿來顯示在「本週校正後每日預算」這一行文字（`showCalibration()`，純顯示，`hidden` 屬性控制要不要顯示），從來沒有寫回任何地方。

真正決定使用者今天/本週熱量目標的地方是：
- `js/ui/tab-today.js` 第166行：`const targets = calculateTargets(profile);`，直接用 profile 的原始身高/體重/年齡/goal_mode 算，`recalcTodayBudget(targets.targetKcal, ...)` 用這個當基準分配今天剩餘配額。
- `js/ui/tab-week.js`：也是直接呼叫 `calculateTargets(profile)`。
- `calculateTargets` 定義在 `js/engine/nutrition.js`（我沒附全文，但確認它只吃 profile 欄位，不吃任何校正 offset）。

也就是說，現在「校正」完全是死路——算出來的數字只顯示，不影響任何實際配額或推薦邏輯。前兩輪 Opus 的方向要求「上修自動套用、維持模式下修需使用者確認」，但沒有交代：

1. 校正後的 offset 要存在哪裡（例如 profile 新增欄位 `calibration_offset_kcal`？還是獨立一個 `tdee_state` store，記錄 `current_offset_kcal`、`last_adjusted_date`、`pending_confirmation`？）
2. `calculateTargets(profile)` 或它的呼叫端（`tab-today.js`/`tab-week.js`/`recommend.js` 用到 targetKcal 的地方）要怎麼吃到這個 offset——改 `calculateTargets` 簽名？還是呼叫端各自加 offset？
3. ±300kcal「累計上限」怎麼追蹤——是限制 offset 的絕對值不能超過 ±300，還是限制每次校正的變化量？兩者不一樣，要講清楚。
4. 14天冷卻期怎麼實作——存最後一次調整日期，14天內即使觸發條件符合也不調整，這個「最後調整日期」要跟 offset 一起存在同一個地方。
5. 維持模式下修需要「使用者按確認」——這代表校正邏輯算出「應該下修」後，要先進入一個 pending 狀態，UI 要有地方讓使用者看到並按確認/忽略，確認後才真正把 offset 更新、觸發14天冷卻。這個 pending 狀態存哪裡、UI 放在哪個分頁、忽略的話下次還會不會再問一次同一筆校正。
6. 這個 offset 的套用時機——校正邏輯本身是「每次進某個分頁時算一次」，還是需要變成每天固定跑一次（例如像現有 `settleWeeklyLedger` 那樣用一個「上次算到哪天」的游標）？

### 任務

只設計這個資料流缺口的解法，不要重新討論前兩輪已經定案的方向、門檻數值、或要不要保留週帳本。給可以直接實作的規格：`tdee_state` 或等效資料結構的完整欄位定義、`calibrateWeeklyTdee` 改寫後的完整流程、`calculateTargets` 或呼叫端要怎麼改、使用者確認 UI 要放在哪裡、校正邏輯什麼時候該被呼叫。有兩個以上同樣合理的做法時直接選一個並說明為什麼，除非真的是使用者才能決定的取捨才點出來讓我去問使用者。

## Opus 回覆（完整、逐字）

我先讀過現況，確認你說的斷點成立，另外多找到三個會影響設計的事實：

- **offset 不能放 profile。** `tab-profile.js` 的 `onCalculate` 用 `readProfileForm()` 讀出整份表單，再 `saveProfile(profile)` 整筆覆寫（`database.js` 是固定 key 直接 setItem）。放在 profile 的欄位只要使用者按一次「計算」就會被清掉。
- **現有 `tdee_calibration_log` 是「週一當主鍵、每週一筆」的結構**，跟「冷卻期／等待確認／隔天生效」這種單一狀態機對不上。
- **目前各分頁不在「切換到該分頁」時載入，而是在 DOMContentLoaded 時各自 `ready()` 平行載入。** `app.js` 只切換顯示，沒有發事件。所以校正一定要有一個大家共用、同一天內只跑一次的 Promise，不然 today、week、profile 三個分頁會互相搶著讀寫。

另外 `collab/claude-session-handoff.md` 寫明「隔天生效，不中途改當天配額」，下面照這條設計。

---

### 1. 資料結構：`tdee_state`

**存放位置：** 現有 `settings` store，key 為 `"tdee_state"`，整個物件一筆。
- 不另開新 store，因為 localforage 在同一個 DB 新增 store 要升版本，而且跟已經開著的 instance 容易出錯。
- 不放 profile，原因見上。

`database.js` 新增 `getTdeeState()` 和 `saveTdeeState(state)`，內部就是 `getSetting` / `setSetting("tdee_state")`。讀到 null 時回傳下面的預設值。

**刪除：** `getTdeeCalibration`、`saveTdeeCalibration`、`STORE.tdeeCalibration`。歷史紀錄改放 `tdee_state.history`。舊 store 的資料不遷移，照第三點的原則放著不讀。

```js
const DEFAULT_TDEE_STATE = {
  version: 1,
  offset_kcal: 0,             // number。已採用的「累計」offset，永遠限制在 [-300, +300]
  prev_offset_kcal: 0,        // number。effective_date 之前（含今天）用的 offset，用來做到「隔天生效」
  effective_date: null,       // "YYYY-MM-DD" | null。offset_kcal 從這天開始生效；null 表示已生效
  last_adjusted_date: null,   // "YYYY-MM-DD" | null。最後一次 offset 真的改變的日子，14 天冷卻期從這天算
  last_evaluated_date: null,  // "YYYY-MM-DD" | null。每日防重跑游標
  goal_mode: null,            // string | null。上次評估時的 goal_mode，用來偵測模式切換
  mode_since_date: null,      // "YYYY-MM-DD" | null。目前這個 goal_mode 從哪天開始
  pending: null,              // null | { delta_kcal:-150, proposed_offset_kcal, created_date,
                              //          slope_kg_per_week, ewma_latest_kg, goal_mode }
                              // 只有「維持模式下修」會用到
  dismissed_until: null,      // "YYYY-MM-DD" | null。使用者按「先不要」後，這天之前不再詢問
  announce_until: null,       // "YYYY-MM-DD" | null。自動調整後，今日建議卡顯示一行告知到這天
  last_result: null,          // { date, status, slope_kg_per_week, ewma_latest_kg, n_weighins, note }
                              // 給 UI 顯示用
  history: []                 // [{ date, from, to, source, slope_kg_per_week }]，最多保留 20 筆
                              // source 可能值："auto" | "confirmed" | "dismissed" | "expired"
                              //               | "reset" | "mode_change"
};
```

**取某一天用的 offset：**

```js
function offsetForDate(state, dateStr) {
  if (state.effective_date && dateStr < state.effective_date) return state.prev_offset_kcal;
  return state.offset_kcal;
}
```

**±300 是限制累計 offset 的絕對值，不是限制單次的變化量。**
- 單次調整量固定用現有的 `ADJUST_KCAL = 150`。
- 新 offset = `clamp(offset_kcal + delta, -300, +300)`。
- 所以同一個方向最多連調兩次。
- 如果 clamp 之後數值沒變（已經到頂），`status = "capped"`，不更新 `last_adjusted_date`，也不開始冷卻期。

**offset 加在目標熱量上，不加在 TDEE 上。** 這樣使用者看到的「±300」就是每日目標真的變動的量，比較好解釋。現有 `calibrateWeeklyTdee` 是加在 TDEE 再乘 multiplier，這個做法要改掉。

---

### 2. `calculateTargets` 怎麼吃到 offset

**只改 `calculateTargets` 本身，呼叫端不各自加。** 原因：脂肪和碳水是由 `targetKcal` 推算的，熱量下限也必須在 offset 之後才檢查。如果呼叫端各自加 offset，巨量營養素和下限都會算錯。

**`js/engine/nutrition.js`：**
- 簽名改成 `calculateTargets(profile, opts)`，其中 `opts = { offsetKcal: number }`，預設 0。
- 保持純同步函式，不碰 DB。
- 步驟 3 算出 `targetKcal = tdee * multiplier` 之後，先記下 `baseTargetKcal = targetKcal`，再做 `targetKcal += offsetKcal`，然後才進步驟 4 的熱量下限 floor。下限永遠優先。
- 步驟 5、6 的脂肪／碳水改用加上 offset 之後的 `targetKcal`。蛋白質、纖維不變。
- 回傳值多兩個欄位：`baseTargetKcal`、`offsetKcal`。

**`js/engine/tdee.js` 新增對外函式：**

```js
async function getCalibratedTargets(profile, dateStr /* 預設今天 */) {
  await ensureDailyCalibration(profile);
  const state = await getTdeeState();
  return calculateTargets(profile, { offsetKcal: offsetForDate(state, dateStr) });
}
window.getCalibratedTargets = getCalibratedTargets;
```

**要改的呼叫端：**

| 檔案 | 位置 | 改法 |
|---|---|---|
| `js/ui/tab-today.js` | 第 166 行 | 改成 `const targets = await getCalibratedTargets(profile);`。同一段把 `settleWeeklyLedger(...)` 那行刪掉（第三點本來就要刪）。 |
| `js/ui/tab-week.js` | 第 115 行 | 同上，改用 `await getCalibratedTargets(profile)`。「近 7 天平均 vs 目標」直接用今天生效的目標，不逐日回推當天的 offset。原因：一年最多調幾次，逐日回推帶來的精確度換不回複雜度。 |
| `js/ui/tab-profile.js` | `onCalculate` | 見第 5 節。 |
| `js/ui/tab-ledger.js` | 新的近 7 天平均顯示 | 如果會用到目標值，一樣改用 `getCalibratedTargets`。 |
| `js/engine/feast.js` | 第 43、249 行 | 兩處呼叫都在要刪的 `computeWeeklyCapKcal` / `settleWeeklyLedger` 裡，會跟著函式一起刪掉。刪完後 feast.js 不能再有任何 `calculateTargets` 呼叫。 |

- `js/engine/recommend.js` 不用改。它只吃 `recalcTodayBudget` 的結果，offset 已經反映在 `targets.targetKcal` 裡了。
- `js/engine/budget.js` 不用改。

---

### 3. `tdee.js` 改寫：`evaluateCalibration(profile, { force })`

#### 常數

```js
const ALPHA = 0.1;            // 每日 EWMA 係數
const MAX_GAP_DAYS = 7;       // 缺測天數上限，用來限制補量權重
const LOOKBACK_DAYS = 56;     // 讀 56 天體重：前 28 天讓 EWMA 暖機，後 28 天做迴歸
const WINDOW_DAYS = 28;
const ADJUST_KCAL = 150;
const OFFSET_CAP = 300;
const COOLDOWN_DAYS = 14;
const DISMISS_DAYS = 14;
const ANNOUNCE_DAYS = 3;
const MIN_WEIGHINS = 8;       // 28 天窗內至少 8 次量測
const MIN_SPAN_DAYS = 21;     // 窗內第一次到最後一次量測至少相隔 21 天
const MAX_STALE_DAYS = 7;     // 最後一次量測距今不超過 7 天
```

#### 門檻表：沿用現有 `T` 的數值，語意改成「28 天迴歸斜率，單位 kg/週」

- 現有 `T` 的 7 天／14 天兩層判斷，由單一斜率取代。
- 如果第二輪 agent `a3e31f65680f15963` 的對話紀錄裡有不同的門檻數值，只要換這張表，流程不用動。

```js
const RULES = {
  cut:      [ { when: s => s > -0.2, delta: -150 },   // 下降太慢
              { when: s => s < -1.0, delta: +150 } ], // 下降太快
  bulk:     [ { when: s => s <  0.1, delta: +150 },   // 增加太慢
              { when: s => s >  1.0, delta: -150 } ], // 增加太快
  maintain: [ { when: s => s >  0.5, delta: -150, confirm: true }, // 維持模式下修，要使用者確認
              { when: s => s < -0.5, delta: +150 } ],
};
```

`goal_mode` 的中英文 key 正規化，跟 `nutrition.js` 用同一套對照（減脂→cut、增肌→bulk、其他→maintain）。

#### EWMA 做法（處理不固定天數量測）

1. 讀取 `getWeightLogs({ start: today - 55 })`，依日期排序。
2. 初始值 = 最早 3 筆量測的平均，降低第一筆碰到水腫的影響。
3. 從第一筆量測那天開始，逐日往後走到今天：
   - 當天有量測：`g` = 距離上一次量測的天數，上限 7。
     `α_eff = 1 - (1 - ALPHA)^g`，然後 `ewma += α_eff * (w - ewma)`。
     這樣週量一次的人也不會被拖成好幾週的延遲，但單次量測的權重最多約 0.52。
   - 當天沒量測：`ewma` 沿用前一天的值。
4. 產出 `ewmaByDate[date]`，每一天都有值。

#### 28 天斜率

- 迴歸窗的起點 = `max(today - 27, mode_since_date)`，終點 = 今天。
- 資料不足條件（任一成立就是 `status = "insufficient"`，不做任何調整）：
  - 窗內量測少於 8 次
  - 窗內第一次到最後一次量測相隔少於 21 天
  - 最後一次量測距今超過 7 天
- 對窗內每一天的 `(dayIndex, ewmaByDate[d])` 做普通最小平方法（OLS），`slope_kg_per_week = slope_per_day * 7`。
- 用每天的 EWMA 值做迴歸，不是只用量測日的原始值。原因是 EWMA 已經把雜訊平掉，逐日點又等距，斜率比較穩定。

#### 評估流程（依序執行，任何一步 return 前都要寫回 `last_result` 並存檔）

1. `state = await getTdeeState()`。profile 不存在就直接 return。
2. **偵測模式切換：** 如果 `state.goal_mode !== profile.goal_mode`：
   - 若 `state.goal_mode` 原本不是 null（代表真的切換了）：`mode_since_date = today`，`pending = null`，`dismissed_until = null`，history 加一筆 `mode_change`。
   - **offset 保留不清零**，因為它反映的是公式本身的誤差。但因為迴歸窗從 `mode_since_date` 開始算，切換後至少 21 天不會再調整，舊模式的體重走勢不會污染判斷。
   - 最後寫入 `state.goal_mode = profile.goal_mode`。
3. 如果 `!force && state.last_evaluated_date === today`，直接 return state。
4. 算 EWMA 和斜率。資料不足時：若有 pending，清掉並在 history 加 `expired`；然後 status 設為 `insufficient`，結束。
5. 用 `RULES[mode]` 找出符合的規則：
   - 沒有符合：清掉 pending（記 `expired`），`status = "ok"`，結束。
   - 有符合：取得 `delta` 和 `needsConfirm`。
6. **冷卻期：** 如果 `last_adjusted_date` 存在，且 `today - last_adjusted_date < 14`：清掉 pending，`status = "cooldown"`，結束。
7. **累計上限：** `proposed = clamp(state.offset_kcal + delta, -300, 300)`。如果 `proposed === state.offset_kcal`，`status = "capped"`，結束。
8. **已到熱量下限：**
   - `cur = calculateTargets(profile, { offsetKcal: offsetForDate(state, today) }).targetKcal`
   - `nxt = calculateTargets(profile, { offsetKcal: proposed }).targetKcal`
   - 如果 `delta < 0 && nxt >= cur`（代表已經被 floor 擋住），`status = "at_floor"`，結束。
9. **下修前的攝取紀錄檢查（這條是我新加的，前兩輪沒有）：**
   - 條件：`delta < 0` 時，迴歸窗內的「完整記錄日」要至少 14 天，而且這些天的平均攝取 ≤ 目前目標 × 1.10。不符合就 `status = "intake_gap"`，不調整。
   - 為什麼要加：沒有這條的話，「吃得比目標多 → 體重沒降 → 目標被自動調低」會形成一路往下的棘輪。這正是前兩輪一直在避免的「吃多了就被限制」的機制，只是換了路徑出現。
   - 上修（`delta > 0`）不檢查，因為往寬鬆的方向調整是安全的。
   - 「完整記錄日」要跟第 4 點的近 7 天平均用同一個 helper，建議放在 `budget.js`，命名 `isCompleteLogDay(dayLogs, enabledSlots)`，裡面用現有的 `isSlotEnabled`。
   - 如果你要拿掉這條，只刪這一步即可。
10. **需要確認的情況**（只有維持模式下修）：
    - 如果 `dismissed_until && today < dismissed_until`：`status = "dismissed"`，結束。
    - 否則：pending 已存在就只更新它的 `slope_kg_per_week` 和 `ewma_latest_kg`（保留原本的 `created_date`）；pending 不存在就建立一筆新的。`status = "pending"`，結束。
    - 冷卻期不在這裡啟動。
11. **自動套用：** 呼叫 `applyOffset(state, proposed, "auto")`，`status = "adjusted"`。
12. `last_evaluated_date = today`，存檔。

#### `applyOffset(state, newOffset, source)`

- `prev_offset_kcal = offsetForDate(state, today)`
- `offset_kcal = newOffset`
- `effective_date = today + 1`（隔天生效）
- `last_adjusted_date = today`（冷卻期從這天開始）
- `pending = null`
- `dismissed_until = null`
- `announce_until = effective_date + 2`
- history 加一筆 `{ date, from, to, source, slope_kg_per_week }`

#### 對外函式（`window.*`）

- `ensureDailyCalibration(profile)`：用模組變數記住 `{ date, promise }`，同一天回傳同一個 Promise，裡面呼叫 `evaluateCalibration(profile, { force: false })`。這樣三個分頁在 DOMContentLoaded 同時呼叫也只會跑一次。
- `runCalibrationNow(profile)`：清掉上面記住的 Promise，然後呼叫 `evaluateCalibration(profile, { force: true })`。
- `confirmPendingCalibration()`：讀取 state，沒有 pending 就 return。有的話執行 `applyOffset(state, pending.proposed_offset_kcal, "confirmed")` 並存檔。確認時不重新檢查冷卻期，因為 pending 本來就不可能在冷卻期內產生。
- `dismissPendingCalibration()`：`pending = null`，`dismissed_until = today + 14`，history 加 `dismissed`。不動 `last_adjusted_date`，所以其他方向（例如自動上修）照常可以觸發。
- `resetCalibrationOffset()`：執行 `applyOffset(state, 0, "reset")`。這會開始冷卻期，避免隔天又用同一批資料把 offset 調回去。
- `getCalibratedTargets(profile, dateStr)`：見第 2 節。
- 刪除舊的 `calibrateWeeklyTdee`、`computeTrends`、`avgInRange`、`weekStartOfToday`、`goalMultiplier`、`isMale`，以及對 `saveTdeeCalibration` 的呼叫。

**「忽略之後還會不會再問」的決定：** 14 天內不會再問。14 天後如果條件仍然成立，會再問一次。
- 不選「永遠不再問」：體重真的持續往上時，應該要能再提醒。
- 不選「每天都問」：太煩，而且會讓使用者習慣直接按掉。
- 14 天跟冷卻期長度一致，比較好解釋。

---

### 4. 什麼時候呼叫

**不需要像 `settleWeeklyLedger` 那樣逐日往回補算。** 校正結果只取決於「到今天為止的體重資料」加上「冷卻期日期」，是一個狀態函式，不是逐日累加。App 很多天沒開也不會漏掉東西，今天評估一次就等於補齊了。所以 `last_evaluated_date` 只是「同一天不要重跑」的防護，不是用來回補的游標。

呼叫點：

1. **所有分頁取目標的時候**：一律透過 `getCalibratedTargets`，裡面會先 await `ensureDailyCalibration`。第一個載入的分頁觸發當天的評估，其他分頁共用同一個 Promise。`app.js` 不用改。
2. **`tab-profile.js` 記錄體重成功之後**：呼叫 `runCalibrationNow(profile)`，然後重畫校正卡片。就算因此產生調整，也是隔天才生效，所以不會改到今天的配額。
3. **`tab-profile.js` 的 `onCalculate` 存完 profile 之後**：呼叫 `runCalibrationNow(profile)`，讓模式切換立刻被偵測到。

---

### 5. UI

#### `tab-profile.js` 和 `index.html`（唯一能操作的地方）

把第 192 行的 `#calibrated-target-row` 換成一張「體重趨勢校正」卡片 `#calibration-card`，內容如下：

- **目標拆解：** 公式目標 `baseTargetKcal`、校正值 `±offsetKcal`、目前每日目標 `targetKcal`。
  如果 `effective_date` 是明天，多一行「明天起：X kcal」。
- **趨勢：** 「近 4 週體重趨勢：+0.3 kg／週」。
  資料不足時改成「需要近 4 週至少 8 次體重紀錄」。
- **狀態說明（中性語氣）：** 依 `last_result.status` 對應一句話，涵蓋 `cooldown`（顯示下次可調整的日期）、`capped`、`at_floor`、`intake_gap`、`dismissed`、`ok`。
- **pending 區塊（`status === "pending"` 時才顯示）：**
  - 說明文字：「近 4 週體重平均每週上升 0.6 kg。如果你這段期間有重訓增肌，這可能是正常的；如果沒有，可以把每日目標下調 150 kcal（明天起生效）。」
  - 按鈕「套用」：呼叫 `confirmPendingCalibration()`，然後重畫卡片，並顯示「明天起每日目標 X kcal」。
  - 按鈕「先不要」：呼叫 `dismissPendingCalibration()`，然後重畫卡片，並顯示「14 天內不會再提醒這件事」。
- **重設按鈕：** offset 不為 0 時才出現「重設校正」按鈕，呼叫 `resetCalibrationOffset()`。

`onCalculate` 和 ready 時的 `showTargets(result)` 改用 `getCalibratedTargets(profile)` 的結果。現有的 `#target-kcal` 顯示校正後的值。

#### `tab-today.js` 彙總卡（只顯示提示，不放按鈕）

操作入口只放在 profile 分頁一個地方，避免兩處狀態不同步。

- pending 存在時：顯示一行「基本資料有一項目標調整建議待你確認」，點擊後呼叫 `activateTab("profile")`。目前 `app.js` 沒有對外暴露這個函式，要在 `app.js` 加一行 `window.activateTab = activateTab;`。
- `today <= announce_until` 時：顯示一行「依近 4 週體重趨勢，每日目標從 M/D 起調整為 X kcal」。

以上所有文案都必須避開第 4 點的禁用字（額度／剩餘／超支／彈性點數／還／補／抵／存）。特別注意「還沒」「補充」這類詞裡面也含禁用字。

---

### 6. 需要你去問使用者的取捨（只有兩個）

1. **畫面上要不要直接顯示「校正 −150 kcal」這個數字？** 另一個選擇是只顯示結果「目前每日目標 X kcal」，把拆解收進一個可展開的「怎麼算的」。這純粹是文案風格和心理感受的偏好。
2. **`intake_gap`（紀錄不夠或攝取偏高，暫不下修）要不要明講原因？** 選項是：
   - 明講：「近 4 週平均攝取高於目標，這段體重變化主要反映攝取量，暫不調整」
   - 不明講：只寫「目前資料不足以判斷是否需要調整」

   明講比較透明，但可能讓使用者覺得被評價。

另外有一件事要你提醒使用者：規格裡多了第 3 節第 9 步的「下修前攝取紀錄檢查」，這條前兩輪沒有，是我這輪新加的，理由寫在那一步裡。

---

### 7. 驗收項目（給實作者）

- 維持模式，斜率 +0.6 kg/週，資料充足 → 產生 pending，offset 不變，今天和明天的目標都不變。
  按「套用」→ 今天的目標不變，明天的目標 −150，`last_adjusted_date = 今天`。
- 按「先不要」→ 14 天內重新評估都是 `dismissed` 狀態；第 15 天條件仍成立時再次產生 pending。
- 減脂模式，斜率 −0.1 kg/週，完整記錄日 ≥ 14 天且平均攝取 ≤ 目標 × 1.1 → 自動套用 −150；隔天 14 天內不會再調整。第二次調到 −300，第三次顯示 `capped`。
- 同樣情境但完整記錄日少於 14 天 → `intake_gap`，offset 不變。
- 目標已經在熱量下限，又觸發下修 → `at_floor`。
- 切換 goal_mode → pending 被清掉；之後 21 天內都是 `insufficient`；offset 保留不變。
- 按一次 profile「計算」後，`tdee_state` 還在（證明 offset 沒被 profile 覆寫掉）。
- 用 grep 檢查：全專案沒有 `calibrateWeeklyTdee`、`saveTdeeCalibration`、`getTdeeCalibration`；feast.js 沒有 `calculateTargets`。
- 三個分頁同時載入時，`evaluateCalibration` 當天只執行一次（在函式裡加 console.count 驗證）。

---

相關檔案：
- `D:\ok\lighten\js\engine\tdee.js`
- `D:\ok\lighten\js\engine\nutrition.js`
- `D:\ok\lighten\js\engine\budget.js`
- `D:\ok\lighten\js\database.js`
- `D:\ok\lighten\js\ui\tab-profile.js`
- `D:\ok\lighten\js\ui\tab-today.js`
- `D:\ok\lighten\js\ui\tab-week.js`
- `D:\ok\lighten\js\ui\tab-ledger.js`
- `D:\ok\lighten\js\engine\feast.js`
- `D:\ok\lighten\js\app.js`
- `D:\ok\lighten\index.html`（第 192 行）
- `D:\ok\lighten\collab\claude-session-handoff.md`
