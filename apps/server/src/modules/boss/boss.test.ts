import {
  BattleResponseSchema,
  BossVisitResponseSchema,
  GAME_DATA,
  JoinMapResponseSchema,
  MapResponseSchema,
  type PlayerBattle,
  type PublicUser,
} from '@heartpatch/shared';
import {
  BOSS_EVENTS,
  bossVisitFor,
  bossWeekOf,
  type BossEventRules,
} from '@heartpatch/shared/server';
import type { FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeAll, describe, expect, inject, it } from 'vitest';
import { buildApp } from '../../app.js';
import { loadConfig } from '../../config.js';
import { createDbClient, type Database, type DbClient } from '../../db/client.js';
import { keepers, sessions, squishies, users } from '../../db/schema.js';
import { instantOfLocalDate, localDate } from '../../lib/time.js';
import { PUBLIC_VIEWS, publicViewFor } from '../../ws/public-views.js';
import { SESSION_COOKIE } from '../auth/limits.js';
import { newSessionToken } from '../auth/secrets.js';

const url = inject('testDatabaseUrl');
const errorOf = (res: { json: () => unknown }) =>
  (res.json() as { error: { message: string } }).error.message;
const HEADERS = { 'x-requested-with': 'heartpatch' };
const DAY_MS = 24 * 60 * 60 * 1000;
const ZONE = 'America/Denver';
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
// Noon in Denver on Monday 16 Nov (MST, UTC−7): the start of a boss week.
const START = '2026-11-16T19:00:00Z';
const TEAM = GAME_DATA.species[0]!;
// A stand-in boss (#190 plan §8): an existing species, in tests only.
const BOSS = GAME_DATA.species.find((s) => s.id !== TEAM.id)!;
const RULES: BossEventRules = {
  ...BOSS_EVENTS,
  bag: [{ speciesId: BOSS.id, terrains: [GAME_DATA.terrains[0]!.id] }],
};

interface Player extends PublicUser {
  token: string;
}

describe.skipIf(!url)('mini-boss visits and fights (#190b, needs DATABASE_URL)', () => {
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

  async function start(rules: BossEventRules = RULES) {
    const config = loadConfig({ NODE_ENV: 'test', DATABASE_URL: url! });
    let sweep: ((only?: readonly string[]) => Promise<number>) | undefined;
    app = await buildApp({
      config,
      db,
      clock: () => clock,
      logger: false,
      bossRules: rules,
      onBoss: (service) => {
        sweep = service.sweep;
      },
    });
    return { server: app, sweep: sweep! };
  }

  async function player(): Promise<Player> {
    const username = `miniboss_${String((counter += 1))}`;
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

  async function patch(server: FastifyInstance, owner: Player, others: Player[] = []) {
    const res = await call(server, 'POST', '/maps', owner, { name: 'Boss Patch', timeZone: ZONE });
    expect(res.statusCode, res.body).toBe(201);
    const map = MapResponseSchema.parse(res.json()).map;
    for (const other of others) {
      const join = await call(server, 'POST', '/maps/join', other, {
        code: map.admin!.invite!.code,
      });
      expect(join.statusCode).toBe(201);
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

  /** A Partner at `partner` and, by default, two strong friends: the team. */
  async function grow(mapId: string, who: PublicUser, partner: number, friends = [100, 100]) {
    const rows = await db
      .insert(squishies)
      .values(
        [partner, ...friends].map((level) => ({
          mapId,
          ownerUserId: who.id,
          speciesId: TEAM.id,
          element: TEAM.element,
          feeling: TEAM.feeling,
          level,
        })),
      )
      .returning({ id: squishies.id });
    await db.execute(
      `update map_members set starter_squishy_id = '${rows[0]!.id}' where user_id = '${who.id}'`,
    );
  }

  /** Moves the clock a minute past this week's visit opening on the patch. */
  async function toVisit(mapId: string) {
    const map = await db.query.maps.findFirst({ where: (t, { eq }) => eq(t.id, mapId) });
    const week = bossWeekOf(localDate(clock, ZONE));
    const plan = bossVisitFor(map!.seed!, week, map!.longNightWeekday ?? null, RULES)!;
    const opensAt = instantOfLocalDate(
      { date: plan.opensOn, minute: RULES.opensAtHour * 60 },
      ZONE,
    );
    clock.setTime(opensAt.getTime() + 60_000);
    return { week, opensAt };
  }

  const visit = async (server: FastifyInstance, who: Player, mapId: string) => {
    const res = await call(server, 'GET', `/maps/${mapId}/boss`, who);
    expect(res.statusCode, res.body).toBe(200);
    return BossVisitResponseSchema.parse(res.json()).boss;
  };
  const fight = (server: FastifyInstance, who: Player, mapId: string) =>
    call(server, 'POST', `/maps/${mapId}/boss/battle`, who);
  const act = async (
    server: FastifyInstance,
    who: Player,
    battle: PlayerBattle,
    action: object,
  ) => {
    const res = await call(server, 'POST', `/battles/${battle.id}/actions`, who, {
      action,
      turn: battle.view.turn,
    });
    expect(res.statusCode, res.body).toBe(200);
    return BattleResponseSchema.parse(res.json()).battle;
  };
  const appeared = async (mapId: string) =>
    (
      await db.query.gameEvents.findMany({
        where: (t, { and, eq: is }) => and(is(t.mapId, mapId), is(t.type, 'boss.appeared')),
      })
    ).length;

  it('stays away with an empty bag, and until some Partner is grown enough', async () => {
    const { server, sweep } = await start(BOSS_EVENTS);
    const owner = await player();
    const mapId = await patch(server, owner);
    await grow(mapId, owner, 30);
    await toVisit(mapId);
    expect(await visit(server, owner, mapId)).toBeNull();
    expect(await sweep([mapId])).toBe(0);
    await app!.close();

    const again = await start();
    const small = await player();
    const smallMap = await patch(again.server, small);
    await grow(smallMap, small, RULES.minPartnerLevel - 1);
    await toVisit(smallMap);
    expect(await visit(again.server, small, smallMap)).toBeNull();
    expect(await appeared(smallMap)).toBe(0);
  });

  it('opens once, pins its tile, and never tells the patch which boss', async () => {
    const { server, sweep } = await start();
    const owner = await player();
    const mapId = await patch(server, owner);
    await grow(mapId, owner, 20);
    const before = await visit(server, owner, mapId);
    expect(before).toBeNull(); // Monday noon: before any visit's 16:00 opening
    const { week } = await toVisit(mapId);
    expect(await sweep([mapId])).toBe(1);
    expect(await sweep([mapId])).toBe(0);
    expect(await appeared(mapId)).toBe(1);
    const boss = (await visit(server, owner, mapId))!;
    expect(boss).toMatchObject({
      window: { id: week },
      species: null,
      state: 'here',
      triesLeftToday: RULES.triesPerDay,
    });
    expect(await appeared(mapId)).toBe(1);

    // The tile was neutral land, and stays pinned when it changes hands.
    const tile = await db.query.tiles.findFirst({
      where: (t, { and, eq }) =>
        and(eq(t.mapId, mapId), eq(t.q, boss.tile.q), eq(t.r, boss.tile.r)),
    });
    expect(tile).toMatchObject({ ownerUserId: null, homeSlot: null, communityId: null });
    expect(['trading-post', 'junipers-gap']).not.toContain(tile!.terrain);
    await db.execute(`update tiles set owner_user_id = '${owner.id}' where id = '${tile!.id}'`);
    expect((await visit(server, owner, mapId))!.tile).toEqual(boss.tile);

    // The event and its public view carry no species, schedule or bag.
    const [event] = await db.query.gameEvents.findMany({
      where: (t, { and, eq: is }) => and(is(t.mapId, mapId), is(t.type, 'boss.appeared')),
    });
    expect(Object.keys(event!.payload as object).sort()).toEqual(['endsAt', 'q', 'r', 'window']);
    const shown = publicViewFor(PUBLIC_VIEWS, event!, { userId: owner.id });
    expect(shown).not.toBeNull();
    expect(JSON.stringify(shown)).not.toContain(BOSS.id);
  });

  it('shows a too-small Keeper the boss, but no fight', async () => {
    const { server } = await start();
    const owner = await player();
    const little = await player();
    const mapId = await patch(server, owner, [little]);
    await grow(mapId, owner, 20);
    await grow(mapId, little, RULES.minPlayerLevel - 1);
    await toVisit(mapId);
    expect(await visit(server, little, mapId)).toMatchObject({
      species: BOSS.id,
      state: 'too-big',
      triesLeftToday: 0,
    });
    const res = await fight(server, little, mapId);
    expect(res.statusCode).toBe(409);
    expect(errorOf(res)).toBe('Too big for now! Grow your team and come back.');
  });

  it('fights as a team, spends a try per fight and gives them back tomorrow', async () => {
    const { server } = await start();
    const owner = await player();
    const mapId = await patch(server, owner);
    await grow(mapId, owner, 20);
    const { week } = await toVisit(mapId);
    for (let i = 0; i < RULES.triesPerDay; i++) {
      const res = await fight(server, owner, mapId);
      expect(res.statusCode, res.body).toBe(201);
      const battle = BattleResponseSchema.parse(res.json()).battle;
      expect(battle.view.sides.a.out).toEqual([0, 1, 2]);
      expect(battle.view.sides.b.squishies).toHaveLength(1);
      // Met now: its name shows, and one try fewer is left.
      expect(await visit(server, owner, mapId)).toMatchObject({
        species: BOSS.id,
        triesLeftToday: RULES.triesPerDay - 1 - i,
      });
      // A one-on-one turn is refused in a team battle.
      const wrong = await call(server, 'POST', `/battles/${battle.id}/actions`, owner, {
        action: { type: 'move', move: battle.view.sides.a.squishies[0]!.moves[0] },
        turn: battle.view.turn,
      });
      expect(wrong.statusCode).toBe(409);
      const lost = await act(server, owner, battle, { type: 'forfeit' });
      expect(lost.status).toBe('finished');
    }
    const none = await fight(server, owner, mapId);
    expect(none.statusCode).toBe(409);
    expect(errorOf(none)).toBe('Phew, that’s enough stomping for today. Try again tomorrow!');
    const row = await db.query.bossEncounters.findFirst({
      where: (t, { eq }) => eq(t.userId, owner.id),
    });
    expect(row).toMatchObject({ windowId: week, wonBattleId: null });

    clock.setTime(clock.getTime() + DAY_MS / 2);
    const pinned = await db.query.bossWindows.findFirst({
      where: (t, { eq }) => eq(t.mapId, mapId),
    });
    if (clock < pinned!.endsAt && localDate(clock, ZONE) !== localDate(pinned!.opensAt, ZONE)) {
      expect((await visit(server, owner, mapId))!.triesLeftToday).toBe(RULES.triesPerDay);
    }
  });

  it('a win pays the mini-boss coins and ends the visit for that Keeper only', async () => {
    const { server } = await start();
    const owner = await player();
    const friend = await player();
    const mapId = await patch(server, owner, [friend]);
    await grow(mapId, owner, 20);
    await grow(mapId, friend, 20);
    await toVisit(mapId);
    const res = await fight(server, owner, mapId);
    expect(res.statusCode, res.body).toBe(201);
    let battle = BattleResponseSchema.parse(res.json()).battle;
    expect(battle.kind).toBe('miniboss');
    for (let round = 0; round < 100 && battle.status === 'active'; round++) {
      const side = battle.view.sides.a;
      const picks = (side.out ?? [])
        .filter((slot) => side.squishies[slot]!.energy > 0)
        .map((slot) => ({ slot, move: side.squishies[slot]!.moves[0]! }));
      battle = await act(server, owner, battle, { type: 'team', picks });
    }
    expect(battle.status).toBe('finished');
    expect(battle.view.phase).toMatchObject({ type: 'over', result: { winner: 'a' } });
    expect(battle.rewards?.coins).toEqual({ patch: 5, heart: 5 });

    expect((await visit(server, owner, mapId))!.state).toBe('beaten');
    const again = await fight(server, owner, mapId);
    expect(again.statusCode).toBe(409);
    expect((await visit(server, friend, mapId))!.state).toBe('here');
  });
});
