import { describe, expect, it } from 'vitest';
import { BUILDINGS } from '../data/buildings.js';
import { hexKey, type HexKey } from '../hex/index.js';
import type { TravelBuilding } from '../schemas/data/buildings.js';
import { travelBuildCheck, type BuildableOnInput, type BuildableTile } from './index.js';

const travel = (id: string) =>
  BUILDINGS.find((b) => b.id === id && b.kind === 'travel') as TravelBuilding;
const BRIDGE = travel('bridge');
const DOCK = travel('ferry-dock');
const WAYSTATION = travel('waystation');
const ME = 'me';

const t = (q: number, r: number, terrain: string, ownerUserId: string | null = null) =>
  ({ q, r, terrain, ownerUserId }) satisfies BuildableTile;

// Land at (0,0) (mine) and (2,0); a river at (1,0) between them. A lake at
// (0,2)-(0,3) with my land at (0,1) beside it; a second lake at (5,5).
const TILES = [
  t(0, 0, 'meadow', ME),
  t(1, 0, 'river'),
  t(2, 0, 'meadow'),
  t(0, 1, 'meadow', ME),
  t(0, 2, 'wild-lake'),
  t(-1, 3, 'wild-lake'),
  t(3, 3, 'meadow', ME),
  t(4, 3, 'wild-lake'),
  t(9, 9, 'meadow', ME),
];
const at = (q: number, r: number) => TILES.find((x) => x.q === q && x.r === r)!;
const supplied = new Set<HexKey>([hexKey({ q: 0, r: 0 }), hexKey({ q: 0, r: 1 })]);

const ask = (over: Partial<BuildableOnInput> & Pick<BuildableOnInput, 'building' | 'tile'>) =>
  travelBuildCheck({ patchType: 'wild-isle', userId: ME, tiles: TILES, supplied, ...over });

describe('travelBuildCheck: bridge', () => {
  it('goes on a river tile next to supplied land', () => {
    expect(ask({ building: BRIDGE, tile: at(1, 0) })).toEqual({ ok: true });
  });
  it('is too far when no neighbour is supplied', () => {
    expect(ask({ building: BRIDGE, tile: at(1, 0), supplied: new Set() })).toEqual({
      ok: false,
      reason: 'too-far',
    });
  });
  it('needs a river, not land or a lake', () => {
    for (const tile of [at(0, 0), at(2, 0), at(0, 2)]) {
      expect(ask({ building: BRIDGE, tile })).toEqual({ ok: false, reason: 'not-river' });
    }
  });
  it('is not for a river tile that is owned or a village tile', () => {
    expect(ask({ building: BRIDGE, tile: { ...at(1, 0), ownerUserId: 'rival' } })).toEqual({
      ok: false,
      reason: 'not-river',
    });
    expect(ask({ building: BRIDGE, tile: { ...at(1, 0), communityId: 'c1' } })).toEqual({
      ok: false,
      reason: 'not-river',
    });
  });
  it('is taken when a bridge already stands there', () => {
    expect(ask({ building: BRIDGE, tile: { ...at(1, 0), hasBuilding: true } })).toEqual({
      ok: false,
      reason: 'taken',
    });
  });
});

describe('travelBuildCheck: ferry dock', () => {
  it('goes on my land next to a lake', () => {
    expect(ask({ building: DOCK, tile: at(0, 1) })).toEqual({ ok: true });
  });
  it('needs a lake next door', () => {
    expect(ask({ building: DOCK, tile: at(9, 9) })).toEqual({ ok: false, reason: 'no-lake' });
    expect(ask({ building: DOCK, tile: at(0, 0) })).toEqual({ ok: false, reason: 'no-lake' });
  });
  it('is not for land that is not mine, or water', () => {
    expect(ask({ building: DOCK, tile: { ...at(0, 1), ownerUserId: 'rival' } })).toEqual({
      ok: false,
      reason: 'not-mine',
    });
    expect(ask({ building: DOCK, tile: at(0, 2) })).toEqual({ ok: false, reason: 'not-mine' });
  });
  it('is taken when something stands there', () => {
    expect(ask({ building: DOCK, tile: { ...at(0, 1), hasBuilding: true } })).toEqual({
      ok: false,
      reason: 'taken',
    });
  });
  it('allows one dock per lake, but another lake is fine', () => {
    const dockOnFirstLake = [{ q: 0, r: 1 }];
    expect(ask({ building: DOCK, tile: at(0, 1), ownDocks: dockOnFirstLake })).toEqual({
      ok: false,
      reason: 'one-dock',
    });
    expect(ask({ building: DOCK, tile: at(3, 3), ownDocks: dockOnFirstLake })).toEqual({
      ok: true,
    });
  });
});

describe('travelBuildCheck: waystation and patch type', () => {
  it('waystations are not yet', () => {
    expect(ask({ building: WAYSTATION, tile: at(0, 0) })).toEqual({ ok: false, reason: 'not-yet' });
  });
  it('a Cozy Patch takes none of them', () => {
    for (const [building, tile] of [
      [BRIDGE, at(1, 0)],
      [DOCK, at(0, 1)],
      [WAYSTATION, at(0, 0)],
    ] as const) {
      expect(ask({ building, tile, patchType: 'cozy' })).toEqual({
        ok: false,
        reason: 'wrong-patch',
      });
    }
  });
});
