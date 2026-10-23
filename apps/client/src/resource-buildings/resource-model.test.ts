import {
  tileLand,
  type BuildingProduction,
  type HeartCoins,
  type MyBuilding,
} from '@heartpatch/shared';
import { CLEAR_TEXT } from '../inventory/clear-model.js';
import { describe, expect, it } from 'vitest';
import {
  RESOURCE_BUILDINGS,
  moveInOrder,
  outOfSeason,
  producedLines,
  resourceBuildCards,
  resourceBuildingFor,
  resourceCard,
  resourceEffect,
  upkeepSection,
  type ResourceTile,
} from './resource-model.js';

const me = '0190a000-0000-7000-8000-000000000001';
const NOW = Date.parse('2026-10-22T12:00:00Z');
const HALLOWEEN = ['halloween'];

const tile = (extra: Partial<ResourceTile> = {}): ResourceTile => ({
  q: 2,
  r: 0,
  terrain: 'hills',
  clearedFrom: null,
  nodeResource: null,
  ownerUserId: me,
  homeSlot: null,
  homestead: 'joined',
  clearing: null,
  buildings: [],
  ...extra,
});

const production = (extra: Partial<BuildingProduction> = {}): BuildingProduction => ({
  resource: 'stone',
  perCycle: 3,
  cycleSeconds: 600,
  ready: { stone: 42 },
  cycles: 14,
  maxCycles: 144,
  full: false,
  nextReadyAt: '2026-10-22T12:06:00Z',
  upkeep: 17,
  paidThrough: '2026-10-22',
  pausedAt: null,
  upkeepRank: null,
  delivering: false,
  ...extra,
});

const quarry = (p: Partial<BuildingProduction> = {}, buildingId = 'stone-quarry') =>
  ({ buildingId, level: 1, production: production(p) }) as Pick<
    MyBuilding,
    'buildingId' | 'level' | 'production'
  >;

describe('which building a homestead takes (#601 PR 7)', () => {
  it('has one building for each land, and cleared land counts as what it was (Q2)', () => {
    expect(RESOURCE_BUILDINGS).toHaveLength(7);
    expect(resourceBuildingFor('forest')?.id).toBe('woodcutters-hut');
    expect(resourceBuildingFor('lake')?.id).toBe('water-well');
    expect(resourceBuildingFor('clearing')).toBeUndefined();
    expect(tileLand({ terrain: 'clearing', clearedFrom: 'old-forest' })).toBe('old-forest');
    expect(tileLand({ terrain: 'meadow' })).toBe('meadow');
  });

  it('works its numbers out from the shared data, not engine code', () => {
    const hut = resourceBuildingFor('forest');
    if (!hut) throw new Error('no hut');
    const one = resourceEffect(hut, 1);
    const four = resourceEffect(hut, 4);
    expect(one?.resource).toBe('timber');
    expect(one?.perHour).toBeGreaterThan(0);
    expect(four?.storageHours).toBeGreaterThan(one?.storageHours ?? Infinity);
  });
});

describe('resourceBuildCards: the Build sheet (#601 PR 7)', () => {
  it('offers only the building that matches the land', () => {
    const cards = resourceBuildCards(tile(), { seasons: [] }, me);
    expect(cards.map((c) => c.id)).toEqual(['stone-quarry']);
    expect(cards[0]).toMatchObject({
      blocked: null,
      area: 'spot',
      cost: { timber: 20, stone: 15 },
    });
    expect(cards[0]?.effect).toMatch(/^🪨 \d+ Stone an hour/);
  });

  it('reads cleared land as the land it was', () => {
    const cleared = tile({ terrain: 'clearing', clearedFrom: 'lake' });
    expect(resourceBuildCards(cleared, { seasons: [] }, me).map((c) => c.id)).toEqual([
      'water-well',
    ]);
  });

  it('shows every building with the land it needs where none matches', () => {
    const cards = resourceBuildCards(
      tile({ terrain: 'clearing', clearedFrom: null }),
      { seasons: HALLOWEEN },
      me,
    );
    expect(cards).toHaveLength(7);
    expect(cards.find((c) => c.id === 'woodcutters-hut')?.blocked).toBe('Needs Forest land!');
    // Out of Halloween the Pumpkin Barn isn't one of them.
    expect(
      resourceBuildCards(tile({ terrain: 'junipers-gap' }), { seasons: [] }, me).map((c) => c.id),
    ).not.toContain('pumpkin-barn');
  });

  it('builds a Pumpkin Barn only in its season', () => {
    const fields = tile({ terrain: 'pumpkin-fields' });
    expect(resourceBuildCards(fields, { seasons: HALLOWEEN }, me)[0]).toMatchObject({
      id: 'pumpkin-barn',
      blocked: null,
    });
    expect(resourceBuildCards(fields, { seasons: [] }, me)[0]?.blocked).toMatch(/only!/);
  });

  it('offers nothing off an empty, joined homestead of mine', () => {
    const none = (extra: Partial<ResourceTile>) =>
      resourceBuildCards(tile(extra), { seasons: [] }, me);
    expect(resourceBuildCards(tile(), { seasons: [] }, null)).toEqual([]);
    expect(none({ ownerUserId: 'someone-else' })).toEqual([]);
    expect(none({ homeSlot: 1 })).toEqual([]);
    expect(none({ homestead: null })).toEqual([]);
    expect(none({ homestead: 'paused' })).toEqual([]);
    expect(none({ buildings: [{ spot: 0 }] })).toEqual([]);
    expect(none({ clearing: { readyAt: '2026-10-22T13:00:00Z' } })).toEqual([]);
  });

  it.each(RESOURCE_BUILDINGS.map((b) => [b.name, b] as const))(
    '%s waits on its own land with a spot, and goes up once that land is cleared',
    (_name, b) => {
      const spot = tile({ terrain: b.terrain, nodeResource: 'something' });
      expect(resourceBuildCards(spot, { seasons: HALLOWEEN }, me)).toEqual([
        expect.objectContaining({ id: b.id, blocked: CLEAR_TEXT.firstLine }),
      ]);
      const cleared = tile({ terrain: 'clearing', clearedFrom: b.terrain });
      expect(resourceBuildCards(cleared, { seasons: HALLOWEEN }, me)).toEqual([
        expect.objectContaining({ id: b.id, blocked: null }),
      ]);
    },
  );

  it('shows the matching one held back on a spot to clear first (owner bug)', () => {
    // The owner's tile: forest with its Timber spot.
    const spot = tile({ terrain: 'forest', nodeResource: 'timber' });
    const cards = resourceBuildCards(spot, { seasons: [] }, me);
    expect(cards).toEqual([
      expect.objectContaining({
        id: 'woodcutters-hut',
        blocked: CLEAR_TEXT.firstLine,
        cost: { timber: 20, stone: 15 },
      }),
    ]);
    expect(cards[0]?.effect).toMatch(/^🪵 \d+ Timber an hour/);
    // Old forest waits for its Ember Kiln, not the Hut.
    expect(
      resourceBuildCards(
        tile({ terrain: 'old-forest', nodeResource: 'emberwood' }),
        { seasons: [] },
        me,
      ).map((c) => c.id),
    ).toEqual(['ember-kiln']);
    // Out of season says so first: clearing wouldn't help yet.
    const fields = tile({ terrain: 'pumpkin-fields', nodeResource: 'pumpkins' });
    expect(resourceBuildCards(fields, { seasons: [] }, me)[0]?.blocked).toMatch(/only!/);
    expect(resourceBuildCards(fields, { seasons: HALLOWEEN }, me)[0]?.blocked).toMatch(
      /Clear this land first/,
    );
    // Land no tool clears keeps its spot: nothing.
    expect(
      resourceBuildCards(
        tile({ terrain: 'junipers-gap', nodeResource: 'stone' }),
        { seasons: [] },
        me,
      ),
    ).toEqual([]);
    // Still nothing off my joined homestead.
    expect(resourceBuildCards({ ...spot, homestead: 'paused' }, { seasons: [] }, me)).toEqual([]);
  });
});

describe('resourceCard: the tile card in its five states (#601 PR 7)', () => {
  it('runs with its storage meter and the next batch', () => {
    const card = resourceCard(quarry(), { homestead: 'joined' }, [], NOW);
    expect(card).toMatchObject({
      state: 'running',
      stored: 42,
      max: 432,
      percent: 10,
      meter: '🪨 42 of 432',
      next: 'Next batch in 6m',
      upkeep: '💛 17 each morning',
      collect: true,
    });
  });

  it('says when it is full', () => {
    const full = resourceCard(
      quarry({ full: true, ready: { stone: 432 }, cycles: 144, nextReadyAt: null }),
      { homestead: 'joined' },
      [],
      NOW,
    );
    expect(full).toMatchObject({ state: 'full', percent: 100, next: null });
    expect(full?.line).toMatch(/full/);
  });

  it('pauses when the morning upkeep was short, and says what starts it again', () => {
    const paused = resourceCard(
      quarry({ pausedAt: '2026-10-22T10:00:00Z', nextReadyAt: null }),
      { homestead: 'joined' },
      [],
      NOW,
    );
    expect(paused?.state).toBe('paused');
    expect(paused?.line).toMatch(/💛 17/);
    // Its own word: "napping" is for a homestead cut off from home.
    expect(paused?.line).toMatch(/^⏸️ Paused/);
    expect(paused?.line).not.toMatch(/nap/i);
    const napping = resourceCard(quarry(), { homestead: 'paused' }, [], NOW);
    expect(napping?.line).toMatch(/napping, cut off from home/);
  });

  it('naps for free on a cut-off homestead, which wins over everything', () => {
    const napping = resourceCard(
      quarry({ pausedAt: '2026-10-22T10:00:00Z' }),
      { homestead: 'paused' },
      [],
      NOW,
    );
    expect(napping).toMatchObject({ state: 'napping', upkeep: 'Free while it sleeps' });
  });

  it('sleeps out of season as a Pumpkin Barn, for free', () => {
    const barn = quarry({ resource: 'pumpkins', ready: {} }, 'pumpkin-barn');
    expect(resourceCard(barn, { homestead: 'joined' }, [], NOW)).toMatchObject({
      state: 'dormant',
      upkeep: 'Free while it sleeps',
      collect: false,
    });
    expect(resourceCard(barn, { homestead: 'joined' }, HALLOWEEN, NOW)?.state).toBe('running');
  });

  it('never fills while the Warehouse delivers, and reads nothing for other buildings', () => {
    expect(
      resourceCard(quarry({ maxCycles: null }), { homestead: 'joined' }, [], NOW),
    ).toMatchObject({ max: null, percent: 0, meter: '🪨 42 waiting' });
    expect(resourceCard(quarry({}, 'hearthfire'), { homestead: 'joined' }, [], NOW)).toBeNull();
    expect(
      resourceCard(
        { buildingId: 'stone-quarry', level: 1, production: null },
        { homestead: 'joined' },
        [],
        NOW,
      ),
    ).toBeNull();
  });
});

describe('the welcome-back line (#601 PR 7)', () => {
  it('says what each building made', () => {
    expect(
      producedLines([
        { buildingRowId: me, buildingId: 'stone-quarry', q: 2, r: 0, items: { stone: 96 } },
        {
          buildingRowId: me,
          buildingId: 'pumpkin-barn',
          q: 3,
          r: 0,
          items: { pumpkins: 40, 'witch-dust': 20 },
        },
        { buildingRowId: me, buildingId: 'greenhouse', q: 4, r: 0, items: {} },
      ]),
    ).toEqual(['Your Stone Quarry made 96 🪨', 'Your Pumpkin Barn made 40 🎃 and 20 🔮']);
    expect(producedLines(undefined)).toEqual([]);
  });
});

describe('the Heart Coins sheet upkeep and its order (#601 Q5)', () => {
  const row = (buildingRowId: string, coins: number, paused = false) => ({
    buildingRowId,
    buildingId: 'stone-quarry',
    level: 2,
    q: 0,
    r: 0,
    coins,
    paused,
  });
  const upkeep: NonNullable<HeartCoins['upkeep']> = {
    nextMorningAt: '2026-10-23T10:00:00Z',
    total: 34,
    due: [row('a', 17), row('b', 17), row('c', 0, true)],
  };

  it('lists the buildings in charge order, the napping one owing nothing', () => {
    const section = upkeepSection(upkeep, 3 * 3600_000 + 5 * 60_000);
    expect(section?.total).toBe('💛 34 next morning, in 3h 05m');
    expect(section?.rows.map((r) => [r.coins, r.first, r.last])).toEqual([
      ['💛 17', true, false],
      ['💛 17', false, false],
      ['Needs 💛', false, true],
    ]);
    expect(section?.canOrder).toBe(true);
    expect(upkeepSection({ ...upkeep, due: [row('a', 17)] }, 0)?.canOrder).toBe(false);
    expect(upkeepSection(undefined, 0)).toBeNull();
    expect(upkeepSection({ ...upkeep, due: [] }, 0)).toBeNull();
    expect(upkeepSection({ ...upkeep, total: 0 }, 0)?.total).toMatch(/Nothing due/);
  });

  it('gives the three sleeps three words: short of coins, cut off, out of season', () => {
    const barn = { ...row('e', 0), buildingId: 'pumpkin-barn' };
    const due = [row('a', 17), row('c', 0, true), row('d', 0), barn];
    // After Halloween: the barn says till when.
    expect(upkeepSection({ ...upkeep, due }, 0, () => [])?.rows.map((r) => r.coins)).toEqual([
      '💛 17',
      'Needs 💛',
      'Napping',
      'Asleep till Halloween 🎃',
    ]);
    // In season next morning too, a barn that owes nothing is on a napping homestead.
    expect(upkeepSection({ ...upkeep, due: [barn] }, 0, () => ['halloween'])?.rows[0]?.coins).toBe(
      'Napping',
    );
  });

  it("judges the season at the morning it charges, not now (a season's last day)", () => {
    // Halloween is on today but over by the next morning, which the server
    // charges for: the barn owes nothing because it sleeps, not because it naps.
    const barn = { ...row('e', 0), buildingId: 'pumpkin-barn' };
    const morning = Date.parse(upkeep.nextMorningAt);
    const asked: number[] = [];
    const seasonsAt = (at: Date) => {
      asked.push(at.getTime());
      return at.getTime() >= morning ? [] : ['halloween'];
    };
    expect(upkeepSection({ ...upkeep, due: [barn] }, 0, seasonsAt)?.rows[0]?.coins).toBe(
      'Asleep till Halloween 🎃',
    );
    expect(asked).toEqual([morning]);
  });

  it('can read a 0-coin row as a sleep, since every level has upkeep', () => {
    for (const b of RESOURCE_BUILDINGS) {
      for (const level of b.levels) expect(level.upkeep).toBeGreaterThan(0);
    }
  });

  it('says Napping when the seasons are not known (no patch time zone yet)', () => {
    const barn = { ...row('e', 0), buildingId: 'pumpkin-barn' };
    expect(upkeepSection({ ...upkeep, due: [barn] }, 0)?.rows[0]?.coins).toBe('Napping');
    expect(upkeepSection({ ...upkeep, due: [barn] }, 0, () => null)?.rows[0]?.coins).toBe(
      'Napping',
    );
  });

  it('knows a Pumpkin Barn sleeps out of season, and the others never do', () => {
    expect(outOfSeason('pumpkin-barn', [])).toBe(true);
    expect(outOfSeason('pumpkin-barn', ['halloween'])).toBe(false);
    expect(outOfSeason('stone-quarry', [])).toBe(false);
  });

  it('moves one building a place up or down, and stays put at the ends', () => {
    expect(moveInOrder(['a', 'b', 'c'], 'c', -1)).toEqual(['a', 'c', 'b']);
    expect(moveInOrder(['a', 'b', 'c'], 'a', 1)).toEqual(['b', 'a', 'c']);
    expect(moveInOrder(['a', 'b', 'c'], 'a', -1)).toEqual(['a', 'b', 'c']);
    expect(moveInOrder(['a', 'b', 'c'], 'c', 1)).toEqual(['a', 'b', 'c']);
    expect(moveInOrder(['a', 'b'], 'z', 1)).toEqual(['a', 'b']);
  });
});
