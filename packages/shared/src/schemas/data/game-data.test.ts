import { describe, expect, it } from 'vitest';
import { FIXTURE_MOVES, FIXTURE_SPECIES } from '../../../tests/fixtures/sample-content.js';
import { GAME_DATA } from '../../data/index.js';
import { checkGameData, type GameData } from './game-data.js';

/** Shipped data plus the test-only species and moves. */
const withFixtures = (): GameData =>
  structuredClone({ ...GAME_DATA, species: FIXTURE_SPECIES, moves: FIXTURE_MOVES });

/** Applies `edit` to a copy of the fixture data and returns the problems. */
function problemsAfter(edit: (data: GameData) => void): string[] {
  const data = withFixtures();
  edit(data);
  return checkGameData(data);
}

describe('checkGameData', () => {
  it('accepts the shipped data', () => {
    expect(checkGameData(GAME_DATA)).toEqual([]);
  });

  it('accepts the test fixtures alongside the shipped data', () => {
    expect(checkGameData(withFixtures())).toEqual([]);
  });

  it('names the species id and field for a bad stat', () => {
    const problems = problemsAfter((d) => {
      d.species[0]!.baseStats.hp = 0;
    });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/^species\["fixture-puddlepuff"\]\.baseStats\.hp: /);
  });

  it('reports unknown and duplicate moves on a species', () => {
    const problems = problemsAfter((d) => {
      d.species[0]!.moves = ['fixture-giggle-drizzle', 'fixture-giggle-drizzle', 'zap-zap'];
    });
    expect(problems).toEqual([
      'species["fixture-puddlepuff"].moves[1]: move "fixture-giggle-drizzle" is listed twice',
      'species["fixture-puddlepuff"].moves[2]: unknown move "zap-zap"',
    ]);
  });

  it('reports evolutions into unknown species or into itself', () => {
    const problems = problemsAfter((d) => {
      d.species[0]!.evolutions = [
        { into: 'fixture-nope', level: 10 },
        { into: 'fixture-puddlepuff', level: 20 },
      ];
    });
    expect(problems).toEqual([
      'species["fixture-puddlepuff"].evolutions[0].into: unknown species "fixture-nope"',
      'species["fixture-puddlepuff"].evolutions[1].into: a species cannot evolve into itself',
    ]);
  });

  it('reports evolution chains that loop', () => {
    const problems = problemsAfter((d) => {
      d.species[1]!.evolutions = [{ into: 'fixture-puddlepuff', level: 30 }];
    });
    expect(problems).toEqual([
      'species["fixture-puddlepuff"].evolutions: evolution chain loops back to this species',
      'species["fixture-splashmallow"].evolutions: evolution chain loops back to this species',
    ]);
  });

  it('rejects a recipe with no inputs', () => {
    const problems = problemsAfter((d) => {
      d.recipes[0]!.inputs = {};
    });
    expect(problems).toEqual(['recipes["heart-charm"].inputs: a recipe needs at least one input']);
  });

  it('reports duplicate ids', () => {
    const problems = problemsAfter((d) => {
      d.moves.push({ ...d.moves[0]! });
    });
    expect(problems).toEqual([
      'moves["fixture-giggle-drizzle"].id: duplicate id "fixture-giggle-drizzle"',
    ]);
  });

  it('reports a missing matrix pair', () => {
    const problems = problemsAfter((d) => {
      const row: Partial<Record<string, number>> = d.elementMatrix.fire;
      delete row['water'];
    });
    expect(problems).toEqual([
      'elementMatrix.fire.water: missing element multiplier (every pair needs one)',
    ]);
  });

  it('reports out-of-range multipliers in every table', () => {
    const problems = problemsAfter((d) => {
      d.elementMatrix.fire.leaf = 3;
      d.feelingMatrix.silly.brave = 2;
      d.synergy.shadow.spooky = 0.5;
    });
    expect(problems).toEqual([
      'elementMatrix.fire.leaf: element multiplier must be between 0.5 and 2',
      'feelingMatrix.silly.brave: feeling multiplier must be between 0.75 and 1.5',
      'synergy.shadow.spooky: synergy multiplier must be between 0.85 and 1.2',
    ]);
  });

  it('reports unknown keys in a matrix', () => {
    const problems = problemsAfter((d) => {
      Object.assign(d.elementMatrix.fire, { plasma: 1 });
    });
    expect(problems).toEqual(['elementMatrix.fire: Unrecognized key: "plasma"']);
  });

  it('reports a missing element or feeling definition', () => {
    const problems = problemsAfter((d) => {
      d.elements = d.elements.filter((e) => e.id !== 'light');
      d.feelings = d.feelings.filter((f) => f.id !== 'spooky');
    });
    expect(problems).toEqual([
      'elements: missing element "light"',
      'feelings: missing feeling "spooky"',
    ]);
  });

  it('reports unknown resources in costs, recipes and fuel', () => {
    const problems = problemsAfter((d) => {
      d.buildings[0]!.levels[0]!.cost = { unobtainium: 1 };
      d.recipes[0]!.output.resource = 'mystery-goo';
      d.careActions[0]!.cost = { cake: 1 };
      const fire = d.buildings[0]!;
      if (fire.kind === 'hearthfire') fire.fuelResource = 'coal';
    });
    expect(problems).toEqual([
      'recipes["heart-charm"].output.resource: unknown resource "mystery-goo"',
      'buildings["hearthfire"].levels[0].cost.unobtainium: unknown resource "unobtainium"',
      'buildings["hearthfire"].fuelResource: unknown resource "coal"',
      'careActions["feed"].cost.cake: unknown resource "cake"',
    ]);
  });

  it('reports unknown seasons and seasonal resources without a season', () => {
    const problems = problemsAfter((d) => {
      d.species[2]!.season = 'easter';
      const pumpkins = d.resources.find((r) => r.id === 'pumpkins')!;
      delete pumpkins.season;
    });
    expect(problems).toEqual([
      'species["fixture-pebblesnooze"].season: unknown season "easter"',
      'resources["pumpkins"].season: seasonal resources need a season; others must not have one',
    ]);
  });

  it('reports bad season windows and override years', () => {
    const problems = problemsAfter((d) => {
      d.seasons[0]!.window.end = '02-30';
      d.seasons[1]!.overrides = { '26': { start: '11-01', end: '11-30' } };
    });
    expect(problems).toEqual([
      'seasons["halloween"].window.end: Not a real month-day',
      'seasons["thanksgiving"].overrides.26: invalid key (Override keys are four-digit years)',
    ]);
  });

  it('reports bad ids and unknown fields', () => {
    const problems = problemsAfter((d) => {
      d.resources.find((r) => r.id === 'heartdust')!.id = 'Heart Dust';
      Object.assign(d.species[1]!, { spawnRules: [] });
    });
    expect(problems).toEqual([
      'species["fixture-splashmallow"]: Unrecognized key: "spawnRules"',
      'resources["Heart Dust"].id: Expected a lowercase kebab-case id like "ember-den"',
    ]);
  });

  it('rejects a habitat with no tags and a building with no levels', () => {
    const problems = problemsAfter((d) => {
      const den = d.buildings.find((b) => b.id === 'ember-den')!;
      if (den.kind === 'habitat') den.tags = { elements: [], feelings: [] };
      d.buildings.find((b) => b.id === 'training-grounds')!.levels = [];
    });
    expect(problems).toHaveLength(2);
    expect(problems[0]).toBe('buildings["ember-den"].tags: a habitat needs at least one tag');
    expect(problems[1]).toMatch(/^buildings\["training-grounds"\]\.levels: /);
  });
});
