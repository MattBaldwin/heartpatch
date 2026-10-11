import { describe, expect, it } from 'vitest';
import { BUILDINGS } from '../data/buildings.js';
import { Rng } from '../rng/index.js';
import type { Building } from '../schemas/data/buildings.js';
import {
  planTileUses,
  tileUseRefusal,
  type TileUseBuilding,
  type TileUsePlan,
  type TileUseTile,
} from './tile-uses.js';

// The Factory moves out to homesteads with #295's data change; the planner
// reads placement from the data it's given, so tests pass that rule in.
const DATA: Pick<Building, 'id' | 'kind' | 'placement'>[] = BUILDINGS.map((b) =>
  b.id === 'crafting-factory' ? { ...b, placement: 'homestead' } : b,
);
const byId = new Map(DATA.map((b) => [b.id, b]));
const data = (id: string) => {
  const b = byId.get(id);
  if (!b) throw new Error(`no building ${id}`);
  return b;
};

// A home around (0, 0), and land to its east: (2, 0) and (3, 0) are open
// homesteads, (2, -1) a homestead with a Stone spot, (3, -1) a paused (cut
// off) homestead, (2, 1) plain land.
const tile = (q: number, r: number, over: Partial<TileUseTile> = {}): TileUseTile => ({
  id: `t${String(q)}_${String(r)}`,
  q,
  r,
  homeSlot: null,
  nodeResource: null,
  homestead: null,
  ...over,
});
const HOME = [
  tile(0, 0, { homeSlot: 0 }),
  tile(1, -1, { homeSlot: 0, nodeResource: 'timber' }),
  tile(1, 0, { homeSlot: 0, nodeResource: 'stone' }),
  tile(0, 1, { homeSlot: 0, nodeResource: 'emberwood' }),
  tile(-1, 1, { homeSlot: 0, nodeResource: 'pumpkins' }),
  tile(-1, 0, { homeSlot: 0, nodeResource: 'treats' }),
  tile(0, -1, { homeSlot: 0, nodeResource: 'magic-fallen-leaves' }),
];
const LAND = [
  tile(2, 0, { homestead: 'joined' }),
  tile(3, 0, { homestead: 'joined' }),
  tile(2, -1, { homestead: 'joined', nodeResource: 'stone' }),
  tile(3, -1, { homestead: 'paused' }),
  tile(2, 1),
];
const TILES = [...HOME, ...LAND];

let n = 0;
/** A building row; with no date, rows are placed a day apart in the order made (wrapping every 9). */
const row = (buildingId: string, tileId: string, placedAt?: string): TileUseBuilding => {
  n += 1;
  return {
    id: `b${String(n).padStart(3, '0')}`,
    tileId,
    buildingId,
    placedAt: placedAt ?? `2026-10-0${String((n % 9) + 1)}`,
  };
};

/** The rows after a plan: moved ones on their new tiles, packed ones gone. */
function apply(rows: readonly TileUseBuilding[], plan: TileUsePlan): TileUseBuilding[] {
  const to = new Map(plan.move.map((m) => [m.id, m.toTileId]));
  const packed = new Set(plan.pack);
  return rows
    .filter((r) => !packed.has(r.id))
    .map((r) => ({ ...r, tileId: to.get(r.id) ?? r.tileId }));
}

describe('tileUseRefusal (#295)', () => {
  const [seed, ring] = HOME;
  const [open, , spot, paused, plain] = LAND;

  it('puts home buildings on home tiles only, beside the ring node', () => {
    expect(tileUseRefusal(data('ember-den'), ring!, false)).toBeNull();
    expect(tileUseRefusal(data('ember-den'), seed!, false)).toBeNull();
    expect(tileUseRefusal(data('ember-den'), open!, false)).toBe('home-only');
    expect(tileUseRefusal(data('ember-den'), ring!, true)).toBe('taken');
  });

  it('puts homestead buildings on open joined homesteads only', () => {
    expect(tileUseRefusal(data('training-grounds'), open!, false)).toBeNull();
    expect(tileUseRefusal(data('training-grounds'), spot!, false)).toBe('clear-first');
    expect(tileUseRefusal(data('training-grounds'), plain!, false)).toBe('homestead-only');
    // Cut off from home: it keeps what stands there, but takes nothing new.
    expect(tileUseRefusal(data('training-grounds'), paused!, false)).toBe('napping');
    expect(tileUseRefusal(data('training-grounds'), ring!, false)).toBe('not-at-home');
    expect(tileUseRefusal(data('training-grounds'), open!, true)).toBe('taken');
  });

  it("follows the data's placement for fires, one a tile, never on a spot", () => {
    expect(tileUseRefusal(data('hearthfire'), plain!, false)).toBeNull();
    expect(tileUseRefusal(data('hearthfire'), spot!, false)).toBe('clear-first');
    expect(tileUseRefusal(data('hearthfire'), seed!, false)).toBe('not-at-home');
    expect(tileUseRefusal(data('hearthfire'), open!, true)).toBe('taken');
  });

  it('never refuses a fence: fences stand on edges, not tiles', () => {
    expect(tileUseRefusal(data('hedge'), spot!, true)).toBeNull();
    expect(tileUseRefusal(data('hedge'), seed!, true)).toBeNull();
  });
});

describe('planTileUses (#295)', () => {
  it('leaves a tidy home alone', () => {
    const rows = [row('ember-den', 't1_-1'), row('cozy-meadow', 't1_0'), row('hearthfire', 't2_1')];
    expect(planTileUses(TILES, rows, DATA)).toEqual({
      stay: rows.map((r) => r.id),
      move: [],
      pack: [],
    });
  });

  it('keeps the oldest home building on a crowded tile and moves the rest to the nearest free home tiles', () => {
    const old = row('ember-den', 't1_-1', '2026-10-02');
    const young = row('cozy-meadow', 't1_-1', '2026-10-05');
    const younger = row('ember-den', 't1_-1', '2026-10-06');
    const plan = planTileUses(TILES, [young, younger, old], DATA);
    expect(plan.stay).toEqual([old.id]);
    expect(plan.pack).toEqual([]);
    // (1, -1)'s free neighbours at distance 1, by tile id: (0, -1), then (0, 0), (1, 0).
    expect(plan.move).toEqual([
      { id: young.id, toTileId: 't0_-1' },
      { id: younger.id, toTileId: 't0_0' },
    ]);
  });

  it('keeps the fire on a shared homestead and moves the Training Grounds, even when they are older', () => {
    const grounds = row('training-grounds', 't2_0', '2026-10-01');
    const fire = row('hearthfire', 't2_0', '2026-10-04');
    const plan = planTileUses(TILES, [grounds, fire], DATA);
    expect(plan.stay).toEqual([fire.id]);
    expect(plan.move).toEqual([{ id: grounds.id, toTileId: 't3_0' }]);
  });

  it('moves the Crafting Factory out of home to a free open homestead, never a spot or a paused one', () => {
    const factory = row('crafting-factory', 't1_0');
    const taken = row('hearthfire', 't2_0');
    const plan = planTileUses(TILES, [factory, taken], DATA);
    expect(plan.move).toEqual([{ id: factory.id, toTileId: 't3_0' }]);
  });

  it('packs what has nowhere to go', () => {
    const factory = row('crafting-factory', 't1_0');
    const fires = [row('hearthfire', 't2_0'), row('hearthfire', 't3_0')];
    const plan = planTileUses(TILES, [factory, ...fires], DATA);
    expect(plan.pack).toEqual([factory.id]);
    expect(plan.move).toEqual([]);
  });

  it('grandfathers a building already standing on a resource spot', () => {
    const grounds = row('training-grounds', 't2_-1');
    expect(planTileUses(TILES, [grounds], DATA)).toEqual({
      stay: [grounds.id],
      move: [],
      pack: [],
    });
  });

  it('keeps a building on a homestead that is cut off right now', () => {
    const grounds = row('training-grounds', 't3_-1');
    expect(planTileUses(TILES, [grounds], DATA)).toEqual({
      stay: [grounds.id],
      move: [],
      pack: [],
    });
  });

  it('leaves fences, unknown buildings and rows on other tiles alone, in stay', () => {
    const fence = row('hedge', 't2_0');
    const gone = row('retired-building', 't2_0');
    const elsewhere = row('ember-den', 'not-my-tile');
    const fire = row('hearthfire', 't2_0');
    expect(planTileUses(TILES, [fence, gone, elsewhere, fire], DATA)).toEqual({
      stay: [fence.id, gone.id, elsewhere.id, fire.id],
      move: [],
      pack: [],
    });
  });

  it('always ends at one building per tile, loses nothing and plans nothing the second time', () => {
    const kinds = [
      'ember-den',
      'cozy-meadow',
      'crafting-factory',
      'training-grounds',
      'hearthfire',
    ];
    for (let trial = 0; trial < 300; trial++) {
      const rng = Rng.fromSeed(`tile-uses-${String(trial)}`);
      const rows: TileUseBuilding[] = Array.from({ length: rng.int(1, 9) }, () => {
        const kind = kinds[rng.int(0, kinds.length - 1)] ?? 'ember-den';
        // Where the old rules let it stand: home kinds at home, the rest out on the land.
        const pool = data(kind).placement === 'home' || kind === 'crafting-factory' ? HOME : LAND;
        const at = pool[rng.int(0, pool.length - 1)] ?? HOME[0]!;
        return row(kind, at.id, `2026-10-0${String(rng.int(1, 9))}`);
      });
      const plan = planTileUses(TILES, rows, DATA);
      expect(plan.stay.length + plan.move.length + plan.pack.length).toBe(rows.length);
      const after = apply(rows, plan);
      const perTile = new Map<string, number>();
      for (const r of after) perTile.set(r.tileId, (perTile.get(r.tileId) ?? 0) + 1);
      expect(Math.max(...perTile.values(), 0)).toBeLessThanOrEqual(1);
      const again = planTileUses(TILES, after, DATA);
      expect(again.move).toEqual([]);
      expect(again.pack).toEqual([]);
    }
  });
});
