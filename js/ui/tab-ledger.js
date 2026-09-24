// 輕盈計畫 (Lighten Plan) — 分頁三：週彈性帳本
// 依賴：database.js、nutrition.js（calculateTargets）、feast.js

(function () {
  "use strict";

  const SLOT_LABELS = { breakfast: "早餐", lunch: "午餐", dinner: "晚餐", snack: "宵夜" };
  const SIZE_LABELS = { S: "小", M: "中", L: "大" };

  function ready(fn) {
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", fn);
    else fn();
  }

  function $(sel) { return document.querySelector(sel); }

  function round1(n) { return Math.round(n * 10) / 10; }

  function fmt(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return y + "-" + m + "-" + day;
  }

  function localDateStr() { return fmt(new Date()); }

  function mondayOfThisWeek() {
    const d = new Date();
    const day = d.getDay();
    const diff = day === 0 ? 6 : day - 1;
    d.setDate(d.getDate() - diff);
    return fmt(d);
  }

  function escapeHtml(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  function renderProgress(used, cap) {
    $("#ledger-used").textContent = round1(used);
    $("#ledger-cap").textContent = round1(cap);
    const pct = cap > 0 ? Math.min(100, (used / cap) * 100) : 0;
    const fill = $("#ledger-bar-fill");
    if (fill) fill.style.width = pct + "%";
  }

  function renderList(list) {
    const container = $("#ledger-reservations");
    if (!container) return;
    const sorted = list.slice().sort(function (a, b) {
      return String(a.plan_date).localeCompare(String(b.plan_date));
    });
    if (sorted.length === 0) {
      container.innerHTML = '<p class="rec-empty">尚無預約</p>';
      return;
    }
    container.innerHTML = sorted.map(function (r) {
      const slotLabel = SLOT_LABELS[r.slot] || r.slot || "";
      const sizeLabel = SIZE_LABELS[r.size] || r.size || "";
      const statusText = r.status === "confirmed" ? "已確認" : r.status === "cancelled" ? "已取消" : "已預約";
      const actions = r.status === "reserved"
        ? '<button type="button" class="feast-confirm" data-id="' + escapeHtml(r.id) + '">確認</button>' +
          '<button type="button" class="feast-cancel" data-id="' + escapeHtml(r.id) + '">取消</button>'
        : "";
      return '<div class="ledger-item">' +
        '<div class="ledger-item-info">' +
        '<span class="ledger-item-title">' + escapeHtml(r.plan_date) + " " + escapeHtml(slotLabel) + " · " + escapeHtml(sizeLabel) + "（約 " + escapeHtml(r.estimated_kcal) + " kcal）</span>" +
        '<span class="ledger-item-status">' + statusText + "</span>" +
        "</div>" +
        '<div class="ledger-item-actions">' + actions + "</div>" +
        "</div>";
    }).join("");
  }

  async function render() {
    const status = $("#ledger-status");
    let profile;
    try {
      profile = await getProfile();
    } catch (e) {
      console.error(e);
      if (status) status.textContent = "讀取基本資料失敗。";
      return;
    }
    if (!profile) {
      if (status) status.textContent = "請先到「基本資料」分頁填寫並按「計算」。";
      return;
    }

    const weekStart = mondayOfThisWeek();
    let ledger = await getWeeklyLedger(weekStart);
    if (!ledger || ledger.cap_kcal == null) {
      const cap = computeWeeklyCapKcal(profile);
      ledger = await updateWeeklyLedger(weekStart, (ledger && ledger.used_kcal) || 0, cap);
    }
    renderProgress(ledger.used_kcal || 0, ledger.cap_kcal || 0);

    const reservations = await getFeastReservations();
    renderList(reservations);
    if (status) status.textContent = "";
  }

  async function onReserve(e) {
    e.preventDefault();
    const form = document.getElementById("feast-form");
    const fd = new FormData(form);
    const planDate = fd.get("plan_date");
    const slot = fd.get("slot");
    const size = fd.get("size");
    if (!planDate) {
      alert("請選擇日期。");
      return;
    }
    try {
      await reserveFeast(planDate, slot, size);
      form.elements["plan_date"].value = localDateStr();
      await render();
    } catch (err) {
      console.error(err);
      alert("預約失敗，請重試。");
    }
  }

  async function onAction(e) {
    const confirmBtn = e.target.closest(".feast-confirm");
    const cancelBtn = e.target.closest(".feast-cancel");
    try {
      if (confirmBtn) {
        await confirmFeast(confirmBtn.getAttribute("data-id")); // 簡化：用預估值當實際記錄
      } else if (cancelBtn) {
        await cancelFeast(cancelBtn.getAttribute("data-id"));
      } else {
        return;
      }
      await render();
    } catch (err) {
      console.error(err);
      alert("操作失敗，請重試。");
    }
  }

  ready(function () {
    const dateInput = document.querySelector("#feast-form input[name='plan_date']");
    if (dateInput) dateInput.value = localDateStr();

    const form = document.getElementById("feast-form");
    if (form) form.addEventListener("submit", onReserve);

    const listEl = document.getElementById("ledger-reservations");
    if (listEl) listEl.addEventListener("click", onAction);

    render();
  });
})();
