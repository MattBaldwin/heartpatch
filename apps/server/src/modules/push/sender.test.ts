import { PUSH_RULES, pushLineFor, type PushPayload } from '@heartpatch/shared';
import pino from 'pino';
import webPush from 'web-push';
import { afterAll, beforeAll, describe, expect, inject, it, vi } from 'vitest';
import { createDbClient, type Database, type DbClient } from '../../db/client.js';
import { pushSubscriptions, sessions, users } from '../../db/schema.js';
import { newDeviceKeys, newVapidPair } from '../../../tests/vapid.js';
import { newSessionToken } from '../auth/secrets.js';
import { createPushRepo } from './repo.js';
import {
  createWebPushSender,
  isPushServiceEndpoint,
  vapidOf,
  type PushSendResult,
  type PushSender,
  type SendNotification,
} from './sender.js';
import { createPushService } from './service.js';
import { pushSwitchOf } from './switch.js';

const VAPID = { ...newVapidPair(), subject: 'mailto:nudges@pumpkinpatchgames.com' };
const MAP_ID = '0190a5f0-0000-7000-8000-000000000001';
const PAYLOAD: PushPayload = {
  v: 1,
  kind: 'dusk',
  ...pushLineFor('dusk'),
  mapId: MAP_ID,
  tag: `dusk/${MAP_ID}`,
};
const OPTIONS = { ttlSeconds: PUSH_RULES.ttlSeconds.dusk, topic: 'dusk', urgency: 'high' as const };

/** A logger that remembers what it was asked to write. */
function recordingLog() {
  const lines: string[] = [];
  const log = pino({ level: 'debug' }, { write: (line: string) => void lines.push(line) });
  return { log, lines };
}

/** A `web-push` error as the library throws it for a push service's reply. */
function replyError(statusCode: number, headers: Record<string, string> = {}): Error {
  return new webPush.WebPushError(
    'Received unexpected response code',
    statusCode,
    headers,
    '',
    'x',
  );
}

const target = (endpoint = 'https://web.push.apple.com/QGsecret-device-token') => ({
  endpoint,
  ...newDeviceKeys(),
});

describe('isPushServiceEndpoint', () => {
  it.each([
    'https://web.push.apple.com/QGabc',
    'https://api.push.apple.com/x',
    'https://fcm.googleapis.com/fcm/send/abc:def',
    'https://updates.push.services.mozilla.com/wpush/v2/abc',
    'https://wns2-by3p.notify.windows.com/w/?token=abc',
    'https://WEB.PUSH.APPLE.COM/QGabc',
  ])('takes %s', (endpoint) => {
    expect(isPushServiceEndpoint(endpoint)).toBe(true);
  });

  it.each([
    'http://web.push.apple.com/QGabc',
    'https://web.push.apple.com:8443/QGabc',
    'https://user:pw@web.push.apple.com/QGabc',
    'https://web.push.apple.com.evil.example/QGabc',
    'https://evilpush.apple.com/x',
    'https://evil.example/web.push.apple.com',
    'https://localhost/x',
    'https://127.0.0.1/x',
    'https://169.254.169.254/latest/meta-data',
    'https://heartpatch-db/x',
    'not a url',
  ])('refuses %s', (endpoint) => {
    expect(isPushServiceEndpoint(endpoint)).toBe(false);
  });
});

describe('vapidOf', () => {
  it('falls back to the site for the subject, and is null without keys', () => {
    const keys = { HP_VAPID_PUBLIC_KEY: VAPID.publicKey, HP_VAPID_PRIVATE_KEY: VAPID.privateKey };
    expect(
      vapidOf({ ...keys, HP_VAPID_SUBJECT: undefined, PUBLIC_ORIGIN: 'https://play.example' }),
    ).toEqual({
      publicKey: VAPID.publicKey,
      privateKey: VAPID.privateKey,
      subject: 'https://play.example',
    });
    expect(
      vapidOf({ ...keys, HP_VAPID_SUBJECT: 'mailto:a@b.c', PUBLIC_ORIGIN: 'https://play.example' })
        ?.subject,
    ).toBe('mailto:a@b.c');
    expect(
      vapidOf({
        HP_VAPID_PUBLIC_KEY: undefined,
        HP_VAPID_PRIVATE_KEY: undefined,
        HP_VAPID_SUBJECT: undefined,
        PUBLIC_ORIGIN: 'https://play.example',
      }),
    ).toBeNull();
  });
});

describe('the web-push sender', () => {
  const senderWith = (fake: SendNotification, subject = VAPID.subject) => {
    const { log, lines } = recordingLog();
    return {
      sender: createWebPushSender({ ...VAPID, subject }, { log, sendNotification: fake }),
      lines,
    };
  };

  it('signs with the VAPID pair and passes TTL, topic and urgency', async () => {
    const fake = vi
      .fn<SendNotification>()
      .mockResolvedValue({ statusCode: 201, body: '', headers: {} });
    const { sender } = senderWith(fake);
    const device = target();
    expect(await sender.send(device, PAYLOAD, OPTIONS)).toEqual({ outcome: 'ok' });
    expect(fake).toHaveBeenCalledTimes(1);
    const [subscription, body, options] = fake.mock.calls[0]!;
    expect(subscription).toEqual({
      endpoint: device.endpoint,
      keys: { p256dh: device.p256dh, auth: device.auth },
    });
    expect(JSON.parse(body as string)).toEqual(PAYLOAD);
    expect(options).toMatchObject({
      vapidDetails: VAPID,
      TTL: PUSH_RULES.ttlSeconds.dusk,
      topic: 'dusk',
      urgency: 'high',
    });
  });

  it('the real library accepts those options and encrypts for the device', async () => {
    // `generateRequestDetails` is everything `sendNotification` does short of the network.
    const fake: SendNotification = (subscription, payload, options) => {
      expect(typeof payload).toBe('string');
      const details: { headers: Record<string, unknown>; body: unknown } =
        webPush.generateRequestDetails(subscription, payload as string, options);
      expect(details.headers).toMatchObject({
        TTL: PUSH_RULES.ttlSeconds.dusk,
        Topic: 'dusk',
        Urgency: 'high',
        'Content-Encoding': 'aes128gcm',
      });
      expect(String(details.headers['Authorization'])).toMatch(
        new RegExp(`^vapid t=.+, k=${VAPID.publicKey}$`),
      );
      // Encrypted: the words aren't in the body.
      expect(Buffer.isBuffer(details.body)).toBe(true);
      expect((details.body as Buffer).toString('utf8')).not.toContain('dark');
      return Promise.resolve({ statusCode: 201, body: '', headers: {} });
    };
    expect(await senderWith(fake).sender.send(target(), PAYLOAD, OPTIONS)).toEqual({
      outcome: 'ok',
    });
  });

  it.each<[string, () => Error, PushSendResult]>([
    ['404', () => replyError(404), { outcome: 'gone', statusCode: 404 }],
    ['410', () => replyError(410), { outcome: 'gone', statusCode: 410 }],
    ['413', () => replyError(413), { outcome: 'dropped', reason: 'too-big' }],
    [
      '429',
      () => replyError(429, { 'retry-after': '120' }),
      { outcome: 'failed', statusCode: 429 },
    ],
    ['500', () => replyError(500), { outcome: 'failed', statusCode: 500 }],
    ['403 (a key change)', () => replyError(403), { outcome: 'failed', statusCode: 403 }],
    [
      'a network error',
      () => Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' }),
      { outcome: 'dropped', reason: 'unreachable' },
    ],
    ['a timeout', () => new Error('Socket timeout'), { outcome: 'dropped', reason: 'unreachable' }],
    [
      'keys that will not encrypt',
      () => new Error('The subscription p256dh value should be 65 bytes long.'),
      { outcome: 'failed', statusCode: null },
    ],
  ])('a %s is classified for the bookkeeping', async (_name, error, expected) => {
    const { sender, lines } = senderWith(() => Promise.reject(error()));
    expect(await sender.send(target(), PAYLOAD, OPTIONS)).toEqual(expected);
    // Logs name the push service, never the device's endpoint or our key.
    for (const line of lines) {
      expect(line).not.toContain('QGsecret-device-token');
      expect(line).not.toContain(VAPID.privateKey);
    }
  });

  it('logs Retry-After and the host only', async () => {
    const { sender, lines } = senderWith(() =>
      Promise.reject(replyError(429, { 'retry-after': '120' })),
    );
    await sender.send(target(), PAYLOAD, OPTIONS);
    expect(lines.join('\n')).toMatch(/"host":"web\.push\.apple\.com"/);
    expect(lines.join('\n')).toMatch(/"retryAfter":"120"/);
  });

  it('never posts to a host that is not a push service', async () => {
    const fake = vi.fn<SendNotification>();
    const { sender } = senderWith(fake);
    expect(await sender.send(target('https://10.0.0.5/internal'), PAYLOAD, OPTIONS)).toEqual({
      outcome: 'gone',
      statusCode: null,
    });
    expect(fake).not.toHaveBeenCalled();
  });

  it('never sends a payload over the size cap', async () => {
    const fake = vi.fn<SendNotification>();
    const { sender } = senderWith(fake);
    // Control characters are six bytes each once JSON-escaped.
    const huge = {
      ...PAYLOAD,
      title: '\u0001'.repeat(80),
      body: '\u0001'.repeat(160),
      tag: '\u0001'.repeat(128),
    };
    expect(Buffer.byteLength(JSON.stringify(huge))).toBeGreaterThan(PUSH_RULES.maxPayloadBytes);
    expect(await sender.send(target(), huge, OPTIONS)).toEqual({
      outcome: 'dropped',
      reason: 'too-big',
    });
    expect(fake).not.toHaveBeenCalled();
  });

  it('refuses a payload outside the shared shape (no extra fields reach a phone)', async () => {
    const fake = vi.fn<SendNotification>();
    const { sender } = senderWith(fake);
    await expect(sender.send(target(), { ...PAYLOAD, title: '' }, OPTIONS)).rejects.toThrow();
    expect(fake).not.toHaveBeenCalled();
  });

  it.each(['http://localhost:5173', 'https://localhost', 'http://play.example'])(
    'sends nothing with an unusable subject (%s), and says so once at boot',
    async (subject) => {
      const fake = vi.fn<SendNotification>();
      const { sender, lines } = senderWith(fake, subject);
      expect(lines.join('\n')).toMatch(/HP_VAPID_SUBJECT/);
      expect(await sender.send(target(), PAYLOAD, OPTIONS)).toEqual({
        outcome: 'dropped',
        reason: 'no-subject',
      });
      expect(fake).not.toHaveBeenCalled();
    },
  );
});

const url = inject('testDatabaseUrl');
const NOW = new Date('2026-11-01T18:00:00Z');

describe.skipIf(!url)('deliver: the subscription books (#726b, needs DATABASE_URL)', () => {
  let client: DbClient;
  let db: Database;
  let counter = 0;

  beforeAll(() => {
    client = createDbClient(url!, { max: 5 });
    db = client.db;
  });
  afterAll(() => client.close());

  async function account(devices: number) {
    const username = `delivery_${String((counter += 1))}_${String(Date.now() % 100000)}`;
    const [user] = await db
      .insert(users)
      .values({ username, passwordHash: 'not-a-hash', birthYear: 2013, timeZone: 'UTC' })
      .returning({ id: users.id });
    const [session] = await db
      .insert(sessions)
      .values({
        userId: user!.id,
        tokenHash: newSessionToken().tokenHash,
        expiresAt: new Date(NOW.getTime() + 86_400_000),
      })
      .returning({ id: sessions.id });
    const endpoints: string[] = [];
    for (let i = 0; i < devices; i += 1) {
      const endpoint = `https://fcm.googleapis.com/fcm/send/${username}-${String(i)}`;
      endpoints.push(endpoint);
      await db.insert(pushSubscriptions).values({
        userId: user!.id,
        sessionId: session!.id,
        endpoint,
        ...newDeviceKeys(),
        createdAt: NOW,
      });
    }
    return { user: { id: user!.id, username }, sessionId: session!.id, endpoints };
  }

  /** A sender that answers per endpoint from a script. */
  function scripted(results: Record<string, PushSendResult>): PushSender & { sent: string[] } {
    const sent: string[] = [];
    return {
      sent,
      send: (device) => {
        sent.push(device.endpoint);
        return Promise.resolve(results[device.endpoint] ?? { outcome: 'ok' });
      },
    };
  }

  const serviceWith = (
    sender: PushSender,
    mode: 'on' | 'off' | 'testers' = 'on',
    testers: string[] = [],
  ) =>
    createPushService({
      db,
      clock: () => NOW,
      log: recordingLog().log,
      push: pushSwitchOf({ HP_PUSH: mode, HP_PUSH_TESTERS: testers }),
      vapid: VAPID,
      sender,
    });

  const rows = (userId: string) =>
    db.query.pushSubscriptions.findMany({
      columns: { endpoint: true, failCount: true, lastOkAt: true },
      where: (t, { eq }) => eq(t.userId, userId),
      orderBy: (t, { asc }) => asc(t.endpoint),
    });

  it('a 2xx resets failures; 404 and 410 delete; a refusal counts; our own faults count nothing', async () => {
    const { user, endpoints } = await account(5);
    const [ok, gone404, gone410, refused, dropped] = endpoints as [
      string,
      string,
      string,
      string,
      string,
    ];
    await db.execute(`update push_subscriptions set fail_count = 4 where user_id = '${user.id}'`);
    const sender = scripted({
      [gone404]: { outcome: 'gone', statusCode: 404 },
      [gone410]: { outcome: 'gone', statusCode: 410 },
      [refused]: { outcome: 'failed', statusCode: 500 },
      [dropped]: { outcome: 'dropped', reason: 'unreachable' },
    });
    expect(await serviceWith(sender).deliver(user, PAYLOAD, OPTIONS)).toEqual({
      devices: 5,
      delivered: 1,
    });
    expect(sender.sent.sort()).toEqual([...endpoints].sort());
    expect(await rows(user.id)).toEqual(
      [
        { endpoint: ok, failCount: 0, lastOkAt: NOW },
        { endpoint: refused, failCount: 5, lastOkAt: null },
        { endpoint: dropped, failCount: 4, lastOkAt: null },
      ].sort((a, b) => a.endpoint.localeCompare(b.endpoint)),
    );
  });

  it(`a device that fails ${String(PUSH_RULES.maxFailures)} times in a row is dropped`, async () => {
    const { user, endpoints } = await account(2);
    const [flaky, fine] = endpoints as [string, string];
    const sender = scripted({ [flaky]: { outcome: 'failed', statusCode: 429 } });
    const service = serviceWith(sender);
    for (let i = 1; i < PUSH_RULES.maxFailures; i += 1) {
      await service.deliver(user, PAYLOAD, OPTIONS);
    }
    expect((await rows(user.id)).find((r) => r.endpoint === flaky)?.failCount).toBe(
      PUSH_RULES.maxFailures - 1,
    );
    expect(await service.deliver(user, PAYLOAD, OPTIONS)).toEqual({ devices: 2, delivered: 1 });
    expect((await rows(user.id)).map((r) => r.endpoint)).toEqual([fine]);
  });

  it('skips a device whose session has expired, though its row is still there', async () => {
    const { user, endpoints } = await account(1);
    const other = await account(0);
    // A second device of the same account, on a session that ran out.
    const [stale] = await db
      .insert(sessions)
      .values({
        userId: user.id,
        tokenHash: newSessionToken().tokenHash,
        expiresAt: new Date(NOW.getTime() - 1),
      })
      .returning({ id: sessions.id });
    await db.insert(pushSubscriptions).values({
      userId: user.id,
      sessionId: stale!.id,
      endpoint: `https://fcm.googleapis.com/fcm/send/${other.user.username}-stale`,
      ...newDeviceKeys(),
      createdAt: NOW,
    });
    const sender = scripted({});
    expect(await serviceWith(sender).deliver(user, PAYLOAD, OPTIONS)).toEqual({
      devices: 1,
      delivered: 1,
    });
    expect(sender.sent).toEqual(endpoints);
  });

  it('sends nothing while push is off for the account', async () => {
    const { user } = await account(1);
    const sender = scripted({});
    expect(
      await serviceWith(sender, 'testers', ['someone_else']).deliver(user, PAYLOAD, OPTIONS),
    ).toEqual({ devices: 0, delivered: 0 });
    expect(
      await createPushService({ db, clock: () => NOW, log: recordingLog().log }).deliver(
        user,
        PAYLOAD,
        OPTIONS,
      ),
    ).toEqual({ devices: 0, delivered: 0 });
    expect(sender.sent).toEqual([]);
    expect(
      await serviceWith(sender, 'testers', [user.username]).deliver(user, PAYLOAD, OPTIONS),
    ).toEqual({ devices: 1, delivered: 1 });
  });

  it('an account with no devices sends nothing', async () => {
    const { user } = await account(0);
    const sender = scripted({});
    expect(await serviceWith(sender).deliver(user, PAYLOAD, OPTIONS)).toEqual({
      devices: 0,
      delivered: 0,
    });
    expect(await createPushRepo(db).targets(user.id, NOW)).toEqual([]);
  });

  it('refuses to build with push on and no keys', () => {
    expect(() =>
      createPushService({
        db,
        clock: () => NOW,
        log: recordingLog().log,
        push: pushSwitchOf({ HP_PUSH: 'on', HP_PUSH_TESTERS: [] }),
      }),
    ).toThrow(/VAPID/);
  });
});
