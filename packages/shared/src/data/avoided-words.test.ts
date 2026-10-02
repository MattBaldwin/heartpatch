import { describe, expect, it } from 'vitest';
import {
  FIXTURE_MOVES,
  FIXTURE_SPAWN_TABLES,
  FIXTURE_SPECIES,
} from '../../tests/fixtures/sample-content.js';
import { findAvoidedWords, scanPlayerFacingText } from './avoided-words.js';
import { GAME_DATA } from './index.js';
import { SERVER_GAME_DATA } from './server/index.js';

describe('style guide §9: avoided words in player-facing data', () => {
  it('finds none in the shipped data', () => {
    expect(scanPlayerFacingText(GAME_DATA, 'GAME_DATA')).toEqual([]);
    expect(scanPlayerFacingText(SERVER_GAME_DATA, 'SERVER_GAME_DATA')).toEqual([]);
  });

  it('finds none in the test fixtures', () => {
    const fixtures = { FIXTURE_MOVES, FIXTURE_SPECIES, FIXTURE_SPAWN_TABLES };
    expect(scanPlayerFacingText(fixtures, 'fixtures')).toEqual([]);
  });

  it('flags avoided words and their common forms, whatever the case', () => {
    expect(findAvoidedWords('Attack! It bites, then the Enemies died.')).toEqual([
      'attack',
      'bites',
      'enemies',
      'died',
    ]);
  });

  it('does not flag words that merely contain an avoided word', () => {
    expect(findAvoidedWords('A diet of soft studies and a hateful-free stabilizer')).toEqual([]);
    expect(findAvoidedWords('Tuckered out, then a cozy nap.')).toEqual([]);
  });

  it('names the row and field, and ignores non-text fields like baseStats.attack', () => {
    const data = {
      species: [
        { id: 'grumbleblob', name: 'Grumbleblob', description: 'Will bite your enemy.' },
        { id: 'okay', name: 'Okay', baseStats: { attack: 10 }, moves: ['attack'] },
      ],
      lines: ['Nobody gets hurt!'],
    };
    expect(scanPlayerFacingText(data, 'data')).toEqual([
      'data.species["grumbleblob"].description: "bite"',
      'data.species["grumbleblob"].description: "enemy"',
      'data.lines[0]: "hurt"',
    ]);
  });
});
