import { WEATHER_LOOK } from './weather-config.js';

// How lit the sky is by lightning (#621 W1-9g): the same double flash the
// bolts draw in the rain plugin's vertex shader, worked out on the CPU from
// the same per-bolt numbers so the cloud bellies and the scene's light pulse
// with the bolts. No allocation: it reads the layout's fixed array.

/** One bolt's flash over its cycle (0 to 1): a bright strike, a dimmer second one, then dark. */
export function boltFlash(cycle: number): number {
  const a = Math.max(0, 1 - cycle * 7);
  const b = Math.max(0, 1 - Math.abs(cycle - 0.2) * 14);
  return Math.min(1, a * a + 0.6 * b * b);
}

/**
 * The sky's light from `count` bolts at clock `time`, 0 to 1. `attrs` holds
 * phase, speed, 0 and -1 (held) or -2 (flashing) per bolt, as the layout
 * writes them. A held bolt keeps the sky at `still` (no flicker when motion is
 * off); no bolts, no light.
 */
export function skyFlash(attrs: Float32Array, count: number, time: number): number {
  let lit = 0;
  for (let i = 0; i < count; i++) {
    const o = i * 4;
    if ((attrs[o + 3] ?? 0) > -1.5) {
      lit = Math.max(lit, WEATHER_LOOK.storm.flash.still);
      continue;
    }
    const t = time * (attrs[o + 1] ?? 0) + (attrs[o] ?? 0);
    lit = Math.max(lit, boltFlash(t - Math.floor(t)));
  }
  return lit;
}
