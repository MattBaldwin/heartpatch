// A big count, short enough for a meter (polish of #621 W1-10c): "10.8k",
// never "10800". Rounded down, so a meter one short of full never reads full.

/** 999 as is, 10800 as "10.8k", 2500000 as "2.5M". */
export function shortNumber(n: number): string {
  const whole = Math.floor(n);
  if (whole < 1_000) return String(whole);
  const [size, unit] = whole < 1_000_000 ? [1_000, 'k'] : [1_000_000, 'M'];
  // Tenths, rounded down; "10k", not "10.0k".
  const tenths = Math.floor((whole * 10) / size);
  return `${String(Math.floor(tenths / 10))}${tenths % 10 === 0 ? '' : `.${String(tenths % 10)}`}${unit}`;
}
