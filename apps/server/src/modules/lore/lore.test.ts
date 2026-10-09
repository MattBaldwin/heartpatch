import { randomUUID } from 'node:crypto';
import {
  LorebookResponseSchema,
  TutorialResponseSchema,
  type LorebookResponse,
} from '@heartpatch/shared';
import { LORE_PAGES } from '@heartpatch/shared/server';
import type { FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeAll, describe, expect, inject, it } from 'vitest';
import { buildApp } from '../../app.js';
import { loadConfig } from '../../config.js';
import { createDbClient, type Database, type DbClient } from '../../db/client.js';
import { appendGameEvent, type NewGameEvent } from '../../db/game-events.js';
import { keepers, loreFound, maps, sessions, users } from '../../db/schema.js';
import { runConsumer } from '../../jobs/consumers.js';
import { SESSION_COOKIE } from '../auth/limits.js';
import { newSessionToken } from '../auth/secrets.js';
import { createLoreConsumer } from './consumer.js';
import { createLoreRepo } from './repo.js';

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

interface Player {
  id: string;
  token: string;
}

describe.skipIf(!url)('the Lorebook (needs DATABASE_URL)', () => {
  let client: DbClient;
  let db: Database;
  let app: FastifyInstance | undefined;
  const clock = new Date('2026-10-03T12:00:00Z');
  let counter = 0;
  const consumer = createLoreConsumer({ clock: () => clock });

  beforeAll(() => {
    client = createDbClient(url!, { max: 10 });
    db = client.db;
  });
  afterAll(() => client.close());
  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  async function start(devGrants = false): Promise<FastifyInstance> {
    const config = loadConfig({
      NODE_ENV: 'test',
      DATABASE_URL: url!,
      HP_DEV_SQUISHY_GRANTS: devGrants ? 'true' : 'false',
    });
    app = await buildApp({ config, db, clock: () => clock, logger: false });
    return app;
  }

  async function player(): Promise<Player> {
    const username = `lorekid_${String((counter += 1))}`;
    const [user] = await db
      .insert(users)
      .values({ username, passwordHash: 'not-a-hash', birthYear: 2014, timeZone: 'UTC' })
      .returning({ id: users.id });
    await db.insert(keepers).values({ userId: user!.id, ...TEST_KEEPER });
    const { token, tokenHash } = newSessionToken();
    await db
      .insert(sessions)
      .values({ userId: user!.id, tokenHash, expiresAt: new Date(Date.now() + 30 * DAY_MS) });
    return { id: user!.id, token };
  }

  const call = (
    server: FastifyInstance,
    method: 'GET' | 'POST',
    path: string,
    who: Player,
    body?: object,
  ) =>
    server.inject({
      method,
      url: `/api/v1${path}`,
      headers: HEADERS,
      cookies: { [SESSION_COOKIE]: who.token },
      ...(body ? { payload: body } : {}),
    });

  const book = async (server: FastifyInstance, who: Player): Promise<LorebookResponse> => {
    const res = await call(server, 'GET', '/lore', who);
    expect(res.statusCode).toBe(200);
    return LorebookResponseSchema.parse(res.json());
  };
  const lorebook = async (server: FastifyInstance, who: Player) => (await book(server, who)).pages;

  const append = (event: NewGameEvent) => db.transaction((tx) => appendGameEvent(tx, event));

  /** A bare patch row: the consumer only reads the map's kind. */
  async function patchRow(): Promise<string> {
    const [map] = await db
      .insert(maps)
      .values({ kind: 'multiplayer', name: 'Lore Patch', timeZone: 'UTC', maxPlayers: 4 })
      .returning({ id: maps.id });
    return map!.id;
  }

  it("finds the Glade's page on the Glade's night, once, for its player", async () => {
    const server = await start();
    const kid = await player();
    const started = await call(server, 'POST', '/tutorial/start', kid);
    const glade = TutorialResponseSchema.parse(started.json()).tutorial.mapId!;
    expect(await lorebook(server, kid)).toEqual([]);

    for (const night of ['2026-10-03', '2026-10-04']) {
      await append({
        mapId: glade,
        type: 'hollow.nightfall',
        actorUserId: null,
        payload: { night, taken: [] },
      });
    }
    await runConsumer(db, consumer, glade);
    const page = LORE_PAGES.find((p) => p.id === 'paw-prints-by-the-fire')!;
    expect(await lorebook(server, kid)).toEqual([
      { id: page.id, title: page.title, text: page.text, foundAt: clock.toISOString() },
    ]);
  });

  it('finds patch pages by their secret conditions, and only those', async () => {
    const server = await start();
    const kid = await player();
    const mapId = await patchRow();
    const captured = (terrain: string): NewGameEvent => ({
      mapId,
      type: 'tile.captured',
      actorUserId: kid.id,
      payload: {
        attackId: randomUUID(),
        battleId: randomUUID(),
        kind: 'tile',
        userId: kid.id,
        fromUserId: null,
        q: 1,
        r: 0,
        terrain,
        rewardPercent: 100,
        returnedSquishyIds: [],
      },
    });
    await append(captured('meadow'));
    // A night on a patch isn't the Glade's page.
    await append({
      mapId,
      type: 'hollow.nightfall',
      actorUserId: null,
      payload: { night: '2026-10-03', taken: [] },
    });
    await runConsumer(db, consumer, mapId);
    expect(await lorebook(server, kid)).toEqual([]);

    await append(captured('old-forest'));
    await append({
      mapId,
      type: 'squishy.rescued',
      actorUserId: kid.id,
      payload: { userId: kid.id, squishyId: randomUUID(), battleId: randomUUID(), heartdust: 0 },
    });
    await runConsumer(db, consumer, mapId);
    expect((await lorebook(server, kid)).map((p) => p.id)).toEqual([
      'the-tidied-clearing',
      'two-watchful-dogs',
    ]);
  });

  it('sends found pages only, and never how to find one', async () => {
    const server = await start();
    const kid = await player();
    const res = await call(server, 'GET', '/lore', kid);
    expect(res.json()).toMatchObject({ pages: [], total: LORE_PAGES.length });
    const other = await player();
    await db.insert(loreFound).values({
      userId: other.id,
      pageId: 'two-watchful-dogs',
      mapId: null,
      foundAt: clock,
    });
    // Someone else's find isn't mine, and a found page has no trigger in it.
    expect(await lorebook(server, kid)).toEqual([]);
    const theirs = (await call(server, 'GET', '/lore', other)).body;
    expect(JSON.parse(theirs)).toMatchObject({
      pages: [expect.objectContaining({ id: 'two-watchful-dogs' })],
    });
    for (const secret of ['"trigger"', '"eventType"', 'squishy.rescued', '"finder"', '"where"']) {
      expect(theirs).not.toContain(secret);
    }
  });

  it('sends the whole book: chapters, every slot in order, words only for found pages (#307)', async () => {
    const server = await start();
    const kid = await player();
    await db.insert(loreFound).values({
      userId: kid.id,
      pageId: 'under-a-mossy-rock',
      mapId: null,
      foundAt: clock,
    });
    const res = await call(server, 'GET', '/lore', kid);
    const body = LorebookResponseSchema.parse(res.json());
    expect(body.chapters.map((c) => c.id)).toEqual([
      'junipers-gap',
      'wild-lands',
      'hollow-man',
      'little-guardians',
    ]);
    expect(body.total).toBe(12);
    expect(body.slots.map((s) => `${s.chapter}#${String(s.order)}`)).toEqual(
      body.chapters.flatMap((c) => [1, 2, 3].map((n) => `${c.id}#${String(n)}`)),
    );
    const mossy = LORE_PAGES.find((p) => p.id === 'under-a-mossy-rock')!;
    expect(body.slots.find((s) => s.id === mossy.id)).toEqual({
      id: mossy.id,
      chapter: 'wild-lands',
      order: 2,
      hint: mossy.hint,
      found: true,
      title: mossy.title,
      text: mossy.text,
      foundAt: clock.toISOString(),
      readAt: null,
    });
    // A page still to find is its place and hint, exactly: nothing more.
    const raw = res.json<{ slots: Record<string, unknown>[] }>();
    for (const slot of raw.slots.filter((s) => s['found'] === false)) {
      expect(Object.keys(slot).sort()).toEqual(['chapter', 'found', 'hint', 'id', 'order']);
    }
    // No unfound page's title, words, id (its title as a slug) or trigger
    // reaches the client: its slot goes by its place.
    expect(body.slots.find((s) => s.chapter === 'wild-lands' && s.order === 3)).toMatchObject({
      id: 'wild-lands-3',
      found: false,
    });
    for (const page of LORE_PAGES.filter((p) => p.id !== mossy.id)) {
      expect(res.body).not.toContain(page.title);
      expect(res.body).not.toContain(page.id);
      expect(res.body).not.toContain(page.text.slice(0, 40));
      expect(res.body).not.toContain(page.trigger.eventType);
    }
    for (const secret of ['"trigger"', '"eventType"', '"finder"', '"where"', '"lorePage"']) {
      expect(res.body).not.toContain(secret);
    }
  });

  it('marks found pages read, once, and only my own (#307)', async () => {
    const server = await start();
    const kid = await player();
    const other = await player();
    for (const who of [kid, other]) {
      await db.insert(loreFound).values({
        userId: who.id,
        pageId: 'two-watchful-dogs',
        mapId: null,
        foundAt: clock,
      });
    }
    const unread = (b: LorebookResponse) =>
      b.slots.filter((s) => s.found && s.readAt === null).map((s) => s.id);
    expect(unread(await book(server, kid))).toEqual(['two-watchful-dogs']);

    // A page I haven't found can't be read; one I have is read now.
    const res = await call(server, 'POST', '/lore/read', kid, {
      ids: ['two-watchful-dogs', 'grey-footprints'],
    });
    expect(res.statusCode).toBe(200);
    const after = LorebookResponseSchema.parse(res.json());
    expect(unread(after)).toEqual([]);
    expect(after.slots.find((s) => s.id === 'hollow-man-3')).toMatchObject({ found: false });
    expect(after.slots.find((s) => s.id === 'two-watchful-dogs')).toMatchObject({
      readAt: clock.toISOString(),
    });
    // Someone else's copy is still new.
    expect(unread(await book(server, other))).toEqual(['two-watchful-dogs']);

    // Reading again keeps the first time.
    const later = new Date(clock.getTime() + DAY_MS);
    await createLoreRepo(db).markRead(kid.id, ['two-watchful-dogs'], later);
    expect((await book(server, kid)).slots.find((s) => s.id === 'two-watchful-dogs')).toMatchObject(
      { readAt: clock.toISOString() },
    );

    // A bad body is refused.
    expect((await call(server, 'POST', '/lore/read', kid, { ids: [] })).statusCode).toBe(400);
    expect((await call(server, 'POST', '/lore/read', kid, { ids: ['Not An Id'] })).statusCode).toBe(
      400,
    );
  });

  it("finds the Hollow's page for the squishy's owner (a nightfall job's event has no actor)", async () => {
    const server = await start();
    const kid = await player();
    const mapId = await patchRow();
    await append({
      mapId,
      type: 'squishy.hollowed',
      actorUserId: null,
      payload: { userId: kid.id, squishyId: randomUUID(), night: '2026-10-03' },
    });
    await runConsumer(db, consumer, mapId);
    expect((await lorebook(server, kid)).map((p) => p.id)).toEqual(['grey-footprints']);
  });

  it('finds a page on demand in dev builds only', async () => {
    const kid = await player();
    const off = await start();
    const missing = await call(off, 'POST', '/lore/dev/find', kid, { pageId: 'grey-footprints' });
    expect(missing.statusCode).toBe(404);
    await off.close();
    app = undefined;

    const dev = await start(true);
    const res = await call(dev, 'POST', '/lore/dev/find', kid, { pageId: 'grey-footprints' });
    expect(res.statusCode).toBe(200);
    expect(LorebookResponseSchema.parse(res.json()).pages.map((p) => p.id)).toEqual([
      'grey-footprints',
    ]);
    const unknown = await call(dev, 'POST', '/lore/dev/find', kid, { pageId: 'no-such-page' });
    expect(unknown.statusCode).toBe(404);
  });
});
