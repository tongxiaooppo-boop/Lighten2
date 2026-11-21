# 任務書：依餐點種類的插圖 27 張（v2026-11-21）

給：Codex（VS Code 面板）。只產圖、存檔，**不改任何程式、不 commit**。格式與上一批 `collab/to-codex-images.md` 相同。

## 要讀的檔案（只准讀這些）

- `collab/to-codex-images.md`：只看「共同風格」兩段 prompt（運動活力、療癒粉彩），這次照用。
- 參考圖（看畫風，讓新圖跟舊圖像同一系列）：`images/skins/sport/meal-lunch.jpg`、`images/skins/pastel/meal-lunch.jpg`、`images/gemini/meal-default-lunch.jpg`。

## 規格（27 張全部一樣）

960×536 JPG，品質約 82，每張 ≤ 90 KB（先產 1536×1024 再裁，主體放正中間：畫面只會顯示中間約 960×350 的一條）。
**不要有任何文字、字母、數字、logo、招牌、浮水印、可辨認的品牌包裝**；不要出現人臉。
裁切壓縮可用 PowerShell `System.Drawing`；暫存檔只放 `collab/skins/tmp/`，結束前刪掉。

## 三種風格 × 九種餐

### 共同風格 prompt
- **運動活力** → 存 `images/skins/sport/`：沿用 `collab/to-codex-images.md` A 段的共同風格。
- **療癒粉彩** → 存 `images/skins/pastel/`：沿用 B 段的共同風格（含飯糰角色）。
- **經典暖色** → 存 `images/skins/classic/`（新資料夾）：
  > Warm hand-drawn watercolor and soft flat illustration, rounded gentle lines, warm and relaxing mood, soft cream and warm orange tones, like a cozy food diary. Healthy Taiwanese meal, subject centered, generous empty margin at top and bottom. No text, no letters, no numbers, no logos, no human faces.

### 九種餐（每種風格都產這 9 張，檔名三個資料夾相同）

| 檔名 | 主題（中式、西式要一眼分得出來） |
|---|---|
| `kind-bf-chinese.jpg` | 台式早餐店外帶：蛋餅、飯糰（台式糯米飯糰）、一杯無糖豆漿，紙袋與塑膠杯，早晨 |
| `kind-bf-western.jpg` | 西式速食早餐：英式滿福堡、薯餅、一杯熱紅茶，速食托盤（無品牌），早晨 |
| `kind-cook-plate.jpg` | 自己做的早餐盤：一個大圓盤上有地瓜、水煮蛋、燙青菜、小番茄，旁邊一杯豆漿，家裡餐桌晨光 |
| `kind-cook-bowl.jpg` | 自己做的早餐碗：一碗無糖優格或燕麥，上面放香蕉片、藍莓、堅果，家裡餐桌 |
| `kind-chinese.jpg` | 台式外食午晚餐：外帶便當（排骨或雞腿＋三樣配菜＋白飯）和一碗湯麵，外帶餐盒與塑膠袋 |
| `kind-western.jpg` | 西式速食午晚餐：漢堡、炸雞、薯條、一杯無糖紅茶，速食托盤（無品牌） |
| `kind-convenience.jpg` | 便利商店即食：三角飯糰、茶葉蛋、一盒生菜沙拉、一瓶無糖茶，店內微波後的透明盒（無品牌、無標籤文字） |
| `kind-cook-home.jpg` | 自己煮的家常合菜：餐桌中間三盤炒菜（炒青菜、番茄炒蛋、三杯雞）、一碗湯、每人一碗白飯，家裡晚餐氣氛 |
| `kind-cook-box.jpg` | 自己帶的簡易餐盒：一個保鮮餐盒（meal-prep 盒），分格放糙米飯、煎雞胸、燙花椰菜、紅蘿蔔，辦公桌一角 |

## 不准做的事

- 不改 `images/skins/` 以外的任何檔案；不改程式；不 commit。不覆蓋既有的 `meal-*.jpg`、`mascot-*.png`。
- 不要用網路搜尋或網頁上的現成圖片。
- 產不出來（工具不能用、額度用完）就停下，寫在回報裡，不要用別的方式湊。

## PROOF_CMD

```powershell
Add-Type -AssemblyName System.Drawing; Get-ChildItem images/skins/sport,images/skins/pastel,images/skins/classic -Filter kind-*.jpg | ForEach-Object { $i=[System.Drawing.Image]::FromFile($_.FullName); "{0}\{1}`t{2}x{3}`t{4}KB" -f $_.Directory.Name,$_.Name,$i.Width,$i.Height,[math]::Round($_.Length/1KB); $i.Dispose() }
```

預期：27 行，全部 `960x536`、≤ 90KB；sport、pastel、classic 各 9 行，檔名同上表。

## 回報（寫到 `collab/from-codex-kind-images.md`）

欄位：完成張數／27、每張「路徑／尺寸／KB」、產不出來的清單與原因、需要決定的事。不貼 prompt 全文。
