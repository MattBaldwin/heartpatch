import {
  ApiErrorSchema,
  GAME_DATA,
  generateMap,
  GUARDIAN_DIFFICULTIES,
  InviteResponseSchema,
  JoinMapResponseSchema,
  MAP_MAX_PLAYERS,
  MapResponseSchema,
  MapViewSchema,
  MeResponseSchema,
  MemberPasswordResetResponseSchema,
  MyMapsResponseSchema,
  normalizeInviteCode,
  parseGameEventPayload,
  PvpModeResponseSchema,
  SessionResponseSchema,
  type GameEventType,
  type MapDetail,
} from '@heartpatch/shared';
import { GUARDIAN_RULES, hintForGuardians } from '@heartpatch/shared/server';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { afterAll, afterEach, beforeAll, describe, expect, inject, it, vi } from 'vitest';
import { buildApp } from '../../app.js';
import { loadConfig } from '../../config.js';
import { createDbClient, type Database, type DbClient } from '../../db/client.js';
import {
  buildings,
  joinRequests,
  keepers,
  mapMembers,
  maps,
  sessions,
  users,
} from '../../db/schema.js';
import { SESSION_COOKIE } from '../auth/limits.js';
import { newSessionToken } from '../auth/secrets.js';
import { INVITE_CODE_TTL_MS, MAP_RATE_LIMITS } from './limits.js';
import { homeRingWaiting } from '../buildings/home-ring.js';
import { litSafeTiles } from '../buildings/hearthfire.js';
import { createBuildingsRepo } from '../buildings/repo.js';
import { mapLocalTime } from '../../lib/time.js';
import { defaultGuardianData, tileGuardians } from '../territory/service.js';
import { createMapsRepo } from './repo.js';
import { createMapsService } from './service.js';

const url = inject('testDatabaseUrl');
const HEADERS = { 'x-requested-with': 'heartpatch' };
const DAY_MS = 24 * 60 * 60 * 1000;
const TEST_KEEPER = { base: 'pip', hairColor: 'honey', eyeColor: 'sky', outfit: 'sunflower' };

interface Player {
  id: string;
  username: string;
  token: string;
}

describe.skipIf(!url)('map endpoints (needs DATABASE_URL)', () => {
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

  async function start(env: Record<string, string> = {}): Promise<FastifyInstance> {
    const config = loadConfig({ NODE_ENV: 'test', DATABASE_URL: url!, ...env });
    app = await buildApp({ config, db, clock: () => clock, logger: false });
    return app;
  }

  /**
   * A logged-in player, written straight to the database: Argon2 signups
   * would make these tests slow, and auth has its own tests.
   */
  async function player(options: { tutorialDone?: boolean } = {}): Promise<Player> {
    const username = `mapkid_${String((counter += 1))}`;
    const [user] = await db
      .insert(users)
      .values({
        username,
        passwordHash: 'not-a-hash',
        birthYear: 2014,
        tutorialCompletedAt: options.tutorialDone ? new Date() : null,
      })
      .returning({ id: users.id });
    const { token, tokenHash } = newSessionToken();
    await db
      .insert(sessions)
      .values({ userId: user!.id, tokenHash, expiresAt: new Date(Date.now() + 30 * DAY_MS) });
    // Every player has picked a Keeper (the map gate, #42; keepers.test.ts covers it).
    await db.insert(keepers).values({ userId: user!.id, ...TEST_KEEPER });
    return { id: user!.id, username, token };
  }

  function call(
    server: FastifyInstance,
    method: 'GET' | 'POST',
    path: string,
    who: Player | null,
    payload?: object,
    extra: Record<string, unknown> = {},
  ) {
    return server.inject({
      method,
      url: `/api/v1${path}`,
      headers: HEADERS,
      ...(who ? { cookies: { [SESSION_COOKIE]: who.token } } : {}),
      ...(payload ? { payload } : {}),
      ...extra,
    });
  }

  function errorOf(res: LightMyRequestResponse) {
    return ApiErrorSchema.parse(res.json()).error;
  }

  async function createMap(server: FastifyInstance, owner: Player, name = 'Pumpkin Hollow') {
    const res = await call(server, 'POST', '/maps', owner, {
      name,
      timeZone: 'America/Chicago',
    });
    expect(res.statusCode).toBe(201);
    return MapResponseSchema.parse(res.json()).map;
  }

  async function getMap(server: FastifyInstance, mapId: string, who: Player) {
    const res = await call(server, 'GET', `/maps/${mapId}`, who);
    expect(res.statusCode).toBe(200);
    return MapResponseSchema.parse(res.json()).map;
  }

  const inviteOf = (map: MapDetail) => map.admin!.invite!.code;

  async function requestJoin(server: FastifyInstance, who: Player, code: string) {
    const res = await call(server, 'POST', '/maps/join', who, { code });
    expect(res.statusCode).toBe(201);
    return JoinMapResponseSchema.parse(res.json()).request;
  }

  async function approve(server: FastifyInstance, owner: Player, mapId: string, requestId: string) {
    return call(server, 'POST', `/maps/${mapId}/requests/${requestId}/approve`, owner);
  }

  /** Creates a map and brings `extra` players in through code → request → approve. */
  async function mapWith(server: FastifyInstance, extra: number) {
    const owner = await player();
    const map = await createMap(server, owner);
    const members: Player[] = [];
    for (let i = 0; i < extra; i++) {
      const p = await player();
      const request = await requestJoin(server, p, inviteOf(map));
      expect((await approve(server, owner, map.id, request.id)).statusCode).toBe(204);
      members.push(p);
    }
    return { owner, map, members };
  }

  const eventsOf = async (mapId: string) =>
    db.query.gameEvents.findMany({
      where: (t, { eq }) => eq(t.mapId, mapId),
      orderBy: (t, { asc }) => [asc(t.seq)],
    });

  const payloadOf = <T extends GameEventType>(type: T, payload: unknown) =>
    parseGameEventPayload(type, payload);

  const tilesOf = (mapId: string) =>
    db.query.tiles.findMany({ where: (t, { eq }) => eq(t.mapId, mapId) });

  const mapRow = (mapId: string) =>
    db.query.maps.findFirst({ where: (t, { eq }) => eq(t.id, mapId) });

  describe('create', () => {
    it('makes the owner, stores the generated map and never shows the seed', async () => {
      const server = await start();
      const owner = await player();
      const res = await call(server, 'POST', '/maps', owner, {
        name: '  Pumpkin   Hollow ',
        timeZone: 'America/Chicago',
      });
      expect(res.statusCode).toBe(201);
      const map = MapResponseSchema.parse(res.json()).map;
      expect(map).toMatchObject({
        name: 'Pumpkin Hollow',
        timeZone: 'America/Chicago',
        pvpMode: 'gentle',
        role: 'owner',
        maxPlayers: MAP_MAX_PLAYERS,
        members: [{ user: { id: owner.id, username: owner.username }, role: 'owner', homeSlot: 0 }],
      });
      expect(map.admin!.invite!.code).toMatch(/^[2-9A-HJKMNP-TV-Z]{4}-[2-9A-HJKMNP-TV-Z]{4}$/);
      expect(Date.parse(map.admin!.invite!.expiresAt)).toBe(clock.getTime() + INVITE_CODE_TTL_MS);
      expect(map.admin!.requests).toEqual([]);

      // Stored exactly as generated, with the owner holding home slot 0.
      const row = await mapRow(map.id);
      expect(row?.seed).toMatch(/^[\w-]{20,}$/);
      expect(row?.maxPlayers).toBe(MAP_MAX_PLAYERS);
      const generated = generateMap(GAME_DATA, {
        seed: row!.seed!,
        playerCount: MAP_MAX_PLAYERS,
      });
      const stored = await tilesOf(map.id);
      expect(stored).toHaveLength(generated.tiles.length);
      const byKey = new Map(stored.map((t) => [`${t.q},${t.r}`, t]));
      for (const t of generated.tiles) {
        expect(byKey.get(`${t.q},${t.r}`)).toMatchObject({
          terrain: t.terrain,
          nodeResource: t.nodeResource,
          guardianStrength: t.guardianStrength,
          homeSlot: t.homeSlot,
          ownerUserId: t.homeSlot === 0 ? owner.id : null,
        });
      }

      const events = await eventsOf(map.id);
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({ seq: 1, type: 'map.created', actorUserId: owner.id });
      expect(payloadOf('map.created', events[0]!.payload)).toEqual({
        name: 'Pumpkin Hollow',
        timeZone: 'America/Chicago',
        pvpMode: 'gentle',
        maxPlayers: MAP_MAX_PLAYERS,
        homeSlot: 0,
        heartSeed: generated.homes[0],
      });

      // The seed appears in no response.
      const responses = [
        res,
        await call(server, 'GET', `/maps/${map.id}`, owner),
        await call(server, 'GET', `/maps/${map.id}/view`, owner),
        await call(server, 'GET', '/maps', owner),
      ];
      for (const r of responses) {
        expect(r.statusCode).toBeLessThan(300);
        expect(r.body).not.toContain(row!.seed!);
        // Guardians show only as neutral land's `guardianHint` (owner decision 10).
        expect(r.body).not.toMatch(/seed"|guardian(?!Hint")/i);
      }
    });

    it('lists the map in the lobby', async () => {
      const server = await start();
      const owner = await player();
      const map = await createMap(server, owner, 'Moth Meadow');
      const res = await call(server, 'GET', '/maps', owner);
      expect(res.statusCode).toBe(200);
      expect(MyMapsResponseSchema.parse(res.json())).toEqual({
        maps: [
          {
            id: map.id,
            name: 'Moth Meadow',
            role: 'owner',
            owner: { id: owner.id, username: owner.username },
            memberCount: 1,
            maxPlayers: MAP_MAX_PLAYERS,
            pvpMode: 'gentle',
            pendingRequests: 0,
          },
        ],
        requests: [],
      });
    });

    it('checks the name, the time zone, login and the CSRF header', async () => {
      const server = await start();
      const owner = await player();
      const body = (overrides: object) => ({ name: 'Nice Patch', timeZone: 'UTC', ...overrides });

      for (const name of ['a', 'x'.repeat(25), 'Patch <3']) {
        const res = await call(server, 'POST', '/maps', owner, body({ name }));
        expect(res.statusCode).toBe(400);
      }
      const rude = await call(server, 'POST', '/maps', owner, body({ name: 'shit patch' }));
      expect(rude.statusCode).toBe(400);
      expect(errorOf(rude).message).toMatch(/kinder name/);
      const link = await call(server, 'POST', '/maps', owner, body({ name: 'visit evil.com' }));
      expect(link.statusCode).toBe(400);
      const zone = await call(server, 'POST', '/maps', owner, body({ timeZone: 'Mars/Olympus' }));
      expect(zone.statusCode).toBe(400);

      const loggedOut = await call(server, 'POST', '/maps', null, body({}));
      expect(loggedOut.statusCode).toBe(401);
      const noCsrf = await server.inject({
        method: 'POST',
        url: '/api/v1/maps',
        cookies: { [SESSION_COOKIE]: owner.token },
        payload: body({}),
      });
      expect(noCsrf.statusCode).toBe(403);
      expect(errorOf(noCsrf).code).toBe('FORBIDDEN');
      expect((await call(server, 'GET', '/maps', null)).statusCode).toBe(401);

      const lobby = MyMapsResponseSchema.parse((await call(server, 'GET', '/maps', owner)).json());
      expect(lobby.maps).toEqual([]);
    });

    it('rate limits making maps per player', async () => {
      const server = await start();
      const owner = await player();
      for (let i = 0; i < MAP_RATE_LIMITS.create.perUser.max; i++) await createMap(server, owner);
      const limited = await call(server, 'POST', '/maps', owner, {
        name: 'One More',
        timeZone: 'UTC',
      });
      expect(limited.statusCode).toBe(429);
      expect(errorOf(limited).code).toBe('RATE_LIMITED');
    });

    it('takes a raised per-IP patch-making limit from dev config (e2e)', async () => {
      const server = await start({ HP_DEV_MAP_CREATE_LIMIT_PER_IP: '50' });
      const { perIp, perUser } = MAP_RATE_LIMITS.create;
      // One IP (inject's), several players: past the usual per-IP max.
      for (let made = 0; made <= perIp.max;) {
        const owner = await player();
        for (let i = 0; i < perUser.max && made <= perIp.max; i++, made++) {
          await createMap(server, owner);
        }
      }
    });
  });

  describe('tutorial gate', () => {
    it('lets anyone create and join while HP_TUTORIAL_REQUIRED is off', async () => {
      const server = await start({ HP_TUTORIAL_REQUIRED: 'false' });
      const { map } = await mapWith(server, 1);
      expect(map.role).toBe('owner');
    });

    it('needs a finished tutorial to create or join when on', async () => {
      const server = await start({ HP_TUTORIAL_REQUIRED: 'true' });
      const newbie = await player();
      const create = await call(server, 'POST', '/maps', newbie, {
        name: 'Too Soon',
        timeZone: 'UTC',
      });
      expect(create.statusCode).toBe(403);
      expect(errorOf(create).message).toMatch(/Sprout/);

      const graduate = await player({ tutorialDone: true });
      const map = await createMap(server, graduate);
      const join = await call(server, 'POST', '/maps/join', newbie, { code: inviteOf(map) });
      expect(join.statusCode).toBe(403);
      const ready = await player({ tutorialDone: true });
      await requestJoin(server, ready, inviteOf(map));
    });
  });

  describe('invites and join requests', () => {
    it('code → request → approve: both players see the map (acceptance)', async () => {
      const server = await start();
      const owner = await player();
      const friend = await player();
      const map = await createMap(server, owner);

      // Codes work in any case, with or without the dash.
      const request = await requestJoin(
        server,
        friend,
        inviteOf(map).replace('-', ' ').toLowerCase(),
      );
      expect(request).toMatchObject({
        mapName: map.name,
        owner: { id: owner.id, username: owner.username },
      });
      const waiting = MyMapsResponseSchema.parse(
        (await call(server, 'GET', '/maps', friend)).json(),
      );
      expect(waiting).toEqual({ maps: [], requests: [request] });
      // The owner's patch list says someone is waiting (#144).
      const ownerLobby = MyMapsResponseSchema.parse(
        (await call(server, 'GET', '/maps', owner)).json(),
      );
      expect(ownerLobby.maps.map((m) => [m.id, m.pendingRequests])).toEqual([[map.id, 1]]);
      // Not a member yet.
      expect((await call(server, 'GET', `/maps/${map.id}`, friend)).statusCode).toBe(404);

      const asOwner = await getMap(server, map.id, owner);
      expect(asOwner.admin!.requests).toEqual([
        {
          id: request.id,
          user: { id: friend.id, username: friend.username },
          createdAt: request.createdAt,
        },
      ]);

      expect((await approve(server, owner, map.id, request.id)).statusCode).toBe(204);

      const asFriend = await getMap(server, map.id, friend);
      expect(asFriend.role).toBe('member');
      expect(asFriend.admin).toBeNull();
      expect(asFriend.members.map((m) => [m.user.id, m.role, m.homeSlot])).toEqual([
        [owner.id, 'owner', 0],
        [friend.id, 'member', 1],
      ]);
      const lobby = MyMapsResponseSchema.parse((await call(server, 'GET', '/maps', friend)).json());
      expect(lobby.requests).toEqual([]);
      // A member never sees the count, and once answered there's nothing to count.
      expect(lobby.maps.map((m) => [m.id, m.role, m.memberCount, m.pendingRequests])).toEqual([
        [map.id, 'member', 2, 0],
      ]);
      expect((await getMap(server, map.id, owner)).admin!.requests).toEqual([]);
      expect(
        MyMapsResponseSchema.parse((await call(server, 'GET', '/maps', owner)).json()).maps.map(
          (m) => m.pendingRequests,
        ),
      ).toEqual([0]);

      // The friend holds home slot 1, and the event says where.
      const row = await mapRow(map.id);
      const generated = generateMap(GAME_DATA, { seed: row!.seed!, playerCount: MAP_MAX_PLAYERS });
      const owned = (await tilesOf(map.id)).filter((t) => t.ownerUserId === friend.id);
      expect(owned).toHaveLength(7);
      expect(owned.every((t) => t.homeSlot === 1)).toBe(true);
      const events = await eventsOf(map.id);
      expect(events.map((e) => [e.seq, e.type])).toEqual([
        [1, 'map.created'],
        [2, 'member.joined'],
      ]);
      expect(payloadOf('member.joined', events[1]!.payload)).toEqual({
        userId: friend.id,
        username: friend.username,
        homeSlot: 1,
        heartSeed: generated.homes[1],
      });

      // The view a member draws from: public tiles only.
      const viewRes = await call(server, 'GET', `/maps/${map.id}/view`, friend);
      expect(viewRes.statusCode).toBe(200);
      const view = MapViewSchema.parse(viewRes.json());
      expect(view.map).toEqual({
        id: map.id,
        name: map.name,
        timeZone: 'America/Chicago',
        pvpMode: 'gentle',
        maxPlayers: MAP_MAX_PLAYERS,
      });
      expect(view.members).toHaveLength(2);
      expect(view.tiles).toHaveLength(generated.tiles.length);
      expect(Object.keys(view.tiles[0]!).sort()).toEqual(
        [
          'cooldownUntil',
          'defenders',
          'guardianHint',
          'buildings',
          'gathering',
          'homeSlot',
          'nodeResource',
          'ownerUserId',
          'q',
          'r',
          'terrain',
          'workers',
        ].sort(),
      );
      expect(view.tiles.filter((t) => t.ownerUserId === friend.id)).toHaveLength(7);
      // Up to date with the friend joining, so live sync follows on from there.
      expect(view.seq).toBe(2);
      expect((await call(server, 'GET', `/maps/${map.id}/view`, await player())).statusCode).toBe(
        404,
      );
    });

    it('returns the pending request again on a second tap', async () => {
      const server = await start();
      const owner = await player();
      const friend = await player();
      const map = await createMap(server, owner);
      const first = await requestJoin(server, friend, inviteOf(map));
      const again = await call(server, 'POST', '/maps/join', friend, { code: inviteOf(map) });
      expect(again.statusCode).toBe(200);
      expect(JoinMapResponseSchema.parse(again.json()).request).toEqual(first);

      // Two at once still make one request.
      const other = await player();
      const both = await Promise.all([
        call(server, 'POST', '/maps/join', other, { code: inviteOf(map) }),
        call(server, 'POST', '/maps/join', other, { code: inviteOf(map) }),
      ]);
      expect(both.map((r) => r.statusCode).sort()).toEqual([200, 201]);
      expect((await getMap(server, map.id, owner)).admin!.requests).toHaveLength(2);
    });

    it('rejects members joining again, junk codes and unknown codes', async () => {
      const server = await start();
      const { owner, map, members } = await mapWith(server, 1);
      const own = await call(server, 'POST', '/maps/join', owner, { code: inviteOf(map) });
      expect(own.statusCode).toBe(409);
      expect(errorOf(own).message).toMatch(/already in this patch/);
      const member = await call(server, 'POST', '/maps/join', members[0]!, {
        code: inviteOf(await getMap(server, map.id, owner)),
      });
      expect(member.statusCode).toBe(409);

      const someone = await player();
      expect((await call(server, 'POST', '/maps/join', someone, { code: 'ABC' })).statusCode).toBe(
        400,
      );
      expect(
        (await call(server, 'POST', '/maps/join', someone, { code: 'OOOO-1111' })).statusCode,
      ).toBe(400);
      const unknown = await call(server, 'POST', '/maps/join', someone, { code: 'ZZZZ-ZZZZ' });
      expect(unknown.statusCode).toBe(404);
      expect(errorOf(unknown).message).toMatch(/Ask for a new one/);
    });

    it('rejects expired codes', async () => {
      const server = await start();
      const owner = await player();
      const map = await createMap(server, owner);
      const created = clock.getTime();

      clock = new Date(created + INVITE_CODE_TTL_MS - 1);
      await requestJoin(server, await player(), inviteOf(map));

      clock = new Date(created + INVITE_CODE_TTL_MS);
      const late = await call(server, 'POST', '/maps/join', await player(), {
        code: inviteOf(map),
      });
      expect(late.statusCode).toBe(404);
      expect((await getMap(server, map.id, owner)).admin!.invite).toBeNull();

      // A new code works again, for another 7 days.
      const fresh = await call(server, 'POST', `/maps/${map.id}/invite`, owner);
      expect(fresh.statusCode).toBe(200);
      const { invite } = InviteResponseSchema.parse(fresh.json());
      expect(Date.parse(invite.expiresAt)).toBe(clock.getTime() + INVITE_CODE_TTL_MS);
      await requestJoin(server, await player(), invite.code);
    });

    it('stops old codes working on regenerate and revoke', async () => {
      const server = await start();
      const owner = await player();
      const map = await createMap(server, owner);
      const oldCode = inviteOf(map);

      const regen = await call(server, 'POST', `/maps/${map.id}/invite`, owner);
      const newCode = InviteResponseSchema.parse(regen.json()).invite.code;
      expect(newCode).not.toBe(oldCode);
      expect(inviteOf(await getMap(server, map.id, owner))).toBe(newCode);
      const stale = await call(server, 'POST', '/maps/join', await player(), { code: oldCode });
      expect(stale.statusCode).toBe(404);
      await requestJoin(server, await player(), newCode);

      const revoke = await call(server, 'POST', `/maps/${map.id}/invite/revoke`, owner);
      expect(revoke.statusCode).toBe(204);
      expect((await getMap(server, map.id, owner)).admin!.invite).toBeNull();
      const revoked = await call(server, 'POST', '/maps/join', await player(), { code: newCode });
      expect(revoked.statusCode).toBe(404);
      // Requests made before the revoke still wait for an answer.
      expect((await getMap(server, map.id, owner)).admin!.requests).toHaveLength(1);
    });

    it('lets only the owner manage codes and requests', async () => {
      const server = await start();
      const { owner, map, members } = await mapWith(server, 1);
      const member = members[0]!;
      const stranger = await player();
      const pending = await requestJoin(server, stranger, inviteOf(map));

      for (const path of [
        `/maps/${map.id}/invite`,
        `/maps/${map.id}/invite/revoke`,
        `/maps/${map.id}/requests/${pending.id}/approve`,
        `/maps/${map.id}/requests/${pending.id}/deny`,
      ]) {
        const asMember = await call(server, 'POST', path, member);
        expect(asMember.statusCode).toBe(403);
        expect(errorOf(asMember).message).toMatch(/Only the patch owner/);
        expect((await call(server, 'POST', path, stranger)).statusCode).toBe(404);
        expect((await call(server, 'POST', path, null)).statusCode).toBe(401);
      }
      expect((await getMap(server, map.id, owner)).admin!.requests).toHaveLength(1);
    });

    it('denies a request, and refuses to answer it twice', async () => {
      const server = await start();
      const owner = await player();
      const friend = await player();
      const map = await createMap(server, owner);
      const request = await requestJoin(server, friend, inviteOf(map));
      const path = `/maps/${map.id}/requests/${request.id}`;

      expect((await call(server, 'POST', `${path}/deny`, owner)).statusCode).toBe(204);
      expect((await call(server, 'POST', `${path}/deny`, owner)).statusCode).toBe(409);
      expect((await call(server, 'POST', `${path}/approve`, owner)).statusCode).toBe(409);
      expect((await getMap(server, map.id, owner)).admin!.requests).toEqual([]);
      expect(
        MyMapsResponseSchema.parse((await call(server, 'GET', '/maps', friend)).json()),
      ).toEqual({
        maps: [],
        requests: [],
      });
      // They can ask again.
      await requestJoin(server, friend, inviteOf(map));

      const unknown = `/maps/${map.id}/requests/0190a000-0000-7000-8000-000000000000/approve`;
      expect((await call(server, 'POST', unknown, owner)).statusCode).toBe(404);
      expect(
        (await call(server, 'POST', `/maps/${map.id}/requests/nope/approve`, owner)).statusCode,
      ).toBe(400);
    });
  });

  describe('seats', () => {
    it('never lets a 5th player in (acceptance)', async () => {
      const server = await start();
      const { owner, map } = await mapWith(server, MAP_MAX_PLAYERS - 1);
      const fifth = await player();
      const full = await call(server, 'POST', '/maps/join', fifth, { code: inviteOf(map) });
      expect(full.statusCode).toBe(409);
      expect(errorOf(full).message).toMatch(/full/);

      // A request made before the map filled is refused on approval.
      const { owner: owner2, map: map2 } = await mapWith(server, MAP_MAX_PLAYERS - 2);
      const early = await requestJoin(server, await player(), inviteOf(map2));
      const last = await requestJoin(server, await player(), inviteOf(map2));
      expect((await approve(server, owner2, map2.id, last.id)).statusCode).toBe(204);
      const late = await approve(server, owner2, map2.id, early.id);
      expect(late.statusCode).toBe(409);
      expect(errorOf(late).message).toMatch(/full/);
      expect((await getMap(server, map2.id, owner2)).members).toHaveLength(MAP_MAX_PLAYERS);
      expect((await getMap(server, map.id, owner)).members).toHaveLength(MAP_MAX_PLAYERS);
    });

    it('lets only one of two racing approvals take the last seat', async () => {
      const server = await start();
      for (let round = 0; round < 5; round++) {
        const { owner, map } = await mapWith(server, MAP_MAX_PLAYERS - 2);
        const a = await requestJoin(server, await player(), inviteOf(map));
        const b = await requestJoin(server, await player(), inviteOf(map));
        const results = await Promise.all([
          approve(server, owner, map.id, a.id),
          approve(server, owner, map.id, b.id),
        ]);
        expect(results.map((r) => r.statusCode).sort()).toEqual([204, 409]);

        const members = await db.query.mapMembers.findMany({
          where: (t, { and, eq }) => and(eq(t.mapId, map.id), eq(t.status, 'active')),
        });
        expect(members).toHaveLength(MAP_MAX_PLAYERS);
        expect(new Set(members.map((m) => m.homeSlot)).size).toBe(MAP_MAX_PLAYERS);
        const joined = (await eventsOf(map.id)).filter((e) => e.type === 'member.joined');
        expect(joined).toHaveLength(MAP_MAX_PLAYERS - 1);
        expect((await eventsOf(map.id)).map((e) => e.seq)).toEqual(
          Array.from({ length: MAP_MAX_PLAYERS }, (_, i) => i + 1),
        );
      }
    });

    it('lets one approval through when the same request is approved twice at once', async () => {
      const server = await start();
      const owner = await player();
      const map = await createMap(server, owner);
      const request = await requestJoin(server, await player(), inviteOf(map));
      const results = await Promise.all([
        approve(server, owner, map.id, request.id),
        approve(server, owner, map.id, request.id),
      ]);
      expect(results.map((r) => r.statusCode).sort()).toEqual([204, 409]);
      expect((await getMap(server, map.id, owner)).members).toHaveLength(2);
    });
  });

  it('closes a stale request from someone already in, without a second home base', async () => {
    const server = await start();
    const { owner, map, members } = await mapWith(server, 1);
    const friend = members[0]!;
    // A second tap that slipped in while the first request was being approved.
    const invite = await db.query.inviteCodes.findFirst({
      where: (t, { eq }) => eq(t.mapId, map.id),
    });
    const [stale] = await db
      .insert(joinRequests)
      .values({ mapId: map.id, userId: friend.id, inviteCodeId: invite!.id })
      .returning({ id: joinRequests.id });
    const eventsBefore = (await eventsOf(map.id)).length;

    expect((await approve(server, owner, map.id, stale!.id)).statusCode).toBe(204);

    const owned = (await tilesOf(map.id)).filter((t) => t.ownerUserId === friend.id);
    expect(owned).toHaveLength(7);
    expect(owned.every((t) => t.homeSlot === 1)).toBe(true);
    const after = await getMap(server, map.id, owner);
    expect(after.members.find((m) => m.user.id === friend.id)?.homeSlot).toBe(1);
    expect(after.admin!.requests).toEqual([]);
    expect(await eventsOf(map.id)).toHaveLength(eventsBefore);
  });

  describe('leaving and removing', () => {
    it('removes a player, frees their land and gives the seat to someone new', async () => {
      const server = await start();
      const { owner, map, members } = await mapWith(server, MAP_MAX_PLAYERS - 1);
      const [first, second] = members as [Player, Player];

      const res = await call(server, 'POST', `/maps/${map.id}/members/${second.id}/remove`, owner);
      expect(res.statusCode).toBe(204);
      expect((await call(server, 'GET', `/maps/${map.id}`, second)).statusCode).toBe(404);
      const lobby = MyMapsResponseSchema.parse((await call(server, 'GET', '/maps', second)).json());
      expect(lobby.maps).toEqual([]);
      expect((await tilesOf(map.id)).filter((t) => t.ownerUserId === second.id)).toEqual([]);
      // Archived, not deleted (tech spec §4).
      const archived = await db.query.mapMembers.findFirst({
        where: (t, { and, eq }) => and(eq(t.mapId, map.id), eq(t.userId, second.id)),
      });
      expect(archived?.status).toBe('removed');

      const events = await eventsOf(map.id);
      expect(events.at(-1)).toMatchObject({ type: 'member.removed', actorUserId: owner.id });
      expect(payloadOf('member.removed', events.at(-1)!.payload)).toEqual({
        userId: second.id,
        releasedTiles: 7,
      });

      // Their seat and home slot (2) go to the next player.
      const next = await player();
      const request = await requestJoin(server, next, inviteOf(map));
      expect((await approve(server, owner, map.id, request.id)).statusCode).toBe(204);
      const after = await getMap(server, map.id, owner);
      expect(after.members.find((m) => m.user.id === next.id)?.homeSlot).toBe(2);
      expect(after.members.find((m) => m.user.id === first.id)?.homeSlot).toBe(1);

      // The removed player can ask to come back; they'd need a free seat.
      const back = await call(server, 'POST', '/maps/join', second, { code: inviteOf(after) });
      expect(back.statusCode).toBe(409);
    });

    it('lets a removed player rejoin when there is room', async () => {
      const server = await start();
      const { owner, map, members } = await mapWith(server, 1);
      const friend = members[0]!;
      await call(server, 'POST', `/maps/${map.id}/members/${friend.id}/remove`, owner);
      const request = await requestJoin(server, friend, inviteOf(map));
      expect((await approve(server, owner, map.id, request.id)).statusCode).toBe(204);
      const after = await getMap(server, map.id, friend);
      expect(after.members.find((m) => m.user.id === friend.id)).toMatchObject({
        role: 'member',
        homeSlot: 1,
      });
    });

    it('lets a member leave, but not the owner', async () => {
      const server = await start();
      const { owner, map, members } = await mapWith(server, 1);
      const friend = members[0]!;
      const ownerLeave = await call(server, 'POST', `/maps/${map.id}/leave`, owner);
      expect(ownerLeave.statusCode).toBe(403);

      expect((await call(server, 'POST', `/maps/${map.id}/leave`, friend)).statusCode).toBe(204);
      expect((await call(server, 'POST', `/maps/${map.id}/leave`, friend)).statusCode).toBe(404);
      const events = await eventsOf(map.id);
      expect(events.at(-1)).toMatchObject({ type: 'member.left', actorUserId: friend.id });
      expect(payloadOf('member.left', events.at(-1)!.payload)).toEqual({
        userId: friend.id,
        releasedTiles: 7,
      });
    });

    it('guards removal', async () => {
      const server = await start();
      const { owner, map, members } = await mapWith(server, 2);
      const [a, b] = members as [Player, Player];
      const self = await call(server, 'POST', `/maps/${map.id}/members/${owner.id}/remove`, owner);
      expect(self.statusCode).toBe(403);
      const byMember = await call(server, 'POST', `/maps/${map.id}/members/${b.id}/remove`, a);
      expect(byMember.statusCode).toBe(403);
      const stranger = await player();
      const notIn = await call(
        server,
        'POST',
        `/maps/${map.id}/members/${stranger.id}/remove`,
        owner,
      );
      expect(notIn.statusCode).toBe(404);
      expect((await getMap(server, map.id, owner)).members).toHaveLength(3);
    });
  });

  describe('PvP mode', () => {
    it('defaults to gentle; the owner changes it and members see it', async () => {
      const server = await start();
      const { owner, map, members } = await mapWith(server, 1);
      const path = `/maps/${map.id}/pvp-mode`;

      const byMember = await call(server, 'POST', path, members[0]!, { pvpMode: 'on' });
      expect(byMember.statusCode).toBe(403);
      expect((await call(server, 'POST', path, owner, { pvpMode: 'wild' })).statusCode).toBe(400);

      const res = await call(server, 'POST', path, owner, { pvpMode: 'off' });
      expect(res.statusCode).toBe(200);
      expect(PvpModeResponseSchema.parse(res.json())).toEqual({ pvpMode: 'off' });
      expect((await getMap(server, map.id, members[0]!)).pvpMode).toBe('off');
      const events = await eventsOf(map.id);
      expect(events.at(-1)).toMatchObject({ type: 'map.updated', actorUserId: owner.id });
      expect(payloadOf('map.updated', events.at(-1)!.payload)).toEqual({ pvpMode: 'off' });

      // Setting the same mode again changes nothing and writes no event.
      const count = events.length;
      expect((await call(server, 'POST', path, owner, { pvpMode: 'off' })).statusCode).toBe(200);
      expect(await eventsOf(map.id)).toHaveLength(count);

      expect((await call(server, 'POST', path, owner, { pvpMode: 'on' })).statusCode).toBe(200);
      expect((await mapRow(map.id))?.pvpMode).toBe('on');
    });
  });

  describe('map view', () => {
    it("carries the seq of the map's latest event", async () => {
      const server = await start();
      const { owner, map } = await mapWith(server, 1);
      const view = async () =>
        MapViewSchema.parse((await call(server, 'GET', `/maps/${map.id}/view`, owner)).json());
      const latest = async () => (await eventsOf(map.id)).at(-1)!.seq;

      expect((await view()).seq).toBe(await latest());
      const set = await call(server, 'POST', `/maps/${map.id}/pvp-mode`, owner, { pvpMode: 'off' });
      expect(set.statusCode).toBe(200);
      const after = await view();
      expect(after.map.pvpMode).toBe('off');
      expect(after.seq).toBe(await latest());
      expect(after.seq).toBe(3);
    });

    /** A map made before the seasonal nodes joined the home ring, and slot 0's bare ring tiles. */
    async function olderMap() {
      const server = await start();
      const { owner, map } = await mapWith(server, 0);
      await db.execute(
        `update tiles set node_resource = null where map_id = '${map.id}'
           and home_slot is not null and node_resource in ('pumpkins', 'magic-fallen-leaves')`,
      );
      const homeTiles = (await tilesOf(map.id)).filter((t) => t.homeSlot === 0);
      const seedTile = homeTiles.find(
        (t) =>
          t.q * 7 === homeTiles.reduce((n, h) => n + h.q, 0) &&
          t.r * 7 === homeTiles.reduce((n, h) => n + h.r, 0),
      )!;
      const bare = homeTiles.filter((t) => t.nodeResource === null && t.id !== seedTile.id);
      expect(bare).toHaveLength(2);
      const build = (tileId: string, spot: number, buildingId = 'cozy-meadow') =>
        db
          .insert(buildings)
          .values({
            mapId: map.id,
            ownerUserId: owner.id,
            tileId,
            buildingId,
            kind: buildingId === 'hearthfire' ? 'hearthfire' : 'habitat',
            spot,
            ...(buildingId === 'hearthfire' ? { fuelledThrough: '2099-01-01' } : {}),
          })
          .returning({ id: buildings.id });
      const view = async () =>
        MapViewSchema.parse((await call(server, 'GET', `/maps/${map.id}/view`, owner)).json());
      const nodeAt = (v: Awaited<ReturnType<typeof view>>, t: { q: number; r: number }) =>
        v.tiles.find((x) => x.q === t.q && x.r === t.r)?.nodeResource ?? null;
      return { server, owner, map, seedTile, bare, build, view, nodeAt };
    }

    it('gives an older map its seasonal home nodes when it is next read (owner decision 2026-10-06)', async () => {
      const { map, seedTile, bare, view, nodeAt } = await olderMap();
      const first = await view();
      for (const slot of [0, 1, 2, 3]) {
        expect(first.tiles.filter((t) => t.homeSlot === slot).map((t) => t.nodeResource)).toEqual(
          expect.arrayContaining(['pumpkins', 'magic-fallen-leaves']),
        );
      }
      expect(bare.map((t) => nodeAt(first, t)).sort()).toEqual(['magic-fallen-leaves', 'pumpkins']);
      expect(nodeAt(first, seedTile)).toBeNull();
      // Stored, so reading again changes nothing, and no event was needed.
      const again = await view();
      expect(again.tiles).toEqual(first.tiles);
      expect(again.seq).toBe(first.seq);
      expect((await eventsOf(map.id)).map((e) => e.type)).not.toContain('building.moved');
    });

    it('moves a building in the way to a side spot on its own tile, once, with an event', async () => {
      const { map, bare, build, view, nodeAt } = await olderMap();
      // A fire in the middle of both bare ring tiles, a meadow beside one.
      const [fire] = await build(bare[0]!.id, 0, 'hearthfire');
      const [meadow] = await build(bare[1]!.id, 0);
      await build(bare[1]!.id, 1);
      const rows = () => createBuildingsRepo(db).listOnMap(map.id);
      const before = await rows();
      const safe = (list: typeof before) =>
        [
          ...litSafeTiles(
            list,
            bare.map((t) => ({ q: t.q, r: t.r })),
            mapLocalTime(new Date(), 'America/Chicago'),
          ),
        ].sort();

      // Two players open the patch at once: one top-up, not two.
      const [a, b] = await Promise.all([view(), view()]);
      const after = await rows();
      expect(after.find((r) => r.id === fire!.id)).toMatchObject({
        tileId: bare[0]!.id,
        spot: 1,
        level: 1,
        fuelledThrough: '2099-01-01',
      });
      // Spot 1 was taken on the meadow's tile, so it goes to spot 2.
      expect(after.find((r) => r.id === meadow!.id)).toMatchObject({
        tileId: bare[1]!.id,
        spot: 2,
      });
      expect(after).toHaveLength(before.length);
      // The fire still reaches as far: its light is measured from its tile.
      expect(safe(after)).toEqual(safe(before));
      for (const v of [a, b]) {
        expect(bare.map((t) => nodeAt(v, t)).sort()).toEqual(['magic-fallen-leaves', 'pumpkins']);
      }
      const moved = (await eventsOf(map.id)).filter((e) => e.type === 'building.moved');
      expect(moved).toHaveLength(2);
      expect(payloadOf('building.moved', moved[0]!.payload).from.spot).toBe(0);
      // Read again: nothing moves twice.
      await view();
      expect((await eventsOf(map.id)).filter((e) => e.type === 'building.moved')).toHaveLength(2);
    });

    it('lets a node wait when every bare ring tile is full of buildings', async () => {
      const { bare, build, view, nodeAt } = await olderMap();
      for (const t of bare) for (let spot = 0; spot <= 6; spot++) await build(t.id, spot);
      const v = await view();
      for (const t of bare) expect(nodeAt(v, t)).toBeNull();
      expect(homeRingWaiting().get(v.map.id)).toBe(2);
    });

    it('reads the map, members, tiles and seq from one snapshot', async () => {
      const server = await start();
      const { owner, map, members } = await mapWith(server, 1);
      const friend = members[0]!;
      const repo = createMapsRepo(db);

      const seen = await repo.snapshot(async (snap) => {
        const before = await snap.findMap(map.id);
        // Another connection removes the friend and commits in between.
        const removed = await call(
          server,
          'POST',
          `/maps/${map.id}/members/${friend.id}/remove`,
          owner,
        );
        expect(removed.statusCode).toBe(204);
        const tiles = await snap.listTiles(map.id);
        return {
          seq: before!.eventSeq,
          members: (await snap.listMembers(map.id)).length,
          friendTiles: tiles.filter((t) => t.ownerUserId === friend.id).length,
        };
      });

      // Everything as of the snapshot: the friend and their land still there.
      expect(seen).toEqual({ seq: 2, members: 2, friendTiles: 7 });
      expect((await mapRow(map.id))?.eventSeq).toBe(3);
    });
  });

  describe('guardian hint (owner decision 10)', () => {
    it("hints at neutral land's guardians today, the same for every member, never who", async () => {
      const server = await start();
      const { owner, map, members } = await mapWith(server, 1);
      const friend = members[0]!;
      const view = async (who: Player) => {
        const res = await call(server, 'GET', `/maps/${map.id}/view`, who);
        expect(res.statusCode).toBe(200);
        return { raw: res.body, view: MapViewSchema.parse(res.json()) };
      };
      const mine = await view(owner);
      const theirs = await view(friend);

      // Identical for two members: the hint is the land's, not the viewer's.
      expect(theirs.view.tiles).toEqual(mine.view.tiles);
      const neutral = mine.view.tiles.filter((t) => t.ownerUserId === null && t.homeSlot === null);
      expect(neutral.length).toBeGreaterThan(0);
      for (const tile of mine.view.tiles) {
        if (tile.ownerUserId === null && tile.homeSlot === null) {
          expect(tile.guardianHint?.count).toBeGreaterThan(0);
          expect(GUARDIAN_DIFFICULTIES).toContain(tile.guardianHint?.difficulty);
        } else {
          // Anyone's land and every home base (even a free one): no hint.
          expect(tile.guardianHint).toBeNull();
        }
      }
      expect(new Set(neutral.map((t) => t.guardianHint!.difficulty)).size).toBeGreaterThan(1);

      // It describes the very team a claim would meet today (#15's builder).
      const row = await mapRow(map.id);
      const strengths = (
        await db.query.tiles.findMany({ where: (t, { eq }) => eq(t.mapId, map.id) })
      ).map((t) => ({ q: t.q, r: t.r, s: t.guardianStrength }));
      const strengthAt = new Map(strengths.map((t) => [`${String(t.q)},${String(t.r)}`, t.s]));
      const teamAt = (t: (typeof neutral)[number], at: Date) =>
        tileGuardians(
          { id: map.id, timeZone: 'America/Chicago', seed: row!.seed },
          { ...t, guardianStrength: strengthAt.get(`${String(t.q)},${String(t.r)}`) ?? null },
          at,
        );
      const { species } = defaultGuardianData();
      const expected = (at: Date) =>
        neutral.map((t) => hintForGuardians(teamAt(t, at), GUARDIAN_RULES, species));
      expect(neutral.map((t) => t.guardianHint)).toEqual(expected(clock));
      // Their feelings (#216) are the team's, in order, as the showdown meets
      // them: each guardian feels as its species does.
      for (const t of neutral) {
        const feelings = teamAt(t, clock).map(
          (g) => g.feeling ?? species.get(g.speciesId)!.feeling,
        );
        expect(t.guardianHint!.feelings).toEqual(feelings);
        expect(t.guardianHint!.feelings).toHaveLength(t.guardianHint!.count);
      }

      // Never species, levels, moves, strengths or seeds (CLAUDE.md rule 6).
      const rawTiles = (JSON.parse(mine.raw) as { tiles: { guardianHint: object | null }[] }).tiles;
      const tilesJson = JSON.stringify(rawTiles);
      expect(tilesJson).not.toMatch(/level|strength|seed|species|moves|guardian-\d/i);
      for (const table of GUARDIAN_RULES.tables) {
        for (const entry of table.entries) expect(tilesJson).not.toContain(`"${entry.species}"`);
      }
      // Nor elements: a hint's feelings are feelings, never the guardians' element.
      const hintsJson = JSON.stringify(rawTiles.map((t) => t.guardianHint));
      for (const element of GAME_DATA.elements) {
        expect(hintsJson).not.toContain(`"${element.id}"`);
      }
      for (const tile of rawTiles) {
        if (tile.guardianHint)
          expect(Object.keys(tile.guardianHint).sort()).toEqual([
            'count',
            'difficulty',
            'feelings',
          ]);
      }

      // Tomorrow's guardians may differ: worked out on read, by the map's day.
      clock = new Date(clock.getTime() + DAY_MS);
      const tomorrow = (await view(owner)).view.tiles.filter(
        (t) => t.ownerUserId === null && t.homeSlot === null,
      );
      expect(tomorrow.map((t) => t.guardianHint)).toEqual(expected(clock));
    });
  });

  describe('password reset by the owner', () => {
    const reset = (server: FastifyInstance, owner: Player, mapId: string, memberId: string) =>
      call(server, 'POST', `/maps/${mapId}/members/${memberId}/reset-password`, owner);

    async function me(server: FastifyInstance, token: string) {
      const res = await server.inject({
        method: 'GET',
        url: '/api/v1/me',
        cookies: { [SESSION_COOKIE]: token },
      });
      return MeResponseSchema.parse(res.json()).user;
    }

    it("resets a member whose maps are all the owner's (acceptance)", async () => {
      const server = await start();
      const { owner, map, members } = await mapWith(server, 1);
      const friend = members[0]!;
      // A tutorial map doesn't count against the rule (decision D).
      const [tutorial] = await db
        .insert(maps)
        .values({ kind: 'tutorial', name: 'Tutorial Glade', timeZone: 'UTC', maxPlayers: 1 })
        .returning({ id: maps.id });
      await db.insert(mapMembers).values({ mapId: tutorial!.id, userId: friend.id, role: 'owner' });
      // Nor does a map they were removed from.
      const { owner: other, map: otherMap } = await mapWith(server, 0);
      const request = await requestJoin(server, friend, inviteOf(otherMap));
      await approve(server, other, otherMap.id, request.id);
      await call(server, 'POST', `/maps/${otherMap.id}/members/${friend.id}/remove`, other);
      const codesBefore = await db.query.recoveryCodes.findMany({
        where: (t, { eq }) => eq(t.userId, friend.id),
      });

      expect(await me(server, friend.token)).not.toBeNull();
      const res = await reset(server, owner, map.id, friend.id);
      expect(res.statusCode).toBe(200);
      expect(res.headers['cache-control']).toBe('no-store');
      const result = MemberPasswordResetResponseSchema.parse(res.json());
      expect(result.user).toEqual({ id: friend.id, username: friend.username });
      expect(result.temporaryPassword).toMatch(/^[2-9A-Z]{4}-[2-9A-Z]{4}-[2-9A-Z]{4}$/);
      expect(result.recoveryCode).toMatch(/^[2-9A-Z]{4}-[2-9A-Z]{4}-[2-9A-Z]{4}$/);

      // Logged out everywhere, a fresh recovery code, and the new password works.
      expect(await me(server, friend.token)).toBeNull();
      const codesAfter = await db.query.recoveryCodes.findMany({
        where: (t, { eq }) => eq(t.userId, friend.id),
      });
      expect(codesAfter.filter((c) => c.usedAt === null)).toHaveLength(1);
      expect(codesAfter.length).toBe(codesBefore.length + 1);
      const login = await call(server, 'POST', '/auth/login', null, {
        username: friend.username,
        password: result.temporaryPassword,
      });
      expect(login.statusCode).toBe(200);
      expect(SessionResponseSchema.parse(login.json()).user.id).toBe(friend.id);
    });

    it("sends the owner to the operator when the member plays in someone else's map", async () => {
      const server = await start();
      const { owner, map, members } = await mapWith(server, 1);
      const friend = members[0]!;
      const { owner: other, map: otherMap } = await mapWith(server, 0);
      const request = await requestJoin(server, friend, inviteOf(otherMap));
      await approve(server, other, otherMap.id, request.id);

      const res = await reset(server, owner, map.id, friend.id);
      expect(res.statusCode).toBe(403);
      expect(errorOf(res).message).toMatch(/grown-up who runs Heartpatch/);
      expect(await me(server, friend.token)).not.toBeNull();
      // The other owner can't either.
      expect((await reset(server, other, otherMap.id, friend.id)).statusCode).toBe(403);
    });

    it('refuses a member who owns a map of their own', async () => {
      const server = await start();
      const { owner, map, members } = await mapWith(server, 1);
      await createMap(server, members[0]!, 'My Own Patch');
      const res = await reset(server, owner, map.id, members[0]!.id);
      expect(res.statusCode).toBe(403);
      expect(errorOf(res).message).toMatch(/grown-up who runs Heartpatch/);
    });

    it('is for the owner, about current members, never themselves', async () => {
      const server = await start();
      const { owner, map, members } = await mapWith(server, 2);
      const [a, b] = members as [Player, Player];
      expect((await reset(server, a, map.id, b.id)).statusCode).toBe(403);
      expect((await reset(server, owner, map.id, owner.id)).statusCode).toBe(403);
      const stranger = await player();
      expect((await reset(server, owner, map.id, stranger.id)).statusCode).toBe(404);
      expect((await reset(server, stranger, map.id, a.id)).statusCode).toBe(404);
      await call(server, 'POST', `/maps/${map.id}/members/${b.id}/remove`, owner);
      expect((await reset(server, owner, map.id, b.id)).statusCode).toBe(404);
      expect(await me(server, a.token)).not.toBeNull();
    });
  });

  describe('live sync', () => {
    it('publishes each map after a command that wrote events commits', async () => {
      const published: { mapId: string; seq: number }[] = [];
      const service = createMapsService({
        db,
        tutorialRequired: false,
        keeperRequired: true,
        publish: async (mapId) => {
          // Runs after commit, so the newest event is already visible.
          const events = await eventsOf(mapId);
          published.push({ mapId, seq: events.at(-1)?.seq ?? 0 });
        },
      });
      const owner = await player();
      const friend = await player();
      const map = await service.create(owner, { name: 'Live Patch', timeZone: 'UTC' });
      const { request } = await service.join(friend, normalizeInviteCode(map.admin!.invite!.code));
      await service.approve(owner, map.id, request.id);
      await service.setPvpMode(owner, map.id, 'off');
      await service.leave(friend, map.id);
      await vi.waitFor(() => {
        expect(published).toEqual([1, 2, 3, 4].map((seq) => ({ mapId: map.id, seq })));
      });
    });
  });

  describe('privacy', () => {
    it("hides other people's maps and tutorial maps", async () => {
      const server = await start();
      const { map } = await mapWith(server, 0);
      const stranger = await player();
      for (const path of [`/maps/${map.id}`, `/maps/${map.id}/view`]) {
        const res = await call(server, 'GET', path, stranger);
        expect(res.statusCode).toBe(404);
      }
      expect((await call(server, 'GET', '/maps/not-a-uuid', stranger)).statusCode).toBe(400);

      const [tutorial] = await db
        .insert(maps)
        .values({ kind: 'tutorial', name: 'Tutorial Glade', timeZone: 'UTC', maxPlayers: 1 })
        .returning({ id: maps.id });
      await db
        .insert(mapMembers)
        .values({ mapId: tutorial!.id, userId: stranger.id, role: 'owner' });
      expect((await call(server, 'GET', `/maps/${tutorial!.id}`, stranger)).statusCode).toBe(404);
      const lobby = MyMapsResponseSchema.parse(
        (await call(server, 'GET', '/maps', stranger)).json(),
      );
      expect(lobby.maps).toEqual([]);
    });

    it('shows a player the view of their own active tutorial run, and nothing else about it', async () => {
      const server = await start();
      const kid = await player();
      const stranger = await player();
      const [tutorial] = await db
        .insert(maps)
        .values({ kind: 'tutorial', name: 'Tutorial Glade', timeZone: 'UTC', maxPlayers: 1 })
        .returning({ id: maps.id });
      await db.insert(mapMembers).values({ mapId: tutorial!.id, userId: kid.id, role: 'owner' });

      const view = await call(server, 'GET', `/maps/${tutorial!.id}/view`, kid);
      expect(view.statusCode).toBe(200);
      expect(MapViewSchema.parse(view.json()).map.id).toBe(tutorial!.id);
      expect((await call(server, 'GET', `/maps/${tutorial!.id}/view`, stranger)).statusCode).toBe(
        404,
      );

      // Invites, admin and leave never apply to a tutorial map.
      for (const [method, path] of [
        ['GET', `/maps/${tutorial!.id}`],
        ['POST', `/maps/${tutorial!.id}/invite`],
        ['POST', `/maps/${tutorial!.id}/invite/revoke`],
        ['POST', `/maps/${tutorial!.id}/pvp-mode`],
        ['POST', `/maps/${tutorial!.id}/leave`],
      ] as const) {
        const body = path.endsWith('pvp-mode') ? { pvpMode: 'off' } : undefined;
        const res = await call(server, method, path, kid, body);
        expect(res.statusCode, path).toBe(404);
      }

      // A replayed or skipped run is archived: its view is gone too.
      await createMapsRepo(db).archiveMember(tutorial!.id, kid.id);
      expect((await call(server, 'GET', `/maps/${tutorial!.id}/view`, kid)).statusCode).toBe(404);
    });
  });
});
