// 型態列舉與門檻常數（唯一來源，章程 C2）

// 一餐的型態（PRD 0.1 第 7 點）
export const MEAL_TYPES = ["convenience", "delivery", "cook_quick", "cook_full"];

// 過敏原固定詞彙（章程 B6.1）：基本資料的勾選框選項，資料與我的品項的 allergen_tags 也只用這些詞
// 花生與堅果分開（台灣法規）；軟體動物指蚵、花枝、章魚、貝類（decisions #18）
export const ALLERGEN_OPTIONS = ["甲殼類", "軟體動物", "魚", "蛋", "乳製品", "花生", "堅果", "麩質", "黃豆", "芝麻"];
// 沒逐項確認過成分時標這個；使用者只要設了任何過敏原，這類品項一律排除
export const UNVERIFIED_ALLERGEN = "未確認";

// daily_log.source
export const LOG_SOURCES = ["rec_accepted", "manual", "from_plan", "backfill"];

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

// 自煮的隱含成分（章程 B5.6–B5.7）：用油食材 id、基本資料「家裡用油習慣」的倍數、調味程度對應的食材 id
export const COOKING_OIL_ID = "cooking_oil";
export const OIL_HABIT_FACTOR = { normal: 1, less: 0.5 };
export const SEASONING_IDS = { light: "seasoning_light", normal: "seasoning_normal" };

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

// 「找不到？直接估算」的 S/M/L 熱量（沿用 v1 美饗日曆的大餐份量估算；Phase 0 的估算卡片使用，PRD 第 9 節）
export const ESTIMATE_SIZE_KCAL = { S: 400, M: 700, L: 1200 };
