import { BossBefriendResponseSchema, PlayerBattleBossSchema } from '@heartpatch/shared';
import type { BossEventRules } from '@heartpatch/shared/server';
import { afterAll, afterEach, beforeAll, describe, expect, inject, it } from 'vitest';
import { createDbClient, type Database, type DbClient } from '../../db/client.js';
import type { GameEvent } from '../../db/game-events.js';
import { BOSS_RULES, STAND_IN_BOSS, bossHarness } from '../../../tests/boss.js';
import { PUBLIC_VIEWS, publicViewFor } from '../../ws/public-views.js';

const url = inject('testDatabaseUrl');

/**
 * Words that would give away the odds, the warmth or the schedule (CLAUDE.md
 * rule 6): none may appear as a key in anything a client is sent. (A finished
 * battle's `seed` is public by design, tech spec §8; the ask's roll also
 * takes the server-only patch seed, so it can't be predicted from it.)
 */
const SECRET_KEYS = [
  'chance',
  'roll',
  'misses',
  'warmth',
  'standing',
  'basePercent',
  'perStandingPercent',
  'perMissPercent',
  'sureAfterMisses',
  'bag',
  'opensAt',
  'opensOn',
  'minPartnerLevel',
  'minPlayerLevel',
];

/** Every key anywhere in a JSON value. */
function keysOf(value: unknown, into = new Set<string>()): Set<string> {
  if (Array.isArray(value)) for (const item of value) keysOf(item, into);
  else if (value && typeof value === 'object') {
    for (const [key, inner] of Object.entries(value)) {
      into.add(key);
      keysOf(inner, into);
    }
  }
  return into;
}
const leaks = (value: unknown) => SECRET_KEYS.filter((k) => keysOf(value).has(k));

// Half the asks miss and half join at most: either way, nothing may show why.
const COIN_FLIP: BossEventRules = {
  ...BOSS_RULES,
  befriend: { ...BOSS_RULES.befriend, basePercent: 50, perStandingPercent: 0 },
};

describe.skipIf(!url)('mini-boss secrets stay on the server (#190c, needs DATABASE_URL)', () => {
  let client: DbClient;
  let db: Database;
  let h: ReturnType<typeof bossHarness>;

  beforeAll(() => {
    client = createDbClient(url!, { max: 10 });
    db = client.db;
    h = bossHarness(db, url!, 'bossleak');
  });
  afterAll(() => client.close());
  afterEach(() => h.close());

  it('no route or live event carries an unmet boss, its odds, warmth or schedule', async () => {
    await h.start(COIN_FLIP);
    const kid = await h.player();
    const mapId = await h.patch(kid);
    await h.grow(mapId, kid, 20);
    const sent: unknown[] = [];
    const get = async (path: string) => {
      const res = await h.call('GET', path, kid);
      expect(res.statusCode, res.body).toBe(200);
      sent.push(res.json());
      return res.json<Record<string, unknown>>();
    };

    await h.toVisit(mapId, COIN_FLIP);
    // Before the fight, the boss is a "?!": no name anywhere.
    const before = await get(`/maps/${mapId}/boss`);
    expect(JSON.stringify(before)).not.toContain(STAND_IN_BOSS.id);

    const started = await h.fight(kid, mapId);
    const won = await h.playOut(kid, started);
    sent.push(started, won);
    // The fight's own view: exactly the documented fields, never a number behind the odds.
    expect(Object.keys(won.boss!).sort()).toEqual(Object.keys(PlayerBattleBossSchema.shape).sort());
    // Met now (marked seen at the start): the marker names it.
    expect((await get(`/maps/${mapId}/boss`))['boss']).toMatchObject({ species: STAND_IN_BOSS.id });

    await grantCharms();
    for (const n of [1, 2]) {
      const res = await h.call('POST', `/battles/${won.id}/befriend`, kid, { ask: n });
      if (res.statusCode !== 200) break; // a yes on the first ask: no second
      sent.push(BossBefriendResponseSchema.parse(res.json()));
    }
    sent.push(await get(`/battles/${won.id}`));

    for (const reply of sent) expect(leaks(reply), JSON.stringify(reply)).toEqual([]);

    // Every live event this patch got, as each member would be sent it.
    const events: GameEvent[] = await db.query.gameEvents.findMany({
      where: (t, { eq }) => eq(t.mapId, mapId),
    });
    expect(events.map((e) => e.type)).toContain('boss.appeared');
    for (const event of events) {
      const shown = publicViewFor(PUBLIC_VIEWS, event, { userId: kid.id });
      expect(leaks(shown), `${event.type}: ${JSON.stringify(shown)}`).toEqual([]);
    }

    async function grantCharms() {
      const { grantItems } = await import('../inventory/service.js');
      await grantItems(db, { mapId, userId: kid.id }, { 'heart-charm': 3 }, 'dev-grant');
    }
  });

  it('a patch-mate who never fought it is never told which boss it is', async () => {
    // Every ask a yes, so the patch gets `squishy.captured` too.
    const sure: BossEventRules = {
      ...COIN_FLIP,
      befriend: { ...COIN_FLIP.befriend, basePercent: 100 },
    };
    await h.start(sure);
    const kid = await h.player();
    const mate = await h.player();
    const mapId = await h.patch(kid);
    await h.join(mapId, kid, mate);
    await h.grow(mapId, kid, 20);
    // Big enough to fight (a Keeper too small for it is shown its name, plan §2).
    await h.grow(mapId, mate, 20);
    await h.toVisit(mapId, sure);
    const won = await h.playOut(kid, await h.fight(kid, mapId));
    const yes = await h.call('POST', `/battles/${won.id}/befriend`, kid, { ask: 1 });
    expect(BossBefriendResponseSchema.parse(yes.json()).outcome).toBe('joined');

    const res = await h.call('GET', `/maps/${mapId}/boss`, mate);
    expect(res.statusCode, res.body).toBe(200);
    const body = res.json<{ boss: { species: string | null } }>();
    expect(body.boss.species).toBeNull();
    expect(leaks(body)).toEqual([]);

    // The patch's live events as the mate is sent them, the new friend's included.
    const events: GameEvent[] = await db.query.gameEvents.findMany({
      where: (t, { eq }) => eq(t.mapId, mapId),
    });
    expect(events.map((e) => e.type)).toContain('squishy.captured');
    for (const event of events) {
      const shown = publicViewFor(PUBLIC_VIEWS, event, { userId: mate.id });
      expect(leaks(shown), `${event.type}: ${JSON.stringify(shown)}`).toEqual([]);
    }
  });
});
