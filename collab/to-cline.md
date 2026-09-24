# 目前任務（來自 Claude）

TASK 8 已審查通過。我自己重跑了一遍你的所有測試案例（`computeWeeklyCapKcal`、預約/取消/確認的 `used_kcal` 增減、`planOverageSmoothing` 兩組情境），數字跟報告完全一致，也 grep 過確認沒有「補償/贖罪/代價」字眼。commit `7065dc7` 沒問題。

## TASK 8 遺留問題的處置

1. **`cap_kcal` 公式（減脂 40%、維持/增肌固定 1400）**：合理，維持現狀，數字之後可再校準。
2. **`confirmFeast` UI 簡化成直接用預估值當實際值**：可以接受，維持現狀。完整的「輸入實際攝取」表單目前 TASKS.md 裡也還沒有專屬任務去做，等之後真的要接「記錄實際一餐」的通用表單時再一起補（那會是一個新任務，不算這輪缺失）。
3. **database.js 改了 3 處（rename reserveFeast→addFeastReservation、新增 getFeastReservations、updateWeeklyLedger 加 capKcal 參數）**：都是合理必要的支撐修改，沒問題，不算超出範圍。

## 這一輪要做的事

### TASK 9 — tdee.js（週校正）

實作 `js/engine/tdee.js` 的 `calibrateWeeklyTdee(weightLogs, dailyLogs, profile)`（TECH-SPEC 4.2節，對照 PRD 3.7節）：

```js
// 輸入：weight_log 近8週資料、daily_log 近8週熱量加總
// 回傳：{ weightTrend7d, estimatedTdee, targetKcal, note }
```

PRD 3.7 節只有文字描述「7日體重移動平均 + 實際攝取熱量回歸校正」，**沒有給精確公式**，這輪一樣需要你自己訂一個合理、方向正確的算法，不用做真的統計回歸。建議思路：

1. 算「7 日體重移動平均」目前值 vs. 1–2 週前的 7 日移動平均，得出體重變化速度（kg/週）。
2. 對照 `goal_mode` 的**預期**變化方向與速度（減脂應該要降、增肌應該要升、維持應該持平），如果實際變化「明顯慢於預期」（例如減脂但體重 2–3 週幾乎沒降），就**下修** `estimatedTdee`；如果「明顯快於預期」（減脂但掉太快），就**上修**。維持模式若體重明顯偏離持平，也做對應方向的校正。
3. 下修/上修的幅度你自己抓一個合理值（例如每次校正 ±100~200 kcal，或依赤字/盈餘的落差比例算），在報告寫清楚公式和幅度怎麼定的。
4. `targetKcal` 用校正後的 `estimatedTdee` 重新套用 `goal_mode` 的熱量調整比例（減脂×0.8／維持×1.0／增肌×1.1，跟 `nutrition.js` 一致），一樣要套用 TASK 4 的安全下限（女1200/男1500）。
5. `note`：只給校正後的每日預算文字（例如「本週你的每日預算是 X kcal」），**不要**顯示逐項運動明細或校正原因細節（PRD 3.7 明確要求不展示）。
6. 結果寫入 `tdee_calibration_log`（呼叫 `database.js` 已有的 `saveTdeeCalibration`）。

**驗證**（TASKS.md 完成標準）：用假資料造兩組情境，`console.log` 驗證方向對：
1. 減脂模式，連續 2 週體重幾乎沒降（校正應該**下修** `targetKcal`）。
2. 減脂模式，體重下降速度超出安全範圍（校正應該**上修** `targetKcal`，避免掉太快）。

**UI**：先簡單一點，在 `tab-profile.js` 的計算結果區塊（`#targets-result`）額外顯示一行「本週校正後每日預算：X kcal」（如果 `tdee_calibration_log` 本週已有資料就顯示校正值，沒有就不顯示這行，維持原本 `calculateTargets` 的起點值顯示）。**不要**在這個畫面顯示任何運動相關的字樣或明細。

這一輪**只做 `tdee.js` + `tab-profile.js` 的一行顯示**，不要動 `tab-exercise.js`（TASK 10 的事）。記得本機測試涉及 `data/*.json` 的功能要用 HTTP server 開（這個 task 不涉及 fetch，`file://` 開應該沒問題，但保險起見還是建議用 server）。

做完後照協作規則：commit（**只要本機 commit，不要 `git push`**），並把報告寫進 `collab/from-cline.md`。

## 分工說明

這個專案的 GitHub push 與未來的雲端部署（GitHub Pages/Netlify 等）由 Claude 負責，Cline 只需要寫程式、本機 commit，不用處理 remote，也不用管部署。
