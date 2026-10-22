import {
  EXPLORE_RULES,
  GAME_DATA,
  JOB_RULES,
  inSeason,
  addDays,
  HOLLOW_RULES,
  upkeepMornings,
  paysUpkeep,
  productionCycleSeconds,
  productionProgress,
  productionSource,
  productionYield,
  storageCycles,
  type BuildingProduction,
  type ItemCounts,
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
import { mapLocalTime, instantOfLocal } from '../../lib/time.js';
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

/**
 * Does a resource building's land suit it (#601, owner decisions Q1, Q2)?
 * Its own terrain, or land cleared from it. (A spot on the tile still needs
 * clearing first: there is no beside-the-spot exception.)
 */
export function suitsLand(
  building: Pick<ResourceBuilding, 'terrain'>,
  land: { terrain: string; clearedFrom: string | null } | null,
): boolean {
  return (
    land !== null && (land.terrain === building.terrain || land.clearedFrom === building.terrain)
  );
}

/** A homestead's pause to leave out of the count (#199), or null. */
export const homesteadPauseOf = (row: Pick<BuildingRow, 'homestead'>): WorkPause | null =>
  row.homestead ? workPauseOf(row.homestead) : null;

/** A resource building's output at an instant. */
export interface ProductionAt {
  building: ResourceBuilding;
  level: ResourceBuildingLevel;
  source: ProductionSource;
  cycleSeconds: number;
  /** Its storage in cycles, or null while the Warehouse delivers (PR 8). */
  maxCycles: number | null;
  progress: WorkProgress;
  /** What the finished cycles make, each judged in its season. */
  ready: ItemCounts;
  homesteadPause: WorkPause | null;
}

/**
 * A resource building's output at `at`: finished cycles since
 * `produced_since`, stopped at full storage, at `paused_at`, and with a
 * cut-off homestead's stretch left out. Null for other kinds, or a row with
 * no count started.
 */
export function productionAt(row: BuildingRow, at: Date, timeZone: string): ProductionAt | null {
  const building = BUILDING_DATA.get(row.buildingId);
  if (building?.kind !== 'resource' || row.producedSince === null) return null;
  const level = levelOf(building.levels, row.level);
  const source = productionSource(building, JOB_RULES, EXPLORE_RULES);
  if (!level || !source) return null;
  const cycleSeconds = productionCycleSeconds(source.seconds, level, JOB_RULES);
  const maxCycles = storageCycles(level, cycleSeconds);
  const homesteadPause = homesteadPauseOf(row);
  const progress = productionProgress(
    {
      sinceMs: row.producedSince.getTime(),
      nowMs: at.getTime(),
      pausedAtMs: row.pausedAt?.getTime() ?? null,
      cycleSeconds,
      maxCycles,
      homesteadPause,
    },
    JOB_RULES,
  );
  const ready = productionYield(
    source,
    progress.finishedMs,
    GAME_DATA.resources,
    seasonsAtFor(timeZone),
  );
  return { building, level, source, cycleSeconds, maxCycles, progress, ready, homesteadPause };
}

/** A resource building's card for its owner (`MyBuilding.production`), or null for other kinds. */
export function productionView(
  row: BuildingRow,
  at: Date,
  timeZone: string,
): BuildingProduction | null {
  const made = productionAt(row, at, timeZone);
  if (!made) return null;
  const napping = row.homestead !== null && homesteadPauseOf(row)?.toMs === null;
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
    delivering: false,
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
): Promise<{ produced: Produced; event: NewGameEvent<'building.produced'> } | null> {
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
 * `productionAt` for a building banked without its mornings charged (#601:
 * lost land, a leave): output stops at the first morning it owes and could
 * work, as an unpaid one would have paused it. Nobody's Heart Coins are
 * taken there, so nothing past an unpaid morning is given either.
 */
export function productionBeforeUnpaid(
  row: BuildingRow,
  at: Date,
  timeZone: string,
): ProductionAt | null {
  if (row.pausedAt === null && upkeepOf(row) !== null) {
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
    if (owed) return productionAt({ ...row, pausedAt: owed }, at, timeZone);
  }
  return productionAt(row, at, timeZone);
}
