import { Matrix, Vector3 } from '@babylonjs/core/Maths/math.vector';
import { edgeNeighbor, hex, hexToWorld, HEX_EDGES } from '@heartpatch/shared';
import { describe, expect, it } from 'vitest';
import { edgeTransform, fenceLength, fencePlacements, FENCE_INSET } from './fence-layout.js';
import { testView } from './test-view.js';

const SIZE = 0.65;

/** Where local (±length/2, 0, 0) lands once the segment is placed. */
function ends(tile: { q: number; r: number }, edge: number) {
  const { x, z, yaw } = edgeTransform(tile, edge, SIZE);
  const m = Matrix.RotationY(yaw).multiply(Matrix.Translation(x, 0, z));
  const half = fenceLength(SIZE) / 2;
  return [-half, half].map((lx) => Vector3.TransformCoordinates(new Vector3(lx, 0, 0), m));
}

describe('fence layout (#203)', () => {
  it('lays each segment along its edge, between the pulled-in corners', () => {
    const tile = hex(2, -1);
    const c = hexToWorld(tile, SIZE);
    for (const edge of HEX_EDGES) {
      // The two corners of this edge, pulled in toward the middle.
      const corners = [-30, 30].map((d) => {
        const a = ((60 * edge + d) * Math.PI) / 180;
        return {
          x: c.x + Math.cos(a) * SIZE * FENCE_INSET,
          z: c.z + Math.sin(a) * SIZE * FENCE_INSET,
        };
      });
      const [a, b] = ends(tile, edge);
      const hits = corners.map((k) =>
        [a!, b!].some((p) => Math.hypot(p.x - k.x, p.z - k.z) < 1e-5),
      );
      expect(hits, `edge ${String(edge)}`).toEqual([true, true]);
    }
  });

  it('faces the neighbour across the edge, and two tiles each keep to their side', () => {
    const tile = hex(0, 0);
    for (const edge of HEX_EDGES) {
      const here = edgeTransform(tile, edge, SIZE);
      const n = edgeNeighbor(tile, edge);
      const there = edgeTransform(n, (edge + 3) % 6, SIZE);
      const c = hexToWorld(tile, SIZE);
      const m = hexToWorld(n, SIZE);
      // Each segment is nearer its own tile's middle than the other's.
      expect(Math.hypot(here.x - c.x, here.z - c.z)).toBeLessThan(
        Math.hypot(here.x - m.x, here.z - m.z),
      );
      expect(Math.hypot(there.x - m.x, there.z - m.z)).toBeLessThan(
        Math.hypot(there.x - c.x, there.z - c.z),
      );
    }
  });

  it('places every segment in the view, and none on tiles without', () => {
    const view = testView(1);
    const [a, b] = view.tiles;
    const fence = (edge: number) => ({
      id: `0190a8c4-0000-7000-8000-00000000020${String(edge)}`,
      edge,
      buildingId: 'hedge',
      level: 1,
      hp: 70,
      maxHp: 70,
    });
    const tiles = view.tiles.map((t) =>
      t === a ? { ...t, fences: [fence(0), fence(3)] } : t === b ? { ...t, fences: [] } : t,
    );
    const placed = fencePlacements({ tiles }, SIZE);
    expect(placed.map((p) => p.fence.edge)).toEqual([0, 3]);
    expect(placed.every((p) => p.tile.q === a!.q && p.tile.r === a!.r)).toBe(true);
  });
});
