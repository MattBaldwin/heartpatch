import { and, asc, count, eq, gt, inArray, isNotNull, isNull, lte } from 'drizzle-orm';
import { withTransaction, type Executor } from '../../db/client.js';
import {
  keepers,
  mapMembers,
  maps,
  milestoneProgress,
  milestoneRewards,
  users,
} from '../../db/schema.js';

/** What the consumer needs to know about the patch an event happened on. */
export interface MapContext {
  kind: 'multiplayer' | 'tutorial';
  timeZone: string;
  /** Active members who had joined by the event (decision F). */
  members: number;
  /** A tutorial map's player (its owner); null on patches. */
  tutorialPlayer: string | null;
}

/** A track's stored progress (`milestone_progress`). */
export interface ProgressRow {
  milestoneId: string;
  /** Hundredths of a step (`MILESTONE_UNIT`). */
  progress: number;
}

/** A tier earned (`milestone_rewards`). */
export interface RewardRow {
  id: string;
  milestoneId: string;
  tier: number;
  earnedAt: Date;
  seenAt: Date | null;
}

export interface NewReward {
  id: string;
  userId: string;
  milestoneId: string;
  tier: number;
  mapId: string | null;
  at: Date;
}

/**
 * Milestone storage (`milestone_progress`, `milestone_rewards`, the worn
 * title on `keepers`). Plain queries; the consumer and service decide the
 * rules. Lock order (tech spec §7): progress rows, then reward rows, both
 * before the account's `coin_balances` row.
 */
export interface MilestonesRepo {
  transaction: <T>(fn: (repo: MilestonesRepo, tx: Executor) => Promise<T>) => Promise<T>;
  /** The map's kind, zone, members by `at`, and its tutorial player. Null if it's gone. */
  mapContext: (mapId: string, at: Date) => Promise<MapContext | null>;
  /**
   * Adds `amount` hundredths to a track, under the row's lock until commit.
   * With a `key` (a "kinds of" track), only a key not counted yet adds.
   * Returns the new total, or null if nothing changed.
   */
  addProgress: (change: {
    userId: string;
    milestoneId: string;
    amount: number;
    key: string | null;
    at: Date;
  }) => Promise<number | null>;
  listProgress: (userId: string) => Promise<ProgressRow[]>;
  /** Records a tier; false if it was already earned (nothing written). */
  insertReward: (reward: NewReward) => Promise<boolean>;
  /** Every tier the player earned, oldest first. */
  listRewards: (userId: string) => Promise<RewardRow[]>;
  /** Marks the player's own rewards celebrated (others' ids are ignored). */
  markSeen: (userId: string, ids: readonly string[], at: Date) => Promise<void>;
  /** When the player first finished the tutorial, or null. */
  tutorialCompletedAt: (userId: string) => Promise<Date | null>;
  /**
   * Players who finished the tutorial and don't have `milestoneId` tier 1 yet,
   * by id, after `after` (null: from the start).
   */
  missingTutorialReward: (
    milestoneId: string,
    after: string | null,
    limit: number,
  ) => Promise<string[]>;
  /** The worn title, or null; undefined if the player has no Keeper. */
  wornTitle: (userId: string) => Promise<string | null | undefined>;
  /** Sets the worn title; false if the player has no Keeper to show it on. */
  setWornTitle: (userId: string, titleId: string | null, at: Date) => Promise<boolean>;
}

export function createMilestonesRepo(db: Executor): MilestonesRepo {
  return {
    transaction: (fn) => withTransaction(db, (tx) => fn(createMilestonesRepo(tx), tx)),

    mapContext: async (mapId, at) => {
      const [map] = await db
        .select({ kind: maps.kind, timeZone: maps.timeZone })
        .from(maps)
        .where(eq(maps.id, mapId));
      if (!map) return null;
      const [members] = await db
        .select({ n: count() })
        .from(mapMembers)
        .where(
          and(
            eq(mapMembers.mapId, mapId),
            eq(mapMembers.status, 'active'),
            lte(mapMembers.joinedAt, at),
          ),
        );
      let tutorialPlayer: string | null = null;
      if (map.kind === 'tutorial') {
        const [owner] = await db
          .select({ userId: mapMembers.userId })
          .from(mapMembers)
          .where(and(eq(mapMembers.mapId, mapId), eq(mapMembers.role, 'owner')));
        tutorialPlayer = owner?.userId ?? null;
      }
      return { ...map, members: members?.n ?? 0, tutorialPlayer };
    },

    addProgress: async ({ userId, milestoneId, amount, key, at }) => {
      await db
        .insert(milestoneProgress)
        .values({ userId, milestoneId, progress: 0, kinds: [], updatedAt: at })
        .onConflictDoNothing();
      const [row] = await db
        .select({ progress: milestoneProgress.progress, kinds: milestoneProgress.kinds })
        .from(milestoneProgress)
        .where(
          and(eq(milestoneProgress.userId, userId), eq(milestoneProgress.milestoneId, milestoneId)),
        )
        .for('update');
      if (!row) return null;
      if (key !== null && row.kinds.includes(key)) return null;
      const progress = row.progress + amount;
      await db
        .update(milestoneProgress)
        .set({ progress, kinds: key === null ? row.kinds : [...row.kinds, key], updatedAt: at })
        .where(
          and(eq(milestoneProgress.userId, userId), eq(milestoneProgress.milestoneId, milestoneId)),
        );
      return progress;
    },

    listProgress: (userId) =>
      db
        .select({
          milestoneId: milestoneProgress.milestoneId,
          progress: milestoneProgress.progress,
        })
        .from(milestoneProgress)
        .where(eq(milestoneProgress.userId, userId)),

    insertReward: async ({ id, userId, milestoneId, tier, mapId, at }) => {
      const inserted = await db
        .insert(milestoneRewards)
        .values({ id, userId, milestoneId, tier, mapId, earnedAt: at })
        .onConflictDoNothing()
        .returning({ id: milestoneRewards.id });
      return inserted.length > 0;
    },

    listRewards: (userId) =>
      db
        .select({
          id: milestoneRewards.id,
          milestoneId: milestoneRewards.milestoneId,
          tier: milestoneRewards.tier,
          earnedAt: milestoneRewards.earnedAt,
          seenAt: milestoneRewards.seenAt,
        })
        .from(milestoneRewards)
        .where(eq(milestoneRewards.userId, userId))
        .orderBy(
          asc(milestoneRewards.earnedAt),
          asc(milestoneRewards.milestoneId),
          asc(milestoneRewards.tier),
        ),

    markSeen: async (userId, ids, at) => {
      await db
        .update(milestoneRewards)
        .set({ seenAt: at })
        .where(
          and(
            eq(milestoneRewards.userId, userId),
            inArray(milestoneRewards.id, [...ids]),
            isNull(milestoneRewards.seenAt),
          ),
        );
    },

    tutorialCompletedAt: async (userId) => {
      const [row] = await db
        .select({ at: users.tutorialCompletedAt })
        .from(users)
        .where(eq(users.id, userId));
      return row?.at ?? null;
    },

    missingTutorialReward: async (milestoneId, after, limit) => {
      const rows = await db
        .select({ id: users.id })
        .from(users)
        .leftJoin(
          milestoneRewards,
          and(
            eq(milestoneRewards.userId, users.id),
            eq(milestoneRewards.milestoneId, milestoneId),
            eq(milestoneRewards.tier, 1),
          ),
        )
        .where(
          and(
            isNotNull(users.tutorialCompletedAt),
            isNull(milestoneRewards.id),
            after === null ? undefined : gt(users.id, after),
          ),
        )
        .orderBy(asc(users.id))
        .limit(limit);
      return rows.map((r) => r.id);
    },

    wornTitle: async (userId) => {
      const [row] = await db
        .select({ titleId: keepers.titleId })
        .from(keepers)
        .where(eq(keepers.userId, userId));
      return row ? row.titleId : undefined;
    },

    setWornTitle: async (userId, titleId, at) => {
      const updated = await db
        .update(keepers)
        .set({ titleId, updatedAt: at })
        .where(eq(keepers.userId, userId))
        .returning({ userId: keepers.userId });
      return updated.length > 0;
    },
  };
}
