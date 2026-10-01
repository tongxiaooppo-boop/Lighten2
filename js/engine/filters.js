// 輕盈計畫 — 硬性過濾（唯一來源，章程 C2）：過敏原、飲食限制、不吃清單。
// 推薦候選、「自己選」的現成品項與自己煮的食材三處共用，確保同一個設定下擋掉的品項一致。
//

import { ALLERGEN_OPTIONS, UNVERIFIED_ALLERGEN } from "../core/config.js";

// 舊版是自由文字輸入，常見寫法對回固定詞彙（打「蝦」比對不到資料裡的「甲殼類」）；一個寫法可以對到多個詞。
const ALLERGEN_SYNONYMS = {
  "蝦": ["甲殼類"], "蝦子": ["甲殼類"], "蝦仁": ["甲殼類"], "蟹": ["甲殼類"], "螃蟹": ["甲殼類"], "甲殼": ["甲殼類"],
  "蚵": ["軟體動物"], "蚵仔": ["軟體動物"], "牡蠣": ["軟體動物"], "花枝": ["軟體動物"], "魷魚": ["軟體動物"],
  "章魚": ["軟體動物"], "透抽": ["軟體動物"], "貝": ["軟體動物"], "貝類": ["軟體動物"], "蛤蜊": ["軟體動物"],
  "魚類": ["魚"], "海鮮": ["甲殼類", "軟體動物", "魚"],
  "雞蛋": ["蛋"], "蛋類": ["蛋"],
  "牛奶": ["乳製品"], "奶": ["乳製品"], "乳": ["乳製品"], "乳糖": ["乳製品"], "奶製品": ["乳製品"], "起司": ["乳製品"],
  "花生醬": ["花生"], "土豆": ["花生"], "杏仁": ["堅果"], "核桃": ["堅果"],
  "小麥": ["麩質"], "麵粉": ["麩質"], "燕麥": ["麩質"],
  "大豆": ["黃豆"], "豆漿": ["黃豆"], "豆腐": ["黃豆"], "黃豆製品": ["黃豆"],
  "檬果": ["芒果"], "樣仔": ["芒果"],
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
    const mapped = ALLERGEN_OPTIONS.indexOf(t) !== -1 ? [t] : ALLERGEN_SYNONYMS[t];
    if (mapped) {
      mapped.forEach(function (m) { if (list.indexOf(m) === -1) list.push(m); });
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

// 回傳 { ok, reason, code }。code："allergen"｜"diet"｜"disliked"｜null——ui 依代碼決定位置（decisions #80），
// 原因文字給人看、也是 picker 快照的內容，不要拿來分支。item 有兩種形狀：推薦的候選組合（有 diet_tag_sets/components/protein_id 等），
// 以及挑選器裡的單一品項（有 allergen_tags/diet_tags/uid），兩種都要能吃。
export function passesHardFilters(item, profile) {
  const p = profile || {};

  // 1. 過敏原：沒有例外，自訂食物也一樣（章程 C4.1）；缺欄或 null 當未確認。
  const userAllergens = normalizeAllergens(p.allergens);
  const allergenTags = Array.isArray(item.allergen_tags) ? item.allergen_tags : [UNVERIFIED_ALLERGEN];
  if (!passesAllergens(allergenTags, userAllergens)) {
    return { ok: false, reason: allergenTags.indexOf(UNVERIFIED_ALLERGEN) !== -1 ? "成分未確認" : "含過敏原", code: "allergen" };
  }

  // 2. 飲食限制：單一品項沒有多成分概念時包成 [diet_tags || []]。
  const dietTagSets = Array.isArray(item.diet_tag_sets) ? item.diet_tag_sets : [item.diet_tags || []];
  if (!passesDiet(dietTagSets, p.diet_restriction)) {
    return { ok: false, reason: "飲食限制未確認", code: "diet" };
  }

  // 3. 不吃食材：命中 profile.disliked_ingredients 就排除。
  const disliked = Array.isArray(p.disliked_ingredients) ? p.disliked_ingredients : [];
  if (disliked.length > 0) {
    const hit = findDislikedHit(item, disliked);
    if (hit) return { ok: false, reason: "你已設定不吃：" + hit, code: "disliked" };
  }

  return { ok: true, reason: null, code: null };
}

// 自煮的單一食材（自煮分頁的選項、我的組合的解析共用，章程 C2）：包成自組食譜的形狀再過濾，「不吃食材」才比得中食材 id。
// axis：protein／staple／vegetable／seasoning
const INGREDIENT_ID_FIELDS = { protein: "protein_id", staple: "staple_id", vegetable: "vegetable_id", seasoning: "sauce_id" };

export function ingredientFilterResult(item, axis, profile) {
  const wrapper = { is_composed: true, allergen_tags: item.allergen_tags || [], diet_tag_sets: [item.diet_tags || []] };
  wrapper[INGREDIENT_ID_FIELDS[axis]] = item.id;
  return passesHardFilters(wrapper, profile);
}

// 找出 item 命中哪個「不吃食材」。disliked 每項 { type, key, label }：
//   - 自組食譜：type 對應 protein/vegetable/staple/sauce，key 用食材 id（章程 C2：改名後仍然命中；比對只看 key）
//   - 現成品項：type='item'，key 用成分 uid（item.components）
//   - 我的食物的分層品項：type='food_tree'，key 用分層 id（decisions #115）；比對一律只看 key
function findDislikedHit(item, disliked) {
  const keys = [];
  if (item.is_composed) {
    if (item.protein_id) keys.push({ type: "protein", key: item.protein_id });
    if (item.staple_id) keys.push({ type: "staple", key: item.staple_id });
    if (item.vegetable_id) keys.push({ type: "vegetable", key: item.vegetable_id });
    if (item.sauce_id) keys.push({ type: "sauce", key: item.sauce_id });
  } else {
    const comps = Array.isArray(item.components) && item.components.length > 0
      ? item.components
      : (item.uid ? [item.uid] : []);
    comps.forEach(function (uid) { keys.push({ type: "item", key: uid }); });
  }
  for (let i = 0; i < disliked.length; i++) {
    const d = disliked[i];
    for (let j = 0; j < keys.length; j++) {
      // 只比 key：食材與品項 id 全資料庫唯一，換軸或改名都不影響（decisions #40）
      if (d && d.key === keys[j].key) {
        return d.label || d.key;
      }
    }
  }
  return null;
}

// 組合的過敏原＝各成分過敏原的聯集；任一成分缺欄或是 null，整組含「未確認」（章程 B6.4）。
export function unionTags() {
  const set = {};
  for (let i = 0; i < arguments.length; i++) {
    const tags = arguments[i];
    if (Array.isArray(tags)) {
      tags.forEach(function (t) {
        if (t) set[t] = true;
      });
    } else {
      set[UNVERIFIED_ALLERGEN] = true;
    }
  }
  return Object.keys(set);
}
