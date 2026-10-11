// 輕盈計畫 — 今日建議的自煮候選（2026-10-11）：用新自煮引擎（cook.js）的餐盒、早餐盤、早餐碗、家常餐組候選，取代舊的餐型骨架窮舉。
// 純函式：資料（catalog）、設定（profile）、☆（favoriteRefs）、日期都由呼叫端傳入，沒有亂數、不讀時鐘（章程 C1.1）。
//
// 做法：每個入口一個固定模板（比「自己選」窄，出來的組合才像人會煮的），在小池子裡窮舉；
//   池子＝使用者 ☆ 過且能用的項目，☆ 不足 COOK_POOL_MIN 時用 COOK_DEFAULTS 依序補到夠，沒有 ☆ 就用預設。
//   份量不連續縮放，是離散的幾種（碳水半份／一份、蛋白質一份／一份半、一鍋菜半／一／一份半…），每個候選自己選最貼近預算的那一種。
//   營養：每個零件先用 cook.js＋meal-content.js 算好一次（cookDraftPart＋contentTotals），候選只做加法；
//   真正被選中的那一餐由 cookRecFinalize 重新用同一套函式算準，卡片、記錄、存下來的數字都是準的。
// 顯示欄位（鈉、飽和脂肪）不在這裡讀，只在 finalize 時從 contentTotals 原樣帶出（章程 C4.14）。

import {
  COOK_DEFAULTS, COOK_POOL_MIN, COOK_ENTRY_LABELS, COOK_METHODS, COOK_METHOD_PREFER, RANK_TO_TIER, isQuickTier,
} from "../core/config.js";
import { seasonOfDate } from "../core/dates.js";
import { passesHardFilters } from "./filters.js";
import { addContributions, buildDraftContent, contentTotals, cookDraftPart, draftLogName } from "./meal-content.js";
import {
  cookOptions, cookOptionByUid, boxProteinOptions, cookMethodProblem, cookItemProblem, cookMethodName, cookFormRank,
  boxProteinMethods, homeDishById, homeDishKind, newBoxForm, newBowlForm, newHomeForm,
} from "./cook.js";

// 做法偏好序（全域一張表；不是每個食材一份）：取第一個「這個入口能用、符合快煮」的
const PROTEIN_METHOD_PREF = ["boil", "steam", "pan"];
const VEG_METHOD_PREF = ["boil", "stir"];
const READY_METHOD = "cold";
// 各入口的候選上限（池子照順序截斷：☆ 在前）
const CAP = { protein: 9, carb: 8, veg: 9, main: 24, homeVeg: 12, soup: 6, fruit: 8 };
const ENTRY_SLOTS = { box: ["lunch", "dinner"], plate: ["breakfast"], bowl: ["breakfast", "afternoon_tea", "snack"], home: ["lunch", "dinner"] };

// 候選取最貼近預算的份量時，用到的營養欄位（只有這五個；顯示欄位不在這裡讀）
const VEC_FIELDS = ["kcal", "protein_g", "carb_g", "fat_g", "fiber_g"];

function vecOf(t) {
  return VEC_FIELDS.map(function (k) { return t[k] == null ? 0 : t[k]; });
}

function addVec(a, b) {
  const out = new Array(a.length);
  for (let i = 0; i < a.length; i++) out[i] = a[i] + b[i];
  return out;
}

// ---------- 零件的營養（只算一次，候選做加法） ----------
function formTotals(form, ctx) {
  const dp = cookDraftPart(form, ctx.catalog, ctx.profile, "cook_full", ctx.oilHabit);
  const content = buildDraftContent({ kind: "cook", meal_type: "cook_full", cook: dp, foods: [], drink: null }, { oilHabit: ctx.oilHabit });
  return contentTotals(content, ctx.catalog);
}

function memo(cache, key, fn) {
  if (!Object.prototype.hasOwnProperty.call(cache, key)) cache[key] = fn();
  return cache[key];
}

function boxVec(ctx, entry, patch) {
  const f = Object.assign(newBoxForm(entry), { carbAmt: "none", pamt: 1 }, patch);
  return vecOf(formTotals(f, ctx));
}

// ---------- 池子 ----------
function usable(ctx, item, quick, entryOpt) {
  if (!passesHardFilters(item, ctx.profile).ok) return false;
  return !(quick && entryOpt && cookItemProblem(entryOpt, true));
}

// ☆ 且能用的排前面；☆ 不足 min 樣用預設依序補到 min；沒有 ☆ 就是全部預設
function resolvePool(ctx, ids, favSet, min, ok) {
  const favs = ctx.favorites.filter(function (u) { return favSet(u) && ok(u); });
  const defs = ids.filter(ok);
  if (favs.length === 0) return defs;
  if (favs.length >= min) return favs;
  const out = favs.slice();
  defs.forEach(function (u) { if (out.length < min && out.indexOf(u) === -1) out.push(u); });
  return out;
}

function pickMethod(entryOpt, prefs, allowed, asVeg, quick) {
  for (let i = 0; i < prefs.length; i++) {
    if (allowed.indexOf(prefs[i]) !== -1 && !cookMethodProblem(entryOpt, prefs[i], asVeg, quick)) return prefs[i];
  }
  return null;
}

// 蛋白質能用的做法（第一個是偏好的，再加上煎讓份量與熱量有第二種選擇）；現成的只直接吃，入口沒有這個做法就不放
function proteinMethods(e, entry, quick) {
  const allowed = boxProteinMethods(entry);
  if (e.ready) return allowed.indexOf(READY_METHOD) !== -1 ? [READY_METHOD] : [];
  const own = COOK_METHOD_PREFER[e.uid];
  const first = pickMethod(e, own ? [own].concat(PROTEIN_METHOD_PREF) : PROTEIN_METHOD_PREF, allowed, false, quick);
  if (!first) return [];
  // 第二個選項：偏好的是煎時給原本的偏好做法，其餘給煎（份量與熱量有第二種選擇）
  const second = first === "pan" ? pickMethod(e, PROTEIN_METHOD_PREF.filter(function (m) { return m !== "pan"; }), allowed, false, quick) : (allowed.indexOf("pan") !== -1 && !cookMethodProblem(e, "pan", false, quick) ? "pan" : null);
  return second ? [first, second] : [first];
}

// 葉菜（炒青菜）先炒，其餘先燙
function vegMethod(e, quick) {
  return pickMethod(e, e.sub === "leafy" ? ["stir", "boil"] : VEG_METHOD_PREF, ["boil", "stir", "air", "raw"], true, quick);
}

// ---------- 候選共同形狀 ----------
// dims：份量的選擇，每個維度是一串 { key, vec }；一個份量組合＝每個維度各選一個。fixed：不隨份量變的零件向量加總
function makeCandidate(ctx, o) {
  const dims = o.dims || [];
  const fixed = o.fixed;
  // 每個候選的預設份量（第一個組合）的數字，其他地方（沒預算時）直接讀
  const first = dims.reduce(function (v, d) { return addVec(v, d.opts[0].vec); }, fixed);
  const c = {
    id: o.id, is_cook_form: true, entry: o.entry, valid_slots: ENTRY_SLOTS[o.entry].slice(), name: o.name,
    tier_rank: o.rank, tier: RANK_TO_TIER[o.rank], part_refs: o.partRefs, main_protein_ref: o.mainProtein || null,
    components: o.partRefs.map(function (p) { return p.ref; }),
    allergen_tags: [], diet_tag_sets: [[]], pre_filtered: true, is_convenience: false, is_delivery: false,
    protein_name: null, content_note: null,
    quick_pool_only: !!ctx.quickPass, // 只在「快煮的池子」出現的候選（☆ 裡慢的食材被擋掉、用預設補出來的）；開伙的池子不收
    kcal: first[0], protein_g: first[1], carb_g: first[2], fat_g: first[3], fiber_g: first[4],
    // 這個候選最貼近預算的份量：回傳 { key, kcal, protein_g, carb_g, fat_g, fiber_g }（低碳：碳水 ≤ maxCarb；沒有符合的回傳 null）
    pickVariant: function (budget, maxCarb) {
      // 五個數字用參數往下傳、不配置陣列（每次推薦要對上萬個候選各跑一次）；只有更好的才記下選擇
      const n = dims.length;
      const pick = new Array(n);
      let bestGap = Infinity, bestKey = null, b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0;
      const walk = function (i, k, p, c, fa, fi) {
        if (i === n) {
          if (maxCarb != null && c > maxCarb) return;
          const gap = budget > 0 && k > 0 ? Math.abs(budget / k - 1) : 0;
          if (gap < bestGap) { bestGap = gap; bestKey = pick.slice(); b0 = k; b1 = p; b2 = c; b3 = fa; b4 = fi; }
          return;
        }
        const opts = dims[i].opts;
        for (let j = 0; j < opts.length; j++) {
          const v = opts[j].vec;
          pick[i] = opts[j].key;
          walk(i + 1, k + v[0], p + v[1], c + v[2], fa + v[3], fi + v[4]);
        }
      };
      walk(0, fixed[0], fixed[1], fixed[2], fixed[3], fixed[4]);
      return bestKey ? { key: bestKey, kcal: b0, protein_g: b1, carb_g: b2, fat_g: b3, fiber_g: b4 } : null;
    },
    // 份量組合 → form（finalize 用）
    buildForm: function (key) { return o.build(key); },
  };
  return c;
}

const idPart = function (list) { return list.length ? list.join("+") : "none"; };

// ---------- 餐盒、早餐盤 ----------
function boxCandidates(ctx, entry, pools, quick, out) {
  const plate = entry === "plate";
  const cat = ctx.catalog;
  const protMethods = {};
  pools.protein.forEach(function (u) { protMethods[u] = proteinMethods(cookOptionByUid(cat, u), entry, quick); });
  const proteins = pools.protein.filter(function (u) { return protMethods[u].length > 0; });
  const vegMethodOf = {};
  pools.veg.forEach(function (u) { vegMethodOf[u] = vegMethod(cookOptionByUid(cat, u), quick); });
  const vegs = pools.veg.filter(function (u) { return vegMethodOf[u]; });
  const carbs = [null].concat(pools.carb);
  // 早餐盤：蛋可以再配起司片或火腿（吐司夾蛋）；餐盒只有單一蛋白質
  const extras = plate ? pools.protein.filter(function (u) { return u === "fx_cheese_slice" || u === "fx_ham"; }) : [];
  // 餐盒 3 種蔬菜（跟自己選的「建議 3 種」一致，decisions #156）；早餐盤 0–1 種
  const vegSets = entry === "plate" ? [[]].concat(vegs.map(function (u) { return [u]; })) : triples(vegs);

  const pv = function (uid, pamt, m) { return memo(ctx.cache, "p|" + entry + "|" + uid + "|" + pamt + "|" + m, function () { return boxVec(ctx, entry, { pamt: pamt, ps: [psOf(uid, m, pamt)] }); }); };
  const cv = function (uid, amt) { return memo(ctx.cache, "c|" + uid + "|" + amt, function () { return boxVec(ctx, entry, { carb: uid, carbAmt: amt }); }); };
  const vv = function (uid) { return memo(ctx.cache, "v|" + uid + "|" + vegMethodOf[uid], function () { return boxVec(ctx, entry, { veg: [{ uid: uid, m: vegMethodOf[uid] }] }); }); };
  const ev = function (uid, p1, pamt, m) { return memo(ctx.cache, "e|" + entry + "|" + p1 + "|" + uid + "|" + pamt + "|" + m, function () { return boxVec(ctx, entry, { pamt: pamt, ps: [psOf(p1, m, pamt), { uid: uid, m: "cold", n: 1 }] }); }); };

  const seen = ctx.seen;
  const emit = function (protList, carb, vegList) {
    const id = "cook|" + entry + "|" + idPart(protList) + "|" + (carb || "none") + "|" + idPart(vegList.slice().sort());
    if (seen[id]) return;
    seen[id] = true;
    const p1 = protList[0];
    const pamts = [1, 1.5];
    // 蛋白質的份量與做法：每個（份量, 做法）一個選項，key 是 [份量, 做法]
    const popts = [];
    pamts.forEach(function (a) { protMethods[p1].forEach(function (m) { popts.push({ key: [a, m], vec: protList.length > 1 ? ev(protList[1], p1, a, m) : pv(p1, a, m) }); }); });
    const dims = [{ opts: popts }];
    let fixed = [0, 0, 0, 0, 0];
    if (carb) dims.push({ opts: ["one", "half"].map(function (a) { return { key: a, vec: cv(carb, a) }; }) });
    vegList.forEach(function (u) { fixed = addVec(fixed, vv(u)); });
    const build = function (key) {
      const f = newBoxForm(entry);
      f.pamt = key[0][0];
      f.ps = protList.map(function (u, i) { return i === 0 ? psOf(u, key[0][1], key[0][0]) : { uid: u, m: "cold", n: 1 }; });
      f.carb = carb; f.carbAmt = carb ? key[1] : "none";
      f.veg = vegList.map(function (u) { return { uid: u, m: vegMethodOf[u] }; });
      return f;
    };
    const base = build(dims.map(function (d) { return d.opts[0].key; }));
    out.push(makeCandidate(ctx, {
      id: id, entry: entry, dims: dims, fixed: fixed, build: build, rank: cookFormRank(base, cat),
      name: COOK_ENTRY_LABELS[entry] + "（" + protList.concat(carb ? [carb] : [], vegList).map(function (u) { return cookOptionByUid(cat, u).name; }).join("＋") + "）",
      partRefs: protList.map(function (u) { return { ref: u, role: "protein" }; }).concat(carb ? [{ ref: carb, role: "carb" }] : [], vegList.map(function (u) { return { ref: u, role: "veg" }; })),
      mainProtein: p1,
    }));
  };
  proteins.forEach(function (p) {
    carbs.forEach(function (c) {
      vegSets.forEach(function (vs) { emit([p], c, vs); });
    });
    if (p === "egg") extras.forEach(function (x) { carbs.forEach(function (c) { vegSets.forEach(function (vs) { emit([p, x], c, vs); }); }); });
  });
}

function psOf(uid, m, pamt) {
  return uid === "egg" ? { uid: uid, m: m, n: pamt === 1 ? 2 : 3 } : { uid: uid, m: m, n: 1 };
}

function triples(list) {
  const out = [];
  for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) for (let k = j + 1; k < list.length; k++) out.push([list[i], list[j], list[k]]);
  return out;
}

// ---------- 早餐碗 ----------
function bowlCandidates(ctx, pools, out) {
  const cat = ctx.catalog;
  const vec = function (patch) { return memo(ctx.cache, "w|" + JSON.stringify(patch), function () { return vecOf(formTotals(Object.assign(newBowlForm(), patch), ctx)); }); };
  const seen = ctx.seen;
  pools.base.forEach(function (b) {
    [null].concat(pools.grain).forEach(function (g) {
      pools.fruit.forEach(function (fr) {
        [null].concat(pools.nut).forEach(function (n) {
          const id = "cook|bowl|" + b + "|" + (g || "none") + "|" + fr + "|" + (n || "none");
          if (seen[id]) return;
          seen[id] = true;
          const f = Object.assign(newBowlForm(), { base: b, grain: g, fruit: [fr], nut: n });
          const names = [b, g, fr, n].filter(Boolean).map(function (u) { return cookOptionByUid(cat, u).name; });
          out.push(makeCandidate(ctx, {
            id: id, entry: "bowl", dims: [], fixed: vec({ base: b, grain: g, fruit: [fr], nut: n }), build: function () { return JSON.parse(JSON.stringify(f)); }, rank: 0,
            name: COOK_ENTRY_LABELS.bowl + "（" + names.join("＋") + "）",
            partRefs: [b, g, fr, n].filter(Boolean).map(function (u) { return { ref: u, role: "bowl" }; }),
          }));
        });
      });
    });
  });
}

// ---------- 家常餐 ----------
// 模板：主食（白飯類／麵）＋主菜 1＋青菜 1＋湯 0 或 1；或一份整碗主食（可再加一道青菜或湯，菜取半盤）
// 道數＝非湯的菜（含一鍋菜），炒煎蒸拌類一份＝整盤 ÷ 道數；主菜與一鍋菜各有半／一／一份半的份量維度（沒有人數）
function homeCandidates(ctx, pools, out) {
  const cat = ctx.catalog;
  const homeVec = function (staple, stapleAmt, dishes, people) {
    const key = "h|" + staple + "|" + stapleAmt + "|" + dishes.map(function (d) { return d.uid + ":" + d.amt; }).join(",") + "|" + people;
    return memo(ctx.cache, key, function () {
      const f = Object.assign(newHomeForm(), { staple: staple, stapleAmt: stapleAmt, people: people, dishes: dishes });
      return vecOf(formTotals(f, ctx));
    });
  };
  const kind = function (u) { return homeDishKind(homeDishById(cat, u)); };
  const seen = ctx.seen;
  const emit = function (staple, complete, dishUids) {
    const id = "cook|home|" + staple + "|" + idPart(dishUids);
    if (seen[id]) return;
    seen[id] = true;
    // 道數（整碗固定 2）只用來算這份候選的克數；輸出的 form 不寫人數
    const count = dishUids.filter(function (u) { return kind(u) !== "soup"; }).length;
    const people = complete ? 2 : Math.max(1, count);
    // 份量維度：主食量（整碗固定一份）、主菜（沒有主菜時是第一道一鍋菜）的半／一／一份半
    const mainIdx = complete ? dishUids.findIndex(function (u) { return kind(u) === "pot"; }) : 0;
    const stapleAmts = complete ? [1] : [1, 0.5];
    const dishAmts = mainIdx === -1 ? [1] : [1, 0.5, 1.5];
    // 主食與菜各自單獨算再相加（道數固定後兩邊互不影響）
    const dishes = function (amt) { return dishUids.map(function (u, i) { return { uid: u, amt: i === mainIdx ? amt : 1 }; }); };
    const stapleVec = function (a) { return homeVec(staple, a, [], people); };
    const dishVec = function (list) { return homeVec("none", 1, list, people); };
    const dims = [];
    if (!complete) dims.push({ opts: stapleAmts.map(function (a) { return { key: a, vec: stapleVec(a) }; }) });
    else dims.push({ opts: [{ key: 1, vec: stapleVec(1) }] });
    dims.push({ opts: dishAmts.map(function (a) { return { key: a, vec: dishVec(dishes(a)) }; }) });
    const build = function (key) {
      return Object.assign(newHomeForm(), { staple: staple, stapleAmt: key[0], people: null, dishes: dishes(key[1]) });
    };
    const base = build([stapleAmts[0], dishAmts[0]]);
    const names = [staple === "none" ? null : homeStapleName(cat, staple)].concat(dishUids.map(function (u) { return homeDishById(cat, u).name; })).filter(Boolean);
    out.push(makeCandidate(ctx, {
      id: id, entry: "home", dims: dims, fixed: [0, 0, 0, 0, 0], build: build, rank: cookFormRank(base, cat),
      name: COOK_ENTRY_LABELS.home + "（" + names.join("＋") + "）",
      partRefs: [{ ref: staple, role: "staple" }].concat(dishUids.map(function (u) { return { ref: u, role: "dish" }; })),
      mainProtein: dishUids.length ? dishUids[0] : staple,
    }));
  };
  pools.staple.forEach(function (s) {
    pools.main.forEach(function (m) {
      pools.homeVeg.forEach(function (v) {
        [null].concat(pools.soup).forEach(function (so) { emit(s, false, [m, v].concat(so ? [so] : [])); });
      });
    });
  });
  pools.complete.forEach(function (w) {
    emit(w, true, []);
    pools.homeVeg.forEach(function (v) { emit(w, true, [v]); });
    pools.soup.forEach(function (so) { emit(w, true, [so]); });
  });
}

function homeStapleName(catalog, staple) {
  const d = homeDishById(catalog, staple);
  if (d) return d.name;
  const st = (catalog.homeDishes && catalog.homeDishes.staples) || {};
  const hit = Object.keys(st).map(function (k) { return st[k]; }).filter(function (s) { return s.ref === staple; })[0];
  return hit ? hit.name : staple;
}

// ---------- 入口：產生全部候選 ----------
const _memo = new WeakMap();

// o = { catalog, profile（allergens、diet_restriction、disliked_ingredients、goal_mode）, favoriteRefs（常吃／☆，字串陣列）, oilHabit, date（YYYY-MM-DD，家常菜依季節） }
export function cookRecCandidates(o) {
  const profile = o.profile || {};
  const favorites = Array.isArray(o.favoriteRefs) ? o.favoriteRefs : [];
  const season = o.date ? seasonOfDate(o.date) : null;
  const sig = JSON.stringify([profile.allergens || [], profile.diet_restriction || "", (profile.disliked_ingredients || []).map(function (d) { return d.type + ":" + d.key; }), favorites, o.oilHabit || "normal", season]);
  let byCatalog = _memo.get(o.catalog);
  if (!byCatalog) { byCatalog = {}; _memo.set(o.catalog, byCatalog); }
  if (byCatalog[sig]) return byCatalog[sig];
  const ctx = { catalog: o.catalog, profile: profile, favorites: favorites, oilHabit: o.oilHabit || "normal", cache: {}, seen: {} };
  const out = [];
  const opts = cookOptions(o.catalog);
  const optOf = function (u) { return cookOptionByUid(o.catalog, u); };
  const hd = function (u) { return homeDishById(o.catalog, u); };
  const inList = function (list) { const set = {}; list.forEach(function (e) { set[e.uid] = true; }); return function (u) { return !!set[u]; }; };

  [false, true].forEach(function (quick) {
    ctx.quickPass = quick;
    const okFood = function (u) { const e = optOf(u); return !!e && usable(ctx, e.item, quick, e); };
    const mk = function (ids, list, min, cap) {
      return resolvePool(ctx, ids, inList(list), min, okFood).slice(0, cap);
    };
    const prot = function (entry) {
      const list = boxProteinOptions(o.catalog, entry);
      return mk(entry === "plate" ? COOK_DEFAULTS.plate_protein : COOK_DEFAULTS.box_protein, list, COOK_POOL_MIN.protein, CAP.protein);
    };
    const veg = mk(COOK_DEFAULTS.veg, opts.veg, COOK_POOL_MIN.veg, CAP.veg);
    // 餐盒的碳水：預設與 ☆ 取自「碳水」；早餐盤另加早餐碳水（吐司、饅頭…）排在前面
    const carb = mk(COOK_DEFAULTS.carb, opts.carb, COOK_POOL_MIN.carb, CAP.carb);
    const plateCarb = opts.plateCarb.map(function (e) { return e.uid; }).filter(okFood).concat(carb).slice(0, CAP.carb + opts.plateCarb.length);
    boxCandidates(ctx, "box", { protein: prot("box"), carb: carb, veg: veg }, quick, out);
    boxCandidates(ctx, "plate", { protein: prot("plate"), carb: plateCarb, veg: veg }, quick, out);
    bowlCandidates(ctx, {
      base: mk(COOK_DEFAULTS.bowl_base, opts.bowlBase, 2, 4), grain: mk(COOK_DEFAULTS.bowl_grain, opts.bowlGrain, 1, 2),
      fruit: mk(COOK_DEFAULTS.bowl_fruit, opts.bowlFruit, 3, CAP.fruit), nut: mk(COOK_DEFAULTS.bowl_nut, opts.bowlNut, 2, 4),
    }, out);

    const okDish = function (role) {
      return function (u) {
        const d = hd(u);
        if (!d || !dishInPoolRole(d, role)) return false;
        if (season && (d.seasons || []).indexOf(season) === -1) return false;
        if (!passesHardFilters(d, profile).ok) return false;
        return !(quick && d.tier === "🔴" && !d.passive);
      };
    };
    const dishList = function (role) { return ((o.catalog.homeDishes && o.catalog.homeDishes.dishes) || []).filter(function (d) { return dishInPoolRole(d, role); }).map(function (d) { return { uid: d.id }; }); };
    const hp = function (ids, role, min, cap) { return resolvePool(ctx, ids, inList(dishList(role)), min, okDish(role)).slice(0, cap); };
    const stapleRefs = Object.keys((o.catalog.homeDishes && o.catalog.homeDishes.staples) || {}).map(function (k) { return o.catalog.homeDishes.staples[k].ref; });
    const staple = COOK_DEFAULTS.home_staple.filter(function (r) {
      const item = (o.catalog.foodTree && o.catalog.foodTree.byId && o.catalog.foodTree.byId[r]) || null;
      return stapleRefs.indexOf(r) !== -1 && item && passesHardFilters(item, profile).ok;
    });
    const complete = COOK_DEFAULTS.home_complete.filter(function (u) { const d = hd(u); return d && passesHardFilters(d, profile).ok && !(quick && d.tier === "🔴" && !d.passive); });
    homeCandidates(ctx, {
      staple: staple, complete: complete,
      main: hp(COOK_DEFAULTS.home_main, "main", COOK_POOL_MIN.home_main, CAP.main),
      homeVeg: hp(COOK_DEFAULTS.home_veg, "veg", COOK_POOL_MIN.home_veg, CAP.homeVeg),
      soup: hp(COOK_DEFAULTS.home_soup, "soup", COOK_POOL_MIN.home_soup, CAP.soup),
    }, out);
  });
  const keys = Object.keys(byCatalog);
  if (keys.length >= 4) delete byCatalog[keys[0]]; // 設定常改的時候不讓舊結果一直堆著
  byCatalog[sig] = out;
  return out;
}

function dishInPoolRole(d, role) {
  if (role === "soup") return d.kind === "soup";
  if (d.kind === "soup") return false;
  return role === "main" ? d.role === "主菜" || d.role === "蛋豆菜" : d.role === "青菜" || d.role === "小菜";
}

// ---------- 被選中之後：重新用同一套函式算準 ----------
// rec：recommend.js 的結果（帶 cook_variant 與 buildForm）；ctx：{ catalog, profile, oilHabit }。回傳新的 rec：
//   form、content（寫進記錄的 MealContent，與「自己選」送出的格式相同）、準確的營養欄位、卡片名稱與零件明細。
//   資料或設定變了、這份 form 現在不能送出時回傳 null（呼叫端略過這張卡）。
export function cookRecFinalize(rec, ctx) {
  const form = rec.buildForm(rec.cook_variant || []);
  const tier = cookRecMealType(rec);
  const dp = cookDraftPart(form, ctx.catalog, ctx.profile, tier, ctx.oilHabit);
  if (dp.problem) return null;
  const draft = { kind: "cook", meal_type: tier, cook: dp, foods: [], drink: null };
  const content = buildDraftContent(draft, { oilHabit: ctx.oilHabit });
  const t = contentTotals(content, ctx.catalog);
  const detail = dp.parts.map(function (p) {
    return p.item.name + " " + p.amount + "g" + (p.method && COOK_METHODS[p.method] ? " " + cookMethodName(p.method) : "");
  }).join("・");
  return Object.assign({}, rec, t, {
    name: draftLogName(draft), cook_form: form, cook_content: content, cook_detail: detail,
    scaled_kcal: t.kcal, kcal: t.kcal, tier_rank: cookFormRank(form, ctx.catalog), tier: RANK_TO_TIER[cookFormRank(form, ctx.catalog)],
    implicit: { oil_g: dp.oil_g, seasoning: null },
  });
}

// 這一餐記成快煮還是開伙：使用者明確選了來源就照他的；auto（或退回）就看這份做不做得了快煮（舊版用最高難度推導，一樣的意思）
export function cookRecMealType(rec) {
  const pref = rec.source_pref;
  if (!rec.fallback_to_auto && (pref === "cook_quick" || pref === "cook_full")) return pref;
  return isQuickTier(rec.tier_rank) ? "cook_quick" : "cook_full";
}

// 零件各是什麼（卡片的「順便不要」chips 用）：[{ ref, role, name }]
export function cookRecParts(rec, catalog) {
  return rec.part_refs.map(function (p) {
    const d = homeDishById(catalog, p.ref);
    const e = d ? null : cookOptionByUid(catalog, p.ref);
    return { ref: p.ref, role: p.role, name: d ? d.name : e ? e.name : homeStapleName(catalog, p.ref) };
  });
}

// 回饋 id 是 "cook|入口|…"：零件近期降權要從候選的 part_refs 取，不從 id 反推（這裡只判斷是不是自煮候選的 id）
export function isCookRecId(id) {
  return typeof id === "string" && id.indexOf("cook|") === 0;
}

// ---------- 自己選的「建議自煮」 ----------
// 自己選的自煮分頁上方列幾個建議（每天換）。沒有回饋與近期顯示的資料可用，改用日期輪轉：
// 先取最貼近這一餐配額的一批候選，主蛋白質（主菜）各取一個，再依「第幾天」從中轉著取 n 個。同一天打開幾次都一樣。
// o = { candidates（cookRecCandidates 的結果）, slot, budget（這個時段的配額 kcal）, quick（true＝快煮、false＝開伙）, date, n,
//       entry（選填：只看這個入口，點餐型時帶入一個建議用）, offset（選填：往後輪幾個，「換一個」用）, poolSize（選填：輪轉的範圍，預設 n×4） }
// 回傳 [{ cand, key（份量組合）, kcal }]；要顯示名稱、帶入表單再用 cookRecFinalize
export function cookRecSuggest(o) {
  const n = o.n || 3;
  const budget = o.budget > 0 ? o.budget : 0;
  const rows = [];
  o.candidates.forEach(function (c) {
    if (c.valid_slots.indexOf(o.slot) === -1) return;
    if (o.entry && c.entry !== o.entry) return;
    if (o.quick ? !isQuickTier(c.tier_rank) : c.quick_pool_only) return;
    const v = c.pickVariant(budget, null);
    if (v) rows.push({ cand: c, key: v.key, kcal: v.kcal, gap: budget > 0 && v.kcal > 0 ? Math.abs(budget / v.kcal - 1) : 0 });
  });
  rows.sort(function (a, b) { return a.gap - b.gap || (a.cand.id < b.cand.id ? -1 : a.cand.id > b.cand.id ? 1 : 0); });
  const mains = {};
  const pool = [];
  const size = o.poolSize || n * 4;
  for (let i = 0; i < rows.length && pool.length < size; i++) {
    const m = rows[i].cand.main_protein_ref || rows[i].cand.id;
    if (mains[m]) continue;
    mains[m] = true;
    pool.push(rows[i]);
  }
  const offset = o.offset || 0;
  if (pool.length <= n && !offset) return pool;
  if (!pool.length) return pool;
  const day = o.date ? Math.floor(Date.UTC(Number(o.date.slice(0, 4)), Number(o.date.slice(5, 7)) - 1, Number(o.date.slice(8, 10))) / 86400000) : 0;
  const out = [];
  for (let i = 0; i < n; i++) out.push(pool[(day * n + i + offset) % pool.length]);
  return out;
}
