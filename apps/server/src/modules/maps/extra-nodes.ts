import { deriveSeed, extraNodes, GAME_DATA } from '@heartpatch/shared';
import type { Executor } from '../../db/client.js';
import { createTerritoryRepo } from '../territory/repo.js';
import { createMapsRepo } from './repo.js';

/**
 * Water, Greens and Ice nodes (#238) on a map made before them, the next
 * time it's read, instead of a backfill job (CLAUDE.md rule 4). A new map
 * gets the same nodes when it's generated: both run shared `extraNodes` on
 * the map seed, rolled per tile. A tile with a building in its middle (a fire
 * on captured land) waits until the middle is free, since a node takes it,
 * and so does a tile a squishy gathers on: a node would change what its work
 * pays, cycles already finished included. Starting a job locks the tile the
 * same way (jobs `lockTiles`), so the check under the lock below holds.
 *
 * A future "cleared" mark (#242, clearing land to repurpose it) is one more
 * flag here: a tile the player cleared is filtered out with these two, so the
 * next read doesn't plant its node back.
 *
 * Cheap when there's nothing to add (one read). Otherwise one transaction:
 * the tiles it adds to (step 6, id order, the lock building takes), planned
 * again under the lock, so two readers or a retry add nothing twice. Nodes
 * are public map data, so nothing secret is written. Tutorial maps keep their
 * hand-made layout. Returns how many nodes it added.
 */
export async function seedExtraNodes(db: Executor, mapId: string): Promise<number> {
  const maps = createMapsRepo(db);
  const [map, stored, tiles] = await Promise.all([
    maps.findMap(mapId),
    createTerritoryRepo(db).mapSeed(mapId),
    maps.listNodelessTiles(mapId),
  ]);
  if (map?.kind !== 'multiplayer') return 0;
  // Hand-authored maps have no seed: key off the map id, as guardians do.
  const seed = stored ?? deriveSeed('hand-authored-map', mapId);
  const plan = (rows: typeof tiles) =>
    extraNodes(
      rows.filter((t) => !t.middleTaken && !t.worked),
      GAME_DATA.terrains,
      seed,
    );
  const first = plan(tiles);
  if (first.length === 0) return 0;
  const idAt = new Map(tiles.map((t) => [`${String(t.q)},${String(t.r)}`, t.id]));
  return maps.transaction(async (repo) => {
    const ids = first.flatMap((n) => idAt.get(`${String(n.q)},${String(n.r)}`) ?? []);
    const locked = await repo.listNodelessTiles(mapId, ids);
    let added = 0;
    for (const node of plan(locked)) {
      const id = locked.find((t) => t.q === node.q && t.r === node.r)?.id;
      if (id && ids.includes(id) && (await repo.addTileNode(id, node.resource))) added += 1;
    }
    return added;
  });
}
