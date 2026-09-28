// 畫面 DOM 小工具（core/ 不碰 DOM，章程 C1）

export function $(sel) {
  return document.querySelector(sel);
}
