// 證明 decisions #101（雜糧飯改標麩質＋未確認、拿掉素食）造成的快照差異只限於會擋雜糧飯的情境。
// 用法：node verify-grain-fix.js <舊快照目錄> <新快照目錄>
"use strict";
const fs = require("fs");
const path = require("path");
const [oldDir, newDir] = process.argv.slice(2);
const G = "mixed_grain_rice_cooked";
const load = (d, f) => {
  const m = new Map();
  fs.readFileSync(path.join(d, f + ".txt"), "utf8").split(/\r?\n/).filter(Boolean).forEach((l) => {
    const i = l.indexOf("\t");
    m.set(i === -1 ? l : l.slice(0, i), i === -1 ? "" : l.slice(i + 1));
  });
  return m;
};
let bad = 0;
const fail = (m) => { bad++; console.log("✗ " + m); };
const report = {};

["pool", "matrix", "recs", "tdee", "picker", "ui"].forEach((f) => {
  const a = load(oldDir, f), b = load(newDir, f);
  const keys = new Set([...a.keys(), ...b.keys()]);
  let changed = 0;
  keys.forEach((k) => {
    if (!a.has(k) || !b.has(k)) { fail(f + " 行數變了：" + k); return; }
    const x = a.get(k), y = b.get(k);
    if (x === y) return;
    changed++;
    if (f === "pool") {
      // 只准雜糧飯的組合，而且只差 allergen= 與 diet= 兩欄
      const strip = (s) => s.replace(/ allergen=\S*/, "").replace(/ diet=\S*/, "");
      if (k.indexOf(G) === -1) fail("pool 非雜糧飯的組合變了：" + k);
      else if (strip(x) !== strip(y)) fail("pool 雜糧飯組合除了過敏原與飲食之外也變了：" + k);
      else {
        // diet＝每個成分各自的素食標記：只准恰好一個成分（雜糧飯）由有素食變成 []
        const dx = JSON.parse(/diet=(\S*)/.exec(x)[1]), dy = JSON.parse(/diet=(\S*)/.exec(y)[1]);
        const diffs = dx.map((v, i) => JSON.stringify(v) === JSON.stringify(dy[i]) ? null : [v, dy[i]]).filter(Boolean);
        const tags = /allergen=(\S*)/.exec(y)[1].split(",");
        if (dx.length !== dy.length || diffs.length !== 1 || diffs[0][1].length !== 0 || diffs[0][0].length === 0) fail("pool 素食標記的變化不是「雜糧飯變成沒有素食」：" + k);
        if (tags.indexOf("麩質") === -1 || tags.indexOf("未確認") === -1) fail("pool 新的過敏原沒有麩質＋未確認：" + k);
      }
    } else if (f === "matrix") {
      // key＝飲食/模式/赤字/過敏原：只准會擋雜糧飯的設定（全素、蛋奶素、或設了任何過敏原——未確認一律擋）
      const p = k.split("/");
      const blocks = p[0] === "全素" || p[0] === "蛋奶素" || p[3] !== "無";
      if (!blocks) fail("matrix 不會擋雜糧飯的設定卻變了：" + k);
      else if (x.indexOf(G) === -1) fail("matrix 舊的推薦沒有雜糧飯卻變了：" + k);
      else if (y.indexOf(G) !== -1) fail("matrix 會擋雜糧飯的設定仍推薦雜糧飯：" + k);
    } else {
      // recs、ui：只准 VEG、VEGAN 情境，舊值含雜糧飯、新值不含
      if (!/^today\/(VEG|VEGAN)\//.test(k)) fail(f + " 不是素食情境卻變了：" + k);
      else if (x.indexOf(G) === -1 && x.indexOf("雜糧飯") === -1) fail(f + " 舊值沒有雜糧飯卻變了：" + k);
      else if (y.indexOf(G) !== -1 || y.indexOf("雜糧飯") !== -1) fail(f + " 新值仍有雜糧飯：" + k);
    }
  });
  report[f] = changed;
});
console.log("變動行數：" + JSON.stringify(report));
console.log(bad === 0 ? "✓ 差異全部來自雜糧飯的標註修正" : bad + " 個不符");
process.exit(bad ? 1 : 0);
