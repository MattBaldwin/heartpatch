import { HOME_BASE_RULES, fitsSlot, freeSpots } from '@heartpatch/shared';
import type { Executor } from '../../db/client.js';
import type { NewGameEvent } from '../../db/game-events.js';
import { mapLocalTime, type Clock } from '../../lib/time.js';
import { BUILDING_DATA, toPublicBuilding } from './hearthfire.js';
import { createMapsRepo } from '../maps/repo.js';
import { createBuildingsRepo, type HomeTileRow } from './repo.js';

/*
 * Typed spots for homes built before them (#204). A building in a spot its
 * `slot` doesn't take is moved on its own tile:
 * - a ring building (a habitat, the Training Grounds) in the middle goes to
 *   the first free ring spot, keeping its level and residents;
 * - a light (a Hearthfire) on the ring goes to the middle if it's free, or
 *   stays where it is (grandfathered) until its owner moves it.
 * Idempotent, so every boot runs it (like the First Patch backfill): a moved
 * building fits its slot, and one that can't move is skipped again. One
 * transaction per player, in the building commands' lock order: their home
 * tiles, the building, then `maps` (`building.moved`).
 */

/** Home tiles' middles hold the Heart Seed (the mean of the seven tiles). */
function isHeartSeed(tile: HomeTileRow, home: readonly HomeTileRow[]): boolean {
  const q = home.reduce((sum, t) => sum + t.q, 0) / home.length;
  const r = home.reduce((sum, t) => sum + t.r, 0) / home.length;
  return tile.q === q && tile.r === r;
}

/**
 * Moves every misplaced home building it can. Returns how many moved; a
 * player whose move fails is reported to `onError` and the rest go on.
 */
export async function relayoutHomes(
  db: Executor,
  clock: Clock,
  onError: (owner: { mapId: string; userId: string }, err: unknown) => void,
): Promise<number> {
  const rows = await createBuildingsRepo(db).listPlacements();
  const misplaced = rows.filter((row) => {
    const slot = BUILDING_DATA.get(row.buildingId)?.slot;
    return slot !== undefined && !fitsSlot(slot, row.spot);
  });
  const owners = new Map<string, { mapId: string; userId: string }>();
  for (const row of misplaced) {
    owners.set(`${row.mapId}/${row.ownerUserId}`, { mapId: row.mapId, userId: row.ownerUserId });
  }
  let moved = 0;
  for (const owner of owners.values()) {
    try {
      moved += await relayoutOne(db, clock, owner);
    } catch (err) {
      onError(owner, err);
    }
  }
  return moved;
}

/** One player's home, in one transaction. */
async function relayoutOne(
  db: Executor,
  clock: Clock,
  owner: { mapId: string; userId: string },
): Promise<number> {
  return createBuildingsRepo(db).transaction(async (repo, tx) => {
    const home = await repo.lockHomeTiles(owner.mapId, owner.userId);
    if (home.length === 0) return 0;
    const timeZone = (await createMapsRepo(tx).findMap(owner.mapId))?.timeZone ?? 'UTC';
    // Read again under the tile locks: a building command or another boot
    // may have moved things since the scan.
    const owned = await repo.listOwned(owner.mapId, owner.userId);
    // Misplaced ones, locked in id order (step 8) before any event takes `maps`.
    const misplaced = owned
      .filter((row) => {
        const slot = BUILDING_DATA.get(row.buildingId)?.slot;
        return (
          slot !== undefined && !fitsSlot(slot, row.spot) && home.some((t) => t.id === row.tileId)
        );
      })
      .sort((a, b) => (a.id < b.id ? -1 : 1));
    const locked = [];
    for (const row of misplaced) {
      const fresh = await repo.lockBuilding(row.id);
      if (fresh) locked.push(fresh);
    }
    const events: NewGameEvent<'building.moved'>[] = [];
    const local = mapLocalTime(clock(), timeZone);
    for (const row of locked) {
      const building = BUILDING_DATA.get(row.buildingId);
      const tile = home.find((t) => t.id === row.tileId);
      if (!building || !tile || fitsSlot(building.slot, row.spot)) continue;
      const taken = new Set(
        owned.filter((b) => b.tileId === row.tileId && b.id !== row.id).map((b) => b.spot),
      );
      const features = { heartSeed: isHeartSeed(tile, home), nodeResource: tile.nodeResource };
      const to = freeSpots(HOME_BASE_RULES, features, taken, building.slot)[0];
      if (to === undefined) continue; // grandfathered until its owner moves it
      await repo.moveBuilding(row.id, { tileId: row.tileId, spot: to });
      const mine = owned.find((b) => b.id === row.id);
      if (mine) mine.spot = to;
      events.push({
        mapId: owner.mapId,
        type: 'building.moved',
        actorUserId: null,
        payload: {
          userId: owner.userId,
          from: { q: row.q, r: row.r, spot: row.spot },
          building: { ...toPublicBuilding({ ...row, spot: to }, local), q: row.q, r: row.r },
        },
      });
    }
    for (const event of events) await repo.appendEvent(event);
    const moved = events.length;
    return moved;
  });
}
