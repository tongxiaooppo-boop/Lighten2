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
// 家常餐：非湯的菜最多 4 道；湯一碗 250g、粥一碗 300g；選了整碗主食後加的菜取半盤
export const COOK_HOME_DISH_MAX = 4;
export const COOK_SOUP_G = 250;
export const COOK_CONGEE_G = 300;
export const COOK_HOME_SIDE_PEOPLE = 2;
export const COOK_POT_AMTS = [0.5, 1, 1.5];
// 組裝類食材的一餐份量規則（由代換表一份換算；高脂肉減半、上限 250g）
export const COOK_MEAL_SERVINGS = { protein: 4, staple: 3 };
export const COOK_VEG_G = 100;
export const COOK_ITEM_CAP_G = 250;
export const COOK_FAT_HEAVY_PER_100 = 15;
