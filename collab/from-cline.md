# 來自 Cline 的報告（TASK 8）

## 這次改了什麼

- `js/engine/feast.js`（新增）：`reserveFeast`/`confirmFeast`/`cancelFeast`/`planOverageSmoothing` + 輔助 `computeWeeklyCapKcal`。
- `js/ui/tab-ledger.js`（新增）：分頁三「週彈性帳本」——進度條、預約表單、已預約清單（確認/取消）。
- `js/database.js`（小幅修改，必要支撐）：見下「database.js 變更」。
- `index.html`（修改）：`#tab-ledger` 區塊 + script 補 `feast.js`/`tab-ledger.js`。
- `css/style.css`（修改）：進度條/預約清單/按鈕樣式。

## 我自行訂的兩組參數（請審查，之後可直接要求改）

### 1. 小/中/大 → kcal（`FEAST_SIZE_KCAL`）

`S=400 / M=700 / L=1200`。直接採用 TECH-SPEC 3.11 的範例值（該節原文就是「例如 S=400/M=700/L=1200」），沒另外從 taiwan_items 分佈重新推（因為 taiwan_items 的 kcal_rep 大半是 null，且「大餐」本質上高於一般台式餐，1200 當大份合理）。

### 2. `cap_kcal` 換算公式（`computeWeeklyCapKcal`）

- **減脂 (cut)**：`cap_kcal = round((tdee − targetKcal) × 7 × 0.4)`，即「週熱量赤字 × 40%」。
  - 例：男 175/70/30 減脂，tdee 2555.6、target 2044.5 → 週赤字 3577 → cap **1431**。
- **維持 (maintain) / 增肌 (bulk)**：固定 **1400** kcal（約 1 餐大份大餐 + 小彈性）。
- 兩個參數 `CUT_CAP_RATIO=0.4`、`FLEX_CAP_FIXED=1400` 都抽成常數，之後好調。公式只讀 goal_mode + tdee/targetKcal，**不碰任何運動資料**。

### 3. `planOverageSmoothing`（PRD 6.4）

- 1–3 天攤還；`dailyCapPct=0.15`（單日攤還 ≤15%）；每筆 `reduce_kcal = min(budget×0.15, budget−safetyFloor)`，保證攤還後 `new_budget ≥ safetyFloor`。
- 回傳 `{ smoothingDays, dailyCapPct, appliedDates, remainingKcal }`（`remainingKcal` 是 3 天內攤不完的餘額，方便 debug；前三個欄位照 TECH-SPEC 4.6）。

## database.js 變更（這輪的必要支撐，非新增業務）

1. `reserveFeast(entry)` **改名** `addFeastReservation(entry)`——因為 TECH-SPEC 4.6 的 `feast.js` 也要一個 `reserveFeast(planDate, slot, size)`，兩者同名會蓋掉。DB 層改成 `addXxx` 也跟其他函式命名一致。
2. 新增 `getFeastReservations(filter)`——TASK 2 的 4.8 清單沒有「列出預約」的函式，但清單 UI 需要。
3. `updateWeeklyLedger(weekStartDate, usedKcal, capKcal)` 增加選填第三參數 `capKcal`——這正是 TASK 2 報告裡我 flag 的「cap_kcal 沒有寫入函式」缺口，本輪一併補上。

## 文案規範

`feast.js`/`tab-ledger.js` 全檔沒有「補償」「贖罪」「代價」字眼（攤還相關註解用「攤還幅度」，不用「補償幅度」）。UI 也只有「已用/上限」「預約/確認/取消」等中性字。

## 跑過的驗證（mock DB，console.log）

- `computeWeeklyCapKcal`（男減脂）→ **1431** ✓
- 預約 M（700）→ used 700；再預約 L（1200）→ used 1900 ✓（進度條 used 有增加）
- 取消 M → used 1200 ✓（點數釋放）
- 確認 L（實際 1500）→ used 1500（用實際值取代預估值重算，1500 = 1200−1200+1500）✓；並寫入 daily_log ✓
- `planOverageSmoothing(500, [1800,1800,1800], 1200)` → 2 天、15%、每天 270/230 ✓
- `planOverageSmoothing(200, [1250,1250,1250], 1200)` → 每天只攤 50（受安全下限 1200 限制）、3 天、剩 50 未攤完 ✓

- `node --check` database.js / feast.js / tab-ledger.js 皆通過；暫存測試檔已刪除。
- 本機 `git commit` 完成（commit `7065dc7`），未 `git push`。

## 需要 Claude／使用者決定的事

1. **cap_kcal 公式的兩個參數**（減脂取 40%、維持/增肌固定 1400）是我自己抓的，數字合理但可再校準——若你想改成「減脂 50%」或「維持固定 1000」等，改 `feast.js` 頂端兩個常數即可。
2. **`confirmFeast` 目前簡化**：UI 直接用預估值當實際記錄（`confirmFeast(id)` 不帶 `actualDailyLogEntry`，內部 fallback 用 estimated_kcal）。要做「真的輸入實際熱量」的完整表單，等 TASK 後續接實際攝取記錄時再補。
3. **database.js 改了 3 處**（rename/add/get+cap），這超出「只做 feast.js+tab-ledger.js」的字面範圍，但都是為了解決命名衝突與補 TASK 2 缺口，請知悉。

## 建議下一步

- 依 TASKS.md 執行 TASK 9（`js/engine/tdee.js` 的 `calibrateWeeklyTdee` 週校正）。
