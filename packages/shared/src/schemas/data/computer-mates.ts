import { z } from 'zod';
import { formatDataIssues } from './issues.js';
import { DefenseStanceSchema } from './raids.js';

/**
 * Computer patch-mates (#386). The public half: who each persona is (name,
 * look hint, blurb), which every client may see. The tuning (how often they
 * claim, trade or challenge) is server-only: `ComputerMateRulesSchema` and
 * `ComputerPersonaTuningSchema`, exported only from `@heartpatch/shared/server`.
 */
export const ComputerPersonaIdSchema = z.enum([
  'bramble',
  'marigold',
  'pocket',
  'thistle',
  'wren',
  'fennel',
]);
export type ComputerPersonaId = z.infer<typeof ComputerPersonaIdSchema>;

export const ComputerPersonaSchema = z.strictObject({
  id: ComputerPersonaIdSchema,
  /** Their name on the patch, always shown with the Computer friend badge. */
  name: z.string().min(1).max(20),
  /** One kid-readable line for their card. */
  blurb: z.string().min(1).max(120),
});
export type ComputerPersona = z.infer<typeof ComputerPersonaSchema>;

export const ComputerPersonasSchema = z
  .array(ComputerPersonaSchema)
  .min(1)
  .refine((all) => new Set(all.map((p) => p.id)).size === all.length, 'persona ids repeat')
  .refine(
    (all) => new Set(all.map((p) => p.name.toLowerCase())).size === all.length,
    'persona names repeat',
  );

/** Validates the personas and returns readable problems, or `[]`. */
export function checkComputerPersonas(input: unknown): string[] {
  const result = ComputerPersonasSchema.safeParse(input);
  return result.success ? [] : formatDataIssues(input, result.error);
}

/**
 * Whether `username` is a computer persona's name (case-insensitive). New
 * signups can't take one, so a kid never looks like a computer friend.
 */
export function isComputerPersonaName(
  personas: readonly ComputerPersona[],
  username: string,
): boolean {
  const lower = username.trim().toLowerCase();
  return personas.some((p) => p.name.toLowerCase() === lower);
}

// ---- Server-only (exported from `@heartpatch/shared/server`) ----------------

const count = z.number().int().min(0);
const percent = z.number().int().min(0).max(100);

/** The patch-wide rules (plan §3). Every number is a guess to tune. */
export const ComputerMateRulesSchema = z.strictObject({
  /** The switch fills the patch up to this many Keepers, real ones included. */
  fillTo: z.number().int().min(1).max(6),
  /** Turning the switch back on waits this long after it last changed. */
  toggleCooldownHours: count,
  /** Mates act only if a real member opened the patch this recently (#386c). */
  warmMinutes: count,
  catchUpSteps: count,
  stepMinutes: z.strictObject({ min: count, max: count }),
  landCapPercent: percent,
  kidHomeBuffer: count,
  minKidTiles: count,
  fireEveryTiles: z.number().int().min(1),
  guardedTiles: count,
  completedPerPatchDay: count,
  giftsPerPatchWeek: count,
  giftMaxValue: count,
  minFairPercent: percent,
  /** What a mate's own trade offer asks for, by `TRADE_VALUES` (386d). */
  offerValue: z.strictObject({ min: z.number().int().min(1), max: z.number().int().min(1) }),
  /** How many of each tradable item a kid may ask a mate for in one offer (386d). */
  shelfPerItem: z.number().int().min(1),
  challengesPerPatchWeek: z.strictObject({ on: count, gentle: count, off: count }),
  quietHours: z.strictObject({
    from: z.number().int().min(0).max(23),
    to: z.number().int().min(0).max(23),
  }),
  /** A mate's team size at creation (common and uncommon base forms). */
  teamSize: z.strictObject({ min: z.number().int().min(1), max: z.number().int().min(1) }),
});
export type ComputerMateRules = z.infer<typeof ComputerMateRulesSchema>;

export const ComputerPersonaTuningSchema = z.strictObject({
  id: ComputerPersonaIdSchema,
  claimsPerDay: count,
  /** Their team's level is the kid's Partner level plus this (−3 to −1). */
  levelOffset: z.number().int().min(-3).max(-1),
  stance: DefenseStanceSchema,
  answerMinutes: count,
  offersPerWeek: count,
  weights: z.strictObject({
    claim: count,
    trade: count,
    gift: count,
    guard: count,
    challenge: count,
  }),
});
export type ComputerPersonaTuning = z.infer<typeof ComputerPersonaTuningSchema>;

export const ComputerMatesSecretsSchema = z
  .strictObject({
    rules: ComputerMateRulesSchema,
    personas: z.array(ComputerPersonaTuningSchema).min(1),
  })
  .refine((d) => d.rules.stepMinutes.min <= d.rules.stepMinutes.max, 'stepMinutes min > max')
  .refine((d) => d.rules.teamSize.min <= d.rules.teamSize.max, 'teamSize min > max')
  .refine((d) => d.rules.offerValue.min <= d.rules.offerValue.max, 'offerValue min > max')
  .refine(
    (d) => new Set(d.personas.map((p) => p.id)).size === d.personas.length,
    'persona tuning repeats',
  );
export type ComputerMatesSecrets = z.infer<typeof ComputerMatesSecretsSchema>;

/** Validates the server-only tuning and returns readable problems, or `[]`. */
export function checkComputerMatesSecrets(input: unknown): string[] {
  const result = ComputerMatesSecretsSchema.safeParse(input);
  return result.success ? [] : formatDataIssues(input, result.error);
}
