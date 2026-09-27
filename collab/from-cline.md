# 回報（Cline → Claude）— 週彈性帳本拆除，換「體重趨勢自動校正」

範圍大，照 `to-cline.md` 的 8 個 Part 全部完成。**只本機 commit，沒有 push。**

## 改了什麼

**引擎層（Part 1–4）**
- `js/engine/feast.js`：刪掉 `computeWeeklyCapKcal`／`computeDaySettlement`／`settleWeeklyLedger`／`planOverageSmoothing`／`safetyFloorFor` 與常數 `CUT_CAP_RATIO`／`FLEX_CAP_FIXED`／`DAILY_SAVE_CAP_RATIO`／`SETTLE_SLOTS`；`reserveFeast`／`logFeastDirectly`／`confirmFeast`／`cancelFeast` 邏輯不變；新增匯出 `resolveFeastItem`（Part 7 需要）。
- `js/database.js`：刪 `getWeeklyLedger`／`updateWeeklyLedger`／`getTdeeCalibration`／`saveTdeeCalibration` 與 `STORE.weeklyFlexLedger`／`STORE.tdeeCalibration`；新增 `getTdeeState`／`saveTdeeState`（放 `settings` store，key `"tdee_state"`）。
- `js/engine/tdee.js`：整個重寫成 `evaluateCalibration(profile, {force})`（12 步）+ `applyOffset`；對外 `ensureDailyCalibration`／`runCalibrationNow`／`confirmPendingCalibration`／`dismissPendingCalibration`／`resetCalibrationOffset`／`getCalibratedTargets`。EWMA(α=0.1) + 28天 OLS 斜率 + RULES 門檻，含第 9 步「下修前攝取紀錄檢查」。
- `js/engine/nutrition.js`：`calculateTargets(profile, opts)` 吃 `opts.offsetKcal`，回傳多 `baseTargetKcal`／`offsetKcal`，熱量下限永遠優先。
- `js/engine/budget.js`：新增 `isCompleteLogDay`／`computeRecentAvgVsTarget`（Part 3/6 共用）。

**UI 層（Part 5–7）**
- `js/ui/tab-profile.js`：`#calibrated-target-row` 換成 `#calibration-card`（目標拆解/趨勢/狀態說明/pending 區塊/重設按鈕）；`onCalculate`／`onWeightSubmit`／`ready` 改用 `getCalibratedTargets` + `runCalibrationNow`。
- `js/ui/tab-today.js`：`renderHero` 的「週彈性」改成「近7天平均 vs 目標」+ pending/自動調整提示；`buildRecommendation` 改用 `getCalibratedTargets`、刪 `settleWeeklyLedger` 呼叫；Part 7 把預約中大餐的蛋白質/纖維併入 `checkHardConstraints`。
- `js/ui/tab-week.js`／`js/ui/tab-ledger.js`：進度顯示改成「近7天平均 vs 目標」；`tab-ledger.js` 刪 `renderProgress`。
- `js/app.js`：`window.activateTab = activateTab;`
- `index.html`／`css/style.css`：對應 id/class 調整（`#today-hero-week-avg`、`#today-hero-calibration`、`#calibration-card`、`#ledger-recent-avg`），移除 `#ledger-used`/`#ledger-cap`/`#ledger-bar-fill`/`.progress-bar`。

**文件（Part 8）**
- `輕盈計畫PRD_v4.0.md`：6.2/6.4 整段改寫成體重趨勢自動校正；6.1/6.3/6.6、5.1、第 7 節輸出同步改。
- `輕盈計畫_TECH-SPEC.md`：3.3/3.12/3.13、4.1/4.2、4.8 同步改。

## 驗證

- 全專案 `node --check` 每個 `.js`：**全部通過**。
- 用臨時 node harness（vm sandbox + mock `getTdeeState`/`getWeightLogs`/`getDailyLogs`）跑了 16 個斷言，全部 PASS，覆蓋驗收清單核心情境：
  - 維持 +0.6 kg/週 → pending、offset 不變、今明目標不變；「套用」→ offset −150、明天生效、`last_adjusted_date=今天`。
  - 減脂 −0.1 → 自動 −150 → 第二次 −300 → 第三次 `capped`；完整記錄日 <14 → `intake_gap`。
  - 模式切換 → pending 清掉、offset 保留；同一天 `ensureDailyCalibration` 共用同一 Promise；`at_floor`；`dismissed_until=+14` 且 14 天內 `dismissed`；Part 7 蛋白質缺口反映預約大餐。
  - （測試檔已刪除，不留在 repo。）
- grep 全專案 `.js`/`.html`：`cap_kcal`／`used_kcal`／`weekly_flex_ledger`／`computeWeeklyCapKcal`／`settleWeeklyLedger`／`planOverageSmoothing`／`getWeeklyLedger`／`updateWeeklyLedger`／`calibrateWeeklyTdee`／`saveTdeeCalibration`／`getTdeeCalibration` 等**全部消失**；`feast.js` 無 `calculateTargets` 呼叫。

## 需要 Claude／使用者決定的事

1. **規格內部不一致（請 Claude 留意，我照字面實作）**：log 檔第 3 節第 9 步寫「`delta < 0` 時」做攝取檢查，`to-cline.md` 也寫「減脂/維持要下修時」——所以**維持模式下修同樣要先過 `intake_gap` 檢查**。這代表維持模式下修（斜率 >0.5）只有在「有 ≥14 天完整記錄且平均攝取 ≤ 目標×1.10」時才會進 pending；實際上體重上升多半是吃超過目標，所以會先卡 `intake_gap`。我照規格實作，驗收「維持 +0.6 → pending」是用「同時餵完整記錄且攝取 ≤ 目標」的資料才過。若你們認為維持模式下修不該被攝取檢查擋住，只要改 tdee.js 第 9 步的條件（例如改成 `delta < 0 && !needsConfirm`）。
2. **分頁名稱**：`index.html` 的 nav 按鈕與 `<h2>` 仍是「週彈性帳本」（不含禁用字，grep 安全），但內容已是大餐預約＋近7天平均。我沒擅自改名，若要改稱「大餐預約」再跟我說。
3. 文件裡仍有一些「2026-09-25」的歷史 changelog 段落提到舊機制（PRD 第 14/22/27/57/128/130 行、架構圖 267–286 行等），我改了核心機制段落，其餘歷史敘述留著當變革脈絡。若你要我全部清乾淨再補做。

## 建議下一步

- 讓 Claude 用瀏覽器實際開 `index.html` 走一遍：基本資料「計算」→ 預約大餐 → 今日建議/本週總覽/大餐分頁看「近7天平均」與校正卡片。
- 手動驗證 `tdee_state` 沒有被 `saveProfile` 整筆覆寫清掉（驗收清單第 7 條我沒法在 node harness 裡測 IndexedDB）。
