# 回報（Cline → Claude）— 家常菜與整碗主食「快煮／開伙」標註初稿

**注意：這不是 `collab/to-cline.md` 的回報。** 本輪只做 `collab/to-ai-cook-tier-tagging.md` 這份獨立資料任務（Cline 這份，149 筆全標）。

只本機 commit，**沒有 push**。詳細報告在 `collab/transcripts/cook_tier_report_cline.md`。

## 改了什麼

| 檔案 | 說明 |
|---|---|
| `collab/transcripts/cook_tier_cline.json`（新） | 交付物：149 筆標註，`_by`="Cline（Claude Sonnet）"、每筆 `by`="cline" |
| `collab/transcripts/_build_cook_tier.py`（新） | 產生器（可重跑） |
| `collab/transcripts/_check_cook_tier.py`（新） | 自我檢查腳本（筆數、欄位、分鐘數一致性、校準對照） |
| `collab/transcripts/cook_tier_report_cline.md`（新） | 短報告：low/medium 清單、判斷解讀、檢查結果 |
| `collab/transcripts/cook_tier_input.tsv`（新） | 輸入檔，一併入庫 |
| `collab/to-ai-cook-tier-tagging.md`（新） | 任務說明，一併入庫 |
| `collab/from-cline.md` | 本檔 |

沒有動 `data/`、`js/`、`docs/`、`index.html`、`css/`。

## 驗證

- `python collab/transcripts/_build_cook_tier.py` → `total: 149 / unique ids: 149`。
- `python collab/transcripts/_check_cook_tier.py` → 全過：輸入 149 = 輸出 149、無漏無多無重複；欄位值合法；🟡 無 >35 分鐘、🔴<30 分鐘者 reason 皆有器具說明；校準範例 12 道全對上。
- 分佈：🟢 4、🟡 73、🔴 72；high 140、medium 6、low 3。

## 需要 Claude 決定的事（詳見報告「拿不準」段）

1. **滷豆腐（d12_040）** 我標 🟡 25（豆腐易入味），但「滷豆干滷蛋／滷蛋」都標 🔴——這條界線請裁決。
2. **雞肉香菇炊飯（wb_chickenrice）** 我標 🟡 35 low（電子鍋免顧火，但略超 30 分鐘），按時間規則也可能是 🔴。
3. **涼拌菠菜／木耳／過貓／沙拉雞絲** 我標 🟡（需先燙熟／煮熟），不是 🟢——請確認這跟 App 現有涼拌標記一致。
4. **魚湯（d12_063）** 以「魚片清湯」判 🟡 20；若定義為魚骨熬湯則應 🔴。
5. **烤吐司** 標 🟢，但 equipment 清單無「烤麵包機」，暫用「免開火」——要不要補設備詞。

## 建議下一步

1. 等 GPT 那份（`cook_tier_gpt.json`）交回後，按 `id` 對齊、逐筆比對不一致處（尤其 🟡↔🔴）。
2. 通過後再決定標記要放進哪個資料檔／欄位（App 的「快煮／開伙」開關）。

