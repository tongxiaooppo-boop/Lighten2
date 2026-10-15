# 食譜分頁（第六頁）資料產生紀錄（2026-10-15）

流程：make-batches.js（配方→送審批次）→ run-steps.js（DeepSeek V4.1 Flash 每批 4 道、GPT-5.4 mini 每批 12 道各寫 124 道作法）→ review.js（GPT mini 交叉審兩版，挑較好一版，review.json）→ score.js（步驟克數對得上食材的機械檢查）。
減重套組：run-sets.js（兩邊各出 8 套×3 類）→ fix-sets.js（用衛福部／代換表重算營養，超出標準請 GPT 修正）→ merge.js（每類型挑較貼合者，並套用 GPT-5.4 審稿的修正：帶殼蛋不微波、牛腱改雞腿、素食標為蛋奶素）→ tools/build-recipes-guide.js 產生 data/recipes_guide.json。
注意：DeepSeek V4 Pro 在這類長輸出會把 16000 token 全用在思考，改用 Flash；套組若 Flash 失敗則拆成更小批。
