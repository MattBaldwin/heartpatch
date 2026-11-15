import {
  ApiErrorSchema,
  ComputerMatesStateSchema,
  JoinMapResponseSchema,
  MapResponseSchema,
  parseGameEventPayload,
  type MapDetail,
} from '@heartpatch/shared';
import { COMPUTER_MATES } from '@heartpatch/shared/server';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { afterAll, afterEach, beforeAll, describe, expect, inject, it } from 'vitest';
import { buildApp } from '../../app.js';
import { loadConfig } from '../../config.js';
import { createDbClient, type Database, type DbClient } from '../../db/client.js';
import { keepers, mapMembers, maps, sessions, users } from '../../db/schema.js';
import { SESSION_COOKIE } from '../auth/limits.js';
import { newSessionToken } from '../auth/secrets.js';
import { createAdminRepo } from '../admin/repo.js';
import { createPushRepo } from '../push/repo.js';
import { createTerritoryRepo } from '../territory/repo.js';
import { createTradesRepo } from '../trades/repo.js';
import { createComputerMatesRepo, mapIs } from './repo.js';

const url = inject('testDatabaseUrl');
const HEADERS = { 'x-requested-with': 'heartpatch' };
const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
const SIGNUP_CODE = 'mates-signup-code';
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
}

describe.skipIf(!url)('computer patch-mates (#386a, needs DATABASE_URL)', () => {
  let client: DbClient;
  let db: Database;
  let app: FastifyInstance | undefined;
  let clock = new Date();
  let counter = 0;

  beforeAll(() => {
    client = createDbClient(url!, { max: 10 });
    db = client.db;
  });
  afterAll(() => client.close());
  afterEach(async () => {
    await app?.close();
    app = undefined;
    clock = new Date();
  });

  async function start(env: Record<string, string> = { HP_COMPUTER_MATES: 'on' }) {
    const config = loadConfig({
      NODE_ENV: 'test',
      DATABASE_URL: url!,
      HP_SIGNUP_CODE: SIGNUP_CODE,
      ...env,
    });
    app = await buildApp({ config, db, clock: () => clock, logger: false });
    return app;
  }

  async function player(name?: string): Promise<Player> {
    const username = name ?? `matekid_${String((counter += 1))}`;
    const [user] = await db
      .insert(users)
      .values({ username, passwordHash: 'not-a-hash', birthYear: 2014 })
      .returning({ id: users.id });
    const { token, tokenHash } = newSessionToken();
    await db
      .insert(sessions)
      .values({ userId: user!.id, tokenHash, expiresAt: new Date(Date.now() + 30 * DAY_MS) });
    await db.insert(keepers).values({ userId: user!.id, ...TEST_KEEPER });
    return { id: user!.id, username, token };
  }

  function call(
    server: FastifyInstance,
    method: 'GET' | 'POST',
    path: string,
    who: Player | null,
    payload?: object,
  ) {
    return server.inject({
      method,
      url: `/api/v1${path}`,
      headers: HEADERS,
      ...(who ? { cookies: { [SESSION_COOKIE]: who.token } } : {}),
      ...(payload ? { payload } : {}),
    });
  }

  const errorOf = (res: LightMyRequestResponse) => ApiErrorSchema.parse(res.json()).error;

  async function createMap(server: FastifyInstance, owner: Player) {
    const res = await call(server, 'POST', '/maps', owner, {
      name: 'Mate Hollow',
      timeZone: 'America/Chicago',
    });
    expect(res.statusCode).toBe(201);
    return MapResponseSchema.parse(res.json()).map;
  }

  async function getMap(server: FastifyInstance, mapId: string, who: Player): Promise<MapDetail> {
    const res = await call(server, 'GET', `/maps/${mapId}`, who);
    expect(res.statusCode).toBe(200);
    return MapResponseSchema.parse(res.json()).map;
  }

  async function bringIn(server: FastifyInstance, owner: Player, map: MapDetail, name?: string) {
    const p = await player(name);
    const fresh = await getMap(server, map.id, owner);
    const res = await call(server, 'POST', '/maps/join', p, { code: fresh.admin!.invite!.code });
    expect(res.statusCode).toBe(201);
    const request = JoinMapResponseSchema.parse(res.json()).request;
    const approved = await call(
      server,
      'POST',
      `/maps/${map.id}/requests/${request.id}/approve`,
      owner,
    );
    expect(approved.statusCode).toBe(204);
    return p;
  }

  async function patchWith(server: FastifyInstance, extra: number) {
    const owner = await player();
    const map = await createMap(server, owner);
    const members: Player[] = [];
    for (let i = 0; i < extra; i++) members.push(await bringIn(server, owner, map));
    return { owner, map, members };
  }

  const setSwitch = (server: FastifyInstance, who: Player, mapId: string, enabled: boolean) =>
    call(server, 'POST', `/maps/${mapId}/computer-mates`, who, { enabled });

  const activeMates = async (mapId: string) => {
    const [rows, active] = await Promise.all([
      db.query.computerMates.findMany({ where: (t, { eq }) => eq(t.mapId, mapId) }),
      db.query.mapMembers.findMany({
        where: (t, { and, eq }) => and(eq(t.mapId, mapId), eq(t.status, 'active')),
      }),
    ]);
    const on = new Set(active.map((m) => m.userId));
    return rows
      .filter((r) => on.has(r.userId))
      .map((r) => ({ userId: r.userId, personaId: r.personaId }))
      .sort((x, y) => (x.userId < y.userId ? -1 : 1));
  };

  const tilesOf = (mapId: string, owners: string[]) =>
    db.query.tiles.findMany({
      where: (t, { and, eq, inArray }) => and(eq(t.mapId, mapId), inArray(t.ownerUserId, owners)),
    });

  const squishiesOf = (mapId: string, owners: string[]) =>
    db.query.squishies.findMany({
      where: (t, { and, eq, inArray }) => and(eq(t.mapId, mapId), inArray(t.ownerUserId, owners)),
    });

  const eventsOf = (mapId: string) =>
    db.query.gameEvents.findMany({
      where: (t, { eq }) => eq(t.mapId, mapId),
      orderBy: (t, { asc }) => [asc(t.seq)],
    });

  it('the switch is owner-only, default off, refused on a tutorial map, and waits out its cooldown', async () => {
    const server = await start();
    const { owner, map, members } = await patchWith(server, 1);
    expect((await getMap(server, map.id, owner)).computerMates).toEqual({
      enabled: false,
      changeAt: null,
    });
    // A member can't flip it.
    const notOwner = await setSwitch(server, members[0]!, map.id, true);
    expect(notOwner.statusCode).toBe(403);

    // The Tutorial Glade: not a patch, so NOT_FOUND like every owner setting.
    const [glade] = await db
      .insert(maps)
      .values({ kind: 'tutorial', name: 'Glade', timeZone: 'UTC' })
      .returning({ id: maps.id });
    await db.insert(mapMembers).values({ mapId: glade!.id, userId: owner.id, role: 'owner' });
    expect((await setSwitch(server, owner, glade!.id, true)).statusCode).toBe(404);
    expect((await activeMates(glade!.id)).length).toBe(0);

    const on = await setSwitch(server, owner, map.id, true);
    expect(on.statusCode).toBe(200);
    expect(ComputerMatesStateSchema.parse(on.json())).toEqual({ enabled: true, changeAt: null });
    const off = await setSwitch(server, owner, map.id, false);
    expect(off.statusCode).toBe(200);
    const offState = ComputerMatesStateSchema.parse(off.json());
    expect(offState.changeAt).not.toBeNull();
    expect(new Date(offState.changeAt!).getTime() - clock.getTime()).toBe(
      COMPUTER_MATES.rules.toggleCooldownHours * HOUR_MS,
    );
    // Too soon to turn back on.
    const again = await setSwitch(server, owner, map.id, true);
    expect(again.statusCode).toBe(409);
    expect(errorOf(again).message).toMatch(/resting/);
    // Turning off twice is a no-op, not an error.
    expect((await setSwitch(server, owner, map.id, false)).statusCode).toBe(200);

    clock = new Date(clock.getTime() + COMPUTER_MATES.rules.toggleCooldownHours * HOUR_MS);
    expect((await setSwitch(server, owner, map.id, true)).statusCode).toBe(200);
  });

  it('the switch stays shut on a Wild Isle (until 386e)', async () => {
    const server = await start({ HP_COMPUTER_MATES: 'on', HP_WILD_ISLE: 'on' });
    const owner = await player();
    const made = await call(server, 'POST', '/maps', owner, {
      name: 'Splash Cove',
      timeZone: 'UTC',
      patchType: 'wild-isle',
    });
    expect(made.statusCode).toBe(201);
    const isle = MapResponseSchema.parse(made.json()).map;
    const on = await setSwitch(server, owner, isle.id, true);
    expect(on.statusCode).toBe(409);
    expect(errorOf(on).message).toMatch(/Wild Isle/);
    expect((await activeMates(isle.id)).length).toBe(0);
  });

  it('is NOT_FOUND and left out of details while HP_COMPUTER_MATES is off', async () => {
    const server = await start({ HP_COMPUTER_MATES: 'off' });
    const owner = await player();
    const map = await createMap(server, owner);
    expect((await setSwitch(server, owner, map.id, true)).statusCode).toBe(404);
    expect((await getMap(server, map.id, owner)).computerMates).toBeUndefined();
  });

  it('opens only on testers’ patches while HP_COMPUTER_MATES=testers', async () => {
    const owner = await player();
    const other = await player();
    const server = await start({
      HP_COMPUTER_MATES: 'testers',
      HP_COMPUTER_MATES_TESTERS: owner.username.toUpperCase(),
    });
    const mine = await createMap(server, owner);
    const theirs = await createMap(server, other);
    expect((await setSwitch(server, owner, mine.id, true)).statusCode).toBe(200);
    expect((await setSwitch(server, other, theirs.id, true)).statusCode).toBe(404);
  });

  it.each([
    { real: 1, mates: 3 },
    { real: 2, mates: 2 },
    { real: 4, mates: 0 },
    { real: 6, mates: 0 },
  ])('switching on fills to fillTo and no further ($real real)', async ({ real, mates }) => {
    const server = await start();
    const { owner, map } = await patchWith(server, real - 1);
    expect((await setSwitch(server, owner, map.id, true)).statusCode).toBe(200);
    const seated = await activeMates(map.id);
    expect(seated.length).toBe(mates);
    const detail = await getMap(server, map.id, owner);
    expect(detail.members.length).toBe(real + mates);
    const computers = detail.members.filter((m) => m.computer !== undefined);
    expect(computers.map((m) => m.computer!.personaId).sort()).toEqual(
      seated.map((m) => m.personaId).sort(),
    );
    for (const m of computers) {
      expect(m.keeper).toBeNull();
      expect(m.title).toBeNull();
      expect(m.homeSlot).not.toBeNull();
    }
    for (const mate of seated) {
      // A home ring and a team of 3–4 real squishies.
      const home = await tilesOf(map.id, [mate.userId]);
      expect(home.length).toBeGreaterThan(0);
      const team = await squishiesOf(map.id, [mate.userId]);
      expect(team.length).toBeGreaterThanOrEqual(COMPUTER_MATES.rules.teamSize.min);
      expect(team.length).toBeLessThanOrEqual(COMPUTER_MATES.rules.teamSize.max);
      for (const s of team) expect(s.level).toBeGreaterThanOrEqual(1);
    }
    // One transaction: the switch and every mate's arrival share its time.
    const events = (await eventsOf(map.id)).filter(
      (e) =>
        (e.type === 'member.joined' &&
          parseGameEventPayload('member.joined', e.payload).computer === true) ||
        (e.type === 'map.updated' &&
          parseGameEventPayload('map.updated', e.payload).computerMates !== undefined),
    );
    expect(events.length).toBe(mates + 1);
    expect(new Set(events.map((e) => e.createdAt.getTime())).size).toBe(1);
  });

  it('fills an old 4-seat patch to min(fillTo, seats)', async () => {
    const server = await start();
    const { owner, map } = await patchWith(server, 0);
    await db.update(maps).set({ maxPlayers: 3 }).where(mapIs(map.id));
    expect((await setSwitch(server, owner, map.id, true)).statusCode).toBe(200);
    expect((await activeMates(map.id)).length).toBe(2);
  });

  it('switching off departs every mate (land wild), and re-enabling reuses the same user rows', async () => {
    const server = await start();
    const { owner, map } = await patchWith(server, 0);
    await setSwitch(server, owner, map.id, true);
    const before = await activeMates(map.id);
    expect(before.length).toBe(3);
    const ids = before.map((m) => m.userId);

    expect((await setSwitch(server, owner, map.id, false)).statusCode).toBe(200);
    expect((await activeMates(map.id)).length).toBe(0);
    const held = await tilesOf(map.id, ids);
    expect(held.length).toBe(0);
    const offRows = await db.query.computerMates.findMany({
      where: (t, { eq }) => eq(t.mapId, map.id),
    });
    expect(offRows.every((r) => r.nextActAt === null)).toBe(true);
    const left = (await eventsOf(map.id)).filter((e) => e.type === 'member.left');
    expect(left.length).toBe(3);
    for (const e of left) {
      expect(parseGameEventPayload('member.left', e.payload).computer).toBe(true);
    }
    expect(new Set(left.map((e) => e.createdAt.getTime())).size).toBe(1);

    clock = new Date(clock.getTime() + COMPUTER_MATES.rules.toggleCooldownHours * HOUR_MS);
    expect((await setSwitch(server, owner, map.id, true)).statusCode).toBe(200);
    const after = await activeMates(map.id);
    expect(after.map((m) => m.userId)).toEqual(ids);
    // No second team: the same squishies come back with them.
    const teams = await squishiesOf(map.id, ids);
    expect(teams.length).toBeLessThanOrEqual(3 * COMPUTER_MATES.rules.teamSize.max);
    const users3 = await db.query.users.findMany({
      where: (t, { and, eq, inArray }) => and(eq(t.kind, 'computer'), inArray(t.id, ids)),
    });
    expect(users3.length).toBe(3);
    const allMates = await db.query.computerMates.findMany({
      where: (t, { eq }) => eq(t.mapId, map.id),
    });
    expect(allMates.length).toBe(3);
  });

  it('switching off sends a mate’s open offers home; a gift the kid already picked up stays', async () => {
    const server = await start();
    const { owner, map } = await patchWith(server, 0);
    await setSwitch(server, owner, map.id, true);
    const [mate] = await activeMates(map.id);
    const trades = createTradesRepo(db);
    const at = new Date(clock.getTime() - HOUR_MS);
    const expiresAt = new Date(clock.getTime() + DAY_MS);
    // An open offer from the mate: its 2 timber wait in escrow (out of its bag).
    const open = await trades.insertOffer({
      mapId: map.id,
      kind: 'trade',
      fromUserId: mate!.userId,
      toUserId: owner.id,
      noteId: null,
      createdAt: at,
      expiresAt,
    });
    await trades.insertLines(open.id, 'give', [{ kind: 'item', itemId: 'timber', quantity: 2 }]);
    // A gift from the mate the kid already picked up: it's the kid's now.
    const gift = await trades.insertOffer({
      mapId: map.id,
      kind: 'gift',
      fromUserId: mate!.userId,
      toUserId: owner.id,
      noteId: null,
      createdAt: at,
      expiresAt,
    });
    await trades.insertLines(gift.id, 'give', [{ kind: 'item', itemId: 'stone', quantity: 1 }]);
    await trades.setStatus([gift.id], 'accepted', at);
    const kidBag = await trades.bagOf(map.id, owner.id);
    const mateBag = await trades.bagOf(map.id, mate!.userId);

    expect((await setSwitch(server, owner, map.id, false)).statusCode).toBe(200);
    const offerStatus = async (id: string) =>
      (await db.query.tradeOffers.findFirst({ where: (t, { eq }) => eq(t.id, id) }))!.status;
    // The open offer went home: called off as "left", the timber back in the mate's bag.
    expect(await offerStatus(open.id)).toBe('cancelled');
    expect((await trades.bagOf(map.id, mate!.userId))['timber'] ?? 0).toBe(
      (mateBag['timber'] ?? 0) + 2,
    );
    const cancelled = (await eventsOf(map.id)).filter((e) => e.type === 'trade.cancelled');
    expect(cancelled.map((e) => e.payload)).toEqual([
      expect.objectContaining({ offerId: open.id, reason: 'left' }),
    ]);
    // The picked-up gift stays the kid's.
    expect(await offerStatus(gift.id)).toBe('accepted');
    expect(await trades.bagOf(map.id, owner.id)).toEqual(kidBag);
  });

  it('never seats a mate with a kid’s name: a kid named Bramble gets three mates, none Bramble', async () => {
    const server = await start();
    // A pre-0064 kid (signup reserves the persona names now), any case.
    const owner = await player('BRAMBLE');
    const map = await createMap(server, owner);
    expect((await setSwitch(server, owner, map.id, true)).statusCode).toBe(200);
    const seated = await activeMates(map.id);
    expect(seated.length).toBe(3);
    expect(seated.map((m) => m.personaId)).not.toContain('bramble');
    const names = (await getMap(server, map.id, owner)).members.map((m) => m.user.username);
    expect(names.filter((n) => n.toLowerCase() === 'bramble')).toEqual(['BRAMBLE']);
  });

  it('approving a kid with a seated mate’s name sends that mate home first', async () => {
    const server = await start();
    const { owner, map } = await patchWith(server, 0);
    await setSwitch(server, owner, map.id, true);
    const seated = await activeMates(map.id);
    const marigold = seated.find((m) => m.personaId === 'marigold')!;
    expect(marigold).toBeDefined();
    // A pre-0064 kid named Marigold (any case) joins. Without the name rule the
    // least-land tie would send the earliest-created mate (Bramble) instead.
    const kid = await bringIn(server, owner, map, 'mariGOLD');
    const now = await activeMates(map.id);
    expect(now.map((m) => m.personaId).sort()).toEqual(['bramble', 'pocket']);
    const row = await db.query.computerMates.findFirst({
      where: (t, { eq }) => eq(t.userId, marigold.userId),
    });
    expect(row!.nextActAt).toBeNull();
    const left = (await eventsOf(map.id)).find(
      (e) =>
        e.type === 'member.left' &&
        parseGameEventPayload('member.left', e.payload).userId === marigold.userId,
    )!;
    expect(parseGameEventPayload('member.left', left.payload)).toMatchObject({
      computer: true,
      madeRoomFor: kid.id,
    });
    const names = (await getMap(server, map.id, owner)).members.map((m) => m.user.username);
    expect(names.filter((n) => n.toLowerCase() === 'marigold')).toEqual(['mariGOLD']);
  });

  it('the owner can’t remove a computer mate, only a real member', async () => {
    const server = await start();
    const { owner, map, members } = await patchWith(server, 1);
    await setSwitch(server, owner, map.id, true);
    const [mate] = await activeMates(map.id);
    const rowOf = (userId: string) =>
      db.query.computerMates.findFirst({ where: (t, { eq }) => eq(t.userId, userId) });
    const before = await rowOf(mate!.userId);
    expect(before!.nextActAt).not.toBeNull();

    const res = await call(server, 'POST', `/maps/${map.id}/members/${mate!.userId}/remove`, owner);
    expect(res.statusCode).toBe(403);
    expect(errorOf(res)).toMatchObject({
      code: 'FORBIDDEN',
      message: 'Computer friends come and go with the switch.',
    });
    expect((await activeMates(map.id)).map((m) => m.userId)).toContain(mate!.userId);
    expect((await rowOf(mate!.userId))!.nextActAt).toEqual(before!.nextActAt);
    expect((await eventsOf(map.id)).some((e) => e.type === 'member.removed')).toBe(false);

    const real = await call(
      server,
      'POST',
      `/maps/${map.id}/members/${members[0]!.id}/remove`,
      owner,
    );
    expect(real.statusCode).toBe(204);
  });

  it('approving a friend departs the smallest computer mate in the same transaction', async () => {
    const server = await start();
    const { owner, map } = await patchWith(server, 0);
    await setSwitch(server, owner, map.id, true);
    const seated = await activeMates(map.id);
    // Give the first two mates extra land, so the third has the least.
    const wild = await db.query.tiles.findMany({
      where: (t, { and, eq, isNull }) =>
        and(eq(t.mapId, map.id), isNull(t.ownerUserId), isNull(t.homeSlot)),
      limit: 4,
    });
    const territory = createTerritoryRepo(db);
    await territory.setOwner(wild[0]!.id, seated[0]!.userId);
    await territory.setOwner(wild[1]!.id, seated[0]!.userId);
    await territory.setOwner(wild[2]!.id, seated[1]!.userId);
    const smallest = seated[2]!.userId;

    const friend = await bringIn(server, owner, map);
    const now = await activeMates(map.id);
    expect(now.map((m) => m.userId)).toEqual([seated[0]!.userId, seated[1]!.userId]);
    const events = await eventsOf(map.id);
    const leftEvent = events.find(
      (e) =>
        e.type === 'member.left' &&
        parseGameEventPayload('member.left', e.payload).userId === smallest,
    )!;
    expect(parseGameEventPayload('member.left', leftEvent.payload)).toMatchObject({
      computer: true,
      madeRoomFor: friend.id,
    });
    const joined = events.find(
      (e) =>
        e.type === 'member.joined' &&
        parseGameEventPayload('member.joined', e.payload).userId === friend.id,
    )!;
    expect(joined.createdAt.getTime()).toBe(leftEvent.createdAt.getTime());
    expect(joined.seq).toBe(leftEvent.seq + 1);
    // Land is never handed over: the leaver's tiles went wild, not to the friend.
    const leaverOld = await tilesOf(map.id, [smallest]);
    expect(leaverOld.length).toBe(0);
  });

  it('switching on when already on tops the patch back up to fillTo, and no further', async () => {
    const server = await start();
    const { owner, map, members } = await patchWith(server, 1);
    expect((await setSwitch(server, owner, map.id, true)).statusCode).toBe(200);
    expect((await activeMates(map.id)).length).toBe(COMPUTER_MATES.rules.fillTo - 2);
    // A friend leaves: one kid and two mates.
    expect((await call(server, 'POST', `/maps/${map.id}/leave`, members[0]!)).statusCode).toBe(204);
    expect((await activeMates(map.id)).length).toBe(COMPUTER_MATES.rules.fillTo - 2);
    // The owner switches on again: back to fillTo.
    expect((await setSwitch(server, owner, map.id, true)).statusCode).toBe(200);
    const topped = await activeMates(map.id);
    expect(topped.length).toBe(COMPUTER_MATES.rules.fillTo - 1);
    // Again: nothing more.
    expect((await setSwitch(server, owner, map.id, true)).statusCode).toBe(200);
    expect(await activeMates(map.id)).toEqual(topped);
  });

  it('join is never refused because of computer mates', async () => {
    const server = await start();
    const { owner, map } = await patchWith(server, 0);
    // An old 4-seat patch: 1 kid and 3 mates fill every seat.
    await db.update(maps).set({ maxPlayers: 4 }).where(mapIs(map.id));
    await setSwitch(server, owner, map.id, true);
    expect((await activeMates(map.id)).length).toBe(3);
    await bringIn(server, owner, map);
    await bringIn(server, owner, map);
    await bringIn(server, owner, map);
    expect((await activeMates(map.id)).length).toBe(0);
    // Now four real Keepers: full for real.
    const fifth = await player();
    const fresh = await getMap(server, map.id, owner);
    const res = await call(server, 'POST', '/maps/join', fifth, {
      code: fresh.admin!.invite!.code,
    });
    expect(res.statusCode).toBe(409);
  });

  it('computer users cannot log in, recover or have their password reset', async () => {
    const server = await start();
    const { owner, map } = await patchWith(server, 0);
    await setSwitch(server, owner, map.id, true);
    const [mate] = await activeMates(map.id);
    const row = await db.query.users.findFirst({ where: (t, { eq }) => eq(t.id, mate!.userId) });
    expect(row!.kind).toBe('computer');
    expect(row!.passwordHash).toBeNull();

    const login = await call(server, 'POST', '/auth/login', null, {
      username: row!.username,
      password: 'squishy-secret',
    });
    const unknown = await call(server, 'POST', '/auth/login', null, {
      username: 'nobody_by_this_name',
      password: 'squishy-secret',
    });
    expect(login.statusCode).toBe(401);
    expect(errorOf(login)).toEqual(errorOf(unknown));

    const recover = await call(server, 'POST', '/auth/recover', null, {
      username: row!.username,
      recoveryCode: 'AAAA-BBBB-CCCC-DDDD',
      newPassword: 'squishy-secret',
    });
    expect([400, 401]).toContain(recover.statusCode);

    const reset = await call(
      server,
      'POST',
      `/maps/${map.id}/members/${mate!.userId}/reset-password`,
      owner,
    );
    expect(reset.statusCode).toBe(403);
    expect(errorOf(reset).message).toMatch(/Computer friends/);
  });

  it('a real kid can sign up with a free name; computer names are reserved', async () => {
    const server = await start();
    const res = await call(server, 'POST', '/auth/signup', null, {
      signupCode: SIGNUP_CODE,
      username: 'bramble',
      password: 'squishy-secret',
      birthYear: 2014,
      timeZone: 'America/Chicago',
      grownUpOk: true,
    });
    expect(res.statusCode).toBe(409);
  });

  it('push, admin lists and milestones treat computer mates right', async () => {
    const server = await start();
    const { owner, map } = await patchWith(server, 0);
    // Milestones count on a solo patch with the switch on (owner decision 3).
    const before = await call(server, 'GET', `/milestones?mapId=${map.id}`, owner);
    expect(before.json()).toMatchObject({ countsHere: false });
    await setSwitch(server, owner, map.id, true);
    const after = await call(server, 'GET', `/milestones?mapId=${map.id}`, owner);
    expect(after.json()).toMatchObject({ countsHere: true });

    const mates = await activeMates(map.id);
    const mateIds = new Set(mates.map((m) => m.userId));
    // friendArrived never fires for a computer mate.
    const friend = await createPushRepo(db).friendRecipients(map.id, mates[0]!.userId, clock);
    expect(friend.arriver).toBeNull();
    const nudged = await createPushRepo(db).mapRecipients(map.id, 'dusk', clock);
    expect(nudged.some((r) => mateIds.has(r.id))).toBe(false);

    // The admin console lists real Keepers only.
    const admin = createAdminRepo(db);
    const listed = await admin.listPlayers('bramble', clock, 200, 0);
    expect(listed.rows.some((r) => mateIds.has(r.id))).toBe(false);
    expect(await admin.findPlayer(mates[0]!.userId, clock)).toBeNull();
    const members = await admin.patchMembers(map.id);
    expect(members.map((m) => m.userId)).toEqual([owner.id]);

    expect(await createComputerMatesRepo(db).countActivePlayers(map.id)).toBe(1);
  });
});
