// 輕盈計畫 — 推薦候選池：由 catalog 產生所有合法的現成品項一餐組合（跟預算、偏好、回饋都無關，同一份 catalog 只建一次）。
//   1. 超商即食品項：channel=convenience（is_convenience=true）
//   2. 外食／外賣：台式外食＋連鎖健康餐盒/宅配（is_delivery=true）
//   兩者共用同一個「統一成分模型」生成器：品項在資料裡標 role/valid_slots，依一張規則表組合。
//   自煮的候選不在這裡：由 cook-rec.js 依使用者設定與 ☆ 另外產生（2026-10-11 取代舊的餐型骨架窮舉），今日建議把兩邊合併成一個池。

import { SLOTS } from "../core/slots.js";
import { WIDE_RANGE_RATIO, RANK_TO_TIER, tierRank } from "../core/config.js";
import { round1 } from "../core/num.js";
import { unionTags } from "./filters.js";
import { sumProducts, displayFields, contentNote } from "./meal-content.js";

function r1(v) {
  return v == null ? null : round1(v);
}

// 沒有代表值、且 high/low ≥ 1.5 倍的品項熱量太不精準，不進推薦池（手動選照樣可用）
function isTooWideRange(p) {
  if (p.kcal_rep != null) return false;
  if (p.kcal_low == null || p.kcal_high == null || p.kcal_low <= 0) return true;
  return p.kcal_high / p.kcal_low >= WIDE_RANGE_RATIO;
}

// ---------- 2. 現成品項（超商／外食外賣）：統一成分模型、單一生成器 ----------
// 每個品項在資料裡自己標 role（main/side/drink/snack）與 valid_slots，這裡只有一張規則表（章程 C4.7）：
//   - 正餐時段（早/午/晚/宵夜）：恰好 1 個 main，+ ≤1 side，+ ≤1 drink（main 已內含飲料時為 0），
//     + ≤1 snack，總數 ≤3 件。飲料不會單獨成為一餐，一餐也不會出現兩杯飲料。
//   - 下午茶：不需要 main，snack、drink 各 ≤1，至少 1 件。
// 每個成分都要在該時段的 valid_slots 裡才會被拿來組合；不同來源（超商／外食）不互相混搭。

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
  const combos = [];

  const convenience = catalog.products
    .filter(function (p) { return !p.is_taiwan && p.kcal != null; })
    .filter(function (p) { return !p.is_treat; }) // 含糖飲料不主動推薦（同下面台式外食；使用者照樣能自己選）
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

// 拿掉含隱藏內建品項的現成組合（PRD 10.2：隱藏是使用者主動操作，推薦也要濾掉）。新自煮候選不受影響（隱藏只針對內建超商／外食品項）。
// 隱藏清單裡查不到的 uid 自然不會命中（章程 B9）。空清單回傳同一個陣列（推薦快照不變）。
export function withoutHidden(pool, hiddenUids) {
  if (!Array.isArray(hiddenUids) || hiddenUids.length === 0) return pool;
  const hidden = {};
  hiddenUids.forEach(function (u) { hidden[u] = true; });
  return pool.filter(function (c) {
    return c.is_cook_form || !(c.components || []).some(function (uid) { return hidden[uid]; });
  });
}
