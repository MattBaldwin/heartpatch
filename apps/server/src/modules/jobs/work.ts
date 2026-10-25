import {
  EXPLORE_RULES,
  GAME_DATA,
  gameplayOverrides,
  homesteadQuantity,
  JOB_RULES,
  roadSpeedPercent,
  trainingProgressAround,
  TRAVEL_RULES,
  workCycleSeconds,
  workProgressAround,
  workSource,
  workSpeedPercent,
  workYield,
  type JobTraits,
  type OwnedSquishy,
} from '@heartpatch/shared';
import { SERVER_GAME_DATA } from '@heartpatch/shared/server';
import type { BuildingRow } from '../buildings/repo.js';
import { homesteadOf, workPauseOf } from '../explore/homesteads.js';
import { seasonsOn } from '../inventory/service.js';
import type { MapRow } from '../maps/repo.js';
import type { JobRow } from './repo.js';

// A squishy's job worked out from its stored row at an instant (CLAUDE.md
// rule 4): a gatherer's cycles and a trainee's XP. The jobs service and the
// contentment checkpoint (#376) both read it, so they never disagree.

const SPECIES = new Map(
  [...GAME_DATA.species, ...SERVER_GAME_DATA.secretSpecies].map((s) => [s.id, s]),
);

/** What to call one of my squishies in a message: its nickname, else its species. */
export const squishyName = (s: Pick<OwnedSquishy, 'nickname' | 'speciesId'>): string =>
  s.nickname ?? SPECIES.get(s.speciesId)?.name ?? 'Your squishy';

/** The job rules' view of a squishy: element, feeling, and its species' season. */
export const traitsOf = (s: OwnedSquishy): JobTraits => ({
  element: s.element,
  feeling: s.feeling,
  season: SPECIES.get(s.speciesId)?.season,
});

/** The map as the job rules need it. */
export type JobMap = Pick<MapRow, 'id' | 'kind' | 'timeZone'>;

/** Seasons on at an instant on this map (each cycle is judged when it finished). */
export const seasonsAtFor = (timeZone: string) => (ms: number) =>
  new Set(seasonsOn(new Date(ms), timeZone));

/**
 * A gatherer's work at `at`: what, how quick, and what's ready. Null if it
 * isn't at work. `justTaken`: it went to the Hollow in this transaction, and
 * its work up to now still counts.
 */
export function workAt(row: JobRow, map: JobMap, at: Date, justTaken = false) {
  const active = row.squishy.state === 'active' || justTaken;
  if (!row.atWork || !active || !row.workTile || !row.workSince) return null;
  const found = workSource(row.workTile, GAME_DATA.resources, JOB_RULES);
  if (!found) return null;
  // A homestead (#199): +1 a cycle while it's joined to home, and nothing
  // while it's cut off (the pause is left out of the count).
  const homestead = row.workTile.homestead ?? null;
  const source =
    homesteadOf(homestead) === 'joined'
      ? { ...found, quantity: homesteadQuantity(found.quantity, EXPLORE_RULES) }
      : found;
  // A road of its owner's on the tile (Wild Isle #621) quickens it. Read at
  // the instant like the homestead bonus: a road laid mid-gather counts for
  // the whole unbanked stretch.
  const road = roadSpeedPercent(row.workTile.roadLevel ?? null, TRAVEL_RULES);
  const speedPercent = workSpeedPercent(
    traitsOf(row.squishy),
    source.resource,
    JOB_RULES,
    road === null ? [] : [road],
  );
  const cycleSeconds = workCycleSeconds(
    source.seconds,
    speedPercent,
    JOB_RULES,
    gameplayOverrides(map.kind),
  );
  const progress = workProgressAround(
    row.workSince.getTime(),
    at.getTime(),
    cycleSeconds,
    JOB_RULES,
    homestead ? workPauseOf(homestead) : null,
  );
  const ready = workYield(
    source,
    progress.finishedMs,
    GAME_DATA.resources,
    seasonsAtFor(map.timeZone),
  );
  return { tile: row.workTile, source, speedPercent, cycleSeconds, progress, ready };
}

/** Training Grounds levels by content id (owner decision 2026-10-06). */
export const TRAINING_GROUNDS = new Map(
  GAME_DATA.buildings.flatMap((b) => (b.kind === 'training-grounds' ? [[b.id, b] as const] : [])),
);

/** A Training Grounds row's level data (room and XP per hour), or null for other buildings. */
export function trainingLevelOf(
  row: Pick<BuildingRow, 'buildingId' | 'level'>,
): { capacity: number; xpPerHour: number } | null {
  const grounds = TRAINING_GROUNDS.get(row.buildingId);
  return grounds?.levels[Math.min(row.level, grounds.levels.length) - 1] ?? null;
}

/** A trainee's XP at `at`: how much per hour, and what's waiting to land. Null if it isn't training. */
export function trainingAt(row: Pick<JobRow, 'training'>, at: Date) {
  const training = row.training;
  if (!training) return null;
  const level = trainingLevelOf({ buildingId: training.buildingId, level: training.level });
  if (!level) return null;
  // A homestead cut off from home naps (#277): the pause is left out of the count.
  const homestead = training.homestead;
  const progress = trainingProgressAround(
    training.since.getTime(),
    at.getTime(),
    level.xpPerHour,
    JOB_RULES,
    homestead ? workPauseOf(homestead) : null,
  );
  return {
    buildingRowId: training.buildingRowId,
    tile: training.tile,
    xpPerHour: level.xpPerHour,
    napping: homesteadOf(homestead) === 'paused',
    progress,
  };
}
