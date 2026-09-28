// 畫面字串工具（唯一來源，章程 C2）

export function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function $(sel) {
  return document.querySelector(sel);
}
