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

  console.log("[我的品項：隱藏、複製、份量（真的 IndexedDB）]");
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
    // 隱藏「目前推薦卡片裡的品項」→ 今日建議重算後推薦不含它；取消隱藏後回來
    await js(`document.querySelector('.tab-btn[data-tab=today]').click()`);
    await until(`!!document.querySelector('#rec-lunch .rec-log-btn') || !!document.querySelector('#rec-lunch .rec-undo-btn') || !!document.querySelector('#rec-lunch .rec-pick-btn')`, "今日建議沒有午餐卡片");
    // 推薦卡片「順便不要」的 chip 帶著現成品項的 uid（data-type=item）
    const recUid = await js(`(() => { const c = document.querySelector('[id^=rec-] .dislike-chip[data-type=item]'); return c ? c.dataset.key : null; })()`);
    check(!!recUid, "找不到推薦卡片裡的現成品項（測試前提不成立）");
    if (recUid) {
      await js(`(async () => { const m = ${DBM}; await m.hideCatalogItem(${JSON.stringify(recUid)}); })()`);
      await js(`document.querySelector('.tab-btn[data-tab=week]').click()`);
      await js(`document.querySelectorAll('[id^=rec-]').forEach((el) => el.insertAdjacentHTML('beforeend', '<i class="smoke-stale"></i>'))`);
      await js(`document.querySelector('.tab-btn[data-tab=today]').click()`);
      await until(`!document.querySelector('.smoke-stale')`, "隱藏後今日建議沒有重算");
      check(!(await js(`!!document.querySelector('[id^=rec-] .dislike-chip[data-key=${JSON.stringify(recUid).slice(1, -1)}]')`)), "隱藏推薦裡的品項 " + recUid + " 後，今日建議還推薦它");
      await js(`(async () => { const m = ${DBM}; await m.unhideCatalogItem(${JSON.stringify(recUid)}); })()`);
    }
    // 備份來回（M9）：先寫進一個隱藏 uid、一筆複製品、一筆份量 ×2 的紀錄，下一段的匯出→還原要逐字相同
    await js(`(async () => { const m = ${DBM}; const mc = await import('./js/engine/meal-content.js'); const c = ${CAT};
      await m.hideCatalogItem('tw_dr05');
      await m.copyBuiltinToCustom(mc.copyFromBuiltin(c.productsByUid['conv_bx04']));
      const p = c.productsByUid['conv_bx01'];
      const content = mc.buildDraftContent({ kind: 'products', meal_type: 'convenience', items: [p], estimates: [], drink: null, qtyByUid: { conv_bx01: 2 } });
      await m.addDailyLog(mc.buildLogEntry({ date: '2026-09-20', slot: 'lunch', source: 'manual', name: mc.draftLogName({ kind: 'products', items: [p], estimates: [], drink: null, qtyByUid: { conv_bx01: 2 } }),
        content: content, totals: mc.contentTotals(content, c), createdAt: new Date().toISOString() })); })()`);
    const hiddenNow = await js(`(async () => { const m = ${DBM}; return await m.getHiddenCatalogUids(); })()`);
    check(hiddenNow.indexOf("tw_dr05") !== -1 && hiddenNow.indexOf("conv_bx04") !== -1, "隱藏清單沒有 tw_dr05 與複製後自動隱藏的 conv_bx04：" + JSON.stringify(hiddenNow));
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
