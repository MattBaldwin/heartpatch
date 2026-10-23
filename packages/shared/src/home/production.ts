import type { ItemCounts } from '../gathering/index.js';
import { homesteadQuantity } from '../explore/index.js';
import {
  workFullAtMs,
  workProgressAround,
  workYield,
  type WorkPause,
  type WorkProgress,
  type WorkSource,
} from '../jobs/index.js';
import type {
  ResourceBuilding,
  ResourceBuildingLevel,
  ResourceBuildingRules,
} from '../schemas/data/buildings.js';
import type { ExploreRules } from '../schemas/data/explore.js';
import type { JobRules } from '../schemas/data/jobs.js';
import type { Resource } from '../schemas/data/resources.js';
import type { LocalDate } from '../schemas/time.js';
import { addDays, daysBetween } from './local-date.js';

// Resource buildings and the Warehouse (#601, owner decisions 2026-10-22):
// production as a pure function of timestamps (CLAUDE.md rule 4), and the
// morning upkeep plan. Every number comes from data; the server passes in
// the clock and the map-local dates, and `pnpm sim:patch-economy` runs the
// same maths. Nothing here ticks.

/** What a resource building makes on its tile, before its level's pace. */
export interface ProductionSource {
  resource: string;
  /** Per finished cycle, the homestead's +1 included. */
  perCycle: number;
  /** The Keeper-equivalent gather time of the land yield. */
  seconds: number;
}

/**
 * What a resource building works: its terrain's land yield
 * (`JOB_RULES.terrainYields`), and per cycle that yield's quantity on a
 * joined homestead (`homesteadQuantity`, the same +1 a squishy gets there;
 * a building only stands on a homestead, and a cut-off one is paused, not
 * smaller). Null if the terrain has no yield (`checkResourceBuildings`
 * refuses that data).
 */
export function productionSource(
  building: Pick<ResourceBuilding, 'terrain'>,
  rules: Pick<JobRules, 'terrainYields'>,
  explore: Pick<ExploreRules, 'homestead'>,
): ProductionSource | null {
  const land = rules.terrainYields.find((y) => y.terrain === building.terrain);
  if (!land) return null;
  return {
    resource: land.resource,
    perCycle: homesteadQuantity(land.quantity, explore),
    seconds: land.seconds,
  };
}

/**
 * Seconds per cycle at a level: a plain squishy gatherer's cycle (the
 * source's time × `cyclePercent`) at `pacePercent` of its pace. Whole-number
 * maths, floored, at least 1. Forest at 300 %: 15 min × 2 ÷ 3 = 10 min.
 */
export function productionCycleSeconds(
  sourceSeconds: number,
  level: Pick<ResourceBuildingLevel, 'pacePercent'>,
  rules: Pick<JobRules, 'work'>,
): number {
  return Math.max(1, Math.floor((sourceSeconds * rules.work.cyclePercent) / level.pacePercent));
}

/** How many finished cycles a level holds before it's full (at least 1). */
export function storageCycles(
  level: Pick<ResourceBuildingLevel, 'storageHours'>,
  cycleSeconds: number,
): number {
  return Math.max(1, Math.floor((level.storageHours * 3600) / cycleSeconds));
}

/** Where a resource building stands at `nowMs`. */
export interface ProductionFacts {
  /** When counting started: placed, or the last settle that banked it. */
  sinceMs: number;
  nowMs: number;
  /** Paused for unpaid upkeep at this instant (counts stop there), or null. */
  pausedAtMs: number | null;
  cycleSeconds: number;
  /** Its storage in cycles, or null while the Warehouse delivers for it (never full). */
  maxCycles: number | null;
  /** Its homestead cut off from home (#199): that stretch never counts. */
  homesteadPause: WorkPause | null;
}

/**
 * Finished cycles waiting at `nowMs` (the gatherer's maths, `workProgressAround`):
 * full storage stops it until the settle banks them, and then it counts
 * from the settle (time past full never pays); unpaid upkeep counts only
 * to `pausedAtMs`; a cut-off homestead's pause is left out. Uncapped while
 * the Warehouse delivers.
 */
export function productionProgress(
  facts: ProductionFacts,
  rules: Pick<JobRules, 'work'>,
): WorkProgress {
  const until = facts.pausedAtMs === null ? facts.nowMs : Math.min(facts.nowMs, facts.pausedAtMs);
  // Only the storage differs from a gatherer's: the building's own, or none.
  const work = { ...rules.work, maxStoredCycles: facts.maxCycles ?? Number.MAX_SAFE_INTEGER };
  const progress = workProgressAround(
    facts.sinceMs,
    Math.max(facts.sinceMs, until),
    facts.cycleSeconds,
    { work },
    facts.homesteadPause,
  );
  // Paused for upkeep: nothing more finishes until it wakes.
  return until < facts.nowMs ? { ...progress, nextReadyMs: null } : progress;
}

/**
 * When a building's storage fills (epoch ms, real time), with a cut-off
 * homestead's pause left out, or null while the Warehouse delivers for it.
 */
export function productionFullAtMs(
  facts: Pick<ProductionFacts, 'sinceMs' | 'cycleSeconds' | 'maxCycles' | 'homesteadPause'>,
  rules: Pick<JobRules, 'work'>,
): number | null {
  if (facts.maxCycles === null) return null;
  const work = { ...rules.work, maxStoredCycles: facts.maxCycles };
  return workFullAtMs(facts.sinceMs, facts.cycleSeconds, { work }, facts.homesteadPause);
}

/**
 * What finished cycles make: the source's resource per cycle while its
 * season is on (a Pumpkin Barn after Halloween makes nothing), plus its
 * in-season extras, each cycle judged when it finished (`workYield`).
 */
export function productionYield(
  source: ProductionSource,
  finishedMs: readonly number[],
  resources: readonly Resource[],
  seasonsAt: (ms: number) => ReadonlySet<string>,
): ItemCounts {
  const work: Pick<WorkSource, 'resource' | 'quantity'> = {
    resource: source.resource,
    quantity: source.perCycle,
  };
  return workYield(work, finishedMs, resources, seasonsAt);
}

/**
 * Where counting starts again when a building wakes from an upkeep pause
 * (owner decision: nothing is lost). Call it after a settle banked the
 * building up to its pause (`sinceMs` is that settle's `nextSinceMs`): a
 * part-done cycle carries on from where it stopped. A full one banked at the
 * pause (`sinceMs` at the pause) starts afresh. The part done is worked
 * time: a cut-off homestead's stretch before the pause (`homesteadPause`,
 * the one that settle used) never counts, as it never pays (#199). Pass
 * only later cut-offs to `productionProgress` after the wake.
 */
export function resumeSinceMs(
  sinceMs: number,
  pausedAtMs: number,
  wakeMs: number,
  homesteadPause: WorkPause | null,
): number {
  const span = Math.max(0, pausedAtMs - sinceMs);
  if (!homesteadPause) return wakeMs - span;
  const cutTo = Math.min(homesteadPause.toMs ?? pausedAtMs, pausedAtMs);
  const cut = Math.max(0, cutTo - Math.max(homesteadPause.fromMs, sinceMs));
  return wakeMs - Math.max(0, span - cut);
}

/** The Warehouse as one of its owner's resource buildings sees it. */
export interface WarehouseState {
  /** Unpaid upkeep: it doesn't deliver. */
  paused: boolean;
  /** Its homestead cut off from home: it doesn't deliver. */
  cutOff: boolean;
}

/**
 * Does the Warehouse deliver for a building at `level`? Only while one
 * stands, paid and joined, and only from `warehouseDeliversFromLevel` up
 * (owner decision 2026-10-22: level 3+). Lower levels keep their storage.
 */
export function warehouseDelivers(
  level: number,
  warehouse: WarehouseState | null,
  rules: Pick<ResourceBuildingRules, 'warehouseDeliversFromLevel'>,
): boolean {
  return (
    warehouse !== null &&
    !warehouse.paused &&
    !warehouse.cutOff &&
    level >= rules.warehouseDeliversFromLevel
  );
}

/** A stretch the Warehouse delivered in (epoch ms): from `fromMs` until `toMs`, or still going. */
export interface DeliveryWindow {
  fromMs: number;
  toMs: number | null;
}

/**
 * When a Warehouse delivered (owner decision 2026-10-22): from when it was
 * placed until it paused for unpaid upkeep (or still going), less the
 * stretch its homestead was cut off from home. Only its homestead's latest
 * cut-off is known (`workPauseOf`), as for gatherers; every settle banks
 * its owner's buildings, so an older one is long settled.
 */
export function warehouseWindows(facts: {
  placedAtMs: number;
  pausedAtMs: number | null;
  homesteadPause: WorkPause | null;
}): DeliveryWindow[] {
  const end = facts.pausedAtMs ?? Infinity;
  const cut = facts.homesteadPause;
  const spans: [number, number][] = cut
    ? [
        [facts.placedAtMs, Math.min(end, cut.fromMs)],
        [Math.max(facts.placedAtMs, cut.toMs ?? Infinity), end],
      ]
    : [[facts.placedAtMs, end]];
  return spans
    .filter(([from, to]) => from < to)
    .map(([fromMs, to]) => ({ fromMs, toMs: Number.isFinite(to) ? to : null }));
}

/** Is `ms` inside one of the windows? */
export const deliveringAt = (windows: readonly DeliveryWindow[], ms: number): boolean =>
  windows.some((w) => w.fromMs <= ms && (w.toMs === null || ms < w.toMs));

/**
 * `productionProgress` with the Warehouse (owner decision 2026-10-22): the
 * stretch from `sinceMs` to `nowMs` is cut where the Warehouse started or
 * stopped delivering, and each piece is worked out on its own, the part-done
 * cycle carried across. While it delivers, nothing caps the count (it goes
 * straight to the bag); otherwise the building's own storage (`maxCycles`)
 * does, starting empty, since what came before was delivered. So a Warehouse
 * pausing caps from that instant, and one built uncaps from then. With no
 * windows it's `productionProgress` itself.
 */
export function deliveredProgress(
  facts: ProductionFacts,
  windows: readonly DeliveryWindow[],
  rules: Pick<JobRules, 'work'>,
): WorkProgress {
  const cuts = [
    ...new Set(
      windows
        .flatMap((w) => [w.fromMs, w.toMs])
        .filter((ms): ms is number => ms !== null && ms > facts.sinceMs && ms < facts.nowMs),
    ),
  ].sort((a, b) => a - b);
  // One piece, from `fromMs` to `nowMs`, counting from `sinceMs`.
  const piece = (sinceMs: number, fromMs: number, nowMs: number) =>
    productionProgress(
      {
        ...facts,
        sinceMs,
        nowMs,
        maxCycles: deliveringAt(windows, fromMs) ? null : facts.maxCycles,
      },
      rules,
    );
  let sinceMs = facts.sinceMs;
  let fromMs = facts.sinceMs;
  const finishedMs: number[] = [];
  let cycles = 0;
  for (const nowMs of cuts) {
    const p = piece(sinceMs, fromMs, nowMs);
    cycles += p.cycles;
    finishedMs.push(...p.finishedMs);
    sinceMs = p.nextSinceMs;
    fromMs = nowMs;
  }
  const end = piece(sinceMs, fromMs, facts.nowMs);
  return {
    ...end,
    cycles: cycles + end.cycles,
    finishedMs: [...finishedMs, ...end.finishedMs],
  };
}

/** A map-local moment: a date and the minute of that day (0–1439). */
export interface LocalMoment {
  date: LocalDate;
  minute: number;
}

/** The latest morning at or before `at` (its map-local date). */
export function latestMorning(at: LocalMoment, morningMinute: number): LocalDate {
  return at.minute >= morningMinute ? at.date : addDays(at.date, -1);
}

/**
 * The mornings a building owes upkeep for, oldest first: those after
 * `settledThrough` (or the first morning after it was placed) up to the
 * latest morning at or before `now`. `settledThrough` is the last morning
 * already dealt with, whether it was paid, paused or skipped: the caller
 * moves it on past every morning `planUpkeep` returned, so a paused or
 * napping morning is never charged back (owner decision Q6). Map-local
 * dates, so a clock change never adds or drops one. Which of them it actually pays is `planUpkeep`'s call.
 */
export function upkeepMornings(
  facts: { placed: LocalMoment; settledThrough: LocalDate | null; now: LocalMoment },
  morningMinute: number,
): LocalDate[] {
  const first =
    facts.settledThrough !== null
      ? addDays(facts.settledThrough, 1)
      : facts.placed.minute < morningMinute
        ? facts.placed.date
        : addDays(facts.placed.date, 1);
  const last = latestMorning(facts.now, morningMinute);
  const count = daysBetween(first, last) + 1;
  return Array.from({ length: Math.max(0, count) }, (_, i) => addDays(first, i));
}

/** One of a player's upkeep buildings, as the morning charge sees it. */
export interface UpkeepEntry {
  /** Its `buildings` row id. */
  id: string;
  kind: 'resource' | 'warehouse';
  level: number;
  /** Heart Coins a morning at its level. */
  upkeep: number;
  placedAtMs: number;
  /** The kid's own order (owner decision Q5: lower first), or null if not set. */
  rank: number | null;
}

/**
 * The order upkeep is charged in when Heart Coins run short (owner decision
 * Q5): the kid's own order first (lower rank first); then, for any building
 * without one, the default: highest level first, then the oldest, the
 * Warehouse last. Ties end on the row id, so the order is total.
 */
export function upkeepOrder<T extends UpkeepEntry>(entries: readonly T[]): T[] {
  const byDefault = (a: T, b: T) =>
    Number(a.kind === 'warehouse') - Number(b.kind === 'warehouse') ||
    b.level - a.level ||
    a.placedAtMs - b.placedAtMs ||
    (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  return [...entries].sort((a, b) => {
    if (a.rank !== null && b.rank !== null) return a.rank - b.rank || byDefault(a, b);
    if (a.rank !== null) return -1;
    if (b.rank !== null) return 1;
    return byDefault(a, b);
  });
}

/** What one building does at one morning. */
export type UpkeepStep =
  | { kind: 'paid'; id: string; day: LocalDate; coins: number }
  | { kind: 'paused'; id: string; day: LocalDate }
  /** It couldn't work that morning (cut off, out of season, paused already): it owes nothing. */
  | { kind: 'skipped'; id: string; day: LocalDate };

/** A player's buildings for `planUpkeep`, in `upkeepOrder`. */
export interface UpkeepPlanEntry extends UpkeepEntry {
  /** Paused for upkeep already (owes nothing until it resumes). */
  paused: boolean;
  /** The mornings it owes, oldest first (`upkeepMornings`). */
  mornings: readonly LocalDate[];
  /** Could it work at that morning? (Not cut off; a seasonal one in season.) */
  canWork: (day: LocalDate) => boolean;
}

export interface UpkeepPlan {
  steps: UpkeepStep[];
  /** The balance after every payment. */
  balance: number;
}

/**
 * Morning upkeep (owner decisions 2026-10-22, Q4–Q6), charged lazily: each
 * morning in date order, each building in charge order. A building that
 * can't work that morning, or is paused already, owes nothing. One the
 * balance covers pays; one it doesn't pauses at that morning (nothing is
 * lost, and there's no debt), and the next one in the order still pays if
 * the balance covers it. A paused building stays paused for the later
 * mornings until `planResume` wakes it.
 */
export function planUpkeep(balance: number, entries: readonly UpkeepPlanEntry[]): UpkeepPlan {
  const steps: UpkeepStep[] = [];
  const paused = new Set(entries.filter((e) => e.paused).map((e) => e.id));
  const days = [...new Set(entries.flatMap((e) => e.mornings))].sort((a, b) =>
    a < b ? -1 : a > b ? 1 : 0,
  );
  let left = balance;
  for (const day of days) {
    for (const e of entries) {
      if (!e.mornings.includes(day)) continue;
      if (paused.has(e.id) || !e.canWork(day)) {
        steps.push({ kind: 'skipped', id: e.id, day });
      } else if (left >= e.upkeep) {
        left -= e.upkeep;
        steps.push({ kind: 'paid', id: e.id, day, coins: e.upkeep });
      } else {
        paused.add(e.id);
        steps.push({ kind: 'paused', id: e.id, day });
      }
    }
  }
  return { steps, balance: left };
}

/**
 * Which paused buildings wake (owner decision Q6): in charge order, each one
 * whose morning the balance still covers, counting the ones woken before it.
 * Waking is free: the next morning charges as usual.
 */
export function planResume<T extends Pick<UpkeepEntry, 'id' | 'upkeep'>>(
  balance: number,
  paused: readonly T[],
): T[] {
  let left = balance;
  const woken: T[] = [];
  for (const e of paused) {
    if (left < e.upkeep) continue;
    left -= e.upkeep;
    woken.push(e);
  }
  return woken;
}
