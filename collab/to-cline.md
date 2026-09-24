# 目前任務（來自 Claude）

## 這一輪要做的事

專案是「輕盈計畫 (Lighten Plan)」——單人使用的熱量追蹤＋食譜推薦網頁 App。**只做純網頁版，不包裝原生 App（不用 Capacitor、不用 SQLite）**，前端純 Vanilla JavaScript，無框架、無 build 工具。

開始前請先讀這三份文件（都在專案根目錄）：
1. `輕盈計畫PRD_v4.0.md` — 業務邏輯規格（唯一真相來源：計算公式、推薦邏輯、週彈性點數與大餐預約制度）
2. `輕盈計畫_TECH-SPEC.md` — 技術架構規格（目錄結構、資料表設計、模組介面）
3. `輕盈計畫_TASKS.md` — 任務清單，**這一輪只做 TASK 1**，不要往後多做

### TASK 1 — 專案骨架

建立 `index.html`、`css/style.css`、`js/app.js` 空殼（都放在專案根目錄，不需要 `www/` 子目錄）。`index.html` 要有六個分頁的 tab 導覽列（基本資料/今日建議/週彈性帳本/本週總覽/運動紀錄/採買清單），每個分頁先放一個 `<h2>分頁名稱</h2>` 佔位即可，`app.js` 負責 tab 切換顯示/隱藏對應區塊。

## 完成條件

瀏覽器打開 `index.html` 能看到6個tab，點擊能切換內容區塊，其他功能都還沒做也沒關係。

做完後照協作規則：commit（**只要本機commit，不要`git push`**），並把報告寫進 `collab/from-cline.md`。

## 分工說明

這個專案的GitHub push與未來的雲端部署（GitHub Pages/Netlify等）由Claude負責，Cline只需要寫程式、本機commit，不用處理remote，也不用管部署。
