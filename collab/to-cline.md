# 目前任務（來自 Claude）

「直接記錄大餐」（commit `10b0514`）跟「運動消耗參考」（commit `ac60783`）都審查過了。Part A（直接記錄大餐）做得很好，`resolveFeastItem`/`logFeastDirectly` 這輪我在上面繼續擴充。**Part B（運動消耗參考）這輪要整個換掉**——這不是你做錯，是我們（我跟使用者，還請了另一個 AI review 兩輪）審查後認為第一版的 kcal 設計即使架構上跟飲食資料隔離，使用者還是會在腦中把「運動消耗 kcal」跟「飲食預算 kcal」拿來換算，跟 PRD 反覆強調要避免的「補償性運動」心態是同一件事，所以撤回改版。詳情在下面「Part 3」。

## 我（Claude）這輪直接做的事（不用你動，直接拿現有的用）

這輪範圍很大，我把核心引擎、資料、資料庫層都直接改完並用 Node 模擬測試驗證過了：

1. **`js/database.js`**：修正一個既有 bug——`getTaiwanItems()` 原本讀 IndexedDB 但從沒有程式碼寫入過，一直回傳空陣列（「台式熱門品項參考」畫面因此從未真的顯示過資料）。改成跟 `recommend.js` 一樣直接 fetch `data/taiwan_items.json` 並快取。另外修正 `applyFilter()` 的過敏原判斷漏洞（缺過敏原資料時原本會直接放行）、新增 `removeDailyLog(id)`、新增 `getAllRecipeFeedback()`（批次讀取回饋，效能考量）。
2. **`js/engine/feast.js`**：`resolveFeastItem` 現在也回傳台式品項的 `protein_g`/`fiber_g`（原本只有自訂食物有），並新增 `usesFlex` 判斷——只有「大餐類」品項才消耗週彈性點數，健康品項（豆漿/地瓜等）不消耗；`reserveFeast`/`logFeastDirectly` 依此決定要不要更新 `weekly_flex_ledger`。新增 `undoDailyLog(dailyLogId)` 撤銷功能（原本完全沒有刪除 `daily_log` 的路徑）。
3. **`js/engine/recommend.js`**：整個重寫，三個候選來源（自組食譜/超商即食/台式外送）併入同一個候選池：
   - 台式熱門品項（`taiwan_items.json`）正式併入，標記 `is_delivery`，依 `uses_flex` 決定要不要檢查週彈性點數額度（額度不夠就不推薦）。
   - 新的 `mealPrefs` 參數取代舊的 `preptimeToday`/`mealStylePreference`——**每個時段一個值**：`"auto"`/`"convenience"`/`"delivery"`/`"cook_quick"`/`"cook_full"`，**硬性篩選**（選了就只在該來源挑，不是加分），篩不到才 fallback 並標記 `fallback_to_auto: true`。
   - 函式簽名改成：`getTodayRecommendation(remainingBudget, hardConstraints, mealPrefs, dietRestriction, allergens, flexLedger)`。
4. **`data/taiwan_items.json`**：50筆全部補上 `allergen_tags`／`protein_g`／`fiber_g`／`uses_flex`（15筆大餐類=true，其餘35筆=false）。
5. **`data/protein_sources.json`/`staples.json`**：補上鮭魚/鯛魚缺的「魚」過敏原標籤、板豆腐/無糖豆漿/毛豆仁缺的「黃豆」標籤。
6. **`css/style.css`**：radio 按鈕現在也套用跟 checkbox 一樣的橫排樣式（你上次提到的排版問題）；補上運動頁新區塊的標題襯線字。
7. PRD/TECH-SPEC 都同步更新，說明所有設計決策的原因。

**這輪請不要動 `js/database.js`、`js/engine/feast.js`、`js/engine/recommend.js`、`data/taiwan_items.json`、`data/protein_sources.json`、`data/staples.json`——我已經改完並用 Node 模擬測試驗證過了。**

---

## 這一輪要做的事（第一部分）：基本資料分頁——「今日建議來源」取代「備餐時間」

### 1. `index.html`

把現有「備餐時間」`<fieldset>`（第 95–119 行附近，裡面是 `prep_time_weekday`/`prep_time_weekend` 兩個下拉）**整個換成**：

```html
<fieldset>
  <legend>今日建議來源</legend>
  <div class="form-row">
    <div class="form-field">
      <label>早餐
        <select name="meal_pref_breakfast">
          <option value="auto">無偏好</option>
          <option value="convenience" selected>超商</option>
          <option value="delivery">外送</option>
          <option value="cook_quick">快煮（≤15分鐘）</option>
          <option value="cook_full">正常煮</option>
        </select>
      </label>
    </div>
    <div class="form-field">
      <label>午餐
        <select name="meal_pref_lunch">
          <option value="auto">無偏好</option>
          <option value="convenience" selected>超商</option>
          <option value="delivery">外送</option>
          <option value="cook_quick">快煮（≤15分鐘）</option>
          <option value="cook_full">正常煮</option>
        </select>
      </label>
    </div>
    <div class="form-field">
      <label>下午茶
        <select name="meal_pref_afternoon_tea">
          <option value="auto" selected>無偏好</option>
          <option value="convenience">超商</option>
          <option value="delivery">外送</option>
          <option value="cook_quick">快煮（≤15分鐘）</option>
          <option value="cook_full">正常煮</option>
        </select>
      </label>
    </div>
    <div class="form-field">
      <label>晚餐
        <select name="meal_pref_dinner">
          <option value="auto">無偏好</option>
          <option value="convenience">超商</option>
          <option value="delivery">外送</option>
          <option value="cook_quick">快煮（≤15分鐘）</option>
          <option value="cook_full" selected>正常煮</option>
        </select>
      </label>
    </div>
    <div class="form-field">
      <label>宵夜
        <select name="meal_pref_snack">
          <option value="auto" selected>無偏好</option>
          <option value="convenience">超商</option>
          <option value="delivery">外送</option>
          <option value="cook_quick">快煮（≤15分鐘）</option>
          <option value="cook_full">正常煮</option>
        </select>
      </label>
    </div>
  </div>
</fieldset>
```
（`selected` 的預設值對照 `js/engine/recommend.js` 的 `DEFAULT_MEAL_PREFS` 常數：早餐/午餐=超商、下午茶/宵夜=無偏好、晚餐=正常煮。「今日建議時段」那個 fieldset（勾選要不要顯示建議）維持原樣不用動，這是另一件事——一個決定「要不要顯示這個時段」，一個決定「這個時段偏好哪種來源」，兩個都留著。）

### 2. `js/ui/tab-profile.js`

- `readProfileForm()`：**移除** `prep_time_weekday`/`prep_time_weekend` 這兩行，改成：
  ```js
  meal_prefs: {
    breakfast: fd.get("meal_pref_breakfast"),
    lunch: fd.get("meal_pref_lunch"),
    afternoon_tea: fd.get("meal_pref_afternoon_tea"),
    dinner: fd.get("meal_pref_dinner"),
    snack: fd.get("meal_pref_snack"),
  },
  ```
- `fillProfileForm()`：**移除** `set("prep_time_weekday", ...)`/`set("prep_time_weekend", ...)` 這兩行，改成：
  ```js
  const mealPrefs = profile.meal_prefs || {};
  ["breakfast", "lunch", "afternoon_tea", "dinner", "snack"].forEach(function (slot) {
    const el = form.elements["meal_pref_" + slot];
    if (!el) return;
    const v = mealPrefs[slot];
    el.value = (window.MEAL_SOURCE_OPTIONS && window.MEAL_SOURCE_OPTIONS.indexOf(v) !== -1)
      ? v
      : (window.DEFAULT_MEAL_PREFS ? window.DEFAULT_MEAL_PREFS[slot] : "auto");
  });
  ```
  （`window.MEAL_SOURCE_OPTIONS`/`window.DEFAULT_MEAL_PREFS` 是 `recommend.js` 已經匯出的常數，直接用。舊資料沒有 `meal_prefs` 欄位時，會自動套用這個預設值，不用另外寫遷移邏輯——這是刻意的簡化決定，PRD 裡有說明原因。）
- 確認 `index.html` 裡 `js/engine/recommend.js` 的 `<script>` 標籤要在 `js/ui/tab-profile.js` 之前載入（應該本來就是，因為 `tab-profile.js` 現在要讀 `window.MEAL_SOURCE_OPTIONS`），若順序不對要調整。

---

## 這一輪要做的事（第二部分）：`tab-today.js`——接新的引擎介面 + 記錄這餐

### 1. 呼叫 `getTodayRecommendation` 的地方

`buildRecommendation()` 裡呼叫引擎那段，簽名整個換了，改成：

```js
const weekStart = mondayOfThisWeek(); // 這個函式檔案裡應該已經有類似的，沒有就照 tab-week.js 的寫法加一個
const ledger = await getWeeklyLedger(weekStart);
const recs = await getTodayRecommendation(
  remainingBudget,
  hardConstraints,
  profile.meal_prefs,
  profile.diet_restriction,
  profile.allergens,
  ledger // { cap_kcal, used_kcal }，沒有的話 getWeeklyLedger 會回傳 null，引擎裡有處理 null 的情況
);
```

### 2. 顯示 fallback 訊息

`renderRecs()` 裡，每個 slot 顯示卡片內容前，先判斷 `rec.fallback_to_auto`：如果是 `true`，在卡片內容最上面加一行提示（中性文案，不要用「抱歉」「很遺憾」這類字眼）：
```js
const fallbackNote = rec.fallback_to_auto
  ? '<p class="rec-fallback-note">今日這個來源沒有符合配額的選擇，已改為一般推薦</p>'
  : "";
```
`.rec-fallback-note` 的 CSS 你可以照現有 `.rec-base`（灰色小字）那種風格加一個。

### 3. 新增「記錄這餐」按鈕

每張 `rec-card` 在「倒讚」按鈕旁邊加一個「記錄這餐」按鈕：
```html
<button type="button" class="primary-btn rec-log-btn" data-slot="早餐">記錄這餐</button>
```
（用 `class="secondary-btn"` 或你覺得合適的既有按鈕樣式都可以，不用一定用 primary。）

點擊處理邏輯：
```js
async function onLogRecClick(slot, rec, btnEl) {
  btnEl.disabled = true; // 防連點
  try {
    const today = localDateStr(); // 檔案裡應該已經有這個 helper
    let savedId;
    if (rec.is_delivery) {
      // source_id 是 recommend.js 給的原始 taiwan_items id（拿掉 tw_ 前綴後的那個）
      const saved = await logFeastDirectly(today, slot, null, rec.source_id);
      savedId = saved.id;
    } else {
      const saved = await addDailyLog({
        log_date: today,
        slot: slot,
        source_type: rec.is_convenience ? "custom" : "recipe_template",
        item_id: null,
        item_name: rec.name,
        kcal: rec.scaled_kcal,
        protein_g: rec.protein_g,
        carb_g: rec.carb_g,
        fat_g: rec.fat_g,
        fiber_g: rec.fiber_g,
        is_feast: 0,
        feast_reservation_id: null,
      });
      savedId = saved.id;
    }
    // 記錄成功：按鈕文字改「已記錄」+ 顯示撤銷連結（只在這次畫面存續期間有效，重新整理頁面後就沒有撤銷按鈕了，
    // 這是刻意先做簡單版，之後如果要做「重新整理後還能撤銷今天已記錄的項目」會是新任務）
    btnEl.textContent = "已記錄";
    const undoBtn = document.createElement("button");
    undoBtn.type = "button";
    undoBtn.className = "feast-cancel rec-undo-btn";
    undoBtn.textContent = "撤銷";
    undoBtn.addEventListener("click", async function () {
      await undoDailyLog(savedId);
      undoBtn.remove();
      btnEl.disabled = false;
      btnEl.textContent = "記錄這餐";
      await buildRecommendation(); // 重新整理今日建議（budget重算會反映這筆記錄被撤銷）
    });
    btnEl.insertAdjacentElement("afterend", undoBtn);
    await buildRecommendation(); // 讓其他還沒記錄的時段的配額重新反映今天已吃的熱量
  } catch (err) {
    console.error(err);
    alert("記錄失敗，請重試。");
    btnEl.disabled = false;
  }
}
```
（`carb_g`/`fat_g` 目前 `rec` 物件上四軸組合都有算，超商組合也有，直接用；`addDailyLog`/`undoDailyLog`/`logFeastDirectly` 都是現成的全域函式。）

**已知限制（這輪先不處理，跟使用者說清楚就好）**：撤銷按鈕只在當次瀏覽期間有效，重新整理頁面後今天已經記錄的項目沒有撤銷入口（除非之後去別的分頁用其他方式查/刪）。持久化的「今天記錄清單」會是後續任務。

---

## 這一輪要做的事（第三部分，取代你上次做的 Part B）：運動紀錄改用「本週活動量」而非 kcal

**請整個取代你上次 `ac60783` commit 裡加的 `ACTIVITY_MET`/`INTENSITY_MET_FALLBACK`/`WEEKLY_EXERCISE_KCAL_TARGET`/`estimateExerciseKcal`/`renderWeeklyKcal` 這些東西，全部刪掉**，換成下面這套。運動項目常用選項下拉（散步/快走/慢跑...）那部分做得很好，維持不變。

### 1. `js/ui/tab-exercise.js`

刪除舊的 MET/kcal 相關常數與函式，改成：

```js
const WEEKLY_ACTIVITY_TARGET = { moderateMinutes: 150, strengthDays: 2 }; // WHO/ACSM一般性建議，跟goal_mode脫鉤
const INTENSITY_MULTIPLIER = { "低": 0, "中": 1, "高": 2 }; // 低強度不計入150分鐘累計，另外顯示

function computeWeeklyActivity(logs) {
  let moderateMinutes = 0;
  let lightMinutes = 0;
  const strengthDates = {};
  logs.forEach(function (l) {
    if (!l) return;
    if (l.activity_type === "重訓") {
      strengthDates[l.log_date] = true;
      return;
    }
    const mult = INTENSITY_MULTIPLIER.hasOwnProperty(l.intensity) ? INTENSITY_MULTIPLIER[l.intensity] : 1;
    if (mult === 0) {
      lightMinutes += Number(l.duration_min) || 0;
    } else {
      moderateMinutes += (Number(l.duration_min) || 0) * mult;
    }
  });
  return {
    moderateMinutes: Math.round(moderateMinutes),
    lightMinutes: Math.round(lightMinutes),
    strengthDays: Object.keys(strengthDates).length,
  };
}
```

- **表單/歷史紀錄列表**：**拿掉**「約消耗 X kcal」那一行（`renderList` 裡刪掉，不需要 `profile.weight_kg`、也不需要任何 kcal 估算顯示）。
- **本週活動量參考區塊**（`.exercise-weekly-kcal` 這個 class 名稱建議改成 `.exercise-weekly-activity`，`index.html` 對應也要改）：讀本週（週一到今天，沿用你原本 `renderWeeklyKcal` 抓資料範圍的寫法）的 `exercise_log`，呼叫 `computeWeeklyActivity(logs)`，組文案塞進區塊：
  ```js
  function renderWeeklyActivity(logs) {
    const stats = computeWeeklyActivity(logs);
    const el = $("#exercise-weekly-kcal-text"); // id 沿用，或改成 #exercise-weekly-activity-text 都可以，記得index.html同步改
    if (!el) return;
    let text = "本週已活動 " + stats.moderateMinutes + " 分鐘（目標 " + WEEKLY_ACTIVITY_TARGET.moderateMinutes + " 分鐘）・肌力訓練 " + stats.strengthDays + " 天（目標 " + WEEKLY_ACTIVITY_TARGET.strengthDays + " 天）";
    if (stats.lightMinutes > 0) {
      text += "；另有輕度活動 " + stats.lightMinutes + " 分鐘";
    }
    el.textContent = text;
  }
  ```
  **文案規則（硬性要求）**：只能是上面這種中性進度描述，**不能出現「還差」「不足」「落後」這類呈現缺口的字眼**，達標與否都用同一種「目前進度 vs. 目標」的平鋪敘述，不要因為達標/未達標切換不同語氣。
- `ready()`：載入時呼叫 `renderWeeklyActivity(logs)`；`onSubmit` 記錄成功後也要重新呼叫一次刷新本週累計。

### 2. `index.html`

`.exercise-weekly-kcal` 區塊的說明文字「僅供參考，不列入每日熱量預算，跟飲食/彈性點數無關」**要拿掉或改寫**，因為現在完全不提 kcal，這句話已經不適用；可以簡化成沒有這行，或改成更符合新內容的說明（例如「WHO一般性建議，僅供參考」），你自行判斷。class 名稱如果要一併改成 `.exercise-weekly-activity` 記得 CSS（`css/style.css`）跟 JS 選取器都要同步改，不要留下對不上的孤兒 class。

### 3. `輕盈計畫PRD_v4.0.md`／`輕盈計畫_TECH-SPEC.md`

這兩份我已經改好新版說明了，這部分你不用動文件，只要程式對得上文件描述的行為即可。

**驗證方式**：你沒有瀏覽器，肉眼檢查 + 列清單：
- 確認全站 grep 找不到任何殘留的 kcal/MET 運動相關字樣（`ACTIVITY_MET`、`estimateExerciseKcal`、`WEEKLY_EXERCISE_KCAL_TARGET` 都應該完全被移除，不是註解掉）。
- 確認「重訓」類型的紀錄不會被算進 `moderateMinutes`，只算進 `strengthDays`。
- 確認低強度紀錄不計入 `moderateMinutes`，但有算進 `lightMinutes` 並顯示出來。
- grep 確認新文案沒有「還差」「不足」「落後」字樣。

---

**驗證方式（第一、二部分）**：
- 確認 `meal_prefs` 在 `readProfileForm`/`fillProfileForm` 都有處理 5 個時段，且舊資料（沒有這個欄位）套用 `DEFAULT_MEAL_PREFS`。
- 確認 `tab-today.js` 呼叫 `getTodayRecommendation` 的參數順序正確（`mealPrefs` 是第3個、`flexLedger` 是第6個）。
- 確認「記錄這餐」對 delivery/非delivery 兩種情況都能正確寫入，且 delivery 品項會經過 `logFeastDirectly`（可能扣彈性點數）、非delivery 只呼叫 `addDailyLog`（不動彈性點數）。
- 確認撤銷按鈕點擊後，`weekly_flex_ledger` 有正確退回點數（如果原本有扣的話）。
- grep 確認沒有新增「補償/贖罪/代價」等字樣。

這幾部分只改 `index.html`、`js/ui/tab-profile.js`、`js/ui/tab-today.js`、`js/ui/tab-exercise.js`、`css/style.css`，不要動這輪我列在最前面「不用你動」清單裡的檔案。

做完後照協作規則：commit（**只要本機 commit，不要 `git push`**），並把報告寫進 `collab/from-cline.md`。**這輪 commit 時請把我改的 `js/database.js`、`js/engine/feast.js`、`js/engine/recommend.js`、`data/taiwan_items.json`、`data/protein_sources.json`、`data/staples.json`、`css/style.css`、`輕盈計畫PRD_v4.0.md`、`輕盈計畫_TECH-SPEC.md` 也一起加進去**。這輪範圍比較大，建議分成 3 個 commit（對應上面三部分），比較好追蹤。

## 分工說明

這個專案的 GitHub push 與未來的雲端部署（GitHub Pages/Netlify 等）由 Claude 負責，Cline 只需要寫程式、本機 commit，不用處理 remote，也不用管部署。
