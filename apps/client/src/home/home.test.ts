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
  atHome,
  buildingNote,
  buildRows,
  FIRES_ON_LAND,
  HOME_SAFE_LINE,
  freeHomeSpots,
  fuelAllOffer,
  landFireLine,
  landFires,
  landTileOffer,
  LAND_FIRE,
  likesHabitat,
  refundPreview,
  trainCost,
  upgradeOffer,
  upgradeReach,
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

  it('glows over every claimed home (the Heart Seed) and the radius of a lit fire', () => {
    const { view, seed } = viewWith([meadow()]);
    const homes = view.tiles.filter((t) => t.homeSlot !== null && t.ownerUserId !== null);
    const base = mapSafeTiles(view);
    expect([...base].sort()).toEqual(homes.map(hexKey).sort());
    expect([...mapSafeTiles(viewWith([fire({ lit: false })]).view)].sort()).toEqual(
      [...base].sort(),
    );
    // A lit fire's radius past the home base glows too.
    const bright = mapSafeTiles(viewWith([fire({ lit: true, safeRadius: 2 })]).view);
    for (const key of base) expect(bright.has(key)).toBe(true);
    expect([...bright].some((key) => !base.has(key))).toBe(true);
    for (const key of bright) {
      if (base.has(key)) continue;
      const [q, r] = key.split(',').map(Number);
      expect(hexDistance({ q: q!, r: r! }, seed)).toBe(2);
    }
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
  it('says home is safe, and how a fire is doing', () => {
    expect(HOME_SAFE_LINE).toBe('Your Heart Seed keeps home safe 💗');
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
      ...Object.values(HOME_TEXT).map((t) =>
        typeof t === 'function' ? (t as (...args: unknown[]) => string)('Thing', 2) : t,
      ),
      HOME_SAFE_LINE,
      FIRES_ON_LAND,
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
  it('offers fires, habitats and Training Grounds, and says why one can’t be built', () => {
    const rows = buildRows(homeWith({ buildings: [fire()], items: { timber: 4, stone: 9 } }));
    expect(rows.map((r) => r.building.id)).toEqual([
      'hearthfire',
      'jack-o-lantern-hearthfire',
      'ember-den',
      'cozy-meadow',
      'training-grounds',
    ]);
    const byId = new Map(rows.map((r) => [r.building.id, r]));
    // Fires go out on land, never at home (owner decision 2026-10-07): no Build, no cost line.
    expect(byId.get('hearthfire')).toMatchObject({
      option: {
        kind: 'land',
        note: 'Fires go on your land, in the middle of a tile 🔥. Your Heart Seed keeps home safe!',
      },
      where: '',
      needs: [],
    });
    // Never "to build X you need X" (design review 2026-10-05): make the lantern first.
    expect(byId.get('jack-o-lantern-hearthfire')?.option).toEqual({
      kind: 'craft',
      note: "Carve a Jack-o'-Lantern first! It's in your recipe book.",
    });
    expect(byId.get('jack-o-lantern-hearthfire')?.needs.map((n) => n.label)).toEqual(['🏮 0/1']);
    // One cost line, as have/need chips.
    expect(byId.get('cozy-meadow')).toMatchObject({ option: { kind: 'ready' } });
    expect(byId.get('cozy-meadow')?.needs.map((n) => [n.label, n.ok])).toEqual([
      ['🪵 4/4', true],
      ['🪨 9/2', true],
    ]);
    expect(byId.get('ember-den')?.option).toEqual({ kind: 'short' });
    expect(byId.get('ember-den')?.needs.map((n) => [n.label, n.ok])).toEqual([
      ['🪵 4/5', false],
      ['🪨 9/3', true],
    ]);
  });

  it('offers the next level with what it does and costs, and nothing past the top', () => {
    const home = homeWith({ buildings: [fire()], items: { timber: 12, stone: 10 } });
    expect(upgradeOffer(home, fire())).toMatchObject({
      from: 1,
      to: 2,
      affordable: true,
      radius: 2,
      line: 'Its light will reach 2 tiles. Squishies out there stay safe at night!',
      next: 'Next time: Level 3 reaches 3 tiles and needs 💎 Glimmer.',
    });
    expect(upgradeOffer(home, fire())?.needs.map((n) => n.label)).toEqual(['🪵 12/10', '🪨 10/10']);
    const two = upgradeOffer(home, fire({ level: 2, safeRadius: 2 }));
    expect(two).toMatchObject({ to: 3, affordable: false, next: null });
    expect(upgradeOffer(home, fire({ level: 3, safeRadius: 3 }))).toBeNull();
    expect(upgradeOffer(home, meadow())).toMatchObject({
      to: 2,
      line: 'Room for 5 squishies (now 3).',
      radius: null,
    });
  });

  it('describes the Training Grounds and what upgrading them does', () => {
    const grounds: MyBuilding = {
      ...meadow(),
      buildingId: 'training-grounds',
      kind: 'training-grounds',
      capacity: 2,
      residents: 1,
    };
    expect(buildingNote(grounds)).toBe(
      "1 of 2 squishies are practicing. They learn a little every hour, even while you're away.",
    );
    expect(upgradeOffer(homeWith(), grounds)).toMatchObject({
      to: 2,
      line: 'Room for 3 squishies, and they learn a little faster.',
    });
  });

  it('says what Train would stop on the Training Grounds card', () => {
    expect(trainCost({ job: 'guard' })).toBe('On watch · Train ends it');
    expect(trainCost({ job: 'gatherer' })).toBe('Gathering · Train stops it');
    expect(trainCost({ job: 'team' })).toBe('On the team · Train takes them off');
    expect(trainCost({ job: 'resting' })).toBe('');
  });

  it("maps where the fire's light reaches now and after the upgrade", () => {
    const home = homeWith();
    const reach = upgradeReach(home, fire({ q: 0, r: 0 }), 2);
    const count = (state: string) => reach.filter((t) => t.state === state).length;
    expect(count('now')).toBe(7); // the home base
    expect(count('new')).toBe(12); // ring 2 around the Heart Seed
    expect(count('outside')).toBe(18); // ring 3, the edge of the little map
    expect(reach.every((t) => hexDistance(t, { q: 0, r: 0 }) <= 3)).toBe(true);
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
      trainingId: null,
      job: 'resting' as const,
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

describe('fires on my land (#202) and typed spots (#204)', () => {
  // My fire out on captured land at (3, 0), two nights left.
  const outer = fire({ id: ID(9), q: 3, r: 0, spot: 0, nightsLeft: 2, fuelSpace: 3, lit: true });
  const homeFire = fire({ q: 0, r: -1, spot: 0, nightsLeft: 1, fuelSpace: 4, lit: true });

  it('keeps the home screen to home buildings, and fires to my land', () => {
    const home = homeWith({ buildings: [homeFire, outer] });
    expect(atHome(home).buildings.map((b) => b.id)).toEqual([homeFire.id]);
    expect(landFires(home).map((b) => b.id)).toEqual([outer.id]);
  });

  it('lights only the right kind of spot (#204)', () => {
    const home = homeWith();
    // Five plain tiles have a free middle; the Heart Seed and the node don't.
    expect(freeHomeSpots(home, null, 'centre')).toHaveLength(5);
    expect(freeHomeSpots(home, null, 'centre').every((s) => s.spot === 0)).toBe(true);
    expect(freeHomeSpots(home, null, 'ring').every((s) => s.spot > 0)).toBe(true);
    const rows = new Map(buildRows(home).map((r) => [r.building.id, r.where]));
    expect(rows.get('cozy-meadow')).toBe('Goes around the middle 🏡');
  });

  it('offers Fuel all fires with what filling every fire costs, once a fire is out on my land', () => {
    expect(fuelAllOffer(homeWith({ buildings: [homeFire] }))).toBeNull();
    expect(fuelAllOffer(homeWith({ buildings: [homeFire, outer] }))).toEqual({
      land: 1,
      low: 1,
      cost: { emberwood: 7 },
      full: false,
    });
    const full = [
      { ...homeFire, nightsLeft: 5, fuelSpace: 0 },
      { ...outer, nightsLeft: 5, fuelSpace: 0 },
    ];
    expect(fuelAllOffer(homeWith({ buildings: full }))).toMatchObject({ full: true, cost: {} });
  });

  it('offers a fire on my land: its card, a build, or a word about the node in the middle', () => {
    const home = homeWith({ buildings: [outer], items: { timber: 5, stone: 2 } });
    const tile = { q: 3, r: 0, nodeResource: null, buildings: [{ spot: 0 }] };
    expect(landTileOffer(tile, home)).toEqual({ kind: 'fire', fire: outer });
    const empty = landTileOffer({ ...tile, q: 4, buildings: [] }, home);
    expect(empty).toMatchObject({ kind: 'build', building: { id: 'hearthfire' } });
    expect(empty.kind === 'build' && empty.needs.map((n) => n.ok)).toEqual([true, false]);
    expect(landTileOffer({ ...tile, q: 4, nodeResource: 'timber', buildings: [] }, home)).toEqual({
      kind: 'node',
      line: '🔥 Fires go in the middle of a tile. This one has a Timber pile there, so a fire next door can reach it!',
    });
    expect(landFireLine(LAND_FIRE!)).toBe(
      'It goes in the middle of this tile 🔥 and keeps everyone within 1 tile cozy at night.',
    );
  });
});
