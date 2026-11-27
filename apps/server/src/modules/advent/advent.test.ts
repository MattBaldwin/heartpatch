import {
  AdventViewSchema,
  ApiErrorSchema,
  ClaimAdventResponseSchema,
  MapResponseSchema,
  MapViewSchema,
  OpenPresentResponseSchema,
  type AdventView,
} from '@heartpatch/shared';
import { ADVENT_PRESENTS, adventSeed, rollAdventPresent } from '@heartpatch/shared/server';
import type { FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeAll, describe, expect, inject, it } from 'vitest';
import { buildApp } from '../../app.js';
import { loadConfig } from '../../config.js';
import { createDbClient, type Database, type DbClient } from '../../db/client.js';
import { keepers, sessions, users } from '../../db/schema.js';
import { PUBLIC_VIEWS, publicViewFor } from '../../ws/public-views.js';
import { SESSION_COOKIE } from '../auth/limits.js';
import { newSessionToken } from '../auth/secrets.js';
import { grantItems } from '../inventory/service.js';
import { createAdventService } from './service.js';

const url = inject('testDatabaseUrl');
const HEADERS = { 'x-requested-with': 'heartpatch' };
const DAY_MS = 24 * 60 * 60 * 1000;
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
/** Dec 5, noon UTC: the fifth advent day on a UTC patch. */
const START = '2026-12-05T12:00:00Z';

interface Player {
  id: string;
  username: string;
  token: string;
}

describe.skipIf(!url)('advent presents, #37 1c (needs DATABASE_URL)', () => {
  let client: DbClient;
  let db: Database;
  let app: FastifyInstance | undefined;
  const clock = new Date(START);
  let counter = 0;

  beforeAll(() => {
    client = createDbClient(url!, { max: 10 });
    db = client.db;
  });
  afterAll(() => client.close());
  afterEach(async () => {
    await app?.close();
    app = undefined;
    clock.setTime(Date.parse(START));
  });

  async function start(): Promise<FastifyInstance> {
    const config = loadConfig({ NODE_ENV: 'test', DATABASE_URL: url! });
    app = await buildApp({ config, db, clock: () => clock, logger: false });
    return app;
  }

  async function player(): Promise<Player> {
    const username = `adventkid_${String((counter += 1))}`;
    const [user] = await db
      .insert(users)
      .values({ username, passwordHash: 'not-a-hash', birthYear: 2014, timeZone: 'UTC' })
      .returning({ id: users.id });
    const { token, tokenHash } = newSessionToken();
    await db.insert(sessions).values({
      userId: user!.id,
      tokenHash,
      expiresAt: new Date(Date.parse(START) + 365 * DAY_MS),
    });
    await db.insert(keepers).values({ userId: user!.id, ...TEST_KEEPER });
    return { id: user!.id, username, token };
  }

  const call = (
    server: FastifyInstance,
    method: 'GET' | 'POST',
    path: string,
    who: Player,
    payload?: object,
  ) =>
    server.inject({
      method,
      url: `/api/v1${path}`,
      headers: HEADERS,
      cookies: { [SESSION_COOKIE]: who.token },
      ...(payload ? { payload } : {}),
    });

  async function newMap(server: FastifyInstance, who: Player, timeZone = 'UTC'): Promise<string> {
    const res = await call(server, 'POST', '/maps', who, { name: 'Snowy Patch', timeZone });
    expect(res.statusCode).toBe(201);
    return MapResponseSchema.parse(res.json()).map.id;
  }

  async function calendar(
    server: FastifyInstance,
    who: Player,
    mapId: string,
  ): Promise<AdventView> {
    const res = await call(server, 'GET', `/maps/${mapId}/advent`, who);
    expect(res.statusCode, res.body).toBe(200);
    return AdventViewSchema.parse(res.json());
  }

  const claim = (server: FastifyInstance, who: Player, mapId: string, day: string) =>
    call(server, 'POST', `/maps/${mapId}/advent/claim`, who, { day });

  async function bag(mapId: string, who: Player): Promise<Record<string, number>> {
    const rows = await db.query.inventories.findMany({
      where: (t, { and, eq }) => and(eq(t.mapId, mapId), eq(t.userId, who.id)),
    });
    return Object.fromEntries(
      rows.filter((r) => r.quantity > 0).map((r) => [r.itemId, r.quantity]),
    );
  }

  const message = (res: { json: () => unknown }) => ApiErrorSchema.parse(res.json()).error.message;

  it("opens today's present into the bag, once, and ledgers it against the claim", async () => {
    const server = await start();
    const kid = await player();
    const mapId = await newMap(server, kid);
    const before = await bag(mapId, kid);

    const view = await calendar(server, kid, mapId);
    expect(view.today).toBe('2026-12-05');
    expect(view.days.map((d) => d.state)).toEqual([
      ...Array<string>(4).fill('catch-up'),
      'today',
      ...Array<string>(20).fill('locked'),
    ]);
    expect(view.catchUpLeft).toBe(true);

    const res = await claim(server, kid, mapId, '2026-12-05');
    expect(res.statusCode, res.body).toBe(200);
    const body = ClaimAdventResponseSchema.parse(res.json());
    const expected = rollAdventPresent(ADVENT_PRESENTS, kid.id, '2026-12-05');
    expect(body.opened).toEqual({ day: '2026-12-05', catchUp: false, items: expected });
    expect(body.advent.days[4]).toMatchObject({ state: 'opened', items: expected });

    const after = await bag(mapId, kid);
    for (const [id, n] of Object.entries(expected)) expect(after[id]).toBe((before[id] ?? 0) + n);

    const [row] = await db.query.adventClaims.findMany({
      where: (t, { eq }) => eq(t.userId, kid.id),
    });
    expect(row).toMatchObject({
      day: '2026-12-05',
      mapId,
      catchUp: false,
      claimedOn: '2026-12-05',
    });
    expect(row!.seed).toBe(adventSeed(ADVENT_PRESENTS, kid.id, '2026-12-05'));
    const ledger = await db.query.resourceLedger.findMany({
      where: (t, { and, eq }) => and(eq(t.userId, kid.id), eq(t.reason, 'advent')),
    });
    expect(ledger.map((l) => l.refId)).toEqual(Object.keys(expected).map(() => row!.id));

    // A second tap is refused and changes nothing.
    const again = await claim(server, kid, mapId, '2026-12-05');
    expect(again.statusCode).toBe(409);
    expect(message(again)).toBe('Already opened! A new present comes tomorrow 🎁');
    expect(await bag(mapId, kid)).toEqual(after);
  });

  it('is account level: a second patch gets the same day refused, and the same present', async () => {
    const server = await start();
    const kid = await player();
    const first = await newMap(server, kid);
    const second = await newMap(server, kid);
    expect((await claim(server, kid, first, '2026-12-05')).statusCode).toBe(200);
    const res = await claim(server, kid, second, '2026-12-05');
    expect(res.statusCode).toBe(409);
    expect((await calendar(server, kid, second)).days[4]!.state).toBe('opened');
  });

  it('a race between two patches writes one claim and one bag', async () => {
    const server = await start();
    const kid = await player();
    const a = await newMap(server, kid);
    const b = await newMap(server, kid);
    const results = await Promise.all([
      claim(server, kid, a, '2026-12-05'),
      claim(server, kid, b, '2026-12-05'),
    ]);
    expect(results.map((r) => r.statusCode).sort()).toEqual([200, 409]);
    expect(
      await db.query.adventClaims.findMany({ where: (t, { eq }) => eq(t.userId, kid.id) }),
    ).toHaveLength(1);
    const ledger = await db.query.resourceLedger.findMany({
      where: (t, { and, eq }) => and(eq(t.userId, kid.id), eq(t.reason, 'advent')),
    });
    expect(new Set(ledger.map((l) => l.mapId)).size).toBe(1);
  });

  it('opens one missed day a day, only past days, and closes after the 25th', async () => {
    const server = await start();
    const kid = await player();
    const mapId = await newMap(server, kid);
    const late = await claim(server, kid, mapId, '2026-12-02');
    expect(late.statusCode, late.body).toBe(200);
    expect(ClaimAdventResponseSchema.parse(late.json()).opened.catchUp).toBe(true);

    const second = await claim(server, kid, mapId, '2026-12-01');
    expect(second.statusCode).toBe(409);
    expect(message(second)).toMatch(/missed present today already/);
    const view = await calendar(server, kid, mapId);
    expect(view.catchUpLeft).toBe(false);
    expect(view.days[0]!.state).toBe('missed');
    // Today's own still opens.
    expect((await claim(server, kid, mapId, '2026-12-05')).statusCode).toBe(200);

    const ahead = await claim(server, kid, mapId, '2026-12-06');
    expect(ahead.statusCode).toBe(409);
    expect(message(ahead)).toBe("Not yet! That one's still wrapped up tight 🎁");
    expect((await claim(server, kid, mapId, '2026-12-26')).statusCode).toBe(400);

    // Tomorrow brings a new catch-up.
    clock.setTime(Date.parse('2026-12-06T12:00:00Z'));
    expect((await claim(server, kid, mapId, '2026-12-01')).statusCode).toBe(200);

    clock.setTime(Date.parse('2026-12-26T12:00:00Z'));
    const over = await claim(server, kid, mapId, '2026-12-10');
    expect(over.statusCode).toBe(409);
    expect(message(over)).toMatch(/all done/);
    expect((await calendar(server, kid, mapId)).catchUpLeft).toBe(false);
  });

  it("uses the claiming patch's own day", async () => {
    const server = await start();
    const kid = await player();
    // Dec 5 12:00 UTC is already Dec 6 in Kiritimati (UTC+14).
    const east = await newMap(server, kid, 'Pacific/Kiritimati');
    expect((await calendar(server, kid, east)).today).toBe('2026-12-06');
    expect((await claim(server, kid, east, '2026-12-06')).statusCode).toBe(200);
  });

  it('shows presentWaiting on the map in December only', async () => {
    const server = await start();
    const kid = await player();
    const mapId = await newMap(server, kid);
    const christmas = async () =>
      MapViewSchema.parse((await call(server, 'GET', `/maps/${mapId}/view`, kid)).json()).christmas;
    expect(await christmas()).toEqual({ presentWaiting: true });
    await claim(server, kid, mapId, '2026-12-05');
    expect(await christmas()).toEqual({ presentWaiting: false });
    clock.setTime(Date.parse('2026-12-27T12:00:00Z'));
    expect(await christmas()).toEqual({ presentWaiting: false });
    clock.setTime(Date.parse('2026-11-27T12:00:00Z'));
    expect(await christmas()).toBeUndefined();
  });

  it('opens a wrapped present from the bag in one transaction', async () => {
    const server = await start();
    const kid = await player();
    const mapId = await newMap(server, kid);
    const none = await call(server, 'POST', `/maps/${mapId}/presents/open`, kid);
    expect(none.statusCode).toBe(409);
    expect(message(none)).toBe('No wrapped presents in your bag right now 🎁');

    await grantItems(db, { mapId, userId: kid.id }, { presents: 2 }, 'dev-grant');
    const before = await bag(mapId, kid);
    const res = await call(server, 'POST', `/maps/${mapId}/presents/open`, kid);
    expect(res.statusCode, res.body).toBe(200);
    const body = OpenPresentResponseSchema.parse(res.json());
    expect(body.presentsLeft).toBe(1);
    expect(body.items['presents']).toBeUndefined();
    const after = await bag(mapId, kid);
    expect(after['presents']).toBe(1);
    for (const [id, n] of Object.entries(body.items)) expect(after[id]).toBe((before[id] ?? 0) + n);

    const ledger = await db.query.resourceLedger.findMany({
      where: (t, { and, eq }) => and(eq(t.userId, kid.id), eq(t.reason, 'present-open')),
    });
    expect(new Set(ledger.map((l) => l.refId)).size).toBe(1);
    expect(ledger.find((l) => l.itemId === 'presents')?.delta).toBe(-1);
    const [event] = await db.query.gameEvents.findMany({
      where: (t, { and, eq }) => and(eq(t.mapId, mapId), eq(t.type, 'present.opened')),
    });
    expect(event!.payload).toMatchObject({ openingId: ledger[0]!.refId, items: body.items });
  });

  it('rolls the whole claim back when the bag write fails', async () => {
    await start();
    const kid = await player();
    const mapId = await newMap(app!, kid);
    // A table naming an item the bag refuses: the claim row must not survive.
    const broken = createAdventService({
      db,
      clock: () => clock,
      presents: {
        ...ADVENT_PRESENTS,
        daily: { picks: 1, pool: [{ itemId: 'not-a-real-item', min: 1, max: 1, weight: 1 }] },
        spareOneIn: 1000,
      },
    });
    const user: Parameters<typeof broken.claim>[0] = { id: kid.id, username: kid.username };
    await expect(broken.claim(user, mapId, '2026-12-05')).rejects.toThrow();
    expect(
      await db.query.adventClaims.findMany({ where: (t, { eq }) => eq(t.userId, kid.id) }),
    ).toEqual([]);
  });

  it('never sends a seed, odds or the salt, and the events are owner-only', async () => {
    const server = await start();
    const kid = await player();
    const friend = await player();
    const mapId = await newMap(server, kid);
    const payloads = [
      (await call(server, 'GET', `/maps/${mapId}/advent`, kid)).body,
      (await claim(server, kid, mapId, '2026-12-05')).body,
      (await call(server, 'GET', `/maps/${mapId}/view`, kid)).body,
    ];
    const seed = adventSeed(ADVENT_PRESENTS, kid.id, '2026-12-05');
    for (const body of payloads) {
      expect(body).not.toContain(seed);
      expect(body).not.toContain(ADVENT_PRESENTS.seedSalt);
      expect(body).not.toMatch(/"weight"|"seed"|spareOneIn|"picks"/);
    }
    const [event] = await db.query.gameEvents.findMany({
      where: (t, { and, eq }) => and(eq(t.mapId, mapId), eq(t.type, 'advent.claimed')),
    });
    expect(publicViewFor(PUBLIC_VIEWS, event!, { userId: friend.id })).toBeNull();
    const mine = publicViewFor(PUBLIC_VIEWS, event!, { userId: kid.id });
    expect(JSON.stringify(mine)).not.toContain('claimId');
  });
});
