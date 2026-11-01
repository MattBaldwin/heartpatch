import {
  MapResponseSchema,
  PUSH_RULES,
  type MapDetail,
  type PushPayload,
} from '@heartpatch/shared';
import type { FastifyInstance } from 'fastify';
import { pino } from 'pino';
import { afterAll, afterEach, beforeAll, describe, expect, inject, it } from 'vitest';
import { buildApp } from '../../app.js';
import { loadConfig } from '../../config.js';
import { createDbClient, type Database, type DbClient } from '../../db/client.js';
import { keepers, pushSettings, pushSubscriptions, sessions, users } from '../../db/schema.js';
import { newDeviceKeys, newVapidPair } from '../../../tests/vapid.js';
import { SESSION_COOKIE } from '../auth/limits.js';
import { newSessionToken } from '../auth/secrets.js';
import { createPushRepo } from './repo.js';
import { accountDayStart } from './send.js';
import type { PushSendResult, PushSender } from './sender.js';
import { createPushService, type PushService } from './service.js';
import { pushSwitchOf } from './switch.js';

// "Moonberry is in your patch! 👋" (#726d): `PushService.friendArrived`, as
// the hub's `onSubscribed` calls it. The hub's side is in `ws/hub.test.ts`.

const url = inject('testDatabaseUrl');
const HEADERS = { 'x-requested-with': 'heartpatch' };
const DAY_MS = 24 * 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;
const VAPID = { ...newVapidPair(), subject: 'mailto:nudges@pumpkinpatchgames.com' };
const ZONE = 'America/Denver';
// Noon in Denver (MDT, UTC−6) on Oct 14, and the start of a 2-hour repeat
// bucket (buckets start on even UTC hours).
const NOON = '2026-10-14T18:00:00Z';
const TEST_KEEPER = {
  base: 'pip',
  hairColor: 'honey',
  eyeColor: 'sky',
  outfit: 'sunflower',
  face: 'pip',
  body: 'pip',
  skinTone: 'tone-1',
  eyes: 'round' as const,
  brows: 'arched',
  mouth: 'smile',
  extras: [],
};

interface Player {
  id: string;
  username: string;
  token: string;
  endpoint: string;
}

/** A sender that returns outcomes, remembers what it sent, and throws for `throwsFor`. */
function fakeSender(): PushSender & {
  sent: { endpoint: string; payload: PushPayload; ttlSeconds: number }[];
  results: Map<string, PushSendResult>;
  throwsFor: Set<string>;
} {
  const sent: { endpoint: string; payload: PushPayload; ttlSeconds: number }[] = [];
  const results = new Map<string, PushSendResult>();
  const throwsFor = new Set<string>();
  return {
    sent,
    results,
    throwsFor,
    send: (target, payload, options) => {
      if (throwsFor.has(target.endpoint)) return Promise.reject(new Error('push service on fire'));
      sent.push({ endpoint: target.endpoint, payload, ttlSeconds: options.ttlSeconds });
      return Promise.resolve(results.get(target.endpoint) ?? { outcome: 'ok' });
    },
  };
}

describe.skipIf(!url)('the friend nudge (#726d, needs DATABASE_URL)', { timeout: 30_000 }, () => {
  let client: DbClient;
  let db: Database;
  let app: FastifyInstance | undefined;
  const clock = new Date(NOON);
  let counter = 0;

  beforeAll(() => {
    client = createDbClient(url!, { max: 10 });
    db = client.db;
  });
  afterAll(() => client.close());
  afterEach(async () => {
    await app?.close();
    app = undefined;
    clock.setTime(Date.parse(NOON));
  });

  /** The app (push off) for making patches through the API. */
  async function start(): Promise<FastifyInstance> {
    const config = loadConfig({ NODE_ENV: 'test', DATABASE_URL: url! });
    app = await buildApp({ config, db, clock: () => clock, logger: false });
    return app;
  }

  /**
   * The push service with a fake sender. `online` holds `mapId/userId`
   * pairs; `left` says when a `mapId/userId` last left (absent: unknown).
   */
  function pushService(
    sender: PushSender,
    options: {
      mode?: 'on' | 'off' | 'testers';
      testers?: string[];
      online?: Set<string>;
      left?: Map<string, Date>;
      errors?: unknown[];
    } = {},
  ): PushService {
    const online = options.online ?? new Set<string>();
    const left = options.left ?? new Map<string, Date>();
    const log = pino({ level: 'silent' });
    if (options.errors) {
      const errors = options.errors;
      log.error = (obj: unknown) => {
        errors.push(obj);
      };
    }
    return createPushService({
      db,
      clock: () => clock,
      log,
      push: pushSwitchOf({
        HP_PUSH: options.mode ?? 'on',
        HP_PUSH_TESTERS: options.testers ?? [],
      }),
      vapid: VAPID,
      sender,
      isOnline: (mapId, userId) => online.has(`${mapId}/${userId}`),
      lastOfflineAt: (mapId, userId) => left.get(`${mapId}/${userId}`) ?? null,
    });
  }

  /** A player with one subscribed device on a live session (`device: false`: none). */
  async function player(options: { device?: boolean } = {}): Promise<Player> {
    const username = `friendly_${String((counter += 1))}_${String(Date.now() % 100000)}`;
    const [user] = await db
      .insert(users)
      .values({ username, passwordHash: 'not-a-hash', birthYear: 2014, timeZone: ZONE })
      .returning({ id: users.id });
    await db.insert(keepers).values({ userId: user!.id, ...TEST_KEEPER });
    const { token, tokenHash } = newSessionToken();
    const [session] = await db
      .insert(sessions)
      .values({
        userId: user!.id,
        tokenHash,
        expiresAt: new Date(Date.parse(NOON) + 30 * DAY_MS),
      })
      .returning({ id: sessions.id });
    const endpoint = `https://web.push.apple.com/QGfriend${String(counter)}-${String(Date.now())}`;
    if (options.device ?? true) {
      await db.insert(pushSubscriptions).values({
        userId: user!.id,
        sessionId: session!.id,
        endpoint,
        ...newDeviceKeys(),
        createdAt: clock,
      });
    }
    return { id: user!.id, username, token, endpoint };
  }

  /** A patch for `owner` and `others` (joined through invite → approve). */
  async function patch(owner: Player, others: Player[] = []) {
    const server = app ?? (await start());
    const call = (who: Player, path: string, payload: object) =>
      server.inject({
        method: 'POST',
        url: `/api/v1${path}`,
        headers: HEADERS,
        cookies: { [SESSION_COOKIE]: who.token },
        payload,
      });
    const res = await call(owner, '/maps', { name: 'Friend Patch', timeZone: ZONE });
    expect(res.statusCode, res.body).toBe(201);
    const map: MapDetail = MapResponseSchema.parse(res.json()).map;
    for (const other of others) {
      const join = await call(other, '/maps/join', { code: map.admin!.invite!.code });
      expect(join.statusCode).toBe(201);
      const { request } = join.json<{ request: { id: string } }>();
      const ok = await call(owner, `/maps/${map.id}/requests/${request.id}/approve`, {});
      expect(ok.statusCode).toBe(204);
    }
    return map.id;
  }

  const minutesAgo = (minutes: number) => new Date(clock.getTime() - minutes * MINUTE_MS);
  const friendSendsOf = (userId: string) =>
    db.query.pushSends.findMany({
      where: (t, { and, eq }) => and(eq(t.userId, userId), eq(t.kind, 'friend')),
      orderBy: (t, { asc }) => asc(t.claimedAt),
    });
  const sentTo = (sender: ReturnType<typeof fakeSender>, who: Player) =>
    sender.sent.filter((s) => s.endpoint === who.endpoint);

  it('names the arriver to an away patch-mate, short-lived, opening the patch', async () => {
    const moon = await player();
    const kid = await player();
    const mapId = await patch(moon, [kid]);
    const sender = fakeSender();
    const push = pushService(sender, { left: new Map([[`${mapId}/${kid.id}`, minutesAgo(15)]]) });

    const result = await push.friendArrived(mapId, moon.id);

    expect(result).toEqual({ due: 1, claimed: 1, delivered: 1, quiet: 0, capped: 0 });
    expect(sentTo(sender, kid)).toEqual([
      {
        endpoint: kid.endpoint,
        payload: {
          v: 1,
          kind: 'friend',
          title: `${moon.username} is in your patch! 👋`,
          body: 'Pop in and say hi.',
          mapId,
          tag: `friend:${mapId}`,
        },
        ttlSeconds: PUSH_RULES.ttlSeconds.friend,
      },
    ]);
    // Never the arriver.
    expect(sentTo(sender, moon)).toEqual([]);
    const bucket = Math.floor(clock.getTime() / (PUSH_RULES.friendRepeatHours * 60 * MINUTE_MS));
    expect(await friendSendsOf(kid.id)).toEqual([
      expect.objectContaining({
        dedupeKey: `${mapId}/${moon.id}/${String(bucket)}`,
        mapId,
        sentAt: clock,
        devices: 1,
      }),
    ]);
    expect(await friendSendsOf(moon.id)).toEqual([]);
  });

  it('counts an unknown time away (not seen since the server started) as long ago', async () => {
    const moon = await player();
    const kid = await player();
    const mapId = await patch(moon, [kid]);
    const sender = fakeSender();
    // No `left` entry: the hub has never seen the kid on this patch.
    const result = await pushService(sender).friendArrived(mapId, moon.id);
    expect(result.delivered).toBe(1);
    expect(sentTo(sender, kid)).toHaveLength(1);
  });

  it('skips patch-mates who are here, just left, switched it off or have no device', async () => {
    const moon = await player();
    const away = await player();
    const here = await player();
    const justLeft = await player();
    const friendOff = await player();
    const noDevice = await player({ device: false });
    const mapId = await patch(moon, [away, here, justLeft, friendOff, noDevice]);
    await db.insert(pushSettings).values({
      userId: friendOff.id,
      dusk: true,
      gatherers: true,
      friend: false,
      longNight: true,
      updatedAt: clock,
    });
    const sender = fakeSender();
    const push = pushService(sender, {
      online: new Set([`${mapId}/${here.id}`]),
      left: new Map([
        [`${mapId}/${away.id}`, minutesAgo(PUSH_RULES.friendAwayMinutes)],
        [`${mapId}/${justLeft.id}`, minutesAgo(PUSH_RULES.friendAwayMinutes - 1)],
        // Gone a while from the patch (but here now: online wins).
        [`${mapId}/${here.id}`, minutesAgo(60)],
      ]),
    });

    const result = await push.friendArrived(mapId, moon.id);

    expect(result).toMatchObject({ due: 1, delivered: 1 });
    expect(sender.sent.map((s) => s.endpoint)).toEqual([away.endpoint]);
    for (const who of [moon, here, justLeft, friendOff, noDevice]) {
      expect(await friendSendsOf(who.id)).toEqual([]);
    }
  });

  it('sends nothing while push is off, or to a patch-mate it is off for', async () => {
    const moon = await player();
    const tester = await player();
    const other = await player();
    const mapId = await patch(moon, [tester, other]);
    const sender = fakeSender();

    expect(await pushService(sender, { mode: 'off' }).friendArrived(mapId, moon.id)).toEqual({
      due: 0,
      claimed: 0,
      delivered: 0,
      quiet: 0,
      capped: 0,
    });
    expect(sender.sent).toEqual([]);

    // `testers`: only the tester hears about it (the arriver needn't be one).
    const testers = pushService(sender, { mode: 'testers', testers: [tester.username] });
    expect(await testers.friendArrived(mapId, moon.id)).toMatchObject({ due: 1, delivered: 1 });
    expect(sender.sent.map((s) => s.endpoint)).toEqual([tester.endpoint]);
  });

  it('sends nothing for an arriver who is not a member of the patch', async () => {
    const owner = await player();
    const kid = await player();
    const stranger = await player();
    const mapId = await patch(owner, [kid]);
    const sender = fakeSender();
    const result = await pushService(sender).friendArrived(mapId, stranger.id);
    expect(result.due).toBe(0);
    expect(sender.sent).toEqual([]);
  });

  it('drops a nudge in quiet hours (the recipient’s zone) without claiming it', async () => {
    const moon = await player();
    const kid = await player();
    const mapId = await patch(moon, [kid]);
    const sender = fakeSender();
    clock.setTime(Date.parse('2026-10-15T04:00:00Z')); // 10 PM in Denver
    const result = await pushService(sender).friendArrived(mapId, moon.id);
    expect(result).toEqual({ due: 1, claimed: 0, delivered: 0, quiet: 1, capped: 0 });
    expect(sender.sent).toEqual([]);
    expect(await friendSendsOf(kid.id)).toEqual([]);
  });

  it('stops at the daily cap', async () => {
    const moon = await player();
    const kid = await player();
    const mapId = await patch(moon, [kid]);
    const repo = createPushRepo(db);
    for (let i = 0; i < PUSH_RULES.dailyCap; i += 1) {
      await repo.claim({
        userId: kid.id,
        kind: 'dusk',
        dedupeKey: `earlier-${String(i)}`,
        mapId,
        now: minutesAgo(60 + i),
        dayStart: accountDayStart(clock, ZONE),
      });
    }
    const sender = fakeSender();
    const result = await pushService(sender).friendArrived(mapId, moon.id);
    expect(result).toMatchObject({ due: 1, claimed: 0, capped: 1 });
    expect(sender.sent).toEqual([]);
  });

  it('nudges about one arriver once per repeat window, then again in the next', async () => {
    const moon = await player();
    const kid = await player();
    const mapId = await patch(moon, [kid]);
    const sender = fakeSender();
    const push = pushService(sender);

    await push.friendArrived(mapId, moon.id);
    // Back again within the window (19:59Z, the same 2-hour bucket): nothing.
    clock.setTime(Date.parse(NOON) + (PUSH_RULES.friendRepeatHours * 60 - 1) * MINUTE_MS);
    expect(await push.friendArrived(mapId, moon.id)).toMatchObject({ due: 1, claimed: 0 });
    expect(sentTo(sender, kid)).toHaveLength(1);
    // The next window (20:00Z): one more.
    clock.setTime(Date.parse(NOON) + PUSH_RULES.friendRepeatHours * 60 * MINUTE_MS);
    expect(await push.friendArrived(mapId, moon.id)).toMatchObject({ claimed: 1, delivered: 1 });
    expect(sentTo(sender, kid)).toHaveLength(2);
    expect(await friendSendsOf(kid.id)).toHaveLength(2);
  });

  it('a send that throws for one patch-mate is logged and the others still get theirs', async () => {
    const moon = await player();
    const first = await player();
    const second = await player();
    const mapId = await patch(moon, [first, second]);
    // Whichever comes first in id order fails.
    const [broken, fine] = first.id < second.id ? [first, second] : [second, first];
    const sender = fakeSender();
    sender.throwsFor.add(broken.endpoint);
    const errors: unknown[] = [];

    const result = await pushService(sender, { errors }).friendArrived(mapId, moon.id);

    expect(result).toMatchObject({ due: 2, claimed: 2, delivered: 1 });
    expect(sender.sent.map((s) => s.endpoint)).toEqual([fine.endpoint]);
    expect(errors).toEqual([expect.objectContaining({ kind: 'friend', userId: broken.id })]);
    // The failed one is still claimed (at most once) and marked as reaching nobody.
    expect(await friendSendsOf(broken.id)).toEqual([
      expect.objectContaining({ sentAt: null, devices: 0 }),
    ]);
  });
});
