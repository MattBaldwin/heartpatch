import { BACKDROP } from './close-up-config.js';

/*
 * The close-up's depth of field, done cheaply (#20, tech spec §6): instead of
 * a depth-of-field post-process (a depth pass plus a wide blur at full
 * resolution, every frame), the view the player came from is snapshotted
 * once, shrunk to a few dozen pixels, blurred on the CPU and drawn behind the
 * squishy as a background layer. The GPU's bilinear upscaling smooths it out.
 * It costs one tiny texture and one full-screen quad per frame.
 */

/**
 * Separable box blur over RGBA pixels, in place, with edges clamped.
 * Three passes approximate a Gaussian.
 */
export function boxBlur(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  radius: number,
  passes = 1,
): void {
  if (radius <= 0 || width === 0 || height === 0) return;
  const scratch = new Float32Array(data.length);
  const span = radius * 2 + 1;
  const pass = (
    from: ArrayLike<number>,
    to: Float32Array | Uint8ClampedArray,
    horizontal: boolean,
  ) => {
    const lines = horizontal ? height : width;
    const length = horizontal ? width : height;
    for (let line = 0; line < lines; line++) {
      const at = (i: number) => {
        const k = Math.min(length - 1, Math.max(0, i));
        return 4 * (horizontal ? line * width + k : k * width + line);
      };
      for (let c = 0; c < 4; c++) {
        let sum = 0;
        for (let i = -radius; i <= radius; i++) sum += from[at(i) + c] ?? 0;
        for (let i = 0; i < length; i++) {
          to[at(i) + c] = sum / span;
          sum += (from[at(i + radius + 1) + c] ?? 0) - (from[at(i - radius) + c] ?? 0);
        }
      }
    }
  };
  for (let p = 0; p < passes; p++) {
    pass(data, scratch, true);
    pass(scratch, data, false);
  }
}

/** Mixes every pixel `amount` of the way to an sRGB hex colour, in place. */
export function tint(data: Uint8ClampedArray, hex: string, amount: number): void {
  const n = Number.parseInt(hex.replace('#', ''), 16);
  const rgb = [(n >> 16) & 255, (n >> 8) & 255, n & 255] as const;
  for (let i = 0; i < data.length; i += 4) {
    for (let c = 0; c < 3; c++) {
      const v = data[i + c] ?? 0;
      data[i + c] = v + ((rgb[c] ?? v) - v) * amount;
    }
    data[i + 3] = 255;
  }
}

/** Size of the blurred image for a source, keeping its shape. */
export function backdropSize(sourceWidth: number, sourceHeight: number, width = BACKDROP.width) {
  const w = Math.max(1, Math.min(width, sourceWidth));
  const h = Math.max(1, Math.round((w * sourceHeight) / Math.max(1, sourceWidth)));
  return { width: w, height: h };
}

/**
 * Snapshots `source` (the game canvas, right after a render, so its drawing
 * buffer is still there) into a small blurred, tinted canvas. Null when the
 * browser can't read it (a lost context, a 2D context it won't give).
 */
export function blurredBackdrop(source: HTMLCanvasElement): HTMLCanvasElement | null {
  if (source.width === 0 || source.height === 0) return null;
  try {
    // Halve step by step: one big jump would skip most pixels and shimmer.
    let from: HTMLCanvasElement = source;
    const size = backdropSize(source.width, source.height);
    while (from.width / 2 >= size.width * 1.5) {
      const half = document.createElement('canvas');
      half.width = Math.max(size.width, Math.round(from.width / 2));
      half.height = Math.max(size.height, Math.round(from.height / 2));
      const ctx = half.getContext('2d');
      if (!ctx) return null;
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(from, 0, 0, half.width, half.height);
      from = half;
    }
    const out = document.createElement('canvas');
    out.width = size.width;
    out.height = size.height;
    const ctx = out.getContext('2d', { willReadFrequently: true });
    if (!ctx) return null;
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(from, 0, 0, out.width, out.height);
    const image = ctx.getImageData(0, 0, out.width, out.height);
    boxBlur(image.data, out.width, out.height, BACKDROP.radius, BACKDROP.passes);
    tint(image.data, BACKDROP.tint, BACKDROP.tintAmount);
    ctx.putImageData(image, 0, 0);
    return out;
  } catch {
    return null;
  }
}
