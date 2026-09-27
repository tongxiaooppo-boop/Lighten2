// 輕盈計畫 (Lighten Plan) — 分頁三：美饗日曆（大餐預約/直接記錄 + 近7天平均）
// 依賴：database.js、nutrition.js（calculateTargets）、feast.js、tdee.js（getCalibratedTargets）

(function () {
  "use strict";

  const SLOT_LABELS = { breakfast: "早餐", lunch: "午餐", afternoon_tea: "下午茶", dinner: "晚餐", snack: "宵夜" };
  const SIZE_LABELS = { S: "小", M: "中", L: "大" };
  const WEEKDAYS = ["日", "一", "二", "三", "四", "五", "六"];
  const FEAST_CAL_WINDOW_WEEKS = 3; // 一次顯示 3 週，用「往前/往後一週」捲動看更遠的日期

  // 「預約」是計畫還沒吃的餐，如果日期是今天、但這個時段的一般用餐時間已經過了，
  // 代表這餐要嘛已經吃過（該用「已經吃了，直接記錄」）、要嘛就是不會再吃了，不該讓使用者預約。
  // 只限制「今天 + 預約模式」，預約未來日期或「直接記錄」模式都不受此限制。
  const SLOT_END_HOUR = { breakfast: 10, lunch: 14, afternoon_tea: 17, dinner: 20, snack: 24 };

  // 品項清單依資料本身的 valid_slots 過濾（跟 recommend.js 同一份定義）；飲料是使用者自己要點的，
  // 五個時段都列出來。原本用分類對照表，午／晚餐漏了西式速食，大麥克無法預約（2026-09-27 整案審查）。
  function itemFitsSlot(it, slot) {
    return it.role === "drink" || (Array.isArray(it.valid_slots) && it.valid_slots.indexOf(slot) !== -1);
  }

  // 台式熱門品項 id → 縮圖（查不到就不顯示，正常降級）
  const TAIWAN_ITEM_IMAGE = {
    bf01: "images/food/egg-pancake.jpg",
    bf02: "images/food/milk-glass.jpg",
    bf03: "images/food/rice-ball.jpg",
    bf04: "images/food/pork-egg-toast.jpg",
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
    dr06: "images/food/soy-milk.jpg",
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

  function fmt(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return y + "-" + m + "-" + day;
  }

  function localDateStr() { return fmt(new Date()); }

  function dateAddDays(dateStr, days) {
    const d = new Date(dateStr + "T00:00:00");
    d.setDate(d.getDate() + days);
    return fmt(d);
  }

  function escapeHtml(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  async function renderRecentAvg(targets, profile) {
    const today = localDateStr();
    const sevenAgo = dateAddDays(today, -7); // 近7天平均不含今天，窗口往前多抓一天
    const recentLogs = await getDailyLogs({ start: sevenAgo, end: today });
    const recent = computeRecentAvgVsTarget(recentLogs, targets.targetKcal, profile.enabled_slots, 7);
    const el = $("#ledger-recent-avg");
    if (el) {
      el.textContent = recent.status === "ok"
        ? "近7天平均 " + Math.round(recent.avgKcal) + "／目標 " + Math.round(recent.targetKcal) + " kcal"
        : "資料不足";
    }
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
    const slot = slotSelect.value;
    // 硬性過濾（過敏原/飲食限制/不吃清單）：命中品項灰階＋顯示原因，不從清單移除（Opus 條件 4）。
    var profile = currentProfile;
    if (!profile) {
      try { profile = await getProfile(); currentProfile = profile; } catch (e) { console.error(e); }
    }
    const filtered = await window.ItemPicker.filterForSlot(slot, profile, { includeConvenience: false });

    let html = itemCardHtml("", "自訂", "份量估算或輸入名稱", "images/food/custom-other.svg", "feast-item-card-custom");
    html += filtered.pass.map(function (it) {
      return window.ItemPicker.cardHtml(it, {});
    }).join("");
    html += filtered.blocked.map(function (b) {
      return window.ItemPicker.cardHtml(b.item, { blockedReason: b.reason });
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
  var currentProfile = null; // renderItemPicker 的硬性過濾要用（render() 每次切分頁會更新）

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
    currentProfile = profile;

    // 近7天平均 vs 目標（取代舊的進度條顯示）。
    let targets;
    try {
      targets = await getCalibratedTargets(profile);
      await renderRecentAvg(targets, profile);
    } catch (err) {
      console.error(err);
    }

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
    // 月曆格子本身已經把不合法的日期畫成不可點，這裡送出時再驗證一次是防禦性檢查
    // （例如表單被用其他方式送出、或畫面狀態沒跟資料同步時）。
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
      setFeastDate(localDateStr());
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
  // 日期選擇改成 inline 週捲動月曆格（參考 jioka2 專案的 calendarHtml 做法），
  // 不再用原生 <input type="date">：格子本身依模式把不能選的日期顯示成灰階不可點，
  // 使用者看得到完整範圍再挑，不用另外看 min/max 限制文字。
  let feastCalWeekOffset = 0;

  function feastDateValue() {
    const el = $("#feast-date-value");
    return el ? el.value : "";
  }

  function feastCalendarRange(weekOffset) {
    const today = new Date();
    const start = new Date(today.getFullYear(), today.getMonth(), today.getDate() - today.getDay() + (weekOffset || 0) * 7);
    return { start: start, weeks: FEAST_CAL_WINDOW_WEEKS };
  }

  function setFeastDate(dateStr) {
    const el = $("#feast-date-value");
    if (el) el.value = dateStr;
    renderFeastDatePicker();
    updateSlotAvailability();
  }

  // 依模式把值夾回合法範圍內（預約不能是過去、直接記錄不能是未來），並把月曆視窗跳到
  // 對該模式最有用的位置：預約從這週開始往後看；直接記錄以這週為終點往前看（多數補記
  // 都是記最近幾天，這樣切過去不用手動點「往前一週」才看得到能選的日期）。
  function updateDateConstraint(mode) {
    const today = localDateStr();
    const current = feastDateValue();
    let next = current;
    if (mode === "log") {
      if (current && current > today) next = today;
      feastCalWeekOffset = -(FEAST_CAL_WINDOW_WEEKS - 1);
    } else {
      if (!current || current < today) next = today;
      feastCalWeekOffset = 0;
    }
    const el = $("#feast-date-value");
    if (el) el.value = next;
    renderFeastDatePicker();
  }

  function renderFeastDatePicker() {
    const picker = $("#feast-date-picker");
    if (!picker) return;
    const mode = currentFeastMode();
    const today = localDateStr();
    const selected = feastDateValue();
    const range = feastCalendarRange(feastCalWeekOffset);
    const end = new Date(range.start.getFullYear(), range.start.getMonth(), range.start.getDate() + range.weeks * 7 - 1);
    const label = (range.start.getMonth() + 1) + "/" + range.start.getDate() + " – " + (end.getMonth() + 1) + "/" + end.getDate();

    let html = '<div class="fdp-header"><div class="fdp-title">' + label + '</div><div class="fdp-nav">' +
      '<button type="button" class="fdp-nav-btn" id="fdp-prev">‹ 往前一週</button> ' +
      '<button type="button" class="fdp-nav-btn" id="fdp-next">往後一週 ›</button></div></div>';

    html += '<div class="fdp-grid">';
    WEEKDAYS.forEach(function (w) {
      html += '<div class="fdp-dow">' + w + '</div>';
    });
    for (let i = 0; i < range.weeks * 7; i++) {
      const d = new Date(range.start.getFullYear(), range.start.getMonth(), range.start.getDate() + i);
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, "0");
      const day = String(d.getDate()).padStart(2, "0");
      const dateStr = y + "-" + m + "-" + day;
      const disabled = mode === "log" ? dateStr > today : dateStr < today;
      let cls = "fdp-day";
      if (disabled) cls += " fdp-disabled";
      if (dateStr === today) cls += " fdp-today";
      if (dateStr === selected) cls += " fdp-selected";
      const attr = disabled ? "" : ' data-date="' + dateStr + '"';
      html += '<div class="' + cls + '"' + attr + '>' + d.getDate() + "</div>";
    }
    html += "</div>";

    picker.innerHTML = html;

    const prevBtn = $("#fdp-prev");
    if (prevBtn) prevBtn.addEventListener("click", function () {
      feastCalWeekOffset -= 1;
      renderFeastDatePicker();
    });
    const nextBtn = $("#fdp-next");
    if (nextBtn) nextBtn.addEventListener("click", function () {
      feastCalWeekOffset += 1;
      renderFeastDatePicker();
    });
    picker.querySelectorAll(".fdp-day[data-date]").forEach(function (cell) {
      cell.addEventListener("click", function () {
        setFeastDate(cell.getAttribute("data-date"));
      });
    });
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
    const dateValueEl = $("#feast-date-value");
    if (dateValueEl) dateValueEl.value = localDateStr();

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

    // 從其他分頁切回來時重新讀資料（例如在今日建議記錄一餐後，近7天平均跟預約清單要更新）。
    document.addEventListener("tab:activated", function (e) {
      if (e.detail === "ledger") render();
    });

    render();
    renderItemPicker();
    onItemSelectChange();
  });
})();
