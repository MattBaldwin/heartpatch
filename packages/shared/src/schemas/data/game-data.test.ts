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
      'species["fixture-puddlepuff"].evolutions[0].into: unknown species "fixture-nope" (evolutions into secret forms go in SECRET_EVOLUTIONS)',
      'species["fixture-puddlepuff"].evolutions[1].into: a species cannot evolve into itself',
    ]);
  });

  it('keeps secret species out of the public table', () => {
    const problems = problemsAfter((d) => {
      d.species[0]!.rarity = 'secret';
    });
    expect(problems).toEqual([
      'species["fixture-puddlepuff"].rarity: secret species are server-only: add them to SECRET_SPECIES in packages/shared/src/data/server/secret-species.ts',
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

  it('reports unknown resources and terrains in terrain and map settings', () => {
    const problems = problemsAfter((d) => {
      d.terrains[1]!.nodeResources = ['acorns'];
      d.mapGen.gapTerrain = 'volcano';
      d.mapGen.homeTerrain = 'swamp';
      d.mapGen.homeRingNodes = ['timber', 'cake'];
    });
    expect(problems).toEqual([
      'terrains["forest"].nodeResources[0]: unknown resource "acorns"',
      'mapGen.gapTerrain: unknown terrain "volcano"',
      'mapGen.homeTerrain: unknown terrain "swamp"',
      'mapGen.homeRingNodes[1]: unknown resource "cake"',
    ]);
  });

  it("keeps Juniper's Gap terrain out of the scattered land", () => {
    const problems = problemsAfter((d) => {
      d.terrains.find((t) => t.id === 'junipers-gap')!.weight = 5;
    });
    expect(problems).toEqual(["mapGen.gapTerrain: Juniper's Gap terrain must have weight 0"]);
  });

  it('needs some scattered terrain and node resources when nodes can appear', () => {
    const problems = problemsAfter((d) => {
      for (const t of d.terrains) t.weight = 0;
      d.terrains[1]!.nodeResources = [];
    });
    expect(problems).toEqual([
      'terrains["forest"]: a terrain with a node chance needs at least one node resource',
      'terrains: at least one terrain needs a weight above 0',
    ]);
  });

  it('rejects map layouts that crowd the Gap, spill off the map or space homes unevenly', () => {
    const problems = problemsAfter((d) => {
      d.mapGen.layouts = [
        { players: 2, radius: 9, homeDistance: 3 },
        { players: 2, radius: 9, homeDistance: 9 },
        { players: 4, radius: 12, homeDistance: 7 },
      ];
    });
    expect(problems).toEqual([
      'mapGen.layouts[1]: home rings must fit inside the map (homeDistance + 1 <= radius)',
      'mapGen.layouts[2]: home bases need exactly even spacing: 6 × homeDistance must divide by players',
      "mapGen.layouts[0].homeDistance: home rings must sit at least 2 steps outside Juniper's Gap",
      'mapGen.layouts[1].players: duplicate layout for 2 players',
    ]);
  });

  it("rejects guardians that aren't toughest in the Gap", () => {
    const problems = problemsAfter((d) => {
      d.mapGen.guardianStrength.gap = d.mapGen.guardianStrength.max;
    });
    expect(problems).toEqual([
      "mapGen.guardianStrength: Juniper's Gap guardians must be the strongest",
    ]);
  });

  it('reports unknown bodies and parts on a species visual', () => {
    const problems = problemsAfter((d) => {
      d.species[0]!.visual.body = 'cube';
      d.species[0]!.visual.parts = ['dot-eyes', 'laser-eyes'];
    });
    expect(problems).toEqual([
      'species["fixture-puddlepuff"].visual.body: unknown body "cube"',
      'species["fixture-puddlepuff"].visual.parts[1]: unknown part "laser-eyes"',
    ]);
  });

  it('reports a part listed twice or two parts in one slot', () => {
    const problems = problemsAfter((d) => {
      d.species[0]!.visual.parts = ['dot-eyes', 'dot-eyes', 'oval-eyes'];
    });
    expect(problems).toEqual([
      'species["fixture-puddlepuff"].visual.parts[1]: part "dot-eyes" is listed twice',
      'species["fixture-puddlepuff"].visual.parts[2]: parts "dot-eyes" and "oval-eyes" both use the eyes slot',
    ]);
  });

  it('needs every squishy to have eyes', () => {
    const problems = problemsAfter((d) => {
      d.species[0]!.visual.parts = ['smile', 'round-ears'];
    });
    expect(problems).toEqual([
      'species["fixture-puddlepuff"].visual.parts: every squishy needs eyes (a part in the eyes slot)',
    ]);
  });

  it('reports duplicate and malformed bodies and parts', () => {
    const problems = problemsAfter((d) => {
      d.bodies.push({ ...d.bodies[0]! });
      d.parts[0]!.size = [0.1, 0.1, 0];
      d.parts[1]!.layout = { kind: 'scatter', count: 1, aroundRange: 10, upRange: 10 };
    });
    expect(problems).toEqual([
      'parts["dot-eyes"].size[2]: Too small: expected number to be >=0.005',
      'parts["oval-eyes"].layout.count: Too small: expected number to be >=2',
      'bodies["blob"].id: duplicate id "blob"',
    ]);
  });
});
