# 給 Claude Sonnet：修「今日建議同一餐湊出兩杯飲料」

一律用中文回覆。這份是獨立任務說明，不需要讀其他交接檔。

## 問題

「今日建議」的超商組合有時會在同一餐推薦兩杯飲料，例如「主餐 ＋ 統一陽光無糖豆漿 ＋ 翰方御品高蛋白搖飲」。

上一次的修正是 commit `af2d7c6`，只擋掉「兩款都屬於`飲品`分類」的情況，沒有處理到根本原因。

## 根因

檔案：`js/engine/recommend.js`，約 356–413 行（`// ---------- 2. 超商即食品項` 那段）。

```js
const EXTRA_CATEGORIES = { "飲品": true, "蛋白飲/點心棒": true };
...
const extraDrinks = extras.filter(function (it) { return it.category === "飲品"; });
const extraBars = extras.filter(function (it) { return it.category === "蛋白飲/點心棒"; });
mains.forEach(function (main) {
  extras.forEach(function (extra) { combos.push(toConvenienceCombo([main, extra])); });
  extraDrinks.forEach(function (drink) {
    extraBars.forEach(function (bar) { combos.push(toConvenienceCombo([main, drink, bar])); });
  });
});
```

三品項組合是「一款`飲品` ＋ 一款`蛋白飲/點心棒`」。問題在於 `data/convenience_items.json` 的`蛋白飲/點心棒`分類混了液態和固態品項：

| id | 名稱 | 實際是 |
|---|---|---|
| conv_pk01 | Body Goals 飽飽控卡／蛋白飲 | **液態** |
| conv_pk02 | 翰方御品 高蛋白飽飽纖搖飲 | **液態** |
| conv_pk03 | Soyjoy 大豆營養棒 | 固態 |
| conv_pk04 | Plenti／Oatly 濃縮燕麥奶 | **液態** |

所以 4 個「點心棒」裡有 3 個其實是飲料，只要挑到其中一個就會變成兩杯。

我已經確認過其他來源都不會出現這個問題，不用去改：
- 每個時段只挑一個候選（`candidates[0]`），不會跨候選拼湊。
- 台式品項（`taiwan_items.json` 的「飲料」分類）都是單品，不會組合。
- 自組食譜 `bowl_oat`（豆漿／優格 ＋ 燕麥）是一碗燕麥，不算兩杯飲料，不用動。

## 修法

### 1. 資料：標出哪些是液態

在 `data/convenience_items.json` 給這 9 筆品項加上 `"is_drink": true`：
- `飲品`分類的全部 6 筆：conv_dr01 到 conv_dr06。
- conv_pk01、conv_pk02、conv_pk04。

conv_pk03（Soyjoy）不要加。其他主餐品項也不用加，沒有這個欄位就當作 false。

分類名稱**維持`蛋白飲/點心棒`不要改**，UI 或其他地方可能有顯示。改之前先 `grep -rn "蛋白飲/點心棒" js/ index.html` 確認。現在已知只有 `recommend.js` 用到，但還是要再確認一次。

### 2. 邏輯：同一個組合裡最多一款液態品項

把 `extraDrinks`／`extraBars` 改成依 `is_drink` 分：

```js
// 「蛋白飲/點心棒」分類混了液態（搖飲/燕麥奶）跟固態（營養棒），不能用分類名判斷是不是飲料，
// 改看品項本身的 is_drink：一個組合最多一款液態，第二款只能是固態點心。
const extraDrinks = extras.filter(function (it) { return !!it.is_drink; });
const extraSnacks = extras.filter(function (it) { return !it.is_drink; });
mains.forEach(function (main) {
  extras.forEach(function (extra) {
    combos.push(toConvenienceCombo([main, extra]));
  });
  extraDrinks.forEach(function (drink) {
    extraSnacks.forEach(function (snack) {
      combos.push(toConvenienceCombo([main, drink, snack]));
    });
  });
});
```

另外把舊的註解（「一餐最多配一款飲品＋一款點心棒」那兩行）改成符合新邏輯的說法，不要留下已經不正確的描述。

**不要做的事：**
- 不要動評分、時段、過敏原、飲食限制的邏輯。
- 不要順手改檔案其他地方。註解裡提到「彈性帳本／彈性點數」的地方之後會整批重寫，這次先不要碰。

### 3. 驗證（要實際跑，把輸出貼給使用者）

在 repo 根目錄用 node 跑下面這段。它直接讀 JSON，重現組合邏輯並檢查：

```bash
node -e '
const items = require("./data/convenience_items.json").filter(i => i.kcal != null);
const EXTRA = {"飲品":1,"蛋白飲/點心棒":1};
const mains = items.filter(i => !EXTRA[i.category]);
const extras = items.filter(i => EXTRA[i.category]);
const drinks = extras.filter(i => i.is_drink), snacks = extras.filter(i => !i.is_drink);
const combos = [];
items.forEach(i => combos.push([i]));
mains.forEach(m => { extras.forEach(e => combos.push([m,e])); drinks.forEach(d => snacks.forEach(s => combos.push([m,d,s]))); });
const bad = combos.filter(c => c.filter(i => i.is_drink).length > 1);
console.log("組合總數", combos.length, "／兩杯以上飲料的組合", bad.length);
console.log("標了 is_drink 的品項:", items.filter(i=>i.is_drink).map(i=>i.id).join(","));
if (bad.length) { console.log(bad.slice(0,5).map(c=>c.map(i=>i.name).join(" + "))); process.exit(1); }
'
```

預期結果：
- 「兩杯以上飲料的組合」是 **0**。
- `is_drink` 品項剛好是 dr01–dr06、pk01、pk02、pk04，共 9 筆。

跑完之後：
- 用 `grep` 確認 `recommend.js` 裡已經沒有 `extraBars` 或 `=== "蛋白飲/點心棒"` 這種用分類名判斷飲料的殘留。
- `python -c "import json;json.load(open('data/convenience_items.json',encoding='utf-8'))"` 確認 JSON 格式正確。

如果可以開瀏覽器（例如 `python -m http.server` 開 `index.html`），把「今日建議來源」設成超商，重新整理幾次，確認沒有同一餐兩杯飲料。沒辦法開就明說沒做這步，不要寫成已驗證。

## 完成後

- commit 訊息用中文，例如：`修 bug：超商組合改依品項是否為液態判斷，避免同一餐兩杯飲料（蛋白飲/點心棒分類混了搖飲與燕麥奶）`
- 先不要 push，等使用者確認。
- 回報三件事：改了哪些檔案、驗證腳本的輸出、有沒有沒做到的步驟。
