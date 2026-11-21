# 交接：外觀風格切換（2026-11-21，decisions #160）

## 完成
- 三種風格：運動活力（預設）、療癒粉彩、經典暖色；基本資料分頁「外觀風格」選單切換，存 `localStorage` `lighten2.skin`（只限這台裝置，不進備份）。
- `css/style.css` 顏色全部變數化（`:root`），`css/skin-sport.css`、`css/skin-pastel.css` 覆寫變數加裝飾。
- 今日建議頂部卡：已吃比例圓環、本週熱量長條（運動）；飯糰角色＋一句話（粉彩）。資料在 `js/engine/hero-deco.js`。照章程 C4.13 中性版：不顯示達標、不評論吃多吃少。
- 插圖：`images/skins/sport/`、`images/skins/pastel/`（各 5 張時段插圖），飯糰 4 種表情 `mascot-{hi,ok,happy,cheer}.png`。經典沿用 `images/gemini/`。
- 示意圖 `collab/skins/mockup.html`；任務書 `collab/to-codex.md`、`collab/to-codex-images.md`；回報 `collab/from-codex.md`、`collab/from-codex-images.md`。

## 驗收後 Opus 修的
- 運動風分頁排 3×2（原本「食譜」單獨掉到第二行）。
- `#today-hero-kcal-value` 補 class，經典風格的大數字樣式原本一直沒生效（既有問題）。
- `heroMessage`：份額已是負的判斷排在「還沒記」前面，不會出現「還能吃 -50 大卡」；check-engine 加一條。

## 歷史註記
- a445738 單獨檢出時經典風格沒有顏色（漏了 `:root`），f238740 補上；不改寫歷史。

## 待使用者手機確認
- 三種風格切換、今日建議頂部卡、各分頁配色是否順眼。
- 使用說明（docs/使用說明.html）還沒提到外觀風格。
