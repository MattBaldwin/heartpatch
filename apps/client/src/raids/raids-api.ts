import {
  RaidReplayResponseSchema,
  RaidReportResponseSchema,
  type DefenseStance,
  type RaidReplay,
  type RaidReport,
} from '@heartpatch/shared';
import { apiCallFor } from '../net/api.js';

/** The raid report's calls (server: modules/raids/routes.ts). */
export const raidsApi = {
  /** My defense style and the latest challenges on my land. */
  report: (mapId: string): Promise<RaidReport> =>
    apiCallFor(`/maps/${mapId}/raids`, { method: 'GET', schema: RaidReportResponseSchema }).then(
      (res) => res.report,
    ),

  /** I've read these in the report. */
  markSeen: (mapId: string, raidIds: readonly string[], key: string): Promise<RaidReport> =>
    apiCallFor(`/maps/${mapId}/raids/seen`, {
      method: 'POST',
      body: { raidIds },
      schema: RaidReportResponseSchema,
      headers: { 'idempotency-key': key },
    }).then((res) => res.report),

  /** How my squishies on watch play from now on. */
  setStyle: (mapId: string, stance: DefenseStance, key: string): Promise<RaidReport> =>
    apiCallFor(`/maps/${mapId}/defense-style`, {
      method: 'POST',
      body: { stance },
      schema: RaidReportResponseSchema,
      headers: { 'idempotency-key': key },
    }).then((res) => res.report),

  /** One of my raids, from my side, for the battle screen to play. */
  replay: (mapId: string, raidId: string): Promise<RaidReplay> =>
    apiCallFor(`/maps/${mapId}/raids/${raidId}/replay`, {
      method: 'GET',
      schema: RaidReplayResponseSchema,
    }).then((res) => res.replay),
};

export type RaidsApi = typeof raidsApi;
