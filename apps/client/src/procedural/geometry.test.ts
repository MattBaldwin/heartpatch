import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import { BODIES, FloaterGlyphSchema, PartShapeSchema, type Body } from '@heartpatch/shared';
import { describe, expect, it } from 'vitest';
import {
  bodyArrays,
  bodyRingsFor,
  dot,
  surfaceNormal,
  surfacePoint,
  type MeshArrays,
} from './body-shape.js';
import { FLOATER, LOD } from './config.js';
import { floaterArrays } from './floater-shapes.js';
import { orientTriangles, partArrays } from './part-shapes.js';
import type { Vec3 } from './params.js';
import { partMatrix, surfaceFrame } from './placement.js';

const at = (values: readonly number[], i: number): Vec3 => [
  values[i * 3]!,
  values[i * 3 + 1]!,
  values[i * 3 + 2]!,
];

/** Every vertex normal agrees with Babylon's own face normals (so faces aren't culled from outside). */
function expectFrontFacing(mesh: MeshArrays): void {
  const babylon: number[] = [];
  VertexData.ComputeNormals(mesh.positions, mesh.indices, babylon);
  const vertices = mesh.positions.length / 3;
  let checked = 0;
  for (let i = 0; i < vertices; i++) {
    const ours = at(mesh.normals, i);
    const theirs = at(babylon, i);
    if (Math.hypot(...theirs) < 0.5) continue; // unused (dropped pole) vertex
    expect(Math.hypot(...ours)).toBeCloseTo(1, 5);
    expect(dot(ours, theirs)).toBeGreaterThan(0.5);
    checked++;
  }
  expect(checked).toBeGreaterThan(vertices * 0.8);
}

function bounds(mesh: MeshArrays): { min: Vec3; max: Vec3 } {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < mesh.positions.length; i++) {
    const k = i % 3;
    min[k] = Math.min(min[k]!, mesh.positions[i]!);
    max[k] = Math.max(max[k]!, mesh.positions[i]!);
  }
  return { min: min as unknown as Vec3, max: max as unknown as Vec3 };
}

describe.each(BODIES.map((b) => [b.id, b] as const))('body %s', (_id, body: Body) => {
  for (const lod of ['low', 'high', 'hero'] as const) {
    it(`builds closed, front-facing ${lod} geometry sitting on the ground`, () => {
      const mesh = orientTriangles(bodyArrays(body, LOD[lod].bodyRings));
      expectFrontFacing(mesh);
      const { min, max } = bounds(mesh);
      expect(min[1]).toBeCloseTo(0, 6);
      // A heart's shoulders are a narrow peak, which a coarse mesh clips a little.
      expect(max[1]).toBeGreaterThanOrEqual(body.height * (body.cleft ? 0.98 : 0.99));
      expect(max[0] - min[0]).toBeLessThanOrEqual(body.width * 1.01 + 1e-9);
      expect(max[2] - min[2]).toBeLessThanOrEqual(body.depth * 1.01 + 1e-9);
    });
  }

  it('puts the face at −z and normals outwards', () => {
    expect(surfacePoint(body, 0, 0)[2]).toBeLessThan(0);
    expect(surfaceNormal(body, 0, 0)[2]).toBeLessThan(-0.5);
    expect(surfaceNormal(body, Math.PI / 2, 0)[0]).toBeGreaterThan(0.5);
    expect(surfaceNormal(body, 0, Math.PI / 2)).toEqual([0, 1, 0]);
  });
});

describe.each(PartShapeSchema.options)('part shape %s', (shape) => {
  for (const lod of ['low', 'high', 'hero'] as const) {
    it(`fills the unit box and faces outwards (${lod})`, () => {
      const mesh = partArrays(shape, LOD[lod]);
      expectFrontFacing(mesh);
      const { min, max } = bounds(mesh);
      for (let k = 0; k < 3; k++) {
        expect(min[k]).toBeCloseTo(-0.5, 6);
        expect(max[k]).toBeCloseTo(0.5, 6);
      }
    });
  }

  it('has fewer triangles at low detail', () => {
    expect(partArrays(shape, LOD.low).indices.length).toBeLessThan(
      partArrays(shape, LOD.high).indices.length,
    );
  });
});

describe('partMatrix', () => {
  const blob = BODIES.find((b) => b.id === 'blob')!;
  const scale: Vec3 = [1, 1, 1];
  const rows = (m: readonly number[]) => ({
    x: [m[0]!, m[1]!, m[2]!] as Vec3,
    y: [m[4]!, m[5]!, m[6]!] as Vec3,
    z: [m[8]!, m[9]!, m[10]!] as Vec3,
    t: [m[12]!, m[13]!, m[14]!] as Vec3,
  });
  const placement = {
    around: 0.4,
    up: 0.25,
    size: [0.1, 0.2, 0.05] as Vec3,
    tilt: 0,
    splay: 0,
    side: 1 as const,
  };

  it('lays surface parts flat on the body, facing out, as a proper rotation', () => {
    const m = rows(
      partMatrix(blob, scale, { surface: true, sink: 0, lift: 0, flip: false }, placement),
    );
    const f = surfaceFrame(blob, scale, placement.around, placement.up);
    const unit = (v: Vec3, len: number) => v.map((c) => c / len) as unknown as Vec3;
    const x = unit(m.x, 0.1);
    const y = unit(m.y, 0.2);
    const z = unit(m.z, 0.05);
    expect(dot(z, f.normal)).toBeCloseTo(1, 6);
    expect(dot(x, y)).toBeCloseTo(0, 6);
    expect(dot(y, z)).toBeCloseTo(0, 6);
    // Right-handed in Babylon's sense (determinant +1), so winding isn't flipped.
    const det =
      x[0] * (y[1] * z[2] - y[2] * z[1]) -
      x[1] * (y[0] * z[2] - y[2] * z[0]) +
      x[2] * (y[0] * z[1] - y[1] * z[0]);
    expect(det).toBeCloseTo(1, 6);
    // Sits half its thickness out from the surface.
    const out = m.t.map((c, i) => c - f.point[i]!) as unknown as Vec3;
    expect(dot(out, f.normal)).toBeCloseTo(0.025, 6);
  });

  it('grows sticking-out parts along the normal, leaning with tilt and splay', () => {
    const straight = rows(
      partMatrix(blob, scale, { surface: false, sink: 0, lift: 0, flip: false }, placement),
    );
    const f = surfaceFrame(blob, scale, placement.around, placement.up);
    expect(dot(straight.y, f.normal) / 0.2).toBeCloseTo(1, 6);
    const tilted = rows(
      partMatrix(
        blob,
        scale,
        { surface: false, sink: 0, lift: 0, flip: false },
        { ...placement, tilt: 0.5, splay: 0.3 },
      ),
    );
    expect(dot(tilted.y, f.towardsTop)).toBeGreaterThan(0);
    expect(dot(tilted.y, f.side)).toBeGreaterThan(0); // right side splays to +side
  });

  it('flips with a half turn, not a mirror', () => {
    const part = { surface: true, sink: 0, lift: 0, flip: false };
    const a = rows(partMatrix(blob, scale, part, placement));
    const b = rows(partMatrix(blob, scale, { ...part, flip: true }, placement));
    expect(b.z).toEqual(a.z);
    expect(b.y.map((c) => -c)).toEqual(a.y);
    expect(b.x.map((c) => -c)).toEqual(a.x);
  });
});

describe('optional body features stay off by default', () => {
  /** The bodies that existed before `cleft`; new bodies don't move this. */
  const BEFORE_CLEFT = [
    'blob',
    'pebble',
    'bean',
    'pear',
    'drop',
    'bun',
    'pumpkin',
    'tall',
    'mochi',
    'tiered',
    'star',
    'comet-star',
    'ghost',
    'barrel',
    'orb',
  ];

  it('draws the bodies that came before the cleft exactly as they were', () => {
    // A hash of each one's mesh at three levels of detail, taken with the
    // original body shaper: a body that doesn't ask for `cleft` must not move.
    // FNV-1a over the text of every body's arrays.
    let hash = 0x811c9dc5;
    const add = (text: string) => {
      for (let i = 0; i < text.length; i++) {
        hash = Math.imul(hash ^ text.charCodeAt(i), 0x01000193) >>> 0;
      }
    };
    for (const id of BEFORE_CLEFT) {
      const body = BODIES.find((b) => b.id === id)!;
      for (const rings of [8, 16, 24]) {
        const mesh = bodyArrays(body, rings);
        add(body.id + JSON.stringify([mesh.positions, mesh.normals, mesh.indices]));
      }
    }
    expect(hash.toString(16)).toBe('c6964a27');
  });
});

describe('a heart body (cleft)', () => {
  const heart: Body = {
    id: 'test-heart',
    width: 1.6,
    height: 1.4,
    depth: 0.6,
    squareness: 0.3,
    taper: 0,
    peak: 0,
    bottomFlat: 0,
    cleft: { depth: 0.2, tip: 0.8 },
    jitter: 0,
  };
  const round: Body = { ...heart, cleft: undefined };
  const near = Math.PI / 2 - 1e-3;

  it('dips at the top middle with a shoulder either side', () => {
    const shoulder = (b: Body) => surfacePoint(b, 1.2, Math.PI / 2 - 0.5)[1];
    expect(shoulder(heart)).toBeGreaterThan(surfacePoint(heart, 0, near)[1] + 0.1);
    // Without the cleft the top middle is the highest point.
    expect(surfacePoint(round, 0, near)[1]).toBeGreaterThan(shoulder(round));
  });

  it('narrows to a point at the bottom', () => {
    const lowWidth = (b: Body) => Math.abs(surfacePoint(b, Math.PI / 2, -Math.PI / 4)[0]);
    expect(lowWidth(heart)).toBeLessThan(lowWidth(round) * 0.6);
  });

  it('is one smooth, front-facing mesh standing on the ground at every detail level', () => {
    for (const lod of ['low', 'high', 'hero'] as const) {
      const mesh = orientTriangles(bodyArrays(heart, LOD[lod].bodyRings));
      expectFrontFacing(mesh);
      expect(bounds(mesh).min[1]).toBeCloseTo(0, 6);
    }
  });
});

describe.each(FloaterGlyphSchema.options)('floater glyph %s', (glyph) => {
  for (const lod of ['low', 'high', 'hero'] as const) {
    it(`is one unit tall, centred, flat and facing −z (${lod})`, () => {
      const mesh = floaterArrays(glyph, LOD[lod]);
      expectFrontFacing(mesh);
      const { min, max } = bounds(mesh);
      expect(max[1] - min[1]).toBeCloseTo(1, 6);
      expect(max[1] + min[1]).toBeCloseTo(0, 6);
      expect(max[0] + min[0]).toBeCloseTo(0, 6);
      expect(max[0] - min[0]).toBeLessThan(1);
      // The glyph lies just in front of its outline (towards the camera),
      // still thin: a sign, not a solid.
      expect(min[2]).toBeLessThanOrEqual(-FLOATER.layerGap + 1e-9);
      expect(min[2]).toBeGreaterThan(-FLOATER.layerGap * 3);
      expect(max[2]).toBeCloseTo(0, 6);
      // The outline shades flat; the glyph's normals lean out for a soft
      // dome, but always towards the camera.
      let leaning = 0;
      for (let v = 0; v < mesh.positions.length / 3; v++) {
        const n = mesh.normals.slice(v * 3, v * 3 + 3);
        if (mesh.positions[v * 3 + 2] === 0) expect(n.map((c) => c + 0)).toEqual([0, 0, -1]);
        else {
          expect(n[2]).toBeLessThan(-0.8);
          if (Math.hypot(n[0]!, n[1]!) > 0.3) leaning++;
        }
      }
      expect(leaning).toBeGreaterThan(0);
    });
  }

  it('darkens only its outline, through vertex colours', () => {
    const mesh = floaterArrays(glyph, LOD.low);
    expect(mesh.colors).toHaveLength((mesh.positions.length / 3) * 4);
    for (let v = 0; v < mesh.positions.length / 3; v++) {
      const rgb = mesh.colors.slice(v * 4, v * 4 + 3);
      const front = mesh.positions[v * 3 + 2]! < 0;
      expect(rgb).toEqual(front ? [1, 1, 1] : [...FLOATER.outlineShade]);
    }
  });
});

/**
 * Most a heart's vertex normal may turn from its neighbour's, degrees: the
 * sharpest spot is across the cleft. Below what the shallower cleft at the
 * old ring count turned (48°, 35°, 28°), so the deeper cleft is still smoother.
 */
const MAX_TURN = { low: 47.5, high: 34.5, hero: 27.5 } as const;

describe('the heart body in the registry', () => {
  const heart = BODIES.find((b) => b.id === 'heart')!;

  it('gets more rings than other bodies, and every other body keeps its own', () => {
    for (const body of BODIES) {
      for (const lod of ['low', 'high', 'hero'] as const) {
        const rings = LOD[lod].bodyRings;
        if (body.cleft) expect(bodyRingsFor(body, rings), body.id).toBeGreaterThan(rings);
        else expect(bodyRingsFor(body, rings), body.id).toBe(rings);
      }
    }
  });

  for (const lod of ['low', 'high', 'hero'] as const) {
    it(`stands on the ground with smooth normals at ${lod} detail`, () => {
      const rings = bodyRingsFor(heart, LOD[lod].bodyRings);
      const mesh = orientTriangles(bodyArrays(heart, rings));
      expectFrontFacing(mesh);
      const { min, max } = bounds(mesh);
      expect(min[1]).toBeCloseTo(0, 6);
      expect(max[1]).toBeGreaterThanOrEqual(heart.height * 0.98);
      // Neighbouring vertices' normals turn gently, around and up the grid
      // (no crease at the cleft or the shoulders).
      const row = rings * 2 + 1;
      let worst = 0;
      for (let r = 1; r < rings - 1; r++) {
        for (let s = 0; s < row - 1; s++) {
          const n = at(mesh.normals, r * row + s);
          for (const m of [
            at(mesh.normals, r * row + s + 1),
            at(mesh.normals, (r + 1) * row + s),
          ]) {
            worst = Math.max(worst, Math.acos(Math.min(1, dot(n, m))));
          }
        }
      }
      expect((worst * 180) / Math.PI).toBeLessThan(MAX_TURN[lod]);
    });
  }
});
