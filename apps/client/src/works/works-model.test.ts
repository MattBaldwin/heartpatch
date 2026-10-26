import {
  findAvoidedWords,
  hexKey,
  hexNeighbors,
  type MapView,
  type PublicBuilding,
  type PublicTile,
} from '@heartpatch/shared';
import { describe, expect, it } from 'vitest';
import { testWildIsle, userId } from '../map/test-view.js';
import {
  WORKS_BUILDINGS,
  WORKS_TEXT,
  worksBuildCards,
  worksEffect,
  worksWaterProblem,
} from './works-model.js';

const ME = userId(1);
const base = testWildIsle();
const template = base.tiles[0];
if (!template) throw new Error('no tiles');

/** A plain tile at (q, r): nobody's meadow with nothing on it. */
const plain = (q: number, r: number, change: Partial<PublicTile> = {}): PublicTile => ({
  ...template,
  q,
  r,
  terrain: 'meadow',
  nodeResource: null,
  ownerUserId: null,
  homeSlot: null,
  homestead: null,
  clearing: null,
  buildings: [],
  ...change,
});

/** My empty, joined homestead at the origin. */
const HOME = plain(0, 0, { ownerUserId: ME, homestead: 'joined' });
const [EAST, , , WEST] = hexNeighbors(HOME);
if (!EAST || !WEST) throw new Error('no neighbours');
const EAST_KEY = hexKey(EAST);
const WEST_KEY = hexKey(WEST);

/** The homestead with its neighbours as `around` says (meadow where it doesn't). */
function viewWith(around: Partial<Record<'east' | 'west', Partial<PublicTile>>>): MapView {
  const tiles = [
    HOME,
    ...hexNeighbors(HOME).map((n) => {
      const key = hexKey(n);
      const change = key === EAST_KEY ? around.east : key === WEST_KEY ? around.west : undefined;
      return plain(n.q, n.r, change);
    }),
  ];
  return { ...base, tiles };
}

const canal = (): PublicBuilding => ({
  id: '0190a8c4-0000-7000-8000-0000000000c1',
  buildingId: 'canal',
  kind: 'canal',
  level: 1,
  spot: 1,
  lit: null,
  safeRadius: null,
});

const card = (cards: ReturnType<typeof worksBuildCards>, id: string) =>
  cards.find((c) => c.id === id);

describe('Wild Isle works Build cards (#621 W1-10)', () => {
  it('lists the six works, the canal, both shelters and the vane, never the travel kinds', () => {
    expect(WORKS_BUILDINGS.map((b) => b.id).sort()).toEqual(
      [
        'canal',
        'fishing-pier',
        'irrigated-field',
        'levee',
        'rain-barrel',
        'river-well',
        'salt-pans',
        'seawall',
        'watermill',
        'weather-vane',
      ].sort(),
    );
  });

  it('offers nothing on a Cozy Patch, on land not mine, or on a tile that is not an empty, joined homestead', () => {
    const view = viewWith({ east: { terrain: 'river' } });
    expect(worksBuildCards(HOME, { ...view, map: { ...view.map, patchType: 'cozy' } }, ME)).toEqual(
      [],
    );
    expect(worksBuildCards(HOME, view, userId(2))).toEqual([]);
    expect(worksBuildCards(HOME, view, null)).toEqual([]);
    expect(worksBuildCards({ ...HOME, homeSlot: 0 }, view, ME)).toEqual([]);
    expect(worksBuildCards({ ...HOME, homestead: 'paused' }, view, ME)).toEqual([]);
    expect(worksBuildCards({ ...HOME, buildings: [canal()] }, view, ME)).toEqual([]);
    expect(worksBuildCards(HOME, view, ME).length).toBeGreaterThan(0);
  });

  it('by a river: the pier, mill, well, field, levee and canal fit; the sea ones say why not', () => {
    const cards = worksBuildCards(HOME, viewWith({ east: { terrain: 'river' } }), ME);
    for (const id of ['fishing-pier', 'watermill', 'river-well', 'irrigated-field', 'levee']) {
      expect(card(cards, id)?.blocked, id).toBeNull();
    }
    expect(card(cards, 'canal')?.blocked).toBeNull();
    expect(card(cards, 'salt-pans')?.blocked).toBe(WORKS_TEXT.water.coast);
    expect(card(cards, 'seawall')?.blocked).toBe(WORKS_TEXT.water.coast);
    // The Rain Barrel and vane need no water.
    expect(card(cards, 'rain-barrel')?.blocked).toBeNull();
    expect(card(cards, 'weather-vane')?.blocked).toBeNull();
  });

  it('inland: each held back with its own line, and the ones that fit lead the row', () => {
    const cards = worksBuildCards(HOME, viewWith({}), ME);
    expect(card(cards, 'fishing-pier')?.blocked).toBe(WORKS_TEXT.water.water);
    expect(card(cards, 'watermill')?.blocked).toBe(WORKS_TEXT.water.river);
    expect(card(cards, 'levee')?.blocked).toBe(WORKS_TEXT.water.river);
    expect(card(cards, 'river-well')?.blocked).toBe(WORKS_TEXT.water['river-or-lake']);
    expect(card(cards, 'salt-pans')?.blocked).toBe(WORKS_TEXT.water.coast);
    expect(card(cards, 'canal')?.blocked).toBe(WORKS_TEXT.water.canal);
    const firstHeld = cards.findIndex((c) => c.blocked !== null);
    expect(cards.slice(0, firstHeld).map((c) => c.id)).toEqual(['rain-barrel', 'weather-vane']);
    expect(cards.slice(firstHeld).every((c) => c.blocked !== null)).toBe(true);
  });

  it('by the sea: the salt pans and seawall fit; the River Well takes a lake too', () => {
    const sea = worksBuildCards(HOME, viewWith({ west: { terrain: 'ocean' } }), ME);
    expect(card(sea, 'salt-pans')?.blocked).toBeNull();
    expect(card(sea, 'seawall')?.blocked).toBeNull();
    expect(card(sea, 'river-well')?.blocked).toBe(WORKS_TEXT.water['river-or-lake']);
    const lake = worksBuildCards(HOME, viewWith({ west: { terrain: 'wild-lake' } }), ME);
    expect(card(lake, 'river-well')?.blocked).toBeNull();
    expect(card(lake, 'watermill')?.blocked).toBe(WORKS_TEXT.water.river);
  });

  it('a field takes water from a canal that carries it; a lone canal far from water does not count', () => {
    const fed = viewWith({ east: { buildings: [canal()] } });
    // The canal next door touches no water itself: it carries none.
    expect(worksWaterProblem(byId('irrigated-field'), HOME, fed.tiles)).toBe(
      WORKS_TEXT.water.water,
    );
    // Put water beside that canal (a tile the homestead doesn't touch) and it carries.
    const east = fed.tiles.find((t) => hexKey(t) === EAST_KEY);
    if (!east) throw new Error('no east');
    const beyond = hexNeighbors(east).find((n) => !fed.tiles.some((t) => hexKey(t) === hexKey(n)));
    if (!beyond) throw new Error('no tile beyond');
    const tiles = [...fed.tiles, plain(beyond.q, beyond.r, { terrain: 'river' })];
    expect(worksWaterProblem(byId('irrigated-field'), HOME, tiles)).toBeNull();
    // The mill still wants the river itself next door.
    expect(worksWaterProblem(byId('watermill'), HOME, tiles)).toBe(WORKS_TEXT.water.river);
  });

  it('says what each makes: an hourly line, the barrel fills in rain, the mill and the rest read their own words', () => {
    expect(worksEffect(byId('fishing-pier'))).toMatch(/^🐟 \d+ Fish an hour, all by itself$/);
    expect(worksEffect(byId('rain-barrel'))).toBe('Fills up when it rains ☔');
    expect(worksEffect(byId('watermill'))).toBe(byId('watermill').description);
    // Revision 1: "Water Well 💧 · Draws Water from the river."
    const well = byId('river-well');
    expect(well.name).toBe('Water Well');
    expect(worksBuildCards(HOME, viewWith({ east: { terrain: 'river' } }), ME)).toContainEqual(
      expect.objectContaining({ id: 'river-well', name: 'Water Well', icon: '💧' }),
    );
    expect(worksEffect(well)).toMatch(/^💧 \d+ Water an hour, all by itself$/);
  });

  it('keeps every card line short and kind (style guide)', () => {
    const cards = [
      ...worksBuildCards(HOME, viewWith({}), ME),
      ...worksBuildCards(HOME, viewWith({ east: { terrain: 'river' } }), ME),
    ];
    const lines = [
      ...cards.flatMap((c) => [c.name, c.effect, c.blocked ?? '']),
      ...Object.values(WORKS_TEXT.water),
      WORKS_TEXT.rainBarrel,
      WORKS_TEXT.built('Fishing Pier'),
    ].filter((l) => l !== '');
    for (const line of lines) {
      expect(line.length, line).toBeLessThanOrEqual(80);
      expect(findAvoidedWords(line), line).toEqual([]);
    }
  });
});

function byId(id: string) {
  const b = WORKS_BUILDINGS.find((x) => x.id === id);
  if (!b) throw new Error(`no ${id}`);
  return b;
}
