import {
  GAME_DATA,
  HEX_DIRECTIONS,
  generateMap,
  hexDistance,
  hexKey,
  hexToWorld,
  type PublicTile,
} from '@heartpatch/shared';
import { describe, expect, it } from 'vitest';
import { HEX_SIZE, TERRAIN_LOOKS } from './map-config.js';
import {
  findHomeBases,
  hash01,
  mapBounds,
  mapRadius,
  propPlacements,
  slotsByUser,
  tintSlot,
  maxZoomFor,
  hexIslandRadius,
  islandTiles,
} from './map-layout.js';
import { member, testView, testWildIsle, userId } from './test-view.js';

describe('findHomeBases', () => {
  it("finds every slot's Heart Seed: the middle of its 7-tile ring", () => {
    const view = testView();
    const homes = findHomeBases(view.tiles);
    expect(homes.map((h) => h.slot)).toEqual([0, 1, 2, 3]);
    for (const home of homes) {
      const ring = view.tiles.filter((t) => t.homeSlot === home.slot);
      expect(ring).toHaveLength(7);
      for (const t of ring) expect(hexDistance(t, home.seed)).toBeLessThanOrEqual(1);
    }
  });

  it('ignores a home ring cut short at the edge of the data', () => {
    const tile = (q: number, r: number): PublicTile => ({
      q,
      r,
      terrain: 'meadow',
      ownerUserId: null,
      nodeResource: null,
      homeSlot: 0,
      gathering: null,
      cooldownUntil: null,
      defenders: 0,
      guardianHint: null,
      buildings: [],
    });
    // Five of the six neighbours: no tile is surrounded, so no Heart Seed.
    const tiles = [tile(0, 0), ...HEX_DIRECTIONS.slice(0, 5).map((d) => tile(d.q, d.r))];
    expect(findHomeBases(tiles)).toEqual([]);
  });
});

describe('tintSlot', () => {
  const slots = slotsByUser([member(1, 0), member(2, 3)]);
  const tile = (owner: string | null): PublicTile => ({
    q: 0,
    r: 0,
    terrain: 'forest',
    ownerUserId: owner,
    nodeResource: null,
    homeSlot: null,
    gathering: null,
    cooldownUntil: null,
    defenders: 0,
    guardianHint: null,
    buildings: [],
  });

  it("uses the owner's home slot", () => {
    expect(tintSlot(tile(userId(1)), slots)).toBe(0);
    expect(tintSlot(tile(userId(2)), slots)).toBe(3);
  });

  it('leaves wild land and unknown owners untinted', () => {
    expect(tintSlot(tile(null), slots)).toBeNull();
    expect(tintSlot(tile(userId(9)), slots)).toBeNull();
  });
});

describe('mapBounds and mapRadius', () => {
  it('cover every tile centre and corner', () => {
    const { tiles } = testView();
    const b = mapBounds(tiles, HEX_SIZE);
    const r = mapRadius(tiles, HEX_SIZE);
    for (const t of tiles) {
      const p = hexToWorld(t, HEX_SIZE);
      expect(p.x).toBeGreaterThanOrEqual(b.minX);
      expect(p.x).toBeLessThanOrEqual(b.maxX);
      expect(p.z).toBeGreaterThanOrEqual(b.minZ);
      expect(p.z).toBeLessThanOrEqual(b.maxZ);
      expect(Math.sqrt(p.x * p.x + p.z * p.z) + HEX_SIZE).toBeLessThanOrEqual(r + 1e-9);
    }
    expect(b.minX).toBeCloseTo(-b.maxX, 9);
  });

  it('is a point for an empty map', () => {
    expect(mapBounds([], HEX_SIZE)).toEqual({ minX: 0, maxX: 0, minZ: 0, maxZ: 0 });
  });
});

describe('propPlacements', () => {
  const forest: PublicTile = {
    q: 3,
    r: -2,
    terrain: 'forest',
    ownerUserId: null,
    nodeResource: 'timber',
    homeSlot: null,
    gathering: null,
    cooldownUntil: null,
    defenders: 0,
    guardianHint: null,
    buildings: [],
  };
  const look = TERRAIN_LOOKS['forest']!;

  it('is the same on every call (same spots on every device)', () => {
    expect(propPlacements(forest, look, HEX_SIZE)).toEqual(propPlacements(forest, look, HEX_SIZE));
  });

  it('keeps props within the tile and within the count range', () => {
    const { tiles } = testView();
    for (const tile of tiles) {
      const l = TERRAIN_LOOKS[tile.terrain]!;
      const props = propPlacements(tile, l, HEX_SIZE);
      expect(props.length).toBeGreaterThanOrEqual(l.prop ? l.propsPerTile[0] : 0);
      expect(props.length).toBeLessThanOrEqual(l.prop ? l.propsPerTile[1] : 0);
      const c = hexToWorld(tile, HEX_SIZE);
      for (const p of props) {
        expect(p.kind).toBe(l.prop);
        expect(Math.hypot(p.at.x - c.x, p.at.z - c.z)).toBeLessThan(HEX_SIZE * 0.5);
      }
    }
  });

  it('gives terrain without props none', () => {
    expect(
      propPlacements({ ...forest, terrain: 'lake' }, TERRAIN_LOOKS['lake']!, HEX_SIZE),
    ).toEqual([]);
  });
});

describe('hash01', () => {
  it('stays in [0, 1) and spreads values out', () => {
    const values = Array.from({ length: 1000 }, (_, i) => hash01(i % 25, Math.floor(i / 25), 7));
    for (const v of values) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    expect(mean).toBeGreaterThan(0.4);
    expect(mean).toBeLessThan(0.6);
  });
});

describe('maxZoomFor (#318)', () => {
  it('frames a radius-12 patch at the camera’s own limit, and a radius-16 one further out', () => {
    const { tiles } = testView(1);
    expect(maxZoomFor(mapBounds(tiles, HEX_SIZE), 38)).toBeCloseTo(38, 5);
    const r16 = mapBounds(
      generateMap(GAME_DATA, { seed: 'zoom', playerCount: 6 }).tiles.map(
        ({ q, r }): PublicTile => ({ ...tiles[0]!, q, r }),
      ),
      HEX_SIZE,
    );
    expect(maxZoomFor(r16, 38)).toBeCloseTo((38 * 16) / 12, 5);
    // A small map never zooms in tighter than the camera allows anyway.
    expect(maxZoomFor({ minX: -1, maxX: 1, minZ: -1, maxZ: 1 }, 38)).toBe(38);
  });
});

describe('the Wild Isle island (#621)', () => {
  const view = testWildIsle();
  const ocean = (t: PublicTile) => t.terrain === 'ocean';

  it('is every tile on a Cozy map', () => {
    const cozy = testView(1);
    expect(islandTiles(cozy.tiles, ocean).size).toBe(cozy.tiles.length);
  });

  it('holds the land, rivers and lakes joined to the middle, and not the isles at sea', () => {
    const island = islandTiles(view.tiles, ocean);
    const land = view.tiles.filter((t) => !ocean(t));
    const isles = land.filter((t) => !island.has(hexKey(t)));
    expect(isles).toHaveLength(8); // two isles of four
    for (const t of isles) expect(hexDistance(t, { q: 0, r: 0 })).toBe(18);
    expect(
      view.tiles.filter((t) => t.terrain === 'river').every((t) => island.has(hexKey(t))),
    ).toBe(true);
  });

  it('sizes the island’s hexagon to hold every corner of its tiles', () => {
    const island = islandTiles(view.tiles, ocean);
    const tiles = view.tiles.filter((t) => island.has(hexKey(t)));
    const r = hexIslandRadius(tiles, HEX_SIZE);
    const apothem = r * (Math.sqrt(3) / 2);
    for (const t of tiles) {
      const p = hexToWorld(t, HEX_SIZE);
      for (let k = 0; k < 6; k++) {
        const a = ((30 + 60 * k) * Math.PI) / 180;
        expect(p.x * Math.cos(a) + p.z * Math.sin(a) + HEX_SIZE).toBeLessThanOrEqual(
          apothem + 1e-9,
        );
      }
    }
    // Snug: no bigger than the land's corner tiles need.
    expect(r).toBeLessThan(hexIslandRadius(view.tiles, HEX_SIZE));
  });
});
