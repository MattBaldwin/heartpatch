import { PUSH_RULES, PushPayloadSchema, type PushPayload } from '@heartpatch/shared';
import webPush from 'web-push';
import type { FastifyBaseLogger } from 'fastify';
import type { Config } from '../../config.js';

/*
 * The one place that talks to a push service (#726 plan, "Library"). It wraps
 * `web-push` (RFC 8291 payload encryption, RFC 8292 VAPID) behind
 * `PushSender`, so tests inject a fake and a hand-rolled sender could replace
 * the library without touching anything else. Nothing else imports
 * `web-push`.
 *
 * Never log the private key or a whole endpoint: an endpoint is a capability
 * (anyone holding it and the keys can nudge that phone). Logs carry the push
 * service's host only.
 */

/** The VAPID pair and subject every nudge is signed with. Server-only. */
export interface VapidKeys {
  publicKey: string;
  privateKey: string;
  /** A `mailto:` or `https:` URL push services can contact us at. */
  subject: string;
}

/** The VAPID details from config, or null while push has no keys (it's off). */
export function vapidOf(
  config: Pick<
    Config,
    'HP_VAPID_PUBLIC_KEY' | 'HP_VAPID_PRIVATE_KEY' | 'HP_VAPID_SUBJECT' | 'PUBLIC_ORIGIN'
  >,
): VapidKeys | null {
  if (config.HP_VAPID_PUBLIC_KEY === undefined || config.HP_VAPID_PRIVATE_KEY === undefined) {
    return null;
  }
  return {
    publicKey: config.HP_VAPID_PUBLIC_KEY,
    privateKey: config.HP_VAPID_PRIVATE_KEY,
    // Unset falls back to the site (#726a). Apple refuses an `http:` one, so
    // a dev server on http://localhost needs HP_VAPID_SUBJECT=mailto:… to send.
    subject: config.HP_VAPID_SUBJECT ?? config.PUBLIC_ORIGIN,
  };
}

/** One device's subscription, as `push_subscriptions` holds it. */
export interface PushTarget {
  endpoint: string;
  p256dh: string;
  auth: string;
}

export interface PushSendOptions {
  /** How long the push service keeps an undelivered nudge (`PUSH_RULES.ttlSeconds`). */
  ttlSeconds: number;
  /** A newer nudge with the same topic replaces an undelivered older one. */
  topic?: string;
  urgency?: 'very-low' | 'low' | 'normal' | 'high';
}

/**
 * What became of one send, for the bookkeeping in `service.deliver`:
 * - `ok`: the push service took it (2xx). Resets the failure count.
 * - `gone`: 404 or 410, or an endpoint off `PUSH_SERVICE_HOSTS`: the
 *   subscription is dead. Delete it.
 * - `failed`: anything else the subscription might be to blame for (429,
 *   5xx, 401/403 after a key change, keys that won't encrypt). Counts toward
 *   `PUSH_RULES.maxFailures`.
 * - `dropped`: our fault, not the device's (413 or an oversized payload, a
 *   network error on our side, an unusable subject). Logged; nothing counted.
 */
export type PushSendResult =
  | { outcome: 'ok' }
  | { outcome: 'gone'; statusCode: number | null }
  | { outcome: 'failed'; statusCode: number | null }
  | { outcome: 'dropped'; reason: 'too-big' | 'unreachable' | 'no-subject' };

export interface PushSender {
  send: (
    target: PushTarget,
    payload: PushPayload,
    options: PushSendOptions,
  ) => Promise<PushSendResult>;
}

/** `web-push`'s `sendNotification`, injectable so tests never touch the network. */
export type SendNotification = typeof webPush.sendNotification;

export interface WebPushSenderOptions {
  log: FastifyBaseLogger;
  /** Defaults to the library's; tests pass a fake. */
  sendNotification?: SendNotification;
  /** Milliseconds before a push service that doesn't answer counts as unreachable. */
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 10_000; // TUNE: Apple and FCM answer in well under a second

/** The push service's host, for logs: never the whole endpoint. */
export function endpointHost(endpoint: string): string {
  try {
    return new URL(endpoint).host;
  } catch {
    return 'invalid';
  }
}

/**
 * The push services a subscription may point at (#726b review): the browsers'
 * own, matched on the host or a subdomain of it. A player can't make the
 * server POST to a URL of their choosing (an internal host, localhost):
 * checked when a device subscribes and again before every send.
 */
export const PUSH_SERVICE_HOSTS: readonly string[] = [
  'push.apple.com', // Safari and Home Screen apps on iPhone, iPad and Mac (web.push.apple.com)
  'fcm.googleapis.com', // Chrome, Edge on Android, Samsung Internet
  'push.services.mozilla.com', // Firefox (updates.push.services.mozilla.com)
  'notify.windows.com', // Edge on Windows (*.notify.windows.com)
];

/** True when the endpoint is plain https on port 443 at a known push service. */
export function isPushServiceEndpoint(endpoint: string): boolean {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:' || url.port !== '' || url.username !== '' || url.password !== '') {
    return false;
  }
  const host = url.hostname.toLowerCase();
  return PUSH_SERVICE_HOSTS.some((known) => host === known || host.endsWith(`.${known}`));
}

/** A subject push services accept (the library throws on anything else). */
function usableSubject(subject: string): boolean {
  try {
    const { protocol, hostname } = new URL(subject);
    // Apple rejects a localhost subject with BadJwtToken (the library warns).
    return protocol === 'mailto:' || (protocol === 'https:' && hostname !== 'localhost');
  } catch {
    return false;
  }
}

/** A Node network error (`ECONNREFUSED`, `ETIMEDOUT`, …): no reply from the service. */
function isNetworkError(error: unknown): boolean {
  // web-push rejects a timeout with a bare Error('Socket timeout'): no reply either.
  if (error instanceof Error && error.message === 'Socket timeout') return true;
  return (
    error instanceof Error &&
    'code' in error &&
    typeof error.code === 'string' &&
    !('statusCode' in error)
  );
}

function codeOf(error: unknown): string | undefined {
  return error instanceof Error && 'code' in error && typeof error.code === 'string'
    ? error.code
    : undefined;
}

/** A push service's `Retry-After` header, from web-push's error. */
function retryAfterOf(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null || !('headers' in error)) return undefined;
  const { headers } = error;
  if (typeof headers !== 'object' || headers === null || !('retry-after' in headers)) {
    return undefined;
  }
  const value = headers['retry-after'];
  return typeof value === 'string' ? value : undefined;
}

function statusOf(error: unknown): number | null {
  if (typeof error !== 'object' || error === null || !('statusCode' in error)) return null;
  return typeof error.statusCode === 'number' ? error.statusCode : null;
}

/** The real sender. Checks the payload against the shared schema and size cap first. */
export function createWebPushSender(vapid: VapidKeys, options: WebPushSenderOptions): PushSender {
  const sendNotification = options.sendNotification ?? webPush.sendNotification;
  const timeout = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const subjectOk = usableSubject(vapid.subject);
  if (!subjectOk) {
    options.log.warn(
      'push: the VAPID subject is not a mailto: or https: URL, so no nudge will be sent; set HP_VAPID_SUBJECT',
    );
  }
  const vapidDetails = {
    subject: vapid.subject,
    publicKey: vapid.publicKey,
    privateKey: vapid.privateKey,
  };

  return {
    send: async (target, payload, sendOptions) => {
      const host = endpointHost(target.endpoint);
      if (!subjectOk) return { outcome: 'dropped', reason: 'no-subject' };
      // Subscribe refuses these; a row from before a host left the list is dead.
      if (!isPushServiceEndpoint(target.endpoint)) return { outcome: 'gone', statusCode: null };
      const body = JSON.stringify(PushPayloadSchema.parse(payload));
      if (Buffer.byteLength(body) > PUSH_RULES.maxPayloadBytes) {
        options.log.error(
          { kind: payload.kind, host },
          'push: payload over the size cap, not sent',
        );
        return { outcome: 'dropped', reason: 'too-big' };
      }
      try {
        await sendNotification(
          { endpoint: target.endpoint, keys: { p256dh: target.p256dh, auth: target.auth } },
          body,
          {
            vapidDetails,
            TTL: sendOptions.ttlSeconds,
            timeout,
            ...(sendOptions.topic !== undefined ? { topic: sendOptions.topic } : {}),
            ...(sendOptions.urgency !== undefined ? { urgency: sendOptions.urgency } : {}),
          },
        );
        return { outcome: 'ok' };
      } catch (error) {
        const statusCode = statusOf(error);
        if (statusCode === 404 || statusCode === 410) return { outcome: 'gone', statusCode };
        if (statusCode === 413) {
          options.log.error(
            { kind: payload.kind, host },
            'push: the service says the payload is too big',
          );
          return { outcome: 'dropped', reason: 'too-big' };
        }
        if (statusCode === null && isNetworkError(error)) {
          options.log.warn(
            { kind: payload.kind, host, code: codeOf(error) },
            'push: the push service is unreachable',
          );
          return { outcome: 'dropped', reason: 'unreachable' };
        }
        // Apple's Retry-After is logged, not honoured in this slice (plan).
        const retryAfter = retryAfterOf(error);
        options.log.warn(
          {
            kind: payload.kind,
            host,
            statusCode,
            ...(retryAfter !== undefined ? { retryAfter } : {}),
          },
          'push: the push service refused a nudge',
        );
        return { outcome: 'failed', statusCode };
      }
    },
  };
}
