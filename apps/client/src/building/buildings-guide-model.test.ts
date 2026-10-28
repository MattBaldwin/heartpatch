import {
  BUILDINGS,
  EXPLORE_RULES,
  HOME_BASE_RULES,
  JOB_RULES,
  RESOURCE_BUILDING_RULES,
  buildingGuide,
  type BuildingGuideEntry,
  type PublicTile,
} from '@heartpatch/shared';
import { describe, expect, it } from 'vitest';
import type { BuildCard } from './build-model.js';
import {
  GUIDE_TEXT,
  costParts,
  fitCounts,
  fitHere,
  gateLabel,
  guideAction,
  needsLine,
  placeChips,
  tileLine,
  valueLines,
} from './buildings-guide-model.js';

const ECONOMY = {
  jobs: JOB_RULES,
  explore: EXPLORE_RULES,
  resourceBuildings: RESOURCE_BUILDING_RULES,
};
const entry = (
  id: string,
  seasons: readonly string[] = ['halloween'],
  patchType: 'cozy' | 'wild-isle' = 'wild-isle',
): BuildingGuideEntry => {
  const b = BUILDINGS.find((x) => x.id === id);
  const g = b && buildingGuide(b, { patchType, seasons, rules: HOME_BASE_RULES, economy: ECONOMY });
  if (!g) throw new Error(id);
  return g;
};
const card = (id: string, over: Partial<BuildCard> = {}): BuildCard => ({
  id,
  icon: 'hammer',
  name: id,
  effect: '',
  cost: { timber: 5 },
  area: 'spot',
  blocked: null,
  craft: null,
  ...over,
});

describe('buildings guide words (#715)', () => {
  it('words every building of every kind with at least one why line and one where chip', () => {
    for (const patchType of ['cozy', 'wild-isle'] as const) {
      for (const b of BUILDINGS) {
        const g = buildingGuide(b, {
          patchType,
          seasons: [],
          rules: HOME_BASE_RULES,
          economy: ECONOMY,
        });
        if (!g) continue;
        expect(valueLines(g.value).length, b.id).toBeGreaterThan(0);
        expect(placeChips(g.place).length, b.id).toBeGreaterThan(0);
        for (const line of [...valueLines(g.value), ...placeChips(g.place)]) {
          expect(line, b.id).not.toMatch(/undefined|NaN|\bHP\b|damage/);
        }
      }
    }
  });

  it('hearthfire: safe tiles, your land, one a tile', () => {
    const g = entry('hearthfire');
    expect(valueLines(g.value)).toContain('Keeps squishies safe 1 tile around it');
    expect(placeChips(g.place)).toEqual(expect.arrayContaining(['Your land', '1 per tile']));
  });

  it('habitat and training read as rooms and XP', () => {
    expect(valueLines(entry('ember-den').value)).toContain('Room for 3 squishies');
    expect(placeChips(entry('ember-den').place)).toEqual(['At your home', 'Up to 4']);
    expect(valueLines(entry('training-grounds').value)).toEqual(
      expect.arrayContaining([expect.stringMatching(/XP an hour, even while you nap$/)]),
    );
  });

  it('fences say energy, never HP (style guide §9)', () => {
    const g = entry('hedge');
    expect(valueLines(g.value)).toContain('Keeps other Keepers off this edge');
    expect(valueLines(g.value).some((l) => l.endsWith('energy'))).toBe(true);
    expect(placeChips(g.place)).toEqual(
      expect.arrayContaining(['Edges of your tiles', 'Priced per edge']),
    );
  });

  it('a factory caps the whole patch', () => {
    expect(placeChips(entry('crafting-factory').place)).toContain('1 per patch');
  });

  it('resource and works: what they make, hold and cost a morning, with shortNumber', () => {
    const lines = valueLines(entry('greenhouse').value);
    expect(lines[0]).toMatch(/^Makes \d+ Greens an hour, all by itself$/);
    expect(lines.some((l) => /^Holds [\d.]+k? Greens$/.test(l))).toBe(true);
    expect(lines).toContain('Storms never knock it over');
    expect(placeChips(entry('greenhouse').place)).toContain('Meadow land');
    const mill = valueLines(entry('watermill').value);
    expect(mill.some((l) => l.startsWith('Eats '))).toBe(true);
    expect(mill.some((l) => l.startsWith('Upkeep: '))).toBe(true);
    expect(placeChips(entry('watermill').place)).toEqual(
      expect.arrayContaining(['River next door', 'Wild Isle only']),
    );
  });

  it('warehouse, canal, shelter, vane and travel all say what they do', () => {
    expect(valueLines(entry('warehouse').value)[0]).toMatch(/straight to your bag$/);
    expect(valueLines(entry('canal').value)[0]).toMatch(/^Carries water up to \d+ tiles inland$/);
    expect(valueLines(entry('levee').value)[0]).toMatch(/^Keeps .* off 1 tile around$/);
    expect(valueLines(entry('weather-vane').value)).toContain("Shows tomorrow's weather");
    expect(valueLines(entry('bridge').value)).toContain('Every Keeper on the patch can cross here');
    expect(placeChips(entry('bridge').place).slice(0, 2)).toEqual([
      'On a river tile',
      'Next to your land',
    ]);
    expect(valueLines(entry('waystation').value)[0]).toBe(
      'Keeps land up to 3 tiles away joined to home',
    );
  });

  it('labels the Coming later shelf: season, or not in the game yet', () => {
    expect(gateLabel(entry('pumpkin-barn', [], 'cozy'))).toBe('Back next Halloween');
    expect(gateLabel(entry('pumpkin-barn', ['halloween'], 'cozy'))).toBeNull();
    expect(gateLabel(entry('waystation'))).toBe('Coming soon!');
  });

  it('fits only when the Build sheet offers the card unblocked', () => {
    const mill = entry('watermill');
    expect(fitHere(mill, [card('watermill')])).toMatchObject({ kind: 'fits' });
    expect(fitHere(mill, [card('watermill', { blocked: 'Needs the river 🌊' })])).toEqual({
      kind: 'no',
      reason: 'Needs the river 🌊',
    });
    expect(fitHere(mill, [])).toEqual({ kind: 'no', reason: 'Needs river next door' });
    expect(fitHere(entry('waystation'), [card('waystation')])).toEqual({
      kind: 'later',
      label: 'Coming soon!',
    });
  });

  it('says what a missing building needs, from its data', () => {
    expect(needsLine(entry('greenhouse').place)).toBe('Needs Meadow land');
    expect(needsLine(entry('bridge').place)).toBe('Goes on a river tile');
    expect(needsLine(entry('ember-den').place)).toBe('Goes at your home');
    expect(needsLine(entry('training-grounds').place)).toBe('Goes on a homestead');
  });

  it('the button: build, need more, recipe book, off, or none', () => {
    const fits = { kind: 'fits', card: card('hearthfire') } as const;
    expect(guideAction(fits, { timber: 9 })).toBe('build');
    expect(guideAction(fits, null)).toBe('build');
    expect(guideAction(fits, { timber: 1 })).toBe('short');
    expect(guideAction({ kind: 'fits', card: card('j', { craft: 'Make it first' }) }, {})).toBe(
      'craft',
    );
    expect(guideAction({ kind: 'no', reason: 'x' }, {})).toBe('off');
    expect(guideAction({ kind: 'later', label: 'x' }, {})).toBe('none');
  });

  it('counts tiles each building fits, once a tile, blocked cards left out', () => {
    const tiles = [
      { q: 0, r: 0 },
      { q: 1, r: 0 },
      { q: 2, r: 0 },
    ] as unknown as PublicTile[];
    const counts = fitCounts(tiles, (t) =>
      t.q === 0
        ? [card('hedge'), card('hedge'), card('watermill')]
        : t.q === 1
          ? [card('hedge'), card('watermill', { blocked: 'no' })]
          : [],
    );
    expect(Object.fromEntries(counts)).toEqual({ hedge: 2, watermill: 1 });
  });

  it('the tile strip and the cost parts', () => {
    expect(tileLine({ terrain: 'meadow', homeSlot: null, homestead: 'joined' })).toBe(
      'Homestead · Meadow',
    );
    expect(tileLine({ terrain: 'meadow', homeSlot: 1 })).toBe('Your home · Meadow');
    expect(costParts({ timber: 1200, stone: 5 }, { timber: 10, stone: 9 })).toEqual([
      { id: 'timber', count: '1.2k', short: true },
      { id: 'stone', count: '5', short: false },
    ]);
    expect(costParts({ timber: 5 }, null)[0]?.short).toBe(false);
    expect(GUIDE_TEXT.fitCount(1)).toBe('Fits 1 of your tiles');
  });
});
