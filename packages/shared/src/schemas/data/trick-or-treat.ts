import { z } from 'zod';
import { ContentIdSchema } from './common.js';
import { formatDataIssues } from './issues.js';

/**
 * Trick-or-treat (#515, owner answers 2026-10-18): visit a patch-mate's Heart
 * Seed home in the Halloween season for a treat, once per home per patch day.
 * These rules are public: the app shows when it's on and whose lantern is lit.
 * What a treat can be, and the odds, are secret (`trick-or-treat-prizes.ts`,
 * exported only from `@heartpatch/shared/server`).
 */
export const TrickOrTreatRulesSchema = z.strictObject({
  /** The season id it runs in (the map's local date, like every seasonal thing). */
  season: ContentIdSchema,
  /** The building whose lit fire makes a home's treats better (and its Heart Seed glow). */
  lanternBuildingId: ContentIdSchema,
  /** Heartdust the host gets from each visitor, as a thank-you. */
  hostThanks: z.number().int().min(1).max(10),
});
export type TrickOrTreatRules = z.infer<typeof TrickOrTreatRulesSchema>;

/** The content `checkTrickOrTreatRules` checks references against. */
export interface TrickOrTreatRefs {
  seasons: readonly { id: string }[];
  buildings: readonly { id: string; kind: string; season?: string | undefined }[];
}

/**
 * Validates the rules and returns readable problems, or `[]`: a real season,
 * and a lantern that is a Hearthfire of that season.
 */
export function checkTrickOrTreatRules(input: unknown, refs: TrickOrTreatRefs): string[] {
  const result = TrickOrTreatRulesSchema.safeParse(input);
  if (!result.success) return formatDataIssues(input, result.error);
  const rules = result.data;
  const problems: string[] = [];
  if (!refs.seasons.some((s) => s.id === rules.season)) {
    problems.push(`season: unknown season "${rules.season}"`);
  }
  const lantern = refs.buildings.find((b) => b.id === rules.lanternBuildingId);
  if (!lantern) problems.push(`lanternBuildingId: unknown building "${rules.lanternBuildingId}"`);
  else if (lantern.kind !== 'hearthfire' || lantern.season !== rules.season) {
    problems.push(`lanternBuildingId: "${lantern.id}" isn't a ${rules.season} Hearthfire`);
  }
  return problems;
}
