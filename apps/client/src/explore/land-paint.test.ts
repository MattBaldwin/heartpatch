import { describe, expect, it } from 'vitest';
import { LAND_LOOKS } from './land-config.js';
import { paintGround, texelToWorld, worldToUv } from './land-paint.js';
import { landField } from './land-shape.js';

const look = LAND_LOOKS['meadow']!;
const land = landField(look.shape, 11, 7, { x: 0, z: -2.94 });
const N = 128;
const R = 46;
const paint = (shades: Parameters<typeof paintGround>[0]['shades']) =>
  paintGround({ palette: look.palette, land, shades, seed: 11, texels: N, radius: R, warp: 3 });
/** The texel's red, green and blue at a world point. */
function at(pixels: Uint8Array, x: number, z: number): [number, number, number] {
  const i = Math.round(worldToUv(x, R, 3) * N - 0.5);
  const j = Math.round(worldToUv(z, R, 3) * N - 0.5);
  const k = (j * N + i) * 4;
  return [pixels[k] ?? 0, pixels[k + 1] ?? 0, pixels[k + 2] ?? 0];
}

describe('paintGround', () => {
  const plain = paint([]);

  it('fills every texel, opaque', () => {
    expect(plain.length).toBe(N * N * 4);
    for (let k = 3; k < plain.length; k += 4) expect(plain[k]).toBe(255);
  });

  it('maps texels and world points both ways', () => {
    for (const i of [0, 17, 64, 127]) {
      expect(worldToUv(texelToWorld(i, N, R, 3), R, 3) * N - 0.5).toBeCloseTo(i, 6);
    }
  });

  it('paints grass green and the path a warm tan', () => {
    const [r, g, b] = at(plain, 3, 0);
    expect(g).toBeGreaterThan(r);
    expect(g).toBeGreaterThan(b);
    const [pr, pg, pb] = at(plain, land.pathX(0), 0);
    expect(pr).toBeGreaterThan(pb + 40);
    expect(pr).toBeGreaterThanOrEqual(pg);
  });

  it('darkens the ground under a shade, and nowhere else', () => {
    const shaded = paint([{ x: 3, z: 0, r: 1, strength: 0.8 }]);
    const sum = (c: [number, number, number]) => c[0] + c[1] + c[2];
    expect(sum(at(shaded, 3, 0))).toBeLessThan(sum(at(plain, 3, 0)) - 30);
    expect(at(shaded, -10, 10)).toEqual(at(plain, -10, 10));
  });
});
