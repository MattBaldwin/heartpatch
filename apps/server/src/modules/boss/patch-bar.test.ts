import {
  BossBefriendResponseSchema,
  BattleResponseSchema,
  MapViewSchema,
} from '@heartpatch/shared';
import { BOSS_EVENTS, type BossEventRules } from '@heartpatch/shared/server';
import { afterAll, afterEach, beforeAll, describe, expect, inject, it, vi } from 'vitest';
import {
  createDbClient,
  withTransaction,
  type Database,
  type DbClient,
  type Executor,
} from '../../db/client.js';
import { bossWindows, buildings, patchTrees } from '../../db/schema.js';
import type * as Drops from '../wardrobe/drops.js';
import { rollFoundDrop } from '../wardrobe/drops.js';
import { createBattlesRepo, type BattleRow } from '../battles/repo.js';
import { BOSS_RULES, STAND_IN_BOSS, bossHarness, type BossPlayer } from '../../../tests/boss.js';
import { thankKeeper } from './patch-bar.js';
import { createMinibossBattlePort } from './service.js';

// The finish's found-drop roll, passed through: the battle table holds only
// Halloween pieces, so a December roll finds nothing to see (#37 X2b).
vi.mock('../wardrobe/drops.js', async (original) => {
  const real = await original<typeof Drops>();
  return { ...real, rollFoundDrop: vi.fn(real.rollFoundDrop) };
});

// The Christmas Eve patch bar (#37 X2).
const EVE = BOSS_EVENTS.christmasEve!;
const WEEK = '2026-12-21';
// Denver is MST (UTC−7) all of late December.
const DENVER = (local: string) => new Date(`${local}-07:00`);

/** The shipped rules with the bar's numbers changed (the stand-in boss in the bag). */
const withBar = (bar: Partial<typeof EVE.bar>, more: Partial<typeof EVE> = {}): BossEventRules => ({
  ...BOSS_RULES,
  christmasEve: { ...EVE, ...more, bar: { ...EVE.bar, ...bar } },
});

/** The battle row as if its boss were tuckered out (a full win's points). */
const bossOut = (row: BattleRow): BattleRow => ({
  ...row,
  state: {
    ...row.state,
    sides: {
      ...row.state.sides,
      b: {
        ...row.state.sides.b,
        squishies: row.state.sides.b.squishies.map((s) => ({ ...s, energy: 0 })),
      },
    },
  },
});

const url = inject('testDatabaseUrl');

describe.skipIf(!url)('the Christmas Eve patch bar (#37 X2, needs DATABASE_URL)', () => {
  let client: DbClient;
  let db: Database;
  let h: ReturnType<typeof bossHarness>;

  beforeAll(() => {
    client = createDbClient(url!, { max: 12 });
    db = client.db;
    h = bossHarness(db, url!, 'xmas_bar');
  });
  afterAll(() => client.close());
  afterEach(() => h.close());

  /** A patch of `n` Keepers (the first owns it), each with a grown team. */
  const patchOf = async (n: number, partners: number[] = []) => {
    const keepers: BossPlayer[] = [];
    for (let i = 0; i < n; i++) keepers.push(await h.player());
    const mapId = await h.patch(keepers[0]!);
    for (const [i, kid] of keepers.entries()) {
      if (i > 0) await h.join(mapId, keepers[0]!, kid);
      await h.grow(mapId, kid, partners[i] ?? 20);
    }
    return { mapId, keepers };
  };
  const bar = async (mapId: string) =>
    (await db.query.bossBars.findFirst({
      where: (t, { and: all, eq: is }) => all(is(t.mapId, mapId), is(t.windowId, WEEK)),
    }))!;
  const chips = (mapId: string) =>
    db.query.bossBarChips.findMany({
      where: (t, { and: all, eq: is }) => all(is(t.mapId, mapId), is(t.windowId, WEEK)),
    });
  const eventsOf = async (mapId: string, type: string) =>
    db.query.gameEvents.findMany({
      where: (t, { and: all, eq: is }) => all(is(t.mapId, mapId), is(t.type, type)),
    });
  const battleOf = async (who: BossPlayer, battleId: string) => {
    const res = await h.call('GET', `/battles/${battleId}`, who);
    expect(res.statusCode, res.body).toBe(200);
    return BattleResponseSchema.parse(res.json()).battle;
  };
  const visit = async (who: BossPlayer, mapId: string) => {
    const res = await h.call('GET', `/maps/${mapId}/boss`, who);
    expect(res.statusCode, res.body).toBe(200);
    return res.json<{ boss: { triesLeftToday: number; state: string } | null }>().boss;
  };
  const thanksLedger = async (mapId: string, userId: string) =>
    db.query.resourceLedger.findMany({
      where: (t, { and: all, eq: is }) =>
        all(is(t.mapId, mapId), is(t.userId, userId), is(t.reason, 'christmas-boss')),
    });
  const toEve = async (mapId: string) => {
    h.clock.setTime(DENVER('2026-12-24T16:01:00').getTime());
    expect(await h.sweep([mapId])).toBe(1);
  };

  it('concurrent finishes add up exactly, and the bar falls once', async () => {
    // Five Keepers, goal 300: the third full win fills it, five land at once.
    const rules = withBar({ goalPerKeeper: 60, minGoal: 100 });
    await h.start(rules);
    h.clock.setTime(DENVER('2026-12-24T12:00:00').getTime());
    const { mapId, keepers } = await patchOf(5);
    await toEve(mapId);
    expect(await bar(mapId)).toMatchObject({ goal: 300, chipped: 0, state: 'open' });

    const repo = createBattlesRepo(db);
    const rows: BattleRow[] = [];
    for (const kid of keepers) rows.push((await repo.findBattle((await h.fight(kid, mapId)).id))!);
    const port = createMinibossBattlePort(rules);
    // Each finish in its own transaction, all at once: the bar's row lock serialises them.
    const results = await Promise.all(
      rows.map((row) => withTransaction(db, (tx) => port.ended(tx, bossOut(row), 'a', h.clock))),
    );
    const events = results.flat();
    expect(events.filter((e) => e.type === 'boss.chipped')).toHaveLength(5);
    expect(events.filter((e) => e.type === 'boss.fell')).toHaveLength(1);
    // Every chip saw the one before it: totals 100…500, each once.
    const totals = events.flatMap((e) =>
      e.type === 'boss.chipped' ? [(e.payload as { chipped: number }).chipped] : [],
    );
    expect(totals.sort((a, b) => a - b)).toEqual([100, 200, 300, 400, 500]);
    const after = await bar(mapId);
    expect(after).toMatchObject({ chipped: 500, state: 'fell' });
    expect(after.fellAt).not.toBeNull();
    expect(await chips(mapId)).toHaveLength(5);

    // A retried finish chips nothing (one chip per battle).
    expect(
      await withTransaction(db, (tx) => port.ended(tx, bossOut(rows[0]!), 'a', h.clock)),
    ).toEqual([]);
    expect((await bar(mapId)).chipped).toBe(500);
  });

  /** The weekly win bundle's ledger lines (`boss`) for this Keeper, by battle. */
  const bundleLedger = async (mapId: string, userId: string) =>
    db.query.resourceLedger.findMany({
      where: (t, { and: all, eq: is }) =>
        all(is(t.mapId, mapId), is(t.userId, userId), is(t.reason, 'boss')),
    });
  /** The finish's boss-drop rolls for this battle. */
  const bossRollsFor = (battleId: string) =>
    vi
      .mocked(rollFoundDrop)
      .mock.calls.filter(([, event]) => event.refId === battleId && event.boss === true);

  it('pays the weekly bundle and drop on a Keeper’s first Eve win only; later wins still chip (#37 X2b)', async () => {
    await h.start();
    h.clock.setTime(DENVER('2026-12-24T12:00:00').getTime());
    const { mapId, keepers } = await patchOf(2);
    const [kid, mate] = keepers as [BossPlayer, BossPlayer];
    await toEve(mapId);

    const first = await h.playOut(kid, await h.fight(kid, mapId));
    expect((await battleOf(kid, first.id)).rewards?.bundle).toEqual(BOSS_RULES.bundle);
    expect(bossRollsFor(first.id)).toHaveLength(1);

    const second = await h.playOut(kid, await h.fight(kid, mapId));
    const repeat = await battleOf(kid, second.id);
    expect((await createBattlesRepo(db).findBattle(second.id))?.result?.winner).toBe('a');
    // No bundle on the result card, in the bag or the ledger, and no drop…
    expect(repeat.rewards?.bundle).toBeNull();
    const ledger = await bundleLedger(mapId, kid.id);
    expect(new Set(ledger.map((l) => l.refId))).toEqual(new Set([first.id]));
    expect(Object.fromEntries(ledger.map((l) => [l.itemId, l.delta]))).toEqual(BOSS_RULES.bundle);
    expect(bossRollsFor(second.id)).toEqual([]);
    // …but it still chips the bar and counts as one of their fights.
    const mine = (await chips(mapId)).filter((c) => c.userId === kid.id);
    expect(mine.map((c) => c.battleId).sort()).toEqual([first.id, second.id].sort());
    expect(repeat.boss?.patchBar?.chipped).toBe((await bar(mapId)).chipped);

    // It's once per Keeper: the mate's first Eve win still pays.
    const theirs = await h.playOut(mate, await h.fight(mate, mapId));
    expect((await battleOf(mate, theirs.id)).rewards?.bundle).toEqual(BOSS_RULES.bundle);
    expect((await bundleLedger(mapId, mate.id)).every((l) => l.refId === theirs.id)).toBe(true);
  });

  it('two Eve wins by one Keeper finishing at once pay one bundle (#37 X2b)', async () => {
    await h.start();
    h.clock.setTime(DENVER('2026-12-24T12:00:00').getTime());
    const { mapId, keepers } = await patchOf(1);
    const kid = keepers[0]!;
    await toEve(mapId);
    // Two of the kid's Eve fights, set aside unfinished (only one can be
    // active at a time), then finished together as `finish` would: the
    // boss's `ended`, then `winPays`, then the battle row, one transaction each.
    const repo = createBattlesRepo(db);
    const rows: BattleRow[] = [];
    const closeOut = (tx: Executor, row: BattleRow, won: boolean) =>
      createBattlesRepo(tx).finish(row.id, {
        status: won ? 'finished' : 'no-contest',
        actions: [],
        state: row.state,
        result: won
          ? { winner: 'a', reason: 'tuckered-out', contentHash: row.contentHash, turns: 1, xp: [] }
          : null,
        log: [],
        rewards: null,
        endedAt: h.clock,
      });
    for (let i = 0; i < 2; i++) {
      const row = (await repo.findBattle((await h.fight(kid, mapId)).id))!;
      await closeOut(db, row, false);
      rows.push(row);
    }
    const port = createMinibossBattlePort(BOSS_RULES);
    // Both transactions open before either reaches the boss, and each holds
    // its read a moment before committing: without the bar's row lock both
    // would read "no earlier win" and both would pay.
    let arrive!: () => void;
    let arrived = 0;
    const together = new Promise<void>((done) => {
      arrive = () => {
        if (++arrived === 2) done();
      };
    });
    const pays = await Promise.all(
      rows.map((row) =>
        withTransaction(db, async (tx) => {
          await createBattlesRepo(tx).findBattle(row.id);
          arrive();
          await together;
          await port.ended(tx, bossOut(row), 'a', h.clock);
          const paid = await port.winPays(tx, row);
          await new Promise((settle) => setTimeout(settle, 100));
          await closeOut(tx, row, true);
          return paid;
        }),
      ),
    );
    expect(pays.filter(Boolean)).toHaveLength(1);
    expect(await chips(mapId)).toHaveLength(2);
  });

  it('normalises across boss energy: a win is 100 for a small Partner and a big one', async () => {
    await h.start();
    h.clock.setTime(DENVER('2026-12-24T12:00:00').getTime());
    const { mapId, keepers } = await patchOf(2, [6, 40]);
    await toEve(mapId);
    const repo = createBattlesRepo(db);
    const hp: number[] = [];
    for (const kid of keepers) {
      const done = await h.playOut(kid, await h.fight(kid, mapId));
      const row = (await repo.findBattle(done.id))!;
      expect(row.result?.winner, kid.username).toBe('a');
      hp.push(row.state.sides.b.squishies[0]!.stats.hp);
    }
    // Two different bosses (their level follows each Partner)…
    expect(hp[0]).toBeLessThan(hp[1]!);
    // …and the same points for each win, through the real finish.
    expect((await chips(mapId)).map((c) => c.points)).toEqual([100, 100]);
    expect((await bar(mapId)).chipped).toBe(200);
    expect(await eventsOf(mapId, 'boss.chipped')).toHaveLength(2);
  });

  it('gives a capped head start for lit lights and the star', async () => {
    await h.start();
    h.clock.setTime(DENVER('2026-12-24T12:00:00').getTime());
    const lit = async (mapId: string, owner: BossPlayer, lights: number, star: boolean) => {
      const tiles = await db.query.tiles.findMany({
        where: (t, { eq: is }) => is(t.mapId, mapId),
        limit: lights + 1,
      });
      for (const tile of tiles.slice(1, lights + 1)) {
        await db.insert(buildings).values({
          mapId,
          ownerUserId: owner.id,
          tileId: tile.id,
          buildingId: 'twinkle-lights',
          kind: 'lights',
          spot: 0,
        });
      }
      await db
        .insert(patchTrees)
        .values({ mapId, postTileId: tiles[0]!.id, starLitAt: star ? h.clock : null });
    };
    const many = await patchOf(1);
    await lit(many.mapId, many.keepers[0]!, 15, true);
    const few = await patchOf(1);
    await lit(few.mapId, few.keepers[0]!, 3, false);
    h.clock.setTime(DENVER('2026-12-24T16:01:00').getTime());
    expect(await h.sweep([many.mapId, few.mapId])).toBe(2);

    // 15 lights would be 30 %: capped at 20 %, plus 10 % for the star, of the 200 floor.
    expect(await bar(many.mapId)).toMatchObject({
      goal: 200,
      headStart: 60,
      chipped: 60,
      headStartLights: 15,
      headStartStar: true,
    });
    // 3 lights, 2 % each, no star.
    expect(await bar(few.mapId)).toMatchObject({ goal: 200, headStart: 12, headStartStar: false });
    // The map shows the bar with its head start, never the rule behind it.
    const res = await h.call('GET', `/maps/${many.mapId}/view`, many.keepers[0]!);
    const eve = MapViewSchema.parse(res.json()).christmas?.eve;
    expect(eve).toEqual({
      opensAt: DENVER('2026-12-24T16:00:00').toISOString(),
      state: 'open',
      chipped: 60,
      goal: 200,
    });
  });

  it('thanks each contributor once when it falls, with two asks, and fights after still count', async () => {
    // Three members, goal 150: two wins fill it; the third never fights.
    // Every ask a "not yet", so both asks are there to spend.
    const rules = withBar({ goalPerKeeper: 50, minGoal: 100 });
    const never: BossEventRules = {
      ...rules,
      befriend: { ...rules.befriend, basePercent: 0, perStandingPercent: 0, perMissPercent: 0 },
    };
    await h.start(never);
    h.clock.setTime(DENVER('2026-12-24T12:00:00').getTime());
    const { mapId, keepers } = await patchOf(3);
    const [kid, mate, watcher] = keepers as [BossPlayer, BossPlayer, BossPlayer];
    await toEve(mapId);
    const won = await h.playOut(kid, await h.fight(kid, mapId));
    // Before the fall: nothing to ask, and not the weekly "win first".
    expect((await battleOf(kid, won.id)).boss).toMatchObject({ befriend: 'none', asksLeft: 0 });
    const early = await h.call('POST', `/battles/${won.id}/befriend`, kid, { ask: 1 });
    expect(early.statusCode).toBe(409);
    expect(early.json<{ error: { message: string } }>().error.message).toBe(
      'Fill the patch bar together first, then ask!',
    );
    await h.playOut(mate, await h.fight(mate, mapId));
    expect(await bar(mapId)).toMatchObject({ chipped: 200, state: 'fell' });
    expect(await eventsOf(mapId, 'boss.fell')).toHaveLength(1);

    // The kid's read pays their thanks; reading again and the sweep pay nothing more.
    await visit(kid, mapId);
    await visit(kid, mapId);
    await h.sweep([mapId]);
    await h.sweep([mapId]);
    const thanked = await eventsOf(mapId, 'boss.thanked');
    // The mate is paid by the sweep without reading; the watcher never fought.
    expect(thanked.map((e) => (e.payload as { userId: string }).userId).sort()).toEqual(
      [kid.id, mate.id].sort(),
    );
    expect(thanked[0]!.payload).toMatchObject({ kind: 'fell', asks: EVE.fallAsks });
    const ledger = await thanksLedger(mapId, kid.id);
    const theBar = await bar(mapId);
    expect(ledger.every((l) => l.refId === theBar.id)).toBe(true);
    expect(Object.fromEntries(ledger.map((l) => [l.itemId, l.delta]))).toEqual(EVE.fallBundle);
    expect(await thanksLedger(mapId, watcher.id)).toEqual([]);

    // Two asks on the fall, the bar on the fight's view.
    const view = (await battleOf(kid, won.id)).boss!;
    expect(view).toMatchObject({
      befriend: 'offer',
      asksLeft: EVE.fallAsks,
      patchBar: { goal: 150, chipped: 200, state: 'fell' },
    });
    for (const ask of [1, 2]) {
      const res = await h.call('POST', `/battles/${won.id}/befriend`, kid, { ask });
      expect(res.statusCode, res.body).toBe(200);
      expect(BossBefriendResponseSchema.parse(res.json()).outcome).toBe('not-yet');
    }
    const third = await h.call('POST', `/battles/${won.id}/befriend`, kid, { ask: 3 });
    expect(third.statusCode).toBe(409);
    expect(third.json<{ error: { message: string } }>().error.message).not.toMatch(
      /next visit|another week|Win the battle/,
    );
    // A repeated ask answers as stored and spends nothing.
    const again = await h.call('POST', `/battles/${won.id}/befriend`, kid, { ask: 2 });
    expect(again.statusCode, again.body).toBe(200);

    // A fight after the fall still counts; no second fall, no second thanks.
    expect((await visit(kid, mapId))?.state).toBe('here');
    await h.playOut(kid, await h.fight(kid, mapId));
    expect(await bar(mapId)).toMatchObject({ chipped: 300, state: 'fell' });
    await visit(kid, mapId);
    expect(await eventsOf(mapId, 'boss.fell')).toHaveLength(1);
    expect(await eventsOf(mapId, 'boss.thanked')).toHaveLength(2);
  });

  it('a short bar dozes off at the close: a thanks bundle, no asks, nothing taken', async () => {
    await h.start();
    h.clock.setTime(DENVER('2026-12-24T12:00:00').getTime());
    const { mapId, keepers } = await patchOf(2);
    const [kid, mate] = keepers as [BossPlayer, BossPlayer];
    await toEve(mapId);
    // One win and one scoot (0 points, still a contributor): 100 of 240.
    const won = await h.playOut(kid, await h.fight(kid, mapId));
    await h.act(mate, await h.fight(mate, mapId), { type: 'forfeit' });
    expect((await chips(mapId)).map((c) => c.points).sort()).toEqual([0, 100]);
    expect(await bar(mapId)).toMatchObject({ goal: 240, chipped: 100, state: 'open' });

    // 09:59 Dec 25: still open, nobody thanked.
    h.clock.setTime(DENVER('2026-12-25T09:59:00').getTime());
    await h.sweep([mapId]);
    expect((await bar(mapId)).state).toBe('open');
    // 10:00: it dozes off, and both contributors are thanked once.
    h.clock.setTime(DENVER('2026-12-25T10:00:00').getTime());
    await h.sweep([mapId]);
    await h.sweep([mapId]);
    expect(await bar(mapId)).toMatchObject({ state: 'dozed', chipped: 100, fellAt: null });
    const thanked = await eventsOf(mapId, 'boss.thanked');
    expect(thanked).toHaveLength(2);
    for (const e of thanked) {
      expect(e.payload).toMatchObject({ kind: 'dozed', items: EVE.dozedBundle, asks: 0 });
    }
    expect(await eventsOf(mapId, 'boss.fell')).toEqual([]);
    // Every ledger line a gift: nothing taken.
    for (const who of [kid, mate]) {
      const ledger = await thanksLedger(mapId, who.id);
      expect(Object.fromEntries(ledger.map((l) => [l.itemId, l.delta]))).toEqual(EVE.dozedBundle);
    }
    // No asks after a doze, and never the weekly "win first" or "another week".
    expect((await battleOf(kid, won.id)).boss).toMatchObject({
      befriend: 'none',
      asksLeft: 0,
      patchBar: { state: 'dozed' },
    });
    const ask = await h.call('POST', `/battles/${won.id}/befriend`, kid, { ask: 1 });
    expect(ask.statusCode).toBe(409);
    expect(ask.json<{ error: { message: string } }>().error.message).toBe(
      'Fill the patch bar together first, then ask!',
    );
  });

  it('a fight finished after 10:00 Dec 25 neither chips nor makes a contributor', async () => {
    await h.start();
    h.clock.setTime(DENVER('2026-12-24T12:00:00').getTime());
    const { mapId, keepers } = await patchOf(2);
    const [kid, late] = keepers as [BossPlayer, BossPlayer];
    await toEve(mapId);
    await h.act(kid, await h.fight(kid, mapId), { type: 'forfeit' });
    // Christmas morning: three fresh tries after the Eve's three.
    h.clock.setTime(DENVER('2026-12-24T18:00:00').getTime());
    for (let i = 0; i < 2; i++) await h.act(kid, await h.fight(kid, mapId), { type: 'forfeit' });
    expect((await visit(kid, mapId))?.triesLeftToday).toBe(0);
    h.clock.setTime(DENVER('2026-12-25T00:00:00').getTime());
    expect((await visit(kid, mapId))?.triesLeftToday).toBe(BOSS_RULES.triesPerDay);
    // The late Keeper starts at 09:58 and finishes at 10:01, after the close.
    h.clock.setTime(DENVER('2026-12-25T09:58:00').getTime());
    const going = await h.fight(late, mapId);
    h.clock.setTime(DENVER('2026-12-25T10:00:00').getTime());
    await h.sweep([mapId]);
    h.clock.setTime(DENVER('2026-12-25T10:01:00').getTime());
    const ended = await h.act(late, going, { type: 'forfeit' });
    expect(ended.status).not.toBe('active');
    expect((await chips(mapId)).map((c) => c.userId)).toEqual([kid.id, kid.id, kid.id]);
    expect(
      (await eventsOf(mapId, 'boss.chipped')).filter(
        (e) => (e.payload as { userId: string }).userId === late.id,
      ),
    ).toEqual([]);
    await h.sweep([mapId]);
    const thanked = await eventsOf(mapId, 'boss.thanked');
    expect(thanked.map((e) => (e.payload as { userId: string }).userId)).toEqual([kid.id]);
    expect(await thanksLedger(mapId, late.id)).toEqual([]);
  });

  it('a fight finished just before the close but behind the doze still makes a contributor', async () => {
    const rules = BOSS_RULES;
    await h.start(rules);
    h.clock.setTime(DENVER('2026-12-24T12:00:00').getTime());
    const { mapId, keepers } = await patchOf(1);
    const kid = keepers[0]!;
    await toEve(mapId);
    const row = (await createBattlesRepo(db).findBattle((await h.fight(kid, mapId)).id))!;
    // The sweep dozed the bar first (as if it took the lock first at 10:00)…
    h.clock.setTime(DENVER('2026-12-25T10:00:00').getTime());
    await h.sweep([mapId]);
    expect((await bar(mapId)).state).toBe('dozed');
    // …and the finish stamped 09:59:59 reaches the bar after it.
    const at = DENVER('2026-12-25T09:59:59');
    const events = await withTransaction(db, (tx) =>
      createMinibossBattlePort(rules).ended(tx, bossOut(row), 'a', at),
    );
    expect(events.map((e) => e.type)).toEqual(['boss.chipped']);
    // The dozed bar never moves; the Keeper is thanked by the next sweep.
    expect(await bar(mapId)).toMatchObject({ state: 'dozed', chipped: 0 });
    await h.sweep([mapId]);
    expect(await eventsOf(mapId, 'boss.thanked')).toHaveLength(1);
  });

  it('two thanks at once pay one', async () => {
    const rules = withBar({ goalPerKeeper: 50, minGoal: 100 });
    await h.start(rules);
    h.clock.setTime(DENVER('2026-12-24T12:00:00').getTime());
    const { mapId, keepers } = await patchOf(1);
    const kid = keepers[0]!;
    await toEve(mapId);
    await h.playOut(kid, await h.fight(kid, mapId));
    expect((await bar(mapId)).state).toBe('fell');
    const fell = await bar(mapId);
    const paid = await Promise.all([
      thankKeeper(db, rules, fell, kid.id, h.clock),
      thankKeeper(db, rules, fell, kid.id, h.clock),
      h.sweep([mapId]),
    ]);
    expect(paid.filter((p) => p === true).length).toBeLessThanOrEqual(1);
    expect(await eventsOf(mapId, 'boss.thanked')).toHaveLength(1);
    const ledger = await thanksLedger(mapId, kid.id);
    expect(Object.fromEntries(ledger.map((l) => [l.itemId, l.delta]))).toEqual(EVE.fallBundle);
  });

  it('keys tries by window: weekly tries on Dec 24 morning leave the Eve’s three', async () => {
    await h.start();
    h.clock.setTime(DENVER('2026-12-21T12:00:00').getTime());
    const { mapId, keepers } = await patchOf(1);
    const kid = keepers[0]!;
    // A weekly visit pinned before X1 shipped, overlapping Christmas Eve.
    await db.insert(bossWindows).values({
      mapId,
      windowId: WEEK,
      speciesId: STAND_IN_BOSS.id,
      q: 0,
      r: 0,
      opensAt: DENVER('2026-12-23T16:00:00'),
      endsAt: DENVER('2026-12-25T16:00:00'),
      kind: 'weekly',
    });
    h.clock.setTime(DENVER('2026-12-24T10:00:00').getTime());
    for (let i = 0; i < 3; i++) {
      await h.act(kid, await h.fight(kid, mapId), { type: 'forfeit' });
    }
    expect((await visit(kid, mapId))?.triesLeftToday).toBe(0);
    h.clock.setTime(DENVER('2026-12-24T16:05:00').getTime());
    expect(await h.sweep([mapId])).toBe(1);
    // The Eve's own three, though it's still Dec 24 patch-local.
    expect((await visit(kid, mapId))?.triesLeftToday).toBe(BOSS_RULES.triesPerDay);
    // The morning's weekly fights chipped nothing.
    expect(await chips(mapId)).toEqual([]);
    const fight = await h.fight(kid, mapId);
    expect((await battleOf(kid, fight.id)).boss?.triesLeftToday).toBe(BOSS_RULES.triesPerDay - 1);
  });

  it('dev route: a Christmas Eve visit from now with a fresh bar (dev tools only)', async () => {
    await h.start(BOSS_RULES, { devTools: true });
    h.clock.setTime(DENVER('2026-11-18T12:00:00').getTime());
    const { mapId, keepers } = await patchOf(1);
    const kid = keepers[0]!;
    const res = await h.call('POST', `/maps/${mapId}/dev/christmas-eve-now`, kid);
    expect(res.statusCode, res.body).toBe(200);
    const hours = 24 - EVE.opensAtHour + EVE.closesAtHour;
    expect(res.json()).toEqual({
      window: '2026-11-16',
      opensAt: h.clock.toISOString(),
      closesAt: new Date(h.clock.getTime() + hours * 3_600_000).toISOString(),
    });
    const boss = (await visit(kid, mapId)) as { event?: { kind: string } } | null;
    expect(boss?.event?.kind).toBe('christmas-eve');
    const done = await h.playOut(kid, await h.fight(kid, mapId));
    expect((await battleOf(kid, done.id)).boss?.patchBar).toMatchObject({ goal: 200 });
    // Again: a fresh bar, the chips gone.
    expect((await h.call('POST', `/maps/${mapId}/dev/christmas-eve-now`, kid)).statusCode).toBe(
      200,
    );
    const fresh = await db.query.bossBars.findFirst({
      where: (t, { eq: is }) => is(t.mapId, mapId),
    });
    expect(fresh).toMatchObject({ chipped: 0, state: 'open' });
  });

  it('the map shows no Eve while the mini-boss switch is closed (it follows /boss)', async () => {
    await h.start(BOSS_RULES, { miniBosses: 'off' });
    h.clock.setTime(DENVER('2026-12-24T12:00:00').getTime());
    const { mapId, keepers } = await patchOf(1);
    // As if pinned while the switch was open.
    await db.insert(bossWindows).values({
      mapId,
      windowId: WEEK,
      speciesId: STAND_IN_BOSS.id,
      q: 0,
      r: 0,
      opensAt: DENVER('2026-12-24T16:00:00'),
      endsAt: DENVER('2026-12-25T10:00:00'),
      kind: 'christmas-eve',
    });
    h.clock.setTime(DENVER('2026-12-24T17:00:00').getTime());
    const res = await h.call('GET', `/maps/${mapId}/view`, keepers[0]!);
    expect(res.statusCode, res.body).toBe(200);
    expect(MapViewSchema.parse(res.json()).christmas?.eve).toBeUndefined();
    expect(await visit(keepers[0]!, mapId)).toBeNull();
  });

  it('dev route: not there without dev tools', async () => {
    await h.start();
    const { mapId, keepers } = await patchOf(1);
    const res = await h.call('POST', `/maps/${mapId}/dev/christmas-eve-now`, keepers[0]!);
    expect(res.statusCode).toBe(404);
  });
});
