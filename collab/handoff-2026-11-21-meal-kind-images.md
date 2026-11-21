# 交接：推薦卡片依餐點種類換插圖（2026-11-21，已完成）

## 狀態
- **已上線**：框架 `ad0b530`＋UI、檢查、27 張圖（本檔所在 commit），已 push。
- 決策紀錄 #161（種類 9 種、三種風格 27 張、下午茶／宵夜／已記錄照舊用時段圖）。
- 驗收（Opus 親自跑）：PROOF_CMD 27 行皆 960x536 ≤79KB；check-arch 過；check-engine 全過（含 `[推薦插圖種類]`）；smoke-browser 54 全過；mobile-walkthrough 690 全過（白名單加了 `images/skins/<風格>/kind-*.jpg`）；看過 sport 晚餐卡片、classic 早餐卡片截圖。
- Opus 逐張看圖：中西式一眼分得出、未見文字／品牌／人臉；pastel 每張都有飯糰角色。

## 待辦
1. ~~sport/kind-cook-plate.jpg 重做~~：已完成（Codex 重產，深藍滿版＋斜線，960x536 47KB，Opus 看過圖），回報 `collab/from-codex-kind-images-fix.md`。
2. PWA 手機實裝回報（全螢幕、圖示）仍待使用者。

## 相關檔案
- `js/engine/meal-kind.js`（種類判斷）、`js/ui/skin.js` `mealImage`、`js/ui/tab-today.js`。
- 任務書：`collab/to-codex-kind-images.md`、`collab/to-codex-kind-images-fix.md`、`collab/to-sonnet-kind-images.md`、`collab/to-sonnet-pwa.md`；回報 `collab/from-codex-kind-images.md`。
