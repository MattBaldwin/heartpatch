import {
  HEX_DIRECTIONS,
  hexKey,
  hexToWorld,
  worldToHex,
  type Hex,
  type HexKey,
  type WorldPoint,
} from '@heartpatch/shared';
import type { MeshArrays } from './hex-mesh.js';
import { hash01 } from './map-layout.js';

// The map's ground as one continuous surface (terrain pass 2): no gaps and no
// bevelled pucks between hexes. Each tile keeps a flat middle (its plateau)
// at its own height and colour; its outer edge is shared with its
// neighbours, whose heights and colours are averaged there, so land slopes
// gently from one biome into the next and meets the water in a soft shore.
// Pure (no Babylon), so it's unit-tested; the scene turns it into one mesh
// (one draw call for the whole ground).

export type Rgb = readonly [number, number, number];

/** What the ground needs to know about one tile. */
export interface GroundTile extends Hex {
  /** Height of the tile's flat middle, world units. */
  readonly height: number;
  /** Its colour, linear RGB. */
  readonly color: Rgb;
}

export interface GroundOptions {
  /** Centre-to-corner size of a hex, world units. */
  readonly size: number;
  /** The flat middle's size as a fraction of the hex (the rest slopes to the edge). */
  readonly plateau: number;
  /** Brightness noise per vertex (± fraction), so big areas don't look flat. */
  readonly noise: number;
  /** Where the map's outer edge drops to (the island top). */
  readonly skirtTo: number;
}

/** One tile's 13 ground points: centre, plateau ring (6) and outer ring (corner, mid, … ×6). */
interface TilePoints {
  readonly centre: Point;
  readonly inner: readonly Point[];
  /** Corner k at index 2k, the middle of edge k (corner k → k + 1) at 2k + 1. */
  readonly outer: readonly Point[];
}

interface Point {
  /** Which point this is: the same id for every tile that shares it. */
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly color: Rgb;
}

const average = (values: readonly Rgb[]): Rgb => {
  const n = values.length || 1;
  return [
    values.reduce((s, c) => s + c[0], 0) / n,
    values.reduce((s, c) => s + c[1], 0) / n,
    values.reduce((s, c) => s + c[2], 0) / n,
  ];
};

/** Corner k of a pointy-top hex (30° + 60° k, anticlockwise from just past east). */
function corner(centre: WorldPoint, size: number, k: number): WorldPoint {
  const a = ((30 + 60 * k) * Math.PI) / 180;
  return { x: centre.x + Math.cos(a) * size, z: centre.z + Math.sin(a) * size };
}

/** The continuous ground: its mesh and its height anywhere on the map. */
export class Ground {
  readonly options: GroundOptions;
  private readonly tiles = new Map<HexKey, GroundTile>();
  private readonly points = new Map<HexKey, TilePoints>();

  constructor(tiles: readonly GroundTile[], options: GroundOptions) {
    this.options = options;
    for (const t of tiles) this.tiles.set(hexKey(t), t);
    for (const t of tiles) this.points.set(hexKey(t), this.tilePoints(t));
  }

  /** Is there ground (a tile) at this hex? */
  has(h: Hex): boolean {
    return this.tiles.has(hexKey(h));
  }

  /** Ground height under a point, or null off the map. */
  heightAt(p: WorldPoint): number | null {
    const h = worldToHex(p, this.options.size);
    const pts = this.points.get(hexKey(h));
    if (!pts) return null;
    for (const [a, b, c] of triangles(pts)) {
      const y = barycentricY(p, a, b, c);
      if (y !== null) return y;
    }
    // On an edge, rounding can miss every triangle by a hair: the nearest point will do.
    return pts.centre.y;
  }

  /** The tile's own (plateau) height, or null off the map. */
  tileHeight(h: Hex): number | null {
    return this.tiles.get(hexKey(h))?.height ?? null;
  }

  /**
   * The whole ground as one vertex-coloured mesh. Points shared by
   * neighbouring tiles are one vertex, so normals are smooth across borders;
   * the map's outer edge gets a skirt down to the island.
   */
  mesh(): MeshArrays {
    const positions: number[] = [];
    const colors: number[] = [];
    const indices: number[] = [];
    const index = new Map<string, number>();
    const { noise } = this.options;
    const vertex = (p: Point, shade = 1): number => {
      const key = `${p.id}@${String(shade)}`;
      const found = index.get(key);
      if (found !== undefined) return found;
      const i = positions.length / 3;
      // The same noise for the same spot, whichever tile adds it.
      const n = 1 + (hash01(Math.round(p.x * 50), Math.round(p.z * 50), 91) * 2 - 1) * noise;
      positions.push(p.x, p.y, p.z);
      colors.push(p.color[0] * n * shade, p.color[1] * n * shade, p.color[2] * n * shade, 1);
      index.set(key, i);
      return i;
    };
    for (const [key, pts] of this.points) {
      for (const [a, b, c] of triangles(pts)) {
        // Wound so Babylon's computed normals face up (as hex-mesh.ts does).
        indices.push(vertex(a), vertex(c), vertex(b));
      }
      // A skirt where the map ends: edges with no neighbour drop to the island.
      const tile = this.tiles.get(key);
      if (!tile) continue;
      for (let k = 0; k < 6; k++) {
        const dir = HEX_DIRECTIONS[(k + 1) % 6];
        if (!dir || this.tiles.has(hexKey({ q: tile.q + dir.q, r: tile.r + dir.r }))) continue;
        const run = [pts.outer[2 * k], pts.outer[2 * k + 1], pts.outer[(2 * k + 2) % 12]];
        for (let s = 0; s < 2; s++) {
          const top0 = run[s];
          const top1 = run[s + 1];
          if (!top0 || !top1) continue;
          const low = (p: Point): Point => ({ ...p, id: `${p.id}!low`, y: this.options.skirtTo });
          const a = vertex(top0, 0.7);
          const b = vertex(top1, 0.7);
          const c = vertex(low(top1), 0.55);
          const d = vertex(low(top0), 0.55);
          indices.push(a, b, c, a, c, d);
        }
      }
    }
    return { positions, indices, colors };
  }

  private tilePoints(t: GroundTile): TilePoints {
    const { size, plateau } = this.options;
    const centre = hexToWorld(t, size);
    const neighbour = (dir: number): GroundTile | undefined => {
      const d = HEX_DIRECTIONS[((dir % 6) + 6) % 6];
      return d ? this.tiles.get(hexKey({ q: t.q + d.q, r: t.r + d.r })) : undefined;
    };
    const blend = (tiles: readonly (GroundTile | undefined)[]) => {
      const present = tiles.filter((x): x is GroundTile => x !== undefined);
      return {
        y: present.reduce((s, x) => s + x.height, 0) / present.length,
        color: average(present.map((x) => x.color)),
      };
    };
    const inner: Point[] = [];
    const outer: Point[] = [];
    const self = hexKey(t);
    const near = (dir: number): string => {
      const d = HEX_DIRECTIONS[((dir % 6) + 6) % 6];
      return d ? hexKey({ q: t.q + d.q, r: t.r + d.r }) : '';
    };
    // A shared point's id is the sorted set of the hexes that meet there.
    const shared = (...keys: string[]) => keys.sort().join('|');
    for (let k = 0; k < 6; k++) {
      const c = corner(centre, size, k);
      const next = corner(centre, size, k + 1);
      inner.push({
        id: `${self}#${String(k)}`,
        x: centre.x + (c.x - centre.x) * plateau,
        y: t.height,
        z: centre.z + (c.z - centre.z) * plateau,
        color: t.color,
      });
      // Corner k touches the neighbours in directions k and k + 1; the middle
      // of edge k touches the one in direction k + 1.
      const atCorner = blend([t, neighbour(k), neighbour(k + 1)]);
      const atMid = blend([t, neighbour(k + 1)]);
      outer.push({ id: shared(self, near(k), near(k + 1)), x: c.x, z: c.z, ...atCorner });
      outer.push({
        id: shared(self, near(k + 1)),
        x: (c.x + next.x) / 2,
        z: (c.z + next.z) / 2,
        ...atMid,
      });
    }
    return {
      centre: { id: self, x: centre.x, y: t.height, z: centre.z, color: t.color },
      inner,
      outer,
    };
  }
}

/** A tile's 24 triangles: 6 across the plateau, 18 sloping out to the shared edge. */
function triangles(pts: TilePoints): [Point, Point, Point][] {
  const out: [Point, Point, Point][] = [];
  for (let k = 0; k < 6; k++) {
    const i0 = pts.inner[k];
    const i1 = pts.inner[(k + 1) % 6];
    const k0 = pts.outer[2 * k];
    const m = pts.outer[2 * k + 1];
    const k1 = pts.outer[(2 * k + 2) % 12];
    if (!i0 || !i1 || !k0 || !m || !k1) continue;
    out.push([pts.centre, i0, i1]);
    out.push([i0, k0, m]);
    out.push([i0, m, i1]);
    out.push([i1, m, k1]);
  }
  return out;
}

/** Height at `p` inside triangle abc (seen from above), or null if `p` is outside it. */
function barycentricY(p: WorldPoint, a: Point, b: Point, c: Point): number | null {
  const d = (b.z - c.z) * (a.x - c.x) + (c.x - b.x) * (a.z - c.z);
  if (Math.abs(d) < 1e-12) return null;
  const wa = ((b.z - c.z) * (p.x - c.x) + (c.x - b.x) * (p.z - c.z)) / d;
  const wb = ((c.z - a.z) * (p.x - c.x) + (a.x - c.x) * (p.z - c.z)) / d;
  const wc = 1 - wa - wb;
  const eps = -1e-9;
  if (wa < eps || wb < eps || wc < eps) return null;
  return wa * a.y + wb * b.y + wc * c.y;
}
