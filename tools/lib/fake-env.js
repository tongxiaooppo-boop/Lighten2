// 快照與檢查工具共用的假環境：固定時區、固定時鐘、假 DOM。
// 時區：CI 在 UTC 跑，本機在台灣。v1 的日期運算依賴本機時區（daysSince 的時區 bug 就是這樣來的），
// 所以一律在 Asia/Taipei 下跑，不然同一份快照在兩個地方會對不上。

"use strict";

const { spawnSync } = require("child_process");

const TZ = "Asia/Taipei";

// 用 TZ=Asia/Taipei 重跑目前這支腳本；已經是就回傳 false 讓呼叫端繼續。
function ensureTaipeiTZ() {
  if (process.env.TZ === TZ) {
    if (new Date(2026, 0, 1).getTimezoneOffset() !== -480) {
      throw new Error("TZ=" + TZ + " 沒有生效（getTimezoneOffset 不是 -480）");
    }
    return false;
  }
  const r = spawnSync(process.execPath, process.argv.slice(1), {
    env: Object.assign({}, process.env, { TZ: TZ }),
    stdio: "inherit",
  });
  process.exit(r.status == null ? 1 : r.status);
}

// 固定時鐘：替換全域 Date，無參數的 new Date() 與 Date.now() 回傳 setNow 設定的時間。
const RealDate = Date;
let nowMs = null;

class FakeDate extends RealDate {
  constructor(...args) {
    if (args.length === 0) {
      if (nowMs == null) throw new Error("固定時鐘還沒設定（setNow）");
      super(nowMs);
    } else {
      super(...args);
    }
  }
  static now() {
    if (nowMs == null) throw new Error("固定時鐘還沒設定（setNow）");
    return nowMs;
  }
}

function installClock() {
  global.Date = FakeDate;
}

// "2026-09-23T10:00" → 當地時間
function setNow(localIso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(localIso);
  if (!m) throw new Error("setNow 格式要是 YYYY-MM-DDTHH:MM：" + localIso);
  nowMs = new RealDate(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]).getTime();
}

// 假 DOM：querySelector 依選擇器回傳一個記錄 textContent/innerHTML/hidden/disabled 的物件，
// 跑完畫面函式後用 dump() 把所有被寫過的元素依選擇器排序輸出，當作畫面快照。
function createFakeDocument() {
  let els = {};
  function makeEl(sel) {
    return {
      _sel: sel,
      textContent: "",
      innerHTML: "",
      hidden: false,
      disabled: false,
      value: "",
      querySelector: function () { return null; },
      querySelectorAll: function () { return []; },
      addEventListener: function () {},
    };
  }
  const doc = {
    readyState: "loading", // 讓各分頁的 ready() 只掛事件、不自動執行
    addEventListener: function () {},
    querySelector: function (sel) {
      if (!els[sel]) els[sel] = makeEl(sel);
      return els[sel];
    },
    getElementById: function (id) { return doc.querySelector("#" + id); },
    querySelectorAll: function () { return []; },
  };
  return {
    document: doc,
    reset: function () { els = {}; },
    dump: function () {
      return Object.keys(els).sort().map(function (sel) {
        const e = els[sel];
        const parts = [];
        if (e.hidden) parts.push("hidden");
        if (e.disabled) parts.push("disabled");
        if (e.textContent !== "") parts.push("text=" + JSON.stringify(String(e.textContent)));
        if (e.innerHTML !== "") parts.push("html=" + JSON.stringify(String(e.innerHTML)));
        return sel + " " + (parts.length ? parts.join(" ") : "(untouched)");
      });
    },
  };
}

module.exports = { ensureTaipeiTZ, installClock, setNow, createFakeDocument, RealDate };
