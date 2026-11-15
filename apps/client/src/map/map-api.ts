import {
  BattleResponseSchema,
  BossVisitResponseSchema,
  MapViewSchema,
  PatchStatsSchema,
  type BossVisit,
  type MapView,
  type PatchStats,
  type PlayerBattle,
} from '@heartpatch/shared';
import { apiCallFor } from '../net/api.js';

/** The map screen's calls (server: modules/maps/routes.ts). */
export const mapApi = {
  /** Everything needed to draw a map, and the event seq it's up to date with. */
  view: (mapId: string): Promise<MapView> =>
    apiCallFor(`/maps/${mapId}/view`, { method: 'GET', schema: MapViewSchema }),
  /** Who's winning what on the patch (#573). */
  stats: (mapId: string): Promise<PatchStats> =>
    apiCallFor(`/maps/${mapId}/stats`, { method: 'GET', schema: PatchStatsSchema }),
  /** This week's mini-boss as I see it, or null (#190: the species only once I've met it). */
  boss: (mapId: string): Promise<BossVisit | null> =>
    apiCallFor(`/maps/${mapId}/boss`, { method: 'GET', schema: BossVisitResponseSchema }).then(
      (res) => res.boss,
    ),
  /** Fights it: the intent alone, the server builds the battle (or hands back the one going). */
  fightBoss: (mapId: string): Promise<PlayerBattle> =>
    apiCallFor(`/maps/${mapId}/boss/battle`, { method: 'POST', schema: BattleResponseSchema }).then(
      (res) => res.battle,
    ),
};
