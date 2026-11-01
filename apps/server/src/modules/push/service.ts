import {
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
import type { Clock } from '../../lib/time.js';
import { hashSessionToken } from '../auth/secrets.js';
import { createPushRepo } from './repo.js';
import { endpointHost, type PushSendOptions, type PushSender, type VapidKeys } from './sender.js';
import { PUSH_OFF, pushOnFor, type PushSwitch } from './switch.js';

/*
 * Push nudges (#726 plan, "Server"). A player's phone can subscribe,
 * unsubscribe and set four switches; nothing here takes a "send me this"
 * command (dev tools included). The server decides every send: the sweep
 * (#726c) and the friend hook (#726d) call `deliver`, which nudges every live
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

  /**
   * NOT_FOUND unless push is on for me, with the same words as an unknown
   * route, so the client reads it as "no nudges here" (the house pattern).
   */
  const requireOn = (user: PublicUser): VapidKeys => {
    if (!pushOnFor(push, user) || vapid === null) throw new AppError('NOT_FOUND');
    return vapid;
  };

  return {
    status: async (user) => ({
      vapidPublicKey: requireOn(user).publicKey,
      settings: await repo.settings(user.id),
    }),

    subscribe: async (user, sessionToken, request) => {
      requireOn(user);
      if (sessionToken === undefined) throw new AppError('UNAUTHENTICATED');
      const stored = await repo.subscribe({
        userId: user.id,
        sessionTokenHash: hashSessionToken(sessionToken),
        subscription: {
          endpoint: request.endpoint,
          p256dh: request.keys.p256dh,
          auth: request.keys.auth,
          expiresAt:
            request.expirationTime === undefined || request.expirationTime === null
              ? null
              : new Date(request.expirationTime),
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

    deliver: async (user, payload, sendOptions) => {
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
    },
  };
}
