// 輕盈計畫 — 瀏覽器冒煙測試：用無頭 Edge/Chrome 實際操作 App（ES modules、import map、IndexedDB 都是真的）。
// 用法：node tools/smoke-browser.mjs            （全部通過 exit 0）
//       SMOKE_BROWSER=/path/to/chrome node tools/smoke-browser.mjs
// 流程：填基本資料 → 今日建議 → 記錄推薦 → 撤銷 → 自己選（現成品項、自己煮）→ 本週 → 運動 → 體重；
// 最後檢查 console 沒有錯誤、資料庫是 lighten2、daily_log 是新格式。約 30 秒，不放進 pre-commit，Phase 驗收時跑。
// 手機上的觸控、版面仍要照 docs/手機實機腳本.md 手動跑。

import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CANDIDATES = [
  process.env.SMOKE_BROWSER,
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "/usr/bin/google-chrome", "/usr/bin/chromium-browser", "/usr/bin/chromium",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
].filter(Boolean);
const BROWSER = CANDIDATES.find((p) => existsSync(p));
if (!BROWSER) { console.log("找不到 Edge/Chrome，設定 SMOKE_BROWSER 指到瀏覽器執行檔"); process.exit(1); }

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- 靜態 server ----------
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8", ".jpg": "image/jpeg", ".png": "image/png", ".svg": "image/svg+xml" };
const server = createServer((req, res) => {
  const p = normalize(join(ROOT, decodeURIComponent(req.url.split("?")[0]) || "/"));
  const file = p.endsWith("\\") || p.endsWith("/") ? join(p, "index.html") : p;
  if (!file.startsWith(ROOT) || !existsSync(file)) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { "Content-Type": TYPES[extname(file)] || "application/octet-stream" });
  res.end(readFileSync(file));
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const URL_BASE = "http://127.0.0.1:" + server.address().port + "/index.html";

// ---------- 瀏覽器＋CDP ----------
const profileDir = mkdtempSync(join(tmpdir(), "lighten-smoke-"));
const port = 9300 + Math.floor(Math.random() * 500);
const browser = spawn(BROWSER, ["--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check",
  "--remote-debugging-port=" + port, "--user-data-dir=" + profileDir, "about:blank"], { stdio: "ignore" });

async function wsUrl() {
  for (let i = 0; i < 75; i++) {
    try {
      const list = await (await fetch("http://127.0.0.1:" + port + "/json/list")).json();
      const page = list.find((t) => t.type === "page");
      if (page) return page.webSocketDebuggerUrl;
    } catch (e) { /* 還沒啟動 */ }
    await sleep(200);
  }
  throw new Error("瀏覽器沒有啟動");
}

const ws = new WebSocket(await wsUrl());
await new Promise((r) => ws.addEventListener("open", r));
let seq = 0;
const pending = new Map();
const events = [];
ws.addEventListener("message", (m) => {
  const msg = JSON.parse(m.data);
  if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); } else if (msg.method) events.push(msg);
});
const send = (method, params = {}) => new Promise((r) => { const i = ++seq; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
async function js(expr) {
  const r = await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true });
  if (r.result.exceptionDetails) throw new Error("頁面執行錯誤：" + expr.slice(0, 80) + " → " + JSON.stringify(r.result.exceptionDetails.exception && r.result.exceptionDetails.exception.description));
  return r.result.result.value;
}
// 等到條件成立（最多 8 秒）
async function until(expr, label) {
  for (let i = 0; i < 80; i++) {
    if (await js(expr)) return true;
    await sleep(100);
  }
  fail(label + "（等了 8 秒）");
  return false;
}
const text = (sel) => `((document.querySelector(${JSON.stringify(sel)}) || {}).innerText || "")`;

let failures = 0, checks = 0;
function fail(msg) { failures++; console.log("  ✗ " + msg); }
function check(cond, msg) { checks++; if (!cond) fail(msg); }

async function run() {
  await send("Runtime.enable");
  await send("Log.enable");
  await send("Page.enable");
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
  await until(`!document.getElementById('manual-picker-overlay').hidden && document.querySelectorAll('#manual-picker-items .item-card').length > 0`, "自己選沒有打開或沒有品項");
  await js(`document.querySelector('#manual-picker-items .item-card[data-uid=conv_bx04]').click()`);
  await until(`${text("#manual-picker-summary")}.indexOf("已選 1 件") !== -1`, "選一個品項後摘要沒有更新");
  await js(`document.getElementById('manual-picker-submit').click()`);
  await until(`${text("#rec-lunch")}.indexOf("已記錄") !== -1`, "自己選送出後午餐沒有變成已記錄");

  await js(`document.querySelector('#rec-dinner .rec-pick-btn').click()`);
  await until(`!document.getElementById('manual-picker-overlay').hidden`, "晚餐自己選沒有打開");
  await js(`document.querySelector('input[name=manual-picker-mode][value=compose]').click()`);
  await js(`document.querySelector('#manual-picker-compose-mode .compose-option[data-axis=archetype]').click()`);
  await js(`['protein', 'staple', 'method'].forEach((ax) => { const b = document.querySelector('#manual-picker-compose-mode .compose-option[data-axis=' + ax + ']:not([disabled])'); if (b) b.click(); })`);
  await until(`${text("#manual-picker-summary")}.indexOf("已配好") !== -1 && !document.getElementById('manual-picker-submit').disabled`, "自己煮選好後不能送出");
  await js(`document.getElementById('manual-picker-submit').click()`);
  await until(`${text("#rec-dinner")}.indexOf("已記錄") !== -1`, "自己煮送出後晚餐沒有變成已記錄");

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
  const errs = events.filter((e) =>
    e.method === "Runtime.exceptionThrown" ||
    (e.method === "Runtime.consoleAPICalled" && e.params.type === "error") ||
    (e.method === "Log.entryAdded" && e.params.entry.level === "error" && !/favicon\.ico/.test(e.params.entry.url || "")));
  errs.forEach((e) => fail("console 錯誤：" + JSON.stringify(e.params).slice(0, 300)));
  checks++;
}

try {
  await run();
} catch (err) {
  fail(err.message);
}
ws.close();
browser.kill();
server.close();
await sleep(300);
try { rmSync(profileDir, { recursive: true, force: true }); } catch (e) { /* 瀏覽器還沒放開檔案 */ }
console.log("\n" + (failures === 0 ? "全部通過" : failures + " 項失敗") + "（共 " + checks + " 項檢查）");
process.exit(failures === 0 ? 0 : 1);
