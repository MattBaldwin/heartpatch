import {
  PUSH_RULES,
  PushPayloadSchema,
  type PublicUser,
  type PushOkResponse,
  type PushPayload,
  type PushSettings,
  type PushSettingsPatch,
  type PushStatusResponse,
  type PushSubscribeRequest,
} from '@heartpatch/shared';
import type { FastifyBaseLogger } from 'fastify';
import type { Executor } from '../../db/client.js';
import { AppError } from '../../lib/errors.js';
import { MINUTE_MS, type Clock } from '../../lib/time.js';
import { hashSessionToken } from '../auth/secrets.js';
import type { LongNightSwitch } from '../long-night/switch.js';
import { createPushRepo } from './repo.js';
import {
  endpointHost,
  isPushServiceEndpoint,
  type PushSendOptions,
  type PushSender,
  type VapidKeys,
} from './sender.js';
import { createPushSend, type PushSendTally } from './send.js';
import { PUSH_OFF, pushOnFor, type PushSwitch } from './switch.js';
import { createPushSweep, type PushSweepResult } from './sweep.js';

/*
 * Push nudges (#726 plan, "Server"). A player's phone can subscribe,
 * unsubscribe and set four switches; nothing here takes a "send me this"
 * command (dev tools included). The server decides every send: the sweep
 * (#726c) and the friend hook (#726d, `friendArrived`) call `deliver`, which nudges every live
 * device of one account and keeps each subscription's books.
 */

export interface PushService {
  /** `GET /push`: the key to subscribe with and my switches. */
  status: (user: PublicUser) => Promise<PushStatusResponse>;
  /** `PUT /push/subscription`, for the session whose cookie token this is. */
  subscribe: (
    user: PublicUser,
    sessionToken: string | undefined,
    request: PushSubscribeRequest,
  ) => Promise<PushOkResponse>;
  /** `DELETE /push/subscription`: idempotent, my own row only. */
  unsubscribe: (user: PublicUser, endpoint: string) => Promise<PushOkResponse>;
  /** `PUT /push/settings`. */
  updateSettings: (user: PublicUser, patch: PushSettingsPatch) => Promise<PushSettings>;
  /**
   * Sends one nudge to every live device of this account, outside any
   * transaction. Not a route: the server's own jobs call it after claiming
   * the send in `push_sends` (#726c). A device that took it has its failures
   * reset; a 404/410 deletes the subscription; other refusals count toward
   * `PUSH_RULES.maxFailures`. Nothing goes out while push is off for the
   * account.
   */
  deliver: (
    user: Pick<PublicUser, 'id' | 'username'>,
    payload: PushPayload,
    options: PushSendOptions,
  ) => Promise<PushDelivery>;
  /**
   * The sweep (#726c, `jobs/push.ts`, every minute): sends the dusk, Long Night and
   * gatherers nudges due at `now` (the clock by default), each at most once.
   * Does nothing while push is off.
   */
  sweep: (now?: Date) => Promise<PushSweepResult>;
  /**
   * "Moonberry is in your patch! 👋" (#726d): the hub's `onSubscribed` says
   * a player arrived on a patch; each patch-mate who is away from it (not
   * online there, and gone `PUSH_RULES.friendAwayMinutes` or for an unknown
   * time) gets one nudge per arriver per `friendRepeatHours`, through the
   * same quiet hours, cap and claim as the sweep. Never the arriver. One
   * recipient's failure is logged and never stops the others; the promise
   * only rejects if the recipients can't be read. Does nothing while push is
   * off.
   */
  friendArrived: (mapId: string, arriverUserId: string, now?: Date) => Promise<PushFriendResult>;
}

/** What one arrival did. */
export interface PushFriendResult extends PushSendTally {
  /** Patch-mates it could go to (after presence and the switch; before quiet hours and the cap). */
  due: number;
}

/** How a `deliver` went: `devices` tried, `delivered` took it. */
export interface PushDelivery {
  devices: number;
  delivered: number;
}

export interface PushServiceOptions {
  db: Executor;
  clock: Clock;
  log: FastifyBaseLogger;
  /** `pushSwitchOf(config)`; off by default. */
  push?: PushSwitch;
  /** `vapidOf(config)`: required unless push is off (config makes sure). */
  vapid?: VapidKeys | null;
  /** `createWebPushSender(vapid, …)`; tests pass a fake. Required unless push is off. */
  sender?: PushSender | null;
  /** `longNightSwitchOf(config)`: the sweep's Long Night calls (#726f). Off by default. */
  longNight?: LongNightSwitch;
  /** `wsHub.isOnline`, for the sweep's "not while you're playing there". No hub: nobody is online. */
  isOnline?: (mapId: string, userId: string) => boolean;
  /** `wsHub.lastOfflineAt`, for the friend nudge's "away a while". No hub: unknown (long ago). */
  lastOfflineAt?: (mapId: string, userId: string) => Date | null;
}

export function createPushService(options: PushServiceOptions): PushService {
  const { db, clock, log } = options;
  const push = options.push ?? PUSH_OFF;
  const vapid = options.vapid ?? null;
  const sender = options.sender ?? null;
  if (push.mode !== 'off' && (vapid === null || sender === null)) {
    // Config refuses this; a test that builds the service by hand might not.
    throw new Error('push is on but has no VAPID keys or sender');
  }
  const repo = createPushRepo(db);
  const isOnline = options.isOnline ?? (() => false);
  const lastOfflineAt = options.lastOfflineAt ?? (() => null);

  /**
   * NOT_FOUND unless push is on for me, with the same words as an unknown
   * route, so the client reads it as "no nudges here" (the house pattern).
   */
  const requireOn = (user: PublicUser): VapidKeys => {
    if (!pushOnFor(push, user) || vapid === null) throw new AppError('NOT_FOUND');
    return vapid;
  };

  const deliver: PushService['deliver'] = async (user, payload, sendOptions) => {
    if (sender === null || !pushOnFor(push, user)) return { devices: 0, delivered: 0 };
    const checked = PushPayloadSchema.parse(payload);
    const targets = await repo.targets(user.id, clock());
    // One device at a time: an account has at most five.
    const ok: string[] = [];
    for (const target of targets) {
      const result = await sender.send(target, checked, sendOptions);
      switch (result.outcome) {
        case 'ok':
          ok.push(target.id);
          break;
        case 'gone':
          await repo.remove(target.id);
          log.info(
            {
              kind: checked.kind,
              host: endpointHost(target.endpoint),
              statusCode: result.statusCode,
            },
            'push: subscription gone, deleted',
          );
          break;
        case 'failed':
          if (await repo.recordFailure(target.id)) {
            log.info(
              { kind: checked.kind, host: endpointHost(target.endpoint) },
              'push: subscription failed too often, deleted',
            );
          }
          break;
        case 'dropped':
          // Our side's fault (logged by the sender); the device keeps its count.
          break;
      }
    }
    await repo.recordOk(ok, clock());
    return { devices: targets.length, delivered: ok.length };
  };
  const sweep = createPushSweep({
    db,
    repo,
    log,
    push,
    deliver,
    ...(options.longNight ? { longNight: options.longNight } : {}),
    ...(options.isOnline ? { isOnline: options.isOnline } : {}),
  });
  const send = createPushSend({ repo, deliver, rules: PUSH_RULES });

  const friendArrived: PushService['friendArrived'] = async (mapId, arriverUserId, now) => {
    const result: PushFriendResult = { due: 0, claimed: 0, delivered: 0, quiet: 0, capped: 0 };
    if (push.mode === 'off') return result;
    const at = now ?? clock();
    const { arriver, recipients } = await repo.friendRecipients(mapId, arriverUserId, at);
    if (arriver === null) return result;
    const awaySince = at.getTime() - PUSH_RULES.friendAwayMinutes * MINUTE_MS;
    const away = recipients.filter((user) => {
      if (user.id === arriverUserId || !pushOnFor(push, user) || isOnline(mapId, user.id)) {
        return false;
      }
      // Unknown (not seen since the server started) counts as long ago.
      const left = lastOfflineAt(mapId, user.id);
      return left === null || left.getTime() <= awaySince;
    });
    result.due = away.length;
    // One per arriver per window: the bucket is the repeat guard, in `push_sends`.
    const bucket = Math.floor(at.getTime() / (PUSH_RULES.friendRepeatHours * 60 * MINUTE_MS));
    for (const user of away) {
      try {
        await send(
          {
            user,
            kind: 'friend',
            dedupeKey: `${mapId}/${arriverUserId}/${bucket}`,
            mapId,
            name: arriver,
          },
          at,
          result,
        );
      } catch (err) {
        // One patch-mate's trouble never stops the others' nudges.
        log.error({ err, kind: 'friend', userId: user.id, mapId }, 'push: a friend nudge failed');
      }
    }
    return result;
  };

  return {
    status: async (user) => ({
      vapidPublicKey: requireOn(user).publicKey,
      settings: await repo.settings(user.id),
    }),

    subscribe: async (user, sessionToken, request) => {
      requireOn(user);
      if (sessionToken === undefined) throw new AppError('UNAUTHENTICATED');
      // Only a real push service: the server never POSTs to a URL a player picked.
      if (!isPushServiceEndpoint(request.endpoint)) throw new AppError('VALIDATION_FAILED');
      // A safe integer can still be past what a Date holds (8.64e15 ms).
      const expiresAt =
        request.expirationTime === undefined || request.expirationTime === null
          ? null
          : new Date(request.expirationTime);
      if (expiresAt !== null && Number.isNaN(expiresAt.getTime())) {
        throw new AppError('VALIDATION_FAILED');
      }
      const stored = await repo.subscribe({
        userId: user.id,
        sessionTokenHash: hashSessionToken(sessionToken),
        subscription: {
          endpoint: request.endpoint,
          p256dh: request.keys.p256dh,
          auth: request.keys.auth,
          expiresAt,
        },
        replaces: request.replaces,
        now: clock(),
      });
      // The session ended between `requireAuth` and here (logout elsewhere).
      if (!stored) throw new AppError('UNAUTHENTICATED');
      return { ok: true };
    },

    unsubscribe: async (user, endpoint) => {
      requireOn(user);
      await repo.unsubscribe(user.id, endpoint);
      return { ok: true };
    },

    updateSettings: async (user, patch) => {
      requireOn(user);
      return repo.patchSettings(user.id, patch, clock());
    },

    deliver,

    sweep: (at) => sweep(at ?? clock()),

    friendArrived,
  };
}
