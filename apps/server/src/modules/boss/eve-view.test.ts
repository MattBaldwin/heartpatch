import { MapViewSchema, type MapViewChristmasEve } from '@heartpatch/shared';
import { BOSS_EVENTS, type BossEventRules } from '@heartpatch/shared/server';
import { afterAll, afterEach, beforeAll, describe, expect, inject, it } from 'vitest';
import { createDbClient, type Database, type DbClient } from '../../db/client.js';
import { instantOfLocalDate } from '../../lib/time.js';
import { BOSS_RULES, bossHarness, type BossPlayer } from '../../../tests/boss.js';

// `MapView.christmas.eve` (#37 X5a): the notice, the chippers and the head
// start, and each Keeper's own thanks.
const EVE = BOSS_EVENTS.christmasEve!;
const HOUR_MS = 3_600_000;
// Denver is MST (UTC−7) all of late December.
const DENVER = (local: string) => new Date(`${local}-07:00`);

/** The shipped rules, the stand-in boss in the bag, and a bar a couple of wins fill. */
const SMALL_BAR: BossEventRules = {
  ...BOSS_RULES,
  christmasEve: { ...EVE, bar: { ...EVE.bar, goalPerKeeper: 50, minGoal: 100 } },
};
/** …and every befriend ask a "not yet", so the asks are there to count. */
const NEVER_JOINS: BossEventRules = {
  ...SMALL_BAR,
  befriend: { ...SMALL_BAR.befriend, basePercent: 0, perStandingPercent: 0, perMissPercent: 0 },
};
/** …or every ask a yes. */
const ALWAYS_JOINS: BossEventRules = {
  ...SMALL_BAR,
  befriend: { ...SMALL_BAR.befriend, basePercent: 100 },
};

const url = inject('testDatabaseUrl');

describe.skipIf(!url)('the Christmas Eve on the map (#37 X5a, needs DATABASE_URL)', () => {
  let client: DbClient;
  let db: Database;
  let h: ReturnType<typeof bossHarness>;

  beforeAll(() => {
    client = createDbClient(url!, { max: 8 });
    db = client.db;
    h = bossHarness(db, url!, 'xmas_view');
  });
  afterAll(() => client.close());
  afterEach(() => h.close());

  /** A patch of `n` Keepers (the first owns it), each with a grown team unless `grown` is false. */
  const patchOf = async (n: number, grown = true) => {
    const keepers: BossPlayer[] = [];
    for (let i = 0; i < n; i++) keepers.push(await h.player());
    const mapId = await h.patch(keepers[0]!);
    for (const [i, kid] of keepers.entries()) {
      if (i > 0) await h.join(mapId, keepers[0]!, kid);
      if (grown) await h.grow(mapId, kid, 20);
    }
    return { mapId, keepers };
  };
  const eveOf = async (
    who: BossPlayer,
    mapId: string,
  ): Promise<MapViewChristmasEve | undefined> => {
    const res = await h.call('GET', `/maps/${mapId}/view`, who);
    expect(res.statusCode, res.body).toBe(200);
    return MapViewSchema.parse(res.json()).christmas?.eve;
  };
  const readBoss = async (who: BossPlayer, mapId: string) => {
    const res = await h.call('GET', `/maps/${mapId}/boss`, who);
    expect(res.statusCode, res.body).toBe(200);
    return res.json<{ boss: { state: string; triesLeftToday: number } | null }>().boss;
  };
  const at = (date: Date) => h.clock.setTime(date.getTime());
  const toEve = async (mapId: string) => {
    at(DENVER('2026-12-24T16:01:00'));
    expect(await h.sweep([mapId])).toBe(1);
  };

  it('shows the notice from Dec 21 00:00 patch-local until 16:00 Dec 24, in every kind of zone', async () => {
    await h.start(SMALL_BAR);
    for (const zone of [
      'America/Denver',
      'Pacific/Kiritimati',
      'Pacific/Pago_Pago',
      'Asia/Kolkata',
    ]) {
      const local = (date: string, minute = 0) => instantOfLocalDate({ date, minute }, zone);
      at(DENVER('2026-12-01T12:00:00'));
      const { mapId, keepers } = await patchOf(1);
      await db.execute(`update maps set time_zone = '${zone}' where id = '${mapId}'`);
      const kid = keepers[0]!;
      const opensAt = local('2026-12-24', EVE.opensAtHour * 60).toISOString();

      at(new Date(local('2026-12-21').getTime() - 60_000));
      expect(await eveOf(kid, mapId), `${zone} Dec 20 23:59`).toBeUndefined();
      at(local('2026-12-21'));
      expect(await eveOf(kid, mapId), `${zone} Dec 21 00:00`).toEqual({ opensAt });
      at(new Date(local('2026-12-24', EVE.opensAtHour * 60).getTime() - 60_000));
      expect(await eveOf(kid, mapId), `${zone} Dec 24 15:59`).toEqual({ opensAt });
      // A plain read pins nothing: the notice changed nothing in the boss tables.
      expect(
        await db.query.bossWindows.findMany({ where: (t, { eq: is }) => is(t.mapId, mapId) }),
      ).toEqual([]);
    }
  }, 30_000);

  it('shows no notice on a patch with no Partner to fight it, nor with the switch closed', async () => {
    await h.start(SMALL_BAR);
    at(DENVER('2026-12-22T12:00:00'));
    const bare = await patchOf(1, false);
    expect(await eveOf(bare.keepers[0]!, bare.mapId)).toBeUndefined();
    await h.close();

    await h.start(SMALL_BAR, { miniBosses: 'off' });
    at(DENVER('2026-12-22T12:00:00'));
    const closed = await patchOf(1);
    expect(await eveOf(closed.keepers[0]!, closed.mapId)).toBeUndefined();
  });

  it('counts the Keepers who chipped in, never who', async () => {
    await h.start(SMALL_BAR);
    at(DENVER('2026-12-24T12:00:00'));
    const { mapId, keepers } = await patchOf(3);
    const [kid, mate] = keepers as [BossPlayer, BossPlayer, BossPlayer];
    await toEve(mapId);
    expect(await eveOf(kid, mapId)).toMatchObject({ chippers: 0, warmedUp: false });
    // A scoot (0 points) still chips in; two fights by one Keeper count once.
    await h.act(kid, await h.fight(kid, mapId), { type: 'forfeit' });
    await h.act(kid, await h.fight(kid, mapId), { type: 'forfeit' });
    expect(await eveOf(mate, mapId)).toMatchObject({ chippers: 1, chipped: 0 });
    await h.act(mate, await h.fight(mate, mapId), { type: 'forfeit' });
    const eve = (await eveOf(mate, mapId))!;
    expect(eve).toMatchObject({ chippers: 2 });
    expect(JSON.stringify(eve)).not.toContain(kid.id);
  });

  it('gives each contributor their own thanks when it falls: two asks, then one, then gone after 24 h', async () => {
    await h.start(NEVER_JOINS);
    at(DENVER('2026-12-24T12:00:00'));
    const { mapId, keepers } = await patchOf(3);
    const [kid, mate, watcher] = keepers as [BossPlayer, BossPlayer, BossPlayer];
    await toEve(mapId);
    const first = await h.playOut(kid, await h.fight(kid, mapId));
    at(DENVER('2026-12-24T16:30:00'));
    const won = await h.playOut(kid, await h.fight(kid, mapId));
    // Fell, but not paid yet: no thanks on the map (a plain read pays nothing).
    expect((await eveOf(kid, mapId))?.state).toBe('fell');
    expect((await eveOf(kid, mapId))?.thanks).toBeUndefined();
    await h.playOut(mate, await h.fight(mate, mapId));

    // The kid's /boss read pays theirs: on their map, with their latest fight.
    at(DENVER('2026-12-24T18:00:00'));
    await readBoss(kid, mapId);
    const thanks = (await eveOf(kid, mapId))?.thanks;
    expect(thanks).toEqual({
      kind: 'fell',
      items: EVE.fallBundle,
      asksLeft: EVE.fallAsks,
      battleId: won.id,
    });
    expect(won.id).not.toBe(first.id);
    // Another Keeper's view never carries it: the mate (paid by the sweep)
    // sees their own, and the watcher (who never fought) none.
    expect((await eveOf(mate, mapId))?.thanks).toBeUndefined();
    await h.sweep([mapId]);
    const mates = (await eveOf(mate, mapId))?.thanks;
    expect(mates?.battleId).not.toBe(won.id);
    expect(mates).toMatchObject({ kind: 'fell', asksLeft: EVE.fallAsks });
    expect((await eveOf(watcher, mapId))?.thanks).toBeUndefined();

    // The befriend route takes the ask on that battle; one ask left.
    const ask = await h.call('POST', `/battles/${thanks!.battleId}/befriend`, kid, { ask: 1 });
    expect(ask.statusCode, ask.body).toBe(200);
    expect((await eveOf(kid, mapId))?.thanks?.asksLeft).toBe(1);

    // Past the 10:00 close it's still there for the kid while the asks are
    // open, the bar with it; the watcher sees no Eve at all.
    at(DENVER('2026-12-25T11:00:00'));
    expect(await eveOf(kid, mapId)).toMatchObject({ state: 'fell', thanks: { asksLeft: 1 } });
    expect(await eveOf(watcher, mapId)).toBeUndefined();
    // 24 h from the thanks: gone.
    at(new Date(DENVER('2026-12-24T18:00:00').getTime() + 24 * HOUR_MS - 60_000));
    expect((await eveOf(kid, mapId))?.thanks?.asksLeft).toBe(1);
    at(new Date(DENVER('2026-12-24T18:00:00').getTime() + 24 * HOUR_MS));
    expect(await eveOf(kid, mapId)).toBeUndefined();
  });

  it('a dozed-off thanks shows its bundle and no asks, past the close, then goes', async () => {
    await h.start(SMALL_BAR);
    at(DENVER('2026-12-24T12:00:00'));
    const { mapId, keepers } = await patchOf(2);
    const kid = keepers[0]!;
    await toEve(mapId);
    const scoot = await h.act(kid, await h.fight(kid, mapId), { type: 'forfeit' });
    at(DENVER('2026-12-25T10:00:00'));
    await h.sweep([mapId]);
    const eve = await eveOf(kid, mapId);
    expect(eve).toMatchObject({ state: 'dozed', chippers: 1 });
    expect(eve?.thanks).toEqual({
      kind: 'dozed',
      items: EVE.dozedBundle,
      asksLeft: 0,
      battleId: scoot.id,
    });
    expect(await eveOf(keepers[1]!, mapId)).toBeUndefined();
    at(new Date(DENVER('2026-12-25T10:00:00').getTime() + 24 * HOUR_MS));
    expect(await eveOf(kid, mapId)).toBeUndefined();
  });

  it('once an Eve ask says yes, it is a friend: no tries shown and no fight started (★ #900 item 2)', async () => {
    await h.start(ALWAYS_JOINS);
    at(DENVER('2026-12-24T12:00:00'));
    const { mapId, keepers } = await patchOf(2);
    const kid = keepers[0]!;
    await toEve(mapId);
    await h.playOut(kid, await h.fight(kid, mapId));
    const won = await h.playOut(kid, await h.fight(kid, mapId));
    expect((await readBoss(kid, mapId))?.state).toBe('here');
    const ask = await h.call('POST', `/battles/${won.id}/befriend`, kid, { ask: 1 });
    expect(ask.json<{ outcome: string }>().outcome).toBe('joined');
    expect(await readBoss(kid, mapId)).toMatchObject({ state: 'friend', triesLeftToday: 0 });
    const start = await h.call('POST', `/maps/${mapId}/boss/battle`, kid);
    expect(start.statusCode).toBe(409);
    expect(start.json<{ error: { message: string } }>().error.message).toBe(
      'It’s your friend now! Thanks for helping. 💙',
    );
    // Its thanks says so too: no asks left.
    expect((await eveOf(kid, mapId))?.thanks).toMatchObject({ kind: 'fell', asksLeft: 0 });
  });
});
