// 輕盈計畫 — 外觀風格（decisions #160）：運動活力（預設）、療癒粉彩、經典暖色。
// 風格存在 <html data-skin="…">；index.html <head> 的行內小程式在畫面出現前先套上，避免閃一下舊風格。
// 選擇存在這台裝置的 localStorage（lighten2.skin），不進 IndexedDB、不進備份（這是裝置偏好，不是飲食資料）。
//
// 框架由 Opus 定（2026-11-21），實作者只填函式內容，不改名稱、參數、回傳格式；覺得要改就停下回報。

export const SKINS = [
  { id: "sport", label: "運動活力" },
  { id: "pastel", label: "療癒粉彩" },
  { id: "classic", label: "經典暖色" },
];
export const DEFAULT_SKIN = "sport";
export const SKIN_STORAGE_KEY = "lighten2.skin";

// 目前的風格 id：讀 document.documentElement.dataset.skin，不在 SKINS 裡就回傳 DEFAULT_SKIN。
export function currentSkin() {
  throw new Error("TODO currentSkin");
}

// 換風格：id 不在 SKINS 裡就丟錯；設定 dataset.skin、寫 localStorage（try/catch，寫不進去不影響畫面），
// 然後 document.dispatchEvent(new CustomEvent("skin:changed", { detail: id }))。
export function setSkin(id) {
  throw new Error("TODO setSkin");
}

// 時段插畫路徑（取代 tab-today.js 的 MEAL_DEFAULT_IMAGE）：
//   classic → "images/gemini/meal-default-<file>.jpg"
//   其他    → "images/skins/<skin>/meal-<file>.jpg"
// <file>：breakfast、lunch、afternoon-tea、dinner、snack（afternoon_tea 的底線換成連字號）。
export function slotImage(slot, skin) {
  throw new Error("TODO slotImage");
}

// 飯糰角色圖：mood 是 hero-deco.js heroMessage 回傳的 "hi" | "ok" | "happy" | "cheer"。
// → "images/skins/pastel/mascot-<mood>.png"
export function mascotImage(mood) {
  throw new Error("TODO mascotImage");
}

// 基本資料分頁的「外觀風格」選單（#skin-picker 底下 name="skin" 的 radio）：
// 依 currentSkin() 勾好目前那個；change 時呼叫 setSkin，立刻生效，不用按「計算」。
export function initSkinPicker() {
  throw new Error("TODO initSkinPicker");
}
