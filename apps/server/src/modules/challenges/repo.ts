import type { ChallengeKind, ChallengeStatus } from '@heartpatch/shared';
import { and, asc, desc, eq, gt, inArray, lte, sql } from 'drizzle-orm';
import { withTransaction, type Executor, type Transaction } from '../../db/client.js';
import { appendGameEvent, type GameEvent, type NewGameEvent } from '../../db/game-events.js';
import { challenges, mapMembers, maps, users } from '../../db/schema.js';
import { activeMember } from '../maps/repo.js';

/** An ask between two players (#29, `challenges`). */
export interface ChallengeRow {
  id: string;
  mapId: string;
  kind: ChallengeKind;
  status: ChallengeStatus;
  fromUserId: string;
  toUserId: string;
  battleId: string | null;
  createdAt: Date;
  expiresAt: Date;
  answeredAt: Date | null;
}

/**
 * Storage for friendly battles' asks (#29). Plain queries; the service holds
 * the rules and runs each command in one transaction.
 */
export interface ChallengesRepo {
  transaction: <T>(fn: (repo: ChallengesTxRepo, tx: Transaction) => Promise<T>) => Promise<T>;
  insert: (row: {
    mapId: string;
    kind: ChallengeKind;
    fromUserId: string;
    toUserId: string;
    createdAt: Date;
    expiresAt: Date;
  }) => Promise<ChallengeRow>;
  find: (challengeId: string) => Promise<ChallengeRow | null>;
  /** Row-locks the ask until commit (lock order step 9c, #29). */
  lock: (challengeId: string) => Promise<ChallengeRow | null>;
  /** Waiting asks on the map to or from `userId`, oldest first. */
  pendingFor: (mapId: string, userId: string) => Promise<ChallengeRow[]>;
  /** Row-locks every waiting ask on the map, in id order (the owner's switch). */
  lockPending: (mapId: string, kind: ChallengeKind) => Promise<ChallengeRow[]>;
  /** Waiting asks past their time, row-locked in id order (expired lazily, on the next read). */
  lockExpired: (mapId: string, at: Date) => Promise<ChallengeRow[]>;
  settle: (
    challengeId: string,
    outcome: { status: Exclude<ChallengeStatus, 'pending'>; at: Date; battleId?: string },
  ) => Promise<void>;
  /** Asks `fromUserId` sent since `since` (any status), to `toUserId` if given. */
  sentSince: (mapId: string, fromUserId: string, since: Date, toUserId?: string) => Promise<number>;
  /** When `toUserId` last said "Not now!" to `fromUserId` on the map, or null. */
  lastNotNow: (mapId: string, fromUserId: string, toUserId: string) => Promise<Date | null>;
  /** Members' usernames, by id. */
  usernames: (userIds: readonly string[]) => Promise<Map<string, string>>;
  /** The owner's friendly-battle switch (`maps.friendly_challenges`). */
  friendlyEnabled: (mapId: string) => Promise<boolean>;
  setFriendly: (mapId: string, on: boolean) => Promise<void>;
  /** The active members of a map, by id. */
  memberIds: (mapId: string) => Promise<string[]>;
}

export interface ChallengesTxRepo extends ChallengesRepo {
  /** `appendGameEvent` in this transaction; call it as the last write. */
  appendEvent: <T extends NewGameEvent['type']>(event: NewGameEvent<T>) => Promise<GameEvent>;
}

type RawChallenge = typeof challenges.$inferSelect;

const toRow = (row: RawChallenge): ChallengeRow => ({
  id: row.id,
  mapId: row.mapId,
  kind: row.kind,
  status: row.status,
  fromUserId: row.fromUserId,
  toUserId: row.toUserId,
  battleId: row.battleId,
  createdAt: row.createdAt,
  expiresAt: row.expiresAt,
  answeredAt: row.answeredAt,
});

export function createChallengesRepo(db: Executor): ChallengesRepo {
  return queries(db);
}

function createChallengesTxRepo(tx: Transaction): ChallengesTxRepo {
  return { ...queries(tx), appendEvent: (event) => appendGameEvent(tx, event) };
}

function queries(db: Executor): ChallengesRepo {
  return {
    transaction: (fn) => withTransaction(db, (tx) => fn(createChallengesTxRepo(tx), tx)),

    insert: async (row) => {
      const [inserted] = await db.insert(challenges).values(row).returning();
      if (!inserted) throw new Error('insert: no challenge row returned');
      return toRow(inserted);
    },

    find: async (challengeId) => {
      const [row] = await db.select().from(challenges).where(eq(challenges.id, challengeId));
      return row ? toRow(row) : null;
    },

    lock: async (challengeId) => {
      const [row] = await db
        .select()
        .from(challenges)
        .where(eq(challenges.id, challengeId))
        .for('update');
      return row ? toRow(row) : null;
    },

    pendingFor: async (mapId, userId) => {
      const rows = await db
        .select()
        .from(challenges)
        .where(
          and(
            eq(challenges.mapId, mapId),
            eq(challenges.status, 'pending'),
            sql`(${challenges.fromUserId} = ${userId} or ${challenges.toUserId} = ${userId})`,
          ),
        )
        .orderBy(asc(challenges.createdAt));
      return rows.map(toRow);
    },

    lockPending: async (mapId, kind) => {
      const rows = await db
        .select()
        .from(challenges)
        .where(
          and(
            eq(challenges.mapId, mapId),
            eq(challenges.kind, kind),
            eq(challenges.status, 'pending'),
          ),
        )
        .orderBy(asc(challenges.id))
        .for('update');
      return rows.map(toRow);
    },

    lockExpired: async (mapId, at) => {
      const rows = await db
        .select()
        .from(challenges)
        .where(
          and(
            eq(challenges.mapId, mapId),
            eq(challenges.status, 'pending'),
            lte(challenges.expiresAt, at),
          ),
        )
        .orderBy(asc(challenges.id))
        .for('update');
      return rows.map(toRow);
    },

    settle: async (challengeId, { status, at, battleId }) => {
      await db
        .update(challenges)
        .set({ status, answeredAt: at, ...(battleId !== undefined && { battleId }) })
        .where(eq(challenges.id, challengeId));
    },

    sentSince: async (mapId, fromUserId, since, toUserId) => {
      const [row] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(challenges)
        .where(
          and(
            eq(challenges.mapId, mapId),
            eq(challenges.kind, 'friendly'),
            eq(challenges.fromUserId, fromUserId),
            gt(challenges.createdAt, since),
            toUserId === undefined ? undefined : eq(challenges.toUserId, toUserId),
          ),
        );
      return row?.count ?? 0;
    },

    lastNotNow: async (mapId, fromUserId, toUserId) => {
      const [row] = await db
        .select({ at: challenges.answeredAt })
        .from(challenges)
        .where(
          and(
            eq(challenges.mapId, mapId),
            eq(challenges.kind, 'friendly'),
            eq(challenges.fromUserId, fromUserId),
            eq(challenges.toUserId, toUserId),
            eq(challenges.status, 'declined'),
          ),
        )
        .orderBy(desc(challenges.answeredAt))
        .limit(1);
      return row?.at ?? null;
    },

    usernames: async (userIds) => {
      if (userIds.length === 0) return new Map();
      const rows = await db
        .select({ id: users.id, username: users.username })
        .from(users)
        .where(inArray(users.id, [...userIds]));
      return new Map(rows.map((r) => [r.id, r.username]));
    },

    friendlyEnabled: async (mapId) => {
      const [row] = await db
        .select({ on: maps.friendlyChallenges })
        .from(maps)
        .where(eq(maps.id, mapId));
      return row?.on ?? false;
    },

    setFriendly: async (mapId, on) => {
      await db.update(maps).set({ friendlyChallenges: on }).where(eq(maps.id, mapId));
    },

    memberIds: async (mapId) => {
      const rows = await db
        .select({ userId: mapMembers.userId })
        .from(mapMembers)
        .where(activeMember(mapId));
      return rows.map((r) => r.userId);
    },
  };
}
