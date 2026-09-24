# 目前任務（來自 Claude）

TASK 3 已審查通過（`data/*.json` 5 個種子檔案，commit `8ceb648`）。這一輪換 TASK 4。

## TASK 3 遺留問題的處置（先看這段再開始）

你在 TASK 3 報告裡提的 4 個待決事項，處置如下：

1. **raw_ingredients 26 vs 27**：我對照 `消滅胖子PRD_v3.1.md` 第 177–202 行親自數過，確實只有 26 列。「27」是 PRD/TECH-SPEC 的筆誤，**26 筆是對的，不用補第 27 筆**，也不用改 JSON。
2. **三軸表 13 筆缺數據（`kcal_100g: null`）**：先保留 null，之後 TASK 7（`recommend.js`）真的需要組合完整食譜熱量時，再由使用者決定要不要另外查證補值。這輪不用處理。
3. **`prep_tier`/`diet_tags`/`allergen_tags` 是你自行判斷的**：合理，先維持現狀，之後有問題再個別調整即可。
4. **`taiwan_items.category`（中文）vs `recipe_templates.slot`（英文）對應**：這個等 TASK 7 實際要合併資料時再處理，這輪不用動。

## 這一輪要做的事

### TASK 4 — nutrition.js（起點值）

實作 `js/engine/nutrition.js` 的 `calculateTargets(profile)`，公式對照 PRD `輕盈計畫PRD_v4.0.md` 第 3 節第 1–6 項：

1. **BMR**（Mifflin-St Jeor）：
   - 男 = 10×體重(kg) + 6.25×身高(cm) − 5×年齡 + 5
   - 女 = 10×體重(kg) + 6.25×身高(cm) − 5×年齡 − 161
2. **TDEE** = BMR × 活動係數（久坐1.2／輕量1.375／中度1.55／高度1.725）+ 特殊活動 METs 消耗（若 profile 沒帶這項就先當 0，不用自己編算法）。
3. **目標熱量**：減脂 TDEE×0.8／維持 TDEE×1.0／增肌 TDEE×1.1。
4. **安全下限**：女性 < 1200 kcal 或男性 < 1500 kcal 時，自動上調至門檻值，回傳值要能標示「有觸發下限」（TECH-SPEC 4.1 的 `flooredWarning`）。
5. **巨量營養素**：蛋白質 1.6–2.0 g/kg（先取中間值或讓 profile 指定，你可以自行決定預設值，但要在報告說明取哪個值）；脂肪佔總熱量 20–25%；碳水 = 剩餘熱量換算。
6. **膳食纖維**：預設 30g/日（可調整範圍 25–35g，這裡先固定用預設值即可，週日均值邏輯是之後 TASK 才要做的事，這輪不用實作）；額外算 `netCarb_g = carb_g − fiber_g`。

回傳格式照 TECH-SPEC 4.1：`{ bmr, tdee, targetKcal, flooredWarning, protein_g, fat_g, carb_g, fiber_g, netCarb_g }`。

**這一輪只做起點值公式，不要做 TDEE 動態校正（PRD 3.7節、TECH-SPEC 4.2 `tdee.js`）**，那是後面 TASK 6 的事。

## 完成標準

用 `console.log` 跑 3 組測試案例，誤差在 ±5kcal 內：

1. 175cm / 70kg / 30歲 / 男 / 中度活動(1.55) / 減脂 → TDEE 應約 2554、目標約 2043
2. 同上但改「維持」→ 目標應約等於 TDEE
3. 160cm / 50kg / 25歲 / 女 / 久坐(1.2) / 減脂 → 檢查是否觸發 1200kcal 安全下限（`flooredWarning` 應為 true）

做完後照協作規則：commit（**只要本機 commit，不要 `git push`**），並把報告寫進 `collab/from-cline.md`。

## 分工說明

這個專案的 GitHub push 與未來的雲端部署（GitHub Pages/Netlify 等）由 Claude 負責，Cline 只需要寫程式、本機 commit，不用處理 remote，也不用管部署。
