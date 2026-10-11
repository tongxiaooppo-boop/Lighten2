// 輕盈計畫 — 瀏覽器冒煙測試：用無頭 Edge/Chrome 實際操作 App（ES modules、import map、IndexedDB 都是真的）。
// 用法：node tools/smoke-browser.mjs            （全部通過 exit 0）
//       SMOKE_BROWSER=/path/to/chrome node tools/smoke-browser.mjs
// 流程：填基本資料 → 今日建議 → 記錄推薦 → 撤銷 → 自己選（超商、外食＋飲料、自煮）→ 本週 → 運動 → 體重 → 備份與還原；
// 最後檢查 console 沒有錯誤、資料庫是 lighten2、daily_log 是新格式。約 30 秒，不放進 pre-commit，Phase 驗收時跑。
// 手機版面與手機實機腳本的步驟由 tools/mobile-walkthrough.mjs 自動跑（模擬手機尺寸＋截圖）。

import { startHarness } from "./lib/browser-harness.mjs";

const H = await startHarness();
const { send, js, until, check, fail, text } = H;
const URL_BASE = H.url;

async function run() {
  console.log("[資料庫升級 v1 → v3（工作線 C、D 切片 8b）]");
  await send("Page.navigate", { url: URL_BASE.replace(/index\.html$/, "data/food_tree.json") });
  await until(`document.readyState === "complete"`, "升級測試的空白頁沒有載入");
  check((await js(`new Promise((res, rej) => { const r = indexedDB.open('lighten2', 1);
    r.onupgradeneeded = () => { const db = r.result;
      db.createObjectStore('user_profile'); db.createObjectStore('weight_log', { keyPath: 'log_date' });
      db.createObjectStore('daily_log', { keyPath: 'id' }).createIndex('log_date', 'log_date');
      db.createObjectStore('exercise_log', { keyPath: 'id' }).createIndex('log_date', 'log_date');
      db.createObjectStore('custom_foods', { keyPath: 'id' }); db.createObjectStore('recipe_feedback'); db.createObjectStore('settings'); };
    r.onsuccess = () => { const db = r.result; const tx = db.transaction('weight_log', 'readwrite');
      tx.objectStore('weight_log').put({ log_date: '2000-01-05', weight_kg: 81 }); tx.oncomplete = () => { db.close(); res(db.version); }; };
    r.onerror = () => rej(r.error); })`)) === 1, "沒有建出 v1 資料庫");
  await send("Page.navigate", { url: URL_BASE });
  await until(`${text("#today-status")}.indexOf("基本資料") !== -1`, "沒有基本資料時，今日建議沒有提示先填基本資料");
  const upgraded = JSON.parse(await js(`new Promise((res) => { const r = indexedDB.open('lighten2'); r.onsuccess = () => { const db = r.result;
    const out = { version: db.version, stores: [...db.objectStoreNames].sort() };
    const q = db.transaction('weight_log').objectStore('weight_log').getAll(); q.onsuccess = () => { out.weights = q.result.length; db.close(); res(JSON.stringify(out)); }; }; })`));
  check(upgraded.version === 4 && upgraded.stores.indexOf("saved_meals") !== -1 && upgraded.stores.indexOf("custom_ingredients") !== -1 && upgraded.stores.indexOf("meal_plan") !== -1 && upgraded.weights === 1, "v1 升到 v4 後要有 saved_meals、custom_ingredients、meal_plan，舊資料還在：" + JSON.stringify(upgraded));
  // 升級測試留下的體重刪掉，後面的檢查照舊
  await js(`new Promise((res) => { const r = indexedDB.open('lighten2'); r.onsuccess = () => { const db = r.result; const tx = db.transaction('weight_log', 'readwrite');
    tx.objectStore('weight_log').delete('2000-01-05'); tx.oncomplete = () => { db.close(); res(true); }; }; })`);
  check((await js(`[...document.querySelectorAll('.tab-btn')].map(b => b.dataset.tab).join(',')`)) === "profile,today,foods,week,exercise",
    "分頁不是 基本資料/今日建議/我的食物/本週/運動（decisions #96）");
  // 還沒有基本資料：不吃的專用函式丟「還沒有基本資料」（PRD 13.5）
  check(/還沒有基本資料/.test(await js(`(async () => { const m = await import('./js/data/db.js');
    try { await m.addDislikedIngredient({ type: 'item', key: 'conv_bx04', label: 'x' }); return 'ok'; } catch (e) { return String(e.message); } })()`)),
    "沒有 profile 時 addDislikedIngredient 沒有丟「還沒有基本資料」");

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
  // 送出後撤銷，順便測撤銷（配額不足時仍有「自己選」由 mobile-walkthrough 3-12 測）
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
  await js(`document.querySelector('#meal-picker-panel [data-nc=entry][data-v=bowl]').click()`);
  await js(`document.querySelector('#meal-picker-panel [data-nc=wb]:not([disabled])').click()`);
  await until(`${text("#meal-picker-summary")}.indexOf("已配好") !== -1 && !document.getElementById('meal-picker-submit').disabled`, "自煮選好後不能送出");
  await js(`document.getElementById('meal-picker-submit').click()`);
  await until(`${text("#rec-breakfast")}.indexOf("已記錄") !== -1`, "自煮送出後早餐沒有變成已記錄");

  console.log("[單品（真的 IndexedDB，工作線 D 切片 7）]");
  const dailyLogs = async () => JSON.parse(await js(`new Promise((res) => { const r = indexedDB.open('lighten2'); r.onsuccess = () => {
    const q = r.result.transaction('daily_log').objectStore('daily_log').getAll(); q.onsuccess = () => res(JSON.stringify(q.result)); }; })`));
  // 外食分頁：全脂奶 1.5 份（熱量用 engine 算出來比，不寫死，審核 S9）
  await js(`document.querySelector('#rec-lunch .rec-pick-btn').click()`);
  await until(`!document.getElementById('meal-picker-overlay').hidden`, "午餐自己選沒有打開（單品）");
  await js(`document.querySelector('#meal-picker-tabs [data-tab=delivery]').click()`);
  await js(`document.querySelector('#meal-picker-drinks [data-food-uid=fx_whole_milk]').click()`);
  await js(`document.querySelector('#meal-picker-drinks [data-food-step=fx_whole_milk][data-dir="1"]').click()`);
  const milkKcal = await js(`(async () => { const mc = await import('./js/engine/meal-content.js'); const c = await (await import('./js/data/catalog.js')).loadCatalog();
    return Math.round(mc.contentTotals(mc.buildDraftContent({ kind: 'products', meal_type: 'delivery', items: [], estimates: [], foods: [{ item: c.foodTree.byId.fx_whole_milk, qty: 1.5 }] }), c).kcal); })()`);
  await until(`${text("#meal-picker-summary")}.indexOf("已選 1 件 · 約 ${milkKcal} kcal") !== -1 && !document.getElementById('meal-picker-submit').disabled`, "全脂奶 1.5 份的摘要不是約 " + milkKcal + " kcal 或不能送出");
  await js(`document.getElementById('meal-picker-submit').click()`);
  await until(`${text("#rec-lunch")}.indexOf("已記錄") !== -1`, "單品送出後午餐沒有變成已記錄");
  const milkLog = (await dailyLogs()).find((l) => l.slot === "lunch");
  const mc0 = milkLog && milkLog.content.components[0];
  check(!!milkLog && milkLog.meal_type === "delivery" && milkLog.name === "全脂奶（自己倒） 360ml" && milkLog.content.components.length === 1 &&
    mc0.kind === "food" && mc0.ref === "fx_whole_milk" && mc0.qty === 1.5 && mc0.snapshot.amount === 240 && mc0.snapshot.unit === "ml" && milkLog.content.implicit === null,
    "單品紀錄寫進資料庫的內容不對：" + JSON.stringify(milkLog));
  await js(`document.querySelector('#rec-lunch .rec-undo-btn').click()`);
  await until(`!!document.querySelector('#rec-lunch .rec-log-btn')`, "撤銷單品紀錄後午餐沒有回到推薦");
  // 克數記法（切片 8b，decisions #136）：全脂奶切成毫升、改 300 → 寫進資料庫的是 amount、沒有 qty
  await js(`document.querySelector('#rec-lunch .rec-pick-btn').click()`);
  await until(`!document.getElementById('meal-picker-overlay').hidden`, "午餐自己選沒有打開（克數記法）");
  await js(`document.querySelector('#meal-picker-tabs [data-tab=delivery]').click()`);
  await js(`document.querySelector('#meal-picker-drinks [data-food-uid=fx_whole_milk]').click()`);
  await js(`document.querySelector('#food-sel-fx_whole_milk [data-food-mode][aria-pressed="false"]').click()`);
  await js(`(() => { const el = document.querySelector('#food-sel-fx_whole_milk .food-amount-input'); el.value = '300'; el.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  await until(`(document.getElementById('food-sel-fx_whole_milk') || {}).innerText.indexOf("300ml") !== -1`, "全脂奶改成 300 毫升沒有生效");
  await js(`document.getElementById('meal-picker-submit').click()`);
  await until(`${text("#rec-lunch")}.indexOf("已記錄") !== -1`, "克數記法送出後午餐沒有變成已記錄");
  const mlLog = (await dailyLogs()).find((l) => l.slot === "lunch");
  const ml0 = mlLog && mlLog.content.components[0];
  check(!!mlLog && mlLog.name === "全脂奶（自己倒） 300ml" && ml0.amount === 300 && !("qty" in ml0) && ml0.snapshot.amount === 240,
    "克數記法寫進資料庫的內容不對：" + JSON.stringify(mlLog));
  await js(`document.querySelector('#rec-lunch .rec-undo-btn').click()`);
  await until(`!!document.querySelector('#rec-lunch .rec-log-btn')`, "撤銷克數紀錄後午餐沒有回到推薦");
  // 自煮分頁不選餐型，搜尋白飯加點單品 → 可以送出，implicit 恰好 0 與 null
  await js(`document.querySelector('#rec-dinner .rec-pick-btn').click()`);
  await until(`!document.getElementById('meal-picker-overlay').hidden`, "晚餐自己選沒有打開（單品）");
  await js(`document.querySelector('#meal-picker-tabs [data-tab=cook]').click()`);
  check(await js(`document.getElementById('meal-picker-submit').disabled`), "自煮分頁什麼都沒選就能送出");
  await js(`(() => { const el = document.getElementById('meal-picker-food-search'); el.value = '白飯'; el.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  await until(`!!document.querySelector('#meal-picker-food-results [data-food-uid=fx_cooked_rice]')`, "搜尋白飯沒有結果");
  await js(`document.querySelector('#meal-picker-food-results [data-food-uid=fx_cooked_rice]').click()`);
  await until(`!document.getElementById('meal-picker-submit').disabled`, "自煮分頁只選單品不能送出");
  await js(`document.getElementById('meal-picker-submit').click()`);
  await until(`${text("#rec-dinner")}.indexOf("已記錄") !== -1`, "自煮只記單品送出後晚餐沒有變成已記錄");
  const riceLog = (await dailyLogs()).find((l) => l.slot === "dinner");
  check(!!riceLog && (riceLog.meal_type === "cook_full" || riceLog.meal_type === "cook_quick") && riceLog.content.archetype_id === null && riceLog.content.method_id === null &&
    JSON.stringify(riceLog.content.implicit) === '{"oil_g":0,"seasoning":null}' && riceLog.name === "白飯 40g", "自煮只記單品的紀錄不對：" + JSON.stringify(riceLog));
  await js(`document.querySelector('#rec-dinner .rec-undo-btn').click()`);
  await until(`!!document.querySelector('#rec-dinner .rec-log-btn')`, "撤銷自煮單品紀錄後晚餐沒有回到推薦");

  console.log("[我的組合（真的 IndexedDB，工作線 C）]");
  const savedAll = async () => JSON.parse(await js(`new Promise((res) => { const r = indexedDB.open('lighten2'); r.onsuccess = () => {
    const q = r.result.transaction('saved_meals').objectStore('saved_meals').getAll(); q.onsuccess = () => res(JSON.stringify(q.result)); }; })`));
  // 入口 1：超商選一個主餐＋全脂奶單品，勾「存成組合」送出 → 紀錄與組合都寫入
  await js(`document.querySelector('#rec-lunch .rec-pick-btn').click()`);
  await until(`!document.getElementById('meal-picker-overlay').hidden`, "午餐自己選沒有打開（組合）");
  await js(`document.querySelector('#meal-picker-tabs [data-tab=convenience]').click()`);
  await js(`document.querySelector('#meal-picker-panel .item-card[data-uid=conv_bx04]').click()`);
  await js(`document.querySelector('#meal-picker-drinks [data-food-uid=fx_whole_milk]').click()`);
  await js(`document.querySelector('#meal-picker-drinks [data-save-as]').click()`);
  await until(`!!document.getElementById('meal-picker-save-name') && document.getElementById('meal-picker-save-name').value.indexOf('全脂奶') !== -1`, "存成組合的名稱沒有預填品名");
  const logsBefore = (await dailyLogs()).length;
  await js(`document.getElementById('meal-picker-submit').click()`);
  await until(`${text("#rec-lunch")}.indexOf("已記錄") !== -1`, "勾存成組合送出後午餐沒有變成已記錄");
  let saved = await savedAll();
  check((await dailyLogs()).length === logsBefore + 1 && saved.length === 1 && saved[0].content.components.map((c) => c.kind + ":" + c.ref).join() === "product:conv_bx04,food:fx_whole_milk" &&
    !saved[0].content.components.some((c) => c.snapshot), "入口 1 沒有同時寫入紀錄與組合，或組合帶了快照：" + JSON.stringify(saved));
  // 全有全無：組合 id 重複讓 add 失敗 → 紀錄也不能寫進去（審核 Q5）
  const atomic = await js(`(async () => { const m = await import('./js/data/db.js'); const mc = await import('./js/engine/meal-content.js'); const c = await (await import('./js/data/catalog.js')).loadCatalog();
    const d = { kind: 'products', meal_type: 'convenience', items: [c.productsByUid.conv_bx04], estimates: [], drink: null };
    const content = mc.buildDraftContent(d);
    const entry = mc.buildLogEntry({ date: '2026-09-25', slot: 'dinner', source: 'manual', name: 'x', content: content, totals: mc.contentTotals(content, c), createdAt: new Date().toISOString() });
    try { await m.addDailyLogWithSavedMeal(entry, { id: ${JSON.stringify(saved[0].id)}, name: 'dup', content: mc.toSavedContent(content) }); return 'ok'; } catch (e) { return 'failed'; } })()`);
  check(atomic === "failed" && !(await dailyLogs()).some((l) => l.log_date === "2026-09-25"), "組合寫入失敗時紀錄被寫進去了（不是全有全無）");
  // 帶入：撤銷後重開，組合列帶入
  await js(`document.querySelector('#rec-lunch .rec-undo-btn').click()`);
  await until(`!!document.querySelector('#rec-lunch .rec-pick-btn')`, "撤銷後午餐沒有回到推薦（組合）");
  await js(`document.querySelector('#rec-lunch .rec-pick-btn').click()`);
  await until(`!!document.querySelector('#meal-picker-panel .saved-card')`, "選擇器最上面沒有組合卡片");
  await js(`document.querySelector('#meal-picker-panel .saved-card').click()`);
  await until(`${text("#meal-picker-summary")}.indexOf("已選 2 件") !== -1`, "帶入組合後摘要不是已選 2 件");
  await js(`document.getElementById('meal-picker-cancel').click()`);
  // 入口 2：記一筆推薦的晚餐，從今日建議存成組合
  await until(`!!document.querySelector('#rec-dinner .rec-log-btn')`, "晚餐沒有記錄按鈕（組合）");
  await js(`document.querySelector('#rec-dinner .rec-log-btn').click()`);
  await until(`!!document.querySelector('#rec-dinner [data-save-log-id]')`, "已記錄的晚餐沒有「存成組合」");
  await js(`document.querySelector('#rec-dinner [data-save-log-id]').click()`);
  await until(`!!document.getElementById('rec-save-name') && document.getElementById('rec-save-name').value !== ''`, "入口 2 的名稱沒有預填");
  await js(`document.querySelector('#rec-dinner [data-save-confirm]').click()`);
  await until(`${text("#rec-dinner")}.indexOf("已存成組合") !== -1`, "入口 2 沒有存成組合");
  saved = await savedAll();
  check(saved.length === 2 && saved[1].content.implicit === null, "入口 2 存的組合不對（implicit 一律 null）：" + JSON.stringify(saved[1]));
  await js(`document.querySelector('#rec-dinner .rec-undo-btn').click()`);
  await until(`!!document.querySelector('#rec-dinner .rec-log-btn')`, "撤銷晚餐沒有回到推薦（組合）");
  // 管理區塊：改名、刪除（封存）、復原
  await js(`document.querySelector('.tab-btn[data-tab=foods]').click()`);
  await until(`!!document.querySelector('#foods-saved [data-saved-rename]')`, "我的食物沒有我的組合區塊");
  await js(`document.querySelector('#foods-saved details[data-saved-section=main] > summary').click()`);
  await js(`document.querySelectorAll('#foods-saved [data-saved-rename]')[1].click()`);
  await js(`(() => { const el = document.getElementById('saved-rename-input'); el.value = '推薦晚餐'; el.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  await js(`document.querySelector('#foods-saved [data-saved-rename-save]').click()`);
  await until(`${text("#foods-saved")}.indexOf("已改名為「推薦晚餐」") !== -1`, "改名沒有完成");
  await js(`document.querySelectorAll('#foods-saved [data-saved-archive]')[1].click()`);
  await until(`${text("#foods-saved")}.indexOf("已刪除「推薦晚餐」") !== -1`, "刪除沒有提示復原");
  check((await savedAll())[1].archived === true, "刪除沒有封存");
  await js(`document.querySelector('#foods-saved .dislike-notice [data-saved-restore]').click()`);
  await until(`${text("#foods-saved")}.indexOf("已還原") !== -1`, "復原沒有完成");
  check((await savedAll()).every((r) => !r.archived) && (await savedAll())[1].name === "推薦晚餐", "復原後組合不對");
  await js(`document.querySelector('.tab-btn[data-tab=today]').click()`);

  console.log("[本週、運動、體重]");
  await js(`document.querySelector('.tab-btn[data-tab=week]').click()`);
  await until(`${text("#week-days")}.indexOf("kcal") !== -1`, "本週總覽沒有今天的熱量");
  await js(`document.querySelector('.tab-btn[data-tab=exercise]').click()`);
  await js(`(() => { const f = document.getElementById('exercise-form'); f.elements.duration_min.value = 30; f.requestSubmit(); })()`);
  await until(`${text("#exercise-history")}.indexOf("30 分鐘") !== -1`, "運動紀錄沒有出現");
  await js(`document.querySelector('.tab-btn[data-tab=profile]').click()`);
  await js(`(() => { const f = document.getElementById('weight-form'); f.elements.weight_kg.value = 79.5; f.requestSubmit(); })()`);
  await until(`${text("#weight-log-status")}.indexOf("79.5") !== -1`, "體重沒有記錄");

  console.log("[我的品項與不吃：複製、不吃、份量（真的 IndexedDB）]");
  {
    const DBM = `(await import('./js/data/db.js'))`;
    const CAT = `(await (await import('./js/data/catalog.js')).loadCatalog())`;
    // 複製成我的版本全有全無：add 或 put 同步丟錯時，我的品項沒新增、隱藏清單沒變
    const snap = () => js(`(async () => { const m = ${DBM}; return JSON.stringify([await m.getCustomFoods(), await m.getHiddenCatalogUids()]); })()`);
    for (const op of ["add", "put"]) {
      const before = await snap();
      const msg = await js(`(async () => { const m = ${DBM}; const mc = await import('./js/engine/meal-content.js'); const c = ${CAT};
        const rec = mc.copyFromBuiltin(c.productsByUid['conv_bx04']);
        const orig = IDBObjectStore.prototype.${op};
        IDBObjectStore.prototype.${op} = function () { throw new DOMException('模擬的 ${op} 失敗', 'DataError'); };
        try { await m.copyBuiltinToCustom(rec); return null; } catch (e) { return String(e && e.message); }
        finally { IDBObjectStore.prototype.${op} = orig; } })()`);
      check(msg !== null, "copyBuiltinToCustom 的 " + op + " 丟錯時沒有回報失敗");
      check((await snap()) === before, "copyBuiltinToCustom 的 " + op + " 丟錯後資料被改了（不是全有全無）");
    }
    // 在「我的食物」明細標「不吃」目前推薦卡片裡的品項 → 今日建議重算後推薦不含它；取消後回來
    await js(`document.querySelector('.tab-btn[data-tab=today]').click()`);
    await until(`!!document.querySelector('#rec-lunch .rec-log-btn') || !!document.querySelector('#rec-lunch .rec-undo-btn') || !!document.querySelector('#rec-lunch .rec-pick-btn')`, "今日建議沒有午餐卡片");
    // 推薦卡片「順便不要」的 chip 帶著現成品項的 uid（data-type=item）
    const recUid = await js(`(() => { const c = document.querySelector('[id^=rec-] .dislike-chip[data-type=item]'); return c ? c.dataset.key : null; })()`);
    check(!!recUid, "找不到推薦卡片裡的現成品項（測試前提不成立）");
    if (recUid) {
      const U = JSON.stringify(recUid);
      await js(`document.querySelector('.tab-btn[data-tab=foods]').click()`);
      await until(`!!document.querySelector('#foods-search')`, "我的食物分頁沒有搜尋框");
      await js(`(async () => { const c = ${CAT}; const i = document.getElementById('foods-search'); i.value = c.productsByUid[${U}].name; i.dispatchEvent(new Event('input', { bubbles: true })); })()`);
      await until(`!!document.querySelector('[data-foods-open=' + JSON.stringify(${U}) + ']')`, "搜尋推薦裡的品項沒有結果");
      await js(`document.querySelector('[data-foods-open=' + JSON.stringify(${U}) + ']').click()`);
      await until(`!!document.querySelector('[data-foods-dislike=' + JSON.stringify(${U}) + ']')`, "明細沒有「不吃」按鈕");
      await js(`document.querySelector('[data-foods-dislike=' + JSON.stringify(${U}) + ']').click()`);
      await until(`!!document.querySelector('[data-foods-undislike=' + JSON.stringify(${U}) + ']')`, "按「不吃」後沒有變成「取消不吃」");
      const keys = JSON.parse(await js(`(async () => { const m = ${DBM}; const p = await m.getProfile(); return JSON.stringify(p.disliked_ingredients.map((d) => d.key)); })()`));
      check(keys.indexOf(recUid) !== -1, "按「不吃」後資料庫的不吃清單沒有 " + recUid);
      await js(`document.querySelectorAll('[id^=rec-]').forEach((el) => el.insertAdjacentHTML('beforeend', '<i class="smoke-stale"></i>'))`);
      await js(`document.querySelector('.tab-btn[data-tab=today]').click()`);
      await until(`!document.querySelector('.smoke-stale')`, "標不吃後今日建議沒有重算");
      check(!(await js(`!!document.querySelector('[id^=rec-] .dislike-chip[data-key=' + JSON.stringify(${U}) + ']')`)), "標不吃推薦裡的品項 " + recUid + " 後，今日建議還推薦它");
      await js(`document.querySelector('.tab-btn[data-tab=foods]').click()`);
      await until(`!!document.querySelector('#foods-body')`, "回到我的食物失敗");
      await js(`(async () => { const i = document.getElementById('foods-search'); i.value = ''; i.dispatchEvent(new Event('input', { bubbles: true })); })()`);
      await until(`!!document.querySelector('.foods-disliked-all [data-foods-undislike=' + JSON.stringify(${U}) + ']')`, "全部清單沒有剛標的不吃");
      await js(`document.querySelector('.foods-disliked-all [data-foods-undislike=' + JSON.stringify(${U}) + ']').click()`);
      await until(`(async () => { const m = await import('./js/data/db.js'); const p = await m.getProfile(); return !p.disliked_ingredients.some((d) => d.key === ${U}); })()`, "在全部清單取消不吃後資料庫還有它");
    }
    // 工作線 D 切片 4：自煮子分頁打得開、有乳品類；分層品項標不吃 → 同樣本有「也標不吃」→ 全部清單有名稱（不是「已不提供」）→ 取消
    await js(`document.querySelector('.tab-btn[data-tab=foods]').click()`);
    await until(`!!document.querySelector('[data-foods-subtab=cook]')`, "我的食物沒有自煮子分頁");
    await js(`document.querySelector('[data-foods-subtab=cook]').click()`);
    await until(`[...document.querySelectorAll('#foods-body details.foods-major > summary')].some((s) => s.innerText.indexOf('乳品類') === 0)`, "自煮子分頁沒有乳品類");
    await js(`(() => { const i = document.getElementById('foods-search'); i.value = '白米'; i.dispatchEvent(new Event('input', { bubbles: true })); })()`);
    await until(`!!document.querySelector('[data-foods-open="fx_rice"]')`, "搜尋白米沒有分層品項");
    await js(`document.querySelector('[data-foods-open="fx_rice"]').click()`);
    await until(`!!document.querySelector('[data-foods-dislike="fx_rice"]')`, "白米明細沒有「不吃」");
    await js(`document.querySelector('[data-foods-dislike="fx_rice"]').click()`);
    await until(`!!document.querySelector('[data-foods-also-dislike="fx_congee"]')`, "白米標不吃後明細沒有「也標不吃」白粥");
    const riceType = await js(`(async () => { const m = ${DBM}; const p = await m.getProfile(); const d = p.disliked_ingredients.find((x) => x.key === 'fx_rice'); return d ? d.type : null; })()`);
    check(riceType === "food_tree", "分層品項寫進不吃清單的 type 不是 food_tree：" + riceType);
    await js(`(() => { const i = document.getElementById('foods-search'); i.value = ''; i.dispatchEvent(new Event('input', { bubbles: true })); })()`);
    await until(`!!document.querySelector('.foods-disliked-all [data-foods-undislike="fx_rice"]')`, "全部清單沒有白米");
    const riceAll = await js(`document.querySelector('.foods-disliked-all [data-foods-undislike="fx_rice"]').closest('.food-row').textContent`);
    check(riceAll.indexOf("白米") !== -1 && riceAll.indexOf("已不提供") === -1, "全部清單的分層品項名稱不對：" + riceAll);
    await js(`document.querySelector('.foods-disliked-all [data-foods-undislike="fx_rice"]').click()`);
    await until(`(async () => { const m = await import('./js/data/db.js'); const p = await m.getProfile(); return !p.disliked_ingredients.some((d) => d.key === 'fx_rice'); })()`, "取消白米不吃後資料庫還有它");
    // 併發（計畫 S11）：兩個不同 key 同時標不吃、saveProfileForm 與標不吃同時送，最後清單都在
    const conc = await js(`(async () => { const m = ${DBM}; const p0 = await m.getProfile();
      await Promise.all([m.addDislikedIngredient({ type: 'item', key: 'conv_sl01', label: 'a' }), m.addDislikedIngredient({ type: 'protein', key: 'chicken_breast', label: '雞胸肉' })]);
      const form = Object.assign({}, p0, { disliked_ingredients: [] });
      await Promise.all([m.saveProfileForm(form), m.addDislikedIngredient({ type: 'item', key: 'conv_sl02', label: 'b' })]);
      await m.saveProfileForm(Object.assign({}, p0, { disliked_ingredients: [{ type: 'item', key: 'zzz', label: 'z' }] }));
      const keys = (await m.getProfile()).disliked_ingredients.map((d) => d.key).sort().join(',');
      await m.removeDislikedIngredient('conv_sl01'); await m.removeDislikedIngredient('conv_sl02');
      return keys; })()`);
    check(conc === "chicken_breast,conv_sl01,conv_sl02", "不吃的併發寫入互蓋，或 saveProfileForm 改到了不吃清單：" + conc);
    // 備份來回（M9）：兩筆複製品（原品項自動隱藏）、一筆份量 ×2 的紀錄、不吃清單（上面留下的雞胸肉），下一段的匯出→還原要逐字相同
    await js(`(async () => { const m = ${DBM}; const mc = await import('./js/engine/meal-content.js'); const c = ${CAT};
      await m.copyBuiltinToCustom(mc.copyFromBuiltin(c.productsByUid['tw_dr05']));
      await m.copyBuiltinToCustom(mc.copyFromBuiltin(c.productsByUid['conv_bx04']));
      const p = c.productsByUid['conv_bx01'];
      const content = mc.buildDraftContent({ kind: 'products', meal_type: 'convenience', items: [p], estimates: [], drink: null, qtyByUid: { conv_bx01: 2 } });
      await m.addDailyLog(mc.buildLogEntry({ date: '2026-09-20', slot: 'lunch', source: 'manual', name: mc.draftLogName({ kind: 'products', items: [p], estimates: [], drink: null, qtyByUid: { conv_bx01: 2 } }),
        content: content, totals: mc.contentTotals(content, c), createdAt: new Date().toISOString() }));
      // 工作線 D 切片 7：一筆只有單品的自煮紀錄（不撤銷），備份來回要帶著它
      const fd = { kind: 'cook', meal_type: 'cook_quick', archetype: null, proteins: [], staple: null, vegetables: [], seasoning: null, method: null, primaryScale: 1,
        foods: [{ item: c.foodTree.byId.fx_cooked_rice, qty: 4 }, { item: c.foodTree.byId.fx_ham, qty: 0.5 }] };
      const fc = mc.buildDraftContent(fd, { oilHabit: 'normal' });
      await m.addDailyLog(mc.buildLogEntry({ date: '2026-09-21', slot: 'dinner', source: 'manual', name: mc.draftLogName(fd),
        content: fc, totals: mc.contentTotals(fc, c), createdAt: new Date().toISOString() })); })()`);
    const hiddenNow = await js(`(async () => { const m = ${DBM}; return await m.getHiddenCatalogUids(); })()`);
    check(hiddenNow.indexOf("tw_dr05") !== -1 && hiddenNow.indexOf("conv_bx04") !== -1, "隱藏清單沒有 tw_dr05 與複製後自動隱藏的 conv_bx04：" + JSON.stringify(hiddenNow));
  }

  console.log("[常吃（真的 IndexedDB，工作線 D 切片 5）]");
  {
    const DBM = `(await import('./js/data/db.js'))`;
    const CAT = `(await (await import('./js/data/catalog.js')).loadCatalog())`;
    // 互斥兩個方向（PRD 13.5）：同一個 transaction 開 settings＋user_profile
    const mutual = await js(`(async () => { const m = ${DBM};
      await m.addDislikedIngredient({ type: 'item', key: 'conv_sl03', label: 'x' });
      const r = await m.addFavoriteRef('conv_sl03');
      const a = r.favorites.indexOf('conv_sl03') !== -1 && !r.disliked.some((d) => d.key === 'conv_sl03') && !(await m.getProfile()).disliked_ingredients.some((d) => d.key === 'conv_sl03');
      await m.addDislikedIngredient({ type: 'item', key: 'conv_sl03', label: 'x' });
      const b = (await m.getFavoriteRefs()).indexOf('conv_sl03') === -1;
      await m.removeDislikedIngredient('conv_sl03');
      return a + ',' + b; })()`);
    check(mutual === "true,true", "常吃與不吃互斥（標常吃移出不吃、標不吃移出常吃）不對：" + mutual);
    // 全有全無：標常吃時 put 同步丟錯，常吃與不吃都沒變
    const favSnap = () => js(`(async () => { const m = ${DBM}; return JSON.stringify([await m.getFavoriteRefs(), (await m.getProfile()).disliked_ingredients]); })()`);
    await js(`(async () => { const m = ${DBM}; await m.addDislikedIngredient({ type: 'item', key: 'conv_sl03', label: 'x' }); })()`);
    const favBefore = await favSnap();
    const favFail = await js(`(async () => { const m = ${DBM}; const orig = IDBObjectStore.prototype.put; let n = 0;
      IDBObjectStore.prototype.put = function () { n++; if (n === 2) throw new DOMException('模擬的 put 失敗', 'DataError'); return orig.apply(this, arguments); };
      try { await m.addFavoriteRef('conv_sl03'); return null; } catch (e) { return String(e && e.message); }
      finally { IDBObjectStore.prototype.put = orig; } })()`);
    check(favFail !== null && (await favSnap()) === favBefore, "addFavoriteRef 中途丟錯時沒有回報失敗，或資料被改了（不是全有全無）");
    await js(`(async () => { const m = ${DBM}; await m.removeDislikedIngredient('conv_sl03'); })()`);
    // 複製成我的版本：常吃跟著換成新的我的品項（decisions #127 ⑦）
    const moved = await js(`(async () => { const m = ${DBM}; const mc = await import('./js/engine/meal-content.js'); const c = ${CAT};
      await m.addFavoriteRef('conv_bx02');
      const rec = await m.copyBuiltinToCustom(mc.copyFromBuiltin(c.productsByUid['conv_bx02']));
      const f = await m.getFavoriteRefs();
      return f.indexOf('conv_bx02') === -1 && f.indexOf(rec.id) !== -1; })()`);
    check(moved === true, "複製成我的版本後常吃沒有換成新的我的品項");
    // 我的食物：白米明細標常吃 → 自煮子分頁最上面的常吃組有它、原分類不再出現
    await js(`document.querySelector('.tab-btn[data-tab=foods]').click()`);
    await until(`!!document.querySelector('#foods-search')`, "我的食物分頁沒有搜尋框");
    await js(`(() => { const i = document.getElementById('foods-search'); i.value = '白米'; i.dispatchEvent(new Event('input', { bubbles: true })); })()`);
    await until(`!!document.querySelector('[data-foods-open="fx_rice"]')`, "搜尋白米沒有分層品項");
    await js(`document.querySelector('[data-foods-open="fx_rice"]').click()`);
    await until(`!!document.querySelector('[data-foods-favorite="fx_rice"]')`, "白米明細沒有「常吃」");
    await js(`document.querySelector('[data-foods-favorite="fx_rice"]').click()`);
    await until(`!!document.querySelector('[data-foods-unfavorite="fx_rice"]')`, "按「常吃」後沒有變成「取消常吃」");
    await js(`(() => { const i = document.getElementById('foods-search'); i.value = ''; i.dispatchEvent(new Event('input', { bubbles: true })); })()`);
    await js(`document.querySelector('[data-foods-subtab=cook]').click()`);
    await until(`!!document.querySelector('#foods-body .foods-favorites [data-foods-open="fx_rice"]')`, "自煮子分頁最上面的常吃組沒有白米");
    check((await js(`document.querySelectorAll('#foods-body [data-foods-open="fx_rice"]').length`)) === 1, "白米標常吃後在自煮子分頁出現不只一次");
    // 選擇器：加點單品最上面的常吃組有白米；超商已選列標常吃 → 搬到常吃組、資料庫有；再取消
    await js(`document.querySelector('.tab-btn[data-tab=today]').click()`);
    await until(`!!document.querySelector('#rec-lunch .rec-pick-btn')`, "午餐沒有「自己選」按鈕");
    await js(`document.querySelector('#rec-lunch .rec-pick-btn').click()`);
    await until(`!document.getElementById('meal-picker-overlay').hidden && !!document.querySelector('#meal-picker-drinks .meal-picker-favorites [data-food-uid="fx_rice"]')`, "選擇器加點單品的常吃組沒有白米");
    await js(`document.querySelector('#meal-picker-tabs [data-tab=convenience]').click()`);
    await until(`!!document.querySelector('#meal-picker-panel .item-card[data-uid=conv_bx04]:not([disabled])') || !!document.querySelector('#meal-picker-panel .item-card:not([disabled])')`, "超商分頁沒有可選的品項");
    // 挑常吃組以外的（複製後的我的品項已經是常吃，在常吃組）
    const pickUid = await js(`([...document.querySelectorAll('#meal-picker-panel .item-card[data-uid]:not([disabled])')].find((c) => !c.closest('.meal-picker-favorites')) || {}).dataset.uid`);
    check((await js(`!!document.querySelector('#meal-picker-panel .meal-picker-favorites .item-card[data-uid^=custom]')`)) === true, "複製後的我的品項（常吃）沒有在超商分頁的常吃組");
    await js(`document.querySelector('#meal-picker-panel .item-card[data-uid=' + JSON.stringify(${JSON.stringify(pickUid)}) + ']').click()`);
    await until(`!!document.querySelector('#meal-picker-panel [data-favorite-uid=' + JSON.stringify(${JSON.stringify(pickUid)}) + ']')`, "已選列沒有「常吃」");
    await js(`document.querySelector('#meal-picker-panel [data-favorite-uid=' + JSON.stringify(${JSON.stringify(pickUid)}) + ']').click()`);
    await until(`!!document.querySelector('#meal-picker-panel .meal-picker-favorites .item-card.selected[data-uid=' + JSON.stringify(${JSON.stringify(pickUid)}) + ']')`, "已選列標常吃後沒有搬到常吃組（或取消了選取）");
    check((await js(`(async () => { const m = ${DBM}; return (await m.getFavoriteRefs()).indexOf(${JSON.stringify(pickUid)}) !== -1; })()`)) === true, "選擇器標常吃沒有寫進資料庫");
    await js(`document.querySelector('#meal-picker-panel [data-unfavorite-uid=' + JSON.stringify(${JSON.stringify(pickUid)}) + ']').click()`);
    await until(`!document.querySelector('#meal-picker-panel .meal-picker-favorites [data-uid=' + JSON.stringify(${JSON.stringify(pickUid)}) + ']')`, "取消常吃後還在常吃組");
    await js(`document.getElementById('meal-picker-cancel').click()`);
  }

  console.log("[我的食材（真的 IndexedDB，工作線 D 切片 8b-2）]");
  {
    const DBI = `(await import('./js/data/db.js'))`;
    // 查詢檔載入失敗 → 「載入失敗」＋重試；重試成功（失敗不快取，審核 M7）
    await js(`document.querySelector('.tab-btn[data-tab=foods]').click()`);
    await until(`!!document.querySelector('[data-foods-subtab=cook]') && !document.querySelector('#foods-body[data-loading]')`, "我的食物沒有載完（我的食材）");
    await js(`document.querySelector('[data-foods-subtab=cook]').click()`);
    await js(`(() => { window.__realFetch = window.fetch; window.fetch = (u, o) => String(u).indexOf('tfda_lookup') !== -1 ? Promise.reject(new Error('offline')) : window.__realFetch(u, o); })()`);
    await js(`document.querySelector('[data-ing-add]').click()`);
    await until(`${text("#foods-body")}.indexOf("衛福部資料載入失敗") !== -1 && !!document.querySelector('[data-ing-retry]')`, "查詢檔載入失敗時沒有「載入失敗」與重試");
    await js(`(() => { window.fetch = window.__realFetch; document.querySelector('[data-ing-retry]').click(); })()`);
    await until(`document.querySelectorAll('[data-ing-cat]').length === 18`, "重試後沒有載到查詢檔（18 個分類）");
    // 加入衛福部食材（UI）→ 常吃 → 不吃＝移除（同一個 transaction 移出常吃）→ 復原（名稱與一份原樣）
    await js(`(() => { const el = document.getElementById('ing-search'); el.value = '茶葉蛋'; el.dispatchEvent(new Event('input', { bubbles: true })); })()`);
    await until(`!!document.querySelector('[data-ing-pick=K0112102]')`, "搜尋茶葉蛋沒有 K0112102");
    await js(`document.querySelector('[data-ing-pick=K0112102]').click()`);
    await js(`(() => { document.querySelector('[data-ing-add-field=name]').value = '家裡的茶葉蛋'; document.querySelector('[data-ing-add-field=amount]').value = '55'; document.querySelector('[data-ing-confirm]').click(); })()`);
    await until(`${text("#foods-status")}.indexOf("已加入「家裡的茶葉蛋」") !== -1`, "茶葉蛋沒有加入");
    await js(`(async () => { const m = ${DBI}; await m.addFavoriteRef('cing_k0112102'); })()`);
    const removed = JSON.parse(await js(`(async () => { const m = ${DBI}; const old = await m.removeTfdaIngredient('cing_k0112102');
      return JSON.stringify({ old: old, fav: await m.getFavoriteRefs(), left: (await m.getCustomIngredients()).length }); })()`));
    check(removed.old.name === "家裡的茶葉蛋" && removed.fav.indexOf("cing_k0112102") === -1 && removed.left === 0, "移除衛福部食材沒有同時移出常吃：" + JSON.stringify(removed));
    const back = JSON.parse(await js(`(async () => { const m = ${DBI}; await m.restoreTfdaIngredient(${JSON.stringify(removed.old)}); return JSON.stringify(await m.getCustomIngredients()); })()`));
    check(back.length === 1 && back[0].name === "家裡的茶葉蛋" && back[0].default_amount === 55 && back[0].created_at === removed.old.created_at, "復原沒有原樣放回：" + JSON.stringify(back));
    check(/ConstraintError|已存在|Key already exists/i.test(await js(`(async () => { const m = ${DBI}; try { await m.addCustomIngredient({ source: 'tfda', tfda_id: 'K0112102', tfda_version: '2025-update1', name: 'x', default_amount: null }); return 'ok'; } catch (e) { return String(e.name + ' ' + e.message); } })()`)),
      "同一個衛福部樣品可以加兩次");
  }

  console.log("[備份與還原（真的 IndexedDB）]");
  // import('./js/data/db.js') 經過 import map，跟 App 是同一個模組實體（PRD 11.6、B-3 計畫第 4 節 9–11）
  const DB = `(await import('./js/data/db.js'))`;
  const exported = await js(`(async () => { const m = ${DB}; const e = await m.exportAllData(); return JSON.stringify(e); })()`);
  // B-1a：用這次真的匯出凍結目前版本的 fixture（只在明確要求時寫檔，平常不動 repo）
  if (process.env.SMOKE_FREEZE_BACKUP) {
    const fsm = await import("node:fs");
    const obj = JSON.parse(exported);
    fsm.writeFileSync(process.env.SMOKE_FREEZE_BACKUP, JSON.stringify(Object.assign({ format: obj.format, schema_version: obj.schema_version, exported_at: "2026-09-29T12:00:00.000Z", app_version: "smoke" }, obj), null, 2) + String.fromCharCode(10));
    console.log("  已凍結 " + process.env.SMOKE_FREEZE_BACKUP);
  }
  check(JSON.parse(exported).sections.logs.daily_log.some((l) => l.content.components.some((x) => x.kind === "food")), "備份沒有帶到單品紀錄");
  const favExported = JSON.parse(exported).sections.system.settings.find((x) => x.id === "favorite_refs");
  check(!!favExported && favExported.value.indexOf("fx_rice") !== -1 && favExported.value.some((u) => /^custom/.test(u)), "備份沒有帶到常吃（v4，含白米與複製後的我的品項）");
  check(JSON.parse(exported).schema_version === 6 && Array.isArray(JSON.parse(exported).sections.custom_ingredients) && Array.isArray(JSON.parse(exported).sections.meal_plan) && JSON.parse(exported).sections.saved_meals.length === 2 &&
    JSON.parse(exported).sections.saved_meals.some((r) => r.content.components.some((x) => x.kind === "food")), "備份沒有帶到我的組合（v6，含單品的組合、我的食材與預約區塊）");
  const selfCheck = await js(`(async () => { const m = ${DB}; return m.validateBackup(m.migrateBackup(JSON.parse(${JSON.stringify(exported)}))); })()`);
  check(Array.isArray(selfCheck) && selfCheck.length === 0, "smoke 流程寫進去的資料匯出後不能還原：" + JSON.stringify(selfCheck).slice(0, 300));
  // 取代：多寫一筆、改一個設定，還原後回到匯出時的樣子（id 保留、多寫的消失）
  await js(`(async () => { const m = ${DB}; await m.addWeightLog({ log_date: '2000-01-01', weight_kg: 70 }); await m.setSetting('picker_last_meal_type', { snack: 'delivery' }); })()`);
  check((await js(`(async () => { const m = ${DB}; return JSON.stringify(await m.exportAllData()); })()`)) !== exported, "多寫一筆後匯出內容沒變（測試前提不成立）");
  await js(`(async () => { const m = ${DB}; await m.importAllData(JSON.parse(${JSON.stringify(exported)})); })()`);
  check((await js(`(async () => { const m = ${DB}; return JSON.stringify(await m.exportAllData()); })()`)) === exported, "還原後再匯出，跟原本的備份不是逐字相同");
  // 全有全無：put 第 5 次呼叫「同步」丟錯（模擬 DataError；不能改成回傳失敗的 request，那樣測不到 withStores 的同步丟錯）
  await js(`(async () => { const m = ${DB}; await m.addWeightLog({ log_date: '2000-01-02', weight_kg: 71 }); })()`);
  const beforeFail = await js(`(async () => { const m = ${DB}; return JSON.stringify(await m.exportAllData()); })()`);
  const failMsg = await js(`(async () => { const m = ${DB}; const orig = IDBObjectStore.prototype.put; let n = 0;
    IDBObjectStore.prototype.put = function () { n++; if (n === 5) throw new DOMException('模擬的 put 失敗', 'DataError'); return orig.apply(this, arguments); };
    try { await m.importAllData(JSON.parse(${JSON.stringify(exported)})); return null; } catch (e) { return String(e && e.message); }
    finally { IDBObjectStore.prototype.put = orig; } })()`);
  check(failMsg !== null, "put 中途丟錯時 importAllData 沒有回報失敗");
  const afterFail = await js(`(async () => { const m = ${DB}; return JSON.stringify(await m.exportAllData()); })()`);
  check(afterFail === beforeFail, "put 中途丟錯後資料庫被改了（不是全有全無）：匯入前 " + beforeFail.length + " 字、之後 " + afterFail.length + " 字");
  await js(`(async () => { const m = ${DB}; await m.importAllData(JSON.parse(${JSON.stringify(exported)})); })()`);

  console.log("[儲存與錯誤]");
  check((await js(`indexedDB.databases().then((d) => d.map((x) => x.name).join(','))`)) === "lighten2", "IndexedDB 不是只有 lighten2");
  const lsKeys = await js(`Object.keys(localStorage)`);
  check(lsKeys.every((k) => k.indexOf("lighten2.") === 0), "localStorage 有沒加 lighten2. 前綴的 key：" + lsKeys.join(","));
  // 我的食材一節故意讓查詢檔載入失敗（審核 M7），那個錯誤不算
  H.consoleErrors().filter((e) => !/Error: offline[\s\S]*loadTfdaLookup/.test(JSON.stringify(e.params))).forEach((e) => fail("console 錯誤：" + JSON.stringify(e.params).slice(0, 300)));
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
