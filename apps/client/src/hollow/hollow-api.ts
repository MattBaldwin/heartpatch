import {
  BattleResponseSchema,
  DevNightfallResponseSchema,
  HollowResponseSchema,
  type DevNightfallResponse,
  type HollowStatus,
  type PlayerBattle,
} from '@heartpatch/shared';
import { apiCallFor } from '../net/api.js';

/** The Hollow Man's calls (server: modules/hollow/routes.ts). */
export const hollowApi = {
  /** The night, my morning reports, my squishies in the Hollow, and the server's clock. */
  status: (mapId: string): Promise<HollowStatus> =>
    apiCallFor(`/maps/${mapId}/hollow`, { method: 'GET', schema: HollowResponseSchema }).then(
      (res) => res.hollow,
    ),

  /** Sets off to rescue a squishy: starts its battle (or resumes the one going). */
  rescue: (mapId: string, squishyId: string, key: string): Promise<PlayerBattle> =>
    apiCallFor(`/maps/${mapId}/rescues`, {
      method: 'POST',
      body: { squishyId },
      schema: BattleResponseSchema,
      headers: { 'idempotency-key': key },
    }).then((res) => res.battle),

  /**
   * My one look in Juniper's Gap (#727): starts its wild battle, or resumes
   * the battle going (which may be another kind).
   */
  gapEncounter: (mapId: string, key: string): Promise<PlayerBattle> =>
    apiCallFor(`/maps/${mapId}/long-night/gap-encounter`, {
      method: 'POST',
      schema: BattleResponseSchema,
      headers: { 'idempotency-key': key },
    }).then((res) => res.battle),

  /** Dev/test only: the next night falls now. */
  devNightfall: (mapId: string): Promise<DevNightfallResponse> =>
    apiCallFor(`/maps/${mapId}/dev/nightfall`, {
      method: 'POST',
      schema: DevNightfallResponseSchema,
    }),
};

export type HollowApi = typeof hollowApi;
