// 輕盈計畫 — 「我的食物」裡的我的品項（B-1a 搬過來，PRD 10.4、10.6、decisions #61、#73、#99）：
// 表單（新增、編輯、補填、複製成我的版本）、封存／還原、取消隱藏的動作與提示文字。
// 不存狀態：狀態在 tab-foods.js，由參數 s 傳入；動作函式回傳要顯示的訊息。模組頂層不碰 document。

import { escapeHtml } from "../../core/html.js";
import { addCustomFood, updateCustomFood, unhideCatalogItem, copyBuiltinToCustom } from "../../data/db.js";
import { builtinCurrentValues, copyFromBuiltin } from "../../engine/meal-content.js";
import {
  valuesFromRecord, emptyCustomFoodValues, recordFromValues, customFoodNotes, customFoodFormHtml, readCustomFoodInputs,
} from "../custom-food-form.js";

export const FOODS_FORM_ID = "foods-custom-food-form";
const VALUE_LABELS = [["kcal", "熱量", " kcal"], ["protein_g", "蛋白質", "g"], ["carb_g", "碳水", "g"], ["fat_g", "脂肪", "g"], ["fiber_g", "纖維", "g"], ["sat_fat_g", "飽和脂肪", "g"], ["sodium_mg", "鈉", " mg"]];
const FORM_TITLES = { add: "新增我的品項", edit: "編輯我的品項", fill: "補填我的品項", copy: "複製成我的版本" };

// 複製來的品項：唯讀並列「內建目前的數值」（decisions #61）；內建已查不到時說明（章程 B9）
export function customFoodCompareHtml(s, rec) {
  if (!rec || !rec.copied_from) return "";
  const cur = builtinCurrentValues(rec.copied_from, s.catalog.productsByUid);
  if (!cur) return '<div class="builtin-compare"><p>內建已不提供這個品項。</p></div>';
  const cells = VALUE_LABELS.map(function (v) {
    return "<li>" + v[1] + "：" + (cur[v[0]] == null ? "無資料" : escapeHtml(String(cur[v[0]])) + v[2]) + "</li>";
  }).join("");
  return '<div class="builtin-compare"><p>內建目前的數值（' + escapeHtml(cur.name) + "）：</p><ul>" + cells +
    "<li>過敏原：" + escapeHtml(cur.allergen_tags.join("、") || "確認不含") + "</li></ul></div>";
}

export function customFoodEditFormHtml(s) {
  const e = s.editing;
  const notes = (e.error ? [e.error] : []).concat(customFoodNotes(e.values, s.profile || {}));
  return customFoodFormHtml(e.values, {
    formId: FOODS_FORM_ID, title: FORM_TITLES[e.mode], saveLabel: e.mode === "copy" ? "存成我的品項" : "存檔",
    profile: s.profile || {}, notes: notes,
  });
}

// 各種表單的起始狀態
export function customFoodEditing(s, mode, key) {
  if (mode === "add") {
    // 飲品・水果預帶飲料角色，channel 預設超商（表單可改）；valid_slots 用角色推的時段（PRD 10.6）
    const role = s.subtab === "drinks" ? "drink" : "main";
    const values = emptyCustomFoodValues(s.subtab === "delivery" ? "delivery" : "convenience", role);
    return { mode: mode, id: null, uid: null, values: values, error: null };
  }
  if (mode === "copy") {
    const p = s.catalog.productsByUid[key];
    return p ? { mode: mode, id: null, uid: key, values: valuesFromRecord(copyFromBuiltin(p)), error: null } : null;
  }
  const rec = s.records.find(function (r) { return r.id === key; });
  return rec ? { mode: mode, id: key, uid: null, values: valuesFromRecord(rec), error: null } : null;
}

export function syncCustomFoodForm(s, root) {
  if (s.editing) readCustomFoodInputs(root, s.editing.values);
}

// 存檔。成功回傳存下的紀錄，失敗把原因寫進 s.editing.error 並回傳 null
export async function saveCustomFoodForm(s) {
  const e = s.editing;
  const r = recordFromValues(e.values);
  if (r.errors.length > 0) { e.error = r.errors.join("；"); return null; }
  try {
    if (e.mode === "copy") {
      // 一個 transaction 新增並自動隱藏原品項（PRD 10.2；標了不吃的也可以複製，複製品不繼承不吃，decisions #100）
      return await copyBuiltinToCustom(Object.assign({}, copyFromBuiltin(s.catalog.productsByUid[e.uid]), r.record, { copied_from: e.uid }));
    }
    return e.id ? await updateCustomFood(e.id, r.record) : await addCustomFood(r.record);
  } catch (err) {
    console.error(err);
    e.error = "存檔失敗，請重試。";
    return null;
  }
}

export async function setCustomFoodArchived(s, id, archived) {
  let saved;
  try { saved = await updateCustomFood(id, { archived: archived }); } catch (err) { console.error(err); return "存檔失敗，請重試。"; }
  let msg = (archived ? "已刪除「" : "已還原「") + saved.name + "」。";
  // 封存複製品時，原本的內建品項仍是隱藏的（兩筆都看不到），中性提示（B-1a 計畫 S11）
  if (archived && saved.copied_from && s.hidden.indexOf(saved.copied_from) !== -1) {
    const p = s.catalog.productsByUid[saved.copied_from];
    if (p) msg += "原本的內建品項「" + p.name + "」仍是換成你的版本，要用回內建到「已換成我的版本」按「改回內建」。";
  }
  return msg;
}

export async function unhideBuiltin(s, uid) {
  try { await unhideCatalogItem(uid); } catch (err) { console.error(err); return "改回內建失敗，請重試。"; }
  const p = s.catalog.productsByUid[uid];
  let msg = "已改回內建「" + (p ? p.name : uid) + "」。";
  const copy = s.records.find(function (r) { return r.copied_from === uid && r.archived !== true; });
  if (copy) msg += "你有一筆從它複製的我的品項「" + copy.name + "」。";
  return msg;
}

