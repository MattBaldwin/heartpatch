import type { BuildingProduction, MyBuilding } from '@heartpatch/shared';
import { describe, expect, it } from 'vitest';
import type { ResourceTile } from './resource-model.js';
import {
  WAREHOUSE,
  WAREHOUSE_TEXT,
  deliveryMark,
  myWarehouse,
  warehouseBuildCard,
  warehouseCard,
  warehouseHere,
} from './warehouse-model.js';

const me = '0190a000-0000-7000-8000-000000000001';
const rowId = (n: number) => `0190a000-0000-7000-8000-${String(n).padStart(12, '0')}`;

const tile = (extra: Partial<ResourceTile> = {}): ResourceTile => ({
  q: 2,
  r: 0,
  terrain: 'clearing',
  clearedFrom: 'meadow',
  nodeResource: null,
  ownerUserId: me,
  homeSlot: null,
  homestead: 'joined',
  clearing: null,
  buildings: [],
  ...extra,
});

type Warehouse = NonNullable<MyBuilding['warehouse']>;
const warehouseOf = (extra: Partial<Warehouse> = {}): Warehouse => ({
  delivering: true,
  fromLevel: 3,
  napping: false,
  upkeep: 30,
  paidThrough: '2026-10-22',
  pausedAt: null,
  upkeepRank: null,
  ...extra,
});

const building = (n: number, extra: Partial<MyBuilding>): MyBuilding => ({
  id: rowId(n),
  buildingId: 'stone-quarry',
  kind: 'resource',
  level: 1,
  spot: 1,
  lit: null,
  safeRadius: null,
  q: 3,
  r: 0,
  nightsLeft: null,
  fuelSpace: null,
  capacity: null,
  residents: null,
  ...extra,
});

const production = (extra: Partial<BuildingProduction> = {}): BuildingProduction => ({
  resource: 'stone',
  perCycle: 3,
  cycleSeconds: 600,
  ready: { stone: 42 },
  cycles: 14,
  maxCycles: null,
  full: false,
  nextReadyAt: '2026-10-22T12:06:00Z',
  upkeep: 17,
  paidThrough: '2026-10-22',
  pausedAt: null,
  upkeepRank: null,
  delivering: true,
  ...extra,
});

const store = (w: Partial<Warehouse> = {}) =>
  building(9, {
    buildingId: 'warehouse',
    kind: 'warehouse',
    q: 2,
    r: 0,
    warehouse: warehouseOf(w),
  });

describe('the Warehouse in the data (#601)', () => {
  it('is one building that costs a lot and pays 💛 each morning', () => {
    expect(WAREHOUSE).toMatchObject({ id: 'warehouse', maxPerHome: 1, placement: 'homestead' });
  });
});

describe('warehouseBuildCard: the Build sheet (#601 PR 9)', () => {
  it('offers my one Warehouse on an empty, joined homestead of mine', () => {
    const card = warehouseBuildCard(tile(), { buildings: [] }, me);
    expect(card).toMatchObject({
      id: 'warehouse',
      icon: '📦',
      name: 'Warehouse',
      blocked: null,
      area: 'spot',
      cost: { timber: 600, stone: 450, glimmer: 20 },
    });
    expect(card?.effect).toBe('📦 Level 3+ buildings send everything straight to your bag');
    expect(card?.spot).toBeGreaterThan(0);
  });

  it('offers none once I have one, or anywhere it cannot stand', () => {
    const none = (t: Partial<ResourceTile>, buildings: MyBuilding[] = []) =>
      warehouseBuildCard(tile(t), { buildings }, me);
    expect(none({}, [store()])).toBeNull();
    expect(none({ ownerUserId: rowId(2) })).toBeNull();
    expect(none({ homeSlot: 1 })).toBeNull();
    expect(none({ homestead: 'paused' })).toBeNull();
    expect(none({ homestead: null })).toBeNull();
    expect(none({ clearing: { readyAt: '2026-10-22T13:00:00Z' } })).toBeNull();
    expect(none({ buildings: [{ spot: 1 }] })).toBeNull();
    expect(none({ nodeResource: 'stone' })).toBeNull();
    expect(warehouseBuildCard(tile(), { buildings: [] }, null)).toBeNull();
  });
});

describe('warehouseCard: the tile card in its three states (#601 PR 9)', () => {
  const quarry3 = building(1, { level: 3, production: production() });
  const quarry1 = building(2, {
    level: 1,
    production: production({ delivering: false, maxCycles: 144 }),
  });

  it('delivers, and counts the buildings it delivers for', () => {
    const card = warehouseCard(
      store(),
      { homestead: 'joined' },
      {
        buildings: [store(), quarry3, quarry1],
      },
    );
    expect(card).toEqual({
      state: 'delivering',
      line: WAREHOUSE_TEXT.delivering(3),
      count: 'Delivering for 1 building',
      upkeep: '💛 30 each morning',
    });
  });

  it('says what to do while no building is level 3 yet', () => {
    const card = warehouseCard(store(), { homestead: 'joined' }, { buildings: [store(), quarry1] });
    expect(card).toMatchObject({ state: 'delivering', count: null });
    expect(card?.line).toMatch(/Get a building to level 3/);
  });

  it('needs 💛 when the morning upkeep was short: huts back to their own storage', () => {
    const paused = store({ delivering: false, pausedAt: '2026-10-22T10:00:00Z' });
    const card = warehouseCard(paused, { homestead: 'joined' }, { buildings: [paused] });
    expect(card).toMatchObject({ state: 'paused', count: null, upkeep: '💛 30 each morning' });
    expect(card?.line).toMatch(/^⏸️ Warehouse needs 💛: huts back to their own storage/);
    expect(card?.line).toMatch(/💛 30!$/);
    expect(card?.line).not.toMatch(/nap/i);
  });

  it('naps for free while its homestead is cut off, which wins', () => {
    const napping = store({ delivering: false, napping: true, pausedAt: '2026-10-22T10:00:00Z' });
    const card = warehouseCard(napping, { homestead: 'joined' }, { buildings: [napping] });
    expect(card).toMatchObject({ state: 'napping', upkeep: 'Free while it sleeps' });
    expect(card?.line).toMatch(/Warehouse napping: huts back to their own storage/);
    // The tile's own word for it counts too.
    expect(warehouseCard(store(), { homestead: 'paused' }, { buildings: [] })?.state).toBe(
      'napping',
    );
  });

  it('reads nothing for other buildings or an older server', () => {
    expect(warehouseCard(quarry3, { homestead: 'joined' }, { buildings: [] })).toBeNull();
    const old = building(9, { buildingId: 'warehouse', kind: 'warehouse' });
    expect(warehouseCard(old, { homestead: 'joined' }, { buildings: [] })).toBeNull();
  });

  it('finds my Warehouse, on its tile', () => {
    const home = { buildings: [store(), quarry3] };
    expect(myWarehouse(home)?.buildingId).toBe('warehouse');
    expect(warehouseHere(home, { q: 2, r: 0 })?.buildingId).toBe('warehouse');
    expect(warehouseHere(home, { q: 3, r: 0 })).toBeUndefined();
  });
});

describe('deliveryMark: the 📦 on a level 3+ card (#601 PR 9)', () => {
  it("reads the server's delivering, never maxCycles", () => {
    const w = warehouseOf();
    expect(deliveryMark({ level: 3, production: production() }, w, false)).toBe(
      '📦 Delivering to your bag',
    );
    // Covered (no cap) but asleep itself: no mark.
    expect(
      deliveryMark({ level: 3, production: production({ delivering: false }) }, w, true),
    ).toBeNull();
    // Too low a level for it.
    expect(
      deliveryMark(
        { level: 2, production: production({ delivering: false, maxCycles: 144 }) },
        w,
        false,
      ),
    ).toBeNull();
  });

  it('says why a level 3+ building is back to its own storage', () => {
    const p = production({ delivering: false, maxCycles: 144 });
    expect(
      deliveryMark(
        { level: 3, production: p },
        warehouseOf({ delivering: false, napping: true }),
        false,
      ),
    ).toBe('📦 Warehouse napping: back to its own storage');
    expect(
      deliveryMark(
        { level: 4, production: p },
        warehouseOf({ delivering: false, pausedAt: '2026-10-22T10:00:00Z' }),
        false,
      ),
    ).toBe('📦 Warehouse needs 💛: back to its own storage');
    expect(deliveryMark({ level: 3, production: p }, undefined, false)).toBeNull();
  });
});
