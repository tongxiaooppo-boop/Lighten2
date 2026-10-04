// 輕盈計畫 — 使用說明：在 App 裡用全螢幕視窗打開 docs/使用說明.html（分頁版說明書，跟 App 一樣的分頁與子分頁）。
// 入口兩種：基本資料分頁的「打開使用說明」（從頭看）、每個畫面標題旁與「自己選」視窗的「?」（data-help，直接跳到那一段）。
// 說明書是獨立的一份檔案（改一次就好，不複製進程式）；iframe 在第一次打開時才載入。
// 模組頂層不碰 document（diff-recs 的假環境也會載入這個模組）。

const HELP_URL = "docs/使用說明.html";
// 「自己選」視窗的「?」依目前的分頁跳到說明書對應的子分頁
const PICKER_HASH = { convenience: "today-store", delivery: "today-delivery", cook: "today-cook" };

function $(id) {
  return document.getElementById(id);
}

// 說明書的 hash 規則：分頁名稱（profile、today、foods、week、exercise、cheat）或「分頁-子分頁」（today-cook、foods-store）
export function helpHashFor(key, selectedTab) {
  if (key === "picker") return PICKER_HASH[selectedTab] || "today-open";
  return key || "";
}

export function initHelp() {
  const openBtn = $("help-open-btn");
  const overlay = $("help-overlay");
  const frame = $("help-frame");
  const closeBtn = $("help-close-btn");
  if (!overlay || !frame || !closeBtn) return;
  let opener = null;

  function open(hash, from) {
    opener = from || null;
    const target = hash ? "#" + hash : "";
    if (!frame.getAttribute("src")) {
      frame.setAttribute("src", HELP_URL + target);
    } else if (hash) {
      try { frame.contentWindow.location.hash = target; } catch (e) { frame.setAttribute("src", HELP_URL + target); }
    }
    overlay.hidden = false;
    closeBtn.focus();
  }
  function close() {
    overlay.hidden = true;
    if (opener && opener.focus) opener.focus();
  }
  if (openBtn) openBtn.addEventListener("click", function () { open("", openBtn); });
  document.addEventListener("click", function (e) {
    const b = e.target.closest && e.target.closest("[data-help]");
    if (!b) return;
    const sel = document.querySelector("#meal-picker-tabs [aria-selected=true]");
    open(helpHashFor(b.getAttribute("data-help"), sel ? sel.getAttribute("data-tab") : null), b);
  });
  closeBtn.addEventListener("click", close);
  overlay.addEventListener("click", function (e) {
    if (e.target === overlay) close();
  });
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && !overlay.hidden) close();
  });
}
