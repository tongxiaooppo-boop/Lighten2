// 數值工具（唯一來源，章程 C2）

export function round1(n) {
  return Math.round(n * 10) / 10;
}

export function isNum(v) {
  return typeof v === "number" && isFinite(v);
}
