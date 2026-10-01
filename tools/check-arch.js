// 輕盈計畫 — 架構規則檢查（章程 C1、C2、C4.11–C4.17）
//
// 用法：
//   node tools/check-arch.js                 檢查目前工作目錄
//   node tools/check-arch.js --staged        另外檢查「這次提交改到 js/ 時 import map 版本字串有沒有換」（pre-commit 用）
//   node tools/check-arch.js --base <commit> 同上，比對 <commit>..HEAD（CI 用）
// 全部通過 exit 0，任何一條失敗 exit 1。

"use strict";

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const ROOT = path.join(__dirname, "..");
const JS = path.join(ROOT, "js");
const args = process.argv.slice(2);

// ---------- 設定 ----------

// 重複的頂層函式名／常數名白名單（C2）：各分頁自己的進入點與小工具名稱，同名不代表同一個概念。
const DUP_NAME_ALLOW = new Set(["render", "init", "ready", "$", "onActivate", "mount"]);

// 「我的組合」讀取函式只允許這些檔案 import（C4.16）。
// 只能加入負責「選擇器、組合管理區、今日建議日期切換的預選編輯、食物資料頁、備份匯出匯入」這五類職責的檔案（章程 C4.16）。
const SAVED_MEAL_READERS = ["listSavedMeals", "getSavedMeal", "exportAllData"];
const SAVED_MEAL_READER_FILES = [
  /^js\/ui\/meal-picker\//,        // 選擇器（Phase 0）
  /^js\/ui\/foods\/saved-meals\.js$/, // 組合管理區（平行工作線 C；放在「我的食物」，PRD 13.2）
  // 今日建議日期切換的預選編輯（decisions #118、#119；取代餐點日曆週格子）：檔案做的時候再加，tab-today.js 本身不可以
  /^js\/ui\/backup\.js$/,          // 備份匯出匯入（平行工作線 B-3）
  /^js\/data\/db\.js$/,
];

// 讀取運動紀錄（包括整批匯出）只允許運動分頁、db.js 與備份匯出匯入（C4.12，decisions #72）
const EXERCISE_READERS = ["getExerciseLogs", "exportAllData"];
const EXERCISE_FILES = [/^js\/ui\/tab-exercise\.js$/, /^js\/data\/db\.js$/, /^js\/ui\/backup\.js$/];

// picker_last_meal_type 只允許出現在 db.js 與「自己選」選擇器（C4.15）
const PICKER_LAST_FILES = [/^js\/data\/db\.js$/, /^js\/ui\/meal-picker\//];
// C4.17 ②：常吃清單。字串 favorite_refs 只准 db.js（掃原始碼含字串）；getFavoriteRefs 只准這些檔案 import（料理編輯器到切片 9 再加）；
// engine 的參數名 favoriteRefs 只准這三個檔案（recommend.js 的「只在 score 裡」函式範圍檢查到切片 6 才有對象）
const FAVORITE_KEY_FILES = [/^js\/data\/db\.js$/];
const FAVORITE_READER_FILES = [/^js\/data\/db\.js$/, /^js\/ui\/meal-picker\//, /^js\/ui\/tab-foods\.js$/, /^js\/ui\/tab-today\.js$/];
const FAVORITE_PARAM_ENGINE_FILES = [/^js\/engine\/picker\.js$/, /^js\/engine\/today\.js$/, /^js\/engine\/recommend\.js$/];

// ui/ 禁用字（C4.13 不評判）
const BANNED_WORDS = ["遵循率", "偏離計畫", "未完成", "連續達成", "達成天數", "照計畫天數", "外食比較多", "多自己煮", "吃太多", "爆卡", "罪惡"];

// 營養欄位（C4.11：ui/ 不得自己加總）
const NUTRIENT = "(kcal|protein_g|carb_g|fat_g|fiber_g|sat_fat_g|sodium_mg)";
const UI_SUM_PATTERNS = [
  { re: /\b\w*(kcal|protein|carb|fat|fiber|sodium)\w*\s*\+=/i, why: "營養數值累加（+=）" },
  { re: new RegExp("\\+=\\s*[^;]*\\." + "\\w*" + NUTRIENT + "\\b"), why: "把營養欄位 += 進變數" },
  { re: new RegExp("\\.reduce\\([^;]*\\." + NUTRIENT + "\\b"), why: "用 reduce 加總營養欄位" },
  // 營養欄位拿去做加法（字串串接不算：+ 的另一邊是字串字面量；行尾的 + 看不到另一邊，不算）
  { re: new RegExp("\\." + NUTRIENT + "\\)?\\s*\\+(?![+=])(?!\\s*([\"'`]|$))"), why: "營養欄位做加法" },
  { re: new RegExp("(?<![\"'`]\\s*)\\+\\s*\\(?\\s*(?:Number\\()?[\\w$.\\[\\]]+\\." + NUTRIENT + "\\b(?!\\s*\\+\\s*[\"'`])"), why: "加上營養欄位" },
];

// ---------- 小工具 ----------

let failures = 0;
let checks = 0;
function fail(msg) { failures++; console.log("  ✗ " + msg); }
function check(cond, msg) { checks++; if (!cond) fail(msg); }

function walk(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? walk(p) : e.name.endsWith(".js") ? [p] : [];
  });
}

const rel = (p) => path.relative(ROOT, p).split(path.sep).join("/");
const layerOf = (r) => { const m = /^js\/(core|data|engine|ui)\//.exec(r); return m ? m[1] : null; };

// 去掉註解與字串內容（保留換行，行號不變），避免註解裡提到的名稱被誤判
function stripCommentsAndStrings(src) {
  let out = "";
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i], d = src[i + 1];
    if (c === "/" && d === "/") { while (i < n && src[i] !== "\n") i++; continue; }
    if (c === "/" && d === "*") { i += 2; while (i < n && !(src[i] === "*" && src[i + 1] === "/")) { if (src[i] === "\n") out += "\n"; i++; } i += 2; continue; }
    if (c === "/" && /[(,=:[!&|?{};+\-*%<>~^]$|^$|\breturn$|\btypeof$/.test(out.replace(/\s+$/, "").slice(-7))) {
      // regex 字面量：跳到沒被跳脫、不在字元類別裡的 /，再跳過旗標
      out += "/"; i++;
      let inClass = false;
      while (i < n && src[i] !== "\n") {
        if (src[i] === "\\") { i += 2; continue; }
        if (src[i] === "[") inClass = true;
        else if (src[i] === "]") inClass = false;
        else if (src[i] === "/" && !inClass) break;
        i++;
      }
      out += "/"; i++;
      while (i < n && /[a-z]/.test(src[i])) i++;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      const q = c; out += q; i++;
      while (i < n && src[i] !== q) { if (src[i] === "\\") i++; else if (src[i] === "\n") out += "\n"; i++; }
      out += q; i++; continue;
    }
    out += c; i++;
  }
  return out;
}

function lineOf(src, idx) { return src.slice(0, idx).split("\n").length; }

// C4.17 ③（啟發式）：推薦候選池相關檔案不得出現字面量 "dish"、"food"（單雙引號與反引號）與識別字 foodTree。
// 掃原始碼本身、不去掉字串與註解（字面量就是要抓的東西）。回傳 [{ what, line }]。
const RECOMMEND_FILES = ["js/engine/pool.js", "js/engine/recommend.js", "js/engine/today.js", "js/engine/matcher.js"];
function recommendLeaks(src) {
  const out = [];
  const scan = (re, what) => { let m; while ((m = re.exec(src))) out.push({ what: what(m), line: lineOf(src, m.index) }); };
  scan(/(["'`])(dish|food)\1/g, (m) => "字面量 " + m[0]);
  scan(/(?<![\w$])foodTree(?![\w$])/g, () => "識別字 foodTree");
  return out;
}

// ---------- 檢查 ----------

const files = walk(JS).map((p) => {
  const r = rel(p);
  const src = fs.readFileSync(p, "utf8");
  return { path: p, rel: r, layer: layerOf(r), src: src, code: stripCommentsAndStrings(src) };
});

function importsOf(f) {
  const out = [];
  const re = /(?:^|\n)\s*(?:import|export)\s[^;]*?from\s*(["'])([^"']+)\1|import\(\s*(["'])([^"']+)\3\s*\)|(?:^|\n)\s*import\s*(["'])([^"']+)\5/g;
  let m;
  while ((m = re.exec(f.src))) {
    const spec = m[2] || m[4] || m[6];
    const target = spec.startsWith(".") ? rel(path.resolve(path.dirname(f.path), spec)) : spec;
    out.push({ spec: spec, target: target, line: lineOf(f.src, m.index), names: (m[0].match(/\{([^}]*)\}/) || [, ""])[1] });
  }
  return out;
}

console.log("[分層與依賴方向 C1.1–C1.2]");
for (const f of files) {
  check(f.layer !== null, f.rel + " 不在 js/core、js/data、js/engine、js/ui 任何一層");
  if (!f.layer) continue;
  const allowed = { core: [], data: ["core", "data"], engine: ["core", "engine"], ui: ["core", "data", "engine", "ui"] }[f.layer];
  for (const imp of importsOf(f)) {
    if (!imp.spec.startsWith(".")) { fail(f.rel + ":" + imp.line + " import 了非相對路徑「" + imp.spec + "」（不引入外部套件，C3）"); continue; }
    const tl = layerOf(imp.target);
    check(tl !== null && allowed.indexOf(tl) !== -1, f.rel + ":" + imp.line + " 是 " + f.layer + "/，不得 import " + imp.target);
    check(fs.existsSync(path.join(ROOT, imp.target)), f.rel + ":" + imp.line + " import 的檔案不存在：" + imp.target);
  }
}

console.log("[engine、core 不讀時鐘、不碰瀏覽器環境 C1.1]");
// 讀時鐘：Date.now()、new Date()、new Date;、Date()（不帶 new 回傳現在時間字串）、performance.now()
const CLOCK_RE = /Date\.now\b|new\s+Date\s*(\(\s*\)|(?![\s(]))|(?<![\w$.])(?<!new\s+)Date\s*\(|performance\s*\.\s*now/g;
const BROWSER_RE = /(?<![\w$.])(document|window|localStorage|sessionStorage|indexedDB|navigator|location|globalThis)(?![\w$])/g;
for (const f of files.filter((x) => x.layer === "engine" || x.layer === "core")) {
  let m;
  while ((m = CLOCK_RE.exec(f.code))) fail(f.rel + ":" + lineOf(f.code, m.index) + " " + f.layer + "/ 讀了時鐘（" + m[0].trim() + "），今天日期/現在時間要由呼叫端傳入");
  while ((m = BROWSER_RE.exec(f.code))) fail(f.rel + ":" + lineOf(f.code, m.index) + " " + f.layer + "/ 碰了瀏覽器環境（" + m[1] + "），只有 data/ 與 ui/ 可以");
  checks += 2;
}

console.log("[ES modules、不掛 window C1.3]");
for (const f of files) {
  const re = /\b(window|globalThis|self)\s*(\.\s*[\w$]+|\[[^\]]*\])\s*=(?!=)|Object\.(assign|defineProperty|defineProperties)\(\s*(window|globalThis|self)\b/g;
  let m;
  while ((m = re.exec(f.code))) {
    if (f.rel === "js/ui/app.js") continue;
    fail(f.rel + ":" + lineOf(f.code, m.index) + " 把東西掛到 window（只有 js/ui/app.js 可以掛除錯函式）");
  }
  check(!/^\s*\(function\s*\(\)\s*\{/m.test(f.code), f.rel + " 還是 IIFE 包裝，要改成 ES module");
  checks++;
}

console.log("[IndexedDB 與 localStorage C1.4]");
const indexHtml = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
check(!/localforage/i.test(indexHtml) && !files.some((f) => /localforage/.test(f.code)), "還在使用 localforage");
const dbFile = files.find((f) => f.rel === "js/data/db.js");
check(!!dbFile, "缺 js/data/db.js");
if (dbFile) check(/indexedDB\.open\(\s*DB_NAME|indexedDB\.open\(\s*["']lighten2["']/.test(dbFile.src) && /["']lighten2["']/.test(dbFile.src), "js/data/db.js 的資料庫名稱不是 lighten2");
for (const f of files) {
  const re = /\bindexedDB\s*\.\s*open\b/g;
  let m;
  while ((m = re.exec(f.code))) check(f.rel === "js/data/db.js", f.rel + ":" + lineOf(f.code, m.index) + " 直接開 IndexedDB（只能在 js/data/db.js）");
  const ls = /localStorage\s*\.\s*(getItem|setItem|removeItem)\(\s*(["'`])([^"'`]*)/g;
  while ((m = ls.exec(f.src))) check(m[3].startsWith("lighten2."), f.rel + ":" + lineOf(f.src, m.index) + " localStorage key「" + m[3] + "」沒有 lighten2. 前綴");
}

console.log("[import map 版本字串 C1.6]");
const mapMatch = /<script type="importmap">([\s\S]*?)<\/script>/.exec(indexHtml);
check(!!mapMatch, "index.html 沒有 import map");
let mapVersion = null;
if (mapMatch) {
  let map = null;
  try { map = JSON.parse(mapMatch[1]).imports || {}; } catch (e) { fail("index.html 的 import map 不是合法 JSON：" + e.message); }
  if (map) {
    const versions = new Set();
    const listed = new Set();
    Object.keys(map).forEach((k) => {
      const m = /^\.\/(js\/.+\.js)$/.exec(k);
      check(!!m, "import map 的 key「" + k + "」不是 ./js/…js");
      if (!m) return;
      listed.add(m[1]);
      const v = /^\.\/(js\/.+\.js)\?v=([\w.-]+)$/.exec(map[k]);
      check(!!v && v[1] === m[1], "import map「" + k + "」的值「" + map[k] + "」不是同一個檔案加 ?v=版本");
      if (v) versions.add(v[2]);
    });
    check(versions.size === 1, "import map 裡有 " + versions.size + " 種版本字串（要全部一樣，改用 node tools/stamp-version.js 產生）");
    mapVersion = versions.size === 1 ? [...versions][0] : null;
    files.forEach((f) => check(listed.has(f.rel), "import map 沒有列 " + f.rel + "（跑 node tools/stamp-version.js）"));
    listed.forEach((r) => check(fs.existsSync(path.join(ROOT, r)), "import map 列了不存在的 " + r));
    const entry = /<script type="module" src="(js\/[^"?]+)\?v=([\w.-]+)"><\/script>/.exec(indexHtml);
    check(!!entry, "index.html 缺 <script type=\"module\" src=\"js/…?v=版本\"> 進入點");
    if (entry && mapVersion) check(entry[2] === mapVersion, "進入點的版本字串跟 import map 不一致");
  }
}

// 這次改到 js/、css/、data/ 時，提交的 index.html 版本字串要換（比對要提交的版本，不是工作區）
const baseIdx = args.indexOf("--base");
const staged = args.indexOf("--staged") !== -1;
if ((staged || baseIdx !== -1) && mapVersion) {
  const git = (cmd) => execSync("git " + cmd, { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  let changed = [], oldHtml = null, newHtml = indexHtml;
  try {
    if (staged) {
      changed = git("diff --cached --name-only").split("\n").filter(Boolean);
      oldHtml = git("show HEAD:index.html");
      newHtml = git("show :index.html"); // 暫存區：版本字串改了但沒 git add 也要擋
    } else {
      const base = args[baseIdx + 1];
      changed = git("diff --name-only " + base + " HEAD").split("\n").filter(Boolean);
      oldHtml = git("show " + base + ":index.html");
    }
  } catch (e) { oldHtml = null; }
  if (oldHtml && changed.some((c) => /^(js|css|data)\//.test(c))) {
    const old = /\.js\?v=([\w.-]+)"/.exec(oldHtml);
    const cur = /\.js\?v=([\w.-]+)"/.exec(newHtml);
    check(!old || (cur && old[1] !== cur[1]),
      "這次改到 js/、css/ 或 data/，但要提交的 index.html 版本字串沒換（跑 node tools/stamp-version.js 再 git add index.html）");
  }
}

console.log("[單一真相來源：重複的頂層名稱 C2]");
const defined = {};
for (const f of files) {
  const re = /^(?:export\s+)?(?:async\s+)?(?:function\s*\*?\s*([\w$]+)|(?:const|let|var|class)\s+([\w$]+))/gm;
  let m;
  while ((m = re.exec(f.code))) {
    const name = m[1] || m[2];
    if (DUP_NAME_ALLOW.has(name)) continue;
    (defined[name] = defined[name] || []).push(f.rel + ":" + lineOf(f.code, m.index));
  }
}
Object.keys(defined).sort().forEach((name) => {
  const where = defined[name];
  const inFiles = new Set(where.map((w) => w.split(":")[0]));
  check(inFiles.size === 1, "「" + name + "」在 " + inFiles.size + " 個檔案各定義一份：" + where.join("、") + "（放到唯一位置再 import）");
});

// 啟發式檢查，不是完整證明（例：.map(x => x.kcal).reduce((s, v) => s + v) 就繞得過）
console.log("[ui 不自己加總營養 C4.11]");
for (const f of files.filter((x) => x.layer === "ui")) {
  f.code.split("\n").forEach((line, i) => {
    UI_SUM_PATTERNS.forEach((p) => {
      checks++;
      if (p.re.test(line)) fail(f.rel + ":" + (i + 1) + " " + p.why + "，要改用 engine/meal-content.js：" + line.trim().slice(0, 100));
    });
  });
}

console.log("[運動與飲食脫鉤 C4.12]");
// 一段原始碼裡出現哪些受限名稱（整個字；純函式，工具自我檢查也用）
function nameHits(code, names) {
  const out = [];
  names.forEach((nm) => {
    const re = new RegExp("\\b" + nm + "\\b", "g");
    let m;
    while ((m = re.exec(code))) out.push({ name: nm, index: m.index });
  });
  return out;
}

function restrictNames(names, allowFiles, label) {
  for (const f of files) {
    if (allowFiles.some((re) => re.test(f.rel))) continue;
    nameHits(f.code, names).forEach((h) => fail(f.rel + ":" + lineOf(f.code, h.index) + " 使用了 " + h.name + "（" + label + "）"));
    checks += names.length;
  }
}
restrictNames(EXERCISE_READERS, EXERCISE_FILES, "只有運動分頁、db.js 與備份匯出匯入可以讀運動紀錄");
for (const f of files.filter((x) => x.layer === "engine")) check(!/exercise/i.test(f.code), f.rel + " engine 出現 exercise（運動與飲食脫鉤）");

console.log("[不評判的禁用字 C4.13]");
for (const f of files.filter((x) => x.layer === "ui")) {
  BANNED_WORDS.forEach((w) => {
    checks++;
    const i = f.src.indexOf(w);
    if (i !== -1) fail(f.rel + ":" + lineOf(f.src, i) + " 出現禁用字「" + w + "」");
  });
}
BANNED_WORDS.forEach((w) => check(indexHtml.indexOf(w) === -1, "index.html 出現禁用字「" + w + "」"));

// 啟發式檢查，不是完整證明（例如用字串拼出欄位名就繞得過）；目的是擋住順手寫出來的違規
console.log("[鈉不參與評分 C4.14]");
// 顯示欄位（飽和脂肪、鈉）只在 engine/meal-content.js 裡處理；其他 engine 模組只能把 displayFields(...) 的結果
// 原封不動併進輸出物件（Object.assign 的後段參數），不能讀出來比較或評分（−1b 驗收審核）。
// 寫法限制：displayFields(...) 要跟 Object.assign( 寫在同一行（或放在以「},」開頭的行），多行拆開會被誤擋。
for (const f of files.filter((x) => x.layer === "engine" && !/meal-content\.js$/.test(x.rel))) {
  f.code.split("\n").forEach((line, i) => {
    checks++;
    const m = /sodium|sat_fat|DISPLAY_FIELDS|sumDisplayLogTotals/.exec(line);
    if (m) fail(f.rel + ":" + (i + 1) + " 出現「" + m[0] + "」：顯示欄位只在 meal-content.js 處理，推薦與評分不能讀（C4.14）");
    checks++;
    if (/displayFields\(/.test(line) && !/(Object\.assign\([^;]*,\s*|^\s*},\s*)displayFields\((?:[^()]|\([^()]*\))*\)\s*[,)]/.test(line)) {
      fail(f.rel + ":" + (i + 1) + " displayFields(...) 只能當 Object.assign 的參數併進輸出（C4.14）：" + line.trim().slice(0, 100));
    }
  });
}

console.log("[picker_last_meal_type 只給自己選 C4.15]");
for (const f of files) {
  if (PICKER_LAST_FILES.some((re) => re.test(f.rel))) continue;
  checks++;
  if (f.src.indexOf("picker_last_meal_type") !== -1) fail(f.rel + " 出現 picker_last_meal_type（只有 db.js 與自己選選擇器可以用）");
}

console.log("[我的組合只供手動引用 C4.16]");
restrictNames(SAVED_MEAL_READERS, SAVED_MEAL_READER_FILES, "我的組合只供選擇器、管理區、日曆、備份讀取");

console.log("[常吃清單只用來排序與加分 C4.17 ②]");
for (const f of files) {
  if (FAVORITE_KEY_FILES.some((re) => re.test(f.rel))) continue;
  checks++;
  const i = f.src.indexOf("favorite_refs");
  if (i !== -1) fail(f.rel + ":" + lineOf(f.src, i) + " 出現 favorite_refs（常吃清單只能經 db.js 的專用函式讀寫，C4.17 ②）");
}
restrictNames(["getFavoriteRefs"], FAVORITE_READER_FILES, "常吃清單只准選擇器、我的食物、今日建議讀取，C4.17 ②");
for (const f of files.filter((x) => x.layer === "engine" && !FAVORITE_PARAM_ENGINE_FILES.some((re) => re.test(x.rel)))) {
  checks++;
  nameHits(f.code, ["favoriteRefs"]).forEach((h) => fail(f.rel + ":" + lineOf(f.code, h.index) + " 出現 favoriteRefs（engine 只准 picker.js 排序分組、today.js 傳遞、recommend.js 加分，C4.17 ②）"));
}

console.log("[推薦不讀單品、料理與分層資料 C4.17 ③]");
for (const r of RECOMMEND_FILES) {
  const f = files.find((x) => x.rel === r);
  check(!!f, r + " 不存在（C4.17 ③ 的檔案清單要跟著改）");
  if (f) recommendLeaks(f.src).forEach((h) => fail(r + ":" + h.line + " 出現 " + h.what + "（推薦不產生單品與料理、候選池不讀分層資料，章程 C4.17 ③）"));
}

console.log("[工具自我檢查]");
// C4.17 ②：白名單與名稱比對要擋得住、也不能誤報
check(!FAVORITE_READER_FILES.some((re) => re.test("js/ui/today-hero.js")) && !FAVORITE_READER_FILES.some((re) => re.test("js/engine/recommend.js")) &&
  FAVORITE_READER_FILES.some((re) => re.test("js/ui/meal-picker/index.js")) && FAVORITE_READER_FILES.some((re) => re.test("js/ui/tab-foods.js")) &&
  !FAVORITE_READER_FILES.some((re) => re.test("js/ui/foods/list.js")), "C4.17 ② getFavoriteRefs 白名單不對");
check(!FAVORITE_PARAM_ENGINE_FILES.some((re) => re.test("js/engine/pool.js")) && FAVORITE_PARAM_ENGINE_FILES.some((re) => re.test("js/engine/picker.js")), "C4.17 ② favoriteRefs 檔案清單不對");
[["f(favoriteRefs)", 1], ["const { favoriteRefs } = o;", 1], ["const favoriteRefsX = 1; myfavoriteRefs();", 0]].forEach(([src, n]) => {
  check(nameHits(stripCommentsAndStrings(src), ["favoriteRefs"]).length === n, "C4.17 ② favoriteRefs 對「" + src + "」應找到 " + n + " 處");
});
// 規則本身要擋得住刻意寫壞的原始碼，也不能誤報相近的寫法
[["if (c.kind === \"food\") {}", 1], ["const k = 'dish';", 1], ["const k = `food`;", 1], ["const t = catalog.foodTree;", 1],
  ["const { foodTree } = catalog;", 1], ["x = \"foods\" + 'dishes';", 0], ["const foodTreeX = 1; myfoodTree();", 0],
  ["// 註解裡的 \"food\" 也算（不去掉字串與註解）", 1]].forEach(([src, n]) => {
  check(recommendLeaks(src).length === n, "C4.17 ③ 規則對「" + src + "」應找到 " + n + " 處，實際 " + recommendLeaks(src).length);
});
// C4.16：今日建議只能用組合的寫入函式（入口 2），不能讀；白名單只放選擇器、管理區、備份、db
[["const all = await listSavedMeals();", 1], ["import { getSavedMeal, addSavedMeal } from './db.js';", 1], ["await addSavedMeal(rec); updateSavedMeal(id, p);", 0],
  ["mylistSavedMealsX()", 0]].forEach(([src, n]) => {
  check(nameHits(src, SAVED_MEAL_READERS).length === n, "C4.16 讀取函式規則對「" + src + "」應找到 " + n + " 處，實際 " + nameHits(src, SAVED_MEAL_READERS).length);
});
check(!SAVED_MEAL_READER_FILES.some((re) => re.test("js/ui/tab-today.js")) && !SAVED_MEAL_READER_FILES.some((re) => re.test("js/ui/tab-foods.js")) &&
  !SAVED_MEAL_READER_FILES.some((re) => re.test("js/engine/meal-content.js")) && SAVED_MEAL_READER_FILES.some((re) => re.test("js/ui/foods/saved-meals.js")),
  "C4.16 白名單：今日建議、我的食物分頁本身、engine 不能讀組合，管理區可以");

console.log("\n" + (failures === 0 ? "全部通過" : failures + " 項失敗") + "（共 " + checks + " 項檢查）");
process.exit(failures === 0 ? 0 : 1);
