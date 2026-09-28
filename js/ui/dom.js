// 畫面 DOM 小工具（core/ 不碰 DOM，章程 C1）

import { SODIUM_REFERENCE_MG } from "../core/config.js";

export function $(sel) {
  return document.querySelector(sel);
}

// 鈉與飽和脂肪的中性文字（章程 C4.14：不上色、不警告）。value 是有資料部分的合計，partial＝有品項沒有資料。
export function sodiumText(value, partial, withReference) {
  if (value == null) return "鈉 無資料";
  return "鈉 約 " + Math.round(value) + " mg" + (withReference ? "（參考 " + SODIUM_REFERENCE_MG + " mg）" : "") +
    (partial ? "（部分品項無資料）" : "");
}

export function satFatText(value, partial) {
  if (value == null) return "飽和脂肪 無資料";
  return "飽和脂肪 約 " + Math.round(value * 10) / 10 + " g" + (partial ? "（部分品項無資料）" : "");
}
