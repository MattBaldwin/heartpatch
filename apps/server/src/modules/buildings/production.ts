import {
  EXPLORE_RULES,
  GAME_DATA,
  JOB_RULES,
  RESOURCE_BUILDING_RULES,
  inSeason,
  addDays,
  HOLLOW_RULES,
  upkeepMornings,
  paysUpkeep,
  deliveredProgress,
  deliveringAt,
  productionCycleSeconds,
  productionSource,
  productionYield,
  storageCycles,
  warehouseWindows,
  type BuildingProduction,
  type DeliveryWindow,
  type ItemCounts,
  type MyBuilding,
  type LocalDate,
  type ProductionSource,
  type ResourceBuilding,
  type ResourceBuildingLevel,
  type UpkeepBuilding,
  type WorkPause,
  type WorkProgress,
} from '@heartpatch/shared';
import type { Executor } from '../../db/client.js';
import type { NewGameEvent } from '../../db/game-events.js';
import { mapLocalTime, instantOfLocal, localDate } from '../../lib/time.js';
import { grantItems, seasonsOn } from '../inventory/service.js';
import { workPauseOf } from '../explore/homesteads.js';
import { seasonsAtFor } from '../jobs/work.js';
import { BUILDING_DATA } from './hearthfire.js';
import { createBuildingsRepo, type BuildingRow } from './repo.js';

/*
 * Resource buildings on the server (#601, owner decisions 2026-10-22): the
 * shared production maths (`home/production.ts`) read from a stored row at
 * an instant (CLAUDE.md rule 4). Nothing ticks: `produced_since`,
 * `paused_at` and the owner's homestead flags are all it needs, and the
 * settle, the take-down and lost land bank what it says.
 */

/** A row's building data when it pays a morning upkeep (resource or Warehouse), else null. */
export function upkeepBuildingOf(row: Pick<BuildingRow, 'buildingId'>): UpkeepBuilding | null {
  const building = BUILDING_DATA.get(row.buildingId);
  return building && paysUpkeep(building) ? building : null;
}

/** A row's level data, clamped to the levels it has. */
function levelOf<T>(levels: readonly T[], level: number): T | undefined {
  return levels[Math.min(level, levels.length) - 1];
}

/** Heart Coins a morning for an upkeep building at its level, or null for other kinds. */
export function upkeepOf(row: Pick<BuildingRow, 'buildingId' | 'level'>): number | null {
  const building = upkeepBuildingOf(row);
  if (!building) return null;
  return levelOf<{ upkeep: number }>(building.levels, row.level)?.upkeep ?? null;
}

/** A homestead's pause to leave out of the count (#199), or null. */
export const homesteadPauseOf = (row: Pick<BuildingRow, 'homestead'>): WorkPause | null =>
  row.homestead ? workPauseOf(row.homestead) : null;

/** The player's Warehouse among their buildings, or null. */
export const warehouseIn = (rows: readonly BuildingRow[]): BuildingRow | null =>
  rows.find((r) => r.kind === 'warehouse') ?? null;

/**
 * When the owner's Warehouse delivers for this building (#601 PR 8, owner
 * decision 2026-10-22): none below `warehouseDeliversFromLevel` or without
 * a Warehouse; else while it stood, paid and joined.
 */
export function deliveryOf(
  row: Pick<BuildingRow, 'level'>,
  warehouse: BuildingRow | null,
): DeliveryWindow[] {
  if (!warehouse || row.level < RESOURCE_BUILDING_RULES.warehouseDeliversFromLevel) return [];
  return warehouseWindows({
    placedAtMs: warehouse.placedAt.getTime(),
    pausedAtMs: warehouse.pausedAt?.getTime() ?? null,
    homesteadPause: homesteadPauseOf(warehouse),
  });
}

/** A resource building's output at an instant. */
export interface ProductionAt {
  building: ResourceBuilding;
  level: ResourceBuildingLevel;
  source: ProductionSource;
  cycleSeconds: number;
  /** Its own storage in cycles, or null while the Warehouse delivers for it now. */
  maxCycles: number | null;
  progress: WorkProgress;
  /** What the finished cycles make, each judged in its season. */
  ready: ItemCounts;
  homesteadPause: WorkPause | null;
}

/**
 * A resource building's output at `at`: finished cycles since
 * `produced_since`, stopped at full storage, at `paused_at`, and with a
 * cut-off homestead's stretch left out. While its owner's `warehouse`
 * delivers for it (level 3+, PR 8), nothing caps it; from when the Warehouse
 * stopped, its own storage does. Null for other kinds, or a row with no
 * count started.
 */
export function productionAt(
  row: BuildingRow,
  at: Date,
  timeZone: string,
  warehouse: BuildingRow | null,
): ProductionAt | null {
  const building = BUILDING_DATA.get(row.buildingId);
  if (building?.kind !== 'resource' || row.producedSince === null) return null;
  const level = levelOf(building.levels, row.level);
  const source = productionSource(building, JOB_RULES, EXPLORE_RULES);
  if (!level || !source) return null;
  const cycleSeconds = productionCycleSeconds(source.seconds, level, JOB_RULES);
  const storage = storageCycles(level, cycleSeconds);
  const homesteadPause = homesteadPauseOf(row);
  const windows = deliveryOf(row, warehouse);
  const progress = deliveredProgress(
    {
      sinceMs: row.producedSince.getTime(),
      nowMs: at.getTime(),
      pausedAtMs: row.pausedAt?.getTime() ?? null,
      cycleSeconds,
      maxCycles: storage,
      homesteadPause,
    },
    windows,
    JOB_RULES,
  );
  const ready = productionYield(
    source,
    progress.finishedMs,
    GAME_DATA.resources,
    seasonsAtFor(timeZone),
  );
  const maxCycles = deliveringAt(windows, at.getTime()) ? null : storage;
  return { building, level, source, cycleSeconds, maxCycles, progress, ready, homesteadPause };
}

/**
 * When a seasonal resource's season ends after `at` (the start of its first
 * map-local day out of season), or null for one with no season or out of
 * season at `at`. Seasons are whole days, so it walks day by day.
 */
export function seasonEndsAt(resourceId: string, at: Date, timeZone: string): Date | null {
  const resource = GAME_DATA.resources.find((r) => r.id === resourceId);
  if (!resource?.season) return null;
  const today = localDate(at, timeZone);
  const onDay = (day: LocalDate) =>
    inSeason(resource, new Set(seasonsOn(morningAt(day, 12 * 60, timeZone), timeZone)));
  if (!onDay(today)) return null;
  // A season runs at most a year.
  for (let n = 1; n <= 366; n += 1) {
    const day = addDays(today, n);
    if (!onDay(day)) return morningAt(day, 0, timeZone);
  }
  return null;
}

/** A resource building's card for its owner (`MyBuilding.production`), or null for other kinds. */
export function productionView(
  row: BuildingRow,
  at: Date,
  timeZone: string,
  warehouse: BuildingRow | null,
): BuildingProduction | null {
  const made = productionAt(row, at, timeZone, warehouse);
  if (!made) return null;
  const napping = row.homestead !== null && homesteadPauseOf(row)?.toMs === null;
  const seasonEnd = seasonEndsAt(made.source.resource, at, timeZone);
  return {
    resource: made.source.resource,
    perCycle: made.source.perCycle,
    cycleSeconds: made.cycleSeconds,
    ready: made.ready,
    cycles: made.progress.cycles,
    maxCycles: made.maxCycles,
    full: made.progress.full,
    nextReadyAt:
      made.progress.nextReadyMs === null || napping
        ? null
        : new Date(made.progress.nextReadyMs).toISOString(),
    upkeep: made.level.upkeep,
    paidThrough: row.upkeepPaidThrough,
    pausedAt: row.pausedAt?.toISOString() ?? null,
    upkeepRank: row.upkeepRank,
    // Only while it works: one asleep for its own upkeep, cut off or out of
    // season sends nothing.
    delivering: made.maxCycles === null && row.pausedAt === null && canWorkAt(row, at, timeZone),
    nextMorningAt: nextMorningAt(at, HOLLOW_RULES.morningMinute, timeZone).toISOString(),
    seasonEndsAt: seasonEnd?.toISOString() ?? null,
  };
}

/** The Warehouse's card for its owner (`MyBuilding.warehouse`), or null for other kinds. */
export function warehouseView(row: BuildingRow, at: Date): MyBuilding['warehouse'] {
  if (row.kind !== 'warehouse') return null;
  const now = at.getTime();
  const cut = homesteadPauseOf(row);
  return {
    delivering: deliveringAt(
      warehouseWindows({
        placedAtMs: row.placedAt.getTime(),
        pausedAtMs: row.pausedAt?.getTime() ?? null,
        homesteadPause: cut,
      }),
      now,
    ),
    fromLevel: RESOURCE_BUILDING_RULES.warehouseDeliversFromLevel,
    napping: cut !== null && cut.fromMs <= now && (cut.toMs === null || now < cut.toMs),
    upkeep: upkeepOf(row) ?? 0,
    paidThrough: row.upkeepPaidThrough,
    pausedAt: row.pausedAt?.toISOString() ?? null,
    upkeepRank: row.upkeepRank,
  };
}

/** The instant a map-local morning starts (`HOLLOW_RULES.morningMinute`) on `day`. */
export function morningAt(day: LocalDate, morningMinute: number, timeZone: string): Date {
  // Near enough for `instantOfLocal`'s two-day search: UTC is within 14 hours.
  const near = new Date(Date.parse(`${day}T00:00:00Z`) + morningMinute * 60_000);
  return instantOfLocal({ date: day, minute: morningMinute }, timeZone, near);
}

/** The next morning after `at` (its instant). */
export function nextMorningAt(at: Date, morningMinute: number, timeZone: string): Date {
  const local = mapLocalTime(at, timeZone);
  const today = morningAt(local.date, morningMinute, timeZone);
  if (today.getTime() > at.getTime()) return today;
  return morningAt(addDays(local.date, 1), morningMinute, timeZone);
}

/**
 * Could an upkeep building work at that morning's instant (owner decision
 * Q4)? Not while its homestead is cut off from home, and a resource
 * building not while its resource is out of season (a Pumpkin Barn after
 * Halloween). Only a building that can work pays.
 */
export function canWorkAt(row: BuildingRow, instant: Date, timeZone: string): boolean {
  const pause = homesteadPauseOf(row);
  const t = instant.getTime();
  if (pause && pause.fromMs <= t && (pause.toMs === null || t < pause.toMs)) return false;
  const building = BUILDING_DATA.get(row.buildingId);
  if (building?.kind !== 'resource') return true;
  const source = productionSource(building, JOB_RULES, EXPLORE_RULES);
  const resource = GAME_DATA.resources.find((r) => r.id === source?.resource);
  return resource ? inSeason(resource, new Set(seasonsOn(instant, timeZone))) : false;
}

/** One building's output that landed (`SettleResponse.produced`). */
export interface Produced {
  buildingRowId: string;
  buildingId: string;
  q: number;
  r: number;
  items: ItemCounts;
}

/** What `bankOutput` landed, and its event to append. */
export interface Banked {
  produced: Produced;
  event: NewGameEvent<'building.produced'>;
}

/**
 * Banks a resource building's finished output into its owner's bag (ledger
 * reason `produced`, ref the row) inside the caller's transaction, after the
 * caller has locked the row (step 8) and the inventory rows (step 11), and
 * moves its count on: from where the cycles stopped, or from now when it was
 * full (time past full never pays). Returns what landed and its
 * `building.produced` event to append, or null when nothing finished.
 */
export async function bankOutput(
  tx: Executor,
  row: BuildingRow,
  made: ProductionAt,
): Promise<Banked | null> {
  if (made.progress.cycles === 0) return null;
  const producedSince = new Date(made.progress.nextSinceMs);
  await createBuildingsRepo(tx).setProduction(row.id, { producedSince });
  // A dormant Pumpkin Barn's cycles make nothing: the count still moves on.
  if (Object.keys(made.ready).length === 0) return null;
  const owner = { mapId: row.mapId, userId: row.ownerUserId };
  await grantItems(tx, owner, made.ready, 'produced', row.id);
  const produced = {
    buildingRowId: row.id,
    buildingId: row.buildingId,
    q: row.q,
    r: row.r,
    items: made.ready,
  };
  return {
    produced,
    event: {
      mapId: row.mapId,
      type: 'building.produced',
      actorUserId: row.ownerUserId,
      payload: { userId: row.ownerUserId, ...produced },
    },
  };
}

/**
 * A row as if its first unpaid morning had paused it (#601: lost land, a
 * leave): the first morning it owes and could work, as an unpaid one would
 * have. Itself when it's paused already or pays no upkeep.
 */
export function withUnpaidPause(row: BuildingRow, at: Date, timeZone: string): BuildingRow {
  if (row.pausedAt !== null || upkeepOf(row) === null) return row;
  const minute = HOLLOW_RULES.morningMinute;
  const owed = upkeepMornings(
    {
      placed: mapLocalTime(row.placedAt, timeZone),
      settledThrough: row.upkeepPaidThrough,
      now: mapLocalTime(at, timeZone),
    },
    minute,
  )
    .map((day) => morningAt(day, minute, timeZone))
    .find((instant) => canWorkAt(row, instant, timeZone));
  return owed ? { ...row, pausedAt: owed } : row;
}

/**
 * `productionAt` for a building banked without its mornings charged (#601:
 * lost land, a leave): output stops at the first morning it owes and could
 * work, as an unpaid one would have paused it, and the Warehouse delivers
 * only up to its own. Nobody's Heart Coins are taken there, so nothing past
 * an unpaid morning is given either.
 */
export function productionBeforeUnpaid(
  row: BuildingRow,
  at: Date,
  timeZone: string,
  warehouse: BuildingRow | null,
): ProductionAt | null {
  return productionAt(
    withUnpaidPause(row, at, timeZone),
    at,
    timeZone,
    warehouse && withUnpaidPause(warehouse, at, timeZone),
  );
}
