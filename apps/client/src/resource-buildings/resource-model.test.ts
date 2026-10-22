import type { BuildingProduction, HeartCoins, MyBuilding } from '@heartpatch/shared';
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
  tileLand,
  upkeepSection,
  waitingResourceBuilding,
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
    // A spot to clear first: Clear land's cards show it waiting instead.
    expect(none({ nodeResource: 'stone' })).toEqual([]);
    expect(waitingResourceBuilding({ terrain: 'hills' })?.id).toBe('stone-quarry');
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
      ['Paused', false, true],
    ]);
    expect(section?.canOrder).toBe(true);
    expect(upkeepSection({ ...upkeep, due: [row('a', 17)] }, 0)?.canOrder).toBe(false);
    expect(upkeepSection(undefined, 0)).toBeNull();
    expect(upkeepSection({ ...upkeep, due: [] }, 0)).toBeNull();
    expect(upkeepSection({ ...upkeep, total: 0 }, 0)?.total).toMatch(/Nothing due/);
  });

  it('says Free for one asleep on a napping homestead or out of season', () => {
    const section = upkeepSection({ ...upkeep, due: [row('a', 17), row('d', 0)] }, 0);
    expect(section?.rows.map((r) => r.coins)).toEqual(['💛 17', 'Free']);
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
