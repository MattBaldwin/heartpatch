import {
  PUSH_RULES,
  type PushKind,
  type PushSettings,
  type PushSettingsPatch,
} from '@heartpatch/shared';
import { and, desc, eq, gt, gte, isNull, lte, ne, or, sql } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { withTransaction, type Executor } from '../../db/client.js';
import { pushSends, pushSettings, pushSubscriptions, sessions } from '../../db/schema.js';
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

/**
 * Someone a nudge may go to: a live device (the `sessions` join, as
 * `targets`), the kind's switch on. `deliver` still re-checks the push
 * switch and reads the devices again.
 */
export interface PushRecipient {
  id: string;
  username: string;
  /** `users.time_zone`: quiet hours and the daily cap go by it. */
  timeZone: string;
}

/** A played patch the Hollow Man can strike tonight (the dusk nudge's maps). */
export interface PushDuskMap {
  id: string;
  kind: 'multiplayer' | 'tutorial';
  timeZone: string;
}

/**
 * Why a player's gatherers may be done (#726 plan, "gatherers"): a node
 * gather ready a while, a factory batch finished a while, or a squishy
 * gatherer working long enough that it may be full (the sweep confirms that
 * one with `workAt`).
 */
export interface PushGathererRow {
  user: PushRecipient;
  map: PushDuskMap;
  source: 'gather' | 'factory' | 'worker';
  /** The squishy gatherer to check, for `worker`; null otherwise. */
  squishyId: string | null;
}

/** A send to claim in `push_sends` (#726 plan, "Idempotency across restarts"). */
export interface PushClaim {
  userId: string;
  kind: PushKind;
  dedupeKey: string;
  mapId: string | null;
  now: Date;
  /** The start of the account's day: the daily cap counts claims since. */
  dayStart: Date;
}

/** `push_settings` columns by switch (SQL), for the candidate queries. */
const SETTING_COLUMN = {
  dusk: sql.raw('dusk'),
  gatherers: sql.raw('gatherers'),
  longNight: sql.raw('long_night'),
} as const;

/** `u` (a `users` row) has a live device and this switch on (no settings row: on). */
const reachable = (setting: keyof typeof SETTING_COLUMN, now: Date) => sql`
  coalesce((select ps.${SETTING_COLUMN[setting]} from push_settings ps where ps.user_id = u.id), true)
  and exists (
    select 1 from push_subscriptions sub
    join sessions s on s.id = sub.session_id and s.expires_at > ${now.toISOString()}::timestamptz
    where sub.user_id = u.id
      and (sub.expires_at is null or sub.expires_at > ${now.toISOString()}::timestamptz)
  )`;

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

  // The sweep (#726c). Reads only, never `FOR UPDATE`; `push_sends` is
  // written one short statement at a time, outside every game transaction.

  /**
   * Multiplayer patches with an active member who has a subscription, and
   * the Hollow Man's strength above 0, in id order: where dusk can matter.
   */
  duskMaps: () => Promise<PushDuskMap[]>;
  /** The patch's active members a nudge with this switch can reach now, in id order. */
  mapRecipients: (
    mapId: string,
    setting: 'dusk' | 'longNight',
    now: Date,
  ) => Promise<PushRecipient[]>;
  /**
   * Active members, on multiplayer patches, with `gatherers` on and a live
   * device, holding a gather ready since `idleBefore`, a factory batch
   * finished by then, or a squishy gatherer at work since then (maybe full:
   * the caller checks), by user, map and source.
   */
  gathererCandidates: (now: Date, idleBefore: Date) => Promise<PushGathererRow[]>;
  /** How many sends this account has claimed since `since` (the daily cap). */
  claimedSince: (userId: string, since: Date) => Promise<number>;
  /**
   * Claims a send (`INSERT … ON CONFLICT DO NOTHING`, one statement, no other
   * lock): its id, or null when it was claimed already or the account has
   * `PUSH_RULES.dailyCap` claims since `dayStart` (the cap again, so two
   * sweeps at once can't both pass it on a stale count).
   */
  claim: (claim: PushClaim, dailyCap?: number) => Promise<string | null>;
  /** After `deliver`: how many devices it went to, and when one took it (else null). */
  markSent: (id: string, sentAt: Date | null, devices: number) => Promise<void>;
  /**
   * Deletes up to `limit` send-log rows claimed before `before`, oldest
   * first (the retention job, `PUSH_RULES.sendLogDays`). How many went.
   */
  pruneSends: (before: Date, limit: number) => Promise<number>;
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

    duskMaps: async () => {
      const rows = await db.execute<{
        id: string;
        kind: PushDuskMap['kind'];
        timeZone: string;
      }>(sql`
        select m.id, m.kind, m.time_zone as "timeZone"
        from maps m
        where m.kind = 'multiplayer'
          and m.hollow_strength_percent > 0
          -- Only patches where someone could get a nudge (the sweep runs every minute).
          and exists (
            select 1 from map_members mm
            join push_subscriptions sub on sub.user_id = mm.user_id
            where mm.map_id = m.id and mm.status = 'active'
          )
        order by m.id`);
      return rows.map((r) => ({ ...r }));
    },

    mapRecipients: async (mapId, setting, now) => {
      const rows = await db.execute<{ id: string; username: string; timeZone: string }>(sql`
        select u.id, u.username, u.time_zone as "timeZone"
        from map_members mm
        join users u on u.id = mm.user_id
        where mm.map_id = ${mapId} and mm.status = 'active' and ${reachable(setting, now)}
        order by u.id`);
      return rows.map((r) => ({ ...r }));
    },

    gathererCandidates: async (now, idleBefore) => {
      const idle = idleBefore.toISOString();
      const rows = await db.execute<{
        userId: string;
        username: string;
        userTimeZone: string;
        mapId: string;
        mapKind: PushDuskMap['kind'];
        mapTimeZone: string;
        source: PushGathererRow['source'];
        squishyId: string | null;
      }>(sql`
        with done as (
          select g.user_id, g.map_id, 'gather' as source, null::uuid as squishy_id
          from gather_jobs g
          where g.status = 'active' and g.ready_at <= ${idle}::timestamptz
          union all
          select f.user_id, f.map_id, 'factory', null::uuid
          from factory_queues f
          where f.end_reason is null
            and f.banked < f.total
            and f.started_at + make_interval(secs => f.total::double precision * f.item_seconds)
              <= ${idle}::timestamptz
          union all
          select sq.owner_user_id, sq.map_id, 'worker', sq.id
          from squishies sq
          where sq.work_tile_id is not null
            and sq.state = 'active'
            and sq.work_since <= ${idle}::timestamptz
        )
        select distinct
          u.id as "userId", u.username, u.time_zone as "userTimeZone",
          m.id as "mapId", m.kind as "mapKind", m.time_zone as "mapTimeZone",
          d.source, d.squishy_id as "squishyId"
        from done d
        join users u on u.id = d.user_id
        join maps m on m.id = d.map_id and m.kind = 'multiplayer'
        join map_members mm
          on mm.map_id = d.map_id and mm.user_id = d.user_id and mm.status = 'active'
        where ${reachable('gatherers', now)}
        order by "userId", "mapId", d.source, "squishyId"`);
      return rows.map((r) => ({
        user: { id: r.userId, username: r.username, timeZone: r.userTimeZone },
        map: { id: r.mapId, kind: r.mapKind, timeZone: r.mapTimeZone },
        source: r.source,
        squishyId: r.squishyId,
      }));
    },

    claimedSince: async (userId, since) => {
      const [row] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(pushSends)
        .where(and(eq(pushSends.userId, userId), gte(pushSends.claimedAt, since)));
      return row?.count ?? 0;
    },

    claim: async (
      { userId, kind, dedupeKey, mapId, now, dayStart },
      dailyCap = PUSH_RULES.dailyCap,
    ) => {
      const rows = await db.execute<{ id: string }>(sql`
        insert into push_sends (id, user_id, kind, dedupe_key, map_id, claimed_at, devices)
        select ${uuidv7()}::uuid, ${userId}::uuid, ${kind}, ${dedupeKey}, ${mapId}::uuid, ${now.toISOString()}::timestamptz, 0
        where (
          select count(*) from push_sends
          where user_id = ${userId}::uuid and claimed_at >= ${dayStart.toISOString()}::timestamptz
        ) < ${dailyCap}
        on conflict (user_id, kind, dedupe_key) do nothing
        returning id`);
      return rows[0]?.id ?? null;
    },

    markSent: async (id, sentAt, devices) => {
      await db
        .update(pushSends)
        .set({ sentAt, devices: Math.min(devices, 32767) })
        .where(eq(pushSends.id, id));
    },

    pruneSends: async (before, limit) => {
      const rows = await db.execute<{ id: string }>(sql`
        delete from push_sends
        where id in (
          select id from push_sends
          where claimed_at < ${before.toISOString()}::timestamptz
          order by claimed_at
          limit ${limit}
        )
        returning id`);
      return rows.length;
    },
  };
}
