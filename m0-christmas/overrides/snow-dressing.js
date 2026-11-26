// MOCK (capture time only): the Christmas tile colours. Appended to the served map-dressing module, which had
// `export function tileColor(` renamed to `tileColorToday(`. Wild (muted) land goes cool snow-white; owned land stays
// a touch warmer and keeps more of its own green; lakes get a frosted tint. Per-instance colour only: 0 draw calls.
export function tileColor(lookColor, jitter, muted) {
  const c = tileColorToday(lookColor, jitter, muted);
  if (sessionStorage.getItem('__capSnow') !== '1') return c;
  const SNOW = {
    '#c2eaa6': 0.94, '#93d6a0': 0.9, '#74b994': 0.86, '#e2d1a4': 0.94, '#c9bddb': 0.55,
    '#f4d68e': 0.9, '#efcf95': 0.8, '#c2eefb': 0.55,
  };
  const share = muted === true ? 1 : muted === false ? 0 : Math.min(1, Math.max(0, muted));
  const wild = share >= 0.5;
  let k = SNOW[lookColor.toLowerCase()];
  let target;
  if (lookColor.toLowerCase() === '#9fd6f5') { k = 0.62; target = [0.82, 0.92, 0.98]; }       // frosted lake
  else target = wild ? [1.0, 1.0, 1.0] : [1.0, 0.95, 0.86];                                  // cool wild / warm owned
  if (k === undefined) return c;
  if (!wild && lookColor.toLowerCase() !== '#9fd6f5') k *= 0.74;                                 // owned keeps more of itself
  const b = Math.min(1.08, Math.max(1.0, 1.0 + (jitter.brightness - 1) * 0.5 + 0.04));
  return c.map((v, i) => v + (Math.min(1, target[i] * b) - v) * k);
}
