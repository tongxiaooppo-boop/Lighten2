# Claude 交接筆記（更新於 2026-09-25 晚，週日 2026-09-27 接續用）

這份是寫給下一個 Claude session（或 compact 之後的自己）看的，不是給 Cline 的。上一版（TASK 1-12 那輪）的內容已經全部執行完並 commit/push 完畢，這版整個改寫，只留現在還沒解決的事。

## 週日（2026-09-27）優先順序：先討論，再決定改什麼

### 1. 週彈性帳本／週末大餐熱量處理——重新設計，還沒動手實作

背景：使用者質疑「週彈性 1400kcal」這個固定值沒有依據，也質疑「預約大餐當下應該就削減當天或後兩天的額度」。我判斷這是大架構決策，找 Opus 做了**兩輪獨立審查**（`Agent` tool, `model: "opus"`，同一個 agent id，可用 `SendMessage` 繼續問），結論：

- **否決**「大餐當下就往後扣未來 1-2 天額度」，也**否決**「接上現成但從沒被呼叫的 `planOverageSmoothing`」——兩者本質上都是「暴食後限制」循環，只是觸發時間點不同，違反 PRD 明文禁止的補償/贖罪框架。
- **否決**「方案A：星期分配（週末目標調高、平日調低，一週總量不變）」——Opus 第二輪自己撤回，理由：使用者長期看到「平日就是比較少」會學成「省下來給週末花」的心態，跟他自己反對的跨週熱量銀行是同一種心理機制，只是週期比較短；而且固定的高週末目標會把大餐「常態化成義務」。
- **建議做的方向**（Opus 給了可直接實作的規格，但**還沒寫進 PRD/TECH-SPEC，也還沒動一行程式碼**）：
  1. 大餐當天：現有「當天重新分配熱量」保留，新增「同一天其他時段優先推薦補蛋白質/纖維」而非單純減熱量。
  2. 長期熱量盈餘交給「體重趨勢自動校正」：重寫 `tdee.js` 的 `calibrateWeeklyTdee`——體重用 EWMA（α=0.1，半衰期約6.6天）平滑掉單次水腫雜訊，看 28 天線性回歸斜率，依 `goal_mode`（減脂/維持/增肌）各自不同觸發門檻，**維持模式的下修一定要使用者按確認**（避免跟增肌重訓的正常體重上升搞混），上修自動套用；offset 累積上限 ±300kcal、修正後 14 天冷卻期；隔天生效不中途改當天配額。
  3. **週彈性帳本整個拔除**（`cap_kcal`/`used_kcal`/`computeWeeklyCapKcal`/`computeDaySettlement`/`settleWeeklyLedger`/`planOverageSmoothing`/`getWeeklyLedger`/`updateWeeklyLedger`，連同常數 `CUT_CAP_RATIO`/`FLEX_CAP_FIXED`/`DAILY_SAVE_CAP_RATIO`），**不是保留不顯示**——Opus 特別強調這個專案已經出現兩次「死碼等人接回去」，這次要真的刪乾淨。IndexedDB 裡已存在的 `weekly_flex_ledger`/`ledger_last_settled_date` 不用遷移，放著不讀即可。
  4. 改用「近 7 天平均 vs 目標」的中性顯示取代進度條（今日建議彙總卡＋`tab-ledger.js`＋`tab-week.js`都要一起改），只用「完整記錄日」（該天所有開啟時段都有記錄）計算平均，不足 3 天就顯示「資料不足暫不計算」；文案禁用「額度/剩餘/超支/彈性點數/還/補/抵/存」這些字。
  5. `tab-ledger.js` 的「預約大餐」表單＋清單（確認/取消）**維持不動**，跟熱量帳本機制無關。

完整規格（EWMA 係數、各 goal_mode 門檻表、`tdee_state` 資料結構、各檔案要改的函式清單、驗收項目）在本次對話紀錄裡（跟 agent `a3e31f65680f15963` 的第二輪問答），週日要做的第一件事是**把這份規格轉述給使用者看過一輪、確認方向**，不要直接開始改——上次我問使用者「1.我直接做 2.寫成to-cline給Cline 3.你先看完整規格」三選一，還沒等到回覆就被切換去處理其他問題。

**這是會動到 `feast.js`／`database.js`／`nutrition.js`／`tdee.js`／`tab-today.js`／`tab-week.js`／`tab-ledger.js`／`index.html`／PRD／TECH-SPEC 的大改動，動手前務必先確認方向。**

### 2. Bug：今日建議仍然會把飲品/調製飲品湊在一起

時間序：
1. 使用者截圖回報「一餐叫我喝兩杯豆漿」（早餐同時出現「統一陽光高纖無糖豆漿」+「光泉燕麥高纖無糖豆漿」）。
2. 我查到根因：`recommend.js` 的超商組合邏輯（`mains.forEach` 那段）原本對 `extras` 陣列（飲品+蛋白飲/點心棒兩類）做無條件兩兩配對，會湊出兩款飲品的組合。
3. 我改成「最多一款飲品（`飲品`分類）+ 一款點心棒（`蛋白飲/點心棒`分類）」，commit `af2d7c6`，並用 850 個組合跑過一次確認沒有殘留雙飲品組合（用的是分類名稱去判斷，不是逐一看品項本身是不是液態）。
4. **使用者事後表示週日還是要修「飲品或調製飲品放一起」的問題**——代表這個修正還不夠，懷疑根因：
   - `convenience_items.json` 的「蛋白飲/點心棒」這個分類本身混了真正的液態飲品（例如「翰方御品 高蛋白飽飽纖搖飲」「Plenti／Oatly 濃縮燕麥奶」都是喝的）跟真正的固態點心棒（例如「Soyjoy 大豆營養棒」）。我的修正邏輯只保證「一款飲品分類 + 一款蛋白飲/點心棒分類」，如果從「蛋白飲/點心棒」挑到的剛好是液態品項（翰方御品、Plenti/Oatly），一樣會湊出兩杯飲料——**問題出在分類本身把液態跟固態混在一起，不是配對邏輯錯**。
   - 也可能牽涉 `taiwan_items.json` 的「飲料」分類（手搖飲類）或 `dish_archetypes.json` 自組食譜的某個槽位，還沒逐一排查，週日要先問使用者拿到具體是哪一筆組合，再往回追是走哪個候選池的邏輯產生的。
   - **修法方向（尚未實作，週日做）**：把 `convenience_items.json` 的「蛋白飲/點心棒」拆成兩個真正的分類（例如「蛋白飲」歸進飲品類一起算、「點心棒」獨立成不算飲品的分類），配對邏輯改成「全站最多一款液態飲品」而不是「每個分類各一款」。

## 記憶系統（auto-memory）目前狀態

`C:\Users\Max\.claude\projects\d--ok-lighten\memory\` 已有：
- `feedback_autoproceed_handoff.md`：審查通過就直接寫下一輪交接，不用問
- `project_cline_handoff_workflow.md`：使用者手動貼 `collab/to-cline.md` 給 Cline
- `feedback_language_chinese.md`：一律中文回覆
- `feedback_verify_runtime_pipeline.md`：審查要連 runtime 資料管線一起查
- `project_opus_review_for_major_design.md`：大架構決策找 Opus 兩輪獨立審核
- `project_weekly_flex_redesign.md`（新增，這輪存）：週彈性帳本重新設計的現況，見上方第 1 點
