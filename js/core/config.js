// 型態列舉與門檻常數（唯一來源，章程 C2）

// 一餐的型態（PRD 0.1 第 7 點）
export const MEAL_TYPES = ["convenience", "delivery", "cook_quick", "cook_full"];

// 過敏原固定詞彙（章程 B6.1）：基本資料的勾選框選項，資料與我的品項的 allergen_tags 也只用這些詞
// 花生與堅果分開（台灣法規）；軟體動物指蚵、花枝、章魚、貝類（decisions #18）；芒果是台灣過敏原標示規定的項目（decisions #88）
export const ALLERGEN_OPTIONS = ["甲殼類", "軟體動物", "魚", "蛋", "乳製品", "花生", "堅果", "麩質", "黃豆", "芝麻", "芒果"];
// 沒逐項確認過成分時標這個；使用者只要設了任何過敏原，這類品項一律排除
export const UNVERIFIED_ALLERGEN = "未確認";

// daily_log.source
// from_plan：預約「記下」；backfill：補記與昨天的 S/M/L；skipped：「這餐沒吃」（0 大卡，decisions #140⑥）
export const LOG_SOURCES = ["rec_accepted", "manual", "from_plan", "backfill", "skipped"];

// 補記過去的一餐最多回推幾天（不含今天，decisions #120）
export const BACKFILL_DAYS = 7;

// 自組食譜只有主要槽位縮放，範圍約半份到兩份（章程 C4.6）
export const PRIMARY_SLOT_SCALE_RANGE = { min: 0.5, max: 2.0 };

// 依序分配後，時段當下配額低於此門檻就標記「額度用完」
export const LOW_BUDGET_THRESHOLD_KCAL = 150;

// 沒有代表值、且熱量區間高/低 ≥ 1.5 倍的外食品項不進推薦池（手動選照樣可用）
export const WIDE_RANGE_RATIO = 1.5;

// 低碳（基本資料的獨立開關，只影響推薦）：一餐碳水上限（章程 B6.6、decisions #26）
export const LOW_CARB_MEAL_MAX_G = 30;

// 手動記錄（自己選）每個角色的數量上限；不要求必須有主餐（章程 C4.8、decisions #20）。推薦生成另有更嚴的規則（C4.7，pool.js）
export const MANUAL_ROLE_MAX = { main: 1, side: 1, drink: 1, snack: 1 };
// 主餐上限依時段（decisions #41）：「雞胸＋蒸地瓜」這類兩個主餐的一餐要能記；沒列的時段用 MANUAL_ROLE_MAX
export const MANUAL_MAIN_MAX_BY_SLOT = { breakfast: 2, lunch: 2, dinner: 2 };

// 沒有時段（slot === null：我的組合的解析、存檔前驗證與編輯模式）時主餐上限 2（decisions #63、#125）
export const SAVED_MEAL_MAIN_MAX = 2;

export function manualRoleMax(role, slot) {
  if (role === "main" && slot === null) return SAVED_MEAL_MAIN_MAX;
  if (role === "main" && MANUAL_MAIN_MAX_BY_SLOT.hasOwnProperty(slot)) return MANUAL_MAIN_MAX_BY_SLOT[slot];
  return MANUAL_ROLE_MAX[role] || 1;
}

export const ROLE_LABELS = { main: "主餐", side: "配菜", drink: "飲料", snack: "點心" };

// 選擇器的份量倍數（PRD 12.3、decisions #66）：只用在商品元件（不用在單品），db.js 驗證只接受這幾個值
export const QTY_OPTIONS = [0.5, 1, 1.5, 2];

// 單品（food 元件，PRD 13.4、decisions #122）：一餐最多 4 項、不佔角色名額；份量步進器 0.5 一格、0.5–12
export const FOOD_MAX_PER_MEAL = 4;
export const FOOD_QTY_STEP = 0.5;
export const FOOD_QTY_MAX = 12;

// 單品份量是否合法（db 寫入驗證與 engine 共用）
export function isFoodQty(q) {
  return typeof q === "number" && isFinite(q) && q >= FOOD_QTY_STEP && q <= FOOD_QTY_MAX && Number.isInteger(q / FOOD_QTY_STEP);
}

// 單品的克數記法（PRD 13.4、decisions #136、#138）：實際吃的 g 或 ml，整數 1–3000；跟 qty 擇一
export const FOOD_AMOUNT_MAX = 3000;
export function isFoodAmount(a) {
  return Number.isInteger(a) && a >= 1 && a <= FOOD_AMOUNT_MAX;
}

// 我的食材的組（PRD 12.4、decisions #134）：代換表六大類，對不上的是 other
export const INGREDIENT_GROUPS = ["dairy", "protein", "grain", "vegetable", "fruit", "fat", "other"];

// 自煮分頁的多選上限（PRD 6.3 的軸上限）；主食、醬料、烹調法單選
export const COMPOSE_MAX = { protein: 2, vegetable: 3 };

// 自煮的隱含成分（章程 B5.6–B5.7）：用油食材 id、基本資料「家裡用油習慣」的倍數、調味程度對應的食材 id
export const COOKING_OIL_ID = "cooking_oil";
export const OIL_HABIT_FACTOR = { normal: 1, less: 0.5 };
export const SEASONING_IDS = { light: "seasoning_light", normal: "seasoning_normal" };
// 「自己選」煎、炒時可以改的用油量：約 1 茶匙、約 2 茶匙（章程 B5.6；另一個選項是依用油習慣算的預設）
export const OIL_TSP_OPTIONS_G = [5, 10];

// 鈉只中性顯示「鈉 約 X mg（參考 2400 mg）」，不上色、不警告、不參與推薦（章程 C4.14、decisions #14）
export const SODIUM_REFERENCE_MG = 2400;

// 纖維週日均下限（25–35g 取下限 25 當硬約束）
export const FIBER_FLOOR_G = 25;

// 免開火烹調法的食材 id：這個烹調法不能搭配需要煮熟的食材（章程 C4.3，推薦候選池與自己選共用）
export const NO_COOK_METHOD_ID = "method_no_cook";

export const TIER_RANK = { "🟢": 0, "🟡": 1, "🔴": 2 };
export const RANK_TO_TIER = { 0: "🟢", 1: "🟡", 2: "🔴" };

export function tierRank(t) {
  return TIER_RANK.hasOwnProperty(t) ? TIER_RANK[t] : 2;
}

// 快煮＝食材與烹調法都 ≤🟡（PRD 第 3 節）；推薦的來源過濾、紀錄型態推導、自煮分頁的灰階共用這一個門檻
export const QUICK_MAX_TIER_RANK = 1;

export function isQuickTier(rank) {
  return rank <= QUICK_MAX_TIER_RANK;
}

// 「找不到？直接估算」的 S/M/L 熱量（沿用 v1 美饗日曆的大餐份量估算；Phase 0 的估算卡片使用，PRD 第 9 節）
export const ESTIMATE_SIZE_KCAL = { S: 400, M: 700, L: 1200 };

// 「昨天的餐」回想估算的 S/M/L（decisions #142④）：依時段分三組；選擇器的估算卡仍用上面那組（日後統一）
export const ESTIMATE_RECALL_KCAL = {
  breakfast: { S: 300, M: 500, L: 800 },
  main: { S: 400, M: 700, L: 1200 },
  light: { S: 150, M: 300, L: 500 },
};
// 「主食＋家常菜」估算的 est 欄位列舉（PRD 第 3 節、decisions #151；db 驗證與 engine 共用）
export const EST_SIZES = ["S", "M", "L"];
export const EST_CATS = ["veg", "mixed", "meat"];       // 素菜／菜肉／純肉
export const EST_STAPLES = ["white", "brown", "mixed", "noodle", "none"];
export const EST_DISH_MAX = 4;
// 「主食＋家常菜」估算的份量常數（decisions #151）：菜的「全分量」S／M／L 是一個總量、分給 N 道（每道 1/N，4 道總量不比 1 道多）；
// 主食 S／M／L ＝ 2／4／6 熱量份（每份約 70 kcal），每份克數依主食種類；湯 1 碗約 250ml（1ml 當 1g）
export const EST_DISH_GRAMS = { S: 120, M: 160, L: 200 };
export const EST_STAPLE_PORTIONS = { S: 2, M: 4, L: 6 };
export const EST_STAPLE_G_PER_PORTION = { white: 40, brown: 40, mixed: 40, noodle: 60 };
export const EST_SOUP_ML = 250;
// 家庭共餐（decisions #152）：家常菜另計上限，不佔 FOOD_MAX_PER_MEAL；湯 1 碗＝250ml
export const HOME_MEAL_DISH_MAX = 4;
export const HOME_MEAL_SOUP_MAX = 1;
export const HOME_MEAL_SLOTS = ["lunch", "dinner"];
export const HOME_DISH_PREFIX = "hd_";
// 共餐的主食（白飯、糙米飯、雜糧飯、白麵）在分層資料裡的 id；check-data 比對 home_dishes.json 的 staples
export const HOME_STAPLE_REFS = ["fx_cooked_rice", "brown_rice_cooked", "mixed_grain_rice_cooked", "fx_cooked_noodles"];
// 打開估算卡時「菜量」預設選哪一格：每餐蛋白質目標（一天目標 ÷ 3）低於第一個門檻選小、高於第二個選大，其餘中（使用者 2026-10-04）。只決定預設，估算的數字永遠等於畫面上選的量
export const EST_DEFAULT_DISH_PROTEIN_CUTS = [30, 50];
export const EST_CAT_LABELS = { veg: "素菜", mixed: "菜肉", meat: "純肉" };
export const EST_STAPLE_LABELS = { white: "白飯", brown: "糙米飯", mixed: "雜糧飯", noodle: "白麵", none: "不吃" };
export const ESTIMATE_RECALL_GROUP = { breakfast: "breakfast", lunch: "main", dinner: "main", afternoon_tea: "light", snack: "light" };

// ---------- 新自煮（2026-10-11）：餐盒、早餐盤、早餐碗、家常餐 ----------
// 入口名稱；舊的餐型骨架（dish_archetypes.json）只保留給歷史紀錄與推薦線解析
export const COOK_ENTRIES = ["box", "plate", "bowl", "home"];
export const COOK_ENTRY_LABELS = { box: "餐盒", plate: "早餐盤", bowl: "早餐碗", home: "家常餐" };
// 做法（組裝類每個元件各選一個）：oil＝蛋白質用這個做法的下鍋油 g、vegOil＝蔬菜用的；rank＝難度（0🟢 1🟡 2🔴）。
// 用油量照章程 B5.6（煎、炒各 5g；蔬菜另加 5g；其餘 0）；水煮／燙、舒肥、生、直接吃是 2026-10-11 新增的做法
export const COOK_METHODS = {
  pan: { name: "煎", oil: 5, vegOil: 5, rank: 1 },
  stir: { name: "炒", oil: 5, vegOil: 5, rank: 1 },
  air: { name: "烤／氣炸", oil: 0, vegOil: 0, rank: 2 },
  steam: { name: "蒸", oil: 0, vegOil: 0, rank: 1 },
  braise: { name: "滷燉", oil: 0, vegOil: 0, rank: 2 },
  boil: { name: "水煮／燙", oil: 0, vegOil: 0, rank: 1 },
  sous: { name: "舒肥", oil: 0, vegOil: 0, rank: 2 },
  raw: { name: "生", oil: 0, vegOil: 0, rank: 0 },
  mw: { name: "微波", oil: 0, vegOil: 0, rank: 0 },
  cold: { name: "直接吃", oil: 0, vegOil: 0, rank: 0 },
};
export const COOK_BOX_PROTEIN_METHODS = ["pan", "air", "sous", "steam", "boil"];
export const COOK_PLATE_PROTEIN_METHODS = ["boil", "pan", "stir", "mw", "steam", "cold"];
export const COOK_VEG_METHODS = ["boil", "stir", "air", "raw"];
// 目標只是帶入預設（碳水份量、蛋白質份量），不是餐型
export const COOK_GOALS = { low: { label: "減糖", carbAmt: "half", pamt: 1 }, normal: { label: "一般", carbAmt: "one", pamt: 1 }, muscle: { label: "增肌", carbAmt: "one", pamt: 1.5 } };
export const COOK_PAMTS = [1, 1.5, 2];
export const COOK_CARB_AMTS = { half: 0.5, one: 1 };
export const COOK_PROTEIN_MAX = 3;
export const COOK_VEG_MAX = 3;
export const COOK_EGG_G = 50;
export const COOK_EGG_MAX = 3;
// 家常餐：非湯的菜（含一鍋菜）最多 4 道，道數決定每道炒煎蒸拌類的份量；湯一碗 250g、粥一碗 300g；選了整碗主食後加的菜取半盤（固定當 2 人份）
export const COOK_HOME_DISH_MAX = 4;
export const COOK_SOUP_G = 250;
export const COOK_CONGEE_G = 300;
export const COOK_HOME_SIDE_PEOPLE = 2;
// 家常餐每道菜的份量（2026-10-11）：炒煎蒸拌這類菜一份＝整盤 ÷ 道數，一鍋菜一份＝配方一人份
export const COOK_HOME_AMTS = [0.5, 1, 1.5];
// 只選 1 道炒煎蒸拌類的菜、整盤熱量超過這個數時，預設半份（只是預設，使用者可以改回一份）
export const COOK_HOME_DISH_KCAL_MAX = 700;
// 組裝類食材的一餐份量規則（由代換表一份換算；高脂肉減半、上限 250g）
export const COOK_MEAL_SERVINGS = { protein: 4, staple: 3 };
export const COOK_VEG_G = 100;
export const COOK_ITEM_CAP_G = 250;
export const COOK_FAT_HEAVY_PER_100 = 15;

// 自煮的預設清單（2026-10-11，唯一來源）：畫面「常見的」、推薦的建議池（☆ 不足時補預設）都讀這裡。每軸是有序的 id 清單，前面的優先。
// 食材用 cook.js 的選項 uid（內建食材原 id 或代換表 fx_ id）；家常菜是 hd_ id；主食格用 homeDishes.staples 的 ref 與整碗 hd_ id。
// 家常菜預設＝原 36 道加上非 🔴 的新菜（開伙才做的滷燉、烤不預設；要的人自己 ☆）。每個 id 是否存在、能不能用由 check-engine 檢查。
export const COOK_DEFAULTS = {
  box_protein: ["chicken_breast", "egg", "firm_tofu", "salmon", "shrimp", "tilapia_fillet", "chicken_thigh", "fx_pork_ham_lean", "edamame"],
  plate_protein: ["egg", "firm_tofu", "chicken_breast", "fx_five_spice_tofu", "fx_tuna", "fx_cheese_slice", "fx_ham"],
  carb: ["sweet_potato", "brown_rice_cooked", "mixed_grain_rice_cooked", "pumpkin", "fx_corn", "quinoa", "fx_potato", "cauliflower_rice"],
  veg: ["broccoli", "cabbage", "fx_sweet_potato_leaves", "spinach", "fx_carrot", "baby_corn", "bell_pepper", "cucumber", "tomato", "lettuce_a", "snap_pea"],
  bowl_base: ["greek_yogurt", "soy_milk", "fx_lowfat_milk"],
  bowl_grain: ["oats", "quinoa"],
  bowl_fruit: ["fx_banana", "fx_fuji_apple", "fx_kiwi", "fx_strawberry", "fx_native_guava", "fx_papaya", "fx_orange", "fx_pineapple"],
  bowl_nut: ["fx_almond", "fx_walnut", "fx_cashew", "fx_peanut"],
  home_staple: ["brown_rice_cooked", "mixed_grain_rice_cooked", "fx_cooked_rice", "fx_cooked_noodles"],
  home_complete: ["hd_wb_friedrice", "hd_wb_eggrice", "hd_wb_sesamenoodle", "hd_wb_dumpling", "hd_d12_017"],
  home_main: [
    "hd_tomato_egg", "hd_green_pepper_pork", "hd_kung_pao_chicken", "hd_oyster_kailan_beef", "hd_braised_napa",
    "hd_mapo_tofu", "hd_steamed_perch", "hd_braised_dried_tofu_egg", "hd_braised_tofu", "hd_braised_chicken_leg",
    "hd_chive_egg", "hd_luffa_egg", "hd_broccoli_shrimp", "hd_water_spinach_beef", "hd_eggplant_pork", "hd_spinach_tofu",
    "hd_wood_ear_pork", "hd_three_cup_chicken", "hd_pan_salmon", "hd_scallion_beef", "hd_d12_001", "hd_d12_003",
    "hd_d12_004", "hd_d12_006", "hd_d12_007", "hd_d12_010", "hd_d12_011", "hd_d12_012", "hd_d12_013", "hd_d12_040",
    "hd_d12_046", "hd_d12_047", "hd_d12_048", "hd_d12_049", "hd_d12_050", "hd_d12_068", "hd_d12_072", "hd_d12_081",
    "hd_d12_084", "hd_d12_085", "hd_d12_087",
  ],
  home_veg: [
    "hd_garlic_cabbage", "hd_garlic_qingjiang", "hd_garlic_sweet_potato_leaves", "hd_cold_cucumber", "hd_garlic_water_spinach",
    "hd_stirfry_luffa", "hd_stirfry_bitter_melon", "hd_garlic_spinach", "hd_garlic_broccoli", "hd_garlic_crown_daisy",
    "hd_garlic_asparagus", "hd_stirfry_cauliflower", "hd_d12_009", "hd_d12_015", "hd_d12_044", "hd_d12_069",
    "hd_d12_070",
  ],
  home_soup: [
    "hd_daikon_rib_soup", "hd_napa_chicken_soup", "hd_seaweed_egg_soup", "hd_winter_melon_rib_soup", "hd_d12_019",
    "hd_d12_020", "hd_d12_023", "hd_d12_024", "hd_d12_063", "hd_d12_107", "hd_d12_109",
  ],
};
// 早餐盤的碳水預設＝早餐碳水（吐司、饅頭、蘿蔔糕、油麵，cook.js 的 PLATE_CARBS）加上上面的 carb
// 來源偏好是「自動」時的順序（2026-10-11，使用者定）：先試自煮（快煮），沒有可用的再試外食，再試超商；
// 下午茶與宵夜的自煮只有早餐碗，沒有可用時第二順位改成「超商與外食一起比分」，免得下午茶被推去買台式外食。
// 「可用」＝這個來源最貼近預算的份量，熱量與配額差在容許範圍內（配額低於 AUTO_LOW_BUDGET_KCAL 時放寬）。
export const AUTO_TOLERANCE = 0.35;
export const AUTO_TOLERANCE_LOW_BUDGET = 0.5;
export const AUTO_LOW_BUDGET_KCAL = 250;
export const AUTO_LIGHT_SLOTS = ["afternoon_tea", "snack"];
// 新自煮推薦的零件角色：哪些算「主蛋白質／主菜」（同一天不重複）、近期降權的權重（蛋白質與主菜最重，蔬菜較輕；沒列的角色不降權）
export const COOK_MAIN_ROLES = ["protein", "dish"];
// 少數食材自己的蛋白質做法偏好（餐盒、早餐盤；其餘照全域偏好序 水煮→蒸→煎）
export const COOK_METHOD_PREFER = { salmon: "pan", shrimp: "boil" };
// 碳水也降權（2026-10-11）：不然纖維高的玉米粒每天都贏（decisions #156）
export const COOK_PART_RECENCY = { protein: 20, dish: 15, veg: 10, carb: 10 };
// 自煮一餐的纖維加分上限＝這一餐配額 × 每千大卡 14g（週缺口是「每天差幾克」，不能拿來當一餐的上限）
export const FIBER_G_PER_1000KCAL = 14;
// 建議池每軸至少幾樣（2026-10-13，decisions #159）：常吃不足時用預設依序補到這個數，常吃達到或超過就只用常吃。
// 數字＝預設清單的數量與池子上限（cook-rec.js 的 CAP）較小的那個：標幾個常吃，預設就少幾個，池子大小不變（不會因為標了一個就縮成 3 個）。
export const COOK_POOL_MIN = { protein: 9, carb: 8, veg: 9, home_main: 24, home_veg: 12, home_soup: 6, bowl_base: 3, bowl_grain: 2, bowl_fruit: 8, bowl_nut: 4 };
// 預設清單的涵蓋度下限（check-engine 用）：快煮、素食、每一季下預設至少還剩幾樣可用（原本的 COOK_POOL_MIN）
export const COOK_POOL_COVER = { protein: 3, carb: 2, veg: 4, home_main: 4, home_veg: 3, home_soup: 2 };
