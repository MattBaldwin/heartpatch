import { describe, expect, it } from 'vitest';
import {
  FIXTURE_MOVES,
  FIXTURE_SECRET_EVOLUTIONS,
  FIXTURE_SECRET_MOVES,
  FIXTURE_SECRET_SPECIES,
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

/** Fixture server data: one secret line (Moonpuff → Moonmallow), no spawn tables. */
const fixtureServerData: ServerGameData = {
  ...SERVER_GAME_DATA,
  spawnTables: [],
  secretSpecies: FIXTURE_SECRET_SPECIES,
  secretMoves: FIXTURE_SECRET_MOVES,
  secretEvolutions: FIXTURE_SECRET_EVOLUTIONS,
};

/** Applies `edit` to a copy of the fixture server data and returns the problems. */
function problemsAfter(edit: (data: ServerGameData) => void): string[] {
  const data = structuredClone(fixtureServerData);
  edit(data);
  return checkServerGameData(data, gameData);
}

const moonpuff = () => structuredClone(FIXTURE_SECRET_SPECIES[0]!);

describe('checkServerGameData', () => {
  it('accepts the shipped server data, which has secret rows to check', () => {
    expect(checkServerGameData(SERVER_GAME_DATA, GAME_DATA)).toEqual([]);
    expect(checkServerGameData(SERVER_GAME_DATA, gameData)).toEqual([]);
    expect(SERVER_GAME_DATA.secretSpecies.length).toBeGreaterThan(0);
    expect(SERVER_GAME_DATA.secretMoves.length).toBeGreaterThan(0);
    expect(SERVER_GAME_DATA.secretEvolutions.length).toBeGreaterThan(0);
    expect(checkServerGameData(fixtureServerData, gameData)).toEqual([]);
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
      d.spawnTables[0]!.entries[0]!.species = 'fixture-moonpuff';
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
      'secretSpecies["fixture-moonpuff"].id: duplicate id "fixture-moonpuff"',
      'secretSpecies["fixture-puddlepuff"].id: id "fixture-puddlepuff" is already a public species',
      'secretMoves["fixture-lullaby"].id: id "fixture-lullaby" is already a public move',
    ]);
  });

  it('holds secret species to the art rules, evolutions included', () => {
    const problems = problemsAfter((d) => {
      d.secretSpecies[0]!.visual.finish = 'vinyl';
      d.secretSpecies[1]!.visual.size = 1;
    });
    expect(problems).toEqual([
      'secretSpecies["fixture-moonpuff"].visual.finish: secret squishies use the "iridescent" finish, not "vinyl"',
      'secretSpecies["fixture-moonmallow"].visual.size: an evolution is ×1.2–1.4 the size of fixture-moonpuff, not ×1.00',
    ]);
  });

  it('checks secret species moves, seasons and visuals against public + secret data', () => {
    const problems = problemsAfter((d) => {
      const s = d.secretSpecies[0]!;
      s.moves = ['fixture-hush-hum', 'fixture-lullaby', 'zap-zap', 'fixture-lullaby'];
      s.season = 'easter';
      s.visual.body = 'cube';
      s.visual.parts = ['tiny-smile'];
    });
    expect(problems).toEqual([
      'secretSpecies["fixture-moonpuff"].visual.body: unknown body "cube"',
      'secretSpecies["fixture-moonpuff"].visual.parts: every squishy needs eyes (a part in the eyes slot)',
      'secretSpecies["fixture-moonpuff"].season: unknown season "easter"',
      'secretSpecies["fixture-moonpuff"].moves[2]: unknown move "zap-zap"',
      'secretSpecies["fixture-moonpuff"].moves[3]: move "fixture-lullaby" is listed twice',
    ]);
  });

  it('keeps evolutions into secret forms in secretEvolutions', () => {
    const problems = problemsAfter((d) => {
      d.secretSpecies[0]!.evolutions = [
        { into: 'fixture-splashmallow', level: 20 },
        { into: 'fixture-moonmallow', level: 20 },
        { into: 'fixture-nope', level: 20 },
      ];
    });
    expect(problems).toEqual([
      'secretSpecies["fixture-moonpuff"].evolutions[1].into: evolutions into secret forms go in secretEvolutions ("fixture-moonmallow")',
      'secretSpecies["fixture-moonpuff"].evolutions[2].into: unknown species "fixture-nope"',
    ]);
  });

  it('lets public species evolve into secret forms', () => {
    const problems = problemsAfter((d) => {
      d.secretEvolutions.push({
        from: 'fixture-puddlepuff',
        into: 'fixture-moonpuff',
        level: 30,
      });
    });
    expect(problems).toEqual([]);
  });

  it('checks secret evolution sources and targets', () => {
    const problems = problemsAfter((d) => {
      d.secretEvolutions = [
        { from: 'fixture-nope', into: 'fixture-moonmallow', level: 20 },
        { from: 'fixture-moonpuff', into: 'fixture-splashmallow', level: 20 },
        { from: 'fixture-moonpuff', into: 'secret-nope', level: 20 },
        { from: 'fixture-moonpuff', into: 'fixture-moonpuff', level: 20 },
        { from: 'fixture-moonpuff', into: 'fixture-moonmallow', level: 20 },
        { from: 'fixture-moonpuff', into: 'fixture-moonmallow', level: 25 },
      ];
    });
    expect(problems).toEqual([
      'secretEvolutions[0].from: unknown species "fixture-nope"',
      'secretEvolutions[1].into: "fixture-splashmallow" is a public species; put the evolution on the species instead',
      'secretEvolutions[2].into: unknown secret species "secret-nope"',
      'secretEvolutions[3].into: a species cannot evolve into itself',
      'secretEvolutions[5]: "fixture-moonpuff" → "fixture-moonmallow" is listed twice',
    ]);
  });

  it('reports evolution chains that loop through secret forms', () => {
    let back = -1;
    const problems = problemsAfter((d) => {
      back =
        d.secretEvolutions.push({
          from: 'fixture-moonmallow',
          into: 'fixture-moonpuff',
          level: 40,
        }) - 1;
    });
    expect(problems).toEqual([
      'secretEvolutions[0]: evolution chain loops back to this species',
      `secretEvolutions[${String(back)}]: evolution chain loops back to this species`,
    ]);
  });
});
