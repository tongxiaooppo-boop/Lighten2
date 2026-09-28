// 輕盈計畫 — 分頁切換

export function activateTab(tabName) {
  // 切換按鈕的 active 樣式
  document.querySelectorAll(".tab-btn").forEach(function (btn) {
    const isActive = btn.getAttribute("data-tab") === tabName;
    btn.classList.toggle("is-active", isActive);
    btn.setAttribute("aria-selected", isActive ? "true" : "false");
  });

  // 切換內容區塊顯示／隱藏
  document.querySelectorAll(".tab-panel").forEach(function (panel) {
    const isActive = panel.getAttribute("data-panel") === tabName;
    panel.classList.toggle("is-active", isActive);
    panel.hidden = !isActive;
  });

  // 各分頁只在載入時渲染一次，切換過來時要重新讀資料（例如記錄一餐後切到本週總覽）。
  // 各分頁自己監聽這個事件、只處理 detail 是自己名字的那次。
  document.dispatchEvent(new CustomEvent("tab:activated", { detail: tabName }));
}

export function initTabs() {
  document.querySelectorAll(".tab-btn").forEach(function (btn) {
    btn.addEventListener("click", function () {
      activateTab(btn.getAttribute("data-tab"));
    });
  });
}
