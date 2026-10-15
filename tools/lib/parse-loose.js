// 模型回的 JSON：去掉 markdown 圍欄，字串裡的裸換行轉成空白
"use strict";
module.exports = function parseLoose(text) {
  let t = String(text).replace(/```(?:json)?/g, "").trim();
  const a = t.indexOf("["), b = t.lastIndexOf("]");
  if (a !== -1 && b !== -1) t = t.slice(a, b + 1);
  try { return JSON.parse(t); } catch (e) { /* fall through */ }
  let out = "", inStr = false, esc = false;
  for (const ch of t) {
    if (inStr) {
      if (esc) { esc = false; out += ch; continue; }
      if (ch === "\\") { esc = true; out += ch; continue; }
      if (ch === '"') { inStr = false; out += ch; continue; }
      if (ch === "\n" || ch === "\r" || ch === "\t") { out += " "; continue; }
      out += ch;
    } else { if (ch === '"') inStr = true; out += ch; }
  }
  try { return JSON.parse(out); } catch (e) {
    // 輸出被截斷：保留最後一個完整元素
    const cut = out.lastIndexOf("  },");
    if (cut === -1) throw e;
    return JSON.parse(out.slice(0, cut + 3) + "]");
  }
};
