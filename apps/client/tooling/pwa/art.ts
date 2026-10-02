import type { Raster } from './png.js';

// The app icon and splash art: a glossy vinyl-toy heart squishy (design doc
// §19), drawn per pixel from signed distance fields so every size is crisp
// and anti-aliased. Procedural, so there are no third-party assets.

type Rgb = readonly [number, number, number];

export const BACKGROUND: Rgb = [0xfd, 0xe8, 0xf0]; // theme colour, #fde8f0
const BODY_TOP: Rgb = [0xff, 0x96, 0xba];
const BODY_BOTTOM: Rgb = [0xf7, 0x68, 0x98];
const RIM: Rgb = [0xe8, 0x54, 0x88];
const SHADOW: Rgb = [0xe6, 0xaa, 0xc3];
const BLUSH: Rgb = [0xff, 0x5c, 0x93];
const FACE: Rgb = [0x4a, 0x31, 0x50];
const WHITE: Rgb = [0xff, 0xff, 0xff];

/** Corner rounding added to the heart, in heart units: puffier, no sharp tip. */
const PUFF = 0.1;
/**
 * The rounded heart spans x ±0.70 and y −0.10…1.20 (heart units, y up); with
 * its shadow, the art spans x ±0.75 and y −0.26…1.22.
 */
const HEART_WIDTH = 1.41;
const ART_TOP = 1.22;
const ART_HEIGHT = 1.48;
const HIGHLIGHT_COS = Math.cos(0.45); // tilt, radians
const HIGHLIGHT_SIN = Math.sin(0.45);

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
/** Anti-aliased coverage of a shape at signed distance `d`, `aa` = one pixel. */
const coverage = (d: number, aa: number) => clamp01(0.5 - d / aa);
// Faster than Math.hypot, which matters at millions of pixels per build.
const length = (x: number, y: number) => Math.sqrt(x * x + y * y);
const smoothstep = (a: number, b: number, v: number) => {
  const t = clamp01((v - a) / (b - a));
  return t * t * (3 - 2 * t);
};

/** Exact signed distance to a heart with its tip at the origin (Inigo Quilez). */
function heartDistance(px: number, py: number): number {
  const x = Math.abs(px);
  if (py + x > 1) return length(x - 0.25, py - 0.75) - Math.SQRT2 / 4;
  const toTop = x * x + (py - 1) * (py - 1);
  const m = 0.5 * Math.max(x + py, 0);
  const toAxis = (x - m) * (x - m) + (py - m) * (py - m);
  return Math.sqrt(Math.min(toTop, toAxis)) * Math.sign(x - py);
}

/** Approximate signed distance to an ellipse (good near its edge, which is all AA needs). */
function ellipseDistance(
  x: number,
  y: number,
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  c = 1, // cosine and sine of the ellipse's tilt
  s = 0,
): number {
  const dx = x - cx;
  const dy = y - cy;
  const u = (dx * c + dy * s) / rx;
  const v = (dy * c - dx * s) / ry;
  return (length(u, v) - 1) * Math.min(rx, ry);
}

/** A smile: the lower half of a circle, with round ends. */
function smileDistance(x: number, y: number): number {
  const cy = 0.55;
  const r = 0.085;
  const halfWidth = 0.016;
  if (y <= cy) return Math.abs(length(x, y - cy) - r) - halfWidth;
  return length(Math.abs(x) - r, y - cy) - halfWidth;
}

/** A working pixel, in floating point until it's written out. */
interface Pixel {
  r: number;
  g: number;
  b: number;
}

function paint(out: Pixel, [r, g, b]: Rgb): void {
  out.r = r;
  out.g = g;
  out.b = b;
}

/** Blends `color` over the working pixel in place, by `t` (0…1). */
function over(out: Pixel, [r, g, b]: Rgb, t: number): void {
  if (t <= 0) return;
  out.r += (r - out.r) * t;
  out.g += (g - out.g) * t;
  out.b += (b - out.b) * t;
}

const skin: Pixel = { r: 0, g: 0, b: 0 };

/**
 * The squishy at a point in heart units, over the background, into `out`.
 * Returns false (leaving `out` alone) where there's only background.
 */
function shade(x: number, y: number, aa: number, out: Pixel): boolean {
  const shadowR = length(x / 0.56, (y + 0.16) / 0.09);
  const d = heartDistance(x, y) - PUFF;
  if (shadowR >= 1 && d >= aa) return false;

  paint(out, BACKGROUND);
  // Soft contact shadow under the toy.
  over(out, SHADOW, 0.6 * (1 - smoothstep(0.55, 1, shadowR)));
  const body = coverage(d, aa);
  if (body <= 0) return true;

  // Lit from above, with a slightly darker rim so it reads as a soft 3D toy.
  paint(skin, BODY_BOTTOM);
  over(skin, BODY_TOP, smoothstep(0, 1.15, y));
  over(skin, RIM, 0.55 * (1 - smoothstep(0, 0.14, -d)));
  if (y > 0.4 && y < 1.1) addFace(x, y, aa, skin);
  // Glossy vinyl highlight on the upper-left lobe.
  over(
    skin,
    WHITE,
    0.6 *
      coverage(ellipseDistance(x, y, -0.33, 0.9, 0.14, 0.075, HIGHLIGHT_COS, HIGHLIGHT_SIN), aa),
  );
  over(skin, WHITE, 0.6 * coverage(length(x + 0.12, y - 1.0) - 0.035, aa));

  over(out, [skin.r, skin.g, skin.b], body);
  return true;
}

/** Blush, eyes with sparkles, and a smile. */
function addFace(x: number, y: number, aa: number, skin: Pixel): void {
  over(skin, BLUSH, 0.45 * coverage(ellipseDistance(x, y, -0.36, 0.5, 0.1, 0.06), aa));
  over(skin, BLUSH, 0.45 * coverage(ellipseDistance(x, y, 0.36, 0.5, 0.1, 0.06), aa));
  over(skin, FACE, coverage(ellipseDistance(x, y, -0.21, 0.66, 0.055, 0.075), aa));
  over(skin, FACE, coverage(ellipseDistance(x, y, 0.21, 0.66, 0.055, 0.075), aa));
  over(skin, WHITE, coverage(length(x + 0.228, y - 0.69) - 0.02, aa));
  over(skin, WHITE, coverage(length(x - 0.192, y - 0.69) - 0.02, aa));
  over(skin, FACE, coverage(smileDistance(x, y), aa));
}

function solid(width: number, height: number, color: Rgb): Raster {
  const pixels = new Uint8Array(width * height * 3);
  pixels.set(color);
  // Doubling copies: a few dozen memmoves instead of millions of writes.
  for (let filled = 3; filled < pixels.length; filled *= 2) {
    pixels.copyWithin(filled, 0, Math.min(filled, pixels.length - filled));
  }
  return { width, height, pixels };
}

/** The squishy and its shadow on the background, `size` pixels across the heart. */
function renderSquishy(size: number): Raster {
  const scale = size / HEART_WIDTH;
  const width = Math.ceil(1.5 * scale);
  const height = Math.ceil(ART_HEIGHT * scale);
  const raster = solid(width, height, BACKGROUND);
  const aa = 1 / scale;
  const pixel: Pixel = { r: 0, g: 0, b: 0 };
  for (let py = 0; py < height; py++) {
    const hy = ART_TOP - (py + 0.5) / scale;
    for (let px = 0; px < width; px++) {
      if (!shade((px + 0.5) / scale - 0.75, hy, aa, pixel)) continue;
      const i = (py * width + px) * 3;
      raster.pixels.set([Math.round(pixel.r), Math.round(pixel.g), Math.round(pixel.b)], i);
    }
  }
  return raster;
}

/** Splashes for both orientations of a device share one squishy. */
const squishies = new Map<number, Raster>();

/** Copies the squishy onto `raster`, centred on (cx, cy). */
function drawSquishy(raster: Raster, cx: number, cy: number, size: number): void {
  const px = Math.round(size);
  let art = squishies.get(px);
  if (!art) {
    art = renderSquishy(px);
    squishies.set(px, art);
  }
  const left = Math.round(cx - art.width / 2);
  const top = Math.round(cy - art.height / 2);
  for (let y = 0; y < art.height; y++) {
    const row = top + y;
    if (row < 0 || row >= raster.height) continue;
    const from = Math.max(0, -left);
    const to = Math.min(art.width, raster.width - left);
    if (to <= from) continue;
    raster.pixels.set(
      art.pixels.subarray((y * art.width + from) * 3, (y * art.width + to) * 3),
      (row * raster.width + left + from) * 3,
    );
  }
}

/**
 * A square, opaque app icon. `fill` is the heart's width as a fraction of the
 * icon: smaller for maskable icons, whose edges the OS may crop to a circle.
 */
export function renderIcon(size: number, fill: number): Raster {
  const raster = solid(size, size, BACKGROUND);
  drawSquishy(raster, size / 2, size / 2, size * fill);
  return raster;
}

/** A launch screen: the squishy on the theme colour, a little above centre. */
export function renderSplash(width: number, height: number): Raster {
  const raster = solid(width, height, BACKGROUND);
  drawSquishy(raster, width / 2, height * 0.46, Math.min(width, height) * 0.32);
  return raster;
}
