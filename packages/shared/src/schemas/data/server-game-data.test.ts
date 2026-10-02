import { describe, expect, it } from 'vitest';
import {
  FIXTURE_MOVES,
  FIXTURE_SPAWN_TABLES,
  FIXTURE_SPECIES,
} from '../../../tests/fixtures/sample-content.js';
import { GAME_DATA } from '../../data/index.js';
import { SERVER_GAME_DATA } from '../../data/server/index.js';
import { checkServerGameData, type ServerGameData } from './server-game-data.js';

/** Shipped public data plus the test-only species and moves the cases below edit. */
const gameData = {
  ...GAME_DATA,
  species: [...GAME_DATA.species, ...FIXTURE_SPECIES],
  moves: [...GAME_DATA.moves, ...FIXTURE_MOVES],
};

const noSecrets = { secretSpecies: [], secretMoves: [], secretEvolutions: [] };

/** Applies `edit` to a copy of the shipped server data and returns the problems. */
function problemsAfter(edit: (data: ServerGameData) => void): string[] {
  const data = structuredClone(SERVER_GAME_DATA);
  edit(data);
  return checkServerGameData(data, gameData);
}

const moonpuff = () => structuredClone(SERVER_GAME_DATA.secretSpecies[0]!);

describe('checkServerGameData', () => {
  it('accepts the shipped server data, which has secret rows to check', () => {
    expect(checkServerGameData(SERVER_GAME_DATA, GAME_DATA)).toEqual([]);
    expect(checkServerGameData(SERVER_GAME_DATA, gameData)).toEqual([]);
    expect(SERVER_GAME_DATA.secretSpecies.length).toBeGreaterThan(0);
    expect(SERVER_GAME_DATA.secretMoves.length).toBeGreaterThan(0);
    expect(SERVER_GAME_DATA.secretEvolutions.length).toBeGreaterThan(0);
  });

  it('accepts the fixture spawn tables', () => {
    expect(
      checkServerGameData({ ...noSecrets, spawnTables: FIXTURE_SPAWN_TABLES }, gameData),
    ).toEqual([]);
  });

  it('names the table and entry for unknown species and seasons', () => {
    const table = structuredClone(FIXTURE_SPAWN_TABLES[0]!);
    table.season = 'easter';
    table.entries[1]!.species = 'fixture-nope';
    expect(checkServerGameData({ ...noSecrets, spawnTables: [table] }, gameData)).toEqual([
      'spawnTables["fixture-forest-day"].season: unknown season "easter"',
      'spawnTables["fixture-forest-day"].entries[1].species: unknown species "fixture-nope"',
    ]);
  });

  it('rejects empty tables and non-positive weights', () => {
    const table = structuredClone(FIXTURE_SPAWN_TABLES[0]!);
    table.entries[0]!.weight = 0;
    const problems = checkServerGameData({ ...noSecrets, spawnTables: [table] }, gameData);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/^spawnTables\["fixture-forest-day"\]\.entries\[0\]\.weight: /);
  });

  it('names spawn table terrains that are not in the terrain table', () => {
    const table = structuredClone(FIXTURE_SPAWN_TABLES[0]!);
    table.terrains = ['forest', 'swamp'];
    expect(checkServerGameData({ ...noSecrets, spawnTables: [table] }, gameData)).toEqual([
      'spawnTables["fixture-forest-day"].terrains[1]: unknown terrain "swamp"',
    ]);
  });

  it('lets spawn tables use secret species', () => {
    const problems = problemsAfter((d) => {
      d.spawnTables = [structuredClone(FIXTURE_SPAWN_TABLES[0]!)];
      d.spawnTables[0]!.entries[0]!.species = 'placeholder-moonpuff';
    });
    expect(problems).toEqual([]);
  });

  it('requires secret ids to be unique across public and secret rows', () => {
    const problems = problemsAfter((d) => {
      d.secretSpecies.push({ ...moonpuff() });
      d.secretSpecies.push({ ...moonpuff(), id: 'fixture-puddlepuff' });
      d.secretMoves.push({ ...d.secretMoves[0]!, id: 'fixture-lullaby' });
    });
    expect(problems).toEqual([
      'secretSpecies["placeholder-moonpuff"].id: duplicate id "placeholder-moonpuff"',
      'secretSpecies["fixture-puddlepuff"].id: id "fixture-puddlepuff" is already a public species',
      'secretMoves["fixture-lullaby"].id: id "fixture-lullaby" is already a public move',
    ]);
  });

  it('checks secret species moves, seasons and visuals against public + secret data', () => {
    const problems = problemsAfter((d) => {
      const s = d.secretSpecies[0]!;
      s.moves = ['placeholder-hush-hum', 'fixture-lullaby', 'zap-zap', 'fixture-lullaby'];
      s.season = 'easter';
      s.visual.body = 'cube';
      s.visual.parts = ['tiny-smile'];
    });
    expect(problems).toEqual([
      'secretSpecies["placeholder-moonpuff"].visual.body: unknown body "cube"',
      'secretSpecies["placeholder-moonpuff"].visual.parts: every squishy needs eyes (a part in the eyes slot)',
      'secretSpecies["placeholder-moonpuff"].season: unknown season "easter"',
      'secretSpecies["placeholder-moonpuff"].moves[2]: unknown move "zap-zap"',
      'secretSpecies["placeholder-moonpuff"].moves[3]: move "fixture-lullaby" is listed twice',
    ]);
  });

  it('keeps evolutions into secret forms in secretEvolutions', () => {
    const problems = problemsAfter((d) => {
      d.secretSpecies[0]!.evolutions = [
        { into: 'fixture-splashmallow', level: 20 },
        { into: 'placeholder-moonmallow', level: 20 },
        { into: 'fixture-nope', level: 20 },
      ];
    });
    expect(problems).toEqual([
      'secretSpecies["placeholder-moonpuff"].evolutions[1].into: evolutions into secret forms go in secretEvolutions ("placeholder-moonmallow")',
      'secretSpecies["placeholder-moonpuff"].evolutions[2].into: unknown species "fixture-nope"',
    ]);
  });

  it('lets public species evolve into secret forms', () => {
    const problems = problemsAfter((d) => {
      d.secretEvolutions.push({
        from: 'fixture-puddlepuff',
        into: 'placeholder-moonpuff',
        level: 30,
      });
    });
    expect(problems).toEqual([]);
  });

  it('checks secret evolution sources and targets', () => {
    const problems = problemsAfter((d) => {
      d.secretEvolutions = [
        { from: 'fixture-nope', into: 'placeholder-moonmallow', level: 20 },
        { from: 'placeholder-moonpuff', into: 'fixture-splashmallow', level: 20 },
        { from: 'placeholder-moonpuff', into: 'secret-nope', level: 20 },
        { from: 'placeholder-moonpuff', into: 'placeholder-moonpuff', level: 20 },
        { from: 'placeholder-moonpuff', into: 'placeholder-moonmallow', level: 20 },
        { from: 'placeholder-moonpuff', into: 'placeholder-moonmallow', level: 25 },
      ];
    });
    expect(problems).toEqual([
      'secretEvolutions[0].from: unknown species "fixture-nope"',
      'secretEvolutions[1].into: "fixture-splashmallow" is a public species; put the evolution on the species instead',
      'secretEvolutions[2].into: unknown secret species "secret-nope"',
      'secretEvolutions[3].into: a species cannot evolve into itself',
      'secretEvolutions[5]: "placeholder-moonpuff" → "placeholder-moonmallow" is listed twice',
    ]);
  });

  it('reports evolution chains that loop through secret forms', () => {
    let back = -1;
    const problems = problemsAfter((d) => {
      back =
        d.secretEvolutions.push({
          from: 'placeholder-moonmallow',
          into: 'placeholder-moonpuff',
          level: 40,
        }) - 1;
    });
    expect(problems).toEqual([
      'secretEvolutions[0]: evolution chain loops back to this species',
      `secretEvolutions[${String(back)}]: evolution chain loops back to this species`,
    ]);
  });
});
