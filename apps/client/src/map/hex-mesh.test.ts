import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import { describe, expect, it } from 'vitest';
import { loftRoundedHex, roundedHexOutline } from './hex-mesh.js';

describe('roundedHexOutline', () => {
  it('has six rounded corners, inside the hexagon, touching each edge', () => {
    const points = roundedHexOutline(1, 0.2, 3);
    expect(points).toHaveLength(6 * 4);
    const inradius = Math.sqrt(3) / 2;
    // How far out a point sits along the six edge normals (pointy-top: 0°, 60°, …).
    const reach = (p: { x: number; z: number }) =>
      Math.max(
        ...[0, 1, 2, 3, 4, 5].map((i) => {
          const a = (i * Math.PI) / 3;
          return p.x * Math.cos(a) + p.z * Math.sin(a);
        }),
      );
    for (const p of points) expect(reach(p)).toBeLessThanOrEqual(inradius + 1e-9);
    // Each arc starts and ends on an edge.
    for (let corner = 0; corner < 6; corner++) {
      expect(reach(points[corner * 4]!)).toBeCloseTo(inradius, 9);
      expect(reach(points[corner * 4 + 3]!)).toBeCloseTo(inradius, 9);
    }
  });

  it('goes anticlockwise seen from above (+x east, +z north)', () => {
    const points = roundedHexOutline(1, 0.2, 3);
    let area = 0;
    points.forEach((p, i) => {
      const q = points[(i + 1) % points.length]!;
      area += p.x * q.z - q.x * p.z;
    });
    expect(area).toBeGreaterThan(0);
  });

  it('rounds into a circle at corner = radius × sin 60°', () => {
    const r = Math.sqrt(3) / 2;
    for (const p of roundedHexOutline(1, r, 4)) {
      expect(Math.sqrt(p.x * p.x + p.z * p.z)).toBeCloseTo(r, 9);
    }
  });
});

describe('loftRoundedHex', () => {
  const rings = [
    { scale: 0.8, y: 0.3, alpha: 0.5 },
    { scale: 1, y: 0.25, alpha: 0 },
    { scale: 1, y: 0 },
  ];

  it('builds a closed top whose normals face up and out', () => {
    const arrays = loftRoundedHex(1, rings, { corner: 0.2, segments: 3, centre: { y: 0.32 } });
    const n = 24;
    expect(arrays.positions).toHaveLength((1 + rings.length * n) * 3);
    expect(arrays.indices).toHaveLength((n + (rings.length - 1) * n * 2) * 3);
    expect(Math.max(...arrays.indices)).toBe(arrays.positions.length / 3 - 1);
    expect(arrays.colors).toBeNull();

    const normals: number[] = [];
    VertexData.ComputeNormals(arrays.positions, arrays.indices, normals);
    expect(normals[1]).toBeGreaterThan(0.99); // the centre points straight up
    // The bottom ring's normals point outwards, away from the centre.
    for (let v = 1 + 2 * n; v < 1 + 3 * n; v++) {
      const outward =
        arrays.positions[v * 3]! * normals[v * 3]! +
        arrays.positions[v * 3 + 2]! * normals[v * 3 + 2]!;
      expect(outward).toBeGreaterThan(0);
    }
  });

  it('colours every vertex, with each ring’s alpha', () => {
    const arrays = loftRoundedHex(1, rings.slice(0, 2), {
      corner: 0.2,
      segments: 3,
      centre: { y: 0.32, alpha: 0.9 },
      rgb: [1, 0.5, 0.25],
    });
    const colors = arrays.colors!;
    expect(colors).toHaveLength((arrays.positions.length / 3) * 4);
    expect(colors.slice(0, 4)).toEqual([1, 0.5, 0.25, 0.9]);
    expect(colors[4 + 3]).toBe(0.5);
    expect(colors[colors.length - 1]).toBe(0);
  });

  it('leaves an open ring without a centre', () => {
    const arrays = loftRoundedHex(1, rings.slice(0, 2), { corner: 0.2, segments: 3 });
    expect(arrays.positions).toHaveLength(2 * 24 * 3);
    expect(arrays.indices).toHaveLength(24 * 2 * 3);
  });
});
