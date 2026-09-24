# 來自 Cline 的報告（TASK 6）

## 這次改了什麼

- `js/engine/budget.js`（新增）：`recalcTodayBudget(targetKcal, todayLogs)`，對照 TECH-SPEC 4.3 / PRD 5.1。
- `js/engine/matcher.js`（新增）：`checkHardConstraints(weekLogs, profile)`，對照 TECH-SPEC 4.4 / PRD 5.6。
- 兩者都以 `window.xxx` 暴露成 bare 全域函式（與其他模組一致），未接任何 UI（tab-today.js 是 TASK 7）。

## budget.js 的分配邏輯（我在報告說明的部分）

- 預設權重：早 0.25／午 0.35／晚 0.30／宵 0.10（PRD 5.1 固定比例，僅作為「無紀錄時」的起始值）。
- **已吃餐次**：配額回傳 **0**（不顯示）。
- **未吃餐次**：把 `remainingKcal = targetKcal − 已吃總熱量` 依各餐次「預設權重」在未吃餐次之間做**相對加權**分配（`剩餘 × 權重／未吃餐次權重總和`）。
  - 例：targetKcal=2000、早餐吃 800 → 剩 1200，午/晚/宵按 0.35:0.30:0.10 相對分 → 560/480/160（不再是固定 700/600/200）。
- 吃越多 → remaining 越小；未吃餐次越少 → 每餐分越多。超吃時 remaining 夾到 0。

## matcher.js 的缺口邏輯（我的判斷，請確認）

- **蛋白質**：目標 g/kg 比照 nutrition.js 定案規則（增肌 2.0、維持/減脂 1.8，可用 `profile.protein_g_per_kg` 覆寫）。`proteinGapToday = 目標 − 今日已攝取`；**已達標回傳 0**（不做負缺口）。
  - 「今日」的判定：取本機今天日期（`YYYY-MM-DD`），在 `weekLogs` 中挑 `log_date === 今天` 的筆加總蛋白質。
- **纖維**：`週日均 = 本週每日纖維總量 ÷ 有記錄的天數`。低於 **25g**（25–35g 區間下限，我取 25 當硬約束下限）時，`fiberGapThisWeek = 25 − 日均`；否則回傳 0。

## 跑過的驗證（console.log）

- budget：無記錄 → {500/700/600/200}；早餐 800 → 剩 1200、{0/560/480/160}（確認有依剩餘重新分配、已吃餐次歸 0）✓
- matcher 蛋白質：70kg 維持（目標 126）今日吃 60 → 缺口 66 ✓；70kg 增肌（目標 140）今日 0 → 缺口 140 ✓
- matcher 纖維：7 天各 10g → 日均 10 → 缺口 15 ✓；7 天各 30g → 日均 30 → 缺口 0 ✓

- `node` 跑測試全數通過（暫存測試檔已刪除）；`node --check` 語法通過。
- 本機 `git commit` 完成（commit `127238b`），未 `git push`。

## 需要 Claude／使用者決定的事

1. **纖維「日均」的分母**：我用「有記錄的天數」取平均（`每日纖維 ÷ 有記錄天數`）。若你希望用「固定 7 天」當分母（總量 ÷ 7），請告知，我改一行。
2. **纖維缺口的基準**：我用 25g（25–35g 區間下限）當缺口基準，不是 profile 的 `fiber_target_g`（預設 30）。若要改成「相對使用者目標（30g 或 profile.fiber_target_g）算缺口」，請告知。
3. **「今日」的判定**：matcher.js 用「本機今天」挑今日蛋白質；若之後 `checkHardConstraints` 要支援指定日期（例如補看歷史某天），建議加選填參數，但本輪照 TECH-SPEC 4.4 的兩參數簽名未加。

## 建議下一步

- 依 TASKS.md 執行 TASK 7（`js/engine/recommend.js` + `js/ui/tab-today.js` 今日建議分頁）。
