import {
  BattleResponseSchema,
  CurrentBattleResponseSchema,
  SquishyResponseSchema,
  WildHintsResponseSchema,
  type DevGrantSquishyRequest,
  type DevStartBattleRequest,
  type Hex,
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

  /** Tiles in reach with a wild squishy right now, nearest first (no species: a hint). */
  wildHints: (mapId: string): Promise<readonly Hex[]> =>
    apiCallFor(`/maps/${mapId}/wild`, { method: 'GET', schema: WildHintsResponseSchema }).then(
      (res) => res.wild.tiles,
    ),

  /**
   * Meets a wild squishy (or resumes the battle going): the one on `tile`
   * (#209, picked on the map), else the nearest. The server checks reach.
   */
  startWild: (mapId: string, tile?: Hex): Promise<PlayerBattle> =>
    apiCallFor(`/maps/${mapId}/battles`, {
      method: 'POST',
      ...(tile ? { body: { tile: { q: tile.q, r: tile.r } } } : {}),
      schema: BattleResponseSchema,
    }).then(battleOf),

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
