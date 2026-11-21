# 任務書：重做 1 張插圖 sport/kind-cook-plate（v2026-11-21）

給：Codex（VS Code 面板）。只產圖、存檔，**不改任何程式、不 commit**。

## 要讀的檔案（只准讀這些）

- `collab/to-codex-kind-images.md`：「規格」一節與表格中 `kind-cook-plate.jpg` 那一列。
- `collab/to-codex-images.md`：只看 A 段（運動活力）共同風格 prompt。
- 參考圖（同系列的樣子）：`images/skins/sport/kind-cook-bowl.jpg`、`images/skins/sport/kind-cook-box.jpg`、`images/skins/sport/meal-breakfast.jpg`。

## 問題

現在的 `images/skins/sport/kind-cook-plate.jpg` 背景是淺灰底＋一條木桌與窗戶，像貼在畫面中間的照片框；同資料夾其他 8 張都是**深藍滿版底＋萊姆綠／橘紅斜線**，這張看起來不同系列。

## 要做的

重產 `images/skins/sport/kind-cook-plate.jpg` 覆蓋舊檔：
- 內容不變：一個大圓盤上有地瓜、水煮蛋、燙青菜、小番茄，旁邊一杯豆漿。
- 背景改成跟參考圖一樣的深藍滿版＋斜線，不要淺色底、不要窗戶、不要木桌橫條；盤子底下可以有一塊餐墊（跟 `kind-cook-bowl.jpg` 一樣）。
- 規格同原任務書：960×536 JPG、品質約 82、≤ 90 KB、主體置中、無文字／logo／人臉。暫存檔只放 `collab/skins/tmp/`，結束前刪掉。

## 不准做的事

- 只動這一個檔，其他圖與程式都不碰；不 commit；不用網路搜尋或現成圖片。
- 產不出來就停下寫在回報。

## PROOF_CMD

```powershell
Add-Type -AssemblyName System.Drawing; $f=Get-Item images/skins/sport/kind-cook-plate.jpg; $i=[System.Drawing.Image]::FromFile($f.FullName); "{0}x{1}`t{2}KB" -f $i.Width,$i.Height,[math]::Round($f.Length/1KB); $i.Dispose()
```

預期：`960x536` 且 ≤ 90KB。

## 回報（寫到 `collab/from-codex-kind-images-fix.md`）

欄位：完成與否／尺寸與 KB／PROOF_CMD 輸出／需要決定的事。不貼程式碼。
