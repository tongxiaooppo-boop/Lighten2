# 任務書：外觀風格插圖 14 張（v2026-11-21）

給：Codex（VS Code 面板）。只產圖、存檔，**不改任何程式、不 commit**。

## 要讀的檔案（只准讀這些）

- `collab/skins/mockup.html`：第 2 個（運動活力）與第 5 個（療癒粉彩）的配色與氣氛，只看 CSS 色碼與說明文字。

## 要做的事

用你的產圖工具產出下面 14 張，存到指定路徑。所有圖：**不要有任何文字、字母、數字、logo、浮水印**；不要出現人臉。

### 規格

| 種類 | 尺寸 | 格式 | 大小上限 |
|---|---|---|---|
| 時段插圖（10 張） | 960×536（先產 1536×1024 再裁成這個比例，主體放正中間：畫面上只會顯示中間大約 960×350 的一條） | JPG，品質約 82 | 每張 90 KB |
| 飯糰角色（4 張） | 512×512 | PNG，**透明背景** | 每張 120 KB |

裁切、壓縮如果你的環境沒有工具，可以用 PowerShell 的 `System.Drawing`；暫存檔只放 `collab/skins/tmp/`，結束前刪掉。

### A. 運動活力 → `images/skins/sport/`

共同風格（每張 prompt 前面都加）：

> Flat vector illustration, bold geometric shapes, clean edges, subtle diagonal speed stripes in the background. Palette strictly: deep navy #12263A, electric lime #C8F23A, coral #FF5B3A, off-white #EEF1EC, small touches of white. Energetic, sporty, modern fitness-app look. Top-down or 3/4 view of a healthy Taiwanese meal on a table, subject centered, generous empty margin at top and bottom. No text, no letters, no numbers, no logos, no people's faces.

| 檔名 | 主題 |
|---|---|
| `meal-breakfast.jpg` | 早餐：一顆烤地瓜、兩顆水煮蛋、一杯無糖豆漿，旁邊一個運動水壺和一條毛巾，晨光 |
| `meal-lunch.jpg` | 午餐：分格便當盒，糙米飯、烤雞胸、燙青菜、滷豆干，旁邊一雙運動鞋的一角 |
| `meal-afternoon-tea.jpg` | 下午茶：一碗芭樂與番茄切塊、一杯無糖綠茶，旁邊一個啞鈴 |
| `meal-dinner.jpg` | 晚餐：台式家常菜，一碗白飯、麻婆豆腐、蒜炒地瓜葉、一碗白菜雞湯，傍晚 |
| `meal-snack.jpg` | 宵夜：一杯溫豆漿和一小碗清湯，夜晚，窗外城市燈光，深藍為主 |

### B. 療癒粉彩 → `images/skins/pastel/`

共同風格（每張 prompt 前面都加）：

> Soft pastel gouache and colored-pencil illustration, rounded cute shapes, gentle texture, cozy and calming. Palette: cream background #FFF5EF, peach #FFB59E, mint #9FDCC2, lilac #CBB8F2, butter yellow #FFE39A, soft plum-gray lines #4A3F5C. A small cute rice-ball (onigiri) character with a nori band, dot eyes and pink blush sits beside the food. Healthy Taiwanese meal, subject centered, generous empty margin at top and bottom. No text, no letters, no numbers, no logos, no human faces.

| 檔名 | 主題 |
|---|---|
| `meal-breakfast.jpg` | 早餐：地瓜、水煮蛋、無糖豆漿，飯糰角色剛起床伸懶腰，晨光 |
| `meal-lunch.jpg` | 午餐：分格便當盒（糙米飯、雞胸、青菜、豆干），飯糰角色拿著筷子 |
| `meal-afternoon-tea.jpg` | 下午茶：一盤芭樂與小番茄、一杯無糖茶，飯糰角色坐在杯子旁 |
| `meal-dinner.jpg` | 晚餐：白飯、麻婆豆腐、炒地瓜葉、白菜雞湯，暖黃燈光，飯糰角色滿足的樣子 |
| `meal-snack.jpg` | 宵夜：一杯溫豆漿，夜空與小星星，飯糰角色抱著小枕頭 |

### C. 飯糰角色表情 → `images/skins/pastel/`

共同風格（每張 prompt 前面都加）：

> Character sheet style, single cute rice-ball (onigiri) mascot, rounded triangle body in white with soft plum-gray outline #4A3F5C, a dark nori band at the bottom, small dot eyes, peach blush cheeks #FFB59E, tiny stubby arms. Soft pastel gouache texture. Centered, full body, fills about 80% of the frame. Transparent background. No text, no shadows on the ground.

四張必須是**同一個角色**（同樣比例、線條、海苔位置），只有表情和手勢不同：

| 檔名 | 表情 |
|---|---|
| `mascot-hi.png` | 揮手打招呼，微笑 |
| `mascot-ok.png` | 平靜微笑，雙手在身體兩側 |
| `mascot-happy.png` | 大笑閉眼，雙手舉高 |
| `mascot-cheer.png` | 握拳加油，眼神堅定但溫和（不是生氣） |

## 不准做的事

- 不改 `images/`、`collab/skins/` 以外的任何檔案；不改程式；不 commit。
- 不要用網路搜尋或網頁上的現成圖片。
- 產不出來（工具不能用、額度用完）就停下，寫在回報裡，不要用別的方式湊。

## PROOF_CMD

```powershell
Get-ChildItem images/skins/sport,images/skins/pastel | ForEach-Object { Add-Type -AssemblyName System.Drawing; $i=[System.Drawing.Image]::FromFile($_.FullName); "{0}`t{1}x{2}`t{3}KB" -f $_.Name,$i.Width,$i.Height,[math]::Round($_.Length/1KB); $i.Dispose() }
```

預期：sport 5 個 JPG 全是 `960x536`、≤ 90KB；pastel 5 個 JPG `960x536` ≤ 90KB ＋ 4 個 PNG `512x512` ≤ 120KB。共 14 行。

## 回報（寫到 `collab/from-codex-images.md`）

- 完成項：14 個檔名，每個一行（檔名／尺寸／KB）
- PROOF_CMD 輸出原文
- 哪幾張不滿意或重產過、四張角色是否同一個樣子
- 需要決定的事（沒有就寫「無」）
