import { describe, expect, it } from 'vitest';
import { CAMERA } from '../engine/config.js';
import { bankField, bankRim, bankShape, cloudShade } from './weather-clouds.js';
import { WEATHER_LOOK } from './weather-config.js';

const BANK = WEATHER_LOOK.clouds.bank;

describe("a storm's bank", () => {
  const shape = bankShape();
  const ys: number[] = [];
  const xs: number[] = [];
  for (let i = 0; i < shape.positions.length; i += 3) {
    xs.push(shape.positions[i] ?? 0);
    ys.push(shape.positions[i + 1] ?? 0);
  }

  it('is one wide slab, many times wider than tall', () => {
    const wide = Math.max(...xs) - Math.min(...xs);
    const tall = Math.max(...ys) - Math.min(...ys);
    expect(wide).toBeGreaterThan(BANK.wide * 1.8);
    expect(wide / tall).toBeGreaterThan(4);
  });

  it('has a hard flat belly: nothing below it, a big share of the surface on it, facing down', () => {
    expect(Math.min(...ys)).toBe(0);
    const flat = ys.filter((y) => y === 0).length;
    expect(flat / ys.length).toBeGreaterThan(0.3);
    const i = ys.indexOf(0);
    expect(shape.normals[i * 3 + 1]).toBe(-1);
  });

  it('shows its puffs as bumps along the top', () => {
    // Across the middle, west to east, the top rises and falls more than once.
    let turns = 0;
    let last = 0;
    let prev = Number.NaN;
    for (let x = -BANK.wide * 0.8; x <= BANK.wide * 0.8; x += 0.05) {
      let y = BANK.thick * 3;
      while (y > 0 && bankField(x, y, 0) > 0) y -= 0.01;
      if (!Number.isNaN(prev)) {
        const dir = Math.sign(y - prev);
        if (dir !== 0 && dir !== last) {
          if (last !== 0) turns++;
          last = dir;
        }
      }
      prev = y;
    }
    expect(turns).toBeGreaterThan(4);
  });

  it('has no long or folded triangles over its top and sides (the streaks and gold seam, #686)', () => {
    const p = shape.positions;
    const n = shape.normals;
    const at = (i: number): [number, number, number] => [
      p[i * 3] ?? 0,
      p[i * 3 + 1] ?? 0,
      p[i * 3 + 2] ?? 0,
    ];
    const edges: number[] = [];
    const tops: { long: number; facing: number }[] = [];
    for (let t = 0; t < shape.indices.length; t += 3) {
      const [a, b, c] = [0, 1, 2].map((k) => shape.indices[t + k] ?? 0) as [number, number, number];
      const [A, B, C] = [at(a), at(b), at(c)];
      const ab = [B[0] - A[0], B[1] - A[1], B[2] - A[2]] as const;
      const ac = [C[0] - A[0], C[1] - A[1], C[2] - A[2]] as const;
      const long = Math.max(
        Math.hypot(...ab),
        Math.hypot(...ac),
        Math.hypot(C[0] - B[0], C[1] - B[1], C[2] - B[2]),
      );
      edges.push(long);
      // The flat belly may be coarse: it is one flat colour.
      if (A[1] === 0 && B[1] === 0 && C[1] === 0) continue;
      // Babylon's front faces wind clockwise, so the outward face is ac × ab.
      const f = [
        ac[1] * ab[2] - ac[2] * ab[1],
        ac[2] * ab[0] - ac[0] * ab[2],
        ac[0] * ab[1] - ac[1] * ab[0],
      ];
      const area = Math.hypot(f[0] ?? 0, f[1] ?? 0, f[2] ?? 0);
      if (area < 1e-9) continue;
      let facing = 0;
      for (const v of [a, b, c]) {
        facing +=
          ((f[0] ?? 0) * (n[v * 3] ?? 0) +
            (f[1] ?? 0) * (n[v * 3 + 1] ?? 0) +
            (f[2] ?? 0) * (n[v * 3 + 2] ?? 0)) /
          area /
          3;
      }
      tops.push({ long, facing });
    }
    const median = [...edges].sort((x, y) => x - y)[Math.floor(edges.length / 2)] ?? 0;
    // No triangle stretched across a dip between puffs...
    expect(Math.max(...tops.map((t) => t.long))).toBeLessThan(median * 4);
    // ...and none turned away from the light its normals give it.
    expect(Math.min(...tops.map((t) => t.facing))).toBeGreaterThan(0.2);
  });

  it('is wound and sized for one draw', () => {
    expect(shape.indices.length % 3).toBe(0);
    expect(xs.length).toBeLessThan(6000);
  });

  it('lights gold round its outline only, not on the far flank of its top (#717 follow-up)', () => {
    // cloud-plugin.ts's gold band, worked out per vertex as the map camera
    // sees it (pitch from the south, eye far off), with and without the
    // bank's own rim share.
    const { rimPower, rimStrength } = WEATHER_LOOK.clouds.shade;
    const sun = WEATHER_LOOK.clouds.sun;
    const sunLength = Math.hypot(...sun);
    const eye = [0, Math.sin(CAMERA.pitch), -Math.cos(CAMERA.pitch)] as const;
    const step = (a: number, b: number, x: number): number => {
      const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
      return t * t * (3 - 2 * t);
    };
    const gated = cloudShade(shape, 0, bankRim);
    const open = cloudShade(shape, 0);
    const gold = { inner: 0, innerOpen: 0, outline: 0, outlineOpen: 0 };
    for (let i = 0; i < shape.positions.length / 3; i++) {
      const [nx, ny, nz] = [0, 1, 2].map((k) => shape.normals[i * 3 + k] ?? 0) as [
        number,
        number,
        number,
      ];
      const nv = nx * eye[0] + ny * eye[1] + nz * eye[2];
      if (nv < 0) continue; // turned away: culled
      const key = Math.min(1, Math.max(0, (nx * sun[0] + ny * sun[1] + nz * sun[2]) / sunLength));
      const rim = (share: number): number =>
        step(
          0.3,
          0.5,
          (1 - nv) ** rimPower *
            step(0.02, 0.3, gated[i * 4] ?? 0) *
            (0.35 + 0.65 * key) *
            share *
            rimStrength,
        );
      const x = shape.positions[i * 3] ?? 0;
      const z = shape.positions[i * 3 + 2] ?? 0;
      const u = Math.max(Math.abs(x) / BANK.wide, Math.abs(z) / BANK.deep);
      const lit = rim(gated[i * 4 + 2] ?? 0) > 0.05;
      const litOpen = rim(open[i * 4 + 2] ?? 0) > 0.05;
      if (u < 0.7) {
        gold.inner += Number(lit);
        gold.innerOpen += Number(litOpen);
      } else if (u >= 1) {
        gold.outline += Number(lit);
        gold.outlineOpen += Number(litOpen);
      }
    }
    // Without the rim share the far flank of the heaped top lit gold (the arc)...
    expect(gold.innerOpen).toBeGreaterThan(5);
    // ...with it, none of the top's middle does, and the outline keeps all its gold.
    expect(gold.inner).toBe(0);
    expect(gold.outline).toBe(gold.outlineOpen);
    expect(gold.outline).toBeGreaterThan(50);
  });

  it('gives an ordinary cloud its full gold edge everywhere', () => {
    const one = cloudShade(
      { positions: [0, 0, 0, 1, 1, 1], normals: [0, 1, 0, 0, 1, 0], indices: [] },
      0,
    );
    expect([one[2], one[6]]).toEqual([1, 1]);
    expect(bankRim(0, 0)).toBe(0);
    expect(bankRim(BANK.wide, 0)).toBe(1);
  });
});
