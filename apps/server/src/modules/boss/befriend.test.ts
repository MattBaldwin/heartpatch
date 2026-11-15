import {
  BossBefriendResponseSchema,
  GAME_DATA,
  BossVisitResponseSchema,
  GROWTH_RULES,
  befriendedLevel,
  type PlayerBattle,
} from '@heartpatch/shared';
import { baseFormOf, type BossEventRules } from '@heartpatch/shared/server';
import { afterAll, afterEach, beforeAll, describe, expect, inject, it } from 'vitest';
import { createDbClient, type Database, type DbClient } from '../../db/client.js';
import { BOSS_RULES, STAND_IN_BOSS, bossHarness, type BossPlayer } from '../../../tests/boss.js';
import { EVOLUTION_STEPS } from '../care/service.js';
import { createBattlesService } from '../battles/service.js';
import { grantItems } from '../inventory/service.js';
import { createBossService, createMinibossBattlePort } from './service.js';

const url = inject('testDatabaseUrl');
const errorOf = (res: { json: () => unknown }) =>
  (res.json() as { error: { message: string } }).error.message;
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
const BASE = baseFormOf(STAND_IN_BOSS.id, EVOLUTION_STEPS);
const BASE_NAME = GAME_DATA.species.find((s) => s.id === BASE)!.name;

/** Rules whose every ask is a "not yet" until `sureAfterMisses` (chance 0 otherwise). */
const NEVER: BossEventRules = {
  ...BOSS_RULES,
  befriend: { ...BOSS_RULES.befriend, basePercent: 0, perStandingPercent: 0, perMissPercent: 0 },
};
const ALWAYS: BossEventRules = {
  ...BOSS_RULES,
  befriend: { ...BOSS_RULES.befriend, basePercent: 100 },
};

describe.skipIf(!url)('mini-boss befriending (#190c, needs DATABASE_URL)', () => {
  let client: DbClient;
  let db: Database;
  let h: ReturnType<typeof bossHarness>;

  beforeAll(() => {
    client = createDbClient(url!, { max: 10 });
    db = client.db;
    h = bossHarness(db, url!, 'befriend');
  });
  afterAll(() => client.close());
  afterEach(() => h.close());

  /** A Keeper on a fresh patch who just won a fight with the visiting boss. */
  async function winner(rules: BossEventRules) {
    await h.start(rules);
    const kid = await h.player();
    const mapId = await h.patch(kid);
    await h.grow(mapId, kid, 20);
    return { kid, mapId, battle: await winAgain(kid, mapId, rules) };
  }
  async function winAgain(kid: BossPlayer, mapId: string, rules: BossEventRules) {
    await h.toVisit(mapId, rules);
    const battle = await h.playOut(kid, await h.fight(kid, mapId));
    expect(battle.view.phase).toMatchObject({ type: 'over', result: { winner: 'a' } });
    return battle;
  }
  const ask = (kid: BossPlayer, battle: PlayerBattle, n: number) =>
    h.call('POST', `/battles/${battle.id}/befriend`, kid, { ask: n });
  const asked = async (kid: BossPlayer, battle: PlayerBattle, n: number) => {
    const res = await ask(kid, battle, n);
    expect(res.statusCode, res.body).toBe(200);
    return BossBefriendResponseSchema.parse(res.json());
  };
  const charms = (kid: BossPlayer, mapId: string) =>
    grantItems(db, { mapId, userId: kid.id }, { 'heart-charm': 3 }, 'dev-grant');
  const spent = async (kid: BossPlayer) =>
    db.query.resourceLedger.findMany({
      where: (t, { and, eq }) => and(eq(t.userId, kid.id), eq(t.reason, 'boss-befriend')),
    });
  const bond = async (kid: BossPlayer) =>
    db.query.bossBonds.findFirst({ where: (t, { eq }) => eq(t.userId, kid.id) });
  const asksOf = async (kid: BossPlayer) =>
    (
      await db.query.bossEncounters.findMany({
        where: (t, { eq }) => eq(t.userId, kid.id),
        orderBy: (t, { asc }) => asc(t.windowId),
      })
    ).flatMap((e) => e.asks as { ask: number; chance: number; roll: number; misses: number }[]);

  it('spends 3 charms and rolls once, in one transaction, and says "not yet"', async () => {
    const { kid, battle } = await winner(NEVER);
    expect(battle.boss).toMatchObject({ befriend: 'offer', asksLeft: 2, charmsPerAsk: 3 });

    const first = await asked(kid, battle, 1);
    expect(first.outcome).toBe('not-yet');
    expect(first.squishyId).toBeNull();
    expect(first.battle.boss).toMatchObject({ befriend: 'not-yet', asksLeft: 1 });
    // The bundle's 3 charms, ledgered against this battle.
    const ledger = await spent(kid);
    expect(ledger.map((l) => [l.itemId, l.delta, l.refId])).toEqual([
      ['heart-charm', -3, battle.id],
    ]);
    expect((await bond(kid))!.misses).toBe(1);
    // The roll is stored with what made it, so it can be explained and replayed.
    expect(await asksOf(kid)).toEqual([
      expect.objectContaining({ ask: 1, battleId: battle.id, chance: 0, misses: 0, standing: 3 }),
    ]);
  });

  it('with too few charms, writes nothing at all', async () => {
    const { kid, battle } = await winner(NEVER);
    await asked(kid, battle, 1); // the bundle's 3 are gone now
    const res = await ask(kid, battle, 2);
    expect(res.statusCode).toBe(409);
    expect(errorOf(res)).toMatch(/Heart Charm/);
    expect(await spent(kid)).toHaveLength(1);
    expect((await bond(kid))!.misses).toBe(1);
    expect(await asksOf(kid)).toHaveLength(1);
  });

  it('a double tap returns the stored answer and spends once', async () => {
    const { kid, mapId, battle } = await winner(NEVER);
    await charms(kid, mapId);
    const [a, b] = await Promise.all([ask(kid, battle, 1), ask(kid, battle, 1)]);
    expect([a.statusCode, b.statusCode]).toEqual([200, 200]);
    expect(BossBefriendResponseSchema.parse(a.json()).outcome).toBe('not-yet');
    expect(BossBefriendResponseSchema.parse(b.json()).outcome).toBe('not-yet');
    expect(await spent(kid)).toHaveLength(1);
    expect((await bond(kid))!.misses).toBe(1);
    // An ask that skips ahead is refused.
    const skip = await ask(kid, battle, 3);
    expect(skip.statusCode).toBe(409);
  });

  it('warms up with each "not yet", then stomps off after the last ask', async () => {
    const warm: BossEventRules = {
      ...NEVER,
      befriend: { ...NEVER.befriend, perMissPercent: 1 },
    };
    const { kid, mapId, battle } = await winner(warm);
    await charms(kid, mapId);
    await asked(kid, battle, 1);
    const second = await asked(kid, battle, 2);
    const [one, two] = await asksOf(kid);
    expect(one).toMatchObject({ misses: 0, chance: 0 });
    expect(two).toMatchObject({ misses: 1, chance: 1 });
    expect(second.outcome).toBe(two!.roll <= 1 ? 'joined' : 'not-yet');
    expect(second.battle.boss!.asksLeft).toBe(0);
    const third = await ask(kid, battle, 3);
    expect(third.statusCode).toBe(409);
  });

  it('carries warmth across visits; the sure ask joins the base form, once per Keeper', async () => {
    const sure: BossEventRules = {
      ...NEVER,
      befriend: { ...NEVER.befriend, sureAfterMisses: 2 },
    };
    const { kid, mapId, battle } = await winner(sure);
    await charms(kid, mapId);
    await asked(kid, battle, 1);
    await asked(kid, battle, 2);
    expect((await bond(kid))!.misses).toBe(2);

    // Next week's visit: the warmth is remembered, so the first ask always works.
    h.clock.setTime(h.clock.getTime() + WEEK_MS);
    const later = await winAgain(kid, mapId, sure);
    const yes = await asked(kid, later, 1);
    expect(yes.outcome).toBe('joined');
    expect(yes.battle.boss).toMatchObject({ befriend: 'joined', asksLeft: 0 });
    const friend = await db.query.squishies.findFirst({
      where: (t, { eq }) => eq(t.id, yes.squishyId!),
    });
    expect(friend).toMatchObject({
      ownerUserId: kid.id,
      speciesId: BASE,
      level: befriendedLevel(BASE, 10, EVOLUTION_STEPS, GROWTH_RULES),
    });
    expect(await bond(kid)).toMatchObject({ squishyId: friend!.id, misses: 2 });
    const seen = await db.query.speciesSeen.findFirst({
      where: (t, { and, eq }) => and(eq(t.userId, kid.id), eq(t.speciesId, BASE)),
    });
    expect(seen?.firstCaughtAt).not.toBeNull();
    const coins = await db.query.coinLedger.findMany({
      where: (t, { and, eq }) => and(eq(t.userId, kid.id), eq(t.source, 'capture')),
    });
    expect(coins.map((c) => [c.refId, c.amount])).toEqual([[later.id, 5]]);
    const captured = await db.query.gameEvents.findMany({
      where: (t, { and, eq }) => and(eq(t.mapId, mapId), eq(t.type, 'squishy.captured')),
    });
    expect(captured.map((e) => (e.payload as { squishyId: string }).squishyId)).toEqual([
      friend!.id,
    ]);
    const res = await h.call('GET', `/maps/${mapId}/boss`, kid);
    expect(BossVisitResponseSchema.parse(res.json()).boss!.state).toBe('friend');

    // One per Keeper per boss kind: the next win has no ask, and costs nothing.
    h.clock.setTime(h.clock.getTime() + WEEK_MS);
    const third = await winAgain(kid, mapId, sure);
    expect(third.boss).toMatchObject({ befriend: 'have-one', asksLeft: 0 });
    const again = await ask(kid, third, 1);
    expect(again.statusCode).toBe(409);
    expect(errorOf(again)).toBe(`You already have a ${BASE_NAME}! 💗`);
    expect(await spent(kid)).toHaveLength(3);
  });

  it('a yes is a yes when the odds say so', async () => {
    const { kid, battle } = await winner(ALWAYS);
    const yes = await asked(kid, battle, 1);
    expect(yes.outcome).toBe('joined');
    // A second ask after a yes finds them already friends.
    const more = await ask(kid, battle, 2);
    expect(more.statusCode).toBe(409);
  });

  it('sends a fresh yes live (publish after commit), never a replay or a "not yet"', async () => {
    const { kid, mapId, battle } = await winner(ALWAYS);
    // The app's boss service is private; this one shares its database and
    // records the publishes, as the battles and territory suites do.
    const published: string[] = [];
    const clock = () => h.clock;
    const service = createBossService({
      db,
      clock,
      rules: ALWAYS,
      battles: createBattlesService({ db, clock, minibosses: createMinibossBattlePort(ALWAYS) }),
      publish: (id) => {
        published.push(id);
        return Promise.resolve();
      },
    });
    const yes = await service.befriend(kid, battle.id, 1);
    expect(yes.outcome).toBe('joined');
    expect(published).toEqual([mapId]);
    // A double tap replays the stored answer: nothing new to send.
    const replay = await service.befriend(kid, battle.id, 1);
    expect(replay.squishyId).toBe(yes.squishyId);
    expect(published).toEqual([mapId]);

    const other = await winner(NEVER);
    const quiet = createBossService({
      db,
      clock,
      rules: NEVER,
      battles: createBattlesService({ db, clock, minibosses: createMinibossBattlePort(NEVER) }),
      publish: (id) => {
        published.push(id);
        return Promise.resolve();
      },
    });
    expect((await quiet.befriend(other.kid, other.battle.id, 1)).outcome).toBe('not-yet');
    expect(published).toEqual([mapId]);
  });

  it('rolls the charm spend back when the new friend can’t be written', async () => {
    const { kid, mapId, battle } = await winner(ALWAYS);
    // Only this patch's squishy inserts fail (the database is shared).
    const fn = `befriend_fail_${mapId.replaceAll('-', '_')}`;
    await db.execute(
      `create function ${fn}() returns trigger language plpgsql as $$ begin
         if new.map_id = '${mapId}' then raise exception 'no room'; end if; return new; end $$`,
    );
    await db.execute(
      `create trigger ${fn} before insert on squishies for each row execute function ${fn}()`,
    );
    try {
      const res = await ask(kid, battle, 1);
      expect(res.statusCode).toBe(500);
    } finally {
      await db.execute(`drop trigger ${fn} on squishies`);
      await db.execute(`drop function ${fn}()`);
    }
    expect(await spent(kid)).toHaveLength(0);
    const held = await db.query.inventories.findFirst({
      where: (t, { and, eq }) =>
        and(eq(t.mapId, mapId), eq(t.userId, kid.id), eq(t.itemId, 'heart-charm')),
    });
    expect(held?.quantity).toBe(3);
    expect(await asksOf(kid)).toEqual([]);
    expect((await bond(kid))?.befriendedAt ?? null).toBeNull();
    // Nothing was spent or stored, so the same ask works once it can.
    expect((await asked(kid, battle, 1)).outcome).toBe('joined');
  });

  it('only a won fight can be asked, only by its Keeper, and only for a day', async () => {
    await h.start(ALWAYS);
    const kid = await h.player();
    const mapId = await h.patch(kid);
    await h.grow(mapId, kid, 20);
    await h.toVisit(mapId);
    const going = await h.fight(kid, mapId);
    expect(going.boss).toMatchObject({ befriend: 'none', asksLeft: 0, charmsPerAsk: 3 });
    expect((await ask(kid, going, 1)).statusCode).toBe(409);
    const lost = await h.act(kid, going, { type: 'forfeit' });
    expect(lost.boss!.befriend).toBe('none');
    expect((await ask(kid, lost, 1)).statusCode).toBe(409);

    const won = await h.playOut(kid, await h.fight(kid, mapId));
    const stranger = await h.player();
    expect((await ask(stranger, won, 1)).statusCode).toBe(404);
    h.clock.setTime(h.clock.getTime() + 25 * HOUR_MS);
    const late = await ask(kid, won, 1);
    expect(late.statusCode).toBe(409);
    expect(await spent(kid)).toHaveLength(0);
  });
});
