// 輕盈計畫 — 推薦卡片插圖的「餐點種類」（2026-11-21 使用者：推薦中式就給中式的圖，外食分中西式，自煮合菜跟簡易餐盒分開）。
// 只回傳種類代碼；圖檔路徑由 ui/skin.js 依外觀風格組出來。下午茶、宵夜不分種類（回傳 null，用時段圖）。

// 外食主餐歸西式的分類；其他（含日式）都歸中式（使用者 2026-11-21 定：日式歸中式）
export const WESTERN_CATEGORIES = ["西式速食", "西式"];

// 全部的種類代碼（圖檔名是 kind-<代碼>.jpg，三種風格都要有）
export const MEAL_IMAGE_KEYS = [
  "bf-chinese", "bf-western", "cook-plate", "cook-bowl",
  "chinese", "western", "convenience", "cook-home", "cook-box",
];

// rec：今日建議的候選（pool.js 的現成組合或 cook-rec.js 的自煮候選）；slot：時段。
// 回傳 MEAL_IMAGE_KEYS 之一，或 null（不分種類，用時段圖）。
export function mealImageKey(rec, slot) {
  if (!rec) return null;
  const breakfast = slot === "breakfast";
  const mainMeal = slot === "lunch" || slot === "dinner";
  if (!breakfast && !mainMeal) return null;
  if (rec.is_cook_form) {
    const byEntry = breakfast ? { plate: "cook-plate", bowl: "cook-bowl" } : { home: "cook-home", box: "cook-box" };
    return byEntry[rec.entry] || null;
  }
  if (rec.is_convenience) return "convenience";
  if (rec.is_delivery) {
    const western = rec.cuisine === "western";
    return breakfast ? (western ? "bf-western" : "bf-chinese") : (western ? "western" : "chinese");
  }
  return null;
}
