import { hexToWorld, type Hex, type MapView, type PublicTile } from '@heartpatch/shared';
import { FENCE_INSET } from './fence-layout.js';
import { hash01 } from './map-layout.js';
import { CHRISTMAS } from './map-config.js';

// Where Twinkle Lights' bulbs hang (#37 2a). Pure (no Babylon), so it's
// unit-tested. A tile holding a `lights` building gets a string along each
// of its six edges (on top of a fence where the edge has one, else just over
// the rim, dipping a little between corners), a scalloped swag under each
// other building's eaves on the camera side, and a few bulbs round the
// lights' own post: spread round the tile, never clumped in its middle.
// Every bulb is a thin instance of one quad, so the patch's bulbs are one
// draw call however many; `CHRISTMAS.bulbs.cap` bounds them, and a busy
// patch respaces each string with fewer bulbs rather than dropping tiles.
// Edge bulbs under a building's footprint are left out (they'd sit on it).

const B = CHRISTMAS.bulbs;

/** One bulb: where it hangs and its colour (an index into `CHRISTMAS.bulbs.colors`). */
export interface Bulb {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly color: number;
  /** Its size as a share of a full bulb (a swag's are smaller); 1 when left out. */
  readonly scale?: number;
}

/** A building on a lit tile whose eaves get a swag: its middle, eave height and reach. */
export interface BulbEave {
  readonly x: number;
  readonly z: number;
  /** World height of the swag's top. */
  readonly y: number;
  readonly radius: number;
  /** How far its footprint (walls, pad) reaches from its middle; edge bulbs inside it are left out. */
  readonly footprint: number;
  /** A flat building (a pad) has no eaves: no swag, only the edge bulbs kept off it. */
  readonly flat?: boolean;
}

/** A Twinkle Lights post: its foot, how tall it stands and how wide its coil is. */
export interface BulbPost {
  readonly x: number;
  readonly z: number;
  readonly y: number;
  readonly height: number;
  readonly radius: number;
}

/** A tile holding Twinkle Lights, as the bulbs see it. */
export interface BulbTile extends Hex {
  /** World height of the tile's rim (where its fences stand). */
  readonly rim: number;
  /** Edges (0-5) with a fence on this tile's side. */
  readonly fenced: ReadonlySet<number>;
  readonly eaves: readonly BulbEave[];
  readonly posts: readonly BulbPost[];
}

/** Tiles holding a `lights` building (the kind X2's head start counts), once each. */
export function litTiles(view: Pick<MapView, 'tiles'>): PublicTile[] {
  return view.tiles.filter((t) => t.buildings.some((b) => b.kind === 'lights'));
}

/** How many bulbs each string on a tile gets, within `budget`. */
export interface BulbCounts {
  readonly perEdge: number;
  readonly perEave: number;
  readonly perPost: number;
}

/**
 * Bulbs per string for a tile with `eaves` swags and `posts` posts and room
 * for `budget` bulbs: the edges first (they spread the light round the
 * tile), then the post, then the eaves share what's left.
 */
export function bulbCounts(eaves: number, posts: number, budget: number): BulbCounts {
  const room = Math.max(0, Math.floor(budget));
  const perEdge = Math.min(B.perEdge, Math.floor(room / 6));
  let left = room - perEdge * 6;
  const perPost = posts === 0 ? 0 : Math.min(B.perPost, Math.floor(left / posts));
  left -= perPost * posts;
  const perEave = eaves === 0 ? 0 : Math.min(B.perEave, Math.floor(left / eaves));
  return { perEdge, perEave, perPost };
}

/** How many of a tile's buildings get a swag (not the flat ones). */
export const swags = (tile: BulbTile): number => tile.eaves.filter((e) => e.flat !== true).length;

/** Every bulb on one lit tile, with `counts` bulbs on each string. */
export function tileBulbs(tile: BulbTile, size: number, counts: BulbCounts): Bulb[] {
  const bulbs: Bulb[] = [];
  const centre = hexToWorld(tile, size);
  // Each tile starts its colours somewhere else, so neighbours don't match.
  const start = Math.floor(hash01(tile.q, tile.r, 140) * B.colors.length);
  let n = 0;
  const push = (x: number, y: number, z: number, scale = 1) => {
    const color = (start + n) % B.colors.length;
    bulbs.push(scale === 1 ? { x, y, z, color } : { x, y, z, color, scale });
    n++;
  };
  // A building whose footprint reaches the edge hides that part of the string.
  // A bulb's glass reaches `core` of its quad out from where it hangs.
  const clear = B.size * B.core;
  const covered = (x: number, z: number) =>
    tile.eaves.some((e) => Math.hypot(x - e.x, z - e.z) < e.footprint + clear);
  // Pointy-top: edge e runs between the corners at 60e - 30° and 60e + 30°,
  // pulled in like the fences (`FENCE_INSET`) so a fenced edge's bulbs sit on it.
  const reach = size * FENCE_INSET;
  for (let edge = 0; edge < 6; edge++) {
    const a0 = ((60 * edge - 30) * Math.PI) / 180;
    const a1 = ((60 * edge + 30) * Math.PI) / 180;
    const lift = tile.fenced.has(edge) ? B.fenceLift : B.rimLift;
    for (let i = 0; i < counts.perEdge; i++) {
      const t = (i + 1) / (counts.perEdge + 1);
      const x = centre.x + reach * (Math.cos(a0) + (Math.cos(a1) - Math.cos(a0)) * t);
      const z = centre.z + reach * (Math.sin(a0) + (Math.sin(a1) - Math.sin(a0)) * t);
      if (covered(x, z)) continue;
      push(x, tile.rim + lift - B.sag * Math.sin(Math.PI * t), z);
    }
  }
  for (const post of tile.posts) {
    for (let i = 0; i < counts.perPost; i++) {
      const k = counts.perPost === 1 ? 0.5 : i / (counts.perPost - 1);
      const a = i * 2.4 - Math.PI / 2; // TUNE: a coil, starting on the camera side
      push(
        post.x + Math.cos(a) * post.radius,
        post.y + post.height * (0.3 + 0.62 * k),
        post.z + Math.sin(a) * post.radius,
      );
    }
  }
  for (const eave of tile.eaves) {
    if (eave.flat === true) continue;
    // On the camera's side (−z) of the building, three soft scallops.
    for (let i = 0; i < counts.perEave; i++) {
      const t = counts.perEave === 1 ? 0.5 : i / (counts.perEave - 1);
      const a = Math.PI * (1.12 + 0.76 * t);
      push(
        eave.x + Math.cos(a) * eave.radius,
        eave.y - B.sag * Math.abs(Math.sin(3 * Math.PI * t)),
        eave.z + Math.sin(a) * eave.radius,
        B.eaveScale,
      );
    }
  }
  return bulbs;
}

/**
 * Every bulb on the map: each lit tile's, all of them within `cap`. A tile
 * gets its full strings while the patch fits; past that, each tile's share
 * (`cap` over the lit tiles) respaces its strings with fewer bulbs.
 */
export function bulbLayout(tiles: readonly BulbTile[], size: number, cap: number = B.cap): Bulb[] {
  if (tiles.length === 0 || cap <= 0) return [];
  const share = Math.floor(cap / tiles.length);
  const bulbs = tiles.flatMap((tile) =>
    tileBulbs(tile, size, bulbCounts(swags(tile), tile.posts.length, share)),
  );
  return bulbs.slice(0, cap);
}
