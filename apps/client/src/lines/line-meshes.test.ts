import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import { describe, expect, it } from 'vitest';
import {
  LINE_LOOK,
  postArrays,
  RAIL_TINT,
  railArmArrays,
  SIDE,
  spanArrays,
  wireHeight,
  WIRE_TINT,
} from './line-meshes.js';

const normalsOf = (arrays: { positions: number[]; indices: number[] }): number[] => {
  const normals: number[] = [];
  VertexData.ComputeNormals(arrays.positions, arrays.indices, normals);
  return normals;
};

/** Every quad's normal points away from its own box's middle (each box is 5 quads, 20 vertices). */
function windsOutwards(arrays: { positions: number[]; indices: number[] }): void {
  const n = normalsOf(arrays);
  const p = arrays.positions;
  const boxes = p.length / 3 / 20;
  expect(Number.isInteger(boxes)).toBe(true);
  for (let box = 0; box < boxes; box++) {
    const verts = Array.from({ length: 20 }, (_, i) => box * 20 + i);
    const mid = [0, 1, 2].map((a) => verts.reduce((s, v) => s + (p[v * 3 + a] ?? 0), 0) / 20);
    for (let quad = 0; quad < 5; quad++) {
      const face = verts.slice(quad * 4, quad * 4 + 4);
      const centre = [0, 1, 2].map(
        (a) => face.reduce((s, v) => s + (p[v * 3 + a] ?? 0), 0) / 4 - (mid[a] ?? 0),
      );
      const v = face[0] ?? 0;
      const out =
        (n[v * 3] ?? 0) * (centre[0] ?? 0) +
        (n[v * 3 + 1] ?? 0) * (centre[1] ?? 0) +
        (n[v * 3 + 2] ?? 0) * (centre[2] ?? 0);
      expect(out).toBeGreaterThan(0);
    }
  }
}

describe('wire and rail meshes (#874 C4)', () => {
  it('stands a post on the ground with a brass cap on top', () => {
    const post = postArrays();
    const ys = post.positions.filter((_, i) => i % 3 === 1);
    expect(Math.min(...ys)).toBe(0);
    expect(Math.max(...ys)).toBeCloseTo(LINE_LOOK.post.height + LINE_LOOK.post.capHeight);
    expect(post.colors.length).toBe((post.positions.length / 3) * 4);
    windsOutwards(post);
  });

  it('lays a rail arm from the middle to just past the side, sleepers under two rails', () => {
    const arm = railArmArrays();
    const xs = arm.positions.filter((_, i) => i % 3 === 0);
    const ys = arm.positions.filter((_, i) => i % 3 === 1);
    expect(Math.min(...xs)).toBeLessThan(0.05);
    expect(Math.max(...xs)).toBeGreaterThanOrEqual(SIDE);
    expect(Math.max(...xs)).toBeLessThan(SIDE + 0.03);
    expect(Math.min(...ys)).toBe(0);
    // Sleepers and two rails: one box each.
    expect(arm.positions.length / 3 / 20).toBe(LINE_LOOK.rail.sleeper.count + 2);
    windsOutwards(arm);
  });

  it('sags a wire from the post top down to its lowest at the side', () => {
    expect(wireHeight(0)).toBeGreaterThan(wireHeight(0.5));
    expect(wireHeight(0.5)).toBeGreaterThan(wireHeight(1));
    expect(wireHeight(0) - wireHeight(1)).toBeCloseTo(LINE_LOOK.wire.sag);
    // Just under the post's cap, so it reads as hanging from it.
    expect(wireHeight(0)).toBeLessThan(LINE_LOOK.post.height + LINE_LOOK.post.capHeight);
    const span = spanArrays();
    const xs = span.positions.filter((_, i) => i % 3 === 0);
    expect(Math.min(...xs)).toBe(0);
    expect(Math.max(...xs)).toBeGreaterThan(SIDE);
    // White, so the per-instance tint is its colour.
    expect(new Set(span.colors)).toEqual(new Set([1]));
  });

  it('tells a lit wire from a dark one, and iron from brass, at a glance', () => {
    const lum = (rgb: readonly number[]) => rgb.reduce((a, b) => a + b, 0);
    expect(lum(WIRE_TINT.lit)).toBeGreaterThan(lum(WIRE_TINT.dark) * 3);
    expect(RAIL_TINT[0]).toEqual([1, 1, 1]);
    // Brass is warmer: more red than blue.
    expect(RAIL_TINT[1][0]).toBeGreaterThan(RAIL_TINT[1][2] * 2);
  });
});
