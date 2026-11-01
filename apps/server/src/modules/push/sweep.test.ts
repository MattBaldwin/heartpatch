import {
  isTradingPost,
  hexDistance,
  MapResponseSchema,
  PUSH_RULES,
  PUSH_TEXT,
  type MapDetail,
  type PushPayload,
} from '@heartpatch/shared';
import { SERVER_GAME_DATA } from '@heartpatch/shared/server';
import type { FastifyInstance } from 'fastify';
import { pino } from 'pino';
import { afterAll, afterEach, beforeAll, describe, expect, inject, it } from 'vitest';
import { buildApp } from '../../app.js';
import { loadConfig } from '../../config.js';
import { createDbClient, type Database, type DbClient } from '../../db/client.js';
import {
  buildings,
  factoryQueues,
  gatherJobs,
  keepers,
  pushSends,
  pushSettings,
  pushSubscriptions,
  sessions,
  squishies,
  users,
} from '../../db/schema.js';
import { newDeviceKeys, newVapidPair } from '../../../tests/vapid.js';
import { SESSION_COOKIE } from '../auth/limits.js';
import { newSessionToken } from '../auth/secrets.js';
import type { PushSendResult, PushSender } from './sender.js';
import { createPushRepo } from './repo.js';
import { createPushService, type PushService } from './service.js';
import { accountDayStart, duskWindowOf } from './sweep.js';
import { pushSwitchOf } from './switch.js';

const url = inject('testDatabaseUrl');
const HEADERS = { 'x-requested-with': 'heartpatch' };
const DAY_MS = 24 * 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;
const VAPID = { ...newVapidPair(), subject: 'mailto:nudges@pumpkinpatchgames.com' };
const SPECIES = SERVER_GAME_DATA.secretSpecies[0]!;
// Denver is on MDT (UTC−6) in mid-October: nightfall (7 PM) on Oct 13 is 01:00Z
// on Oct 14, so the dusk window is 00:00Z–01:00Z.
const ZONE = 'America/Denver';
const DUSK = '2026-10-14T00:30:00Z'; // 6:30 PM in Denver
const TONIGHT = '2026-10-13';
const NOON = '2026-10-14T18:00:00Z'; // noon in Denver, Oct 14
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

describe('duskWindowOf', () => {
  it('is open from an hour before nightfall until nightfall, in the patch’s zone', () => {
    const at = (iso: string) => duskWindowOf({ timeZone: ZONE }, new Date(iso));
    expect(at('2026-10-13T23:59:00Z')).toBeNull(); // 5:59 PM
    expect(at('2026-10-14T00:00:00Z')).toEqual({ kind: 'dusk', night: TONIGHT });
    expect(at('2026-10-14T00:59:00Z')).toEqual({ kind: 'dusk', night: TONIGHT });
    expect(at('2026-10-14T01:00:00Z')).toBeNull(); // night has fallen
    // Another zone, another hour: 6 PM in Tokyo is 09:00Z.
    expect(duskWindowOf({ timeZone: 'Asia/Tokyo' }, new Date('2026-10-14T09:10:00Z'))).toEqual({
      kind: 'dusk',
      night: '2026-10-14',
    });
  });

  it('follows the wall clock across a daylight-saving change', () => {
    // Nov 1 2026: Denver falls back to MST (UTC−7), so dusk is 01:00Z–02:00Z on Nov 2.
    const at = (iso: string) => duskWindowOf({ timeZone: ZONE }, new Date(iso));
    expect(at('2026-11-02T00:30:00Z')).toBeNull(); // 5:30 PM MST
    expect(at('2026-11-02T01:30:00Z')).toEqual({ kind: 'dusk', night: '2026-11-01' });
  });
});

describe('accountDayStart', () => {
  it('is midnight in the account’s zone', () => {
    expect(accountDayStart(new Date(DUSK), ZONE).toISOString()).toBe('2026-10-13T06:00:00.000Z');
    expect(accountDayStart(new Date(DUSK), 'UTC').toISOString()).toBe('2026-10-14T00:00:00.000Z');
  });
});

interface Player {
  id: string;
  username: string;
  token: string;
  sessionId: string;
  endpoint: string;
}

/** A sender that returns outcomes (never throws, like the real one) and remembers what it sent. */
function fakeSender(): PushSender & {
  sent: { endpoint: string; payload: PushPayload; ttlSeconds: number }[];
  results: Map<string, PushSendResult>;
} {
  const sent: { endpoint: string; payload: PushPayload; ttlSeconds: number }[] = [];
  const results = new Map<string, PushSendResult>();
  return {
    sent,
    results,
    send: (target, payload, options) => {
      sent.push({ endpoint: target.endpoint, payload, ttlSeconds: options.ttlSeconds });
      return Promise.resolve(results.get(target.endpoint) ?? { outcome: 'ok' });
    },
  };
}

// Each sweep reads every patch in the shared test database: roomy under a full parallel run.
describe.skipIf(!url)(
  'the push sweep: dusk and gatherers (#726c, needs DATABASE_URL)',
  { timeout: 30_000 },
  () => {
    let client: DbClient;
    let db: Database;
    let app: FastifyInstance | undefined;
    const clock = new Date(DUSK);
    let counter = 0;
    let endpoints = 0;

    beforeAll(() => {
      client = createDbClient(url!, { max: 10 });
      db = client.db;
    });
    afterAll(() => client.close());
    afterEach(async () => {
      await app?.close();
      app = undefined;
      clock.setTime(Date.parse(DUSK));
    });

    /** The app (push off) for making patches through the API. */
    async function start(): Promise<FastifyInstance> {
      const config = loadConfig({ NODE_ENV: 'test', DATABASE_URL: url! });
      app = await buildApp({ config, db, clock: () => clock, logger: false });
      return app;
    }

    /** The push service with a fake sender; `online` holds `mapId/userId` pairs. */
    function pushService(
      sender: PushSender,
      options: { mode?: 'on' | 'off' | 'testers'; testers?: string[]; online?: Set<string> } = {},
    ): PushService {
      const online = options.online ?? new Set<string>();
      return createPushService({
        db,
        clock: () => clock,
        log: pino({ level: 'silent' }),
        push: pushSwitchOf({
          HP_PUSH: options.mode ?? 'on',
          HP_PUSH_TESTERS: options.testers ?? [],
        }),
        vapid: VAPID,
        sender,
        isOnline: (mapId, userId) => online.has(`${mapId}/${userId}`),
      });
    }

    /** A player with one subscribed device on a live session (`device: false`: none). */
    async function player(
      options: { timeZone?: string; device?: boolean; sessionEnds?: Date } = {},
    ): Promise<Player> {
      const username = `nudged_${String((counter += 1))}_${String(Date.now() % 100000)}`;
      const [user] = await db
        .insert(users)
        .values({
          username,
          passwordHash: 'not-a-hash',
          birthYear: 2014,
          timeZone: options.timeZone ?? ZONE,
        })
        .returning({ id: users.id });
      await db.insert(keepers).values({ userId: user!.id, ...TEST_KEEPER });
      const { token, tokenHash } = newSessionToken();
      const [session] = await db
        .insert(sessions)
        .values({
          userId: user!.id,
          tokenHash,
          expiresAt: options.sessionEnds ?? new Date(Date.parse(DUSK) + 30 * DAY_MS),
        })
        .returning({ id: sessions.id });
      const endpoint = `https://web.push.apple.com/QGsweep${String((endpoints += 1))}-${String(Date.now())}`;
      if (options.device ?? true) {
        await db.insert(pushSubscriptions).values({
          userId: user!.id,
          sessionId: session!.id,
          endpoint,
          ...newDeviceKeys(),
          createdAt: clock,
        });
      }
      return { id: user!.id, username, token, sessionId: session!.id, endpoint };
    }

    /** A patch for `owner` and `others` (joined through invite → approve). */
    async function patch(server: FastifyInstance, owner: Player, others: Player[] = []) {
      const call = (who: Player, path: string, payload: object) =>
        server.inject({
          method: 'POST',
          url: `/api/v1${path}`,
          headers: HEADERS,
          cookies: { [SESSION_COOKIE]: who.token },
          payload,
        });
      const res = await call(owner, '/maps', { name: 'Dusk Patch', timeZone: ZONE });
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

    /** Plain land out on the map, 3+ tiles from anyone's, now `who`'s (no fire reaches it). */
    async function farLand(mapId: string, who: Pick<Player, 'id'>, terrain?: string) {
      const all = await db.query.tiles.findMany({
        where: (t, { and, eq, isNull }) => and(eq(t.mapId, mapId), isNull(t.homeSlot)),
        orderBy: (t, { asc }) => [asc(t.q), asc(t.r)],
      });
      const held = all.filter((t) => t.ownerUserId !== null);
      const tile = all.find(
        (t) =>
          t.ownerUserId === null &&
          t.nodeResource === null &&
          !isTradingPost(t) &&
          t.communityId === null &&
          held.every((h) => hexDistance(h, t) >= 3),
      )!;
      await db.execute(
        `update tiles set owner_user_id = '${who.id}'${terrain ? `, terrain = '${terrain}'` : ''} where id = '${tile.id}'`,
      );
      return tile.id;
    }

    /** A squishy of `who`'s at work on `tileId` since `since` (it sleeps out there). */
    async function gatherer(mapId: string, who: Pick<Player, 'id'>, tileId: string, since: Date) {
      const [row] = await db
        .insert(squishies)
        .values({
          mapId,
          ownerUserId: who.id,
          speciesId: SPECIES.id,
          element: SPECIES.element,
          feeling: SPECIES.feeling,
          level: 5,
        })
        .returning({ id: squishies.id });
      await db.execute(
        `update squishies set work_tile_id = '${tileId}', work_since = '${since.toISOString()}', work_started_at = '${since.toISOString()}' where id = '${row!.id}'`,
      );
      return row!.id;
    }

    /** One of `who`'s squishies out on dark land tonight. */
    const inTheDark = async (mapId: string, who: Pick<Player, 'id'>) =>
      gatherer(mapId, who, await farLand(mapId, who), clock);

    const minutesAgo = (minutes: number) => new Date(clock.getTime() - minutes * MINUTE_MS);

    const sendsOf = (userId: string) =>
      db.query.pushSends.findMany({
        where: (t, { eq }) => eq(t.userId, userId),
        orderBy: (t, { asc }) => asc(t.claimedAt),
      });
    const sentTo = (sender: ReturnType<typeof fakeSender>, who: Player) =>
      sender.sent.filter((s) => s.endpoint === who.endpoint);

    describe('dusk', () => {
      it('nudges a member with a squishy in the dark, once, inside the window only', async () => {
        const server = await start();
        const kid = await player();
        const friend = await player();
        const mapId = await patch(server, kid, [friend]);
        await inTheDark(mapId, kid);
        const sender = fakeSender();
        const push = pushService(sender);

        // 5:59 PM: not yet.
        clock.setTime(Date.parse('2026-10-13T23:59:00Z'));
        await push.sweep();
        expect(await sendsOf(kid.id)).toEqual([]);

        clock.setTime(Date.parse(DUSK));
        await push.sweep();
        const [row, ...more] = await sendsOf(kid.id);
        expect(more).toEqual([]);
        expect(row).toMatchObject({
          kind: 'dusk',
          dedupeKey: `${mapId}/${TONIGHT}`,
          mapId,
          claimedAt: clock,
          sentAt: clock,
          devices: 1,
        });
        expect(sentTo(sender, kid)).toEqual([
          {
            endpoint: kid.endpoint,
            payload: { v: 1, kind: 'dusk', ...PUSH_TEXT.dusk, mapId, tag: `dusk:${mapId}` },
            ttlSeconds: PUSH_RULES.ttlSeconds.dusk,
          },
        ]);
        // Nothing of the friend's sleeps out: no nudge for them.
        expect(await sendsOf(friend.id)).toEqual([]);
        expect(sentTo(sender, friend)).toEqual([]);

        // A second sweep (a restart, an overlap) finds the claim: nothing twice.
        clock.setTime(Date.parse('2026-10-14T00:45:00Z'));
        await push.sweep();
        await pushService(sender).sweep();
        expect(await sendsOf(kid.id)).toHaveLength(1);
        expect(sentTo(sender, kid)).toHaveLength(1);

        // Night has fallen: the window is gone (a missed one sends nothing).
        clock.setTime(Date.parse('2026-10-14T01:00:00Z'));
        await push.sweep();
        expect(await sendsOf(kid.id)).toHaveLength(1);

        // Tomorrow's dusk is a new night.
        clock.setTime(Date.parse(DUSK) + DAY_MS);
        await push.sweep();
        // (Its basket filled overnight, so a gatherers nudge may come too.)
        const dusks = (await sendsOf(kid.id)).filter((r) => r.kind === 'dusk');
        expect(dusks.map((r) => r.dedupeKey)).toEqual([
          `${mapId}/${TONIGHT}`,
          `${mapId}/2026-10-14`,
        ]);
      });

      it('sends nothing when a lit fire keeps the squishy safe, or the Hollow Man is at 0 %', async () => {
        const server = await start();
        const kid = await player();
        const mapId = await patch(server, kid);
        const land = await farLand(mapId, kid);
        await gatherer(mapId, kid, land, clock);
        // A fire on that land, fuelled for tonight.
        await db.insert(buildings).values({
          mapId,
          ownerUserId: kid.id,
          tileId: land,
          buildingId: 'hearthfire',
          kind: 'hearthfire',
          spot: 0,
          fuelledThrough: TONIGHT,
        });
        const sender = fakeSender();
        await pushService(sender).sweep();
        expect(await sendsOf(kid.id)).toEqual([]);

        // Unlit tonight (fuelled through yesterday), but he can't strike here.
        await db.execute(
          `update buildings set fuelled_through = '2026-10-12' where tile_id = '${land}'`,
        );
        await db.execute(`update maps set hollow_strength_percent = 0 where id = '${mapId}'`);
        await pushService(sender).sweep();
        expect(await sendsOf(kid.id)).toEqual([]);

        await db.execute(`update maps set hollow_strength_percent = 100 where id = '${mapId}'`);
        await pushService(sender).sweep();
        expect(await sendsOf(kid.id)).toHaveLength(1);
      });

      it('skips a member with dusk switched off, no live device, or push off for them', async () => {
        const server = await start();
        const switchedOff = await player();
        const noDevice = await player({ device: false });
        const expired = await player();
        const notTester = await player();
        const tester = await player();
        const everyone = [switchedOff, noDevice, expired, notTester, tester];
        const mapId = await patch(server, switchedOff, everyone.slice(1));
        for (const who of everyone) await inTheDark(mapId, who);
        // Logged in long ago: the session ran out (expiry deletes no row).
        await db.execute(
          `update sessions set expires_at = '${new Date(Date.parse(DUSK) - MINUTE_MS).toISOString()}' where id = '${expired.sessionId}'`,
        );
        await db.insert(pushSettings).values({
          userId: switchedOff.id,
          dusk: false,
          gatherers: true,
          friend: true,
          longNight: true,
          updatedAt: clock,
        });
        const sender = fakeSender();

        // Off for everyone: nothing at all.
        expect(await pushService(sender, { mode: 'off' }).sweep()).toEqual({
          due: 0,
          claimed: 0,
          delivered: 0,
          quiet: 0,
          capped: 0,
        });
        // Testers: only the tester.
        await pushService(sender, { mode: 'testers', testers: [tester.username] }).sweep();
        for (const who of everyone) {
          expect(await sendsOf(who.id), who.username).toHaveLength(who === tester ? 1 : 0);
        }
        // On: still not the switched-off one, nor the ones with no live device
        // (no claim spent on them either).
        await pushService(sender).sweep();
        expect(await sendsOf(notTester.id)).toHaveLength(1);
        for (const who of [switchedOff, noDevice, expired]) {
          expect(await sendsOf(who.id), who.username).toEqual([]);
        }
      });

      it('a device that is gone still uses up the claim: sent_at stays null, no second try', async () => {
        const server = await start();
        const kid = await player();
        const mapId = await patch(server, kid);
        await inTheDark(mapId, kid);
        const sender = fakeSender();
        // Apple says the device is gone (410) after the candidate query found it:
        // the plan's rule is at most once, so the claim stands with nobody nudged.
        sender.results.set(kid.endpoint, { outcome: 'gone', statusCode: 410 });
        const push = pushService(sender);
        await push.sweep();
        expect(await sendsOf(kid.id)).toEqual([
          expect.objectContaining({ kind: 'dusk', sentAt: null, devices: 1 }),
        ]);
        expect(
          await db.query.pushSubscriptions.findMany({ where: (t, { eq }) => eq(t.userId, kid.id) }),
        ).toEqual([]);
        clock.setTime(Date.parse('2026-10-14T00:40:00Z'));
        await push.sweep();
        expect(await sendsOf(kid.id)).toHaveLength(1);
        expect(sentTo(sender, kid)).toHaveLength(1);
      });

      it('drops a nudge that comes due in quiet hours in the account’s zone', async () => {
        const server = await start();
        // 6:30 PM in Denver is 1:30 AM in London: quiet there.
        const faraway = await player({ timeZone: 'Europe/London' });
        const mapId = await patch(server, faraway);
        await inTheDark(mapId, faraway);
        const sender = fakeSender();
        const push = pushService(sender);
        const result = await push.sweep();
        expect(result.quiet).toBeGreaterThanOrEqual(1);
        expect(await sendsOf(faraway.id)).toEqual([]);
        // Dropped, not delayed: nothing is sent later in the night.
        clock.setTime(Date.parse('2026-10-14T05:00:00Z'));
        await push.sweep();
        expect(await sendsOf(faraway.id)).toEqual([]);
      });

      it('stops at the daily cap, counted in the account’s day', async () => {
        const server = await start();
        const kid = await player();
        const mapId = await patch(server, kid);
        await inTheDark(mapId, kid);
        // Three nudges already today (since midnight in Denver, 06:00Z on Oct 13).
        const earlier = (key: string, at: string) => ({
          userId: kid.id,
          kind: 'gatherers',
          dedupeKey: key,
          mapId: null,
          claimedAt: new Date(at),
          devices: 1,
        });
        await db.insert(pushSends).values([
          earlier('a', '2026-10-13T05:59:00Z'), // yesterday in Denver: doesn't count
          earlier('b', '2026-10-13T06:00:00Z'),
          earlier('c', '2026-10-13T15:00:00Z'),
        ]);
        const sender = fakeSender();
        const push = pushService(sender);
        await push.sweep();
        // Two today: room for one more.
        expect((await sendsOf(kid.id)).map((r) => r.kind)).toEqual([
          'gatherers',
          'gatherers',
          'gatherers',
          'dusk',
        ]);

        // Tomorrow, three already: the dusk nudge is dropped.
        clock.setTime(Date.parse(DUSK) + DAY_MS);
        await db
          .insert(pushSends)
          .values([
            earlier('d', '2026-10-14T07:00:00Z'),
            earlier('e', '2026-10-14T08:00:00Z'),
            earlier('f', '2026-10-14T09:00:00Z'),
          ]);
        const result = await push.sweep();
        expect(result.capped).toBeGreaterThanOrEqual(1);
        expect((await sendsOf(kid.id)).filter((r) => r.kind === 'dusk')).toHaveLength(1);
        expect(sentTo(sender, kid)).toHaveLength(1);
        // A sweep that read a stale count still can't pass it: the claim counts again.
        const claim = {
          userId: kid.id,
          kind: 'dusk' as const,
          dedupeKey: 'stale-count',
          mapId,
          now: clock,
          dayStart: accountDayStart(clock, ZONE),
        };
        expect(await createPushRepo(db).claim(claim)).toBeNull();
        expect(await createPushRepo(db).claim(claim, PUSH_RULES.dailyCap + 1)).toEqual(
          expect.any(String),
        );
        // And the unique key: the same send claimed twice is claimed once.
        expect(await createPushRepo(db).claim(claim, PUSH_RULES.dailyCap + 2)).toBeNull();
      });
    });

    describe('gatherers', () => {
      it('nudges for a node gather ready half an hour, once a day', async () => {
        clock.setTime(Date.parse(NOON));
        const server = await start();
        const kid = await player();
        const mapId = await patch(server, kid);
        const tileId = await farLand(mapId, kid);
        const [job] = await db
          .insert(gatherJobs)
          .values({
            mapId,
            userId: kid.id,
            tileId,
            resource: 'greens',
            items: { greens: 2 },
            startedAt: minutesAgo(60),
            readyAt: minutesAgo(PUSH_RULES.gatherersIdleMinutes - 1),
          })
          .returning({ id: gatherJobs.id });
        const sender = fakeSender();
        const push = pushService(sender);
        // Ready 29 minutes: not yet.
        await push.sweep();
        expect(await sendsOf(kid.id)).toEqual([]);

        clock.setTime(clock.getTime() + MINUTE_MS);
        await push.sweep();
        expect(await sendsOf(kid.id)).toEqual([
          expect.objectContaining({
            kind: 'gatherers',
            dedupeKey: '2026-10-14',
            mapId,
            sentAt: clock,
          }),
        ]);
        expect(sentTo(sender, kid).map((s) => s.payload)).toEqual([
          { v: 1, kind: 'gatherers', ...PUSH_TEXT.gatherers, mapId, tag: `gatherers:${mapId}` },
        ]);
        // Still uncollected an hour later: one a day.
        clock.setTime(clock.getTime() + 60 * MINUTE_MS);
        await push.sweep();
        expect(await sendsOf(kid.id)).toHaveLength(1);

        // Collected: nothing left to nudge about tomorrow.
        await db.execute(
          `update gather_jobs set status = 'collected', ended_at = '${clock.toISOString()}' where id = '${job!.id}'`,
        );
        clock.setTime(clock.getTime() + DAY_MS);
        await push.sweep();
        expect(await sendsOf(kid.id)).toHaveLength(1);
      });

      it('nudges for a factory batch finished half an hour, not one still going or stopped', async () => {
        clock.setTime(Date.parse(NOON));
        const server = await start();
        const kid = await player();
        const busy = await player();
        const stopped = await player();
        const mapId = await patch(server, kid, [busy, stopped]);
        const batch = (who: Player, startedMinutesAgo: number, ended = false) => ({
          mapId,
          userId: who.id,
          buildingId: crypto.randomUUID(),
          recipeId: 'treats',
          total: 2,
          itemSeconds: 5 * 60,
          output: { treats: 1 },
          inputs: {},
          startedAt: minutesAgo(startedMinutesAgo),
          ...(ended ? { endedAt: minutesAgo(1), endReason: 'stopped' as const } : {}),
        });
        // Two 5-minute items: done 40 − 10 = 30 minutes ago, still unbanked.
        await db
          .insert(factoryQueues)
          .values([batch(kid, 40), batch(busy, 39), batch(stopped, 60, true)]);
        const sender = fakeSender();
        await pushService(sender).sweep();
        expect(await sendsOf(kid.id)).toEqual([expect.objectContaining({ kind: 'gatherers' })]);
        expect(await sendsOf(busy.id)).toEqual([]);
        expect(await sendsOf(stopped.id)).toEqual([]);

        // All banked: nothing waits.
        await db.execute(`update factory_queues set banked = total where user_id = '${busy.id}'`);
        clock.setTime(clock.getTime() + 10 * MINUTE_MS);
        await pushService(sender).sweep();
        expect(await sendsOf(busy.id)).toEqual([]);
      });

      it('nudges for a squishy gatherer whose basket was full half an hour ago', async () => {
        clock.setTime(Date.parse(NOON));
        const server = await start();
        const kid = await player();
        const filling = await player();
        const mapId = await patch(server, kid, [filling]);
        // Meadow: four 15-minute cycles (give or take its speed) fill the basket.
        await gatherer(mapId, kid, await farLand(mapId, kid, 'meadow'), minutesAgo(4 * 60));
        // At work 45 minutes: one cycle by now − 30, nowhere near full.
        await gatherer(mapId, filling, await farLand(mapId, filling, 'meadow'), minutesAgo(45));
        const sender = fakeSender();
        await pushService(sender).sweep();
        expect(await sendsOf(kid.id)).toEqual([
          expect.objectContaining({ kind: 'gatherers', mapId }),
        ]);
        expect(await sendsOf(filling.id)).toEqual([]);

        clock.setTime(clock.getTime() + 4 * 60 * MINUTE_MS);
        await pushService(sender).sweep();
        expect(await sendsOf(filling.id)).toEqual([expect.objectContaining({ kind: 'gatherers' })]);
      });

      it('skips a player who is on that patch now, and the gatherers switch off', async () => {
        clock.setTime(Date.parse(NOON));
        const server = await start();
        const kid = await player();
        const quiet = await player();
        const mapId = await patch(server, kid, [quiet]);
        for (const who of [kid, quiet]) {
          await db.insert(gatherJobs).values({
            mapId,
            userId: who.id,
            tileId: await farLand(mapId, who),
            resource: 'greens',
            items: { greens: 2 },
            startedAt: minutesAgo(90),
            readyAt: minutesAgo(60),
          });
        }
        await db.insert(pushSettings).values({
          userId: quiet.id,
          dusk: true,
          gatherers: false,
          friend: true,
          longNight: true,
          updatedAt: clock,
        });
        const sender = fakeSender();
        const online = new Set([`${mapId}/${kid.id}`]);
        await pushService(sender, { online }).sweep();
        expect(await sendsOf(kid.id)).toEqual([]);
        expect(await sendsOf(quiet.id)).toEqual([]);

        // Closed the app: the nudge goes.
        online.clear();
        await pushService(sender, { online }).sweep();
        expect(await sendsOf(kid.id)).toHaveLength(1);
        expect(await sendsOf(quiet.id)).toEqual([]);
      });
    });

    it('dusk comes before gatherers when only one fits under the cap', async () => {
      const server = await start();
      const kid = await player();
      const mapId = await patch(server, kid);
      await inTheDark(mapId, kid);
      await db.insert(gatherJobs).values({
        mapId,
        userId: kid.id,
        tileId: await farLand(mapId, kid),
        resource: 'greens',
        items: { greens: 2 },
        startedAt: minutesAgo(90),
        readyAt: minutesAgo(60),
      });
      await db.insert(pushSends).values(
        ['a', 'b'].map((key) => ({
          userId: kid.id,
          kind: 'friend',
          dedupeKey: key,
          mapId,
          claimedAt: minutesAgo(5),
          devices: 1,
        })),
      );
      await pushService(fakeSender()).sweep();
      expect((await sendsOf(kid.id)).map((r) => r.kind)).toEqual(['friend', 'friend', 'dusk']);
    });
  },
);
