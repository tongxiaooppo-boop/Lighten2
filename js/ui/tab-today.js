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
      const isEnabled = !profile || !profile.enabled_slots || profile.enabled_slots[slot] !== false;
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
      body.innerHTML =
        imgHtml +
        '<div class="rec-name">' + escapeHtml(rec.name) + "</div>" +
        '<div class="rec-meta">' +
        escapeHtml(rec.tier) + " · 約 " + rec.scaled_kcal + " kcal" +
        '<span class="rec-base">（基準 ' + rec.kcal + " kcal）</span>" +
        "</div>" +
        '<button type="button" class="dislike-btn" data-id="' + escapeHtml(rec.id) + '">倒讚</button>';
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
    const preptimeToday = isWeekend() ? profile.prep_time_weekend : profile.prep_time_weekday;

    const recs = await getTodayRecommendation(
      remainingBudget,
      hardConstraints,
      preptimeToday,
      profile.diet_restriction,
      profile.allergens
    );

    renderRecs(recs, profile);
    setStatus("");
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
        const btn = e.target.closest(".dislike-btn");
        if (btn && btn.getAttribute("data-id")) {
          onDislikeClick(btn.getAttribute("data-id"));
        }
      });
    }

    buildRecommendation();
  });
})();
