import { randomUUID } from 'node:crypto';
import { LorebookResponseSchema, TutorialResponseSchema } from '@heartpatch/shared';
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

  async function start(): Promise<FastifyInstance> {
    const config = loadConfig({ NODE_ENV: 'test', DATABASE_URL: url! });
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

  const call = (server: FastifyInstance, method: 'GET' | 'POST', path: string, who: Player) =>
    server.inject({
      method,
      url: `/api/v1${path}`,
      headers: HEADERS,
      cookies: { [SESSION_COOKIE]: who.token },
    });

  const lorebook = async (server: FastifyInstance, who: Player) => {
    const res = await call(server, 'GET', '/lore', who);
    expect(res.statusCode).toBe(200);
    return LorebookResponseSchema.parse(res.json()).pages;
  };

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
    expect(res.json()).toEqual({ pages: [] });
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
    expect(JSON.parse(theirs)).toEqual({
      pages: [expect.objectContaining({ id: 'two-watchful-dogs' })],
    });
    for (const secret of ['trigger', 'eventType', 'squishy.rescued', 'finder', 'where']) {
      expect(theirs).not.toContain(secret);
    }
  });
});
