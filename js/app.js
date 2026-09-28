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

    // 各分頁只在載入時渲染一次，切換過來時要重新讀資料（例如在美饗日曆預約後切回今日建議）。
    // 各分頁自己監聽這個事件、只處理 detail 是自己名字的那次。
    document.dispatchEvent(new CustomEvent("tab:activated", { detail: tabName }));
  }

  tabButtons.forEach(function (btn) {
    btn.addEventListener("click", function () {
      activateTab(btn.getAttribute("data-tab"));
    });
  });

  // Part 6：今日建議彙總卡的校正提示要能切換到基本資料分頁。
  window.activateTab = activateTab;
})();
