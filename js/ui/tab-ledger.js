// 輕盈計畫 (Lighten Plan) — 分頁三：週彈性帳本
// 依賴：database.js、nutrition.js（calculateTargets）、feast.js

(function () {
  "use strict";

  const SLOT_LABELS = { breakfast: "早餐", lunch: "午餐", afternoon_tea: "下午茶", dinner: "晚餐", snack: "宵夜" };
  const SIZE_LABELS = { S: "小", M: "中", L: "大" };

  // 「預約」是計畫還沒吃的餐，如果日期是今天、但這個時段的一般用餐時間已經過了，
  // 代表這餐要嘛已經吃過（該用「已經吃了，直接記錄」）、要嘛就是不會再吃了，不該讓使用者預約。
  // 只限制「今天 + 預約模式」，預約未來日期或「直接記錄」模式都不受此限制。
  const SLOT_END_HOUR = { breakfast: 10, lunch: 14, afternoon_tea: 17, dinner: 20, snack: 24 };

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

  function itemCardHtml(id, name, kcalText, imgSrc, extraClass) {
    const imgHtml = imgSrc
      ? '<img class="feast-item-card-img" src="' + imgSrc + '" alt="' + escapeHtml(name) + '" loading="lazy">'
      : '<div class="feast-item-card-img feast-item-card-img-empty" aria-hidden="true"></div>';
    return '<button type="button" class="feast-item-card' + (extraClass ? " " + extraClass : "") + '" data-item-id="' + escapeHtml(id) + '">' +
      imgHtml +
      '<span class="feast-item-card-name">' + escapeHtml(name) + "</span>" +
      (kcalText ? '<span class="feast-item-card-kcal">' + escapeHtml(kcalText) + "</span>" : "") +
      "</button>";
  }

  // 品項卡片只顯示目前選到的餐別對應的分類（不是一次把三餐全列出來），
  // 點卡片直接選取，取代原本看得到圖但不能點的「參考區」+ 看不到圖的下拉選單。
  async function renderItemPicker() {
    const slotSelect = document.querySelector("#feast-form select[name='slot']");
    const picker = $("#feast-item-picker");
    if (!slotSelect || !picker) return;
    const category = SLOT_TO_TAIWAN_CATEGORY[slotSelect.value];

    let matched = [];
    if (category) {
      const taiwanItems = await getTaiwanItems();
      matched = taiwanItems.filter(function (it) { return it.category === category; });
    }
    const customFoods = await getCustomFoods();

    let html = itemCardHtml("", "自訂", "份量估算或輸入名稱", "images/food/custom-other.svg", "feast-item-card-custom");
    html += matched.map(function (it) {
      const kcal = it.kcal_rep != null ? it.kcal_rep : Math.round((it.kcal_low + it.kcal_high) / 2);
      return itemCardHtml(it.id, it.name, "約 " + kcal + " kcal", TAIWAN_ITEM_IMAGE[it.id]);
    }).join("");
    html += customFoods.map(function (f) {
      return itemCardHtml(f.id, f.name, "約 " + f.kcal + " kcal", null);
    }).join("");

    picker.innerHTML = html;
    updateItemPickerSelection();
  }

  function updateItemPickerSelection() {
    const picker = $("#feast-item-picker");
    const valueInput = $("#feast-item-select");
    if (!picker || !valueInput) return;
    const current = valueInput.value || "";
    picker.querySelectorAll(".feast-item-card").forEach(function (card) {
      card.classList.toggle("selected", (card.getAttribute("data-item-id") || "") === current);
    });
  }

  // 熱量欄位預設「跟著份量走」（小/中/大 → 400/700/1200），讓使用者選份量時能直接看到數字，
  // 而不是送出後才知道估算值。一旦使用者自己手動改過熱量，就不再被份量覆蓋，直到重新選回「自訂」卡。
  let kcalManuallyEdited = false;

  function syncKcalFromSize() {
    if (kcalManuallyEdited) return;
    const sizeSelect = document.querySelector("#feast-form select[name='size']");
    const kcalInput = document.querySelector("#feast-form [name='custom_food_kcal']");
    if (!sizeSelect || !kcalInput) return;
    const map = window.FEAST_SIZE_KCAL || { S: 400, M: 700, L: 1200 };
    kcalInput.value = map.hasOwnProperty(sizeSelect.value) ? map[sizeSelect.value] : "";
  }

  // 「自訂」卡片把「不指定（用份量估算）」跟「自行輸入名稱/熱量」合併成同一張卡：
  // 選到具體品項（taiwan_items/自訂食物）時，份量跟名稱/熱量欄位都跟這筆記錄無關，一起隱藏；
  // 選到「自訂」（item_id === ""）時才顯示，熱量重新跟著份量自動帶出。
  function onItemSelectChange() {
    const valueInput = $("#feast-item-select");
    const customRow = $("#feast-custom-row");
    if (!valueInput || !customRow) return;
    const isCustom = valueInput.value === "";
    customRow.hidden = !isCustom;
    if (isCustom) {
      kcalManuallyEdited = false;
      syncKcalFromSize();
    } else {
      ["custom_food_name", "custom_food_kcal", "custom_food_protein", "custom_food_fiber"].forEach(function (name) {
        const el = document.querySelector("#feast-form [name='" + name + "']");
        if (el) el.value = "";
      });
    }
  }

  function onItemPickerClick(e) {
    const card = e.target.closest(".feast-item-card");
    if (!card) return;
    const valueInput = $("#feast-item-select");
    if (!valueInput) return;
    valueInput.value = card.getAttribute("data-item-id") || "";
    updateItemPickerSelection();
    onItemSelectChange();
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

    // 彈性帳本改成逐日結算（見 feast.js 的 settleWeeklyLedger），每次進這頁順便結算一次
    // 「昨天以前」還沒結算的日子，不用再靠預約/記錄當下手動加減。
    await settleWeeklyLedger(profile);
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
    // min/max 屬性只是讓瀏覽器的日期選擇器「傾向」擋掉，使用者仍可手動輸入繞過，
    // 送出時要再明確驗證一次，不能只靠屬性。
    const today = localDateStr();
    if (mode === "log" && planDate > today) {
      alert("「已經吃了，直接記錄」不能選未來日期。");
      return;
    }
    if (mode !== "log" && planDate < today) {
      alert("「預約」不能選過去日期。");
      return;
    }
    // 同樣道理：時段的 disabled 只是 UI 提示，送出時要再驗證一次。
    if (mode !== "log" && planDate === today && SLOT_END_HOUR.hasOwnProperty(slot)) {
      const now = new Date();
      const currentHour = now.getHours() + now.getMinutes() / 60;
      if (currentHour >= SLOT_END_HOUR[slot]) {
        alert("現在已經過了" + (SLOT_LABELS[slot] || slot) + "的一般用餐時間，不能預約今天的" + (SLOT_LABELS[slot] || slot) + "。如果已經吃了，請改用「已經吃了，直接記錄」。");
        return;
      }
    }
    let itemId = fd.get("item_id") || null;
    // 選「自訂」卡片（item_id 空字串）時：熱量欄位會跟著「份量」自動帶出估算值（見 onSizeChange），
    // 純粹是給使用者看數字、可以手動覆蓋，不代表使用者「有意」建立一筆具名的自訂食物。
    // 真正決定要不要存成自訂食物的判斷點是「有沒有填名稱」：填了名稱才連同熱量一起存；
    // 沒填名稱就當作單純用份量估算，忽略熱量欄位目前顯示的值（避免自動帶出的數字被誤判成使用者輸入）。
    if (!itemId) {
      const name = (fd.get("custom_food_name") || "").trim();
      if (name) {
        const kcal = parseFloat(fd.get("custom_food_kcal"));
        if (!isFinite(kcal) || kcal <= 0) {
          alert("請填寫熱量。");
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
      ["custom_food_name", "custom_food_kcal", "custom_food_protein", "custom_food_fiber"].forEach(function (name) {
        const el = document.querySelector("#feast-form [name='" + name + "']");
        if (el) el.value = "";
      });
      onItemSelectChange();
      await renderItemPicker();
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

  // 「預約」是計畫未來要吃的，選過去日期沒意義；「已經吃了，直接記錄」是補記，
  // 只能記錄今天或以前吃過的，選未來日期也沒意義。兩種模式的日期限制互斥。
  function updateDateConstraint(mode) {
    const dateInput = document.querySelector("#feast-form input[name='plan_date']");
    if (!dateInput) return;
    const today = localDateStr();
    if (mode === "log") {
      dateInput.removeAttribute("min");
      dateInput.max = today;
      if (dateInput.value && dateInput.value > today) dateInput.value = today;
    } else {
      dateInput.removeAttribute("max");
      dateInput.min = today;
      if (dateInput.value && dateInput.value < today) dateInput.value = today;
    }
  }

  function currentFeastMode() {
    const checked = document.querySelector("#feast-form input[name='feast_mode']:checked");
    return checked ? checked.value : "reserve";
  }

  // 「預約」+ 日期是今天時，把已經過了一般用餐時間的時段選項鎖住（disabled），
  // 避免使用者選了一個其實已經沒意義的預約（該用「直接記錄」或根本不會再吃）。
  function updateSlotAvailability() {
    const dateInput = document.querySelector("#feast-form input[name='plan_date']");
    const slotSelect = document.querySelector("#feast-form select[name='slot']");
    if (!dateInput || !slotSelect) return;
    const mode = currentFeastMode();
    const isToday = dateInput.value === localDateStr();
    const now = new Date();
    const currentHour = now.getHours() + now.getMinutes() / 60;

    let selectedIsDisabled = false;
    Array.prototype.forEach.call(slotSelect.options, function (opt) {
      const passed = mode !== "log" && isToday && SLOT_END_HOUR.hasOwnProperty(opt.value) && currentHour >= SLOT_END_HOUR[opt.value];
      opt.disabled = passed;
      if (passed && opt.selected) selectedIsDisabled = true;
    });
    if (selectedIsDisabled) {
      const firstEnabled = Array.prototype.filter.call(slotSelect.options, function (opt) { return !opt.disabled; })[0];
      if (firstEnabled) {
        slotSelect.value = firstEnabled.value;
        slotSelect.dispatchEvent(new Event("change"));
      }
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
        updateDateConstraint(radio.value);
        updateSlotAvailability();
      });
    });
    const checkedMode = document.querySelector("#feast-form input[name='feast_mode']:checked");
    updateDateConstraint(checkedMode ? checkedMode.value : "reserve");

    if (dateInput) dateInput.addEventListener("change", updateSlotAvailability);

    const slotSelect = document.querySelector("#feast-form select[name='slot']");
    if (slotSelect) {
      slotSelect.addEventListener("change", function () {
        const valueInput = $("#feast-item-select");
        if (valueInput) valueInput.value = "";
        renderItemPicker();
        onItemSelectChange();
      });
    }
    updateSlotAvailability();

    const picker = $("#feast-item-picker");
    if (picker) picker.addEventListener("click", onItemPickerClick);

    const sizeSelect = document.querySelector("#feast-form select[name='size']");
    if (sizeSelect) sizeSelect.addEventListener("change", syncKcalFromSize);

    const kcalInput = document.querySelector("#feast-form [name='custom_food_kcal']");
    if (kcalInput) kcalInput.addEventListener("input", function () { kcalManuallyEdited = true; });

    const listEl = document.getElementById("ledger-reservations");
    if (listEl) listEl.addEventListener("click", onAction);

    render();
    renderItemPicker();
    onItemSelectChange();
  });
})();
