# 任務書：外觀風格切換（運動活力／療癒粉彩／經典暖色）（v2026-11-21）

給：Codex（VS Code 面板）。依據 decisions #160。框架（函式名稱、參數、回傳格式、常數）已由 Opus commit，**不准改**；覺得框架有問題就停下，照文末「提問格式」寫進回報。

## 要讀的檔案（只准讀這些，大檔照範圍）

1. `docs/decisions.md` 最後一列（#160）
2. `collab/skins/mockup.html`：只看 `/* 2 運動活力 */` 與 `/* 5 療癒粉彩 */` 兩段 CSS、`phone()` 產生的 HTML 結構
3. `css/style.css`（全檔，第 1 步要改）
4. `index.html` 第 1–30 行、第 170–190 行（基本資料表單結尾）、第 244–306 行（今日建議）、第 440–515 行（import map）
5. `js/engine/hero-deco.js`、`js/ui/skin.js`、`js/core/config.js` 最後 6 行（框架，照註解填）
6. `js/ui/today-hero.js`（全檔）
7. `js/ui/tab-today.js` 第 1–40 行、第 60–75 行、第 235–275 行、第 375–430 行
8. `js/ui/tab-profile.js`（只找 init 函式）、`js/ui/app.js`
9. `tools/check-engine.js`：找現有 `isCompleteLogDay`／`computeRecentAvgVsTarget` 測試，照它造紀錄的寫法
10. `tools/mobile-walkthrough.mjs` 第 1–60 行與結尾

## 第 1 步：顏色改成 CSS 變數（畫面一點都不能變）→ commit

在 `css/style.css` 最上面加 `:root { … }`，把下面這些寫死的顏色換成變數。值就是現在的值（＝經典暖色）。

| 變數 | 值 | 合併進來的相近色（換成同一個變數） |
|---|---|---|
| `--c-bg` | `#FBF5ED` | `#FBF5EC` `#FBF6EC` |
| `--c-surface` | `#FFFFFF` | `#FFF` `#FFFDF8` `#FFFBF6` |
| `--c-surface-warm` | `#FFFBF5` | |
| `--c-ink` | `#3A2E22` | |
| `--c-ink-2` | `#5A4C3A` | `#5C4D3C` `#6B5B45` |
| `--c-muted` | `#8A7A63` | `#A8997F` |
| `--c-line` | `#EFE3D2` | `#EFE4D0` `#E8DCCB` `#E8DCC8` `#E5D5BE` |
| `--c-line-soft` | `#F3EADF` | `#E8E0D4` |
| `--c-line-strong` | `#E0D3BF` | `#D9CBB2` |
| `--c-accent` | `#C1652F` | |
| `--c-accent-strong` | `#9E4F24` | |
| `--c-accent-soft` | `#F3E4D0` | |
| `--c-accent-tint` | `#FBF0E6` | |
| `--c-accent-line` | `#E0B98C` | |
| `--c-accent-ink` | `#8A5A2B` | |
| `--c-on-accent` | `#FFFFFF` | 只用在橘底上的白字 |
| `--c-warn-ink` | `#9A5B00` | |
| `--c-danger` | `#AA3333` | `#a33` |
| `--c-danger-line` | `#D0A0A0` | |
| `--c-danger-tint` | `#FBF0F0` | |
| `--c-shadow` | `rgba(120, 85, 40, 0.08)` | `rgba(150, 110, 60, 0.08)` |
| `--c-shadow-strong` | `rgba(60, 40, 20, 0.25)` | |
| `--c-overlay` | `rgba(58, 46, 34, 0.45)` | |
| `--font-body` | 現在 body 的字型堆疊 | |
| `--font-display` | `"Noto Serif TC", serif` | |
| `--radius-card` | 現在 `.rec-card` 的圓角 | 其他卡片若同值也用它 |
| `--radius-btn` | `999px` | 只用在現在就是 999px 的地方 |

- 表上沒有的顏色：歸到最接近的變數，並列在回報的「另外歸併」欄。
- 註解裡的 `#140` 這類決策編號不是顏色，不要動。
- 驗收：上面表格以外不准有寫死的顏色（見 PROOF_CMD 第 1 條），`mobile-walkthrough` 截圖跟改之前看起來一樣。

## 第 2 步：風格切換與兩套外觀 → commit

1. **`index.html` `<head>`**：
   - 在 stylesheet 之前加行內小程式：讀 `localStorage.getItem("lighten2.skin")`，值是 `sport`／`pastel`／`classic` 之一就用它，否則 `sport`，設成 `document.documentElement.dataset.skin`；整段包 try/catch，出錯也設 `sport`。
   - Google Fonts 加 `Oswald:wght@500;700`、`Noto+Sans+TC:wght@700;900`、`Huninn`（併進現有那條 `fonts.googleapis.com` 連結）。
   - `css/style.css` 後面加 `css/skin-sport.css`、`css/skin-pastel.css`（版本字串比照 style.css）。
2. **`css/skin-sport.css`**：全部寫在 `html[data-skin="sport"]` 底下。先覆寫第 1 步的變數，再照 mockup 第 2 段做裝飾。**`css/skin-pastel.css`**：同理用 `html[data-skin="pastel"]`，照 mockup 第 5 段。mockup 的 class 對到 app：

   | mockup | app |
   |---|---|
   | `.ah` `.ah h1` | `.app-header` `.app-header h1` |
   | `.tabs` `.tab` `.tab.on` | `.tab-nav` `.tab-btn` `.tab-btn.is-active` |
   | `.hero` `.hl` | `.today-hero` `.today-hero-label` |
   | `.hk b` `.hk small` | `#today-hero-kcal-value` `.today-hero-kcal-unit` |
   | `.st` `.sl` `.sv` | `.today-hero-stat` `.today-hero-stat-label` `.today-hero-stat-value` |
   | `.card` `.card h3` | `.rec-card` `.rec-card h3` |
   | `.b.p` | `.primary-btn`、`.secondary-btn` |
   | `.b.n` | `.undo-btn`、`.dislike-btn` |

   - 運動的 `.card h3::after` 英文小字：在 CSS 用 `:nth-child` 不可靠，改成在 `index.html` 的五個 `.rec-card h3` 加 `data-en`（BREAKFAST、LUNCH、TEA、DINNER、LATE SNACK）。
   - 運動頁首的「DAY 23 · 連續紀錄」**不做**。
   - mockup 沒畫到的地方（表單、本週總覽、選擇器視窗）只靠變數換色，不另外加裝飾。
   - 按鈕高度不得低於現在（walkthrough 會量 44px）。
3. **`js/ui/skin.js`**：照註解填五個函式。`js/ui/app.js` 最前面呼叫 `initSkinPicker()`。
4. **基本資料分頁**：`</form>`（第 186 行那個）後面加：
   ```html
   <section id="skin-picker" class="skin-picker">
     <h3>外觀風格</h3>
     <label><input type="radio" name="skin" value="sport"> 運動活力</label>
     <label><input type="radio" name="skin" value="pastel"> 療癒粉彩</label>
     <label><input type="radio" name="skin" value="classic"> 經典暖色</label>
     <p class="skin-picker-note">只影響這台裝置，選了馬上換。</p>
   </section>
   ```
   radio 的觸控區（label）高度 ≥ 44px。
5. **時段插畫**：`tab-today.js` 刪掉 `MEAL_DEFAULT_IMAGE`，兩處取圖改用 `slotImage(slot, currentSkin())`；監聽 `skin:changed`，觸發時重畫今日建議（用現有的重畫函式，不新寫流程）。圖檔可能還沒產好（另一個任務在做）：**不准**為此加備援邏輯，缺圖就讓它缺，回報裡註明。

## 第 3 步：頂部卡三個新元件 → commit

1. **`js/engine/hero-deco.js`**：照註解填三個函式。
2. **`tools/check-engine.js`** 加測試（名稱照寫，預期值不准改）。紀錄照現有 `isCompleteLogDay` 測試的寫法造；enabledSlots 用「只開早餐、午餐、晚餐」；目標 1800（達標範圍 1530～1890）；today＝`2026-11-19`（週四）。

   | 測試名稱 | 輸入 | 預期 |
   |---|---|---|
   | `eatenPct 一般` | (412, 1778) | 23 |
   | `eatenPct 零` | (0, 1778) | 0 |
   | `eatenPct 超過` | (2000, 1778) | 112 |
   | `eatenPct 目標無效` | (500, 0) | null |
   | `weekTargetDays 七天狀態` | 一 11/16 三餐 1700；二 11/17 三餐 1900；三 11/18 只記早午；四（今天）只記早餐 | states＝`["hit","over","incomplete","today","future","future","future"]`，hits＝1 |
   | `weekTargetDays 吃太少` | 一 三餐 1400，其他沒記 | days[0].state＝`"low"`，hits＝0 |
   | `weekTargetDays 邊界` | 一 三餐 1530；二 三餐 1890 | 兩天都 `"hit"`，hits＝2 |
   | `weekTargetDays 今天記完` | 四（今天）三餐 1800 | days[3].state＝`"hit"` |
   | `weekTargetDays 目標無效` | 一 三餐 1700，目標 0 | days[0].state＝`"incomplete"`，hits＝0 |
   | `heroMessage 還沒記` | loggedCount 0, remaining 1366.4 | `{ text: "今天還能吃 1366 大卡，慢慢來", mood: "hi" }` |
   | `heroMessage 進行中` | loggedCount 1, remaining 954 | `{ text: "還能吃 954 大卡喔", mood: "ok" }` |
   | `heroMessage 份額用完` | loggedCount 2, allLogged false, remaining -50 | mood `"cheer"`，text「今天的份額用完了，下一餐清淡一點」 |
   | `heroMessage 記完達標` | allLogged, eaten 1750, target 1800 | mood `"happy"` |
   | `heroMessage 記完超標` | allLogged, eaten 1950, target 1800 | mood `"cheer"`，text「多一點點沒關係，明天再調整」 |
   | `heroMessage 記完太少` | allLogged, eaten 1300, target 1800 | mood `"ok"`，text「今天吃得有點少，記得吃飽喔」 |

3. **`index.html` 今日建議**：
   - `#today-hero` 裡最前面加：
     ```html
     <p class="hero-bubble" id="today-hero-bubble"></p>
     <img class="hero-mascot" id="today-hero-mascot" alt="" aria-hidden="true">
     <div class="hero-ring" id="today-hero-ring" aria-hidden="true"><span id="today-hero-ring-pct">0%</span><small>已吃</small></div>
     ```
   - `#today-hero` 這個 section 結束後、`.today-toolbar` 之前加 `<div id="today-streak" class="today-streak" hidden></div>`。
4. **`js/ui/today-hero.js`**：`renderHero` 加第 10 個參數 `weekLogs`（`tab-today.js` 第 425 行把已經讀好的 `weekLogs` 傳進去）。在現有算完主數字之後：
   - 圓環：`eatenPct(logsKcal(todayLogs), targets.targetKcal)`；`#today-hero-ring` 設 `style.setProperty("--pct", Math.min(pct, 100))`，文字 `pct + "%"`；null 時文字 `—`、`--pct` 0。
   - 對話：`heroMessage({ loggedCount: 今天有記錄的時段數, allLogged, remainingKcal: remainingBudget.remainingKcal, eatenKcal: logsKcal(todayLogs), targetKcal: targets.targetKcal })` → `#today-hero-bubble` 的文字、`#today-hero-mascot` 的 src＝`mascotImage(mood)`、alt 空字串。
   - 達標格：`weekTargetDays(weekLogs, targets.targetKcal, profile.enabled_slots, today)` → `#today-streak` 的 innerHTML：`<span class="streak-label">本週達標</span>`＋7 個 `<i class="streak-day is-<state>" title="週一 達標"></i>`（state 中文：hit 達標、low 吃太少、over 超標、incomplete 沒記完、today 今天、future 還沒到）＋`<b class="streak-count">N/7</b>`。跟 `hero.hidden` 一起顯示與隱藏（含 `setHeroSuppressed` 的情況）。
5. **顯示規則（CSS）**：`style.css` 預設 `.hero-bubble, .hero-mascot, .hero-ring, .today-streak { display: none }`；
   - 運動：顯示 `.hero-ring`（mockup 的 `.ring`，用 `conic-gradient(var(--c-accent) calc(var(--pct) * 1%), …)`）與 `.today-streak:not([hidden])`（mockup 的 `.streak`；hit 螢光綠、over 珊瑚、low `#F2C94C`、incomplete／future 半透明白、today 螢光綠外框）。
   - 粉彩：顯示 `.hero-bubble`（黃色對話框，放在頂部卡最上面，右側讓出角色的位置）與 `.hero-mascot`（右上角約 76px）。
   - 經典：三個都不顯示。
6. **`tools/mobile-walkthrough.mjs`**：
   - 圖片白名單（第 45 行）改成也接受 `images/skins/(sport|pastel)/meal-[a-z-]+\.jpg` 與 `images/skins/pastel/mascot-(hi|ok|happy|cheer)\.png`。
   - 結尾加：切到粉彩、截今日建議一張；切到經典、截一張（用 `setSkin` 或直接設 dataset 加 localStorage，自選）。
7. 快照：`node tools/diff-recs.js` 若因頂部卡多了元素而失敗，確認差異只有新加的元素後才跑 `--update`，在回報寫差異摘要。

## 不准做的事

- 不改 `hero-deco.js`、`skin.js` 的函式名稱、參數、回傳格式，不改 `config.js` 的兩個常數。
- 不新增 IndexedDB 設定、不把風格寫進備份。
- 不新增函式庫；字型只加上面列的三個。
- 不動 `images/`（產圖是另一個任務）。
- 暫存檔、一次性腳本只放 `collab/skins/tmp/`，結束前刪掉。
- 不用 `--no-verify`、不 stash／reset／checkout 別人的檔；每步只 add 自己改的檔。
- 不要用網路搜尋或網頁抓取。

## PROOF_CMD（Git Bash，在 repo 根目錄）

```bash
grep -nE '#[0-9A-Fa-f]{3}([0-9A-Fa-f]{3})?\b|rgba?\(' css/style.css | grep -v '^[0-9]*: *--' | grep -v 'decisions\|/\*' ; echo "---"; \
node tools/check-engine.js | tail -1 && node tools/check-arch.js | tail -1 && node tools/diff-recs.js | tail -1 && node tools/mobile-walkthrough.mjs | tail -3
```

預期：`---` 之前**沒有任何一行**（顏色只出現在 `:root` 的變數定義）；`check-engine`、`check-arch` 都印「全部通過」；`diff-recs` 通過；`mobile-walkthrough` exit 0，沒有溢出與圖片警告（缺圖導致的破圖除外，回報註明）。

## 回報（寫到 `collab/from-codex.md`，欄位照寫，不貼程式碼）

- 完成項：三步各一行
- commit：hash＋訊息，三個
- 測試數字：PROOF_CMD 每條的最後一行原文
- 另外歸併的顏色：`原色 → 變數`，一行一個
- 快照差異摘要
- 截圖路徑（walkthrough 印出的資料夾）
- 需要決定的事：用下面的提問格式；沒有就寫「無」

### 提問格式（最多停下問 2 次）

問題一句話／選項 2–3 個／你的建議／影響範圍。小事（欄名不同但意思明確）自己決定、在回報註明，不用停。
