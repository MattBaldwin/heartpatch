import { ElementIdSchema, FeelingIdSchema, type OwnedSquishy } from '@heartpatch/shared';
import { and, asc, eq, getTableName, inArray, isNotNull, sql, type AnyColumn } from 'drizzle-orm';
import { alias, type AnyPgColumn } from 'drizzle-orm/pg-core';
import { withTransaction, type Executor, type Transaction } from '../../db/client.js';
import { appendGameEvent, type GameEvent, type NewGameEvent } from '../../db/game-events.js';
import {
  buildings,
  squishies,
  tileAttacks,
  tileDefenders,
  tileExplore,
  tiles,
  tileTending,
} from '../../db/schema.js';
import { squishyOnWatch } from '../territory/repo.js';

/** A tile as the job board needs it. */
export interface JobTileRow {
  id: string;
  q: number;
  r: number;
  terrain: string;
  nodeResource: string | null;
  homeSlot: number | null;
  ownerUserId: string | null;
  /**
   * The working squishy's owner's explore row for this tile, when they've
   * fully explored it (#199): its homestead columns. Work tiles only.
   */
  homestead?: { joinedAt: Date | null; pausedAt: Date | null; resumedAt: Date | null } | null;
}

/** One of a player's squishies with everything its job depends on. */
export interface JobRow {
  squishy: OwnedSquishy;
  habitatBuildingId: string | null;
  teamSlot: number | null;
  /** The work tile as stored (maybe stale), with when its count started. */
  workTile: JobTileRow | null;
  workSince: Date | null;
  /** It works a tile its owner still holds, untouched since it started (`squishyAtWork`). */
  atWork: boolean;
  /**
   * When its work tile was first captured after it started there, or null:
   * cycles finished before then still go in its owner's bag (owner decision
   * 2026-10-06); only the unfinished one is lost.
   */
  lostAt: Date | null;
  /** Its watch post as stored (maybe on land that changed hands). */
  post: { tileId: string; q: number; r: number } | null;
  /** It stands watch (`squishyOnWatch`). */
  onWatch: boolean;
  /**
   * The Training Grounds it practices at (owner decision 2026-10-06), with
   * that building's content id and level, and when the current count of XP
   * started; null when it isn't training.
   */
  training: {
    buildingRowId: string;
    buildingId: string;
    level: number;
    since: Date;
    /** Its homestead tile (#277): it sleeps there. */
    tile: { id: string; q: number; r: number };
    /** Its owner's row for that tile: the homestead's pauses (training naps while cut off). */
    homestead: { joinedAt: Date | null; pausedAt: Date | null; resumedAt: Date | null } | null;
  } | null;
}

/**
 * The one SQL spelling of "at work" (owner decisions 2026-10-04; like
 * territory's `squishyOnWatch`): the squishy has a work tile its owner still
 * holds, and nobody has captured that tile since it started there, so work
 * on land that changed hands (even land won back) has stopped. Not
 * state-aware: callers add `state` where it matters. `squishy` is a
 * `squishies` row of the outer query, written `"table"."column"`.
 */
export const squishyAtWork = (
  squishy: {
    ownerUserId: AnyPgColumn;
    workTileId: AnyPgColumn;
    workStartedAt: AnyPgColumn;
  } = squishies,
) => {
  const outer = (column: AnyPgColumn) =>
    sql`${sql.identifier(getTableName(column.table))}.${sql.identifier(column.name)}`;
  const tile = (column: AnyColumn) => sql`work_tile.${sql.identifier(column.name)}`;
  const attack = (column: AnyColumn) => sql`work_attack.${sql.identifier(column.name)}`;
  return sql<boolean>`(${outer(squishy.workTileId)} is not null and exists (
    select 1 from ${tiles} as work_tile
    where ${tile(tiles.id)} = ${outer(squishy.workTileId)}
      and ${tile(tiles.ownerUserId)} = ${outer(squishy.ownerUserId)}
  ) and not exists (
    select 1 from ${tileAttacks} as work_attack
    where ${attack(tileAttacks.tileId)} = ${outer(squishy.workTileId)}
      and ${attack(tileAttacks.outcome)} = 'captured'
      and ${attack(tileAttacks.endedAt)} > ${outer(squishy.workStartedAt)}
  ))`;
};

/**
 * The one SQL spelling of "when this land changed hands" (owner decision
 * 2026-10-06), read the way `squishyAtWork` reads captures: the first
 * `captured` attack on `tileId` that ended after `since`, or the time the
 * land went wild after `since` (land that misses you, `tile_tending.wild_at`),
 * whichever came first, or null. Work and gathers finished before then still
 * go in the bag. Both are columns of the outer query. `wild_at` keeps only the
 * latest time a tile went wild; a capture in between is found first anyway.
 */
export const firstCaptureSince = (tileId: AnyPgColumn, since: AnyPgColumn) => {
  // Outer columns written `"table"."column"` and the subqueries' tables
  // aliased, so `tile_id` / `started_at` can never bind to their own columns.
  const outer = (column: AnyPgColumn) =>
    sql`${sql.identifier(getTableName(column.table))}.${sql.identifier(column.name)}`;
  const attack = (column: AnyColumn) => sql`land_capture.${sql.identifier(column.name)}`;
  const wild = (column: AnyColumn) => sql`land_wild.${sql.identifier(column.name)}`;
  // `least` skips nulls, so either one alone is the answer.
  return sql<Date | null>`least(
    (
      select min(${attack(tileAttacks.endedAt)}) from ${tileAttacks} as land_capture
      where ${attack(tileAttacks.tileId)} = ${outer(tileId)}
        and ${attack(tileAttacks.outcome)} = 'captured'
        and ${attack(tileAttacks.endedAt)} > ${outer(since)}
    ),
    (
      select ${wild(tileTending.wildAt)} from ${tileTending} as land_wild
      where ${wild(tileTending.tileId)} = ${outer(tileId)}
        and ${wild(tileTending.wildAt)} > ${outer(since)}
    )
  )`.mapWith(tileAttacks.endedAt);
};

/**
 * Squishy job storage. Plain queries; the service decides the rules and
 * holds the transaction. Lock order (tech spec §7): the member row (maps
 * repo `lockMember`), tiles in id order, squishies in id order, inventory
 * rows (`grantItems`), then `maps` (the events, last).
 */
export interface SquishyJobsRepo {
  transaction: <T>(fn: (repo: SquishyJobsTxRepo, tx: Executor) => Promise<T>) => Promise<T>;

  /** The player's squishies on the map with their jobs, in id order. Unlocked. */
  listMine: (mapId: string, userId: string) => Promise<JobRow[]>;
  /** These squishies with their jobs (any owner), in id order. Unlocked. */
  listByIds: (ids: readonly string[]) => Promise<JobRow[]>;
  /** The tiles the player owns. */
  listOwnedTiles: (mapId: string, userId: string) => Promise<JobTileRow[]>;
  /** Every home tile with an owner (whose fires protect what). */
  homeTiles: (mapId: string) => Promise<{ ownerUserId: string; q: number; r: number }[]>;
  tileAt: (mapId: string, q: number, r: number) => Promise<JobTileRow | null>;
  /** Locks tiles in id order (`FOR NO KEY UPDATE`) until commit; returns them. */
  lockTiles: (ids: readonly string[]) => Promise<JobTileRow[]>;
  /** Locks squishies in id order (`FOR NO KEY UPDATE`, like housing and posting) until commit. */
  lockSquishies: (ids: readonly string[]) => Promise<void>;

  setTeamSlot: (squishyId: string, slot: number | null) => Promise<void>;
  /** Takes every squishy of the player off the team. */
  clearTeam: (mapId: string, userId: string) => Promise<void>;
  startWork: (squishyId: string, tileId: string, at: Date) => Promise<void>;
  /** The next cycle count starts here (after a collect). */
  moveWorkSince: (squishyId: string, since: Date) => Promise<void>;
  stopWork: (squishyId: string) => Promise<void>;
  startTraining: (squishyId: string, buildingRowId: string, at: Date) => Promise<void>;
  /** The next XP count starts here (after a settle). */
  moveTrainingSince: (squishyId: string, since: Date) => Promise<void>;
  stopTraining: (squishyId: string) => Promise<void>;
  /** How many squishies practice at this Training Grounds, any state. */
  countTrainees: (buildingRowId: string) => Promise<number>;
  /** Off its watch post; returns the tile it left, if it had one. */
  leavePost: (squishyId: string) => Promise<string | null>;
}

export interface SquishyJobsTxRepo extends SquishyJobsRepo {
  /** `appendGameEvent` in this transaction; call it as the last write. */
  appendEvent: <T extends NewGameEvent['type']>(event: NewGameEvent<T>) => Promise<GameEvent>;
}

const workTile = alias(tiles, 'job_work_tile');
const postTile = alias(tiles, 'job_post_tile');
const trainingBuilding = alias(buildings, 'job_training_building');
const trainingTile = alias(tiles, 'job_training_tile');
const trainingExplore = alias(tileExplore, 'job_training_explore');

const tileColumns = {
  id: tiles.id,
  q: tiles.q,
  r: tiles.r,
  terrain: tiles.terrain,
  nodeResource: tiles.nodeResource,
  homeSlot: tiles.homeSlot,
  ownerUserId: tiles.ownerUserId,
};

export function createSquishyJobsRepo(db: Executor): SquishyJobsRepo {
  return queries(db);
}

export function createSquishyJobsTxRepo(tx: Transaction): SquishyJobsTxRepo {
  return { ...queries(tx), appendEvent: (event) => appendGameEvent(tx, event) };
}

function queries(db: Executor): SquishyJobsRepo {
  const selectJobs = () =>
    db
      .select({
        id: squishies.id,
        mapId: squishies.mapId,
        ownerUserId: squishies.ownerUserId,
        speciesId: squishies.speciesId,
        element: squishies.element,
        feeling: squishies.feeling,
        nickname: squishies.nickname,
        level: squishies.level,
        xp: squishies.xp,
        state: squishies.state,
        habitatBuildingId: squishies.habitatBuildingId,
        teamSlot: squishies.teamSlot,
        workSince: squishies.workSince,
        atWork: squishyAtWork(),
        lostAt: firstCaptureSince(squishies.workTileId, squishies.workStartedAt),
        onWatch: squishyOnWatch(),
        workTileId: workTile.id,
        workQ: workTile.q,
        workR: workTile.r,
        workTerrain: workTile.terrain,
        workNode: workTile.nodeResource,
        workHomeSlot: workTile.homeSlot,
        workOwner: workTile.ownerUserId,
        workExplored: tileExplore.completedAt,
        workJoinedAt: tileExplore.joinedAt,
        workPausedAt: tileExplore.pausedAt,
        workResumedAt: tileExplore.resumedAt,
        postTileId: postTile.id,
        postQ: postTile.q,
        postR: postTile.r,
        trainingRowId: trainingBuilding.id,
        trainingContentId: trainingBuilding.buildingId,
        trainingLevel: trainingBuilding.level,
        trainingSince: squishies.trainingSince,
        trainingTileId: trainingTile.id,
        trainingQ: trainingTile.q,
        trainingR: trainingTile.r,
        trainingExplored: trainingExplore.completedAt,
        trainingJoinedAt: trainingExplore.joinedAt,
        trainingPausedAt: trainingExplore.pausedAt,
        trainingResumedAt: trainingExplore.resumedAt,
      })
      .from(squishies)
      .leftJoin(workTile, eq(workTile.id, squishies.workTileId))
      // The owner's own row for the work tile: a homestead's bonus and pauses (#199).
      .leftJoin(
        tileExplore,
        and(
          eq(tileExplore.tileId, squishies.workTileId),
          eq(tileExplore.userId, squishies.ownerUserId),
          isNotNull(tileExplore.completedAt),
        ),
      )
      .leftJoin(tileDefenders, eq(tileDefenders.squishyId, squishies.id))
      .leftJoin(postTile, eq(postTile.id, tileDefenders.tileId))
      .leftJoin(trainingBuilding, eq(trainingBuilding.id, squishies.trainingBuildingId))
      .leftJoin(trainingTile, eq(trainingTile.id, trainingBuilding.tileId))
      // The owner's own row for the Training Grounds' homestead: its pauses (#277).
      .leftJoin(
        trainingExplore,
        and(
          eq(trainingExplore.tileId, trainingBuilding.tileId),
          eq(trainingExplore.userId, squishies.ownerUserId),
          isNotNull(trainingExplore.completedAt),
        ),
      );

  type Raw = Awaited<ReturnType<ReturnType<typeof selectJobs>['execute']>>[number];
  const toJob = (r: Raw): JobRow => ({
    squishy: {
      id: r.id,
      mapId: r.mapId,
      ownerUserId: r.ownerUserId,
      speciesId: r.speciesId,
      // Content ids are plain text in the database; check them on the way out.
      element: ElementIdSchema.parse(r.element),
      feeling: FeelingIdSchema.parse(r.feeling),
      nickname: r.nickname,
      level: r.level,
      xp: r.xp,
      state: r.state,
    },
    habitatBuildingId: r.habitatBuildingId,
    teamSlot: r.teamSlot,
    workTile:
      r.workTileId === null || r.workQ === null || r.workR === null || r.workTerrain === null
        ? null
        : {
            id: r.workTileId,
            q: r.workQ,
            r: r.workR,
            terrain: r.workTerrain,
            nodeResource: r.workNode,
            homeSlot: r.workHomeSlot,
            ownerUserId: r.workOwner,
            homestead:
              r.workExplored === null
                ? null
                : {
                    joinedAt: r.workJoinedAt,
                    pausedAt: r.workPausedAt,
                    resumedAt: r.workResumedAt,
                  },
          },
    workSince: r.workSince,
    atWork: r.atWork,
    lostAt: r.lostAt,
    post:
      r.postTileId === null || r.postQ === null || r.postR === null
        ? null
        : { tileId: r.postTileId, q: r.postQ, r: r.postR },
    onWatch: r.onWatch,
    training:
      r.trainingRowId === null ||
      r.trainingContentId === null ||
      r.trainingLevel === null ||
      r.trainingSince === null ||
      r.trainingTileId === null ||
      r.trainingQ === null ||
      r.trainingR === null
        ? null
        : {
            buildingRowId: r.trainingRowId,
            buildingId: r.trainingContentId,
            level: r.trainingLevel,
            since: r.trainingSince,
            tile: { id: r.trainingTileId, q: r.trainingQ, r: r.trainingR },
            homestead:
              r.trainingExplored === null
                ? null
                : {
                    joinedAt: r.trainingJoinedAt,
                    pausedAt: r.trainingPausedAt,
                    resumedAt: r.trainingResumedAt,
                  },
          },
  });

  return {
    transaction: (fn) => withTransaction(db, (tx) => fn(createSquishyJobsTxRepo(tx), tx)),

    listMine: async (mapId, userId) =>
      (
        await selectJobs()
          .where(and(eq(squishies.mapId, mapId), eq(squishies.ownerUserId, userId)))
          .orderBy(asc(squishies.id))
      ).map(toJob),

    listByIds: async (ids) => {
      if (ids.length === 0) return [];
      return (
        await selectJobs()
          .where(inArray(squishies.id, [...ids]))
          .orderBy(asc(squishies.id))
      ).map(toJob);
    },

    listOwnedTiles: (mapId, userId) =>
      db
        .select(tileColumns)
        .from(tiles)
        .where(and(eq(tiles.mapId, mapId), eq(tiles.ownerUserId, userId)))
        .orderBy(asc(tiles.q), asc(tiles.r)),

    homeTiles: async (mapId) => {
      const rows = await db
        .select({ ownerUserId: tiles.ownerUserId, q: tiles.q, r: tiles.r })
        .from(tiles)
        .where(
          and(eq(tiles.mapId, mapId), isNotNull(tiles.homeSlot), isNotNull(tiles.ownerUserId)),
        );
      return rows.flatMap((r) =>
        r.ownerUserId === null ? [] : [{ ...r, ownerUserId: r.ownerUserId }],
      );
    },

    tileAt: async (mapId, q, r) => {
      const [row] = await db
        .select(tileColumns)
        .from(tiles)
        .where(and(eq(tiles.mapId, mapId), eq(tiles.q, q), eq(tiles.r, r)));
      return row ?? null;
    },

    lockTiles: async (ids) => {
      if (ids.length === 0) return [];
      return (
        db
          .select(tileColumns)
          .from(tiles)
          .where(inArray(tiles.id, [...ids]))
          // Id order (tech spec §7 "Lock order"), so two transactions never deadlock.
          .orderBy(asc(tiles.id))
          .for('no key update')
      );
    },

    lockSquishies: async (ids) => {
      if (ids.length === 0) return;
      await db
        .select({ id: squishies.id })
        .from(squishies)
        .where(inArray(squishies.id, [...ids]))
        // Id order, like nightfall's (tech spec §7 "Lock order").
        .orderBy(asc(squishies.id))
        .for('no key update');
    },

    setTeamSlot: async (squishyId, slot) => {
      await db.update(squishies).set({ teamSlot: slot }).where(eq(squishies.id, squishyId));
    },

    clearTeam: async (mapId, userId) => {
      await db
        .update(squishies)
        .set({ teamSlot: null })
        .where(
          and(
            eq(squishies.mapId, mapId),
            eq(squishies.ownerUserId, userId),
            isNotNull(squishies.teamSlot),
          ),
        );
    },

    startWork: async (squishyId, tileId, at) => {
      await db
        .update(squishies)
        .set({ workTileId: tileId, workSince: at, workStartedAt: at })
        .where(eq(squishies.id, squishyId));
    },

    moveWorkSince: async (squishyId, since) => {
      await db.update(squishies).set({ workSince: since }).where(eq(squishies.id, squishyId));
    },

    stopWork: async (squishyId) => {
      await db
        .update(squishies)
        .set({ workTileId: null, workSince: null, workStartedAt: null })
        .where(eq(squishies.id, squishyId));
    },

    startTraining: async (squishyId, buildingRowId, at) => {
      await db
        .update(squishies)
        .set({ trainingBuildingId: buildingRowId, trainingSince: at })
        .where(eq(squishies.id, squishyId));
    },

    moveTrainingSince: async (squishyId, since) => {
      await db.update(squishies).set({ trainingSince: since }).where(eq(squishies.id, squishyId));
    },

    stopTraining: async (squishyId) => {
      await db
        .update(squishies)
        .set({ trainingBuildingId: null, trainingSince: null })
        .where(eq(squishies.id, squishyId));
    },

    countTrainees: async (buildingRowId) => {
      const [row] = await db
        .select({ n: sql<number>`count(*)::int` })
        .from(squishies)
        .where(eq(squishies.trainingBuildingId, buildingRowId));
      return row?.n ?? 0;
    },

    leavePost: async (squishyId) => {
      const [row] = await db
        .delete(tileDefenders)
        .where(eq(tileDefenders.squishyId, squishyId))
        .returning({ tileId: tileDefenders.tileId });
      return row?.tileId ?? null;
    },
  };
}
