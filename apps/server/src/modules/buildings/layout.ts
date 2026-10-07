import {
  HOME_BASE_RULES,
  buildsAtHome,
  fitsSlot,
  freeSpots,
  fuelCost,
  hearthfireState,
  spentOn,
  type ItemCounts,
  type MapLocalTime,
} from '@heartpatch/shared';
import type { Executor } from '../../db/client.js';
import type { NewGameEvent } from '../../db/game-events.js';
import { mapLocalTime, type Clock } from '../../lib/time.js';
import { grantItems, lockGrantRows } from '../inventory/service.js';
import { createMapsRepo } from '../maps/repo.js';
import { BUILDING_DATA, toPublicBuilding } from './hearthfire.js';
import { createBuildingsRepo, type BuildingRow, type HomeTileRow } from './repo.js';

/*
 * Homes built before the rules they live by now. Every boot runs this pass
 * (like the First Patch backfill); it's idempotent.
 *
 * - **Home fires pack up** (#202, owner decision 2026-10-07: the Heart Seed
 *   keeps home safe, so Hearthfires stand only on captured land). A fire on
 *   a home tile comes down with everything spent on it given back whole
 *   (build, upgrades and unburned fuel), and the player gets a one-time note
 *   in the morning report (`packed_home_fires`).
 * - **Typed spots** (#204): a ring building (a habitat, the Training
 *   Grounds) in a tile's middle moves to the first free ring spot on the same
 *   tile, keeping its level and residents. One with nowhere to go stays.
 *
 * One transaction per player, in the building commands' lock order: their
 * home tiles (step 6), the buildings (step 8, id order), the bag's rows
 * (step 11), the note, then `maps` for the events.
 */

/** Home tiles' middles hold the Heart Seed (the mean of the seven tiles). */
function isHeartSeed(tile: HomeTileRow, home: readonly HomeTileRow[]): boolean {
  const q = home.reduce((sum, t) => sum + t.q, 0) / home.length;
  const r = home.reduce((sum, t) => sum + t.r, 0) / home.length;
  return tile.q === q && tile.r === r;
}

/** Everything a packed-up home fire gives back: all it cost, and its unburned fuel. */
export function packUpRefund(row: BuildingRow, local: MapLocalTime): ItemCounts {
  const building = BUILDING_DATA.get(row.buildingId);
  if (!building) return {};
  const back: ItemCounts = spentOn(building, row.level);
  if (building.kind === 'hearthfire') {
    const { nightsLeft } = hearthfireState(row.fuelledThrough, local, HOME_BASE_RULES);
    if (nightsLeft > 0) {
      for (const [id, n] of Object.entries(fuelCost(building, nightsLeft))) {
        back[id] = (back[id] ?? 0) + n;
      }
    }
  }
  return back;
}

/** Does this home building break today's rules (a fire at home, or the wrong kind of spot)? */
const outOfPlace = (buildingId: string, spot: number): boolean => {
  const building = BUILDING_DATA.get(buildingId);
  return building !== undefined && (!buildsAtHome(building) || !fitsSlot(building.slot, spot));
};

/** What one pass did, for the boot log. */
export interface HomesTidied {
  readonly packed: number;
  readonly moved: number;
}

/**
 * Packs up home fires and moves misplaced home buildings, player by player.
 * A player whose pass fails is reported to `onError` and the rest go on.
 */
export async function relayoutHomes(
  db: Executor,
  clock: Clock,
  onError: (owner: { mapId: string; userId: string }, err: unknown) => void,
): Promise<HomesTidied> {
  const rows = await createBuildingsRepo(db).listPlacements();
  const owners = new Map<string, { mapId: string; userId: string }>();
  for (const row of rows) {
    if (row.homeSlot === null || !outOfPlace(row.buildingId, row.spot)) continue;
    owners.set(`${row.mapId}/${row.ownerUserId}`, { mapId: row.mapId, userId: row.ownerUserId });
  }
  let packed = 0;
  let moved = 0;
  for (const owner of owners.values()) {
    try {
      const done = await relayoutOne(db, clock, owner);
      packed += done.packed;
      moved += done.moved;
    } catch (err) {
      onError(owner, err);
    }
  }
  return { packed, moved };
}

/** One player's home, in one transaction. */
async function relayoutOne(
  db: Executor,
  clock: Clock,
  owner: { mapId: string; userId: string },
): Promise<HomesTidied> {
  return createBuildingsRepo(db).transaction(async (repo, tx) => {
    const home = await repo.lockHomeTiles(owner.mapId, owner.userId);
    if (home.length === 0) return { packed: 0, moved: 0 };
    const at = clock();
    const timeZone = (await createMapsRepo(tx).findMap(owner.mapId))?.timeZone ?? 'UTC';
    const local = mapLocalTime(at, timeZone);
    // Read again under the tile locks: a command or another boot may have
    // changed things since the scan.
    const homeIds = new Set(home.map((t) => t.id));
    const owned = await repo.listOwned(owner.mapId, owner.userId);
    const candidates = owned
      .filter((row) => homeIds.has(row.tileId) && outOfPlace(row.buildingId, row.spot))
      .sort((a, b) => (a.id < b.id ? -1 : 1));
    // Step 8, id order, before any grant or event.
    const locked: BuildingRow[] = [];
    for (const row of candidates) {
      const fresh = await repo.lockBuilding(row.id);
      if (fresh && fresh.tileId === row.tileId) locked.push(fresh);
    }

    const removed: NewGameEvent<'building.removed'>[] = [];
    const movedEvents: NewGameEvent<'building.moved'>[] = [];
    const refund: ItemCounts = {};
    for (const row of locked) {
      const building = BUILDING_DATA.get(row.buildingId);
      if (!building) continue;
      if (!buildsAtHome(building)) {
        const back = packUpRefund(row, local);
        for (const [id, n] of Object.entries(back)) refund[id] = (refund[id] ?? 0) + n;
        await repo.deleteBuilding(row.id);
        removed.push({
          mapId: owner.mapId,
          type: 'building.removed',
          actorUserId: null,
          payload: {
            userId: owner.userId,
            buildingRowId: row.id,
            buildingId: row.buildingId,
            q: row.q,
            r: row.r,
            refund: back,
            movedOut: [],
            lost: 'packed',
          },
        });
        continue;
      }
      const tile = home.find((t) => t.id === row.tileId);
      if (!tile || fitsSlot(building.slot, row.spot)) continue;
      const taken = new Set(
        owned.filter((b) => b.tileId === row.tileId && b.id !== row.id).map((b) => b.spot),
      );
      const features = { heartSeed: isHeartSeed(tile, home), nodeResource: tile.nodeResource };
      const to = freeSpots(HOME_BASE_RULES, features, taken, building.slot)[0];
      if (to === undefined) continue; // stays until its owner moves it
      await repo.moveBuilding(row.id, { tileId: row.tileId, spot: to });
      const mine = owned.find((b) => b.id === row.id);
      if (mine) mine.spot = to;
      movedEvents.push({
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
    // Step 11: everything back into the bag, the rows locked once in item-id order.
    const grants = Object.entries(refund).filter(([, n]) => n > 0);
    if (grants.length > 0) {
      const items = Object.fromEntries(grants);
      await lockGrantRows(tx, owner.mapId, [{ userId: owner.userId, items }]);
      await grantItems(
        tx,
        { mapId: owner.mapId, userId: owner.userId },
        items,
        'build-refund',
        removed[0]?.payload.buildingRowId,
      );
    }
    if (removed.length > 0) await repo.notePackedFires(owner.mapId, owner.userId, refund, at);
    for (const event of [...removed, ...movedEvents]) await repo.appendEvent(event);
    return { packed: removed.length, moved: movedEvents.length };
  });
}
