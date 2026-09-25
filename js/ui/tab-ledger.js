// 輕盈計畫 (Lighten Plan) — 分頁三：週彈性帳本
// 依賴：database.js、nutrition.js（calculateTargets）、feast.js

(function () {
  "use strict";

  const SLOT_LABELS = { breakfast: "早餐", lunch: "午餐", afternoon_tea: "下午茶", dinner: "晚餐", snack: "宵夜" };
  const SIZE_LABELS = { S: "小", M: "中", L: "大" };

  // 餐別 → 台式熱門品項分類（下午茶暫用「飲料」分類頂替，西式速食先不納入）
  const SLOT_TO_TAIWAN_CATEGORY = {
    breakfast: "早餐",
    lunch: "午餐",
    dinner: "晚餐",
    snack: "宵夜",
    afternoon_tea: "飲料",
  };

  // 台式熱門品項 id → 縮圖（查不到就不顯示，正常降級）
  const TAIWAN_ITEM_IMAGE = {
    bf01: "images/food/egg-pancake.jpg",
    bf02: "images/food/milk-glass.jpg",
    bf03: "images/food/rice-ball.jpg",
    bf04: "images/food/pork-egg-toast.jpg",
    bf05: "images/food/soy-milk.jpg",
    bf06: "images/food/radish-cake.jpg",
    bf07: "images/food/teppan-noodles.jpg",
    bf08: "images/food/sweet-potato.jpg",
    bf09: "images/food/youtiao.jpg",
    bf10: "images/food/scallion-pancake-egg.jpg",
    ln01: "images/food/pork-chop-bento.jpg",
    ln02: "images/food/chicken-leg-bento.jpg",
    ln03: "images/food/dumplings.jpg",
    ln04: "images/food/beef-noodle-soup.jpg",
    ln05: "images/food/noodle-soup.jpg",
    ln06: "images/food/buffet-rice.jpg",
    ln07: "images/food/healthy-bento.jpg",
    ln08: "images/food/braised-pork-rice.jpg",
    ln09: "images/food/ham-fried-rice.jpg",
    ln10: "images/food/conv-store-bento.jpg",
    dn01: "images/food/hot-pot.jpg",
    dn02: "images/food/popcorn-chicken.jpg",
    dn03: "images/food/luwei.jpg",
    dn04: "images/food/teppanyaki.jpg",
    dn05: "images/food/sushi-set.jpg",
    dn06: "images/food/oyster-omelet.jpg",
    dn07: "images/food/boiled-healthy-meal.jpg",
    dn08: "images/food/pasta.jpg",
    dn09: "images/food/home-cooking.jpg",
    dn10: "images/food/congee.jpg",
    sn01: "images/food/popcorn-chicken.jpg",
    sn02: "images/food/skewers-grill.jpg",
    sn03: "images/food/instant-noodles.jpg",
    sn04: "images/food/xiaolongbao.jpg",
    sn05: "images/food/fried-chicken-cutlet.jpg",
    sn06: "images/food/luwei.jpg",
    sn07: "images/food/oden.jpg",
    sn08: "images/food/cold-noodles.jpg",
    sn09: "images/food/douhua.jpg",
    sn10: "images/food/salt-water-chicken.jpg",
    dr01: "images/food/bubble-tea-full-sugar.jpg",
    dr02: "images/food/bubble-tea-half-sugar.jpg",
    dr03: "images/food/black-tea-unsweetened.jpg",
    dr04: "images/food/fruit-tea.jpg",
    dr05: "images/food/latte.jpg",
    fw01: "images/food/big-mac-meal.jpg",
    fw02: "images/food/big-mac.jpg",
    fw03: "images/food/fried-chicken-fries.jpg",
    fw04: "images/food/pizza-slices.jpg",
    fw05: "images/food/burger-meal.jpg",
  };

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
      const itemLabel = r.item_name || sizeLabel;
      const statusText = r.status === "confirmed" ? "已確認" : r.status === "cancelled" ? "已取消" : "已預約";
      const actions = r.status === "reserved"
        ? '<button type="button" class="feast-confirm" data-id="' + escapeHtml(r.id) + '">確認</button>' +
          '<button type="button" class="feast-cancel" data-id="' + escapeHtml(r.id) + '">取消</button>'
        : "";
      return '<div class="ledger-item">' +
        '<div class="ledger-item-info">' +
        '<span class="ledger-item-title">' + escapeHtml(r.plan_date) + " " + escapeHtml(slotLabel) + " · " + escapeHtml(itemLabel) + "（約 " + escapeHtml(r.estimated_kcal) + " kcal）</span>" +
        '<span class="ledger-item-status">' + statusText + "</span>" +
        "</div>" +
        '<div class="ledger-item-actions">' + actions + "</div>" +
        "</div>";
    }).join("");
  }

  function renderTaiwanItem(it) {
    const imgSrc = TAIWAN_ITEM_IMAGE[it.id];
    const imgHtml = imgSrc
      ? '<img class="taiwan-ref-img" src="' + imgSrc + '" alt="' + escapeHtml(it.name) + '" loading="lazy">'
      : "";
    const kcalText = it.kcal_rep != null
      ? "約 " + it.kcal_rep + " kcal"
      : it.kcal_low + "–" + it.kcal_high + " kcal";
    return '<div class="taiwan-ref-item">' +
      imgHtml +
      '<div class="taiwan-ref-info">' +
      '<span class="taiwan-ref-name">' + escapeHtml(it.name) + "</span>" +
      '<span class="taiwan-ref-kcal">' + escapeHtml(kcalText) + "</span>" +
      "</div>" +
      "</div>";
  }

  async function renderTaiwanRef() {
    const container = $("#taiwan-ref-list");
    if (!container) return;
    let items;
    try {
      items = await getTaiwanItems();
    } catch (err) {
      console.error(err);
      container.innerHTML = '<p class="rec-empty">載入品項參考失敗。</p>';
      return;
    }
    const byCategory = {};
    items.forEach(function (it) {
      const c = it.category || "其他";
      if (!byCategory[c]) byCategory[c] = [];
      byCategory[c].push(it);
    });
    const order = ["早餐", "午餐", "晚餐", "宵夜", "飲料", "西式速食"];
    container.innerHTML = order.map(function (cat) {
      const list = byCategory[cat] || [];
      if (list.length === 0) return "";
      return '<div class="taiwan-ref-group">' +
        '<h4 class="taiwan-ref-cat">' + escapeHtml(cat) + "</h4>" +
        '<div class="taiwan-ref-items">' +
        list.map(renderTaiwanItem).join("") +
        "</div>" +
        "</div>";
    }).join("");
  }

  async function refreshFeastItemOptions() {
    const slotSelect = document.querySelector("#feast-form select[name='slot']");
    const itemSelect = $("#feast-item-select");
    if (!slotSelect || !itemSelect) return;
    const category = SLOT_TO_TAIWAN_CATEGORY[slotSelect.value];
    if (!category) return;

    const taiwanItems = await getTaiwanItems();
    const matched = taiwanItems.filter(function (it) {
      return it.category === category;
    });
    const taiwanHtml = matched.map(function (it) {
      const kcal = it.kcal_rep != null ? it.kcal_rep : Math.round((it.kcal_low + it.kcal_high) / 2);
      return '<option value="' + escapeHtml(it.id) + '">' + escapeHtml(it.name) + "（約 " + escapeHtml(kcal) + " kcal）</option>";
    }).join("");

    const customFoods = await getCustomFoods();
    const customHtml = customFoods.length > 0
      ? '<optgroup label="我的自訂食物">' +
        customFoods.map(function (f) {
          return '<option value="' + escapeHtml(f.id) + '">' + escapeHtml(f.name) + "（約 " + escapeHtml(f.kcal) + " kcal）</option>";
        }).join("") +
        "</optgroup>"
      : "";

    itemSelect.innerHTML =
      '<option value="">不指定，用左邊份量估算</option>' +
      taiwanHtml +
      customHtml +
      '<option value="__custom_new__">自行輸入名稱與熱量…</option>';
  }

  function onItemSelectChange() {
    const itemSelect = $("#feast-item-select");
    const customRow = $("#feast-custom-food-row");
    if (!itemSelect || !customRow) return;
    if (itemSelect.value === "__custom_new__") {
      customRow.hidden = false;
    } else {
      customRow.hidden = true;
      ["custom_food_name", "custom_food_kcal", "custom_food_protein", "custom_food_fiber"].forEach(function (name) {
        const el = document.querySelector("#feast-form [name='" + name + "']");
        if (el) el.value = "";
      });
    }
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

  async function onSubmitFeastForm(e) {
    e.preventDefault();
    const form = document.getElementById("feast-form");
    const fd = new FormData(form);
    const planDate = fd.get("plan_date");
    const slot = fd.get("slot");
    const size = fd.get("size");
    const mode = fd.get("feast_mode") || "reserve";
    if (!planDate) {
      alert("請選擇日期。");
      return;
    }
    let itemId = fd.get("item_id") || null;
    if (itemId === "__custom_new__") {
      const name = (fd.get("custom_food_name") || "").trim();
      const kcal = parseFloat(fd.get("custom_food_kcal"));
      if (!name || !isFinite(kcal) || kcal <= 0) {
        alert("請填寫自訂食物的名稱與熱量。");
        return;
      }
      const protein = parseFloat(fd.get("custom_food_protein"));
      const fiber = parseFloat(fd.get("custom_food_fiber"));
      const saved = await addCustomFood({
        name: name,
        kcal: kcal,
        protein_g: isFinite(protein) ? protein : null,
        fiber_g: isFinite(fiber) ? fiber : null,
      });
      itemId = saved.id;
    }
    try {
      let logEntry = null;
      if (mode === "log") {
        logEntry = await logFeastDirectly(planDate, slot, size, itemId);
      } else {
        await reserveFeast(planDate, slot, size, itemId);
      }
      form.elements["plan_date"].value = localDateStr();
      form.elements["item_id"].value = "";
      const customRow = $("#feast-custom-food-row");
      if (customRow) customRow.hidden = true;
      ["custom_food_name", "custom_food_kcal", "custom_food_protein", "custom_food_fiber"].forEach(function (name) {
        const el = document.querySelector("#feast-form [name='" + name + "']");
        if (el) el.value = "";
      });
      await refreshFeastItemOptions();
      await render();
      if (mode === "log" && logEntry) {
        const status = $("#ledger-status");
        if (status) status.textContent = "已記錄：" + (logEntry.item_name || "大餐") + " 約 " + logEntry.kcal + " kcal";
      }
    } catch (err) {
      console.error(err);
      alert(mode === "log" ? "記錄失敗，請重試。" : "預約失敗，請重試。");
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
    if (form) form.addEventListener("submit", onSubmitFeastForm);

    const feastModeRadios = document.querySelectorAll("#feast-form input[name='feast_mode']");
    feastModeRadios.forEach(function (radio) {
      radio.addEventListener("change", function () {
        const btn = $("#feast-submit-btn");
        if (btn) btn.textContent = radio.value === "log" ? "直接記錄" : "預約";
      });
    });

    const slotSelect = document.querySelector("#feast-form select[name='slot']");
    if (slotSelect) {
      slotSelect.addEventListener("change", function () {
        const itemSelect = $("#feast-item-select");
        if (itemSelect) itemSelect.value = "";
        const customRow = $("#feast-custom-food-row");
        if (customRow) customRow.hidden = true;
        refreshFeastItemOptions();
      });
    }

    const itemSelect = $("#feast-item-select");
    if (itemSelect) itemSelect.addEventListener("change", onItemSelectChange);

    const listEl = document.getElementById("ledger-reservations");
    if (listEl) listEl.addEventListener("click", onAction);

    render();
    renderTaiwanRef();
    refreshFeastItemOptions();
  });
})();
