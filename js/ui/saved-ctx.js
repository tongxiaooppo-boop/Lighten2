// 輕盈計畫 — 解析我的組合用的 ctx（resolveSavedMeal／remapSavedRefs／savedMealDefaultName 共用；切片 8b 審核 M6）。
// 今日建議（入口 2）、我的食物的組合管理都從這裡拿，不各自組：少帶 customIngredients 會讓組合裡的我的食材被當成查不到丟掉
// （engine 遇到 cing_ 而 ctx 沒帶會丟錯，fail-closed）。選擇器用自己 state 裡的同一批欄位（index.js savedCtx）。
// 這個檔不讀組合清單，不在章程 C4.16 的白名單裡（審核 N3）。

import { getCustomFoods, getHiddenCatalogUids, getProfile, getCustomIngredients } from "../data/db.js";
import { loadCatalog, fromCustomFood, loadTfdaLookup } from "../data/catalog.js";

// 有衛福部來源的我的食材才載查詢檔（約 100KB）；載入失敗不擋，tfdaLookup 留 null，engine 把那些元件擋成「載入失敗」
export async function loadSavedMealCtx(opts) {
  const o = opts || {};
  const r = await Promise.all([loadCatalog(), getCustomFoods(), getProfile(), getCustomIngredients()]);
  let hidden = [];
  try { hidden = await getHiddenCatalogUids(); } catch (err) { console.error(err); }
  let tfdaLookup = null;
  if (r[3].some(function (x) { return x.source === "tfda"; })) {
    try { tfdaLookup = await loadTfdaLookup(); } catch (err) { console.error(err); }
  }
  return {
    catalog: r[0],
    ctx: { hidden: hidden, customs: r[1].map(fromCustomFood), slot: o.slot !== undefined ? o.slot : null, profile: r[2] || {},
      customIngredients: r[3], tfdaLookup: tfdaLookup },
  };
}
