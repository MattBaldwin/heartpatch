import { z } from 'zod';

/** `GET /api/v1/health`: liveness, the process is up (tech spec §14). */
export const HealthResponseSchema = z.object({
  status: z.literal('ok'),
  version: z.string(),
  uptimeSeconds: z.number().nonnegative(),
});
export type HealthResponse = z.infer<typeof HealthResponseSchema>;

/** `GET /api/v1/ready`: readiness, every dependency check passed. */
export const ReadyResponseSchema = z.object({
  status: z.enum(['ready', 'not_ready']),
  checks: z.record(z.string(), z.enum(['ok', 'failed'])),
});
export type ReadyResponse = z.infer<typeof ReadyResponseSchema>;
