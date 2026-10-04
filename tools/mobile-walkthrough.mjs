// 輕盈計畫 — 手機實機腳本的自動版：無頭 Edge/Chrome 模擬手機（390×844、觸控），照 docs/手機實機腳本.md 逐步操作、檢查、截圖。
// 用法：node tools/mobile-walkthrough.mjs              （全部通過 exit 0；截圖路徑印在最後）
//       WALKTHROUGH_OUT=某資料夾 node tools/mobile-walkthrough.mjs
// 每一步另外自動檢查版面：不能左右溢出、不能出現時段插畫以外的圖；按鈕高度不到 44px 的列成警告。
// 截圖給實作者逐張看過再交給使用者；使用者的手機測試只剩自動測不到的部分（真的手機快取、手感、看不看得懂），
// 見 docs/手機實機腳本.md 開頭。約 1 分鐘，Phase 驗收與改到畫面流程時跑。

import { join } from "node:path";
import { tmpdir } from "node:os";
import { rmSync } from "node:fs";
import { startHarness } from "./lib/browser-harness.mjs";

const OUT = process.env.WALKTHROUGH_OUT || join(tmpdir(), "lighten-walkthrough");
try { rmSync(OUT, { recursive: true, force: true }); } catch (e) { /* 第一次跑 */ }

const H = await startHarness({ mobile: { width: 390, height: 844, deviceScaleFactor: 2 } });
const { send, js, until, check, fail, text } = H;
const warnings = [];
let shotNo = 0;

// 版面檢查＋截圖。scrollTo：截圖前捲到這個元素
async function shot(name, scrollTo) {
  if (scrollTo) await js(`(() => { const el = document.querySelector(${JSON.stringify(scrollTo)}); if (el) el.scrollIntoView({ block: "start" }); })()`);
  await new Promise((r) => setTimeout(r, 250));
  const label = String(++shotNo).padStart(2, "0") + "-" + name;
  const layout = await js(`(() => {
    const W = window.innerWidth;
    const visible = (el) => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el);
      return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none" && !el.closest("[hidden]"); };
    const overflow = [...document.querySelectorAll("body *")].filter((el) => visible(el) && el.getBoundingClientRect().right > W + 1
      && getComputedStyle(el).position !== "fixed" && !el.closest(".tab-bar, .tabs, nav"))
      .slice(0, 5).map((el) => el.tagName.toLowerCase() + (el.id ? "#" + el.id : "") + (el.className && typeof el.className === "string" ? "." + el.className.split(" ")[0] : ""));
    const imgs = [...document.querySelectorAll("img")].filter(visible).map((i) => i.getAttribute("src"));
    const small = [...document.querySelectorAll("button, select, input:not([type=checkbox]):not([type=radio]):not([type=hidden])")]
      .filter((el) => visible(el) && el.getBoundingClientRect().height < 44)
      .map((el) => (el.id ? "#" + el.id : el.className ? "." + String(el.className).split(" ")[0] : el.tagName.toLowerCase()) + "(" + Math.round(el.getBoundingClientRect().height) + "px)");
    // 勾選框的觸控區是包住它的整個標籤（「存成組合」，工作線 C），量標籤的高度
    const hitBox = (el) => (el.type === "checkbox" && el.closest("label") ? el.closest("label") : el);
    const smallInPicker = [...document.querySelectorAll("#meal-picker-overlay button, #meal-picker-overlay summary, #meal-picker-overlay input:not([type=hidden])")]
      .filter((el) => visible(el) && hitBox(el).getBoundingClientRect().height < 44)
      .map((el) => (el.id ? "#" + el.id : el.className ? "." + String(el.className).split(" ")[0] : el.tagName.toLowerCase()) + "(" + Math.round(el.getBoundingClientRect().height) + "px)");
    return { scrollW: document.documentElement.scrollWidth, W: W, overflow: overflow, imgs: imgs, small: [...new Set(small)], smallInPicker: [...new Set(smallInPicker)] };
  })()`);
  check(layout.scrollW <= layout.W + 1, label + "：畫面左右溢出（寬 " + layout.scrollW + " > " + layout.W + "）" + layout.overflow.join(", "));
  const badImgs = layout.imgs.filter((s) => !/^images\/gemini\/meal-default-[a-z_-]+\.jpg$/.test(s || ""));
  check(badImgs.length === 0, label + "：出現時段插畫以外的圖（decisions #8）：" + badImgs.join(", "));
  if (layout.small.length) warnings.push(label + "：按鈕高度不到 44px " + layout.small.join(" "));
  check(layout.smallInPicker.length === 0, label + "：選擇器裡的按鈕高度不到 44px（Phase 0 起算失敗）" + layout.smallInPicker.join(" "));
  await H.screenshot(OUT, label);
}

const click = (sel) => js(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); if (!el) throw new Error("找不到 " + ${JSON.stringify(sel)}); el.scrollIntoView({ block: "center" }); el.click(); })()`);
const tab = (name) => click(`.tab-btn[data-tab=${name}]`);
const setField = (name, value) => js(`(() => { const f = document.getElementById('profile-form'); const el = f.elements[${JSON.stringify(name)}];
  if (el.type === 'checkbox') el.checked = ${JSON.stringify(value)}; else el.value = ${JSON.stringify(value)}; el.dispatchEvent(new Event('change', { bubbles: true })); })()`);
const setAllergens = (list) => js(`document.querySelectorAll('input[name=allergens]').forEach((c) => { c.checked = ${JSON.stringify(list)}.indexOf(c.value) !== -1; })`);
const submitProfile = () => js(`document.getElementById('profile-form').requestSubmit()`);
const recText = (slot) => js(text("#rec-" + slot));
const openPicker = async (slot) => {
  await tab("today");
  await until(`!!document.querySelector('#rec-${slot} .rec-pick-btn')`, slot + " 沒有「自己選」按鈕");
  await click(`#rec-${slot} .rec-pick-btn`);
  await until(`!document.getElementById('meal-picker-overlay').hidden && document.getElementById('meal-picker-panel').innerHTML !== ''`, slot + " 的自己選沒有打開");
};
const closePicker = () => click("#meal-picker-cancel");
const currentTab = () => js(`(document.querySelector('#meal-picker-tabs [aria-selected=true]') || {}).dataset.tab`);
// 目前分頁可選的品項中，某個角色的 uid（照畫面順序）
const passUids = (role) => js(`(async () => { const m = await import('./js/data/catalog.js'); const c = await m.loadCatalog();
  return [...document.querySelectorAll('#meal-picker-panel .item-card:not([disabled])')].map((b) => b.dataset.uid)
    .filter((u) => (c.productsByUid[u] || {}).role === ${JSON.stringify(role)}); })()`);
// 自煮分頁：點某個軸的選項（沒給 id 就點第一個可選、還沒選的）；cookFill 依序點有的軸（沒有主食槽的餐型不點主食）
const cookPick = (axis, id) => click(`#meal-picker-panel .compose-option[data-axis=${axis}]${id ? `[data-id=${id}]` : ":not([disabled]):not(.selected)"}`);
const cookFill = async (axes) => { for (const ax of axes) {
  if (await js(`!!document.querySelector('#meal-picker-panel .compose-option[data-axis=${ax}]:not([disabled]):not(.selected)')`)) await cookPick(ax);
} };
// 快速新增表單：填名稱與熱量（觸發 input 事件，預告會跟著更新）
const fillQuickAdd = (name, kcal) => js(`(() => {
  const set = (sel, v) => { const el = document.querySelector('#quick-add-form ' + sel); el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); };
  set('[data-qa=name]', ${JSON.stringify(name)}); set('[data-qa=kcal]', ${JSON.stringify(kcal)}); })()`);
// 步驟編號只數看得到的步驟，要從 1 連續（截圖曾看到「1.」後跳「4.」）
const checkStepNumbers = async (label) => {
  const nums = await js(`[...document.querySelectorAll('#meal-picker-overlay .meal-picker-step-label')].filter((el) => el.offsetParent !== null).map((el) => parseInt(el.textContent, 10))`);
  check(nums.length > 0 && nums.every((n, i) => n === i + 1), label + " 步驟編號不連續：" + nums.join(","));
};
// 「我的食物」分頁（工作線 D 切片 2）：依名稱找一列、點開、在列裡按按鈕；切子分頁；搜尋
const foodRow = (name) => `[...document.querySelectorAll('#foods-body .food-row')].find((r) => { const n = r.querySelector('.food-name'); return n && n.textContent === ${JSON.stringify(name)}; })`;
const foodRowText = (name) => js(`(() => { const r = ${foodRow(name)}; return r ? r.innerText : null; })()`);
const inFoodRow = (name, sel) => js(`(() => { const r = ${foodRow(name)}; const b = r && r.querySelector(${JSON.stringify(sel)}); if (!b) throw new Error("「" + ${JSON.stringify(name)} + "」找不到 " + ${JSON.stringify(sel)}); b.scrollIntoView({ block: "center" }); b.click(); })()`);
const openFood = (name) => inFoodRow(name, ".food-row-main");
// 我的食物重讀完才點子分頁（#foods-body 的 data-loading，切片 8b-2；之前 8-5 偶發點到舊畫面）
const foodsSub = async (t) => { await until(`!document.querySelector("#foods-body[data-loading]")`, "我的食物沒有載完"); await click(`[data-foods-subtab=${t}]`); };
const foodsSearch = (q) => js(`(() => { const el = document.getElementById('foods-search'); el.value = ${JSON.stringify(q)}; el.dispatchEvent(new Event('input', { bubbles: true })); })()`);
const openFolded = () => js(`document.querySelectorAll('#foods-body details').forEach((d) => { d.open = true; })`);
// 代換表分層（工作線 D 切片 4）：點 summary 展開大類、子類（不直接設 open，審核 M3），等內容畫出來
const sectionSel = (key) => `#foods-body details[data-foods-section="${key}"]`;
async function openSection(key) {
  if (await js(`!!document.querySelector('${sectionSel(key)}[open]')`)) return;
  await click(`${sectionSel(key)} > summary`);
  await until(`!!document.querySelector('${sectionSel(key)}[open] .food-row, ${sectionSel(key)}[open] details')`, "展開 " + key + " 沒有內容");
}
// 展開分層品項所在的大類、子類，回傳畫面名稱。prefix：cook 或 drinks
async function showTreeItem(prefix, id) {
  const t = await js(`(async () => { const c = await (await import('./js/data/catalog.js')).loadCatalog(); const it = c.foodTree.byId[${JSON.stringify(id)}]; return { name: it.name, group: it.group, subgroup: it.subgroup }; })()`);
  await openSection(prefix + ":" + t.group);
  if (t.subgroup) await openSection(prefix + ":" + t.group + ":" + t.subgroup);
  return t.name;
}
const inViewport = (sel) => js(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); if (!el) return false; const r = el.getBoundingClientRect(); return r.top >= -1 && r.bottom <= window.innerHeight + 1; })()`);
const dbDislikedKeys = `import('./js/data/db.js').then((m) => m.getProfile()).then((p) => JSON.stringify(((p || {}).disliked_ingredients || []).map((d) => d.key)))`;
const navFits = () => js(`(() => { const n = document.querySelector('.tab-nav'); return n.scrollWidth <= n.clientWidth + 1; })()`);

// 推薦卡片是整塊重畫的：切分頁前放一個標記，標記消失＝重算完成，才不會讀到舊卡片
const markStale = () => js(`document.querySelectorAll('[id^=rec-]').forEach((el) => el.insertAdjacentHTML('beforeend', '<i class="walkthrough-stale"></i>'))`);
const waitFresh = (label) => until(`!document.querySelector('.walkthrough-stale') && !!document.querySelector('#rec-dinner .rec-log-btn')`, label);

async function run() {
  // ---------- 0. 開啟 ----------
  console.log("[0. 開啟]");
  await send("Page.navigate", { url: H.url });
  await until(`${text("#today-status")}.indexOf("基本資料") !== -1`, "0-1 沒有基本資料時，今日建議沒有提示先填基本資料");
  check((await js(`[...document.querySelectorAll('.tab-btn')].map(b => b.innerText.trim().replace(/\s+/g, '')).join('/')`)) === "基本資料/今日建議/我的食物/本週總覽/運動紀錄",
    "0-1 上方分頁不是 基本資料／今日建議／我的食物／本週總覽／運動紀錄（decisions #96）");
  check(await navFits(), "0-1 分頁列在 390 寬要橫向捲動");
  await shot("開啟");
  // 0-1 360 寬（較小的手機）：分頁列仍然不橫捲，截圖定案（計畫 S12）
  await send("Emulation.setDeviceMetricsOverride", { width: 360, height: 780, deviceScaleFactor: 2, mobile: true });
  await new Promise((r) => setTimeout(r, 300));
  check(await navFits(), "0-1 分頁列在 360 寬要橫向捲動");
  await shot("開啟-360寬");
  await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await new Promise((r) => setTimeout(r, 300));
  // 0-2 還沒填基本資料：「我的食物」可以看、明細打得開，「不吃」停用並說明（PRD 13.5）
  await tab("foods");
  await until(`!!document.querySelector('#foods-body .food-row-main')`, "0-2 我的食物沒有品項");
  await click("#foods-body .food-row-main");
  await until(`!!document.querySelector('#foods-body [data-foods-dislike]')`, "0-2 明細沒有「不吃」按鈕");
  check(await js(`document.querySelector('#foods-body [data-foods-dislike]').disabled`), "0-2 沒有基本資料時「不吃」沒有停用");
  check((await js(text("#foods-body .food-detail"))).indexOf("先在基本資料填好身體數據並按計算") !== -1, "0-2 停用的「不吃」旁邊沒有說明");
  check(await js(`(document.querySelector('#foods-body [data-foods-favorite]') || {}).disabled === true`), "0-2 沒有基本資料時「常吃」沒有停用（切片 5）");
  await shot("我的食物-沒有基本資料", "#foods-body .food-detail");
  // 自煮的分層品項也一樣停用（切片 4）
  await foodsSub("cook");
  await openSection("cook:dairy");
  await click(`${sectionSel("cook:dairy")} .food-row-main`);
  await until(`!!document.querySelector('${sectionSel("cook:dairy")} [data-foods-dislike]')`, "0-2 自煮明細沒有「不吃」按鈕");
  check(await js(`document.querySelector('${sectionSel("cook:dairy")} [data-foods-dislike]').disabled`), "0-2 沒有基本資料時自煮的「不吃」沒有停用");
  await click(`${sectionSel("cook:dairy")} > summary`); // 收回去，8-7 要看預設收合
  await foodsSub("convenience");

  // ---------- 1. 基本資料 ----------
  console.log("[1. 基本資料]");
  await tab("profile");
  await shot("基本資料-空白");
  await js(`(() => { const f = document.getElementById('profile-form');
    f.elements.age.value = 35; f.elements.gender.value = '男'; f.elements.height_cm.value = 175; f.elements.weight_kg.value = 80;
    f.elements.activity_mode.value = '輕度'; f.elements.goal_mode.value = '減脂'; })()`);
  await submitProfile();
  await until(`${text("#target-kcal")} === "1896.1"`, "1-1 按計算後目標熱量不是 1896.1");
  await until(`["公式目標", "校正", "目前每日目標"].every((w) => ${text("#calibration-body")}.indexOf(w) !== -1)`, "1-1 校正卡片沒有「公式目標／校正值／目前每日目標」");
  await shot("基本資料-計算結果", "#targets-result");
  const allergenValues = await js(`[...document.querySelectorAll('input[name=allergens]')].map((c) => c.value)`);
  check(allergenValues.length === 11 && ["軟體動物", "花生", "芒果"].every((a) => allergenValues.indexOf(a) !== -1),
    "1-4 過敏原勾選框不是 11 個或缺軟體動物／花生／芒果：" + allergenValues.join(","));
  check((await js(`[...document.querySelector('select[name=diet_restriction]').options].every((o) => o.value !== '低碳')`)), "1-4 飲食型態下拉不該有低碳");
  check((await js(`!!document.querySelector('input[name=low_carb]') && !!document.querySelector('select[name=oil_habit]')`)), "1-4 缺低碳勾選框或用油習慣下拉");
  // 1-4 設定按「計算」後重新整理還在
  await setField("low_carb", true);
  await setField("oil_habit", "less");
  await submitProfile();
  await until(`${text("#target-kcal")} === "1896.1"`, "1-4 改設定後按計算沒有完成");
  await send("Page.reload");
  await until(`document.querySelector('select[name=oil_habit]') && document.querySelector('select[name=oil_habit]').value === 'less' && document.querySelector('input[name=low_carb]').checked`,
    "1-4 低碳、少油按計算後重新整理不見了");
  await shot("基本資料-設定還在", "select[name=diet_restriction]");
  await setField("low_carb", false);
  await setField("oil_habit", "normal");
  await submitProfile();
  await until(`${text("#target-kcal")} === "1896.1"`, "1-4 還原設定後按計算沒有完成");
  // 1-3 體重回填
  await js(`(() => { const f = document.getElementById('weight-form'); f.elements.weight_kg.value = 79.8; f.requestSubmit(); })()`);
  await until(`${text("#weight-log-status")}.indexOf("79.8") !== -1`, "1-3 體重回填沒有顯示已記錄");
  await shot("基本資料-體重回填", "#weight-form");

  // ---------- 2. 今日建議 ----------
  console.log("[2. 今日建議]");
  await tab("today");
  await until(`!!document.querySelector('#rec-breakfast .rec-log-btn') && !!document.querySelector('#rec-dinner .rec-log-btn')`, "2-1 早餐／晚餐沒有推薦卡片");
  check((await recText("afternoon_tea")).indexOf("不需要這個時段") !== -1, "2-1 下午茶（預設關閉）沒有顯示「已設定不需要這個時段的建議」");
  check((await js(text("#today-hero-kcal-value"))) === "1896", "2-1 彙總卡建議熱量不是 1896");
  await shot("今日建議");
  await shot("今日建議-晚餐卡片", "#rec-dinner");
  // 2-8 自煮卡片含用油（晚餐預設正常煮）
  const dinnerCard = await recText("dinner");
  check(/含用油約 \d+g/.test(dinnerCard) || /氣炸|免開火|微波/.test(await js(`(window.__lastDinner = document.querySelector('#rec-dinner .rec-name').innerText)`)),
    "2-8 自煮推薦卡片的基準熱量後面沒有「含用油約 Ng」：" + dinnerCard.slice(0, 80));
  // 2-6 切到別的分頁再切回來，推薦不變（decisions #39）
  const before = await js(`[...document.querySelectorAll('.rec-name')].map((e) => e.innerText).join('|')`);
  await tab("week");
  await tab("today");
  await until(`[...document.querySelectorAll('.rec-name')].map((e) => e.innerText).join('|') === ${JSON.stringify(before)}`, "2-6 切分頁回來推薦整批換掉");
  // 2-2、2-7 記錄早餐：hero 變、午晚餐推薦不變
  const lunchDinnerBefore = await js(`['lunch', 'dinner'].map((s) => document.querySelector('#rec-' + s + ' .rec-name').innerText).join('|')`);
  const breakfastName = await js(`document.querySelector('#rec-breakfast .rec-name').innerText`);
  await click("#rec-breakfast .rec-log-btn");
  await until(`${text("#rec-breakfast")}.indexOf("已記錄") !== -1 && !!document.querySelector('#rec-breakfast .rec-undo-btn')`, "2-2 記錄這餐後早餐沒有變成「已記錄＋撤銷」");
  check((await js(text("#today-hero-kcal-value"))) !== "1896", "2-2 記錄早餐後彙總卡熱量沒變");
  check((await js(`['lunch', 'dinner'].map((s) => document.querySelector('#rec-' + s + ' .rec-name').innerText).join('|')`)) === lunchDinnerBefore, "2-7 記錄早餐後午晚餐推薦變了");
  const bfItems = breakfastName.split(/\s*[＋+]\s*/);
  check(!bfItems.some((n) => lunchDinnerBefore.indexOf(n) !== -1), "2-7 午晚餐出現早餐吃過的品項：" + breakfastName);
  await shot("今日建議-已記錄早餐");
  // 2-3 撤銷
  await click("#rec-breakfast .rec-undo-btn");
  await until(`!!document.querySelector('#rec-breakfast .rec-log-btn')`, "2-3 撤銷後早餐沒有回到推薦卡片");
  // 2-4 倒讚換推薦
  const lunchName = await js(`document.querySelector('#rec-lunch .rec-name').innerText`);
  await click("#rec-lunch .dislike-btn");
  await until(`document.querySelector('#rec-lunch .rec-name') && document.querySelector('#rec-lunch .rec-name').innerText !== ${JSON.stringify(lunchName)}`, "2-4 倒讚後午餐沒有換推薦");
  // 2-5 「順便不要」晶片：從推薦消失、提示去「我的食物」取消；基本資料按計算不會蓋掉（decisions #99）；在全部清單取消
  const chip = await js(`(() => { const c = document.querySelector('#rec-dinner .dislike-chip'); return c ? { key: c.dataset.key, label: c.dataset.label } : null; })()`);
  check(!!chip, "2-5 晚餐卡片沒有「順便不要」晶片");
  if (chip) {
    await click(`#rec-dinner .dislike-chip[data-key="${chip.key}"]`);
    await until(`!document.querySelector('#rec-dinner .dislike-chip[data-key="${chip.key}"]')`, "2-5 按「順便不要」後 " + chip.label + " 還在晚餐推薦裡");
    check((await js(text("#today-status"))).indexOf("可以在「我的食物」取消") !== -1, "2-5 按「順便不要」後沒有提示去「我的食物」取消");
    await shot("今日建議-順便不要之後", "#rec-dinner");
    // 接著在基本資料按「計算」：不能把剛加的不吃項目蓋掉
    await tab("profile");
    await submitProfile();
    await until(`${text("#target-kcal")} === "1896.1"`, "2-5 按計算沒有完成");
    check(JSON.parse(await js(dbDislikedKeys)).indexOf(chip.key) !== -1, "2-5 在基本資料按「計算」把剛加的不吃項目 " + chip.label + " 蓋掉了");
    check(!(await js(`!!document.getElementById('disliked-ingredients-list')`)), "2-5 基本資料還有「不吃的食材」區塊（已搬到我的食物）");
    await tab("foods");
    await until(`!!document.querySelector('.foods-disliked-all [data-foods-undislike="${chip.key}"]')`, "2-5 我的食物的全部清單沒有 " + chip.label);
    // 切片 4：共用內建 id 的食材也在自煮的「你標了不吃」（審核第 6 節第 1 點）
    const chipTree = await js(`(async () => { const c = await (await import('./js/data/catalog.js')).loadCatalog(); const it = c.foodTree.byId[${JSON.stringify(chip.key)}]; return it ? it.name : null; })()`);
    if (chipTree) {
      await foodsSub("cook");
      await until(`!!document.querySelector('#foods-body details[data-foods-section="cook:disliked"]') && document.querySelector('#foods-body details[data-foods-section="cook:disliked"]').textContent.indexOf(${JSON.stringify(chipTree)}) !== -1`,
        "2-5 自煮的「你標了不吃」沒有 " + chipTree);
    }
    await js(`document.querySelector('.foods-disliked-all').open = true`);
    await shot("我的食物-不吃的全部", ".foods-disliked-all");
    await click(`.foods-disliked-all [data-foods-undislike="${chip.key}"]`); // 還原，後面的步驟才有完整候選
    await until(`(${dbDislikedKeys}).then((s) => JSON.parse(s).indexOf(${JSON.stringify(chip.key)}) === -1)`, "2-5 在全部清單取消後資料庫還有 " + chip.label);
    await markStale();
    await tab("today");
  }
  // 2-8 少油：用油克數減半
  await waitFresh("2-8 晚餐推薦沒有重算");
  const oilNormal = await js(`(() => { const m = document.querySelector('#rec-dinner').innerText.match(/含用油約 (\\d+)g/); return m ? Number(m[1]) : null; })()`);
  await tab("profile");
  await setField("oil_habit", "less");
  await submitProfile();
  await until(`${text("#target-kcal")} === "1896.1"`, "2-8 改少油後按計算沒有完成");
  await markStale();
  await tab("today");
  await waitFresh("2-8 少油後晚餐推薦沒有重算");
  const oilLess = await js(`(() => { const m = document.querySelector('#rec-dinner').innerText.match(/含用油約 (\\d+)g/); return m ? Number(m[1]) : null; })()`);
  if (oilNormal != null && oilLess != null) check(oilLess * 2 === oilNormal || oilLess < oilNormal, "2-8 少油後晚餐用油沒有減少（" + oilNormal + "g → " + oilLess + "g）");
  else warnings.push("2-8 晚餐推薦剛好不是煎/炒（一般 " + oilNormal + "g、少油 " + oilLess + "g），少油減半只能由 check-engine 斷言保證");
  await tab("profile");
  await setField("oil_habit", "normal");
  await submitProfile();
  await until(`${text("#target-kcal")} === "1896.1"`, "2-8 還原用油後按計算沒有完成");
  await tab("today");
  // 2-9 營養素明細：鈉中性顯示
  await until(`!!document.querySelector('#rec-breakfast .rec-log-btn')`, "2-9 早餐推薦沒有出現");
  await click("#rec-breakfast .rec-log-btn");
  await until(`!document.getElementById('today-hero-nutrition').hidden`, "2-9 記錄一餐後沒有「營養素明細」");
  await js(`document.getElementById('today-hero-nutrition').open = true`);
  await until(`/鈉 (約 \\d+ mg（參考 2400 mg）|無資料)/.test(${text("#today-hero-nutrition-body")}) && /飽和脂肪 (約 [\\d.]+ g|無資料)/.test(${text("#today-hero-nutrition-body")})`,
    "2-9 營養素明細沒有「鈉 約 N mg（參考 2400 mg）」與飽和脂肪");
  check((await js(`[...document.querySelectorAll('#today-hero-nutrition-body *')].every((el) => { const c = getComputedStyle(el).color; return !/rgb\\(2[0-9]{2}, [0-9]{1,2}, [0-9]{1,2}\\)/.test(c); })`)),
    "2-9 營養素明細出現紅色字（鈉要中性顯示，章程 C4.14）");
  await shot("今日建議-營養素明細", "#today-hero");
  await click("#rec-breakfast .rec-undo-btn");
  await until(`!!document.querySelector('#rec-breakfast .rec-log-btn')`, "2-9 撤銷早餐沒有完成");

  // ---------- 3. 自己選 ----------
  console.log("[3. 自己選]");
  // 3-1 打開：午餐偏好是超商 → 停在超商分頁；純文字卡片；「記下這餐」不用捲動就看得到；步驟編號連續
  await openPicker("lunch");
  check((await currentTab()) === "convenience", "3-1 午餐（偏好超商）打開沒有停在超商分頁，停在 " + (await currentTab()));
  check((await js(`document.querySelectorAll('#meal-picker-panel .item-card img, #meal-picker-panel .item-card-img').length`)) === 0, "3-1 品項卡片有圖片（decisions #8）");
  check(await js(`(() => { const r = document.getElementById('meal-picker-submit').getBoundingClientRect(); return r.bottom <= window.innerHeight && r.top >= 0; })()`),
    "3-1 剛打開時「記下這餐」不在視窗內（要捲動才看得到）");
  await checkStepNumbers("3-1");
  await shot("自己選-午餐超商");
  // 3-2 選一個主餐 → 摘要；午餐主餐可以選 2 個，第 3 個出現提示（decisions #41）
  const lunchMains = await passUids("main");
  check(lunchMains.length >= 3, "3-2 午餐超商分頁可選的主餐不到 3 個，測不到上限");
  if (lunchMains.length >= 3) {
    await click(`#meal-picker-panel .item-card[data-uid="${lunchMains[0]}"]`);
    await until(`/已選 1 件 · 約 \\d+ kcal.*鈉 (約 \\d+ mg|無資料)/.test(${text("#meal-picker-summary")}.replace(/\\n/g, ' '))`, "3-2 選一個品項後摘要不是「已選 1 件 · 約 N kcal … · 鈉 …」");
    await shot("自己選-選一個主餐", "#meal-picker-summary");
    await click(`#meal-picker-panel .item-card[data-uid="${lunchMains[1]}"]`);
    await until(`${text("#meal-picker-summary")}.indexOf("已選 2 件") !== -1`, "3-2 午餐選第二個主餐應該可以");
    const dialogsBefore = H.dialogs.length;
    await click(`#meal-picker-panel .item-card[data-uid="${lunchMains[2]}"]`);
    await new Promise((r) => setTimeout(r, 300));
    check(H.dialogs.length > dialogsBefore && /午餐的主餐最多選 2 個/.test(H.dialogs[H.dialogs.length - 1]), "3-2 午餐選第三個主餐沒有出現「午餐的主餐最多選 2 個」");
  }
  // 3-7 飲料跨分頁保留；其他分頁還有選取時摘要多一行；外食分頁列出便當
  await click(`#meal-picker-drinks [data-drink="tw_dr05"]`);
  await click(`#meal-picker-tabs [data-tab=delivery]`);
  await until(`(document.querySelector('#meal-picker-tabs [aria-selected=true]') || {}).dataset.tab === 'delivery'`, "3-7 切到外食分頁沒有反應");
  check(await js(`!!document.querySelector('#meal-picker-drinks [data-drink="tw_dr05"].selected')`), "3-7 切到外食分頁後，剛選的飲料不見了");
  check((await js(text("#meal-picker-gap"))).indexOf("超商分頁還有 2 項沒有算進這餐") !== -1, "3-7 外食分頁沒有提示「超商分頁還有 2 項沒有算進這餐」");
  check((await js(`[...document.querySelectorAll('#meal-picker-panel .item-card')].map((c) => c.textContent).join('|')`)).indexOf("便當") !== -1, "3-7 外食分頁沒有列出便當");
  await checkStepNumbers("3-7");
  await shot("自己選-外食分頁（飲料保留）");
  // 3-6 取消 → 沒有記錄；重開回到預設分頁
  await closePicker();
  await until(`document.getElementById('meal-picker-overlay').hidden`, "3-6 按取消後視窗沒有關閉");
  check((await recText("lunch")).indexOf("已記錄") === -1, "3-6 按取消卻記錄了午餐");
  await openPicker("lunch");
  check((await currentTab()) === "convenience", "3-6 取消後重開沒有回到預設的超商分頁");
  await closePicker();
  // 3-2a 早餐只選拿鐵（飲料步驟）：鈉約 113 mg、可以送出
  await openPicker("breakfast");
  await click(`#meal-picker-drinks [data-drink="tw_dr05"]`);
  await until(`${text("#meal-picker-summary")}.indexOf("鈉 約 113 mg") !== -1`, "3-2a 早餐只選拿鐵，摘要不是「鈉 約 113 mg」");
  check(!(await js(`document.getElementById('meal-picker-submit').disabled`)), "3-2a 只選一杯飲料時「記下這餐」不能按");
  await shot("自己選-早餐只選拿鐵", "#meal-picker-drinks");
  // 3-3 記下這餐
  await click("#meal-picker-submit");
  await until(`document.getElementById('meal-picker-overlay').hidden && ${text("#rec-breakfast")}.indexOf("已記錄") !== -1`, "3-3 記下這餐後視窗沒關或早餐沒有變成已記錄");
  await click("#rec-breakfast .rec-undo-btn");
  await until(`!!document.querySelector('#rec-breakfast .rec-log-btn')`, "3-3 撤銷早餐沒有完成");
  // 3-8 宵夜設成「自動」：送出後重開停在送出的分頁（PRD 第 4 節）；下午茶的超商分頁只有少數品項
  await tab("profile");
  await setField("meal_pref_snack", "auto");
  await setField("meal_pref_afternoon_tea", "auto");
  await submitProfile();
  await until(`${text("#target-kcal")} === "1896.1"`, "3-8 改宵夜、下午茶偏好後按計算沒有完成");
  await openPicker("snack");
  check((await currentTab()) === "convenience", "3-8 宵夜（自動、沒送出過）沒有停在超商分頁");
  await click(`#meal-picker-tabs [data-tab=delivery]`);
  await click(`#meal-picker-panel .item-card:not([disabled])`);
  await click("#meal-picker-submit");
  await until(`document.getElementById('meal-picker-overlay').hidden && ${text("#rec-snack")}.indexOf("已記錄") !== -1`, "3-8 宵夜外食送出後沒有變成已記錄");
  await click("#rec-snack .rec-undo-btn");
  await until(`!!document.querySelector('#rec-snack .rec-log-btn')`, "3-8 撤銷宵夜沒有完成");
  await openPicker("snack");
  check((await currentTab()) === "delivery", "3-8 宵夜送出外食後重開，沒有停在外食分頁");
  await closePicker();
  await openPicker("afternoon_tea");
  await shot("自己選-下午茶超商分頁");
  await closePicker();
  // 3-2b 設過敏原並按計算 → 沙拉等複合料理灰掉、寫「成分未確認」、排在組內最後；頂端一行中性說明；整組被擋收成一行
  await tab("profile");
  await setAllergens(["蛋"]);
  await submitProfile();
  await until(`${text("#target-kcal")} === "1896.1"`, "3-2b 勾過敏原後按計算沒有完成");
  await openPicker("lunch");
  const blocked = await js(`[...document.querySelectorAll('#meal-picker-panel .item-card.is-blocked')].map((c) => c.dataset.uid + ':' + c.textContent)`);
  ["conv_sl01", "conv_sl02", "conv_sl04"].forEach((uid) => {
    const b = blocked.find((x) => x.indexOf(uid + ":") === 0);
    check(b && b.indexOf("成分未確認") !== -1, "3-2b 設了過敏原，" + uid + " 沒有灰掉並顯示「成分未確認」");
  });
  check(/灰色的 \d+ 項因你的過敏原／飲食設定不能選/.test(await js(text("#meal-picker-panel"))), "3-2b 分頁頂端沒有「灰色的 N 項…不能選」");
  check(await js(`[...document.querySelectorAll('#meal-picker-panel .meal-picker-group')].every((g) => { const cards = [...g.querySelectorAll('.item-card')];
    const first = cards.findIndex((c) => c.classList.contains('is-blocked')); return first === -1 || cards.slice(first).every((c) => c.classList.contains('is-blocked')); })`), "3-2b 被擋的品項沒有排在組內最後");
  check(/沙拉（\d+ 項因設定不能選）/.test(await js(text("#meal-picker-panel"))), "3-2b 整組被擋的沙拉沒有收成一行「沙拉（N 項因設定不能選）」");
  await shot("自己選-過敏原被擋（收合）");
  await js(`document.querySelectorAll('#meal-picker-panel details.is-all-blocked').forEach((d) => { d.open = true; })`);
  await shot("自己選-過敏原被擋（展開）", "#meal-picker-panel .item-card.is-blocked");
  // 3-11a 有設過敏原時，快速新增照預設（過敏原未確認）會預告被哪個設定擋住，不引導改填「確認不含」
  await click("#meal-picker-panel [data-quick-add-open]");
  await fillQuickAdd("朋友做的便當", "650");
  const notes = await js(text("#quick-add-notes"));
  check(notes.indexOf("你設了過敏原「蛋」") !== -1 && notes.indexOf("確認不含就") === -1, "3-11a 有設過敏原時沒有預告，或預告在引導改填確認不含：" + notes);
  await shot("自己選-快速新增預告", "#quick-add-form");
  await closePicker();
  await tab("profile");
  await setAllergens([]);
  await setField("meal_pref_snack", "off");
  await setField("meal_pref_afternoon_tea", "off");
  await submitProfile();
  await until(`${text("#target-kcal")} === "1896.1"`, "3-2b 取消過敏原後按計算沒有完成");
  // 3-4 自煮分頁：晚餐偏好是開伙 → 停在自煮分頁、子切換是開伙；溫沙拉「未含沙拉醬」、其他餐型沒有；份量滑桿
  await openPicker("dinner");
  check((await currentTab()) === "cook", "3-4 晚餐（偏好開伙）打開沒有停在自煮分頁，停在 " + (await currentTab()));
  check(await js(`!!document.querySelector('#meal-picker-panel [data-tier=cook_full].selected')`), "3-4 晚餐的子切換不是「開伙」");
  await checkStepNumbers("3-4 剛打開");
  await shot("自煮-選餐型");
  await cookPick("archetype", "warm_salad");
  await cookFill(["protein", "staple", "method"]);
  await until(`${text("#meal-picker-summary")}.indexOf("已配好") !== -1 && ${text("#meal-picker-summary")}.indexOf("未含沙拉醬") !== -1`, "3-4a 溫沙拉的摘要沒有「已配好」「未含沙拉醬」");
  check(!(await js(`document.getElementById('meal-picker-submit').disabled`)), "3-4 自煮選好後不能送出");
  await checkStepNumbers("3-4 溫沙拉");
  await shot("自煮-溫沙拉", "#meal-picker-panel .compose-step:last-child");
  const other = await js(`[...document.querySelectorAll('#meal-picker-panel .compose-option[data-axis=archetype]')].map((b) => b.dataset.id).find((id) => id !== 'warm_salad' && id !== 'egg_pan')`);
  await cookPick("archetype", other);
  await cookFill(["protein", "staple", "method"]);
  await until(`${text("#meal-picker-summary")}.indexOf("已配好") !== -1`, "3-4a 換成 " + other + " 後沒有配好");
  check((await js(text("#meal-picker-summary"))).indexOf("未含沙拉醬") === -1, "3-4a 換成 " + other + " 還顯示「未含沙拉醬」");
  const hasSlider = await js(`!!document.querySelector('#meal-picker-panel input[type=range]')`);
  check(hasSlider, "3-4 " + other + " 沒有份量滑桿");
  if (hasSlider) {
    const s1 = await js(text("#meal-picker-summary"));
    await js(`(() => { const r = document.querySelector('#meal-picker-panel input[type=range]'); r.value = r.max; r.dispatchEvent(new Event('input', { bubbles: true })); })()`);
    await until(`${text("#meal-picker-summary")} !== ${JSON.stringify(s1)}`, "3-4 拖份量滑桿後摘要沒變");
  }
  // 3-4b 蛋白質最多 2 個：第三個灰掉並寫「最多選 2 個」
  const proteins = await js(`[...document.querySelectorAll('#meal-picker-panel .compose-option[data-axis=protein]:not([disabled])')].map((b) => b.dataset.id)`);
  const selectedProteins = await js(`[...document.querySelectorAll('#meal-picker-panel .compose-option[data-axis=protein].selected')].map((b) => b.dataset.id)`);
  const extra = proteins.find((id) => selectedProteins.indexOf(id) === -1);
  if (extra && proteins.length >= 3) {
    await cookPick("protein", extra);
    check(await js(`[...document.querySelectorAll('#meal-picker-panel .compose-option[data-axis=protein][disabled]')].some((b) => b.innerText.indexOf("最多選 2 個") !== -1)`), "3-4b 選了 2 個蛋白質後，其他蛋白質沒有灰掉寫「最多選 2 個」");
    await shot("自煮-兩個蛋白質", "#meal-picker-panel .compose-option[data-axis=protein]");
  } else warnings.push("3-4b " + other + " 可選的蛋白質不到 3 個，沒測到上限");
  // 3-4c 煎蛋：用油選項（預設／約 2 茶匙；預設 5g 跟 1 茶匙相同只列一次）、改 2 茶匙後摘要「含用油約 10g」；調味清淡／一般
  await cookPick("archetype", "egg_pan");
  await cookFill(["protein"]);
  await cookPick("method", "method_pan_fry");
  const oils = await js(`[...document.querySelectorAll('#meal-picker-panel [data-oil]')].map((b) => b.innerText.trim())`);
  check(oils.length === 2 && oils[0].indexOf("預設（5g") === 0 && oils[1].indexOf("約 2 茶匙") === 0, "3-4c 煎蛋的用油選項不是「預設（5g…）／約 2 茶匙」：" + oils.join("、"));
  await click(`#meal-picker-panel [data-oil="10"]`);
  await until(`${text("#meal-picker-summary")}.indexOf("含用油約 10g") !== -1`, "3-4c 改用 2 茶匙後摘要沒有「含用油約 10g」");
  check(await js(`document.querySelectorAll('#meal-picker-panel [data-seasoning-level]').length === 2`), "3-4c 煎蛋沒有「清淡／一般」調味選項");
  await shot("自煮-煎蛋用油與調味", "#meal-picker-panel [data-oil]");
  // 3-9 快煮：🔴 的烹調法與食材灰掉寫原因；開伙時已選的 🔴 切到快煮仍可以取消，送出被擋並提示
  await cookPick("archetype", "grain_bowl_baked");
  await cookFill(["protein", "staple"]);
  await cookPick("method", "method_air_fry");
  await click(`#meal-picker-panel [data-tier=cook_quick]`);
  await until(`!!document.querySelector('#meal-picker-panel [data-tier=cook_quick].selected')`, "3-9 切到快煮沒有反應");
  check(await js(`[...document.querySelectorAll('#meal-picker-panel .compose-option[data-axis=protein][disabled]')].some((b) => b.innerText.indexOf("快煮不含這個食材") !== -1)`), "3-9 快煮時 🔴 的蛋白質（鮭魚、雞腿）沒有灰掉寫「快煮不含這個食材」");
  check(await js(`(() => { const b = document.querySelector('#meal-picker-panel [data-axis=method][data-id=method_air_fry]'); return b.classList.contains('selected') && !b.disabled; })()`), "3-9 開伙時選的氣炸，切到快煮後不能取消");
  check((await js(`document.getElementById('meal-picker-submit').disabled`)) && /快煮不含「/.test(await js(text("#meal-picker-hint"))), "3-9 快煮下選著氣炸，送出沒有被擋或沒有提示");
  await checkStepNumbers("3-9");
  await shot("自煮-快煮灰階", "#meal-picker-hint");
  await cookPick("method", "method_air_fry");
  await cookPick("method", "method_pan_fry");
  await until(`!document.getElementById('meal-picker-submit').disabled`, "3-9 快煮換成煎之後還是不能送出");
  // 3-4d 送出自煮 → 已記錄（型態＝子切換值），撤銷
  await click("#meal-picker-submit");
  await until(`document.getElementById('meal-picker-overlay').hidden && ${text("#rec-dinner")}.indexOf("已記錄") !== -1`, "3-4d 自煮記下這餐後晚餐沒有變成已記錄");
  await click("#rec-dinner .rec-undo-btn");
  await until(`!!document.querySelector('#rec-dinner .rec-log-btn')`, "3-4d 撤銷晚餐沒有完成");
  // 3-5 早餐碗：免開火、微波都能選
  await openPicker("breakfast");
  await click(`#meal-picker-tabs [data-tab=cook]`);
  await cookPick("archetype", "bowl_oat");
  const methods = await js(`[...document.querySelectorAll('#meal-picker-panel .compose-option[data-axis=method]')].map((b) => b.innerText.trim() + (b.disabled ? '(不可選)' : ''))`);
  check(methods.some((m) => m.indexOf("免開火") === 0) && methods.some((m) => m.indexOf("微波") === 0) && methods.every((m) => m.indexOf("不可選") === -1),
    "3-5 早餐碗的烹調法不是免開火、微波都可選：" + methods.join(","));
  // 3-5a 自煮分頁什麼都沒選 → 請先選餐型；只選飲料 → 可以送出（decisions #122 修正 #45，不再提示到超商或外食分頁）
  await closePicker();
  await openPicker("breakfast");
  await click(`#meal-picker-tabs [data-tab=cook]`);
  check((await js(`document.getElementById('meal-picker-submit').disabled`)) && (await js(text("#meal-picker-hint"))) === "請先選餐型", "3-5a 自煮分頁什麼都沒選時沒有擋下或提示不是「請先選餐型」");
  await click(`#meal-picker-drinks [data-drink="tw_dr05"]`);
  check(!(await js(`document.getElementById('meal-picker-submit').disabled`)) && (await js(text("#meal-picker-hint"))).indexOf("只記飲料") === -1, "3-5a 自煮分頁只選飲料時不能送出，或還有「只記飲料請到超商或外食分頁」");
  await shot("自煮-早餐只選飲料", "#meal-picker-hint");
  await closePicker();

  // 3-10 外食分頁「找不到？直接估算」：名稱＋L → 摘要約 1200 kcal、蛋白質無資料、「其他餐會自動調整」；送出後紀錄名稱是填的名稱
  await openPicker("lunch");
  await click(`#meal-picker-tabs [data-tab=delivery]`);
  await js(`(() => { const el = document.getElementById('meal-picker-estimate-name'); el.value = '喜宴'; el.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  await click(`#meal-picker-panel [data-estimate-size=L]`);
  await until(`${text("#meal-picker-summary")}.indexOf("約 1200 kcal") !== -1`, "3-10 估算 L 後摘要不是約 1200 kcal");
  const estGap = await js(text("#meal-picker-gap"));
  check(estGap.indexOf("其他餐會自動調整") !== -1 && estGap.indexOf("蛋白質：無資料") !== -1, "3-10 估算的缺口文字沒有「其他餐會自動調整」「蛋白質：無資料」：" + estGap);
  await shot("自己選-外食估算", "#meal-picker-panel .meal-picker-estimate");
  await click("#meal-picker-submit");
  await until(`document.getElementById('meal-picker-overlay').hidden && ${text("#rec-lunch")}.indexOf("喜宴") !== -1`, "3-10 估算送出後午餐紀錄沒有「喜宴」");
  check((await recText("lunch")).indexOf("1200") !== -1, "3-10 估算送出後午餐紀錄的熱量不是 1200");
  await click("#rec-lunch .rec-undo-btn");
  await until(`!!document.querySelector('#rec-lunch .rec-log-btn')`, "3-10 撤銷午餐沒有完成");
  // 3-11 快速新增：存完在目前分頁的「我的品項」看得到、已選中
  await openPicker("lunch");
  await click("#meal-picker-panel [data-quick-add-open]");
  await fillQuickAdd("巷口新開的便當", "620");
  await click("#meal-picker-panel [data-qa-save]");
  await until(`!!document.querySelector('#meal-picker-panel details.meal-picker-custom[open] .item-card.selected')`, "3-11 快速新增後，我的品項沒有展開或沒有選中");
  check((await js(text("#meal-picker-summary"))).indexOf("已選 1 件 · 約 620 kcal") !== -1, "3-11 快速新增後摘要不是「已選 1 件 · 約 620 kcal」");
  await shot("自己選-快速新增後選中", "#meal-picker-panel details.meal-picker-custom");
  await closePicker();
  // 3-12 配額不足的時段也能「自己選」：早餐記 1800 kcal → 午餐、晚餐配額不足，卡片仍有「自己選」且能記錄（v1 起這兩種卡片沒有按鈕）
  await openPicker("breakfast");
  await click(`#meal-picker-tabs [data-tab=convenience]`);
  await click("#meal-picker-panel [data-quick-add-open]");
  await fillQuickAdd("吃到飽早午餐", "1800");
  await click("#meal-picker-panel [data-qa-save]");
  await until(`!document.getElementById('meal-picker-submit').disabled`, "3-12 快速新增 1800 kcal 後不能送出");
  await click("#meal-picker-submit");
  await until(`document.getElementById('meal-picker-overlay').hidden && ${text("#rec-breakfast")}.indexOf("已記錄") !== -1`, "3-12 早餐記 1800 kcal 後沒有變成已記錄");
  await until(`${text("#rec-dinner")}.indexOf("配額已經不多") !== -1`, "3-12 早餐記 1800 kcal 後晚餐沒有顯示配額不足：" + (await recText("dinner")));
  await shot("今日建議-配額不足", "#rec-dinner");
  await openPicker("dinner");
  await click(`#meal-picker-tabs [data-tab=convenience]`);
  await click(`#meal-picker-panel .item-card:not([disabled])`);
  await click("#meal-picker-submit");
  await until(`document.getElementById('meal-picker-overlay').hidden && ${text("#rec-dinner")}.indexOf("已記錄") !== -1`, "3-12 配額不足時自己選送出後晚餐沒有變成已記錄");
  await click("#rec-dinner .rec-undo-btn");
  await until(`!!document.querySelector('#rec-dinner .rec-pick-btn')`, "3-12 撤銷晚餐沒有完成");
  await click("#rec-breakfast .rec-undo-btn");
  await until(`!!document.querySelector('#rec-breakfast .rec-log-btn') && !!document.querySelector('#rec-lunch .rec-log-btn')`, "3-12 撤銷早餐後早餐／午餐沒有回到推薦");
  // 3-3a 記一筆午餐留著（第 4 節本週總覽要有今天的熱量）
  await openPicker("lunch");
  await click(`#meal-picker-panel .item-card:not([disabled])`);
  await click("#meal-picker-submit");
  await until(`document.getElementById('meal-picker-overlay').hidden && ${text("#rec-lunch")}.indexOf("已記錄") !== -1`, "3-3a 午餐記下這餐後沒有變成已記錄");

  // ---------- 4. 本週總覽、運動紀錄 ----------
  console.log("[4. 本週、運動]");
  await tab("week");
  await until(`${text("#week-days")}.indexOf("kcal") !== -1`, "4-1 本週總覽沒有今天的熱量");
  await shot("本週總覽");
  await tab("exercise");
  await js(`(() => { const f = document.getElementById('exercise-form'); f.elements.duration_min.value = 30; f.requestSubmit(); })()`);
  await until(`${text("#exercise-history")}.indexOf("30 分鐘") !== -1`, "4-2 運動紀錄沒有出現");
  check(!/kcal|熱量/.test(await js(`document.getElementById('tab-exercise').innerText`)), "4-2 運動分頁出現飲食熱量（章程 C4.12）");
  await shot("運動紀錄");

  // ---------- 5. 資料備份（PRD 11.6） ----------
  console.log("[5. 資料備份]");
  const DB = `(await import('./js/data/db.js'))`;
  // 攔截下載：記下檔名與內容（blob URL 在頁面裡讀得到）
  const hookDownloads = () => js(`(() => { window.__downloads = window.__downloads || [];
    if (window.__dlHooked) return; window.__dlHooked = true;
    const orig = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function () {
      if (this.download) { const a = this; window.__downloads.push({ name: a.download, pending: true });
        const rec = window.__downloads[window.__downloads.length - 1];
        fetch(a.href).then((r) => r.text()).then((t) => { rec.text = t; rec.pending = false; }); return; }
      return orig.apply(this, arguments); }; })()`);
  const downloads = () => js(`(window.__downloads || []).filter((d) => !d.pending).map((d) => ({ name: d.name, text: d.text }))`);
  const putFile = (content, name) => js(`(() => { const input = document.getElementById('backup-file-input');
    const dt = new DataTransfer(); dt.items.add(new File([${JSON.stringify(content)}], ${JSON.stringify(name)}, { type: 'application/json' }));
    input.files = dt.files; input.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  const todayLocal = await js(`(() => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); })()`);

  await tab("profile");
  await hookDownloads();
  await shot("資料備份-區塊", "#backup-section");
  // 5-1 匯出：下載一個檔案，檔名是今天，沒有「無法還原」的提示
  await click("#backup-export-btn");
  await until(`(window.__downloads || []).length === 1 && !window.__downloads[0].pending`, "5-1 按匯出備份沒有產生下載");
  const dl1 = (await downloads())[0];
  check(dl1.name === "lighten2-backup-" + todayLocal + ".json", "5-1 備份檔名不是 lighten2-backup-今天.json：" + dl1.name);
  const status1 = await js(text("#backup-status"));
  check(status1.indexOf("已下載") !== -1 && status1.indexOf("無法還原") === -1, "5-1 匯出後的狀態不對（自我驗證有問題？）：" + status1);
  const backup = JSON.parse(dl1.text);
  check(backup.format === "lighten2-backup" && backup.sections && backup.manifest && typeof backup.exported_at === "string", "5-1 備份檔缺 format／sections／manifest／exported_at");
  await shot("資料備份-已匯出", "#backup-section");

  // 5-2 匯出之後改資料：記一餐（早餐記推薦）、改體重
  await tab("today");
  await until(`!!document.querySelector('#rec-breakfast .rec-log-btn')`, "5-2 早餐沒有推薦可以記");
  await click("#rec-breakfast .rec-log-btn");
  await until(`!!document.querySelector('#rec-breakfast .rec-undo-btn')`, "5-2 早餐記錄後沒有變成已記錄");
  await tab("profile");
  await js(`(() => { const f = document.getElementById('weight-form'); f.elements.weight_kg.value = 78.8; f.requestSubmit(); })()`);
  await until(`${text("#weight-log-status")}.indexOf("78.8") !== -1`, "5-2 體重沒有記錄");
  const changed = await js(`(async () => { const m = ${DB}; return JSON.stringify((await m.exportAllData()).sections); })()`);
  check(changed !== JSON.stringify(backup.sections), "5-2 改資料後內容跟備份一樣（測試前提不成立）");

  // 5-3 放一個壞檔：不是 JSON、版本較新 → 列出問題，沒有「還原」
  await putFile("這不是備份", "note.txt");
  await until(`!document.getElementById('backup-preview').hidden && ${text("#backup-preview")}.indexOf("不能還原") !== -1`, "5-3 非 JSON 檔沒有顯示「不能還原」");
  check(!(await js(`!!document.querySelector('#backup-preview [data-backup-restore]')`)), "5-3 壞檔還出現「還原」按鈕");
  await putFile(JSON.stringify(Object.assign({}, backup, { schema_version: backup.schema_version + 1 })), "newer.json");
  await until(`${text("#backup-preview")}.indexOf("較新的版本") !== -1`, "5-3 較新版本的備份沒有說明");
  await shot("資料備份-壞檔", "#backup-preview");
  await click("#backup-preview [data-backup-cancel]");

  // 5-4 放剛才的備份：預覽有筆數對照、「匯出之後新增的紀錄」、「不是同步」；有資料時「還原」先不能按
  await putFile(dl1.text, dl1.name);
  await until(`!!document.querySelector('#backup-preview .backup-table')`, "5-4 選了備份檔沒有出現預覽");
  const pv = await js(text("#backup-preview"));
  check(pv.indexOf("飲食紀錄") !== -1 && pv.indexOf("體重紀錄") !== -1 && pv.indexOf("不是同步") !== -1, "5-4 預覽缺筆數對照或「不是同步」說明：" + pv.slice(0, 200));
  check(pv.indexOf("之後新增的紀錄，還原後不會保留") !== -1, "5-4 目前有匯出之後新記的一餐，預覽沒有提示");
  check(pv.indexOf("我的組合") !== -1, "5-4 預覽沒有「我的組合」一列（工作線 C）");
  check(!/kcal|分鐘/.test(pv), "5-4 預覽出現熱量或運動內容（只能有筆數與日期，章程 C4.12）");
  check(await js(`document.querySelector('#backup-preview [data-backup-restore]').disabled`), "5-4 目前有資料時，還沒先匯出就能按「還原」");
  await shot("資料備份-預覽", "#backup-preview");
  // 5-5 取消 → 資料不變
  await click("#backup-preview [data-backup-cancel]");
  check(await js(`document.getElementById('backup-preview').hidden`), "5-5 按取消後預覽沒有關閉");
  check((await js(`(async () => { const m = ${DB}; return JSON.stringify((await m.exportAllData()).sections); })()`)) === changed, "5-5 按取消後資料變了");
  // 5-6 先匯出目前的資料 → 產生第二個下載、「還原」可以按
  await putFile(dl1.text, dl1.name);
  await until(`!!document.querySelector('#backup-preview [data-backup-export-current]')`, "5-6 預覽沒有「先匯出目前的資料」");
  await click("#backup-preview [data-backup-export-current]");
  await until(`(window.__downloads || []).filter((d) => !d.pending).length === 2`, "5-6 按「先匯出目前的資料」沒有產生下載");
  await until(`!document.querySelector('#backup-preview [data-backup-restore]').disabled`, "5-6 先匯出之後「還原」還是不能按");
  // 5-7 還原 → 頁面重新載入，改過的資料都回到匯出時的樣子
  await js(`window.__beforeReload = true`);
  await click("#backup-preview [data-backup-restore]");
  await until(`!window.__beforeReload && document.readyState === 'complete' && !!document.getElementById('backup-section')`, "5-7 還原後頁面沒有重新載入");
  const restored = await js(`(async () => { const m = ${DB}; return JSON.stringify((await m.exportAllData()).sections); })()`);
  check(restored === JSON.stringify(backup.sections), "5-7 還原後資料跟備份檔不一樣");
  await tab("today");
  await until(`!!document.querySelector('#rec-breakfast .rec-log-btn') && ${text("#rec-lunch")}.indexOf("已記錄") !== -1`, "5-7 還原後早餐不是回到推薦、或午餐紀錄不見了");
  await shot("資料備份-還原後今日建議");

  // ---------- 6. 我的品項（B-1a）：份量、不吃、複製、補填 ----------
  console.log("[6. 我的品項]");
  const kcalOf = async () => { const m = /約 (\d+(?:\.\d+)?) kcal/.exec(await js(text("#meal-picker-summary"))); return m ? Number(m[1]) : null; };
  const firstBuiltinMain = () => js(`(async () => { const c = await (await import('./js/data/catalog.js')).loadCatalog();
    const card = [...document.querySelectorAll('#meal-picker-panel .item-card:not([disabled])')].find((b) => { const p = c.productsByUid[b.dataset.uid]; return p && p.role === 'main'; });
    return card ? card.dataset.uid : null; })()`);
  const cardIndex = (uid) => js(`[...document.querySelectorAll('#meal-picker-panel .item-card')].findIndex((b) => b.dataset.uid === ${JSON.stringify(uid)})`);

  // 6-1 份量：已選段在清單上方；×2 摘要熱量兩倍；飲料份量在飲料步驟，切到自煮看得到；取消再選回到 1；送出名稱帶 ×2
  await openPicker("dinner");
  await click(`#meal-picker-tabs [data-tab=convenience]`);
  const mainA = await firstBuiltinMain();
  check(!!mainA, "6-1 超商分頁沒有可選的內建主餐");
  await click(`#meal-picker-panel .item-card[data-uid="${mainA}"]`);
  check(await js(`(() => { const s = document.querySelector('#meal-picker-panel .meal-picker-selected'); const g = document.querySelector('#meal-picker-panel .item-grid');
    return !!s && !!g && (s.compareDocumentPosition(g) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0; })()`), "6-1 已選段不在品項清單上方");
  check(!/kcal/.test(await js(text("#meal-picker-panel .meal-picker-selected"))), "6-1 已選段每行顯示了熱量（要看摘要，章程 C4.11）");
  const k1 = await kcalOf();
  await click(`#meal-picker-panel [data-qty-uid="${mainA}"][data-qty="2"]`);
  const k2 = await kcalOf();
  check(k1 && k2 && Math.abs(k2 - 2 * k1) <= 1, "6-1 份量 ×2 後摘要熱量不是兩倍（" + k1 + " → " + k2 + "）");
  await click(`#meal-picker-drinks [data-drink]:not([data-drink=""]):not([disabled])`);
  const drinkA = await js(`document.querySelector('#meal-picker-drinks .item-card.selected').dataset.drink`);
  await click(`#meal-picker-drinks [data-qty-uid="${drinkA}"][data-qty="2"]`);
  await shot("我的品項-份量", "#meal-picker-panel .meal-picker-selected");
  await click(`#meal-picker-tabs [data-tab=cook]`);
  check(await js(`!!document.querySelector('#meal-picker-drinks [data-qty-uid="${drinkA}"][data-qty="2"].selected')`), "6-1 切到自煮分頁看不到飲料的份量 ×2");
  await click(`#meal-picker-tabs [data-tab=convenience]`);
  await click(`#meal-picker-drinks [data-drink=""]`);
  await click(`#meal-picker-drinks [data-drink="${drinkA}"]`);
  check(await js(`!!document.querySelector('#meal-picker-drinks [data-qty-uid="${drinkA}"][data-qty="1"].selected')`), "6-1 飲料取消再選回來，份量不是 1");
  await click("#meal-picker-submit");
  await until(`document.getElementById('meal-picker-overlay').hidden && ${text("#rec-dinner")}.indexOf("×2") !== -1`, "6-1 送出後晚餐紀錄名稱沒有「×2」");
  await click("#rec-dinner .rec-undo-btn");
  await until(`!!document.querySelector('#rec-dinner .rec-pick-btn')`, "6-1 撤銷晚餐沒有完成");

  // 6-2 不吃（取代原本的隱藏，decisions #99）：已選段按「不吃」→ 移到最下方收合的「你標了不吃」＋提示＋復原 → 按復原回到原本的位置
  await openPicker("dinner");
  await click(`#meal-picker-tabs [data-tab=convenience]`);
  const mainB = await firstBuiltinMain();
  const idxB = await cardIndex(mainB);
  await click(`#meal-picker-panel .item-card[data-uid="${mainB}"]`);
  await click(`#meal-picker-panel [data-dislike-uid="${mainB}"]`);
  await until(`!!document.querySelector('#meal-picker-panel .dislike-notice') && !!document.querySelector('#meal-picker-panel .meal-picker-disliked .item-card[data-uid="${mainB}"]')`, "6-2 按不吃後沒有提示或沒有移到「你標了不吃」組");
  check(await js(`!document.querySelector('#meal-picker-panel .meal-picker-disliked').open && document.querySelector('#meal-picker-panel .meal-picker-disliked .item-card[data-uid="${mainB}"]').disabled`), "6-2 「你標了不吃」組沒有預設收合或卡片還能點");
  check(await js(`(() => { const d = document.querySelector('#meal-picker-panel .meal-picker-disliked'); const gs = [...document.querySelectorAll('#meal-picker-panel .meal-picker-group:not(.meal-picker-disliked)')];
    return gs.every((g) => (g.compareDocumentPosition(d) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0); })()`), "6-2 「你標了不吃」組不在分頁最下方");
  check((await js(text("#meal-picker-panel .dislike-notice"))).indexOf("可以在「我的食物」取消") !== -1, "6-2 提示沒有寫去哪裡取消");
  await js(`document.querySelector('#meal-picker-panel .meal-picker-disliked').open = true`);
  await shot("我的品項-不吃提示", "#meal-picker-panel .dislike-notice");
  await shot("我的品項-不吃組", "#meal-picker-panel .meal-picker-disliked");
  await click(`#meal-picker-panel .dislike-notice [data-undislike-uid="${mainB}"]`);
  await until(`!!document.querySelector('#meal-picker-panel .item-card[data-uid="${mainB}"]:not([disabled])')`, "6-2 按復原後品項沒有回來");
  check((await cardIndex(mainB)) === idxB, "6-2 復原後品項沒有回到原本的位置（" + idxB + " → " + (await cardIndex(mainB)) + "）");
  // 6-2a 選擇器裡標不吃後直接按取消關閉 → 今日建議馬上重算（計畫 S7）：用晚餐推薦裡的現成品項
  await closePicker();
  const recItem = await js(`(() => { const c = document.querySelector('[id^=rec-] .dislike-chip[data-type=item]'); return c ? c.dataset.key : null; })()`);
  if (recItem) {
    const recSlot = await js(`document.querySelector('[id^=rec-] .dislike-chip[data-key="${recItem}"]').closest('[id^=rec-]').id.replace('rec-', '')`);
    await openPicker(recSlot);
    const recTab = await js(`(async () => { const c = await (await import('./js/data/catalog.js')).loadCatalog(); const p = c.productsByUid[${JSON.stringify(recItem)}]; return p.role === 'drink' ? null : (p.is_taiwan || p.channel === 'delivery' ? 'delivery' : 'convenience'); })()`);
    if (recTab) {
      await new Promise((r) => setTimeout(r, 300)); // 選擇器打開是非同步的，面板可能還是上一次的內容
      await click(`#meal-picker-tabs [data-tab=${recTab}]`);
      await until(`!!document.querySelector('#meal-picker-panel .item-card[data-uid="${recItem}"]')`, "6-2a 選擇器裡找不到推薦的品項 " + recItem);
      await js(`document.querySelectorAll('#meal-picker-panel details').forEach((d) => { d.open = true; })`);
      await click(`#meal-picker-panel .item-card[data-uid="${recItem}"]`);
      await click(`#meal-picker-panel [data-dislike-uid="${recItem}"]`);
    } else {
      await click(`#meal-picker-drinks [data-drink="${recItem}"]`);
      await click(`#meal-picker-drinks [data-dislike-uid="${recItem}"]`);
    }
    await until(`!!document.querySelector('.dislike-notice')`, "6-2a 選擇器裡標不吃沒有提示");
    await markStale();
    await closePicker();
    await until(`!document.querySelector('.walkthrough-stale')`, "6-2a 選擇器裡標不吃後按取消，今日建議沒有重算");
    check(!(await js(`!!document.querySelector('[id^=rec-] .dislike-chip[data-key="${recItem}"]')`)), "6-2a 選擇器裡標不吃 " + recItem + " 後，今日建議還推薦它");
    await js(`import('./js/data/db.js').then((m) => m.removeDislikedIngredient(${JSON.stringify(recItem)}))`); // 還原，後面步驟要完整候選
    await markStale();
    await tab("week");
    await tab("today");
    await waitFresh("6-2a 還原後今日建議沒有重算");
  } else check(false, "6-2a 推薦卡片裡找不到現成品項（測試前提不成立）");

  // 6-3 複製成我的版本：表單預帶內建的值 → 改熱量存檔 → 原品項消失、新的一筆選中、份量沿用
  await openPicker("dinner");
  await new Promise((r) => setTimeout(r, 300));
  await click(`#meal-picker-tabs [data-tab=convenience]`);
  await until(`!!document.querySelector('#meal-picker-panel .item-card[data-uid="${mainB}"]:not([disabled])')`, "6-3 選擇器裡沒有 " + mainB);
  await click(`#meal-picker-panel .item-card[data-uid="${mainB}"]`);
  await click(`#meal-picker-panel [data-qty-uid="${mainB}"][data-qty="2"]`);
  await click(`#meal-picker-panel [data-copy-uid="${mainB}"]`);
  await until(`!!document.getElementById('picker-custom-food-form')`, "6-3 按複製成我的版本沒有出現表單");
  const builtinName = await js(`(async () => (await (await import('./js/data/catalog.js')).loadCatalog()).productsByUid[${JSON.stringify(mainB)}].name)()`);
  check((await js(`document.querySelector('#picker-custom-food-form [data-cf=name]').value`)) === builtinName, "6-3 表單沒有預帶內建品項的名稱");
  await js(`document.querySelector('#picker-custom-food-form [data-cf=kcal]').value = '444'`);
  await shot("我的品項-複製表單", "#picker-custom-food-form");
  await click(`#picker-custom-food-form [data-cf-save]`);
  await until(`!document.getElementById('picker-custom-food-form') && !document.querySelector('#meal-picker-panel .item-card[data-uid="${mainB}"]')`, "6-3 存檔後表單沒關或原品項沒有消失");
  check(await js(`!!document.querySelector('#meal-picker-panel details.meal-picker-custom[open] .item-card.selected')`), "6-3 複製品沒有在我的品項裡選中");
  check((await kcalOf()) === 888, "6-3 複製品的份量沒有沿用 ×2（摘要應該是 888 kcal，實際 " + (await kcalOf()) + "）");
  check((await js(text("#meal-picker-panel"))).indexOf("已複製成我的版本") !== -1, "6-3 沒有「已複製成我的版本」的說明");
  await closePicker();

  // 6-4 補填：快速新增一筆過敏原未確認 → 設過敏原並按「計算」→ 灰掉、旁邊有「補填」；勾「含蛋」的那筆沒有補填 → 補成確認不含 → 可以選
  await openPicker("dinner");
  await click(`#meal-picker-tabs [data-tab=convenience]`);
  await click("#meal-picker-panel [data-quick-add-open]");
  await fillQuickAdd("朋友做的飯糰", "300");
  await click("#meal-picker-panel [data-qa-save]");
  await until(`${text("#meal-picker-panel")}.indexOf("已存成我的品項") !== -1`, "6-4 快速新增沒有存成功");
  await click("#meal-picker-panel [data-quick-add-open]");
  await fillQuickAdd("有蛋的三明治", "320");
  await click(`#meal-picker-panel [data-qa-allergen-mode=some]`);
  await click(`#meal-picker-panel [data-qa-allergen="蛋"]`);
  await click("#meal-picker-panel [data-qa-save]");
  await until(`${text("#meal-picker-panel")}.indexOf("有蛋的三明治") !== -1`, "6-4 第二筆快速新增沒有存成功");
  await closePicker();
  await tab("profile");
  await setAllergens(["蛋"]);
  await submitProfile();
  await until(`${text("#target-kcal")} === "1896.1"`, "6-4 設過敏原後按計算沒有完成");
  await openPicker("dinner");
  await click(`#meal-picker-tabs [data-tab=convenience]`);
  await js(`document.querySelectorAll('#meal-picker-panel details.meal-picker-custom').forEach((d) => { d.open = true; })`);
  const riceUid = await js(`[...document.querySelectorAll('#meal-picker-panel .item-card')].find((b) => b.innerText.indexOf('朋友做的飯糰') !== -1).dataset.uid`);
  const eggUid = await js(`[...document.querySelectorAll('#meal-picker-panel .item-card')].find((b) => b.innerText.indexOf('有蛋的三明治') !== -1).dataset.uid`);
  check(await js(`document.querySelector('#meal-picker-panel .item-card[data-uid="${riceUid}"]').disabled && !!document.querySelector('#meal-picker-panel [data-fill-uid="${riceUid}"]')`), "6-4 過敏原未確認的我的品項沒有灰掉或旁邊沒有「補填」");
  check(!(await js(`!!document.querySelector('#meal-picker-panel [data-fill-uid="${eggUid}"]')`)), "6-4 勾了「含蛋」的我的品項出現「補填」（不能引導改答案，章程 C4.1）");
  await shot("我的品項-補填按鈕", `#meal-picker-panel [data-fill-uid="${riceUid}"]`);
  await click(`#meal-picker-panel [data-fill-uid="${riceUid}"]`);
  await until(`!!document.getElementById('picker-custom-food-form')`, "6-4 按補填沒有出現表單");
  await click(`#picker-custom-food-form [data-cf-allergen-mode=none]`);
  await click(`#picker-custom-food-form [data-cf-save]`);
  await until(`!document.getElementById('picker-custom-food-form') && !!document.querySelector('#meal-picker-panel .item-card[data-uid="${riceUid}"].selected')`, "6-4 補成確認不含之後沒有選中");
  check((await js(`document.querySelectorAll('#meal-picker-panel .item-card[data-uid="${riceUid}"]').length`)) === 1, "6-4 補填後出現兩張同一筆的卡片");
  await closePicker();
  await tab("profile");
  await setAllergens([]);
  await submitProfile();
  await until(`${text("#target-kcal")} === "1896.1"`, "6-4 取消過敏原後按計算沒有完成");

  // ---------- 7. 我的食物的「我的品項」（B-1a 搬過來，工作線 D 切片 2） ----------
  console.log("[7. 我的品項管理]");
  check(!(await js(`!!document.getElementById('custom-foods-section')`)), "7-0 基本資料還有「我的品項」區塊（已搬到我的食物）");
  await tab("foods");
  await foodsSub("convenience");
  await until(`!!(${foodRow(builtinName)})`, "7-1 超商的我的品項沒有剛才的複製品");
  check((await foodRowText(builtinName)).indexOf("從內建複製") !== -1, "7-1 複製品沒有標「從內建複製」");
  const mineOrder = await js(`[...document.querySelectorAll('#foods-body .foods-mine .food-name')].map((n) => n.innerText)`);
  check(mineOrder.indexOf("有蛋的三明治") !== -1 && mineOrder.indexOf("有蛋的三明治") < mineOrder.indexOf("朋友做的飯糰") && mineOrder.indexOf("朋友做的飯糰") < mineOrder.indexOf("巷口新開的便當"),
    "7-1 我的品項不是新到舊：" + mineOrder.join("、"));
  await openFood(builtinName);
  await until(`!!document.querySelector('#foods-body .food-detail .builtin-compare')`, "7-1 複製品的明細沒有「內建目前的數值」");
  check((await js(text("#foods-body .food-detail"))).indexOf("出處：從內建複製") !== -1, "7-1 複製品的出處不是「從內建複製」");
  await inFoodRow(builtinName, "[data-cf-edit]");
  await until(`!!document.getElementById('foods-custom-food-form')`, "7-1 按編輯沒有出現表單");
  await shot("我的食物-編輯複製品", "#foods-custom-food-form");
  await click("#foods-custom-food-form [data-cf-cancel]");

  // 7-2 補填只給未確認類：設過敏原「蛋」並按計算 → 未確認的有「補填」、含蛋的沒有
  await tab("profile");
  await setAllergens(["蛋"]);
  await submitProfile();
  await until(`${text("#target-kcal")} === "1896.1"`, "7-2 設過敏原後按計算沒有完成");
  await tab("foods");
  await until(`!!(${foodRow("巷口新開的便當")}) && (${foodRow("巷口新開的便當")}).innerText.indexOf("成分未確認") !== -1`, "7-2 設過敏原後，未確認的我的品項沒有寫原因");
  await openFood("巷口新開的便當");
  check(await js(`!!(${foodRow("巷口新開的便當")}).querySelector('[data-cf-fill]')`), "7-2 未確認的我的品項沒有「補填」");
  await openFood("有蛋的三明治");
  check((await foodRowText("有蛋的三明治")).indexOf("含過敏原") !== -1 && !(await js(`!!(${foodRow("有蛋的三明治")}).querySelector('[data-cf-fill]')`)), "7-2 含蛋的我的品項沒有寫原因、或出現「補填」（不能引導改答案）");
  await shot("我的食物-我的品項狀態", "#foods-body .foods-mine");
  await tab("profile");
  await setAllergens([]);
  await submitProfile();
  await until(`${text("#target-kcal")} === "1896.1"`, "7-2 取消過敏原後按計算沒有完成");
  await tab("foods");
  await until(`!!(${foodRow("巷口新開的便當")}) && (${foodRow("巷口新開的便當")}).innerText.indexOf("成分未確認") === -1`, "7-2 取消過敏原後狀態沒有更新");

  // 7-3 刪除複製品 → 移到「已刪除」、提示原品項仍隱藏；還原
  await openFood(builtinName);
  await inFoodRow(builtinName, "[data-cf-archive]");
  await until(`${text("#foods-status")}.indexOf("仍是換成你的版本") !== -1 && [...document.querySelectorAll('#foods-body details.foods-folded > summary')].some((s) => s.innerText.indexOf("已刪除") === 0)`, "7-3 刪除複製品後沒有「已刪除」組或沒有「仍是換成你的版本」提示");
  await openFolded();
  // 複製品跟被隱藏的原品項同名：只在「已刪除」組裡找
  const archivedRow = `[...[...document.querySelectorAll('#foods-body details.foods-folded')].find((d) => d.querySelector('summary').innerText.indexOf("已刪除") === 0).querySelectorAll('.food-row')].find((r) => r.querySelector('.food-name').textContent === ${JSON.stringify(builtinName)})`;
  await js(`(() => { const r = ${archivedRow}; if (!r.querySelector('[data-cf-restore]')) r.querySelector('.food-row-main').click(); })()`);
  await until(`!!(${archivedRow}).querySelector('[data-cf-restore]')`, "7-3 已刪除的複製品明細沒有「還原」");
  await js(`(${archivedRow}).querySelector('[data-cf-restore]').click()`);
  await until(`${text("#foods-status")}.indexOf("已還原") !== -1 && ![...document.querySelectorAll('#foods-body details.foods-folded > summary')].some((s) => s.innerText.indexOf("已刪除") === 0)`, "7-3 還原後沒有回到清單");

  // 7-4 已換成我的版本的內建品項：改回內建，有複製品時提示
  await openFolded();
  check(!!(await js(`!!(${foodRow(builtinName)}) && [...document.querySelectorAll('#foods-body details.foods-folded')].some((d) => d.querySelector('summary').innerText.indexOf("已換成我的版本") === 0 && d.innerText.indexOf(${JSON.stringify(builtinName)}) !== -1)`)), "7-4 「已換成我的版本」組沒有列出複製時自動隱藏的原品項");
  await shot("我的食物-已換成我的版本", "#foods-body details.foods-folded");
  await js(`(() => { const d = [...document.querySelectorAll('#foods-body details.foods-folded')].find((x) => x.querySelector('summary').innerText.indexOf("已換成我的版本") === 0);
    const b = [...d.querySelectorAll('.food-row')].find((r) => r.innerText.indexOf(${JSON.stringify(builtinName)}) !== -1).querySelector('[data-cf-unhide]'); b.click(); })()`);
  await until(`${text("#foods-status")}.indexOf("你有一筆從它複製的我的品項") !== -1`, "7-4 改回內建時沒有提示有複製品");

  // 7-5 搜尋：我的品項與內建都找得到，結果標子分頁
  await foodsSearch("三明治");
  await until(`!!(${foodRow("有蛋的三明治")})`, "7-5 搜尋「三明治」沒有找到我的品項");
  check((await foodRowText("有蛋的三明治")).indexOf("超商 · 我的品項") !== -1, "7-5 搜尋結果沒有標子分頁與分組");
  await foodsSearch("");

  // 7-6 ＋新增：飲品・水果預帶飲料角色；改成外食主餐存檔 → 說明存到「外食」
  await foodsSub("drinks");
  await click("#foods-body [data-foods-add]");
  await until(`!!document.getElementById('foods-custom-food-form')`, "7-6 按新增沒有出現表單");
  check(await js(`!!document.querySelector('#foods-custom-food-form [data-cf-role=drink].selected')`), "7-6 飲品・水果的新增沒有預帶飲料角色");
  await js(`(() => { const f = document.getElementById('foods-custom-food-form'); f.querySelector('[data-cf=name]').value = '在家整理的新品'; f.querySelector('[data-cf=kcal]').value = '210'; })()`);
  await click(`#foods-custom-food-form [data-cf-channel=delivery]`);
  await click(`#foods-custom-food-form [data-cf-role=main]`);
  await shot("我的食物-新增表單", "#foods-custom-food-form");
  await click("#foods-custom-food-form [data-cf-save]");
  await until(`${text("#foods-status")}.indexOf("已新增") !== -1 && ${text("#foods-status")}.indexOf("外食") !== -1`, "7-6 新增到別的子分頁後沒有說明存到哪裡");
  await foodsSub("delivery");
  await until(`!!(${foodRow("在家整理的新品")})`, "7-6 外食的我的品項沒有新的一筆");

  // ---------- 8. 我的食物（工作線 D 切片 2，PRD 13） ----------
  console.log("[8. 我的食物]");
  // 8-1 三個子分頁
  for (const [sub, label] of [["convenience", "超商"], ["delivery", "外食"], ["drinks", "飲品・水果"]]) {
    await foodsSub(sub);
    await until(`!!document.querySelector('[data-foods-subtab=${sub}][aria-selected=true]') && !!document.querySelector('#foods-body .food-row')`, "8-1 " + label + " 子分頁沒有內容");
    await shot("我的食物-" + label);
  }
  check((await js(text("#foods-body"))).indexOf("現成飲料") !== -1, "8-1 飲品・水果沒有「現成飲料」組");
  // 8-2 搜尋「豆漿」：有結果、標子分頁
  await foodsSearch("豆漿");
  await until(`!!document.querySelector('#foods-body .food-row')`, "8-2 搜尋「豆漿」沒有結果");
  check((await js(text("#foods-body"))).indexOf("飲品・水果 ·") !== -1, "8-2 搜尋結果沒有標子分頁");
  await shot("我的食物-搜尋豆漿");
  // 8-3 明細：出處分組、衛福部附編號、不顯示 ref、鈉中性寫法、能在哪些餐出現
  const latte = await js(`(async () => (await (await import('./js/data/catalog.js')).loadCatalog()).productsByUid.tw_dr05.name)()`);
  await foodsSearch("拿鐵");
  await until(`!!(${foodRow(latte)})`, "8-3 搜尋「拿鐵」沒有 tw_dr05");
  await openFood(latte);
  const latteText = await js(text("#foods-body .food-detail"));
  check(latteText.indexOf("衛福部（整合編號 O0700301）") !== -1, "8-3 衛福部換算的品項出處沒有附整合編號：" + latteText);
  check(latteText.indexOf("鈉 約 113 mg（參考 2400 mg）") !== -1, "8-3 鈉不是中性寫法：" + latteText);
  check(latteText.indexOf("能在哪些餐出現") !== -1 && latteText.indexOf("「不吃」只擋這一項") !== -1, "8-3 明細缺「能在哪些餐出現」或「只擋這一項」");
  check(!/TFDA|Google|AI|decisions|審核|×/.test(latteText), "8-3 明細出現了 ref 或開發註記：" + latteText);
  await shot("我的食物-明細衛福部", "#foods-body .food-detail");
  const mid = await js(`(async () => { const c = await (await import('./js/data/catalog.js')).loadCatalog(); return c.products.find((p) => p.kcal_basis === 'midpoint' && p.role !== 'drink').name; })()`);
  await foodsSearch(mid);
  await until(`!!(${foodRow(mid)})`, "8-3 搜尋區間中點的外食沒有結果");
  await openFood(mid);
  check(/區間 \d+–\d+ kcal/.test(await js(text("#foods-body .food-detail"))) && (await js(text("#foods-body .food-detail"))).indexOf("估算") !== -1, "8-3 區間中點的熱量沒有附區間或出處不是估算");
  await shot("我的食物-明細區間", "#foods-body .food-detail");
  await foodsSearch("");
  // 8-4 標不吃 → 移到「你標了不吃（1）」收合組；選擇器同一分頁在最下方收合組，按「取消不吃」回原位
  await foodsSub("convenience");
  const target = await js(`(async () => { const c = await (await import('./js/data/catalog.js')).loadCatalog(); return c.products.find((p) => !p.is_taiwan && p.channel === 'convenience' && p.role === 'main' && p.valid_slots.indexOf('dinner') !== -1); })()`);
  await openFood(target.name);
  await inFoodRow(target.name, "[data-foods-dislike]");
  await until(`[...document.querySelectorAll('#foods-body details.foods-folded > summary')].some((s) => s.innerText === "你標了不吃（1）")`, "8-4 標不吃後沒有「你標了不吃（1）」組");
  check(await js(`(() => { const d = [...document.querySelectorAll('#foods-body details.foods-folded')].find((x) => x.querySelector('summary').innerText === "你標了不吃（1）"); return d.innerText.indexOf(${JSON.stringify(target.name)}) !== -1; })()`), "8-4 標不吃的品項不在「你標了不吃」組");
  await shot("我的食物-標不吃之後", "#foods-body details.foods-folded");
  await openPicker("dinner");
  await click(`#meal-picker-tabs [data-tab=convenience]`);
  check(await js(`!!document.querySelector('#meal-picker-panel .meal-picker-disliked .item-card[data-uid="${target.uid}"]') && !document.querySelector('#meal-picker-panel .meal-picker-group:not(.meal-picker-disliked) .item-card[data-uid="${target.uid}"]')`), "8-4 選擇器裡標了不吃的品項不在最下方的不吃組");
  await js(`document.querySelector('#meal-picker-panel .meal-picker-disliked').open = true`);
  await click(`#meal-picker-panel .meal-picker-disliked [data-undislike-uid="${target.uid}"]`);
  await until(`!!document.querySelector('#meal-picker-panel .item-card[data-uid="${target.uid}"]:not([disabled])') && !document.querySelector('#meal-picker-panel .meal-picker-disliked')`, "8-4 選擇器裡取消不吃後沒有回到原位可選");
  await closePicker();
  // 8-5 設過敏原後被擋品項的明細有「複製成我的版本」，按鈕不在原因旁邊
  await tab("profile");
  await setAllergens(["蛋"]);
  await submitProfile();
  await until(`${text("#target-kcal")} === "1896.1"`, "8-5 設過敏原後按計算沒有完成");
  await tab("foods");
  await foodsSub("convenience");
  const blockedName = await js(`(() => { const r = document.querySelector('#foods-body .food-row.is-blocked .food-name'); return r ? r.innerText : null; })()`);
  check(!!blockedName, "8-5 設過敏原後超商沒有被擋的品項");
  if (blockedName) {
    await openFood(blockedName);
    check(await js(`(() => { const r = ${foodRow(blockedName)}; const b = r.querySelector('[data-foods-copy]'); return !!b && !!b.closest('.backup-actions') && !b.closest('.food-status'); })()`), "8-5 被擋品項的明細沒有「複製成我的版本」或按鈕位置不對");
    check((await foodRowText(blockedName)).indexOf("以你目前的設定：") !== -1, "8-5 被擋品項的明細沒有「以你目前的設定」");
    await shot("我的食物-被擋可複製", "#foods-body .food-detail");
  }
  await tab("profile");
  await setAllergens([]);
  await submitProfile();
  await until(`${text("#target-kcal")} === "1896.1"`, "8-5 取消過敏原後按計算沒有完成");
  // 8-6 全部清單的「已不提供」可以移除（先用 db 函式寫一個不存在的 key）
  await js(`import('./js/data/db.js').then((m) => m.addDislikedIngredient({ type: 'item', key: 'gone_walkthrough', label: '已下架的舊品項' }))`);
  await tab("today");
  await tab("foods");
  await until(`!!document.querySelector('.foods-disliked-all [data-foods-undislike="gone_walkthrough"]')`, "8-6 全部清單沒有查不到的 key");
  await js(`document.querySelector('.foods-disliked-all').open = true`);
  check((await js(text(".foods-disliked-all"))).indexOf("已下架的舊品項（已不提供）") !== -1, "8-6 查不到的 key 沒有寫「已不提供」");
  await shot("我的食物-已不提供", ".foods-disliked-all");
  await click(`.foods-disliked-all [data-foods-undislike="gone_walkthrough"]`);
  await until(`(${dbDislikedKeys}).then((s) => JSON.parse(s).length === 0)`, "8-6 移除後不吃清單不是空的");

  // ---------- 8-7～8-11 自煮、家裡的飲品、水果（工作線 D 切片 4，計畫 docs/review/2026-09-30-D4-實作計畫.md 第 4 節） ----------
  // 8-7 自煮：大類預設收合、標題有筆數；點 summary 展開；雞胸明細的量詞與今日建議的一餐；收起明細後已展開的大類仍展開；360 寬
  await foodsSub("cook");
  await until(`!!document.querySelector('#foods-body details.foods-major')`, "8-7 自煮沒有大類");
  check(await js(`[...document.querySelectorAll('#foods-body details.foods-major')].every((d) => !d.open)`), "8-7 自煮的大類預設要收合");
  check(/^豆魚蛋肉類（\d+）$/.test(await js(`document.querySelector('${sectionSel("cook:protein")} > summary').innerText`)), "8-7 大類標題沒有筆數");
  await shot("我的食物-自煮收合");
  const breastName = await showTreeItem("cook", "chicken_breast");
  await openSection("cook:vegetable");
  await openFood(breastName);
  const breast = await foodRowText(breastName);
  check(breast.indexOf("1 份（代換表）＝生重 30g") !== -1 && breast.indexOf("今日建議的一餐：生重 130g") !== -1, "8-7 雞胸明細沒有生重份量或今日建議的一餐");
  check(!/TFDA|×|decisions/.test(breast), "8-7 雞胸明細有開發註記");
  await shot("我的食物-自煮雞胸", "#foods-body .food-detail");
  await openFood(breastName); // 收起明細
  check(await js(`document.querySelector('${sectionSel("cook:protein")}').open && document.querySelector('${sectionSel("cook:vegetable")}').open`), "8-7 收起明細後已展開的大類被收合（審核 M3）");
  check((await js(text(sectionSel("cook:vegetable")))).indexOf("筍與莖菜（本 App 自己的分組）") !== -1, "8-7 蔬菜類沒有標「本 App 自己的分組」");
  const avocado = await showTreeItem("cook", "fx_avocado");
  await openFood(avocado);
  check((await foodRowText(avocado)).indexOf("加州（Hass）酪梨") !== -1, "8-7 酪梨明細沒有台灣品種的說明");
  await openFood(avocado);
  await send("Emulation.setDeviceMetricsOverride", { width: 360, height: 780, deviceScaleFactor: 2, mobile: true });
  await new Promise((r) => setTimeout(r, 300));
  check(await js(`(() => { const t = document.getElementById('foods-subtabs'); return t.scrollWidth <= t.clientWidth + 1 && [...t.querySelectorAll('button')].every((b) => b.scrollWidth <= b.clientWidth + 1 && getComputedStyle(b).whiteSpace === 'nowrap'); })()`), "8-7 360 寬的子分頁列溢出或折行");
  await shot("我的食物-自煮360寬", sectionSel("cook:protein"));
  await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await new Promise((r) => setTimeout(r, 300));

  // 8-8 標「白米」不吃：fx_ 的訊息；那一列在「你標了不吃」展開並在畫面內；「也標不吃」白粥在畫面內 → 按；全部清單兩筆；取消與「也取消」
  const rice = await showTreeItem("cook", "fx_rice");
  const congee = await js(`(async () => (await (await import('./js/data/catalog.js')).loadCatalog()).foodTree.byId.fx_congee.name)()`);
  await openFood(rice);
  await inFoodRow(rice, "[data-foods-dislike]");
  await until(`!!document.querySelector('[data-foods-also-dislike="fx_congee"]')`, "8-8 標白米不吃後沒有「也標不吃」白粥");
  check((await js(text("#foods-status"))).indexOf("不影響推薦裡的其他食物") !== -1, "8-8 fx_ 品項標不吃的訊息不對（審核 M7）");
  check(await js(`!!document.querySelector('${sectionSel("cook:disliked")}[open] [data-foods-open="fx_rice"]')`), "8-8 白米沒有移到展開的「你標了不吃」");
  check(await inViewport('[data-foods-also-dislike="fx_congee"]'), "8-8 「也標不吃」不在畫面內（decisions #115）");
  await shot("我的食物-標白米之後");
  await click('[data-foods-also-dislike="fx_congee"]');
  await until(`document.querySelector('${sectionSel("cook:disliked")} > summary').innerText === "你標了不吃（2）"`, "8-8 也標白粥後「你標了不吃」不是 2 筆");
  const all88 = await js(`document.querySelector('.foods-disliked-all').textContent`);
  check(all88.indexOf(rice) !== -1 && all88.indexOf(congee) !== -1 && all88.indexOf("已不提供") === -1, "8-8 全部清單沒有白米、白粥的名稱");
  await inFoodRow(rice, "[data-foods-undislike]");
  await until(`!!document.querySelector('[data-foods-also-undislike="fx_congee"]')`, "8-8 取消白米後沒有「也取消」白粥");
  await click('[data-foods-also-undislike="fx_congee"]');
  await until(`(${dbDislikedKeys}).then((s) => JSON.parse(s).length === 0)`, "8-8 取消兩筆後不吃清單不是空的");

  // 8-9 飲品・水果：現成飲料 → 家裡的飲品 → 水果；全脂奶標不吃 → 同一個衛福部樣品的外帶鮮奶「也標不吃」→ 兩筆都在「你標了不吃」；取消
  await foodsSub("drinks");
  const order = await js(`(() => { const t = document.getElementById('foods-body').innerText; return [t.indexOf('現成飲料'), t.indexOf('家裡的飲品'), t.indexOf('水果類')]; })()`);
  check(order[0] !== -1 && order[0] < order[1] && order[1] < order[2], "8-9 飲品・水果的組順序不是 現成飲料 → 家裡的飲品 → 水果（decisions #114）：" + order.join(","));
  check(await js(`!document.querySelector('${sectionSel("drinks:fruit")}').open`), "8-9 水果要預設收合");
  await shot("我的食物-飲品水果", "#foods-body");
  const takeout = await js(`(async () => (await (await import('./js/data/catalog.js')).loadCatalog()).productsByUid.tw_dr08.name)()`);
  const wholeMilk = await js(`(async () => (await (await import('./js/data/catalog.js')).loadCatalog()).foodTree.byId.fx_whole_milk.name)()`);
  await openFood(wholeMilk);
  check((await foodRowText(wholeMilk)).indexOf("同一個衛福部樣品：" + takeout) !== -1, "8-9 全脂奶明細沒有提到外帶鮮奶");
  await inFoodRow(wholeMilk, "[data-foods-dislike]");
  await until(`!!document.querySelector('[data-foods-also-dislike="tw_dr08"]')`, "8-9 標全脂奶不吃後沒有「也標不吃」外帶鮮奶");
  check(await inViewport('[data-foods-also-dislike="tw_dr08"]'), "8-9 「也標不吃」不在畫面內");
  await click('[data-foods-also-dislike="tw_dr08"]');
  await until(`document.querySelector('${sectionSel("drinks:disliked")} > summary').innerText === "你標了不吃（2）"`, "8-9 也標外帶鮮奶後「你標了不吃」不是 2 筆");
  await shot("我的食物-鮮奶兩筆不吃", sectionSel("drinks:disliked"));
  await inFoodRow(wholeMilk, "[data-foods-undislike]");
  await until(`!!document.querySelector('[data-foods-also-undislike="tw_dr08"]')`, "8-9 取消全脂奶後沒有「也取消」外帶鮮奶");
  await click('[data-foods-also-undislike="tw_dr08"]');
  await until(`(${dbDislikedKeys}).then((s) => JSON.parse(s).length === 0)`, "8-9 取消兩筆後不吃清單不是空的");

  // 8-10 搜尋：鮮奶兩筆都有、標位置；水餃皮寫出別名；芭樂乾明細有「有加糖」
  await foodsSearch("鮮奶");
  await until(`!!document.querySelector('#foods-body [data-foods-open="fx_whole_milk"]') && !!document.querySelector('#foods-body [data-foods-open="tw_dr08"]')`, "8-10 搜尋鮮奶沒有兩筆");
  check((await js(text("#foods-body"))).indexOf("飲品・水果 · 家裡的飲品") !== -1, "8-10 搜尋結果沒有標家裡的飲品");
  await foodsSearch("水餃皮");
  await until(`!!document.querySelector('#foods-body [data-foods-open="fx_dumpling_wrapper"]')`, "8-10 搜尋水餃皮沒有餃子皮");
  check((await js(text("#foods-body"))).indexOf("別名：水餃皮") !== -1, "8-10 別名命中沒有寫出別名");
  await shot("我的食物-搜尋別名");
  await foodsSearch("芭樂乾");
  await until(`!!document.querySelector('#foods-body [data-foods-open="fx_dried_guava"]')`, "8-10 搜尋芭樂乾沒有結果");
  await click('#foods-body [data-foods-open="fx_dried_guava"]');
  check((await js(text("#foods-body .food-detail"))).indexOf("衛福部樣品：有加糖") !== -1, "8-10 芭樂乾明細沒有「有加糖」");
  await foodsSearch("");

  // 8-11 設過敏原「蛋」：美乃滋「含過敏原」、明細「蛋；其他成分未確認」；蛋奶素：雞胸「不符合你的飲食設定」、素雞塊「飲食限制未確認」；還原
  await tab("profile");
  await setAllergens(["蛋"]);
  await submitProfile();
  await until(`${text("#target-kcal")} === "1896.1"`, "8-11 設過敏原後按計算沒有完成");
  await tab("foods");
  await foodsSub("cook");
  const mayo = await showTreeItem("cook", "fx_mayonnaise");
  await until(`(${foodRow(mayo)}) && (${foodRow(mayo)}).innerText.indexOf("含過敏原") !== -1`, "8-11 美乃滋列上沒有「含過敏原」");
  await openFood(mayo);
  check((await foodRowText(mayo)).indexOf("過敏原：蛋；其他成分未確認") !== -1, "8-11 美乃滋明細的過敏原把蛋蓋掉了（decisions #117）");
  await shot("我的食物-設蛋之後", "#foods-body .food-detail");
  await openFood(mayo);
  await tab("profile");
  await setAllergens([]);
  await js(`(() => { const s = document.querySelector('select[name=diet_restriction]'); s.value = '蛋奶素'; s.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  await submitProfile();
  await until(`${text("#target-kcal")} === "1896.1"`, "8-11 設蛋奶素後按計算沒有完成");
  await tab("foods");
  await foodsSub("cook");
  const nugget = await showTreeItem("cook", "fx_vegetarian_nugget");
  await showTreeItem("cook", "chicken_breast");
  await until(`(${foodRow(breastName)}) && (${foodRow(breastName)}).innerText.indexOf("不符合你的飲食設定") !== -1`, "8-11 蛋奶素時雞胸的灰字不是「不符合你的飲食設定」");
  check((await foodRowText(nugget)).indexOf("飲食限制未確認") !== -1, "8-11 蛋奶素時素雞塊的灰字不是「飲食限制未確認」");
  await shot("我的食物-蛋奶素", sectionSel("cook:protein"));
  await tab("profile");
  await js(`(() => { const s = document.querySelector('select[name=diet_restriction]'); s.value = '一般'; s.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  await submitProfile();
  await until(`${text("#target-kcal")} === "1896.1"`, "8-11 還原飲食設定後按計算沒有完成");


  // ---------- 9. 單品（工作線 D 切片 7，計畫 docs/review/2026-10-01-D7-實作計畫.md 第 4 節、第 8 節） ----------
  console.log("[9. 單品]");
  const foodCardSel = (uid, inResults) => "#meal-picker-drinks " + (inResults ? "#meal-picker-food-results " : "") + "[data-food-uid=" + uid + "]";
  const foodCardText = (uid, inResults) => js(`(() => { const el = document.querySelector(${JSON.stringify(foodCardSel(uid, inResults))}); return el ? el.innerText.replace(/\\s+/g, " ") : null; })()`);
  const foodSearch = (q) => js(`(() => { const el = document.getElementById('meal-picker-food-search'); el.value = ${JSON.stringify(q)}; el.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  const pickFood = async (uid, q) => {
    if (q) { await foodSearch(q); await until(`!!document.querySelector(${JSON.stringify(foodCardSel(uid, true))})`, "搜尋「" + q + "」沒有 " + uid); }
    await click(foodCardSel(uid, !!q));
  };
  const stepFoodBtn = (uid, dir, times) => js(`(() => { for (let i = 0; i < ${times || 1}; i++) document.querySelector('#meal-picker-drinks [data-food-step=${uid}][data-dir="${dir}"]').click(); })()`);
  const pickedFoodText = (uid) => js(`(() => { const el = document.getElementById('food-sel-${uid}'); return el ? el.innerText.replace(/\\s+/g, " ") : null; })()`);
  const stepDisabled = (uid, dir) => js(`document.querySelector('#meal-picker-drinks [data-food-step=${uid}][data-dir="${dir}"]').disabled`);
  const kcalOfFoods = (list) => js(`(async () => { const mc = await import('./js/engine/meal-content.js'); const c = await (await import('./js/data/catalog.js')).loadCatalog();
    return Math.round(mc.contentTotals(mc.buildDraftContent({ kind: 'products', meal_type: 'convenience', items: [], estimates: [], foods: ${JSON.stringify(list)}.map((f) => ({ item: c.foodTree.byId[f[0]], qty: f[1] })) }), c).kcal); })()`);
  const loggedName = (slot) => js(`(() => { const t = document.getElementById('rec-${slot}').innerText; const m = t.match(/已記錄：(.+?)（約/); return m ? m[1] : t; })()`);
  const submitAndUndo = async (slot, label) => {
    await click("#meal-picker-submit");
    await until(`${text("#rec-" + slot)}.indexOf("已記錄") !== -1 && !!document.querySelector('#rec-${slot} .rec-undo-btn')`, label + " 送出後沒有變成已記錄");
    const name = await loggedName(slot);
    await click(`#rec-${slot} .rec-undo-btn`);
    await until(`!!document.querySelector('#rec-${slot} .rec-pick-btn')`, label + " 撤銷後沒有回到推薦");
    return name;
  };
  const foodSectionSel = (key) => `#meal-picker-drinks details[data-food-section="${key}"]`;
  const openFoodSection = async (key) => {
    if (!(await js(`!!document.querySelector('${foodSectionSel(key)}[open]')`))) await click(foodSectionSel(key) + " > summary");
    await until(`!!document.querySelector('${foodSectionSel(key)}[open] .item-card, ${foodSectionSel(key)}[open] details')`, "展開 " + key + " 沒有內容");
  };
  const treeInfo = (id) => js(`(async () => { const c = await (await import('./js/data/catalog.js')).loadCatalog(); const it = c.foodTree.byId[${JSON.stringify(id)}]; return { name: it.name, group: it.group, subgroup: it.subgroup }; })()`);
  const stepLabels = () => js(`[...document.querySelectorAll('#meal-picker-overlay .meal-picker-step-label')].filter((el) => el.offsetParent !== null).map((el) => el.textContent).join("|")`);

  await tab("today");
  await until(`!!document.querySelector("#rec-dinner .rec-log-btn, #rec-dinner .rec-undo-btn")`, "9 今日建議沒有畫出來");
  // 前面的節次留下的紀錄先撤銷（第 9 節要用午餐、晚餐的「自己選」）
  for (const s of ["lunch", "dinner"]) {
    if (await js(`!!document.querySelector("#rec-${s} .rec-undo-btn")`)) {
      await click(`#rec-${s} .rec-undo-btn`);
      await until(`!!document.querySelector("#rec-${s} .rec-pick-btn")`, "9 開頭撤銷" + s + "沒有回到推薦");
    }
  }
  // 9-1 步驟名稱與編號：三個分頁都連續；自煮不選餐型、選了餐型都連續；手機打開看得到取消與記下
  await openPicker("lunch");
  await click(`#meal-picker-tabs [data-tab=convenience]`);
  await checkStepNumbers("9-1 超商");
  check(/2\. 加飲品・水果（選填）\|3\. 加點單品（選填）$/.test(await stepLabels()), "9-1 超商分頁的步驟名稱不對：" + (await stepLabels()));
  check(await inViewport("#meal-picker-submit") && await inViewport("#meal-picker-cancel"), "9-1 打開選擇器看不到「取消」「記下這餐」");
  await click(`#meal-picker-tabs [data-tab=delivery]`);
  await checkStepNumbers("9-1 外食");
  await click(`#meal-picker-tabs [data-tab=cook]`);
  await checkStepNumbers("9-1 自煮沒選餐型");
  check((await js(text("#meal-picker-panel"))).indexOf("只記單品可以不選餐型，直接到下面加點單品") !== -1, "9-1 自煮「選餐型」上方沒有只記單品的說明");
  check(/3\. 加飲品・水果（選填）\|4\. 加點單品（選填）$/.test(await stepLabels()), "9-1 自煮沒選餐型的步驟不是 3、4：" + (await stepLabels()));
  await cookPick("archetype");
  await checkStepNumbers("9-1 自煮選了餐型");
  check(/加飲品・水果（選填）\|\d+\. 加點單品（選填）$/.test(await stepLabels()), "9-1 自煮選了餐型後兩個共用步驟不在最後");
  await shot("單品-步驟編號", "#meal-picker-panel");
  await closePicker();

  // 9-2 飲品・水果：現成飲料 → 家裡的飲品 → 水果（收著）；全脂奶 2 份；連點兩張卡片；送出名稱
  await openPicker("lunch");
  await click(`#meal-picker-tabs [data-tab=convenience]`);
  const heads = await js(`[...document.querySelectorAll('#meal-picker-drinks .meal-picker-role')].map((h) => h.textContent).join(",")`);
  check(heads.indexOf("現成飲料,家裡的飲品") === 0, "9-2 飲品・水果步驟的順序不是現成飲料 → 家裡的飲品：" + heads);
  check(await js(`!!document.querySelector('${foodSectionSel("fruit:fruit")}') && !document.querySelector('${foodSectionSel("fruit:fruit")}[open]')`), "9-2 水果不是收著的");
  await pickFood("fx_whole_milk");
  check((await foodCardText("fx_whole_milk")).indexOf("已選 · 1 份") !== -1 && (await foodCardText("fx_whole_milk")).indexOf("代換表 1 份 · 240ml") !== -1, "9-2 全脂奶卡片沒有標「已選 · 1 份」或份量：" + (await foodCardText("fx_whole_milk")));
  await stepFoodBtn("fx_whole_milk", 1, 2);
  check((await pickedFoodText("fx_whole_milk")).indexOf("2 份＝480ml（2杯）") !== -1, "9-2 全脂奶 2 份的說明不對：" + (await pickedFoodText("fx_whole_milk")));
  const milk2 = await kcalOfFoods([["fx_whole_milk", 2]]);
  check((await js(text("#meal-picker-summary"))).indexOf("已選 1 件 · 約 " + milk2 + " kcal") !== -1, "9-2 全脂奶 2 份的摘要不是約 " + milk2 + " kcal：" + (await js(text("#meal-picker-summary"))));
  await shot("單品-全脂奶2份", "#meal-picker-drinks");
  // 連點兩張卡片（審核 S2）：點的那張留在畫面裡
  await pickFood("fx_lowfat_milk");
  await pickFood("fx_skim_milk");
  check(await inViewport(foodCardSel("fx_skim_milk")), "9-2 連點兩張卡片後，剛點的那張不在畫面裡（捲動錨點補償）");
  await shot("單品-連點兩張", foodCardSel("fx_skim_milk"));
  await click(`#meal-picker-drinks [data-food-remove=fx_lowfat_milk]`);
  await click(`#meal-picker-drinks [data-food-remove=fx_skim_milk]`);
  check((await submitAndUndo("lunch", "9-2")) === "全脂奶（自己倒） 480ml", "9-2 紀錄名稱不是「全脂奶（自己倒） 480ml」");

  // 9-3 加點單品：大類收著有筆數、水果不在這一步；搜尋白飯；步進器 0.5–12；再點捲到步進器；移除
  await openPicker("lunch");
  await click(`#meal-picker-tabs [data-tab=convenience]`);
  const majors = await js(`[...document.querySelectorAll('#meal-picker-drinks details[data-food-section^="cook:"]')].map((d) => (d.open ? "open:" : "") + d.querySelector('summary').textContent)`);
  check(majors.length >= 5 && majors.every((t) => /（\d+）$/.test(t) && t.indexOf("open:") !== 0) && majors.every((t) => t.indexOf("水果") === -1), "9-3 大類不是收著、沒有筆數，或水果在加點單品：" + majors.join(","));
  check((await js(text("#meal-picker-drinks"))).indexOf("單品不含烹調用油；有用油可以加油脂類") !== -1, "9-3 加點單品沒有用油的說明");
  await foodSearch("白飯");
  await until(`!!document.querySelector(${JSON.stringify(foodCardSel("fx_cooked_rice", true))})`, "9-3 搜尋白飯沒有結果");
  check((await foodCardText("fx_cooked_rice", true)).indexOf("代換表 1 份 · 熟重 40g · 約 73 kcal") !== -1, "9-3 白飯卡片：" + (await foodCardText("fx_cooked_rice", true)));
  await click(foodCardSel("fx_cooked_rice", true));
  await stepFoodBtn("fx_cooked_rice", 1, 6);
  check((await pickedFoodText("fx_cooked_rice")).indexOf("4 份＝熟重 160g（1碗）") !== -1, "9-3 白飯 4 份的說明不對：" + (await pickedFoodText("fx_cooked_rice")));
  await shot("單品-白飯4份", "#food-sel-fx_cooked_rice");
  // 360 寬：步進器、份量說明不橫捲（shot 會檢查左右溢出與 44px）
  await send("Emulation.setDeviceMetricsOverride", { width: 360, height: 780, deviceScaleFactor: 2, mobile: true });
  await shot("單品-白飯4份-360寬", "#food-sel-fx_cooked_rice");
  await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await stepFoodBtn("fx_cooked_rice", 1, 20);
  check((await pickedFoodText("fx_cooked_rice")).indexOf("12 份＝熟重 480g（3碗）") !== -1 && await stepDisabled("fx_cooked_rice", 1), "9-3 白飯到 12 份時 ＋ 沒停用或說明不對：" + (await pickedFoodText("fx_cooked_rice")));
  await stepFoodBtn("fx_cooked_rice", -1, 1);
  check((await pickedFoodText("fx_cooked_rice")).indexOf("11.5 份") !== -1 && !(await stepDisabled("fx_cooked_rice", 1)), "9-3 從 12 按 − 沒有回到 11.5、＋ 沒恢復");
  await stepFoodBtn("fx_cooked_rice", -1, 30);
  const half = await pickedFoodText("fx_cooked_rice");
  check(half.indexOf("0.5 份＝熟重 20g") !== -1 && half.indexOf("碗") === -1 && await stepDisabled("fx_cooked_rice", -1), "9-3 0.5 份時 − 沒停用、或寫了 1/8 碗：" + half);
  await click(foodCardSel("fx_cooked_rice", true));
  check((await js(`document.querySelectorAll('#food-sel-fx_cooked_rice').length`)) === 1 && (await pickedFoodText("fx_cooked_rice")).indexOf("0.5 份") !== -1, "9-3 再點已選的白飯多了一筆或份量變了");
  await until(`(() => { const r = document.querySelector('#food-sel-fx_cooked_rice .food-stepper').getBoundingClientRect(); return r.top >= 0 && r.bottom <= window.innerHeight; })()`, "9-3 再點已選的白飯沒有捲到它的步進器");
  await click(`#meal-picker-drinks [data-food-remove=fx_cooked_rice]`);
  check(!(await js(`!!document.getElementById('food-sel-fx_cooked_rice')`)) && (await foodCardText("fx_cooked_rice", true)).indexOf("已選") === -1, "9-3 移除後白飯還在已選框或卡片還標已選");
  // 兩層收合裡連點兩張卡片（審核 S2）
  const riceInfo = await treeInfo("fx_cooked_rice");
  await foodSearch("");
  await openFoodSection("cook:" + riceInfo.group);
  await openFoodSection("cook:" + riceInfo.group + ":" + riceInfo.subgroup);
  await click(foodCardSel("fx_cooked_rice") + ":not([disabled])");
  await click(`#meal-picker-drinks details[data-food-section="cook:${riceInfo.group}:${riceInfo.subgroup}"] [data-food-uid=brown_rice_cooked]`);
  check(await inViewport(`#meal-picker-drinks details [data-food-uid=brown_rice_cooked]`), "9-3 在分類裡連點兩張卡片後，剛點的那張不在畫面裡");
  check((await pickedFoodText("brown_rice_cooked")).indexOf("1 份＝內建一餐 熟重 150g") !== -1, "9-3 糙米飯的說明不是「1 份＝內建一餐 熟重 150g」：" + (await pickedFoodText("brown_rice_cooked")));
  await shot("單品-分類裡連點", `#meal-picker-drinks details [data-food-uid=brown_rice_cooked]`);
  await closePicker();

  // 9-4 自煮只記單品；半套餐型＋單品擋下並提示取消；再點餐型取消；完整餐型＋單品＋飲料的名稱順序
  await openPicker("dinner");
  await click(`#meal-picker-tabs [data-tab=cook]`);
  await pickFood("fx_cooked_rice", "白飯");
  await stepFoodBtn("fx_cooked_rice", 1, 6);
  check(!(await js(`document.getElementById('meal-picker-submit').disabled`)) && (await js(text("#meal-picker-summary"))).indexOf("已選 1 件 · 約 293 kcal") === 0, "9-4 自煮只選單品不能送出或摘要不對：" + (await js(text("#meal-picker-summary"))));
  check((await submitAndUndo("dinner", "9-4")) === "白飯 160g", "9-4 自煮只記單品的名稱不是「白飯 160g」");
  await openPicker("dinner");
  await click(`#meal-picker-tabs [data-tab=cook]`);
  await cookPick("archetype");
  const archName = await js(`document.querySelector('#meal-picker-panel .compose-option[data-axis=archetype][aria-pressed=true]').textContent`);
  await pickFood("fx_cooked_rice", "白飯");
  check(await js(`document.getElementById('meal-picker-submit').disabled`) && (await js(text("#meal-picker-hint"))).indexOf("只記單品可以再點一次「" + archName + "」取消餐型") !== -1, "9-4 半套餐型＋單品沒有擋下或沒有取消餐型的提示：" + (await js(text("#meal-picker-hint"))));
  await shot("單品-半套餐型", "#meal-picker-hint");
  await click(`#meal-picker-panel .compose-option[data-axis=archetype][aria-pressed=true]`);
  check(!(await js(`!!document.querySelector('#meal-picker-panel .compose-option[data-axis=archetype][aria-pressed=true]')`)) && !(await js(`document.getElementById('meal-picker-submit').disabled`)) && !!(await pickedFoodText("fx_cooked_rice")),
    "9-4 再點餐型沒有取消、單品不見了或不能送出");
  // 完整餐型＋單品＋飲料：名稱是 餐型與食材 → 單品 → 飲料
  await cookPick("archetype");
  await cookFill(["protein", "staple", "method"]);
  await pickFood("fx_whole_milk");
  await stepFoodBtn("fx_whole_milk", 1, 2);
  await click(`#meal-picker-drinks [data-drink="tw_dr05"]`);
  check(!(await js(`document.getElementById('meal-picker-submit').disabled`)), "9-4 完整餐型＋單品＋飲料不能送出：" + (await js(text("#meal-picker-hint"))));
  const fullName = await submitAndUndo("dinner", "9-4 完整");
  check(new RegExp("^" + archName + "＋.+＋白飯 40g＋全脂奶（自己倒） 480ml＋[^＋]+$").test(fullName), "9-4 完整餐型＋單品＋飲料的名稱順序不對：" + fullName);

  // 9-5 上限：第 5 項 alert；4 項單品＋主餐＋配菜＋飲料可以送出
  await openPicker("lunch");
  await click(`#meal-picker-tabs [data-tab=convenience]`);
  await pickFood("fx_cooked_rice", "白飯");
  await pickFood("fx_skim_milk");
  await pickFood("fx_soft_tofu", "嫩豆腐");
  await pickFood("fx_whole_milk");
  const dlgBefore = H.dialogs.length;
  await pickFood("fx_banana", "香蕉");
  check(H.dialogs.length === dlgBefore + 1 && H.dialogs[H.dialogs.length - 1] === "單品最多選 4 項。", "9-5 第 5 項單品沒有出現「單品最多選 4 項。」");
  check((await js(`document.querySelectorAll('#meal-picker-drinks [id^=food-sel-]').length`)) === 4, "9-5 第 5 項被加進去了");
  const main5 = (await passUids("main"))[0], side5 = (await passUids("side"))[0];
  await click(`#meal-picker-panel .item-card[data-uid=${main5}]`);
  if (side5) await click(`#meal-picker-panel .item-card[data-uid=${side5}]`);
  await click(`#meal-picker-drinks [data-drink="tw_dr05"]`);
  check(!(await js(`document.getElementById('meal-picker-submit').disabled`)) && (await js(text("#meal-picker-summary"))).indexOf("已選 " + (side5 ? 7 : 6) + " 件") === 0, "9-5 4 項單品＋主餐＋配菜＋飲料不能送出或件數不對：" + (await js(text("#meal-picker-summary"))));
  await shot("單品-上限", "#meal-picker-drinks");
  await closePicker();

  // 9-6 過敏原灰字；不吃組（飲品・水果步驟合併一組、加點單品自己一組）；取消不吃；搜尋標「在飲品・水果」
  await tab("profile");
  await setAllergens(["蛋"]);
  await submitProfile();
  await until(`${text("#target-kcal")} === "1896.1"`, "9-6 設蛋過敏後按計算沒有完成");
  await openPicker("lunch");
  await click(`#meal-picker-tabs [data-tab=convenience]`);
  await foodSearch("美乃滋");
  await until(`!!document.querySelector(${JSON.stringify(foodCardSel("fx_mayonnaise", true))})`, "9-6 搜尋美乃滋沒有結果");
  check(await js(`document.querySelector(${JSON.stringify(foodCardSel("fx_mayonnaise", true))}).disabled`) && (await foodCardText("fx_mayonnaise", true)).indexOf("含過敏原") !== -1, "9-6 設蛋過敏時美乃滋沒有灰掉、寫「含過敏原」");
  await foodSearch("火腿");
  await until(`!!document.querySelector(${JSON.stringify(foodCardSel("fx_ham", true))})`, "9-6 搜尋火腿沒有結果");
  check(await js(`document.querySelector(${JSON.stringify(foodCardSel("fx_ham", true))}).disabled`) && (await foodCardText("fx_ham", true)).indexOf("成分未確認") !== -1, "9-6 設蛋過敏時火腿沒有寫「成分未確認」");
  await shot("單品-過敏原灰字", "#meal-picker-food-results");
  await closePicker();
  await tab("profile");
  await setAllergens([]);
  await submitProfile();
  await until(`${text("#target-kcal")} === "1896.1"`, "9-6 取消過敏原後按計算沒有完成");
  await js(`(async () => { const m = await import('./js/data/db.js');
    await m.addDislikedIngredient({ type: 'food_tree', key: 'fx_rice', label: '白米' });
    await m.addDislikedIngredient({ type: 'food_tree', key: 'fx_orange', label: '柳丁' });
    await m.addDislikedIngredient({ type: 'item', key: 'tw_dr05', label: '拿鐵' }); })()`);
  await openPicker("lunch");
  await click(`#meal-picker-tabs [data-tab=convenience]`);
  const groups = await js(`[...document.querySelectorAll('#meal-picker-drinks details.meal-picker-disliked')].map((d) => [...d.querySelectorAll('[data-drink], [data-food-uid]')].map((b) => b.dataset.drink || b.dataset.foodUid).sort().join(","))`);
  const inG = (i, u) => (groups[i] || "").split(",").indexOf(u) !== -1;
  check(groups.length === 2 && inG(0, "tw_dr05") && inG(0, "fx_orange") && !inG(0, "fx_rice") && inG(1, "fx_rice") && !inG(1, "tw_dr05") && !inG(1, "fx_orange"), "9-6 不吃組不是「飲品・水果合併一組＋加點單品一組」：" + JSON.stringify(groups));
  check(!(await js(`!!document.querySelector('#meal-picker-drinks [data-dislike-uid^="fx_"]')`)), "9-6 選擇器裡的單品有「不吃」按鈕");
  await js(`document.querySelectorAll('#meal-picker-drinks details.meal-picker-disliked').forEach((d) => { d.open = true; })`);
  await shot("單品-不吃組", "#meal-picker-drinks details.meal-picker-disliked");
  await click(`#meal-picker-drinks [data-undislike-uid=fx_rice]`);
  await until(`![...document.querySelectorAll('#meal-picker-drinks details.meal-picker-disliked [data-food-uid]')].some((b) => b.dataset.foodUid === 'fx_rice')`, "9-6 取消不吃後白米還在不吃組");
  check(JSON.parse(await js(dbDislikedKeys)).indexOf("fx_rice") === -1, "9-6 取消不吃沒有寫進資料庫");
  await js(`(async () => { const m = await import('./js/data/db.js'); await m.removeDislikedIngredient('fx_orange'); await m.removeDislikedIngredient('tw_dr05'); })()`);
  await closePicker();
  await openPicker("lunch");
  await click(`#meal-picker-tabs [data-tab=convenience]`);
  await foodSearch("柳丁");
  await until(`!!document.querySelector(${JSON.stringify(foodCardSel("fx_orange", true))})`, "9-6 加點單品搜尋柳丁沒有結果");
  check((await foodCardText("fx_orange", true)).indexOf("在飲品・水果") !== -1, "9-6 搜尋到的柳丁沒有標「在飲品・水果」");
  await click(foodCardSel("fx_orange", true));
  check((await pickedFoodText("fx_orange")) !== null, "9-6 搜尋結果的柳丁點了沒有選進去");
  await stepFoodBtn("fx_orange", 1, 6);
  check((await pickedFoodText("fx_orange")).indexOf("4 份＝可食部分 520g（4個，購買量約 680g）") !== -1, "9-6 柳丁 4 份的說明不對：" + (await pickedFoodText("fx_orange")));
  check((await submitAndUndo("lunch", "9-6")) === "柳丁 520g", "9-6 柳丁的紀錄名稱不是「柳丁 520g」");

  // 9-7 份／克切換（切片 8b，decisions #136）：白飯 2 份 → 克（80）→ 改 95 → 切回份（2.5）→ 再切克改 95 送出「白飯 95g」；全脂奶是「毫升」
  await openPicker("lunch");
  await click(`#meal-picker-tabs [data-tab=convenience]`);
  await pickFood("fx_cooked_rice", "白飯");
  await stepFoodBtn("fx_cooked_rice", 1, 2);
  const modeOn = (uid) => js(`(() => { const b = document.querySelector('#food-sel-${uid} [data-food-mode][aria-pressed="true"]'); return b ? b.textContent : null; })()`);
  check((await modeOn("fx_cooked_rice")) === "份", "9-7 已選的白飯預設不是「份」");
  await click(`#food-sel-fx_cooked_rice [data-food-mode][aria-pressed="false"]`);
  check((await modeOn("fx_cooked_rice")) === "克" && (await js(`document.querySelector('#food-sel-fx_cooked_rice .food-amount-input').value`)) === "80", "9-7 白飯 2 份切成克不是 80");
  const setAmount = (uid, v) => js(`(() => { const el = document.querySelector('#food-sel-${uid} .food-amount-input'); el.value = ${JSON.stringify(String(v))}; el.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  await setAmount("fx_cooked_rice", 95);
  await until(`(document.getElementById('food-sel-fx_cooked_rice') || {}).innerText.indexOf("熟重 95g") !== -1`, "9-7 白飯改成 95 後說明不是「熟重 95g」");
  await shot("單品-克數記法", "#food-sel-fx_cooked_rice");
  await send("Emulation.setDeviceMetricsOverride", { width: 360, height: 780, deviceScaleFactor: 2, mobile: true });
  await shot("單品-克數記法-360寬", "#food-sel-fx_cooked_rice");
  await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  check((await foodCardText("fx_cooked_rice", true)).indexOf("已選 · 95g") !== -1, "9-7 白飯卡片不是「已選 · 95g」：" + (await foodCardText("fx_cooked_rice", true)));
  await click(`#food-sel-fx_cooked_rice [data-food-mode][aria-pressed="false"]`);
  check((await pickedFoodText("fx_cooked_rice")).indexOf("2.5 份") !== -1, "9-7 95g 切回份不是 2.5 份：" + (await pickedFoodText("fx_cooked_rice")));
  await click(`#food-sel-fx_cooked_rice [data-food-mode][aria-pressed="false"]`);
  await setAmount("fx_cooked_rice", 95);
  await until(`(document.getElementById('food-sel-fx_cooked_rice') || {}).innerText.indexOf("熟重 95g") !== -1`, "9-7 第二次改 95 沒生效");
  await pickFood("fx_whole_milk", "全脂奶");
  await click(`#food-sel-fx_whole_milk [data-food-mode][aria-pressed="false"]`);
  check((await modeOn("fx_whole_milk")) === "毫升" && (await js(`document.querySelector('#food-sel-fx_whole_milk .food-amount-input').value`)) === "240", "9-7 全脂奶切換不是「毫升」240");
  await setAmount("fx_whole_milk", 300);
  await until(`(document.getElementById('food-sel-fx_whole_milk') || {}).innerText.indexOf("300ml") !== -1`, "9-7 全脂奶改 300 沒生效");
  check((await submitAndUndo("lunch", "9-7")) === "白飯 95g＋全脂奶（自己倒） 300ml", "9-7 紀錄名稱不是「白飯 95g＋全脂奶（自己倒） 300ml」");


  // ---------- 10. 我的組合（工作線 C，計畫 docs/review/2026-10-01-C-實作計畫.md 第 4 節、第 8 節） ----------
  console.log("[10. 我的組合]");
  await tab("today");
  for (const s of ["lunch", "dinner"]) {
    if (await js(`!!document.querySelector("#rec-${s} .rec-undo-btn")`)) {
      await click(`#rec-${s} .rec-undo-btn`);
      await until(`!!document.querySelector("#rec-${s} .rec-pick-btn")`, "10 開頭撤銷" + s + "沒有回到推薦");
    }
  }
  const savedNames = () => js(`[...document.querySelectorAll('#foods-saved .saved-item-name')].map((e) => e.textContent).join("|")`);
  // 10-1 入口 1：還沒有組合時選擇器沒有組合列；選主餐＋單品，勾「存成組合」→ 名稱預填品名（不寫量）→ 送出
  await openPicker("lunch");
  await click(`#meal-picker-tabs [data-tab=convenience]`);
  check(!(await js(`!!document.querySelector('#meal-picker-panel .saved-row')`)), "10-1 還沒有組合時選擇器出現組合列");
  const main10 = (await passUids("main"))[0];
  await click(`#meal-picker-panel .item-card[data-uid=${main10}]`);
  await click(`#meal-picker-drinks [data-food-uid=fx_whole_milk]`);
  await click(`#meal-picker-drinks [data-save-as]`);
  const name10 = await js(`document.getElementById('meal-picker-save-name').value`);
  check(/全脂奶（自己倒）$/.test(name10) && !/ml|g$/.test(name10), "10-1 預設名稱不是只寫品名：" + name10);
  await shot("組合-存成組合", "#meal-picker-drinks .save-as");
  await click("#meal-picker-submit");
  await until(`${text("#rec-lunch")}.indexOf("已記錄") !== -1`, "10-1 勾存成組合送出後午餐沒有記錄");
  await click(`#rec-lunch .rec-undo-btn`);
  await until(`!!document.querySelector('#rec-lunch .rec-pick-btn')`, "10-1 撤銷後午餐沒有回到推薦");
  // 10-2 帶入：晚餐打開，最上面一列有組合（型態、熱量）；點了切到超商、帶入兩件；360 寬不讓整頁橫捲
  await openPicker("dinner");
  await until(`!!document.querySelector('#meal-picker-panel .saved-card')`, "10-2 選擇器最上面沒有組合卡片");
  const card10 = await js(`document.querySelector('#meal-picker-panel .saved-card').innerText.replace(/\\s+/g, " ")`);
  check(card10.indexOf("超商 · 約") !== -1 && /kcal/.test(card10), "10-2 組合卡片沒有型態或熱量：" + card10);
  await shot("組合-選擇器組合列", "#meal-picker-panel");
  await send("Emulation.setDeviceMetricsOverride", { width: 360, height: 780, deviceScaleFactor: 2, mobile: true });
  await shot("組合-選擇器組合列-360寬", "#meal-picker-panel");
  await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await click(`#meal-picker-panel .saved-card`);
  check((await currentTab()) === "convenience" && (await js(text("#meal-picker-summary"))).indexOf("已選 2 件") === 0 && !!(await js(`document.getElementById('food-sel-fx_whole_milk')`)),
    "10-2 帶入後不是超商分頁、已選 2 件與全脂奶：" + (await js(text("#meal-picker-summary"))));
  check((await js(text("#meal-picker-panel"))).indexOf("已帶入「" + name10 + "」") !== -1, "10-2 帶入後沒有說明");
  await shot("組合-帶入", "#meal-picker-panel");
  await closePicker();
  // 10-3 外食加了估算時「存成組合」不能勾
  await openPicker("lunch");
  await click(`#meal-picker-tabs [data-tab=delivery]`);
  await click(`#meal-picker-panel [data-estimate-size=M]`);
  check(await js(`document.querySelector('#meal-picker-drinks [data-save-as]').disabled`) && (await js(text("#meal-picker-drinks"))).indexOf("估算的一餐不能存成組合") !== -1, "10-3 有估算時「存成組合」沒有停用或沒有說明");
  await closePicker();
  // 10-4 入口 2：記推薦的午餐 → 卡片「存成組合」→ 名稱欄預填 → 存
  await until(`!!document.querySelector('#rec-lunch .rec-log-btn')`, "10-4 午餐沒有推薦可以記");
  await click(`#rec-lunch .rec-log-btn`);
  await until(`!!document.querySelector('#rec-lunch [data-save-log-id]')`, "10-4 已記錄的午餐沒有「存成組合」");
  await click(`#rec-lunch [data-save-log-id]`);
  await until(`!!document.getElementById('rec-save-name') && document.getElementById('rec-save-name').value !== ''`, "10-4 名稱沒有預填");
  await shot("組合-今日建議存成組合", "#rec-lunch");
  await click(`#rec-lunch [data-save-confirm]`);
  await until(`${text("#rec-lunch")}.indexOf("已存成組合") !== -1`, "10-4 沒有存成組合");
  await click(`#rec-lunch .rec-undo-btn`);
  await until(`!!document.querySelector('#rec-lunch .rec-pick-btn')`, "10-4 撤銷後午餐沒有回到推薦");
  // 10-5 管理區塊：最上方收著「我的組合（2）」；改名；編輯內容（編輯模式）存回；刪除與復原；已刪除還原
  await tab("foods");
  await until(`(document.querySelector('#foods-saved summary') || {}).textContent === "我的組合（2）"`, "10-5 我的食物沒有「我的組合（2）」區塊");
  check((await js(`document.querySelector('#foods-saved summary').textContent`)) === "我的組合（2）" && !(await js(`document.querySelector('#foods-saved details').open`)),
    "10-5 區塊不是收著的「我的組合（2）」");
  check(await js(`(() => { const a = document.getElementById('foods-saved').getBoundingClientRect().top, b = document.getElementById('foods-subtabs').getBoundingClientRect().top; return a < b; })()`), "10-5 管理區塊不在子分頁上面");
  await click(`#foods-saved details[data-saved-section=main] > summary`);
  await click(`#foods-saved [data-saved-rename]`);
  await js(`(() => { const el = document.getElementById('saved-rename-input'); el.value = '平日午餐'; el.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  await click(`#foods-saved [data-saved-rename-save]`);
  await until(`${text("#foods-saved")}.indexOf("已改名為「平日午餐」") !== -1`, "10-5 改名沒有完成");
  await shot("組合-管理區塊", "#foods-saved");
  await click(`#foods-saved [data-saved-edit]`);
  await until(`!document.getElementById('meal-picker-overlay').hidden`, "10-5 編輯內容沒有打開選擇器");
  check((await js(text("#meal-picker-title"))) === "編輯組合：平日午餐" && (await js(text("#meal-picker-submit"))) === "存回組合" &&
    (await js(text("#meal-picker-gap"))).indexOf("編輯組合不計算時段的配額") !== -1 && !(await js(`!!document.querySelector('.saved-row, .save-as')`)),
    "10-5 編輯模式的標題、送出鈕、配額說明不對，或還有組合列、存成組合");
  await shot("組合-編輯模式", "#meal-picker-panel");
  await click(`#meal-picker-drinks [data-food-step=fx_whole_milk][data-dir="1"]`);
  await click("#meal-picker-submit");
  await until(`document.getElementById('meal-picker-overlay').hidden && ${text("#foods-saved")}.indexOf("已存回「平日午餐」") !== -1`, "10-5 存回組合沒有完成");
  await click(`#foods-saved [data-saved-archive]`);
  await until(`${text("#foods-saved")}.indexOf("已刪除「平日午餐」") !== -1`, "10-5 刪除沒有提示");
  await shot("組合-刪除復原", "#foods-saved");
  await click(`#foods-saved .dislike-notice [data-saved-restore]`);
  await until(`${text("#foods-saved")}.indexOf("已還原「平日午餐」") !== -1`, "10-5 復原沒有完成");
  check((await savedNames()).split("|").length === 2, "10-5 復原後不是 2 筆：" + (await savedNames()));
  // 10-6 搜尋組合名稱 → 結果標「我的組合」，點了捲到管理區塊那一筆
  await js(`(() => { const el = document.getElementById('foods-search'); el.value = '平日'; el.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  await until(`!!document.querySelector('#foods-body [data-saved-goto]')`, "10-6 搜尋沒有組合結果");
  check((await js(text("#foods-body"))).indexOf("我的組合") !== -1 && (await js(text("#foods-body"))).indexOf("沒有符合") === -1, "10-6 組合結果沒有標「我的組合」或多了「沒有符合」");
  await click(`#foods-body [data-saved-goto]`);
  await until(`(() => { const r = document.querySelector('#foods-saved .saved-item'); if (!r) return false; const b = r.getBoundingClientRect(); return b.top >= 0 && b.bottom <= window.innerHeight; })()`, "10-6 點組合結果沒有捲到管理區塊");
  await js(`(() => { const el = document.getElementById('foods-search'); el.value = ''; el.dispatchEvent(new Event('input', { bubbles: true })); })()`);

  // ---------- 11. 常吃（工作線 D 切片 5，計畫 docs/review/2026-10-01-D5-實作計畫.md；放最後：前面各節不會看到常吃組，審核 S11） ----------
  console.log("[11. 常吃]");
  const DBW = `(await import('./js/data/db.js'))`;
  const dbFavs = () => js(`(async () => { const m = ${DBW}; return JSON.stringify(await m.getFavoriteRefs()); })()`).then(JSON.parse);
  // 11-1 我的食物超商：點開一列按「常吃」→ 搬到最上面的「常吃（1）」、按鈕變「取消常吃」、訊息；原分類不再出現
  await tab("foods");
  await foodsSub("convenience");
  await until(`!!document.querySelector('#foods-body .food-row-main')`, "11-1 超商子分頁沒有品項");
  const uid11 = await js(`[...document.querySelectorAll('#foods-body .food-row-main')].map((b) => b.dataset.foodsOpen).find((u) => /^conv_/.test(u))`);
  await click(`#foods-body [data-foods-open=${uid11}]`);
  const btnOrder = await js(`[...document.querySelector('#foods-body .food-detail .backup-actions').querySelectorAll('button')].map((b) => b.textContent).join(",")`);
  check(btnOrder === "常吃,複製成我的版本,不吃", "11-1 明細按鈕順序不是常吃、複製、不吃（審核 S13）：" + btnOrder);
  check((await js(text("#foods-body .food-detail"))).indexOf("常吃只影響自己選的排列。") !== -1, "11-1 明細沒有寫常吃的作用");
  await click(`#foods-body [data-foods-favorite=${uid11}]`);
  await until(`!!document.querySelector('#foods-body .foods-favorites [data-foods-unfavorite=${uid11}]')`, "11-1 標常吃後沒有在最上面的常吃組變成「取消常吃」");
  check((await js(`document.querySelector('#foods-body .foods-favorites h4').textContent`)) === "常吃（1）" &&
    (await js(`document.querySelectorAll('#foods-body [data-foods-open=${uid11}]').length`)) === 1, "11-1 常吃組標題不對，或那一列在原分類還出現");
  check((await js(text("#foods-status"))).indexOf("自己選會放在最上面") !== -1, "11-1 標常吃沒有訊息");
  await shot("常吃-我的食物", "#foods-body .foods-favorites");
  // 11-2 互斥：常吃的按「不吃」→ 移到不吃、訊息補一句；再取消不吃（不會自己變回常吃）
  await click(`#foods-body [data-foods-dislike=${uid11}]`);
  await until(`${text("#foods-status")}.indexOf("原本標的常吃已取消") !== -1`, "11-2 常吃的標不吃沒有說明常吃已取消");
  check((await dbFavs()).indexOf(uid11) === -1 && !(await js(`!!document.querySelector('#foods-body .foods-favorites')`)), "11-2 標不吃後常吃沒有拿掉");
  await click(`#foods-body [data-foods-undislike=${uid11}]`);
  await until(`!document.querySelector('#foods-body [data-foods-undislike=${uid11}]')`, "11-2 取消不吃沒有完成");
  // 11-3 自煮：白米標常吃 → 自煮子分頁最上面；長清單（審核 S13）：再標 10 樣超商，看 360 寬
  await foodsSearch("白米");
  await until(`!!document.querySelector('[data-foods-open="fx_rice"]')`, "11-3 搜尋白米沒有結果");
  await click(`[data-foods-open="fx_rice"]`);
  await click(`[data-foods-favorite="fx_rice"]`);
  await until(`!!document.querySelector('[data-foods-unfavorite="fx_rice"]')`, "11-3 白米標常吃沒有完成");
  check((await js(text("#foods-body"))).indexOf("常吃") !== -1, "11-3 搜尋結果沒有寫「常吃」");
  await foodsSearch("");
  await foodsSub("cook");
  await until(`!!document.querySelector('#foods-body .foods-favorites [data-foods-open="fx_rice"]')`, "11-3 自煮子分頁最上面沒有白米");
  await shot("常吃-自煮子分頁", "#foods-body .foods-favorites");
  const many = await js(`(async () => { const m = ${DBW}; const c = await (await import('./js/data/catalog.js')).loadCatalog();
    const us = c.products.filter((p) => p.channel === 'convenience' && p.role !== 'drink').slice(0, 10).map((p) => p.uid);
    for (const u of us) await m.addFavoriteRef(u); return us; })()`);
  await tab("today"); await tab("foods");
  await foodsSub("convenience");
  await until(`document.querySelectorAll('#foods-body .foods-favorites .food-row').length === ${many.length}`, "11-3 超商的常吃組不是 " + many.length + " 列");
  await send("Emulation.setDeviceMetricsOverride", { width: 360, height: 780, deviceScaleFactor: 2, mobile: true });
  await shot("常吃-我的食物長清單-360寬", "#foods-body .foods-favorites");
  await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  // 11-4 選擇器：超商「1. 選品項」最上面一組常吃（被擋的灰在組尾）；加點單品最上面有白米；步驟編號連續
  await openPicker("lunch");
  await click(`#meal-picker-tabs [data-tab=convenience]`);
  await until(`!!document.querySelector('#meal-picker-panel .meal-picker-favorites .item-card')`, "11-4 超商分頁沒有常吃組");
  const favCards = await js(`[...document.querySelectorAll('#meal-picker-panel .meal-picker-favorites .item-card')].map((b) => b.dataset.uid)`);
  const elsewhere = await js(`[...document.querySelectorAll('#meal-picker-panel .item-card[data-uid]')].filter((b) => !b.closest('.meal-picker-favorites') && ${JSON.stringify(favCards)}.indexOf(b.dataset.uid) !== -1).length`);
  check(favCards.length > 0 && elsewhere === 0, "11-4 常吃的卡片在原分類還出現 " + elsewhere + " 張");
  const blockedTail = await js(`(() => { const cs = [...document.querySelectorAll('#meal-picker-panel .meal-picker-favorites .item-card')]; const i = cs.findIndex((b) => b.disabled); return i === -1 || cs.slice(i).every((b) => b.disabled); })()`);
  check(blockedTail, "11-4 常吃組裡被擋的沒有排在組尾");
  await checkStepNumbers("11-4");
  await shot("常吃-選擇器超商", "#meal-picker-panel .meal-picker-favorites");
  check(!!(await js(`document.querySelector('#meal-picker-drinks .meal-picker-favorites [data-food-uid="fx_rice"]')`)), "11-4 加點單品最上面的常吃組沒有白米");
  await shot("常吃-選擇器加點單品", "#meal-picker-drinks .meal-picker-favorites");
  // 11-5 已選列：選一個不是常吃的 → 已選列「常吃」在第一個 → 搬到常吃組、還是選著；360 寬；再取消
  const pick11 = await js(`([...document.querySelectorAll('#meal-picker-panel .item-card[data-uid]:not([disabled])')].find((b) => !b.closest('.meal-picker-favorites')) || {}).dataset.uid`);
  await click(`#meal-picker-panel .item-card[data-uid=${pick11}]`);
  const rowOrder = await js(`[...document.querySelector('#meal-picker-panel .selected-actions').querySelectorAll('button')].map((b) => b.textContent).join(",")`);
  check(rowOrder === "常吃,複製成我的版本,不吃", "11-5 已選列按鈕順序不對：" + rowOrder);
  await click(`#meal-picker-panel [data-favorite-uid=${pick11}]`);
  await until(`!!document.querySelector('#meal-picker-panel .meal-picker-favorites .item-card.selected[data-uid=${pick11}]')`, "11-5 已選列標常吃後沒有搬到常吃組或取消了選取");
  check((await js(text("#meal-picker-summary"))).indexOf("已選 1 件") === 0, "11-5 標常吃後選取變了");
  await send("Emulation.setDeviceMetricsOverride", { width: 360, height: 780, deviceScaleFactor: 2, mobile: true });
  await shot("常吃-已選列-360寬", "#meal-picker-panel .meal-picker-selected");
  await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await click(`#meal-picker-panel [data-unfavorite-uid=${pick11}]`);
  await until(`!document.querySelector('#meal-picker-panel .meal-picker-favorites [data-uid=${pick11}]')`, "11-5 取消常吃後還在常吃組");
  // 單品已選框也有「常吃」
  await click(`#meal-picker-drinks .meal-picker-favorites [data-food-uid="fx_rice"]`);
  check(!!(await js(`document.querySelector('#food-sel-fx_rice [data-unfavorite-uid="fx_rice"]')`)), "11-5 單品已選框沒有「取消常吃」");
  await closePicker();
  // 11-6 自煮：常吃且能選的蛋白質排第一個（只看設定，點選過程不跳位置）
  await openPicker("dinner");
  await click(`#meal-picker-tabs [data-tab=cook]`);
  // 找一個能選的蛋白質至少 2 個的餐型（再點一次餐型＝取消，decisions #122）
  const archIds = await js(`[...document.querySelectorAll('#meal-picker-panel .compose-option[data-axis=archetype]')].map((b) => b.dataset.id)`);
  let prots = [], arch11 = null;
  for (const id of archIds) {
    await click(`#meal-picker-panel .compose-option[data-axis=archetype][data-id=${id}]`);
    prots = await js(`[...document.querySelectorAll('#meal-picker-panel .compose-option[data-axis=protein]:not([disabled])')].map((b) => b.dataset.id)`);
    await click(`#meal-picker-panel .compose-option[data-axis=archetype][data-id=${id}]`);
    if (prots.length >= 2) { arch11 = id; break; }
  }
  await closePicker();
  if (prots.length >= 2) {
    const target = prots[prots.length - 1];
    await js(`(async () => { const m = ${DBW}; await m.addFavoriteRef(${JSON.stringify(target)}); })()`);
    await openPicker("dinner");
    await click(`#meal-picker-tabs [data-tab=cook]`);
    await click(`#meal-picker-panel .compose-option[data-axis=archetype][data-id=${arch11}]`);
    const first = await js(`document.querySelector('#meal-picker-panel .compose-option[data-axis=protein]').dataset.id`);
    check(first === target, "11-6 常吃的蛋白質沒有排第一個：" + first + "（應為 " + target + "）");
    await shot("常吃-自煮蛋白質", "#meal-picker-panel .compose-step");
    await closePicker();
  } else fail("11-6 晚餐沒有能選的蛋白質至少 2 個的餐型（測試前提不成立）");

  // ---------- 12. 我的食材（工作線 D 切片 8b-2，計畫 docs/review/2026-10-02-D8b-實作計畫.md） ----------
  console.log("[12. 我的食材]");
  await tab("foods");
  await foodsSub("cook");
  // 12-1 ＋新增食材 → 搜尋鯖魚 → 熟的樣品寫「熟」→ 點「鯖魚(煮)」→ 確認表單（一份空白、參考句不給熟魚）→ 加入
  await click(`[data-ing-add]`);
  await until(`!!document.getElementById('ing-search') && document.querySelectorAll('[data-ing-cat]').length >= 15`, "12-1 新增食材面板沒有搜尋框或分類晶片");
  await shot("我的食材-新增面板", "#foods-add-ing");
  const ingSearch = (q) => js(`(() => { const el = document.getElementById('ing-search'); el.value = ${JSON.stringify(q)}; el.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  await ingSearch("鯖魚");
  await until(`!!document.querySelector('[data-ing-pick=J0414808]')`, "12-1 搜尋鯖魚沒有「鯖魚(煮)」");
  check((await js(`document.querySelector('[data-ing-pick=J0414808]').innerText`)).indexOf("魚貝類 · 熟") !== -1, "12-1 鯖魚(煮)沒有標「熟」");
  await click(`[data-ing-pick=J0414701]`);
  await until(`!!document.querySelector('[data-ing-confirm]')`, "12-1 點鯖魚(生)沒有出現確認表單");
  const confirmText = await js(`document.querySelector('.ing-confirm').innerText`);
  check(confirmText.indexOf("參考：代換表 1 份「虱目魚」是生重 35g") !== -1 && confirmText.indexOf("這是生的樣品") !== -1 && confirmText.indexOf("衛福部標註") !== -1,
    "12-1 生鯖魚的確認表單缺參考句、生的說明或衛福部標註：" + confirmText);
  await shot("我的食材-確認加入", ".ing-confirm");
  await click(`[data-ing-confirm]`);
  await until(`${text("#foods-status")}.indexOf("已加入「鯖魚(生)」") !== -1`, "12-1 加入後沒有「已加入」");
  check(!!(await js(`!!(${foodRow("鯖魚(生)")})`)), "12-1 加入後豆魚蛋肉類裡沒有鯖魚(生)");
  const fishText = await foodRowText("鯖魚(生)");
  check(fishText.indexOf("衛福部 · 每 100g") !== -1 && fishText.indexOf("沒有設一份") !== -1 && fishText.indexOf("衛福部 J0414701") !== -1, "12-1 鯖魚明細不對：" + fishText);
  await shot("我的食材-明細", ".food-row:has(.food-detail)");
  // 12-2 分類晶片：加工調理食品 → 點第一筆、一份填 300 → 在「其他食材」
  await click(`[data-ing-add]`);
  await until(`!!document.querySelector('[data-ing-cat="加工調理食品及其他類"]')`, "12-2 沒有加工調理的分類晶片");
  await click(`[data-ing-cat="加工調理食品及其他類"]`);
  await until(`!!document.querySelector('[data-ing-pick=R0100101]')`, "12-2 分類晶片沒有列出廣東粥");
  check((await js(`document.querySelector('[data-ing-pick=J0414701]')`)) === null, "12-2 選了分類還列出別類的");
  await click(`[data-ing-pick=R0100101]`);
  await js(`(() => { const el = document.querySelector('[data-ing-add-field=amount]'); el.value = '300'; })()`);
  await click(`[data-ing-confirm]`);
  await until(`${text("#foods-status")}.indexOf("已加入「廣東粥」") !== -1`, "12-2 廣東粥沒有加入");
  await openFolded();
  check(!!(await js(`[...document.querySelectorAll('#foods-body details[data-foods-section="cook:other"] .food-name')].some((n) => n.textContent === "廣東粥")`)), "12-2 廣東粥不在「其他食材」");
  // 12-3 不吃＝移除 → 復原
  await openFolded();
  await openFood("鯖魚(生)");
  await until(`!!(${foodRow("鯖魚(生)")}).querySelector("[data-ing-remove]")`, "12-3 鯖魚明細沒有「不吃」");
  await inFoodRow("鯖魚(生)", "[data-ing-remove]");
  await until(`${text("#foods-status")}.indexOf("已從我的食材移除「鯖魚(生)」") !== -1 && !!document.querySelector('[data-ing-undo]')`, "12-3 不吃後沒有移除訊息或「復原」");
  check(!(await js(`!!(${foodRow("鯖魚(生)")})`)), "12-3 移除後鯖魚還在");
  await click(`[data-ing-undo]`);
  await until(`${text("#foods-status")}.indexOf("已復原「鯖魚(生)」") !== -1`, "12-3 復原沒有成功");
  // 12-4 自填：每份 40g 熱量 76 → 每 100g 190；一份 40；刪除 → 已刪除的食材 → 還原
  await click(`[data-ing-add]`);
  await until(`!!document.querySelector('[data-ing-self]')`, "12-4 沒有「自己填」");
  await click(`[data-ing-self]`);
  await until(`!!document.getElementById('foods-ing-form')`, "12-4 沒有自填表單");
  await click(`[data-ing-basis=serving]`);
  await js(`(() => { const f = document.getElementById('foods-ing-form'); const set = (sel, v) => { f.querySelector(sel).value = v; };
    set('[data-ing=name]', '某牌豆干'); set('[data-ing=servingAmount]', '40'); set('[data-ing=kcal]', '76'); set('[data-ing=amount]', '40'); })()`);
  await click(`[data-ing-state=as_is]`);
  await shot("我的食材-自填表單", "#foods-ing-form");
  await click(`[data-ing-save]`);
  await until(`${text("#foods-status")}.indexOf("已新增「某牌豆干」") !== -1`, "12-4 自填沒有存成功：" + (await js(text("#foods-body"))).slice(0, 200));
  const tofuRec = await js(`(async () => { const m = ${DBW}; return (await m.getCustomIngredients()).find((r) => r.name === '某牌豆干'); })()`);
  check(tofuRec && tofuRec.per_100g.kcal === 190 && tofuRec.default_amount === 40 && /^cing_u_/.test(tofuRec.id), "12-4 自填的每 100g 換算或 id 不對：" + JSON.stringify(tofuRec));
  await inFoodRow("某牌豆干", "[data-ing-archive]");
  await until(`${text("#foods-status")}.indexOf("已刪除「某牌豆干」") !== -1`, "12-4 刪除沒有訊息");
  await openFolded();
  await js(`(() => { const r = ${foodRow("某牌豆干")}; if (!r.querySelector("[data-ing-restore]")) r.querySelector(".food-row-main").click(); })()`);
  await inFoodRow("某牌豆干", "[data-ing-restore]");
  await until(`${text("#foods-status")}.indexOf("已還原「某牌豆干」") !== -1`, "12-4 還原沒有成功");
  // 12-5 選擇器：鯖魚沒有一份 → 只有克、預設 100；豆干有一份 → 份／克；送出名稱
  await openPicker("dinner");
  await click(`#meal-picker-tabs [data-tab=convenience]`);
  await until(`(() => { const el = document.getElementById('meal-picker-food-search'); return !!el; })()`, "12-5 選擇器沒有單品搜尋");
  await pickFood("cing_j0414701", "鯖魚");
  check((await pickedFoodText("cing_j0414701")).indexOf("生重 100g") !== -1 && !(await js(`!!document.querySelector('#food-sel-cing_j0414701 [data-food-mode]')`)),
    "12-5 沒設一份的鯖魚不是只有克、預設 100：" + (await pickedFoodText("cing_j0414701")));
  await js(`(() => { const el = document.querySelector('#food-sel-cing_j0414701 .food-amount-input'); el.value = '150'; el.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  await until(`(document.getElementById('food-sel-cing_j0414701') || {}).innerText.indexOf("生重 150g") !== -1`, "12-5 鯖魚改 150 沒生效");
  await pickFood(tofuRec.id, "豆干");
  check(!!(await js(`!!document.querySelector('#food-sel-${tofuRec.id} [data-food-mode]')`)) && (await pickedFoodText(tofuRec.id)).indexOf("1 份＝") !== -1, "12-5 有一份的豆干沒有份／克切換");
  await shot("我的食材-選擇器", "#food-sel-cing_j0414701");
  await send("Emulation.setDeviceMetricsOverride", { width: 360, height: 780, deviceScaleFactor: 2, mobile: true });
  await shot("我的食材-選擇器-360寬", "#food-sel-cing_j0414701");
  await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  check((await submitAndUndo("dinner", "12-5")) === "鯖魚(生) 150g＋某牌豆干 40g", "12-5 紀錄名稱不是「鯖魚(生) 150g＋某牌豆干 40g」");
  // 12-6 360 寬：新增面板的分類晶片不讓整頁橫移
  await tab("foods");
  await foodsSub("cook");
  await click(`[data-ing-add]`);
  await until(`document.querySelectorAll('[data-ing-cat]').length >= 15`, "12-6 再開新增面板沒有晶片");
  await send("Emulation.setDeviceMetricsOverride", { width: 360, height: 780, deviceScaleFactor: 2, mobile: true });
  await shot("我的食材-新增面板-360寬", "#foods-add-ing");
  await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await click(`[data-ing-add-close]`);

  // ---------- 13. 日期切換與預約（decisions #140–#142，設計草案 docs/review/2026-10-02-日期切換-設計草案.md 第 9 節） ----------
  console.log("[13. 日期切換與預約]");
  await tab("today");
  await until(`document.querySelectorAll('#today-dates [data-day-offset]').length === 7`, "13-1 日期列不是七個日子");
  check((await js(text("#today-dates [data-day-offset='0']"))).indexOf("今天") !== -1, "13-1 第一個日子不是「今天」");
  // 13-1 明天：不跑推薦、不顯示目標，只有「還沒排」與自己選
  await click(`#today-dates [data-day-offset='1']`);
  await until(`!document.getElementById('today-day-summary').hidden && ${text("#today-day-summary")}.indexOf("還沒排任何一餐") !== -1`, "13-1 明天沒有「還沒排任何一餐」");
  check(await js(`document.getElementById('today-hero').hidden`), "13-1 未來日子不該顯示彙總卡（PRD 6.2）");
  check(!(await js(`!!document.querySelector('#today-recs .rec-log-btn')`)), "13-1 未來日子出現了推薦的「記錄這餐」");
  check(!!(await js(`!!document.querySelector('#rec-dinner [data-plan-pick=dinner]')`)), "13-1 明天晚餐沒有「自己選」");
  await shot("日期切換-明天還沒排", "#today-dates");
  // 13-2 明天晚餐排喜宴（估算 L）：選擇器 plan 模式的標題、送出鍵、不計算配額
  await click(`#rec-dinner [data-plan-pick=dinner]`);
  await until(`!document.getElementById('meal-picker-overlay').hidden && document.getElementById('meal-picker-panel').innerHTML !== ''`, "13-2 預約的選擇器沒有打開");
  check((await js(text("#meal-picker-title"))).indexOf("排進") !== -1 && (await js(text("#meal-picker-submit"))) === "排進預約", "13-2 預約模式的標題或送出鍵不對");
  await click(`#meal-picker-tabs [data-tab=delivery]`);
  await until(`!!document.querySelector('[data-estimate-size=L]')`, "13-2 預約模式的外食分頁沒有估算卡");
  await js(`(() => { document.getElementById('meal-picker-estimate-name').value = '喜宴'; })()`);
  await click(`[data-estimate-size=L]`);
  await until(`${text("#meal-picker-gap")}.indexOf("預約不計算配額") !== -1`, "13-2 預約模式沒有寫「不計算配額」");
  check((await js(text("#meal-picker-gap"))).indexOf("缺口") === -1, "13-2 預約模式不該顯示缺口");
  await click("#meal-picker-submit");
  await until(`${text("#rec-dinner")}.indexOf("約 1200 kcal") !== -1 && ${text("#today-day-summary")}.indexOf("已排 1 餐，約 1200 kcal") !== -1`, "13-2 排完明天晚餐沒有顯示 1200 或頂端合計");
  check(!(await js(`document.querySelector("#today-dates [data-day-offset='1'] .today-date-dot").hidden`)), "13-2 有預約的日子沒有小點");
  // 13-3 明天早餐預約「這餐不吃」
  await click(`#rec-breakfast [data-plan-skip=breakfast]`);
  await until(`${text("#rec-breakfast")}.indexOf("這餐不吃（預約）") !== -1 && ${text("#today-day-summary")}.indexOf("已排 2 餐，約 1200 kcal") !== -1`, "13-3 預約不吃沒有顯示或合計不對");
  check(!(await js(`!!document.querySelector('#rec-afternoon_tea [data-plan-skip]')`)), "13-3 關掉的時段不該有「這餐不吃」（審核 M13）");
  await shot("日期切換-明天已排", "#today-day-summary");
  await send("Emulation.setDeviceMetricsOverride", { width: 360, height: 780, deviceScaleFactor: 2, mobile: true });
  await shot("日期切換-明天已排-360寬", "#today-dates");
  await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  // 13-4 改明天的晚餐：帶入喜宴
  await click(`#rec-dinner [data-plan-edit=dinner]`);
  await until(`!document.getElementById('meal-picker-overlay').hidden && ${text("#meal-picker-panel")}.indexOf("喜宴（L") !== -1`, "13-4 改預約沒有帶入喜宴");
  await closePicker();
  // 13-5 今天的預約（模擬昨天排好的）：晚餐 1200 → 卡片、彙總卡主數字不扣、「已排」一行
  await click(`#today-dates [data-day-offset='0']`);
  await until(`!document.getElementById('today-hero').hidden && document.getElementById('today-day-summary').hidden`, "13-5 回到今天彙總卡沒有出現");
  const heroBefore = await js(text("#today-hero-kcal-value"));
  await js(`(async () => { const m = ${DBW}; const est = { kind: 'estimate', name: '聚餐', size: 'L', snapshot: { kcal: 1200, protein_g: null, carb_g: null, fat_g: null, fiber_g: null, sat_fat_g: null, sodium_mg: null } };
    const d = new Date(); const ds = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    await m.setMealPlan({ date: ds, slot: 'dinner', name: '聚餐', content: { meal_type: 'delivery', archetype_id: null, method_id: null, implicit: null, components: [est] } }); })()`);
  await click("#today-refresh");
  await until(`${text("#rec-dinner")}.indexOf("預約 · 約 1200 kcal") !== -1 && !!document.querySelector('#rec-dinner [data-plan-log=dinner]')`, "13-5 今天的預約卡片沒有出現");
  check((await js(text("#today-hero-kcal-value"))) === heroBefore, "13-5 彙總卡主數字被預約扣掉了（應維持目標減已記錄）");
  check((await js(text("#today-hero-planned"))).indexOf("已排：晚餐 約 1200 kcal") !== -1, "13-5 彙總卡沒有「已排」一行");
  check(!(await js(`!!document.querySelector('#rec-extra-dinner [data-skip-slot]')`)), "13-5 有預約的時段不該有「這餐不吃」");
  await shot("日期切換-今天的預約", "#rec-dinner");
  // 13-6 記下 → 已記錄；撤銷 → 預約還在；取消預約 → 回到推薦
  await click(`#rec-dinner [data-plan-log=dinner]`);
  await until(`${text("#rec-dinner")}.indexOf("已記錄：聚餐") !== -1`, "13-6 記下後沒有變成已記錄");
  const planLog = await js(`(async () => { const m = ${DBW}; return (await m.getDailyLogs({})).filter((l) => l.source === 'from_plan').map((l) => l.name + '|' + l.totals.kcal); })()`);
  check(planLog.indexOf("聚餐|1200") !== -1, "13-6 紀錄的 source 不是 from_plan 或熱量不對：" + JSON.stringify(planLog));
  await click(`#rec-dinner .rec-undo-btn`);
  await until(`!!document.querySelector('#rec-dinner [data-plan-cancel]')`, "13-6 撤銷後預約卡片沒有回來");
  await click(`#rec-dinner [data-plan-cancel]`);
  await until(`!!document.querySelector('#rec-dinner .rec-pick-btn') && document.getElementById('today-hero-planned').hidden`, "13-6 取消預約後沒有回到推薦，或「已排」沒收起來");
  // 13-7 今天「這餐不吃」→ 這餐沒吃＋撤銷
  await until(`!!document.querySelector('#rec-extra-lunch [data-skip-slot=lunch]')`, "13-7 午餐沒有「這餐不吃」");
  await click(`#rec-extra-lunch [data-skip-slot=lunch]`);
  await until(`${text("#rec-lunch")}.indexOf("這餐沒吃") !== -1 && !!document.querySelector('#rec-lunch .rec-undo-btn')`, "13-7 這餐不吃之後沒有「這餐沒吃」");
  await shot("日期切換-這餐沒吃", "#rec-lunch");
  await click(`#rec-lunch .rec-undo-btn`);
  await until(`!!document.querySelector('#rec-lunch .rec-pick-btn')`, "13-7 撤銷這餐沒吃後沒有回到推薦");
  // 收尾：取消明天的兩筆預約
  await click(`#today-dates [data-day-offset='1']`);
  await until(`!!document.querySelector('#rec-dinner [data-plan-cancel]')`, "13-8 明天的預約不見了");
  await click(`#rec-dinner [data-plan-cancel]`);
  await until(`!document.querySelector('#rec-dinner [data-plan-cancel]') && !!document.querySelector('#rec-breakfast [data-plan-cancel]')`, "13-8 取消晚餐預約沒有生效");
  await click(`#rec-breakfast [data-plan-cancel]`);
  await until(`${text("#today-day-summary")}.indexOf("還沒排任何一餐") !== -1`, "13-8 取消後明天不是「還沒排」");
  await click(`#today-dates [data-day-offset='0']`);

  // 13-9 現成飲料分組（decisions #143）：超商分頁超商那組在前，外食分頁手搖飲那組在前，全部照列
  await openPicker("lunch");
  await click(`#meal-picker-tabs [data-tab=convenience]`);
  const drinkHeads = () => js(`[...document.querySelectorAll('#meal-picker-drinks .meal-picker-subrole')].map((h) => h.textContent).join(",")`);
  await until(`!!document.querySelector('#meal-picker-drinks .meal-picker-subrole')`, "13-9 現成飲料沒有分組標題");
  check(/^超商（\d+）,手搖飲・咖啡・早餐店（\d+）/.test(await drinkHeads()), "13-9 超商分頁的飲料分組順序不對：" + (await drinkHeads()));
  // 13-10 收合（decisions #144）：超商分頁的分類預設收起來；飲料只有超商那組打開
  check(await js(`[...document.querySelectorAll('#meal-picker-panel details.meal-picker-fold')].length > 0 && [...document.querySelectorAll('#meal-picker-panel details.meal-picker-fold')].every((d) => !d.open)`),
    "13-10 超商分頁的分類沒有預設收起來");
  check(await js(`(() => { const d = [...document.querySelectorAll('#meal-picker-drinks details[data-pick-group]')]; return d.length === 2 && d[0].open && !d[1].open; })()`),
    "13-10 飲料不是只有超商那組打開");
  await js(`document.querySelector('#meal-picker-panel details.meal-picker-fold').open = true`);
  await until(`!!document.querySelector('#meal-picker-panel details.meal-picker-fold[open] .item-card')`, "13-10 打開分類沒有品項");
  await shot("收合-超商分頁", "#meal-picker-panel");
  await shot("飲料分組-超商", "#meal-picker-drinks .meal-picker-subrole");
  await click(`#meal-picker-tabs [data-tab=delivery]`);
  await until(`(${text("#meal-picker-drinks .meal-picker-subrole")}).indexOf("手搖飲・咖啡・早餐店（") === 0`, "13-9 外食分頁的飲料第一組不是手搖飲・咖啡・早餐店");
  await closePicker();

  // ---------- 14. 昨天的餐與補記（日期切換切片 3；decisions #140⑤、#142、#120） ----------
  console.log("[14. 昨天的餐與補記]");
  const dayStr = (back) => `(() => { const d = new Date(); d.setDate(d.getDate() - ${back}); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); })()`;
  const ydLogs = (date) => js(`(async () => { const m = ${DBW}; return (await m.getDailyLogs({ start: ${date}, end: ${date} })).map((l) => l.slot + '|' + l.source + '|' + l.name + '|' + l.totals.kcal); })()`);
  await tab("today");
  await click(`#today-dates [data-day-offset='0']`);
  // 14-1 昨天：午餐有預約（聚餐 L）、晚餐有昨天最後顯示的推薦、早餐什麼都沒有
  await js(`(async () => { const m = ${DBW}; const y = ${dayStr(1)};
    const est = { kind: 'estimate', name: '聚餐', size: 'L', snapshot: { kcal: 1200, protein_g: null, carb_g: null, fat_g: null, fiber_g: null, sat_fat_g: null, sodium_mg: null } };
    await m.setMealPlan({ date: y, slot: 'lunch', name: '聚餐', content: { meal_type: 'delivery', archetype_id: null, method_id: null, implicit: null, components: [est] } });
    const rest = { kind: 'estimate', name: '便當', size: 'M', snapshot: { kcal: 650, protein_g: null, carb_g: null, fat_g: null, fiber_g: null, sat_fat_g: null, sodium_mg: null } };
    await m.setLastShownRecs(y, { dinner: { name: '昨天的建議便當', content: { meal_type: 'delivery', archetype_id: null, method_id: null, implicit: null, components: [rest] }, totals: { kcal: 650, protein_g: null, carb_g: null, fat_g: null, fiber_g: null, sat_fat_g: null, sodium_mg: null, partial: [] } } }); })()`);
  await click("#today-refresh");
  await until(`!document.getElementById('today-yesterday').hidden && ${text("#today-yesterday")}.indexOf("昨天的餐（3 餐）") !== -1`, "14-1 昨天的餐卡片沒有出現或不是 3 餐：" + (await js(text("#today-yesterday"))).slice(0, 120));
  check(await js(`!document.querySelector('#today-yesterday details').open`), "14-1 昨天的餐預設應該收合");
  await shot("昨天的餐-收合", "#today-yesterday");
  await js(`document.querySelector('#today-yesterday details').open = true`);
  await until(`!!document.querySelector('#today-yesterday [data-yday=eat-plan]') && !!document.querySelector('#today-yesterday [data-yday=eat-rec]')`, "14-1 展開後沒有預約與推薦的「吃了」");
  check(await js(`!!document.querySelector('#today-yesterday [data-yday=est-S][data-slot=breakfast]') && !document.querySelector('#today-yesterday [data-yday=eat-plan][data-slot=breakfast]')`), "14-1 早餐只該有 S／M／L");
  check((await js(text("#today-yesterday"))).indexOf("昨天看到的建議：昨天的建議便當（約 650 kcal）") !== -1 && (await js(text("#today-yesterday"))).indexOf("聚餐（預約，約 1200 kcal）") !== -1, "14-1 推薦或預約那一列沒有寫品名與熱量");
  await shot("昨天的餐-展開", "#today-yesterday");
  await send("Emulation.setDeviceMetricsOverride", { width: 360, height: 780, deviceScaleFactor: 2, mobile: true });
  await shot("昨天的餐-展開-360寬", "#today-yesterday");
  await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  // 14-2 早餐按 M → backfill 估算（中）500 kcal；卡片剩 2 餐、維持展開
  await click(`#today-yesterday [data-yday=est-M][data-slot=breakfast]`);
  await until(`${text("#today-yesterday")}.indexOf("昨天的餐（2 餐）") !== -1`, "14-2 按 M 之後卡片沒有剩 2 餐");
  check(await js(`document.querySelector('#today-yesterday details').open`), "14-2 寫入後卡片不該自己收起來");
  check((await ydLogs(dayStr(1))).indexOf("breakfast|backfill|估算（中）|500") !== -1, "14-2 昨天早餐沒有寫入 backfill 估算（中）500：" + JSON.stringify(await ydLogs(dayStr(1))));
  // 14-3 晚餐「吃了」＝昨天推薦 → rec_accepted；午餐「吃了」＝預約 → from_plan 1200
  await click(`#today-yesterday [data-yday=eat-rec][data-slot=dinner]`);
  await until(`${text("#today-yesterday")}.indexOf("昨天的餐（1 餐）") !== -1`, "14-3 吃了推薦之後卡片沒有剩 1 餐");
  check((await ydLogs(dayStr(1))).indexOf("dinner|rec_accepted|昨天的建議便當|650") !== -1, "14-3 晚餐沒有以 rec_accepted 寫入昨天的推薦");
  await click(`#today-yesterday [data-yday=eat-plan][data-slot=lunch]`);
  await until(`document.getElementById('today-yesterday').hidden`, "14-3 三餐都處理完卡片應該消失");
  check((await ydLogs(dayStr(1))).indexOf("lunch|from_plan|聚餐|1200") !== -1, "14-3 午餐沒有以 from_plan 寫入預約");
  // 14-4 「不確定」只收起、不寫紀錄；「這餐沒吃」寫 skipped；先不用收整張
  await js(`(async () => { const m = ${DBW}; const logs = await m.getDailyLogs({ start: ${dayStr(1)}, end: ${dayStr(1)} }); for (const l of logs) await m.undoDailyLog(l.id); })()`);
  await click("#today-refresh");
  await until(`!document.getElementById('today-yesterday').hidden && ${text("#today-yesterday")}.indexOf("昨天的餐（3 餐）") !== -1`, "14-4 清掉昨天紀錄後卡片沒有回來");
  await click(`#today-yesterday [data-yday=unsure][data-slot=breakfast]`);
  await until(`${text("#today-yesterday")}.indexOf("昨天的餐（2 餐）") !== -1`, "14-4 不確定之後卡片沒有剩 2 餐");
  check((await ydLogs(dayStr(1))).length === 0, "14-4 不確定不該寫任何紀錄");
  await click("#today-refresh");
  await until(`${text("#today-yesterday")}.indexOf("昨天的餐（2 餐）") !== -1`, "14-4 重畫後不確定的那餐又出現了（應該維持略過）");
  await click(`#today-yesterday [data-yday=skipped][data-slot=dinner]`);
  await until(`${text("#today-yesterday")}.indexOf("昨天的餐（1 餐）") !== -1`, "14-4 這餐沒吃之後卡片沒有剩 1 餐");
  check((await ydLogs(dayStr(1))).indexOf("dinner|skipped|這餐沒吃|0") !== -1, "14-4 這餐沒吃沒有寫 skipped 0 kcal");
  await click(`#today-yesterday [data-yday=close]`);
  await until(`document.getElementById('today-yesterday').hidden`, "14-4 先不用沒有收起整張卡");
  // 14-5 切到明天：卡片收起；回今天不再冒出來（先不用只收今天）
  await click(`#today-dates [data-day-offset='1']`);
  await until(`!document.getElementById('today-day-summary').hidden`, "14-5 沒有切到明天");
  check(await js(`document.getElementById('today-yesterday').hidden`), "14-5 未來日子不該有昨天的餐");
  await click(`#today-dates [data-day-offset='0']`);
  await until(`!document.getElementById('today-hero').hidden`, "14-5 沒有回到今天");
  check(await js(`document.getElementById('today-yesterday').hidden`), "14-5 先不用之後回到今天卡片又出現了");
  // 14-6 補記：本週總覽選前天、午餐 → 選擇器補記模式 → 估算 M → backfill
  await js(`(async () => { const m = ${DBW}; const logs = await m.getDailyLogs({ start: ${dayStr(1)}, end: ${dayStr(1)} }); for (const l of logs) await m.undoDailyLog(l.id); })()`);
  await tab("week");
  await until(`!!document.querySelector('#week-backfill [data-backfill-slot=lunch]')`, "14-6 本週總覽沒有補記區");
  await shot("補記-本週總覽", "#week-backfill");
  await js(`(() => { const el = document.getElementById('week-backfill-date'); el.value = ${dayStr(2)}; el.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  const lastPicked0 = await js(`(async () => { const m = ${DBW}; return JSON.stringify(await m.getSetting('picker_last_meal_type')); })()`);
  await click(`#week-backfill [data-backfill-slot=lunch]`);
  await until(`!document.getElementById('meal-picker-overlay').hidden && document.getElementById('meal-picker-panel').innerHTML !== ''`, "14-6 補記的選擇器沒有打開");
  check((await js(text("#meal-picker-title"))).indexOf("補記") !== -1 && (await js(text("#meal-picker-submit"))) === "補記這餐", "14-6 補記模式的標題或送出鍵不對：" + (await js(text("#meal-picker-title"))));
  await click(`#meal-picker-tabs [data-tab=delivery]`);
  await until(`!!document.querySelector('[data-estimate-size=M]')`, "14-6 補記模式的外食分頁沒有估算卡");
  await click(`[data-estimate-size=M]`);
  await until(`${text("#meal-picker-gap")}.indexOf("補記過去的一餐，不計算配額") !== -1`, "14-6 補記模式沒有寫「不計算配額」");
  await shot("補記-選擇器", "#meal-picker-panel");
  await click("#meal-picker-submit");
  await until(`document.getElementById('meal-picker-overlay').hidden`, "14-6 補記送出後選擇器沒有關閉");
  check((await ydLogs(dayStr(2))).some((x) => /^lunch\|backfill\|.*\|700$/.test(x)), "14-6 前天午餐沒有以 backfill 寫入：" + JSON.stringify(await ydLogs(dayStr(2))));
  const lastPicked1 = await js(`(async () => { const m = ${DBW}; return JSON.stringify(await m.getSetting('picker_last_meal_type')); })()`);
  check(lastPicked0 === lastPicked1, "14-6 補記不該更新上次選過的型態（章程 C4.15）：" + lastPicked0 + " → " + lastPicked1);
  // 14-7 日期超出範圍：選 8 天前不行
  await js(`(() => { const el = document.getElementById('week-backfill-date'); el.value = ${dayStr(9)}; })()`);
  await click(`#week-backfill [data-backfill-slot=lunch]`);
  await until(`${text("#week-backfill-msg")}.indexOf("過去 7 天") !== -1`, "14-7 超出 7 天沒有提示");
  check(await js(`document.getElementById('meal-picker-overlay').hidden`), "14-7 超出 7 天不該打開選擇器");
  await js(`(async () => { const m = ${DBW}; for (const d of [${dayStr(1)}, ${dayStr(2)}]) { const logs = await m.getDailyLogs({ start: d, end: d }); for (const l of logs) await m.undoDailyLog(l.id); } })()`);
  await tab("today");

  // ---------- 15. 主食＋家常菜估算（decisions #151，設計草案 docs/review/2026-10-04-家常菜估算-設計草案.md 第 8 節） ----------
  console.log("[15. 主食＋家常菜估算]");
  const homeLogs = (date) => js(`(async () => { const m = ${DBW}; return (await m.getDailyLogs({ start: ${date}, end: ${date} })).map((l) => { const c = l.content.components[0]; return JSON.stringify({ slot: l.slot, source: l.source, name: l.name, kcal: l.totals.kcal, kind: c.kind, size: c.size, est: c.est || null, sodium: c.snapshot.sodium_mg }); }); })()`);
  // 15-1 今天記錄：外食分頁 → 主食＋家常菜（預設值先看一次）→ 2 道菜（素菜、純肉）＋湯 → 加入 → 送出
  await tab("today");
  await openPicker("lunch");
  await click(`#meal-picker-tabs [data-tab=delivery]`);
  check(!(await js(`!!document.querySelector('#meal-picker-panel [data-home-n]')`)), "15-1 沒選「主食＋家常菜」前不該顯示它的設定");
  await click(`#meal-picker-panel [data-home-toggle]`);
  await until(`!!document.querySelector('#meal-picker-panel [data-home-n="2"]')`, "15-1 展開「自助餐」沒有出現道數按鈕");
  const homePreview0 = await js(text("#meal-picker-panel .meal-picker-estimate"));
  check(/白飯 (80|160|240)g/.test(homePreview0) && /菜 (120|160|200)g/.test(homePreview0) && homePreview0.indexOf("蛋白質") !== -1 && homePreview0.indexOf("鈉") !== -1 && homePreview0.indexOf("估計") !== -1 &&
    homePreview0.indexOf("純肉＝肉、魚、蛋、豆腐為主") !== -1, "15-1 預設預覽沒有白飯 160g、菜 160g、蛋白質、鈉、估計、純肉說明：" + homePreview0);
  await shot("估算-主食加家常菜-預設", "#meal-picker-panel .meal-picker-estimate");
  // 預設的主食量與菜量依個人目標與時段配額而不同，這裡固定成中份再比數字
  await click(`#meal-picker-panel [data-home-staple-size=M]`);
  await click(`#meal-picker-panel [data-home-dish=M]`);
  await click(`#meal-picker-panel [data-home-n="2"]`);
  await click(`#meal-picker-panel [data-home-cat="0:veg"]`);
  await click(`#meal-picker-panel [data-home-cat="1:meat"]`);
  await click(`#meal-picker-panel [data-home-soup=on]`);
  const homePreview1 = await js(text("#meal-picker-panel .meal-picker-estimate"));
  check(homePreview1.indexOf("每道約 80g") !== -1 && homePreview1.indexOf("湯 250ml") !== -1 && homePreview1.indexOf("白飯＋2 道菜（素菜、純肉）＋湯") !== -1, "15-1 2 道菜加湯的預覽不對：" + homePreview1);
  await click(`#meal-picker-panel [data-home-staple=none]`);
  check(!(await js(`!!document.querySelector('#meal-picker-panel [data-home-staple-size]')`)), "15-1 不吃主食時不該有主食量");
  await click(`#meal-picker-panel [data-home-staple=white]`);
  check(await js(`!!document.querySelector('#meal-picker-panel [data-home-staple-size="M"].selected')`), "15-1 改回白飯後主食量要回到中份");
  await send("Emulation.setDeviceMetricsOverride", { width: 360, height: 780, deviceScaleFactor: 2, mobile: true });
  await shot("估算-主食加家常菜-360寬", "#meal-picker-panel .meal-picker-estimate");
  await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await click(`#meal-picker-panel [data-home-add]`);
  await until(`${text("#meal-picker-panel .meal-picker-estimate-list")}.indexOf("白飯＋2 道菜（素菜、純肉）＋湯") !== -1 && ${text("#meal-picker-summary")}.indexOf("kcal") !== -1`, "15-1 加入後清單或摘要沒有出現");
  check(await js(`!!document.querySelector('#meal-picker-panel [data-home-add]')`), "15-1 加入後表單應仍在（可以再加一筆）");
  await shot("估算-主食加家常菜-已加入", "#meal-picker-panel .meal-picker-estimate");
  await click("#meal-picker-submit");
  await until(`document.getElementById('meal-picker-overlay').hidden && ${text("#rec-lunch")}.indexOf("白飯＋2 道菜") !== -1`, "15-1 送出後午餐紀錄沒有出現家常菜估算");
  const todayStr15 = `(() => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); })()`;
  const log15 = JSON.parse((await homeLogs(todayStr15)).filter((x) => /"slot":"lunch"/.test(x))[0] || "{}");
  check(log15.kind === "estimate" && log15.size === null && log15.est && log15.est.n === 2 && log15.est.soup === true && log15.est.staple === "white" && log15.kcal > 300 && log15.kcal < 900 && typeof log15.sodium === "number",
    "15-1 紀錄的元件不是帶 est 的估算：" + JSON.stringify(log15));
  await click("#rec-lunch .rec-undo-btn");
  await until(`!!document.querySelector('#rec-lunch .rec-log-btn') || !!document.querySelector('#rec-lunch .rec-pick-btn')`, "15-1 撤銷午餐沒有完成");
  // 15-2 預約明天午餐：加入 3 道菜 → 排進預約 → 改（帶入）仍看得到、est 與快照存進預約
  await click(`#today-dates [data-day-offset='1']`);
  await until(`!document.getElementById('today-day-summary').hidden`, "15-2 切到明天失敗");
  await click(`#rec-lunch [data-plan-pick=lunch]`);
  await until(`!document.getElementById('meal-picker-overlay').hidden && document.getElementById('meal-picker-panel').innerHTML !== ''`, "15-2 預約的選擇器沒有打開");
  await click(`#meal-picker-tabs [data-tab=delivery]`);
  await click(`#meal-picker-panel [data-home-toggle]`);
  await click(`#meal-picker-panel [data-home-n="3"]`);
  await click(`#meal-picker-panel [data-home-add]`);
  await until(`${text("#meal-picker-panel .meal-picker-estimate-list")}.indexOf("3 道菜") !== -1`, "15-2 預約模式加入家常菜估算失敗");
  await click("#meal-picker-submit");
  await until(`${text("#today-day-summary")}.indexOf("已排 1 餐") !== -1`, "15-2 排完午餐沒有頂端合計");
  const plan15 = await js(`(async () => { const m = ${DBW}; const d = new Date(); d.setDate(d.getDate() + 1); const ds = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    const p = (await m.getMealPlans({ start: ds, end: ds })).filter((x) => x.slot === 'lunch')[0]; const c = p.content.components[0]; return JSON.stringify({ n: c.est && c.est.n, size: c.size, kcal: c.snapshot.kcal, na: c.snapshot.sodium_mg }); })()`);
  const p15 = JSON.parse(plan15);
  check(p15.n === 3 && p15.size === null && p15.kcal > 300 && typeof p15.na === "number", "15-2 預約沒有存 est 與快照：" + plan15);
  await shot("估算-主食加家常菜-預約", "#rec-lunch");
  await click(`#rec-lunch [data-plan-edit=lunch]`);
  await until(`!document.getElementById('meal-picker-overlay').hidden && ${text("#meal-picker-panel")}.indexOf("3 道菜") !== -1`, "15-2 改預約沒有帶入家常菜估算");
  await closePicker();
  await click(`#rec-lunch [data-plan-cancel]`);
  await until(`${text("#today-day-summary")}.indexOf("還沒排任何一餐") !== -1`, "15-2 取消預約後明天不是「還沒排」");
  await click(`#today-dates [data-day-offset='0']`);
  // 15-3 補記前天午餐：主食改糙米飯 → 補記這餐
  await tab("week");
  await until(`!!document.querySelector('#week-backfill [data-backfill-slot=lunch]')`, "15-3 本週總覽沒有補記區");
  await js(`(() => { const el = document.getElementById('week-backfill-date'); el.value = ${dayStr(2)}; el.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  await click(`#week-backfill [data-backfill-slot=lunch]`);
  await until(`!document.getElementById('meal-picker-overlay').hidden && document.getElementById('meal-picker-panel').innerHTML !== ''`, "15-3 補記的選擇器沒有打開");
  await click(`#meal-picker-tabs [data-tab=delivery]`);
  await click(`#meal-picker-panel [data-home-toggle]`);
  await click(`#meal-picker-panel [data-home-staple=brown]`);
  await click(`#meal-picker-panel [data-home-add]`);
  await until(`${text("#meal-picker-panel .meal-picker-estimate-list")}.indexOf("糙米飯＋1 道菜") !== -1`, "15-3 補記模式加入家常菜估算失敗");
  await click("#meal-picker-submit");
  await until(`document.getElementById('meal-picker-overlay').hidden`, "15-3 補記送出後選擇器沒有關閉");
  const log153 = JSON.parse((await homeLogs(dayStr(2))).filter((x) => /"slot":"lunch"/.test(x))[0] || "{}");
  check(log153.source === "backfill" && log153.est && log153.est.staple === "brown" && log153.kcal > 300 && log153.kcal !== 700, "15-3 補記的紀錄不對：" + JSON.stringify(log153));
  await js(`(async () => { const m = ${DBW}; const logs = await m.getDailyLogs({ start: ${dayStr(2)}, end: ${dayStr(2)} }); for (const l of logs) await m.undoDailyLog(l.id); })()`);
  await tab("today");

  // ---------- 16. 家庭共餐（自煮，decisions #152，設計草案 docs/review/2026-10-04-家庭共餐-設計草案.md） ----------
  console.log("[16. 家庭共餐]");
  const hmLogs = (date) => js(`(async () => { const m = ${DBW}; return (await m.getDailyLogs({ start: ${date}, end: ${date} })).map((l) => JSON.stringify({ slot: l.slot, source: l.source, name: l.name, kcal: l.totals.kcal, type: l.meal_type, arch: l.content.archetype_id, imp: l.content.implicit, comps: l.content.components.map((c) => c.kind + ':' + c.ref + '=' + c.amount) })); })()`);
  const hmPick = async (nDishes, withSoup) => {
    const ids = await js(`[...document.querySelectorAll('#meal-picker-panel [data-hm-dish]:not([disabled])')].map((b) => b.getAttribute('data-hm-dish')).slice(0, ${nDishes})`);
    for (const id of ids) await click(`#meal-picker-panel [data-hm-dish="${id}"]`);
    if (withSoup) {
      const sid = await js(`([...document.querySelectorAll('#meal-picker-panel [data-hm-soup]:not([disabled])')].map((b) => b.getAttribute('data-hm-soup')).filter(Boolean))[0]`);
      await click(`#meal-picker-panel [data-hm-soup="${sid}"]`);
    }
    return ids;
  };
  // 16-1 晚餐：自煮 → 開伙 → 「共餐」→ 選 3 道菜加 1 道湯 → 記下
  await tab("today");
  await openPicker("dinner");
  await click(`#meal-picker-tabs [data-tab=cook]`);
  await click(`#meal-picker-panel [data-tier=cook_full]`);
  check(await js(`!!document.querySelector('#meal-picker-panel [data-hm-toggle]')`), "16-1 晚餐開伙的「選餐型」沒有「共餐」");
  check(!(await js(`!!document.querySelector('#meal-picker-panel [data-hm-dish]')`)), "16-1 沒按「共餐」前不該顯示菜單");
  await click(`#meal-picker-panel [data-hm-toggle]`);
  await until(`!!document.querySelector('#meal-picker-panel [data-hm-dish]')`, "16-1 按「共餐」沒有出現家常菜");
  const hmText0 = await js(text("#meal-picker-panel"));
  check(hmText0.indexOf("素菜") !== -1 && hmText0.indexOf("菜肉") !== -1 && hmText0.indexOf("純肉") !== -1 && hmText0.indexOf("當季") !== -1 && hmText0.indexOf("最多 4 道") !== -1, "16-1 共餐沒有素菜／菜肉／純肉分組或「最多 4 道」：" + hmText0.slice(0, 200));
  await shot("共餐-預設", "#meal-picker-panel");
  const picked16 = await hmPick(3, true);
  await until(`${text("#meal-picker-summary")}.indexOf("kcal") !== -1 && ${text("#meal-picker-summary")}.indexOf("已選 4 件") !== -1`, "16-1 選了 3 道菜加湯後摘要不是已選 4 件");
  check((await js(text("#meal-picker-panel"))).indexOf("每道菜約") !== -1, "16-1 沒有每道菜的克數");
  await shot("共餐-已選", "#meal-picker-panel");
  await send("Emulation.setDeviceMetricsOverride", { width: 360, height: 780, deviceScaleFactor: 2, mobile: true });
  await shot("共餐-360寬", "#meal-picker-panel");
  await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  // 同一道菜不能選第五道：先選滿 4 道再看第 5 個按鈕選不進去
  const more = await js(`[...document.querySelectorAll('#meal-picker-panel [data-hm-dish]:not([disabled]):not(.selected)')].map((b) => b.getAttribute('data-hm-dish')).slice(0, 3)`);
  for (const id of more) await click(`#meal-picker-panel [data-hm-dish="${id}"]`);
  check((await js(`document.querySelectorAll('#meal-picker-panel [data-hm-dish].selected').length`)) === 4, "16-1 共餐的菜要停在 4 道（再點不會超過）");
  await click("#meal-picker-submit");
  await until(`document.getElementById('meal-picker-overlay').hidden && ${text("#rec-dinner")}.indexOf("共餐：") !== -1`, "16-1 送出後晚餐紀錄沒有「共餐：」");
  const todayStr16 = `(() => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); })()`;
  const log16 = JSON.parse((await hmLogs(todayStr16)).filter((x) => /"slot":"dinner"/.test(x))[0] || "{}");
  check(log16.type === "cook_full" && log16.arch === null && log16.imp && log16.imp.oil_g === 0 && log16.comps.length >= 4 && log16.comps.every((c) => /^food:/.test(c)) && log16.comps.some((c) => /^food:hd_/.test(c)) && log16.name.indexOf("共餐：") === 0 && !/\d+g/.test(log16.name),
    "16-1 共餐紀錄不是自煮的 hd_ 單品、或名稱帶克數：" + JSON.stringify(log16));
  await click("#rec-dinner .rec-undo-btn");
  await until(`!!document.querySelector('#rec-dinner .rec-log-btn') || !!document.querySelector('#rec-dinner .rec-pick-btn')`, "16-1 撤銷晚餐沒有完成");
  // 16-2 早餐沒有「共餐」；午餐開伙有；切到快煮就收起
  await openPicker("breakfast");
  await click(`#meal-picker-tabs [data-tab=cook]`);
  check(!(await js(`!!document.querySelector('#meal-picker-panel [data-hm-toggle]')`)), "16-2 早餐不該有「共餐」");
  await closePicker();
  await openPicker("lunch");
  await click(`#meal-picker-tabs [data-tab=cook]`);
  await click(`#meal-picker-panel [data-tier=cook_full]`);
  await click(`#meal-picker-panel [data-hm-toggle]`);
  await hmPick(1, false);
  await click(`#meal-picker-panel [data-tier=cook_quick]`);
  check(!(await js(`!!document.querySelector('#meal-picker-panel [data-hm-toggle]')`)) && ((await js(text("#meal-picker-summary"))).indexOf("還沒配好") !== -1 || (await js(text("#meal-picker-summary"))).indexOf("已選 0 件") !== -1), "16-2 切到快煮後共餐沒有收起、或還算進這一餐：" + (await js(text("#meal-picker-summary"))));
  // 共餐與餐型擇一：點任一餐型就收起共餐
  await click(`#meal-picker-panel [data-tier=cook_full]`);
  await click(`#meal-picker-panel [data-hm-toggle]`);
  await until(`!!document.querySelector('#meal-picker-panel [data-hm-dish]')`, "16-2 再按「共餐」沒有展開");
  await click(`#meal-picker-panel [data-axis=archetype]`);
  check(!(await js(`!!document.querySelector('#meal-picker-panel [data-hm-dish]')`)), "16-2 選餐型後共餐沒有收起（擇一）");
  await closePicker();
  // 16-3 預約明天晚餐：共餐選 2 道 → 排進預約 → 預約只存 ref＋amount → 改（帶入）還原
  await click(`#today-dates [data-day-offset='1']`);
  await until(`!document.getElementById('today-day-summary').hidden`, "16-3 切到明天失敗");
  await click(`#rec-dinner [data-plan-pick=dinner]`);
  await until(`!document.getElementById('meal-picker-overlay').hidden && document.getElementById('meal-picker-panel').innerHTML !== ''`, "16-3 預約的選擇器沒有打開");
  await click(`#meal-picker-tabs [data-tab=cook]`);
  await click(`#meal-picker-panel [data-tier=cook_full]`);
  await click(`#meal-picker-panel [data-hm-toggle]`);
  const plan16ids = await hmPick(2, false);
  await click("#meal-picker-submit");
  await until(`${text("#today-day-summary")}.indexOf("已排 1 餐") !== -1`, "16-3 排完共餐沒有頂端合計");
  const plan16 = JSON.parse(await js(`(async () => { const m = ${DBW}; const d = new Date(); d.setDate(d.getDate() + 1); const ds = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    const p = (await m.getMealPlans({ start: ds, end: ds })).filter((x) => x.slot === 'dinner')[0]; return JSON.stringify(p.content.components.map((c) => c.kind + ':' + c.ref + '=' + c.amount + (c.snapshot ? '+snapshot' : ''))); })()`));
  check(plan16.length >= 3 && plan16.every((c) => /^food:/.test(c) && c.indexOf("+snapshot") === -1) && plan16.filter((c) => /^food:hd_/.test(c)).length === 2, "16-3 預約不是只存 ref＋amount 的 hd_ 單品：" + JSON.stringify(plan16));
  await shot("共餐-預約", "#rec-dinner");
  await click(`#rec-dinner [data-plan-edit=dinner]`);
  await until(`!document.getElementById('meal-picker-overlay').hidden && document.querySelectorAll('#meal-picker-panel [data-hm-dish].selected').length === 2`, "16-3 改預約沒有帶回 2 道共餐的菜");
  check(await js(`!!document.querySelector('#meal-picker-panel [data-hm-staple].selected')`), "16-3 帶回後主食沒有還原");
  await closePicker();
  await click(`#rec-dinner [data-plan-cancel]`);
  await until(`${text("#today-day-summary")}.indexOf("還沒排任何一餐") !== -1`, "16-3 取消預約後明天不是「還沒排」");
  await click(`#today-dates [data-day-offset='0']`);

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
if (warnings.length) { console.log("\n警告（不算失敗，看截圖判斷）："); warnings.forEach((w) => console.log("  ⚠ " + w)); }
console.log("\n截圖（" + shotNo + " 張）：" + OUT);
console.log((failures === 0 ? "全部通過" : failures + " 項失敗") + "（共 " + checks + " 項檢查）");
process.exit(failures === 0 ? 0 : 1);
