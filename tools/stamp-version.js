// 產生 index.html 的 import map：列出 js/ 底下每個模組，全部帶同一個版本字串（章程 C1.6）；css 連結用同一個版本字串。
// 程式裡一律用相對路徑 import；瀏覽器解析出的網址會被 import map 換成 ?v=版本，部署後不用手動重新整理。
// 用法：node tools/stamp-version.js           換一個新版本字串（改了 js/ 就要跑）
//       node tools/stamp-version.js --keep    版本不變，只重列檔案（新增/刪除檔案時）

"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const HTML = path.join(ROOT, "index.html");

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? walk(p) : e.name.endsWith(".js") ? [p] : [];
  });
}

let html = fs.readFileSync(HTML, "utf8");
const keep = process.argv.indexOf("--keep") !== -1;
const old = /\.js\?v=([\w.-]+)"/.exec(html);

let version;
if (keep && old) {
  version = old[1];
} else {
  const d = new Date();
  const p2 = (x) => String(x).padStart(2, "0");
  version = d.getFullYear() + p2(d.getMonth() + 1) + p2(d.getDate()) + "-" + p2(d.getHours()) + p2(d.getMinutes()) + p2(d.getSeconds());
  if (old && old[1] === version) version += "b";
}

const files = walk(path.join(ROOT, "js")).map((p) => path.relative(ROOT, p).split(path.sep).join("/")).sort();
const imports = {};
files.forEach((f) => { imports["./" + f] = "./" + f + "?v=" + version; });
const block = '<script type="importmap">\n' + JSON.stringify({ imports: imports }, null, 2) + "\n  </script>";

if (!/<script type="importmap">[\s\S]*?<\/script>/.test(html)) throw new Error("index.html 找不到 <script type=\"importmap\"> 區塊");
html = html.replace(/<script type="importmap">[\s\S]*?<\/script>/, block);
html = html.replace(/(<script type="module" src="js\/[^"?]+)\?v=[\w.-]+("><\/script>)/, "$1?v=" + version + "$2");
html = html.replace(/(<link rel="stylesheet" href="css\/[^"?]+)\?v=[\w.-]+(")/g, "$1?v=" + version + "$2");
fs.writeFileSync(HTML, html);
console.log("import map：" + files.length + " 個模組，版本 " + version);
