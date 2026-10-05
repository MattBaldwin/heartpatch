import {
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
  workCycleSeconds,
  workProgress,
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
  type WorkSource,
  type WorkStatus,
} from '@heartpatch/shared';
import { SERVER_GAME_DATA } from '@heartpatch/shared/server';
import type { Executor } from '../../db/client.js';
import type { NewGameEvent } from '../../db/game-events.js';
import { AppError } from '../../lib/errors.js';
import { mapLocalTime, type Clock } from '../../lib/time.js';
import { litSafeTiles } from '../buildings/hearthfire.js';
import { createBuildingsRepo } from '../buildings/repo.js';
import { createInventoryRepo } from '../inventory/repo.js';
import { grantItems, seasonsOn } from '../inventory/service.js';
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
 * had ready; a part-done cycle is let go.
 */

// Kid-readable messages (style guide §6).
const MESSAGES = {
  noMap: "We couldn't find that patch.",
  noSquishy: "We couldn't find that squishy.",
  inHollow: (name: string) => `${name} is in the Hollow. Rescue them first!`,
  noTile: "We couldn't find that spot.",
  notYours: 'Squishies can only gather on your own land.',
  nothingHere: "There's nothing to gather here.",
  outOfSeason: (resource: string, season: string) => `${resource} only turn up around ${season}!`,
  spotTaken: (name: string) => `${name} is already gathering here!`,
  teamFull: 'Your team is full! Take someone off first.',
  changed: 'Something just changed. Try again!',
  notReady: 'Nothing ready yet. Check back soon!',
} as const;

const SPECIES = new Map(
  [...GAME_DATA.species, ...SERVER_GAME_DATA.secretSpecies].map((s) => [s.id, s]),
);
const SEASON_NAMES = new Map(GAME_DATA.seasons.map((s) => [s.id, s.name]));

/** What to call one of my squishies in a message: its nickname, else its species. */
const squishyName = (s: Pick<OwnedSquishy, 'nickname' | 'speciesId'>): string =>
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
  const source = workSource(row.workTile, GAME_DATA.resources, JOB_RULES);
  if (!source) return null;
  const speedPercent = workSpeedPercent(traitsOf(row.squishy), source.resource, JOB_RULES);
  const cycleSeconds = workCycleSeconds(
    source.seconds,
    speedPercent,
    JOB_RULES,
    gameplayOverrides(map.kind),
  );
  const progress = workProgress(row.workSince.getTime(), at.getTime(), cycleSeconds, JOB_RULES);
  const ready = workYield(
    source,
    progress.finishedMs,
    GAME_DATA.resources,
    seasonsAtFor(map.timeZone),
  );
  return { tile: row.workTile, source, speedPercent, cycleSeconds, progress, ready };
}

const isEmpty = (items: ItemCounts) => Object.keys(items).length === 0;

function addInto(total: ItemCounts, items: ItemCounts): void {
  for (const [id, n] of Object.entries(items)) total[id] = (total[id] ?? 0) + n;
}

const tileOf = (t: { q: number; r: number } | null) => (t ? { q: t.q, r: t.r } : null);

/**
 * Takes squishies off their work tiles, banking what each had ready into its
 * owner's bag (ledger reason `work`, ref the squishy). The caller has locked
 * these squishies (tech spec §7: squishies, then the inventory rows this
 * takes); a stale work row (land that changed hands) is just cleared.
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
): Promise<NewGameEvent[]> {
  const repo = createSquishyJobsRepo(tx);
  const rows = (await repo.listByIds(squishyIds)).filter((r) => r.workTile !== null);
  const banked = new Map<string, { squishyIds: string[]; items: ItemCounts }>();
  const events: NewGameEvent[] = [];
  for (const row of rows) {
    // Nightfall calls this for a squishy it just took: its day's work still counts.
    const work = workAt(row, map, at, true);
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
    if (work) {
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
    const homes = new Map<string, { q: number; r: number }[]>();
    for (const { ownerUserId, q, r } of homeTiles) {
      homes.set(ownerUserId, [...(homes.get(ownerUserId) ?? []), { q, r }]);
    }
    const night = tonightOf(mapLocalTime(at, map.timeZone), HOME_BASE_RULES);
    return litSafeTiles(
      fires.filter((b) => b.kind === 'hearthfire'),
      (owner) => homes.get(owner) ?? [],
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
    const [rows, owned, safe] = await Promise.all([
      repo.listMine(map.id, userId),
      repo.listOwnedTiles(map.id, userId),
      firelitTiles(tx, repo, map, at),
    ]);
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
      return {
        squishy: row.squishy,
        job: jobOf({ teamSlot: row.teamSlot, atWork: work !== null, onWatch }),
        teamSlot: row.teamSlot,
        post: onWatch ? tileOf(row.post) : null,
        habitatId: row.habitatBuildingId,
        work: status,
      };
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
          quantity: source.quantity,
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
        const { rows, tiles } = await lockJobs(repo, [before], target ? [target.id] : []);
        const [row] = rows;
        if (!row) throw new AppError('NOT_FOUND', MESSAGES.noSquishy);
        const name = squishyName(row.squishy);
        if (row.squishy.state !== 'active') throw new AppError('CONFLICT', MESSAGES.inHollow(name));
        const current = jobOf({
          teamSlot: row.teamSlot,
          atWork: row.atWork,
          onWatch: row.onWatch,
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
        } else if (request.job === current) {
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
        if (request.job === 'gatherer' && workTile) {
          // Out on the land, it leaves its habitat bed (housed or working, not both).
          if (row.habitatBuildingId !== null) {
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
          await repo.startWork(row.squishy.id, workTile.id, at);
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
        for (const row of rows) {
          const work = workAt(row, map, at);
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
