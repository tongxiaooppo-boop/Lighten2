# 回報：外觀風格切換（v2026-11-21，由 Sonnet 子代理執行）

## 完成項
- 第 1 步：style.css 顏色、字型、圓角全改 CSS 變數（`:root` 的值＝經典暖色）。
- 第 2 步：`data-skin` 切換（head 行內小程式、skin.js 五個函式、基本資料分頁選單）、`skin-sport.css`、`skin-pastel.css`、時段插畫改走 `slotImage`、五張卡 `data-en`、walkthrough 圖片白名單。
- 第 3 步：hero-deco 三函式＋12 個測試、頂部卡圓環／對話／長條（today-hero.js）、各風格顯示規則、walkthrough 結尾截粉彩與經典。

## commit
- a445738 refactor(css): 寫死的顏色改成 CSS 變數，經典暖色值不變（decisions #160 第 1 步）
- e75a935 feat(skin): 外觀風格切換與運動活力、療癒粉彩兩套外觀（decisions #160 第 2 步）
- f238740 feat(skin): 頂部卡圓環、本週熱量長條、飯糰一句話；補上 :root 顏色變數（decisions #160 第 3 步）

注意：a445738 漏了 `:root` 變數區塊（檔案是 CRLF，插入用的字串沒比對到，我當時只驗了「沒有寫死顏色」沒驗 `:root` 存在）。第 2 步的運動、粉彩兩個風格自己把變數全定義了所以看不出來，第 3 步截經典風格時才發現，已在 f238740 補上。所以 a445738 單獨檢出時經典風格會沒有顏色。

## 測試數字（PROOF_CMD 最後一行原文）
- 顏色 grep（`---` 之前）：無任何輸出
- check-engine：`全部通過（共 108429 項檢查）`
- check-arch：`全部通過（共 44934 項檢查）`
- diff-recs：`（v2 adapter，52069 ms）`（無差異行，exit 0）
- mobile-walkthrough：`全部通過（共 690 項檢查）`，exit 0（131 張截圖）

## 另外歸併的顏色
- 表上未列、本次全部都在表內，沒有額外歸併。
- `#fff`／`#ffffff`：`color:` 屬性（橘底白字）→ `--c-on-accent`；其餘（背景）→ `--c-surface`。
- `#AA3333`／`#a33` → `--c-danger`（表內）。

## 快照差異摘要
- 第 2 步：`tools/snapshots/ui.txt` 只有時段插畫路徑從 `images/gemini/meal-default-*.jpg` 變成 `images/skins/sport/meal-*.jpg`（159 行，逐行比對只差路徑）。
- 第 3 步：只多了 5 個新元素（`#today-hero-ring`、`#today-hero-ring-pct`、`#today-hero-bubble`、`#today-hero-mascot`、`#today-streak`，各 50 個情境）；其餘行只有 domNN 編號位移。
- 為此在 `tools/lib/fake-env.js` 假元素加了 `style: { setProperty }`（不加的話 `ring.style.setProperty` 在假 DOM 會丟錯，頂部卡後面的更新全被跳過，快照會少掉 7 個元素）。

## 截圖路徑
`C:\Users\Max\AppData\Local\Temp\lighten-walkthrough`（131 張；130、131 是粉彩與經典的今日建議）

## 小決定（框架沒寫死、自行決定）
- `currentSkin()` 加了防呆：假 DOM 沒有 `document.documentElement` 時回傳預設風格（diff-recs 在 Node 裡跑）。
- `skin:changed` 的重畫呼叫 `buildRecommendation()`（現有的整套重畫函式；切回今日分頁本來就會重算，所以這個監聽實際上多一道保險）。
- 運動風格的圓環顏色用風格內變數 `--sk-hot`（橘紅，照 mockup），不是 `--c-accent`（運動風的 accent 是深藍）。任務書寫 `var(--c-accent)`，若要照字面改成深藍告訴我。
- 粉彩的主色太淺不能當文字色，`.status-text`／營養素明細摘要／`.link-btn` 等用主色當文字的地方，粉彩風格改用 `--c-accent-ink`。
- `heroMessage` 規則 2 照框架字面：還沒記任何一餐但 remaining 為負時會印「今天還能吃 -50 大卡」，框架沒處理，要不要夾成 0 請 Opus 決定。
- `tools/mobile-walkthrough.mjs` 第 127 行的分頁檢查補上「食譜」（第六分頁加上去之後這條就一直是舊的）。
- `#today-hero-kcal-value` 在 HTML 只有 id、沒有 `.today-hero-kcal-value` class，所以 style.css 原本那條大字樣式在經典風格沒生效（既有狀況，沒動）；運動、粉彩風格用 id 選擇器所以有效。
- 圖檔已由另一個任務放進 `images/skins/`，目前沒有缺圖。

## 需要決定的事
無（上面的小決定供參考）。
