// 輕盈計畫 — 無頭瀏覽器測試的共用底座（唯一來源，章程 C2）：靜態 server、啟動 Edge/Chrome、CDP 連線、檢查與截圖。
// smoke-browser.mjs（桌機冒煙）與 mobile-walkthrough.mjs（手機實機腳本自動版）共用。

import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const CANDIDATES = [
  process.env.SMOKE_BROWSER,
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "/usr/bin/google-chrome", "/usr/bin/chromium-browser", "/usr/bin/chromium",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
].filter(Boolean);

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8", ".jpg": "image/jpeg", ".png": "image/png", ".svg": "image/svg+xml" };

// mobile：{ width, height, deviceScaleFactor } 時模擬手機（觸控、行動版 viewport）；不給就是桌機
export async function startHarness(opts) {
  const o = opts || {};
  const BROWSER = CANDIDATES.find((p) => existsSync(p));
  if (!BROWSER) { console.log("找不到 Edge/Chrome，設定 SMOKE_BROWSER 指到瀏覽器執行檔"); process.exit(1); }

  const server = createServer((req, res) => {
    const p = normalize(join(ROOT, decodeURIComponent(req.url.split("?")[0]) || "/"));
    const file = p.endsWith("\\") || p.endsWith("/") ? join(p, "index.html") : p;
    if (!file.startsWith(ROOT) || !existsSync(file)) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { "Content-Type": TYPES[extname(file)] || "application/octet-stream" });
    res.end(readFileSync(file));
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const url = "http://127.0.0.1:" + server.address().port + "/index.html";

  const profileDir = mkdtempSync(join(tmpdir(), "lighten-browser-"));
  const port = 9300 + Math.floor(Math.random() * 500);
  const browser = spawn(BROWSER, ["--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check",
    "--remote-debugging-port=" + port, "--user-data-dir=" + profileDir, "about:blank"], { stdio: "ignore" });

  let wsUrl = null;
  for (let i = 0; i < 75 && !wsUrl; i++) {
    try {
      const list = await (await fetch("http://127.0.0.1:" + port + "/json/list")).json();
      const page = list.find((t) => t.type === "page");
      if (page) wsUrl = page.webSocketDebuggerUrl;
    } catch (e) { /* 還沒啟動 */ }
    if (!wsUrl) await sleep(200);
  }
  if (!wsUrl) throw new Error("瀏覽器沒有啟動");

  const ws = new WebSocket(wsUrl);
  await new Promise((r) => ws.addEventListener("open", r));
  let seq = 0;
  const pending = new Map();
  const events = [];
  const dialogs = []; // alert/confirm 的文字（自動按確定）
  ws.addEventListener("message", (m) => {
    const msg = JSON.parse(m.data);
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); return; }
    if (msg.method === "Page.javascriptDialogOpening") {
      dialogs.push(msg.params.message);
      send("Page.handleJavaScriptDialog", { accept: true });
    }
    if (msg.method) events.push(msg);
  });
  const send = (method, params = {}) => new Promise((r) => { const i = ++seq; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });

  // 頁面裡的 promise 永遠不 resolve 時（例：IndexedDB 交易丟錯），15 秒後當成錯誤，不讓整個測試卡住
  async function js(expr) {
    const r = await Promise.race([
      send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true }),
      sleep(15000).then(() => { throw new Error("頁面執行逾時（15 秒）：" + expr.slice(0, 80)); }),
    ]);
    if (r.result.exceptionDetails) throw new Error("頁面執行錯誤：" + expr.slice(0, 80) + " → " + JSON.stringify(r.result.exceptionDetails.exception && r.result.exceptionDetails.exception.description));
    return r.result.result.value;
  }

  let failures = 0, checks = 0;
  function fail(msg) { failures++; console.log("  ✗ " + msg); }
  function check(cond, msg) { checks++; if (!cond) fail(msg); }
  // 等到條件成立（最多 8 秒）
  async function until(expr, label) {
    for (let i = 0; i < 80; i++) {
      if (await js(expr)) return true;
      await sleep(100);
    }
    fail(label + "（等了 8 秒）");
    return false;
  }

  await send("Runtime.enable");
  await send("Log.enable");
  await send("Page.enable");
  if (o.mobile) {
    await send("Emulation.setDeviceMetricsOverride", { width: o.mobile.width, height: o.mobile.height,
      deviceScaleFactor: o.mobile.deviceScaleFactor || 2, mobile: true });
    await send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
  }

  // 截圖（目前視窗）存成 PNG，回傳路徑
  async function screenshot(dir, name) {
    mkdirSync(dir, { recursive: true });
    const r = await send("Page.captureScreenshot", { format: "png" });
    const file = join(dir, name + ".png");
    writeFileSync(file, Buffer.from(r.result.data, "base64"));
    return file;
  }

  // console 錯誤（不含 favicon 404）
  function consoleErrors() {
    return events.filter((e) =>
      e.method === "Runtime.exceptionThrown" ||
      (e.method === "Runtime.consoleAPICalled" && e.params.type === "error") ||
      (e.method === "Log.entryAdded" && e.params.entry.level === "error" && !/favicon\.ico/.test(e.params.entry.url || "")));
  }

  async function close() {
    ws.close();
    browser.kill();
    server.close();
    await sleep(300);
    try { rmSync(profileDir, { recursive: true, force: true }); } catch (e) { /* 瀏覽器還沒放開檔案 */ }
  }

  return {
    url, send, js, until, check, fail, screenshot, consoleErrors, close, dialogs,
    text: (sel) => `((document.querySelector(${JSON.stringify(sel)}) || {}).innerText || "")`,
    result: () => ({ failures, checks: checks }),
    countCheck: () => { checks++; },
  };
}
