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
  coverWindows,
  eatenBy,
  eatsCap,
  followsWeather,
  pacedProgress,
  worksPace,
  worksShort,
  worksWeatherAt,
  type WorksPace,
  worksSource,
  type BuildingProduction,
  type DeliveryWindow,
  type ItemCounts,
  type MyBuilding,
  type LocalDate,
  type ProductionSource,
  type ResourceBuilding,
  type ResourceBuildingLevel,
  type UpkeepBuilding,
  type WeatherFront,
  type WorkPause,
  type WorkProgress,
  type WorksBuilding,
} from '@heartpatch/shared';
import type { Executor } from '../../db/client.js';
import type { NewGameEvent } from '../../db/game-events.js';
import { mapLocalTime, instantOfLocal, localDate } from '../../lib/time.js';
import { consumeItems, grantItems, seasonsOn } from '../inventory/service.js';
import { createInventoryRepo } from '../inventory/repo.js';
import { frontsBetween, weatherMap } from '../weather/plans.js';
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
 *
 * Wild Isle works (#621 W1-8) produce the same way, from their own `makes`:
 * one whose pace follows the weather reads the stored fronts over its tile
 * (`worksFronts`, plain reads, never locked), and one that `eats` takes it
 * from its owner's bag when it banks (`bankOutput`, under the caller's
 * inventory lock), banking only the cycles the bag pays for. The Warehouse
 * never delivers for works.
 */

/** A row's building data when it pays a morning upkeep (resource, Warehouse or works), else null. */
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

/**
 * Where a building's output stops (epoch ms), or null while it works: the
 * morning it paused for upkeep (#601) or the instant a storm knocked it
 * about (Wild Isle #621), whichever came first.
 */
export function stoppedAtMs(row: Pick<BuildingRow, 'pausedAt' | 'damagedAt'>): number | null {
  const stops = [row.pausedAt, row.damagedAt].flatMap((d) => (d ? [d.getTime()] : []));
  return stops.length === 0 ? null : Math.min(...stops);
}

/** Knocked about by a storm at or before this instant (Wild Isle #621)? */
export const knockedAt = (row: Pick<BuildingRow, 'damagedAt'>, instantMs: number): boolean =>
  row.damagedAt !== null && row.damagedAt.getTime() <= instantMs;

/** The player's Warehouse among their buildings, or null. */
export const warehouseIn = (rows: readonly BuildingRow[]): BuildingRow | null =>
  rows.find((r) => r.kind === 'warehouse') ?? null;

/**
 * When the owner's Warehouse delivers for this building (#601 PR 8, owner
 * decision 2026-10-22): none below `warehouseDeliversFromLevel` or without
 * a Warehouse; else while it stood, paid and joined.
 */
export function deliveryOf(
  row: Pick<BuildingRow, 'level' | 'kind'>,
  warehouse: BuildingRow | null,
): DeliveryWindow[] {
  // Resource buildings only: a works keeps its own storage (#621 W1-8).
  if (row.kind !== 'resource') return [];
  if (!warehouse || row.level < RESOURCE_BUILDING_RULES.warehouseDeliversFromLevel) return [];
  return warehouseWindows({
    placedAtMs: warehouse.placedAt.getTime(),
    pausedAtMs: stoppedAtMs(warehouse),
    homesteadPause: homesteadPauseOf(warehouse),
  });
}

/** What a works building's output reads besides its row (#621 W1-8). */
export interface ProductionContext {
  /** The owner's map's fronts since its works' counts started (`worksFronts`), or null: clear skies. */
  readonly fronts?: readonly WeatherFront[] | null;
  /**
   * The owner's bag, to cap an eater's cycles by (`eatsCap`). Left out: no
   * cap (what it could make at most, for an inventory lock).
   */
  readonly bag?: Readonly<ItemCounts>;
}

/** A producing building's output at an instant: a resource building or a Wild Isle works. */
export interface ProductionAt {
  building: ResourceBuilding | WorksBuilding;
  level: ResourceBuildingLevel;
  source: ProductionSource;
  cycleSeconds: number;
  /** Its own storage in cycles, or null while the Warehouse delivers for it now. */
  maxCycles: number | null;
  progress: WorkProgress;
  /** What the finished cycles make, each judged in its season (an eater's capped by the bag given). */
  ready: ItemCounts;
  homesteadPause: WorkPause | null;
  /** What a works eats a cycle (#621 W1-8), or null. */
  eats: ItemCounts | null;
  /** A weather-paced works' pace on its tile (#621 W1-8), or null. */
  pace: WorksPace | null;
  /** What `ready` eats (`eats` × its cycles). */
  eaten: ItemCounts;
  /** Every item banking it can touch, for the caller's one inventory lock: made and eaten, uncapped. */
  touches: ItemCounts;
  /** What the first `cycles` finished cycles make (an eater banks only those the bag pays for). */
  yieldOf: (cycles: number) => ItemCounts;
}

/** A works building's pace on its tile from the fronts (#621 W1-8), or null when it ignores the weather. */
function paceOf(
  building: WorksBuilding,
  row: Pick<BuildingRow, 'q' | 'r'>,
  sinceMs: number,
  fronts: readonly WeatherFront[] | null | undefined,
) {
  if (!followsWeather(building)) return null;
  return worksPace(
    building,
    coverWindows(fronts ?? [], { q: row.q, r: row.r }, sinceMs, Number.MAX_SAFE_INTEGER),
  );
}

/**
 * A producing building's output at `at`: finished cycles since
 * `produced_since`, stopped at full storage, at `paused_at` (or a knock),
 * and with a cut-off homestead's stretch left out. While its owner's
 * `warehouse` delivers for it (level 3+ resource buildings, PR 8), nothing
 * caps it; from when the Warehouse stopped, its own storage does. A works
 * (#621 W1-8) paces by the weather in `ctx.fronts` and an eater's `ready`
 * is capped by `ctx.bag`. Null for other kinds, or a row with no count started.
 */
export function productionAt(
  row: BuildingRow,
  at: Date,
  timeZone: string,
  warehouse: BuildingRow | null,
  ctx: ProductionContext = {},
): ProductionAt | null {
  const building = BUILDING_DATA.get(row.buildingId);
  if ((building?.kind !== 'resource' && building?.kind !== 'works') || row.producedSince === null) {
    return null;
  }
  const level = levelOf(building.levels, row.level);
  const source =
    building.kind === 'works'
      ? worksSource(building)
      : productionSource(building, JOB_RULES, EXPLORE_RULES);
  if (!level || !source) return null;
  const cycleSeconds = productionCycleSeconds(source.seconds, level, JOB_RULES);
  const storage = storageCycles(level, cycleSeconds);
  const homesteadPause = homesteadPauseOf(row);
  const windows = deliveryOf(row, warehouse);
  const facts = {
    sinceMs: row.producedSince.getTime(),
    nowMs: at.getTime(),
    pausedAtMs: stoppedAtMs(row),
    cycleSeconds,
    maxCycles: storage,
    homesteadPause,
  };
  const pace = building.kind === 'works' ? paceOf(building, row, facts.sinceMs, ctx.fronts) : null;
  const progress = pace ? pacedProgress(facts, pace) : deliveredProgress(facts, windows, JOB_RULES);
  const yieldOf = (cycles: number) =>
    productionYield(
      source,
      progress.finishedMs.slice(0, Math.max(0, cycles)),
      GAME_DATA.resources,
      seasonsAtFor(timeZone),
    );
  const eats = building.kind === 'works' && building.eats ? { ...building.eats } : null;
  const paid = Math.min(progress.cycles, ctx.bag ? eatsCap(eats ?? undefined, ctx.bag) : Infinity);
  const ready = yieldOf(paid);
  // Every row its output or its eating could land on (a works might eat what it makes).
  const touches: ItemCounts = { ...yieldOf(progress.cycles) };
  for (const [id, n] of Object.entries(eatenBy(eats ?? undefined, progress.cycles))) {
    touches[id] = (touches[id] ?? 0) + n;
  }
  const maxCycles = deliveringAt(windows, at.getTime()) ? null : storage;
  return {
    building,
    level,
    source,
    cycleSeconds,
    maxCycles,
    progress,
    ready,
    homesteadPause,
    eats,
    pace,
    eaten: eatenBy(eats ?? undefined, paid),
    touches,
    yieldOf,
  };
}

/**
 * The fronts the owner's weather-paced works need (#621 W1-8): the stored
 * plans from the earliest such count's start to `at`, read without a lock
 * (tech spec §7: `weather_days` is inserted, never locked). Null, and no
 * query at all, when none of `rows` follows the weather (always on a Cozy
 * Patch); null too on a map with no weather.
 */
export async function worksFronts(
  tx: Executor,
  mapId: string,
  rows: readonly BuildingRow[],
  at: Date,
): Promise<WeatherFront[] | null> {
  const paced = rows.filter((r) => {
    const b = BUILDING_DATA.get(r.buildingId);
    return b?.kind === 'works' && followsWeather(b) && r.producedSince !== null;
  });
  if (paced.length === 0) return null;
  const map = await weatherMap(tx, mapId);
  if (!map) return null;
  const from = new Date(Math.min(...paced.map((r) => r.producedSince?.getTime() ?? at.getTime())));
  return frontsBetween(tx, map, from < at ? from : at, at);
}

/**
 * Banks producing rows in order, eaters last (#621 W1-8: a Greenhouse's
 * Greens land before a Watermill eats them).
 */
export function eatersLast<T extends Pick<BuildingRow, 'buildingId'>>(rows: readonly T[]): T[] {
  const eats = (r: T) => {
    const b = BUILDING_DATA.get(r.buildingId);
    return b?.kind === 'works' && b.eats !== undefined ? 1 : 0;
  };
  return [...rows].sort((a, b) => eats(a) - eats(b));
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
  ctx: ProductionContext = {},
): BuildingProduction | null {
  const made = productionAt(row, at, timeZone, warehouse, ctx);
  if (!made) return null;
  const napping = row.homestead !== null && homesteadPauseOf(row)?.toMs === null;
  const seasonEnd = seasonEndsAt(made.source.resource, at, timeZone);
  const weather =
    made.building.kind === 'works' && made.pace
      ? worksWeatherAt(made.building, made.pace, at.getTime())
      : null;
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
    // A Wild Isle works that eats (#621 W1-8): what each cycle takes from the bag.
    ...(made.eats ? { eats: made.eats } : {}),
    // The works tile card (#621 W1-10c): the weather's effect on its tile
    // now, and what the bag lacks for an eater's next cycle.
    ...(weather ? { weather } : {}),
    ...(made.eats && ctx.bag
      ? { short: worksShort(made.eats, ctx.bag, made.progress.cycles) }
      : {}),
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
        pausedAtMs: stoppedAtMs(row),
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
 * Q4)? Not while its homestead is cut off from home, not while a storm has
 * it knocked about (Wild Isle #621), and a resource building not while its
 * resource is out of season (a Pumpkin Barn after Halloween). Only a
 * building that can work pays.
 */
export function canWorkAt(row: BuildingRow, instant: Date, timeZone: string): boolean {
  const pause = homesteadPauseOf(row);
  const t = instant.getTime();
  if (knockedAt(row, t)) return false;
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
 * Banks a producing building's finished output into its owner's bag (ledger
 * reason `produced`, ref the row) inside the caller's transaction, after the
 * caller has locked the row (step 8) and the inventory rows its output can
 * touch (step 11, `made.touches`), and moves its count on: from where the
 * cycles stopped, or from now when it was full (time past full never pays).
 * A works that eats (#621 W1-8) banks only the cycles the bag holds enough
 * for, read here under that lock, and takes what they eat (ledger reason
 * `works-eat`); the rest it couldn't grind were idle and pay nothing. Returns
 * what landed and its `building.produced` event to append, or null when
 * nothing finished.
 */
export async function bankOutput(
  tx: Executor,
  row: BuildingRow,
  made: ProductionAt,
): Promise<Banked | null> {
  if (made.progress.cycles === 0) return null;
  const producedSince = new Date(made.progress.nextSinceMs);
  await createBuildingsRepo(tx).setProduction(row.id, { producedSince });
  const owner = { mapId: row.mapId, userId: row.ownerUserId };
  let ready = made.ready;
  if (made.eats) {
    const bag = await createInventoryRepo(tx).lockItems(owner, Object.keys(made.eats));
    const paid = Math.min(made.progress.cycles, eatsCap(made.eats, bag));
    ready = made.yieldOf(paid);
    const eaten = eatenBy(made.eats, paid);
    if (Object.keys(eaten).length > 0) {
      await consumeItems(tx, owner, eaten, 'works-eat', row.id);
    }
  }
  // A dormant Pumpkin Barn's cycles make nothing: the count still moves on.
  if (Object.keys(ready).length === 0) return null;
  await grantItems(tx, owner, ready, 'produced', row.id);
  const produced = {
    buildingRowId: row.id,
    buildingId: row.buildingId,
    q: row.q,
    r: row.r,
    items: ready,
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
  // A works that eats (#621 W1-8) banks nothing here: these paths grant
  // without taking from the bag, so it can't pay for a cycle (an empty bag).
  // One whose pace follows the weather counts at clear skies.
  return productionAt(
    withUnpaidPause(row, at, timeZone),
    at,
    timeZone,
    warehouse && withUnpaidPause(warehouse, at, timeZone),
    { bag: {} },
  );
}
