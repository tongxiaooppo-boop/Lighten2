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
    const smallInPicker = [...document.querySelectorAll("#meal-picker-overlay button, #meal-picker-overlay summary, #meal-picker-overlay input:not([type=hidden])")]
      .filter((el) => visible(el) && el.getBoundingClientRect().height < 44)
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
const foodsSub = (t) => click(`[data-foods-subtab=${t}]`);
const foodsSearch = (q) => js(`(() => { const el = document.getElementById('foods-search'); el.value = ${JSON.stringify(q)}; el.dispatchEvent(new Event('input', { bubbles: true })); })()`);
const openFolded = () => js(`document.querySelectorAll('#foods-body details').forEach((d) => { d.open = true; })`);
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
  await shot("我的食物-沒有基本資料", "#foods-body .food-detail");

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
  check((await js(`[...document.querySelectorAll('#meal-picker-panel .item-card')].map((c) => c.innerText).join('|')`)).indexOf("便當") !== -1, "3-7 外食分頁沒有列出便當");
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
  // 3-5a 自煮分頁沒配好只選飲料 → 不能送出，提示到超商或外食分頁
  await closePicker();
  await openPicker("breakfast");
  await click(`#meal-picker-tabs [data-tab=cook]`);
  await click(`#meal-picker-drinks [data-drink="tw_dr05"]`);
  check((await js(`document.getElementById('meal-picker-submit').disabled`)) && (await js(text("#meal-picker-hint"))).indexOf("只記飲料請到超商或外食分頁") !== -1, "3-5a 自煮分頁只選飲料時沒有擋下或沒有提示到超商／外食分頁");
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

  // 7-3 封存複製品 → 移到「已封存」、提示原品項仍隱藏；還原
  await openFood(builtinName);
  await inFoodRow(builtinName, "[data-cf-archive]");
  await until(`${text("#foods-status")}.indexOf("仍是隱藏的") !== -1 && [...document.querySelectorAll('#foods-body details.foods-folded > summary')].some((s) => s.innerText.indexOf("已封存") === 0)`, "7-3 封存複製品後沒有「已封存」組或沒有「仍是隱藏的」提示");
  await openFolded();
  // 複製品跟被隱藏的原品項同名：只在「已封存」組裡找
  const archivedRow = `[...[...document.querySelectorAll('#foods-body details.foods-folded')].find((d) => d.querySelector('summary').innerText.indexOf("已封存") === 0).querySelectorAll('.food-row')].find((r) => r.querySelector('.food-name').textContent === ${JSON.stringify(builtinName)})`;
  await js(`(() => { const r = ${archivedRow}; if (!r.querySelector('[data-cf-restore]')) r.querySelector('.food-row-main').click(); })()`);
  await until(`!!(${archivedRow}).querySelector('[data-cf-restore]')`, "7-3 已封存的複製品明細沒有「還原」");
  await js(`(${archivedRow}).querySelector('[data-cf-restore]').click()`);
  await until(`${text("#foods-status")}.indexOf("已還原") !== -1 && ![...document.querySelectorAll('#foods-body details.foods-folded > summary')].some((s) => s.innerText.indexOf("已封存") === 0)`, "7-3 還原後沒有回到清單");

  // 7-4 已隱藏的內建品項：取消隱藏，有複製品時提示
  await openFolded();
  check(!!(await js(`!!(${foodRow(builtinName)}) && [...document.querySelectorAll('#foods-body details.foods-folded')].some((d) => d.querySelector('summary').innerText.indexOf("已隱藏") === 0 && d.innerText.indexOf(${JSON.stringify(builtinName)}) !== -1)`)), "7-4 「已隱藏」組沒有列出複製時自動隱藏的原品項");
  await shot("我的食物-已隱藏", "#foods-body details.foods-folded");
  await js(`(() => { const d = [...document.querySelectorAll('#foods-body details.foods-folded')].find((x) => x.querySelector('summary').innerText.indexOf("已隱藏") === 0);
    const b = [...d.querySelectorAll('.food-row')].find((r) => r.innerText.indexOf(${JSON.stringify(builtinName)}) !== -1).querySelector('[data-cf-unhide]'); b.click(); })()`);
  await until(`${text("#foods-status")}.indexOf("你有一筆從它複製的我的品項") !== -1`, "7-4 取消隱藏時沒有提示有複製品");

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
