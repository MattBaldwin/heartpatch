import { z } from 'zod';

/**
 * Hex grid maths in axial coordinates (design doc §11). Tiles are pointy-top
 * hexes addressed by `q` (column) and `r` (row); the third cube coordinate is
 * `s = -q - r`. Map centre is `(0, 0)`. Everything here is integer-only, so
 * results are identical on every JS engine.
 *
 * Shared contract: territory adjacency, Hearthfire safe radii, map generation
 * and stranded-tile checks all use these helpers, so keep them small.
 */

/** A tile position. Matches the `tiles.q` / `tiles.r` smallint columns. */
export const HexSchema = z.strictObject({
  q: z.number().int().min(-32768).max(32767),
  r: z.number().int().min(-32768).max(32767),
});
export type Hex = Readonly<z.infer<typeof HexSchema>>;

/** A hex as a string key (`"q,r"`) for `Map` and `Set` lookups. */
export type HexKey = `${number},${number}`;

/** Builds a hex. Normalises `-0` to `0` so equal hexes compare equal everywhere. */
export function hex(q: number, r: number): Hex {
  return { q: q + 0, r: r + 0 };
}

export function hexKey(h: Hex): HexKey {
  return `${h.q},${h.r}`;
}

/** The inverse of `hexKey`. */
export function hexFromKey(key: HexKey): Hex {
  const comma = key.indexOf(',');
  return hex(Number(key.slice(0, comma)), Number(key.slice(comma + 1)));
}

export function hexEquals(a: Hex, b: Hex): boolean {
  return a.q === b.q && a.r === b.r;
}

export function hexAdd(a: Hex, b: Hex): Hex {
  return hex(a.q + b.q, a.r + b.r);
}

export function hexScale(h: Hex, factor: number): Hex {
  return hex(h.q * factor, h.r * factor);
}

/**
 * The six neighbour offsets, in a fixed order going around the hex (east
 * first, then anticlockwise on screen). Ring and spiral order follow it.
 */
export const HEX_DIRECTIONS: readonly Hex[] = [
  hex(1, 0),
  hex(1, -1),
  hex(0, -1),
  hex(-1, 0),
  hex(-1, 1),
  hex(0, 1),
];

/** The six adjacent hexes, in `HEX_DIRECTIONS` order. */
export function hexNeighbors(h: Hex): Hex[] {
  return HEX_DIRECTIONS.map((d) => hexAdd(h, d));
}

/** Steps between two hexes, moving one neighbour at a time. */
export function hexDistance(a: Hex, b: Hex): number {
  const dq = a.q - b.q;
  const dr = a.r - b.r;
  return (Math.abs(dq) + Math.abs(dr) + Math.abs(dq + dr)) / 2;
}

/**
 * Every hex exactly `radius` steps from `center`, walking once around (6 ×
 * radius hexes, starting at `center + radius × HEX_DIRECTIONS[4]`). Radius 0
 * is just the centre.
 */
export function hexRing(center: Hex, radius: number): Hex[] {
  if (!Number.isSafeInteger(radius) || radius < 0) {
    throw new RangeError(`hexRing(): radius must be a whole number >= 0, got ${radius}`);
  }
  if (radius === 0) return [center];
  const ring: Hex[] = [];
  let h = hexAdd(center, hexScale(hex(-1, 1), radius)); // HEX_DIRECTIONS[4]
  for (const direction of HEX_DIRECTIONS) {
    for (let step = 0; step < radius; step++) {
      ring.push(h);
      h = hexAdd(h, direction);
    }
  }
  return ring;
}

/**
 * Every hex within `radius` steps of `center` (1 + 3 × radius × (radius + 1)
 * hexes): the centre, then ring 1, ring 2 and so on. The order is fixed, so
 * it's a safe iteration order for seeded generation.
 */
export function hexSpiral(center: Hex, radius: number): Hex[] {
  const spiral: Hex[] = [];
  for (let k = 0; k <= radius; k++) spiral.push(...hexRing(center, k));
  return spiral;
}

/**
 * Breadth-first search from one or more start hexes, stepping only onto hexes
 * where `canEnter` is true (the starts are always included). Returns each
 * reached hex's step count from the nearest start. Use it for connected
 * territory, stranded tiles and "distance to nearest X" maps.
 */
export function hexBfs(starts: readonly Hex[], canEnter: (h: Hex) => boolean): Map<HexKey, number> {
  const distances = new Map<HexKey, number>();
  const queue: { hex: Hex; distance: number }[] = [];
  for (const start of starts) {
    const key = hexKey(start);
    if (distances.has(key)) continue;
    distances.set(key, 0);
    queue.push({ hex: start, distance: 0 });
  }
  // for…of keeps visiting entries pushed during the loop: a FIFO queue.
  for (const current of queue) {
    for (const neighbor of hexNeighbors(current.hex)) {
      const key = hexKey(neighbor);
      if (distances.has(key) || !canEnter(neighbor)) continue;
      distances.set(key, current.distance + 1);
      queue.push({ hex: neighbor, distance: current.distance + 1 });
    }
  }
  return distances;
}

/** A point on the ground plane in world units: `x` is east, `z` is north. */
export interface WorldPoint {
  readonly x: number;
  readonly z: number;
}

const SQRT3 = Math.sqrt(3);

/**
 * The centre of a hex on the ground plane, for hexes `size` world units from
 * centre to corner. Pointy-top, `(0, 0)` at the origin, north is +z: `r`
 * grows southwards, so `HEX_DIRECTIONS` go east, north-east, north-west and
 * so on, anticlockwise seen from above. The client lays the map out with it
 * (and the server can, for distances in world units).
 */
export function hexToWorld(h: Hex, size: number): WorldPoint {
  return { x: size * SQRT3 * (h.q + h.r / 2) + 0, z: size * -1.5 * h.r + 0 };
}

/**
 * The hex containing a ground point: the inverse of `hexToWorld` (a tap on
 * the map → the tile under it). Points exactly on an edge go to one side,
 * the same one every time.
 */
export function worldToHex(p: WorldPoint, size: number): Hex {
  const r = -p.z / (1.5 * size);
  const q = p.x / (SQRT3 * size) - r / 2;
  return hexRound(q, r);
}

/** The nearest hex to fractional axial coordinates (rounding in cube space). */
function hexRound(q: number, r: number): Hex {
  const s = -q - r;
  let rq = Math.round(q);
  let rr = Math.round(r);
  const rs = Math.round(s);
  const dq = Math.abs(rq - q);
  const dr = Math.abs(rr - r);
  const ds = Math.abs(rs - s);
  // Rounding each coordinate can break q + r + s = 0; fix the one that moved most.
  if (dq > dr && dq > ds) rq = -rr - rs;
  else if (dr > ds) rr = -rq - rs;
  return hex(rq, rr);
}
