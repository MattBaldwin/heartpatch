import {
  ApiErrorSchema,
  JoinMapResponseSchema,
  MapResponseSchema,
  parseGameEventPayload,
  RESEARCH_TREE,
  ResearchResponseSchema,
  ResearchViewSchema,
  type MapDetail,
  type PublicUser,
  type ResearchRules,
} from '@heartpatch/shared';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { afterAll, afterEach, beforeAll, describe, expect, inject, it } from 'vitest';
import { buildApp } from '../../app.js';
import { loadConfig } from '../../config.js';
import { createDbClient, withTransaction, type Database, type DbClient } from '../../db/client.js';
import { buildings, keepers, researchJobs, sessions, users } from '../../db/schema.js';
import { SESSION_COOKIE } from '../auth/limits.js';
import { newSessionToken } from '../auth/secrets.js';
import { createInventoryRepo } from '../inventory/repo.js';
import { grantItems } from '../inventory/service.js';
import { createResearchService } from './service.js';

/*
 * The Research Bench (#874 C3): starting a node pays up front and fixes
 * `ready_at` from the node's seconds and the bench's pace; one going per
 * player per patch; claiming before ready is refused; a ready job is
 * claimed lazily on `GET`, granting once however many reads race; `requires`
 * is enforced; nobody sees another player's research; Cozy has none.
 */

const url = inject('testDatabaseUrl');
const HEADERS = { 'x-requested-with': 'heartpatch' };
const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
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
const ZONE = 'America/Denver';
const START = '2026-12-01T18:00:00Z';
const PLENTY = { parts: 60, spark: 40 };
const node = (id: string) => RESEARCH_TREE.nodes.find((n) => n.id === id)!;

interface Player extends PublicUser {
  token: string;
}

describe.skipIf(!url)('the Research Bench (needs DATABASE_URL)', () => {
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
    const username = `tinker_${String((counter += 1))}`;
    const [user] = await db
      .insert(users)
      .values({ username, passwordHash: 'not-a-hash', birthYear: 2014, timeZone: ZONE })
      .returning({ id: users.id });
    await db.insert(keepers).values({ userId: user!.id, ...TEST_KEEPER });
    const { token, tokenHash } = newSessionToken();
    await db
      .insert(sessions)
      .values({ userId: user!.id, tokenHash, expiresAt: new Date(Date.now() + 30 * DAY_MS) });
    return { id: user!.id, username, token };
  }

  function call(
    server: FastifyInstance,
    method: 'GET' | 'POST',
    path: string,
    who: Player,
    payload?: object,
  ) {
    return server.inject({
      method,
      url: `/api/v1${path}`,
      headers: HEADERS,
      cookies: { [SESSION_COOKIE]: who.token },
      ...(payload ? { payload } : {}),
    });
  }

  const errorOf = (res: LightMyRequestResponse) => ApiErrorSchema.parse(res.json()).error;

  /**
   * A patch with `others` joined. Made Cozy (the generator has no Clockwork
   * layout until C1), then turned into a Clockwork Isle unless `cozy`.
   */
  async function patch(
    server: FastifyInstance,
    owner: Player,
    others: Player[] = [],
    cozy = false,
  ) {
    const res = await call(server, 'POST', '/maps', owner, { name: 'Bench Patch', timeZone: ZONE });
    expect(res.statusCode, res.body).toBe(201);
    const map: MapDetail = MapResponseSchema.parse(res.json()).map;
    for (const other of others) {
      const join = await call(server, 'POST', '/maps/join', other, {
        code: map.admin!.invite!.code,
      });
      const request = JoinMapResponseSchema.parse(join.json()).request;
      const ok = await call(
        server,
        'POST',
        `/maps/${map.id}/requests/${request.id}/approve`,
        owner,
      );
      expect(ok.statusCode).toBe(204);
    }
    if (!cozy)
      await db.execute(`update maps set patch_type = 'clockwork-isle' where id = '${map.id}'`);
    return map.id;
  }

  /** A Research Bench of `who`'s on a home tile, at `level`; its row id. */
  async function bench(mapId: string, who: Player, level = 1): Promise<string> {
    const home = await db.query.tiles.findFirst({
      where: (t, { and, eq, isNotNull }) =>
        and(eq(t.mapId, mapId), eq(t.ownerUserId, who.id), isNotNull(t.homeSlot)),
    });
    const [row] = await db
      .insert(buildings)
      .values({
        mapId,
        ownerUserId: who.id,
        tileId: home!.id,
        buildingId: 'research-bench',
        kind: 'research',
        level,
        spot: 1,
      })
      .returning({ id: buildings.id });
    return row!.id;
  }

  const give = (mapId: string, who: Player, items: Record<string, number>) =>
    withTransaction(db, (tx) => grantItems(tx, { mapId, userId: who.id }, items, 'dev-grant'));
  const bag = (mapId: string, who: Player) =>
    createInventoryRepo(db).list({ mapId, userId: who.id });
  const eventsOf = (mapId: string, type: string) =>
    db.query.gameEvents.findMany({
      where: (t, { and, eq }) => and(eq(t.mapId, mapId), eq(t.type, type)),
      orderBy: (t, { asc }) => [asc(t.seq)],
    });
  const begin = (
    server: FastifyInstance,
    who: Player,
    mapId: string,
    buildingId: string,
    nodeId: string,
  ) => call(server, 'POST', `/maps/${mapId}/research`, who, { buildingId, nodeId });
  const view = async (server: FastifyInstance, who: Player, mapId: string) => {
    const res = await call(server, 'GET', `/maps/${mapId}/research`, who);
    expect(res.statusCode, res.body).toBe(200);
    return ResearchViewSchema.parse(res.json());
  };

  it('has no research on a Cozy Patch', async () => {
    const server = await start();
    const kid = await player();
    const mapId = await patch(server, kid, [], true);
    const benchId = await bench(mapId, kid);
    const get = await call(server, 'GET', `/maps/${mapId}/research`, kid);
    expect(get.statusCode).toBe(404);
    expect(errorOf(get).message).toBe('There is no research on this patch.');
    expect((await begin(server, kid, mapId, benchId, 'sorting')).statusCode).toBe(404);
    expect((await call(server, 'POST', `/maps/${mapId}/research/claim`, kid)).statusCode).toBe(404);
  });

  it('has no research on a Wild Isle', async () => {
    const server = await start();
    const kid = await player();
    const mapId = await patch(server, kid, [], true);
    await db.execute(`update maps set patch_type = 'wild-isle' where id = '${mapId}'`);
    expect((await call(server, 'GET', `/maps/${mapId}/research`, kid)).statusCode).toBe(404);
  });

  it('starts a node, paying Parts and Spark Jars up front, ready after its seconds (bench L1)', async () => {
    const server = await start();
    const kid = await player();
    const mapId = await patch(server, kid);
    const benchId = await bench(mapId, kid, 1);
    await give(mapId, kid, PLENTY);
    expect(await view(server, kid, mapId)).toEqual({
      known: [],
      going: null,
      serverTime: clock.toISOString(),
    });

    const res = await begin(server, kid, mapId, benchId, 'sorting');
    expect(res.statusCode, res.body).toBe(201);
    const body = ResearchResponseSchema.parse(res.json());
    const sorting = node('sorting');
    expect(body.research.going).toEqual({
      nodeId: 'sorting',
      startedAt: new Date(START).toISOString(),
      readyAt: new Date(Date.parse(START) + sorting.seconds * 1000).toISOString(),
    });
    expect(body.items['parts']).toBe(PLENTY['parts'] - sorting.cost['parts']!);
    expect(body.items['spark']).toBe(PLENTY['spark'] - sorting.cost['spark']!);

    const [started] = await eventsOf(mapId, 'research.started');
    expect(parseGameEventPayload('research.started', started!.payload)).toMatchObject({
      userId: kid.id,
      buildingRowId: benchId,
      nodeId: 'sorting',
      cost: sorting.cost,
    });
  });

  it('works faster on a level-2 bench', async () => {
    const server = await start();
    const kid = await player();
    const mapId = await patch(server, kid);
    const benchId = await bench(mapId, kid, 2);
    await give(mapId, kid, PLENTY);
    const res = await begin(server, kid, mapId, benchId, 'bright-bulbs');
    expect(res.statusCode, res.body).toBe(201);
    // 3 h at 150 % pace: 2 h.
    expect(ResearchResponseSchema.parse(res.json()).research.going?.readyAt).toBe(
      new Date(Date.parse(START) + 2 * HOUR_MS).toISOString(),
    );
  });

  it('runs one node at a time per player per patch', async () => {
    const server = await start();
    const kid = await player();
    const mapId = await patch(server, kid);
    const benchId = await bench(mapId, kid);
    await give(mapId, kid, PLENTY);
    expect((await begin(server, kid, mapId, benchId, 'sorting')).statusCode).toBe(201);
    const second = await begin(server, kid, mapId, benchId, 'tidy-rails');
    expect(second.statusCode).toBe(409);
    expect(errorOf(second).message).toBe('Your Bench is busy tinkering! One thing at a time.');
    // Two taps at once: one wins, the other is busy, paid once.
    const other = await player();
    const map2 = await patch(server, other);
    const bench2 = await bench(map2, other);
    await give(map2, other, PLENTY);
    const both = await Promise.all([
      begin(server, other, map2, bench2, 'sorting'),
      begin(server, other, map2, bench2, 'tidy-rails'),
    ]);
    expect(both.map((r) => r.statusCode).sort()).toEqual([201, 409]);
    expect((await eventsOf(map2, 'research.started')).length).toBe(1);
  });

  it("refuses a bench that isn't mine, or isn't a bench", async () => {
    const server = await start();
    const kid = await player();
    const pal = await player();
    const mapId = await patch(server, kid, [pal]);
    const palBench = await bench(mapId, pal);
    await give(mapId, kid, PLENTY);
    const res = await begin(server, kid, mapId, palBench, 'sorting');
    expect(res.statusCode).toBe(404);
    expect(errorOf(res).message).toBe("That isn't one of your Research Benches.");
    const missing = await begin(
      server,
      kid,
      mapId,
      '00000000-0000-4000-8000-000000000000',
      'sorting',
    );
    expect(missing.statusCode).toBe(404);
    expect((await begin(server, kid, mapId, palBench, 'not-a-node')).statusCode).toBe(404);
  });

  it('refuses a node I can’t pay for, and takes nothing', async () => {
    const server = await start();
    const kid = await player();
    const mapId = await patch(server, kid);
    const benchId = await bench(mapId, kid);
    await give(mapId, kid, { parts: 2, spark: 40 });
    const res = await begin(server, kid, mapId, benchId, 'sorting');
    expect(res.statusCode).toBe(409);
    expect(await bag(mapId, kid)).toMatchObject({ parts: 2, spark: 40 });
    expect((await view(server, kid, mapId)).going).toBeNull();
  });

  it('refuses a claim before ready, then claims once ready', async () => {
    const server = await start();
    const kid = await player();
    const mapId = await patch(server, kid);
    const benchId = await bench(mapId, kid);
    await give(mapId, kid, PLENTY);
    const claim = () => call(server, 'POST', `/maps/${mapId}/research/claim`, kid);
    const nothing = await claim();
    expect(nothing.statusCode).toBe(409);
    expect(errorOf(nothing).message).toBe('Nothing is tinkering on your Bench.');
    await begin(server, kid, mapId, benchId, 'sorting');
    clock.setTime(Date.parse(START) + 2 * HOUR_MS - 1000);
    const early = await claim();
    expect(early.statusCode).toBe(409);
    expect(errorOf(early).message).toBe("It's still tinkering. Check back soon!");

    clock.setTime(Date.parse(START) + 2 * HOUR_MS);
    const res = await claim();
    expect(res.statusCode, res.body).toBe(200);
    const body = ResearchResponseSchema.parse(res.json());
    expect(body.research).toMatchObject({ known: ['sorting'], going: null });
    expect(body.items['blueprints']).toBe(node('sorting').grants['blueprints']);
    expect((await claim()).statusCode).toBe(409);
  });

  it('claims a ready job lazily on GET, granting Blueprints once across two reads', async () => {
    const server = await start();
    const kid = await player();
    const mapId = await patch(server, kid);
    const benchId = await bench(mapId, kid);
    await give(mapId, kid, PLENTY);
    await begin(server, kid, mapId, benchId, 'sorting');
    expect((await view(server, kid, mapId)).known).toEqual([]);

    clock.setTime(Date.parse(START) + 3 * HOUR_MS);
    const [a, b] = await Promise.all([view(server, kid, mapId), view(server, kid, mapId)]);
    for (const v of [a, b]) expect(v).toMatchObject({ known: ['sorting'], going: null });
    expect(await view(server, kid, mapId)).toMatchObject({ known: ['sorting'], going: null });
    expect((await bag(mapId, kid))['blueprints']).toBe(node('sorting').grants['blueprints']);
    const done = await eventsOf(mapId, 'research.done');
    expect(done.length).toBe(1);
    expect(parseGameEventPayload('research.done', done[0]!.payload)).toMatchObject({
      userId: kid.id,
      nodeId: 'sorting',
      grants: node('sorting').grants,
    });
    const jobs = await db.query.researchJobs.findMany({
      where: (t, { eq }) => eq(t.mapId, mapId),
    });
    expect(jobs.map((j) => j.claimedAt?.toISOString())).toEqual([
      new Date(Date.parse(START) + 3 * HOUR_MS).toISOString(),
    ]);
  });

  it('two services claiming the same ready job in parallel grant once', async () => {
    const server = await start();
    const kid = await player();
    const mapId = await patch(server, kid);
    const benchId = await bench(mapId, kid);
    await give(mapId, kid, PLENTY);
    await begin(server, kid, mapId, benchId, 'tidy-rails');
    const later = () => new Date(Date.parse(START) + 5 * HOUR_MS);
    const services = [1, 2, 3].map(() => createResearchService({ db, clock: later }));
    await Promise.all(services.map((s) => s.view(kid, mapId)));
    expect((await bag(mapId, kid))['blueprints']).toBe(node('tidy-rails').grants['blueprints']);
    expect((await eventsOf(mapId, 'research.done')).length).toBe(1);
  });

  it('claims a ready job when the next one starts, and refuses a node already known', async () => {
    const server = await start();
    const kid = await player();
    const mapId = await patch(server, kid);
    const benchId = await bench(mapId, kid);
    await give(mapId, kid, PLENTY);
    await begin(server, kid, mapId, benchId, 'sorting');
    clock.setTime(Date.parse(START) + 4 * HOUR_MS);
    // Starting again on a ready bench claims Sorting first: it's known now.
    const again = await begin(server, kid, mapId, benchId, 'sorting');
    expect(again.statusCode).toBe(409);
    expect(errorOf(again).message).toBe('You already know that one! ✨');
    // …but the refusal rolled the claim back too; the next read claims it.
    expect((await bag(mapId, kid))['blueprints'] ?? 0).toBe(0);
    const next = await begin(server, kid, mapId, benchId, 'wrapping');
    expect(next.statusCode, next.body).toBe(201);
    const body = ResearchResponseSchema.parse(next.json());
    expect(body.research.known).toEqual(['sorting']);
    expect(body.research.going?.nodeId).toBe('wrapping');
    expect(body.items['blueprints']).toBe(node('sorting').grants['blueprints']);
    expect((await eventsOf(mapId, 'research.done')).length).toBe(1);
  });

  it('needs every node a node requires known first', async () => {
    const server = await start();
    const kid = await player();
    const mapId = await patch(server, kid);
    const benchId = await bench(mapId, kid);
    await give(mapId, kid, PLENTY);
    // Tier 1 needs nothing; a tier-2 node (Wave 2) is checked with a stand-in tree below.
    expect(RESEARCH_TREE.nodes.every((n) => n.tier > 1 || n.requires.length === 0)).toBe(true);
    const tree: ResearchRules = {
      ...RESEARCH_TREE,
      nodes: [
        ...RESEARCH_TREE.nodes,
        {
          id: 'pressing',
          tier: 2,
          name: 'Pressing',
          description: 'Squish Greens into Pies.',
          cost: { parts: 2 },
          seconds: 600,
          requires: ['sorting'],
          grants: { blueprints: 1 },
        },
      ],
    };
    {
      const service = createResearchService({ db, clock: () => clock, tree });
      await expect(
        service.start(kid, mapId, { buildingId: benchId, nodeId: 'pressing' }),
      ).rejects.toMatchObject({ code: 'CONFLICT', message: 'Research Sorting first!' });
      await db.insert(researchJobs).values({
        mapId,
        userId: kid.id,
        buildingId: benchId,
        nodeId: 'sorting',
        startedAt: new Date(Date.parse(START) - 3 * HOUR_MS),
        readyAt: new Date(Date.parse(START) - HOUR_MS),
      });
      const ok = await service.start(kid, mapId, { buildingId: benchId, nodeId: 'pressing' });
      expect(ok.research).toMatchObject({ known: ['sorting'], going: { nodeId: 'pressing' } });
    }
  });

  it("never shows another player's known nodes or going job", async () => {
    const server = await start();
    const kid = await player();
    const pal = await player();
    const mapId = await patch(server, kid, [pal]);
    const kidBench = await bench(mapId, kid);
    await give(mapId, kid, PLENTY);
    await begin(server, kid, mapId, kidBench, 'sorting');
    clock.setTime(Date.parse(START) + 2 * HOUR_MS);
    expect((await view(server, kid, mapId)).known).toEqual(['sorting']);
    const palBench = await bench(mapId, pal);
    await give(mapId, pal, PLENTY);
    await begin(server, kid, mapId, kidBench, 'tidy-rails');
    expect(await view(server, pal, mapId)).toEqual({
      known: [],
      going: null,
      serverTime: clock.toISOString(),
    });
    // Pal can research Sorting for themselves.
    expect((await begin(server, pal, mapId, palBench, 'sorting')).statusCode).toBe(201);
    expect((await view(server, kid, mapId)).going?.nodeId).toBe('tidy-rails');
  });

  it('keeps a job going when its bench comes down', async () => {
    const server = await start();
    const kid = await player();
    const mapId = await patch(server, kid);
    const benchId = await bench(mapId, kid);
    await give(mapId, kid, PLENTY);
    await begin(server, kid, mapId, benchId, 'sorting');
    await db.execute(`delete from buildings where id = '${benchId}'`);
    clock.setTime(Date.parse(START) + 2 * HOUR_MS);
    expect((await view(server, kid, mapId)).known).toEqual(['sorting']);
  });
});
