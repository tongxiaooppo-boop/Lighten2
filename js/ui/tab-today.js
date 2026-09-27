// 輕盈計畫 (Lighten Plan) — 分頁二：今日建議
// 依賴：database.js、nutrition.js、budget.js、matcher.js、recommend.js、feast.js、tdee.js

(function () {
  "use strict";

  const SLOTS = window.RECOMMEND_SLOTS || ["breakfast", "lunch", "dinner", "snack"];
  const SLOT_LABELS = window.RECOMMEND_SLOT_LABELS || {
    breakfast: "早餐",
    lunch: "午餐",
    dinner: "晚餐",
    snack: "宵夜",
  };

  // 蛋白質來源 → 食材縮圖（對照 data/protein_sources.json 的 name；查不到就不顯示圖片，正常降級）
  const PROTEIN_IMAGE = {
    // 2026-09-25 移除「乳清蛋白粉」：原圖是有品牌商標/廣告字樣的市售產品照，跟其他中性食材縮圖風格不一致，
    // 也不適合代表整份組合餐點；查不到圖片會正常降級成不顯示（跟超商品項目前的處理方式一致）。
    "雞胸肉": "images/food/chicken-breast.jpg",
    "雞蛋": "images/food/egg.jpg",
    "希臘優格": "images/food/greek-yogurt.jpg",
    "鮭魚": "images/food/salmon.jpg",
    "牛肉": "images/food/beef.jpg",
    "雞腿肉": "images/food/chicken-thigh.jpg",
    "鯛魚": "images/food/tilapia.jpg",
    "板豆腐": "images/food/tofu.jpg",
    "蝦仁": "images/food/shrimp.jpg",
    "無糖豆漿": "images/food/soy-milk.jpg",
  };

  // 時段 → 預設插畫（找不到具體食物照片時墊底用，取代原本依「來源」分色的漸層色塊）。
  // 溫馨手繪風格，5 張同一套風格、只有時段場景不同，跟 images/food/ 那批寫實食物照刻意區隔。
  const MEAL_DEFAULT_IMAGE = {
    breakfast: "images/gemini/meal-default-breakfast.jpg",
    lunch: "images/gemini/meal-default-lunch.jpg",
    afternoon_tea: "images/gemini/meal-default-afternoon-tea.jpg",
    dinner: "images/gemini/meal-default-dinner.jpg",
    snack: "images/gemini/meal-default-snack.jpg",
  };

  // 記錄「最近一次」的推薦結果，供「記錄這餐」按鈕點擊時找到對應 slot 的 rec
  let currentRecs = {};

  function ready(fn) {
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", fn);
    else fn();
  }

  function $(sel) {
    return document.querySelector(sel);
  }

  function fmt(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return y + "-" + m + "-" + day;
  }

  function localDateStr() {
    return fmt(new Date());
  }

  function mondayOfThisWeek() {
    const d = new Date();
    const day = d.getDay(); // 0=Sun
    const diff = day === 0 ? 6 : day - 1;
    d.setDate(d.getDate() - diff);
    return fmt(d);
  }

  function dateAddDays(dateStr, days) {
    const d = new Date(dateStr + "T00:00:00");
    d.setDate(d.getDate() + days);
    return fmt(d);
  }

  function shortDate(dateStr) {
    return dateStr ? dateStr.slice(5).replace("-", "/") : "";
  }

  function isWeekend() {
    const d = new Date().getDay();
    return d === 0 || d === 6;
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function setStatus(msg) {
    const el = $("#today-status");
    if (el) el.textContent = msg || "";
  }

  const RESERVATION_SIZE_LABELS = { S: "小", M: "中", L: "大" };

  // 這個時段已經記錄過（2026-09-27 整案審查 A3）：顯示記了什麼＋撤銷，不再推薦新的組合。
  // 撤銷按鈕跟著卡片一起渲染（用 daily_log 的 id），所以任何重新整理都不會把它吃掉。
  // 從預約確認來的紀錄要到美饗日曆處理，這裡不給撤銷。
  function loggedHtml(logs) {
    const total = logs.reduce(function (sum, l) { return sum + (Number(l.kcal) || 0); }, 0);
    const names = logs.map(function (l) { return l.item_name || "已記錄的餐點"; }).join("、");
    let html = '<p class="rec-reservation-note">已記錄：' + escapeHtml(names) + "（約 " + Math.round(total) + " kcal）</p>";
    logs.forEach(function (l) {
      if (!l.feast_reservation_id) {
        html += '<button type="button" class="feast-cancel rec-undo-btn" data-log-id="' + escapeHtml(l.id) + '">撤銷' +
          (logs.length > 1 ? "「" + escapeHtml(l.item_name || "") + "」" : "") + "</button>";
      }
    });
    return html;
  }

  // 這個時段已經有預約中的大餐時，不要再顯示一般推薦——使用者已經決定這餐要吃什麼了，
  // 繼續推薦別的東西只會讓人以為系統沒看到預約、或不確定該吃哪一個。
  // 依組合內容列出可以「順便不要」的項目（Part 4）：
  //   自組食譜 → 蛋白質 + 蔬菜兩個 chip；現成品項組合 → 每個成分名稱一個 chip；沒有可拆解成分就不顯示。
  function dislikeChipsHtml(rec) {
    var entries = [];
    if (rec.is_composed) {
      if (rec.protein_name) entries.push({ type: "protein", key: rec.protein_name, label: rec.protein_name });
      if (rec.vegetable_name) entries.push({ type: "vegetable", key: rec.vegetable_name, label: rec.vegetable_name });
    } else if (Array.isArray(rec.component_labels)) {
      rec.component_labels.forEach(function (c) { entries.push({ type: "item", key: c.uid, label: c.label }); });
    }
    if (entries.length === 0) return "";
    var chips = entries.map(function (e) {
      return '<button type="button" class="dislike-chip" data-type="' + escapeHtml(e.type) +
        '" data-key="' + escapeHtml(e.key) + '" data-label="' + escapeHtml(e.label) + '">' + escapeHtml(e.label) + "</button>";
    }).join("");
    return '<div class="dislike-chips"><span class="dislike-chips-label">順便不要：</span>' + chips + "</div>";
  }

  function renderRecs(recs, profile, reservationsBySlot, logsBySlot) {
    SLOTS.forEach(function (slot) {
      const body = $("#rec-" + slot);
      if (!body) return;
      const isEnabled = !profile || window.isSlotEnabled(profile.enabled_slots, slot);
      if (!isEnabled) {
        body.innerHTML = '<p class="rec-empty">已設定不需要這個時段的建議，可到基本資料分頁調整</p>';
        return;
      }
      const slotLogs = logsBySlot && logsBySlot[slot];
      if (slotLogs && slotLogs.length > 0) {
        body.innerHTML = loggedHtml(slotLogs);
        return;
      }
      const reservation = reservationsBySlot && reservationsBySlot[slot];
      if (reservation) {
        const label = reservation.item_name || (RESERVATION_SIZE_LABELS[reservation.size] || "") + "份量";
        body.innerHTML =
          '<p class="rec-reservation-note">已預約：' + escapeHtml(label) + "（約 " + escapeHtml(reservation.estimated_kcal) + " kcal）</p>" +
          '<button type="button" class="secondary-btn rec-goto-ledger-btn">到美饗日曆確認／取消</button>';
        const gotoBtn = body.querySelector(".rec-goto-ledger-btn");
        if (gotoBtn) gotoBtn.addEventListener("click", function () {
          if (window.activateTab) window.activateTab("ledger");
        });
        return;
      }
      const rec = recs[slot];
      if (!rec) {
        body.innerHTML = '<p class="rec-empty">暫無適合的組合</p>';
        return;
      }
      // 7a：依序分配後配額低於門檻（不是「找不到組合」，是「配額被前面時段用完了」）
      if (rec.lowBudget) {
        body.innerHTML = '<p class="rec-empty">這個時段的配額已經不多了</p>';
        return;
      }
      // 找不到具體食物照片時（超商/台式外送品項、或還沒建檔縮圖的食材），墊底用該時段的預設插畫，
      // 取代原本依「來源」分色的漸層色塊。
      const imgSrc = PROTEIN_IMAGE[rec.protein_name] || MEAL_DEFAULT_IMAGE[slot];
      const imgHtml = imgSrc
        ? '<img class="rec-card-img" src="' + imgSrc + '" alt="' + escapeHtml(rec.protein_name || SLOT_LABELS[slot] || "") + '" loading="lazy">'
        : "";
      const fallbackNote = rec.fallback_to_auto
        ? '<p class="rec-fallback-note">今天這個來源沒有合適的選擇，已改為一般推薦</p>'
        : "";
      const contentNote = rec.content_note
        ? '<p class="rec-content-note">' + escapeHtml(rec.content_note) + "</p>"
        : "";
      body.innerHTML =
        imgHtml +
        fallbackNote +
        '<div class="rec-name">' + escapeHtml(rec.name) + "</div>" +
        contentNote +
        '<div class="rec-meta">' +
        escapeHtml(rec.tier) + " · 約 " + rec.scaled_kcal + " kcal" +
        '<span class="rec-base">（基準 ' + rec.kcal + " kcal）</span>" +
        (rec.budget != null ? '<span class="rec-base"> · 配額 ' + Math.round(rec.budget) + " kcal</span>" : "") +
        "</div>" +
        dislikeChipsHtml(rec) +
        '<button type="button" class="dislike-btn" data-id="' + escapeHtml(rec.id) + '">倒讚</button>' +
        '<button type="button" class="secondary-btn rec-log-btn" data-slot="' + escapeHtml(slot) + '">記錄這餐</button>' +
        '<button type="button" class="secondary-btn rec-pick-btn" data-slot="' + escapeHtml(slot) + '">自己選</button>';
    });
  }

  // 頂部彙總卡：今日未記錄時段的建議熱量（recalcTodayBudget 已算好）+ 今天蛋白質/纖維攝取量
  // + 近7天平均 vs 目標 + 體重趨勢校正提示（pending / 自動調整告知）。
  async function renderHero(remainingBudget, targets, todayLogs, recentLogs, profile, recs) {
    const hero = $("#today-hero");
    if (!hero) return;
    // null-safe 累加：跳過 null（缺資料），不當 0 加
    var eatenProtein = 0, eatenCarb = 0, eatenFat = 0, eatenFiber = 0;
    var missingCoverageKcal = 0;
    todayLogs.forEach(function (l) {
      eatenProtein += l.protein_g != null ? Number(l.protein_g) : 0;
      eatenCarb += l.carb_g != null ? Number(l.carb_g) : 0;
      eatenFat += l.fat_g != null ? Number(l.fat_g) : 0;
      eatenFiber += l.fiber_g != null ? Number(l.fiber_g) : 0;
      // 資料涵蓋率：缺資料只看欄位是不是 null。
      // 2026-09-27：taiwan_items.json 已用食物代換表份量概念回填 carb_g/fat_g 估算值，
      // 拿掉原本「source_type 是 taiwan_item 就當缺資料」的舊版 fallback——那條是給「改版前
      // fromTaiwan() 寫死 0」的舊紀錄用的，現在台式品項的新紀錄有真正的估算值，不能再一律當缺資料。
      if (l.fat_g == null || l.carb_g == null) {
        missingCoverageKcal += Number(l.kcal) || 0;
      }
    });
    // 所有開啟的時段都記錄完時，「接下來幾餐」已經不存在，改顯示記錄完成、不顯示數字
    // （這個數字是「目標減已記錄」，記完之後仍可能是正數，繼續顯示會像在叫人再吃一餐）。
    const loggedSlots = {};
    todayLogs.forEach(function (l) { loggedSlots[l.slot] = true; });
    const allLogged = SLOTS.every(function (s) {
      return !window.isSlotEnabled(profile.enabled_slots, s) || loggedSlots[s];
    });
    $("#today-hero-label").textContent = allLogged ? "今天的餐點都記錄完了" : "接下來幾餐的建議熱量";
    $("#today-hero-kcal").hidden = allLogged;
    $("#today-hero-kcal-value").textContent = Math.round(remainingBudget.remainingKcal);
    $("#today-hero-protein").textContent = Math.round(eatenProtein) + " / " + Math.round(targets.protein_g) + "g";
    $("#today-hero-fiber").textContent = Math.round(eatenFiber) + " / " + Math.round(targets.fiber_g) + "g";

    // 7b：次要行「目前這幾餐建議合計」，跟主數字有落差時顯示差額。
    var subEl = $("#today-hero-kcal-sub");
    if (subEl) {
      if (!allLogged && recs) {
        var cardTotal = 0;
        SLOTS.forEach(function (s) {
          var r = recs[s];
          if (r && !r.lowBudget && r.scaled_kcal != null) cardTotal += r.scaled_kcal;
        });
        cardTotal = Math.round(cardTotal);
        if (cardTotal > 0) {
          var diff = cardTotal - Math.round(remainingBudget.remainingKcal);
          $("#today-hero-kcal-sub-value").textContent = cardTotal + (Math.abs(diff) >= 20 ? "（" + (diff > 0 ? "+" : "") + Math.round(diff) + "）" : "");
          subEl.hidden = false;
        } else { subEl.hidden = true; }
      } else { subEl.hidden = true; }
    }

    // 7c：營養素明細（<details> 展開區塊）
    var nutritionEl = $("#today-hero-nutrition");
    if (nutritionEl) {
      var body = $("#today-hero-nutrition-body");
      if (body) {
        body.innerHTML =
          '<div class="today-hero-stat"><span class="today-hero-stat-label">蛋白質</span><span class="today-hero-stat-value">' + Math.round(eatenProtein) + " / " + Math.round(targets.protein_g) + "g（" + Math.round(eatenProtein * 4 / targets.targetKcal * 100) + "%）</span></div>" +
          '<div class="today-hero-stat"><span class="today-hero-stat-label">脂肪</span><span class="today-hero-stat-value">' + Math.round(eatenFat) + " / " + Math.round(targets.fat_g) + "g（" + Math.round(eatenFat * 9 / targets.targetKcal * 100) + "%）</span></div>" +
          '<div class="today-hero-stat"><span class="today-hero-stat-label">碳水（參考值）</span><span class="today-hero-stat-value">' + Math.round(eatenCarb) + " / " + Math.round(targets.carb_g) + "g（" + Math.round(eatenCarb * 4 / targets.targetKcal * 100) + "%）</span></div>" +
          '<div class="today-hero-stat"><span class="today-hero-stat-label">纖維</span><span class="today-hero-stat-value">' + Math.round(eatenFiber) + " / " + Math.round(targets.fiber_g) + "g</span></div>" +
          '<p class="taiwan-ref-note">碳水是用目標熱量扣掉蛋白質、脂肪熱量後反推出來的，不是獨立設定的建議值。</p>';
      }
      nutritionEl.hidden = false;
    }
    // 資料涵蓋率警語
    var coverageEl = $("#today-hero-coverage-warn");
    if (coverageEl) {
      if (missingCoverageKcal > 0) {
        coverageEl.textContent = "今天有 " + Math.round(missingCoverageKcal) + " kcal 來自沒有脂肪/碳水資料的品項（超商即食／台式外送），這部分的脂肪、碳水沒有算進上面的數字。";
        coverageEl.hidden = false;
      } else { coverageEl.hidden = true; }
    }

    const recent = computeRecentAvgVsTarget(recentLogs, targets.targetKcal, profile.enabled_slots, 7);
    const avgEl = $("#today-hero-week-avg");
    if (avgEl) {
      avgEl.textContent = recent.status === "ok"
        ? "近7天平均 " + Math.round(recent.avgKcal) + "／目標 " + Math.round(recent.targetKcal) + " kcal"
        : "資料不足";
    }

    // 校正提示：pending 或自動調整告知，只顯示其中一個。
    const promptEl = $("#today-hero-calibration");
    if (promptEl) {
      let html = "";
      try {
        const state = await getTdeeState();
        const today = localDateStr();
        if (state.pending) {
          html = '<button type="button" class="today-cal-link" id="today-cal-pending">基本資料有一項目標調整建議待你確認</button>';
        } else if (state.announce_until && today <= state.announce_until && state.offset_kcal !== 0) {
          const newTargets = await getCalibratedTargets(profile, state.effective_date);
          html = '<p class="today-cal-announce">依近4週體重趨勢，每日目標從 ' + shortDate(state.effective_date) + ' 起調整為 ' + Math.round(newTargets.targetKcal) + ' kcal</p>';
        }
      } catch (err) {
        console.error(err);
      }
      promptEl.innerHTML = html;
      promptEl.hidden = html === "";
      const pendingBtn = promptEl.querySelector("#today-cal-pending");
      if (pendingBtn) {
        pendingBtn.addEventListener("click", function () {
          if (window.activateTab) window.activateTab("profile");
        });
      }
    }

    hero.hidden = false;
  }

  async function buildRecommendation() {
    setStatus("載入中…");
    let profile;
    try {
      profile = await getProfile();
    } catch (e) {
      console.error(e);
      setStatus("讀取基本資料失敗。");
      return;
    }

    if (!profile) {
      setStatus("請先到「基本資料」分頁填寫並按「計算」後，再回來看今日建議。");
      currentRecs = {};
      SLOTS.forEach(function (slot) {
        const body = $("#rec-" + slot);
        if (body) body.innerHTML = "";
      });
      const hero = $("#today-hero");
      if (hero) hero.hidden = true;
      return;
    }

    let targets;
    try {
      targets = await getCalibratedTargets(profile);
    } catch (e) {
      console.error(e);
      setStatus("計算今日目標失敗，請重新整理頁面。");
      return;
    }
    const today = localDateStr();
    const monday = mondayOfThisWeek();
    // 近7天平均不含今天（見 budget.js computeRecentAvgVsTarget 的說明），窗口往前多抓一天。
    const sevenAgo = dateAddDays(today, -7);

    const [todayLogs, weekLogs, recentLogs, todayReservations] = await Promise.all([
      getDailyLogs({ start: today, end: today }),
      getDailyLogs({ start: monday, end: today }),
      getDailyLogs({ start: sevenAgo, end: today }),
      getFeastReservations({ status: "reserved", start: today, end: today }),
    ]);

    // 大餐當天：「預約中」的大餐當成暫時紀錄餵給 recalcTodayBudget，讓其他還沒吃的時段配額提前反映。
    const pseudoLogsForBudget = todayLogs.concat(
      todayReservations.map(function (r) {
        return { slot: r.slot, kcal: r.estimated_kcal };
      })
    );
    const remainingBudget = recalcTodayBudget(targets.targetKcal, pseudoLogsForBudget, profile.enabled_slots);

    // Part 7：預約中的大餐也要影響蛋白質/纖維缺口。把每筆預約的巨量營養素解回後，
    // 跟 weekLogs concat 傳給 checkHardConstraints（預約還沒寫進 daily_log，concat 不會重複計算）。
    const reservationMacros = await Promise.all(
      todayReservations.map(async function (r) {
        const resolved = await resolveFeastItem(r.item_id, r.size);
        return { log_date: today, slot: r.slot, protein_g: resolved.protein_g, fiber_g: resolved.fiber_g };
      })
    );
    const hardConstraints = checkHardConstraints(weekLogs.concat(reservationMacros), profile);

    // 已記錄、已預約、已關閉的時段都不需要推薦，也不該佔用跨時段不重複的名額。
    const logsBySlot = {};
    todayLogs.forEach(function (l) {
      if (!logsBySlot[l.slot]) logsBySlot[l.slot] = [];
      logsBySlot[l.slot].push(l);
    });
    const reservationsBySlot = {};
    todayReservations.forEach(function (r) { reservationsBySlot[r.slot] = r; });
    const skipSlots = {};
    SLOTS.forEach(function (slot) {
      if (logsBySlot[slot] || reservationsBySlot[slot] || !window.isSlotEnabled(profile.enabled_slots, slot)) skipSlots[slot] = true;
    });

    const recs = await getTodayRecommendation(
      remainingBudget,
      hardConstraints,
      profile.meal_prefs,
      profile.diet_restriction,
      profile.allergens,
      skipSlots,
      profile.disliked_ingredients
    );
    currentRecs = recs;

    renderHero(remainingBudget, targets, todayLogs, recentLogs, profile, recs).catch(function (err) { console.error(err); });

    renderRecs(recs, profile, reservationsBySlot, logsBySlot);
    // 修既有 bug：score() 的「近期出現過降權」一直讀 shown_count/last_shown_date，
    // 但這兩個欄位過去只在使用者按「倒讚」時才寫入，單純顯示從沒被記錄過，降權形同死碼。
    // 在畫面實際渲染出卡片的當下記錄「這個組合今天被顯示過」，同一天重複整理不重複累加。
    const shownIds = Object.keys(recs).map(function (slot) { return recs[slot] && recs[slot].id; }).filter(Boolean);
    if (shownIds.length > 0) markRecipesShown(shownIds).catch(function (err) { console.error(err); });
    setStatus("");
  }

  // 推薦的組合一律照組合本身算好的數字記錄，不算大餐（is_feast=0）。
  // 單一台式品項帶 item_id 方便之後對回 taiwan_items；多品項組合沒有單一對應品項。
  // 記錄完重新渲染，這個時段會改顯示「已記錄＋撤銷」（見 renderRecs）。
  async function onLogRecClick(slot, rec, btnEl) {
    btnEl.disabled = true; // 防連點
    try {
      await addDailyLog({
        log_date: localDateStr(),
        slot: slot,
        source_type: rec.source_id ? "taiwan_item" : rec.is_composed ? "recipe_template" : "custom",
        item_id: rec.source_id || null,
        item_name: rec.name,
        kcal: rec.scaled_kcal,
        protein_g: rec.protein_g,
        carb_g: rec.carb_g,
        fat_g: rec.fat_g,
        fiber_g: rec.fiber_g,
        is_feast: 0,
        feast_reservation_id: null,
        component_ids: rec.components || null,
      });
      await buildRecommendation();
    } catch (err) {
      console.error(err);
      alert("記錄失敗，請重試。");
      btnEl.disabled = false;
    }
  }

  async function onUndoClick(logId, btnEl) {
    btnEl.disabled = true;
    try {
      await undoDailyLog(logId);
      await buildRecommendation();
    } catch (err) {
      console.error(err);
      alert("撤銷失敗，請重試。");
      btnEl.disabled = false;
    }
  }

  function onDislikeClick(id) {
    saveRecipeFeedback(id, "dislike").then(function () {
      return buildRecommendation();
    }).catch(function (e) {
      console.error(e);
      setStatus("倒讚記錄失敗。");
    });
  }
// ===== Part 5：手動組餐（自己選） =====
  var manualPicker = { slot: null, selectedUids: [], passItems: [], blockedItems: [], profile: null, targets: null, todayLogs: null };

  function manualRoleLimits(slot) {
    return { requireMain: slot !== "afternoon_tea", maxByRole: { main: 1, side: 1, drink: 1, snack: 1 } };
  }

  function manualSelectedItems() {
    var sel = manualPicker.selectedUids;
    return manualPicker.passItems.filter(function (it) { return sel.indexOf(it.uid) !== -1; });
  }

  function fmtNutrient(v) { return v == null ? "—" : Math.round(v) + "g"; }

  async function openManualPicker(slot) {
    var profile;
    try { profile = await getProfile(); } catch (e) { console.error(e); return; }
    if (!profile) { alert("請先到「基本資料」分頁填寫並按「計算」。"); return; }
    var targets = await getCalibratedTargets(profile);
    var today = localDateStr();
    var todayLogs = await getDailyLogs({ start: today, end: today });
    var filtered = await window.ItemPicker.filterForSlot(slot, profile, {});
    manualPicker.slot = slot;
    manualPicker.profile = profile;
    manualPicker.targets = targets;
    manualPicker.todayLogs = todayLogs;
    manualPicker.passItems = filtered.pass;
    manualPicker.blockedItems = filtered.blocked;
    manualPicker.selectedUids = [];
    var labelEl = $("#manual-picker-slot-label");
    if (labelEl) labelEl.textContent = SLOT_LABELS[slot] || slot;
    renderManualPicker();
    var overlay = $("#manual-picker-overlay");
    if (overlay) overlay.hidden = false;
  }

  function renderManualPicker() {
    var itemsEl = $("#manual-picker-items");
    if (!itemsEl) return;
    var selected = manualPicker.selectedUids;
    var html = manualPicker.passItems.map(function (it) {
      return window.ItemPicker.cardHtml(it, { selected: selected.indexOf(it.uid) !== -1 });
    }).join("");
    html += manualPicker.blockedItems.map(function (b) {
      return window.ItemPicker.cardHtml(b.item, { selected: false, blockedReason: b.reason });
    }).join("");
    itemsEl.innerHTML = html;

    var selItems = manualSelectedItems();
    var totals = window.ItemPicker.sumSelected(selItems);
    var limits = manualRoleLimits(manualPicker.slot);
    var roleCount = { main: 0, side: 0, drink: 0, snack: 0 };
    selItems.forEach(function (it) { roleCount[it.role] = (roleCount[it.role] || 0) + 1; });

    var summaryEl = $("#manual-picker-summary");
    if (summaryEl) {
      summaryEl.innerHTML =
        "已選 " + selItems.length + " 件 · 約 " + Math.round(totals.kcal) + " kcal" +
        " · 蛋白質 " + fmtNutrient(totals.protein_g) +
        " · 碳水 " + fmtNutrient(totals.carb_g) +
        " · 脂肪 " + fmtNutrient(totals.fat_g) +
        " · 纖維 " + fmtNutrient(totals.fiber_g);
    }

    var gapEl = $("#manual-picker-gap");
    if (gapEl) {
      var share = window.slotNutrientShare
        ? window.slotNutrientShare(manualPicker.targets, manualPicker.todayLogs, manualPicker.profile.enabled_slots, manualPicker.slot)
        : { kcalShare: 0, proteinShare: 0, fiberShare: 0 };
      var lines = [];
      var overKcal = Math.round(totals.kcal - share.kcalShare);
      if (overKcal > 0) lines.push("這組合約 " + Math.round(totals.kcal) + " kcal，這個時段配額約 " + Math.round(share.kcalShare) + " kcal（+" + overKcal + "），仍可送出。");
      var proteinGap = Math.round((share.proteinShare - (totals.protein_g || 0)) * 10) / 10;
      var fiberGap = Math.round((share.fiberShare - (totals.fiber_g || 0)) * 10) / 10;
      if (proteinGap > 0) lines.push("蛋白質缺口約 " + proteinGap + "g");
      if (fiberGap > 0) lines.push("纖維缺口約 " + fiberGap + "g");
      var suggestions = [];
      if (proteinGap > 0) suggestions = suggestions.concat(suggestFillers(proteinGap, "protein_g", selItems, share));
      if (fiberGap > 0) suggestions = suggestions.concat(suggestFillers(fiberGap, "fiber_g", selItems, share));
      if (suggestions.length > 0) lines.push("可以考慮加：" + suggestions.slice(0, 2).join("、"));
      gapEl.innerHTML = lines.length > 0 ? lines.map(function (t) { return "<p>" + escapeHtml(t) + "</p>"; }).join("") : "";
    }

    var submitBtn = $("#manual-picker-submit");
    var hint = document.getElementById("manual-picker-main-hint");
    var missingMain = limits.requireMain && roleCount.main === 0;
    if (submitBtn) submitBtn.disabled = missingMain;
    if (hint) hint.hidden = !missingMain;
  }
function suggestFillers(gap, field, selItems, share) {
    var out = [];
    manualPicker.passItems.forEach(function (it) {
      if (selItems.indexOf(it) !== -1) return;
      if (["side", "drink", "snack"].indexOf(it.role) === -1) return;
      if (it[field] == null || it[field] <= 0) return;
      var cur = window.ItemPicker.sumSelected(selItems);
      if (cur.kcal + (it.kcal || 0) > share.kcalShare + 100) return;
      var per100 = it[field] / Math.max(1, it.kcal || 100) * 100;
      out.push({ label: it.name + "（+" + Math.round(it[field]) + "g）", score: per100 });
    });
    out.sort(function (a, b) { return b.score - a.score; });
    return out.slice(0, 3).map(function (o) { return o.label; });
  }

  function onManualItemClick(e) {
    var card = e.target.closest(".feast-item-card");
    if (!card || card.disabled) return;
    var uid = card.getAttribute("data-uid");
    var it = manualPicker.passItems.filter(function (x) { return x.uid === uid; })[0];
    if (!it) return;
    var idx = manualPicker.selectedUids.indexOf(uid);
    var limits = manualRoleLimits(manualPicker.slot);
    if (idx === -1) {
      var roleCount = {};
      manualSelectedItems().forEach(function (x) { roleCount[x.role] = (roleCount[x.role] || 0) + 1; });
      var max = limits.maxByRole[it.role] || 1;
      if ((roleCount[it.role] || 0) >= max) {
        alert("這個時段的「" + (it.role === "main" ? "主餐" : it.role === "side" ? "配菜" : it.role === "drink" ? "飲料" : "點心") + "」已經選過了，要不要先取消上一個？");
        return;
      }
      manualPicker.selectedUids.push(uid);
    } else {
      manualPicker.selectedUids.splice(idx, 1);
    }
    renderManualPicker();
  }

  async function onManualSubmit() {
    var selItems = manualSelectedItems();
    if (selItems.length === 0) { alert("請至少選一個品項。"); return; }
    var totals = window.ItemPicker.sumSelected(selItems);
    var entry = {
      log_date: localDateStr(),
      slot: manualPicker.slot,
      source_type: "manual_combo",
      item_id: null,
      item_name: selItems.map(function (it) { return it.name; }).join("＋"),
      kcal: totals.kcal,
      protein_g: totals.protein_g,
      carb_g: totals.carb_g,
      fat_g: totals.fat_g,
      fiber_g: totals.fiber_g,
      is_feast: 0,
      feast_reservation_id: null,
      component_ids: selItems.map(function (it) { return it.uid; }),
    };
    try {
      await addDailyLog(entry);
      var overlay = $("#manual-picker-overlay");
      if (overlay) overlay.hidden = true;
      await buildRecommendation();
    } catch (err) {
      console.error(err);
      alert("記錄失敗，請重試。");
    }
  }

  async function onDislikeChipClick(e) {
    var chip = e.target.closest(".dislike-chip");
    if (!chip) return;
    var entry = { type: chip.getAttribute("data-type"), key: chip.getAttribute("data-key"), label: chip.getAttribute("data-label") };
    var profile = await getProfile();
    if (!profile) return;
    var list = Array.isArray(profile.disliked_ingredients) ? profile.disliked_ingredients : [];
    var exists = list.some(function (d) { return d.type === entry.type && d.key === entry.key; });
    if (!exists) {
      list.push(entry);
      profile.disliked_ingredients = list;
      await saveProfile(profile);
    }
    await buildRecommendation();
  }




  ready(function () {
    const refreshBtn = $("#today-refresh");
    if (refreshBtn) {
      refreshBtn.addEventListener("click", function () {
        buildRecommendation();
      });
    }

    const grid = $("#today-recs");
    if (grid) {
      grid.addEventListener("click", function (e) {
        const dislikeBtn = e.target.closest(".dislike-btn");
        if (dislikeBtn && dislikeBtn.getAttribute("data-id")) {
          onDislikeClick(dislikeBtn.getAttribute("data-id"));
          return;
        }
        const undoBtn = e.target.closest(".rec-undo-btn");
        if (undoBtn && undoBtn.getAttribute("data-log-id")) {
          onUndoClick(undoBtn.getAttribute("data-log-id"), undoBtn);
          return;
        }
        const logBtn = e.target.closest(".rec-log-btn");
        if (logBtn && logBtn.getAttribute("data-slot")) {
          const slot = logBtn.getAttribute("data-slot");
          const rec = currentRecs[slot];
          if (rec) onLogRecClick(slot, rec, logBtn);
          return;
        }
        const pickBtn = e.target.closest(".rec-pick-btn");
        if (pickBtn && pickBtn.getAttribute("data-slot")) {
          openManualPicker(pickBtn.getAttribute("data-slot"));
          return;
        }
        const chipBtn = e.target.closest(".dislike-chip");
        if (chipBtn && chipBtn.getAttribute("data-key")) {
          onDislikeChipClick(e);
        }
      });
    }

    const overlay = $("#manual-picker-overlay");
    if (overlay) {
      overlay.addEventListener("click", function (e) {
        if (e.target === overlay) overlay.hidden = true;
      });
    }
    const manualItems = $("#manual-picker-items");
    if (manualItems) manualItems.addEventListener("click", onManualItemClick);
    const manualCancel = $("#manual-picker-cancel");
    if (manualCancel) manualCancel.addEventListener("click", function () { overlay.hidden = true; });
    const manualSubmit = $("#manual-picker-submit");
    if (manualSubmit) manualSubmit.addEventListener("click", onManualSubmit);

    // 從其他分頁切回來（預約／記錄／改基本資料之後）要重新算，不能停在載入時的畫面（整案審查 A4）。
    document.addEventListener("tab:activated", function (e) {
      if (e.detail === "today") buildRecommendation();
    });

    buildRecommendation();
  });
})();
