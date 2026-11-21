// 輕盈計畫 — 產生 PWA 圖示（images/icons/*.png）。用法：node tools/build-icons.mjs（可重跑，會覆蓋舊圖）
// 用 browser-harness 開無頭瀏覽器，載入內嵌 SVG 的 data URL 後截圖。
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { startHarness, ROOT, sleep } from "./lib/browser-harness.mjs";

const OUT = join(ROOT, "images", "icons");
const ICONS = [
  { file: "icon-192.png", size: 192, round: true, glyph: 0.55 },
  { file: "icon-512.png", size: 512, round: true, glyph: 0.55 },
  { file: "icon-maskable-512.png", size: 512, round: false, glyph: 0.45 },
  { file: "apple-touch-icon-180.png", size: 180, round: false, glyph: 0.55 },
];

function html(size, round, glyph) {
  const rx = round ? Math.round(size * 0.22) : 0;
  const fs = Math.round(size * glyph);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">` +
    `<rect width="${size}" height="${size}" rx="${rx}" fill="#12263A"/>` +
    `<text x="50%" y="50%" text-anchor="middle" dominant-baseline="central" font-family="sans-serif" font-weight="900" font-size="${fs}" fill="#FFFFFF">輕</text></svg>`;
  return `<!DOCTYPE html><html><body style="margin:0;background:transparent">${svg}</body></html>`;
}

mkdirSync(OUT, { recursive: true });
const h = await startHarness();
try {
  for (const ic of ICONS) {
    await h.send("Emulation.setDeviceMetricsOverride", { width: ic.size, height: ic.size, deviceScaleFactor: 1, mobile: false });
    await h.send("Emulation.setDefaultBackgroundColorOverride", { color: { r: 0, g: 0, b: 0, a: 0 } });
    await h.send("Page.navigate", { url: "data:text/html;charset=utf-8," + encodeURIComponent(html(ic.size, ic.round, ic.glyph)) });
    await sleep(600);
    const r = await h.send("Page.captureScreenshot", { format: "png" });
    writeFileSync(join(OUT, ic.file), Buffer.from(r.result.data, "base64"));
    console.log("已產生 " + ic.file + "（" + ic.size + "x" + ic.size + "）");
  }
} finally {
  await h.close();
}
