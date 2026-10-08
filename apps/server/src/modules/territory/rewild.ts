import type { GameEventPayload, LocalDate } from '@heartpatch/shared';
import type { Executor } from '../../db/client.js';
import type { NewGameEvent } from '../../db/game-events.js';
import { takeDownOnLostLand } from '../buildings/service.js';
import { takeDownFencesOnLostLand } from '../fences/service.js';
import { grantItems, lockGrantRows } from '../inventory/service.js';
import { createSquishyJobsRepo } from '../jobs/repo.js';
import { leaveWork } from '../jobs/service.js';
import type { MapRow } from '../maps/repo.js';
import { createTendingRepo, createTerritoryRepo, type TendingTileRow } from './repo.js';

/**
 * Land goes wild (#194's path, shared with the Hollow Man's reclaims, #277):
 * the tiles go back to neutral and their rows remember the night, guards go
 * home, fires and fences come down for their take-down share, gatherers
 * bank what they had ready and rest. The caller has locked the tiles (step
 * 6, id order) and their `tile_tending` rows and checked each is still its
 * owner's; this keeps the rest of tech spec §7's order (defenders, buildings,
 * fences, squishies, inventory). Returns the events to append (`maps` last).
 */
export async function rewildTiles(
  tx: Executor,
  map: MapRow,
  going: readonly TendingTileRow[],
  night: LocalDate,
  at: Date,
  cause: 'untended' | 'hollow',
): Promise<NewGameEvent[]> {
  if (going.length === 0) return [];
  const mapId = map.id;
  const repo = createTendingRepo(tx);
  const territory = createTerritoryRepo(tx);
  const byOwner = new Map<string, TendingTileRow[]>();
  for (const tile of going) {
    byOwner.set(tile.ownerUserId, [...(byOwner.get(tile.ownerUserId) ?? []), tile]);
  }
  const owned = [...byOwner].sort(([a], [b]) => (a < b ? -1 : 1));
  // Neutral now, remembering when: work and gathers finished before
  // then still go in the bag (jobs' `firstCaptureSince`).
  for (const [userId, list] of owned) {
    await repo.goWild(
      list.map((t) => t.id),
      userId,
      night,
      at,
    );
  }
  const returned = new Map<string, string[]>();
  for (const tile of going) {
    const guards = await territory.clearDefenders(tile.id);
    returned.set(tile.ownerUserId, [...(returned.get(tile.ownerUserId) ?? []), ...guards]);
  }
  // Fires on that land come down too (#202, step 8). What they give
  // back goes in their owners' bags with the gatherers' banking below,
  // the inventory rows locked together (step 11).
  const lostFires = await takeDownOnLostLand(
    tx,
    mapId,
    going.map((t) => t.id),
    at,
    map.timeZone,
    'wild',
  );
  for (const lost of lostFires) await repo.setLostFire(lost.tileId, lost.refund);
  // And their fence segments (#203, step 8 after the fires), for the
  // same take-down share back.
  const lostFences = await takeDownFencesOnLostLand(
    tx,
    mapId,
    going.map((t) => t.id),
    'wild',
  );
  const refunds = [
    ...lostFires.map((l) => ({
      userId: l.ownerUserId,
      items: l.refund,
      refId: l.event.payload.buildingRowId,
    })),
    ...lostFences.map((l) => ({ userId: l.ownerUserId, items: l.refund, refId: l.fenceId })),
  ].filter((r) => Object.keys(r.items).length > 0);
  // Gatherers bank what they had ready and rest (as when land changes hands).
  const workers = await repo.workersOn(going.map((t) => t.id));
  await createSquishyJobsRepo(tx).lockSquishies(workers);
  const events: NewGameEvent[] =
    workers.length > 0 ? await leaveWork(tx, map, workers, 'resting', at, refunds) : [];
  if (workers.length === 0) await lockGrantRows(tx, mapId, refunds);
  for (const { userId, items, refId } of refunds) {
    await grantItems(tx, { mapId, userId }, items, 'build-refund', refId);
  }
  events.push(...lostFires.map((l) => l.event), ...lostFences.map((l) => l.event));
  for (const [userId, list] of owned) {
    const payload: GameEventPayload<'tile.rewilded'> = {
      userId,
      night,
      tiles: list.map(({ q, r, terrain }) => ({ q, r, terrain })),
      returnedSquishyIds: returned.get(userId) ?? [],
      ...(cause === 'hollow' ? { cause } : {}),
    };
    events.push({ mapId, type: 'tile.rewilded', actorUserId: null, payload });
  }
  return events;
}
