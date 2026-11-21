# 任務書：輕盈計畫可安裝到手機（PWA）— v2026-11-21

工作目錄：`D:/ok/lighten`（直接在主目錄做；此時沒有其他人改程式）。禁止 stash／reset／checkout／push；只 `git add` 自己動到的檔案。

## 背景
App 放在 GitHub Pages 子路徑（`https://<帳號>.github.io/Lighten2/`），**所有路徑一律相對**（`./`、不准用 `/` 開頭）。
目前沒有 manifest、沒有 service worker，手機只能「加到主畫面」當捷徑。目標：Android Chrome 可「安裝應用程式」、iPhone Safari「加入主畫面」後全螢幕開啟、有圖示、離線能打開上次載入過的版本。

## 要讀的檔案（只准讀這些）
- `index.html` 第 1–25 行（head）與最後 30 行
- `tools/lib/browser-harness.mjs`（整份，做圖示要用它開無頭瀏覽器截圖）
- `tools/stamp-version.js`（只看它改哪些字串，確認不會碰到你的新檔）
- `js/ui/help.js`：用 Grep 找「基本資料」那頁說明的區塊，只讀那段前後 40 行
- `tools/check-arch.js`：只在它報錯時讀相關段落

## 要做的事（框架已定，不准改設計）

### 1. 圖示：`tools/build-icons.mjs`（新）＋ `images/icons/*.png`（產出）
- 用 `startHarness()` 開瀏覽器，`Emulation.setDeviceMetricsOverride` 設尺寸，載入一段 data URL 的 HTML（內嵌 SVG），`Page.captureScreenshot` 存 PNG。
- 設計：滿版圓角正方形底色 `#12263A`，正中白色粗體「輕」字（字型用系統 sans-serif，字高約 55%）。maskable 版不要圓角、字縮到 45%（安全區）。
- 產出 4 張：`icon-192.png`（192）、`icon-512.png`（512）、`icon-maskable-512.png`（512）、`apple-touch-icon-180.png`（180，不要圓角，iOS 自己會裁）。
- 腳本可重跑；檔頭註解寫用法。

### 2. `manifest.webmanifest`（新，放根目錄）
```json
{
  "name": "輕盈計畫",
  "short_name": "輕盈計畫",
  "lang": "zh-TW",
  "start_url": "./",
  "scope": "./",
  "display": "standalone",
  "background_color": "#EEF1EC",
  "theme_color": "#12263A",
  "icons": [
    { "src": "images/icons/icon-192.png", "sizes": "192x192", "type": "image/png" },
    { "src": "images/icons/icon-512.png", "sizes": "512x512", "type": "image/png" },
    { "src": "images/icons/icon-maskable-512.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable" }
  ]
}
```

### 3. `sw.js`（新，放根目錄）＋ `index.html` 註冊
`sw.js` 行為固定如下（network-first，避免版本字串更新後吃到舊檔）：
- `const CACHE = "lighten2-shell-v1";`
- install：`cache.addAll(["./", "./index.html", "./manifest.webmanifest", "./images/icons/icon-192.png"])`，然後 `self.skipWaiting()`。
- activate：刪掉名稱不是 `CACHE` 的快取，`self.clients.claim()`。
- fetch：只處理 `GET` 且 `new URL(req.url).origin === self.location.origin`，其他直接不攔（不呼叫 respondWith）。處理方式：先 `fetch(req)`，`res.ok` 就 `cache.put(req, res.clone())` 再回傳；網路失敗就 `caches.match(req)`；仍沒有且 `req.mode === "navigate"` 就回 `caches.match("./index.html")`。
- 不快取 Google Fonts 等外部網域。

`index.html`：
- head 加：`<link rel="manifest" href="manifest.webmanifest" />`、`<meta name="theme-color" content="#12263A" />`、`<link rel="apple-touch-icon" href="images/icons/apple-touch-icon-180.png" />`、`<meta name="apple-mobile-web-app-capable" content="yes" />`、`<meta name="apple-mobile-web-app-title" content="輕盈計畫" />`。
- `</body>` 前加一段小的 inline script：`if ("serviceWorker" in navigator) { window.addEventListener("load", function () { navigator.serviceWorker.register("./sw.js").catch(function () {}); }); }`
- 若 check-arch 的規則（例如 C1.3 不掛 window）擋到 inline script，**停下回報**，不要自己改規則。

### 4. 說明：`js/ui/help.js` 基本資料頁說明加一小段「裝到手機」
- Android（Chrome）：右上角選單 →「安裝應用程式」或「加到主畫面」。
- iPhone（Safari）：下方分享鈕 →「加入主畫面」。
- 再加一句：「資料存在這支手機裡，記得定期用備份。」
- 文字不准出現評判字眼（章程 C4.13，check-arch 會查）。

## 不准做的事
- 不改 `js/engine`、`js/data`、`data/`、`css/`。不改 check 工具的規則。不加 npm 套件。
- 暫存檔只能放 `D:/ok/lighten/collab/tmp-sonnet/`，結束前刪掉。
- 不確定就停下回報（每個任務最多停下問 2 次）。

## PROOF_CMD（全部要過）
```
cd D:/ok/lighten && node tools/build-icons.mjs && node -e "JSON.parse(require('fs').readFileSync('manifest.webmanifest','utf8'));console.log('manifest ok')" && ls images/icons && node tools/stamp-version.js && node tools/check-arch.js && node tools/check-engine.js | tail -1 && node tools/smoke-browser.mjs | tail -3
```
預期：`manifest ok`；`images/icons` 列出 4 張 png；check-arch「全部通過」；check-engine「全部通過」；smoke-browser 全部通過、console 無錯誤。

## 完成後
- 一個 commit：`feat(pwa): 可安裝到手機（manifest、service worker、圖示）`，結尾加 `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`。commit 前確認 `git config user.email` 是 `300864627+tongxiaooppo-boop@users.noreply.github.com`，不是就停下。
- 回報（精簡，不貼程式碼）：commit hash、PROOF_CMD 各段結果、圖示 4 張的尺寸（用 harness 或檔頭讀）、需要決定的事。
