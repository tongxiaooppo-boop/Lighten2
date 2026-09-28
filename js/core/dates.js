// 日期工具（唯一來源，章程 C2）。一律用本地日期字串 "YYYY-MM-DD" 運算。
// 這裡不讀時鐘：「今天」由 ui/clock.js 取得後當參數傳進來（engine 不得讀時鐘，章程 C1.1）。

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
