// 輕盈計畫 — 「自己選」三分頁選擇器的純函式（PRD 第 4 節、6.3、10.3；Phase 0 計畫第 3 節）。
// 預設分頁、品項分到哪個分頁、分頁內怎麼分組、快速新增的預設值與送出前預告。
// 不碰 DOM、不 import data（章程 C1）；選擇器記住的「上次選的型態」由 ui 讀好，這裡只收 lastPicked 值（章程 C4.15）。

import { MEAL_TYPES, ALLERGEN_OPTIONS, UNVERIFIED_ALLERGEN, FOOD_QTY_STEP, FOOD_QTY_MAX } from "../core/config.js";
import { SLOTS } from "../core/slots.js";
import { passesHardFilters, normalizeAllergens } from "./filters.js";
import { emptyOptionalNutrients, canAddManualItem, manualSelectionProblem, foodLimitProblem } from "./meal-content.js";

function validMealType(v) {
  return MEAL_TYPES.indexOf(v) !== -1 ? v : null;
}

// 打開時停在哪個型態：計畫（Phase 2 才有）→ 時段偏好（有效型態值）→ 上次這個時段送出的型態 → 超商。
// 刻意跟推薦的有效偏好（recommend.js：不合法的偏好退回預設偏好）不同：這裡不合法（含 "auto"）就往下找，不要合併成同一個函式。
export function resolveDefaultMealType(o) {
  const x = o || {};
  return validMealType(x.planned) || validMealType(x.pref) || validMealType(x.lastPicked) || "convenience";
}

// 選擇器的分頁：自煮的兩個型態都在自煮分頁（子切換）
export function tabOfMealType(mealType) {
  return mealType === "cook_quick" || mealType === "cook_full" ? "cook" : mealType;
}

// 飲料任何時段都能選（decisions #44）；其他品項照 valid_slots
export function fitsSlot(item, slot) {
  return item.role === "drink" || (Array.isArray(item.valid_slots) && item.valid_slots.indexOf(slot) !== -1);
}

// 品項分到分頁：超商分頁＝超商的非飲料；外食分頁＝台式外食非飲料在前、宅配/連鎖餐盒在後；
// 我的品項依自己的 channel 放在分頁最後；飲料（含我的品項的飲料，不分 channel）進共用的飲料步驟。
// products：catalog.products；customs：已經過 fromCustomFood 的我的品項（archived 的不列出）。
// hiddenUids：使用者隱藏的內建品項（PRD 10.2；可省略＝不過濾），只影響內建，不影響我的品項。
export function partitionByMealType(products, customs, slot, hiddenUids) {
  return partition(products, customs, function (it) { return fitsSlot(it, slot); }, hiddenUids);
}

// 「我的食物」分頁用：同樣的分法，但不套時段（每個品項都列出來）
export function partitionAllChannels(products, customs, hiddenUids) {
  return partition(products, customs, function () { return true; }, hiddenUids);
}

function partition(products, customs, fits, hiddenUids) {
  const own = (customs || []).filter(function (it) { return !it.archived && fits(it); });
  const hidden = {};
  (hiddenUids || []).forEach(function (u) { hidden[u] = true; });
  const builtin = products.filter(function (p) { return fits(p) && !hidden[p.uid]; });
  const nonDrink = function (it) { return it.role !== "drink"; };
  return {
    convenience: builtin.filter(function (p) { return !p.is_taiwan && p.channel === "convenience" && nonDrink(p); })
      .concat(own.filter(function (p) { return p.channel === "convenience" && nonDrink(p); })),
    delivery: builtin.filter(function (p) { return p.is_taiwan && nonDrink(p); })
      .concat(builtin.filter(function (p) { return !p.is_taiwan && p.channel === "delivery" && nonDrink(p); }))
      .concat(own.filter(function (p) { return p.channel === "delivery" && nonDrink(p); })),
    drinks: builtin.filter(function (p) { return p.is_taiwan && !nonDrink(p); })
      .concat(builtin.filter(function (p) { return !p.is_taiwan && !nonDrink(p); }))
      .concat(own.filter(function (p) { return !nonDrink(p); })),
  };
}

// 把「你標了不吃」的品項移到另一組（PRD 6.3 第 4 點：不吃的放最下方收合）。codeOf(item)：passesHardFilters 的 code。
// 只在 ui 組 HTML 時用；選擇器 state 裡的 items、reasons 的內容與順序不動（picker 快照不變的前提）。
// 又不吃又被過敏原或飲食擋的，code 是 allergen／diet，留在 rest 裡原位灰掉（decisions #80）。
export function splitDisliked(items, codeOf) {
  const rest = [];
  const disliked = [];
  items.forEach(function (it) { (codeOf(it) === "disliked" ? disliked : rest).push(it); });
  return { rest: rest, disliked: disliked };
}

const ROLE_ORDER = ["main", "side", "snack"];

// 分頁內的分組（PRD 6.3）：內建品項先依角色分區（主餐 → 配菜 → 點心），區內依 category 分組，
// 組的順序與組內順序都照資料原順序（不按熱量排，PRD 6.1）；被擋的排在組內最後。我的品項整組放最後、不進角色分區。
// reasonOf(item)：被擋的原因或 null。回傳 [{ role, category, is_custom, entries: [{ item, reason }], blocked }]
export function groupForTab(items, reasonOf) {
  const groups = [];
  const byKey = {};
  const add = function (key, base, item) {
    if (!byKey[key]) { byKey[key] = Object.assign({ entries: [] }, base); groups.push(byKey[key]); }
    byKey[key].entries.push({ item: item, reason: reasonOf(item) || null });
  };
  ROLE_ORDER.forEach(function (role) {
    items.forEach(function (it) {
      if (it.is_custom || it.role !== role) return;
      add(role + "|" + (it.category || ""), { role: role, category: it.category || null, is_custom: false }, it);
    });
  });
  items.forEach(function (it) {
    if (it.is_custom) add("custom", { role: null, category: null, is_custom: true }, it);
  });
  groups.forEach(function (g) {
    g.entries = g.entries.filter(function (e) { return !e.reason; }).concat(g.entries.filter(function (e) { return e.reason; }));
    g.blocked = g.entries.filter(function (e) { return e.reason; }).length;
  });
  return groups;
}

// ---------- 「我的品項」快速新增（PRD 10.3） ----------

const ROLE_DEFAULT_SLOTS = {
  main: ["breakfast", "lunch", "dinner", "snack"],
  side: SLOTS,
  snack: ["afternoon_tea", "snack"],
  drink: SLOTS,
};

export function defaultQuickAddRole(slot) {
  return slot === "afternoon_tea" || slot === "snack" ? "snack" : "main";
}

// 依角色推 valid_slots，一定包含目前時段（否則新增完在這個時段看不到它），照時段順序
export function quickAddSlots(role, slot) {
  const base = ROLE_DEFAULT_SLOTS[role] || SLOTS;
  return SLOTS.filter(function (s) { return base.indexOf(s) !== -1 || s === slot; });
}

// 快速新增表單的預設記錄（PRD 10.1 格式；archived、copied_from、時間戳由 db.addCustomFood 補）
export function quickAddDefaults(slot, role, channel) {
  const r = role || defaultQuickAddRole(slot);
  return Object.assign({ name: "", kcal: null, role: r, channel: channel, valid_slots: quickAddSlots(r, slot) },
    emptyOptionalNutrients(), { allergen_tags: null, vegan: false, lacto_ovo: false });
}

const NOT_VEGAN = ["蛋", "乳製品", "魚", "甲殼類", "軟體動物"];
const NOT_LACTO_OVO = ["魚", "甲殼類", "軟體動物"];

// 送出前預告（Phase 0 計畫 2.1 第 7 項）。item：ui 用 fromCustomFood 轉好的品項形狀。
// 回傳 { blocked, conflict }：blocked＝以目前設定會被哪個設定擋住（中性說明，不引導改填「確認不含」，章程 C4.1）；
// conflict＝飲食宣告跟過敏原互相矛盾（只提示不擋；我的品項只受章程 B8 驗證，B6.8 不適用）。
// 「全素但過敏原未確認」不提示：未確認是預設值。
export function quickAddProblem(item, profile) {
  const p = profile || {};
  const res = passesHardFilters(item, p);
  let blocked = null;
  if (!res.ok) {
    const mine = normalizeAllergens(p.allergens);
    const names = mine.list.concat(mine.unknown).join("、");
    const tags = Array.isArray(item.allergen_tags) ? item.allergen_tags : [UNVERIFIED_ALLERGEN];
    if (res.code === "allergen" && res.reason === "成分未確認") blocked = "你設了過敏原「" + names + "」，過敏原未確認的品項不能選。";
    else if (res.code === "allergen") {
      const hit = mine.list.filter(function (a) { return tags.indexOf(a) !== -1; });
      blocked = "你設了過敏原「" + hit.join("、") + "」，含有它的品項不能選。";
    } else if (res.code === "diet") blocked = "你設了飲食限制「" + p.diet_restriction + "」，沒有宣告符合的品項不能選。";
    else blocked = res.reason;
  }
  const tags = Array.isArray(item.allergen_tags) ? item.allergen_tags : [];
  const diet = item.diet_tags || [];
  let conflict = null;
  const clash = function (list) { return tags.filter(function (t) { return list.indexOf(t) !== -1 && ALLERGEN_OPTIONS.indexOf(t) !== -1; }); };
  if (diet.indexOf("全素") !== -1 && clash(NOT_VEGAN).length > 0) conflict = "宣告全素，但過敏原勾了「" + clash(NOT_VEGAN).join("、") + "」。";
  else if (diet.indexOf("蛋奶素") !== -1 && clash(NOT_LACTO_OVO).length > 0) conflict = "宣告蛋奶素，但過敏原勾了「" + clash(NOT_LACTO_OVO).join("、") + "」。";
  return { blocked: blocked, conflict: conflict };
}

// ---------- B-1a：我的品項管理（PRD 10.2、10.4、10.6） ----------

// 被擋的原因可不可以「補填」：只有「未確認」類（PRD 10.4）。「含過敏原」「不吃」只寫原因，不引導改答案（章程 C4.1）。
export function fillableReason(reason) {
  return reason === "成分未確認" || reason === "飲食限制未確認";
}

// 已隱藏的內建品項清單（照隱藏的順序）；查不到的 uid 略過（章程 B9）。
export function hiddenEntries(hiddenUids, productsByUid) {
  return (hiddenUids || []).filter(function (u) { return productsByUid && productsByUid[u]; })
    .map(function (u) { return { uid: u, name: productsByUid[u].name, channel: productsByUid[u].channel, role: productsByUid[u].role }; });
}

// 新存的我的品項放到選擇器的哪裡、要不要選中（快速新增、複製、補填共用；說明文字由各入口在 ui 組）。
// ctx：{ slot, currentTab, profile, roleItems（目前這一餐已選的品項，角色上限用） }。
// 順序跟 Phase 0 的快速新增相同：先決定放哪裡，再判斷選不選中；被擋的照樣放進清單並記原因。
// 飲料：沒被擋就直接取代目前的飲料（不跑角色名額）。
export function placeNewCustom(item, ctx) {
  const check = passesHardFilters(item, ctx.profile || {});
  const reason = check.ok ? null : check.reason;
  if (item.role === "drink") return { dest: "drinks", tab: null, select: !reason, reason: reason, roleProblem: null };
  if (!fitsSlot(item, ctx.slot)) return { dest: null, tab: null, select: false, reason: reason, roleProblem: null };
  const tab = item.channel;
  if (tab !== ctx.currentTab || reason) return { dest: "tab", tab: tab, select: false, reason: reason, roleProblem: null };
  const roleItems = ctx.roleItems || [];
  if (canAddManualItem(roleItems, item, ctx.slot)) return { dest: "tab", tab: tab, select: true, reason: null, roleProblem: null };
  return { dest: "tab", tab: tab, select: false, reason: null, roleProblem: manualSelectionProblem(roleItems.concat([item]), ctx.slot) };
}

// ---------- 單品的選取（工作線 D 切片 7；PRD 13.4） ----------
// sel：[{ uid, qty }]，照點選順序；三個型態分頁共用一份。一餐裡同一個 uid 只有一筆。

// 再點已選的不新增（existed: true，畫面捲到它的步進器）；第 5 項回 problem；否則附在最後、份量 1
export function addFood(sel, uid) {
  const list = sel || [];
  if (list.some(function (f) { return f.uid === uid; })) return { sel: list, existed: true, problem: null };
  const problem = foodLimitProblem(list.length + 1);
  if (problem) return { sel: list, existed: false, problem: problem };
  return { sel: list.concat([{ uid: uid, qty: 1 }]), existed: false, problem: null };
}

// 步進器：dir 是 1 或 -1，一格 FOOD_QTY_STEP，夾在 FOOD_QTY_STEP–FOOD_QTY_MAX（不會變成 0；移除另有按鈕）
export function stepFood(sel, uid, dir) {
  return (sel || []).map(function (f) {
    if (f.uid !== uid) return f;
    const q = Math.min(FOOD_QTY_MAX, Math.max(FOOD_QTY_STEP, f.qty + (dir > 0 ? FOOD_QTY_STEP : -FOOD_QTY_STEP)));
    return { uid: f.uid, qty: q };
  });
}

export function removeFood(sel, uid) {
  return (sel || []).filter(function (f) { return f.uid !== uid; });
}
