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
    return { scrollW: document.documentElement.scrollWidth, W: W, overflow: overflow, imgs: imgs, small: [...new Set(small)] };
  })()`);
  check(layout.scrollW <= layout.W + 1, label + "：畫面左右溢出（寬 " + layout.scrollW + " > " + layout.W + "）" + layout.overflow.join(", "));
  const badImgs = layout.imgs.filter((s) => !/^images\/gemini\/meal-default-[a-z_-]+\.jpg$/.test(s || ""));
  check(badImgs.length === 0, label + "：出現時段插畫以外的圖（decisions #8）：" + badImgs.join(", "));
  if (layout.small.length) warnings.push(label + "：按鈕高度不到 44px " + layout.small.join(" "));
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
  await until(`!document.getElementById('manual-picker-overlay').hidden && document.querySelectorAll('#manual-picker-items .item-card').length > 0`, slot + " 的自己選沒有打開");
};
const closePicker = () => click("#manual-picker-cancel");
const composeMode = () => click("input[name=manual-picker-mode][value=compose]");
const composePick = (axis, id) => click(`#manual-picker-compose-mode .compose-option[data-axis=${axis}]${id ? `[data-id=${id}]` : ":not([disabled])"}`);
const summary = () => js(text("#manual-picker-summary"));
// 選有的軸（沒有主食槽的餐型不點主食）
const composeFill = async (axes) => { for (const ax of axes) {
  if (await js(`!!document.querySelector('#manual-picker-compose-mode .compose-option[data-axis=${ax}]:not([disabled])')`)) await composePick(ax);
} };
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
  // 3-1 打開、純文字卡片
  await openPicker("lunch");
  check((await js(`document.querySelectorAll('#manual-picker-items .item-card img, #manual-picker-items .item-card-img').length`)) === 0, "3-1 品項卡片有圖片（decisions #8）");
  await shot("自己選-午餐");
  // 3-2 選一個主餐 → 摘要；同一角色第二個 → 提示
  const mains = await js(`[...document.querySelectorAll('#manual-picker-items .item-card:not([disabled])')].map((c) => c.dataset.uid)`);
  // 同一角色要有 2 個以上可選品項，才測得到「第二個出現提示」；主餐優先
  const mainUids = await js(`(async () => { const m = await import('./js/data/catalog.js'); const c = await m.loadCatalog();
    const role = (u) => (c.productsByUid[u] || {}).role;
    const by = {}; ${JSON.stringify(mains)}.forEach((u) => { (by[role(u)] = by[role(u)] || []).push(u); });
    return ['main', 'side', 'snack', 'drink'].map((r) => by[r] || []).find((l) => l.length >= 2) || []; })()`);
  check(mainUids.length >= 2, "3-2 午餐自己選沒有任何角色有 2 個以上可選品項");
  if (mainUids.length >= 2) {
    await click(`#manual-picker-items .item-card[data-uid="${mainUids[0]}"]`);
    await until(`/已選 1 件 · 約 \\d+ kcal.*鈉 (約 \\d+ mg|無資料)/.test(${text("#manual-picker-summary")}.replace(/\\n/g, ' '))`, "3-2 選一個品項後摘要不是「已選 1 件 · 約 N kcal … · 鈉 …」");
    await shot("自己選-選一個主餐", "#manual-picker-summary");
    const dialogsBefore = H.dialogs.length;
    await click(`#manual-picker-items .item-card[data-uid="${mainUids[1]}"]`);
    await new Promise((r) => setTimeout(r, 300));
    check(H.dialogs.length > dialogsBefore && /已經選過了/.test(H.dialogs[H.dialogs.length - 1]), "3-2 同一角色選第二個沒有出現提示");
  }
  // 3-6 取消 → 沒有記錄
  await closePicker();
  await until(`document.getElementById('manual-picker-overlay').hidden`, "3-6 按取消後視窗沒有關閉");
  check((await recText("lunch")).indexOf("已記錄") === -1, "3-6 按取消卻記錄了午餐");
  // 3-2a 早餐只選拿鐵：鈉約 113 mg、可以送出
  await openPicker("breakfast");
  await click(`#manual-picker-items .item-card[data-uid="tw_dr05"]`);
  await until(`${text("#manual-picker-summary")}.indexOf("鈉 約 113 mg") !== -1`, "3-2a 早餐只選拿鐵，摘要不是「鈉 約 113 mg」");
  check(!(await js(`document.getElementById('manual-picker-submit').disabled`)), "3-2a 只選一杯飲料時「記下這餐」不能按");
  await shot("自己選-早餐只選拿鐵", "#manual-picker-summary");
  // 3-3 記下這餐
  await click("#manual-picker-submit");
  await until(`document.getElementById('manual-picker-overlay').hidden && ${text("#rec-breakfast")}.indexOf("已記錄") !== -1`, "3-3 記下這餐後視窗沒關或早餐沒有變成已記錄");
  await click("#rec-breakfast .rec-undo-btn");
  await until(`!!document.querySelector('#rec-breakfast .rec-log-btn')`, "3-3 撤銷早餐沒有完成");
  // 3-2b 設過敏原並按計算 → 沙拉等複合料理灰掉、成分未確認
  await tab("profile");
  await setAllergens(["蛋"]);
  await submitProfile();
  await until(`${text("#target-kcal")} === "1896.1"`, "3-2b 勾過敏原後按計算沒有完成");
  await openPicker("lunch");
  const blocked = await js(`[...document.querySelectorAll('#manual-picker-items .item-card.is-blocked')].map((c) => c.dataset.uid + ':' + c.innerText.replace(/\\n/g, ' '))`);
  ["conv_sl01", "conv_sl02", "conv_sl04"].forEach((uid) => {
    const b = blocked.find((x) => x.indexOf(uid + ":") === 0);
    check(b && b.indexOf("成分未確認") !== -1, "3-2b 設了過敏原，" + uid + " 沒有灰掉並顯示「成分未確認」");
  });
  await shot("自己選-過敏原被擋（清單最後）", "#manual-picker-items .item-card.is-blocked");
  await closePicker();
  await tab("profile");
  await setAllergens([]);
  await submitProfile();
  await until(`${text("#target-kcal")} === "1896.1"`, "3-2b 取消過敏原後按計算沒有完成");
  // 3-4、3-4a 自己煮：溫沙拉「未含沙拉醬」、其他餐型沒有
  await openPicker("lunch");
  await composeMode();
  await until(`!document.getElementById('manual-picker-compose-mode').hidden`, "3-4 切到自己煮沒有反應");
  await shot("自己煮-選餐型");
  await composePick("archetype", "warm_salad");
  await composeFill(["protein", "staple", "method"]);
  await until(`${text("#manual-picker-summary")}.indexOf("已配好") !== -1 && ${text("#manual-picker-summary")}.indexOf("未含沙拉醬") !== -1`, "3-4a 溫沙拉的摘要沒有「未含沙拉醬」");
  check(!(await js(`document.getElementById('manual-picker-submit').disabled`)), "3-4 自己煮選好後不能送出");
  await shot("自己煮-溫沙拉", "#manual-picker-summary");
  const other = await js(`[...document.querySelectorAll('#manual-picker-compose-mode .compose-option[data-axis=archetype]')].map((b) => b.dataset.id).find((id) => id !== 'warm_salad')`);
  await composePick("archetype", other);
  await composeFill(["protein", "staple", "method"]);
  await until(`${text("#manual-picker-summary")}.indexOf("已配好") !== -1`, "3-4a 換成 " + other + " 後沒有配好");
  check((await summary()).indexOf("未含沙拉醬") === -1, "3-4a 換成 " + other + " 還顯示「未含沙拉醬」");
  // 3-4 份量滑桿（有的話）拖了摘要要變
  const hasSlider = await js(`!!document.querySelector('#manual-picker-compose-mode input[type=range]')`);
  if (hasSlider) {
    const s1 = await summary();
    await js(`(() => { const r = document.querySelector('#manual-picker-compose-mode input[type=range]'); r.value = r.max; r.dispatchEvent(new Event('input', { bubbles: true })); r.dispatchEvent(new Event('change', { bubbles: true })); })()`);
    await until(`${text("#manual-picker-summary")} !== ${JSON.stringify(s1)}`, "3-4 拖份量滑桿後摘要沒變");
  } else warnings.push("3-4 自己煮沒有找到份量滑桿（input[type=range]）");
  await shot("自己煮-其他餐型", "#manual-picker-summary");
  await click("#manual-picker-submit");
  await until(`document.getElementById('manual-picker-overlay').hidden && ${text("#rec-lunch")}.indexOf("已記錄") !== -1`, "3-4 自己煮記下這餐後午餐沒有變成已記錄");
  // 3-5 早餐碗：免開火、微波都能選
  await openPicker("breakfast");
  await composeMode();
  await composePick("archetype", "bowl_oat");
  const methods = await js(`[...document.querySelectorAll('#manual-picker-compose-mode .compose-option[data-axis=method]')].map((b) => b.innerText.trim() + (b.disabled ? '(不可選)' : ''))`);
  check(methods.some((m) => m.indexOf("免開火") === 0) && methods.some((m) => m.indexOf("微波") === 0) && methods.every((m) => m.indexOf("不可選") === -1),
    "3-5 早餐碗的烹調法不是免開火、微波都可選：" + methods.join(","));
  await shot("自己煮-早餐碗", "#manual-picker-compose-mode");
  await closePicker();

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
