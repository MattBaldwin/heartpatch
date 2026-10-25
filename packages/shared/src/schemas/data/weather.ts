import { z } from 'zod';
import { ContentIdSchema } from './common.js';
import { formatDataIssues, type Report } from './issues.js';
import { WaterKindSchema } from './terrains.js';

/**
 * Wild Isle weather (#621, owner decision 2026-10-22: visible, moving
 * fronts). Each map-local day has a kind; a day that isn't `clear` sends
 * 0–2 fronts of its kind drifting across the island. Cozy Patches have no
 * weather (`patchRules`).
 */
export const WeatherKindSchema = z.enum(['clear', 'rain', 'storm', 'fog', 'drought']);
export type WeatherKind = z.infer<typeof WeatherKindSchema>;

const percent = z.number().int().min(0).max(1000);

/** A weighted day kind: `weight` against the rest of its table. */
const DayKindSchema = z.strictObject({
  kind: WeatherKindSchema,
  weight: z.number().int().positive(),
});

/** A whole-number range, both ends included. */
const rangeSchema = (min: number, max: number) =>
  z
    .strictObject({
      min: z.number().int().min(min).max(max),
      max: z.number().int().min(min).max(max),
    })
    .refine((r) => r.min <= r.max, 'min above max');

export const WeatherRulesSchema = z.strictObject({
  /** The everyday table of day kinds. */
  days: z.array(DayKindSchema).min(1),
  /** A season's own table (by `SEASONS` id), used instead of `days` while it runs. */
  seasons: z.array(
    z.strictObject({ season: ContentIdSchema, days: z.array(DayKindSchema).min(1) }),
  ),
  fronts: z.strictObject({
    /** Fronts a day that isn't clear sends. */
    perDay: rangeSchema(0, 4),
    /** How fast a front drifts, in tiles an hour. */
    tilesPerHour: rangeSchema(1, 12),
    /** How many tiles around its centre a front covers. */
    radius: rangeSchema(1, 6),
  }),
  effects: z.strictObject({
    /** A gatherer's pace under a front of this kind, as a whole percent (left out: 100). */
    gatherPercent: z.partialRecord(WeatherKindSchema, percent),
    /** A Fishing Pier's pace under a front of this kind (left out: 100). */
    pierPercent: z.partialRecord(WeatherKindSchema, percent),
    storm: z.strictObject({
      /** Percent chance a storm front knocks a building it crosses (one seeded roll per front and building). */
      knockPercent: z.number().int().min(0).max(100),
      /** Added to `knockPercent` for a building next to water of a `nearWater` kind (flooding). */
      floodBonusPercent: z.number().int().min(0).max(100),
      nearWater: z.array(WaterKindSchema).min(1),
    }),
    /** Fixing a knocked building costs this percent of what was spent on it (rounded up per item). */
    repairPercent: z.number().int().min(1).max(100),
  }),
  forecast: z.strictObject({
    /** Everyone sees tomorrow's one-line summary. */
    summaryForAll: z.boolean(),
    /** Tomorrow's fronts in detail need a Weather Vane. */
    detailNeedsVane: z.boolean(),
  }),
  /** Days of stored plans (`weather_days`) kept before the sweep deletes them. */
  retentionDays: z.number().int().min(2).max(60),
});
export type WeatherRules = z.infer<typeof WeatherRulesSchema>;

/**
 * Readable problems with the weather rules, or `[]`: they parse; every
 * season named is a real one, once; no table lists a kind twice; and every
 * table can roll a day.
 */
export function checkWeatherRules(input: unknown, seasonIds: ReadonlySet<string>): string[] {
  const parsed = WeatherRulesSchema.safeParse(input);
  if (!parsed.success) return formatDataIssues(input, parsed.error);
  const rules = parsed.data;
  const problems: string[] = [];
  const report: Report = (path, message) => {
    problems.push(`${path.join('.')}: ${message}`);
  };
  const checkTable = (table: z.infer<typeof DayKindSchema>[], path: (string | number)[]) => {
    const kinds = new Set<string>();
    table.forEach((row, i) => {
      if (kinds.has(row.kind)) report([...path, i, 'kind'], `"${row.kind}" twice`);
      kinds.add(row.kind);
    });
  };
  checkTable(rules.days, ['days']);
  const seen = new Set<string>();
  rules.seasons.forEach((s, i) => {
    if (!seasonIds.has(s.season)) report(['seasons', i, 'season'], `unknown season "${s.season}"`);
    if (seen.has(s.season)) report(['seasons', i, 'season'], `"${s.season}" twice`);
    seen.add(s.season);
    checkTable(s.days, ['seasons', i, 'days']);
  });
  return problems;
}
