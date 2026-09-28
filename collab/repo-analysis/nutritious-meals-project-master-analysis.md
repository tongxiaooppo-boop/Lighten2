# repo 分析：nutritious-meals-project-master（營養師開菜單 App，學校專題）

分析對象：`D:\ok\lighten\book\nutritious-meals-project-master`
對照基準：`D:\ok\lighten\docs\PRD.md`（Lighten2 PRD 2.0，讀取成功，以此為準）

---

## 0. 摘要卡

| 項目 | 值 |
|---|---|
| 專案定位 | 大學專題等級的 Android 客戶端，讓「客戶」查看營養師事先在後台開好的每日三餐菜單（純文字），附帶一個獨立的 BMI/BMR/REE 計算頁面 |
| 專案類型 | 架構參考型（但內容極薄），不含資料來源型內容 |
| 技術棧 | Android (Java, androidx, Fragment + Navigation)、Firebase Auth（僅 Google 登入）、後端是外部 PHP + MySQL（**原始碼不在此 repo 內**，架設在已停用的免費空間 000webhostapp.com） |
| 對 Lighten2 的價值等級 | **低** |
| 最大亮點 | 唯一稍微可用的參考點是「客戶端定期輪詢後端菜單、依電話+日期本地過濾顯示」這個「檢視他人排好的計畫」的殼子概念，但實作本身沒有可抄的細節 |
| 最大缺口/風險 | 完全沒有結構化營養資料（沒有 kcal/protein/carb/fat 任何欄位）、沒有份量縮放、沒有推薦邏輯、沒有採購清單、服務端原始碼缺失且端點已死，多數畫面是未清理的教學範本殘留（例如通訊錄 CRUD 模板） |

---

## 1. 架構總覽

```
[外部後端，原始碼不在本 repo]
  PHP + MySQL on 000webhostapp.com（免費空間，兩個獨立網域：
    andyetw.000webhostapp.com/list_menu.php
    gesticulatory-conta.000webhostapp.com/php/list_contacts.php, list_contacts2.php）
        │  GET，回傳整表 JSON（無分頁、無篩選參數）
        ▼
[Android 客戶端 AsyncTask]  ← HttpURLConnection 直接打 GET，org.json 手動解析
        │
        ▼
[本地端用迴圈掃全部結果，逐筆比對 tel1/eatdate 是否等於使用者輸入]
        │  （MenuPage.java 甚至寫死只取 arr.getJSONObject(0)，只顯示第一筆）
        ▼
[RecyclerView/ListView 顯示純文字 dish1~dish5 或 Breakfast/Lunch/Dinner 字串]
```

- 沒有推薦引擎、沒有規則層、沒有資料庫 schema 檔（沒有看到任何 `.sql`、ORM、DB migration，MySQL 結構完全靠猜測欄位名反推）。
- BMI/BMR/REE（`ui/health/health.java`、`BmiCommomActivity.java`、`BmrCommom.java`、`ReeCommomActivity.java`）是完全獨立的一條分支，用 SeekBar 輸入身高體重年齡，Harris-Benedict 公式現算現顯示，**跟菜單模組沒有任何資料串接**（算出的 BMR/REE 不會拿去推算菜單熱量、不會存檔）。
- 登入（`Main_Home.java`）只做 Firebase Google Sign-In 換名字/email 顯示，跟菜單資料的存取權限（電話/日期查詢用的是使用者手動輸入的電話字串，不是登入身分）完全脫鉤。

## 2. 資料模型（跟我們對照）

程式碼裡唯二能反推出的「資料表」，都是**扁平字串欄位**，沒有巢狀結構、沒有單位、沒有營養素：

- **`list_menu.php` 回傳**（`menushow.java:107-121`，對照 Lighten2 `daily_log`／`MealContent`）：
  ```
  { id, tel1, eatdate, radio1(when/時段), dish1, dish2, dish3, dish4, dish5 }
  ```
  五個 `dish` 欄位全是自由文字字串（可能是菜名），**沒有 kcal/protein_g/carb_g/fat_g/fiber_g 任何欄位**，也沒有品項 ID 可對應資料庫。跟我們 `MealContent.components[]` 的落差是本質性的：我們是結構化元件（ingredient/product/estimate 三種 kind，各自可運算），這裡是給人看的純文字菜名，**完全不能拿來當資料，只能當「顯示形式」的反面案例**。
- **`list_contacts2.php` 回傳**（`MenuPage.java:105-113`、`historyFragment.java:118-127`，對照 Lighten2 `meal_plan`）：
  ```
  { ContactID, Breakfast, Lunch, Dinner, Date }
  ```
  同樣是三個自由文字欄位，無結構。`historyFragment` 讀的是同一支 API（`list_contacts2.php`），跟 `MenuPage` 完全重複，只是分頁位置不同——**這是同一份資料的兩套平行實作**，UI 上叫「歷史」跟「菜單頁」，但資料來源、轉換函式（`convertMenu`）幾乎一字不差複製貼上（比對 `MenuPage.java:105-113` 與 `historyFragment.java:118-127`，兩者代碼幾乎相同）。
- **`Contact.java`／`list_contacts.php`**（`{ ContactID, Picture, Name, Phone, Email, Birthday, Address }`）是典型 Firebase/Android 教學範例的「通訊錄」CRUD 資料結構，跟飲食/菜單毫無關聯，**推測是從其他通訊錄教學專案複製過來、沒有清乾淨的殘留**（`DashboardFragment.java` 抓這支 API 顯示成清單，點下去卻導去 `MenuPage`，語意對不起來）。

**結論：沒有任何一個資料結構可以對照到我們的 `profile`／`meal_plan`／`daily_log`／`custom_foods`／`ingredients.json` schema。** 這個專案的「菜單」概念停留在「營養師打字寫菜名」，不是我們的「結構化可運算食材/商品/估算元件」。

## 3. 核心邏輯（依錨點深挖）

依 PRD 的 6 條必查項逐一核對：

1. **本地優先 vs 雲端同步**：不適用。這個專案是純 client-server thin client，資料庫在遠端，沒有離線快取、沒有 IndexedDB/SQLite 本地儲存、沒有同步/合併邏輯。每次進畫面就是重新 GET 整包再本地過濾（`menushow.java:88-97`：`for` 迴圈掃全部再用 `tel1`/`eatdate` 字串相等比對），沒有分頁也沒有增量更新。**[避坑]** 這種「全表下載+客戶端過濾」的模式在資料量變大後會直接把手機流量和記憶體用爆，我們純本地 IndexedDB 方案完全不會遇到這個問題，但也提醒我們：未來若真的加同步層，過濾邏輯必須留在伺服器端查詢條件，不能學這裡整包拉回來比對。
2. **份量/人數縮放邏輯**：**未發現**。整個 repo 沒有任何「人數」「份量」「serving」「scale」相關欄位或計算式（grep 過 `meal|diet|recipe|serving|portion` 全部落空，唯一命中的是變數命名巧合）。菜單就是純文字菜名，沒有可縮放的量。
3. **AI 辨識/生成流程**：**未發現**，也未在 README 宣稱。BMI/BMR/REE 計算是固定公式（`health.java:98-107`：男用 `13.7*w+5*h-6.8*age+66`、女用 `9.6*w+1.8*h-4.7*age+655`，屬於 Harris-Benedict 舊版公式），現算現顯示，沒有邊界處理（沒有做輸入驗證、沒有 try/catch，`Float.valueOf(met2.getText())` 若使用者輸入空字串會直接 crash——這點在 `health.java:91-92` 完全沒有防呆）。
4. **推薦/篩選邏輯的資料前提**：**不存在推薦邏輯**。菜單完全是營養師人工在（不在本 repo 內的）後台系統打字產生，App 端只做「查詢+顯示」，沒有任何篩選規則、沒有硬性過濾、沒有「資料不完整時怎麼辦」的處理——因為壓根沒有結構化資料可以缺。
5. **採購/清單類邏輯**：**完全沒有**。沒有任何跟「買」「採購」「shopping」「單位換算」相關的程式碼。
6. **營養資料庫 schema**：**不存在**。整個 repo 找不到任何 kcal/protein/carb/fat/fiber 欄位或資料檔，也沒有 `.json`/`.csv`/`.sql` 資料檔案（`find` 全 repo，資料檔只有截圖 `1.jpg`、`menu_all.png`、`healthyMenu.gif` 三張圖片與一個純 URL 的 `00.txt`）。

## 4. 資料可用性評估

不適用——本專案不含任何營養資料檔案或欄位（見第 3 節第 6 點），連示範資料都沒有內嵌在程式碼或版本庫裡（後端 MySQL 內容不可見，且服務網域已是免費空間，推測早已停止服務，無法連線驗證）。此節無資料可評估。

## 5. 高價值模組/借鏡清單

嚴格來說沒有可直接借鏡的「模組」，只有兩個**概念層級**、可能值得參考的點，附上出處：

- `menushow.java:41-54`（意圖：依「電話+日期」查一筆特定的每日菜單）——概念上對應我們「查某天某時段的計畫/紀錄」的入口動線，但實作是本地端硬過濾整包資料，寫法本身不值得抄，只有「使用者輸入日期→回看當天菜單」這個**使用情境**可以當背景參考，對應我們餐點日曆（Phase 3）的「回顧某天」場景。
- README 提到的架構圖（`1.jpg`）與成果展示 gif（`healthyMenu.gif`）**未在本次分析中展開判讀**（README 只有圖片連結，無文字說明架構決策的理由），若使用者想看畫面長相可以自己開圖，但圖片本身不構成程式碼證據，不納入舉證。

其餘所有檔案（`Contact*.java`、`ContactAdapter*.java`、`AnimationTo.java`、`ui/connection/*`）都是教學模板等級的 CRUD/動畫殘留，跟飲食記錄無關，不列入。

## 6. 避坑清單

- **[避坑] 全表下載＋客戶端過濾**（`menushow.java:88-97`）：把整張表拉回手機再用字串相等比對找目標列，沒有伺服器端查詢條件、沒有分頁。資料量一大就是流量與效能雙重浪費。我們即使加同步層也要把過濾邏輯放在查詢層，不要學這個。
- **[避坑] 同一份資料兩套幾乎相同的平行實作**（`MenuPage.java:105-113` vs `historyFragment.java:118-127`）：程式碼近乎逐行複製貼上，日後改一邊忘記改另一邊就會產生行為分歧。這正好呼應我們自己 PRD 0.1 節提到的「v1 的問題出在同一件事有多份實作」——這個 repo 是一個活生生的反面示範，值得當「為什麼要做 Phase −1a 收斂」的佐證案例。
- **[避坑] 菜單內容是自由文字，沒有結構化資料**：意味著這個系統完全無法做任何營養計算、篩選、彙總——這正是我們選擇「結構化 MealContent」而非「純文字菜單」的理由所在，可以在跟 Opus 討論架構取捨時引用這個反例。
- **[避坑] 無輸入防呆會直接 crash**（`health.java:91-92`，`Float.valueOf` 對空字串會丟 `NumberFormatException` 且未 catch）：跟我們「optimistic-fail-safe，未確認一律保守排除」的原則相反，這裡是「沒防呆，等著炸」。
- 未發現其他值得記錄的地雷（因為多數功能本身就沒有實作到會出問題的深度）。

## 7. 一句話結論

這個 repo 是一個資料完全非結構化、無推薦邏輯、無份量/採購/AI 概念、後端原始碼缺失且服務已死的教學等級專題，對 Lighten2 現階段（PRD 2.0 Phase 0 起）**沒有可直接借鏡的架構或資料**，唯一殘餘價值是拿它的「全表下載＋客戶端過濾」與「同一資料兩套平行實作」當**負面案例**，可以在跟 Opus 討論 Phase −1a（收斂多份實作）或未來要不要加同步層時，當一句話式的反例引用，不需要另外安排時間點回頭細讀。
