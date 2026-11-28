import { hexKey, isGenerator, needsPower, poweredSet, type WorkPause } from '@heartpatch/shared';
import type { Executor } from '../../db/client.js';
import type { NewGameEvent } from '../../db/game-events.js';
import { homesteadPauseOf } from '../buildings/production.js';
import { createBuildingsRepo, type BuildingRow } from '../buildings/repo.js';
import { createLinesRepo } from '../lines/repo.js';
import { createTerritoryRepo } from './repo.js';
import { mapPatchRules } from './supply.js';

/*
 * Who keeps power fresh (Clockwork Isle #874, plan R2.2). A `needsPower`
 * building's unpowered time is a timestamp (`buildings.unpowered_since`),
 * written in the same transaction as whatever changed it: a wire laid or
 * taken up, a generator or machine put up, moved or taken down, land won,
 * lost or gone wild. `refreshPower` takes **no lock of its own**: the
 * caller folds these owners' generator and `needsPower` rows into the one
 * id-ordered `buildings` lock its path already takes (tech spec §7 step 8),
 * then calls it inside that locked section.
 */

export interface RefreshPowerOptions {
  /** Rows being taken down in this transaction: they neither power nor need power. */
  exclude?: readonly string[];
}

/** `building.powered` / `building.unpowered` for one row. */
const powerEvent = (
  row: BuildingRow,
  type: 'building.powered' | 'building.unpowered',
): NewGameEvent<typeof type> => ({
  mapId: row.mapId,
  type,
  actorUserId: null,
  payload: { userId: row.ownerUserId, buildingRowId: row.id, q: row.q, r: row.r },
});

/** How much of `[fromMs, toMs)` a homestead cut-off (`WorkPause`) covers. */
function pausedWithin(fromMs: number, toMs: number, pause: WorkPause | null): number {
  if (!pause) return 0;
  return Math.max(0, Math.min(toMs, pause.toMs ?? Infinity) - Math.max(fromMs, pause.fromMs));
}

/**
 * Where a repowered building's count starts again (epoch ms): early enough
 * before `atMs` that its worked time from there to `atMs` equals the
 * worked time `W` it had from `sinceMs` to `offAtMs`, so a machine
 * unpowered at T1 and repowered at T2 banks exactly `[T0, T1) ∪ [T2, now)`.
 * Worked time leaves out its homestead's cut-off (`pause`, one interval,
 * open while it lasts), which `productionAt` cuts by absolute time. Closed
 * form: with no cut-off before `atMs`, or `W` fitting in the stretch after
 * it ends (`tail`), `atMs - W`; else the rest of `W` before the cut-off.
 */
export function repoweredSinceMs(
  sinceMs: number,
  offAtMs: number,
  atMs: number,
  pause: WorkPause | null,
): number {
  const worked = Math.max(0, offAtMs - sinceMs - pausedWithin(sinceMs, offAtMs, pause));
  if (!pause || pause.fromMs >= atMs) return atMs - worked;
  const tail = atMs - Math.min(pause.toMs ?? atMs, atMs);
  return worked <= tail ? atMs - worked : pause.fromMs - (worked - tail);
}

/**
 * A repowered row's new count start. An earlier stop (an upkeep pause, a
 * storm) owns the count and is left to its own wake. Known edge: a stop
 * that came while it was unpowered is not shifted with it; Clockwork rows
 * pay no upkeep and the isle has no weather, so neither happens there.
 */
function repoweredSince(row: BuildingRow, offAt: Date, at: Date): Date | null {
  if (row.producedSince === null) return null;
  const earlier = [row.pausedAt, row.damagedAt].some((d) => d !== null && d <= offAt);
  if (earlier) return row.producedSince;
  return new Date(
    repoweredSinceMs(
      row.producedSince.getTime(),
      offAt.getTime(),
      at.getTime(),
      homesteadPauseOf(row),
    ),
  );
}

/**
 * Works out these players' power (`poweredSet` from their land now, their
 * live wires and their standing generators) and writes each `needsPower`
 * row's `unpowered_since`: `at` when it lost power, cleared (its count
 * moved on past the gap) when it got it back, untouched otherwise. `at` is
 * the path's own instant, never a later `now()`. Returns the
 * `building.powered` / `building.unpowered` events to append. Nothing on a
 * patch with no power rules (Cozy and Wild). The caller holds these rows'
 * locks already (see above).
 */
export async function refreshPower(
  tx: Executor,
  mapId: string,
  userIds: readonly string[],
  at: Date,
  options: RefreshPowerOptions = {},
): Promise<NewGameEvent[]> {
  const rules = (await mapPatchRules(tx, mapId))?.power ?? null;
  const players = [...new Set(userIds)].sort();
  if (!rules || players.length === 0) return [];
  const gone = new Set(options.exclude ?? []);
  const buildings = createBuildingsRepo(tx);
  const [tiles, wires, rows] = await Promise.all([
    createTerritoryRepo(tx).listTiles(mapId),
    createLinesRepo(tx).listLive(mapId, 'wire'),
    buildings.listPowerRows({ mapId, userIds: players }),
  ]);
  const standing = rows.filter((r) => !gone.has(r.id));
  const generators = standing.filter((r) => isGenerator(r.buildingId));
  const events: NewGameEvent[] = [];
  for (const userId of players) {
    const powered = poweredSet(tiles, wires, generators, userId, rules);
    for (const row of standing) {
      if (row.ownerUserId !== userId || !needsPower(row.buildingId)) continue;
      const on = powered.has(hexKey(row));
      if (!on && row.unpoweredSince === null) {
        await buildings.setPower(row.id, { unpoweredSince: at });
        events.push(powerEvent(row, 'building.unpowered'));
      } else if (on && row.unpoweredSince !== null) {
        const offAt = row.unpoweredSince < at ? row.unpoweredSince : at;
        await buildings.setPower(row.id, {
          unpoweredSince: null,
          producedSince: repoweredSince(row, offAt, at),
        });
        events.push(powerEvent(row, 'building.powered'));
      }
    }
  }
  return events;
}

/**
 * For a path with no other `buildings` lock (a placement, a line command,
 * nightfall): locks these players' power rows (step 8, id order) and
 * refreshes their power. Nothing, and no lock, on a patch with no power.
 */
export async function lockAndRefreshPower(
  tx: Executor,
  mapId: string,
  userIds: readonly string[],
  at: Date,
): Promise<NewGameEvent[]> {
  if (!(await mapPatchRules(tx, mapId))?.power) return [];
  await createBuildingsRepo(tx).lockPowerRows({ mapId, userIds });
  return refreshPower(tx, mapId, userIds, at);
}
