import type { HelperCandidate, HelperReason, MyHelper, PublicUser } from '@heartpatch/shared';
import { and, asc, count, eq, gte, inArray, ne, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { withTransaction, type Executor } from '../../db/client.js';
import { accountHelperResets, accountHelpers, mapMembers, maps, users } from '../../db/schema.js';

/** Both sides of one player's live links. */
export interface LiveLinks {
  helpers: MyHelper[];
  asks: PublicUser[];
  helping: PublicUser[];
}

/** Which end of a link the player is on. */
export type LinkSide = { userId: string } | { helperUserId: string };

export interface AccountHelpersRepo {
  /** Runs `fn` in one transaction; `tx` builds other modules' repos on it too. */
  transaction: <T>(fn: (repo: AccountHelpersRepo, tx: Executor) => Promise<T>) => Promise<T>;
  /**
   * Row-locks the accounts in id order (tech spec §7, step 4), so the caps
   * on each side stay true until commit.
   */
  lockUsers: (userIds: readonly string[]) => Promise<void>;
  liveLinks: (userId: string) => Promise<LiveLinks>;
  /** Pending and active links on one side. */
  countLive: (side: LinkSide) => Promise<number>;
  /** The pair's pending or active link, if any. */
  findLive: (
    userId: string,
    helperUserId: string,
  ) => Promise<{ id: string; status: 'pending' | 'active' } | null>;
  /** The pair's active link, row-locked until commit. */
  lockActive: (userId: string, helperUserId: string) => Promise<boolean>;
  insertAsk: (userId: string, helperUserId: string, now: Date) => Promise<void>;
  /**
   * Moves the pair's live link from one of `from` to `to`; false if there was
   * none (answered or removed meanwhile).
   */
  moveLive: (link: {
    userId: string;
    helperUserId: string;
    from: readonly ('pending' | 'active')[];
    to: 'active' | 'declined' | 'removed';
    now: Date;
  }) => Promise<boolean>;
  /**
   * Who the player may ask: whoever brought them in (`users.invited_by`) and
   * everyone they share a multiplayer patch with, minus live links.
   */
  candidates: (userId: string) => Promise<HelperCandidate[]>;
  countResetsSince: (helperUserId: string, since: Date) => Promise<number>;
  insertReset: (reset: { userId: string; helperUserId: string; now: Date }) => Promise<void>;
  findUser: (userId: string) => Promise<PublicUser | null>;
}

const LIVE = ['pending', 'active'] as const;
const REASON_ORDER: Record<HelperReason, number> = {
  'invited-you': 0,
  'patch-owner': 1,
  'patch-mate': 2,
};

export function createAccountHelpersRepo(db: Executor): AccountHelpersRepo {
  const repo: AccountHelpersRepo = {
    transaction: (fn) => withTransaction(db, (tx) => fn(createAccountHelpersRepo(tx), tx)),

    lockUsers: async (userIds) => {
      const ids = [...new Set(userIds)].sort();
      await db
        .select({ id: users.id })
        .from(users)
        .where(inArray(users.id, ids))
        .orderBy(asc(users.id))
        .for('no key update');
    },

    liveLinks: async (userId) => {
      const other = alias(users, 'other');
      const rows = await db
        .select({
          userId: accountHelpers.userId,
          helperUserId: accountHelpers.helperUserId,
          status: accountHelpers.status,
          other: { id: other.id, username: other.username },
        })
        .from(accountHelpers)
        .innerJoin(
          other,
          sql`${other.id} = case when ${accountHelpers.userId} = ${userId}
            then ${accountHelpers.helperUserId} else ${accountHelpers.userId} end`,
        )
        .where(
          and(
            inArray(accountHelpers.status, LIVE),
            sql`(${accountHelpers.userId} = ${userId} or ${accountHelpers.helperUserId} = ${userId})`,
          ),
        )
        .orderBy(asc(accountHelpers.createdAt), asc(accountHelpers.id));
      const links: LiveLinks = { helpers: [], asks: [], helping: [] };
      for (const row of rows) {
        if (row.status !== 'pending' && row.status !== 'active') continue;
        if (row.userId === userId) links.helpers.push({ user: row.other, status: row.status });
        else if (row.status === 'pending') links.asks.push(row.other);
        else links.helping.push(row.other);
      }
      links.helping.sort((a, b) => a.username.localeCompare(b.username));
      return links;
    },

    countLive: async (side) => {
      const [row] = await db
        .select({ n: count() })
        .from(accountHelpers)
        .where(
          and(
            inArray(accountHelpers.status, LIVE),
            'userId' in side
              ? eq(accountHelpers.userId, side.userId)
              : eq(accountHelpers.helperUserId, side.helperUserId),
          ),
        );
      return row?.n ?? 0;
    },

    findLive: async (userId, helperUserId) => {
      const [row] = await db
        .select({ id: accountHelpers.id, status: accountHelpers.status })
        .from(accountHelpers)
        .where(
          and(
            eq(accountHelpers.userId, userId),
            eq(accountHelpers.helperUserId, helperUserId),
            inArray(accountHelpers.status, LIVE),
          ),
        )
        .limit(1);
      if (!row || (row.status !== 'pending' && row.status !== 'active')) return null;
      return { id: row.id, status: row.status };
    },

    lockActive: async (userId, helperUserId) => {
      const rows = await db
        .select({ id: accountHelpers.id })
        .from(accountHelpers)
        .where(
          and(
            eq(accountHelpers.userId, userId),
            eq(accountHelpers.helperUserId, helperUserId),
            eq(accountHelpers.status, 'active'),
          ),
        )
        .for('update');
      return rows.length > 0;
    },

    insertAsk: async (userId, helperUserId, now) => {
      await db.insert(accountHelpers).values({ userId, helperUserId, createdAt: now });
    },

    moveLive: async ({ userId, helperUserId, from, to, now }) => {
      const rows = await db
        .update(accountHelpers)
        .set({
          status: to,
          ...(to === 'removed' ? { endedAt: now } : { answeredAt: now }),
        })
        .where(
          and(
            eq(accountHelpers.userId, userId),
            eq(accountHelpers.helperUserId, helperUserId),
            inArray(accountHelpers.status, from),
          ),
        )
        .returning({ id: accountHelpers.id });
      return rows.length > 0;
    },

    candidates: async (userId) => {
      const me = alias(mapMembers, 'me');
      const them = alias(mapMembers, 'them');
      const inviter = alias(users, 'inviter');
      const [invited, mates, live] = await Promise.all([
        db
          .select({ id: inviter.id, username: inviter.username })
          .from(users)
          .innerJoin(inviter, eq(inviter.id, users.invitedBy))
          .where(eq(users.id, userId)),
        db
          .select({
            id: users.id,
            username: users.username,
            role: them.role,
            patchName: maps.name,
          })
          .from(me)
          .innerJoin(maps, and(eq(maps.id, me.mapId), eq(maps.kind, 'multiplayer')))
          .innerJoin(
            them,
            and(eq(them.mapId, me.mapId), eq(them.status, 'active'), ne(them.userId, userId)),
          )
          .innerJoin(users, eq(users.id, them.userId))
          .where(and(eq(me.userId, userId), eq(me.status, 'active')))
          .orderBy(asc(maps.name), asc(maps.id)),
        db
          .select({ helperUserId: accountHelpers.helperUserId })
          .from(accountHelpers)
          .where(and(eq(accountHelpers.userId, userId), inArray(accountHelpers.status, LIVE))),
      ]);

      const linked = new Set(live.map((l) => l.helperUserId));
      const byId = new Map<string, HelperCandidate>();
      const offer = (candidate: HelperCandidate) => {
        if (candidate.user.id === userId || linked.has(candidate.user.id)) return;
        const seen = byId.get(candidate.user.id);
        if (!seen || REASON_ORDER[candidate.reason] < REASON_ORDER[seen.reason]) {
          byId.set(candidate.user.id, candidate);
        }
      };
      for (const user of invited) offer({ user, reason: 'invited-you', patchName: null });
      for (const mate of mates) {
        offer({
          user: { id: mate.id, username: mate.username },
          reason: mate.role === 'owner' ? 'patch-owner' : 'patch-mate',
          patchName: mate.patchName,
        });
      }
      return [...byId.values()].sort(
        (a, b) =>
          REASON_ORDER[a.reason] - REASON_ORDER[b.reason] ||
          a.user.username.localeCompare(b.user.username),
      );
    },

    countResetsSince: async (helperUserId, since) => {
      const [row] = await db
        .select({ n: count() })
        .from(accountHelperResets)
        .where(
          and(
            eq(accountHelperResets.helperUserId, helperUserId),
            gte(accountHelperResets.createdAt, since),
          ),
        );
      return row?.n ?? 0;
    },

    insertReset: async ({ userId, helperUserId, now }) => {
      await db.insert(accountHelperResets).values({ userId, helperUserId, createdAt: now });
    },

    findUser: async (userId) => {
      const [row] = await db
        .select({ id: users.id, username: users.username })
        .from(users)
        .where(eq(users.id, userId));
      return row ?? null;
    },
  };
  return repo;
}
