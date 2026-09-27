# 目前任務（來自 Claude）— 手動組餐拿掉「現成品項」模式，「自己選」只留「自己煮」

使用者看了「現成品項」模式的畫面（截圖顯示前面十幾張卡片幾乎全部是飲料，要滑很久才看得到沙拉/雞胸肉這些食物）後回饋：這個模式本質上就是「挑一個現成商品」，跟美饗日曆做的事重複，不該在「自己選」裡面重複做一套。**使用者已經明確拍板：整個拿掉「現成品項」模式，「自己選」只留「自己煮」（餐型骨架＋食材軸）這一種。**

**在這之前先蓋掉 `collab/to-cline.md` 裡「蛋白質/蔬菜改多選」那份舊任務——如果 Cline 還沒開始做那份，這次直接照這份新的做，那份多選的需求還是有效，會併在下面一起講清楚；如果已經做了一半，先看下面的驗收清單，多選的部分繼續保留，只是拿掉現成品項模式跟它牽連的東西。**

---

## Part 1：拿掉「現成品項」模式（`js/ui/tab-today.js`）

**整個刪除，不是留著隱藏／不呼叫：**
- 狀態：`manualPicker.mode`、`manualPicker.passItems`、`manualPicker.blockedItems`、`manualPicker.selectedUids` 這幾個欄位刪掉（`manualPicker.compose` 保留，之後就是唯一內容）。
- 函式：`manualSelectedItems()`、`manualRoleLimits()`、`onManualItemClick()`、`syncModeRadios()`、`setManualMode()`、`suggestFillers()` 全部刪除。
- `renderManualPicker()` 裡判斷 `manualPicker.mode === "compose"` 的 if/else 分支拿掉，直接固定呼叫 `renderComposeMode()`（不用再判斷模式）。
- `updateManualSummary()` 裡 `isCompose` 判斷跟 `selItems`/`totals` 的 items 分支拿掉，直接用 `composeTotals()`。「可以考慮加」那段 gap 建議（原本呼叫 `suggestFillers`）**這次順便拿掉**——那段本來就是從超商/台式清單找東西來補，跟這次「拿掉現成品項清單」的精神衝突，缺口數字（蛋白質缺口/纖維缺口）繼續顯示，只是不再列出「可以考慮加：xxx」這行建議。
- `onManualSubmit()` 裡 `manualPicker.mode === "compose"` 的判斷拿掉，永遠走原本 compose 那個分支（`source_type` 永遠是 `"manual_composed"`，`manual_combo` 這個 `source_type` 以後不會再有新紀錄寫入，舊資料不用管，欄位本身沒有 schema 變動）。
- `openManualPicker()` 裡：
  - `filterForSlot(slot, profile, { excludeWholeMeals: true })` 那次呼叫，**改成純粹只是為了拿飲料清單**，簡化成 `filterForSlot(slot, profile, {})`（不用再傳 `excludeWholeMeals`，理由見 Part 2）。
  - 拿掉 `manualPicker.passItems`/`manualPicker.blockedItems`/`manualPicker.selectedUids` 的賦值。
  - `manualPicker.compose.drinkItems`/`drinkBlocked` 繼續從這次呼叫的結果篩 `role === 'drink'`（這段邏輯不變）。
  - 拿掉 `syncModeRadios()` 呼叫，`manualPicker.mode = "items"` 那行刪掉。

`ready()` 裡：
- 拿掉 `manualItems`（`#manual-picker-items` 的 click listener，`onManualItemClick`）。
- 拿掉 `modeRadios` 那段（radio 的 change listener）。
- `composeModeEl` 的 click listener（`onComposeClick`）保留。

---

## Part 2：`js/ui/item-picker.js` 清掉不再用的東西

`excludeWholeMeals` 這個選項跟 `WHOLE_MEAL_CATEGORIES` 常數，**目前只有上一輪「現成品項」模式在用**，這次那個模式整個拿掉之後就是死碼，刪除：
- `WHOLE_MEAL_CATEGORIES` 常數刪掉。
- `loadItems()`／`filterForSlot()` 裡 `opts.excludeWholeMeals` 相關的 if 判斷拿掉，恢復成原本單純載入的樣子。
- `window.ItemPicker` 匯出物件裡移掉 `WHOLE_MEAL_CATEGORIES`。
- **確認美饗日曆（`tab-ledger.js`）沒有呼叫 `excludeWholeMeals`**（本來就沒有，這步只是順手確認不要漏東西）。
- `loadComposeAxes()`、`cardHtml()`、`fitsSlot()`、`loadItems()`、`filterForSlot()`、`sumSelected()` 這些**繼續保留**，「自己煮」的食材軸/飲料清單跟美饗日曆都還在用。

---

## Part 3：`index.html`／`css/style.css` 清掉模式切換 UI

`index.html` 的 `manual-picker-overlay` modal：
- 拿掉「現成品項／自己煮」的 radio 切換區塊（`<div class="manual-picker-mode">...`）。
- 拿掉 `#manual-picker-items-mode` 那個 wrapper（含裡面「點卡片多選，最多1主餐+1配菜...」的說明文字跟 `#manual-picker-items` 網格）。
- `#manual-picker-compose-mode` 這個 div 拿掉 `hidden` 屬性，改成 modal 一打開就直接顯示（因為現在只有這一種內容）。
- 標題底下可以加一句簡短說明取代原本的模式切換文字，例如「選餐型 → 挑食材 → 調份量 → 選填飲料」，方便使用者知道流程，不強制，Cline 自行判斷要不要加。

`css/style.css` 裡如果有專門給 `.manual-picker-mode` radio 切換用的樣式，一併清掉；`.compose-*` 系列樣式繼續保留。

---

## Part 4：蛋白質／蔬菜改多選（上一份任務的需求，這輪一併做，沒有變）

這部分需求不變，照這裡重新完整列一次（如果上一份任務已經做掉這部分，這裡只是確認規格一致，不用重做）：

- **蛋白質、蔬菜開放多選**：蛋白質上限 2 種，蔬菜上限 3 種，寫成具名常數 `COMPOSE_MAX = { protein: 2, vegetable: 3 }`。
- **主食、調味維持單選**，行為不變。
- **份量縮放**：有主食槽的餐型，縮放照舊套在主食上。**沒有主食槽的餐型**（例如「煎蛋類」）——只有使用者剛好只選了 1 種蛋白質時才提供縮放滑桿；選了 0 種或 2 種蛋白質時，滑桿不顯示，所有選中的蛋白質都用天然份量直接加總。
- `manualPicker.compose.protein`／`.vegetable` 改成陣列（預設 `[]`），選新餐型時重置成 `[]`（`staple`/`seasoning`/`method` 一樣重置成 `null`）。
- `composePrimaryItem()`：有主食槽回傳 `staple`；沒有主食槽時，`protein.length === 1` 才回傳那唯一一個，否則回傳 `null`。
- `composeTotals()`：主食（如果是 primary）套 `primaryScale`，蛋白質裡如果剛好是 primary 的那個套 `primaryScale`、其餘天然份量；**蔬菜一律不縮放**（不管選幾種）；調味/飲料邏輯不變。
- `composeAxisHtml()`：蛋白質／蔬菜這兩軸點擊改成 toggle（已選再點=取消，未選點擊=加入，達上限=`alert`提示「蛋白質最多選2種，要不要先取消一個」/「蔬菜最多選3種，要不要先取消一個」），`selected` 判斷從「等於某物件」改成「陣列裡有沒有這個id」；已選中的品項即使被硬性過濾擋住也要能點擊取消（沿用現有邏輯，只是判斷方式從相等改陣列包含）。主食/調味這兩軸維持原本單選寫法不變。
- `onComposeClick()`：`protein`/`vegetable` 分支改呼叫共用的 `toggleComposeMulti(c, field, id, max, label)` helper（兩軸共用一份邏輯，不要各寫一份）。
- `composeMissingReason()`：`c.protein.length === 0` 判斷「請選至少1種蛋白質」；免開火食安檢查要攤平陣列一起檢查（`[].concat(c.protein, c.staple || [], c.vegetable, c.seasoning || [])`，注意型別，蛋白質/蔬菜是陣列、主食/調味是單一物件或null，攤平時要小心）。
- `onManualSubmit()` compose 分支的 `nameParts`/`compIds` 組合，蛋白質/蔬菜要攤平多個名稱/id 再 join（`.concat(c.protein.map(...))`／`.concat(c.vegetable.map(...))`）。

---

## 驗收清單

- 打開「自己選」直接進「自己煮」流程，沒有模式切換 UI，不會看到超商/台式現成品項的清單畫面。
- 送出後 `daily_log` 的 `source_type` 永遠是 `"manual_composed"`（不會再產生 `"manual_combo"` 的新紀錄）。
- 蛋白質最多選 2 種、蔬菜最多選 3 種，達上限有提示；已選中的可以取消。
- 「煎蛋類」只選 1 種蛋白質時看得到縮放滑桿，選 2 種時滑桿消失、天然份量加總；有主食槽的餐型（炒類/烤舒肥定食/溫沙拉）縮放永遠套在主食上。
- 蔬菜不縮放。
- 加飲料那一步（Step 4）維持能用，飲料清單正常（不受這次拿掉 `excludeWholeMeals` 影響，因為飲料本來就不屬於整套便當分類）。
- `node --check` 全部 `.js` 過；`node tools/check-engine.js` 重跑維持全過。
- grep 確認 `manual_combo`、`WHOLE_MEAL_CATEGORIES`、`excludeWholeMeals`、`manualSelectedItems`、`manualRoleLimits`、`onManualItemClick`、`suggestFillers`、`syncModeRadios`、`setManualMode` 這些字串在 `.js`/`.html` 裡都清乾淨了（真的刪掉，不是留著不呼叫）。

---

做完後照協作規則：**只要本機 commit，不要 `git push`**，並把報告寫進 `collab/from-cline.md`。這輪範圍中等，建議 Part 1+2+3（拿掉現成品項模式）、Part 4（多選）分開兩個 commit。

## 分工說明

GitHub push 與部署由 Claude 負責，Cline 只需要寫程式、本機 commit，不用處理 remote，不用管部署。
