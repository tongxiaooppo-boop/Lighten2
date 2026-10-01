# 平行工作線 A 前期調研：擴充餐型骨架（候選清單，非定案）

日期：2026-10-01。範圍：PRD 第 7 節「平行工作線 A」。本檔只做調研與候選，不改任何既有檔案；新骨架之後依章程 B7／C3 送獨立審核。

## 0. 先講結論與一個引擎事實

1. 引擎（`js/engine/pool.js` 第 46–125 行）對每個骨架做**笛卡兒積**：蛋白質 × 主食 × 蔬菜（附加「不加」）× 醬料（附加「不加」）× 烹調法。意思是：
   - 一個骨架內所有「蛋白質 × 蔬菜」配對都會被產生，**不能表達「只有雞腿配這種菜」**。口味差很多的做法（清蒸 vs 滷 vs 炒）要拆成不同骨架。
   - 推薦路徑每個槽位只會選 1 個食材（`COMPOSE_MAX` 的 2／3 只用於「自己選」）。
   - 主食槽的 `allow` 只要非空，就**一定**有主食（沒有「不加」選項）；要「可有可無主食」只能拆兩個骨架。
2. 骨架 `allow` 只能引用 `data/ingredients.json` 的 id。已確認 `tools/check-data.js` 第 670–673 行用 `byId`（ingredients.json）驗證，**不能直接引用 `food_tree.json` 的 `fx_` id**。所以任何新食材要先進 ingredients.json（走 `tools/build-ingredients.js`，TFDA 來源），再進骨架。
3. 現有 `ingredients.json` 的 39 個骨架食材（蛋白質 11、主食 7、蔬菜 19、醬料 2）**已全部被引用**（腳本確認沒有未被引用者）。現有烹調法只有 5 個：免開火、微波、煎、炒、烤／氣炸，**沒有蒸、水煮／燙、滷／燉**，而台灣家常減脂餐最常見的做法正是這三種（見第 5 節）。
4. 因此候選分兩種：**甲類**＝只用現有食材、現有烹調法就能做（可立刻起草）；**乙類**＝需要新烹調法；**丙類**＝需要新食材。多數有價值的候選是乙類，**烹調法缺口是最大瓶頸**，比食材缺口大。

## 1. 現有 5 個骨架摘要

資料：`data/dish_archetypes.json`（全部 5 個已讀）。「組合數」＝上述笛卡兒積筆數（自算，供量級參考）。

| id | 名稱 | 時段 | 蛋白質 | 主食 | 蔬菜 | 醬料 | 烹調法 | 用到食材 id 數 | 組合數 |
|---|---|---|---|---|---|---|---|---|---|
| `bowl_oat` | 早餐碗 | 早、下午茶、點心 | soy_milk, greek_yogurt | oats | 無 | 無 | no_cook, microwave | 3 | 4 |
| `egg_pan` | 煎蛋類 | 早、午、晚、點心 | egg | 無 | broccoli, spinach, celery, tomato, bell_pepper, onion | 無 | pan_fry, stir_fry | 7 | 14 |
| `protein_stir_fry` | 炒類 | 午、晚 | beef_shank, shrimp, chicken_thigh, edamame | cauliflower_rice, brown_rice_cooked | 15 種（broccoli … baby_corn） | kimchi | stir_fry | 22 | 256 |
| `grain_bowl_baked` | 烤／舒肥定食 | 午、晚 | chicken_breast, salmon, chicken_thigh, tilapia_fillet, firm_tofu | brown_rice_cooked, quinoa, mixed_grain_rice_cooked, sweet_potato | 11 種 | teriyaki_sauce | air_fry, pan_fry, microwave | 21 | 1440 |
| `warm_salad` | 溫沙拉 | 午、晚 | chicken_thigh, chicken_breast, firm_tofu | pumpkin, sweet_potato | 11 種（含 cucumber, lettuce_a, daikon） | 無 | pan_fry, air_fry | 16 | 144 |

觀察：
- 午晚餐可用的只有 `protein_stir_fry`、`grain_bowl_baked`、`warm_salad`（加上 `egg_pan`）。**做法只有「炒」「煎／烤」兩大類**，沒有蒸、滷、燉、湯、涼拌；蛋白質只有 11 種，沒有豬肉、豆干、鯖魚等台灣日常蛋白質。
- `grain_bowl_baked` 的組合數占全部約 78%，推薦池實際上被它主導。
- 規則（章程 B7）：`allow` 只能引用存在且 axis 相符的 id〔機〕；必填 `seasoned`；食材沒被任何骨架引用 → 警告；新增或修改骨架屬 C3 需審核，可一批一起審；骨架算不到的東西寫 `not_included`。

## 2. 候選新骨架清單

出處標示規則：`senior#N`＝`collab/transcripts/senior_recipes.json` 第 N 道（月份）；`1600`＝`recipes_1600_1800.json`（原 PDF 數字全缺，只有菜色骨架）；`90531#N`＝`90531.md` 第 N 道食譜；`plate`＝`my_plate.json` 的 `meal_examples`；`online-nut`＝`book/online-nutritionist-main/backend/prisma/seed.ts` 的餐點定義；`BasketMate`＝`book/BasketMate-main/frontend/app/docs/菜篮子/數據庫/recipes.csv` 的菜名（簡體，食材是 uuid 對不上，只能當菜名佐證）。

食材 id 只寫現有 `ingredients.json` 的 id。分類：甲＝現有食材與烹調法即可；乙＝需新烹調法；丙＝另需新食材才做得出原型。

### 甲類（立刻可起草，不需新烹調法）

**A1. 蛋飯類（番茄炒蛋飯／蔬菜蛋炒飯）**　午、晚　seasoned: true
- 蛋白質：egg；主食：brown_rice_cooked, mixed_grain_rice_cooked, cauliflower_rice；蔬菜：tomato, onion, bell_pepper, cabbage, spinach, broccoli, bean_sprout, shiitake, celery, snap_pea, baby_corn；醬料：無；烹調法：method_stir_fry, method_pan_fry。
- 規模：1×3×12×2＝72 組合，用 15 個既有 id。
- 出處：BasketMate 菜名「番茄炒蛋」；senior#5 咖哩菇菇歐姆蛋（蛋＋菇類）；online-nut「蝦子蔬菜炒飯」（蔬菜炒飯結構）；`1600` 早餐水煮蛋（蛋當蛋白質）。
- 為何適合減脂：蛋是便宜、好取得、蛋白質密度高的蛋白質；有主食＋蔬菜的完整一餐，台灣家常最常見的午晚餐之一。
- 跟現有差異：`egg_pan` 沒有主食槽、蛋只配蔬菜（早餐導向）；這個補上「蛋＋飯」，可以讓蛋成為午晚餐的主角。
- 風險：蛋在 `egg_pan` 已有，同天推薦可能重複蛋（現有「近期降權」是否涵蓋骨架層級待審）。

**A2. 低碳蛋白質蔬菜盤（無主食）**　午、晚　seasoned: true
- 蛋白質：chicken_breast, chicken_thigh, salmon, tilapia_fillet, shrimp, beef_shank, firm_tofu；主食：無；蔬菜：broccoli, spinach, cabbage, celery, bell_pepper, tomato, onion, snap_pea, baby_corn, okra, bamboo_shoot；醬料：無；烹調法：method_pan_fry, method_stir_fry, method_air_fry。
- 規模：7×1×12×3＝252 組合，18 個既有 id。
- 出處：`1600` 午餐「乾煎雞胸肉＋炒綜合蔬菜」「烤里肌肉片＋炒綜合蔬菜」；90531#3 翠綠蔥白拌鮮豚（肉絲＋蔥，不配飯）、90531#4 麻香黑蠔菇佐豚肉；web：營養師建議減少精緻澱粉、每餐蛋白質＋蔬菜（見第 7 節網址）。
- 為何適合減脂：低碳開關（`LOW_CARB_MEAL_MAX_G`）下，現有午晚餐骨架都有必選主食，最低只能壓到 0.5 倍；這個給低碳使用者一個不靠縮放就能過的選擇。
- 跟現有差異：`protein_stir_fry`／`grain_bowl_baked` 的主食槽非空就一定有主食；這是第一個午晚餐的「無主食」骨架（只有早餐導向的 `egg_pan` 是無主食）。
- 風險（重要）：沒有主食槽時主要槽位是蛋白質（`primary_axis: "protein"`），縮放範圍只有 0.5–2.0（`PRIMARY_SLOT_SCALE_RANGE`）。蛋白質份量 ×2 後熱量（如雞胸 154×2＝308 kcal）可能仍達不到午晚餐預算，推薦會被排除或偏低熱量。需要在起草時用 `tools/diff-recs.js` 看實際會不會進得了池。

**A3. 免開火涼拌豆腐／沙拉碗**　午、晚、點心　seasoned: false
- 蛋白質：firm_tofu；主食：cauliflower_rice；蔬菜：cucumber, tomato, lettuce_a, cabbage, bell_pepper, onion, spinach, celery, daikon, snap_pea；醬料：無；烹調法：method_no_cook。
- 規模：1×1×11×1＝11 組合，12 個既有 id；食安：以上 id 的 `requires_cooking` 都是 false（腳本確認）。
- 出處：senior#7 秋葵豆腐（涼拌豆腐概念，但秋葵需煮熟，此候選不含）；fatloss-plan-demo `takeout.html`「輕食碗／沙拉：肉／蝦＋一份碳水＋大量蔬菜，醬料單獨放」；`plate` 西式早餐「爽脆蔬菜」。
- 為何適合減脂：熱量低、不需開火，上班族／宿舍可用。
- 風險：組合只有 11 個，花椰菜米 35 kcal、豆腐 144 kcal，一餐熱量偏低，縮放最多 2 倍也可能不夠；價值中等，**優先序低**，除非使用者回報常沒有爐具。蛋白質只有豆腐一種，免開火可用的蛋白質只有 firm_tofu、greek_yogurt（優格配生菜不合理）。

**A4. 茄汁燉魚／雞（番茄洋蔥燉煮）**　午、晚　seasoned: true　（歸類上是乙類：理想做法是燉，放在這裡只因為現有炒／煎勉強可做，見差異）
- 蛋白質：tilapia_fillet, salmon, chicken_thigh；主食：brown_rice_cooked, mixed_grain_rice_cooked, sweet_potato；蔬菜：tomato, onion, bell_pepper, eggplant, celery；醬料：無；烹調法：理想是 method_braise（乙類），現有可退而用 method_stir_fry／method_pan_fry。
- 規模：3×3×6＝54 組合/個烹調法，11 個既有 id。
- 出處：senior#10 茄汁秋刀魚（番茄＋洋蔥＋魚燉煮，壓力鍋或電鍋）；`plate` 中式午餐「蒜香燉雞肉」；online-nut「瘦牛肉義大利麵」（番茄＋洋蔥）。
- 為何適合減脂：番茄洋蔥當醬底，免用高熱量醬料，魚與雞腿都是蛋白質密度高的食材。
- 跟現有差異：現有「炒」「烤」都不是燉煮路線；若只用炒／煎，其實跟 `grain_bowl_baked` 高度重疊，沒有新意，所以實質上屬乙類（需 method_braise）。

### 乙類（需要新烹調法：蒸、水煮／燙、滷／燉）

**B1. 清蒸魚定食**　午、晚　seasoned: true　需 method_steam
- 蛋白質：tilapia_fillet, salmon, shrimp；主食：brown_rice_cooked, mixed_grain_rice_cooked, sweet_potato, pumpkin；蔬菜：spinach, cabbage, broccoli, luffa, eggplant, okra, snap_pea, bamboo_shoot, celery；醬料：無；烹調法：method_steam（待新增）。
- 規模：3×4×10＝120 組合，16 個既有 id。
- 出處：`1600` 兩份計畫的晚餐「清蒸鱈魚或鮭魚」；`plate` 中式晚餐「蒜茸蒸魚＋高麗菜＋青江菜＋紫米飯」；BasketMate 菜名「清蒸鲈鱼」；senior#6 味噌茄子（電鍋蒸）；90531#7 菇香青玉蒸鮮肉；web：營養師建議清蒸、汆燙、清燉（第 7 節）。
- 為何適合減脂：蒸不加油（`implicit` 用油 0），台灣最典型的低脂家常做法；官方食譜多份都出現。
- 差異：現有沒有任何無油做法；`cooking_oil` 隱含 0 g，同樣食材熱量比煎炒低約 5–10 g 油（45–90 kcal）。
- 丙類延伸：鱈魚（fx_cod）、鯖魚、虱目魚補進來後蛋白質更貼近台灣，但不補也能成立。

**B2. 滷／燉定食（滷豆腐、滷雞腿、滷蛋、燉牛腱）**　午、晚　seasoned: true　需 method_braise
- 蛋白質：firm_tofu, chicken_thigh, beef_shank, egg；主食：brown_rice_cooked, mixed_grain_rice_cooked, sweet_potato；蔬菜：daikon, cabbage, shiitake, wood_ear, bamboo_shoot, celery, onion, tomato；醬料：無；烹調法：method_braise（待新增）。
- 規模：4×3×9＝108 組合，15 個既有 id。
- 出處：`1600` 計畫 2 晚餐「滷豆腐」；senior#2 滷梅花重疊肉（青江菜）；90531#12 暖心秋藕燉嫩排；`plate` 中式午餐「蒜香燉雞肉」；web：營養師建議「清蒸、汆燙、清燉、滷」，滷味攤蔬菜可夾 2–3 種（第 7 節）。
- 為何適合減脂：滷是台灣家庭／便當／滷味攤最普遍的做法，不需要油，味道重但可控；牛腱本身就是現有蛋白質，但「燉」才是它的常見做法（現在只配炒）。
- 風險：滷汁的鈉很高，`seasoned: true` 的鈉要用 `seasoning_normal` 估；用現有 `implicit` 調味概念即可，不新增食材。

**B3. 燉湯／清湯（雞腿蘿蔔香菇湯、牛腱蔬菜湯、豆腐蔬菜湯）**　午、晚　seasoned: true　需 method_boil 或 method_braise
- 蛋白質：chicken_thigh, beef_shank, firm_tofu, tilapia_fillet, shrimp；主食：無；蔬菜：cabbage, daikon, shiitake, celery, tomato, onion, luffa, bean_sprout, wood_ear, spinach；醬料：無；烹調法：method_boil／method_braise（待新增）。
- 規模：5×1×11＝55 組合/個烹調法，15 個既有 id。
- 出處：senior#12 白菜燉雞湯（大白菜、白蘿蔔、香菇、雞腿；食材除大白菜外現有 id 都有，用 cabbage 代）；senior#8 米苔目湯、senior#1 青花菜海鮮濃湯；90531#11 海陸鮮蔬燴雞蛋（蛋花湯）；`plate` 沒有湯品。
- 為何適合減脂：熱量低、飽足感高、蔬菜量大；是使用者沒主食時的選擇。
- 風險：湯品是整個產品要不要有的口味決定（第 6 節）；無主食導致主要槽位為蛋白質（見 A2 的縮放風險）；湯的熱量會很低，要看推薦能不能湊到預算。

**B4. 南瓜海鮮濃湯／蔬菜濃湯**　午、晚　seasoned: true　需 method_boil
- 蛋白質：shrimp, tilapia_fillet, chicken_breast；主食：pumpkin, sweet_potato；蔬菜：broccoli, onion, tomato, celery, spinach；醬料：無；烹調法：method_boil（待新增）。
- 規模：3×2×6＝36 組合，10 個既有 id。
- 出處：senior#1 青花菜海鮮濃湯（南瓜、蝦仁、小卷、蛤蜊、洋蔥、青花菜；本檔候選只用蝦仁、南瓜、洋蔥、青花菜四個現有 id，小卷與蛤蜊缺）。
- 為何適合減脂：用南瓜當主食與濃稠來源，不加奶油與麵粉。
- 差異：跟 `warm_salad`（南瓜／地瓜配煎肉）同主食，但做法是濃湯，口感差很多。
- 規模小，可併入 B3 當同一骨架的子集（不能，因為 B3 無主食、B4 必有主食，笛卡兒積限制，見第 0 節）。

**B5. 燙拌豆腐蔬菜（涼拌秋葵豆腐、味噌茄子豆腐）**　午、晚、點心　seasoned: true　需 method_boil 或 method_steam
- 蛋白質：firm_tofu, egg, edamame；主食：無；蔬菜：okra, eggplant, spinach, bean_sprout, cabbage, broccoli, luffa, bamboo_shoot；醬料：無；烹調法：method_boil／method_steam（待新增）。
- 規模：3×1×9＝27 組合，11 個既有 id。
- 出處：senior#7 秋葵豆腐（燙後拌醬）；senior#6 味噌茄子（蒸）；90531#6 綠精靈秋葵佐醬汁、90531#16 蒜香翡翠毛豆佐花生（毛豆＋紅蘿蔔）；`plate` 素食午餐「毛豆仁」。
- 為何適合減脂：素食友善、極低油，毛豆與豆腐都已是既有蛋白質。
- 風險：無主食、整餐熱量偏低（同 A2 風險）；更像「配菜」而非「一餐」，是否值得當午晚餐的獨立骨架要審核時決定。

**B6. 蒸釀蔬菜／蒸蛋（電鍋菜）**　午、晚　需 method_steam，且需豬絞肉才做得出原型
- 現有 id 能做的版本：蛋白質 egg, chicken_breast, shrimp；主食 無；蔬菜 luffa, eggplant, shiitake, cabbage；烹調法 method_steam。
- 出處：90531#7 菇香青玉蒸鮮肉（胡瓜釀豬絞肉）。
- 評價：原型需要豬絞肉（缺），現有 id 只能做出「蒸蛋」「蒸蝦」，與 B1 高度重疊；**不建議單獨做**，併入 B1 的蛋白質軸（加 egg）就好。

### 丙類（需要新食材才有意義）

**C1. 義式／西式麵食定食**　午、晚　seasoned: true　**需要使用者先決定要不要麵食**
- 蛋白質：shrimp, chicken_breast, beef_shank（現有）；主食：通心粉／麵條（缺，見第 3 節）；蔬菜：tomato, bell_pepper, broccoli, onion, bamboo_shoot 等現有；醬料：無（番茄醬底為既有 tomato/onion）；烹調法：method_stir_fry。
- 出處：`plate` 西式晚餐「起司白醬螺旋麵＋橄欖油炒蘑菇／四季豆／玉米筍＋蝦仁」；online-nut「瘦牛肉義大利麵」。
- 為何適合減脂：麵食是午晚餐最常見的主食選擇之一，使用者兩週後單調的來源常是「每天都吃糙米飯」。
- 風險：碳水高（通心粉乾 20 g ≈ 1 份，約 70 kcal，但實際吃 1 碗熟麵 ≈ 3 份）；低碳開關下大多被排除。

**C2. 湯麵／米苔目／粥類**　午、晚　seasoned: true　需 method_boil、新主食
- 蛋白質：egg, chicken_breast, shrimp, firm_tofu；主食：米苔目、白粥（缺）；蔬菜：cabbage, bean_sprout, spinach, celery；烹調法：method_boil。
- 出處：senior#8 米苔目湯；senior#3 健康蔬菜粥；`plate` 素食早餐「地瓜稀飯」；fatloss-plan-demo `takeout.html`「粥／湯粉：瘦肉／牛肉＋雞蛋＋青菜＋常規主食」。
- 風險：粥與米苔目升糖較快、飽足感低；要使用者決定。**較不適合減脂主力，列為備選。**

**C3. 豬肉小炒類（青椒肉絲、蔥爆肉絲）**　午、晚　可併入 `protein_stir_fry`
- 需豬里肌（fx_pork_loin）；出處：BasketMate 菜名「青椒肉丝」；90531#3、90531#4；`1600` 計畫 2 午餐「烤里肌肉片」；online-nut 沒有。
- 評價：這不用新骨架，只要把豬里肌加進 `protein_stir_fry`（與 `grain_bowl_baked`）的蛋白質軸。屬「擴充既有骨架 allow」，也需 B7／C3 審核。

### 沒有列入候選但值得知道的

- 韓式拌飯（kimchi＋egg＋beef_shank＋spinach／bean_sprout）：我沒有在任何本地來源或搜尋結果讀到出處，只是用現有 id 的推論，**不列為候選**。
- 豬肝、皇宮菜麻油豬肝（senior#9）：膽固醇與內臟，且缺食材，不建議。
- 蛋糕、甜品類（90531#9 山藥甜拌、#13 洛神花茶）：含糖，與減脂方向不符。

### 擴充既有骨架 allow（不算新骨架，但屬 C3 變更）

這些只改 `allow`，成本最低、單調感改善最快（需要新食材的除外）：
1. `protein_stir_fry` 蛋白質軸加 `egg`、`firm_tofu`（番茄炒蛋、麻婆豆腐式家常菜；BasketMate 菜名、`1600` 嫩煎豆腐）；主食軸加 `mixed_grain_rice_cooked`（甲類，現有 id）。
2. `egg_pan` 蔬菜軸加 `shiitake`、`wood_ear`、`bean_sprout`（senior#5 咖哩菇菇歐姆蛋、senior#11 菠菜起司烘蛋）。
3. `grain_bowl_baked` 蛋白質軸加 `shrimp`、`beef_shank`、`egg`。
4. 加新食材後（第 3 節）：豬里肌、鯖魚、豆干、胡蘿蔔、青江菜、大白菜等進相應軸。

## 3. 食材缺口

比對 `data/ingredients.json`（含食材、方法、醬料、隱含共 47 筆）與 `data/food_tree.json`（333 個分層品項）。「建議對應」優先列 `food_tree.json` 已有的 `fx_` id；樣品編號為衛福部（TFDA）。**因 B7 只認 ingredients.json，下表每一項都要先進 ingredients.json（走 build-ingredients，需標註過敏原／素食，章程 B6）才能被骨架引用。**

| 缺的食材 | 建議對應 | 缺了哪些候選做不成／變弱 | 備註 |
|---|---|---|---|
| 豬里肌／豬瘦肉 | `fx_pork_loin` 豬大里肌（I0304101）；另有 `fx_pork_ham_lean`（I0302301） | C3、擴充炒類；A2 變弱 | 台灣最常見家常肉；多份轉錄食譜出現 |
| 豬絞肉 | TFDA I0310402 豬絞肉(90%瘦肉率)；`food_tree` 未見對應 | B6 原型（胡瓜釀肉）；senior#3、#4 | `food_tree` 沒收，需新增對應；與 B1 重疊，優先序低 |
| 鯖魚 | TFDA J0414701 鯖魚(生)；`food_tree` 未見 | `1600` 計畫 2 晚餐「鹽烤鯖魚」做不成（B1、A2 的魚類選擇變少） | 代換表沒有鯖魚，需 TFDA 直接對應 |
| 鱈魚 | `fx_cod`（J0415701） | B1 原型「清蒸鱈魚」（`1600`）；現可用鯛魚、鮭魚代 | |
| 秋刀魚 | `fx_saury`（J0416501） | A4 原型（senior#10） | 可用 tilapia 代 |
| 虱目魚 | `fx_milkfish`（J04010） | 無來源直接點名；是台灣家常魚，僅供參考 | 本次來源未提到，不列入必要 |
| 豆干／干絲 | `fx_dried_tofu_shreds` 干絲（R4700201）、`fx_small_dried_tofu` 小方豆干（R4700203） | `plate` 素食午餐「炒干絲」；素食蛋白質選擇少 | 現有素食蛋白質只有豆腐、毛豆、豆漿 |
| 嫩豆腐 | `fx_soft_tofu`（R4701201） | B5 的秋葵豆腐（senior#7 用盒裝豆腐，可用板豆腐代） | 可不補 |
| 胡蘿蔔 | `fx_carrot`（E02001） | `1600`、senior#3、90531#7、#14、#15、#16、online-nut 都出現；做不成「炒綜合蔬菜」 | **最常被來源提到的缺口**，優先 |
| 青江菜 | `fx_qingjiang`（E3201202） | `1600` 水煮青江菜、`plate` 晚餐、senior#2 | 台灣最日常的葉菜之一 |
| 大白菜 | `fx_napa_cabbage` 山東白菜（E33001）；亦有包心白菜 `fx_head_cabbage_bok` | B3 原型（白菜燉雞湯）、`plate` 開陽白菜 | 現可用 cabbage（高麗菜）代 |
| 地瓜葉 | `fx_sweet_potato_leaves`（E3100101） | web（滷味攤常見）、`plate` 素食早餐 | |
| 韭菜 | `fx_chives`（E2600201） | senior#8 | 低 |
| 杏鮑菇 | TFDA G13002 杏鮑菇平均值；`food_tree` 未見（只有洋菇、金針菇、猴頭菇…） | senior#4、90531#8 | 菇類現有只有鮮香菇、木耳 |
| 金針菇／洋菇 | `fx_enoki`（G1600101）、`fx_button_mushroom`（G2000101） | senior#5、`plate` 西式晚餐（蘑菇） | |
| 苦瓜 | `fx_bitter_melon`（E6500101） | `plate` 素食午餐 | 低 |
| 馬鈴薯 | `fx_potato`（B0700202） | online-nut「鮭魚配馬鈴薯」；現可用地瓜代 | 主食多樣化 |
| 山藥／蓮藕／玉米粒 | `fx_yam`（B01002）、`fx_lotus_root`（B0900101）、`fx_corn`（A0400301） | 90531#9、#12；`plate` 西式午餐玉米飯 | 主食軸 |
| 白飯 | `fx_cooked_rice`（A0550601） | online-nut 多道、`plate` 素食晚餐；現有只有糙米飯、雜糧飯 | 要不要白飯是口味決定（第 6 節） |
| 麵條（熟） | `fx_cooked_noodles`（R2000101）；`fx_macaroni` 通心粉（乾，找不到義大利麵） | C1 做不成 | 麵食是口味決定 |
| 米苔目／白粥 | `fx_rice_noodle_tube`（R1100601）、`fx_congee`（A05002） | C2 做不成 | 同上 |
| 小卷（鎖管）／蛤蜊 | 小卷：TFDA J3500501 台灣鎖管；蛤蜊：TFDA 清單搜尋 0 筆，只有文蛤 J3100901 | B4 原型的海鮮 | 海鮮＋甲殼類／軟體動物過敏原標註（B6） |
| 海帶、紫菜 | TFDA 藻類 F0700101 海帶卷、F0210101 紫菜（乾貨）；`food_tree` 未見 | 90531#11；台灣湯品常見 | 低 |
| 味噌 | TFDA P1200101（調味料及香辛料類） | senior#6 味噌茄子（蒸）；放醬料軸（比照 teriyaki_sauce 含黃豆、麩質、未確認） | 醬料軸現只有泡菜與照燒醬 |
| 蔥、薑、蒜 | TFDA 青蔥 E23001、嫩薑 E1900101、大蒜 E2100101 | 多數轉錄食譜出現 | **建議不做成槽位**，視為調味，不影響推薦 |

統計：共列 **27 項**缺口食材（含蔥薑蒜 1 組不建議做槽位）；其中被兩個以上候選或兩份以上來源需要的「優先補」只有 **6 項**：胡蘿蔔、青江菜、豬里肌、鯖魚（或鱈魚）、豆干、大白菜。其他視使用者口味決定。

甲類候選（A1、A2、A3）與乙類候選（B1–B5）**都不需要任何新食材**即可成立，食材缺口不是第一瓶頸。

## 4. 烹調法缺口

現有：`method_no_cook`、`method_microwave`、`method_pan_fry`、`method_stir_fry`、`method_air_fry`（含 `implicit` 用油規則：煎 5 g、炒 5 g＋有蔬菜再 5 g、其餘 0）。缺：

| 缺的烹調法 | 需要它的候選 | 來源佐證 | 設計要點（供審核） |
|---|---|---|---|
| 蒸（電鍋蒸） | B1、B5、B6 | `1600` 清蒸鱈魚、`plate` 蒜茸蒸魚、senior#6、90531#7 | 用油 0；`prep_tier` 可標 🟡；若沿用 `requires_cooking`／免開火檢查不受影響 |
| 水煮／燙 | B3、B4、B5、C2 | `1600` 水煮青江菜、水煮花椰菜；senior#7、90531#6、#16 | 用油 0 |
| 滷／燉煮 | A4、B2、B3 | `1600` 滷豆腐、senior#2、#10、#12、90531#12、`plate` 蒜香燉雞肉 | 用油 0；鈉要用 `seasoning_normal` 估；可把「燉」與「滷」合併成一個 id 以免過細 |

每個新烹調法都要有 `implicit`（章程 B12：烹調法有 `implicit`），而且會影響自煮 `meal_content` 的用油與調味邏輯、`method_id` 的資料庫驗證與推薦快照，屬 C3 變更，要連同檢查工具一起審。

## 5. 風險與待決

**需要使用者決定口味方向：**
1. **要不要湯品**（B3、B4）：湯的熱量很低，且台灣家庭湯與主餐的搭配是「一餐內的一碗」，不是獨立的一餐；推薦卡片怎麼顯示、熱量湊不湊得夠預算要先想。
2. **要不要麵食與白飯**（C1、C2）：減脂App 常預設糙米，但單調感來自「每天糙米飯」；若加白飯與麵，低碳開關會把它們大量排除，且需要在 UI 說明份量（1 碗熟麵≈3 份）。
3. **要不要豬肉**：現有蛋白質無豬肉（只有雞、牛、魚蝦、蛋、豆類），台灣家常菜缺豬肉會讓使用者覺得不像日常飯菜；加豬里肌需標過敏原與素食（無過敏原詞彙，A 類）。
4. **鹹湯／滷的鈉**：滷與湯的鈉通常高，是否要顯示高鈉提醒（章程 B5.7 的調味估算）。

**可能與章程 B7 或推薦演算法衝突：**
1. **B7.1 只認 ingredients.json**：任何新食材要先過 B2、B4、B6（出處、數值、過敏原與素食標註）才能進骨架，所以丙類候選與擴充 allow 都是「兩步走」，不能一個 commit 搞定。
2. **B7.3「食材沒被任何骨架引用 → 警告」**：目前零警告；新增食材一定要同時被骨架引用，否則出現警告。
3. **無主食骨架的縮放風險**（A2、A3、B3、B5）：主要槽位改成蛋白質，`PRIMARY_SLOT_SCALE_RANGE` 0.5–2.0 可能湊不到預算（例：一餐 500 kcal，雞胸 154 kcal ×2＝308 kcal），這類骨架可能整批被推薦排除，起草後一定要用 `tools/diff-recs.js` 看各時段候選數與熱量分布。
4. **笛卡兒積限制**：同一骨架內蛋白質與蔬菜的所有配對都會出現，若骨架內有「不合理配對」只能靠拆骨架，不能靠 `allow` 微調（例：B2 的「滷豆腐配滷白菜」與「燉牛腱配蘿蔔」會產生所有交叉組合）。審核時要看每個骨架內的配對是否都可接受。
5. **`seasoned` 與 `not_included`（B7.2、B7.5）**：B1–B5 需決定 `seasoned`（滷／湯調味重＝true）；`warm_salad` 的「未含沙拉醬」那類要寫 `not_included` 的候選，A3 涼拌若加醬汁就要寫。
6. **推薦池主導問題**：`grain_bowl_baked` 約占現有組合的 78%，新骨架若組合數少很多（A3 11 組、B4 36 組、B5 27 組），在推薦池中被抽到的機率很低，單調感不見得改善；組合數與推薦抽樣方式（是否按骨架平衡）需要核對 `engine` 的抽樣邏輯，本次沒有查。
7. **蛋白質重複**：同一食材（雞腿、蛋）出現在越多骨架，使用者越會覺得「還是那幾樣」；新骨架的價值來自**不同做法＋不同蛋白質**，單純換骨架但食材相同（A4 若只用炒）效果有限。

## 6. 值得先做的 3–5 個（建議順序）

1. **B1 清蒸魚定食**（乙類，需 method_steam）：來源最多（`1600`、`plate`、BasketMate、senior、90531）、最道地、零油，現有 16 個 id 都夠用；先補「蒸」這一個烹調法就同時解鎖 B1、B5。
2. **B2 滷／燉定食**（乙類，需 method_braise）：台灣便當與家庭最常見的做法，沒有蔬菜與蛋白質新缺口，補一個烹調法即可；與 B1 一起補「蒸、滷」兩個烹調法就能一批審核。
3. **A1 蛋飯類**（甲類，零缺口）：現有食材、現有烹調法就能起草，是風險最低、最快見效的新午晚餐骨架。
4. **A2 低碳蛋白質蔬菜盤**（甲類）：對低碳使用者價值最高，但要先用 diff-recs 驗證縮放風險；若不通過就不做，改為擴充既有骨架。
5. **擴充既有骨架 allow（`protein_stir_fry` 加 egg、firm_tofu、mixed_grain；`egg_pan` 加菇類）**：成本最低，與上面一起打包進同一批 C3 審核。

食材面最值得先補的是胡蘿蔔、青江菜、豬里肌、大白菜、豆干（來源重複率最高），但不阻擋上面 1–3 項。

## 7. 資料來源

**本地轉錄（已讀）：**
- `D:\ok\lighten\collab\transcripts\recipes_1600_1800.json`：2 份計畫的三餐菜色（全部讀過，數字全缺）。
- `senior_recipes.json`：12 道食譜的食材與步驟（全部讀過）。
- `90531.md`：16 道季節食譜（讀第 36–165 行，全部 16 道的材料與流程；廚餘堆肥章節未讀，與菜色無關）。
- `my_plate.json`：`meal_examples` 九餐範例（全部讀過）；`my_plate.md` 只掃讀口訣與一個範例段落，其餘未逐字讀。
- `README.md`：已讀，僅用於確認各檔出處。
- `daily_food_guide.md`：**沒有實際讀內文**（只確認 README 對它的描述：六大類食物簡介、份量，與組餐結構無直接關係）。

**本地參考專案（只讀、未執行）：**
- `book/online-nutritionist-main/backend/prisma/seed.ts` 第 1150–1700 行：自帶 12 道餐點定義（午餐 4、晚餐 3、早餐 3、點心 3），這是整個 `book/` 裡唯一有「餐點＝食材組合」的資料。
- `book/BasketMate-main/frontend/app/docs/菜篮子/数据库/recipes.csv`：12 筆菜名（麻婆豆腐、紅燒肉、清蒸鱸魚、青椒肉絲、番茄炒蛋、土豆燉牛肉等）；食材欄是 uuid，無法解回食材名，所以只當菜名佐證。
- `book/fatloss-plan-demo-main/takeout.html`：外賣選擇的組合邏輯（米飯類、輕食碗、日料、粥／湯粉），讀了第 11–31 行；`diet.html`、`ai-food.html`、`script.js` 只用 grep 掃餐點關鍵字，**沒有食譜資料**。
- `book/zaofang-local-recipes-main`：讀了 README、`docs/NUTRITION_DESIGN.md` 開頭、`scripts/generate-nutrition-data.mjs` 開頭；這是食譜管理 App 框架，**沒有內建食譜**（`app/data` 只有 USDA 營養資料）。
- `book/ai-diet-agent-main`：讀 README 與 `app/agents/prompts.py`；只有「食材辨識＋給 1–2 個低油低鹽做法」的提示詞，**沒有菜色資料**。
- `book/xianghong-site-main`：檔名與 `q02.html` 開頭，是《生理學與生物化學》題庫網站，**與菜色無關**。
- `book/nutritious-meals-project-master`：讀 README；是 Android 營養師開菜單 App，菜單圖片（menu_all.png）**沒有開圖看**，所以沒有資料。
- `book/foodwake-master`、`book/BasketMate-main` 其他檔：未讀（foodwake 只看到爬蟲目錄，BasketMate 其他為後端／前端程式）。

**網路（WebSearch 取得的標題與摘要，我沒有 WebFetch 打開內文）：**
- 國健署「我的餐盤」與鐵路便當、外食組合：<https://www.commonhealth.com.tw/article/80458>、<https://www.mohw.gov.tw/fp-3794-41108-1.html>、<https://health.tvbs.com.tw/regimen/308852>（自助餐怎麼夾才好）。
- 營養師減脂家常做法（清蒸、汆燙、清燉、滷；滷味攤蔬菜夾 2–3 種；醬料越稀越好）：<https://health.tvbs.com.tw/nutrition/339240>。
- 這兩次搜尋只取到摘要，**引用的是搜尋摘要的結論，沒有逐頁驗證內文**，審核時請當輔助佐證，不當主要出處。

## 8. 我沒查的範圍

- 沒有打開原始 PDF（`collab/pdf/`），全部靠轉錄檔；沒有重新核對轉錄內容。
- `daily_food_guide.md`、`vegetarian_food_guide.md`、`national_dietary_indicators.md` 沒讀（組餐結構與份數建議，非菜色）。
- 沒有查 TFDA 資料庫的個別品項數據（只確認品名與樣品編號存在），沒有算候選的熱量與營養素；A2、A3、B3、B5 的「熱量可能湊不到預算」是用 `ingredients.json` 的 `per_100g × serving_g` 手算的量級，沒有跑 `tools/diff-recs.js` 或 `check-engine`。
- 沒有查推薦引擎的抽樣方式（是否按骨架平衡）、「近期降權」是否按骨架層級，這決定新骨架實際被推薦的機率。
- 沒有查章程 B6（過敏原／素食標註）對候選新食材逐項的標註結果，也沒有查 B5.6–B5.7 對新烹調法的用油規則細節。
- 網路只做了兩次搜尋，沒有打開網頁內文；沒有查健身餐盒品牌菜單、台灣便當連鎖菜單、營養師書籍。
- 沒有向使用者確認口味方向（湯、麵、白飯、豬肉）。
- 驗證腳本在 `C:\Users\Max\AppData\Local\Temp\claude\d--ok-lighten\89bfef84-6faa-470e-8696-6a31bdd9e194\scratchpad\archetype\check.js`（確認候選的 id 都存在且 axis 相符、算組合數）；候選 A1–A4、B1–B5 的現有 id 清單都通過檢查（無 BAD 輸出）。
