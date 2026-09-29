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
// 推薦卡片是整塊重畫的：切分頁前放一個標記，標記消失＝重算完成，才不會讀到舊卡片
const markStale = () => js(`document.querySelectorAll('[id^=rec-]').forEach((el) => el.insertAdjacentHTML('beforeend', '<i class="walkthrough-stale"></i>'))`);
const waitFresh = (label) => until(`!document.querySelector('.walkthrough-stale') && !!document.querySelector('#rec-dinner .rec-log-btn')`, label);

async function run() {
  // ---------- 0. 開啟 ----------
  console.log("[0. 開啟]");
  await send("Page.navigate", { url: H.url });
  await until(`${text("#today-status")}.indexOf("基本資料") !== -1`, "0-1 沒有基本資料時，今日建議沒有提示先填基本資料");
  check((await js(`[...document.querySelectorAll('.tab-btn')].map(b => b.innerText.trim()).join('/')`)) === "基本資料/今日建議/本週總覽/運動紀錄/採買清單",
    "0-1 上方分頁不是 基本資料／今日建議／本週總覽／運動紀錄／採買清單");
  await shot("開啟");

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
  check(allergenValues.length === 10 && allergenValues.indexOf("軟體動物") !== -1 && allergenValues.indexOf("花生") !== -1,
    "1-4 過敏原勾選框不是 10 個或缺軟體動物／花生：" + allergenValues.join(","));
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
  // 2-5 「順便不要」晶片：從推薦消失、出現在基本資料的不吃清單
  const chip = await js(`(() => { const c = document.querySelector('#rec-dinner .dislike-chip'); return c ? { key: c.dataset.key, label: c.dataset.label } : null; })()`);
  check(!!chip, "2-5 晚餐卡片沒有「順便不要」晶片");
  if (chip) {
    await click(`#rec-dinner .dislike-chip[data-key="${chip.key}"]`);
    await until(`!document.querySelector('#rec-dinner .dislike-chip[data-key="${chip.key}"]')`, "2-5 按「順便不要」後 " + chip.label + " 還在晚餐推薦裡");
    await shot("今日建議-順便不要之後", "#rec-dinner");
    await tab("profile");
    await until(`${text("#disliked-ingredients-list")}.indexOf(${JSON.stringify(chip.label)}) !== -1`, "2-5 基本資料的不吃清單沒有 " + chip.label);
    await shot("基本資料-不吃清單", "#disliked-ingredients-list");
    // 接著在基本資料按「計算」：不能把剛加的不吃項目蓋掉
    const dbDisliked = `import('./js/data/db.js').then((m) => m.getProfile()).then((p) => JSON.stringify(((p || {}).disliked_ingredients || []).map((d) => d.key)))`;
    await submitProfile();
    await until(`${text("#target-kcal")} === "1896.1"`, "2-5 按計算沒有完成");
    check(JSON.parse(await js(dbDisliked)).indexOf(chip.key) !== -1, "2-5 在基本資料按「計算」把剛加的不吃項目 " + chip.label + " 蓋掉了");
    await click("#disliked-ingredients-list .dislike-chip-x"); // 還原，後面的步驟才有完整候選
    await markStale();
    await until(`(${dbDisliked}).then((s) => JSON.parse(s).indexOf(${JSON.stringify(chip.key)}) === -1)`, "2-5 按 × 移除後資料庫還有 " + chip.label);
    await submitProfile();
    await until(`${text("#target-kcal")} === "1896.1"`, "2-5 移除不吃項目後按計算沒有完成");
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
  check(/灰色的 \d+ 項因你的過敏原／飲食／不吃設定不能選/.test(await js(text("#meal-picker-panel"))), "3-2b 分頁頂端沒有「灰色的 N 項…不能選」");
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
