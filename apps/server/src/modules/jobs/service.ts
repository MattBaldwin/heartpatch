import {
  battleXpPercent,
  GROWTH_RULES,
  BATTLE_RULES,
  GAME_DATA,
  gameplayOverrides,
  hexKey,
  HOME_BASE_RULES,
  inSeason,
  JOB_RULES,
  jobOf,
  teamProblem,
  tonightOf,
  trainingProgressAround,
  workCycleSeconds,
  workProgressAround,
  EXPLORE_RULES,
  homesteadQuantity,
  workSource,
  workSpeedPercent,
  workYield,
  type CollectWorkResponse,
  type HexKey,
  type ItemCounts,
  type JobsView,
  type JobSquishy,
  type JobTraits,
  type OwnedSquishy,
  type PublicUser,
  type SetJobRequest,
  type SetTeamRequest,
  type SquishyJobId,
  type TrainingStatus,
  type WorkSource,
  type WorkStatus,
} from '@heartpatch/shared';
import { SERVER_GAME_DATA } from '@heartpatch/shared/server';
import type { Executor } from '../../db/client.js';
import type { NewGameEvent } from '../../db/game-events.js';
import { AppError } from '../../lib/errors.js';
import { mapLocalTime, nextLocalMidnight, type Clock } from '../../lib/time.js';
import { createBattlesRepo } from '../battles/repo.js';
import { litSafeTiles } from '../buildings/hearthfire.js';
import { createBuildingsRepo, type BuildingRow } from '../buildings/repo.js';
import { applyXp, growthEvents, type Growth } from '../care/service.js';
import { homesteadOf, workPauseOf } from '../explore/homesteads.js';
import { createExploreRepo } from '../explore/repo.js';
import { createInventoryRepo } from '../inventory/repo.js';
import { grantItems, lockGrantRows, seasonsOn } from '../inventory/service.js';
import { requireMember } from '../maps/members.js';
import { createMapsRepo, type MapRow } from '../maps/repo.js';
import {
  createSquishyJobsRepo,
  type JobRow,
  type JobTileRow,
  type SquishyJobsRepo,
  type SquishyJobsTxRepo,
} from './repo.js';

/*
 * Squishy jobs (owner decisions 2026-10-04, design doc §6 and §12). Each
 * squishy has one job: on the battle team, a guard on watch (#15's posts,
 * set from the tile panel), a gatherer working a tile of its owner's land,
 * or resting (at home or in a habitat). Giving a squishy a new job takes it
 * off its old one. A gatherer's work is timestamps (CLAUDE.md rule 4):
 * finished cycles are worked out when someone looks or collects, capped,
 * so an idle gatherer costs nothing. Taking one off its tile banks what it
 * had ready; a part-done cycle is let go. Training at the Training Grounds
 * (owner decision 2026-10-06) works the same way: XP per hour from a
 * timestamp, capped, landing at each settle and when it stops training.
 */

// Kid-readable messages (style guide §6).
const MESSAGES = {
  noMap: "We couldn't find that patch.",
  noSquishy: "We couldn't find that squishy.",
  inHollow: (name: string) => `${name} is in the Hollow. Rescue them first!`,
  noTile: "We couldn't find that spot.",
  notYours: 'Squishies can only gather on your own land.',
  napping: 'This homestead is napping. Join it back up to home first!',
  nothingHere: "There's nothing to gather here.",
  outOfSeason: (resource: string, season: string) => `${resource} only turn up around ${season}!`,
  spotTaken: (name: string) => `${name} is already gathering here!`,
  teamFull: 'Your team is full! Take someone off first.',
  changed: 'Something just changed. Try again!',
  notReady: 'Nothing ready yet. Check back soon!',
  noGrounds: 'Build Training Grounds on a homestead first! 🏡',
  groundsNapping: 'These Training Grounds are napping. Join their homestead back up to home first!',
  groundsFull: 'The Training Grounds are full! Upgrade them for more room.',
  groundsFullTop: 'The Training Grounds are full! Give someone else a turn first.',
} as const;

const SPECIES = new Map(
  [...GAME_DATA.species, ...SERVER_GAME_DATA.secretSpecies].map((s) => [s.id, s]),
);
const SEASON_NAMES = new Map(GAME_DATA.seasons.map((s) => [s.id, s.name]));

/** What to call one of my squishies in a message: its nickname, else its species. */
export const squishyName = (s: Pick<OwnedSquishy, 'nickname' | 'speciesId'>): string =>
  s.nickname ?? SPECIES.get(s.speciesId)?.name ?? 'Your squishy';

/** The job rules' view of a squishy: element, feeling, and its species' season. */
const traitsOf = (s: OwnedSquishy): JobTraits => ({
  element: s.element,
  feeling: s.feeling,
  season: SPECIES.get(s.speciesId)?.season,
});

/** The map as the job rules need it. */
export type JobMap = Pick<MapRow, 'id' | 'kind' | 'timeZone'>;

/** Seasons on at an instant on this map (each cycle is judged when it finished). */
const seasonsAtFor = (timeZone: string) => (ms: number) =>
  new Set(seasonsOn(new Date(ms), timeZone));

/**
 * A gatherer's work at `at`: what, how quick, and what's ready. Null if it
 * isn't at work. `justTaken`: it went to the Hollow in this transaction, and
 * its work up to now still counts.
 */
function workAt(row: JobRow, map: JobMap, at: Date, justTaken = false) {
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
  const speedPercent = workSpeedPercent(traitsOf(row.squishy), source.resource, JOB_RULES);
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
const TRAINING_GROUNDS = new Map(
  GAME_DATA.buildings.flatMap((b) => (b.kind === 'training-grounds' ? [[b.id, b] as const] : [])),
);

/** A Training Grounds row's level data (room and XP per hour), or null for other buildings. */
export function trainingLevelOf(
  row: Pick<BuildingRow, 'buildingId' | 'level'>,
): { capacity: number; xpPerHour: number } | null {
  const grounds = TRAINING_GROUNDS.get(row.buildingId);
  return grounds?.levels[Math.min(row.level, grounds.levels.length) - 1] ?? null;
}

/**
 * The Training Grounds a Train command means (read before the tile locks, and
 * checked again under them): the one asked for, else the first of mine with
 * room on a homestead that isn't napping, else my first. Null: none of mine.
 */
async function pickGrounds(
  tx: Executor,
  mapId: string,
  userId: string,
  buildingRowId: string | undefined,
): Promise<BuildingRow | null> {
  const mine = (await createBuildingsRepo(tx).listOwned(mapId, userId)).filter(
    (b) => trainingLevelOf(b) !== null,
  );
  if (buildingRowId !== undefined) return mine.find((b) => b.id === buildingRowId) ?? null;
  const explore = createExploreRepo(tx);
  const jobs = createSquishyJobsRepo(tx);
  for (const b of mine) {
    const room = (trainingLevelOf(b)?.capacity ?? 0) > (await jobs.countTrainees(b.id));
    if (room && homesteadOf(await explore.findRow(userId, b.tileId)) === 'joined') return b;
  }
  return mine[0] ?? null;
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

/**
 * Lands what trainees earned (plain XP, levels and evolutions through
 * `applyXp`) and either moves their count on (`stop: false`, a settle) or
 * ends their training (`stop: true`: a new job, the Hollow, the Training
 * Grounds taken down). The caller has locked these squishies (tech spec §7).
 * Returns what landed per squishy and the events to append after the
 * caller's own writes: `squishy.trained` per owner, then growth events.
 */
export async function landTraining(
  tx: Executor,
  map: Pick<JobMap, 'id'>,
  squishyIds: readonly string[],
  at: Date,
  stop: boolean,
): Promise<{
  trained: { squishyId: string; ownerUserId: string; xp: number }[];
  events: NewGameEvent[];
}> {
  const repo = createSquishyJobsRepo(tx);
  const rows = (await repo.listByIds(squishyIds)).filter((r) => r.training !== null);
  const trained: { squishyId: string; ownerUserId: string; xp: number }[] = [];
  const growths: Growth[] = [];
  for (const row of rows) {
    const training = trainingAt(row, at);
    const xp = training?.progress.xp ?? 0;
    if (xp > 0) {
      const growth = await applyXp(tx, row.squishy.id, xp, at, { plain: true });
      if (growth) growths.push(growth);
      trained.push({ squishyId: row.squishy.id, ownerUserId: row.squishy.ownerUserId, xp });
    }
    if (stop) await repo.stopTraining(row.squishy.id);
    else if (training && xp > 0) {
      // The next count starts here; a full one starts again now.
      await repo.moveTrainingSince(row.squishy.id, new Date(training.progress.nextSinceMs));
    }
  }
  const byOwner = new Map<string, { squishyId: string; xp: number }[]>();
  for (const t of trained) {
    byOwner.set(t.ownerUserId, [
      ...(byOwner.get(t.ownerUserId) ?? []),
      { squishyId: t.squishyId, xp: t.xp },
    ]);
  }
  const events: NewGameEvent[] = [...byOwner].map(([userId, list]) => ({
    mapId: map.id,
    type: 'squishy.trained',
    actorUserId: userId,
    payload: { userId, trained: list },
  }));
  events.push(...growthEvents(growths));
  return { trained, events };
}

const isEmpty = (items: ItemCounts) => Object.keys(items).length === 0;

function addInto(total: ItemCounts, items: ItemCounts): void {
  for (const [id, n] of Object.entries(items)) total[id] = (total[id] ?? 0) + n;
}

const tileOf = (t: { q: number; r: number } | null) => (t ? { q: t.q, r: t.r } : null);

/**
 * What a gatherer has to bank at `at`: its work now if it's at work, or, if
 * its tile changed hands, the cycles it finished before then (owner decision
 * 2026-10-06: finished cycles are banked first, only the unfinished one is
 * lost). Null if there's nothing to bank from.
 */
export function bankableWork(row: JobRow, map: JobMap, at: Date, justTaken = false) {
  if (row.atWork) return workAt(row, map, at, justTaken);
  if (row.lostAt === null) return null;
  const until = row.lostAt < at ? row.lostAt : at;
  return workAt({ ...row, atWork: true }, map, until, justTaken);
}

/**
 * Takes squishies off their work tiles, banking what each had ready into its
 * owner's bag (ledger reason `work`, ref the squishy). The caller has locked
 * these squishies (tech spec §7: squishies, then the inventory rows this
 * takes); a stale work row (land that changed hands) banks the cycles it
 * finished before then, and is cleared.
 * Returns the events to append (`work.collected`, and `squishy.assigned`
 * with `job`, so maps stop showing a gatherer there), after the caller's own
 * writes, `maps` last. Nightfall, posting a guard and housing use it too.
 */
export async function leaveWork(
  tx: Executor,
  map: JobMap,
  squishyIds: readonly string[],
  job: SquishyJobId,
  at: Date,
  /** More grants the caller will make right after (a lost fire's refund, #202): locked with these. */
  alsoLock: readonly { userId: string; items: ItemCounts }[] = [],
): Promise<NewGameEvent[]> {
  const repo = createSquishyJobsRepo(tx);
  const rows = (await repo.listByIds(squishyIds)).filter((r) => r.workTile !== null);
  const banked = new Map<string, { squishyIds: string[]; items: ItemCounts }>();
  const events: NewGameEvent[] = [];
  // Nightfall calls this for a squishy it just took: its day's work still
  // counts. Work on land that changed hands banks what finished before then.
  const works = rows.map((row) => ({ row, work: bankableWork(row, map, at, true) }));
  await lockGrantRows(tx, map.id, [
    ...works.flatMap(({ row, work }) =>
      work ? [{ userId: row.squishy.ownerUserId, items: work.ready }] : [],
    ),
    ...alsoLock,
  ]);
  for (const { row, work } of works) {
    const owner = row.squishy.ownerUserId;
    if (work && !isEmpty(work.ready)) {
      await grantItems(tx, { mapId: map.id, userId: owner }, work.ready, 'work', row.squishy.id);
      const sum = banked.get(owner) ?? { squishyIds: [], items: {} };
      sum.squishyIds.push(row.squishy.id);
      addInto(sum.items, work.ready);
      banked.set(owner, sum);
    }
    await repo.stopWork(row.squishy.id);
    // Only a gatherer that was really at work shows on the map.
    if (work && row.atWork) {
      events.push({
        mapId: map.id,
        type: 'squishy.assigned',
        actorUserId: owner,
        payload: {
          userId: owner,
          squishyId: row.squishy.id,
          job,
          from: tileOf(work.tile),
          to: null,
        },
      });
    }
  }
  for (const [userId, sum] of banked) {
    events.unshift({
      mapId: map.id,
      type: 'work.collected',
      actorUserId: userId,
      payload: { userId, squishyIds: sum.squishyIds, items: sum.items },
    });
  }
  return events;
}

export interface SquishyJobsService {
  /** My squishies with their jobs, my team, and the tiles a gatherer could work. */
  view: (user: PublicUser, mapId: string) => Promise<JobsView>;
  /** Gives one of my squishies a new job (team, gatherer or resting). */
  setJob: (
    user: PublicUser,
    mapId: string,
    squishyId: string,
    request: SetJobRequest,
  ) => Promise<JobsView>;
  /** Picks my whole battle team, in slot order. */
  setTeam: (user: PublicUser, mapId: string, request: SetTeamRequest) => Promise<JobsView>;
  /** Puts everything my gatherers have ready in my bag. */
  collect: (user: PublicUser, mapId: string) => Promise<CollectWorkResponse>;
  /** Dev/test only: each of my gatherers finishes one more cycle now (a short timer for e2e). */
  devReady: (user: PublicUser, mapId: string) => Promise<JobsView>;
}

export interface SquishyJobsServiceOptions {
  db: Executor;
  clock?: Clock;
  /** Live sync (`wsHub.publish`), called after commit. Never rejects. */
  publish?: (mapId: string) => Promise<void>;
}

export function createSquishyJobsService(options: SquishyJobsServiceOptions): SquishyJobsService {
  const { db } = options;
  const now = options.clock ?? (() => new Date());
  const store = createSquishyJobsRepo(db);
  const published = (mapId: string) => {
    void options.publish?.(mapId);
  };

  /** Tiles lit fires keep safe tonight (anyone's fires, as nightfall counts them). */
  const firelitTiles = async (
    tx: Executor,
    repo: SquishyJobsRepo,
    map: JobMap,
    at: Date,
  ): Promise<Set<HexKey>> => {
    const [fires, homeTiles] = await Promise.all([
      createBuildingsRepo(tx).listOnMap(map.id),
      repo.homeTiles(map.id),
    ]);
    const night = tonightOf(mapLocalTime(at, map.timeZone), HOME_BASE_RULES);
    return litSafeTiles(
      fires.filter((b) => b.kind === 'hearthfire'),
      homeTiles,
      { date: night, minute: 0 },
    );
  };

  const buildView = async (
    tx: Executor,
    repo: SquishyJobsRepo,
    map: JobMap,
    userId: string,
    at: Date,
  ): Promise<JobsView> => {
    const [rows, owned, safe, buildings, explored] = await Promise.all([
      repo.listMine(map.id, userId),
      repo.listOwnedTiles(map.id, userId),
      firelitTiles(tx, repo, map, at),
      createBuildingsRepo(tx).listOwned(map.id, userId),
      createExploreRepo(tx).listOwnersExplored(map.id),
    ]);
    // My homesteads (#199): +1 a cycle while joined to home.
    const joined = new Set(
      explored
        .filter((e) => homesteadOf(e) === 'joined')
        .map((e) => `${String(e.q)},${String(e.r)}`),
    );
    // Who has won its full-XP battles today (#201): wins pay less until the
    // patch's next midnight (the battles service's falloff, the same count).
    const wins = await createBattlesRepo(tx).winsToday(
      map.id,
      userId,
      rows.map((r) => r.squishy.id),
      at,
    );
    const fullXpBack = nextLocalMidnight(at, map.timeZone).toISOString();
    const seasons = new Set(seasonsOn(at, map.timeZone));
    const workers = new Map<string, string>();
    const squishies: JobSquishy[] = rows.map((row) => {
      const work = workAt(row, map, at);
      if (work) workers.set(work.tile.id, row.squishy.id);
      const status: WorkStatus | null = work && {
        q: work.tile.q,
        r: work.tile.r,
        resource: work.source.resource,
        from: work.source.from,
        cycleSeconds: work.cycleSeconds,
        speedPercent: work.speedPercent,
        readyCycles: work.progress.cycles,
        ready: work.ready,
        nextReadyAt:
          work.progress.nextReadyMs === null
            ? null
            : new Date(work.progress.nextReadyMs).toISOString(),
        full: work.progress.full,
        firelit: safe.has(hexKey(work.tile)),
      };
      const onWatch = row.onWatch && row.squishy.state === 'active';
      const training = trainingAt(row, at);
      const trainingStatus: TrainingStatus | null = training && {
        buildingId: training.buildingRowId,
        q: training.tile.q,
        r: training.tile.r,
        firelit: safe.has(hexKey(training.tile)),
        napping: training.napping,
        xpPerHour: training.xpPerHour,
        xpReady: training.progress.xp,
        full: training.progress.full,
      };
      return {
        squishy: row.squishy,
        job: jobOf({
          teamSlot: row.teamSlot,
          atWork: work !== null,
          onWatch,
          training: training !== null,
        }),
        teamSlot: row.teamSlot,
        post: onWatch ? tileOf(row.post) : null,
        habitatId: row.habitatBuildingId,
        work: status,
        training: trainingStatus,
        fullXpResetAt:
          battleXpPercent(wins.get(row.squishy.id) ?? 0, GROWTH_RULES) < 100 ? fullXpBack : null,
      };
    });
    // One a homestead (#277), each with its room and its night.
    const napping = new Set(
      explored
        .filter((e) => homesteadOf(e) === 'paused')
        .map((e) => `${String(e.q)},${String(e.r)}`),
    );
    const grounds = buildings.flatMap((b) => {
      const level = trainingLevelOf(b);
      if (!level) return [];
      const key = `${String(b.q)},${String(b.r)}`;
      return [
        {
          id: b.id,
          q: b.q,
          r: b.r,
          capacity: level.capacity,
          used: rows.filter((r) => r.training?.buildingRowId === b.id).length,
          firelit: safe.has(hexKey(b)),
          napping: napping.has(key),
        },
      ];
    });
    const team = rows
      .filter((r) => r.teamSlot !== null)
      .sort((a, b) => (a.teamSlot ?? 0) - (b.teamSlot ?? 0))
      .map((r) => r.squishy.id);
    const spots = owned.flatMap((tile) => {
      const source = workSource(tile, GAME_DATA.resources, JOB_RULES);
      if (!source) return [];
      const resource = GAME_DATA.resources.find((r) => r.id === source.resource);
      return [
        {
          q: tile.q,
          r: tile.r,
          terrain: tile.terrain,
          resource: source.resource,
          from: source.from,
          quantity: joined.has(`${String(tile.q)},${String(tile.r)}`)
            ? homesteadQuantity(source.quantity, EXPLORE_RULES)
            : source.quantity,
          seconds: source.seconds,
          inSeason: resource ? inSeason(resource, seasons) : false,
          workerId: workers.get(tile.id) ?? null,
          firelit: safe.has(hexKey(tile)),
        },
      ];
    });
    return {
      squishies,
      names: Object.fromEntries(rows.map((r) => [r.squishy.id, squishyName(r.squishy)])),
      team,
      spots,
      trainingGrounds: grounds,
      rules: { teamSize: BATTLE_RULES.teamSize, maxStoredCycles: JOB_RULES.work.maxStoredCycles },
      now: at.toISOString(),
    };
  };

  /** One job command for a member: their row lock first (one change at a time), `maps` last. */
  const command = async <T>(
    user: PublicUser,
    mapId: string,
    fn: (ctx: { repo: SquishyJobsTxRepo; tx: Executor; map: MapRow; at: Date }) => Promise<T>,
  ): Promise<T> => {
    const result = await store.transaction(async (repo, tx) => {
      const { map } = await requireMember(tx, user, mapId);
      // Lock order (tech spec §7): the member row, tiles, squishies, inventory, `maps`.
      if (!(await createMapsRepo(tx).lockMember(map.id, user.id))) {
        throw new AppError('NOT_FOUND', MESSAGES.noMap);
      }
      return fn({ repo, tx, map, at: now() });
    });
    published(mapId);
    return result;
  };

  /**
   * Locks the tiles these squishies stand on or work (plus `extra`), in id
   * order, then the squishies, and reads them again. Throws if where they
   * stand moved between the first read and the locks.
   */
  const lockJobs = async (
    repo: SquishyJobsRepo,
    before: readonly JobRow[],
    extra: readonly string[] = [],
  ): Promise<{ rows: JobRow[]; tiles: Map<string, JobTileRow> }> => {
    const tileIds = new Set(extra);
    for (const row of before) {
      if (row.post) tileIds.add(row.post.tileId);
      if (row.workTile) tileIds.add(row.workTile.id);
      if (row.training) tileIds.add(row.training.tile.id);
    }
    const tiles = new Map(
      (await repo.lockTiles([...tileIds].sort())).map((tile) => [tile.id, tile]),
    );
    await repo.lockSquishies(before.map((r) => r.squishy.id));
    const rows = await repo.listByIds(before.map((r) => r.squishy.id));
    const where = (r: JobRow) => `${r.post?.tileId ?? ''}/${r.workTile?.id ?? ''}`;
    const was = new Map(before.map((r) => [r.squishy.id, where(r)]));
    if (rows.some((r) => was.get(r.squishy.id) !== where(r))) {
      throw new AppError('CONFLICT', MESSAGES.changed);
    }
    return { rows, tiles };
  };

  /**
   * Takes squishies off their old jobs (watch posts, work tiles) before a
   * new one; returns the events. Team slots are the caller's to rewrite.
   */
  const leaveOldJobs = async (
    repo: SquishyJobsTxRepo,
    tx: Executor,
    map: MapRow,
    userId: string,
    rows: readonly JobRow[],
    job: SquishyJobId,
    at: Date,
  ): Promise<NewGameEvent[]> => {
    const events: NewGameEvent[] = [];
    const leftPosts = new Map<string, { q: number; r: number }>();
    for (const row of rows) {
      if (!row.post) continue;
      await repo.leavePost(row.squishy.id);
      if (row.onWatch) {
        leftPosts.set(row.post.tileId, row.post);
        events.push({
          mapId: map.id,
          type: 'squishy.assigned',
          actorUserId: userId,
          payload: { userId, squishyId: row.squishy.id, job, from: null, to: null },
        });
      }
    }
    // One `defenders.changed` per tile whose guards changed, as posting sends.
    for (const [tileId, post] of leftPosts) {
      const ids = (await repo.listMine(map.id, userId))
        .filter((r) => r.post?.tileId === tileId && r.squishy.state === 'active')
        .map((r) => r.squishy.id);
      events.push({
        mapId: map.id,
        type: 'defenders.changed',
        actorUserId: userId,
        payload: { userId, q: post.q, r: post.r, count: ids.length, squishyIds: ids },
      });
    }
    const working = rows.filter((r) => r.workTile !== null).map((r) => r.squishy.id);
    if (working.length > 0) events.push(...(await leaveWork(tx, map, working, job, at)));
    // Trainees land what they earned and stop (owner decision 2026-10-06).
    const training = rows.filter((r) => r.training !== null).map((r) => r.squishy.id);
    if (training.length > 0)
      events.push(...(await landTraining(tx, map, training, at, true)).events);
    return events;
  };

  const append = async (repo: SquishyJobsTxRepo, events: readonly NewGameEvent[]) => {
    for (const event of events) await repo.appendEvent(event);
  };

  return {
    view: async (user, mapId) => {
      const { map } = await requireMember(db, user, mapId);
      return buildView(db, store, map, user.id, now());
    },

    setJob: (user, mapId, squishyId, request) =>
      command(user, mapId, async ({ repo, tx, map, at }) => {
        const [before] = await repo.listByIds([squishyId]);
        if (!before || before.squishy.mapId !== map.id || before.squishy.ownerUserId !== user.id) {
          throw new AppError('NOT_FOUND', MESSAGES.noSquishy);
        }
        const target =
          request.job === 'gatherer' ? await repo.tileAt(map.id, request.q, request.r) : null;
        if (request.job === 'gatherer' && !target) throw new AppError('NOT_FOUND', MESSAGES.noTile);
        // The Training Grounds asked for (one a homestead, #277), else my first
        // with room. Its tile is locked with the others, so taking it down or
        // losing its land (both lock that tile first) can't race this.
        const groundsBefore =
          request.job === 'training'
            ? await pickGrounds(
                tx,
                map.id,
                user.id,
                // Already training and none asked for: it stays where it is.
                request.buildingId ?? before.training?.buildingRowId,
              )
            : null;
        if (request.job === 'training' && !groundsBefore) {
          throw new AppError('CONFLICT', MESSAGES.noGrounds);
        }
        const extraTiles = [target?.id, groundsBefore?.tileId].filter(
          (id): id is string => id !== undefined,
        );
        const { rows, tiles } = await lockJobs(repo, [before], extraTiles);
        const [row] = rows;
        if (!row) throw new AppError('NOT_FOUND', MESSAGES.noSquishy);
        const name = squishyName(row.squishy);
        if (row.squishy.state !== 'active') throw new AppError('CONFLICT', MESSAGES.inHollow(name));
        const current = jobOf({
          teamSlot: row.teamSlot,
          atWork: row.atWork,
          onWatch: row.onWatch,
          training: row.training !== null,
        });

        let source: WorkSource | null = null;
        let workTile: JobTileRow | null = null;
        if (request.job === 'gatherer') {
          workTile = tiles.get(target?.id ?? '') ?? null;
          if (!workTile) throw new AppError('NOT_FOUND', MESSAGES.noTile);
          if (current === 'gatherer' && row.workTile?.id === workTile.id) {
            return buildView(tx, repo, map, user.id, at);
          }
          if (workTile.ownerUserId !== user.id) throw new AppError('FORBIDDEN', MESSAGES.notYours);
          source = workSource(workTile, GAME_DATA.resources, JOB_RULES);
          if (!source) throw new AppError('CONFLICT', MESSAGES.nothingHere);
          // A homestead cut off from home naps (#199), as for the Keeper.
          if (homesteadOf(await createExploreRepo(tx).findRow(user.id, workTile.id)) === 'paused') {
            throw new AppError('CONFLICT', MESSAGES.napping);
          }
          const resource = GAME_DATA.resources.find((r) => r.id === source?.resource);
          if (resource && !inSeason(resource, new Set(seasonsOn(at, map.timeZone)))) {
            const season = SEASON_NAMES.get(resource.season ?? '') ?? 'their season';
            throw new AppError('CONFLICT', MESSAGES.outOfSeason(resource.name, season));
          }
          // One gatherer per tile (the member lock keeps two assignments apart).
          const other = (await repo.listMine(map.id, user.id)).find(
            (r) =>
              r.squishy.id !== row.squishy.id &&
              r.atWork &&
              r.squishy.state === 'active' &&
              r.workTile?.id === workTile?.id,
          );
          if (other) throw new AppError('CONFLICT', MESSAGES.spotTaken(squishyName(other.squishy)));
        } else if (request.job === 'training') {
          if (current === 'training' && row.training?.buildingRowId === groundsBefore?.id) {
            return buildView(tx, repo, map, user.id, at);
          }
          // Read again under the tile lock: still mine, and room for one more.
          const grounds = (await createBuildingsRepo(tx).listOwned(map.id, user.id)).find(
            (b) => b.id === groundsBefore?.id,
          );
          const level = grounds ? trainingLevelOf(grounds) : null;
          if (!grounds || !level) throw new AppError('CONFLICT', MESSAGES.noGrounds);
          // A homestead cut off from home naps (#277): no new trainees there.
          if (
            homesteadOf(await createExploreRepo(tx).findRow(user.id, grounds.tileId)) !== 'joined'
          ) {
            throw new AppError('CONFLICT', MESSAGES.groundsNapping);
          }
          if ((await repo.countTrainees(grounds.id)) >= level.capacity) {
            // Only suggest an upgrade when there's a level to upgrade to.
            const top =
              grounds.level >= (TRAINING_GROUNDS.get(grounds.buildingId)?.levels.length ?? 1);
            throw new AppError('CONFLICT', top ? MESSAGES.groundsFullTop : MESSAGES.groundsFull);
          }
        } else if (request.job === current) {
          // Resting already, maybe with a stale work row (its land changed
          // hands): bank what it finished before then (owner decision
          // 2026-10-06), then tidy it away so the one-job checks never read it.
          if (row.workTile !== null && !row.atWork) {
            await append(repo, await leaveWork(tx, map, [row.squishy.id], 'resting', at));
          }
          return buildView(tx, repo, map, user.id, at);
        }

        let slot: number | null = null;
        if (request.job === 'team') {
          const taken = new Set(
            (await repo.listMine(map.id, user.id)).flatMap((r) =>
              r.teamSlot === null ? [] : [r.teamSlot],
            ),
          );
          slot =
            Array.from({ length: BATTLE_RULES.teamSize }, (_, i) => i).find((i) => !taken.has(i)) ??
            null;
          if (slot === null) throw new AppError('CONFLICT', MESSAGES.teamFull);
        }

        // Off the old job first: its post or work tile (banking what's ready).
        const events = await leaveOldJobs(repo, tx, map, user.id, [row], request.job, at);
        if (row.teamSlot !== null) await repo.setTeamSlot(row.squishy.id, null);
        if (request.job === 'team') await repo.setTeamSlot(row.squishy.id, slot);
        // Out on the land, gathering or training (it sleeps on its homestead,
        // #277), it leaves its habitat bed (housed or working, not both).
        const outOnLand = (request.job === 'gatherer' && workTile) || request.job === 'training';
        if (outOnLand && row.habitatBuildingId !== null) {
          await createBuildingsRepo(tx).setHabitat(row.squishy.id, null);
          events.push({
            mapId: map.id,
            type: 'squishy.housed',
            actorUserId: user.id,
            payload: {
              userId: user.id,
              squishyId: row.squishy.id,
              habitatId: null,
              fromHabitatId: row.habitatBuildingId,
            },
          });
        }
        if (request.job === 'gatherer' && workTile) {
          await repo.startWork(row.squishy.id, workTile.id, at);
        }
        // It sleeps on its homestead now (#277), in that tile's firelight or not.
        if (request.job === 'training' && groundsBefore) {
          await repo.startTraining(row.squishy.id, groundsBefore.id, at);
        }
        // A worker leaving work already said so (`leaveWork`); say the rest.
        if (!events.some((e) => e.type === 'squishy.assigned')) {
          events.push({
            mapId: map.id,
            type: 'squishy.assigned',
            actorUserId: user.id,
            payload: {
              userId: user.id,
              squishyId: row.squishy.id,
              job: request.job,
              from: null,
              to: workTile ? { q: workTile.q, r: workTile.r } : null,
            },
          });
        } else if (workTile) {
          // Moved from one tile to another: the arrival too.
          events.push({
            mapId: map.id,
            type: 'squishy.assigned',
            actorUserId: user.id,
            payload: {
              userId: user.id,
              squishyId: row.squishy.id,
              job: 'gatherer',
              from: null,
              to: { q: workTile.q, r: workTile.r },
            },
          });
        }
        await append(repo, events);
        return buildView(tx, repo, map, user.id, at);
      }),

    setTeam: (user, mapId, request) =>
      command(user, mapId, async ({ repo, tx, map, at }) => {
        const problem = teamProblem(request.squishyIds, BATTLE_RULES);
        if (problem) throw new AppError('VALIDATION_FAILED', problem);
        const mine = new Map(
          (await repo.listMine(map.id, user.id)).map((row) => [row.squishy.id, row]),
        );
        const wanted = request.squishyIds.map((id) => {
          const row = mine.get(id);
          if (!row) throw new AppError('NOT_FOUND', MESSAGES.noSquishy);
          return row;
        });
        const oldTeam = [...mine.values()].filter((r) => r.teamSlot !== null);
        const touched = [
          ...new Map([...oldTeam, ...wanted].map((r) => [r.squishy.id, r])).values(),
        ];
        const { rows } = await lockJobs(repo, touched);
        const byId = new Map(rows.map((r) => [r.squishy.id, r]));
        const joining = request.squishyIds.flatMap((id) => {
          const row = byId.get(id);
          return row && row.teamSlot === null ? [row] : [];
        });
        // Someone already on the team may stay while in the Hollow; nobody new joins from there.
        const away = joining.find((r) => r.squishy.state !== 'active');
        if (away) throw new AppError('CONFLICT', MESSAGES.inHollow(squishyName(away.squishy)));
        const same =
          oldTeam.length === request.squishyIds.length &&
          request.squishyIds.every((id, i) => byId.get(id)?.teamSlot === i);
        if (same) return buildView(tx, repo, map, user.id, at);

        // New team members leave their posts and work tiles first.
        const events = await leaveOldJobs(repo, tx, map, user.id, joining, 'team', at);
        await repo.clearTeam(map.id, user.id);
        for (const [slot, id] of request.squishyIds.entries()) await repo.setTeamSlot(id, slot);
        events.push({
          mapId: map.id,
          type: 'team.picked',
          actorUserId: user.id,
          payload: { userId: user.id, squishyIds: [...request.squishyIds] },
        });
        await append(repo, events);
        return buildView(tx, repo, map, user.id, at);
      }),

    collect: (user, mapId) =>
      command(user, mapId, async ({ repo, tx, map, at }) => {
        const working = (await repo.listMine(map.id, user.id)).filter(
          (r) => r.atWork && r.squishy.state === 'active',
        );
        // Work tiles locked first, so a capture can't land mid-collect.
        const { rows } = await lockJobs(repo, working);
        const owner = { mapId: map.id, userId: user.id };
        const granted: ItemCounts = {};
        const collected: string[] = [];
        const works = rows.map((row) => ({ row, work: workAt(row, map, at) }));
        await lockGrantRows(
          tx,
          map.id,
          works.flatMap(({ work }) => (work ? [{ userId: user.id, items: work.ready }] : [])),
        );
        for (const { row, work } of works) {
          if (!work || work.progress.cycles === 0) continue;
          if (!isEmpty(work.ready)) {
            await grantItems(tx, owner, work.ready, 'work', row.squishy.id);
            addInto(granted, work.ready);
          }
          await repo.moveWorkSince(row.squishy.id, new Date(work.progress.nextSinceMs));
          collected.push(row.squishy.id);
        }
        if (collected.length === 0) throw new AppError('CONFLICT', MESSAGES.notReady);
        if (!isEmpty(granted)) {
          await repo.appendEvent({
            mapId: map.id,
            type: 'work.collected',
            actorUserId: user.id,
            payload: { userId: user.id, squishyIds: collected, items: granted },
          });
        }
        return {
          granted,
          items: await createInventoryRepo(tx).list(owner),
          jobs: await buildView(tx, repo, map, user.id, at),
        };
      }),

    devReady: (user, mapId) =>
      command(user, mapId, async ({ repo, tx, map, at }) => {
        const working = (await repo.listMine(map.id, user.id)).filter((r) => r.atWork);
        const { rows } = await lockJobs(repo, working);
        for (const row of rows) {
          const work = workAt(row, map, at);
          if (!work || !row.workSince) continue;
          const since = row.workSince.getTime() - work.cycleSeconds * 1000;
          await repo.moveWorkSince(row.squishy.id, new Date(since));
        }
        return buildView(tx, repo, map, user.id, at);
      }),
  };
}
