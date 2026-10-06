import { hexKey, hexRing, type Hex } from '../hex/index.js';
import { deriveSeed, Rng, type Seed } from '../rng/index.js';

/** A stored home tile, as `missingHomeRingNodes` needs it. */
export interface HomeRingTile {
  readonly q: number;
  readonly r: number;
  /** The player slot whose home base this tile is part of. */
  readonly homeSlot: number;
  readonly nodeResource: string | null;
  /** A building stands on the tile's middle spot (where a node would go). */
  readonly middleTaken: boolean;
}

/** A node to add to a stored home ring. */
export interface HomeRingNode {
  readonly q: number;
  readonly r: number;
  readonly resource: string;
}

/**
 * The home-ring nodes a stored map is missing (owner decision 2026-10-06):
 * a map made before a resource joined `mapGen.homeRingNodes` (the seasonal
 * Pumpkins and leaf pile) gets it on a free ring tile the next time its homes
 * are read. Pure and deterministic: each home tries its free ring tiles in an
 * order turned by the map seed and the slot, so every read picks the same
 * tile. A tile with a building on its middle is skipped; if no tile is free,
 * the node waits until one is. Maps generated now already have every node, so
 * this returns nothing for them.
 */
export function missingHomeRingNodes(
  tiles: readonly HomeRingTile[],
  homeRingNodes: readonly string[],
  seed: Seed | null,
): HomeRingNode[] {
  const slots = new Map<number, HomeRingTile[]>();
  for (const tile of tiles) slots.set(tile.homeSlot, [...(slots.get(tile.homeSlot) ?? []), tile]);
  const added: HomeRingNode[] = [];
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
    const free = [...ring.slice(turn), ...ring.slice(0, turn)].filter(
      (t) => t.nodeResource === null && !t.middleTaken,
    );
    missing.forEach((resource, i) => {
      const tile = free[i];
      if (tile) added.push({ q: tile.q, r: tile.r, resource });
    });
  }
  return added;
}
