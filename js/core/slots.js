// 時段（唯一來源，章程 C2）：清單、中文標籤、預設權重、預設開關、各時段的預設來源偏好。

export const SLOTS = ["breakfast", "lunch", "afternoon_tea", "dinner", "snack"];

export const SLOT_LABELS = { breakfast: "早餐", lunch: "午餐", afternoon_tea: "下午茶", dinner: "晚餐", snack: "宵夜" };

// 無紀錄時的預設切分比例（早20%／午30%／下午茶10%／晚30%／宵夜10%）
export const SLOT_WEIGHTS = {
  breakfast: 0.20,
  lunch: 0.30,
  afternoon_tea: 0.10,
  dinner: 0.30,
  snack: 0.10,
};

// 今日建議時段的預設開關（早/午/晚預設開啟，下午茶/宵夜預設關閉）
export const DEFAULT_ENABLED_SLOTS = { breakfast: true, lunch: true, afternoon_tea: false, dinner: true, snack: false };

export function isSlotEnabled(enabledSlots, slot) {
  const slots = enabledSlots || {};
  return slots.hasOwnProperty(slot) ? slots[slot] !== false : DEFAULT_ENABLED_SLOTS[slot];
}

// 每個時段的「來源偏好」（profile.meal_prefs[slot]）：
//   "auto"：無偏好，tier 上限採中等難度（🟢🟡），不特別篩來源
//   其餘四個是型態（core/config.js MEAL_TYPES）
export const MEAL_SOURCE_OPTIONS = ["auto", "convenience", "delivery", "cook_quick", "cook_full"];
export const DEFAULT_MEAL_PREFS = { breakfast: "convenience", lunch: "convenience", afternoon_tea: "auto", dinner: "cook_full", snack: "auto" };
