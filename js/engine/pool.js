// 輕盈計畫 — 推薦候選池：由 catalog 產生所有合法的一餐組合（跟預算、偏好、回饋都無關，同一份 catalog 只建一次）。
//   1. 自組食譜：data/dish_archetypes.json 定義的「餐型骨架」，組合只在餐型內部展開（is_composed=true）
//   2. 超商即食品項：channel=convenience（is_convenience=true）
//   3. 外食／外賣：台式外食＋連鎖健康餐盒/宅配（is_delivery=true）
//   2、3 共用同一個「統一成分模型」生成器：品項在資料裡標 role/valid_slots，依一張規則表組合。

import { SLOTS } from "../core/slots.js";
import { WIDE_RANGE_RATIO, RANK_TO_TIER, NO_COOK_METHOD_ID, tierRank } from "../core/config.js";
import { round1 } from "../core/num.js";
import { unionTags } from "./filters.js";
import {
  sumProducts, ingredientContribution, addContributions, displayFields, defaultImplicit, implicitContribution, ZERO_CONTRIBUTION,
} from "./meal-content.js";

function r1(v) {
  return v == null ? null : round1(v);
}

function byId(list, id) {
  for (let i = 0; i < list.length; i++) {
    if (list[i].id === id) return list[i];
  }
  return null;
}

// 沒有代表值、且 high/low ≥ 1.5 倍的品項熱量太不精準，不進推薦池（手動選照樣可用）
function isTooWideRange(p) {
  if (p.kcal_rep != null) return false;
  if (p.kcal_low == null || p.kcal_high == null || p.kcal_low <= 0) return true;
  return p.kcal_high / p.kcal_low >= WIDE_RANGE_RATIO;
}

// ---------- 1. 自組食譜（餐型骨架） ----------
// 組合只在每個「餐型」內部展開，槽位不對稱（例如早餐碗沒有蔬菜/醬料槽）。
// 每個食材用自己的 serving_g 算天然一份的營養值；用「主要槽位」（有主食槽的用主食、沒有主食槽的用蛋白質）
// 在 PRIMARY_SLOT_SCALE_RANGE 內縮放去對熱量預算，其他槽位維持天然份量不縮放。
function composedCombos(catalog) {
  const combos = [];

  function pickList(axesList, allowIds) {
    if (!allowIds || allowIds.length === 0) return [null];
    return allowIds.map(function (id) { return byId(axesList, id); }).filter(Boolean);
  }

  catalog.archetypes.forEach(function (arche) {
    const proteinList = pickList(catalog.proteins, arche.protein && arche.protein.allow);
    const stapleList = pickList(catalog.staples, arche.staple && arche.staple.allow);
    // 蔬菜/醬料即使餐型有白名單，也一律附加一個「不加」的選項（null），因為它們本來就是加分項不是必要項
    const vegetableList = (arche.vegetable && arche.vegetable.allow && arche.vegetable.allow.length > 0)
      ? pickList(catalog.vegetables, arche.vegetable.allow).concat([null])
      : [null];
    const seasoningList = (arche.seasoning && arche.seasoning.allow && arche.seasoning.allow.length > 0)
      ? pickList(catalog.sauces, arche.seasoning.allow).concat([null])
      : [null];
    const methodList = (arche.methods || []).map(function (id) { return byId(catalog.sauces, id); }).filter(Boolean);
    const hasStapleSlot = !!(arche.staple && arche.staple.allow && arche.staple.allow.length > 0);

    proteinList.forEach(function (p) {
      if (!p || p.kcal_100g == null) return;
      stapleList.forEach(function (s) {
        if (s && s.kcal_100g == null) return;
        vegetableList.forEach(function (v) {
          if (v && v.kcal_100g == null) return;
          seasoningList.forEach(function (season) {
            if (season && season.kcal_100g == null) return;
            methodList.forEach(function (m) {
              // 食安：免開火只能配不需要煮熟的食材，適用於這個組合裡出現的每一個槽位（章程 C4.3）。
              if (m.id === NO_COOK_METHOD_ID && [p, s, v, season].some(function (it) { return it && it.requires_cooking; })) return;

              const primaryItem = hasStapleSlot ? s : p;
              const primaryContribution = primaryItem ? ingredientContribution(primaryItem) : ZERO_CONTRIBUTION;

              // 隱含成分以「一般」用油習慣建立，少油習慣在推薦時換算（meal-content withOilHabit）；不跟主要槽位縮放
              const implicit = defaultImplicit(m, arche, !!v, !!season, "normal");
              const total = addContributions([
                ingredientContribution(p),
                s ? ingredientContribution(s) : null,
                v ? ingredientContribution(v) : null,
                season ? ingredientContribution(season) : null,
                implicitContribution(implicit, catalog.implicit),
              ].filter(Boolean));

              const items = [p, s, v, season].filter(Boolean);
              const rank = Math.max(tierRank(m.prep_tier), items.reduce(function (r, it) { return Math.max(r, tierRank(it.prep_tier)); }, 0));
              const nameParts = [p.name, s && s.name, v && v.name, season && season.name].filter(Boolean);

              combos.push(Object.assign({
                id: arche.id + "_" + p.id + "_" + (s ? s.id : "none") + "_" + (v ? v.id : "none") + "_" + (season ? season.id : "none") + "_" + m.id,
                archetype_id: arche.id,
                method_id: m.id,
                protein_id: p.id,
                staple_id: s ? s.id : null,
                vegetable_id: v ? v.id : null,
                sauce_id: season ? season.id : null,
                primary_axis: hasStapleSlot ? "staple" : "protein",
                valid_slots: arche.valid_slots || null, // 餐型自己標適用時段
                name: nameParts.join(" + "),
                protein_name: p.name,
                staple_name: s ? s.name : null,
                vegetable_name: v ? v.name : null,
                sauce_name: season ? season.name : m.name,
                kcal: round1(total.kcal),
                protein_g: r1(total.protein_g),
                carb_g: r1(total.carb_g),
                fat_g: r1(total.fat_g),
                fiber_g: r1(total.fiber_g),
                primary_kcal: primaryContribution.kcal,
                primary_protein_g: primaryContribution.protein_g,
                primary_carb_g: primaryContribution.carb_g,
                primary_fat_g: primaryContribution.fat_g,
                primary_fiber_g: primaryContribution.fiber_g,
                implicit: implicit,
                implicit_items: catalog.implicit,
                is_composed: true,
                tier: RANK_TO_TIER[rank],
                tier_rank: rank,
                components: items.map(function (it) { return it.id; }),
                diet_tag_sets: items.map(function (it) { return it.diet_tags || []; }), // 烹調法不是食物，不參與飲食限制判斷
                allergen_tags: unionTags.apply(null, items.map(function (it) { return it.allergen_tags; }).concat([m.allergen_tags])),
                is_convenience: false,
                is_delivery: false,
              }, displayFields(total, primaryContribution)));
            });
          });
        });
      });
    });
  });
  return combos;
}

// ---------- 2. 現成品項（超商／外食外賣）：統一成分模型、單一生成器 ----------
// 每個品項在資料裡自己標 role（main/side/drink/snack）與 valid_slots，這裡只有一張規則表（章程 C4.7）：
//   - 正餐時段（早/午/晚/宵夜）：恰好 1 個 main，+ ≤1 side，+ ≤1 drink（main 已內含飲料時為 0），
//     + ≤1 snack，總數 ≤3 件。飲料不會單獨成為一餐，一餐也不會出現兩杯飲料。
//   - 下午茶：不需要 main，snack、drink 各 ≤1，至少 1 件。
// 每個成分都要在該時段的 valid_slots 裡才會被拿來組合；不同來源（超商／外食）不互相混搭。

// convenience_items.json 的 note 格式是「資料來源說明；實際內容物描述」，只取「；」後半段給使用者看。
function contentNote(note) {
  if (!note) return null;
  const idx = note.indexOf("；");
  if (idx === -1) return null;
  return note.slice(idx + 1).trim() || null;
}

// 候選池裡的成分：營養值未知就是 null，組合時 null 傳染（章程 C4.5）；熱量一定有值（沒有熱量的品項不進池）
function toMember(p) {
  return Object.assign({
    uid: p.uid, source_id: p.source_id, name: p.name, role: p.role, valid_slots: p.valid_slots,
    contains_drink: p.contains_drink, channel: p.channel,
    kcal: p.kcal, protein_g: p.protein_g, carb_g: p.carb_g, fat_g: p.fat_g, fiber_g: p.fiber_g,
    tier_rank: p.is_taiwan ? 0 : tierRank(p.tier), diet_tags: p.diet_tags,
    allergen_tags: p.allergen_tags,
    note: p.is_taiwan ? null : contentNote(p.note), is_taiwan: p.is_taiwan,
  }, displayFields(p));
}

function toItemCombo(members) {
  const maxTierRank = members.reduce(function (r, m) { return Math.max(r, m.tier_rank); }, 0);
  const notes = members.map(function (m) { return m.note; }).filter(Boolean);
  const single = members.length === 1 ? members[0] : null;
  const totals = sumProducts(members);
  return Object.assign({
    id: members.map(function (m) { return m.uid; }).join("+"),
    source_id: single && single.is_taiwan ? single.source_id : null,
    components: members.map(function (m) { return m.uid; }),
    component_labels: members.map(function (m) { return { uid: m.uid, label: m.name }; }),
    name: members.map(function (m) { return m.name; }).join(" ＋ "),
    protein_name: null,
    content_note: notes.length > 0 ? notes.join("；") : null,
    kcal: totals.kcal,
    protein_g: totals.protein_g,
    carb_g: totals.carb_g,
    fat_g: totals.fat_g,
    fiber_g: totals.fiber_g,
    tier: RANK_TO_TIER[maxTierRank],
    tier_rank: maxTierRank,
    diet_tag_sets: members.map(function (m) { return m.diet_tags; }),
    allergen_tags: unionTags.apply(null, members.map(function (m) { return m.allergen_tags; })),
    is_convenience: members[0].channel === "convenience",
    is_delivery: members[0].channel === "delivery",
    valid_slots: [],
  }, displayFields(totals));
}

// 依規則表對一組同來源的品項展開所有合法組合；同一個組合在多個時段合法時只產生一次，valid_slots 累加。
function generateItemCombos(items) {
  const byComboId = {};
  function add(members, slot) {
    const id = members.map(function (m) { return m.uid; }).join("+");
    if (!byComboId[id]) byComboId[id] = toItemCombo(members);
    byComboId[id].valid_slots.push(slot);
  }
  SLOTS.forEach(function (slot) {
    const here = items.filter(function (it) { return it.valid_slots.indexOf(slot) !== -1; });
    const ofRole = function (role) { return here.filter(function (it) { return it.role === role; }); };
    const mains = ofRole("main"), sides = ofRole("side"), drinks = ofRole("drink"), snacks = ofRole("snack");
    if (slot === "afternoon_tea") {
      snacks.forEach(function (sn) { add([sn], slot); });
      drinks.forEach(function (dr) { add([dr], slot); });
      snacks.forEach(function (sn) {
        drinks.forEach(function (dr) { add([sn, dr], slot); });
      });
      return;
    }
    mains.forEach(function (main) {
      const drinkOpts = main.contains_drink ? [null] : [null].concat(drinks);
      [null].concat(sides).forEach(function (side) {
        drinkOpts.forEach(function (drink) {
          [null].concat(snacks).forEach(function (snack) {
            const members = [main, side, drink, snack].filter(Boolean);
            if (members.length <= 3) add(members, slot);
          });
        });
      });
    });
  });
  return Object.keys(byComboId).map(function (id) { return byComboId[id]; });
}

const _pools = new WeakMap();

export function buildCandidatePool(catalog) {
  if (_pools.has(catalog)) return _pools.get(catalog);
  const combos = composedCombos(catalog);

  const convenience = catalog.products
    .filter(function (p) { return !p.is_taiwan && p.kcal != null; })
    .map(toMember);
  const taiwan = catalog.products
    .filter(function (p) { return p.is_taiwan; })
    .filter(function (p) { return !isTooWideRange(p); }) // 熱量區間太寬，不夠精準，不進推薦池
    // 含糖飲料、甜點零食（is_treat）不主動推薦：系統推薦等於「建議你吃這個」。不是禁止，使用者照樣能自己選、自己記錄。
    .filter(function (p) { return !p.is_treat; })
    .map(toMember);
  // 超商品項、宅配／連鎖健康餐盒（channel=delivery）、台式外食各自獨立展開，不跨來源混搭。
  [
    convenience.filter(function (it) { return it.channel === "convenience"; }),
    convenience.filter(function (it) { return it.channel === "delivery"; }),
    taiwan,
  ].forEach(function (group) {
    Array.prototype.push.apply(combos, generateItemCombos(group));
  });

  _pools.set(catalog, combos);
  return combos;
}
