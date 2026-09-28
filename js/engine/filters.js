// 輕盈計畫 — 硬性過濾（唯一來源，章程 C2）：過敏原、飲食限制、不吃清單。
// 推薦候選、「自己選」的現成品項與自己煮的食材三處共用，確保同一個設定下擋掉的品項一致。
//
// ⚠️ Phase −1a 刻意保留的 v1 行為（−1b 修正，修掉會讓快照對不上）：
//   - 自訂食物（is_custom）略過過敏原檢查（章程 C4.1 要求拿掉這個例外）
//   - 不吃清單的自組食譜食材以名稱比對（章程 C2 要求改成 id）

// 過敏原固定詞彙（基本資料分頁的勾選框選項，資料裡的 allergen_tags 也只用這些詞）。
export const ALLERGEN_OPTIONS = ["甲殼類", "魚", "蛋", "乳製品", "堅果", "麩質", "黃豆", "芝麻"];
// 複合料理沒人逐項審過過敏原時標這個；使用者只要設了任何過敏原，這類品項一律排除。
export const UNVERIFIED_ALLERGEN = "未確認";
// 舊版是自由文字輸入，常見寫法對回固定詞彙（打「蝦」比對不到資料裡的「甲殼類」）。
const ALLERGEN_SYNONYMS = {
  "蝦": "甲殼類", "蝦子": "甲殼類", "蝦仁": "甲殼類", "蟹": "甲殼類", "螃蟹": "甲殼類", "甲殼": "甲殼類",
  "魚類": "魚", "海鮮": "甲殼類",
  "雞蛋": "蛋", "蛋類": "蛋",
  "牛奶": "乳製品", "奶": "乳製品", "乳": "乳製品", "乳糖": "乳製品", "奶製品": "乳製品", "起司": "乳製品",
  "花生": "堅果", "杏仁": "堅果", "核桃": "堅果",
  "小麥": "麩質", "麵粉": "麩質",
  "大豆": "黃豆", "豆漿": "黃豆", "豆腐": "黃豆", "黃豆製品": "黃豆",
};

// 回傳 { list: 固定詞彙陣列, unknown: 對不回固定詞彙的舊文字 }。
// 接受新版陣列，也接受舊版自由文字字串（逗號/頓號/空白分隔）。
export function normalizeAllergens(input) {
  const raw = Array.isArray(input)
    ? input
    : String(input || "").split(/[,、，;；\s]+/);
  const list = [];
  const unknown = [];
  raw.forEach(function (x) {
    const t = String(x || "").trim();
    if (!t) return;
    const mapped = ALLERGEN_OPTIONS.indexOf(t) !== -1 ? t : ALLERGEN_SYNONYMS[t];
    if (mapped) {
      if (list.indexOf(mapped) === -1) list.push(mapped);
    } else if (unknown.indexOf(t) === -1) {
      unknown.push(t);
    }
  });
  return { list: list, unknown: unknown };
}

// 使用者有設任何過敏原（含對不回固定詞彙的舊文字）→ 未確認的品項排除；命中任一過敏原 → 排除。
function passesAllergens(allergenTags, userAllergens) {
  if (userAllergens.list.length === 0 && userAllergens.unknown.length === 0) return true;
  if (allergenTags.indexOf(UNVERIFIED_ALLERGEN) !== -1) return false;
  return !userAllergens.list.some(function (a) { return allergenTags.indexOf(a) !== -1; });
}

function tagSatisfies(tags, restriction) {
  const t = tags || [];
  if (t.indexOf(restriction) !== -1) return true;
  return restriction === "蛋奶素" && t.indexOf("全素") !== -1; // 全素一定也符合蛋奶素
}

// 飲食限制逐成分判斷（章程 C4.2）：每個成分都要符合，烹調法不是食物不參與判斷。
function passesDiet(dietTagSets, dietRestriction) {
  if (!dietRestriction || dietRestriction === "一般" || dietRestriction === "無特殊限制") {
    return true;
  }
  return dietTagSets.length > 0 && dietTagSets.every(function (tags) {
    return tagSatisfies(tags, dietRestriction);
  });
}

// 回傳 { ok, reason }。item 有兩種形狀：推薦的候選組合（有 diet_tag_sets/components/protein_name 等），
// 以及挑選器裡的單一品項（有 allergen_tags/diet_tags/uid），兩種都要能吃。
export function passesHardFilters(item, profile) {
  const p = profile || {};

  // 1. 過敏原：自訂食物略過（v1 行為，−1b 拿掉這個例外），其餘照常判斷。
  const userAllergens = normalizeAllergens(p.allergens);
  const allergenTags = Array.isArray(item.allergen_tags) ? item.allergen_tags : [UNVERIFIED_ALLERGEN];
  if (!item.is_custom && !passesAllergens(allergenTags, userAllergens)) {
    return { ok: false, reason: allergenTags.indexOf(UNVERIFIED_ALLERGEN) !== -1 ? "成分未確認" : "含過敏原" };
  }

  // 2. 飲食限制：單一品項沒有多成分概念時包成 [diet_tags || []]。
  const dietTagSets = Array.isArray(item.diet_tag_sets) ? item.diet_tag_sets : [item.diet_tags || []];
  if (!passesDiet(dietTagSets, p.diet_restriction)) {
    return { ok: false, reason: "飲食限制未確認" };
  }

  // 3. 不吃食材：命中 profile.disliked_ingredients 就排除。
  const disliked = Array.isArray(p.disliked_ingredients) ? p.disliked_ingredients : [];
  if (disliked.length > 0) {
    const hit = findDislikedHit(item, disliked);
    if (hit) return { ok: false, reason: "你已設定不吃：" + hit };
  }

  return { ok: true, reason: null };
}

// 找出 item 命中哪個「不吃食材」。disliked 每項 { type, key, label }：
//   - 自組食譜：type 對應 protein/vegetable/staple/sauce，key 用名稱
//   - 現成品項：type='item'，key 用成分 uid（item.components）
function findDislikedHit(item, disliked) {
  const keys = [];
  if (item.is_composed) {
    if (item.protein_name) keys.push({ type: "protein", key: item.protein_name });
    if (item.staple_name) keys.push({ type: "staple", key: item.staple_name });
    if (item.vegetable_name) keys.push({ type: "vegetable", key: item.vegetable_name });
    if (item.sauce_name) keys.push({ type: "sauce", key: item.sauce_name });
  } else {
    const comps = Array.isArray(item.components) && item.components.length > 0
      ? item.components
      : (item.uid ? [item.uid] : []);
    comps.forEach(function (uid) { keys.push({ type: "item", key: uid }); });
  }
  for (let i = 0; i < disliked.length; i++) {
    const d = disliked[i];
    for (let j = 0; j < keys.length; j++) {
      if (d && d.type === keys[j].type && d.key === keys[j].key) {
        return d.label || d.key;
      }
    }
  }
  return null;
}

// 組合的過敏原＝各成分過敏原的聯集（缺欄的成分被略過；v1 行為，−1b 改成「任一成分未確認則整組未確認」）
export function unionTags() {
  const set = {};
  for (let i = 0; i < arguments.length; i++) {
    const tags = arguments[i];
    if (Array.isArray(tags)) {
      tags.forEach(function (t) {
        if (t) set[t] = true;
      });
    }
  }
  return Object.keys(set);
}
