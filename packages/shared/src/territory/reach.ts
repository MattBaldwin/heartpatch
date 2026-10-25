import { TERRAINS } from '../data/terrains.js';
import { hexBfs, hexDistance, hexKey, hexNeighbors, type Hex, type HexKey } from '../hex/index.js';
import type { TravelRules } from '../schemas/data/travel.js';
import { isWater } from '../schemas/data/terrains.js';

// Connected land and trading-post reach (#30, #269). Pure: the server decides
// with these and the client explains with the same code. `connectedLand` is
// the one BFS for "reached from home through my own land"; #199's homestead
// tiles reuse it rather than writing another.

/** The terrain id of a trading-post tile (stored in `tiles.terrain`, never renamed). */
export const TRADING_POST_TERRAIN = 'trading-post';

/** Is this tile a trading post? Posts are shared and never owned (owner decision 1 on #30). */
export function isTradingPost(tile: { readonly terrain: string }): boolean {
  return tile.terrain === TRADING_POST_TERRAIN;
}

/** What reach needs to know about a tile (`PublicTile` and the server's tile rows fit). */
export interface ReachTile extends Hex {
  readonly ownerUserId: string | null;
  readonly homeSlot: number | null;
}

/**
 * The player's land that's joined to their home: a BFS from their home tiles
 * (the Heart Seed and its ring) stepping only onto tiles they own. Land cut
 * off from home by a rival's capture isn't in it. Empty when they have no
 * home on this map.
 */
export function connectedLand(tiles: readonly ReachTile[], userId: string): Set<HexKey> {
  const mine = new Set(tiles.filter((t) => t.ownerUserId === userId).map(hexKey));
  const home = tiles.filter((t) => t.ownerUserId === userId && t.homeSlot !== null);
  return new Set(hexBfs(home, (h) => mine.has(hexKey(h))).keys());
}

/**
 * How a player reaches a trading post (owner decisions 1–3 on #30):
 * - `connected`: their land joined to home touches it, so no journey is needed;
 * - `journey`: it doesn't, and a journey's difficulty grows with `distance`,
 *   the steps from the post to their nearest owned tile (home ring included,
 *   cut-off land too, so a cut-off tile next to it is distance 1).
 * Null when they own no land on the map.
 */
export type PostReach =
  { readonly kind: 'connected' } | { readonly kind: 'journey'; readonly distance: number };

export function postReach(
  post: Hex,
  tiles: readonly ReachTile[],
  userId: string,
): PostReach | null {
  const connected = connectedLand(tiles, userId);
  if (hexNeighbors(post).some((n) => connected.has(hexKey(n)))) return { kind: 'connected' };
  let distance = Infinity;
  for (const t of tiles) {
    if (t.ownerUserId === userId) distance = Math.min(distance, hexDistance(t, post));
  }
  return distance === Infinity ? null : { kind: 'journey', distance };
}

const WATER = new Set(TERRAINS.filter((t) => isWater(t)).map((t) => t.id));

/** Is this terrain id water (Wild Isle, #621)? Unknown ids are land. */
export function isWaterTerrain(terrain: string): boolean {
  return WATER.has(terrain);
}

/** A tile as `supplyMap` needs it: owner, home slot and terrain. */
export interface SupplyTile extends ReachTile {
  readonly terrain: string;
}

/** A road (`tile_roads`): whose, and its level (1 Path, 2 Road, 3 Paved road). */
export interface RoadSpot extends Hex {
  readonly ownerUserId: string;
  readonly level: number;
}

/** A bridge standing on a river tile, and whose it is. */
export interface BridgeSpot extends Hex {
  readonly ownerUserId: string;
}

/**
 * A player's supply line home on a Wild Isle (#621):
 * - `supplied`: the tiles joined to home, their own land and the bridges
 *   they cross; land of theirs outside it is stranded and starts to fade.
 * - `reach`: land a road of theirs reaches past their own land, with the
 *   steps from the nearest such road; they may claim it.
 */
export interface Supply {
  readonly supplied: ReadonlySet<HexKey>;
  readonly reach: ReadonlyMap<HexKey, number>;
}

/**
 * `connectedLand` for a Wild Isle (#621): a BFS from the player's home tiles
 * over their own land, never onto water except a river tile with a bridge
 * (anyone's while `bridgesShared`, else only theirs). A road of theirs on
 * supplied land reaches `reach` steps (its level's) over any land, never
 * water; their own land in that reach is supplied too, so a road carries
 * the supply line across a gap and land claimed through it isn't stranded.
 * Roads count only on their owner's tiles. Pure; the server decides with it
 * and the client explains with it.
 */
export function supplyMap(
  tiles: readonly SupplyTile[],
  roads: readonly RoadSpot[],
  bridges: readonly BridgeSpot[],
  userId: string,
  rules: Pick<TravelRules, 'roads' | 'bridgesShared'>,
): Supply {
  const byKey = new Map(tiles.map((t) => [hexKey(t), t]));
  const isLand = (key: HexKey) => {
    const t = byKey.get(key);
    return t !== undefined && !isWaterTerrain(t.terrain);
  };
  const mine = (key: HexKey) => isLand(key) && byKey.get(key)?.ownerUserId === userId;
  const crossings = new Set(
    bridges
      .filter((b) => rules.bridgesShared || b.ownerUserId === userId)
      .map(hexKey)
      .filter((key) => byKey.get(key)?.terrain === 'river'),
  );
  const roadReach = new Map<HexKey, number>();
  for (const road of roads) {
    const key = hexKey(road);
    if (road.ownerUserId !== userId || !mine(key)) continue;
    const level = rules.roads.levels[Math.min(road.level, rules.roads.levels.length) - 1];
    if (level) roadReach.set(key, level.reach);
  }

  const supplied = new Set<HexKey>();
  const reach = new Map<HexKey, number>();
  const queue: Hex[] = [];
  const supply = (hex: Hex) => {
    const key = hexKey(hex);
    if (supplied.has(key)) return;
    supplied.add(key);
    queue.push(hex);
  };
  for (const t of tiles) {
    if (t.ownerUserId === userId && t.homeSlot !== null && !isWaterTerrain(t.terrain)) supply(t);
  }
  // for…of keeps visiting entries pushed during the loop: a FIFO queue.
  for (const current of queue) {
    for (const n of hexNeighbors(current)) {
      const key = hexKey(n);
      if (mine(key) || crossings.has(key)) supply(n);
    }
    const steps = roadReach.get(hexKey(current));
    if (steps === undefined) continue;
    const near = hexBfs([current], (h) => isLand(hexKey(h)) && hexDistance(h, current) <= steps);
    for (const [key, distance] of near) {
      // Round water the walk is longer than the straight line: steps count.
      if (distance === 0 || distance > steps) continue;
      reach.set(key, Math.min(reach.get(key) ?? Infinity, distance));
      const t = byKey.get(key);
      if (t && mine(key)) supply(t);
    }
  }
  return { supplied, reach };
}
