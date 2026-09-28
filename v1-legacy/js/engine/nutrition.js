// 輕盈計畫 (Lighten Plan) — 核心計算引擎：起點值（BMR/TDEE/目標熱量/四大營養素）
//
// 對照 PRD v4.0 第 3 節第 1–6 項、TECH-SPEC 4.1。
// 此檔只做「起點值」公式，不做 TDEE 動態校正（那是 tdee.js 的職責）。

(function () {
  "use strict";

  // 日常活動等級 → PAL 係數（PRD 2.2 方式 A；支援中英文 key）
  const ACTIVITY_FACTORS = {
    sedentary: 1.2,
    "久坐": 1.2,
    light: 1.375,
    "輕度": 1.375,
    "輕量": 1.375,
    moderate: 1.55,
    "中度": 1.55,
    high: 1.725,
    "高度": 1.725,
  };

  // 目標模式 → 熱量乘數（PRD 3.3）
  const GOAL_MULTIPLIER = {
    cut: 0.8,
    "減脂": 0.8,
    maintain: 1.0,
    "維持": 1.0,
    bulk: 1.1,
    "增肌": 1.1,
  };

  function normalizeGender(gender) {
    const g = String(gender === undefined || gender === null ? "" : gender).trim().toLowerCase();
    if (g === "male" || g === "m" || g === "男") return "male";
    if (g === "female" || g === "f" || g === "女") return "female";
    return null;
  }

  // 活動係數：優先取 activity_value（數值 PAL），否則查 activity_mode 對照表，最後 fallback 久坐 1.2
  function resolveActivityFactor(profile) {
    if (typeof profile.activity_value === "number" && profile.activity_value > 0) {
      return profile.activity_value;
    }
    const key = String(profile.activity_mode || "").trim().toLowerCase();
    if (ACTIVITY_FACTORS.hasOwnProperty(key)) return ACTIVITY_FACTORS[key];
    return 1.2;
  }

  // 蛋白質 g/kg 預設值（PRD 3.5：範圍 1.6–2.0；增肌取上限 2.0、維持取中間 1.8，減脂亦取中間 1.8）
  function defaultProteinPerKg(goalKey) {
    if (goalKey === "bulk" || goalKey === "增肌") return 2.0;
    return 1.8;
  }

  // opts = { offsetKcal: number }：體重趨勢校正的「累計 offset」，預設 0。
  // 保持純同步、不碰 DB。offset 加在目標熱量上（不加在 TDEE），熱量下限永遠優先。
  function calculateTargets(profile, opts) {
    if (!profile) throw new Error("[nutrition.js] 缺少 profile。");

    const offsetKcal =
      opts && typeof opts.offsetKcal === "number" && isFinite(opts.offsetKcal)
        ? opts.offsetKcal
        : 0;

    const gender = normalizeGender(profile.gender);
    if (!gender) {
      throw new Error("[nutrition.js] 無法辨識 gender，請給 '男'/'女' 或 'male'/'female'。");
    }

    const weightKg = Number(profile.weight_kg);
    const heightCm = Number(profile.height_cm);
    const age = Number(profile.age);
    if (!isFinite(weightKg) || !isFinite(heightCm) || !isFinite(age)) {
      throw new Error("[nutrition.js] weight_kg / height_cm / age 必須為有效數字。");
    }

    // 1. BMR（Mifflin-St Jeor）
    let bmr;
    if (gender === "male") {
      bmr = 10 * weightKg + 6.25 * heightCm - 5 * age + 5;
    } else {
      bmr = 10 * weightKg + 6.25 * heightCm - 5 * age - 161;
    }

    // 2. TDEE = BMR × 活動係數。
    // 2026-09-27 移除「特殊活動消耗」：這是 profile（不常變動的基本資料）裡的一個欄位，
    // 卻要放「當天」的運動消耗，值一填就永久留著、沒人會記得吃完當天要改回0，
    // 而且這正是 PRD 3.7 節（見 PRD 第51行）已經審核否決的「運動消耗折抵飲食熱量」設計——
    // 運動紀錄已經改用「本週活動量」（見 tab-exercise.js），刻意不換算成 kcal 疊加回飲食預算。
    const activityFactor = resolveActivityFactor(profile);
    const tdee = bmr * activityFactor;

    // 3. 目標熱量
    const goalKey = String(profile.goal_mode || "maintain").trim().toLowerCase();
    const multiplier = GOAL_MULTIPLIER.hasOwnProperty(goalKey)
      ? GOAL_MULTIPLIER[goalKey]
      : GOAL_MULTIPLIER[String(profile.goal_mode || "")];
    let targetKcal = tdee * (multiplier || 1.0);

    // 4. 加上體重趨勢校正 offset（先記下公式起點，再加 offset，之後才做熱量下限）
    const baseTargetKcal = targetKcal;
    targetKcal = targetKcal + offsetKcal;

    // 5. 熱量安全下限（PRD 3.4：女 < 1200 / 男 < 1500 自動上調）。下限永遠優先，
    //    就算 offset 是負值也不能讓目標低於下限。
    const floor = gender === "male" ? 1500 : 1200;
    let flooredWarning = false;
    if (targetKcal < floor) {
      targetKcal = floor;
      flooredWarning = true;
    }

    // 6. 巨量營養素（脂肪／碳水改用加了 offset 之後的 targetKcal；蛋白質、纖維不受影響）
    const proteinPerKg =
      typeof profile.protein_g_per_kg === "number" && profile.protein_g_per_kg > 0
        ? profile.protein_g_per_kg
        : defaultProteinPerKg(goalKey);
    const protein_g = proteinPerKg * weightKg;

    const fatPct =
      typeof profile.fat_pct === "number" && profile.fat_pct > 0 && profile.fat_pct <= 1
        ? profile.fat_pct
        : 0.25; // 預設 25%（PRD 範圍 20–25%）
    const fat_g = (targetKcal * fatPct) / 9;

    // 7. 膳食纖維（預設 30g）＋淨碳水
    const fiber_g = typeof profile.fiber_target_g === "number" ? profile.fiber_target_g : 30;
    let carb_g = (targetKcal - protein_g * 4 - fat_g * 9) / 4;
    if (carb_g < 0) carb_g = 0;
    const netCarb_g = carb_g - fiber_g;

    return {
      bmr: round1(bmr),
      tdee: round1(tdee),
      targetKcal: round1(targetKcal),
      baseTargetKcal: round1(baseTargetKcal),
      offsetKcal: offsetKcal,
      flooredWarning: flooredWarning,
      protein_g: round1(protein_g),
      fat_g: round1(fat_g),
      carb_g: round1(carb_g),
      fiber_g: round1(fiber_g),
      netCarb_g: round1(netCarb_g),
    };
  }

  function round1(n) {
    return Math.round(n * 10) / 10;
  }

  // 對外暴露（bare 全域函式，供 console 驗證與其他模組使用）
  window.calculateTargets = calculateTargets;
})();
