import { describe, expect, it } from 'vitest';
import { GAME_DATA } from '../data/index.js';
import { TRAVEL_RULES } from '../data/travel.js';
import { hexDistance, hexKey, hexNeighbors, type HexKey } from '../hex/index.js';
import { generateMap } from '../mapgen/index.js';
import type { PvpMode } from '../schemas/maps.js';
import { attackTargetProblem, type AttackTargetProblem, type TerritoryTile } from './index.js';
import {
  connectedLand,
  isTradingPost,
  isWaterTerrain,
  postReach,
  supplyMap,
  type ReachTile,
  type SupplyTile,
} from './reach.js';

const ME = 'me';
const tile = (
  q: number,
  r: number,
  ownerUserId: string | null = null,
  homeSlot: number | null = null,
) => ({ q, r, ownerUserId, homeSlot }) satisfies ReachTile;

// My home: the Heart Seed at (0,0) and its ring. Claimed land runs east to
// (2,0) and (3,0); (5,0) is mine too but cut off (a rival holds (4,0)).
const HOME = [
  tile(0, 0, ME, 0),
  tile(1, 0, ME, 0),
  tile(1, -1, ME, 0),
  tile(0, -1, ME, 0),
  tile(-1, 0, ME, 0),
  tile(-1, 1, ME, 0),
  tile(0, 1, ME, 0),
];
const TILES: ReachTile[] = [
  ...HOME,
  tile(2, 0, ME),
  tile(3, 0, ME),
  tile(4, 0, 'rival'),
  tile(5, 0, ME),
  tile(6, 0),
  tile(0, 4),
];

describe('connectedLand', () => {
  it('is my land joined to home through my own tiles', () => {
    const joined = connectedLand(TILES, ME);
    expect(joined.has(hexKey(tile(3, 0)))).toBe(true);
    expect(joined.has(hexKey(tile(5, 0)))).toBe(false); // cut off
    expect(joined.size).toBe(9);
  });

  it('is empty for a player with no home here', () => {
    expect(connectedLand(TILES, 'stranger').size).toBe(0);
  });
});

describe('postReach (owner decisions 1–3 on #30)', () => {
  it('is connected when my land joined to home touches the post', () => {
    expect(postReach({ q: 3, r: 1 }, TILES, ME)).toEqual({ kind: 'connected' });
  });

  it('is a journey by distance to my nearest land when it isn’t', () => {
    // (0,4) is 3 steps from my ring tile (0,1).
    expect(postReach({ q: 0, r: 4 }, TILES, ME)).toEqual({ kind: 'journey', distance: 3 });
  });

  it('counts cut-off land for distance, but not for connection', () => {
    // (6,0) touches my cut-off (5,0): a journey of 1, not connected.
    expect(postReach({ q: 6, r: 0 }, TILES, ME)).toEqual({ kind: 'journey', distance: 1 });
  });

  it('is null for someone with no land', () => {
    expect(postReach({ q: 0, r: 4 }, TILES, 'stranger')).toBeNull();
  });
});

describe('isTradingPost', () => {
  it('reads the terrain', () => {
    expect(isTradingPost({ terrain: 'trading-post' })).toBe(true);
    expect(isTradingPost({ terrain: 'meadow' })).toBe(false);
  });
});

// ── Wild Isle supply and reach (#621) ─────────────────────────────────────

const RULES = TRAVEL_RULES;
const land = (q: number, r: number, ownerUserId: string | null = null, terrain = 'meadow') =>
  ({ q, r, ownerUserId, homeSlot: null, terrain }) satisfies SupplyTile;
const homeOf = (q: number, r: number, ownerUserId: string) =>
  ({ ...land(q, r, ownerUserId), homeSlot: 0 }) satisfies SupplyTile;

/**
 * A strip running east from my home at (0,0): my land (1,0) and (2,0), a
 * river at (3,0) (a column of river down q = 3), a meadow beyond, and my
 * cut-off tile (5,0) past it.
 */
function strip(): SupplyTile[] {
  const tiles: SupplyTile[] = [homeOf(0, 0, ME), land(1, 0, ME), land(2, 0, ME)];
  for (let r = -3; r <= 3; r++) tiles.push(land(3, r, null, 'river'));
  tiles.push(land(4, 0), land(5, 0, ME), land(6, 0), land(4, -1), land(2, 1), land(2, -1));
  tiles.push(land(1, 1), land(1, -1), land(0, 1), land(0, -1), land(-1, 0));
  return tiles;
}

describe('supplyMap (Wild Isle, #621)', () => {
  it('supplies my land joined to home and never steps on water', () => {
    const { supplied, reach } = supplyMap(strip(), [], [], ME, RULES);
    expect([...supplied].sort()).toEqual(['0,0', '1,0', '2,0'].sort());
    expect(reach.size).toBe(0);
  });

  it('crosses a river only through a bridge, anyone’s while bridges are shared', () => {
    const bridge = { q: 3, r: 0, ownerUserId: 'rival' };
    const withBridge = supplyMap(strip(), [], [bridge], ME, RULES);
    // The bridge carries the line to the river's far bank, but (4,0) isn't mine.
    expect(withBridge.supplied.has('3,0')).toBe(true);
    expect(withBridge.supplied.has('5,0')).toBe(false);
    const tiles = strip().map((t) => (t.q === 4 && t.r === 0 ? land(4, 0, ME) : t));
    expect(supplyMap(tiles, [], [bridge], ME, RULES).supplied.has('5,0')).toBe(true);
    // Not shared: only my own bridge crosses.
    const own = { ...RULES, bridgesShared: false };
    expect(supplyMap(tiles, [], [bridge], ME, own).supplied.has('5,0')).toBe(false);
    expect(
      supplyMap(tiles, [], [{ ...bridge, ownerUserId: ME }], ME, own).supplied.has('5,0'),
    ).toBe(true);
    // A bridge on anything but a river tile carries nothing.
    expect(supplyMap(strip(), [], [{ q: 4, r: 0, ownerUserId: ME }], ME, RULES).supplied.size).toBe(
      3,
    );
  });

  it('reaches past my land by the road’s level, over land only', () => {
    const tiles = [
      homeOf(0, 0, ME),
      land(1, 0, ME),
      ...[2, 3, 4, 5].map((q) => land(q, 0)),
      land(1, 1),
      land(0, 1),
      land(1, -1),
      land(2, -1),
    ];
    const path = supplyMap(tiles, [{ q: 1, r: 0, ownerUserId: ME, level: 1 }], [], ME, RULES);
    expect(path.reach.get('2,0')).toBe(1);
    expect(path.reach.has('3,0')).toBe(false);
    const paved = supplyMap(tiles, [{ q: 1, r: 0, ownerUserId: ME, level: 3 }], [], ME, RULES);
    expect(paved.reach.get('3,0')).toBe(2);
    expect(paved.reach.get('4,0')).toBe(3);
    expect(paved.reach.has('5,0')).toBe(false);
    // My home tile is mine, never "reach".
    expect(paved.reach.get('0,0')).toBe(1);
    expect(paved.supplied.has('0,0')).toBe(true);
  });

  it('counts steps round water, and land in a road’s reach is supplied', () => {
    // My road at (2,0) by a river; (5,0), mine, is 3 straight steps away but
    // the river at (3,0) and (4,-1) makes the walk longer.
    const tiles = strip();
    const road = { q: 2, r: 0, ownerUserId: ME, level: 3 };
    const { supplied, reach } = supplyMap(tiles, [road], [], ME, RULES);
    expect(reach.has('3,0')).toBe(false); // water
    expect(reach.has('5,0')).toBe(false); // the river walls it
    expect(supplied.has('5,0')).toBe(false);
    const bridged = supplyMap(tiles, [road], [{ q: 3, r: 0, ownerUserId: ME }], ME, RULES);
    expect(bridged.reach.get('4,0')).toBeUndefined(); // reach never crosses water
    // A road carries supply across a gap of someone else's land.
    const gap = [homeOf(0, 0, ME), land(1, 0, ME), land(2, 0, 'rival'), land(3, 0, ME)];
    const roaded = supplyMap(gap, [{ q: 1, r: 0, ownerUserId: ME, level: 2 }], [], ME, RULES);
    expect(roaded.supplied.has('3,0')).toBe(true);
    expect(supplyMap(gap, [], [], ME, RULES).supplied.has('3,0')).toBe(false);
  });

  it('ignores a road on land that isn’t its owner’s, or on cut-off land', () => {
    const tiles = strip();
    const stale = supplyMap(tiles, [{ q: 4, r: 0, ownerUserId: ME, level: 3 }], [], ME, RULES);
    expect(stale.reach.size).toBe(0);
    const cutOff = supplyMap(tiles, [{ q: 5, r: 0, ownerUserId: ME, level: 3 }], [], ME, RULES);
    expect(cutOff.reach.size).toBe(0);
    const rivals = supplyMap(
      tiles,
      [{ q: 1, r: 0, ownerUserId: 'rival', level: 3 }],
      [],
      ME,
      RULES,
    );
    expect(rivals.reach.size).toBe(0);
  });

  it('is empty for a player with no home here', () => {
    expect(supplyMap(strip(), [], [], 'stranger', RULES).supplied.size).toBe(0);
  });
});

describe('attackTargetProblem with supply (Wild Isle, #621)', () => {
  const tiles = strip();
  it('refuses water and land past my supply line', () => {
    const supply = supplyMap(tiles, [], [], ME, RULES);
    expect(attackTargetProblem(land(3, 0, null, 'river'), tiles, ME, 'on', supply)).toBe('water');
    expect(attackTargetProblem(land(2, 1), tiles, ME, 'on', supply)).toBeNull();
    // (6,0) touches my cut-off (5,0): today that's near enough, not on a Wild Isle.
    expect(attackTargetProblem(land(6, 0), tiles, ME, 'on')).toBeNull();
    expect(attackTargetProblem(land(6, 0), tiles, ME, 'on', supply)).toBe('too-far');
  });

  it('allows land in a road’s reach and beyond a bridge', () => {
    const gap = [homeOf(0, 0, ME), land(1, 0, ME), land(2, 0), land(3, 0)];
    const supply = supplyMap(gap, [{ q: 1, r: 0, ownerUserId: ME, level: 2 }], [], ME, RULES);
    expect(attackTargetProblem(land(3, 0), gap, ME, 'on', supply)).toBeNull();
    const bridged = supplyMap(tiles, [], [{ q: 3, r: 0, ownerUserId: 'rival' }], ME, RULES);
    expect(attackTargetProblem(land(4, 0), tiles, ME, 'on', bridged)).toBeNull();
    expect(
      attackTargetProblem(land(4, 0), tiles, ME, 'on', supplyMap(tiles, [], [], ME, RULES)),
    ).toBe('too-far');
  });
});

/** `attackTargetProblem` as it stood before Wild Isles (main 6ade165), kept verbatim. */
function attackTargetProblemBefore(
  target: TerritoryTile,
  tiles: readonly TerritoryTile[],
  userId: string,
  pvpMode: PvpMode,
): AttackTargetProblem | null {
  if (target.homeSlot !== null) return 'home';
  if (target.terrain !== undefined && isTradingPost({ terrain: target.terrain }))
    return 'trading-post';
  if ((target.communityId ?? null) !== null && target.restored !== true) return 'hollowed';
  if (target.ownerUserId === userId) return 'mine';
  const mine = new Set(tiles.filter((t) => t.ownerUserId === userId).map(hexKey));
  if (!hexNeighbors(target).some((n) => mine.has(hexKey(n)))) return 'too-far';
  if (target.ownerUserId !== null && pvpMode === 'off') return 'pvp-off';
  return null;
}

describe('a Cozy Patch is unchanged (#621 §10)', () => {
  // Six Keepers on a generated Cozy map, each holding a blob of land grown
  // from home (a few rings, rivals' blobs where they meet) plus a tile cut
  // off far away, so every rule the old function had gets exercised.
  const map = generateMap(GAME_DATA, { seed: 'cozy-reach', playerCount: 6 });
  const owners = map.homes.map((_, slot) => `keeper-${String(slot)}`);
  const ownerAt = new Map<HexKey, string>();
  map.homes.forEach((home, slot) => {
    for (const t of map.tiles) {
      if (t.homeSlot === null && hexDistance(t, home) <= 3 && !ownerAt.has(hexKey(t)))
        ownerAt.set(hexKey(t), owners[slot]!);
    }
    ownerAt.set(hexKey({ q: -home.q, r: -home.r }), owners[slot]!);
  });
  const tiles = map.tiles.map((t) => ({
    ...t,
    ownerUserId: t.homeSlot !== null ? owners[t.homeSlot]! : (ownerAt.get(hexKey(t)) ?? null),
  }));

  it('has no water, so no tile is ever "water"', () => {
    expect(tiles.some((t) => isWaterTerrain(t.terrain))).toBe(false);
  });

  it('gives what the old rules gave for every tile and every Keeper, with no supply', () => {
    let checked = 0;
    for (const userId of [...owners, 'stranger']) {
      for (const pvp of ['off', 'gentle', 'on'] as const) {
        for (const t of tiles) {
          expect(attackTargetProblem(t, tiles, userId, pvp)).toBe(
            attackTargetProblemBefore(t, tiles, userId, pvp),
          );
          checked++;
        }
      }
    }
    expect(checked).toBe(tiles.length * 7 * 3);
  });

  it('gives the same with a supply line over land that is all joined up', () => {
    const joined = tiles.map((t) =>
      // Drop the far-off tiles: with every tile joined, supply changes nothing.
      t.ownerUserId !== null &&
      t.homeSlot === null &&
      !connectedLand(tiles, t.ownerUserId).has(hexKey(t))
        ? { ...t, ownerUserId: null }
        : t,
    );
    for (const userId of owners) {
      const supply = supplyMap(joined, [], [], userId, RULES);
      for (const t of joined) {
        expect(attackTargetProblem(t, joined, userId, 'on', supply)).toBe(
          attackTargetProblemBefore(t, joined, userId, 'on'),
        );
      }
    }
  });
});
