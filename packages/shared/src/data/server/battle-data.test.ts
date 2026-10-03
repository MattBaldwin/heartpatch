import { describe, expect, it } from 'vitest';
import { battleSetup, squishy } from '../../../tests/fixtures/battle.js';
import {
  FIXTURE_MOVES,
  FIXTURE_SECRET_EVOLUTIONS,
  FIXTURE_SECRET_MOVES,
  FIXTURE_SECRET_SPECIES,
  FIXTURE_SPECIES,
} from '../../../tests/fixtures/sample-content.js';
import { createBattleContent } from '../../battle/content.js';
import { startBattle } from '../../battle/engine.js';
import { GAME_DATA } from '../index.js';
import { serverBattleData } from './battle-data.js';
import { SERVER_GAME_DATA } from './index.js';

const gameData = { ...GAME_DATA, species: FIXTURE_SPECIES, moves: FIXTURE_MOVES };

describe('serverBattleData', () => {
  it('adds the secret species and moves to the public ones', () => {
    const data = serverBattleData(gameData, SERVER_GAME_DATA);
    expect(data.species.map((s) => s.id)).toEqual([
      ...FIXTURE_SPECIES.map((s) => s.id),
      ...SERVER_GAME_DATA.secretSpecies.map((s) => s.id),
    ]);
    expect(data.moves.map((m) => m.id)).toEqual([
      ...FIXTURE_MOVES.map((m) => m.id),
      ...SERVER_GAME_DATA.secretMoves.map((m) => m.id),
    ]);
    expect(data.elementMatrix).toBe(GAME_DATA.elementMatrix);
  });

  it('lets a public squishy battle a secret one', () => {
    const secrets = {
      ...SERVER_GAME_DATA,
      secretSpecies: FIXTURE_SECRET_SPECIES,
      secretMoves: FIXTURE_SECRET_MOVES,
      secretEvolutions: FIXTURE_SECRET_EVOLUTIONS,
    };
    const secret = FIXTURE_SECRET_SPECIES[0]!.id;
    const content = createBattleContent(serverBattleData(gameData, secrets));
    const state = startBattle(
      content,
      battleSetup(
        'secret',
        { squishies: [squishy('fixture-puddlepuff')] },
        { squishies: [squishy(secret)] },
      ),
    );
    expect(state.sides.b.squishies[0]!.speciesId).toBe(secret);
  });

  it('hashes the secret rows the server battles with', () => {
    const publicOnly = createBattleContent(gameData).contentHash;
    const merged = createBattleContent(serverBattleData(gameData, SERVER_GAME_DATA)).contentHash;
    expect(merged).not.toBe(publicOnly);

    const retuned = structuredClone(SERVER_GAME_DATA);
    retuned.secretSpecies[0]!.baseStats.speed += 1;
    expect(createBattleContent(serverBattleData(gameData, retuned)).contentHash).not.toBe(merged);

    const repowered = structuredClone(SERVER_GAME_DATA);
    repowered.secretMoves[0]!.power += 5;
    expect(createBattleContent(serverBattleData(gameData, repowered)).contentHash).not.toBe(merged);
  });
});
