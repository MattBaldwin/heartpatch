import {
  ApiErrorSchema,
  CollectResponseSchema,
  CraftResponseSchema,
  GatherResponseSchema,
  HomeResponseSchema,
  InventoryResponseSchema,
  MapResponseSchema,
  MapViewSchema,
  RECIPE_BOOK,
  RecipeBookResponseSchema,
  recipeBookPages,
} from '@heartpatch/shared';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { afterAll, afterEach, beforeAll, describe, expect, inject, it } from 'vitest';
import { buildApp } from '../../app.js';
import { loadConfig } from '../../config.js';
import { createDbClient, withTransaction, type Database, type DbClient } from '../../db/client.js';
import { keepers, sessions, users } from '../../db/schema.js';
import { SESSION_COOKIE } from '../auth/limits.js';
import { newSessionToken } from '../auth/secrets.js';
import { recipeBookPage, requirePageOpen } from './service.js';

const url = inject('testDatabaseUrl');
const HEADERS = { 'x-requested-with': 'heartpatch' };
const DAY_MS = 24 * 60 * 60 * 1000;
const TEST_KEEPER = {
  base: 'pip',
  hairColor: 'honey',
  eyeColor: 'sky',
  outfit: 'sunflower',
  skinTone: 'tone-1',
  eyes: 'round' as const,
  brows: 'arched',
  mouth: 'smile',
  extras: [],
};
/** Oct 2, 6:00 AM in Denver: in the Halloween window. */
const START = '2026-10-02T12:00:00Z';
const SEALED_RECIPE = 'That recipe page is still sealed! Collect everything it needs first.';
const SEALED_BUILDING = 'That building page is still sealed! Collect everything it needs first.';
const ALWAYS_OPEN = [
  'recipe:heart-charm',
  'building:hearthfire',
  'building:ember-den',
  'building:cozy-meadow',
];

interface Player {
  id: string;
  token: string;
}

describe.skipIf(!url)('recipe book unlocks (needs DATABASE_URL)', () => {
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
    const username = `bookworm_${String((counter += 1))}`;
    const [user] = await db
      .insert(users)
      .values({ username, passwordHash: 'not-a-hash', birthYear: 2014, timeZone: 'America/Denver' })
      .returning({ id: users.id });
    const { token, tokenHash } = newSessionToken();
    await db.insert(sessions).values({
      userId: user!.id,
      tokenHash,
      expiresAt: new Date(Date.parse(START) + 365 * DAY_MS),
    });
    // Every player has picked a Keeper (the map gate, #42).
    await db.insert(keepers).values({ userId: user!.id, ...TEST_KEEPER });
    return { id: user!.id, token };
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

  async function newMap(server: FastifyInstance, who: Player): Promise<string> {
    const res = await call(server, 'POST', '/maps', who, {
      name: 'Book Patch',
      timeZone: 'America/Denver',
    });
    expect(res.statusCode).toBe(201);
    return MapResponseSchema.parse(res.json()).map.id;
  }

  async function give(server: FastifyInstance, who: Player, mapId: string, items: object) {
    const res = await call(server, 'POST', `/maps/${mapId}/dev/items`, who, { items });
    expect(res.statusCode).toBe(201);
  }

  const bag = async (server: FastifyInstance, who: Player, mapId: string) => {
    const res = await call(server, 'GET', `/maps/${mapId}/inventory`, who);
    expect(res.statusCode).toBe(200);
    return InventoryResponseSchema.parse(res.json());
  };

  async function book(server: FastifyInstance, who: Player): Promise<string[]> {
    const res = await call(server, 'GET', '/recipe-book', who);
    expect(res.statusCode).toBe(200);
    return RecipeBookResponseSchema.parse(res.json()).unlocked;
  }

  const craft = (server: FastifyInstance, who: Player, mapId: string, recipeId: string) =>
    call(server, 'POST', `/maps/${mapId}/crafts`, who, { recipeId });

  async function craftAndCollect(
    server: FastifyInstance,
    who: Player,
    mapId: string,
    recipeId: string,
  ) {
    const made = await craft(server, who, mapId, recipeId);
    expect(made.statusCode, made.body).toBe(201);
    const { craft: started } = CraftResponseSchema.parse(made.json());
    clock.setTime(Date.parse(started.readyAt));
    const res = await call(server, 'POST', `/maps/${mapId}/crafts/${started.id}/collect`, who);
    expect(res.statusCode).toBe(200);
    return CollectResponseSchema.parse(res.json());
  }

  /** A plain home tile (no Heart Seed, no node) to build on. */
  async function plainHomeTile(server: FastifyInstance, who: Player, mapId: string) {
    const res = await call(server, 'GET', `/maps/${mapId}/home`, who);
    expect(res.statusCode).toBe(200);
    // Any ring tile: its node takes the middle, so tests build on spots 1–6.
    const tile = HomeResponseSchema.parse(res.json()).tiles.find((t) => !t.heartSeed)!;
    return { q: tile.q, r: tile.r };
  }

  /** A neutral outer tile with a free middle, handed to `who` (as if claimed): fires go there. */
  async function landTile(mapId: string, who: Player) {
    const tile = (await db.query.tiles.findFirst({
      where: (t, { and, eq, isNull }) =>
        and(eq(t.mapId, mapId), isNull(t.homeSlot), isNull(t.ownerUserId), isNull(t.nodeResource)),
    }))!;
    await db.execute(`update tiles set owner_user_id = '${who.id}' where id = '${tile.id}'`);
    return { q: tile.q, r: tile.r };
  }

  const place = (
    server: FastifyInstance,
    who: Player,
    mapId: string,
    body: { buildingId: string; q: number; r: number; spot: number },
  ) => call(server, 'POST', `/maps/${mapId}/buildings`, who, body);

  const craftsOf = (userId: string) =>
    db.query.crafts.findMany({ where: (t, { eq }) => eq(t.userId, userId) });
  const buildingsOf = (userId: string) =>
    db.query.buildings.findMany({ where: (t, { eq }) => eq(t.ownerUserId, userId) });

  it('needs a logged-in player', async () => {
    const server = await start();
    expect((await call(server, 'GET', '/recipe-book', null)).statusCode).toBe(401);
  });

  it('opens only the always-open pages for a brand-new account, in book order', async () => {
    const server = await start();
    const kid = await player();
    expect(await book(server, kid)).toEqual(ALWAYS_OPEN);
    expect(RECIPE_BOOK.alwaysOpen).toEqual(ALWAYS_OPEN);

    // The ledger read itself: open pages pass with nothing collected, sealed ones don't.
    await withTransaction(db, async (tx) => {
      for (const key of ALWAYS_OPEN) {
        await expect(requirePageOpen(tx, kid.id, recipeBookPage(key)!)).resolves.toBeUndefined();
      }
      await expect(
        requirePageOpen(tx, kid.id, recipeBookPage('recipe:pumpkin-treats')!),
      ).rejects.toMatchObject({ code: 'FORBIDDEN', message: SEALED_RECIPE });
      await expect(
        requirePageOpen(tx, kid.id, recipeBookPage('building:jack-o-lantern-hearthfire')!),
      ).rejects.toMatchObject({ code: 'FORBIDDEN', message: SEALED_BUILDING });
    });
  });

  it('lets a new account make every always-open page', async () => {
    const server = await start();
    const kid = await player();
    const mapId = await newMap(server, kid);
    await give(server, kid, mapId, { timber: 30, stone: 30, treats: 2 });
    await craftAndCollect(server, kid, mapId, 'heart-charm');
    const tile = await plainHomeTile(server, kid, mapId);
    // Habitats go around a home tile's middle (#204); fires only out on land (#202).
    for (const [i, buildingId] of ['ember-den', 'cozy-meadow'].entries()) {
      const res = await place(server, kid, mapId, { buildingId, ...tile, spot: i + 1 });
      expect(res.statusCode, res.body).toBe(201);
    }
    const res = await place(server, kid, mapId, {
      buildingId: 'hearthfire',
      ...(await landTile(mapId, kid)),
      spot: 0,
    });
    expect(res.statusCode, res.body).toBe(201);
  });

  it('refuses a sealed recipe with FORBIDDEN and spends nothing', async () => {
    const server = await start();
    const kid = await player();
    const mapId = await newMap(server, kid);
    // Everything but the Witch Dust.
    await give(server, kid, mapId, { pumpkins: 3, emberwood: 2 });
    const before = (await bag(server, kid, mapId)).items;

    const res = await craft(server, kid, mapId, 'jack-o-lantern-hearthfire');
    expect(res.statusCode).toBe(403);
    expect(errorOf(res)).toEqual({ code: 'FORBIDDEN', message: SEALED_RECIPE });
    expect((await bag(server, kid, mapId)).items).toEqual(before);
    expect(await craftsOf(kid.id)).toEqual([]);
    expect(await book(server, kid)).not.toContain('recipe:jack-o-lantern-hearthfire');
  });

  it('refuses to place a sealed building with FORBIDDEN and spends nothing', async () => {
    const server = await start();
    const kid = await player();
    const mapId = await newMap(server, kid);
    await give(server, kid, mapId, { timber: 20, stone: 20 });
    const before = (await bag(server, kid, mapId)).items;
    const tile = await plainHomeTile(server, kid, mapId);

    const res = await place(server, kid, mapId, {
      buildingId: 'jack-o-lantern-hearthfire',
      ...tile,
      spot: 0,
    });
    expect(res.statusCode).toBe(403);
    expect(errorOf(res)).toEqual({ code: 'FORBIDDEN', message: SEALED_BUILDING });
    expect((await bag(server, kid, mapId)).items).toEqual(before);
    expect(await buildingsOf(kid.id)).toEqual([]);
  });

  it("opens the Jack-o'-Lantern pages on the first collect of what they were missing", async () => {
    const server = await start();
    const kid = await player();
    const mapId = await newMap(server, kid);
    await give(server, kid, mapId, { pumpkins: 3 });
    // A dev grant is a collect too: Pumpkins open Pumpkin Treats.
    expect(await book(server, kid)).toEqual([
      'recipe:heart-charm',
      'recipe:pumpkin-treats',
      ...ALWAYS_OPEN.slice(1),
    ]);

    // An Emberwood gather around Halloween brings Witch Dust along.
    const view = MapViewSchema.parse(
      (await call(server, 'GET', `/maps/${mapId}/view`, kid)).json(),
    );
    const ember = view.tiles.find(
      (t) => t.ownerUserId === kid.id && t.nodeResource === 'emberwood',
    )!;
    const started = await call(server, 'POST', `/maps/${mapId}/gathers`, kid, {
      q: ember.q,
      r: ember.r,
    });
    expect(started.statusCode).toBe(201);
    const { gather } = GatherResponseSchema.parse(started.json());
    expect(gather.items['witch-dust']).toBe(1);
    // Started is not collected: still sealed.
    expect(await book(server, kid)).not.toContain('recipe:jack-o-lantern-hearthfire');
    expect((await craft(server, kid, mapId, 'jack-o-lantern-hearthfire')).statusCode).toBe(403);

    clock.setTime(Date.parse(gather.readyAt));
    const collected = await call(
      server,
      'POST',
      `/maps/${mapId}/gathers/${gather.id}/collect`,
      kid,
    );
    expect(collected.statusCode).toBe(200);
    const opened = await book(server, kid);
    expect(opened).toContain('recipe:jack-o-lantern-hearthfire');
    // The building is made from the carved lantern, which nobody has yet.
    expect(opened).not.toContain('building:jack-o-lantern-hearthfire');

    await craftAndCollect(server, kid, mapId, 'jack-o-lantern-hearthfire');
    // Every page but the Training Grounds and the Crafting Factory (#294),
    // which need Stone this kid hasn't gathered, Thanksgiving's leaf charms (no leaves yet), the battle
    // potions (#214), which all need Treats, cooking Greens and freezing
    // Water (#238), and the fences (#203), which need Timber or Stone.
    const notYet = new Set([
      'building:training-grounds',
      'building:crafting-factory',
      'recipe:cook-treats',
      'recipe:freeze-water',
      'building:hedge',
      'building:moat',
      'building:stone-wall',
      'building:emberwood-palisade',
      'building:glimmer-rail',
      'building:lantern-fence',
      'building:bramble-hedge',
      'building:ice-wall',
      'recipe:leafy-heart-charms',
      'recipe:brave-brew',
      'recipe:cozy-cocoa',
      'recipe:hearty-soup',
    ]);
    expect(await book(server, kid)).toEqual(
      recipeBookPages()
        .map((p) => p.key)
        .filter((key) => !notYet.has(key)),
    );
    const res = await place(server, kid, mapId, {
      buildingId: 'jack-o-lantern-hearthfire',
      ...(await landTile(mapId, kid)),
      spot: 0,
    });
    expect(res.statusCode, res.body).toBe(201);
  });

  it('unlocks for the whole account, across every map', async () => {
    const server = await start();
    const kid = await player();
    const first = await newMap(server, kid);
    const second = await newMap(server, kid);
    await give(server, kid, first, { pumpkins: 1, emberwood: 1 });
    expect(await book(server, kid)).not.toContain('recipe:jack-o-lantern-hearthfire');
    await give(server, kid, first, { 'witch-dust': 1 });
    expect(await book(server, kid)).toContain('recipe:jack-o-lantern-hearthfire');

    // The page is open on the second map too: what stops the craft there is
    // the bag (CONFLICT), not the book (FORBIDDEN).
    await give(server, kid, second, { pumpkins: 3, emberwood: 2 });
    const res = await craft(server, kid, second, 'jack-o-lantern-hearthfire');
    expect(res.statusCode).toBe(409);
    expect(errorOf(res).message).toBe('You need 1 more Witch Dust first!');

    // Spending it all doesn't seal a page again.
    await give(server, kid, second, { 'witch-dust': 1 });
    await craftAndCollect(server, kid, second, 'jack-o-lantern-hearthfire');
    expect((await bag(server, kid, second)).items['witch-dust']).toBeUndefined();
    expect(await book(server, kid)).toContain('recipe:jack-o-lantern-hearthfire');

    // Another account's collects open nothing for this one.
    const friend = await player();
    expect(await book(server, friend)).toEqual(ALWAYS_OPEN);
  });
});
