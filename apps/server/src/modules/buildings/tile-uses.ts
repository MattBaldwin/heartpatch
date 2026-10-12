import {
  HOME_BASE_RULES,
  freeSpots,
  heartSeedOf,
  planTileUses,
  type ItemCounts,
  type TileUsePlan,
  type TileUseTile,
} from '@heartpatch/shared';
import type { Executor } from '../../db/client.js';
import type { NewGameEvent } from '../../db/game-events.js';
import { mapLocalTime, type Clock } from '../../lib/time.js';
import { homesteadOf } from '../explore/homesteads.js';
import { createFactoryRepo } from '../factory/repo.js';
import { applyBatchPlans, planGrants, stopPlan } from '../factory/service.js';
import { grantItems, lockGrantRows } from '../inventory/service.js';
import { createSquishyJobsRepo } from '../jobs/repo.js';
import { landTraining, leaveWork, squishyName } from '../jobs/service.js';
import { BUILDING_DATA, toPublicBuilding } from './hearthfire.js';
import { packUpRefund } from './layout.js';
import {
  createBuildingsRepo,
  type BuildingRow,
  type BuildingsRepo,
  type TileUseNoteContent,
} from './repo.js';
import { createMapsRepo } from '../maps/repo.js';

/*
 * One building per tile (#295, owner decisions 2026-10-11): patches built
 * under the old rules get tidied once. Every boot runs this pass, like
 * `relayoutHomes`; it's idempotent, because a tidy home plans nothing.
 *
 * Per player (shared `planTileUses`): on a crowded tile a Hearthfire stays,
 * else the oldest building; the rest move to the nearest free tile they're
 * allowed on (home buildings within home, homestead buildings to an open
 * joined homestead); one with nowhere to go comes down with everything it
 * cost back (a Factory's batches too: made things kept, unfinished inputs
 * back). A building already on a resource spot stays (grandfathered).
 * Squishies gathering on a tile that keeps a building out on the land stop,
 * banking what they had ready (a building blocks its tile's yield). The
 * player gets a one-time note in the morning report (`tile_use_notes`).
 *
 * One transaction per player, in the building commands' lock order: every
 * tile they own (step 6, id order), the buildings that move or pack (step
 * 8, id order), a packing Factory's batches (step 8), the squishies it
 * touches (step 10, one id-ordered lock), the bag's rows (step 11, one
 * `lockGrantRows`), trainees' XP, the note, then `maps` for the events.
 * Tutorial maps are left alone.
 *
 * `tile-uses:check` (`src/ops/tile-uses-check.ts`) prints the same plans
 * without writing anything, for a dry run on a copy of live data.
 */

export interface TileUseOwner {
  readonly mapId: string;
  readonly userId: string;
}

/** What the pass would do for one player, read without locks (the dry run) or under them (the pass). */
export interface OwnerTileUses {
  readonly owner: TileUseOwner;
  readonly tiles: readonly TileUseTile[];
  readonly rows: readonly BuildingRow[];
  readonly plan: TileUsePlan;
  /** Squishies gathering on a tile out on the land that keeps a building: they stop. */
  readonly gatherers: readonly string[];
}

/** Does this plan change anything? */
export const tidies = (uses: Pick<OwnerTileUses, 'plan' | 'gatherers'>): boolean =>
  uses.plan.move.length + uses.plan.pack.length + uses.gatherers.length > 0;

/** One player's plan, read through `db` (the caller decides on locks). */
export async function planOwnerTileUses(db: Executor, owner: TileUseOwner): Promise<OwnerTileUses> {
  const repo = createBuildingsRepo(db);
  const [tileRows, rows] = await Promise.all([
    repo.listTileUseTiles(owner.mapId, owner.userId),
    repo.listOwned(owner.mapId, owner.userId),
  ]);
  const ownTiles: TileUseTile[] = tileRows.map(({ joinedAt, pausedAt, resumedAt, ...tile }) => ({
    ...tile,
    homestead: tile.homeSlot === null ? homesteadOf({ joinedAt, pausedAt, resumedAt }) : null,
  }));
  const plan = planTileUses(
    ownTiles,
    rows.map((r) => ({
      id: r.id,
      tileId: r.tileId,
      buildingId: r.buildingId,
      placedAt: r.placedAt.toISOString(),
    })),
    [...BUILDING_DATA.values()],
  );
  // Where every building stands after the plan, out on the land.
  const to = new Map(plan.move.map((m) => [m.id, m.toTileId]));
  const packed = new Set(plan.pack);
  const home = new Set(ownTiles.filter((t) => t.homeSlot !== null).map((t) => t.id));
  const built = [
    ...new Set(
      rows
        .filter((r) => !packed.has(r.id))
        .map((r) => to.get(r.id) ?? r.tileId)
        .filter((id) => !home.has(id)),
    ),
  ];
  const gatherers = await repo.gatherersOnTiles(owner.mapId, owner.userId, built);
  return { owner, tiles: ownTiles, rows, plan, gatherers };
}

/**
 * Players who might need tidying, on multiplayer maps: a tile with two or
 * more buildings, a building its placement doesn't allow where it stands
 * (home vs out on the land), or a squishy gathering on a tile out on the
 * land with a building. A cheap scan; each one's plan decides.
 */
export async function listTileUseOwners(
  db: Executor,
  mapIds?: readonly string[],
): Promise<TileUseOwner[]> {
  const scan = await createBuildingsRepo(db).scanTileUses();
  // Tests tidy only their own patches (they share one database).
  const keep = (row: { mapId: string }) => !mapIds || mapIds.includes(row.mapId);
  const rows = scan.rows.filter(keep);
  const working = scan.working.filter(keep);
  const owners = new Map<string, TileUseOwner>();
  const perTile = new Map<string, number>();
  for (const row of rows) perTile.set(row.tileId, (perTile.get(row.tileId) ?? 0) + 1);
  for (const row of rows) {
    const placement = BUILDING_DATA.get(row.buildingId)?.placement;
    const misplaced =
      placement !== undefined && placement !== 'owned' && (placement === 'home') !== row.home;
    if ((perTile.get(row.tileId) ?? 0) > 1 || misplaced) {
      owners.set(`${row.mapId}/${row.userId}`, { mapId: row.mapId, userId: row.userId });
    }
  }
  for (const w of working) owners.set(`${w.mapId}/${w.userId}`, w);
  return [...owners.values()].sort((a, b) =>
    a.mapId === b.mapId ? (a.userId < b.userId ? -1 : 1) : a.mapId < b.mapId ? -1 : 1,
  );
}

/** What one pass did, for the boot log. */
export interface TileUsesTidied {
  readonly players: number;
  readonly moved: number;
  readonly packed: number;
  readonly stopped: number;
}

/**
 * Tidies every player's buildings to one per tile. A player whose pass
 * fails is reported to `onError` and the rest go on; the next boot tries
 * again.
 */
export async function relayoutTileUses(
  db: Executor,
  clock: Clock,
  onError: (owner: TileUseOwner, err: unknown) => void,
  onTidied: (owner: TileUseOwner, done: Omit<TileUsesTidied, 'players'>) => void = () => {},
  /** Only these maps (tests, which share one database); every map when left out. */
  mapIds?: readonly string[],
): Promise<TileUsesTidied> {
  let players = 0;
  let moved = 0;
  let packed = 0;
  let stopped = 0;
  for (const owner of await listTileUseOwners(db, mapIds)) {
    try {
      const done = await tidyOne(db, clock, owner);
      if (done.moved + done.packed + done.stopped === 0) continue;
      players += 1;
      moved += done.moved;
      packed += done.packed;
      stopped += done.stopped;
      onTidied(owner, done);
    } catch (err) {
      onError(owner, err);
    }
  }
  return { players, moved, packed, stopped };
}

/** Adds `items` into `into`. */
function addInto(into: ItemCounts, items: ItemCounts): void {
  for (const [id, n] of Object.entries(items)) into[id] = (into[id] ?? 0) + n;
}

/** One player's tidy-up, in one transaction. */
async function tidyOne(
  db: Executor,
  clock: Clock,
  owner: TileUseOwner,
): Promise<Omit<TileUsesTidied, 'players'>> {
  return createBuildingsRepo(db).transaction(async (repo, tx) => {
    const none = { moved: 0, packed: 0, stopped: 0 };
    const at = clock();
    const jobs = createSquishyJobsRepo(tx);
    // Step 6: every tile I own, one id-ordered lock (a building may move to any of them).
    const tileIds = await repo.ownedTileIds(owner.mapId, owner.userId);
    await jobs.lockTiles(tileIds);
    const map = await createMapsRepo(tx).findMap(owner.mapId);
    if (!map || map.kind !== 'multiplayer') return none;
    // Planned again under the locks: a command may have changed things since the scan.
    const uses = await planOwnerTileUses(tx, owner);
    if (!tidies(uses)) return none;
    const { plan, rows, gatherers } = uses;
    const local = mapLocalTime(at, map.timeZone);
    const byId = new Map(rows.map((r) => [r.id, r]));
    const tileById = new Map(uses.tiles.map((t) => [t.id, t]));

    // Step 8: the buildings that move or pack, then a packing Factory's batches.
    const changing = [...plan.move.map((m) => m.id), ...plan.pack].sort();
    for (const id of changing) await repo.lockBuilding(id);
    const packing = plan.pack.flatMap((id) => {
      const row = byId.get(id);
      return row ? [row] : [];
    });
    const factory = createFactoryRepo(tx);
    const batches = [];
    for (const row of packing.filter((r) => r.kind === 'factory')) {
      for (const batch of await factory.lockRunningIn(row.id)) {
        batches.push(stopPlan(batch, at, 'taken-down'));
      }
    }

    // Step 10: every squishy this touches, one id-ordered lock: trainees of
    // Training Grounds that move or pack, residents of habitats that pack,
    // and gatherers that stop.
    const mine = await repo.listSquishies(owner.mapId, owner.userId);
    const movingIds = new Set(plan.move.map((m) => m.id));
    const packingIds = new Set(plan.pack);
    const trainees = (ids: ReadonlySet<string>) =>
      mine.filter((s) => s.trainingBuildingId !== null && ids.has(s.trainingBuildingId));
    const movedTrainees = trainees(movingIds).map((s) => s.id);
    const packedTrainees = trainees(packingIds).map((s) => s.id);
    const residents = mine
      .filter((s) => s.habitatBuildingId !== null && packingIds.has(s.habitatBuildingId))
      .map((s) => s.id);
    await jobs.lockSquishies(
      [...new Set([...movedTrainees, ...packedTrainees, ...residents, ...gatherers])].sort(),
    );

    // Step 11: the bag's rows once, the gatherers' banked work with the refund.
    const refund: ItemCounts = {};
    const packedEvents: NewGameEvent<'building.removed'>[] = [];
    for (const row of packing) {
      const back = packUpRefund(row, local);
      addInto(refund, back);
      packedEvents.push({
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
          movedOut: [
            ...residents.filter(
              (id) => mine.find((s) => s.id === id)?.habitatBuildingId === row.id,
            ),
            ...packedTrainees.filter(
              (id) => mine.find((s) => s.id === id)?.trainingBuildingId === row.id,
            ),
          ].sort(),
          lost: 'packed',
        },
      });
    }
    const alsoLock = [{ userId: owner.userId, items: refund }, ...planGrants(batches)];
    let workEvents: NewGameEvent[] = [];
    if (gatherers.length > 0) {
      workEvents = await leaveWork(tx, map, gatherers, 'resting', at, alsoLock);
    } else {
      await lockGrantRows(tx, owner.mapId, alsoLock);
    }
    if (Object.keys(refund).length > 0) {
      await grantItems(
        tx,
        { mapId: owner.mapId, userId: owner.userId },
        refund,
        'build-refund',
        packing[0]?.id,
      );
    }
    const stoppedBatches = await applyBatchPlans(tx, batches, at);

    // Trainees land what they earned: a packing Training Grounds' stop, a
    // moving one's carry on from where they are now.
    const training = [
      ...(packedTrainees.length > 0
        ? (await landTraining(tx, map, packedTrainees, at, true)).events
        : []),
      ...(movedTrainees.length > 0
        ? (await landTraining(tx, map, movedTrainees, at, false)).events
        : []),
    ];

    // The moves: the same row on a new tile, keeping its id, level,
    // residents, trainees, fuel and batches. A free spot of its slot (the
    // tile is empty, so one is always free).
    const seed = heartSeedOf(uses.tiles.filter((t) => t.homeSlot !== null));
    const movedEvents: NewGameEvent<'building.moved'>[] = [];
    const movedNote: {
      buildingId: string;
      from: { q: number; r: number };
      to: { q: number; r: number };
    }[] = [];
    for (const { id, toTileId } of plan.move) {
      const row = byId.get(id);
      const tile = tileById.get(toTileId);
      const building = row ? BUILDING_DATA.get(row.buildingId) : undefined;
      if (!row || !tile || !building) continue;
      const features = {
        heartSeed: seed !== null && tile.q === seed.q && tile.r === seed.r,
        nodeResource: tile.nodeResource,
      };
      const spot = freeSpots(HOME_BASE_RULES, features, new Set(), building.slot)[0] ?? 0;
      await repo.moveBuilding(row.id, { tileId: tile.id, spot });
      movedNote.push({
        buildingId: row.buildingId,
        from: { q: row.q, r: row.r },
        to: { q: tile.q, r: tile.r },
      });
      movedEvents.push({
        mapId: owner.mapId,
        type: 'building.moved',
        actorUserId: null,
        payload: {
          userId: owner.userId,
          from: { q: row.q, r: row.r, spot: row.spot },
          building: {
            ...toPublicBuilding({ ...row, tileId: tile.id, spot }, local),
            q: tile.q,
            r: tile.r,
          },
        },
      });
    }
    // The packed ones go, once their residents and trainees are off them.
    for (const row of packing) {
      if (row.kind === 'habitat') await repo.moveOutAll(row.id);
      await repo.deleteBuilding(row.id);
    }

    // The note, merged with any earlier one (a later rule change may tidy again).
    const names = new Map(mine.map((s) => [s.id, squishyName(s)]));
    await noteTileUses(repo, owner, at, {
      moved: movedNote,
      packed: packing.map((r) => ({ buildingId: r.buildingId, q: r.q, r: r.r })),
      refund: (() => {
        const all = { ...refund };
        for (const p of batches) {
          addInto(all, p.bank);
          addInto(all, p.refund);
        }
        return all;
      })(),
      stoppedGatherers: gatherers.map((id) => ({
        squishyId: id,
        name: names.get(id) ?? 'Your squishy',
      })),
    });

    // Not published live: it runs at boot, like `relayoutHomes`.
    for (const event of [
      ...workEvents,
      ...packedEvents,
      ...movedEvents,
      ...training,
      ...stoppedBatches.events,
    ]) {
      await repo.appendEvent(event);
    }
    return { moved: plan.move.length, packed: plan.pack.length, stopped: gatherers.length };
  });
}

/** Writes (or adds to) the player's tidy-up note. After the bag's rows, before `maps`. */
async function noteTileUses(
  repo: Pick<BuildingsRepo, 'tileUseNote' | 'setTileUseNote'>,
  owner: TileUseOwner,
  at: Date,
  note: TileUseNoteContent,
): Promise<void> {
  const earlier = await repo.tileUseNote(owner.mapId, owner.userId);
  const merged: TileUseNoteContent = earlier
    ? {
        moved: [...earlier.moved, ...note.moved],
        packed: [...earlier.packed, ...note.packed],
        refund: { ...earlier.refund },
        stoppedGatherers: [...earlier.stoppedGatherers, ...note.stoppedGatherers],
      }
    : { ...note, refund: {} };
  addInto(merged.refund, note.refund);
  await repo.setTileUseNote(owner.mapId, owner.userId, merged, at);
}
