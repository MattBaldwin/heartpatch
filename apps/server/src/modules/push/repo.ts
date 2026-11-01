import { PUSH_RULES, type PushSettings, type PushSettingsPatch } from '@heartpatch/shared';
import { and, desc, eq, gt, gte, isNull, lte, ne, or, sql } from 'drizzle-orm';
import { withTransaction, type Executor } from '../../db/client.js';
import { pushSettings, pushSubscriptions, sessions } from '../../db/schema.js';
import type { PushTarget } from './sender.js';

/*
 * Push nudges' tables (#726, migration 0063). Leaves: written only here,
 * outside every game command's transaction, never locked `FOR UPDATE`
 * (TECH_SPEC §7). A subscription only counts while its login session is live
 * (`sessions.expires_at > now`): expiry doesn't delete the session row, so
 * the cascade alone isn't enough (#726a).
 */

/** No `push_settings` row: every switch on. */
export const DEFAULT_PUSH_SETTINGS: PushSettings = {
  dusk: true,
  gatherers: true,
  friend: true,
  longNight: true,
};

/** A device to nudge: the target plus the row id for the bookkeeping. */
export interface PushTargetRow extends PushTarget {
  id: string;
}

/** A subscription to store, from `PushSubscription.toJSON()`. */
export interface NewPushSubscription {
  endpoint: string;
  p256dh: string;
  auth: string;
  expiresAt: Date | null;
}

const settingsColumns = {
  dusk: pushSettings.dusk,
  gatherers: pushSettings.gatherers,
  friend: pushSettings.friend,
  longNight: pushSettings.longNight,
};

export interface PushRepo {
  /** My switches; the defaults when I have no row. */
  settings: (userId: string) => Promise<PushSettings>;
  /** Changes some switches (an upsert) and returns all four. */
  patchSettings: (userId: string, patch: PushSettingsPatch, now: Date) => Promise<PushSettings>;
  /**
   * Stores this device's subscription for the live session with this token
   * hash, which must be `userId`'s own (the row takes the session's user, so
   * the two can't disagree). An endpoint already stored, for anyone, is taken
   * over: new session, user and keys, failures reset. Deletes `replaces` if
   * it's mine, then my oldest devices past `PUSH_RULES.maxDevicesPerAccount`.
   * False when the session isn't live (logged out mid-request).
   */
  subscribe: (input: {
    userId: string;
    sessionTokenHash: string;
    subscription: NewPushSubscription;
    replaces: string | undefined;
    now: Date;
  }) => Promise<boolean>;
  /** Deletes my subscription with this endpoint, if there is one. */
  unsubscribe: (userId: string, endpoint: string) => Promise<void>;
  /**
   * My devices a nudge can go to: live session, not past `expires_at`. Also
   * deletes my subscriptions whose own `expires_at` has passed.
   */
  targets: (userId: string, now: Date) => Promise<PushTargetRow[]>;
  /** The push service took a nudge: failures reset. */
  recordOk: (ids: readonly string[], now: Date) => Promise<void>;
  /**
   * The push service refused one: `fail_count + 1`, and the row goes once it
   * reaches `PUSH_RULES.maxFailures`. True when it was deleted.
   */
  recordFailure: (id: string) => Promise<boolean>;
  /** A dead subscription (404 or 410). */
  remove: (id: string) => Promise<void>;
}

export function createPushRepo(db: Executor): PushRepo {
  const settings = async (userId: string): Promise<PushSettings> => {
    const [row] = await db
      .select(settingsColumns)
      .from(pushSettings)
      .where(eq(pushSettings.userId, userId));
    return row ?? { ...DEFAULT_PUSH_SETTINGS };
  };

  return {
    settings,

    patchSettings: async (userId, patch, now) => {
      const [row] = await db
        .insert(pushSettings)
        .values({ ...DEFAULT_PUSH_SETTINGS, ...patch, userId, updatedAt: now })
        .onConflictDoUpdate({ target: pushSettings.userId, set: { ...patch, updatedAt: now } })
        .returning(settingsColumns);
      if (!row) throw new Error('push settings upsert returned no row');
      return row;
    },

    subscribe: ({ userId, sessionTokenHash, subscription, replaces, now }) =>
      withTransaction(db, async (tx) => {
        // The row's user and session come from one live `sessions` row.
        const [session] = await tx
          .select({ id: sessions.id, userId: sessions.userId })
          .from(sessions)
          .where(
            and(
              eq(sessions.tokenHash, sessionTokenHash),
              eq(sessions.userId, userId),
              gt(sessions.expiresAt, now),
            ),
          );
        if (!session) return false;
        const [stored] = await tx
          .insert(pushSubscriptions)
          .values({
            userId: session.userId,
            sessionId: session.id,
            ...subscription,
            createdAt: now,
          })
          .onConflictDoUpdate({
            target: pushSubscriptions.endpoint,
            set: {
              userId: session.userId,
              sessionId: session.id,
              p256dh: subscription.p256dh,
              auth: subscription.auth,
              expiresAt: subscription.expiresAt,
              failCount: 0,
              // A takeover by another account starts fresh (the device cap's order).
              lastOkAt: sql`case when ${pushSubscriptions.userId} = ${session.userId}::uuid then ${pushSubscriptions.lastOkAt} else null end`,
              createdAt: sql`case when ${pushSubscriptions.userId} = ${session.userId}::uuid then ${pushSubscriptions.createdAt} else ${now.toISOString()}::timestamptz end`,
            },
          })
          .returning({ id: pushSubscriptions.id });
        if (!stored) throw new Error('push subscription upsert returned no row');

        if (replaces !== undefined && replaces !== subscription.endpoint) {
          await tx
            .delete(pushSubscriptions)
            .where(
              and(eq(pushSubscriptions.userId, userId), eq(pushSubscriptions.endpoint, replaces)),
            );
        }

        // Past the cap, my least recently working devices go (never this one).
        const others = await tx
          .select({ id: pushSubscriptions.id })
          .from(pushSubscriptions)
          .where(and(eq(pushSubscriptions.userId, userId), ne(pushSubscriptions.id, stored.id)))
          .orderBy(
            desc(sql`coalesce(${pushSubscriptions.lastOkAt}, ${pushSubscriptions.createdAt})`),
            desc(pushSubscriptions.id),
          )
          .offset(PUSH_RULES.maxDevicesPerAccount - 1);
        for (const { id } of others) {
          await tx.delete(pushSubscriptions).where(eq(pushSubscriptions.id, id));
        }
        return true;
      }),

    unsubscribe: async (userId, endpoint) => {
      await db
        .delete(pushSubscriptions)
        .where(and(eq(pushSubscriptions.userId, userId), eq(pushSubscriptions.endpoint, endpoint)));
    },

    targets: async (userId, now) => {
      await db
        .delete(pushSubscriptions)
        .where(and(eq(pushSubscriptions.userId, userId), lte(pushSubscriptions.expiresAt, now)));
      return db
        .select({
          id: pushSubscriptions.id,
          endpoint: pushSubscriptions.endpoint,
          p256dh: pushSubscriptions.p256dh,
          auth: pushSubscriptions.auth,
        })
        .from(pushSubscriptions)
        .innerJoin(
          sessions,
          and(eq(sessions.id, pushSubscriptions.sessionId), gt(sessions.expiresAt, now)),
        )
        .where(
          and(
            eq(pushSubscriptions.userId, userId),
            or(isNull(pushSubscriptions.expiresAt), gt(pushSubscriptions.expiresAt, now)),
          ),
        )
        .orderBy(pushSubscriptions.id);
    },

    recordOk: async (ids, now) => {
      for (const id of ids) {
        await db
          .update(pushSubscriptions)
          .set({ lastOkAt: now, failCount: 0 })
          .where(eq(pushSubscriptions.id, id));
      }
    },

    recordFailure: async (id) => {
      await db
        .update(pushSubscriptions)
        .set({ failCount: sql`least(${pushSubscriptions.failCount} + 1, 32767)` })
        .where(eq(pushSubscriptions.id, id));
      const gone = await db
        .delete(pushSubscriptions)
        .where(
          and(
            eq(pushSubscriptions.id, id),
            gte(pushSubscriptions.failCount, PUSH_RULES.maxFailures),
          ),
        )
        .returning({ id: pushSubscriptions.id });
      return gone.length > 0;
    },

    remove: async (id) => {
      await db.delete(pushSubscriptions).where(eq(pushSubscriptions.id, id));
    },
  };
}
