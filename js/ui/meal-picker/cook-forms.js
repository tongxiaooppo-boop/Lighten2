// 輕盈計畫 — 選擇器自煮分頁的新結構畫面（2026-10-11）：餐盒、早餐盤、早餐碗、家常餐四個入口的表單。
// 只組 HTML 與改表單狀態，不加總營養（章程 C4.11）：選項清單、份量、能不能選都問 engine/cook.js。
// 按鈕一律 data-nc="動作" 加 data 屬性，事件委派在 index.js（沒有新的 DOM id，搜尋框除外）。

import { escapeHtml } from "../../core/html.js";
import {
  COOK_ENTRIES, COOK_ENTRY_LABELS, COOK_GOALS, COOK_PAMTS, COOK_PROTEIN_MAX, COOK_VEG_MAX, COOK_EGG_MAX, COOK_HOME_DISH_MAX,
  COOK_VEG_METHODS, COOK_POT_AMTS,
} from "../../core/config.js";
import { passesHardFilters } from "../../engine/filters.js";
import {
  cookOptions, cookOptionByUid, cookMethodProblem, cookItemProblem, cookMethodName, boxProteinMethods, boxSplitCount, newBoxForm, newBowlForm, newHomeForm,
  applyGoal, homeDishById, homeDishKind, homeStapleIsComplete, homeShareCount, homePeople, homeDishProtein, COOK_COMMON,
} from "../../engine/cook.js";

const NEW_METHODS = ["boil", "sous", "raw", "cold"]; // 這一輪新增的做法，名稱後面加＊
const ENTRY_NOTES = {
  box: "餐盒：蛋白質、碳水、燙或炒的蔬菜，分開擺。目標選減糖、一般或增肌，只是帶入份量的預設。",
  plate: "早餐盤：蛋白質＋碳水＋蔬菜水果＋無糖飲品。中式（饅頭＋荷包蛋＋青菜＋豆漿）、吐司夾蛋（碳水選吐司、蛋白質選蛋加起司片或火腿、蔬菜選生）、低碳（碳水選不要）都在這裡。",
  bowl: "早餐碗：免開火。碗底、穀物、水果、堅果各選一點。",
  home: "家常餐：飯配菜、麵、炒飯、水餃、粥。記你自己吃的那一份。",
};
const ENTRY_SUBS = { box: "蛋白質＋碳水＋蔬菜", plate: "蛋白＋碳水＋菜果＋飲品", bowl: "優格燕麥", home: "飯配菜、麵、粥" };
const ROLE_TABS = [["主菜", "主菜"], ["蛋豆菜", "蛋豆菜・半葷素"], ["青菜", "青菜"], ["小菜", "小菜・根莖菇"], ["湯", "湯"]];
const COMPLETE_TABS = [["青菜", "青菜"], ["湯", "湯"]];
const PROTEIN_GROUPS = ["雞", "豬", "牛", "魚海鮮", "豆蛋"];

export function newCookState() {
  return { entry: null, forms: {}, more: {}, role: "主菜", q: "", recent: [], msg: "" };
}

// 沒有表單就建一個（入口第一次打開）
export function ensureForm(nc, entry) {
  if (!nc.forms[entry]) nc.forms[entry] = entry === "bowl" ? newBowlForm() : entry === "home" ? newHomeForm() : newBoxForm(entry);
  return nc.forms[entry];
}

// ---------- 小零件 ----------
function opt(act, data, label, on, why, sub) {
  const blocked = !!why && !on;
  return '<button type="button" class="compose-option' + (on ? " selected" : "") + (blocked ? " is-blocked" : "") + '" data-nc="' + act + '" ' + data + (blocked ? " disabled" : "") + ">" +
    escapeHtml(label) + (blocked ? '<span class="item-card-reason">' + escapeHtml(why) + "</span>" : sub ? '<span class="item-card-kcal">' + escapeHtml(sub) + "</span>" : "") + "</button>";
}
const a = function (name, v) { return "data-" + name + '="' + escapeHtml(String(v)) + '"'; };
function box(title, inner, note) {
  return '<div class="compose-axis"><div class="compose-axis-label">' + title + "</div>" + inner + (note ? '<p class="meal-picker-note">' + escapeHtml(note) + "</p>" : "") + "</div>";
}
function optRow(inner) { return '<div class="compose-options">' + inner + "</div>"; }
function req(text) { return ' <span class="meal-picker-note">' + escapeHtml(text) + "</span>"; }

function hardWhy(item, pf) {
  const r = passesHardFilters(item, pf);
  return r.ok ? null : r.reason;
}

// 常見的先列，其餘收在「更多」並依子類分組；已選的一定列在前面
function pickList(key, cands, selUids, act, ctx, isCommon) {
  const fav = ctx.fav || {};
  const isFav = function (e) { return !!fav[e.uid] && !hardWhy(e.item, ctx.pf); };
  const first = cands.filter(function (e) { return isFav(e) || isCommon(e) || selUids.indexOf(e.uid) !== -1; });
  // 常吃且沒被擋的排前面（只看設定，選的過程不跳位置）
  first.sort(function (x, y) { return (isFav(y) ? 1 : 0) - (isFav(x) ? 1 : 0); });
  const rest = cands.filter(function (e) { return first.indexOf(e) === -1; });
  const one = function (e) { return opt(act, a("uid", e.uid), e.name, selUids.indexOf(e.uid) !== -1, hardWhy(e.item, ctx.pf) || cookItemProblem(e, ctx.quick)); };
  let h = optRow(first.map(one).join(""));
  if (rest.length) {
    const open = !!ctx.nc.more[key];
    h += '<div class="compose-options"><button type="button" class="compose-option" data-nc="more" ' + a("k", key) + ">" + (open ? "▾ 收起" : "▸ 更多（" + rest.length + "）") + "</button></div>";
    if (open) {
      const g = {};
      rest.forEach(function (e) { (g[e.sub || "其他"] = g[e.sub || "其他"] || []).push(e); });
      Object.keys(g).forEach(function (k) { h += '<div class="compose-axis-label">' + escapeHtml(k) + "</div>" + optRow(g[k].map(one).join("")); });
    }
  }
  return h;
}

function methodRow(e, list, cur, act, idx, asVeg, quick) {
  return optRow(list.map(function (mk) {
    return opt(act, a("i", idx) + " " + a("m", mk), cookMethodName(mk) + (NEW_METHODS.indexOf(mk) !== -1 ? "＊" : ""), cur === mk, cookMethodProblem(e, mk, asVeg, quick));
  }).join(""));
}

const PAMT_LABELS = { 1: "一份", 1.5: "一份半", 2: "兩份" };
const CARB_LABELS = { half: "半份", one: "一份", none: "不要" };

// ---------- 餐盒、早餐盤 ----------
function boxHtml(form, catalog, st) {
  const o = cookOptions(catalog);
  const ctx = { nc: st.nc, quick: st.quick, pf: st.pf, fav: st.fav };
  const plate = form.entry === "plate";
  const isBraise = function (e) { return !!e.only && e.only.indexOf("braise") !== -1; };
  let h = box("目標" + req("（只帶入預設，可再改）"), optRow(Object.keys(COOK_GOALS).map(function (g) {
    const gg = COOK_GOALS[g];
    return opt("goal", a("v", g), gg.label, form.goal === g, null, "碳水" + CARB_LABELS[gg.carbAmt] + "・蛋白質" + PAMT_LABELS[gg.pamt]);
  }).join("")));

  const pc = o.protein.filter(function (e) { return !isBraise(e) && (plate || !e.plateOnly); });
  const common = plate ? COOK_COMMON.plateProtein : COOK_COMMON.protein;
  let ph = pickList("protein", pc, form.ps.map(function (p) { return p.uid; }), "p", ctx, function (e) { return common.indexOf(e.name) !== -1; });
  const allowed = boxProteinMethods(form.entry);
  form.ps.forEach(function (p, i) {
    const e = cookOptionByUid(catalog, p.uid);
    if (!e) return;
    ph += '<div class="compose-axis-label">' + escapeHtml(e.name) + " 的做法：</div>" + methodRow(e, allowed, p.m, "pm", i, false, st.quick);
    if (e.uid === "egg") {
      ph += '<div class="compose-axis-label">顆數</div>' + optRow([1, 2, 3].filter(function (n) { return n <= COOK_EGG_MAX; }).map(function (n) { return opt("pn", a("i", i) + " " + a("v", n), n + " 顆", (p.n || 1) === n); }).join(""));
    }
  });
  const nn = boxSplitCount(form, catalog);
  if (nn >= 1) {
    ph += '<div class="compose-axis-label">肉／豆類份量</div>' + optRow(COOK_PAMTS.map(function (v) { return opt("pamt", a("v", v), PAMT_LABELS[v], (form.pamt || 1) === v); }).join(""));
  }
  if (nn > 1) ph += '<p class="meal-picker-note">選 ' + nn + " 種肉／豆類時，一份蛋白質平分；蛋與起司片不平分。</p>";
  h += box((plate ? "蛋白質" : "主蛋白") + req("（必選 1–" + COOK_PROTEIN_MAX + " 種）"), ph);

  let ch = optRow(["half", "one", "none"].map(function (k) { return opt("ca", a("v", k), CARB_LABELS[k], form.carbAmt === k); }).join(""));
  if (form.carbAmt !== "none") {
    const cands = plate ? o.plateCarb.concat(o.carb) : o.carb;
    const plateNames = o.plateCarb.map(function (e) { return e.uid; });
    ch += pickList("carb", cands, form.carb ? [form.carb] : [], "c", ctx, function (e) { return plateNames.indexOf(e.uid) !== -1 || COOK_COMMON.carb.indexOf(e.name) !== -1; });
  }
  h += box(plate ? "碳水" : "原型碳水", ch, plate ? "吐司一份 2 片、饅頭半顆；其餘是代換表一份的份量。" : "不收白飯、麵、粉類；半份約半碗。");

  let vh = pickList("veg", o.veg, form.veg.map(function (v) { return v.uid; }), "v", ctx, function (e) { return COOK_COMMON.veg.indexOf(e.name) !== -1; });
  form.veg.forEach(function (v, i) {
    const e = cookOptionByUid(catalog, v.uid);
    if (e) vh += '<div class="compose-axis-label">' + escapeHtml(e.name) + " 的做法：</div>" + methodRow(e, COOK_VEG_METHODS, v.m, "vm", i, true, st.quick);
  });
  h += box("蔬菜" + req("（0–" + COOK_VEG_MAX + " 種" + (plate ? "" : "，建議 3 種") + "）"), vh);
  return h;
}

// ---------- 早餐碗 ----------
function bowlHtml(form, catalog, st) {
  const o = cookOptions(catalog);
  const pf = st.pf;
  const one = function (act, e, on) { return opt(act, a("uid", e.uid), e.name, on, hardWhy(e.item, pf), (e.g != null ? e.g : "") + (e.item.serving && e.item.serving.unit === "ml" ? "ml" : "g")); };
  let h = box("碗底" + req("（必選）"), optRow(o.bowlBase.map(function (e) { return one("wb", e, form.base === e.uid); }).join("")));
  h += box("穀物", optRow(o.bowlGrain.map(function (e) { return one("wg", e, form.grain === e.uid); }).join("")));
  const fr = st.nc.more.fruit ? o.bowlFruit : o.bowlFruit.filter(function (e, i) { return i < 10 || form.fruit.indexOf(e.uid) !== -1; });
  let fh = optRow(fr.map(function (e) { return one("wf", e, form.fruit.indexOf(e.uid) !== -1); }).join(""));
  if (o.bowlFruit.length > 10) fh += optRow('<button type="button" class="compose-option" data-nc="more" ' + a("k", "fruit") + ">" + (st.nc.more.fruit ? "▾ 收起" : "▸ 更多水果") + "</button>");
  h += box("水果" + req("（0–2 種）"), fh);
  h += box("堅果" + req("（選填）"), optRow(o.bowlNut.map(function (e) { return one("wn", e, form.nut === e.uid); }).join("")));
  return h;
}

// ---------- 家常餐 ----------
function slowWhy(d, quick) {
  return quick && d.tier === "🔴" && !d.passive ? "快煮不做" + (d.mins ? "（約 " + d.mins + " 分）" : "") : null;
}

function homeHtml(form, catalog, st) {
  const h0 = catalog.homeDishes || { staples: {}, dishes: [] };
  const quick = st.quick, pf = st.pf, nc = st.nc;
  const complete = homeStapleIsComplete(catalog, form.staple);
  let h = "";
  if (!complete && homeShareCount(form, catalog) > 0) {
    h += box("幾個人吃", '<span class="compose-options">' + opt("ppl", a("v", -1), "−", false) + "<b>" + homePeople(form, catalog) + " 人</b>" + opt("ppl", a("v", 1), "＋", false) + "</span>",
      form.people ? "（自己改過）整盤的菜 ÷ 人數，是你吃的那一份。" : "（照炒煎蒸拌這類菜的道數預設，可改；湯、一鍋菜不算）");
  }
  // 主食格：白飯類、麵；整碗；粥
  const stOpts = Object.keys(h0.staples).map(function (k) { return h0.staples[k]; });
  let sh = optRow(stOpts.map(function (s) { return opt("hs", a("v", s.ref), s.name, form.staple === s.ref, hardWhy(((catalog.foodTree && catalog.foodTree.byId) || {})[s.ref] || s, pf)); }).join("") + opt("hs", a("v", "none"), "不要", form.staple === "none"));
  [["整碗（本身就是一餐，可以不再配菜）", "整碗"], ["粥", "粥"]].forEach(function (g) {
    const L = h0.dishes.filter(function (d) { return d.role === g[1]; });
    if (!L.length) return;
    sh += '<div class="compose-axis-label">' + escapeHtml(g[0]) + "</div>" + optRow(L.map(function (d) {
      return opt("hs", a("v", d.id), d.name, form.staple === d.id, hardWhy(d, pf) || slowWhy(d, quick), (d.passive ? "預約電鍋・" : "") + (d.mins ? d.mins + "分" : ""));
    }).join(""));
  });
  if (form.staple !== "none" && !complete) {
    sh += '<div class="compose-axis-label">主食量</div>' + optRow([[1, "一份"], [0.5, "半份"]].map(function (x) { return opt("hsa", a("v", x[0]), x[1], form.stapleAmt === x[0]); }).join(""));
  }
  h += box("主食", sh);

  // 這餐的菜：已選 → 最近煮過 → 搜尋 → 角色分頁
  let dh = "";
  form.dishes.forEach(function (x, i) {
    const d = homeDishById(catalog, x.uid);
    if (!d) return;
    dh += '<div class="meal-picker-note"><b>' + escapeHtml(d.name) + "</b>・" + escapeHtml(d.method || "") + ' <button type="button" class="compose-option" data-nc="hdel" ' + a("i", i) + ">移除</button></div>";
    if (homeDishKind(d) === "pot") {
      dh += optRow(COOK_POT_AMTS.map(function (v) { return opt("hamt", a("i", i) + " " + a("v", v), { 0.5: "半份", 1: "一份", 1.5: "一份半" }[v], (x.amt || 1) === v); }).join(""));
    }
  });
  const picked = function (d) { return form.dishes.some(function (x) { return x.uid === d.id; }); };
  const allowed = function (d) { return d.role !== "整碗" && d.role !== "粥" && (!complete || d.role === "青菜" || d.kind === "soup"); };
  const dopt = function (d, free) {
    return opt("hd", a("uid", d.id), d.name, picked(d), hardWhy(d, pf) || (free ? null : slowWhy(d, quick)),
      (d.passive ? "預約電鍋・" : "") + (d.method || "") + (homeDishKind(d) === "pot" ? "・一鍋" : "") + (d.mins ? "・" + d.mins + "分" : ""));
  };
  const rec = nc.recent.map(function (id) { return homeDishById(catalog, id); }).filter(function (d) { return d && allowed(d); });
  if (rec.length) dh += '<div class="compose-axis-label">最近煮過</div>' + optRow(rec.map(function (d) { return dopt(d, true); }).join(""));
  dh += '<input id="nc-home-q" type="search" class="meal-picker-search" placeholder="搜尋菜名" value="' + escapeHtml(nc.q || "") + '">';
  if (nc.q) {
    const L = h0.dishes.filter(function (d) { return allowed(d) && d.name.indexOf(nc.q) !== -1; });
    dh += optRow(L.length ? L.map(function (d) { return dopt(d); }).join("") : '<span class="meal-picker-note">找不到「' + escapeHtml(nc.q) + "」</span>");
  } else {
    const tabs = complete ? COMPLETE_TABS : ROLE_TABS;
    const roleOf = function (t) { return function (d) { return allowed(d) && (t === "湯" ? d.kind === "soup" : d.kind !== "soup" && d.role === t); }; };
    const role = tabs.some(function (t) { return t[0] === nc.role; }) ? nc.role : tabs[0][0];
    dh += optRow(tabs.map(function (t) { return opt("hrole", a("v", t[0]), t[1] + "（" + h0.dishes.filter(roleOf(t[0])).length + "）", role === t[0]); }).join(""));
    const L0 = h0.dishes.filter(roleOf(role));
    const Lp = quick ? L0.filter(function (d) { return d.passive; }) : [];
    const L = L0.filter(function (d) { return Lp.indexOf(d) === -1; });
    if (role === "主菜") {
      PROTEIN_GROUPS.forEach(function (p) {
        const G = L.filter(function (d) { return homeDishProtein(d) === p; });
        if (G.length) dh += '<div class="compose-axis-label">' + p + "</div>" + optRow(G.map(function (d) { return dopt(d); }).join(""));
      });
    } else dh += optRow(L.map(function (d) { return dopt(d); }).join(""));
    if (Lp.length) {
      dh += optRow('<button type="button" class="compose-option" data-nc="more" ' + a("k", "pas") + ">" + (nc.more.pas ? "▾ 收起" : "▸ 先預約電鍋才快（" + Lp.length + " 道）") + "</button>");
      if (nc.more.pas) dh += optRow(Lp.map(function (d) { return dopt(d); }).join(""));
    }
  }
  h += box((complete ? "要加青菜或湯嗎" + req("（選填，菜取半盤）") : "這餐的菜" + req("（1–" + COOK_HOME_DISH_MAX + " 道，湯另外加）")), dh);
  return h;
}

// ---------- 對外 ----------
// 步驟 2 的入口列：新的四個入口；舊的餐型（carriedArchetype）只在帶入舊組合／預約時顯示成已選，點掉就回到新入口
export function cookEntryHtml(slot, nc) {
  const order = slot === "breakfast" ? ["plate", "bowl", "box", "home"] : ["box", "home", "plate", "bowl"];
  return order.filter(function (k) { return COOK_ENTRIES.indexOf(k) !== -1; }).map(function (k) {
    return '<button type="button" class="compose-option' + (nc.entry === k ? " selected" : "") + '" data-nc="entry" ' + a("v", k) + ' aria-pressed="' + (nc.entry === k ? "true" : "false") + '">' +
      escapeHtml(COOK_ENTRY_LABELS[k]) + '<span class="item-card-kcal">' + escapeHtml(ENTRY_SUBS[k]) + "</span></button>";
  }).join("");
}

// st = { nc, tier, pf, fav（常吃，uid → true，選填） }；回傳 { html }（nc.entry 沒選回傳空字串）
export function cookFormsHtml(catalog, st, label) {
  const nc = st.nc;
  if (!nc.entry) return "";
  const form = ensureForm(nc, nc.entry);
  const s = { nc: nc, quick: st.tier === "cook_quick", pf: st.pf || {}, fav: st.fav || {} };
  let inner = nc.entry === "bowl" ? bowlHtml(form, catalog, s) : nc.entry === "home" ? homeHtml(form, catalog, s) : boxHtml(form, catalog, s);
  const msg = nc.msg ? '<p class="meal-picker-note">' + escapeHtml(nc.msg) + "</p>" : "";
  return '<div class="compose-step"><div class="meal-picker-step-label">' + escapeHtml(label) + '</div><p class="meal-picker-note">' + escapeHtml(ENTRY_NOTES[nc.entry]) + "</p>" + msg + inner + "</div>";
}

// ---------- 點選 ----------
const toggleIn = function (list, uid, max, make) {
  const i = list.findIndex(function (x) { return x.uid === uid; });
  if (i !== -1) { list.splice(i, 1); return null; }
  if (list.length >= max) return "最多 " + max + " 樣";
  list.push(make(uid));
  return null;
};

// 回傳 false＝不是這裡的動作。改的是 nc（選擇器的新自煮狀態）；ctx = { catalog, tier }
export function cookFormAction(nc, act, p, ctx) {
  nc.msg = "";
  if (act === "entry") {
    nc.entry = nc.entry === p.v ? null : p.v;
    if (nc.entry) ensureForm(nc, nc.entry);
    return true;
  }
  if (act === "more") { nc.more[p.k] = !nc.more[p.k]; return true; }
  const form = nc.entry ? ensureForm(nc, nc.entry) : null;
  if (!form) return false;
  const i = p.i != null ? Number(p.i) : null;
  const v = p.v;
  switch (act) {
    case "goal": applyGoal(form, v); break;
    case "p": nc.msg = toggleIn(form.ps, p.uid, COOK_PROTEIN_MAX, function (uid) { return { uid: uid, m: uid === "fx_cheese_slice" ? "cold" : null, n: 1 }; }) ? "蛋白質最多 " + COOK_PROTEIN_MAX + " 種" : ""; break;
    case "pm": form.ps[i].m = form.ps[i].m === p.m ? null : p.m; break;
    case "pn": form.ps[i].n = Number(v); break;
    case "pamt": form.pamt = Number(v); break;
    case "ca": form.carbAmt = v; if (v === "none") form.carb = null; break;
    case "c": form.carb = form.carb === p.uid ? null : p.uid; break;
    case "v": nc.msg = toggleIn(form.veg, p.uid, COOK_VEG_MAX, function (uid) { return { uid: uid, m: "boil" }; }) ? "蔬菜最多 " + COOK_VEG_MAX + " 種" : ""; break;
    case "vm": form.veg[i].m = form.veg[i].m === p.m ? null : p.m; break;
    case "wb": form.base = form.base === p.uid ? null : p.uid; break;
    case "wg": form.grain = form.grain === p.uid ? null : p.uid; break;
    case "wn": form.nut = form.nut === p.uid ? null : p.uid; break;
    case "wf": {
      const k = form.fruit.indexOf(p.uid);
      if (k !== -1) form.fruit.splice(k, 1); else if (form.fruit.length < 2) form.fruit.push(p.uid); else nc.msg = "水果最多 2 種";
      break;
    }
    case "ppl": form.people = Math.min(6, Math.max(1, homePeople(form, ctx.catalog) + Number(v))); break;
    case "hs": form.staple = v; if (homeStapleIsComplete(ctx.catalog, v)) form.stapleAmt = 1; break;
    case "hsa": form.stapleAmt = Number(v); break;
    case "hrole": nc.role = v; nc.q = ""; break;
    case "hamt": form.dishes[i].amt = Number(v); break;
    case "hdel": form.dishes.splice(i, 1); break;
    case "hd": {
      const k = form.dishes.findIndex(function (x) { return x.uid === p.uid; });
      const d = homeDishById(ctx.catalog, p.uid);
      if (k !== -1) form.dishes.splice(k, 1);
      else if (d && d.kind !== "soup" && form.dishes.filter(function (x) { const y = homeDishById(ctx.catalog, x.uid); return y && y.kind !== "soup"; }).length >= COOK_HOME_DISH_MAX) nc.msg = "菜最多 " + COOK_HOME_DISH_MAX + " 道（湯另外加）";
      else { form.dishes.push({ uid: p.uid, amt: 1 }); nc.recent = [p.uid].concat(nc.recent.filter(function (z) { return z !== p.uid; })).slice(0, 8); }
      break;
    }
    default: return false;
  }
  return true;
}
