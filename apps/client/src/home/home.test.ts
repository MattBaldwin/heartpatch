import {
  findAvoidedWords,
  GAME_DATA,
  hexDistance,
  hexKey,
  hexToWorld,
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
import {
  filledTiles,
  fillsTile,
  mapBuildings,
  mapSafeTiles,
  nodeAside,
  spotWorld,
} from './home-layout.js';
import { homeTileLines } from './home-tile-info.js';
import {
  atHome,
  buildingNote,
  buildRows,
  ON_HOMESTEAD,
  effectChip,
  effectChips,
  FIRES_ON_LAND,
  HOME_SAFE_LINE,
  freeHomeSpots,
  fuelAllOffer,
  HOME_ALL_BUILT,
  HOME_ALL_TOP,
  HOME_FULL,
  HOME_FULL_GROW,
  homeBuildReason,
  landFires,
  BUILT_ON_HOMESTEAD,
  factoryTileOffer,
  groundsTileOffer,
  landTileOffer,
  LAND_FIRE,
  likesHabitat,
  refundPreview,
  speciesMap,
  squishyRarity,
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

  it("glows around a won Lantern Tower every night, and not before it's won (#306 PR 3b)", () => {
    const { view } = viewWith([meadow()]);
    const base = mapSafeTiles(view);
    const far = view.tiles.find((t) => t.homeSlot === null && !base.has(hexKey(t)))!;
    const village = {
      id: '00000000-0000-4000-8000-000000000001',
      name: 'Bramble Glen',
      kind: 'lantern-tower' as const,
      square: { q: far.q, r: far.r },
      tiles: [{ q: far.q, r: far.r }],
      restored: 1,
      ownerUserId: null,
      reach: null,
      distance: null,
    };
    expect(mapSafeTiles({ ...view, communities: [village] }).has(hexKey(far))).toBe(false);
    const lit = mapSafeTiles({ ...view, communities: [{ ...village, ownerUserId: userId(2) }] });
    expect(lit.has(hexKey(far))).toBe(true);
    for (const key of lit) {
      if (base.has(key)) continue;
      const [q, r] = key.split(',').map(Number);
      expect(hexDistance({ q: q!, r: r! }, far)).toBeLessThanOrEqual(2);
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

describe('a building filling its home tile (#589)', () => {
  /** A building on a ring tile of the first home, and one on its Heart Seed tile. */
  function ringView() {
    const view = testView(2);
    const base = findHomeBases(view.tiles)[0]!;
    const ringTile = view.tiles.find(
      (t) => t.homeSlot === base.slot && !(t.q === base.seed.q && t.r === base.seed.r),
    )!;
    const put = (at: { q: number; r: number }, b: PublicBuilding) => ({
      ...view,
      tiles: view.tiles.map((t) => (t.q === at.q && t.r === at.r ? { ...t, buildings: [b] } : t)),
    });
    return { base, ringTile, put };
  }

  it('fills ring spots off the Heart Seed tile, never the centre spot or the seed tile', () => {
    expect(fillsTile(2, false)).toBe(true);
    expect(fillsTile(0, false)).toBe(false);
    expect(fillsTile(2, true)).toBe(false);
  });

  it('stands a ring-spot building in its tile middle and tucks the node aside', () => {
    const { ringTile, put } = ringView();
    const view = put(ringTile, meadow({ spot: 3 }));
    const [placed] = mapBuildings(view, 0.65);
    const middle = hexToWorld(ringTile, 0.65);
    expect(placed!.fills).toBe(true);
    expect(placed!.at).toEqual(middle);
    expect(filledTiles(view)).toEqual(new Set([hexKey(ringTile)]));
    const aside = nodeAside(middle, 0.65);
    expect(Math.hypot(aside.x - middle.x, aside.z - middle.z)).toBeGreaterThan(0.65 * 0.5);
  });

  it('leaves the Heart Seed tile and a ring tile with no building as they were', () => {
    const { base, ringTile, put } = ringView();
    const onSeed = put(base.seed, meadow({ spot: 3 }));
    const [seeded] = mapBuildings(onSeed, 0.65);
    expect(seeded!.fills).toBe(false);
    expect(seeded!.at).toEqual(spotWorld(base.seed, 3, 0.65));
    expect(filledTiles(onSeed).size).toBe(0);
    expect(filledTiles(put(ringTile, meadow({ spot: 3 }))).has(hexKey(base.seed))).toBe(false);
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
      ...buildRows(homeWith({ items: {} })).flatMap((r) => [
        r.option.kind === 'blocked' ? r.option.note : '',
        r.description,
        ...r.effects,
      ]),
    ];
    for (const line of lines) expect(findAvoidedWords(line), line).toEqual([]);
  });
});

describe('build menu', () => {
  it('offers fires, habitats, Training Grounds and the Factory, and says why one can’t be built', () => {
    const rows = buildRows(homeWith({ buildings: [fire()], items: { timber: 4, stone: 9 } }));
    expect(rows.map((r) => r.building.id)).toEqual([
      'hearthfire',
      'jack-o-lantern-hearthfire',
      'ember-den',
      'cozy-meadow',
      'training-grounds',
      'crafting-factory',
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
      radius: 1,
      line: 'Same glow for now. At level 3 it reaches 2 tiles!',
      next: 'Next time: Level 3 reaches 2 tiles and needs 💎 Glimmer.',
    });
    expect(upgradeOffer(home, fire())?.needs.map((n) => n.label)).toEqual(['🪵 12/10', '🪨 10/10']);
    const two = upgradeOffer(home, fire({ level: 2, safeRadius: 1 }));
    expect(two).toMatchObject({
      to: 3,
      affordable: false,
      next: null,
      line: 'Its light will reach 2 tiles. Squishies out there stay safe at night!',
    });
    expect(upgradeOffer(home, fire({ level: 3, safeRadius: 2 }))).toBeNull();
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
    const empty = freeHomeSpots(homeWith());
    expect(empty[0]).toEqual({ q: 0, r: 0, spot: 1 });
    expect(empty.some((s) => s.q === 0 && s.r === 0 && s.spot === 0)).toBe(false);
    expect(empty.some((s) => s.q === 1 && s.r === 0 && s.spot === 0)).toBe(false); // Timber
    // 6 (Heart Seed) + 6 (node tile) + 5 × 7
    expect(empty).toHaveLength(6 + 6 + 35);
  });

  it('keeps one building per home tile, as the server does (#295, #537)', () => {
    const spots = freeHomeSpots(homeWith({ buildings: [fire({ spot: 1 })] }));
    // The Heart Seed's tile is taken whole: the first free spot is on the ring.
    expect(spots.some((s) => s.q === 0 && s.r === 0)).toBe(false);
    expect(spots).toHaveLength(6 + 35);
    // A building being moved: its own tile counts as free.
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
      accessory: null,
      houseRoomId: null,
    };
    expect(likesHabitat(pal, 'cozy-meadow')).toBe(true);
    expect(likesHabitat(pal, 'ember-den')).toBe(false);
    expect(likesHabitat(pal, 'hearthfire')).toBe(false);
  });

  it("gives a squishy's rarity for its dot in the home lists, secret ones too (#240)", () => {
    const pal = {
      id: ID(9),
      speciesId: 'puddlepuff',
      element: 'water' as const,
      feeling: 'joy' as const,
      nickname: null,
      level: 1,
      habitatId: null,
      trainingId: null,
      job: 'resting' as const,
      accessory: null,
      houseRoomId: null,
    };
    const rare = GAME_DATA.species.find((s) => s.rarity === 'rare');
    if (!rare) throw new Error('no rare species');
    const secret = { ...rare, id: 'heartlet', name: 'Heartlet', rarity: 'secret' as const };
    const species = speciesMap(homeWith({ speciesDefs: [secret] }));
    expect(squishyRarity(pal, species)).toBe('common');
    expect(squishyRarity({ ...pal, speciesId: rare.id }, species)).toBe('rare');
    expect(squishyRarity({ ...pal, speciesId: 'heartlet' }, species)).toBe('secret');
    expect(squishyRarity({ ...pal, speciesId: 'who-knows' }, species)).toBeNull();
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

  it('sends Training Grounds to a homestead, with their cost to show (#277)', () => {
    const row = buildRows(homeWith({ items: { timber: 20, stone: 2 } })).find(
      (r) => r.building.id === 'training-grounds',
    )!;
    expect(row.option).toEqual({ kind: 'homestead', note: ON_HOMESTEAD });
    expect(row.where).toBe('');
    expect(row.needs.map((n) => n.label)).toEqual(['🪵 20/8', '🪨 2/8']);
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
    // One building a tile (#295): someone else's building there leaves no room.
    expect(landTileOffer({ ...tile, q: 4, buildings: [{ spot: 2 }] }, home)).toEqual({
      kind: 'none',
    });
    const empty = landTileOffer({ ...tile, q: 4, buildings: [] }, home);
    expect(empty).toMatchObject({ kind: 'build', building: { id: 'hearthfire' } });
    expect(empty.kind === 'build' && empty.needs.map((n) => n.ok)).toEqual([true, false]);
    expect(landTileOffer({ ...tile, q: 4, nodeResource: 'timber', buildings: [] }, home)).toEqual({
      kind: 'node',
      line: '🔥 Fires go in the middle of a tile. This one has a Timber pile there, so a fire next door can reach it!',
    });
    // Land a tool clears says so (#242): clear it on a homestead, or join it up first.
    const stone = { ...tile, q: 4, nodeResource: 'stone', buildings: [], terrain: 'mountains' };
    expect(landTileOffer({ ...stone, homestead: 'joined' }, home)).toEqual({
      kind: 'node',
      line: '🔥 Fires go in the middle of a tile. This one has a Stone pile there, so a fire next door can reach it! Or clear it with a Pickaxe and build here 🌱',
    });
    expect(landTileOffer({ ...stone, homestead: null }, home)).toMatchObject({
      line: expect.stringMatching(/ Once it's a homestead, a Pickaxe can clear it 🌱$/) as string,
    });
    // A napping homestead wakes up first: no hint. Nor on land no tool clears in Phase 1.
    expect(landTileOffer({ ...stone, homestead: 'paused' }, home)).toMatchObject({
      line: expect.stringMatching(/reach it!$/) as string,
    });
    expect(
      landTileOffer({ ...stone, terrain: 'old-forest', homestead: 'joined' }, home),
    ).toMatchObject({ line: expect.stringMatching(/reach it!$/) as string });
    // No carved pumpkin, no lantern; with one in Halloween, its own build card and cost.
    expect(empty.kind === 'build' && empty.lantern).toBeNull();
    const carved = landTileOffer(
      { ...tile, q: 4, buildings: [] },
      homeWith({ buildings: [outer], items: { 'jack-o-lantern-hearthfire': 1 } }),
    );
    expect(carved.kind === 'build' && carved.lantern).toMatchObject({
      building: { id: 'jack-o-lantern-hearthfire' },
      needs: [{ ok: true }],
    });
  });
});

describe('the Crafting Factory on a homestead (#295)', () => {
  const factory = {
    ...fire({ id: ID(12), q: 3, r: 1, spot: 1 }),
    buildingId: 'crafting-factory',
    kind: 'factory' as const,
    nightsLeft: null,
    fuelSpace: null,
    lit: null,
    safeRadius: null,
  };
  const tile = (extra: Partial<{ homestead: 'joined' | 'paused' | null; q: number }> = {}) => ({
    q: 3,
    r: 1,
    nodeResource: null,
    homestead: 'joined' as const,
    buildings: [] as { spot: number }[],
    ...extra,
  });

  it('shows mine standing there, and offers my one Factory on an empty, open homestead', () => {
    expect(
      factoryTileOffer({ ...tile(), buildings: [{ spot: 1 }] }, homeWith({ buildings: [factory] })),
    ).toEqual({
      kind: 'factory',
      factory,
    });
    const offer = factoryTileOffer(tile(), homeWith());
    expect(offer).toMatchObject({ kind: 'build', building: { id: 'crafting-factory' } });
    expect(offer?.kind === 'build' && offer.spot).toEqual(expect.any(Number));
  });

  it('offers nothing with a Factory elsewhere, on a spot, a napping or non-homestead, or a taken tile', () => {
    const elsewhere = homeWith({ buildings: [{ ...factory, q: 9 }] });
    expect(factoryTileOffer(tile(), elsewhere)).toBeNull();
    expect(factoryTileOffer({ ...tile(), nodeResource: 'timber' }, homeWith())).toBeNull();
    expect(factoryTileOffer(tile({ homestead: 'paused' }), homeWith())).toBeNull();
    expect(factoryTileOffer(tile({ homestead: null }), homeWith())).toBeNull();
    expect(factoryTileOffer({ ...tile(), buildings: [{ spot: 0 }] }, homeWith())).toBeNull();
  });

  it('says where it goes on the home Build sheet, and that it is built once it is', () => {
    const row = (home: HomeResponse) =>
      buildRows(home).find((r) => r.building.id === 'crafting-factory')!;
    expect(row(homeWith()).option).toEqual({ kind: 'homestead', note: ON_HOMESTEAD });
    expect(row(homeWith({ buildings: [factory] })).option).toEqual({
      kind: 'built',
      note: BUILT_ON_HOMESTEAD,
    });
  });
});

describe('Training Grounds on a homestead (#277, mockup screen 6)', () => {
  const grounds = {
    ...fire({ id: ID(11), q: 3, r: 1, spot: 1 }),
    buildingId: 'training-grounds',
    kind: 'training-grounds' as const,
    nightsLeft: null,
    fuelSpace: null,
    lit: null,
    safeRadius: null,
    capacity: 2,
    residents: 1,
  };
  const tile = (extra: Partial<{ homestead: 'joined' | 'paused' | null; q: number }> = {}) => ({
    q: 3,
    r: 1,
    terrain: 'forest',
    nodeResource: 'timber',
    homestead: 'joined' as const,
    buildings: [{ spot: 0 }],
    ...extra,
  });

  it('shows the Training Grounds standing there, napping or not', () => {
    const home = homeWith({ buildings: [grounds] });
    expect(groundsTileOffer(tile(), home)).toEqual({ kind: 'grounds', grounds, napping: false });
    expect(groundsTileOffer(tile({ homestead: 'paused' }), home)).toEqual({
      kind: 'grounds',
      grounds,
      napping: true,
    });
  });

  it('offers to build them on an empty homestead, once its spot is cleared (#295)', () => {
    const home = homeWith({ items: { timber: 8, stone: 1 } });
    const offer = groundsTileOffer({ ...tile(), nodeResource: null, buildings: [] }, home);
    expect(offer).toMatchObject({ kind: 'build', building: { id: 'training-grounds' } });
    expect(offer?.kind === 'build' && offer.needs.map((n) => n.ok)).toEqual([true, false]);
    // A resource spot is cleared first (#242); one building a tile (#295).
    expect(groundsTileOffer({ ...tile(), buildings: [] }, home)).toMatchObject({
      kind: 'clear-first',
      building: { id: 'training-grounds' },
    });
    expect(groundsTileOffer({ ...tile(), nodeResource: null }, home)).toBeNull();
    // Land no tool clears (owner Q5) keeps its spot: nothing to wait for.
    expect(groundsTileOffer({ ...tile(), terrain: 'old-forest', buildings: [] }, home)).toBeNull();
    // Not on land that isn't a homestead; nothing new on a napping one.
    expect(groundsTileOffer(tile({ homestead: null }), home)).toBeNull();
    expect(groundsTileOffer(tile({ homestead: 'paused' }), home)).toEqual({ kind: 'napping' });
  });
});

describe('what each building does (#207)', () => {
  it('gives every build-menu row its description and effect chips, in data order', () => {
    const rows = buildRows(homeWith({ items: {} }));
    const byId = new Map(rows.map((r) => [r.building.id, r]));
    expect(rows[0]?.building.id).toBe('hearthfire');
    expect(byId.get('hearthfire')).toMatchObject({
      description: 'Keeps squishies out on your land safe from the Hollow Man at night.',
      effects: ['🛡️ Safe 1 tile around', '🪵 Needs fuel each night'],
    });
    expect(byId.get('ember-den')?.effects).toEqual([
      '✨ Faster growing: 🔥 Fire · Cozy',
      '🏠 Room for 3',
    ]);
    expect(byId.get('cozy-meadow')?.effects).toEqual([
      '✨ Faster growing: 🍃 Leaf · Cozy · Sleepy',
      '🏠 Room for 3',
    ]);
    expect(byId.get('training-grounds')?.effects).toEqual(['🏋️ 2 squishies · 5 XP/hr']);
  });

  it('words each effect for any number', () => {
    expect(effectChip({ kind: 'safe', radius: 0 })).toBe('🛡️ Keeps its own tile safe');
    expect(effectChip({ kind: 'safe', radius: 2 })).toBe('🛡️ Safe 2 tiles around');
    expect(effectChip({ kind: 'training', capacity: 1, xpPerHour: 8 })).toBe(
      '🏋️ 1 squishy · 8 XP/hr',
    );
    expect(effectChip({ kind: 'grows', elements: ['water'], feelings: [] })).toBe(
      '✨ Faster growing: 💧 Water',
    );
  });

  it('shows a fire’s chips on the land fire sheet, at level 1', () => {
    expect(effectChips(LAND_FIRE!)).toEqual(['🛡️ Safe 1 tile around', '🪵 Needs fuel each night']);
    expect(effectChips(LAND_FIRE!, 2)[0]).toBe('🛡️ Safe 1 tile around');
    expect(effectChips(LAND_FIRE!, 3)[0]).toBe('🛡️ Safe 2 tiles around');
  });
});

/** One building on each of the first `n` home tiles (Heart Seed, then the ring), as `make` says. */
function homeFilled(
  make: (i: number) => Partial<MyBuilding>,
  n = 7,
  extra: Partial<HomeResponse> = {},
) {
  const tiles = extra.tiles ?? homeWith().tiles;
  return homeWith({
    buildings: tiles
      .slice(0, n)
      .map((t, i) => meadow({ id: ID(10 + i), q: t.q, r: t.r, spot: 1, ...make(i) })),
    ...extra,
  });
}

/** The cards home's Build sheet shows (home-screen.ts `buildView`). */
const sheetCards = (home: HomeResponse) =>
  buildRows(home)
    .filter((r) => !['built', 'land', 'homestead'].includes(r.option.kind))
    .map((r) => r.building.id);

describe('a home base with no room left (#537)', () => {
  const den = { buildingId: 'ember-den' };
  // Four Ember Dens and four Cozy Meadows (each `maxPerHome: 4`, owner
  // 2026-10-18) need eight tiles: one more than a real home base's seven.
  // A real home can't reach this state; it guards the all-built lines for a
  // future cap or home-size change.
  const roomy = {
    tiles: [...homeWith().tiles, { q: 2, r: -1, heartSeed: false, nodeResource: null }],
  };

  it('holds four of each den and meadow (owner 2026-10-18)', () => {
    for (const id of ['ember-den', 'cozy-meadow']) {
      expect(GAME_DATA.buildings.find((b) => b.id === id)?.maxPerHome).toBe(4);
    }
  });

  it('says full once four dens and three meadows fill the seven home tiles', () => {
    const home = homeFilled((i) => (i < 4 ? den : {}), 7, { items: {} });
    const rows = new Map(buildRows(home).map((r) => [r.building.id, r.option]));
    expect(rows.get('ember-den')).toMatchObject({ kind: 'built' });
    expect(rows.get('cozy-meadow')).toEqual({ kind: 'blocked', note: HOME_FULL });
    // A den can still grow, so the sheet points to upgrades (owner 2026-10-18).
    expect(homeBuildReason(home)).toBe(HOME_FULL_GROW);
  });

  it('says take one down only once the full home is all at its top level', () => {
    const home = homeFilled((i) => ({ ...(i < 4 ? den : {}), level: 2 }), 7, { items: {} });
    expect(homeBuildReason(home)).toBe(HOME_FULL);
  });

  it('with every den and meadow built, only the lantern card is left', () => {
    const home = homeFilled((i) => (i < 4 ? den : {}), 8, { ...roomy, items: {} });
    expect(sheetCards(home)).toEqual(['jack-o-lantern-hearthfire']);
    const rows = new Map(buildRows(home).map((r) => [r.building.id, r.option.kind]));
    expect(rows.get('ember-den')).toBe('built');
    expect(rows.get('cozy-meadow')).toBe('built');
    // The sheet now says why.
    expect(homeBuildReason(home)).toBe(HOME_ALL_BUILT);
  });

  it('says they are as big as they get once every one is at its top level', () => {
    const home = homeFilled((i) => ({ ...(i < 4 ? den : {}), level: 2 }), 8, roomy);
    expect(homeBuildReason(home)).toBe(HOME_ALL_TOP);
  });

  it('says the home base is full when every tile holds a building', () => {
    // One Ember Den and six older fires still at home: a den could go up, but no tile is free.
    const home = homeFilled((i) =>
      i === 0 ? den : { buildingId: 'hearthfire', kind: 'hearthfire', capacity: null },
    );
    expect(freeHomeSpots(home)).toEqual([]);
    const row = buildRows(home).find((r) => r.building.id === 'ember-den')!;
    expect(row.option).toEqual({ kind: 'blocked', note: HOME_FULL });
    expect(homeBuildReason(home)).toBe(HOME_FULL_GROW);
  });

  it('says full before short: gathering more would not make room', () => {
    const home = homeFilled(() => ({ buildingId: 'hearthfire', kind: 'hearthfire' }), 7, {
      items: {},
    });
    const row = buildRows(home).find((r) => r.building.id === 'cozy-meadow')!;
    expect(row.option).toEqual({ kind: 'blocked', note: HOME_FULL });
  });

  it('gives no reason while a home building can still go up', () => {
    expect(homeBuildReason(homeWith())).toBeNull();
    // Short of stuff is the chips' job, not a reason line.
    expect(homeBuildReason(homeWith({ items: {} }))).toBeNull();
    // One tile left: still room.
    expect(homeBuildReason(homeFilled(() => ({ buildingId: 'hearthfire' }), 6))).toBeNull();
  });

  it('reads kindly (style guide §9)', () => {
    for (const line of [HOME_FULL, HOME_FULL_GROW, HOME_ALL_BUILT, HOME_ALL_TOP]) {
      expect(findAvoidedWords(line)).toEqual([]);
      expect(line.split(' ').length).toBeLessThanOrEqual(15);
    }
  });
});
