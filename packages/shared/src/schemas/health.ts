import { z } from 'zod';

/** A short commit id: the first 7 hex digits of the sha (#198). */
export const ShortCommitSchema = z.string().regex(/^[0-9a-f]{7}$/);

/**
 * Which build of the game this is (#198): the number of commits on `main` at
 * that commit (`git rev-list --count HEAD`), its short sha and the UTC date it
 * was built. Never env names or hosts.
 */
export const BuildInfoSchema = z.object({
  number: z.number().int().positive(),
  commit: ShortCommitSchema,
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});
export type BuildInfo = z.infer<typeof BuildInfoSchema>;

/** `GET /api/v1/health`: liveness, the process is up (tech spec §14). */
export const HealthResponseSchema = z.object({
  status: z.literal('ok'),
  version: z.string(),
  /**
   * The server's build number and commit (#198); null when it wasn't built
   * from git. An older server leaves them out (a deploy or rollback can pair
   * a new client with it), which reads as null.
   */
  build: z.number().int().positive().nullable().default(null),
  commit: ShortCommitSchema.nullable().default(null),
  uptimeSeconds: z.number().nonnegative(),
});
export type HealthResponse = z.infer<typeof HealthResponseSchema>;

/** `GET /api/v1/ready`: readiness, every dependency check passed. */
export const ReadyResponseSchema = z.object({
  status: z.enum(['ready', 'not_ready']),
  checks: z.record(z.string(), z.enum(['ok', 'failed'])),
});
export type ReadyResponse = z.infer<typeof ReadyResponseSchema>;
