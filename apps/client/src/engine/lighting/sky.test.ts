import { describe, expect, it } from 'vitest';
import { buildSkyFaces, skyRadiance, SKY_COLORS } from './sky.js';

const sunUp = { x: 0, y: 1, z: 0 };
const sunSide = { x: 1, y: 0.2, z: 0 };

function avg(face: Uint8Array): [number, number, number] {
  let r = 0;
  let g = 0;
  let b = 0;
  for (let i = 0; i < face.length; i += 4) {
    r += face[i]!;
    g += face[i + 1]!;
    b += face[i + 2]!;
  }
  const n = face.length / 4;
  return [r / n, g / n, b / n];
}

describe('skyRadiance', () => {
  it('is blue overhead and warm below the horizon', () => {
    const away = { x: 0, y: -1, z: 0 };
    const up = skyRadiance({ x: 0, y: 1, z: 0 }, away);
    const down = skyRadiance({ x: 0, y: -1, z: 0 }, { x: 0, y: 1, z: 0 });
    expect(up).toEqual(SKY_COLORS.zenith);
    expect(down).toEqual(SKY_COLORS.ground);
    expect(up[2]).toBeGreaterThan(up[0]);
    expect(down[0]).toBeGreaterThan(down[2]);
  });

  it('is brightest towards the sun', () => {
    const towards = skyRadiance(sunSide, sunSide);
    const away = skyRadiance({ x: -1, y: 0.2, z: 0 }, sunSide);
    expect(towards[0] + towards[1] + towards[2]).toBeGreaterThan(away[0] + away[1] + away[2]);
  });

  it('accepts unnormalised directions', () => {
    expect(skyRadiance({ x: 0, y: 5, z: 0 }, sunSide)).toEqual(
      skyRadiance({ x: 0, y: 1, z: 0 }, sunSide),
    );
  });
});

describe('buildSkyFaces', () => {
  const faces = buildSkyFaces(16, sunUp);

  it('builds six opaque RGBA8 faces', () => {
    for (const face of Object.values(faces)) {
      expect(face).toHaveLength(16 * 16 * 4);
      expect(face[3]).toBe(255);
    }
  });

  it('puts the sky on +Y and the ground on -Y', () => {
    const up = avg(faces.up);
    const down = avg(faces.down);
    expect(up[2]).toBeGreaterThan(down[2]);
    expect(down[0]).toBeGreaterThan(down[2]);
  });

  it('places the sun on the face it points at', () => {
    const east = buildSkyFaces(16, { x: 1, y: 0, z: 0 });
    const sum = (f: Uint8Array) => avg(f).reduce((a, b) => a + b, 0);
    expect(sum(east.right)).toBeGreaterThan(sum(east.left));
  });
});
