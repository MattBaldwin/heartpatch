import {
  BattleResponseSchema,
  CurrentBattleResponseSchema,
  SquishyResponseSchema,
  type DevGrantSquishyRequest,
  type DevStartBattleRequest,
  type OwnedSquishy,
  type PlayerBattle,
  type PlayerBattleAction,
} from '@heartpatch/shared';
import { apiCallFor } from '../net/api.js';

const battleOf = (res: { battle: PlayerBattle }) => res.battle;

/** The battle screen's calls (server: modules/battles/routes.ts). */
export const battleApi = {
  /** The battle to resume on this map, or null. */
  current: (mapId: string): Promise<PlayerBattle | null> =>
    apiCallFor(`/maps/${mapId}/battles/current`, {
      method: 'GET',
      schema: CurrentBattleResponseSchema,
    }).then((res) => res.battle),

  /** Picks a fight with whatever wild squishy is around (or resumes the one going). */
  startWild: (mapId: string): Promise<PlayerBattle> =>
    apiCallFor(`/maps/${mapId}/battles`, { method: 'POST', schema: BattleResponseSchema }).then(
      battleOf,
    ),

  get: (battleId: string): Promise<PlayerBattle> =>
    apiCallFor(`/battles/${battleId}`, { method: 'GET', schema: BattleResponseSchema }).then(
      battleOf,
    ),

  /**
   * One action for the player's side. `turn` is the view the player acted on;
   * `key` makes a retry on a flaky connection safe (tech spec §5).
   */
  act: (
    battleId: string,
    action: PlayerBattleAction,
    turn: number,
    key: string,
  ): Promise<PlayerBattle> =>
    apiCallFor(`/battles/${battleId}/actions`, {
      method: 'POST',
      body: { action, turn },
      schema: BattleResponseSchema,
      headers: { 'idempotency-key': key },
    }).then(battleOf),

  // Dev builds only (server `HP_DEV_SQUISHY_GRANTS`): until spawns (#14) and the
  // tutorial's starter arrive, these hand a player a squishy and pick a fight.
  dev: {
    grantSquishy: (mapId: string, body: DevGrantSquishyRequest = {}): Promise<OwnedSquishy> =>
      apiCallFor(`/maps/${mapId}/dev/squishies`, {
        method: 'POST',
        body,
        schema: SquishyResponseSchema,
      }).then((res) => res.squishy),
    pickFight: (mapId: string, body: DevStartBattleRequest = {}): Promise<PlayerBattle> =>
      apiCallFor(`/maps/${mapId}/dev/battles`, {
        method: 'POST',
        body,
        schema: BattleResponseSchema,
      }).then(battleOf),
  },
};
