// 輕盈計畫 — 瀏覽器冒煙測試：用無頭 Edge/Chrome 實際操作 App（ES modules、import map、IndexedDB 都是真的）。
// 用法：node tools/smoke-browser.mjs            （全部通過 exit 0）
//       SMOKE_BROWSER=/path/to/chrome node tools/smoke-browser.mjs
// 流程：填基本資料 → 今日建議 → 記錄推薦 → 撤銷 → 自己選（超商、外食＋飲料、自煮）→ 本週 → 運動 → 體重；
// 最後檢查 console 沒有錯誤、資料庫是 lighten2、daily_log 是新格式。約 30 秒，不放進 pre-commit，Phase 驗收時跑。
// 手機版面與手機實機腳本的步驟由 tools/mobile-walkthrough.mjs 自動跑（模擬手機尺寸＋截圖）。

import { startHarness } from "./lib/browser-harness.mjs";

const H = await startHarness();
const { send, js, until, check, fail, text } = H;
const URL_BASE = H.url;

async function run() {
  await send("Page.navigate", { url: URL_BASE });
  await until(`${text("#today-status")}.indexOf("基本資料") !== -1`, "沒有基本資料時，今日建議沒有提示先填基本資料");
  check((await js(`[...document.querySelectorAll('.tab-btn')].map(b => b.dataset.tab).join(',')`)) === "profile,today,week,exercise,shopping",
    "分頁不是 基本資料/今日建議/本週/運動/採買（美饗日曆應已移除）");

  console.log("[基本資料]");
  await js(`(() => { const f = document.getElementById('profile-form');
    f.elements.age.value = 35; f.elements.gender.value = '男'; f.elements.height_cm.value = 175; f.elements.weight_kg.value = 80;
    f.elements.activity_mode.value = '輕度'; f.elements.goal_mode.value = '減脂'; f.requestSubmit(); })()`);
  await until(`${text("#target-kcal")} === "1896.1"`, "按計算後目標熱量不是 1896.1");
  await until(`${text("#calibration-body")}.indexOf("公式目標") !== -1`, "校正卡片沒有出現");

  console.log("[今日建議]");
  await js(`document.querySelector('.tab-btn[data-tab=today]').click()`);
  await until(`!!document.querySelector('#rec-breakfast .rec-log-btn') && !!document.querySelector('#rec-dinner .rec-log-btn')`, "早餐/晚餐沒有推薦卡片");
  check((await js(text("#today-hero-kcal-value"))) === "1896", "hero 剩餘熱量不是 1896");
  check((await js(text("#rec-afternoon_tea"))).indexOf("不需要這個時段") !== -1, "下午茶（預設關閉）沒有顯示關閉提示");

  await js(`document.querySelector('#rec-breakfast .rec-log-btn').click()`);
  await until(`!!document.querySelector('#rec-breakfast .rec-undo-btn')`, "記錄推薦後早餐沒有變成已記錄");
  const log = JSON.parse(await js(`new Promise((res) => { const r = indexedDB.open('lighten2'); r.onsuccess = () => {
    const q = r.result.transaction('daily_log').objectStore('daily_log').getAll(); q.onsuccess = () => res(JSON.stringify(q.result)); }; })`));
  check(log.length === 1, "記錄一餐後 daily_log 不是 1 筆（" + log.length + "）");
  if (log[0]) {
    const e = log[0];
    check(e.slot === "breakfast" && e.source === "rec_accepted" && typeof e.name === "string", "daily_log 的 slot/source/name 不對");
    check(["convenience", "delivery", "cook_quick", "cook_full"].indexOf(e.meal_type) !== -1 && e.content && e.content.meal_type === e.meal_type, "daily_log 的 meal_type 不對");
    check(Array.isArray(e.content.components) && e.content.components.length > 0, "daily_log 沒有 content.components");
    check(e.totals && typeof e.totals.kcal === "number", "daily_log 沒有 totals.kcal");
    check(!("item_name" in e) && !("feast_reservation_id" in e) && !("component_ids" in e), "daily_log 還有 v1 欄位");
  }
  check(Number((await js(text("#today-hero-protein"))).split(" ")[0]) > 0, "記錄後 hero 蛋白質沒有增加");
  const shownDates = await js(`new Promise((res) => { const r = indexedDB.open('lighten2'); r.onsuccess = () => {
    const q = r.result.transaction('recipe_feedback').objectStore('recipe_feedback').getAll(); q.onsuccess = () => res(q.result.map((x) => x.last_shown_date)); }; })`);
  const todayLocal = await js(`(() => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); })()`);
  check(shownDates.length > 0 && shownDates.every((d) => d === todayLocal), "推薦卡片顯示後 recipe_feedback 的 last_shown_date 不是今天：" + shownDates.join(","));

  await js(`document.querySelector('#rec-breakfast .rec-undo-btn').click()`);
  await until(`!!document.querySelector('#rec-breakfast .rec-log-btn')`, "撤銷後早餐沒有回到推薦");

  console.log("[自己選]");
  await js(`document.querySelector('#rec-lunch .rec-pick-btn').click()`);
  await until(`!document.getElementById('meal-picker-overlay').hidden && document.querySelectorAll('#meal-picker-panel .item-card').length > 0`, "自己選沒有打開或沒有品項");
  await js(`document.querySelector('#meal-picker-panel .item-card[data-uid=conv_bx04]').click()`);
  await until(`${text("#meal-picker-summary")}.indexOf("已選 1 件") !== -1`, "選一個品項後摘要沒有更新");
  await js(`document.getElementById('meal-picker-submit').click()`);
  await until(`${text("#rec-lunch")}.indexOf("已記錄") !== -1`, "自己選送出後午餐沒有變成已記錄");
  // 每次送出後撤銷，讓後面的時段不會因配額不足而沒有「自己選」按鈕
  await js(`document.querySelector('#rec-lunch .rec-undo-btn').click()`);
  await until(`!!document.querySelector('#rec-lunch .rec-log-btn')`, "撤銷後午餐沒有回到推薦");

  // 外食分頁＋飲料步驟
  await js(`document.querySelector('#rec-dinner .rec-pick-btn').click()`);
  await until(`!document.getElementById('meal-picker-overlay').hidden`, "晚餐自己選沒有打開");
  await js(`document.querySelector('#meal-picker-tabs [data-tab=delivery]').click()`);
  await until(`document.querySelectorAll('#meal-picker-panel .item-card').length > 0`, "外食分頁沒有品項");
  await js(`document.querySelector('#meal-picker-panel .item-card:not([disabled])').click()`);
  await js(`document.querySelector('#meal-picker-drinks [data-drink]:not([data-drink=""]):not([disabled])').click()`);
  await until(`${text("#meal-picker-summary")}.indexOf("已選 2 件") !== -1 && !document.getElementById('meal-picker-submit').disabled`, "外食選一個品項＋飲料後不能送出");
  await js(`document.getElementById('meal-picker-submit').click()`);
  await until(`${text("#rec-dinner")}.indexOf("已記錄") !== -1`, "外食送出後晚餐沒有變成已記錄");
  await js(`document.querySelector('#rec-dinner .rec-undo-btn').click()`);
  await until(`!!document.querySelector('#rec-dinner .rec-log-btn')`, "撤銷後晚餐沒有回到推薦");

  // 自煮分頁
  await until(`!!document.querySelector('#rec-breakfast .rec-pick-btn')`, "早餐沒有「自己選」按鈕");
  await js(`document.querySelector('#rec-breakfast .rec-pick-btn').click()`);
  await until(`!document.getElementById('meal-picker-overlay').hidden`, "早餐自己選沒有打開");
  await js(`document.querySelector('#meal-picker-tabs [data-tab=cook]').click()`);
  await js(`document.querySelector('#meal-picker-panel .compose-option[data-axis=archetype]').click()`);
  await js(`['protein', 'staple', 'method'].forEach((ax) => { const b = document.querySelector('#meal-picker-panel .compose-option[data-axis=' + ax + ']:not([disabled])'); if (b) b.click(); })`);
  await until(`${text("#meal-picker-summary")}.indexOf("已配好") !== -1 && !document.getElementById('meal-picker-submit').disabled`, "自煮選好後不能送出");
  await js(`document.getElementById('meal-picker-submit').click()`);
  await until(`${text("#rec-breakfast")}.indexOf("已記錄") !== -1`, "自煮送出後早餐沒有變成已記錄");

  console.log("[本週、運動、體重]");
  await js(`document.querySelector('.tab-btn[data-tab=week]').click()`);
  await until(`${text("#week-days")}.indexOf("kcal") !== -1`, "本週總覽沒有今天的熱量");
  await js(`document.querySelector('.tab-btn[data-tab=exercise]').click()`);
  await js(`(() => { const f = document.getElementById('exercise-form'); f.elements.duration_min.value = 30; f.requestSubmit(); })()`);
  await until(`${text("#exercise-history")}.indexOf("30 分鐘") !== -1`, "運動紀錄沒有出現");
  await js(`document.querySelector('.tab-btn[data-tab=profile]').click()`);
  await js(`(() => { const f = document.getElementById('weight-form'); f.elements.weight_kg.value = 79.5; f.requestSubmit(); })()`);
  await until(`${text("#weight-log-status")}.indexOf("79.5") !== -1`, "體重沒有記錄");

  console.log("[儲存與錯誤]");
  check((await js(`indexedDB.databases().then((d) => d.map((x) => x.name).join(','))`)) === "lighten2", "IndexedDB 不是只有 lighten2");
  const lsKeys = await js(`Object.keys(localStorage)`);
  check(lsKeys.every((k) => k.indexOf("lighten2.") === 0), "localStorage 有沒加 lighten2. 前綴的 key：" + lsKeys.join(","));
  H.consoleErrors().forEach((e) => fail("console 錯誤：" + JSON.stringify(e.params).slice(0, 300)));
  H.countCheck();
}

try {
  await run();
} catch (err) {
  fail(err.message);
}
await H.close();
const { failures, checks } = H.result();
console.log("\n" + (failures === 0 ? "全部通過" : failures + " 項失敗") + "（共 " + checks + " 項檢查）");
process.exit(failures === 0 ? 0 : 1);
