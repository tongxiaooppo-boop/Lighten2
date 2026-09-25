// 輕盈計畫 (Lighten Plan) — 分頁二：今日建議
// 依賴：database.js、nutrition.js、budget.js、matcher.js、recommend.js

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
    "乳清蛋白粉": "images/food/whey-protein.jpg",
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
        : "";
      const fallbackNote = rec.fallback_to_auto
        ? '<p class="rec-fallback-note">今日這個來源沒有符合配額的選擇，已改為一般推薦</p>'
        : "";
      body.innerHTML =
        imgHtml +
        fallbackNote +
        '<div class="rec-name">' + escapeHtml(rec.name) + "</div>" +
        '<div class="rec-meta">' +
        escapeHtml(rec.tier) + " · 約 " + rec.scaled_kcal + " kcal" +
        '<span class="rec-base">（基準 ' + rec.kcal + " kcal）</span>" +
        "</div>" +
        '<button type="button" class="dislike-btn" data-id="' + escapeHtml(rec.id) + '">倒讚</button>' +
        '<button type="button" class="secondary-btn rec-log-btn" data-slot="' + escapeHtml(slot) + '">記錄這餐</button>';
    });
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
      return;
    }

    const targets = calculateTargets(profile);
    const today = localDateStr();
    const monday = mondayOfThisWeek();

    const [todayLogs, weekLogs] = await Promise.all([
      getDailyLogs({ start: today, end: today }),
      getDailyLogs({ start: monday, end: today }),
    ]);

    const remainingBudget = recalcTodayBudget(targets.targetKcal, todayLogs, profile.enabled_slots);
    const hardConstraints = checkHardConstraints(weekLogs, profile);
    const ledger = await getWeeklyLedger(monday);

    const recs = await getTodayRecommendation(
      remainingBudget,
      hardConstraints,
      profile.meal_prefs,
      profile.diet_restriction,
      profile.allergens,
      ledger
    );
    currentRecs = recs;

    renderRecs(recs, profile);
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
