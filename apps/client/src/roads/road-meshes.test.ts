import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import { describe, expect, it } from 'vitest';
import {
  armArrays,
  ARM_LENGTH,
  clampLevel,
  hubArrays,
  linearRgb,
  ringArrays,
  ROAD_LOOK,
} from './road-meshes.js';

const normalsOf = (arrays: { positions: number[]; indices: number[] }): number[] => {
  const normals: number[] = [];
  VertexData.ComputeNormals(arrays.positions, arrays.indices, normals);
  return normals;
};

const HUB_SIDES_N = 14;

describe('road meshes (#621 W1-6)', () => {
  it('has a look for each of the three levels, wider and thicker as it goes up', () => {
    expect(ROAD_LOOK).toHaveLength(3);
    for (let i = 1; i < 3; i++) {
      expect(ROAD_LOOK[i]?.width).toBeGreaterThan(ROAD_LOOK[i - 1]?.width ?? 0);
      expect(ROAD_LOOK[i]?.height).toBeGreaterThan(ROAD_LOOK[i - 1]?.height ?? 0);
    }
  });

  it('tells the three levels apart: dirt trail, gravel with a dark edge, stone with a light kerb', () => {
    const [path, road, paved] = ROAD_LOOK;
    expect(path.edge).toBeNull();
    expect(road.edge).not.toBeNull();
    expect(paved.edge).not.toBeNull();
    // Each is at least 1.5x as wide as the one below, and the colours differ.
    expect(road.width).toBeGreaterThanOrEqual(path.width * 1.5);
    expect(paved.width).toBeGreaterThanOrEqual(road.width * 1.5);
    expect(new Set([path.top, road.top, paved.top]).size).toBe(3);
    // Gravel's edge is darker than its surface; the stone's kerb is lighter than its surface.
    const lum = (hex: string) => linearRgb(hex).reduce((a, b) => a + b, 0);
    expect(lum(road.edge ?? '#fff')).toBeLessThan(lum(road.top));
    expect(lum(paved.edge ?? '#000')).toBeGreaterThan(lum(paved.top));
  });

  it('clamps a level into 1–3', () => {
    expect([0, 1, 2, 3, 9].map(clampLevel)).toEqual([1, 1, 2, 3, 3]);
  });

  it('turns an sRGB hex into linear RGB', () => {
    expect(linearRgb('#ffffff')).toEqual([1, 1, 1]);
    expect(linearRgb('#000000')).toEqual([0, 0, 0]);
  });

  it('draws an arm from the hub to the middle of a side, lying on the ground', () => {
    for (const level of [1, 2, 3]) {
      const arm = armArrays(level);
      const xs = arm.positions.filter((_, i) => i % 3 === 0);
      const ys = arm.positions.filter((_, i) => i % 3 === 1);
      expect(Math.min(...xs)).toBe(0);
      expect(Math.max(...xs)).toBeCloseTo(ARM_LENGTH);
      expect(Math.min(...ys)).toBe(0);
      expect(arm.colors?.length).toBe((arm.positions.length / 3) * 4);
    }
  });

  it('winds every arm face outwards: the top faces up, the sides face away from the middle', () => {
    const arm = armArrays(2);
    const n = normalsOf(arm);
    for (let v = 0; v < 4; v++) expect(n[v * 3 + 1]).toBeCloseTo(1);
    for (let v = 4; v < 8; v++) expect(n[v * 3 + 2]).toBeCloseTo(-1);
    for (let v = 8; v < 12; v++) expect(n[v * 3 + 2]).toBeCloseTo(1);
  });

  it('winds the hub so its top faces up and its rim faces out', () => {
    const hub = hubArrays(3);
    const n = normalsOf(hub);
    const p = hub.positions;
    // Each of its segments: 3 vertices of the top fan, then 4 of the rim.
    for (let seg = 0; seg < HUB_SIDES_N; seg++) {
      for (let k = 0; k < 3; k++) expect(n[(seg * 7 + k) * 3 + 1]).toBeCloseTo(1);
      for (let k = 3; k < 7; k++) {
        const v = seg * 7 + k;
        const out = (n[v * 3] ?? 0) * (p[v * 3] ?? 0) + (n[v * 3 + 2] ?? 0) * (p[v * 3 + 2] ?? 0);
        expect(out).toBeGreaterThan(0);
      }
    }
  });

  it('winds a Clockwork loop so its top faces up, its outer wall out and its inner wall in (#874)', () => {
    const radius = 0.4;
    const ring = ringArrays(1, radius); // a Path: no edge strip, so 3 quads a segment
    const n = normalsOf(ring);
    const p = ring.positions;
    const segments = p.length / 3 / 12;
    expect(Number.isInteger(segments)).toBe(true);
    for (let seg = 0; seg < segments; seg++) {
      const v = (k: number) => seg * 12 + k;
      for (let k = 0; k < 4; k++) expect(n[v(k) * 3 + 1]).toBeCloseTo(1);
      const out = (k: number) =>
        (n[v(k) * 3] ?? 0) * (p[v(k) * 3] ?? 0) + (n[v(k) * 3 + 2] ?? 0) * (p[v(k) * 3 + 2] ?? 0);
      for (let k = 4; k < 8; k++) expect(out(k)).toBeGreaterThan(0);
      for (let k = 8; k < 12; k++) expect(out(k)).toBeLessThan(0);
    }
    // It runs round the building at `radius`, as wide as the arm.
    const radii = Array.from({ length: p.length / 3 }, (_, i) =>
      Math.hypot(p[i * 3] ?? 0, p[i * 3 + 2] ?? 0),
    );
    expect(Math.min(...radii)).toBeCloseTo(radius - ROAD_LOOK[0].width / 2);
    expect(Math.max(...radii)).toBeCloseTo(radius + ROAD_LOOK[0].width / 2);
  });
});
