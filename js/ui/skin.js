// 輕盈計畫 — 外觀風格（decisions #160）：運動活力（預設）、療癒粉彩、經典暖色。
// 風格存在 <html data-skin="…">；index.html <head> 的行內小程式在畫面出現前先套上，避免閃一下舊風格。
// 選擇存在這台裝置的 localStorage（lighten2.skin），不進 IndexedDB、不進備份（這是裝置偏好，不是飲食資料）。
//
// 框架由 Opus 定（2026-11-21），實作者只填函式內容，不改名稱、參數、回傳格式；覺得要改就停下回報。

import { mealImageKey } from "../engine/meal-kind.js";

export const SKINS = [
  { id: "sport", label: "運動活力" },
  { id: "pastel", label: "療癒粉彩" },
  { id: "classic", label: "經典暖色" },
];
export const DEFAULT_SKIN = "sport";
export const SKIN_STORAGE_KEY = "lighten2.skin";

// 目前的風格 id：讀 document.documentElement.dataset.skin，不在 SKINS 裡就回傳 DEFAULT_SKIN。
export function currentSkin() {
  // 測試用的假 DOM 沒有 documentElement，當成預設風格
  const root = document.documentElement;
  const id = root && root.dataset ? root.dataset.skin : undefined;
  return SKINS.some(function (s) { return s.id === id; }) ? id : DEFAULT_SKIN;
}

// 換風格：id 不在 SKINS 裡就丟錯；設定 dataset.skin、寫 localStorage（try/catch，寫不進去不影響畫面），
// 然後 document.dispatchEvent(new CustomEvent("skin:changed", { detail: id }))。
export function setSkin(id) {
  if (!SKINS.some(function (s) { return s.id === id; })) throw new Error("未知的風格：" + id);
  document.documentElement.dataset.skin = id;
  try { localStorage.setItem(SKIN_STORAGE_KEY, id); } catch (err) { /* 寫不進去不影響畫面 */ }
  document.dispatchEvent(new CustomEvent("skin:changed", { detail: id }));
}

// 時段插畫路徑（取代 tab-today.js 的 MEAL_DEFAULT_IMAGE）：
//   classic → "images/gemini/meal-default-<file>.jpg"
//   其他    → "images/skins/<skin>/meal-<file>.jpg"
// <file>：breakfast、lunch、afternoon-tea、dinner、snack（afternoon_tea 的底線換成連字號）。
export function slotImage(slot, skin) {
  const file = String(slot).replace(/_/g, "-");
  return skin === "classic"
    ? "images/gemini/meal-default-" + file + ".jpg"
    : "images/skins/" + skin + "/meal-" + file + ".jpg";
}

// 推薦卡片插圖：依餐點種類（meal-kind.js）換圖，圖檔 images/skins/<skin>/kind-<key>.jpg（classic 也走這個路徑）；
// 不分種類（下午茶、宵夜、沒有種類）就用時段圖。
export function mealImage(rec, slot, skin) {
  const key = mealImageKey(rec, slot);
  return key ? "images/skins/" + skin + "/kind-" + key + ".jpg" : slotImage(slot, skin);
}

// 飯糰角色圖：mood 是 hero-deco.js heroMessage 回傳的 "hi" | "ok" | "happy" | "cheer"。
// → "images/skins/pastel/mascot-<mood>.png"
export function mascotImage(mood) {
  return "images/skins/pastel/mascot-" + mood + ".png";
}

// 基本資料分頁的「外觀風格」選單（#skin-picker 底下 name="skin" 的 radio）：
// 依 currentSkin() 勾好目前那個；change 時呼叫 setSkin，立刻生效，不用按「計算」。
export function initSkinPicker() {
  const box = document.getElementById("skin-picker");
  if (!box) return;
  box.querySelectorAll('input[name="skin"]').forEach(function (r) {
    r.checked = r.value === currentSkin();
    r.addEventListener("change", function () {
      if (r.checked) setSkin(r.value);
    });
  });
}
