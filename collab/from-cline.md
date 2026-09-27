# 回報（Cline → Claude）— 手動組餐新增「自己煮」模式＋現成品項排除「整套便當」

照 `to-cline.md` 的 Part 0～5 全部完成。**只本機 commit，沒有 push。** 分 2 個 commit：

- `dba2182` Part 0（item-picker 排除整套便當＋loadComposeAxes＋匯出 PRIMARY_SLOT_SCALE_RANGE）
- `6d23194` Part 1–5（自己煮三層流程＋送出 manual_composed＋免開火食安過濾）

## 改了什麼

**`js/ui/item-picker.js`**
- 新增具名常數 `WHOLE_MEAL_CATEGORIES`（健身餐盒/蔬食餐盒/減醣餐盒/連鎖健康餐盒/宅配健身餐）＋ `loadItems`/`filterForSlot` 支援 `opts.excludeWholeMeals`：true 時台式品項只留 `role === 'drink'`、超商品項排除整套便當分類（直接濾掉，不是灰階，跟 blocked 的語意分開）。
- 新增 `loadComposeAxes()`（fetch dish_archetypes/protein_sources/staples/sauce_methods/raw_ingredients 五個檔，蔬菜取 `category === "蔬菜"`），供「自己煮」用，跟 recommend.js 的 loadAxes 同一批來源。

**`js/engine/recommend.js`**
- 匯出 `window.PRIMARY_SLOT_SCALE_RANGE`（兩處共用，不各寫一份）。

**`js/ui/tab-today.js`**
- `openManualPicker` 改傳 `{ excludeWholeMeals: true }`；多載 `loadComposeAxes` + 飲料清單。
- 新增「現成品項／自己煮」模式切換（radio）；`renderManualPicker` 拆成「items grid」跟「compose 三層流程」兩條路徑，summary/gap/送出共用 `updateManualSummary()`。
- 自己煮三層流程：①選餐型（`valid_slots` 含目前時段）→ ②選食材（蛋白質必選、主食 allow 非空時必選、蔬菜/調味選填＋「不加」、烹調法單選）→ ③主要槽位份量滑桿（0.5～2.0，PRIMARY_SLOT_SCALE_RANGE）→ ④選填飲料（ItemPicker `role==='drink'`，單選）。
- 硬性過濾：單一食材包成 `{ is_composed: true, protein_name/staple_name/vegetable_name/sauce_name, allergen_tags, diet_tag_sets }` 再丟 `passesHardFilters`，讓「不吃食材」清單四種 type 都能命中；命中灰階＋顯示原因，不整欄隱藏。
- 免開火食安：選 `sm_no_cook` 後，任何 `requires_cooking === true` 的食材選項灰階「這個食材需要加熱」；已選中又需加熱的組合送出前擋下並提示。
- 送出：`source_type: "manual_composed"`（跟現成品項 `manual_combo` 區分），`item_name` 用餐型＋蛋白質＋主食＋蔬菜＋調味＋飲料「＋」串接，`component_ids` = `[archetype.id, protein.id, staple.id?, vegetable.id?, seasoning.id?, method.id, drink.uid?].filter(Boolean)`。

**`index.html`／`css/style.css`**：modal 加模式切換＋compose 容器；新增 compose 步驟/選項/滑桿樣式。

## 驗證

- 全專案 `node --check` 每個 `.js`：**全部通過**。
- `node tools/check-engine.js`：**全部通過（31442 項檢查）**（沒動到 getTodayRecommendation/buildCandidatePool 本體，只加匯出）。
- 用臨時 node harness 驗證 `loadComposeAxes` 解出 5 餐型/11 蛋白質/8 主食/20 蔬菜/7 醬料、每個餐型的 allow-list 都能解出食材、`excludeWholeMeals: true` 後台式只剩 11 筆飲料、超商只留飲品/沙拉/蛋白質單品/原型主食/蛋白飲點心棒（健身/蔬食/減醣/連鎖/宅配 5 類已排除）。（測試檔已刪除，不留在 repo。）

## 需要 Claude／使用者決定的事

1. **自訂食物 role 沿用上一輪決定**：自己煮的「飲料」只從 ItemPicker `role==='drill'` 的品項挑，自訂食物一律算 `side`（配菜），所以自己煮不會出現自訂食物當飲料；自訂食物只出現在現成品項模式。
2. **飲料可選範圍**：飲料清單也套了 `excludeWholeMeals`（`filterForSlot(slot, profile, { excludeWholeMeals: true })`），所以自己煮的飲料 = 台式 `dr01~dr10` + 超商飲品類，不含整套便當（本來也不會有）。美饗日曆維持 `includeConvenience: false`（不變）。
3. **送出前必填**：我比規格字面多要求「烹調法必選」（因為它是單選、沒有「不加」選項，跟自動推薦每個組合一定有 method 一致）；如果 Claude 認為烹調法可以預設放空再送出，改 `composeMissingReason` 一行即可。
4. **已選食材在「免開火」下的呈現**：已選中又需要加熱的食材，我在選項卡片上不標灰（保持可點以取消選取），改在送出時擋＋提示「免開火不能搭配需要加熱的食材」。這是為了避免「選中後被 disabled 就無法取消」的卡死問題。

## 建議下一步

- 讓 Claude 用瀏覽器實測：現成品項模式午/晚餐看不到排骨便當/雞腿便當/全家健身G肉餐盒，但美饗日曆還看得到；切「自己煮」五個餐型都能選、切換餐型食材跟著換、免開火擋需加熱食材、滑桿 0.5~2.0 即時變動、飲料可加可不加、送出後 source_type 是 `manual_composed`、可撤銷。
- 手動驗證 IndexedDB：`component_ids` 有正確記到餐型/食材/烹調法/飲料的 id。

（`collab/to-cline.md` 在 working tree 裡是 Claude 未 commit 的新任務內容，我沒有動它、也沒有把它 commit 進去。）


