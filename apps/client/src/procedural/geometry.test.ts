import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import { BODIES, PartShapeSchema, type Body } from '@heartpatch/shared';
import { describe, expect, it } from 'vitest';
import { bodyArrays, dot, surfaceNormal, surfacePoint, type MeshArrays } from './body-shape.js';
import { LOD } from './config.js';
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
      expect(max[1]).toBeGreaterThanOrEqual(body.height * 0.99);
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
