// 日期工具（唯一來源，章程 C2）。一律用本地日期字串 "YYYY-MM-DD" 運算。
// 這裡不讀時鐘：「今天」由 ui/clock.js 取得後當參數傳進來（engine 不得讀時鐘，章程 C1.1）。

// 台灣的季節（共餐家常菜只列當季，decisions #152）：春 3–5、夏 6–8、秋 9–11、冬 12–2 月
export function seasonOfDate(dateStr) {
  const m = Number(String(dateStr).slice(5, 7));
  if (!(m >= 1 && m <= 12)) throw new Error("[dates.js] 日期不對：" + dateStr);
  return m >= 3 && m <= 5 ? "spring" : m >= 6 && m <= 8 ? "summer" : m >= 9 && m <= 11 ? "autumn" : "winter";
}

export function fmtDate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return y + "-" + m + "-" + day;
}

export function dateAddDays(dateStr, days) {
  const d = new Date(dateStr + "T00:00:00");
  d.setDate(d.getDate() + days);
  return fmtDate(d);
}

export function diffDays(a, b) {
  const da = new Date(a + "T00:00:00");
  const db = new Date(b + "T00:00:00");
  return Math.round((db - da) / 86400000);
}

// 該日期所在那週的週一
export function mondayOf(dateStr) {
  const d = new Date(dateStr + "T00:00:00");
  const day = d.getDay(); // 0=Sun
  const diff = day === 0 ? 6 : day - 1;
  d.setDate(d.getDate() - diff);
  return fmtDate(d);
}

export function shortDate(dateStr) {
  return dateStr ? dateStr.slice(5).replace("-", "/") : "";
}

// 「週六」這類短字（日期切換的圓點）
export function weekdayLabel(dateStr) {
  return "週" + "日一二三四五六".charAt(new Date(dateStr + "T00:00:00").getDay());
}
