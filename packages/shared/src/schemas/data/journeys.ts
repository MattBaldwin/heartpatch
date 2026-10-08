import { z } from 'zod';
import type { Species } from './species.js';
import { formatDataIssues } from './issues.js';

const positiveInt = z.number().int().positive();

/**
 * Journeys to trading posts (#270, owner decisions 2 and 3 on #30): a post
 * that isn't connected to your land is visited by winning a journey showdown.
 * Public: the journey preview shows the level and team size, and the server
 * builds the trail team from the same rules.
 */
export const JourneyRulesSchema = z
  .strictObject({
    /** A journey's trail squishies are `baseLevel + levelsPerTile × distance`, uncapped (decision 3). */
    baseLevel: positiveInt,
    levelsPerTile: z.number().int().min(0),
    /**
     * How many trail squishies a journey meets: the row with the largest
     * `fromDistance` that's at most the distance. The first row must start at 1.
     */
    teamSize: z
      .array(z.strictObject({ fromDistance: positiveInt, size: z.number().int().min(1).max(3) }))
      .min(1),
    /** Hours a trail team stays the same for a player and post (a retry can't reroll it). Divides 24. */
    windowHours: positiveInt,
    /** Minutes a won journey's visit pass lasts. */
    visitMinutes: positiveInt,
    /** Species the trail team is picked from: public, non-seasonal base forms. */
    trail: z.array(z.string().min(1)).min(1),
  })
  .refine((r) => r.teamSize[0]?.fromDistance === 1, {
    message: 'the first teamSize row must start at distance 1',
    path: ['teamSize'],
  })
  .refine(
    (r) =>
      r.teamSize.every(
        (row, i) => i === 0 || row.fromDistance > (r.teamSize[i - 1]?.fromDistance ?? 0),
      ),
    {
      message: 'teamSize rows must go up by fromDistance',
      path: ['teamSize'],
    },
  )
  .refine((r) => 24 % r.windowHours === 0, {
    message: 'windowHours must divide 24',
    path: ['windowHours'],
  });
export type JourneyRules = z.infer<typeof JourneyRulesSchema>;

/**
 * Validates journey rules against the public species: every trail squishy is
 * known, a base form (nothing evolves into it) and not seasonal, so a journey
 * never shows a secret or out-of-season squishy. Returns readable problems, or `[]`.
 */
export function checkJourneyRules(input: unknown, species: readonly Species[]): string[] {
  const result = JourneyRulesSchema.safeParse(input);
  if (!result.success) return formatDataIssues(input, result.error);
  const byId = new Map(species.map((s) => [s.id, s]));
  const evolved = new Set(species.flatMap((s) => s.evolutions.map((e) => e.into)));
  const problems: string[] = [];
  result.data.trail.forEach((id, i) => {
    const s = byId.get(id);
    if (!s) problems.push(`trail.${String(i)}: unknown species "${id}"`);
    else if (evolved.has(id)) problems.push(`trail.${String(i)}: "${id}" is not a base form`);
    else if (s.season) problems.push(`trail.${String(i)}: "${id}" is seasonal`);
  });
  if (new Set(result.data.trail).size !== result.data.trail.length) {
    problems.push('trail: a species is listed twice');
  }
  return problems;
}
