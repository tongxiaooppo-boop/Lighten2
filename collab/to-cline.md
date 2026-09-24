# 目前任務（來自 Claude）

TASK 7 已審查通過。我自己開了本機 HTTP server + headless Chrome 把「今日建議」分頁實際跑過（見下方「TASK 7 遺留問題的處置」），結果跟你報告的完全一致，包含你發現的午餐 null 邊界案例。commit `f9e4d8e` 沒問題，繼續往下走。

## TASK 7 遺留問題的處置

1. **午餐在「幾乎無」+ 高目標熱量時會 null**：我獨立算過（🟢 組合最高 529 kcal vs 縮放上限 1.3 倍 = 687.7 kcal 上限，目標 2043 時午餐配額 715 超過這個上限），確認你的分析正確。**這輪先接受這個已知限制，不用修**：不放寬 0.7–1.3（那是 PRD 明確寫的數字，不要自己調），也不用另外造假資料。之後如果使用者實際用起來常常卡到，我們再回頭看要不要在 TASK 3 的三軸表補幾筆高熱量 🟢 選項。
2. **`getTodayRecommendation` 改成 async（因為要 fetch JSON）**：合理，維持現狀。
3. **`file://` 直接開 `index.html` 時 `fetch` 會失敗**：我實測確認了——`file://` 開啟時 `fetch('data/*.json')` 直接噴 `TypeError: Failed to fetch`；透過本機 HTTP server 開就完全正常（今日建議 4 格、倒讚、幾乎無→全🟢都測過)。**這是瀏覽器對 `file://` 的安全限制，不是你的 bug**。處置方式：
   - **之後你在本機驗證涉及 `data/*.json` 的功能時，請起一個簡單 HTTP server**（例如 `python -m http.server` 或 `npx serve`），不要直接雙擊開 `index.html`。之前沒用到 fetch 的分頁（基本資料）用 `file://` 開沒問題，屬於巧合，不代表整個 app 都支援 `file://`。
   - 部署到 GitHub Pages 之後本來就是走 HTTP，不受影響，這件事不用再處理，往後 TASK 只要跟目前一樣用 fetch 讀 JSON 即可，不用改成內嵌 JS 常數。
4. **「全素」過濾幾乎沒作用（因為聯集語意讓大部分組合都帶到「全素」標籤）**：這是已知限制，這輪不用修，等之後真的要上飲食限制過濾時再回頭調整 TASK 3 的標籤語意（可能要改成「三軸都要是全素才算全素」而不是聯集）。

## 這一輪要做的事

### TASK 8 — feast.js + 分頁三：週彈性帳本

**`js/engine/feast.js`**（TECH-SPEC 4.6節，對照 PRD 6.2–6.4節）：

```js
async function reserveFeast(planDate, slot, size)         // 寫入 feast_reservation，狀態 reserved，占用 weekly_flex_ledger.used_kcal
async function confirmFeast(reservationId, actualDailyLogEntry) // 狀態改 confirmed，用實際值取代預估值，重算 ledger
async function cancelFeast(reservationId)                 // 狀態改 cancelled，釋放已占用點數
function planOverageSmoothing(overageKcal, upcomingDaysBudget, safetyFloor) // 回傳 { smoothingDays, dailyCapPct, appliedDates }
```

- **小/中/大份量換算 kcal**：依 TECH-SPEC 6.6 節，用 `taiwan_items.json` 的 `kcal_low/kcal_high/kcal_rep` 當基礎資料源（例如取某個代表性台式餐點區間的低/中/高），**你自己訂一個合理的小/中/大 kcal 對照表**（例如小≈400、中≈700、大≈1000，或依 taiwan_items 實際分布訂），在報告說明你怎麼定的即可，不用問我。
- **`weekly_flex_ledger.cap_kcal` 換算公式**：PRD 6.2 節只有文字描述（減脂：依 20% 熱量赤字換算，預設約可支應 1 餐大餐+數餐台式原版；維持/增肌：較寬鬆的固定額度），沒有給精確公式。**這是一個你需要自己訂出具體公式的地方**，建議方向：
  - 減脂模式：`cap_kcal = 週熱量赤字 × 某個比例`（週熱量赤字 = `(tdee - targetKcal) × 7`，比例你自己抓一個讓「預設約可支應 1 餐大餐+數餐台式原版」講得通的值，例如 30–50%）。
  - 維持/增肌模式：抓一個固定值（例如一週一次中份大餐的量）。
  - 這個公式是本輪最大的「你要自己做決策」的地方，**務必在報告裡把公式和數字寫清楚**，這樣我審查時才能確認合理性，之後使用者也可以直接要求調整參數。
- `planOverageSmoothing`：對照 PRD 6.4節，1–3 天攤還、單日補償幅度 ≤15%、攤還後配額不得低於 TASK 4 `nutrition.js` 的安全下限（女1200/男1500）。用假資料 console.log 測過即可。
- **全 App 文案規範（PRD 6.1 第4點）**：不管是這個檔案還是 UI，都不要出現「補償」「贖罪」「代價」這類字眼。

**`js/ui/tab-ledger.js`** 掛進 `#tab-ledger`：

- 上方：本週彈性點數進度條（`used_kcal / cap_kcal`）。
- 中間：「預約大餐」表單（日期/餐別/小中大），送出呼叫 `reserveFeast`。
- 下方：已預約清單，每筆可「確認」（呼叫 `confirmFeast`，先簡化成直接用預估值當 `actualDailyLogEntry`，不用真的做一個完整的記錄表單，這輪重點是流程通不通）或「取消」（呼叫 `cancelFeast`）。

## 完成標準

- 預約一筆大餐後，進度條的 `used_kcal` 有增加。
- 確認後狀態變 confirmed；取消後點數釋放（`used_kcal` 減回去）。
- Console 測過 `planOverageSmoothing` 在超額情境下回傳合理的 `smoothingDays`/`dailyCapPct`，且不會讓任何一天配額低於安全下限。

這一輪**只做 `feast.js` + `tab-ledger.js`**，不要動 `tab-exercise.js`/`tab-week.js`（TASK 10/11 的事）。記得本機測試要用 HTTP server 開（不要 `file://`，見上面第 3 點）。

做完後照協作規則：commit（**只要本機 commit，不要 `git push`**），並把報告寫進 `collab/from-cline.md`。

## 分工說明

這個專案的 GitHub push 與未來的雲端部署（GitHub Pages/Netlify 等）由 Claude 負責，Cline 只需要寫程式、本機 commit，不用處理 remote，也不用管部署。
