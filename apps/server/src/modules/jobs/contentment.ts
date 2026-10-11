import {
  CARE_RULES,
  contentmentAt,
  GAME_DATA,
  gatherFits,
  holdSpans,
  inSeason,
  JOB_RULES,
  moodDrift,
  seasonEndMs,
  trainingFullAtMs,
  workFullAtMs,
  type CareState,
  type HoldFacts,
  type MoodDrift,
} from '@heartpatch/shared';
import type { Executor } from '../../db/client.js';
import { workPauseOf } from '../explore/homesteads.js';
import { createMapsRepo } from '../maps/repo.js';
import { createSquishyJobsRepo, type JobRow } from './repo.js';
import { seasonsAtFor, traitsOf, workAt, type JobMap } from './work.js';

// Contentment and jobs (owner decision on #376, design doc §7): it drifts
// down only while a squishy rests or its job doesn't suit it. Still lazy
// (CLAUDE.md rule 4): the stored checkpoint plus the stretches since then
// its job held it steady (shared `holdSpans`), worked out here from the job
// as stored, on the server only. Anything that changes a squishy's job calls
// `checkpointContentment` first, so the time before counts at the old job's
// rate. Moments a job stops by itself (a full basket, a nap, a season's end,
// lost land) are timestamps already, so they need no write.

/** The checkpoint as read: the newer of the checkpoint pair and the last-care pair. */
export function contentmentCheckpoint(care: JobRow['care']): CareState {
  const checkpoint = care.contentmentSince;
  const cared = care.lastCaredAt;
  // A row the previous release cared for, or created, has only the last-care pair.
  if (cared !== null && (checkpoint === null || cared > checkpoint)) {
    return { contentment: care.contentmentAtLastCare, since: cared };
  }
  return { contentment: care.contentment, since: checkpoint };
}

/**
 * What a squishy's job looks like to its contentment at `at`, in the order
 * `jobOf` reads jobs: a watch post, a gatherer (one whose land changed hands
 * counts until then), a trainee, the team. One in the Hollow or a trade has
 * no job. `since` is where the count starts (the season search starts there).
 */
export function holdFactsOf(row: JobRow, map: JobMap, at: Date, since: Date | null): HoldFacts {
  if (row.squishy.state !== 'active') return {};
  if (row.onWatch && row.post) return { steady: { fromMs: row.post.assignedAt.getTime() } };
  if (row.workTile && row.workSince && (row.atWork || row.lostAt)) {
    const work = workAt({ ...row, atWork: true }, map, at);
    if (work) {
      const homestead = row.workTile.homestead ?? null;
      const pause = homestead ? workPauseOf(homestead) : null;
      const fromMs = (row.workStartedAt ?? row.workSince).getTime();
      const resource = GAME_DATA.resources.find((r) => r.id === work.source.resource);
      const seasonsAt = seasonsAtFor(map.timeZone);
      const searchFrom = Math.max(fromMs, since?.getTime() ?? fromMs);
      return {
        gatherer: {
          fits: gatherFits(traitsOf(row.squishy), work.source.resource, JOB_RULES),
          fromMs,
          lostMs: row.atWork ? null : (row.lostAt?.getTime() ?? null),
          fullMs: workFullAtMs(row.workSince.getTime(), work.cycleSeconds, JOB_RULES, pause),
          seasonEndMs:
            resource?.season === undefined
              ? null
              : seasonEndMs(searchFrom, at.getTime(), (ms) => inSeason(resource, seasonsAt(ms))),
          pause,
        },
      };
    }
  }
  if (row.training) {
    const homestead = row.training.homestead;
    const pause = homestead ? workPauseOf(homestead) : null;
    return {
      training: { fullMs: trainingFullAtMs(row.training.since.getTime(), JOB_RULES, pause), pause },
    };
  }
  if (row.teamSlot !== null) return { steady: { fromMs: null } };
  return {};
}

/** A squishy's contentment at `at`, and whether its job is holding it steady. */
export function contentmentOf(
  row: JobRow,
  map: JobMap,
  at: Date,
): { contentment: number; drift: MoodDrift } {
  const checkpoint = contentmentCheckpoint(row.care);
  const facts = holdFactsOf(row, map, at, checkpoint.since);
  return {
    contentment: contentmentAt(checkpoint, at, CARE_RULES, holdSpans(facts)),
    drift: moodDrift(facts, at.getTime()),
  };
}

/** One squishy's contentment at `at`; it must exist (a locked or listed row). */
export async function contentmentFor(
  tx: Executor,
  mapId: string,
  squishyId: string,
  at: Date,
): Promise<{ contentment: number; drift: MoodDrift }> {
  return moodIn(await contentmentsOf(tx, mapId, [squishyId], at), squishyId);
}

/** A squishy's entry from `contentmentsOf`, which has every row it was asked for. */
export function moodIn(
  moods: ReadonlyMap<string, { contentment: number; drift: MoodDrift }>,
  squishyId: string,
): { contentment: number; drift: MoodDrift } {
  const mood = moods.get(squishyId);
  if (!mood) throw new Error(`contentment: no squishy ${squishyId}`);
  return mood;
}

/** The map as the job maths needs it, read once. */
async function jobMap(tx: Executor, mapId: string): Promise<JobMap> {
  const map = await createMapsRepo(tx).findMap(mapId);
  if (!map) throw new Error(`contentment: no map ${mapId}`);
  return map;
}

/** These squishies' contentment at `at` (one query for all), by id. */
export async function contentmentsOf(
  tx: Executor,
  mapId: string,
  squishyIds: readonly string[],
  at: Date,
): Promise<Map<string, { contentment: number; drift: MoodDrift }>> {
  if (squishyIds.length === 0) return new Map();
  const [rows, map] = await Promise.all([
    createSquishyJobsRepo(tx).listByIds(squishyIds),
    jobMap(tx, mapId),
  ]);
  return new Map(rows.map((row) => [row.squishy.id, contentmentOf(row, map, at)]));
}

/** A checkpoint worked out but not written yet: a squishy's contentment at one moment. */
export interface ContentmentCheckpoint {
  readonly squishyId: string;
  readonly contentment: number;
}

/** These squishies' checkpoints at `at`, worked out from their jobs as stored now. */
export async function contentmentCheckpointsOf(
  tx: Executor,
  mapId: string,
  squishyIds: readonly string[],
  at: Date,
): Promise<ContentmentCheckpoint[]> {
  return [...(await contentmentsOf(tx, mapId, squishyIds, at))].map(([squishyId, c]) => ({
    squishyId,
    contentment: c.contentment,
  }));
}

/**
 * Writes checkpoints worked out earlier (`contentmentCheckpointsOf`), with
 * the squishies locked. For a command that must read a job before its rows
 * go (a capture, land going wild) but locks squishies later (tech spec §7).
 */
export async function writeContentmentCheckpoints(
  tx: Executor,
  checkpoints: readonly ContentmentCheckpoint[],
  at: Date,
): Promise<void> {
  const repo = createSquishyJobsRepo(tx);
  for (const { squishyId, contentment } of checkpoints) {
    await repo.setContentment(squishyId, contentment, at);
  }
}

/** A guard on watch, as a capture or land going wild finds it before its post goes. */
export interface GuardWatch {
  readonly squishyId: string;
  /** When it was posted (`tile_defenders.assigned_at`): its watch holds from then. */
  readonly assignedAt: Date;
}

/**
 * These guards' watches: read before their posts go (only the post row says
 * when it started). The ids come from `listDefenders`: active guards on watch.
 */
export async function guardWatchesOf(
  tx: Executor,
  squishyIds: readonly string[],
): Promise<GuardWatch[]> {
  if (squishyIds.length === 0) return [];
  return (await createSquishyJobsRepo(tx).listByIds(squishyIds)).flatMap((row) =>
    row.post ? [{ squishyId: row.squishy.id, assignedAt: row.post.assignedAt }] : [],
  );
}

/**
 * Writes the checkpoint of guards whose posts went at `at` (a capture, land
 * going wild): their watch held until now. Call it with the squishies
 * locked: it reads their care columns then, so a care action that landed
 * after the posts were read still counts (only `assignedAt` comes from
 * before, and nothing changes it while the command holds the tile).
 */
export async function writeGuardCheckpoints(
  tx: Executor,
  watches: readonly GuardWatch[],
  at: Date,
): Promise<void> {
  if (watches.length === 0) return;
  const repo = createSquishyJobsRepo(tx);
  const since = new Map(watches.map((w) => [w.squishyId, w.assignedAt.getTime()]));
  for (const row of await repo.listByIds([...since.keys()])) {
    const fromMs = since.get(row.squishy.id);
    if (fromMs === undefined) continue;
    const value = contentmentAt(
      contentmentCheckpoint(row.care),
      at,
      CARE_RULES,
      holdSpans({ steady: { fromMs } }),
    );
    await repo.setContentment(row.squishy.id, value, at);
  }
}

/**
 * Writes a contentment checkpoint for these squishies at `at` (#376): what
 * their job so far left them with. Call it before anything that changes
 * their job (a new job, a collect or settle that restarts a count, a watch
 * post, the Hollow, a trade), inside that transaction, with the squishies
 * locked. Writing one twice at the same instant changes nothing.
 */
export async function checkpointContentment(
  tx: Executor,
  mapId: string,
  squishyIds: readonly string[],
  at: Date,
): Promise<void> {
  await writeContentmentCheckpoints(
    tx,
    await contentmentCheckpointsOf(tx, mapId, squishyIds, at),
    at,
  );
}
