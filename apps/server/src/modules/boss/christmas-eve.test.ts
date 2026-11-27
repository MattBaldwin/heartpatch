import {
  BossVisitResponseSchema,
  GAME_DATA,
  MapViewSchema,
  replayBattle,
} from '@heartpatch/shared';
import { BOSS_EVENTS, bossWeekOf, type BossEventRules } from '@heartpatch/shared/server';
import { afterAll, afterEach, beforeAll, describe, expect, inject, it } from 'vitest';
import { createDbClient, type Database, type DbClient } from '../../db/client.js';
import { bossEncounters, bossWindows } from '../../db/schema.js';
import { canonicalTimeZone, localDate, mapLocalTime } from '../../lib/time.js';
import { createBattlesRepo, setupOf } from '../battles/repo.js';
import { createBossRepo } from './repo.js';
import { defaultBattleContent } from '../battles/service.js';
import { BOSS_RULES, BOSS_TEAM, STAND_IN_BOSS, bossHarness } from '../../../tests/boss.js';
import { createMinibossBattlePort, plannedBossVisit } from './service.js';

// The Christmas Eve visit (#37 X1).
const EVE = BOSS_EVENTS.christmasEve!;

describe('the Christmas Eve visit in every zone (#37 X1)', () => {
  const zones = [...new Set(Intl.supportedValuesOf('timeZone').map(canonicalTimeZone))].filter(
    (z): z is string => z !== null,
  );

  it('pins 16:00 Dec 24 to 10:00 Dec 25 patch-local, either side of the date line', () => {
    expect(zones).toEqual(expect.arrayContaining(['Pacific/Kiritimati', 'Pacific/Pago_Pago']));
    for (const year of ['2026', '2028']) {
      const week = bossWeekOf(`${year}-12-24`);
      for (const timeZone of zones) {
        const plan = plannedBossVisit(
          { seed: 'seed', timeZone, longNightWeekday: 4 },
          week,
          BOSS_RULES,
        );
        expect(plan?.kind, timeZone).toBe('christmas-eve');
        expect(mapLocalTime(plan!.opensAt, timeZone), timeZone).toEqual({
          date: `${year}-12-24`,
          minute: EVE.opensAtHour * 60,
        });
        expect(mapLocalTime(plan!.endsAt, timeZone), timeZone).toEqual({
          date: `${year}-12-25`,
          minute: EVE.closesAtHour * 60,
        });
      }
    }
  });

  it('pins the weekly bag draw the weeks around it', () => {
    for (const week of ['2026-12-14', '2026-12-28', '2028-12-25']) {
      expect(
        plannedBossVisit(
          { seed: 'seed', timeZone: 'Pacific/Kiritimati', longNightWeekday: 4 },
          week,
          BOSS_RULES,
        )?.kind,
      ).toBe('weekly');
    }
  });
});

const url = inject('testDatabaseUrl');

describe.skipIf(!url)('the Christmas Eve visit (#37 X1, needs DATABASE_URL)', () => {
  let client: DbClient;
  let db: Database;
  let h: ReturnType<typeof bossHarness>;

  beforeAll(() => {
    client = createDbClient(url!, { max: 10 });
    db = client.db;
    h = bossHarness(db, url!, 'xmas_eve');
  });
  afterAll(() => client.close());
  afterEach(() => h.close());

  // Denver is MST (UTC−7) all of late December.
  const DENVER = (local: string) => new Date(`${local}-07:00`);
  const visitOf = async (who: Awaited<ReturnType<typeof h.player>>, mapId: string) => {
    const res = await h.call('GET', `/maps/${mapId}/boss`, who);
    expect(res.statusCode, res.body).toBe(200);
    return BossVisitResponseSchema.parse(res.json()).boss;
  };
  const eveOf = async (who: Awaited<ReturnType<typeof h.player>>, mapId: string) => {
    const res = await h.call('GET', `/maps/${mapId}/view`, who);
    expect(res.statusCode, res.body).toBe(200);
    return MapViewSchema.parse(res.json()).christmas?.eve;
  };
  const windowRow = async (mapId: string, windowId: string) =>
    db.query.bossWindows.findFirst({
      where: (t, { and: all, eq: is }) => all(is(t.mapId, mapId), is(t.windowId, windowId)),
    });

  it('opens for a patch made that afternoon, with the gates lowered for it only', async () => {
    await h.start();
    // A brand-new patch on Christmas Eve afternoon, its Partner small.
    h.clock.setTime(DENVER('2026-12-24T15:30:00').getTime());
    const owner = await h.player();
    const mapId = await h.patch(owner);
    await h.grow(mapId, owner, 6);

    // Before 16:00: nothing out, nothing on the map.
    expect(await visitOf(owner, mapId)).toBeNull();
    expect(await eveOf(owner, mapId)).toBeUndefined();

    h.clock.setTime(DENVER('2026-12-24T16:01:00').getTime());
    expect(await h.sweep([mapId])).toBe(1);
    const visit = (await visitOf(owner, mapId))!;
    const closesAt = DENVER('2026-12-25T10:00:00').toISOString();
    expect(visit.window).toEqual({ id: '2026-12-21', endsAt: closesAt });
    expect(visit.event).toEqual({ kind: 'christmas-eve', gatesLowered: true, closesAt });
    // Partner 6: under the weekly 12, over the Eve's 5.
    expect(visit.state).toBe('here');
    expect(await eveOf(owner, mapId)).toEqual({
      opensAt: DENVER('2026-12-24T16:00:00').toISOString(),
    });
    const row = (await windowRow(mapId, '2026-12-21'))!;
    expect(row.kind).toBe('christmas-eve');
    // Until X3 lands the species, the week's bag boss stands in.
    expect(EVE.speciesId).toBeNull();
    expect(row.speciesId).toBe(STAND_IN_BOSS.id);

    // The fight's boss level: Partner + 2, floored at the Eve's 10.
    const battle = await h.fight(owner, mapId);
    expect(battle.view.sides.b.squishies[0]!.level).toBe(
      Math.max(EVE.gates.minLevel, 6 + EVE.gates.levelBonus),
    );
    const ended = await h.playOut(owner, battle);
    expect(ended.status).not.toBe('active');
    // A stored Eve fight replays unchanged.
    const stored = (await createBattlesRepo(db).findBattle(battle.id))!;
    expect(replayBattle(defaultBattleContent(), setupOf(stored), stored.actions)).toEqual(
      stored.state,
    );

    // 10:00 Dec 25: it's gone, from the map too.
    h.clock.setTime(DENVER('2026-12-25T10:00:00').getTime());
    expect(await visitOf(owner, mapId)).toBeNull();
    expect(await eveOf(owner, mapId)).toBeUndefined();

    // The week after: the weekly bag again, gates and all (Partner 6 can't open it).
    await h.grow(mapId, owner, 20);
    h.clock.setTime(DENVER('2026-12-28T12:00:00').getTime());
    await h.toVisit(mapId);
    const weekly = (await visitOf(owner, mapId))!;
    expect(weekly.window.id).toBe('2026-12-28');
    expect(weekly.event).toBeUndefined();
    expect((await windowRow(mapId, '2026-12-28'))!.kind).toBe('weekly');
    expect(await eveOf(owner, mapId)).toBeUndefined();
  });

  it('keeps weekly gates on a weekly visit: too small stays too big', async () => {
    await h.start();
    h.clock.setTime(DENVER('2026-12-14T12:00:00').getTime());
    const owner = await h.player();
    const small = await h.player();
    const mapId = await h.patch(owner);
    await h.join(mapId, owner, small);
    await h.grow(mapId, owner, 20);
    await h.grow(mapId, small, 6);
    await h.toVisit(mapId);
    const visit = (await visitOf(small, mapId))!;
    expect(visit.state).toBe('too-big');
    expect(visit.event).toBeUndefined();
    expect('event' in visit).toBe(false);
  });

  it('uses the Christmas species once it lands', async () => {
    const frost = GAME_DATA.species.find(
      (s) => s.id !== BOSS_TEAM.id && s.id !== STAND_IN_BOSS.id,
    )!;
    const rules: BossEventRules = { ...BOSS_RULES, christmasEve: { ...EVE, speciesId: frost.id } };
    await h.start(rules);
    h.clock.setTime(DENVER('2026-12-24T17:00:00').getTime());
    const owner = await h.player();
    const mapId = await h.patch(owner);
    await h.grow(mapId, owner, 6);
    expect((await visitOf(owner, mapId))?.event?.kind).toBe('christmas-eve');
    expect((await windowRow(mapId, '2026-12-21'))!.speciesId).toBe(frost.id);
  });

  it('converts a weekly visit already pinned in the Eve’s week when the Eve opens', async () => {
    await h.start();
    h.clock.setTime(DENVER('2026-12-21T12:00:00').getTime());
    const owner = await h.player();
    const mapId = await h.patch(owner);
    await h.grow(mapId, owner, 20);
    // As if pinned before X1 shipped: a weekly row overlapping Christmas Eve.
    await db.insert(bossWindows).values({
      mapId,
      windowId: '2026-12-21',
      speciesId: STAND_IN_BOSS.id,
      q: 0,
      r: 0,
      opensAt: DENVER('2026-12-23T16:00:00'),
      endsAt: DENVER('2026-12-25T16:00:00'),
      kind: 'weekly',
    });
    await db.insert(bossEncounters).values({
      mapId,
      userId: owner.id,
      windowId: '2026-12-21',
      createdAt: DENVER('2026-12-23T17:00:00'),
      lastActionAt: DENVER('2026-12-23T17:05:00'),
      asks: [{ ask: 1 }],
    });
    // Before the Eve opens, the weekly visit stays out as pinned.
    h.clock.setTime(DENVER('2026-12-24T12:00:00').getTime());
    expect((await visitOf(owner, mapId))?.event).toBeUndefined();

    h.clock.setTime(DENVER('2026-12-24T16:05:00').getTime());
    expect(await h.sweep([mapId])).toBe(1);
    const row = (await windowRow(mapId, '2026-12-21'))!;
    // The weekly opening stays, so the week's fights still belong to this row.
    expect(row).toMatchObject({
      kind: 'christmas-eve',
      opensAt: DENVER('2026-12-23T16:00:00'),
      endsAt: DENVER('2026-12-25T10:00:00'),
      q: 0,
      r: 0,
    });
    const fought = await createBossRepo(db).visitOf(mapId, DENVER('2026-12-23T17:00:00'));
    expect(fought?.windowId).toBe('2026-12-21');
    // Its weekly goes are reset (the idle clock kept), so the Keeper meets the Eve fresh.
    const goes = await db.query.bossEncounters.findMany({
      where: (t, { and: all, eq: is }) => all(is(t.mapId, mapId), is(t.windowId, '2026-12-21')),
    });
    expect(goes).toHaveLength(1);
    expect(goes[0]).toMatchObject({
      wonBattleId: null,
      asks: [],
      lastActionAt: DENVER('2026-12-23T17:05:00'),
    });
    expect((await visitOf(owner, mapId))?.state).toBe('here');
    expect((await visitOf(owner, mapId))?.event?.kind).toBe('christmas-eve');
    // The map shows the Eve's own opening, not the weekly one.
    expect(await eveOf(owner, mapId)).toEqual({
      opensAt: DENVER('2026-12-24T16:00:00').toISOString(),
    });
    // Once: a second sweep has nothing new.
    expect(await h.sweep([mapId])).toBe(0);
    const appeared = await db.query.gameEvents.findMany({
      where: (t, { and: all, eq: is }) => all(is(t.mapId, mapId), is(t.type, 'boss.appeared')),
    });
    expect(appeared).toHaveLength(1);
  });

  it('keeps a weekly fight going across the conversion (its idle clock stays)', async () => {
    await h.start();
    h.clock.setTime(DENVER('2026-12-21T12:00:00').getTime());
    const owner = await h.player();
    const mapId = await h.patch(owner);
    // An even team, so one step doesn't end the fight.
    await h.grow(mapId, owner, 20, [20, 20]);
    await db.insert(bossWindows).values({
      mapId,
      windowId: '2026-12-21',
      speciesId: STAND_IN_BOSS.id,
      q: 0,
      r: 0,
      opensAt: DENVER('2026-12-23T16:00:00'),
      endsAt: DENVER('2026-12-25T16:00:00'),
      kind: 'weekly',
    });
    // The fight starts on the weekly visit at 15:50 and steps at 15:58…
    h.clock.setTime(DENVER('2026-12-24T15:50:00').getTime());
    let battle = await h.fight(owner, mapId);
    const step = async () => {
      const side = battle.view.sides.a;
      const picks = (side.out ?? [])
        .filter((slot) => side.squishies[slot]!.energy > 0)
        .map((slot) => ({ slot, move: side.squishies[slot]!.moves[0]! }));
      battle = await h.act(owner, battle, { type: 'team', picks });
    };
    h.clock.setTime(DENVER('2026-12-24T15:58:00').getTime());
    await step();
    expect(battle.status).toBe('active');
    // …the Eve converts the row at 16:01…
    h.clock.setTime(DENVER('2026-12-24T16:01:00').getTime());
    expect(await h.sweep([mapId])).toBe(1);
    // …and a step at 16:05 is 7 minutes after the last one, not 15 after the
    // start: no leave (`idleMinutes` 10), the fight goes on.
    h.clock.setTime(DENVER('2026-12-24T16:05:00').getTime());
    await step();
    const stored = (await createBattlesRepo(db).findBattle(battle.id))!;
    expect(stored.actions.some((a) => a.type === 'forfeit')).toBe(false);
    // The weekly fight still belongs to the converted row.
    expect((await createBossRepo(db).visitOf(mapId, stored.startedAt))?.windowId).toBe(
      '2026-12-21',
    );
    // Won after 16:00, it's still the weekly fight's win: the Keeper hasn't
    // met the Eve boss, so the Eve stays `here` for them.
    await createMinibossBattlePort(BOSS_RULES).ended(db, stored, 'a', h.clock);
    const go = await db.query.bossEncounters.findFirst({
      where: (t, { and: all, eq: is }) =>
        all(is(t.mapId, mapId), is(t.userId, owner.id), is(t.windowId, '2026-12-21')),
    });
    expect(go?.wonBattleId).toBeNull();
    expect((await visitOf(owner, mapId))?.state).toBe('here');
  });

  it('stays out Christmas morning when the Eve is a Sunday (2028), then the bag resumes', async () => {
    await h.start();
    h.clock.setTime(DENVER('2028-12-24T16:30:00').getTime());
    // The harness's session lasts 30 real days: stretch it to 2029.
    const owner = await h.player(new Date('2029-01-31T00:00:00Z'));
    const mapId = await h.patch(owner);
    await h.grow(mapId, owner, 20);
    expect((await visitOf(owner, mapId))?.window.id).toBe('2028-12-18');

    // Monday Dec 25, 09:00: a new boss week, the Eve visit still out.
    h.clock.setTime(DENVER('2028-12-25T09:00:00').getTime());
    expect(localDate(h.clock, 'America/Denver')).toBe('2028-12-25');
    const morning = (await visitOf(owner, mapId))!;
    expect(morning.window.id).toBe('2028-12-18');
    expect(morning.event?.kind).toBe('christmas-eve');
    expect(await h.sweep([mapId])).toBe(0);

    // From 10:00 it's the new week's bag draw.
    h.clock.setTime(DENVER('2028-12-25T10:00:00').getTime());
    expect((await visitOf(owner, mapId))?.event).toBeUndefined();
    await h.toVisit(mapId);
    const weekly = (await visitOf(owner, mapId))!;
    expect(weekly.window.id).toBe('2028-12-25');
    expect(weekly.event).toBeUndefined();
  });
});
