import {
  findAvoidedWords,
  hexDistance,
  hexKey,
  type HomeResponse,
  type MapView,
  type MyBuilding,
  type PublicBuilding,
} from '@heartpatch/shared';
import { describe, expect, it } from 'vitest';
import { findHomeBases } from '../map/map-layout.js';
import { testView, userId } from '../map/test-view.js';
import { HOME_VIEW } from './home-config.js';
import { HOME_TEXT } from './home-screen.js';
import { mapBuildings, mapSafeTiles, spotWorld } from './home-layout.js';
import { homeTileLines } from './home-tile-info.js';
import {
  buildingNote,
  buildRows,
  fireStatus,
  freeHomeSpots,
  likesHabitat,
  refundPreview,
} from './home-view.js';

const ID = (n: number) => `0190a8c4-0000-7000-8000-0000000001${String(n).padStart(2, '0')}`;

const fire = (extra: Partial<MyBuilding> = {}): MyBuilding => ({
  id: ID(1),
  buildingId: 'hearthfire',
  kind: 'hearthfire',
  level: 1,
  spot: 1,
  lit: false,
  safeRadius: 1,
  q: 0,
  r: 0,
  nightsLeft: 0,
  fuelSpace: 5,
  capacity: null,
  residents: null,
  ...extra,
});

const meadow = (extra: Partial<MyBuilding> = {}): MyBuilding => ({
  id: ID(2),
  buildingId: 'cozy-meadow',
  kind: 'habitat',
  level: 1,
  spot: 2,
  lit: null,
  safeRadius: null,
  q: 0,
  r: 0,
  nightsLeft: null,
  fuelSpace: null,
  capacity: 3,
  residents: 0,
  ...extra,
});

/** A home of seven tiles around (0, 0): the Heart Seed, a Timber node and five plain tiles. */
function homeWith(extra: Partial<HomeResponse> = {}): HomeResponse {
  const ring = [
    [1, 0],
    [1, -1],
    [0, -1],
    [-1, 0],
    [-1, 1],
    [0, 1],
  ] as const;
  return {
    tiles: [
      { q: 0, r: 0, heartSeed: true, nodeResource: null },
      ...ring.map(([q, r], i) => ({
        q,
        r,
        heartSeed: false,
        nodeResource: i === 0 ? 'timber' : null,
      })),
    ],
    buildings: [],
    squishies: [],
    speciesDefs: [],
    items: { timber: 20, stone: 20 },
    seasons: ['halloween'],
    tonight: '2026-10-02',
    now: '2026-10-02T12:00:00.000Z',
    ...extra,
  };
}

/** A map view where player 1's home tile holds these buildings. */
function viewWith(buildings: PublicBuilding[]): { view: MapView; seed: { q: number; r: number } } {
  const view = testView(2);
  const seed = findHomeBases(view.tiles)[0]!.seed;
  return {
    seed,
    view: {
      ...view,
      tiles: view.tiles.map((t) => (t.q === seed.q && t.r === seed.r ? { ...t, buildings } : t)),
    },
  };
}

describe('home layout', () => {
  it('puts spot 0 in the middle of a tile and spots 1–6 around it, inside the tile', () => {
    const size = 2;
    const middle = spotWorld({ q: 1, r: 0 }, 0, size);
    for (let spot = 1; spot <= 6; spot++) {
      const p = spotWorld({ q: 1, r: 0 }, spot, size);
      const d = Math.hypot(p.x - middle.x, p.z - middle.z);
      expect(d).toBeGreaterThan(size * 0.3);
      expect(d).toBeLessThan(size * 0.8); // the tile's inner radius is ~0.82 × size
    }
  });

  it('glows over every home tile and the radius of a lit fire, and nothing for an unlit one', () => {
    const lit = { ...fire({ lit: true }) };
    const { view, seed } = viewWith([lit]);
    const safe = mapSafeTiles(view);
    expect(safe.size).toBe(7); // radius 1 from the Heart Seed is the home base itself
    for (const key of safe) {
      const [q, r] = key.split(',').map(Number);
      expect(hexDistance({ q: q!, r: r! }, seed)).toBeLessThanOrEqual(1);
    }
    expect(mapSafeTiles(viewWith([fire({ lit: false })]).view).size).toBe(0);
    expect(mapSafeTiles(viewWith([meadow()]).view).size).toBe(0);
    const bright = mapSafeTiles(viewWith([fire({ lit: true, safeRadius: 2 })]).view);
    expect(bright.size).toBe(19);
    expect(bright.has(hexKey(seed))).toBe(true);
  });

  it('lists every building on the map with where it stands', () => {
    const { view } = viewWith([fire(), meadow()]);
    expect(mapBuildings(view, 0.65).map((b) => b.building.buildingId)).toEqual([
      'hearthfire',
      'cozy-meadow',
    ]);
  });
});

describe('home screen copy', () => {
  it('says how the fire is doing', () => {
    expect(fireStatus([])).toBe('Build a Hearthfire to keep everyone safe at night!');
    expect(fireStatus([fire()])).toBe('Your fire is out! Add some Emberwood.');
    expect(fireStatus([fire({ lit: true, nightsLeft: 1 })])).toBe(
      'Your fire is lit: 1 night left.',
    );
    expect(fireStatus([fire({ lit: true, nightsLeft: 4 })])).toBe(
      'Your fire is lit: 4 nights left.',
    );
    expect(buildingNote(fire({ nightsLeft: 3 }))).toBe('Lit! 3 nights of fuel left.');
    expect(buildingNote(meadow({ residents: 2 }))).toBe('2 of 3 squishies live here.');
  });

  it('describes buildings on a home tile for everyone, with a nudge for the owner', () => {
    const { view, seed } = viewWith([fire({ lit: true }), meadow()]);
    const tile = view.tiles.find((t) => t.q === seed.q && t.r === seed.r)!;
    expect(homeTileLines(tile, userId(2))).toEqual([
      '🔥 Hearthfire: lit and keeping everyone cozy.',
      '🌼 Cozy Meadow',
    ]);
    const out = { ...tile, buildings: [fire({ lit: false })] };
    expect(homeTileLines(out, userId(1))).toEqual(['🔥 Hearthfire: out! Add Emberwood at home.']);
    expect(homeTileLines(out, userId(2))).toEqual(['🔥 Hearthfire: out.']);
  });

  it('never uses an avoided word', () => {
    const lines = [
      ...Object.values(HOME_TEXT).map((t) => (typeof t === 'function' ? t('Thing', 'Stuff') : t)),
      fireStatus([]),
      fireStatus([fire()]),
      buildingNote(fire()),
      buildingNote(meadow()),
      ...buildRows(homeWith({ items: {} })).map((r) =>
        r.option.kind === 'blocked' ? r.option.note : '',
      ),
    ];
    for (const line of lines) expect(findAvoidedWords(line), line).toEqual([]);
  });
});

describe('build menu', () => {
  it('offers fires and habitats, and says why one can’t be built', () => {
    const rows = buildRows(homeWith({ buildings: [fire()] }));
    expect(rows.map((r) => r.building.id)).toEqual([
      'hearthfire',
      'jack-o-lantern-hearthfire',
      'ember-den',
      'cozy-meadow',
    ]);
    const byId = new Map(rows.map((r) => [r.building.id, r.option]));
    expect(byId.get('hearthfire')).toEqual({
      kind: 'blocked',
      note: 'Your home has all it can hold.',
    });
    expect(byId.get('jack-o-lantern-hearthfire')).toEqual({
      kind: 'blocked',
      note: "Need 1 🏮 Jack-o'-Lantern Hearthfire more.",
    });
    expect(byId.get('cozy-meadow')).toEqual({ kind: 'ready' });
  });

  it('leaves the Jack-o-Lantern out of season unless one is already built', () => {
    const off = buildRows(homeWith({ seasons: [] })).map((r) => r.building.id);
    expect(off).not.toContain('jack-o-lantern-hearthfire');
  });

  it('finds free spots: Heart Seed tile first, never a middle with a seed or node', () => {
    const spots = freeHomeSpots(homeWith({ buildings: [fire({ spot: 1 })] }));
    expect(spots[0]).toEqual({ q: 0, r: 0, spot: 2 });
    expect(spots.some((s) => s.q === 0 && s.r === 0 && s.spot === 0)).toBe(false);
    expect(spots.some((s) => s.q === 1 && s.r === 0 && s.spot === 0)).toBe(false); // Timber
    expect(spots.some((s) => s.q === 0 && s.r === 0 && s.spot === 1)).toBe(false); // taken
    // 6 + 6 (node tile) + 5 × 7 − 1 taken
    expect(spots).toHaveLength(6 + 6 + 35 - 1);
    // A building being moved: its own spot counts as free.
    const moving = freeHomeSpots(homeWith({ buildings: [fire({ spot: 1 })] }), ID(1));
    expect(moving[0]).toEqual({ q: 0, r: 0, spot: 1 });
  });

  it('previews what taking down gives back, unburned fuel included', () => {
    expect(refundPreview(fire({ nightsLeft: 2 }))).toEqual({ timber: 2, stone: 2, emberwood: 2 });
    expect(refundPreview(meadow())).toEqual({ timber: 2, stone: 1 });
  });

  it('knows which squishies love a habitat', () => {
    const pal = {
      id: ID(9),
      speciesId: 'x',
      element: 'leaf' as const,
      feeling: 'joy' as const,
      nickname: null,
      level: 1,
      habitatId: null,
    };
    expect(likesHabitat(pal, 'cozy-meadow')).toBe(true);
    expect(likesHabitat(pal, 'ember-den')).toBe(false);
    expect(likesHabitat(pal, 'hearthfire')).toBe(false);
  });
});

describe('home base colours (#131)', () => {
  /** WCAG relative luminance of an sRGB hex colour. */
  const luminance = (hex: string): number => {
    const [r, g, b] = [1, 3, 5].map((i) => {
      const c = parseInt(hex.slice(i, i + 2), 16) / 255;
      return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * (r ?? 0) + 0.7152 * (g ?? 0) + 0.0722 * (b ?? 0);
  };
  const contrast = (a: string, b: string): number => {
    const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
    return ((hi ?? 0) + 0.05) / ((lo ?? 0) + 0.05);
  };

  it('keeps the home tiles below near-white, so the sun and bloom never wash them out', () => {
    // The map's cream (#fff0d4, ~0.88) rendered pure white with a halo up close.
    expect(luminance(HOME_VIEW.tile.color)).toBeLessThan(0.75);
    expect(HOME_VIEW.tile.roughness).toBeGreaterThanOrEqual(0.7);
  });

  it('makes the build spots stand out from the tiles', () => {
    expect(contrast(HOME_VIEW.spot.ring, HOME_VIEW.tile.color)).toBeGreaterThanOrEqual(2);
  });
});
