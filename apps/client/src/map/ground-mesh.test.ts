import { HEX_DIRECTIONS, hexToWorld } from '@heartpatch/shared';
import { describe, expect, it } from 'vitest';
import { Ground, type GroundTile } from './ground-mesh.js';

const SIZE = 0.65;
const OPTIONS = { size: SIZE, plateau: 0.55, noise: 0, skirtTo: 0, rim: 0.2 };

/** A small patch: a ring of meadow round a mountain, with a lake to the east. */
function patch(): GroundTile[] {
  const tiles: GroundTile[] = [{ q: 0, r: 0, height: 0.4, color: [0.5, 0.4, 0.6] }];
  for (const d of HEX_DIRECTIONS)
    tiles.push({ q: d.q, r: d.r, height: 0.2, color: [0.3, 0.8, 0.2] });
  tiles.push({ q: 2, r: 0, height: 0.04, color: [0.9, 0.8, 0.5] });
  return tiles;
}

describe('Ground', () => {
  const ground = new Ground(patch(), OPTIONS);

  it('keeps each tile flat at its own height in the middle', () => {
    for (const t of patch()) {
      const c = hexToWorld(t, SIZE);
      expect(ground.heightAt(c)).toBeCloseTo(t.height, 6);
      expect(ground.heightAt({ x: c.x + 0.1, z: c.z })).toBeCloseTo(t.height, 6);
    }
  });

  it('meets each neighbour halfway at the shared edge (no step, no gap)', () => {
    const a = hexToWorld({ q: 0, r: 0 }, SIZE);
    const b = hexToWorld({ q: 1, r: 0 }, SIZE);
    const mid = { x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 };
    expect(ground.heightAt(mid)).toBeCloseTo((0.4 + 0.2) / 2, 6);
    // Just either side of the edge: the same height, whichever tile answers.
    const left = ground.heightAt({ x: mid.x - 1e-4, z: mid.z });
    const right = ground.heightAt({ x: mid.x + 1e-4, z: mid.z });
    expect(left).not.toBeNull();
    expect(Math.abs((left ?? 0) - (right ?? 0))).toBeLessThan(1e-3);
  });

  it('slopes gently between plateaus (a hill, not a cliff)', () => {
    const a = hexToWorld({ q: 0, r: 0 }, SIZE);
    const b = hexToWorld({ q: 1, r: 0 }, SIZE);
    let last = ground.heightAt(a) ?? 0;
    for (let i = 1; i <= 20; i++) {
      const p = { x: a.x + ((b.x - a.x) * i) / 20, z: a.z + ((b.z - a.z) * i) / 20 };
      const y = ground.heightAt(p) ?? 0;
      expect(y).toBeLessThanOrEqual(last + 1e-9);
      expect(last - y).toBeLessThan(0.06);
      last = y;
    }
  });

  it('is off the map past its edge', () => {
    expect(ground.heightAt({ x: 40, z: 40 })).toBeNull();
    expect(ground.tileHeight({ q: 9, r: 9 })).toBeNull();
  });

  it('shares every point between the tiles that meet there (one vertex, smooth normals)', () => {
    const mesh = ground.mesh();
    const vertices = mesh.positions.length / 3;
    // The middle of the edge between the mountain and its east neighbour, and
    // the corner where the mountain and two meadows meet: one vertex each.
    const a = hexToWorld({ q: 0, r: 0 }, SIZE);
    const b = hexToWorld({ q: 1, r: 0 }, SIZE);
    const corner = { x: a.x + Math.cos(Math.PI / 6) * SIZE, z: a.z + Math.sin(Math.PI / 6) * SIZE };
    for (const p of [{ x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 }, corner]) {
      let at = 0;
      for (let i = 0; i < vertices; i++) {
        const dx = (mesh.positions[i * 3] ?? 0) - p.x;
        const dz = (mesh.positions[i * 3 + 2] ?? 0) - p.z;
        if (Math.hypot(dx, dz) < 1e-6) at++;
      }
      expect(at).toBe(1);
    }
    // Every index points at a vertex, and every triangle is whole.
    expect(mesh.indices.length % 3).toBe(0);
    for (const i of mesh.indices) expect(i).toBeLessThan(vertices);
    expect(mesh.colors).toHaveLength(vertices * 4);
  });

  it('blends colours across borders (the mountain/meadow edge is in between)', () => {
    const mesh = ground.mesh();
    const a = hexToWorld({ q: 0, r: 0 }, SIZE);
    const b = hexToWorld({ q: 1, r: 0 }, SIZE);
    const mid = { x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 };
    for (let i = 0; i < mesh.positions.length / 3; i++) {
      const x = mesh.positions[i * 3] ?? 0;
      const z = mesh.positions[i * 3 + 2] ?? 0;
      if (Math.hypot(x - mid.x, z - mid.z) > 1e-6) continue;
      expect(mesh.colors?.[i * 4 + 1]).toBeCloseTo((0.4 + 0.8) / 2, 6);
    }
  });
});

describe('Ground winding', () => {
  it('faces every ground triangle up (anticlockwise from above), so none is culled', () => {
    const mesh = new Ground(patch(), OPTIONS).mesh();
    const at = (i: number) => ({
      x: mesh.positions[i * 3] ?? 0,
      y: mesh.positions[i * 3 + 1] ?? 0,
      z: mesh.positions[i * 3 + 2] ?? 0,
    });
    let up = 0;
    for (let t = 0; t < mesh.indices.length; t += 3) {
      const [a, b, c] = [
        at(mesh.indices[t] ?? 0),
        at(mesh.indices[t + 1] ?? 0),
        at(mesh.indices[t + 2] ?? 0),
      ];
      const area = (b.x - a.x) * (c.z - a.z) - (c.x - a.x) * (b.z - a.z);
      // Skirt walls stand upright (no area seen from above); every other triangle faces up.
      if (Math.abs(area) < 1e-9) continue;
      expect(area).toBeGreaterThan(0);
      up++;
    }
    expect(up).toBe(8 * 24);
  });
});
