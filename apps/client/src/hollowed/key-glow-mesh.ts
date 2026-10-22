import { loftRoundedHex, type MeshArrays } from '../map/hex-mesh.js';
import { KEY_GLOW } from './hollowed-config.js';

// The cellar key tile's glow as plain vertex arrays (#306): its fill, its
// rim, its column of light and the sparkles in it, all one mesh, so the map
// draws it in one call. No Babylon here, so its shape is unit-tested.

/** The hex outline the glow follows: the map tile's (`TILE_RADIUS`, `CORNER`, `SEGMENTS`). */
export interface GlowHex {
  readonly radius: number;
  readonly corner: number;
  readonly segments: number;
}

/** Joins vertex arrays into one (each part's indices shifted past the ones before). */
function join(parts: readonly MeshArrays[]): MeshArrays {
  const out: MeshArrays = { positions: [], indices: [], colors: [] };
  for (const part of parts) {
    const base = out.positions.length / 3;
    out.positions.push(...part.positions);
    out.indices.push(...part.indices.map((i) => i + base));
    out.colors?.push(...(part.colors ?? []));
  }
  return out;
}

/** A four-point sparkle: two crossed upright diamonds, both sides drawn, bright in the middle. */
function sparkle(x: number, y: number, z: number, size: number): MeshArrays {
  const [r, g, b] = KEY_GLOW.rgb;
  const positions: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];
  for (const [dx, dz] of [
    [1, 0],
    [0, 1],
  ] as const) {
    const at = positions.length / 3;
    // Middle, then up, right, down, left in the diamond's plane.
    positions.push(x, y, z);
    positions.push(x, y + size, z);
    positions.push(x + dx * size * 0.45, y, z + dz * size * 0.45);
    positions.push(x, y - size, z);
    positions.push(x - dx * size * 0.45, y, z - dz * size * 0.45);
    colors.push(1, 1, 0.9, 1, r, g, b, 0.9, r, g, b, 0.9, r, g, b, 0.9, r, g, b, 0.9);
    for (let i = 1; i <= 4; i++) {
      const next = (i % 4) + 1;
      indices.push(at, at + i, at + next, at, at + next, at + i);
    }
  }
  return { positions, indices, colors };
}

/** The whole glow over one tile, its base at y 0. */
export function keyGlowArrays(hex: GlowHex): MeshArrays {
  const rgb = KEY_GLOW.rgb;
  const options = { corner: hex.corner, segments: hex.segments, rgb };
  const { rim } = KEY_GLOW;
  const fill = loftRoundedHex(hex.radius, [{ scale: rim.inner, y: 0, alpha: KEY_GLOW.fill }], {
    ...options,
    centre: { y: 0, alpha: KEY_GLOW.fill },
  });
  const ring = loftRoundedHex(
    hex.radius,
    [
      { scale: rim.inner, y: 0, alpha: KEY_GLOW.fill },
      { scale: rim.peak, y: 0, alpha: rim.alpha },
      { scale: rim.outer, y: 0, alpha: 0 },
    ],
    options,
  );
  const column = loftRoundedHex(hex.radius, KEY_GLOW.column, options);
  const sparkles = KEY_GLOW.sparkles.map((s) =>
    sparkle(s.x * hex.radius, s.y, s.z * hex.radius, s.size),
  );
  return join([fill, ring, column, ...sparkles]);
}
