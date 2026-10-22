import { GAME_DATA, hexKey, keyMoveTo, type HexKey } from '@heartpatch/shared';
import { CELLAR_RULES } from '@heartpatch/shared/server';
import type { Executor } from '../../db/client.js';
import { createMapsRepo } from '../maps/repo.js';
import { createTerritoryRepo } from '../territory/repo.js';
import { communitiesTransaction, createCommunitiesRepo } from './repo.js';

/*
 * Keys hide only on wild land on a patch with no challenges (#306, owner
 * decision 2026-10-22). A hunt's key on someone else's claimed land there
 * (an older key, a claim since, or the patch's challenges switched off)
 * moves to the nearest wild tile (`keyMoveTo`), lazily, whenever its winner
 * looks: before their map view, their explore view and their search. The
 * winner's own claim never moves it. With no wild tile near enough it stays,
 * and land next to it is enough (`keyInReach`). A move is the winner's
 * secret (rule 6): no game event.
 *
 * Each move is its own transaction: the community row `FOR UPDATE` (step 6;
 * no tile is locked, the land is only read), re-checked under the lock, so
 * a second look that raced it moves nothing.
 */

/** Moves `userId`'s hunted keys off claimed land on a no-challenge patch; how many moved. */
export async function settleKeys(db: Executor, mapId: string, userId: string): Promise<number> {
  const map = await createMapsRepo(db).findMap(mapId);
  if (map?.pvpMode !== 'off') return 0;
  const repo = createCommunitiesRepo(db);
  const keys = await repo.keyTiles(mapId);
  const hunts = keys.filter((k) => k.ownerUserId === userId && !k.found);
  if (hunts.length === 0) return 0;
  const tiles = await createTerritoryRepo(db).listTiles(mapId);
  const byId = new Map(tiles.map((t) => [t.id, t]));
  const byKey = new Map(tiles.map((t) => [hexKey(t), t]));
  const taken = new Set<HexKey>(
    keys.flatMap((k) => {
      const t = byId.get(k.keyTileId);
      return t ? [hexKey(t)] : [];
    }),
  );
  let moved = 0;
  for (const hunt of hunts) {
    const key = byId.get(hunt.keyTileId);
    if (!key) continue;
    const to = keyMoveTo(key, tiles, userId, {
      pvpMode: map.pvpMode,
      range: CELLAR_RULES.keyMoveRange,
      taken,
      gapTerrain: GAME_DATA.mapGen.gapTerrain,
      excludedTerrains: GAME_DATA.mapGen.communities.excludedTerrains,
    });
    const target = to ? byKey.get(hexKey(to)) : undefined;
    if (!target) continue;
    const done = await communitiesTransaction(db, async (tx) => {
      const community = await tx.lockCommunity(hunt.communityId);
      if (
        !community ||
        community.ownerUserId !== userId ||
        community.keyRevealedAt !== null ||
        community.keyTileId !== hunt.keyTileId
      ) {
        return false;
      }
      await tx.moveKey(hunt.communityId, target.id);
      return true;
    });
    if (!done) continue;
    taken.delete(hexKey(key));
    taken.add(hexKey(target));
    moved++;
  }
  return moved;
}
