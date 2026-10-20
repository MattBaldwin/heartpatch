import { randomUUID } from 'node:crypto';
import {
  COMMUNITY_RULES,
  JoinMapResponseSchema,
  MAP_GEN,
  MapResponseSchema,
  parseGameEventPayload,
  restoredNameIdeas,
  villageRing,
  type MapDetail,
  type PublicUser,
} from '@heartpatch/shared';
import type { FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeAll, describe, expect, inject, it } from 'vitest';
import { buildApp } from '../../app.js';
import { loadConfig } from '../../config.js';
import { createDbClient, withTransaction, type Database, type DbClient } from '../../db/client.js';
import { appendGameEvent } from '../../db/game-events.js';
import { keepers, sessions, users } from '../../db/schema.js';
import { runConsumer } from '../../jobs/consumers.js';
import { SESSION_COOKIE } from '../auth/limits.js';
import { newSessionToken } from '../auth/secrets.js';
import { createCommunitySettleConsumer } from './settle-consumer.js';

/*
 * Contested tiles during restoration (#306 PR 4): a restored village tile is
 * ordinary land, so a village's last tile can be won in a battle. The
 * community-settle consumer then wins the village the way the restore path
 * does (`winVillage`), plants a gap in a won ring, re-wins a village whose
 * winner left, and does nothing twice. The battles themselves are the
 * territory tests'; here a capture is its `tile.captured` event.
 */

const url = inject('testDatabaseUrl');
const HEADERS = { 'x-requested-with': 'heartpatch' };
const DAY_MS = 24 * 60 * 60 * 1000;
const ZONE = 'America/Denver';
// Noon in Denver: villages are open by day.
const NOON = '2026-10-02T18:00:00Z';
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

interface Player extends PublicUser {
  token: string;
}

interface Tile {
  id: string;
  q: number;
  r: number;
  terrain: string;
  ownerUserId: string | null;
  homeSlot: number | null;
  communityId: string | null;
}

describe.skipIf(!url)('contested village tiles (#306 PR 4, needs DATABASE_URL)', () => {
  let client: DbClient;
  let db: Database;
  let app: FastifyInstance | undefined;
  const clock = new Date(NOON);
  let counter = 0;

  beforeAll(() => {
    client = createDbClient(url!, { max: 10 });
    db = client.db;
  });
  afterAll(() => client.close());
  afterEach(async () => {
    await app?.close();
    app = undefined;
    clock.setTime(Date.parse(NOON));
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
    const username = `contester_${String((counter += 1))}`;
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
    method: 'POST',
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

  async function patch(server: FastifyInstance, owner: Player, others: Player[] = []) {
    const res = await call(server, 'POST', '/maps', owner, {
      name: 'Contest Patch',
      timeZone: ZONE,
    });
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
    return map.id;
  }

  const tilesOf = async (mapId: string): Promise<Tile[]> =>
    db.query.tiles.findMany({ where: (t, { eq }) => eq(t.mapId, mapId) });
  const eventsOf = async (mapId: string, type: string) =>
    (
      await db.query.gameEvents.findMany({
        where: (t, { eq }) => eq(t.mapId, mapId),
        orderBy: (t, { asc }) => [asc(t.seq)],
      })
    ).filter((e) => e.type === type);
  const slotOf = async (mapId: string, who: Player) =>
    (await db.query.mapMembers.findFirst({
      where: (m, { and, eq }) => and(eq(m.mapId, mapId), eq(m.userId, who.id)),
    }))!.homeSlot!;
  const communityOf = (id: string) =>
    db.query.communities.findFirst({ where: (t, { eq }) => eq(t.id, id) });
  const setOwner = (tileIds: readonly string[], userId: string | null) =>
    db.execute(
      `update tiles set owner_user_id = ${userId === null ? 'null' : `'${userId}'`}
       where id in (${tileIds.map((id) => `'${id}'`).join(', ')})`,
    );

  /** A grey village next to `who`'s land (the explore dev route), every tile of it restored. */
  async function restoredVillage(server: FastifyInstance, who: Player, mapId: string) {
    const res = await call(server, 'POST', `/maps/${mapId}/dev/hollowed-reach`, who);
    expect(res.statusCode, res.body).toBe(201);
    const at = res.json<{ q: number; r: number }>();
    const square = (await tilesOf(mapId)).find((t) => t.q === at.q && t.r === at.r)!;
    const communityId = square.communityId!;
    await db.execute(
      `update community_tiles set pieces_done = pieces_needed, restored_at = now()
       where community_id = '${communityId}'`,
    );
    const rows = await db.query.communityTiles.findMany({
      where: (t, { eq }) => eq(t.communityId, communityId),
    });
    const ids = new Set(rows.map((r) => r.tileId));
    const village = (await tilesOf(mapId)).filter((t) => ids.has(t.id));
    return { communityId, square, village };
  }

  /** `who` won `tile` in a battle: it's theirs, and its `tile.captured` is on the stream. */
  async function captured(mapId: string, who: Player, tile: Tile, from: string | null) {
    await setOwner([tile.id], who.id);
    await withTransaction(db, (tx) =>
      appendGameEvent(tx, {
        mapId,
        type: 'tile.captured',
        actorUserId: who.id,
        payload: {
          attackId: randomUUID(),
          battleId: randomUUID(),
          kind: from === null ? 'tile' : 'rival-tile',
          userId: who.id,
          fromUserId: from,
          q: tile.q,
          r: tile.r,
          terrain: tile.terrain,
          rewardPercent: 100,
          returnedSquishyIds: [],
        },
      }),
    );
  }

  const settle = (mapId: string) =>
    runConsumer(db, createCommunitySettleConsumer({ clock: () => clock }), mapId);

  it('wins the village and plants its ring when its last tile is won in a battle', async () => {
    const server = await start();
    const me = await player();
    const rival = await player();
    const mapId = await patch(server, me, [rival]);
    const { communityId, square, village } = await restoredVillage(server, me, mapId);
    // Every tile restored and mine, but one the rival restored and holds.
    const [theirs, ...rest] = village.filter((t) => t.id !== square.id);
    await setOwner([square.id, ...rest.map((t) => t.id)], me.id);
    await setOwner([theirs!.id], rival.id);
    await settle(mapId);
    expect((await communityOf(communityId))!.ownerUserId).toBeNull();

    await captured(mapId, me, theirs!, rival.id);
    await settle(mapId);
    const won = (await communityOf(communityId))!;
    const [name] = restoredNameIdeas(won.name, COMMUNITY_RULES, MAP_GEN.communities);
    expect(won).toMatchObject({ ownerUserId: me.id, restoredName: name });
    const slot = await slotOf(mapId, me);
    const tiles = await tilesOf(mapId);
    for (const t of village) {
      expect(tiles.find((x) => x.id === t.id)).toMatchObject({
        ownerUserId: me.id,
        homeSlot: slot,
        communityId,
      });
    }
    const [restored, ...more] = await eventsOf(mapId, 'community.restored');
    expect(more).toEqual([]);
    const payload = parseGameEventPayload('community.restored', restored!.payload);
    expect(payload).toMatchObject({ communityId, userId: me.id, name });
    expect(payload.square).toEqual({ q: square.q, r: square.r });
    for (const t of village) expect(payload.ring).toContainEqual({ q: t.q, r: t.r });

    // Replayed from the start: everything is won already, nothing is written twice.
    await db.execute(
      `update event_consumers set last_seq = 0
       where consumer = 'community-settle' and map_id = '${mapId}'`,
    );
    await settle(mapId);
    expect(await eventsOf(mapId, 'community.restored')).toHaveLength(1);
    expect(await tilesOf(mapId)).toEqual(tiles);
  });

  it('wins nothing while a tile is still grey or someone else’s', async () => {
    const server = await start();
    const me = await player();
    const rival = await player();
    const mapId = await patch(server, me, [rival]);
    const { communityId, square, village } = await restoredVillage(server, me, mapId);
    const [grey, theirs, ...rest] = village.filter((t) => t.id !== square.id);
    await db.execute(
      `update community_tiles set restored_at = null, pieces_done = 0 where tile_id = '${grey!.id}'`,
    );
    await setOwner([square.id, ...rest.map((t) => t.id)], me.id);
    await setOwner([theirs!.id], rival.id);
    // My capture of another tile: the grey one and the rival's still stand in the way.
    await captured(mapId, me, rest[0] ?? square, rival.id);
    await settle(mapId);
    expect((await communityOf(communityId))!.ownerUserId).toBeNull();
    expect(await eventsOf(mapId, 'community.restored')).toEqual([]);
  });

  it('plants a gap in a won ring when its winner wins it', async () => {
    const server = await start();
    const me = await player();
    const rival = await player();
    const mapId = await patch(server, me, [rival]);
    const { communityId, square, village } = await restoredVillage(server, me, mapId);
    const villageIds = new Set(village.map((t) => t.id));
    // A grounds tile of the ring the rival holds at the win: it stays theirs, a gap.
    const all = await tilesOf(mapId);
    const gap = villageRing(square)
      .map((h) => all.find((t) => t.q === h.q && t.r === h.r))
      .find(
        (t): t is Tile =>
          t !== undefined &&
          !villageIds.has(t.id) &&
          t.homeSlot === null &&
          t.terrain !== 'trading-post',
      );
    // A village that fills its ring has no grounds: nothing to plant there.
    if (!gap) return;
    await setOwner([gap.id], rival.id);
    const [last, ...rest] = village;
    await setOwner(
      rest.map((t) => t.id),
      me.id,
    );
    await captured(mapId, me, last!, null);
    await settle(mapId);
    expect((await communityOf(communityId))!.ownerUserId).toBe(me.id);
    expect((await tilesOf(mapId)).find((t) => t.id === gap.id)).toMatchObject({
      ownerUserId: rival.id,
      homeSlot: null,
    });

    await captured(mapId, me, gap, rival.id);
    await settle(mapId);
    expect((await tilesOf(mapId)).find((t) => t.id === gap.id)).toMatchObject({
      ownerUserId: me.id,
      homeSlot: await slotOf(mapId, me),
      communityId,
    });
    const events = await eventsOf(mapId, 'community.restored');
    expect(events).toHaveLength(2);
    expect(parseGameEventPayload('community.restored', events[1]!.payload).ring).toEqual([
      { q: gap.q, r: gap.r },
    ]);
  });

  it('lets a village whose winner left be won again by the kid who holds every tile', async () => {
    const server = await start();
    const owner = await player();
    const me = await player();
    const rival = await player();
    const mapId = await patch(server, owner, [me, rival]);
    const { communityId, village } = await restoredVillage(server, me, mapId);
    const [last, ...rest] = village;
    await setOwner(
      rest.map((t) => t.id),
      me.id,
    );
    await captured(mapId, me, last!, null);
    await settle(mapId);
    expect((await communityOf(communityId))!.ownerUserId).toBe(me.id);

    const left = await call(server, 'POST', `/maps/${mapId}/leave`, me);
    expect(left.statusCode, left.body).toBe(204);
    expect((await communityOf(communityId))!.ownerUserId).toBeNull();

    // The rival claims the released tiles one by one; the last one wins it.
    await setOwner(
      rest.map((t) => t.id),
      rival.id,
    );
    await captured(mapId, rival, last!, null);
    await settle(mapId);
    expect((await communityOf(communityId))!.ownerUserId).toBe(rival.id);
    const slot = await slotOf(mapId, rival);
    for (const t of village) {
      expect((await tilesOf(mapId)).find((x) => x.id === t.id)).toMatchObject({
        ownerUserId: rival.id,
        homeSlot: slot,
      });
    }
  });
});
