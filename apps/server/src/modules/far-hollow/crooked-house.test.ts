import {
  ApiErrorSchema,
  BattleResponseSchema,
  CROOKED_HOUSE,
  CrookedChestResponseSchema,
  CrookedEnterResponseSchema,
  CrookedFixResponseSchema,
  CrookedRelightResponseSchema,
  CrookedViewResponseSchema,
  deriveSeed,
  DevRelightAnswerResponseSchema,
  echoCatch,
  farHollowSeed,
  FarHollowViewSchema,
  GAME_DATA,
  lightOf,
  MapResponseSchema,
  parseGameEventPayload,
  STARTERS,
  type PublicUser,
} from '@heartpatch/shared';
import {
  CROOKED_HOUSE_SECRETS,
  crookedHouseSecrets,
  FAR_HOLLOW_SECRETS,
  type CrookedHouseSeason,
} from '@heartpatch/shared/server';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { afterAll, afterEach, beforeAll, describe, expect, inject, it } from 'vitest';
import { backendPid, waitUntilBlockedBy } from '../../../tests/lock-waits.js';
import { buildApp } from '../../app.js';
import { loadConfig } from '../../config.js';
import { createDbClient, type Database, type DbClient, type Transaction } from '../../db/client.js';
import { keepers, sessions, squishies, users } from '../../db/schema.js';
import { SESSION_COOKIE } from '../auth/limits.js';
import { FAR_HOLLOW_MESSAGES } from './service.js';
import { newSessionToken } from '../auth/secrets.js';

const url = inject('testDatabaseUrl');
const HEADERS = { 'x-requested-with': 'heartpatch' };
const DAY_MS = 24 * 60 * 60 * 1000;
/** DB tests each make a patch and walk the house: give them room. */
const SLOW = { timeout: 60_000 };
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
// 10:00 in Denver (MST, UTC−7) on Nov 4: Halloween 2026's far Hollow (it holds to Nov 9).
const START = '2026-11-04T17:00:00Z';
const SEASON = { id: 'halloween', year: 2026 };
const HERO = STARTERS.speciesIds[0]!;
const speciesOf = (element: string) =>
  GAME_DATA.species.find((s) => s.element === element && s.rarity === 'common')!;

interface Player extends PublicUser {
  token: string;
}

/** A map seed whose house this season passes `ok` (tests pick the shuffle they need). */
function seedWhere(ok: (season: CrookedHouseSeason) => boolean): string {
  for (let i = 0; i < 500; i++) {
    const seed = deriveSeed('crooked-house-test', i);
    if (ok(crookedHouseSecrets(farHollowSeed(seed, SEASON)))) return seed;
  }
  throw new Error('seedWhere: none');
}

describe.skipIf(!url)('the Crooked House (#306 6b, needs DATABASE_URL)', () => {
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
    const config = loadConfig({
      NODE_ENV: 'test',
      DATABASE_URL: url!,
      HP_DEV_SQUISHY_GRANTS: 'true',
    });
    app = await buildApp({ config, db, clock: () => clock, logger: false });
    return app;
  }

  async function player(): Promise<Player> {
    const username = `crooked_${String((counter += 1))}`;
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
    key?: string,
  ) =>
    server.inject({
      method,
      url: `/api/v1${path}`,
      headers: { ...HEADERS, ...(key ? { 'idempotency-key': key } : {}) },
      cookies: { [SESSION_COOKIE]: who.token },
      ...(payload ? { payload } : {}),
    });
  const errorOf = (res: LightMyRequestResponse) => ApiErrorSchema.parse(res.json()).error;

  /** A patch with the kid's starter on it, its seed `seed`, arrived in the house (dev). */
  async function house(server: FastifyInstance, kid: Player, seed: string, dev: object = {}) {
    const res = await call(server, 'POST', '/maps', kid, {
      name: 'Crooked Patch',
      timeZone: 'America/Denver',
    });
    expect(res.statusCode, res.body).toBe(201);
    const mapId = MapResponseSchema.parse(res.json()).map.id;
    // Ids and a seed from this test, so inlining them is safe.
    await db.execute(`update maps set seed = '${seed}' where id = '${mapId}'`);
    const hero = GAME_DATA.species.find((s) => s.id === HERO)!;
    const [squishy] = await db
      .insert(squishies)
      .values({
        mapId,
        ownerUserId: kid.id,
        speciesId: HERO,
        element: hero.element,
        feeling: hero.feeling,
        level: 10,
        teamSlot: 0,
      })
      .returning({ id: squishies.id });
    const arrived = await call(server, 'POST', `/maps/${mapId}/dev/far-hollow`, kid, dev);
    expect(arrived.statusCode, arrived.body).toBe(201);
    const secrets = crookedHouseSecrets(farHollowSeed(seed, SEASON));
    return { mapId, secrets, heroId: squishy!.id, view: FarHollowViewSchema.parse(arrived.json()) };
  }

  const post = (server: FastifyInstance, kid: Player, mapId: string, cmd: string, body: object) =>
    call(server, 'POST', `/maps/${mapId}/far-hollow/${cmd}`, kid, body);
  const fix = async (
    s: FastifyInstance,
    kid: Player,
    mapId: string,
    room: string,
    thing: string,
  ) => {
    const res = await post(s, kid, mapId, 'fix', { room, thing });
    expect(res.statusCode, res.body).toBe(200);
    return CrookedFixResponseSchema.parse(res.json());
  };
  const enter = async (
    s: FastifyInstance,
    kid: Player,
    mapId: string,
    room: string,
    tiptoe = false,
  ) => {
    const res = await post(s, kid, mapId, 'enter', { room, tiptoe });
    expect(res.statusCode, res.body).toBe(200);
    return CrookedEnterResponseSchema.parse(res.json());
  };
  const thingsOf = (room: string) =>
    CROOKED_HOUSE.rooms.find((r) => r.id === room)!.things.filter((t) => t.kind !== 'relight');
  const stateOf = async (kid: PublicUser) =>
    (await db.query.farHollowState.findMany({ where: (t, { eq }) => eq(t.userId, kid.id) }))[0]!;
  const eventsOf = (mapId: string) =>
    db.query.gameEvents.findMany({
      where: (t, { eq }) => eq(t.mapId, mapId),
      orderBy: (t, { asc }) => [asc(t.seq)],
    });

  /** Moves the clock until stepping into `room` now is (or isn't) caught by an echo. */
  function waitForEchoes(
    secrets: CrookedHouseSeason,
    room: string,
    caught: boolean,
    tiptoe = false,
  ) {
    for (let i = 0; i < 600; i++) {
      const hit = echoCatch(CROOKED_HOUSE, secrets.echoes, {
        room,
        atMs: clock.getTime(),
        tiptoe,
        lit: new Set(),
      });
      if ((hit !== null) === caught) return;
      clock.setTime(clock.getTime() + 250);
    }
    throw new Error('waitForEchoes: never');
  }

  it('starts me in the lit Front Hall, with the shuffle kept secret (rule 6)', SLOW, async () => {
    const server = await start();
    const kid = await player();
    const seed = seedWhere(() => true);
    const { mapId, secrets, view } = await house(server, kid, seed);
    expect(view.house).toMatchObject({
      room: 'front-hall',
      lastLitRoom: 'front-hall',
      keys: [],
      unlocked: [],
      bonusOpen: [],
      chestsOpened: [],
      serverTime: START.replace('Z', '.000Z'),
    });
    expect(view.house!.rooms).toHaveLength(13);
    expect(view.house!.rooms.filter((r) => r.bloomed).map((r) => r.id)).toEqual(['front-hall']);
    // The echoes' phases are sent (the client draws them); where keys hide and chests never.
    expect(view.house!.echoes).toEqual(
      CROOKED_HOUSE.echoLoops.map((l) => ({ loop: l.id, ...secrets.echoes[l.id] })),
    );
    const body = JSON.stringify(view);
    const state = await stateOf(kid);
    expect(body).not.toContain(state.seasonSeed);
    for (const spot of Object.values(secrets.keys)) expect(body).not.toContain(`"${spot.thing}"`);
    expect(body).not.toContain('chance');
    // Not arrived on another patch: no house, and its commands refused.
    const other = await call(server, 'POST', '/maps', kid, {
      name: 'Other',
      timeZone: 'America/Denver',
    });
    const otherId = MapResponseSchema.parse(other.json()).map.id;
    const away = await call(server, 'GET', `/maps/${otherId}/far-hollow`, kid);
    expect(FarHollowViewSchema.parse(away.json()).house).toBeNull();
    const refused = await post(server, kid, otherId, 'enter', { room: 'parlour' });
    expect(refused.statusCode).toBe(409);
    expect(errorOf(refused).message).toMatch(/far road/);
    // A stranger isn't on the patch.
    const stranger = await player();
    expect((await post(server, stranger, mapId, 'enter', { room: 'parlour' })).statusCode).toBe(
      404,
    );
  });

  it(
    'puts a room right thing by thing, only where I stand, and blooms it with a find (acceptance)',
    SLOW,
    async () => {
      const server = await start();
      const kid = await player();
      // The Brass Key in the Parlour this season.
      const seed = seedWhere((s) => s.keys['brass-key']!.room === 'parlour');
      const { mapId, secrets } = await house(server, kid, seed);
      const brass = secrets.keys['brass-key']!;

      // Not in the Parlour yet.
      const away = await post(server, kid, mapId, 'fix', { room: 'parlour', thing: 'picture' });
      expect(away.statusCode).toBe(409);
      expect(errorOf(away).message).toMatch(/Walk into that room/);
      expect((await enter(server, kid, mapId, 'parlour')).caught).toBeNull();
      expect(
        (await post(server, kid, mapId, 'fix', { room: 'parlour', thing: 'sofa' })).statusCode,
      ).toBe(404);
      expect(
        (await post(server, kid, mapId, 'fix', { room: 'attic-x', thing: 'sofa' })).statusCode,
      ).toBe(404);

      const things = thingsOf('parlour');
      for (const [i, thing] of things.entries()) {
        const res = await fix(server, kid, mapId, 'parlour', thing.id);
        // The key pops out of the thing it hid in, and only that one.
        expect(res.key).toEqual(
          thing.id === brass.thing ? { id: 'brass-key', name: 'Brass Key' } : null,
        );
        const room = res.view.house!.rooms.find((r) => r.id === 'parlour')!;
        expect(room.fixed).toHaveLength(i + 1);
        const last = i === things.length - 1;
        expect(room.bloomed).toBe(last);
        expect(res.bloom !== null).toBe(last);
        if (last) {
          expect(res.view.house!.lastLitRoom).toBe('parlour');
          expect(res.view.house!.keys).toEqual(['brass-key']);
          expect(res.bloom!.xp).toHaveLength(1);
        }
      }
      // Once a thing.
      const again = await post(server, kid, mapId, 'fix', {
        room: 'parlour',
        thing: things[0]!.id,
      });
      expect(again.statusCode).toBe(409);
      expect(errorOf(again).message).toMatch(/already put right/);

      // The bloom is an explore search at the far road's post: the Seeker track and lore count it.
      const searched = (await eventsOf(mapId)).filter((e) => e.type === 'explore.searched');
      expect(searched).toHaveLength(1);
      expect(parseGameEventPayload('explore.searched', searched[0]!.payload)).toMatchObject({
        userId: kid.id,
        kind: CROOKED_HOUSE_SECRETS.blooms['parlour']!.kind,
        house: { room: 'parlour' },
        tool: null,
      });
    },
  );

  it(
    'turns keys in doors to open the house, never a door without its key (reachability)',
    SLOW,
    async () => {
      const server = await start();
      const kid = await player();
      const seed = seedWhere((s) => s.keys['brass-key']!.room === 'conservatory');
      const { mapId, secrets } = await house(server, kid, seed);

      // The north door is locked and the rooms past it out of reach.
      const locked = await post(server, kid, mapId, 'enter', { room: 'stair-hall' });
      expect(locked.statusCode).toBe(409);
      expect(errorOf(locked).message).toMatch(/locked tight/);
      expect((await post(server, kid, mapId, 'enter', { room: 'kitchen' })).statusCode).toBe(409);
      const noKey = await post(server, kid, mapId, 'unlock', { door: 'north-door' });
      expect(noKey.statusCode).toBe(409);
      expect(errorOf(noKey).message).toBe(
        'Locked tight! The Brass Key is somewhere in this house… 🗝️',
      );
      // Not a key door, a door elsewhere, a door that isn't.
      expect((await post(server, kid, mapId, 'unlock', { door: 'parlour-door' })).statusCode).toBe(
        409,
      );
      expect((await post(server, kid, mapId, 'unlock', { door: 'stairs' })).statusCode).toBe(409);
      expect((await post(server, kid, mapId, 'unlock', { door: 'trapdoor' })).statusCode).toBe(404);

      await enter(server, kid, mapId, 'conservatory');
      await fix(server, kid, mapId, 'conservatory', secrets.keys['brass-key']!.thing);
      // A door of another room: walk back first.
      expect((await post(server, kid, mapId, 'unlock', { door: 'north-door' })).statusCode).toBe(
        409,
      );
      await enter(server, kid, mapId, 'front-hall');
      const turned = await post(server, kid, mapId, 'unlock', { door: 'north-door' });
      expect(turned.statusCode, turned.body).toBe(200);
      expect(CrookedViewResponseSchema.parse(turned.json()).view.house!.unlocked).toEqual([
        'north-door',
      ]);
      // Twice is harmless.
      expect((await post(server, kid, mapId, 'unlock', { door: 'north-door' })).statusCode).toBe(
        200,
      );

      // Now the Stair Hall, through the door, past its echo.
      waitForEchoes(secrets, 'stair-hall', false);
      expect((await enter(server, kid, mapId, 'stair-hall')).view.house!.room).toBe('stair-hall');
      // Dark rooms only through a door of the room I'm in.
      const jump = await post(server, kid, mapId, 'enter', { room: 'kitchen' });
      expect(jump.statusCode).toBe(409);
      expect(errorOf(jump).message).toMatch(/No door/);
      // The Library is behind the Copper door.
      expect((await post(server, kid, mapId, 'enter', { room: 'library' })).statusCode).toBe(409);
      // A lit room I can reach: straight there (the dollhouse map).
      const back = await enter(server, kid, mapId, 'front-hall');
      expect(back.view.house).toMatchObject({ room: 'front-hall', lastLitRoom: 'front-hall' });
    },
  );

  it(
    'catches me with a peekaboo in an echo’s reach, half as far on tiptoe, and loses nothing (owner decision 2)',
    SLOW,
    async () => {
      const server = await start();
      const kid = await player();
      const seed = seedWhere(() => true);
      // Every key found and turned, standing in the Front Hall.
      const { mapId, secrets } = await house(server, kid, seed, { room: 'front-hall' });
      const loop = CROOKED_HOUSE.echoLoops.find((l) => l.rooms.includes('stair-hall'))!;

      waitForEchoes(secrets, 'stair-hall', true);
      const caught = await enter(server, kid, mapId, 'stair-hall');
      expect(caught.caught).toEqual({ echo: loop.id, backTo: 'front-hall' });
      expect(caught.view.house).toMatchObject({
        room: 'front-hall',
        keys: CROOKED_HOUSE.keys.map((k) => k.id),
      });

      // Just inside full reach but past half of it: tiptoe slips by.
      waitForEchoes(secrets, 'stair-hall', true, false);
      for (let i = 0; i < 2000; i++) {
        const full = echoCatch(CROOKED_HOUSE, secrets.echoes, {
          room: 'stair-hall',
          atMs: clock.getTime(),
          tiptoe: false,
          lit: new Set(),
        });
        const half = echoCatch(CROOKED_HOUSE, secrets.echoes, {
          room: 'stair-hall',
          atMs: clock.getTime(),
          tiptoe: true,
          lit: new Set(),
        });
        if (full && !half) break;
        clock.setTime(clock.getTime() + 50);
      }
      const crept = await enter(server, kid, mapId, 'stair-hall', true);
      expect(crept.caught).toBeNull();
      expect(crept.view.house!.room).toBe('stair-hall');

      // A room put right is safe for good: the echo never catches there.
      for (const thing of thingsOf('stair-hall'))
        await fix(server, kid, mapId, 'stair-hall', thing.id);
      await enter(server, kid, mapId, 'front-hall');
      waitForEchoes(secrets, 'stair-hall', true);
      const safe = await enter(server, kid, mapId, 'stair-hall');
      expect(safe.caught).toBeNull();
      expect(safe.view.house!.lastLitRoom).toBe('stair-hall');
    },
  );

  it(
    'opens a power door with a team squishy of its element, any level, every time (owner decision 7)',
    SLOW,
    async () => {
      const server = await start();
      const kid = await player();
      const seed = seedWhere(() => true);
      const { mapId, heroId } = await house(server, kid, seed, { room: 'parlour' });
      const fire = speciesOf('fire');
      const [ember, benched] = await db
        .insert(squishies)
        .values(
          [1, null].map((teamSlot) => ({
            mapId,
            ownerUserId: kid.id,
            speciesId: fire.id,
            element: fire.element,
            feeling: fire.feeling,
            level: 1,
            teamSlot,
          })),
        )
        .returning({ id: squishies.id });
      const hero = GAME_DATA.species.find((s) => s.id === HERO)!;
      const power = (squishyId: string, door = 'inglenook-door') =>
        post(server, kid, mapId, 'power', { door, squishyId });

      if (hero.element !== 'fire') {
        const wrong = await power(heroId);
        expect(wrong.statusCode).toBe(409);
        expect(errorOf(wrong).message).toBe('A Fire friend could help here!');
      }
      const offTeam = await power(benched!.id);
      expect(offTeam.statusCode).toBe(409);
      expect(errorOf(offTeam).message).toMatch(/battle team/);
      expect((await power(ember!.id, 'parlour-door')).statusCode).toBe(409);
      // Not before it's open.
      expect((await post(server, kid, mapId, 'enter', { room: 'inglenook' })).statusCode).toBe(409);

      const opened = await power(ember!.id);
      expect(opened.statusCode, opened.body).toBe(200);
      expect(CrookedViewResponseSchema.parse(opened.json()).view.house!.bonusOpen).toEqual([
        'inglenook-door',
      ]);
      expect((await power(ember!.id)).statusCode).toBe(200);
      // Open, and lit at once: walk in.
      expect((await enter(server, kid, mapId, 'inglenook')).view.house!.room).toBe('inglenook');
    },
  );

  it(
    'gives a bonus chest’s loot and starts its rare friend’s battle, odds unsent (owner decision 6)',
    SLOW,
    async () => {
      const server = await start();
      const kid = await player();
      const seed = seedWhere((s) => s.chests['inglenook']!.friend !== null);
      const { mapId, secrets } = await house(server, kid, seed, { room: 'parlour' });
      const fire = speciesOf('fire');
      const [ember] = await db
        .insert(squishies)
        .values({
          mapId,
          ownerUserId: kid.id,
          speciesId: fire.id,
          element: fire.element,
          feeling: fire.feeling,
          level: 1,
          teamSlot: 1,
        })
        .returning({ id: squishies.id });
      expect(
        (await post(server, kid, mapId, 'power', { door: 'inglenook-door', squishyId: ember!.id }))
          .statusCode,
      ).toBe(200);
      // Only in the room.
      expect((await post(server, kid, mapId, 'chest', { room: 'inglenook' })).statusCode).toBe(409);
      expect((await post(server, kid, mapId, 'chest', { room: 'parlour' })).statusCode).toBe(409);
      await enter(server, kid, mapId, 'inglenook');

      const res = await post(server, kid, mapId, 'chest', { room: 'inglenook' });
      expect(res.statusCode, res.body).toBe(200);
      const chest = CrookedChestResponseSchema.parse(res.json());
      const due = secrets.chests['inglenook']!;
      expect(chest.find.found).toMatchObject(due.items);
      expect(chest.completed).toBe(false);
      expect(chest.view.house!.chestsOpened).toEqual(['inglenook']);
      expect(chest.friend).toMatchObject({ speciesId: due.friend!.speciesId });
      expect(res.body).not.toContain('chance');
      // A wild battle a Heart Charm works in, against the friend at its level.
      const battle = await call(server, 'GET', `/battles/${chest.friend!.battleId}`, kid);
      expect(battle.statusCode).toBe(200);
      const b = BattleResponseSchema.parse(battle.json()).battle;
      expect(b.kind).toBe('wild');
      expect(b.view.sides.b.squishies).toEqual([
        expect.objectContaining({ speciesId: due.friend!.speciesId, level: due.friend!.level }),
      ]);
      // Once a chest.
      const again = await post(server, kid, mapId, 'chest', { room: 'inglenook' });
      expect(again.statusCode).toBe(409);
    },
  );

  it(
    'refuses a bonus chest while a battle is going, so a friend has a free team to meet',
    SLOW,
    async () => {
      const server = await start();
      const kid = await player();
      const seed = seedWhere(() => true);
      const { mapId } = await house(server, kid, seed, { room: 'parlour' });
      const fire = speciesOf('fire');
      const [ember] = await db
        .insert(squishies)
        .values({
          mapId,
          ownerUserId: kid.id,
          speciesId: fire.id,
          element: fire.element,
          feeling: fire.feeling,
          level: 1,
          teamSlot: 1,
        })
        .returning({ id: squishies.id });
      await post(server, kid, mapId, 'power', { door: 'inglenook-door', squishyId: ember!.id });
      await enter(server, kid, mapId, 'inglenook');
      const fight = await call(server, 'POST', `/maps/${mapId}/dev/battles`, kid, {});
      expect([200, 201]).toContain(fight.statusCode);
      const res = await post(server, kid, mapId, 'chest', { room: 'inglenook' });
      expect(res.statusCode).toBe(409);
      expect(errorOf(res).message).toMatch(/Finish your battle/);
      expect((await stateOf(kid)).chestsOpened).toBe(0);
    },
  );

  it(
    'opens the attic chest once every room is right: page, cloak, pile, gift and completion, once (owner decision 4)',
    SLOW,
    async () => {
      const server = await start();
      const kid = await player();
      const seed = seedWhere(() => true);
      // Too soon: the attic with rooms still dark.
      const early = await house(server, kid, seed, { room: 'attic' });
      const soon = await post(server, kid, early.mapId, 'chest', { room: 'attic' });
      expect(soon.statusCode).toBe(409);
      expect(errorOf(soon).message).toMatch(/Put 12 more rooms right/);

      const other = await player();
      const { mapId } = await house(server, other, seed, { nearlyDone: true });
      const state = await stateOf(other);
      expect(state.currentRoom).toBe('sewing-room');
      expect((await post(server, other, mapId, 'chest', { room: 'attic' })).statusCode).toBe(409);
      const last = thingsOf('sewing-room').at(-1)!;
      const bloomed = await fix(server, other, mapId, 'sewing-room', last.id);
      expect(bloomed.bloom).not.toBeNull();
      await enter(server, other, mapId, 'landing');
      await enter(server, other, mapId, 'attic');
      const notYet = await post(server, other, mapId, 'chest', { room: 'attic' });
      expect(notYet.statusCode, notYet.body).toBe(200);
      const chest = CrookedChestResponseSchema.parse(notYet.json());
      const gift = FAR_HOLLOW_SECRETS.completionGift;
      const pile = CROOKED_HOUSE_SECRETS.attic.items;
      expect(chest).toMatchObject({
        completed: true,
        friend: null,
        find: {
          lore: { id: 'the-crooked-house', title: 'A Lantern in Every Room' },
          clothing: 'lantern-keepers-cloak',
          notable: 'lore',
        },
      });
      expect(chest.find.found).toEqual({
        heartdust: (pile['heartdust'] ?? 0) + (gift['heartdust'] ?? 0),
        glimmer: pile['glimmer'],
        treats: gift['treats'],
      });
      expect(chest.view.completedAt).toBe(clock.toISOString());
      const events = await eventsOf(mapId);
      const completed = events.filter((e) => e.type === 'journey.completed');
      expect(completed).toHaveLength(1);
      expect(parseGameEventPayload('journey.completed', completed[0]!.payload)).toEqual({
        userId: other.id,
        season: SEASON.id,
        year: SEASON.year,
        lorePage: 'the-crooked-house',
      });
      expect((await stateOf(other)).atticOpenedAt).toEqual(clock);
      expect((await post(server, other, mapId, 'chest', { room: 'attic' })).statusCode).toBe(409);
      // The page is found once: the lore consumer grants it from the search.
      const searched = events.filter((e) => e.type === 'explore.searched').at(-1)!;
      expect(parseGameEventPayload('explore.searched', searched.payload)).toMatchObject({
        lorePage: 'the-crooked-house',
        house: { room: 'attic' },
      });
    },
  );

  it('works at night (owner decisions of 2026-10-23)', SLOW, async () => {
    const server = await start();
    const kid = await player();
    const { mapId } = await house(
      server,
      kid,
      seedWhere(() => true),
    );
    // 21:00 in Denver.
    clock.setTime(Date.parse('2026-11-05T04:00:00Z'));
    expect((await enter(server, kid, mapId, 'parlour')).view.house!.room).toBe('parlour');
    expect((await fix(server, kid, mapId, 'parlour', 'picture')).view.house!.rooms).toContainEqual(
      expect.objectContaining({ id: 'parlour', fixed: ['picture'] }),
    );
  });

  describe('the Relight boards (#306 6f, owner decision 5)', () => {
    const relight = async (s: FastifyInstance, kid: Player, mapId: string, room: string) => {
      const thing = CROOKED_HOUSE.rooms
        .find((r) => r.id === room)!
        .things.find((t) => t.kind === 'relight')!;
      const res = await post(s, kid, mapId, 'relight', { room, thing: thing.id });
      expect(res.statusCode, res.body).toBe(200);
      return { thing: thing.id, start: CrookedRelightResponseSchema.parse(res.json()) };
    };
    const answer = async (s: FastifyInstance, kid: Player, mapId: string, body: object) => {
      const res = await call(s, 'POST', `/maps/${mapId}/dev/far-hollow/relight-answer`, kid, body);
      expect(res.statusCode, res.body).toBe(200);
      return DevRelightAnswerResponseSchema.parse(res.json());
    };

    it(
      'deals a 5×5 in the Library and a 6×6 in the Music Room, a new one every try',
      SLOW,
      async () => {
        const server = await start();
        const kid = await player();
        const { mapId } = await house(
          server,
          kid,
          seedWhere(() => true),
          { room: 'library' },
        );
        const first = await relight(server, kid, mapId, 'library');
        expect(first.start).toMatchObject({ kind: 'relight', attempt: 1, board: { size: 5 } });
        // A fresh try is a new puzzle of the same size (owner decision: a fail reshuffles).
        const second = await relight(server, kid, mapId, 'library');
        expect(second.start).toMatchObject({ attempt: 2, board: { size: 5 } });
        expect(second.start.board.cells).not.toEqual(first.start.board.cells);
        // The board's openings are as dealt, never the answer: it isn't lit yet.
        expect(lightOf(second.start.board).litLanterns).toBeLessThan(
          lightOf(second.start.board).lanterns,
        );
        // Only in the room I'm in, and only a Relight thing.
        const away = await post(server, kid, mapId, 'relight', {
          room: 'music-room',
          thing: 'music-box',
        });
        expect(away.statusCode).toBe(409);
        expect(errorOf(away).message).toBe(FAR_HOLLOW_MESSAGES.notHere);
        const notBoard = await post(server, kid, mapId, 'relight', {
          room: 'library',
          thing: 'globe',
        });
        expect(notBoard.statusCode).toBe(409);
        expect(errorOf(notBoard).message).toBe(FAR_HOLLOW_MESSAGES.notRelight);
      },
    );

    it(
      "relights only with the try's own winning moves, replayed on the server (rule 1)",
      SLOW,
      async () => {
        const server = await start();
        const kid = await player();
        const { mapId } = await house(
          server,
          kid,
          seedWhere(() => true),
          { room: 'music-room' },
        );
        const fixBoard = (relightTry: object) =>
          post(server, kid, mapId, 'fix', {
            room: 'music-room',
            thing: 'music-box',
            relight: relightTry,
          });
        // No board, no fix.
        const bare = await post(server, kid, mapId, 'fix', {
          room: 'music-room',
          thing: 'music-box',
        });
        expect(bare.statusCode).toBe(409);
        expect(errorOf(bare).message).toBe(FAR_HOLLOW_MESSAGES.needsBoard);
        // Before any try: stale.
        expect(errorOf(await fixBoard({ attempt: 1, moves: [] })).message).toBe(
          FAR_HOLLOW_MESSAGES.puzzleStale,
        );
        const { start: first } = await relight(server, kid, mapId, 'music-room');
        expect(first.board.size).toBe(6);
        const won = await answer(server, kid, mapId, { room: 'music-room', thing: 'music-box' });
        expect(won.attempt).toBe(1);
        // Not lit: refused, and nothing written.
        const wrong = await fixBoard({ attempt: 1, moves: [] });
        expect(wrong.statusCode).toBe(409);
        expect(errorOf(wrong).message).toBe(FAR_HOLLOW_MESSAGES.puzzleWrong);
        // An old try's answer after a reshuffle: stale.
        await relight(server, kid, mapId, 'music-room');
        expect(errorOf(await fixBoard({ attempt: 1, moves: won.moves })).message).toBe(
          FAR_HOLLOW_MESSAGES.puzzleStale,
        );
        const now = await answer(server, kid, mapId, { room: 'music-room', thing: 'music-box' });
        const res = await fixBoard({ attempt: now.attempt, moves: now.moves });
        expect(res.statusCode, res.body).toBe(200);
        const fixed = CrookedFixResponseSchema.parse(res.json());
        expect(fixed.view.house!.rooms).toContainEqual(
          expect.objectContaining({ id: 'music-room', fixed: ['music-box'], bloomed: false }),
        );
        // Not a key's hiding place, and no scrap until the room blooms.
        expect(fixed).toMatchObject({ key: null, bloom: null, scrap: null });
        // Once relit, it stays: no new try, no second fix.
        const again = await post(server, kid, mapId, 'relight', {
          room: 'music-room',
          thing: 'music-box',
        });
        expect(errorOf(again).message).toBe(FAR_HOLLOW_MESSAGES.fixed);
        // A plain thing takes no board.
        const plain = await post(server, kid, mapId, 'fix', {
          room: 'music-room',
          thing: 'piano-lid',
          relight: { attempt: 1, moves: [] },
        });
        expect(errorOf(plain).message).toBe(FAR_HOLLOW_MESSAGES.notRelight);
      },
    );

    it('blooms the Library on its board, with its story scrap', SLOW, async () => {
      const server = await start();
      const kid = await player();
      const { mapId } = await house(
        server,
        kid,
        seedWhere(() => true),
        { room: 'library', nearlyDone: true },
      );
      // Every room right but the Library's board.
      const library = (await stateOf(kid)).currentRoom;
      expect(library).toBe('library');
      const { thing } = await relight(server, kid, mapId, 'library');
      const won = await answer(server, kid, mapId, { room: 'library', thing });
      const res = await post(server, kid, mapId, 'fix', {
        room: 'library',
        thing,
        relight: won,
      });
      expect(res.statusCode, res.body).toBe(200);
      const fixed = CrookedFixResponseSchema.parse(res.json());
      expect(fixed.bloom).not.toBeNull();
      expect(fixed.scrap).toBe(CROOKED_HOUSE_SECRETS.scraps['library']);
      expect(fixed.view.house!.rooms.every((r) => r.bloomed)).toBe(true);
      expect((await stateOf(kid)).lastLitRoom).toBe('library');
    });
  });

  it('gives each room its scrap as it blooms, and only then', SLOW, async () => {
    const server = await start();
    const kid = await player();
    const { mapId } = await house(
      server,
      kid,
      seedWhere(() => true),
      { room: 'scullery' },
    );
    const [first, last] = thingsOf('scullery');
    expect((await fix(server, kid, mapId, 'scullery', first!.id)).scrap).toBeNull();
    const bloomed = await fix(server, kid, mapId, 'scullery', last!.id);
    expect(bloomed.scrap).toBe(CROOKED_HOUSE_SECRETS.scraps['scullery']);
    // The scraps are server-side story, never in the view (rule 6).
    expect(JSON.stringify(bloomed.view)).not.toContain(CROOKED_HOUSE_SECRETS.scraps['parlour']!);
  });

  it('replays a retried fix (Idempotency-Key): one write, one key', SLOW, async () => {
    const server = await start();
    const kid = await player();
    const seed = seedWhere((s) => s.keys['brass-key']!.room === 'parlour');
    const { mapId, secrets } = await house(server, kid, seed, { room: 'parlour' });
    const thing = secrets.keys['brass-key']!.thing;
    const send = () =>
      call(
        server,
        'POST',
        `/maps/${mapId}/far-hollow/fix`,
        kid,
        { room: 'parlour', thing },
        'fix-1',
      );
    const first = await send();
    expect(first.statusCode, first.body).toBe(200);
    const replay = await send();
    expect(replay.statusCode).toBe(200);
    expect(replay.headers['idempotent-replayed']).toBe('true');
    expect(replay.json()).toEqual(first.json());
    const rooms = await db.query.farHollowRooms.findMany({
      where: (t, { eq }) => eq(t.userId, kid.id),
    });
    expect(rooms.find((r) => r.roomId === 'parlour')!.fixed).toBe(
      1 <<
        CROOKED_HOUSE.rooms
          .find((r) => r.id === 'parlour')!
          .things.findIndex((t) => t.id === thing),
    );
  });

  describe('lock order (tech spec §7)', () => {
    /** Holds `first` in a transaction, starts `command`, waits until it's blocked on us, then takes `then`. */
    async function holdThen<T>(
      first: (tx: Transaction) => Promise<unknown>,
      command: () => Promise<T>,
      then: (tx: Transaction) => Promise<unknown>,
    ): Promise<T> {
      let running: Promise<T> | undefined;
      await db.transaction(async (tx) => {
        await tx.execute(`set local lock_timeout = '10s'`);
        await first(tx);
        const pid = await backendPid(tx);
        running = command();
        await waitUntilBlockedBy(db, pid);
        await then(tx);
      });
      return running!;
    }
    // Ids from this test's own rows, so inlining them is safe.
    const lockState = (tx: Transaction, kid: PublicUser) =>
      tx.execute(`select keys from far_hollow_state where user_id = '${kid.id}' for update`);
    const lockRoom = (tx: Transaction, kid: PublicUser, room: string) =>
      tx.execute(
        `select fixed from far_hollow_rooms where user_id = '${kid.id}' and room_id = '${room}' for update`,
      );
    const lockSquishy = (tx: Transaction, id: string) =>
      tx.execute(`select id from squishies where id = '${id}' for update`);

    it('takes the state row before the room row (fix, step 6)', SLOW, async () => {
      const server = await start();
      const kid = await player();
      const { mapId } = await house(
        server,
        kid,
        seedWhere(() => true),
        { room: 'parlour' },
      );
      await fix(server, kid, mapId, 'parlour', 'picture');
      const res = await holdThen(
        (tx) => lockState(tx, kid),
        () => post(server, kid, mapId, 'fix', { room: 'parlour', thing: 'armchair' }),
        (tx) => lockRoom(tx, kid, 'parlour'),
      );
      expect(res.statusCode, res.body).toBe(200);
    });

    it(
      'takes the room row before the team’s squishies (a bloom, step 6 then 10)',
      SLOW,
      async () => {
        const server = await start();
        const kid = await player();
        const { mapId, heroId } = await house(
          server,
          kid,
          seedWhere(() => true),
          { room: 'scullery' },
        );
        await fix(server, kid, mapId, 'scullery', 'mop');
        const res = await holdThen(
          (tx) => lockRoom(tx, kid, 'scullery'),
          () => post(server, kid, mapId, 'fix', { room: 'scullery', thing: 'bucket' }),
          (tx) => lockSquishy(tx, heroId),
        );
        expect(res.statusCode, res.body).toBe(200);
        expect(CrookedFixResponseSchema.parse(res.json()).bloom).not.toBeNull();
      },
    );
  });
});
