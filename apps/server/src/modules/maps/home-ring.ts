import { GAME_DATA, missingHomeRingNodes } from '@heartpatch/shared';
import type { Executor } from '../../db/client.js';
import { createTerritoryRepo } from '../territory/repo.js';
import { createMapsRepo } from './repo.js';

/**
 * Gives every home on the map the home-ring nodes it's missing (owner
 * decision 2026-10-06: a seasonal Pumpkin node and leaf pile in every home
 * ring), the next time the map or a home is read, instead of a backfill. A
 * map generated now already has them, so this is one cheap read; an older map
 * gets them once, on free ring tiles picked by the map seed (shared
 * `missingHomeRingNodes`). The write locks the home tiles in id order and
 * looks again, so it can't race building placement onto the same middle
 * spot. Nodes only show and gather in their season (client and gathering).
 *
 * No game event: other players see the new nodes the next time they load
 * the map, as they would any map-open refresh. The Tutorial Glade keeps its
 * hand-made layout (it has no seasons).
 */
export async function seedHomeRingNodes(db: Executor, mapId: string): Promise<void> {
  const repo = createMapsRepo(db);
  const { homeRingNodes } = GAME_DATA.mapGen;
  const [home, map, seed] = await Promise.all([
    repo.listHomeRingTiles(mapId),
    repo.findMap(mapId),
    createTerritoryRepo(db).mapSeed(mapId),
  ]);
  if (map?.kind !== 'multiplayer') return;
  if (missingHomeRingNodes(home, homeRingNodes, seed).length === 0) return;
  await repo.transaction(async (tx) => {
    const locked = await tx.listHomeRingTiles(mapId, true);
    const byKey = new Map(locked.map((t) => [`${String(t.q)},${String(t.r)}`, t.id]));
    for (const node of missingHomeRingNodes(locked, homeRingNodes, seed)) {
      const tileId = byKey.get(`${String(node.q)},${String(node.r)}`);
      if (tileId) await tx.addHomeNode(tileId, node.resource);
    }
  });
}
