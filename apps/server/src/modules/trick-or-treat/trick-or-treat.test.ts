import {
  ApiErrorSchema,
  CLOTHING,
  HollowResponseSchema,
  MapResponseSchema,
  TRICK_OR_TREAT,
  TrickOrTreatResponseSchema,
  TrickOrTreatVisitResponseSchema,
  type PublicUser,
} from '@heartpatch/shared';
import { TRICK_OR_TREAT_PRIZES, type TrickOrTreatPrizes } from '@heartpatch/shared/server';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { afterAll, afterEach, beforeAll, describe, expect, inject, it } from 'vitest';
import { buildApp } from '../../app.js';
import { loadConfig } from '../../config.js';
import { createDbClient, withTransaction, type Database, type DbClient } from '../../db/client.js';
import { buildings, clothingOwned, keepers, sessions, users } from '../../db/schema.js';
import { SESSION_COOKIE } from '../auth/limits.js';
import { newSessionToken } from '../auth/secrets.js';
import { grantItems } from '../inventory/service.js';
import { backendPid, waitUntilBlockedBy } from '../../../tests/lock-waits.js';
import { createTrickOrTreatService } from './service.js';

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
/** 10 AM in Denver, in the Halloween season. */
const START = '2026-10-20T16:00:00Z';
const THANKS = TRICK_OR_TREAT.hostThanks;

interface Player extends PublicUser {
  token: string;
}

/** A prize table where only Keeper costumes come up. */
const KEEPER_ONLY: TrickOrTreatPrizes = {
  ...TRICK_OR_TREAT_PRIZES,
  plain: {
    heartdust: { ...TRICK_OR_TREAT_PRIZES.plain.heartdust, weight: 0 },
    keeperCostume: { weight: 1 },
    squishyCostume: { weight: 0 },
  },
};

/** Only Heartdust, a different amount at a lit home: the table shows in the count. */
const DUST_ONLY: TrickOrTreatPrizes = {
  ...TRICK_OR_TREAT_PRIZES,
  plain: {
    heartdust: { weight: 1, min: 1, max: 1 },
    keeperCostume: { weight: 0 },
    squishyCostume: { weight: 0 },
  },
  lantern: {
    heartdust: { weight: 1, min: 3, max: 3 },
    keeperCostume: { weight: 0 },
    squishyCostume: { weight: 0 },
  },
};

describe.skipIf(!url)('trick-or-treat (#515, needs DATABASE_URL)', () => {
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
    const username = `treater_${String((counter += 1))}`;
    const [user] = await db
      .insert(users)
      .values({ username, passwordHash: 'not-a-hash', birthYear: 2014, timeZone: 'America/Denver' })
      .returning({ id: users.id });
    await db.insert(keepers).values({ userId: user!.id, ...TEST_KEEPER });
    const { token, tokenHash } = newSessionToken();
    await db
      .insert(sessions)
      .values({ userId: user!.id, tokenHash, expiresAt: new Date(Date.now() + 30 * DAY_MS) });
    return { id: user!.id, username, token };
  }

  const call = (
    server: FastifyInstance,
    method: 'GET' | 'POST',
    path: string,
    who: Player,
    payload?: object,
    headers: Record<string, string> = {},
  ) =>
    server.inject({
      method,
      url: `/api/v1${path}`,
      headers: { ...HEADERS, ...headers },
      cookies: { [SESSION_COOKIE]: who.token },
      ...(payload ? { payload } : {}),
    });
  const errorOf = (res: LightMyRequestResponse) => ApiErrorSchema.parse(res.json()).error;

  /** A patch of `host`'s that `visitor` has joined. */
  async function patch(server: FastifyInstance, host: Player, visitor: Player): Promise<string> {
    const made = await call(server, 'POST', '/maps', host, {
      name: `Pumpkin Lane ${String(counter)}`,
      timeZone: 'America/Denver',
    });
    expect(made.statusCode, made.body).toBe(201);
    const mapId = MapResponseSchema.parse(made.json()).map.id;
    const detail = async () =>
      MapResponseSchema.parse((await call(server, 'GET', `/maps/${mapId}`, host)).json()).map;
    const code = (await detail()).admin!.invite!.code;
    expect((await call(server, 'POST', '/maps/join', visitor, { code })).statusCode).toBe(201);
    const requestId = (await detail()).admin!.requests[0]!.id;
    const approved = await call(
      server,
      'POST',
      `/maps/${mapId}/requests/${requestId}/approve`,
      host,
    );
    expect(approved.statusCode).toBe(204);
    return mapId;
  }

  const view = async (server: FastifyInstance, who: Player, mapId: string) => {
    const res = await call(server, 'GET', `/maps/${mapId}/trick-or-treat`, who);
    expect(res.statusCode, res.body).toBe(200);
    return TrickOrTreatResponseSchema.parse(res.json()).trickOrTreat;
  };
  const knock = (
    server: FastifyInstance,
    who: Player,
    mapId: string,
    host: PublicUser,
    headers: Record<string, string> = {},
  ) => call(server, 'POST', `/maps/${mapId}/trick-or-treat`, who, { hostUserId: host.id }, headers);

  const ledger = (mapId: string, reason: string) =>
    db.query.resourceLedger.findMany({
      where: (t, { and, eq }) => and(eq(t.mapId, mapId), eq(t.reason, reason)),
    });
  const visits = (mapId: string) =>
    db.query.trickOrTreatVisits.findMany({ where: (t, { eq }) => eq(t.mapId, mapId) });
  const events = (mapId: string) =>
    db.query.gameEvents.findMany({
      where: (t, { and, eq }) => and(eq(t.mapId, mapId), eq(t.type, 'trick.visited')),
    });

  /** Gives `host` a lit Jack-o'-Lantern Hearthfire on a tile of land next to nobody's home. */
  async function lightLantern(mapId: string, host: PublicUser) {
    const tile = await db.query.tiles.findFirst({
      where: (t, { and, eq, isNull }) =>
        and(eq(t.mapId, mapId), isNull(t.ownerUserId), isNull(t.homeSlot), isNull(t.nodeResource)),
    });
    await db.execute(`update tiles set owner_user_id = '${host.id}' where id = '${tile!.id}'`);
    await db.insert(buildings).values({
      mapId,
      ownerUserId: host.id,
      tileId: tile!.id,
      buildingId: TRICK_OR_TREAT.lanternBuildingId,
      kind: 'hearthfire',
      spot: 0,
      fuelledThrough: '2026-10-25',
      fuelUpdatedAt: clock,
    });
  }

  it("knocks on a patch-mate's door for a treat, and thanks the host", async () => {
    const server = await start();
    const [host, visitor] = [await player(), await player()];
    const mapId = await patch(server, host, visitor);

    expect(await view(server, visitor, mapId)).toEqual({
      open: true,
      day: '2026-10-20',
      resetsAt: '2026-10-21T06:00:00.000Z',
      hosts: [{ userId: host.id, lit: false, visited: false }],
    });

    const res = await knock(server, visitor, mapId, host);
    expect(res.statusCode, res.body).toBe(200);
    const { visit, trickOrTreat } = TrickOrTreatVisitResponseSchema.parse(res.json());
    expect(visit).toMatchObject({ hostUserId: host.id, lantern: false });
    expect(trickOrTreat.hosts).toEqual([{ userId: host.id, lit: false, visited: true }]);

    // The treat landed, against the visit.
    if (visit.prize.kind === 'heartdust') {
      const rows = await ledger(mapId, 'trick-or-treat');
      expect(rows.map((r) => [r.userId, r.itemId, r.delta, r.refId])).toEqual([
        [visitor.id, 'heartdust', visit.prize.count, visit.visitId],
      ]);
    } else {
      const piece = await db.query.clothingOwned.findFirst({
        where: (t, { eq }) => eq(t.refId, visit.visitId),
      });
      expect(piece).toMatchObject({
        userId: visitor.id,
        itemId: visit.prize.itemId,
        source: 'trick-or-treat',
      });
    }
    // The host's thank-you, in the same transaction.
    const thanks = await ledger(mapId, 'trick-or-treat-thanks');
    expect(thanks.map((r) => [r.userId, r.itemId, r.delta, r.refId])).toEqual([
      [host.id, 'heartdust', THANKS, visit.visitId],
    ]);
    // One visit row and one event, with the treat only inside.
    const [row] = await visits(mapId);
    expect(row).toMatchObject({
      id: visit.visitId,
      visitorUserId: visitor.id,
      hostUserId: host.id,
      day: '2026-10-20',
      prizeKind: visit.prize.kind,
      prizeItemId: visit.prize.itemId,
      hostHeartdust: THANKS,
    });
    const [event] = await events(mapId);
    expect(event?.actorUserId).toBe(visitor.id);
    expect(event?.payload).toMatchObject({ visitId: visit.visitId, prize: visit.prize });

    // The host can knock back: it's a different home.
    expect((await knock(server, host, mapId, visitor)).statusCode).toBe(200);
  });

  it('gives one treat per home per patch day, and another tomorrow', async () => {
    const server = await start();
    const [host, visitor] = [await player(), await player()];
    const mapId = await patch(server, host, visitor);
    const first = TrickOrTreatVisitResponseSchema.parse(
      (await knock(server, visitor, mapId, host)).json(),
    );

    const again = await knock(server, visitor, mapId, host);
    expect(again.statusCode).toBe(409);
    expect(errorOf(again).message).toBe(
      'You already got a treat here today. Come back tomorrow! 🎃',
    );
    expect(await visits(mapId)).toHaveLength(1);

    // Still the same day just before midnight in Denver, a new one just after.
    clock.setTime(Date.parse('2026-10-21T05:59:00Z'));
    expect((await knock(server, visitor, mapId, host)).statusCode).toBe(409);
    clock.setTime(Date.parse('2026-10-21T06:01:00Z'));
    const tomorrow = await knock(server, visitor, mapId, host);
    expect(tomorrow.statusCode, tomorrow.body).toBe(200);
    expect(TrickOrTreatVisitResponseSchema.parse(tomorrow.json()).visit.visitId).not.toBe(
      first.visit.visitId,
    );
    expect((await visits(mapId)).map((v) => v.day).sort()).toEqual(['2026-10-20', '2026-10-21']);
  });

  it('lets one of two knocks at once through, and refuses the other', async () => {
    const server = await start();
    const [host, visitor] = [await player(), await player()];
    const mapId = await patch(server, host, visitor);
    const both = await Promise.all([
      knock(server, visitor, mapId, host),
      knock(server, visitor, mapId, host),
    ]);
    expect(both.map((r) => r.statusCode).sort()).toEqual([200, 409]);
    expect(await visits(mapId)).toHaveLength(1);
    expect(await ledger(mapId, 'trick-or-treat-thanks')).toHaveLength(1);
    expect(await events(mapId)).toHaveLength(1);
  });

  it("lets two Keepers knock on each other's doors at once", async () => {
    const server = await start();
    const [host, visitor] = [await player(), await player()];
    const mapId = await patch(server, host, visitor);
    for (let round = 0; round < 3; round += 1) {
      const both = await Promise.all([
        knock(server, visitor, mapId, host),
        knock(server, host, mapId, visitor),
      ]);
      expect(
        both.map((r) => r.statusCode),
        both.map((r) => r.body).join(' | '),
      ).toEqual([200, 200]);
      clock.setTime(clock.getTime() + DAY_MS);
    }
    expect(await visits(mapId)).toHaveLength(6);
  });

  it("makes both bags' new rows in user order before granting, so a knock back never deadlocks (#557)", async () => {
    const server = await start();
    const [a, b] = [await player(), await player()];
    const mapId = await patch(server, a, b);
    const [low, high] = a.id < b.id ? [a, b] : [b, a];
    const service = createTrickOrTreatService({ db, clock: () => clock, prizes: DUST_ONLY });
    // A rival transaction in user order (as a knock back takes them): it makes
    // the lower Keeper's new Heartdust row and holds it while the higher Keeper
    // knocks. Granting the visitor's row first would hold the higher row while
    // waiting on ours, and our next insert would deadlock.
    let knocked: ReturnType<typeof service.visit> | undefined;
    await withTransaction(db, async (tx) => {
      const pid = await backendPid(tx);
      await grantItems(tx, { mapId, userId: low.id }, { heartdust: 1 }, 'trick-or-treat');
      knocked = service.visit(high, mapId, { hostUserId: low.id });
      await waitUntilBlockedBy(db, pid);
      await tx.execute("set local lock_timeout = '2s'");
      await grantItems(tx, { mapId, userId: high.id }, { heartdust: 1 }, 'trick-or-treat');
    });
    const visit = await knocked!;
    expect(visit.visit.prize).toEqual({ kind: 'heartdust', itemId: 'heartdust', count: 1 });
    const bag = await db.query.inventories.findMany({ where: (t, { eq }) => eq(t.mapId, mapId) });
    expect(Object.fromEntries(bag.map((r) => [r.userId, r.quantity]))).toEqual({
      [high.id]: 2,
      [low.id]: 1 + THANKS,
    });
  });

  it('replays a retried knock (Idempotency-Key) without a second treat', async () => {
    const server = await start();
    const [host, visitor] = [await player(), await player()];
    const mapId = await patch(server, host, visitor);
    const key = { 'idempotency-key': '0190a8c4-0000-7000-8000-00000000abcd' };
    const once = await knock(server, visitor, mapId, host, key);
    const twice = await knock(server, visitor, mapId, host, key);
    expect(once.statusCode).toBe(200);
    expect(twice.statusCode).toBe(200);
    expect(twice.json()).toEqual(once.json());
    expect(await visits(mapId)).toHaveLength(1);
    expect(await ledger(mapId, 'trick-or-treat-thanks')).toHaveLength(1);
  });

  it('refuses your own home, a home not on the patch, and knocking out of season', async () => {
    const server = await start();
    const [host, visitor, stranger] = [await player(), await player(), await player()];
    const mapId = await patch(server, host, visitor);

    const own = await knock(server, visitor, mapId, visitor);
    expect(own.statusCode).toBe(400);
    expect(errorOf(own).message).toBe("That's your own home! Knock on a friend's door. 🎃");
    const away = await knock(server, visitor, mapId, stranger);
    expect(away.statusCode).toBe(404);
    expect(errorOf(away).message).toBe("That home isn't on this patch.");
    // Not a member: the patch isn't there for them.
    expect((await knock(server, stranger, mapId, host)).statusCode).toBe(404);

    // Nov 12: the season is over (2026's runs to Nov 9).
    clock.setTime(Date.parse('2026-11-12T17:00:00Z'));
    expect((await view(server, visitor, mapId)).open).toBe(false);
    const closed = await knock(server, visitor, mapId, host);
    expect(closed.statusCode).toBe(409);
    expect(errorOf(closed).message).toBe(
      'Trick-or-treat is for Halloween. See you next October! 🎃',
    );
    expect(await visits(mapId)).toEqual([]);
  });

  it("rolls from the better table at a home with a lit Jack-o'-Lantern", async () => {
    const server = await start();
    const [host, visitor] = [await player(), await player()];
    const mapId = await patch(server, host, visitor);
    await lightLantern(mapId, host);

    expect((await view(server, visitor, mapId)).hosts).toEqual([
      { userId: host.id, lit: true, visited: false },
    ]);
    // Only Heartdust comes up here, so the table shows in the count.
    const service = createTrickOrTreatService({ db, clock: () => clock, prizes: DUST_ONLY });
    const lit = await service.visit(visitor, mapId, { hostUserId: host.id });
    expect(lit.visit).toMatchObject({
      lantern: true,
      prize: { kind: 'heartdust', count: DUST_ONLY.lantern.heartdust.min },
    });
    // Out of fuel: the lantern isn't lit, and the treats are plain again.
    clock.setTime(Date.parse('2026-10-27T16:00:00Z'));
    expect((await view(server, visitor, mapId)).hosts[0]?.lit).toBe(false);
    const plain = await service.visit(visitor, mapId, { hostUserId: host.id });
    expect(plain.visit).toMatchObject({
      lantern: false,
      prize: { kind: 'heartdust', count: DUST_ONLY.plain.heartdust.min },
    });
  });

  it('gives only costumes the visitor lacks, then Heartdust once they own them all', async () => {
    const server = await start();
    const [host, visitor] = [await player(), await player()];
    const mapId = await patch(server, host, visitor);
    const costumes = CLOTHING.filter(
      (i) => i.slot === 'costume' && i.sources.includes('trick-or-treat'),
    ).map((i) => i.id);
    const service = createTrickOrTreatService({ db, clock: () => clock, prizes: KEEPER_ONLY });

    // Own every treat costume but one: that one comes.
    await db
      .insert(clothingOwned)
      .values(
        costumes.slice(1).map((itemId) => ({ userId: visitor.id, itemId, source: 'dev-grant' })),
      );
    const one = await service.visit(visitor, mapId, { hostUserId: host.id });
    expect(one.visit.prize).toEqual({ kind: 'keeper-costume', itemId: costumes[0], count: 1 });

    // Owning them all, the next day's costume roll is Heartdust instead.
    clock.setTime(clock.getTime() + DAY_MS);
    const two = await service.visit(visitor, mapId, { hostUserId: host.id });
    expect(two.visit.prize).toEqual({
      kind: 'heartdust',
      itemId: 'heartdust',
      count: TRICK_OR_TREAT_PRIZES.plain.heartdust.min,
    });
  });

  it("puts yesterday's trick-or-treaters in the host's morning report", async () => {
    const server = await start();
    const [host, visitor] = [await player(), await player()];
    const mapId = await patch(server, host, visitor);
    const hollow = async () =>
      HollowResponseSchema.parse((await call(server, 'GET', `/maps/${mapId}/hollow`, host)).json())
        .hollow;

    expect((await knock(server, visitor, mapId, host)).statusCode).toBe(200);
    // Not until the next morning.
    expect((await hollow()).trickOrTreat).toBeNull();
    clock.setTime(clock.getTime() + DAY_MS);
    expect((await hollow()).trickOrTreat).toEqual({
      day: '2026-10-20',
      visitors: 1,
      heartdust: THANKS,
    });
  });
});
