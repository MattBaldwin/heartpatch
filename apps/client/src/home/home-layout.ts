import {
  COMMUNITY_RULES,
  hexAdd,
  hexKey,
  hexToWorld,
  safeTiles,
  spotOffset,
  villageLights,
  type HexKey,
  type MapView,
  type PublicTile,
  type SafeFire,
  type WorldPoint,
} from '@heartpatch/shared';
import { findHomeBases } from '../map/map-layout.js';
import { HOME_FILL, SPOT_SIZE } from './home-config.js';

// Pure home-base layout (no Babylon), so it's unit-tested: where a building
// spot is in the world, and which map tiles a lit Hearthfire keeps safe.
// Everything comes from what the server sent (CLAUDE.md rule 1).

/** World position of a spot on a tile drawn at `hexSize`. */
export function spotWorld(
  tile: { q: number; r: number },
  spot: number,
  hexSize: number,
): WorldPoint {
  const centre = hexToWorld(tile, hexSize);
  const offset = hexToWorld(spotOffset(spot), hexSize * SPOT_SIZE);
  return { x: centre.x + offset.x, z: centre.z + offset.z };
}

/**
 * Whether a building fills its home tile (#589): any building on a ring spot
 * of a home ring tile. Fires stand on the centre spot already, and the Heart
 * Seed tile keeps its spots as they are.
 */
export function fillsTile(spot: number, onHeartSeed: boolean): boolean {
  return spot !== 0 && !onHeartSeed;
}

/** Where the small node pile sits on a tile whose building fills it (#589). */
export function nodeAside(centre: WorldPoint, hexSize: number): WorldPoint {
  return {
    x: centre.x + HOME_FILL.nodeOffset.x * hexSize,
    z: centre.z + HOME_FILL.nodeOffset.z * hexSize,
  };
}

/** The home tiles whose building fills them, as the map sees them. */
export function filledTiles(view: MapView): Set<HexKey> {
  const seeds = new Set(findHomeBases(view.tiles).map((h) => hexKey(h.seed)));
  const filled = new Set<HexKey>();
  for (const tile of view.tiles) {
    if (tile.homeSlot === null) continue;
    const onSeed = seeds.has(hexKey(tile));
    if (tile.buildings.some((b) => fillsTile(b.spot, onSeed))) filled.add(hexKey(tile));
  }
  return filled;
}

/** A building on the map view, with where it stands. */
export interface PlacedOnMap {
  readonly tile: PublicTile;
  readonly building: PublicTile['buildings'][number];
  readonly at: WorldPoint;
  /** It fills a home ring tile (#589): drawn tile-sized, in the middle. */
  readonly fills: boolean;
}

/** Every building on the map, at map scale. */
export function mapBuildings(view: MapView, hexSize: number): PlacedOnMap[] {
  const placed: PlacedOnMap[] = [];
  const seeds = new Set(findHomeBases(view.tiles).map((h) => hexKey(h.seed)));
  for (const tile of view.tiles) {
    for (const building of tile.buildings) {
      // A building fills its tile, in the middle: out on the land (#295) and
      // on a home ring tile (#589). Only the Heart Seed tile still uses spots.
      const fills = tile.homeSlot !== null && fillsTile(building.spot, seeds.has(hexKey(tile)));
      const at =
        tile.homeSlot === null || fills
          ? hexToWorld(tile, hexSize)
          : spotWorld(tile, building.spot, hexSize);
      placed.push({ tile, building, at, fills });
    }
  }
  return placed;
}

/**
 * Tiles safe tonight, as the map shows them: every claimed home base (the
 * Heart Seed keeps it safe, owner decision 2026-10-07) plus each lit fire's
 * tile and radius out on land (shared `safeTiles`, the rule nightfall uses),
 * and every won Lantern Tower's light.
 * `lit` is as of the view or the last event about it.
 */
export function mapSafeTiles(view: MapView): Set<HexKey> {
  const homes = view.tiles.filter((t) => t.homeSlot !== null && t.ownerUserId !== null);
  const fires: SafeFire[] = [];
  for (const tile of view.tiles) {
    for (const b of tile.buildings) {
      if (b.lit !== true || b.safeRadius === null) continue;
      fires.push({ at: tile, radius: b.safeRadius });
    }
  }
  // A won Lantern Tower lights its village and the land around it (#306 PR 3b).
  fires.push(...villageLights(view.communities ?? [], COMMUNITY_RULES));
  const known = new Set(view.tiles.map((t) => hexKey(t)));
  return new Set([...safeTiles(fires, homes)].filter((key) => known.has(key)));
}

/** The middle of a set of hexes (the Heart Seed of a home base). */
export function centreOf(tiles: readonly { q: number; r: number }[]): { q: number; r: number } {
  if (tiles.length === 0) return { q: 0, r: 0 };
  const sum = tiles.reduce((acc, t) => hexAdd(acc, t), { q: 0, r: 0 });
  return { q: Math.round(sum.q / tiles.length), r: Math.round(sum.r / tiles.length) };
}
