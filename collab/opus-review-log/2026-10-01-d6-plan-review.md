# 切片 6「常吃（推薦）」實作計畫審核（2026-10-01）

計畫：[docs/review/2026-10-01-D6-實作計畫.md](../../docs/review/2026-10-01-D6-實作計畫.md)（第一版）。推薦評分改動，照 PRD 13.6、章程 C3 另送審核。

## 第一輪：送給獨立 Opus 的問題（逐字）

```
你是獨立審核者，請用中文審核一份「改推薦評分」的實作計畫（章程 C3 要求推薦評分改動另送審核）。專案在 D:\ok\lighten（純前端 vanilla JS ＋ IndexedDB 的個人減脂飲食 App「Lighten2」）。

要審的計畫：docs/review/2026-10-01-D6-實作計畫.md（工作線 D 切片 6「常吃（推薦）」）。

產品決定已定案、不要推翻：decisions #81（含任一常吃品項的組合加 20 分、一個組合只加一次、清單是空的時候推薦逐字不變；否決了「只推常吃」與「加 40」）、#126、#127。依據：docs/PRD.md 第 6.1、13.6、13.9 節；docs/CHARTER.md 的 C1、C2、C4.13、C4.17（②③）。前一個切片的計畫與審核可參考格式與深度：docs/review/2026-10-01-D5-實作計畫.md、collab/opus-review-log/2026-10-01-d5-plan-review.md。

請你**實際打開程式**驗證計畫第 1 節「現況」與第 6 節「自查」的每個說法，至少要看：js/engine/recommend.js（score、getTodayRecommendation、feedbackScore）、js/engine/pool.js（components 怎麼組、哪些品項進候選池）、js/engine/today.js、js/engine/foods.js（favoriteEffectText、favoriteMessage）、js/engine/picker.js（effectiveFavorites）、js/ui/tab-today.js（buildRecommendation、tab:activated）、js/ui/meal-picker/index.js（setFavoriteInPicker、closePicker）、js/ui/foods/rows.js、js/ui/tab-foods.js、js/data/catalog.js（productsByUid、archetypes、foodTree 的 builtin）、tools/check-arch.js（C4.17 ② 現有寫法、stripCommentsAndStrings、nameHits）、tools/check-engine.js（直接呼叫 getTodayRecommendation／planToday 的地方，以及「常吃」一節）、tools/diff-recs.js（snapToday、todayScenario）、tools/lib/adapter-v2.js、tools/lib/fake-db.mjs、tools/snapshots/recs.txt。

重點請檢查：
1. 「清單是空的時候推薦逐字不變」與「既有 diff-recs 行逐字不變」是否真的成立（包括 tab-today 多讀一個設定會不會讓 fake DOM 多一行、或 fake-db 多一筆寫入紀錄）。
2. 加 20 分的實作位置與方式：會不會影響過濾、候選、跨時段不重複、低碳、退回 auto（fallback）的邏輯；同分排序；少油習慣 withOilHabit 產生的新物件是否保留 components。
3. 20 分在現有評分各項之間的實際影響：請用程式碼的數字估算（必要時寫一小段 node 腳本在 scratchpad 跑候選池，看常見時段裡第一、二名的分差分佈），判斷會不會出現「常吃組合天天被推」或「加了也幾乎沒效果」，並給具體數據。
4. 第 3 節 Q1–Q5 每題給同意或不同意與理由。
5. check-arch 對 recommend.js 的函式範圍檢查寫法是否可行、會不會誤報或輕易漏掉。
6. 測試設計（尤其合成小候選池那幾條）能否真的抓到「加兩次」「加在過濾」這類錯誤。
7. 漏掉的依賴、會壞掉的呼叫端、commit 拆法能不能讓每個 commit 的 hook 都通過（hook 跑 check-data、check-engine、check-arch --staged、diff-recs，都是看工作目錄）。

輸出格式：先一句結論（「改完可以開工」「要大改」等），然後分「必須改（M）」「建議改（S）」「問題回答（Q1–Q5）」「其他觀察」，每條附檔案與行號證據。不要修改 repo 裡的任何檔案，只回報（scratchpad 可以寫臨時腳本）。
```

## 第一輪：審核回覆（逐字）

## D6 計畫審核（推薦評分，C3）

**結論：改完可以開工。** 架構和接法都對，不用大改。但有三件事要先改：
- Q2 的理由跟實測數據相反。
- 「會不會進推薦」的判斷漏了 23 個品項。
- 抓「加兩次」的那條測試其實抓不到。

repo 裡我沒有改任何檔案。模擬用的腳本放在 scratchpad：recommend.mjs／today.mjs 是照計畫改過的複本，另外有 sim.mjs、sim2.mjs、sim3.mjs、gap.mjs。

---

### 必須改（M）

**M1　Q2「不會天天同一組」的說法要改寫，手機短清單的預期也要改**

這句話只對「同一個組合」成立，對「同一個品項」不成立。

先看分差。用現有評分跑基準設定：P.M、各時段預算 474／711／711、蛋白質缺口 144、纖維缺口 2.5、預設各餐來源。21 天裡每天每個時段第一名減第二名的分差：

| 時段 | 中位數 | 第 90 百分位 | 最大 |
|---|---|---|---|
| 早餐 | 0.16 | 0.40 | 0.54 |
| 午餐 | 0 | 0.07 | 0.10 |
| 晚餐 | 0 | 0 | 0 |

第 1 名到第 10 名也只差 1～3 分。所以 20 分是決勝分差的 40 倍以上，加了就幾乎一定會被選到。

再看 21 天模擬。模擬時照 `markRecipesShown` 的規則累計回饋，標一個常吃，看它出現在幾天：
- **超商品項**：27 個裡有 26 個是 21／21 天都出現，平均輪替約 15 個不同組合。#81 擔心的「同一個組合隔天重複」確實沒發生，因為昨天那組會被扣 40 分；但同一個品項換別的組合繼續上，所以等於每天那一餐都有它。
- **單一超商主餐**：午餐含它的天數從 5／28 變成 28／28。
- **標 3 個超商主餐**：午餐 28／28 天都含其中一個。在那個時段，實際效果已經接近 #81 否決的「只推常吃」。
- **內建食材（37 個）**：平均從 1.7 天變 9.6 天（21 天裡），中等效果。
- **台式外食與宅配**：預設各餐來源下是 0 天。原因是早午餐預設超商、晚餐預設自己煮，它們被來源過濾掉了。各餐都改成「自動」時，台式從 0.1 天變 4.6 天；它們的纖維是 null，拿不到最多 50 分的纖維加分，所以基本分本來就差 25～50 分。

不推翻 20 分（照「定案照做」）。但要做到：
- 第 3 節 Q2 的理由改成實際數據。
- decisions #128 不能寫進錯的理由。
- 手機短清單的預期，從「比較常出現（不保證每次）」改成「超商品項通常每天那一餐都會有它，組合會換」。
- 把這組數據記進 `docs/日後討論.md`，上線後讓使用者確認。

另外看到一件現有的問題，跟本切片無關：糙米飯在不加任何常吃時就已經 28／28 天都在晚餐。原因是主食不在近期降權裡，可以一起記進日後討論。

**M2　Q3 的 `canBeRecommended` 判斷範圍不對，會寫出不實文字**

計畫的寫法是「productsByUid 有、kcal 不是 null」。實測 104 個有熱量的內建品項裡，有 23 個不在候選池：
- 12 個台式主餐：熱量區間太寬（`pool.js:227` 的 `isTooWideRange`）。
- 11 個含糖飲料或甜點：`pool.js:229` 的 `is_treat`。

這 23 個會被寫成「今日建議會優先」，但它們永遠不會被推薦。

建議改成直接從 `buildCandidatePool(catalog)` 收集所有組合的 `components`，做成集合，用 WeakMap 依 catalog 快取一次，以候選池為唯一來源（C2）：
- engine 之間互相 import 是允許的（`check-arch.js` 的 allowed 表）。
- 候選池本身就依 catalog 快取（`pool.js:216`）。
- 37 個對得到內建食材的分層品項，實測全都在候選池裡。

`foods.js` 不會因此碰到 `foodTree` 的限制，C4.17 ③ 只管 pool／recommend／today／matcher。

**M3　合成小候選池的「加兩次」測試抓不到錯**

計畫的設計是 A 喜歡（+40）、B 兩個成分都是常吃。
- 正確實作：B＝20，選 A。
- 錯誤實作加兩次：B＝40，跟 A 同分，同分時依 id 也選 A。

兩種結果一樣，測試分辨不出來（計畫第 42 行自己的推論有誤）。

改成「夾住 20 分」的寫法：
- 用現成品項組合，不會縮放。把蛋白質缺口、纖維缺口都設 0，只留熱量貼近度。
- 讓 B 因熱量偏離被扣 19 分：預算 500，B 熱量約 362.3。B 標常吃後要選 B。
- 再讓 B 被扣 21 分：B 要輸給 A，證明加分小於 21。
- 「被扣 21 分的 B 兩個成分都標常吃，仍選 A」，這一條才抓得到加兩次。
- 同一組也抓得到「只推常吃」寫成過濾的錯：那種寫法在扣 21 分的情況會選 B。

**M4　diff-recs 要改 `todayScenario`，而且新增的行會進兩個快照檔**

- `todayScenario` 目前的 `setDb` 不帶 settings（`diff-recs.js:249-252`），要加 `settings: s.settings`。既有情境傳 undefined，`adapter-v2.js:89` 會當成 `{}`，所以不會變。
- 每個新情境除了寫進 recs.txt，也會透過 `takeDom` 寫進 **ui.txt**（`diff-recs.js:262`）。計畫只寫了 recs.txt。
- 比對是看 key 的，新增的行算差異（`diff-recs.js:976`），所以加情境的那個 commit 要一起跑 `--update`。驗收要確認兩個檔都只有「+」行。

---

### 建議改（S）

1. **`dislikeNotesHtml(s, uid)` 的呼叫端有兩個**：`list.js:75`（內建品項）和 `tree.js:35`（分層品項）。第 6 節只寫了 list 那邊。建議在 `dislikeNotesHtml` 裡用 uid 從 `s.catalog` 查出品項，不改它的參數。
2. **新簽名要容許不傳參數**：`check-engine.js:894` 呼叫 `fd.favoriteEffectText()` 不帶參數，`check-engine.js:77` 的 catalog 也沒有 foodTree。`canBeRecommended(undefined, undefined)` 要回 false、不能拋錯，這樣 feat 那個 commit 自己的樹才會一致。
3. **check-arch 的寫法收緊**：
   - 「同一行含 `score(`」改成正規式 `\bscore\([^;]*,\s*o\.favoriteRefs\)`，並要求區間外剛好出現 1 次。否則同一行裡的 `o.favoriteRefs.filter(...)` 會漏掉，`rescore(` 這種名字也會誤中。
   - 找不到 `function score(` 時直接報錯。
   - 判斷寫成吃原始碼字串的純函式，自我檢查才測得到。
   - 現在 `score` 的結尾確實是行首的 `}`（`recommend.js` 第 87 行附近）。
4. **`m.favoritesChanged` 的重置**：要在 `openMealPicker` 跟 `dislikedChanged` 一起歸零（`index.js:162`），`closePicker` 呼叫後也要歸零。
5. **smoke 第 13 項證明不了什麼**：切到今日建議分頁本來就一律重算（`tab-today.js:398`），所以「stale 標記消失」不能證明推薦有讀常吃。依 M1 的數據，超商品項標常吃後幾乎一定上卡片，建議直接斷言那一餐的卡片含這個品項。
6. **walkthrough 11-1 要改，不只是加**：`mobile-walkthrough.mjs:1329` 斷言了「常吃只影響自己選的排列。」，那一筆是超商品項，改完會失敗。
7. **明細與訊息的文字**：依 M1 的台式數據，建議把「依你設定的各餐來源」寫進句子（例如「今日建議會優先考慮含它的組合（依你設定的各餐來源）」），不然預設設定下標台式品項會覺得沒作用。另外：
   - 已隱藏的內建品項在搜尋裡也有常吃按鈕，但推薦會用 `withoutHidden` 濾掉。判斷時應該把隱藏清單算成「不會推薦」。
   - 被過敏原或飲食擋掉的品項維持「會優先」可以接受，但要在計畫裡寫明。
8. **diff-recs 多加兩個情境**：一個是晚餐自己煮、標一個食材常吃（走自組食譜那條路）；一個是「標常吃＋昨天顯示過」（`fb-shownYesterday`），讓輪替現象留在快照裡。
9. **效能沒問題**：`score` 裡每個組合大約做 4 次 `indexOf`。即使常吃有 100 項，一個時段約 74 萬次比對，可以接受，不用為此放寬 check-arch。

---

### 問題回答（Q1–Q5）

- **Q1 同意**，比對 `components` 全部。現在能標常吃的入口：「我的食物」的內建分層品項只有蛋白質 11、主食 7、蔬菜 19 這三個軸（實測），選擇器只標商品。所以「醬料沒有入口」屬實；`pool.js:119` 的醬料 id 在裡面也不會出錯。
- **Q2 數字同意（已定案），理由不同意**，見 M1。
- **Q3 範圍的方向同意，判斷方式不同意**，見 M2 和 S7。
- **Q4 同意不標**。符合 PRD 6.1，而且依 M1，標了反而會讓人以為「每天都推它」是在評判。
- **Q5 同意**，但要補 S4 的重置。重算會讓新推薦也被記成今天顯示過，跟現在標不吃之後重算的行為一樣，可以接受。

---

### 其他觀察（驗證過的說法）

計畫第 1 節和第 6 節，下面這些都屬實：
- `score` 的計分順序與各項係數，在 `recommend.js:69-88`。
- `components` 在 `pool.js:119`（自組食譜）和 `pool.js:161`（現成品項）。
- `fx_` 開頭的分層品項和 `custom_` 我的品項都不在候選池。
- `today.js:27-41` 把設定原封傳下去。
- tab-today 還沒 import `getFavoriteRefs`。
- `closePicker` 和 `setFavoriteInPicker` 的行為描述正確（`index.js:527-543`、`1084-1092`）。
- check-engine 直接呼叫的位置在 84、369、431、1277、1730 行。
- recs.txt 是 524 行。

**問題 1「空清單逐字不變」成立：**
- fake-db 的 `getFavoriteRefs` 只讀不寫，不會多一筆寫入紀錄（`fake-db.mjs:113-116`）。
- tab-today 多讀一個設定不碰 DOM，`renderHero` 和 `markRecipesShown` 的先後順序也不變。
- diff-recs 的 matrix 走 `recommendRaw`，不傳常吃（`adapter-v2.js:121-128`）。
- `snapFavorites` 只開選擇器，不跑今日建議頁。

**問題 2「加分的位置」沒問題：**
- 加在 `score` 裡，就不會碰到過濾、倒讚、跨時段不重複、低碳、退回 auto（fallback）。這些都在 `score` 之前。
- 標了不吃的成分，組合已經在 `findDislikedHit` 用同一批 id 擋掉（`filters.js:105-127`）。
- 少油習慣 `withOilHabit` 用 `Object.assign({}, c, …)` 產生新物件，會保留 `components`（`meal-content.js:122`）。
- 同分時依 id 排序的規則不變。

**commit 拆法可行：**
- hook 用的是工作目錄，`check-arch --staged` 只檢查改到 js/ 時有沒有換版本字串。feat 那個 commit 已經包含 `index.html` 的 stamp。
- 依 S2，feat 那個 commit 自己的樹也過得了既有的 check-engine。
- diff-recs 的新情境和 `--update` 要放在 test 那個 commit（M4）。

**現有評分的結構性問題（本切片範圍外，建議記錄）：**
- 纖維加分最多 50 分、蛋白質加分最多 12.5 分，遠大於各候選之間的分差。所以推薦實際上是由「有沒有纖維、蛋白質資料」和「近期降權」在決定。
- 這也是台式外食幾乎不會出現、主食天天一樣的根本原因。

## Opus（主 session）的處理

M1–M4、S1–S9 全收，對照在計畫第二版第 7 節。抽驗：主 session 重跑審核者的 `gap.mjs`（scratchpad），早、午、晚第一名與各來源最佳組合的分差與審核所述一致（各時段前幾名只差不到 1 分）；`pool.js:223-230` 的 `isTooWideRange`、`is_treat` 確實把台式部分品項排除在候選池外。M1 的「+20 實際效果接近只推常吃」屬產品層面的新事實：照「定案照做」維持 #81 的 20 分，數據記進 `docs/日後討論.md`，並告知使用者、讓使用者決定要不要開工前重議。

送出的問題比上面逐字稿多一句：最後附上 scratchpad 路徑（C:\Users\Max\AppData\Local\Temp\claude\d--ok-lighten\7a47143d-fcec-4955-9e60-f22aca877ead\scratchpad）。

