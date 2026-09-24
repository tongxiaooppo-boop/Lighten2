# 來自 Cline 的報告（TASK 4）

## 這次改了什麼

- `js/engine/nutrition.js`（新增）：實作 `calculateTargets(profile)` 起點值公式，對照 PRD v4.0 第 3 節第 1–6 項與 TECH-SPEC 4.1。
- 對外以 `window.calculateTargets` 暴露成 bare 全域函式（與 database.js 相同模式），供 console 驗證與後續 `ui/tab-profile.js` 呼叫。

## 公式與預設值（含我自行決定的預設）

1. **BMR**（Mifflin-St Jeor）：男 `10W + 6.25H − 5A + 5`、女 `10W + 6.25H − 5A − 161`。
2. **TDEE** = BMR × 活動係數 + 特殊活動消耗。活動係數：優先取 `activity_value`（數值 PAL），否則查 `activity_mode` 對照表（久坐1.2／輕度1.375／中度1.55／高度1.725，支援中英文 key），都缺時 fallback 1.2。`special_activity_kcal` 沒帶就當 0（未自己編 METs 算法）。
3. **目標熱量**：減脂 ×0.8／維持 ×1.0／增肌 ×1.1。
4. **安全下限**：女 < 1200、男 < 1500 自動上調至門檻值，`flooredWarning = true`。
5. **蛋白質預設**（範圍 1.6–2.0 g/kg，我自訂的預設值，**請確認**）：增肌 2.0（取上限）、維持 1.8（取中間值）、減脂 1.8（取中間值；PRD 未明說減脂取何值，故比照維持）。可用 `profile.protein_g_per_kg` 覆寫。
6. **脂肪預設**：佔目標熱量 **25%**（PRD 範圍 20–25%，取上限），可用 `profile.fat_pct`（0–1）覆寫。碳水 = 剩餘熱量換算（不會變負數）。**膳食纖維** 預設 30g（可用 `profile.fiber_target_g` 覆寫），`netCarb_g = carb_g − fiber_g`。

回傳格式照 TECH-SPEC 4.1：`{ bmr, tdee, targetKcal, flooredWarning, protein_g, fat_g, carb_g, fiber_g, netCarb_g }`，數值四捨五入到小數 1 位。

## 跑過的驗證（console.log 3 組 + 1 組額外）

| 案例 | 結果 | 判定 |
|---|---|---|
| 1. 175cm/70kg/30歲/男/1.55/減脂 | BMR 1648.8、TDEE **2555.6**、目標 **2044.5**、無下限 | TDEE 約2554、目標約2043，±5 內 ✓ |
| 2. 同上改維持 | 目標 2555.6 = TDEE | ✓ |
| 3. 160cm/50kg/25歲/女/1.2/減脂 | 目標 **1200**、`flooredWarning=true` | 觸發 1200 下限 ✓ |
| 4.（額外）增肌 | protein_g = 140（2.0 g/kg × 70kg） | 取上限 ✓ |

- `node --check` 語法通過；暫存測試檔跑完已刪除。
- 本機 `git commit` 完成（commit `74daf2f`），未 `git push`。

## 需要 Claude／使用者決定的事

1. **蛋白質 g/kg 預設值**：減脂我比照維持取 1.8（PRD 只寫「增肌取上限、維持取中間值」，未寫減脂）。若要減脂取上限 2.0（保留肌肉較常見的建議），請告知，我一行即可改。
2. **脂肪佔比預設取 25%**（範圍上限）。若要用中間值 22.5% 或下限 20%，請告知。
3. **`activity_value` / `activity_mode` / `special_activity_kcal` 的欄位名**是我依 PRD 2.2 與 TECH-SPEC 3.1 推定的；TASK 5 做表單時會實際定案 input name，屆時以表單欄位為準。

## 建議下一步

- 依 TASKS.md 執行 TASK 5（`js/ui/tab-profile.js`：基本資料表單 + 計算 + weight_log 回填）。
