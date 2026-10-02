import {
  ApiErrorSchema,
  BATTLE_RULES,
  BattleResponseSchema,
  createBattleContent,
  GAME_DATA,
  hexKey,
  hexNeighbors,
  JoinMapResponseSchema,
  MapResponseSchema,
  parseGameEventPayload,
  RAID_RULES,
  RaidReplayResponseSchema,
  RaidReportResponseSchema,
  replayBattle,
  replayBattleRecord,
  SquishyResponseSchema,
  TERRITORY_RULES,
  type MapDetail,
  type PlayerBattle,
  type PlayerBattleAction,
  type PublicUser,
} from '@heartpatch/shared';
import { SERVER_GAME_DATA, serverBattleData } from '@heartpatch/shared/server';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { afterAll, afterEach, beforeAll, describe, expect, inject, it } from 'vitest';
import { buildApp } from '../../app.js';
import { loadConfig } from '../../config.js';
import { createDbClient, withTransaction, type Database, type DbClient } from '../../db/client.js';
import { keepers, sessions, users } from '../../db/schema.js';
import { runConsumer } from '../../jobs/consumers.js';
import { PUBLIC_VIEWS, publicViewFor } from '../../ws/public-views.js';
import { SESSION_COOKIE } from '../auth/limits.js';
import { newSessionToken } from '../auth/secrets.js';
import { createBattlesRepo } from '../battles/repo.js';
import { createBattlesService } from '../battles/service.js';
import { createTileBattlePort } from '../territory/service.js';
import { createRaidsConsumer, raidOutcome } from './consumer.js';

const url = inject('testDatabaseUrl');
const HEADERS = { 'x-requested-with': 'heartpatch' };
const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
const TEST_KEEPER = { base: 'pip', hairColor: 'honey', eyeColor: 'sky', outfit: 'sunflower' };
const UUID = /^[0-9a-f-]{36}$/;
const uuid = (value: string) => {
  if (!UUID.test(value)) throw new Error(`not a uuid: ${value}`);
  return value;
};
// Noon in Denver: a whole map-local day either side to move around in.
const START = '2026-10-02T18:00:00Z';

interface Player extends PublicUser {
  token: string;
}

describe('raidOutcome', () => {
  it('reads the land first, then who won, from the defender’s side', () => {
    expect(raidOutcome('a', 'a', 'captured')).toBe('taken');
    expect(raidOutcome('a', 'a', 'won')).toBe('lost');
    expect(raidOutcome('b', 'a', 'lost')).toBe('held');
    expect(raidOutcome('draw', 'a', 'lost')).toBe('tie');
    expect(raidOutcome(null, 'a', 'no-contest')).toBe('no-contest');
    expect(raidOutcome('b', 'a', 'no-contest')).toBe('no-contest');
  });
});

describe.skipIf(!url)('raids (needs DATABASE_URL)', () => {
  let client: DbClient;
  let db: Database;
  let app: FastifyInstance | undefined;
  const clock = new Date(START);
  let counter = 0;
  const consumer = createRaidsConsumer();

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
    const username = `defender_${String((counter += 1))}`;
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
  const battleOf = (res: LightMyRequestResponse) => BattleResponseSchema.parse(res.json()).battle;

  async function report(server: FastifyInstance, who: Player, mapId: string) {
    const res = await call(server, 'GET', `/maps/${mapId}/raids`, who);
    expect(res.statusCode, res.body).toBe(200);
    return RaidReportResponseSchema.parse(res.json()).report;
  }

  async function join(server: FastifyInstance, owner: Player, mapId: string, other: Player) {
    const res = await call(server, 'GET', `/maps/${mapId}`, owner);
    const code = MapResponseSchema.parse(res.json()).map.admin!.invite!.code;
    const joined = await call(server, 'POST', '/maps/join', other, { code });
    expect(joined.statusCode).toBe(201);
    const request = JoinMapResponseSchema.parse(joined.json()).request;
    const ok = await call(server, 'POST', `/maps/${mapId}/requests/${request.id}/approve`, owner);
    expect(ok.statusCode).toBe(204);
  }

  async function grant(server: FastifyInstance, who: Player, mapId: string, level: number) {
    const res = await call(server, 'POST', `/maps/${mapId}/dev/squishies`, who, { level });
    expect(res.statusCode).toBe(201);
    return SquishyResponseSchema.parse(res.json()).squishy;
  }

  const tilesOf = (mapId: string) =>
    db.query.tiles.findMany({
      where: (t, { eq }) => eq(t.mapId, mapId),
      orderBy: (t, { asc }) => [asc(t.q), asc(t.r)],
    });
  const setOwner = (tileId: string, userId: string) =>
    db.execute(`update tiles set owner_user_id = '${uuid(userId)}' where id = '${uuid(tileId)}'`);
  const raidsOf = (mapId: string) =>
    db.query.raids.findMany({ where: (t, { eq }) => eq(t.mapId, mapId) });
  const eventsOf = (mapId: string) =>
    db.query.gameEvents.findMany({
      where: (t, { eq }) => eq(t.mapId, mapId),
      orderBy: (t, { asc }) => [asc(t.seq)],
    });

  const act = (server: FastifyInstance, who: Player, b: PlayerBattle, action: PlayerBattleAction) =>
    call(server, 'POST', `/battles/${b.id}/actions`, who, { action, turn: b.view.turn });

  /** Plays the player's first move every turn until the battle ends. */
  async function playOut(server: FastifyInstance, who: Player, battle: PlayerBattle) {
    let current = battle;
    for (let i = 0; i < BATTLE_RULES.maxTurns + 5 && current.status === 'active'; i++) {
      const side = current.view.sides[current.mySide];
      const action: PlayerBattleAction =
        current.view.phase.type === 'replace'
          ? { type: 'replace', slot: side.squishies.findIndex((s) => s.energy > 0) }
          : { type: 'move', move: side.squishies[side.active]!.moves[0]! };
      const res = await act(server, who, current, action);
      expect(res.statusCode, res.body).toBe(200);
      current = battleOf(res);
    }
    expect(current.status).toBe('finished');
    return current;
  }

  /**
   * A patch where `kid` (squishy at `kidLevel`) can challenge `rival`'s tile
   * `near`, guarded by the rival's squishy at `rivalLevel` (or by the land's
   * own guardians when `rivalLevel` is null). Past the rival's shield.
   */
  async function challenge(
    server: FastifyInstance,
    { kidLevel = 40, rivalLevel = 3 }: { kidLevel?: number; rivalLevel?: number | null } = {},
  ) {
    const kid = await player();
    const rival = await player();
    const res = await call(server, 'POST', '/maps', kid, {
      name: 'Raid Patch',
      timeZone: 'America/Denver',
    });
    expect(res.statusCode).toBe(201);
    const map: MapDetail = MapResponseSchema.parse(res.json()).map;
    const mapId = map.id;
    await join(server, kid, mapId, rival);
    await grant(server, kid, mapId, kidLevel);
    const guard = rivalLevel === null ? null : await grant(server, rival, mapId, rivalLevel);
    clock.setTime(clock.getTime() + (TERRITORY_RULES.newPlayerShieldHours + 1) * HOUR_MS);
    const all = await tilesOf(mapId);
    const mine = new Set(all.filter((t) => t.ownerUserId === kid.id).map(hexKey));
    const [near, near2] = all.filter(
      (t) =>
        t.ownerUserId === null &&
        t.homeSlot === null &&
        hexNeighbors(t).some((n) => mine.has(hexKey(n))),
    );
    await setOwner(near!.id, rival.id);
    await setOwner(near2!.id, rival.id);
    if (guard) {
      const watch = await call(server, 'POST', `/maps/${mapId}/defenders`, rival, {
        q: near!.q,
        r: near!.r,
        squishyIds: [guard.id],
      });
      expect(watch.statusCode, watch.body).toBe(200);
    }
    const attack = () =>
      call(server, 'POST', `/maps/${mapId}/attacks`, kid, { q: near!.q, r: near!.r });
    return { kid, rival, mapId, near: near!, near2: near2!, attack };
  }

  describe('defense style', () => {
    it('defaults to Balanced and plays the challenge in the style the defender picked', async () => {
      const server = await start();
      const { kid, rival, mapId, attack } = await challenge(server);
      expect((await report(server, rival, mapId)).stance).toBe(RAID_RULES.defaultStance);

      const set = await call(server, 'POST', `/maps/${mapId}/defense-style`, rival, {
        stance: 'aggressive',
      });
      expect(set.statusCode, set.body).toBe(200);
      expect(RaidReportResponseSchema.parse(set.json()).report.stance).toBe('aggressive');
      // Per map, per player: the challenger's stays Balanced.
      expect((await report(server, kid, mapId)).stance).toBe('balanced');

      const res = await attack();
      expect(res.statusCode, res.body).toBe(201);
      const battle = battleOf(res);
      // The server's AI plays the defender (they never need to be online).
      expect(battle.view.sides.b.controller).toEqual({ type: 'ai', policy: 'aggressive' });
      // Stored in the battle's setup, so a replay needs no lookup.
      const row = await createBattlesRepo(db).findBattle(battle.id);
      expect(row!.setup.b.controller).toEqual({ type: 'ai', policy: 'aggressive' });

      // A change after the start doesn't touch the battle going.
      await call(server, 'POST', `/maps/${mapId}/defense-style`, rival, { stance: 'defensive' });
      const again = await createBattlesRepo(db).findBattle(battle.id);
      expect(again!.setup.b.controller).toEqual({ type: 'ai', policy: 'aggressive' });
    });

    it('keeps the guardian policy when the land’s guardians stand in', async () => {
      const server = await start();
      const { rival, mapId, attack } = await challenge(server, { rivalLevel: null });
      await call(server, 'POST', `/maps/${mapId}/defense-style`, rival, { stance: 'aggressive' });
      const battle = battleOf(await attack());
      expect(battle.view.sides.b.controller).toEqual({ type: 'ai', policy: 'guardian' });
    });

    it('refuses an unknown style, and players who aren’t on the patch', async () => {
      const server = await start();
      const { rival, mapId } = await challenge(server);
      const bad = await call(server, 'POST', `/maps/${mapId}/defense-style`, rival, {
        stance: 'sneaky',
      });
      expect(bad.statusCode).toBe(400);
      const stranger = await player();
      const res = await call(server, 'POST', `/maps/${mapId}/defense-style`, stranger, {
        stance: 'aggressive',
      });
      expect(res.statusCode).toBe(404);
      expect(errorOf(res).message).toMatch(/couldn't find that patch/);
      expect((await call(server, 'GET', `/maps/${mapId}/raids`, stranger)).statusCode).toBe(404);
      expect((await call(server, 'GET', `/maps/${mapId}/raids`, null)).statusCode).toBe(401);
    });
  });

  describe('the raid log', () => {
    it('logs a lost tile for the defender, with a replay that matches the recorded log (acceptance)', async () => {
      const server = await start();
      const { kid, rival, mapId, near, attack } = await challenge(server);
      await call(server, 'POST', `/maps/${mapId}/defense-style`, rival, { stance: 'defensive' });
      // The challenge resolves right away: the defender's side is the server's AI.
      const done = await playOut(server, kid, battleOf(await attack()));
      expect(done.view.phase).toMatchObject({ type: 'over', result: { winner: 'a' } });

      // Nothing until the consumer runs (it never runs inside the battle's transaction).
      expect(await raidsOf(mapId)).toEqual([]);
      await runConsumer(db, consumer, mapId);
      const [row] = await raidsOf(mapId);
      expect(row).toMatchObject({
        battleId: done.id,
        attackerUserId: kid.id,
        defenderUserId: rival.id,
        outcome: 'taken',
        reason: 'tuckered-out',
        stance: 'defensive',
        seenAt: null,
      });

      // The defender's report, next time they open the patch.
      const seen = await report(server, rival, mapId);
      expect(seen.unseen).toBe(1);
      expect(seen.raids).toEqual([
        expect.objectContaining({
          id: row!.id,
          battleId: done.id,
          attackerUserId: kid.id,
          attackerName: kid.username,
          q: near.q,
          r: near.r,
          outcome: 'taken',
          stance: 'defensive',
          seenAt: null,
          replayable: true,
        }),
      ]);

      // The event, after the battle's own events; members see only the public fields.
      const events = await eventsOf(mapId);
      const resolved = events.at(-1)!;
      expect(resolved.type).toBe('raid.resolved');
      expect(events.map((e) => e.type).slice(-3)).toEqual([
        'battle.ended',
        'tile.captured',
        'raid.resolved',
      ]);
      expect(parseGameEventPayload('raid.resolved', resolved.payload)).toEqual({
        raidId: row!.id,
        battleId: done.id,
        attackerUserId: kid.id,
        defenderUserId: rival.id,
        q: near.q,
        r: near.r,
        outcome: 'taken',
      });
      expect(publicViewFor(PUBLIC_VIEWS, resolved, { userId: rival.id })).toEqual({
        raidId: row!.id,
        attackerUserId: kid.id,
        defenderUserId: rival.id,
        q: near.q,
        r: near.r,
        outcome: 'taken',
      });

      // The replay, from the defender's side, through the battle screen's own view.
      const res = await call(server, 'GET', `/maps/${mapId}/raids/${row!.id}/replay`, rival);
      expect(res.statusCode, res.body).toBe(200);
      const { start: first, end } = RaidReplayResponseSchema.parse(res.json()).replay;
      expect(first.mySide).toBe('b');
      expect(end.mySide).toBe('b');
      expect(first.view.turn).toBe(0);
      expect(first.view.log).toEqual([]);
      expect(end.view.phase).toEqual(done.view.phase);
      expect(end.view.log).toEqual(done.view.log);
      expect(res.body).not.toMatch(/"rng"/);
      // …and it is the recorded battle: seed + setup + actions replay to the stored log.
      const battle = (await createBattlesRepo(db).findBattle(done.id))!;
      const content = createBattleContent(serverBattleData(GAME_DATA, SERVER_GAME_DATA));
      const replayed = replayBattleRecord(content, {
        setup: { seed: battle.seed, sides: battle.setup },
        actions: battle.actions,
        contentHash: battle.contentHash,
        result: battle.result!,
        log: battle.log!,
      });
      expect(replayed).toEqual(battle.state);
      expect(replayed.log).toEqual(battle.log);
      expect(end.view.log).toEqual(
        replayBattle(content, { seed: battle.seed, sides: battle.setup }, battle.actions).log,
      );
    });

    it('logs a held tile when the defenders win, and when the challenger scoots home', async () => {
      const server = await start();
      // A sleepy little challenger against a big squishy on watch.
      const { kid, rival, mapId, near, attack } = await challenge(server, {
        kidLevel: 2,
        rivalLevel: 60,
      });
      const lost = await playOut(server, kid, battleOf(await attack()));
      expect(lost.view.phase).toMatchObject({ type: 'over', result: { winner: 'b' } });
      clock.setTime(clock.getTime() + TERRITORY_RULES.cooldownHours * HOUR_MS + 60_000);
      const left = battleOf(await attack());
      const res = await act(server, kid, left, { type: 'forfeit' });
      expect(res.statusCode).toBe(200);

      await runConsumer(db, consumer, mapId);
      const raids = (await report(server, rival, mapId)).raids;
      // Newest first.
      expect(raids.map((r) => [r.battleId, r.outcome, r.reason, r.stance])).toEqual([
        [left.id, 'held', 'forfeit', 'balanced'],
        [lost.id, 'held', 'tuckered-out', 'balanced'],
      ]);
      expect(raids.every((r) => r.q === near.q && r.r === near.r && r.replayable)).toBe(true);
      // The land stays the defender's.
      const tile = (await tilesOf(mapId)).find((t) => t.id === near.id)!;
      expect(tile.ownerUserId).toBe(rival.id);
    });

    it('logs a challenge the server called off, with nothing to replay', async () => {
      const server = await start();
      const { kid, rival, mapId, attack } = await challenge(server);
      const battle = battleOf(await attack());
      const retuned = createBattlesService({
        db,
        clock: () => clock,
        content: createBattleContent(serverBattleData(GAME_DATA, SERVER_GAME_DATA), {
          ...BATTLE_RULES,
          maxTurns: BATTLE_RULES.maxTurns + 1,
        }),
        tileBattles: createTileBattlePort(),
      });
      expect((await retuned.get(kid, battle.id)).status).toBe('no-contest');
      await runConsumer(db, consumer, mapId);
      const [raid] = (await report(server, rival, mapId)).raids;
      expect(raid).toMatchObject({
        battleId: battle.id,
        outcome: 'no-contest',
        reason: 'no-contest',
        replayable: false,
      });
      const replay = await call(server, 'GET', `/maps/${mapId}/raids/${raid!.id}/replay`, rival);
      expect(replay.statusCode).toBe(409);
      expect(errorOf(replay).message).toMatch(/called off/);
    });

    it('logs each challenge once, however often the consumer sees it', async () => {
      const server = await start();
      const { kid, rival, mapId, attack } = await challenge(server);
      await playOut(server, kid, battleOf(await attack()));
      expect(await runConsumer(db, consumer, mapId)).toBeGreaterThan(0);
      // Caught up: nothing more to apply.
      expect(await runConsumer(db, consumer, mapId)).toBe(0);
      // A handler run twice on the same event (a retried batch) writes nothing new.
      const ended = (await eventsOf(mapId)).find((e) => e.type === 'battle.ended')!;
      await withTransaction(db, (tx) => consumer.handle(tx, ended));
      expect(await raidsOf(mapId)).toHaveLength(1);
      expect((await eventsOf(mapId)).filter((e) => e.type === 'raid.resolved')).toHaveLength(1);
      expect((await report(server, rival, mapId)).raids).toHaveLength(1);
    });

    it('ignores claims of wild land and other battles', async () => {
      const server = await start();
      const { kid, mapId } = await challenge(server);
      // A wild claim next to the kid's land (no defender).
      const all = await tilesOf(mapId);
      const mine = new Set(all.filter((t) => t.ownerUserId === kid.id).map(hexKey));
      const wild = all.find(
        (t) =>
          t.ownerUserId === null &&
          t.homeSlot === null &&
          hexNeighbors(t).some((n) => mine.has(hexKey(n))),
      )!;
      const claim = battleOf(
        await call(server, 'POST', `/maps/${mapId}/attacks`, kid, { q: wild.q, r: wild.r }),
      );
      expect(claim.kind).toBe('tile');
      await playOut(server, kid, claim);
      await runConsumer(db, consumer, mapId);
      expect(await raidsOf(mapId)).toEqual([]);
    });

    it('shows each defender only their own raids, and marks them seen', async () => {
      const server = await start();
      const { kid, rival, mapId, attack } = await challenge(server);
      await playOut(server, kid, battleOf(await attack()));
      await runConsumer(db, consumer, mapId);
      const [raid] = (await report(server, rival, mapId)).raids;

      // The challenger isn't the defender: nothing in their report, no replay for them.
      expect((await report(server, kid, mapId)).raids).toEqual([]);
      const theirs = await call(server, 'GET', `/maps/${mapId}/raids/${raid!.id}/replay`, kid);
      expect(theirs.statusCode).toBe(404);
      // Marking someone else's raid seen changes nothing.
      const sneaky = await call(server, 'POST', `/maps/${mapId}/raids/seen`, kid, {
        raidIds: [raid!.id],
      });
      expect(sneaky.statusCode).toBe(200);
      expect((await report(server, rival, mapId)).unseen).toBe(1);
      // A stranger can't see the patch at all.
      const stranger = await player();
      expect(
        (await call(server, 'GET', `/maps/${mapId}/raids/${raid!.id}/replay`, stranger)).statusCode,
      ).toBe(404);

      const seenAt = new Date(clock);
      const res = await call(server, 'POST', `/maps/${mapId}/raids/seen`, rival, {
        raidIds: [raid!.id],
      });
      expect(res.statusCode, res.body).toBe(200);
      const after = RaidReportResponseSchema.parse(res.json()).report;
      expect(after.unseen).toBe(0);
      expect(after.raids[0]!.seenAt).toBe(seenAt.toISOString());
      // Seeing it again later keeps the first time.
      clock.setTime(clock.getTime() + HOUR_MS);
      await call(server, 'POST', `/maps/${mapId}/raids/seen`, rival, { raidIds: [raid!.id] });
      expect((await report(server, rival, mapId)).raids[0]!.seenAt).toBe(seenAt.toISOString());
    });

    it('leaves Gentle mode’s daily loss cap as it was, whatever the style', async () => {
      const server = await start();
      const { kid, rival, mapId, near2, attack } = await challenge(server);
      await call(server, 'POST', `/maps/${mapId}/defense-style`, rival, { stance: 'aggressive' });
      await playOut(server, kid, battleOf(await attack()));
      await runConsumer(db, consumer, mapId);
      expect((await report(server, rival, mapId)).raids[0]!.outcome).toBe('taken');
      // Gentle (the default): one lost tile a day, raid log or not.
      const capped = await call(server, 'POST', `/maps/${mapId}/attacks`, kid, {
        q: near2.q,
        r: near2.r,
      });
      expect(capped.statusCode).toBe(409);
      expect(errorOf(capped).message).toMatch(/enough fun for today/);
    });
  });
});
