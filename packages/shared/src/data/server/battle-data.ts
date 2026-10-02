import type { BattleData } from '../../battle/content.js';
import type { GameData } from '../../schemas/data/game-data.js';
import type { ServerGameData } from '../../schemas/data/server-game-data.js';

/**
 * The data the server battles with: public plus secret species and moves.
 * Server battles build their content from this
 * (`createBattleContent(serverBattleData(GAME_DATA, SERVER_GAME_DATA))`), so
 * a secret squishy can battle and the content hash covers every row that can
 * change an outcome. Anything client-facing uses public `GAME_DATA` only.
 */
export function serverBattleData(gameData: GameData, serverData: ServerGameData): BattleData {
  return {
    species: [...gameData.species, ...serverData.secretSpecies],
    moves: [...gameData.moves, ...serverData.secretMoves],
    elementMatrix: gameData.elementMatrix,
    feelingMatrix: gameData.feelingMatrix,
    synergy: gameData.synergy,
  };
}
