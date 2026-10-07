import { deriveSeed, Rng } from '../rng/index.js';
import type { Terrain } from '../schemas/data/terrains.js';

// Extra nodes (#238): Water on lakes, Greens on meadows and forests, Ice on
// mountains. A second pass after `generateMap`'s main one, rolled per tile
// from the map seed, so a new map and an older map read later get exactly
// the same nodes, and running it twice adds nothing (CLAUDE.md rule 4: done
// on read, no backfill job).

/** What the pass needs to know about a tile. */
export interface ExtraNodeTile {
  readonly q: number;
  readonly r: number;
  readonly terrain: string;
  readonly homeSlot: number | null;
  readonly nodeResource: string | null;
}

/** A node to add. */
export interface ExtraNode {
  readonly q: number;
  readonly r: number;
  readonly resource: string;
}

/**
 * Nodes to add to tiles that have none, outside home bases (their nodes are
 * the guaranteed ring, design doc §11), in tile order. Each of the terrain's
 * `extraNodes` is rolled in order on the tile's own seed; the first that hits
 * wins. Tiles that already have a node are left alone, so it's idempotent.
 */
export function extraNodes(
  tiles: readonly ExtraNodeTile[],
  terrains: readonly Pick<Terrain, 'id' | 'extraNodes'>[],
  mapSeed: string,
): ExtraNode[] {
  const byId = new Map(terrains.map((t) => [t.id, t]));
  const added: ExtraNode[] = [];
  for (const tile of tiles) {
    if (tile.homeSlot !== null || tile.nodeResource !== null) continue;
    for (const extra of byId.get(tile.terrain)?.extraNodes ?? []) {
      const rng = Rng.fromSeed(deriveSeed(mapSeed, 'extra-node', tile.q, tile.r, extra.resource));
      if (rng.chance(extra.chance)) {
        added.push({ q: tile.q, r: tile.r, resource: extra.resource });
        break;
      }
    }
  }
  return added;
}
