import { hexDistance, type Hex } from '../hex/index.js';
import type { Building } from '../schemas/data/buildings.js';

// One building per tile (#295, owner decisions 2026-10-11). Every tile has
// one use: a home tile holds one home building (beside its ring node), and
// any other tile holds one building that its `placement` allows. A resource
// spot must be cleared (#242) before anything but a home building stands on
// it. Fences stand on edges and aren't tile uses. Pure: the server passes in
// the player's tiles and buildings.

/** One of the player's tiles, as the tile-use rules see it. */
export interface TileUseTile extends Hex {
  readonly id: string;
  /** Set on the seven tiles of a home base (the Heart Seed and its ring). */
  readonly homeSlot: number | null;
  /** Resource id of the tile's spot, if it has one. */
  readonly nodeResource: string | null;
  /** Joined to its owner's home as a homestead (#199); paused ones aren't. */
  readonly homestead: boolean;
}

/** Why a building can't go on a tile, or null when it can. */
export type TileUseRefusal =
  /** A home building, off the home base. */
  | 'home-only'
  /** Not a home building, on the home base. */
  | 'not-at-home'
  /** Needs a joined homestead. */
  | 'homestead-only'
  /** A resource spot stands there: clear the land first. */
  | 'clear-first'
  /** The tile already has its building. */
  | 'taken';

/**
 * Where a building of this kind may stand, ignoring what's on the tile: its
 * `placement` (home / homestead / land). Fences (`owned`) aren't tile uses.
 */
function placementRefusal(
  building: Pick<Building, 'placement'>,
  tile: TileUseTile,
): TileUseRefusal | null {
  const home = tile.homeSlot !== null;
  switch (building.placement) {
    case 'home':
      return home ? null : 'home-only';
    case 'homestead':
      return home ? 'not-at-home' : tile.homestead ? null : 'homestead-only';
    case 'land':
      return home ? 'not-at-home' : null;
    case 'owned':
      return null;
  }
}

/**
 * Can a new building of this kind go on this tile? `taken` says the tile
 * already holds a building. A home building stands beside its tile's ring
 * node; anywhere else a resource spot must be cleared first.
 */
export function tileUseRefusal(
  building: Pick<Building, 'placement'>,
  tile: TileUseTile,
  taken: boolean,
): TileUseRefusal | null {
  const where = placementRefusal(building, tile);
  if (where) return where;
  if (taken) return 'taken';
  if (tile.homeSlot === null && tile.nodeResource !== null) return 'clear-first';
  return null;
}

/** A building row as the tidy-up planner sees it. */
export interface TileUseBuilding {
  /** The row's id. */
  readonly id: string;
  readonly tileId: string;
  /** Its id in the building data. */
  readonly buildingId: string;
  /** When it was placed, ISO 8601: the oldest on a crowded tile stays. */
  readonly placedAt: string;
}

/** What the tidy-up does with one player's buildings. */
export interface TileUsePlan {
  /** Rows that stay where they are, in input order. */
  readonly stay: readonly string[];
  /** Rows that move to a free tile they're allowed on. */
  readonly move: readonly { readonly id: string; readonly toTileId: string }[];
  /** Rows with nowhere to go: taken down and given back. */
  readonly pack: readonly string[];
}

const byAge = (a: TileUseBuilding, b: TileUseBuilding): number =>
  a.placedAt < b.placedAt ? -1 : a.placedAt > b.placedAt ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0;

/**
 * Tidies one player's buildings to one per tile (#295's migration of older
 * patches). Deterministic, so a retry plans the same, and a second run on its
 * result plans no moves or packs.
 *
 * - On a crowded tile a Hearthfire stays (it has fuel and lights the land);
 *   otherwise the oldest building stays.
 * - A building its `placement` no longer allows where it stands (the
 *   Crafting Factory leaving home) leaves too, even alone.
 * - One already on a resource spot it was allowed on stays (grandfathered):
 *   the spot rule only gates new buildings.
 * - Each building that leaves, oldest first, goes to the nearest free tile
 *   it's allowed on (spots excluded), ties by tile id; with none free, it's
 *   packed.
 *
 * Rows whose building id isn't in `buildings`, and fences, are left alone.
 */
export function planTileUses(
  tiles: readonly TileUseTile[],
  rows: readonly TileUseBuilding[],
  buildings: readonly Pick<Building, 'id' | 'kind' | 'placement'>[],
): TileUsePlan {
  const data = new Map(buildings.map((b) => [b.id, b]));
  const tileById = new Map(tiles.map((t) => [t.id, t]));
  const onTiles = rows.filter((r) => {
    const b = data.get(r.buildingId);
    return b !== undefined && b.kind !== 'fence' && tileById.has(r.tileId);
  });

  const leaving = new Set<string>();
  const occupied = new Set<string>();
  const byTile = new Map<string, TileUseBuilding[]>();
  for (const row of onTiles) {
    const list = byTile.get(row.tileId) ?? [];
    list.push(row);
    byTile.set(row.tileId, list);
  }
  for (const [tileId, list] of byTile) {
    const tile = tileById.get(tileId);
    if (!tile) continue;
    const allowed = list.filter((r) => {
      const b = data.get(r.buildingId);
      return b !== undefined && placementRefusal(b, tile) === null;
    });
    const fire = allowed.filter((r) => data.get(r.buildingId)?.kind === 'hearthfire').sort(byAge)[0];
    const keeper = fire ?? [...allowed].sort(byAge)[0];
    for (const row of list) if (row !== keeper) leaving.add(row.id);
    if (keeper) occupied.add(tileId);
  }

  const move: { id: string; toTileId: string }[] = [];
  const pack: string[] = [];
  for (const row of onTiles.filter((r) => leaving.has(r.id)).sort(byAge)) {
    const b = data.get(row.buildingId);
    const from = tileById.get(row.tileId);
    if (!b || !from) continue;
    const to = tiles
      .filter((t) => !occupied.has(t.id) && tileUseRefusal(b, t, false) === null)
      .sort((x, y) => hexDistance(x, from) - hexDistance(y, from) || (x.id < y.id ? -1 : x.id > y.id ? 1 : 0))[0];
    if (to) {
      occupied.add(to.id);
      move.push({ id: row.id, toTileId: to.id });
    } else {
      pack.push(row.id);
    }
  }
  const stay = onTiles.filter((r) => !leaving.has(r.id)).map((r) => r.id);
  return { stay, move, pack };
}
