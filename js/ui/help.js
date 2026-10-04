// 輕盈計畫 — 基本資料分頁的「使用說明」入口：在 App 裡用全螢幕視窗打開 docs/使用說明.html（分頁版說明書，跟 App 一樣的分頁與子分頁）。
// 說明書是獨立的一份檔案（改一次就好，不複製進程式）；iframe 在第一次打開時才載入，關掉再開保留上次看到的位置。
// 模組頂層不碰 document（diff-recs 的假環境也會載入這個模組）。

const HELP_URL = "docs/使用說明.html";

function $(id) {
  return document.getElementById(id);
}

export function initHelp() {
  const openBtn = $("help-open-btn");
  const overlay = $("help-overlay");
  const frame = $("help-frame");
  const closeBtn = $("help-close-btn");
  if (!openBtn || !overlay || !frame || !closeBtn) return;

  function close() {
    overlay.hidden = true;
    openBtn.focus();
  }
  openBtn.addEventListener("click", function () {
    if (!frame.getAttribute("src")) frame.setAttribute("src", HELP_URL);
    overlay.hidden = false;
    closeBtn.focus();
  });
  closeBtn.addEventListener("click", close);
  overlay.addEventListener("click", function (e) {
    if (e.target === overlay) close();
  });
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && !overlay.hidden) close();
  });
}
