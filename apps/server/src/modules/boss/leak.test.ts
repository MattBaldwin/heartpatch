import {
  BossBefriendResponseSchema,
  MapViewSchema,
  PlayerBattleBossSchema,
} from '@heartpatch/shared';
import {
  BOSS_EVENTS,
  SECRET_MOVES,
  SECRET_SPECIES,
  type BossEventRules,
} from '@heartpatch/shared/server';
import { afterAll, afterEach, beforeAll, describe, expect, inject, it } from 'vitest';
import { createDbClient, type Database, type DbClient } from '../../db/client.js';
import { buildings, patchTrees } from '../../db/schema.js';
import type { GameEvent } from '../../db/game-events.js';
import {
  BOSS_RULES,
  REAL_BAG_IS_REAL,
  REAL_BAG_RULES,
  STAND_IN_BOSS,
  bossHarness,
} from '../../../tests/boss.js';
import { PUBLIC_VIEWS, publicViewFor } from '../../ws/public-views.js';

const url = inject('testDatabaseUrl');

/**
 * Words that would give away the odds, the misses or the schedule (CLAUDE.md
 * rule 6): none may appear as a key in anything a client is sent. Warmth goes
 * out only as `PlayerBattle.boss.warmth`, a coarse 0–4 step (#190 ruling). (A finished
 * battle's `seed` is public by design, tech spec §8; the ask's roll also
 * takes the server-only patch seed, so it can't be predicted from it.)
 */
const SECRET_KEYS = [
  'chance',
  'roll',
  'misses',
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

/**
 * Every key anywhere in a JSON value, except a move effect's own `chance`
 * (`moveDefs[].effects[].chance`). That is the public move schema
 * (`MoveEffectSchema`: "dizzy 20% of the time"), the same field most moves in
 * `GAME_DATA.moves` carry, and a met boss's signature moves go out as move
 * defs so the client can show them (#234 CI, 234b-1c). It says nothing about
 * the befriend odds; `chance` anywhere else (the boss view, the befriend
 * reply, an event, a species def) is still a leak.
 */
function keysOf(value: unknown, into = new Set<string>(), inMoveEffect = false): Set<string> {
  if (Array.isArray(value)) for (const item of value) keysOf(item, into, inMoveEffect);
  else if (value && typeof value === 'object') {
    for (const [key, inner] of Object.entries(value)) {
      if (!(inMoveEffect && key === 'chance')) into.add(key);
      if (key === 'moveDefs' && Array.isArray(inner)) {
        for (const move of inner) {
          for (const [k, v] of Object.entries(move as object)) {
            into.add(k);
            keysOf(v, into, k === 'effects');
          }
        }
      } else keysOf(inner, into);
    }
  }
  return into;
}
/** Every `warmth` value anywhere in a JSON value. */
function warmthsIn(value: unknown, into: unknown[] = []): unknown[] {
  if (Array.isArray(value)) for (const item of value) warmthsIn(item, into);
  else if (value && typeof value === 'object') {
    for (const [key, inner] of Object.entries(value)) {
      if (key === 'warmth') into.push(inner);
      else warmthsIn(inner, into);
    }
  }
  return into;
}
const leaks = (value: unknown) => SECRET_KEYS.filter((k) => keysOf(value).has(k));

/**
 * The Christmas Eve bar's secrets (#37 X2): the goal's formula, the head
 * start's rule and what it came from, a fight's points rule, who shares the
 * fall and what the thanks hold before they're paid. The client gets the
 * bar's `goal`, `chipped` and `state` (#889 verdict), and a Keeper their own
 * chip's `points`.
 */
const EVE_SECRET_KEYS = [
  'goalPerKeeper',
  'minGoal',
  'maxGoal',
  'pointsPerWin',
  'headStart',
  'headStartLights',
  'headStartStar',
  'headStartPerLightPercent',
  'headStartLightsMaxPercent',
  'headStartStarPercent',
  'contributorMinFights',
  'noticeDays',
  'fallBundle',
  'fallAsks',
  'dozedBundle',
  'activeKeepers',
  'gates',
];
const eveLeaks = (value: unknown) => EVE_SECRET_KEYS.filter((k) => keysOf(value).has(k));

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
    expect(won.boss).not.toHaveProperty('patchBar');
    // The fight's own view: exactly the documented fields, never a number behind the odds.
    // A weekly fight has no Christmas Eve `patchBar` (#37 C0b; X2 fills it on the Eve visit).
    expect(Object.keys(won.boss!).sort()).toEqual(
      Object.keys(PlayerBattleBossSchema.shape)
        .filter((key) => key !== 'patchBar')
        .sort(),
    );
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
    // Warmth is a heart step, never a percentage: whole, 0 to 4, wherever it shows.
    const warmths = sent.flatMap((reply) => warmthsIn(reply));
    expect(warmths.length).toBeGreaterThan(0);
    for (const w of warmths)
      expect(typeof w === 'number' && Number.isInteger(w) && w >= 0 && w <= 4, String(w)).toBe(
        true,
      );

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

  it('the real bag (#234): an unmet boss is never named, nor any other boss in it', async () => {
    await h.start(REAL_BAG_RULES, { miniBosses: 'on' });
    const kid = await h.player();
    const mapId = await h.patch(kid);
    await h.grow(mapId, kid, 20);
    await h.toVisit(mapId, REAL_BAG_RULES);
    // Every boss in the bag, and once 234b-1 lands every form on the boss line.
    const secrets = [
      ...REAL_BAG_RULES.bag.map((b) => b.speciesId),
      ...SECRET_SPECIES.filter((s) => s.line === 'boss').flatMap((s) => [s.id, s.name]),
    ];
    const named = (value: unknown) => secrets.filter((x) => JSON.stringify(value).includes(x));

    const before = await h.call('GET', `/maps/${mapId}/boss`, kid);
    expect(before.statusCode, before.body).toBe(200);
    expect(before.json<{ boss: unknown }>().boss).not.toBeNull();
    expect(named(before.json())).toEqual([]);
    expect(leaks(before.json())).toEqual([]);
    const events: GameEvent[] = await db.query.gameEvents.findMany({
      where: (t, { eq }) => eq(t.mapId, mapId),
    });
    expect(events.map((e) => e.type)).toContain('boss.appeared');
    for (const event of events) {
      const shown = publicViewFor(PUBLIC_VIEWS, event, { userId: kid.id });
      expect(named(shown), event.type).toEqual([]);
    }

    // The fight names the boss it is (marked seen), and only that one.
    const [window] = await db.query.bossWindows.findMany({
      where: (t, { eq }) => eq(t.mapId, mapId),
    });
    const battle = await h.fight(kid, mapId);
    const others = REAL_BAG_RULES.bag
      .map((b) => b.speciesId)
      .filter((id) => id !== window!.speciesId);
    expect(battle.speciesDefs.map((s) => s.id).filter((id) => others.includes(id))).toEqual([]);
    expect(leaks(battle)).toEqual([]);
    // Its signature moves do reach the client, effects and all: public move
    // data, exactly as the server holds it (the walker above allows only this `chance`).
    const boss = battle.speciesDefs.find((s) => s.id === window!.speciesId)!;
    const signature = SECRET_MOVES.filter((m) => boss.moves.includes(m.id));
    expect(signature.some((m) => (m.effects ?? []).some((e) => 'chance' in e))).toBe(true);
    for (const move of signature)
      expect(
        battle.moveDefs.find((m) => m.id === move.id),
        move.id,
      ).toEqual(move);
    // The walker still catches an odds-like `chance` outside a move effect.
    expect(leaks({ ...battle, boss: { ...battle.boss, chance: 40 } })).toEqual(['chance']);
  });

  it.skipIf(!REAL_BAG_IS_REAL)(
    'moveDefs carry a move an assist calls in (#234): Papa Brrr brings Mama Bear Charge',
    async () => {
      const papaOnly: BossEventRules = {
        ...REAL_BAG_RULES,
        bag: REAL_BAG_RULES.bag.filter((b) => b.speciesId === 'papa-brrr'),
      };
      expect(papaOnly.bag).toHaveLength(1);
      await h.start(papaOnly, { miniBosses: 'on' });
      const kid = await h.player();
      const mapId = await h.patch(kid);
      await h.grow(mapId, kid, 20);
      await h.toVisit(mapId, papaOnly);
      const battle = await h.fight(kid, mapId);

      const ask = SECRET_MOVES.find((m) => m.id === 'ask-your-mother')!;
      expect(ask.effects).toContainEqual({ type: 'assist', move: 'mama-bear-charge' });
      const charge = SECRET_MOVES.find((m) => m.id === 'mama-bear-charge')!;
      // Papa Brrr doesn't know it himself: it rides along only for the assist.
      expect(battle.speciesDefs.find((s) => s.id === 'papa-brrr')!.moves).not.toContain(charge.id);
      expect(battle.moveDefs.find((m) => m.id === charge.id)).toEqual(charge);
      // A flavour hint, not a secret: Mommentum herself is never named.
      expect(battle.speciesDefs.map((s) => s.id)).not.toContain('mommentum');
      expect(JSON.stringify(battle)).not.toMatch(/mommentum/i);
      expect(leaks(battle)).toEqual([]);
    },
  );

  it('the Christmas Eve bar (#37 X2): only goal, chipped and state, never its formula or who chipped', async () => {
    // Goal 100 for two: the kid's win fills it, so the fall and the thanks go out too.
    const eve = BOSS_EVENTS.christmasEve!;
    const rules: BossEventRules = {
      ...COIN_FLIP,
      christmasEve: { ...eve, bar: { ...eve.bar, goalPerKeeper: 40, minGoal: 100 } },
    };
    await h.start(rules);
    h.clock.setTime(new Date('2026-12-24T12:00:00-07:00').getTime());
    const kid = await h.player();
    const mate = await h.player();
    const mapId = await h.patch(kid);
    await h.join(mapId, kid, mate);
    await h.grow(mapId, kid, 20);
    await h.grow(mapId, mate, 20);
    // Two lit lights and the star (#37 X5a): a head start whose size and rule
    // must never show, only that it warmed the bar up.
    const tiles = await db.query.tiles.findMany({
      where: (t, { eq }) => eq(t.mapId, mapId),
      limit: 3,
    });
    for (const tile of tiles.slice(1)) {
      await db.insert(buildings).values({
        mapId,
        ownerUserId: kid.id,
        tileId: tile.id,
        buildingId: 'twinkle-lights',
        kind: 'lights',
        spot: 0,
      });
    }
    await db.insert(patchTrees).values({ mapId, postTileId: tiles[0]!.id, starLitAt: h.clock });
    h.clock.setTime(new Date('2026-12-24T16:01:00-07:00').getTime());
    const sent: unknown[] = [];
    const get = async (path: string, who = kid) => {
      const res = await h.call('GET', path, who);
      expect(res.statusCode, res.body).toBe(200);
      sent.push(res.json());
      return res.json<Record<string, unknown>>();
    };
    await get(`/maps/${mapId}/boss`);
    const started = await h.fight(kid, mapId);
    const won = await h.playOut(kid, started);
    sent.push(started, won);
    // The fight's bar: exactly the three documented fields.
    expect(Object.keys(started.boss!.patchBar!).sort()).toEqual(['chipped', 'goal', 'state']);
    // 4 % from two lights and 10 % for the star, of 100: 14 to start, 114 after the win.
    expect(won.boss!.patchBar).toEqual({ goal: 100, chipped: 114, state: 'fell' });
    // The map's Eve: the opening, the bar, a count of chippers and a yes/no
    // for the head start (#37 X5a), nothing else.
    const view = MapViewSchema.parse(await get(`/maps/${mapId}/view`));
    expect(Object.keys(view.christmas!.eve!).sort()).toEqual([
      'chipped',
      'chippers',
      'goal',
      'opensAt',
      'state',
      'warmedUp',
    ]);
    expect(view.christmas!.eve).toMatchObject({ chippers: 1, warmedUp: true });
    // Never the head start's size (14) nor the lights counted (2).
    expect(Object.values(view.christmas!.eve!)).not.toContain(14);
    expect(Object.values(view.christmas!.eve!)).not.toContain(2);
    await get(`/maps/${mapId}/view`, mate);
    await get(`/maps/${mapId}/boss`);
    await get(`/maps/${mapId}/boss`, mate);
    await get(`/battles/${won.id}`);
    // The kid's thanks, once paid (their /boss read): theirs alone, never odds.
    const thanked = MapViewSchema.parse(await get(`/maps/${mapId}/view`)).christmas!.eve!;
    expect(Object.keys(thanked.thanks!).sort()).toEqual(['asksLeft', 'battleId', 'items', 'kind']);
    const mates = MapViewSchema.parse(await get(`/maps/${mapId}/view`, mate)).christmas!.eve!;
    expect(mates.thanks).toBeUndefined();
    for (const reply of sent) expect(eveLeaks(reply), JSON.stringify(reply)).toEqual([]);
    // The boss routes and the map's Christmas block never say who else chipped
    // (the map's member list names the mate, as always), and the boss routes
    // keep the weekly secrets too (`opensAt` is the map's alone).
    const bossReplies = sent.filter((r) => !('map' in (r as object)));
    expect(JSON.stringify([...bossReplies, view.christmas])).not.toContain(mate.id);
    for (const reply of bossReplies) {
      expect(leaks(reply).filter((k) => k !== 'opensAt')).toEqual([]);
    }

    // The live events: the bar moves for everyone, nameless; the points and
    // the thanks are the kid's alone.
    const events: GameEvent[] = await db.query.gameEvents.findMany({
      where: (t, { eq }) => eq(t.mapId, mapId),
    });
    const types = events.map((e) => e.type);
    expect(types).toEqual(expect.arrayContaining(['boss.chipped', 'boss.fell', 'boss.thanked']));
    for (const event of events) {
      for (const who of [kid, mate]) {
        const shown = publicViewFor(PUBLIC_VIEWS, event, { userId: who.id });
        expect(eveLeaks(shown), `${event.type}: ${JSON.stringify(shown)}`).toEqual([]);
      }
      const toMate = publicViewFor(PUBLIC_VIEWS, event, { userId: mate.id });
      if (event.type === 'boss.chipped') {
        expect(Object.keys(toMate as object).sort()).toEqual(['chipped', 'goal', 'window']);
        const toKid = publicViewFor(PUBLIC_VIEWS, event, { userId: kid.id });
        expect(toKid).toMatchObject({ points: 100 });
      }
      if (event.type === 'boss.thanked') expect(toMate).toBeNull();
      if (event.type === 'boss.fell') {
        expect(Object.keys(toMate as object).sort()).toEqual([
          'chipped',
          'fellAt',
          'goal',
          'window',
        ]);
      }
    }
  });

  it('the switch closed (#234): nothing about the visit is sent', async () => {
    await h.start(REAL_BAG_RULES, { miniBosses: 'off' });
    const kid = await h.player();
    const mapId = await h.patch(kid);
    await h.grow(mapId, kid, 20);
    await h.toVisit(mapId, REAL_BAG_RULES);
    const res = await h.call('GET', `/maps/${mapId}/boss`, kid);
    expect(res.json()).toEqual({ boss: null });
    // Nor the dev looks, without dev tools.
    expect((await h.call('GET', '/dev/boss-looks', kid)).statusCode).toBe(404);
  });
});
