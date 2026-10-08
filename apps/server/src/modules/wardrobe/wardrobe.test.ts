import {
  ApiErrorSchema,
  CLOTHING_BY_ID,
  CollectResponseSchema,
  GatherResponseSchema,
  MapResponseSchema,
  MapViewSchema,
  Rng,
  SetAccessoryResponseSchema,
  SquishyResponseSchema,
  STARTER_CLOTHING,
  WardrobeResponseSchema,
  type PublicTile,
  type Wardrobe,
} from '@heartpatch/shared';
import { CLOTHING_DROPS, type ClothingDropTable } from '@heartpatch/shared/server';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { afterAll, afterEach, beforeAll, describe, expect, inject, it } from 'vitest';
import { buildApp } from '../../app.js';
import { loadConfig } from '../../config.js';
import { createDbClient, withTransaction, type Database, type DbClient } from '../../db/client.js';
import { keepers, sessions, users } from '../../db/schema.js';
import { createClock } from '../../lib/time.js';
import { PUBLIC_VIEWS, publicViewFor } from '../../ws/public-views.js';
import { SESSION_COOKIE } from '../auth/limits.js';
import { newSessionToken } from '../auth/secrets.js';
import { rollFoundDrop } from './drops.js';

const url = inject('testDatabaseUrl');
const HEADERS = { 'x-requested-with': 'heartpatch' };
const DAY_MS = 24 * 60 * 60 * 1000;
const TEST_KEEPER = { base: 'pip', hairColor: 'honey', eyeColor: 'sky', outfit: 'sunflower' };
/** In the Halloween window (design doc §15). */
const START = '2026-10-02T12:00:00Z';
const STARTERS_ONLY = STARTER_CLOTHING.map((itemId) => ({ itemId, count: 1 }));

interface Player {
  id: string;
  username: string;
  token: string;
}

describe.skipIf(!url)('wardrobe (needs DATABASE_URL)', () => {
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

  async function start(
    env: Record<string, string> = {},
    options: { realClock?: boolean } = {},
  ): Promise<FastifyInstance> {
    const config = loadConfig({
      NODE_ENV: 'test',
      DATABASE_URL: url!,
      HP_DEV_SQUISHY_GRANTS: 'true',
      ...env,
    });
    app = await buildApp({
      config,
      db,
      ...(options.realClock ? {} : { clock: () => clock }),
      logger: false,
    });
    return app;
  }

  async function player(): Promise<Player> {
    const username = `dresser_${String((counter += 1))}`;
    const [user] = await db
      .insert(users)
      .values({ username, passwordHash: 'not-a-hash', birthYear: 2014, timeZone: 'America/Denver' })
      .returning({ id: users.id });
    // Every player has picked a Keeper (the map gate, #42).
    await db.insert(keepers).values({ userId: user!.id, ...TEST_KEEPER });
    const { token, tokenHash } = newSessionToken();
    await db
      .insert(sessions)
      .values({ userId: user!.id, tokenHash, expiresAt: new Date(Date.now() + 365 * DAY_MS) });
    return { id: user!.id, username, token };
  }

  function call(
    server: FastifyInstance,
    method: 'GET' | 'POST',
    path: string,
    who: Player | null,
    payload?: object,
    headers: Record<string, string> = {},
  ) {
    return server.inject({
      method,
      url: `/api/v1${path}`,
      headers: { ...HEADERS, ...headers },
      ...(who ? { cookies: { [SESSION_COOKIE]: who.token } } : {}),
      ...(payload ? { payload } : {}),
    });
  }

  const errorOf = (res: LightMyRequestResponse) => ApiErrorSchema.parse(res.json()).error;

  async function wardrobeOf(server: FastifyInstance, who: Player): Promise<Wardrobe> {
    const res = await call(server, 'GET', '/wardrobe', who);
    expect(res.statusCode).toBe(200);
    return WardrobeResponseSchema.parse(res.json()).wardrobe;
  }

  const wear = (server: FastifyInstance, who: Player, wearing: string[], headers = {}) =>
    call(server, 'POST', '/wardrobe/wear', who, { wearing }, headers);

  async function wearOk(server: FastifyInstance, who: Player, wearing: string[]) {
    const res = await wear(server, who, wearing);
    expect(res.statusCode, res.body).toBe(200);
    return WardrobeResponseSchema.parse(res.json()).wardrobe;
  }

  async function grant(server: FastifyInstance, who: Player, items: string[]) {
    const res = await call(server, 'POST', '/dev/wardrobe/items', who, { items });
    expect(res.statusCode, res.body).toBe(201);
    return WardrobeResponseSchema.parse(res.json()).wardrobe;
  }

  async function newMap(server: FastifyInstance, who: Player): Promise<string> {
    const res = await call(server, 'POST', '/maps', who, {
      name: 'Dress-up Patch',
      timeZone: 'America/Denver',
    });
    expect(res.statusCode).toBe(201);
    return MapResponseSchema.parse(res.json()).map.id;
  }

  async function join(server: FastifyInstance, owner: Player, friend: Player, mapId: string) {
    const detail = () =>
      call(server, 'GET', `/maps/${mapId}`, owner).then(
        (res) => MapResponseSchema.parse(res.json()).map,
      );
    const code = (await detail()).admin!.invite!.code;
    expect((await call(server, 'POST', '/maps/join', friend, { code })).statusCode).toBe(201);
    const requestId = (await detail()).admin!.requests[0]!.id;
    const approve = `/maps/${mapId}/requests/${requestId}/approve`;
    expect((await call(server, 'POST', approve, owner)).statusCode).toBe(204);
  }

  async function viewOf(server: FastifyInstance, who: Player, mapId: string) {
    const res = await call(server, 'GET', `/maps/${mapId}/view`, who);
    expect(res.statusCode).toBe(200);
    return MapViewSchema.parse(res.json());
  }

  const eventsOf = (mapId: string) =>
    db.query.gameEvents.findMany({
      where: (t, { eq }) => eq(t.mapId, mapId),
      orderBy: (t, { asc }) => [asc(t.seq)],
    });

  const piecesOf = (userId: string) =>
    db.query.clothingOwned.findMany({
      where: (t, { eq }) => eq(t.userId, userId),
      orderBy: (t, { asc }) => [asc(t.acquiredAt), asc(t.id)],
    });

  describe('access', () => {
    it('needs a logged-in player', async () => {
      const server = await start();
      const id = '00000000-0000-7000-8000-000000000000';
      for (const [method, path, body] of [
        ['GET', '/wardrobe', undefined],
        ['POST', '/wardrobe/wear', { wearing: [] }],
        ['POST', '/wardrobe/presets/1', { name: null, wearing: [] }],
        ['POST', '/wardrobe/presets/1/wear', undefined],
        ['POST', `/maps/${id}/squishies/${id}/accessory`, { itemId: null }],
        ['POST', '/dev/wardrobe/items', { items: ['witch-hat'] }],
      ] as const) {
        const res = await call(server, method, path, null, body);
        expect(res.statusCode, path).toBe(401);
        expect(errorOf(res).code).toBe('UNAUTHENTICATED');
      }
    });

    it('registers the dev grant only with HP_DEV_SQUISHY_GRANTS', async () => {
      const server = await start({ HP_DEV_SQUISHY_GRANTS: 'false' });
      const res = await call(server, 'POST', '/dev/wardrobe/items', await player(), {
        items: ['witch-hat'],
      });
      expect(res.statusCode).toBe(404);
    });
  });

  describe('owning and wearing', () => {
    it('starts every account with the starter set, nothing worn and no presets', async () => {
      const server = await start();
      const kid = await player();
      expect(await wardrobeOf(server, kid)).toEqual({
        owned: STARTERS_ONLY,
        wearing: [],
        presets: [],
      });
      // Starters aren't stored: nothing to backfill, nothing to trade.
      expect(await piecesOf(kid.id)).toEqual([]);
    });

    it('wears a set (stored in slot order) and takes it off again', async () => {
      const server = await start();
      const kid = await player();
      const dressed = await wearOk(server, kid, ['puddle-boots', 'sunny-cap', 'cozy-sweater']);
      expect(dressed.wearing).toEqual(['sunny-cap', 'cozy-sweater', 'puddle-boots']);
      expect((await wardrobeOf(server, kid)).wearing).toEqual(dressed.wearing);
      expect((await wearOk(server, kid, ['sunny-cap'])).wearing).toEqual(['sunny-cap']);
      expect((await wearOk(server, kid, [])).wearing).toEqual([]);
    });

    it('refuses unknown pieces, squishy accessories, repeats, two in one slot and unowned pieces', async () => {
      const server = await start();
      const kid = await player();
      await wearOk(server, kid, ['sunny-cap']);
      const cases: [string[], number, string][] = [
        [['crown-of-wobbles'], 400, "We don't know that piece of clothing."],
        [['tiny-bow'], 400, "That's for squishies! Try it on one of them."],
        [['sunny-cap', 'sunny-cap'], 400, "You're already wearing that!"],
        [
          ['sunny-cap', 'pom-pom-beanie'],
          400,
          'One at a time in each spot! Take the other one off first.',
        ],
        [['witch-hat'], 403, "You don't have that one yet. Keep exploring!"],
      ];
      for (const [wearing, status, message] of cases) {
        const res = await wear(server, kid, wearing);
        expect(res.statusCode, wearing.join()).toBe(status);
        expect(errorOf(res).message).toBe(message);
      }
      // Nothing changed.
      expect((await wardrobeOf(server, kid)).wearing).toEqual(['sunny-cap']);
      // Shape problems are refused before the service: too many, not ids.
      const tooMany = Array.from({ length: 9 }, () => 'sunny-cap');
      expect((await wear(server, kid, tooMany)).statusCode).toBe(400);
      expect((await wear(server, kid, ['<b>'])).statusCode).toBe(400);
    });

    it('wears what the player found or was given, and counts each piece', async () => {
      const server = await start();
      const kid = await player();
      const granted = await grant(server, kid, ['witch-hat', 'witch-hat', 'ghost-sheet']);
      expect(granted.owned).toContainEqual({ itemId: 'witch-hat', count: 2 });
      expect(granted.owned).toContainEqual({ itemId: 'ghost-sheet', count: 1 });
      // A costume goes over the rest, which stays worn underneath (#42's rule).
      const dressed = await wearOk(server, kid, ['ghost-sheet', 'witch-hat', 'puddle-boots']);
      expect(dressed.wearing).toEqual(['witch-hat', 'puddle-boots', 'ghost-sheet']);
    });

    it('is account-level: other players see it on every patch, live', async () => {
      const server = await start();
      const [kid, friend, other] = [await player(), await player(), await player()];
      const mine = await newMap(server, kid);
      const theirs = await newMap(server, other);
      await join(server, kid, friend, mine);
      await join(server, other, kid, theirs);

      // Never dressed: an empty list, not a guess.
      const before = await viewOf(server, friend, mine);
      expect(before.members.find((m) => m.user.id === kid.id)?.keeper?.wearing).toEqual([]);

      await grant(server, kid, ['witch-hat']);
      await wearOk(server, kid, ['witch-hat', 'puddle-boots']);
      for (const [who, mapId] of [
        [friend, mine],
        [other, theirs],
      ] as const) {
        const member = (await viewOf(server, who, mapId)).members.find((m) => m.user.id === kid.id);
        expect(member?.keeper).toEqual({ ...TEST_KEEPER, wearing: ['witch-hat', 'puddle-boots'] });
        // Live: `outfit.changed` on each patch, with just who and what.
        const event = (await eventsOf(mapId)).at(-1)!;
        expect(event).toMatchObject({ type: 'outfit.changed', actorUserId: kid.id });
        expect(publicViewFor(PUBLIC_VIEWS, event, { userId: who.id })).toEqual({
          userId: kid.id,
          wearing: ['witch-hat', 'puddle-boots'],
        });
      }

      // Wearing the same thing again changes nothing and tells nobody.
      const seq = (await eventsOf(mine)).length;
      await wearOk(server, kid, ['puddle-boots', 'witch-hat']);
      expect(await eventsOf(mine)).toHaveLength(seq);
      // Nor does a player who never dressed taking nothing off.
      await wearOk(server, friend, []);
      expect(await eventsOf(mine)).toHaveLength(seq);
    });

    it('replays a retried wear instead of applying it twice (Idempotency-Key)', async () => {
      const server = await start();
      const kid = await player();
      const mapId = await newMap(server, kid);
      const key = { 'idempotency-key': 'wear-once-please-1' };
      const first = await wear(server, kid, ['sunny-cap'], key);
      const again = await wear(server, kid, ['sunny-cap'], key);
      expect(again.statusCode).toBe(200);
      expect(again.headers['idempotent-replayed']).toBe('true');
      expect(again.json()).toEqual(first.json());
      const changed = (await eventsOf(mapId)).filter((e) => e.type === 'outfit.changed');
      expect(changed).toHaveLength(1);
    });
  });

  describe('outfit presets', () => {
    it('saves up to 3 named outfits and wears one with a tap', async () => {
      const server = await start();
      const kid = await player();
      await grant(server, kid, ['witch-hat', 'ghost-cape']);
      const save = (preset: number, name: string | null, wearing: string[]) =>
        call(server, 'POST', `/wardrobe/presets/${String(preset)}`, kid, { name, wearing });

      expect((await save(1, 'Spooky', ['ghost-cape', 'witch-hat'])).statusCode).toBe(200);
      const saved = WardrobeResponseSchema.parse(
        (await save(3, null, ['sunny-cap'])).json(),
      ).wardrobe;
      expect(saved.presets).toEqual([
        { preset: 1, name: 'Spooky', wearing: ['witch-hat', 'ghost-cape'] },
        { preset: 3, name: null, wearing: ['sunny-cap'] },
      ]);
      // Saving doesn't change what's worn.
      expect(saved.wearing).toEqual([]);

      const worn = await call(server, 'POST', '/wardrobe/presets/1/wear', kid);
      expect(worn.statusCode).toBe(200);
      expect(WardrobeResponseSchema.parse(worn.json()).wardrobe.wearing).toEqual([
        'witch-hat',
        'ghost-cape',
      ]);

      // Replacing a preset keeps one row per preset.
      await save(1, 'Cozy', ['cozy-sweater']);
      expect((await wardrobeOf(server, kid)).presets.map((p) => p.name)).toEqual(['Cozy', null]);
    });

    it('checks presets like wearing, filters names, and has only 3 spots', async () => {
      const server = await start();
      const kid = await player();
      const save = (preset: string, body: object) =>
        call(server, 'POST', `/wardrobe/presets/${preset}`, kid, body);

      const unowned = await save('2', { name: 'Witchy', wearing: ['witch-hat'] });
      expect(unowned.statusCode).toBe(403);
      // Outfit names pass the same filter as usernames (style guide §8).
      const phone = await save('2', { name: 'call 555 123 4567', wearing: [] });
      expect(errorOf(phone)).toEqual({
        code: 'VALIDATION_FAILED',
        message: "Names can't have phone numbers, emails, links or addresses. Try a fun one!",
      });
      for (const preset of ['0', '4', 'one']) {
        expect((await save(preset, { name: null, wearing: [] })).statusCode, preset).toBe(400);
      }
      const empty = await call(server, 'POST', '/wardrobe/presets/2/wear', kid);
      expect(empty.statusCode).toBe(404);
      expect(errorOf(empty).message).toBe("There's no outfit saved there yet.");
      expect((await wardrobeOf(server, kid)).presets).toEqual([]);
    });
  });

  describe('squishy accessories', () => {
    async function squishyOn(server: FastifyInstance, who: Player, mapId: string) {
      const res = await call(server, 'POST', `/maps/${mapId}/dev/squishies`, who, {});
      expect(res.statusCode).toBe(201);
      return SquishyResponseSchema.parse(res.json()).squishy;
    }

    it('dresses the player’s own squishy with an accessory they own, and undresses it', async () => {
      const server = await start();
      const [kid, friend] = [await player(), await player()];
      const mapId = await newMap(server, kid);
      await join(server, kid, friend, mapId);
      const squishy = await squishyOn(server, kid, mapId);
      const path = `/maps/${mapId}/squishies/${squishy.id}/accessory`;

      const bow = await call(server, 'POST', path, kid, { itemId: 'tiny-bow' });
      expect(bow.statusCode).toBe(200);
      expect(SetAccessoryResponseSchema.parse(bow.json())).toEqual({
        squishyId: squishy.id,
        accessory: 'tiny-bow',
      });

      const cases: [Player, object, number][] = [
        [kid, { itemId: 'witch-hat' }, 400], // a Keeper item
        [kid, { itemId: 'tiny-crown' }, 403], // not owned
        [kid, { itemId: 'nope' }, 400],
        [friend, { itemId: 'tiny-bow' }, 404], // not their squishy
      ];
      for (const [who, body, status] of cases) {
        expect((await call(server, 'POST', path, who, body)).statusCode).toBe(status);
      }

      await grant(server, kid, ['tiny-crown']);
      const crown = await call(server, 'POST', path, kid, { itemId: 'tiny-crown' });
      expect(SetAccessoryResponseSchema.parse(crown.json()).accessory).toBe('tiny-crown');
      const off = await call(server, 'POST', path, kid, { itemId: null });
      expect(SetAccessoryResponseSchema.parse(off.json()).accessory).toBeNull();

      // A squishy taken to the Hollow is rescued first, then dressed up.
      await db.execute(`update squishies set state = 'hollowed' where id = '${squishy.id}'`);
      const hollowed = await call(server, 'POST', path, kid, { itemId: 'tiny-bow' });
      expect(hollowed.statusCode).toBe(409);
      expect(errorOf(hollowed).message).toBe(
        'That squishy is in the Hollow. Rescue them first, then dress them up!',
      );
    });
  });

  describe('found clothing', () => {
    /** A finished timber gather, collected; returns what the collect said. */
    async function gatherOnce(server: FastifyInstance, kid: Player, mapId: string) {
      const view = await viewOf(server, kid, mapId);
      const tile = view.tiles.find(
        (t: PublicTile) => t.ownerUserId === kid.id && t.nodeResource === 'timber',
      )!;
      const started = await call(server, 'POST', `/maps/${mapId}/gathers`, kid, {
        q: tile.q,
        r: tile.r,
      });
      expect(started.statusCode).toBe(201);
      const { gather } = GatherResponseSchema.parse(started.json());
      // Timers are timestamps: a day later it's ready.
      clock.setTime(clock.getTime() + DAY_MS);
      const done = await call(server, 'POST', `/maps/${mapId}/gathers/${gather.id}/collect`, kid);
      expect(done.statusCode, done.body).toBe(200);
      return { gather, collected: CollectResponseSchema.parse(done.json()) };
    }

    it('finds a piece while gathering, in the same transaction, and tells only who and what', async () => {
      const server = await start({ HP_DEV_DROP_CHANCE: '100' });
      const [kid, friend] = [await player(), await player()];
      const mapId = await newMap(server, kid);
      await join(server, kid, friend, mapId);
      const { gather, collected } = await gatherOnce(server, kid, mapId);
      // The bag still gets its timber; the collect reply is unchanged.
      expect(Object.keys(collected.granted)).toEqual(['timber']);

      const pieces = await piecesOf(kid.id);
      expect(pieces).toHaveLength(1);
      expect(pieces[0]).toMatchObject({ source: 'gather', refId: gather.id, mapId });
      const itemId = pieces[0]!.itemId;
      expect(CLOTHING_BY_ID.get(itemId)?.sources).toContain('found');
      expect((await wardrobeOf(server, kid)).owned).toContainEqual({ itemId, count: 1 });

      // Found just before the gather's own event, which stays the last write.
      const events = await eventsOf(mapId);
      expect(events.at(-1)?.type).toBe('resource.gathered');
      const found = events.at(-2)!;
      expect(found).toMatchObject({
        type: 'clothing.found',
        actorUserId: kid.id,
        payload: { userId: kid.id, itemId, source: 'gather', refId: gather.id },
      });
      expect(publicViewFor(PUBLIC_VIEWS, found, { userId: friend.id })).toEqual({
        userId: kid.id,
        itemId,
      });
      // The drop tables never leave the server.
      const reply = JSON.stringify(await wardrobeOf(server, kid));
      expect(reply).not.toMatch(/chance|weight|terrain/);
    });

    it('a miss still collects the gather, with no piece and no event', async () => {
      const server = await start({ HP_DEV_DROP_CHANCE: '0' });
      const kid = await player();
      const mapId = await newMap(server, kid);
      await gatherOnce(server, kid, mapId);
      expect(await piecesOf(kid.id)).toEqual([]);
      expect((await eventsOf(mapId)).at(-1)?.type).toBe('resource.gathered');
    });

    it('drops Halloween pieces only in the Halloween window (dev date override)', async () => {
      await start();
      const kid = await player();
      const server = app!;
      const mapId = await newMap(server, kid);
      const halloweenOnly: ClothingDropTable[] = [
        { source: 'gather', chance: 100, entries: [{ item: 'witch-hat', weight: 1 }] },
      ];
      const roll = (devNow: string, refId: string) => {
        const at = createClock(
          loadConfig({ NODE_ENV: 'test', DATABASE_URL: url!, HP_DEV_NOW: devNow }),
        )();
        return withTransaction(db, (tx) =>
          rollFoundDrop(
            tx,
            { source: 'gather', refId, userId: kid.id, mapId, tileId: null, at },
            { tables: halloweenOnly, rng: Rng.fromSeed(refId) },
          ),
        );
      };
      // Denver-local dates: Nov 9 is the 2026 window's last day, Nov 10 is out.
      expect(
        await roll('2026-12-05T12:00:00-07:00', '00000000-0000-7000-8000-000000000001'),
      ).toBeNull();
      expect(
        await roll('2026-11-10T09:00:00-07:00', '00000000-0000-7000-8000-000000000002'),
      ).toBeNull();
      expect(await roll('2026-11-09T22:00:00-07:00', '00000000-0000-7000-8000-000000000003')).toBe(
        'witch-hat',
      );
      expect(await roll('2026-10-31T18:00:00-06:00', '00000000-0000-7000-8000-000000000004')).toBe(
        'witch-hat',
      );
      expect((await piecesOf(kid.id)).map((p) => p.itemId)).toEqual(['witch-hat', 'witch-hat']);
    });

    it('every #261 drop source can award a costume, only in the Halloween window', async () => {
      await start();
      const kid = await player();
      const mapId = await newMap(app!, kid);
      const at = (devNow: string) =>
        createClock(loadConfig({ NODE_ENV: 'test', DATABASE_URL: url!, HP_DEV_NOW: devNow }))();
      let n = 0;
      for (const source of ['gather', 'capture', 'battle', 'explore'] as const) {
        // The shipped table's Halloween costume rows, at a sure chance.
        const shipped = CLOTHING_DROPS.find((t) => t.source === source)!;
        const costumes: ClothingDropTable[] = [
          {
            source,
            chance: 100,
            entries: shipped.entries.filter((e) => {
              const item = CLOTHING_BY_ID.get(e.item);
              return item?.slot === 'costume' && item.season === 'halloween';
            }),
          },
        ];
        const roll = (when: string) => {
          const refId = `00000000-0000-7000-8000-${String((n += 1)).padStart(12, '0')}`;
          return withTransaction(db, (tx) =>
            rollFoundDrop(
              tx,
              { source, refId, userId: kid.id, mapId, tileId: null, at: at(when) },
              { tables: costumes, rng: Rng.fromSeed(refId) },
            ),
          );
        };
        const found = await roll('2026-10-31T18:00:00-06:00');
        expect(CLOTHING_BY_ID.get(found ?? '')?.slot, source).toBe('costume');
        expect(await roll('2026-11-10T09:00:00-07:00'), source).toBeNull();
      }
      const pieces = await piecesOf(kid.id);
      expect(pieces.map((p) => p.source).toSorted()).toEqual([
        'battle',
        'capture',
        'explore',
        'gather',
      ]);
    });

    it('rolls the rival chance when a capture takes a rival’s land', async () => {
      await start();
      const kid = await player();
      const mapId = await newMap(app!, kid);
      const rivalOnly: ClothingDropTable[] = [
        {
          source: 'capture',
          chance: 0,
          rivalChance: 100,
          entries: [{ item: 'big-bow', weight: 1 }],
        },
      ];
      const roll = (refId: string, rival: boolean) =>
        withTransaction(db, (tx) =>
          rollFoundDrop(
            tx,
            { source: 'capture', refId, userId: kid.id, mapId, tileId: null, rival, at: clock },
            { tables: rivalOnly },
          ),
        );
      expect(await roll('00000000-0000-7000-8000-0000000000d1', false)).toBeNull();
      expect(await roll('00000000-0000-7000-8000-0000000000d2', true)).toBe('big-bow');
    });

    it('grants at most one piece per gather, however often it is rolled', async () => {
      await start();
      const kid = await player();
      const mapId = await newMap(app!, kid);
      const always: ClothingDropTable[] = [
        { source: 'gather', chance: 100, entries: [{ item: 'heart-clip', weight: 1 }] },
      ];
      const refId = '00000000-0000-7000-8000-0000000000aa';
      const roll = () =>
        withTransaction(db, (tx) =>
          rollFoundDrop(
            tx,
            { source: 'gather', refId, userId: kid.id, mapId, tileId: null, at: clock },
            { tables: always },
          ),
        );
      expect(await roll()).toBe('heart-clip');
      expect(await roll()).toBeNull();
      expect(await piecesOf(kid.id)).toHaveLength(1);
      expect((await eventsOf(mapId)).filter((e) => e.type === 'clothing.found')).toHaveLength(1);
    });

    it('scales the chance by the event’s share (a Gentle capture, #84)', async () => {
      await start();
      const kid = await player();
      const mapId = await newMap(app!, kid);
      const half: ClothingDropTable[] = [
        { source: 'capture', chance: 60, entries: [{ item: 'big-bow', weight: 1 }] },
      ];
      const roll = (refId: string, percent: number) =>
        withTransaction(db, (tx) =>
          rollFoundDrop(
            tx,
            { source: 'capture', refId, userId: kid.id, mapId, tileId: null, percent, at: clock },
            { tables: half, rng: Rng.fromSeed(refId) },
          ),
        );
      // 60% at half share is 30%: each roll finds exactly when the same
      // seeded roll would at 30, and some seeds land in between.
      let between = 0;
      for (let i = 0; i < 40; i++) {
        const refId = `00000000-0000-7000-8000-${String(i).padStart(12, '0')}`;
        const atHalf = Rng.fromSeed(refId).chance(30);
        if (!atHalf && Rng.fromSeed(refId).chance(60)) between += 1;
        expect(await roll(refId, 50)).toBe(atHalf ? 'big-bow' : null);
      }
      expect(between).toBeGreaterThan(0);
      // No share, no find, even at 100%.
      const sure: ClothingDropTable[] = [{ ...half[0]!, chance: 100 }];
      expect(
        await withTransaction(db, (tx) =>
          rollFoundDrop(
            tx,
            {
              source: 'capture',
              refId: '00000000-0000-7000-8000-0000000000cc',
              userId: kid.id,
              mapId,
              tileId: null,
              percent: 0,
              at: clock,
            },
            { tables: sure },
          ),
        ),
      ).toBeNull();
    });

    it('rolls back with the gather: no piece and no event if the transaction fails', async () => {
      await start();
      const kid = await player();
      const mapId = await newMap(app!, kid);
      const always: ClothingDropTable[] = [
        { source: 'gather', chance: 100, entries: [{ item: 'heart-clip', weight: 1 }] },
      ];
      await expect(
        withTransaction(db, async (tx) => {
          await rollFoundDrop(
            tx,
            {
              source: 'gather',
              refId: '00000000-0000-7000-8000-0000000000bb',
              userId: kid.id,
              mapId,
              tileId: null,
              at: clock,
            },
            { tables: always },
          );
          throw new Error('the collect failed after the roll');
        }),
      ).rejects.toThrow('the collect failed');
      expect(await piecesOf(kid.id)).toEqual([]);
      expect((await eventsOf(mapId)).some((e) => e.type === 'clothing.found')).toBe(false);
    });
  });
});
