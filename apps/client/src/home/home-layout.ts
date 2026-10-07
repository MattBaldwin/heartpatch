import {
  hexAdd,
  hexKey,
  hexToWorld,
  safeTiles,
  spotOffset,
  type HexKey,
  type MapView,
  type PublicTile,
  type SafeFire,
  type WorldPoint,
} from '@heartpatch/shared';
import { SPOT_SIZE } from './home-config.js';

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

/** A building on the map view, with where it stands. */
export interface PlacedOnMap {
  readonly tile: PublicTile;
  readonly building: PublicTile['buildings'][number];
  readonly at: WorldPoint;
}

/** Every building on the map, at map scale. */
export function mapBuildings(view: MapView, hexSize: number): PlacedOnMap[] {
  const placed: PlacedOnMap[] = [];
  for (const tile of view.tiles) {
    for (const building of tile.buildings) {
      placed.push({ tile, building, at: spotWorld(tile, building.spot, hexSize) });
    }
  }
  return placed;
}

/**
 * Tiles safe tonight, as the map shows them: every claimed home base (the
 * Heart Seed keeps it safe, owner decision 2026-10-07) plus each lit fire's
 * tile and radius out on land (shared `safeTiles`, the rule nightfall uses).
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
  const known = new Set(view.tiles.map((t) => hexKey(t)));
  return new Set([...safeTiles(fires, homes)].filter((key) => known.has(key)));
}

/** The middle of a set of hexes (the Heart Seed of a home base). */
export function centreOf(tiles: readonly { q: number; r: number }[]): { q: number; r: number } {
  if (tiles.length === 0) return { q: 0, r: 0 };
  const sum = tiles.reduce((acc, t) => hexAdd(acc, t), { q: 0, r: 0 });
  return { q: Math.round(sum.q / tiles.length), r: Math.round(sum.r / tiles.length) };
}
