import { RARE_GLOW_LEVEL, type Rarity } from '@heartpatch/shared';
import { RARE_GLOW_CODE } from './config.js';

/**
 * Rare finds glow (#391): the per-squishy part of the `squishEvent.w` code.
 * The shader takes each part's glow colour from the part itself; a pure
 * white part has none, so it borrows the hue picked here from the palette.
 */

/** Hue (0–1) and saturation (0–1) of a `#rrggbb` colour. */
function hueSat(hex: string): [number, number] {
  const n = Number.parseInt(hex.slice(1, 7), 16);
  const r = ((n >> 16) & 255) / 255;
  const g = ((n >> 8) & 255) / 255;
  const b = (n & 255) / 255;
  const max = Math.max(r, g, b);
  const d = max - Math.min(r, g, b);
  let h = 0;
  if (d > 0) {
    if (max === r) h = ((g - b) / d + 6) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
  }
  return [h / 6, max === 0 ? 0 : d / max];
}

/** The palette's most colourful colour, as one of `RARE_GLOW_CODE.hues` hue steps. */
export function glowHueIndex(palette: readonly string[]): number {
  let best: [number, number] = [0, -1];
  for (const colour of palette) {
    const hs = hueSat(colour);
    if (hs[1] > best[1]) best = hs;
  }
  return Math.round(best[0] * RARE_GLOW_CODE.hues) % RARE_GLOW_CODE.hues;
}

/** The glow level for a rarity (0 for none, and for looks with no rarity). */
export function rareGlowLevel(rarity: Rarity | undefined): number {
  return rarity ? RARE_GLOW_LEVEL[rarity] : 0;
}

/**
 * `?rareglow=0` in the address turns the glow off, so the owner can compare
 * a real device's frame rate with and without it (with `?fps=1`, #391).
 * Cosmetic only: nothing else reads it.
 */
export function rareGlowOff(search: string): boolean {
  return new URLSearchParams(search).get('rareglow') === '0';
}
const OFF = typeof location !== 'undefined' && rareGlowOff(location.search);

/** What a squishy adds to its glowing pieces' codes: 0 below rare. */
export function rareGlowCode(
  rarity: Rarity | undefined,
  palette: readonly string[],
  off = OFF,
): number {
  const level = off ? 0 : rareGlowLevel(rarity);
  if (level === 0) return 0;
  return level * RARE_GLOW_CODE.level + glowHueIndex(palette) * RARE_GLOW_CODE.hue;
}

/** Splits a `squishEvent.w` code the way the shader does. */
export function decodeSquishCode(code: number): { base: number; level: number; hue: number } {
  const hue = Math.floor(code / RARE_GLOW_CODE.hue + 0.001);
  const rest = code - hue * RARE_GLOW_CODE.hue;
  const level = Math.floor(rest / RARE_GLOW_CODE.level + 0.001);
  return { base: rest - level * RARE_GLOW_CODE.level, level, hue };
}
