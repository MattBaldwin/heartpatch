import { describe, expect, it } from 'vitest';
import { FIXTURE_SPAWN_TABLES, FIXTURE_SPECIES } from '../../../tests/fixtures/sample-content.js';
import { GAME_DATA } from '../../data/index.js';
import { SERVER_GAME_DATA } from '../../data/server/index.js';
import { checkServerGameData } from './server-game-data.js';

const gameData = { ...GAME_DATA, species: FIXTURE_SPECIES };

describe('checkServerGameData', () => {
  it('accepts the shipped server data', () => {
    expect(checkServerGameData(SERVER_GAME_DATA, GAME_DATA)).toEqual([]);
  });

  it('accepts the fixture spawn tables', () => {
    expect(checkServerGameData({ spawnTables: FIXTURE_SPAWN_TABLES }, gameData)).toEqual([]);
  });

  it('names the table and entry for unknown species and seasons', () => {
    const table = structuredClone(FIXTURE_SPAWN_TABLES[0]!);
    table.season = 'easter';
    table.entries[1]!.species = 'fixture-nope';
    expect(checkServerGameData({ spawnTables: [table] }, gameData)).toEqual([
      'spawnTables["fixture-forest-day"].season: unknown season "easter"',
      'spawnTables["fixture-forest-day"].entries[1].species: unknown species "fixture-nope"',
    ]);
  });

  it('rejects empty tables and non-positive weights', () => {
    const table = structuredClone(FIXTURE_SPAWN_TABLES[0]!);
    table.entries[0]!.weight = 0;
    const problems = checkServerGameData({ spawnTables: [table] }, gameData);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/^spawnTables\["fixture-forest-day"\]\.entries\[0\]\.weight: /);
  });

  it('names spawn table terrains that are not in the terrain table', () => {
    const table = structuredClone(FIXTURE_SPAWN_TABLES[0]!);
    table.terrains = ['forest', 'swamp'];
    expect(checkServerGameData({ spawnTables: [table] }, gameData)).toEqual([
      'spawnTables["fixture-forest-day"].terrains[1]: unknown terrain "swamp"',
    ]);
  });
});
