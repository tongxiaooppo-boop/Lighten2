# 外觀風格插圖交付回報

日期：2026-11-21

完成 14 / 14 張。使用內建 image_gen 產圖；PowerShell System.Drawing 裁切、縮放、編碼與 PNG 色彩壓縮。未修改程式、未 commit、未搜尋或使用網路現成圖片。

## 完成項

- images/skins/sport/meal-breakfast.jpg / 960×536 / 37.38 KB（38276 bytes）
- images/skins/sport/meal-lunch.jpg / 960×536 / 55.03 KB（56348 bytes）
- images/skins/sport/meal-afternoon-tea.jpg / 960×536 / 37.71 KB（38615 bytes）
- images/skins/sport/meal-dinner.jpg / 960×536 / 50.29 KB（51501 bytes）
- images/skins/sport/meal-snack.jpg / 960×536 / 33.52 KB（34329 bytes）
- images/skins/pastel/meal-breakfast.jpg / 960×536 / 31.07 KB（31818 bytes）
- images/skins/pastel/meal-lunch.jpg / 960×536 / 35.74 KB（36599 bytes）
- images/skins/pastel/meal-afternoon-tea.jpg / 960×536 / 26.95 KB（27595 bytes）
- images/skins/pastel/meal-dinner.jpg / 960×536 / 39.35 KB（40290 bytes）
- images/skins/pastel/meal-snack.jpg / 960×536 / 25.69 KB（26304 bytes）
- images/skins/pastel/mascot-hi.png / 512×512 / 119.9 KB（122781 bytes）
- images/skins/pastel/mascot-ok.png / 512×512 / 95.52 KB（97817 bytes）
- images/skins/pastel/mascot-happy.png / 512×512 / 99.35 KB（101733 bytes）
- images/skins/pastel/mascot-cheer.png / 512×512 / 99.02 KB（101397 bytes）

KB 以 1024 bytes 計算。10 張 JPG 為 960×536、品質 82；4 張 PNG 為 512×512，具真正 alpha 透明背景。全部符合大小上限；mascot-hi.png 為 122781 bytes，小於 120 KB（122880 bytes）。

## PROOF_CMD 輸出原文

```text
meal-afternoon-tea.jpg	960x536	38KB
meal-breakfast.jpg	960x536	37KB
meal-dinner.jpg	960x536	50KB
meal-lunch.jpg	960x536	55KB
meal-snack.jpg	960x536	34KB
mascot-cheer.png	512x512	99KB
mascot-happy.png	512x512	99KB
mascot-hi.png	512x512	120KB
mascot-ok.png	512x512	96KB
meal-afternoon-tea.jpg	960x536	27KB
meal-breakfast.jpg	960x536	31KB
meal-dinner.jpg	960x536	39KB
meal-lunch.jpg	960x536	36KB
meal-snack.jpg	960x536	26KB
```

## 視覺檢查與重產紀錄

- 運動早餐重產 1 次：首版主體偏下且將兩顆蛋畫成兩個半顆；最終版改為中央構圖及兩顆完整水煮蛋。
- 粉彩宵夜重產 1 次：首版多出餐盤；最終版只保留溫豆漿、抱枕飯糰與星空。
- 其餘 12 張未重產。逐張目視檢查未見文字、字母、數字、logo、浮水印或人臉；成品無仍需重產的不滿意項目。
- 10 張餐點原圖均為 1536×1024，置中裁成 1536×857.6 後縮至 960×536；另檢查中央 960×350 裁切，主體完整可辨識。
- 四張獨立角色為同一個樣子：以 mascot-hi 母版參考編輯其餘三張，保留圓角三角身形、梅灰描邊、腮紅與底部中央海苔位置，只改表情與手勢；輪廓、海苔及比例經總覽比較一致。
- PNG RGB 以 8 階間距壓縮，保留 alpha 數值及半透明邊緣。透明度驗證如下。

- mascot-hi.png：透明 118380 像素、半透明 143188 像素、不透明 576 像素。
- mascot-ok.png：透明 120451 像素、半透明 140632 像素、不透明 1061 像素。
- mascot-happy.png：透明 117158 像素、半透明 143767 像素、不透明 1219 像素。
- mascot-cheer.png：透明 119774 像素、半透明 141213 像素、不透明 1157 像素。

## 暫存處理

這次建立的 collab/skins/tmp/codex-images-qa.png 已刪除。原先 tmp 內其他檔案未變動。工具原始產圖留在預設 generated_images 目錄；14 張交付成品均已存入專案指定路徑。

## 需要決定的事

無。

## 最終 prompt 組合

餐點各張 prompt = 對應風格前綴 + Subject 主題 + 共用構圖規則。使用內建工具，餐點 transparent_background=false，角色為 true。

### 運動前綴

```text
Flat vector illustration, bold geometric shapes, clean edges, subtle diagonal speed stripes in the background. Palette strictly: deep navy #12263A, electric lime #C8F23A, coral #FF5B3A, off-white #EEF1EC, small touches of white. Energetic, sporty, modern fitness-app look. Top-down or 3/4 view of a healthy Taiwanese meal on a table, subject centered, generous empty margin at top and bottom. No text, no letters, no numbers, no logos, no people's faces.
```

### 粉彩前綴

```text
Soft pastel gouache and colored-pencil illustration, rounded cute shapes, gentle texture, cozy and calming. Palette: cream background #FFF5EF, peach #FFB59E, mint #9FDCC2, lilac #CBB8F2, butter yellow #FFE39A, soft plum-gray lines #4A3F5C. A small cute rice-ball (onigiri) character with a nori band, dot eyes and pink blush sits beside the food. Healthy Taiwanese meal, subject centered, generous empty margin at top and bottom. No text, no letters, no numbers, no logos, no human faces.
```

### 餐點共用構圖規則

```text
Use case: illustration-story. Landscape 1536x1024. Arrange ALL food and props as a small, low horizontal still-life centered at x=768 y=512, entirely within x=280..1256 and y=310..700. Top-down view for bowls/plates, shallow cups. Upper AND lower thirds mostly empty background. This will be cropped to 960x536 then a central 960x350 strip. Avoid tall objects, photorealism, gradients, excessive detail, and any text or watermark.
```

- images/skins/sport/meal-breakfast.jpg: Breakfast: one roasted sweet potato, TWO WHOLE boiled eggs (not two halves), one short glass of unsweetened soy milk, a small plain sports water bottle and folded towel nearby, morning light. All objects compact and short in height.
- images/skins/sport/meal-lunch.jpg: Lunch: a compartmented bento box containing brown rice, grilled chicken breast, blanched leafy vegetables, braised dried tofu; a small corner of sports sneakers nearby.
- images/skins/sport/meal-afternoon-tea.jpg: Afternoon tea: a bowl of guava and tomato chunks, a short glass of unsweetened green tea, a dumbbell beside the food.
- images/skins/sport/meal-dinner.jpg: Dinner: Taiwanese home cooking, one bowl of white rice, mapo tofu, garlic stir-fried sweet potato leaves, one bowl of napa cabbage chicken soup; evening.
- images/skins/sport/meal-snack.jpg: Late night snack: one short glass of warm soy milk and a small bowl of clear soup, tiny distant city lights through a window; predominantly deep navy night scene.
- images/skins/pastel/meal-breakfast.jpg: Breakfast: sweet potato, boiled eggs, unsweetened soy milk, rice-ball character stretching after waking up, morning light.
- images/skins/pastel/meal-lunch.jpg: Lunch: compartment bento with brown rice, chicken breast, leafy vegetables, dried tofu; rice-ball character holding chopsticks.
- images/skins/pastel/meal-afternoon-tea.jpg: Afternoon tea: a plate of guava chunks and cherry tomatoes, one short cup of unsweetened tea, the small rice-ball mascot sitting beside the cup.
- images/skins/pastel/meal-dinner.jpg: Dinner: white rice, mapo tofu, stir-fried sweet potato leaves, napa cabbage chicken soup; warm butter-yellow lamplight, rice-ball mascot looking satisfied.
- images/skins/pastel/meal-snack.jpg: Late night snack: ONLY a single short cup of warm unsweetened soy milk and the little rice-ball character hugging a small lilac pillow. A soft lilac patch of night sky with tiny butter-yellow stars behind them. No plate, no eggs, no tofu, no vegetables, no other food. 

### 角色母版 prompt

```text
Character sheet style, single cute rice-ball (onigiri) mascot, rounded triangle body in white with soft plum-gray outline #4A3F5C, a dark nori band at the bottom, small dot eyes, peach blush cheeks #FFB59E, tiny stubby arms. Soft pastel gouache texture. Centered, full body, fills about 80% of the frame. Transparent background. No text, no shadows on the ground.
Subject: Use case: illustration-story. Square single mascot asset. Waving hello with one tiny hand, gentle smile. Front-facing softly rounded triangular white body, dark rectangular nori band centered at bottom front, dot eyes and peach blush, no accessories, no feet, no human faces, no logos, no watermark. Actual transparent alpha background. This is the master identity for a consistent four-pose set.
```

### 角色編輯 prompt

三張均參考同一張 mascot-hi 原始圖；下列共用 prompt 的 POSE 分別替換為後列指示。

```text
Character sheet style, single cute rice-ball (onigiri) mascot, rounded triangle body in white with soft plum-gray outline #4A3F5C, a dark nori band at the bottom, small dot eyes, peach blush cheeks #FFB59E, tiny stubby arms. Soft pastel gouache texture. Centered, full body, fills about 80% of the frame. Transparent background. No text, no shadows on the ground.
Use case: identity-preserve. Edit target: the attached master mascot. Change ONLY expression and arm gesture: POSE Preserve the exact same body silhouette, aspect ratio, outline thickness and plum color, gouache texture, cheek placement, bottom-centered nori rectangle size and position, framing and scale. No feet, no accessories, no text, no ground shadow. True transparent alpha background.
```

- mascot-ok.png：Calm gentle smile, two arms resting down at the sides. Remove waving motion marks.
- mascot-happy.png：Laughing with closed happy curved eyes, open joyful smile, both tiny arms raised high.
- mascot-cheer.png：Both tiny hands clenched into encouraging little fists beside the body, determined but kind dot eyes and confident small smile; not angry.
