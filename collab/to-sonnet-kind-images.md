# 任務書：推薦卡片依餐點種類換插圖 — v2026-11-21（框架 commit ad0b530）

工作目錄：`D:/ok/lighten`（直接在主目錄做）。禁止 stash／reset／checkout／push。**這輪不 commit**（圖片由 Codex 另外產，到齊後 Opus 一起 commit）。

## 背景
使用者：推薦中式就給中式的圖，外食分中西式，自煮合菜跟簡易餐盒分開。種類判斷已由 Opus 寫好，**不准改**：
- `js/engine/meal-kind.js`：`mealImageKey(rec, slot)` 回傳 `MEAL_IMAGE_KEYS` 之一或 `null`；`MEAL_IMAGE_KEYS`（9 個）。
- `js/engine/pool.js`：外食組合有 `cuisine`（"western"／"chinese"），超商與下午茶組合為 `null`。
圖檔路徑：`images/skins/<skin>/kind-<key>.jpg`，skin ＝ sport／pastel／classic（classic 是新資料夾，圖由 Codex 產）。

## 要讀的檔案（只准讀這些）
- `js/engine/meal-kind.js`（整份）
- `js/ui/skin.js`（整份）
- `js/ui/tab-today.js` 第 20–30 行、第 225–245 行
- `tools/check-engine.js` 第 1–100 行（了解 check、itemByUid、candidatePool、imp 的用法），以及檔尾最後一個 section（照它的寫法加新 section）

## 要做的事
1. `js/ui/skin.js` 加 `export function mealImage(rec, slot, skin)`：`const key = mealImageKey(rec, slot)`；有 key → `"images/skins/" + skin + "/kind-" + key + ".jpg"`（classic 也走這個路徑）；沒有 → `slotImage(slot, skin)`。加上簡短註解。
2. `js/ui/tab-today.js` 推薦卡片那處（約第 236 行 `const imgSrc = slotImage(slot, currentSkin());`）改成 `mealImage(rec, slot, currentSkin())`。**已記錄卡片（loggedHtml，約第 63 行）不改**，照舊用時段圖。import 跟著調整。
3. `tools/check-engine.js` 檔尾加 section `[推薦插圖種類]`，檢查（預期值寫死）：
   - 真實候選池（`candidatePool`）：`tw_fw03` 單點在 lunch → `western`；`tw_ln02` 單點 lunch → `chinese`；`tw_dn05` 單點 dinner → `chinese`（日式歸中式）；`tw_bf12` 單點 breakfast → `bf-western`；`tw_bf01` 單點 breakfast → `bf-chinese`；任一 `is_convenience` 且 valid_slots 含 lunch 的組合在 lunch → `convenience`；任一組合在 `afternoon_tea`、`snack` → `null`。
   - 所有 `is_delivery` 且含主餐的組合 `cuisine` 是 "western" 或 "chinese"；所有 `is_convenience` 組合 `cuisine === null`。
   - 自煮用假物件（`mealImageKey` 只讀 `is_cook_form`、`entry`）：home＋lunch → `cook-home`；box＋dinner → `cook-box`；plate＋breakfast → `cook-plate`；bowl＋breakfast → `cook-bowl`；bowl＋afternoon_tea → `null`；home＋breakfast → `null`。
   - 圖檔齊全：sport／pastel／classic × `MEAL_IMAGE_KEYS` 共 27 個檔案都存在（用 `fs.existsSync`）。**寫成一個 check**，訊息列出缺的檔名。
   - 單點組合的 id 就是 uid 本身（例 `tw_fw03`），用 `candidatePool.find(c => c.id === "tw_fw03")` 取。

## 不准做的事
- 不改 `js/engine/`、`data/`、`css/`、`index.html` 以外的版本字串以外的東西；`index.html` 只允許 `node tools/stamp-version.js` 改的版本字串。
- 不改 check 工具既有規則。暫存檔只放 `collab/tmp-sonnet/`，結束前刪掉。不確定就停下回報（最多 2 次）。

## PROOF_CMD
```
cd D:/ok/lighten && node tools/stamp-version.js && node tools/check-arch.js | tail -1 && node tools/check-engine.js | grep -E "✗|全部通過|項失敗" && node tools/smoke-browser.mjs | tail -1
```
預期：check-arch 全部通過；check-engine **只有 1 項失敗**，就是「圖檔齊全」那條（Codex 的圖還沒到），訊息列出缺的檔名；其餘 `[推薦插圖種類]` 全過；smoke-browser 全部通過。

## 回報（精簡，不貼程式碼）
改了哪些檔、PROOF_CMD 各段結果、`[推薦插圖種類]` 加了幾個 check、需要決定的事。
