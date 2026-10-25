import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import { describe, expect, it } from 'vitest';
import {
  armArrays,
  ARM_LENGTH,
  clampLevel,
  hubArrays,
  linearRgb,
  ROAD_LOOK,
} from './road-meshes.js';

const normalsOf = (arrays: { positions: number[]; indices: number[] }): number[] => {
  const normals: number[] = [];
  VertexData.ComputeNormals(arrays.positions, arrays.indices, normals);
  return normals;
};

describe('road meshes (#621 W1-6)', () => {
  it('has a look for each of the three levels, wider and thicker as it goes up', () => {
    expect(ROAD_LOOK).toHaveLength(3);
    for (let i = 1; i < 3; i++) {
      expect(ROAD_LOOK[i]?.width).toBeGreaterThan(ROAD_LOOK[i - 1]?.width ?? 0);
      expect(ROAD_LOOK[i]?.height).toBeGreaterThan(ROAD_LOOK[i - 1]?.height ?? 0);
    }
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
    const verts = p.length / 3;
    // Each of its segments: 3 vertices of the top fan, then 4 of the rim.
    for (let seg = 0; seg < verts / 7; seg++) {
      for (let k = 0; k < 3; k++) expect(n[(seg * 7 + k) * 3 + 1]).toBeCloseTo(1);
      for (let k = 3; k < 7; k++) {
        const v = seg * 7 + k;
        const out = (n[v * 3] ?? 0) * (p[v * 3] ?? 0) + (n[v * 3 + 2] ?? 0) * (p[v * 3 + 2] ?? 0);
        expect(out).toBeGreaterThan(0);
      }
    }
  });
});
