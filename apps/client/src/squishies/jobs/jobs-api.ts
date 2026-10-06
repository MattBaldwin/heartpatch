import { JobsViewSchema, type JobsView, type SetJobRequest } from '@heartpatch/shared';
import { apiCallFor } from '../../net/api.js';

/** Squishy job calls (server: modules/jobs). `key` makes a retry safe (tech spec §5). */
export const jobsApi = {
  /** My squishies' jobs, my team, and the spots a gatherer could work. */
  view: (mapId: string): Promise<JobsView> =>
    apiCallFor(`/maps/${mapId}/jobs`, { method: 'GET', schema: JobsViewSchema }),

  setJob: (mapId: string, squishyId: string, job: SetJobRequest, key: string): Promise<JobsView> =>
    apiCallFor(`/maps/${mapId}/squishies/${squishyId}/job`, {
      method: 'POST',
      body: job,
      schema: JobsViewSchema,
      headers: { 'idempotency-key': key },
    }),

  setTeam: (mapId: string, squishyIds: readonly string[], key: string): Promise<JobsView> =>
    apiCallFor(`/maps/${mapId}/team`, {
      method: 'POST',
      body: { squishyIds },
      schema: JobsViewSchema,
      headers: { 'idempotency-key': key },
    }),
};

export type JobsApi = typeof jobsApi;
