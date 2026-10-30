import { z } from 'zod';
import { formatDataIssues } from './issues.js';

/**
 * The Long Night's secrets (#727). Server-only (CLAUDE.md rule 6): kids see
 * the moon stages and "he's stronger tonight", never by how much. Exported
 * only from `@heartpatch/shared/server`; the public rules are
 * `LONG_NIGHT_RULES`.
 */
export const LongNightSecretsSchema = z.strictObject({
  /**
   * The patch's Hollow Man strength percent (`maps.hollow_strength_percent`)
   * is multiplied by this on a Long Night. Each strike chance still clamps
   * at 100 and the strike cap still holds (`rollStrikes`).
   */
  strengthMultiplier: z.number().int().min(1).max(5),
});
export type LongNightSecrets = z.infer<typeof LongNightSecretsSchema>;

/** Validates the Long Night's secrets and returns readable problems, or `[]`. */
export function checkLongNightSecrets(input: unknown): string[] {
  const result = LongNightSecretsSchema.safeParse(input);
  return result.success ? [] : formatDataIssues(input, result.error);
}
