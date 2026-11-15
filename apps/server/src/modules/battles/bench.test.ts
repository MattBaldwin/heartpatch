import {
  BATTLE_RULES,
  BattleResponseSchema,
  BattleResultSchema,
  BattleRewardsSchema,
  CARE_RULES,
  createBattleContent,
  friendlyBattleXp,
  GAME_DATA,
  grantedXp,
  GROWTH_RULES,
  hexKey,
  hexNeighbors,
  JoinMapResponseSchema,
  MapResponseSchema,
  parseGameEventPayload,
  SquishyResponseSchema,
  TERRITORY_RULES,
  xpForLevel,
  xpMultiplier,
  type PlayerBattle,
  type PlayerBattleAction,
} from '@heartpatch/shared';
import {
  EVOLUTION_RULES,
  GUARDIAN_RULES,
  SERVER_GAME_DATA,
  serverBattleData,
} from '@heartpatch/shared/server';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { afterAll, afterEach, beforeAll, describe, expect, inject, it } from 'vitest';
import { buildApp } from '../../app.js';
import { loadConfig } from '../../config.js';
import { createDbClient, type Database, type DbClient } from '../../db/client.js';
import { keepers, sessions, users } from '../../db/schema.js';
import { SESSION_COOKIE } from '../auth/limits.js';
import { newSessionToken } from '../auth/secrets.js';
import { createBattlesRepo } from './repo.js';
import { createBattlesService, devEncounter } from './service.js';
import { bigMove } from '../../../tests/big-move.js';

const url = inject('testDatabaseUrl');
const HEADERS = { 'x-requested-with': 'heartpatch' };
const ORIGIN = 'http://localhost:5173';
const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
const START = '2026-10-02T12:00:00Z';
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
const UUID = /^[0-9a-f-]{36}$/;
const uuid = (value: string) => {
  if (!UUID.test(value)) throw new Error(`not a uuid: ${value}`);
  return value;
};

interface Player {
  id: string;
  username: string;
  token: string;
}

/** A secret line's first and grown forms: the grown one wins, the first is the weak foe. */
const SECRET_LINE = SERVER_GAME_DATA.secretEvolutions.find((e) =>
  SERVER_GAME_DATA.secretSpecies.some((s) => s.id === e.from),
)!;
const STRONG = SECRET_LINE.into;
const WEAK = { speciesId: SECRET_LINE.from, level: 3 };
const TOUGH = { speciesId: SECRET_LINE.from, level: 90 };

/** `benchXpPercent` of the best award on a side (#732). */
const half = (base: number) => Math.floor((base * GROWTH_RULES.benchXpPercent!) / 100);
/**
 * XP a squishy at start contentment with no habitat gets for `base`: every
 * squishy here is granted at the battle's clock, so care is the same for all.
 */
const paid = (base: number) =>
  grantedXp(
    base,
    xpMultiplier(
      CARE_RULES.startContentment,
      null,
      { element: 'light', feeling: 'cozy' },
      GROWTH_RULES,
    ),
  );

describe.skipIf(!url)('the bench shares XP (#732, needs DATABASE_URL)', () => {
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
      PUBLIC_ORIGIN: ORIGIN,
    });
    app = await buildApp({ config, db, clock: () => clock, logger: false });
    return app;
  }

  async function player(): Promise<Player> {
    const username = `benchkid_${String((counter += 1))}`;
    const [user] = await db
      .insert(users)
      .values({ username, passwordHash: 'not-a-hash', birthYear: 2014, timeZone: 'America/Denver' })
      .returning({ id: users.id });
    const { token, tokenHash } = newSessionToken();
    await db
      .insert(sessions)
      .values({ userId: user!.id, tokenHash, expiresAt: new Date(Date.now() + 30 * DAY_MS) });
    await db.insert(keepers).values({ userId: user!.id, ...TEST_KEEPER });
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

  const battleOf = (res: LightMyRequestResponse) => {
    expect(res.statusCode, res.body).toBeLessThan(300);
    return BattleResponseSchema.parse(res.json()).battle;
  };

  /** `owner`'s patch, with each of `others` joined. */
  async function patch(server: FastifyInstance, owner: Player, ...others: Player[]) {
    const res = await call(server, 'POST', '/maps', owner, {
      name: 'Bench Patch',
      timeZone: 'America/Denver',
    });
    expect(res.statusCode, res.body).toBe(201);
    const map = MapResponseSchema.parse(res.json()).map;
    for (const other of others) {
      const joined = await call(server, 'POST', '/maps/join', other, {
        code: map.admin!.invite!.code,
      });
      expect(joined.statusCode, joined.body).toBe(201);
      const request = JoinMapResponseSchema.parse(joined.json()).request;
      const ok = await call(
        server,
        'POST',
        `/maps/${map.id}/requests/${request.id}/approve`,
        owner,
      );
      expect(ok.statusCode, ok.body).toBe(204);
    }
    return map.id;
  }

  async function grant(
    server: FastifyInstance,
    who: Player,
    mapId: string,
    body: { speciesId?: string; level?: number },
  ) {
    const res = await call(server, 'POST', `/maps/${mapId}/dev/squishies`, who, body);
    expect(res.statusCode, res.body).toBe(201);
    return SquishyResponseSchema.parse(res.json()).squishy;
  }

  async function team(server: FastifyInstance, who: Player, mapId: string, ids: string[]) {
    const res = await call(server, 'POST', `/maps/${mapId}/team`, who, { squishyIds: ids });
    expect(res.statusCode, res.body).toBe(200);
  }

  const pickFight = async (
    server: FastifyInstance,
    who: Player,
    mapId: string,
    opponent: { speciesId: string; level: number },
  ) => battleOf(await call(server, 'POST', `/maps/${mapId}/dev/battles`, who, { opponent }));

  const send = async (
    server: FastifyInstance,
    who: Player,
    b: PlayerBattle,
    action: PlayerBattleAction,
  ) =>
    battleOf(
      await call(server, 'POST', `/battles/${b.id}/actions`, who, { action, turn: b.view.turn }),
    );

  /** Plays `who`'s big move every turn (or sends out the next one) until the battle ends. */
  async function playOut(server: FastifyInstance, who: Player, battle: PlayerBattle) {
    let current = battle;
    for (let i = 0; i < BATTLE_RULES.maxTurns + 5 && current.status === 'active'; i++) {
      const side = current.view.sides[current.mySide];
      const action: PlayerBattleAction =
        current.view.phase.type === 'replace'
          ? { type: 'replace', slot: side.squishies.findIndex((s) => s.energy > 0) }
          : { type: 'move', move: bigMove(side.squishies[side.active]!) };
      current = await send(server, who, current, action);
    }
    expect(current.status).toBe('finished');
    return current;
  }

  const resultOf = (b: PlayerBattle) => {
    if (b.view.phase.type !== 'over') throw new Error('the battle is not over');
    return b.view.phase.result;
  };
  const rowOf = async (battleId: string) =>
    (await db.query.battles.findFirst({ where: (t, { eq }) => eq(t.id, battleId) }))!;
  const rewardsOf = async (battleId: string) =>
    BattleRewardsSchema.parse((await rowOf(battleId)).rewards);
  const storedResultOf = async (battleId: string) =>
    BattleResultSchema.parse((await rowOf(battleId)).result);
  const squishyOf = async (id: string) =>
    (await db.query.squishies.findFirst({ where: (t, { eq }) => eq(t.id, id) }))!;
  const winsOf = async (mapId: string, ids: string[]) =>
    Object.fromEntries(await createBattlesRepo(db).winsToday(mapId, ids, clock));
  const eventsOf = (mapId: string) =>
    db.query.gameEvents.findMany({
      where: (t, { eq }) => eq(t.mapId, mapId),
      orderBy: (t, { asc }) => [asc(t.seq)],
    });
  const endedOf = async (mapId: string, battleId: string) =>
    (await eventsOf(mapId))
      .filter((e) => e.type === 'battle.ended')
      .map((e) => parseGameEventPayload('battle.ended', e.payload))
      .find((p) => p.battleId === battleId)!;
  /** Changes one squishy behind the game's back (`set` is SQL), as another request could. */
  const setSquishy = (id: string, set: string) =>
    db.execute(`update squishies set ${set} where id = '${uuid(id)}'`);
  /** A row's XP by squishy, with its bench marker. */
  const rowsBy = (xp: readonly { squishyId: string; xp: number; bench?: boolean | undefined }[]) =>
    new Map(xp.map((x) => [x.squishyId, x]));

  /** A kid on their own patch with a strong lead and `extra` more on the team, in that order. */
  async function kidWithTeam(server: FastifyInstance, extra: number, ...others: Player[]) {
    const kid = await player();
    const mapId = await patch(server, kid, ...others);
    const ids: string[] = [];
    for (let i = 0; i <= extra; i++) {
      ids.push((await grant(server, kid, mapId, { speciesId: STRONG, level: 20 })).id);
    }
    await team(server, kid, mapId, ids);
    return { server, kid, mapId, ids };
  }

  describe('wild battles', () => {
    it('a won battle pays each benched teammate half the lead’s base, through its own care', async () => {
      const server = await start();
      const { kid, mapId, ids } = await kidWithTeam(server, 2);
      const [lead, benchA, benchB] = ids as [string, string, string];
      const done = await playOut(server, kid, await pickFight(server, kid, mapId, WEAK));
      const result = resultOf(done);
      expect(result.winner).toBe('a');
      // The engine never saw the bench: only the lead came out and was awarded.
      expect(result.xp.filter((x) => x.side === 'a').map((x) => x.squishyId)).toEqual([lead]);
      const base = result.xp.find((x) => x.squishyId === lead)!.xp;
      expect(half(base)).toBeGreaterThan(0);

      const rewards = await rewardsOf(done.id);
      const rows = rowsBy(rewards.xp);
      expect(rows.get(lead)).toMatchObject({ xp: paid(base) });
      expect(rows.get(lead)!.bench).toBeUndefined();
      for (const id of [benchA, benchB]) {
        expect(rows.get(id), id).toMatchObject({ xp: paid(half(base)), bench: true });
        expect((await squishyOf(id)).xp).toBe(xpForLevel(20, GROWTH_RULES) + paid(half(base)));
      }
      // The player's own view of the rewards carries the bench too.
      expect(done.rewards?.xp.find((x) => x.squishyId === benchA)).toMatchObject({ bench: true });
      // `battle.ended` names the bench with the fighters.
      const ended = await endedOf(mapId, done.id);
      expect(ended.xp).toEqual(
        expect.arrayContaining([
          { squishyId: lead, xp: paid(base) },
          { squishyId: benchA, xp: paid(half(base)) },
          { squishyId: benchB, xp: paid(half(base)) },
        ]),
      );
      expect(ended.xp).toHaveLength(3);
      // Both took a falloff slot with the lead.
      expect(await winsOf(mapId, ids)).toEqual({ [lead]: 1, [benchA]: 1, [benchB]: 1 });
    });

    it('is never leaned Brave: only the lead that won is', async () => {
      const server = await start();
      const { kid, mapId, ids } = await kidWithTeam(server, 1);
      const [lead, bench] = ids as [string, string];
      const brave = EVOLUTION_RULES.lean.win.feeling;
      expect((await squishyOf(bench)).feelingLean[brave] ?? 0).toBe(0);
      const done = await playOut(server, kid, await pickFight(server, kid, mapId, WEAK));
      expect(resultOf(done).winner).toBe('a');
      expect(rowsBy((await rewardsOf(done.id)).xp).get(bench)).toMatchObject({ bench: true });
      expect((await squishyOf(lead)).feelingLean[brave]).toBe(EVOLUTION_RULES.lean.win.points);
      expect((await squishyOf(bench)).feelingLean[brave] ?? 0).toBe(0);
    });

    it('a lost battle pays the bench half the minimum, and uses no slot', async () => {
      const server = await start();
      const { kid, mapId, ids } = await kidWithTeam(server, 1);
      const [lead, bench] = ids as [string, string];
      // A loss where the bench never comes out: one turn against a much
      // stronger squishy, then the turn limit (pinned content) ends it.
      const short = createBattlesService({
        db,
        clock: () => clock,
        content: createBattleContent(serverBattleData(GAME_DATA, SERVER_GAME_DATA), {
          ...BATTLE_RULES,
          maxTurns: 1,
        }),
      });
      // A level 1 lead: it can't out-hit the stronger squishy in one turn.
      await setSquishy(lead, 'level = 1');
      const user = { id: kid.id, username: kid.username };
      const { battle } = await short.startAgainst(user, mapId, devEncounter(short, TOUGH));
      // At the turn limit the side with more of its whole energy left wins,
      // bench included (`energyLeader`), so a missed hit could hand side a
      // the win. A benched squishy down to 1 energy (pinned in the stored
      // state, as another request could) makes the loss certain on every
      // seed, while it still stands to be sent out if the lead goes down.
      await db.execute(
        `update battles set state = jsonb_set(state, '{sides,a,squishies,1,energy}', '1')
         where id = '${uuid(battle.id)}'`,
      );
      const side = battle.view.sides.a;
      const done = await short.act(user, battle.id, {
        action: { type: 'move', move: bigMove(side.squishies[side.active]!) },
        turn: battle.view.turn,
      });
      const result = resultOf(done);
      expect(result).toMatchObject({ winner: 'b', reason: 'turn-limit' });
      expect(done.view.sides.a.squishies.map((s) => s.joined)).toEqual([true, false]);
      expect(result.xp.find((x) => x.squishyId === lead)!.xp).toBe(BATTLE_RULES.xp.minimum);
      const rows = rowsBy((await rewardsOf(done.id)).xp);
      expect(rows.get(bench)).toMatchObject({
        xp: paid(half(BATTLE_RULES.xp.minimum)),
        bench: true,
      });
      // A loss fills no falloff slot, bench or not.
      expect(await winsOf(mapId, ids)).toEqual({});
    });

    it('a team of one adds no award', async () => {
      const server = await start();
      const { kid, mapId, ids } = await kidWithTeam(server, 0);
      const done = await playOut(server, kid, await pickFight(server, kid, mapId, WEAK));
      const rewards = await rewardsOf(done.id);
      expect(rewards.xp.map((x) => x.squishyId)).toEqual(ids);
      expect(rewards.xp.every((x) => x.bench === undefined)).toBe(true);
    });

    it('a bench squishy at the top level stays there', async () => {
      const top = GROWTH_RULES.maxLevel;
      const server = await start();
      const { kid, mapId, ids } = await kidWithTeam(server, 1);
      const [, bench] = ids as [string, string];
      const atTop = xpForLevel(top, GROWTH_RULES);
      await setSquishy(bench, `level = ${String(top)}, xp = ${String(atTop)}`);
      const done = await playOut(server, kid, await pickFight(server, kid, mapId, WEAK));
      expect(resultOf(done).winner).toBe('a');
      const row = rowsBy((await rewardsOf(done.id)).xp).get(bench)!;
      expect(row).toMatchObject({ bench: true });
      expect(row.xp).toBeGreaterThan(0);
      // Its XP is counted like a fighter's (#205), but no level past the cap.
      const after = await squishyOf(bench);
      expect(after.level).toBe(top);
      expect(after.xp).toBe(atTop + row.xp);
    });

    it('pays no bench and uses no bench slot with the knob at 0', async () => {
      const rules = GROWTH_RULES as { benchXpPercent?: number };
      const was = rules.benchXpPercent;
      rules.benchXpPercent = 0;
      try {
        const server = await start();
        const { kid, mapId, ids } = await kidWithTeam(server, 1);
        const [lead, bench] = ids as [string, string];
        const done = await playOut(server, kid, await pickFight(server, kid, mapId, WEAK));
        expect(resultOf(done).winner).toBe('a');
        expect((await rewardsOf(done.id)).xp.map((x) => x.squishyId)).toEqual([lead]);
        // Untouched: no XP has been written since the grant.
        expect((await squishyOf(bench)).xp).toBe(0);
        expect(await winsOf(mapId, ids)).toEqual({ [lead]: 1 });
      } finally {
        rules.benchXpPercent = was;
      }
    });

    it('a squishy that came out for one turn fought: the engine’s award, no bench marker', async () => {
      const server = await start();
      const { kid, mapId, ids } = await kidWithTeam(server, 2);
      const [lead, swapped, bench] = ids as [string, string, string];
      const battle = await pickFight(server, kid, mapId, WEAK);
      const out = await send(server, kid, battle, { type: 'swap', slot: 1 });
      expect(out.view.sides.a.squishies[1]!.joined).toBe(true);
      const done = await playOut(server, kid, out);
      const result = resultOf(done);
      expect(result.winner).toBe('a');
      expect(done.view.sides.a.squishies.map((s) => s.joined)).toEqual([true, true, false]);
      const engine = new Map(result.xp.map((x) => [x.squishyId, x.xp]));
      const rows = rowsBy((await rewardsOf(done.id)).xp);
      for (const id of [lead, swapped]) {
        expect(rows.get(id), id).toMatchObject({ xp: paid(engine.get(id)!) });
        expect(rows.get(id)!.bench, id).toBeUndefined();
      }
      const best = Math.max(engine.get(lead)!, engine.get(swapped)!);
      expect(rows.get(bench)).toMatchObject({ xp: paid(half(best)), bench: true });
    });

    it('a scoot at turn 0 pays nobody and uses no slot', async () => {
      const server = await start();
      const { kid, mapId, ids } = await kidWithTeam(server, 1);
      const battle = await pickFight(server, kid, mapId, WEAK);
      const done = await send(server, kid, battle, { type: 'forfeit' });
      expect(resultOf(done)).toMatchObject({ reason: 'forfeit', turns: 0 });
      expect((await rewardsOf(done.id)).xp).toEqual([]);
      // Untouched: no XP has been written since the grant.
      for (const id of ids) expect((await squishyOf(id)).xp).toBe(0);
      expect(await winsOf(mapId, ids)).toEqual({});
    });

    it('takes a falloff slot on a win: past the limit the bench gets the share, and full XP comes back at midnight', async () => {
      const falloff = GROWTH_RULES.battleXpFalloff!;
      const server = await start();
      const { kid, mapId, ids } = await kidWithTeam(server, 1);
      const [, bench] = ids as [string, string];
      const first = await playOut(server, kid, await pickFight(server, kid, mapId, WEAK));
      expect(resultOf(first).winner).toBe('a');
      expect(await winsOf(mapId, [bench])).toEqual({ [bench]: 1 });
      // The rest of today's full wins, as copies of the first.
      await db.execute(
        `insert into battles
         select (jsonb_populate_record(null::battles, to_jsonb(b) || jsonb_build_object('id', gen_random_uuid()))).*
         from battles b, generate_series(1, ${String(falloff.fullWinsPerDay - 1)})
         where b.id = '${uuid(first.id)}'`,
      );
      expect(await winsOf(mapId, [bench])).toEqual({ [bench]: falloff.fullWinsPerDay });
      const tired = await playOut(server, kid, await pickFight(server, kid, mapId, WEAK));
      const base = resultOf(tired).xp.find((x) => x.squishyId === ids[0])!.xp;
      const rewards = await rewardsOf(tired.id);
      expect(rowsBy(rewards.xp).get(bench)).toMatchObject({
        xp: paid(Math.floor((half(base) * falloff.afterPercent) / 100)),
        bench: true,
      });
      expect(rewards.fullXpResetAt).toBe('2026-10-03T06:00:00.000Z');
    });

    it('a benched squishy traded away, in the post or Hollowed before the finish earns nothing and uses no slot', async () => {
      const changes = {
        traded: (other: Player) => `owner_user_id = '${uuid(other.id)}'`,
        hollowed: () => `state = 'hollowed'`,
        'in-trade': () => `state = 'in-trade'`,
      };
      const server = await start();
      for (const [name, change] of Object.entries(changes)) {
        const other = await player();
        const { kid, mapId, ids } = await kidWithTeam(server, 2, other);
        const [lead, gone, kept] = ids as [string, string, string];
        const battle = await pickFight(server, kid, mapId, WEAK);
        await setSquishy(gone, change(other));
        const done = await playOut(server, kid, battle);
        expect(resultOf(done).winner, name).toBe('a');
        expect(
          done.view.sides.a.squishies.map((s) => s.joined),
          name,
        ).toEqual([true, false, false]);
        const rows = rowsBy((await rewardsOf(done.id)).xp);
        expect(rows.has(gone), name).toBe(false);
        expect(rows.get(kept), name).toMatchObject({ bench: true });
        expect((await squishyOf(gone)).xp, name).toBe(0);
        expect(await winsOf(mapId, ids), name).toEqual({ [lead]: 1, [kept]: 1 });
      }
    }, 120_000);

    it('bench XP can evolve a squishy, telling its owner', async () => {
      const species = GAME_DATA.species.find(
        (s) => s.evolutions.length === 1 && s.evolutions[0]!.level > 2,
      )!;
      const level = species.evolutions[0]!.level;
      const server = await start();
      const kid = await player();
      const mapId = await patch(server, kid);
      const lead = await grant(server, kid, mapId, { speciesId: STRONG, level: 20 });
      const bench = await grant(server, kid, mapId, { speciesId: species.id, level: level - 1 });
      // One XP short of the evolution level.
      await setSquishy(bench.id, `xp = ${String(xpForLevel(level, GROWTH_RULES) - 1)}`);
      await team(server, kid, mapId, [lead.id, bench.id]);
      const done = await playOut(server, kid, await pickFight(server, kid, mapId, WEAK));
      expect(resultOf(done).winner).toBe('a');
      const row = rowsBy((await rewardsOf(done.id)).xp).get(bench.id);
      expect(row).toMatchObject({ bench: true, evolvingAfter: null });
      const after = await squishyOf(bench.id);
      expect(after.level).toBeGreaterThanOrEqual(level);
      expect(after.speciesId).not.toBe(species.id);
      const evolved = (await eventsOf(mapId)).filter((e) => e.type === 'squishy.evolved');
      expect(evolved).toEqual([
        expect.objectContaining({
          actorUserId: kid.id,
          payload: expect.objectContaining({
            userId: kid.id,
            squishyId: bench.id,
            fromSpeciesId: species.id,
          }) as unknown,
        }),
      ]);
    });
  });

  describe('friendlies', () => {
    /** The app's own battles service is private; this one shares its database. */
    const service = () => createBattlesService({ db, clock: () => clock });

    /** Both players pick every turn until the battle ends. */
    async function fight(server: FastifyInstance, a: Player, b: Player, battleId: string) {
      const get = async (who: Player) =>
        battleOf(await call(server, 'GET', `/battles/${battleId}`, who));
      for (let i = 0; i < 2 * BATTLE_RULES.maxTurns; i++) {
        let active = false;
        for (const who of [a, b]) {
          const view = await get(who);
          if (view.status !== 'active') break;
          active = true;
          const side = view.view.sides[view.mySide];
          const phase = view.view.phase;
          if (phase.type === 'replace') {
            if (!phase.sides.includes(view.mySide)) continue;
            const slot = side.squishies.findIndex((s, i) => i !== side.active && s.energy > 0);
            await send(server, who, view, { type: 'replace', slot });
          } else if (view.live?.myPick === null) {
            await send(server, who, view, {
              type: 'move',
              move: side.squishies[side.active]!.moves[0]!,
            });
          }
        }
        if (!active) break;
      }
      expect((await get(a)).status).toBe('finished');
    }

    /** A side's base as a friendly pays it (`friendlyBattleXp`), from the stored state. */
    const friendlyBase = async (battleId: string, side: 'a' | 'b', squishyId: string) => {
      const row = await rowOf(battleId);
      const result = BattleResultSchema.parse(row.result);
      const engine = result.xp.find((x) => x.side === side && x.squishyId === squishyId)!.xp;
      const state = row.state as { sides: Record<'a' | 'b', { squishies: { energy: number }[] }> };
      const out = state.sides[side === 'a' ? 'b' : 'a'].squishies.filter((s) => s.energy === 0);
      return friendlyBattleXp(engine, out.length, GROWTH_RULES);
    };

    it('pays each side’s bench half its friendly share; only a won one takes a slot', async () => {
      const server = await start();
      const [lee, sam] = [await player(), await player()];
      const mapId = await patch(server, lee, sam);
      const leeLead = await grant(server, lee, mapId, { speciesId: 'puddlepuff', level: 40 });
      const leeBench = await grant(server, lee, mapId, { speciesId: 'puddlepuff', level: 5 });
      const samOnly = await grant(server, sam, mapId, { speciesId: 'puddlepuff', level: 5 });
      const ids = [leeLead.id, leeBench.id, samOnly.id];

      // Lee wins from side a: the level 5 never comes out.
      const first = await service().startFriendly({ mapId, aUserId: lee.id, bUserId: sam.id });
      await fight(server, lee, sam, first);
      expect(await storedResultOf(first)).toMatchObject({ winner: 'a' });
      const leeBase = await friendlyBase(first, 'a', leeLead.id);
      const rewards = await rewardsOf(first);
      expect(rowsBy(rewards.xp).get(leeBench.id)).toMatchObject({
        xp: paid(half(leeBase)),
        bench: true,
      });
      expect(rowsBy(rewards.xp).get(leeLead.id)).toMatchObject({ xp: paid(leeBase) });
      expect(rowsBy(rewards.xp).get(leeLead.id)!.bench).toBeUndefined();
      // Sam's only squishy fought and lost: paid, no slot.
      expect(rewards.b!.xp.map((x) => [x.squishyId, x.bench])).toEqual([[samOnly.id, undefined]]);
      expect(await winsOf(mapId, ids)).toEqual({ [leeLead.id]: 1, [leeBench.id]: 1 });

      // Sam wins from side b with his own bench; Lee's lead is away.
      await setSquishy(leeLead.id, `state = 'hollowed'`);
      const samLead = await grant(server, sam, mapId, { speciesId: 'puddlepuff', level: 40 });
      const second = await service().startFriendly({ mapId, aUserId: lee.id, bUserId: sam.id });
      await fight(server, lee, sam, second);
      expect(await storedResultOf(second)).toMatchObject({ winner: 'b' });
      const samBase = await friendlyBase(second, 'b', samLead.id);
      const b = (await rewardsOf(second)).b!;
      expect(b.userId).toBe(sam.id);
      expect(rowsBy(b.xp).get(samOnly.id)).toMatchObject({ xp: paid(half(samBase)), bench: true });
      expect(rowsBy(b.xp).get(samLead.id)!.bench).toBeUndefined();
      // Sam's bench takes a slot for the win; Lee's level 5 lost this time (no new slot).
      expect(await winsOf(mapId, [...ids, samLead.id])).toEqual({
        [leeLead.id]: 1,
        [leeBench.id]: 1,
        [samOnly.id]: 1,
        [samLead.id]: 1,
      });
    });

    it('a friendly scooted at turn 0 pays the winner’s bench nothing either', async () => {
      const server = await start();
      const [lee, sam] = [await player(), await player()];
      const mapId = await patch(server, lee, sam);
      const leeLead = await grant(server, lee, mapId, { speciesId: 'puddlepuff', level: 40 });
      const leeBench = await grant(server, lee, mapId, { speciesId: 'puddlepuff', level: 5 });
      await grant(server, sam, mapId, { speciesId: 'puddlepuff', level: 5 });
      const battleId = await service().startFriendly({ mapId, aUserId: lee.id, bUserId: sam.id });
      const theirs = battleOf(await call(server, 'GET', `/battles/${battleId}`, sam));
      await send(server, sam, theirs, { type: 'forfeit' });
      expect(await storedResultOf(battleId)).toMatchObject({
        winner: 'a',
        reason: 'forfeit',
        turns: 0,
      });
      const rewards = await rewardsOf(battleId);
      expect(rewards.xp).toEqual([]);
      expect(rewards.b!.xp).toEqual([]);
      expect((await squishyOf(leeBench.id)).xp).toBe(0);
      expect(await winsOf(mapId, [leeLead.id, leeBench.id])).toEqual({});
    });
  });

  describe('a held rival tile', () => {
    /**
     * Lee and Sam on one patch, past the new-player shield, with Sam holding
     * the free tile next to Lee's land; Sam's `guards` (if any) on watch.
     * Returns the other free tiles at Lee's edge too.
     */
    async function rivalTile(
      server: FastifyInstance,
      lee: Player,
      sam: Player,
      mapId: string,
      guards: string[],
    ) {
      clock.setTime(clock.getTime() + (TERRITORY_RULES.newPlayerShieldHours + 1) * HOUR_MS);
      const tiles = await db.query.tiles.findMany({
        where: (t, { eq }) => eq(t.mapId, mapId),
        orderBy: (t, { asc }) => [asc(t.q), asc(t.r)],
      });
      const mine = new Set(tiles.filter((t) => t.ownerUserId === lee.id).map(hexKey));
      const [near, ...edge] = tiles.filter(
        (t) =>
          t.ownerUserId === null &&
          t.homeSlot === null &&
          hexNeighbors(t).some((n) => mine.has(hexKey(n))),
      );
      await db.execute(
        `update tiles set owner_user_id = '${uuid(sam.id)}' where id = '${uuid(near!.id)}'`,
      );
      if (guards.length > 0) {
        const watch = await call(server, 'POST', `/maps/${mapId}/defenders`, sam, {
          q: near!.q,
          r: near!.r,
          squishyIds: guards,
        });
        expect(watch.statusCode, watch.body).toBe(200);
      }
      return { near: near!, edge };
    }

    it('a Gentle rival-tile battle benches half of the halved base', async () => {
      const server = await start();
      const [lee, sam] = [await player(), await player()];
      const mapId = await patch(server, lee, sam);
      const guard = await grant(server, sam, mapId, { speciesId: 'puddlepuff', level: 2 });
      const { near, edge } = await rivalTile(server, lee, sam, mapId, [guard.id]);
      // Lee has lots of land, Sam one tile: picking on a much smaller player
      // (Gentle, the default) pays Lee part of the battle's XP.
      for (const tile of edge.slice(0, 8)) {
        await db.execute(
          `update tiles set owner_user_id = '${uuid(lee.id)}' where id = '${uuid(tile.id)}'`,
        );
      }
      // Granted now, at the battle's clock, so `paid` is their care.
      const lead = await grant(server, lee, mapId, { speciesId: STRONG, level: 60 });
      const bench = await grant(server, lee, mapId, { speciesId: STRONG, level: 20 });
      await team(server, lee, mapId, [lead.id, bench.id]);

      const started = battleOf(
        await call(server, 'POST', `/maps/${mapId}/attacks`, lee, { q: near.q, r: near.r }),
      );
      expect(started.kind).toBe('rival-tile');
      const done = await playOut(server, lee, started);
      const result = resultOf(done);
      expect(result.winner).toBe('a');
      expect(done.view.sides.a.squishies.map((s) => s.joined)).toEqual([true, false]);
      const rewards = await rewardsOf(done.id);
      const percent = TERRITORY_RULES.gentle.rewardPercent;
      expect(rewards.percent).toBe(percent);
      expect(percent).toBeLessThan(100);
      const engine = result.xp.find((x) => x.squishyId === lead.id)!.xp;
      const gentle = Math.floor((engine * percent) / 100);
      // The bench's base is half of Gentle's share, not half of the engine's.
      expect(paid(half(gentle))).not.toBe(paid(half(engine)));
      const rows = rowsBy(rewards.xp);
      expect(rows.get(lead.id)).toMatchObject({ xp: paid(gentle) });
      expect(rows.get(bench.id)).toMatchObject({ xp: paid(half(gentle)), bench: true });
    });

    it('guardians standing in have no bench', async () => {
      const server = await start();
      const [lee, sam] = [await player(), await player()];
      const mapId = await patch(server, lee, sam);
      await grant(server, lee, mapId, { speciesId: 'emberbun', level: 2 });
      // Sam's squishy stays home: the land's guardians stand in.
      await grant(server, sam, mapId, { speciesId: 'puddlepuff', level: 5 });
      const { near } = await rivalTile(server, lee, sam, mapId, []);
      // The strongest land has a team of guardians, so some wait on the bench.
      const strongest = Math.max(...GUARDIAN_RULES.strengths.map((t) => t.strength));
      await db.execute(
        `update tiles set guardian_strength = ${String(strongest)} where id = '${uuid(near.id)}'`,
      );
      const started = battleOf(
        await call(server, 'POST', `/maps/${mapId}/attacks`, lee, { q: near.q, r: near.r }),
      );
      expect(started.kind).toBe('rival-tile');
      const done = await playOut(server, lee, started);
      expect(resultOf(done).winner).toBe('b');
      // At least one guardian never came out, and still nothing is paid on side b.
      expect(done.view.sides.b.squishies.some((s) => !s.joined)).toBe(true);
      const rewards = await rewardsOf(done.id);
      expect(rewards.b?.xp ?? []).toEqual([]);
    });

    it('pays the Keeper’s benched guard, in side b’s rewards', async () => {
      const server = await start();
      const [lee, sam] = [await player(), await player()];
      const mapId = await patch(server, lee, sam);
      await grant(server, lee, mapId, { speciesId: 'emberbun', level: 2 });
      const guard = await grant(server, sam, mapId, { speciesId: 'puddlepuff', level: 60 });
      const benched = await grant(server, sam, mapId, { speciesId: 'puddlepuff', level: 5 });
      clock.setTime(clock.getTime() + (TERRITORY_RULES.newPlayerShieldHours + 1) * HOUR_MS);
      // Sam holds the tile next to Lee's land, both on watch; Sam is offline.
      const tiles = await db.query.tiles.findMany({
        where: (t, { eq }) => eq(t.mapId, mapId),
        orderBy: (t, { asc }) => [asc(t.q), asc(t.r)],
      });
      const mine = new Set(tiles.filter((t) => t.ownerUserId === lee.id).map(hexKey));
      const near = tiles.find(
        (t) =>
          t.ownerUserId === null &&
          t.homeSlot === null &&
          hexNeighbors(t).some((n) => mine.has(hexKey(n))),
      )!;
      await db.execute(
        `update tiles set owner_user_id = '${uuid(sam.id)}' where id = '${uuid(near.id)}'`,
      );
      const watch = await call(server, 'POST', `/maps/${mapId}/defenders`, sam, {
        q: near.q,
        r: near.r,
        squishyIds: [guard.id, benched.id],
      });
      expect(watch.statusCode, watch.body).toBe(200);
      const before = await squishyOf(benched.id);

      const started = battleOf(
        await call(server, 'POST', `/maps/${mapId}/attacks`, lee, { q: near.q, r: near.r }),
      );
      expect(started.kind).toBe('rival-tile');
      const done = await playOut(server, lee, started);
      const result = resultOf(done);
      expect(result.winner).toBe('b');
      expect(done.view.sides.b.squishies.map((s) => s.joined)).toEqual([true, false]);
      const base = result.xp.find((x) => x.side === 'b' && x.squishyId === guard.id)!.xp;
      const rewards = await rewardsOf(done.id);
      expect(rewards.b!.userId).toBe(sam.id);
      const rows = rowsBy(rewards.b!.xp);
      expect(rows.get(guard.id)!.bench).toBeUndefined();
      const bench = rows.get(benched.id)!;
      expect(bench).toMatchObject({ bench: true });
      // Care × habitat on half the guard's base: never less, never past the cap.
      expect(bench.xp).toBeGreaterThanOrEqual(half(base));
      expect(bench.xp).toBeLessThanOrEqual(
        Math.floor((half(base) * GROWTH_RULES.capPercent) / 100),
      );
      expect(before.xp).toBe(0);
      // Its first XP counts from the start of its level (#205).
      expect((await squishyOf(benched.id)).xp).toBe(xpForLevel(5, GROWTH_RULES) + bench.xp);
      // `battle.ended` tells the defender, bench and all.
      expect((await endedOf(mapId, done.id)).defender?.xp).toEqual(
        expect.arrayContaining([{ squishyId: benched.id, xp: bench.xp }]),
      );
      // A held defence is a win for side b: the bench takes a slot.
      expect(await winsOf(mapId, [guard.id, benched.id])).toEqual({
        [guard.id]: 1,
        [benched.id]: 1,
      });
    });
  });
});
