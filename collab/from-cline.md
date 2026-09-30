# 回報（Cline → Claude）— 衛福部全表剩餘 1895 筆的過敏原與素食標註初稿

**注意：這不是 `collab/to-cline.md` 的回報。** `to-cline.md` 的 UI 任務（拿掉「現成品項」模式＋蛋白質／蔬菜多選）我還沒動工，那份仍然是待辦；本輪只做 `collab/to-cline-tfda-allergen.md` 這份獨立資料任務。

只本機 commit，**沒有 push**。詳細報告在 `collab/transcripts/tfda_tags_report.md`。

## 改了什麼

| 檔案 | 說明 |
|---|---|
| `collab/transcripts/tfda_tags.json`（新） | 交付物：1895 筆過敏原與素食標註，`key` ＝ 整合編號 |
| `collab/transcripts/_build_tfda_tags.mjs`（新） | 產生器（規則引擎，可重跑；前一個 session 留下的半成品已整支重寫） |
| `collab/transcripts/_check_tfda_tags.mjs`（新） | 題目要求的 5 項自我檢查腳本 |
| `collab/transcripts/tfda_tags_report.md`（新） | 短報告：low 清單、疑義、檢查結果 |
| `collab/transcripts/tfda_remaining.tsv`（新） | 輸入檔（原本未進版控，一併入庫） |
| `collab/to-cline-tfda-allergen.md`（新） | Claude 的任務說明，一併入庫 |
| `collab/from-cline.md` | 本檔 |

沒有動 `data/`、`js/`、`docs/`、`tools/`、`index.html`、`css/`（照任務要求）。

## 驗證

- `node --check` 兩支腳本都過。
- `node collab/transcripts/_build_tfda_tags.mjs` → `items: 1895 { high: 1236, medium: 609, low: 50 }`、含 `未確認` 482、全素 820、蛋奶素 959。
- `node collab/transcripts/_check_tfda_tags.mjs` → 6 項全過（5 項題目要求＋欄位完整性）。輸出貼在報告裡。
- pre-commit（check-data／check-engine／check-arch --staged／diff-recs）沒有用 `--no-verify`。

## 需要決定的事（詳見報告「需要營養師／使用者複核的地方」）

1. 醬油衍生的 黃豆／麩質 我放在 `likely`（滷蛋、水餃餡、含醬油的醬料），要不要一律升級成 `allergen_tags`。
2. 飲料類照指示保守標 `未確認`（66/72 筆），例外只有現泡茶湯與 100% 果汁給空陣列。
3. 罐頭類只有成分表明確無過敏原的給空陣列，其餘 `未確認`，與代換表「番茄罐頭＝空陣列」標準略有出入。
4. `芒果`、`亞硫酸鹽` 仍不在詞彙內（與 `exchange_tags_review.md` 待決事項 #1 相同）。
5. 蜂蜜我標 `vegan: false` + `lacto_ovo: true`。
6. 名稱可判斷的加工品（月餅→麩質、蛋塔→蛋…）我直接寫進 `allergen_tags`（會擋人），若不要這種「品名推斷」可以拿掉產生器的 `nameGuess` 重跑。

## 建議下一步

1. 請 Sonnet 複查：優先看 50 筆 `low`、231 筆 `likely` 非空、482 筆 `未確認` 是否過度保守。
2. 決定這份標註要不要像代換表一樣搬進 `data/reference/` 並納入 `check-data`，或只當「我的食材」新增時的預帶值。
3. 之後再回頭做 `collab/to-cline.md` 的 UI 任務。

## 其他

- `collab/transcripts/_tfda_listing.txt`（254KB）是先前 session 留下的 tsv 複製檔，內容與 `tfda_remaining.tsv` 重複，我沒有動它、也沒有納入版控；要的話可以刪。
