// 輕盈計畫 (Lighten Plan) — 分頁切換邏輯

(function () {
  "use strict";

  const tabButtons = document.querySelectorAll(".tab-btn");
  const tabPanels = document.querySelectorAll(".tab-panel");

  function activateTab(tabName) {
    // 切換按鈕的 active 樣式
    tabButtons.forEach(function (btn) {
      const isActive = btn.getAttribute("data-tab") === tabName;
      btn.classList.toggle("is-active", isActive);
      btn.setAttribute("aria-selected", isActive ? "true" : "false");
    });

    // 切換內容區塊顯示／隱藏
    tabPanels.forEach(function (panel) {
      const isActive = panel.getAttribute("data-panel") === tabName;
      panel.classList.toggle("is-active", isActive);
      panel.hidden = !isActive;
    });
  }

  tabButtons.forEach(function (btn) {
    btn.addEventListener("click", function () {
      activateTab(btn.getAttribute("data-tab"));
    });
  });
})();
