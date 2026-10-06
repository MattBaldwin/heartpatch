import { hexKey, hexRing, type Hex } from '../hex/index.js';
import { deriveSeed, Rng, type Seed } from '../rng/index.js';

/** Building spots on a home tile: 0 is the middle (where a node stands), 1–6 around it. */
const SIDE_SPOTS = [1, 2, 3, 4, 5, 6] as const;

/** A stored home tile, as `missingHomeRingNodes` needs it. */
export interface HomeRingTile {
  readonly q: number;
  readonly r: number;
  /** The player slot whose home base this tile is part of. */
  readonly homeSlot: number;
  readonly nodeResource: string | null;
  /** Spots with a building on them (0 is the middle, where a node would go). */
  readonly takenSpots: readonly number[];
}

/** A node to add to a stored home ring. */
export interface HomeRingNode {
  readonly q: number;
  readonly r: number;
  readonly resource: string;
  /**
   * The side spot the building in the tile's middle moves to first, so the
   * node has room; `null` when the middle is already free.
   */
  readonly moveMiddleTo: number | null;
}

/** What topping up a stored map's home rings takes. */
export interface HomeRingPlan {
  readonly add: readonly HomeRingNode[];
  /** Nodes that can't go anywhere yet: every free ring tile is full of buildings. */
  readonly waiting: number;
}

/**
 * The home-ring nodes a stored map is missing (owner decision 2026-10-06): a
 * map made before a resource joined `mapGen.homeRingNodes` (the seasonal
 * Pumpkins and leaf pile) gets it on a ring tile without a node the next
 * time its homes are read. Pure and deterministic: each home tries those
 * tiles in an order turned by the map seed and the slot, so every read picks
 * the same ones. Tiles with a free middle go first. Then, so every home gets
 * its seasonal nodes, a tile whose middle has a building in it, which moves
 * to the lowest free side spot on the same tile. A node waits only when
 * every such tile is full. Maps generated now already have every node, so
 * this returns nothing for them.
 */
export function missingHomeRingNodes(
  tiles: readonly HomeRingTile[],
  homeRingNodes: readonly string[],
  seed: Seed | null,
): HomeRingPlan {
  const slots = new Map<number, HomeRingTile[]>();
  for (const tile of tiles) slots.set(tile.homeSlot, [...(slots.get(tile.homeSlot) ?? []), tile]);
  const add: HomeRingNode[] = [];
  let waiting = 0;
  for (const [slot, home] of [...slots].sort(([a], [b]) => a - b)) {
    // The Heart Seed is the middle of the seven tiles (their mean).
    const center: Hex = {
      q: home.reduce((sum, t) => sum + t.q, 0) / home.length,
      r: home.reduce((sum, t) => sum + t.r, 0) / home.length,
    };
    const byKey = new Map(home.map((t) => [hexKey(t), t]));
    const ring = hexRing(center, 1).flatMap((h) => byKey.get(hexKey(h)) ?? []);
    const have = new Set(ring.map((t) => t.nodeResource));
    const missing = homeRingNodes.filter((resource) => !have.has(resource));
    if (missing.length === 0) continue;
    const turn = seed === null ? 0 : Rng.fromSeed(deriveSeed(seed, 'home-ring', slot)).int(0, 5);
    const bare = [...ring.slice(turn), ...ring.slice(0, turn)].filter(
      (t) => t.nodeResource === null,
    );
    const open = bare.flatMap((t) =>
      t.takenSpots.includes(0) ? [] : [{ tile: t, moveMiddleTo: null }],
    );
    const crowded = bare.flatMap((t) => {
      if (!t.takenSpots.includes(0)) return [];
      const side = SIDE_SPOTS.find((s) => !t.takenSpots.includes(s));
      return side === undefined ? [] : [{ tile: t, moveMiddleTo: side }];
    });
    const room = [...open, ...crowded];
    missing.forEach((resource, i) => {
      const spot = room[i];
      if (!spot) {
        waiting++;
        return;
      }
      add.push({ q: spot.tile.q, r: spot.tile.r, resource, moveMiddleTo: spot.moveMiddleTo });
    });
  }
  return { add, waiting };
}
