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

  function renderRecs(recs, profile) {
    SLOTS.forEach(function (slot) {
      const body = $("#rec-" + slot);
      if (!body) return;
      const isEnabled = !profile || window.isSlotEnabled(profile.enabled_slots, slot);
      if (!isEnabled) {
        body.innerHTML = '<p class="rec-empty">已設定不需要這個時段的建議，可到基本資料分頁調整</p>';
        return;
      }
      const rec = recs[slot];
      if (!rec) {
        body.innerHTML = '<p class="rec-empty">暫無適合的組合</p>';
        return;
      }
      const imgSrc = PROTEIN_IMAGE[rec.protein_name];
      const imgHtml = imgSrc
        ? '<img class="rec-card-img" src="' + imgSrc + '" alt="' + escapeHtml(rec.protein_name) + '" loading="lazy">'
        // 沒有對應照片時（超商/台式外送品項、或還沒建檔縮圖的食材）用色塊墊底取代整塊留白，
        // 依來源分三種色調（自組食譜/超商/台式外送），視覺上仍看得出這是哪一類建議。
        : '<div class="rec-card-placeholder ' + (rec.is_convenience ? "rec-placeholder-convenience" : rec.is_delivery ? "rec-placeholder-delivery" : "rec-placeholder-cooked") + '" aria-hidden="true"></div>';
      const fallbackNote = rec.fallback_to_auto
        ? '<p class="rec-fallback-note">今日這個來源沒有符合配額的選擇，已改為一般推薦</p>'
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
        "</div>" +
        '<button type="button" class="dislike-btn" data-id="' + escapeHtml(rec.id) + '">倒讚</button>' +
        '<button type="button" class="secondary-btn rec-log-btn" data-slot="' + escapeHtml(slot) + '">記錄這餐</button>';
    });
  }

  // 頂部「今日剩餘預算」彙總卡：剩餘熱量（recalcTodayBudget 已算好）+ 今天蛋白質/纖維攝取量
  // + 近7天平均 vs 目標 + 體重趨勢校正提示（pending / 自動調整告知）。
  async function renderHero(remainingBudget, targets, todayLogs, recentLogs, profile) {
    const hero = $("#today-hero");
    if (!hero) return;
    const eatenProtein = todayLogs.reduce(function (s, l) { return s + (Number(l.protein_g) || 0); }, 0);
    const eatenFiber = todayLogs.reduce(function (s, l) { return s + (Number(l.fiber_g) || 0); }, 0);
    $("#today-hero-kcal-value").textContent = Math.round(remainingBudget.remainingKcal);
    $("#today-hero-protein").textContent = Math.round(eatenProtein) + " / " + Math.round(targets.protein_g) + "g";
    $("#today-hero-fiber").textContent = Math.round(eatenFiber) + " / " + Math.round(targets.fiber_g) + "g";

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
          html = '<p class="today-cal-announce">依近4週體重趨勢，每日目標從 ' + shortDate(state.effective_date) + ' 起調整為 ' + Math.round(targets.targetKcal) + ' kcal</p>';
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

    const targets = await getCalibratedTargets(profile);
    const today = localDateStr();
    const monday = mondayOfThisWeek();
    const sevenAgo = dateAddDays(today, -6);

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

    renderHero(remainingBudget, targets, todayLogs, recentLogs, profile).catch(function (err) { console.error(err); });

    const recs = await getTodayRecommendation(
      remainingBudget,
      hardConstraints,
      profile.meal_prefs,
      profile.diet_restriction,
      profile.allergens
    );
    currentRecs = recs;

    renderRecs(recs, profile);
    // 修既有 bug：score() 的「近期出現過降權」一直讀 shown_count/last_shown_date，
    // 但這兩個欄位過去只在使用者按「倒讚」時才寫入，單純顯示從沒被記錄過，降權形同死碼。
    // 在畫面實際渲染出卡片的當下記錄「這個組合今天被顯示過」，同一天重複整理不重複累加。
    const shownIds = Object.keys(recs).map(function (slot) { return recs[slot] && recs[slot].id; }).filter(Boolean);
    if (shownIds.length > 0) markRecipesShown(shownIds).catch(function (err) { console.error(err); });
    setStatus("");
  }

  async function onLogRecClick(slot, rec, btnEl) {
    btnEl.disabled = true; // 防連點
    try {
      const today = localDateStr();
      let savedId;
      if (rec.is_delivery) {
        // source_id 是 recommend.js 給的原始 taiwan_items id（拿掉 tw_ 前綴後的那個）
        const saved = await logFeastDirectly(today, slot, null, rec.source_id);
        savedId = saved.id;
      } else {
        const saved = await addDailyLog({
          log_date: today,
          slot: slot,
          source_type: rec.is_convenience ? "custom" : "recipe_template",
          item_id: null,
          item_name: rec.name,
          kcal: rec.scaled_kcal,
          protein_g: rec.protein_g,
          carb_g: rec.carb_g,
          fat_g: rec.fat_g,
          fiber_g: rec.fiber_g,
          is_feast: 0,
          feast_reservation_id: null,
        });
        savedId = saved.id;
      }
      btnEl.textContent = "已記錄";
      const undoBtn = document.createElement("button");
      undoBtn.type = "button";
      undoBtn.className = "feast-cancel rec-undo-btn";
      undoBtn.textContent = "撤銷";
      undoBtn.addEventListener("click", async function () {
        await undoDailyLog(savedId);
        undoBtn.remove();
        btnEl.disabled = false;
        btnEl.textContent = "記錄這餐";
        await buildRecommendation();
      });
      btnEl.insertAdjacentElement("afterend", undoBtn);
      await buildRecommendation();
    } catch (err) {
      console.error(err);
      alert("記錄失敗，請重試。");
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
        const logBtn = e.target.closest(".rec-log-btn");
        if (logBtn && logBtn.getAttribute("data-slot")) {
          const slot = logBtn.getAttribute("data-slot");
          const rec = currentRecs[slot];
          if (rec) onLogRecClick(slot, rec, logBtn);
        }
      });
    }

    buildRecommendation();
  });
})();
