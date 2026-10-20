import { BATTLE_RULES, GAME_DATA, speciesMoveKinds } from '@heartpatch/shared';
import { SERVER_GAME_DATA, serverBattleData } from '@heartpatch/shared/server';

const MOVES = new Map(serverBattleData(GAME_DATA, SERVER_GAME_DATA).moves.map((m) => [m.id, m]));

/**
 * A move that can tucker out a wild squishy or a neutral guardian: a big one
 * (#587), since a player's steady moves are gentle with them. Falls back to
 * the first move for a squishy with no attacks.
 */
export function bigMove(squishy: { speciesId: string; moves: readonly string[] }): string {
  const kinds = BATTLE_RULES.moveKinds
    ? speciesMoveKinds(
        { id: squishy.speciesId, moves: squishy.moves },
        MOVES,
        BATTLE_RULES.moveKinds,
      )
    : new Map();
  return squishy.moves.find((id) => kinds.get(id) === 'big') ?? squishy.moves[0]!;
}
