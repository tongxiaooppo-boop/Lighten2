// 型態列舉與門檻常數（唯一來源，章程 C2）

// 一餐的型態（PRD 0.1 第 7 點）
export const MEAL_TYPES = ["convenience", "delivery", "cook_quick", "cook_full"];

// 過敏原固定詞彙（章程 B6.1）：基本資料的勾選框選項，資料與我的品項的 allergen_tags 也只用這些詞
export const ALLERGEN_OPTIONS = ["甲殼類", "魚", "蛋", "乳製品", "堅果", "麩質", "黃豆", "芝麻"];
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

// 纖維週日均下限（25–35g 取下限 25 當硬約束）
export const FIBER_FLOOR_G = 25;

export const TIER_RANK = { "🟢": 0, "🟡": 1, "🔴": 2 };
export const RANK_TO_TIER = { 0: "🟢", 1: "🟡", 2: "🔴" };

export function tierRank(t) {
  return TIER_RANK.hasOwnProperty(t) ? TIER_RANK[t] : 2;
}

// 「找不到？直接估算」的 S/M/L 熱量（沿用 v1 美饗日曆的大餐份量估算；Phase 0 的估算卡片使用，PRD 第 9 節）
export const ESTIMATE_SIZE_KCAL = { S: 400, M: 700, L: 1200 };
