/**
 * Number formatting shared across the app. Balances/amounts are RAW integer token
 * units (the demo treats 1 raw unit as 1 "unit"), so everything works on BigInt and
 * never on lossy floats.
 */

/** Full grouped integer: 1234567 -> "1,234,567". */
export function fmtUnits(raw: string | number | bigint): string {
  try {
    return BigInt(raw).toLocaleString("en-US");
  } catch {
    return String(raw);
  }
}

const K = BigInt(1000);
const M = BigInt(1_000_000);
const B = BigInt(1_000_000_000);

/**
 * Compact form for dashboard tiles where a full 11-digit number would overflow:
 * 40_000_009_000 -> "40B", 9_000 -> "9K", 500 -> "500". Keeps one decimal below 10
 * of a unit so "1.2M" reads better than "1M".
 */
export function compactUnits(raw: string | number | bigint): string {
  let v: bigint;
  try {
    v = BigInt(raw);
  } catch {
    return String(raw);
  }
  const neg = v < BigInt(0);
  const abs = neg ? -v : v;
  const sign = neg ? "-" : "";

  if (abs >= B) return `${sign}${trim(Number(abs) / 1e9)}B`;
  if (abs >= M) return `${sign}${trim(Number(abs) / 1e6)}M`;
  if (abs >= K) return `${sign}${trim(Number(abs) / 1e3)}K`;
  return v.toLocaleString("en-US");
}

/** One decimal, but drop a trailing ".0" so 40.0 -> "40". */
function trim(n: number): string {
  const s = n.toFixed(1);
  return s.endsWith(".0") ? s.slice(0, -2) : s;
}
