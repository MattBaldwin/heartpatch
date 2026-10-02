import { z } from 'zod';
import { ContentIdSchema, DescriptionSchema, DisplayNameSchema } from './common.js';

const DAYS_IN_MONTH = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

/** Whether `day` exists in `month`; with no year, Feb 29 counts as real. */
function isRealDay(year: number | undefined, month: number | undefined, day: number | undefined) {
  if (month === undefined || day === undefined) return false;
  const leap = year === undefined || (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  const max = month === 2 && !leap ? 28 : DAYS_IN_MONTH[month - 1];
  return max !== undefined && day >= 1 && day <= max;
}

/** A month and day, `MM-DD`, in the map's time zone. `02-29` is allowed. */
export const MonthDaySchema = z
  .string()
  .regex(/^\d{2}-\d{2}$/, 'Expected a month-day like "10-31"')
  .refine((md) => {
    const [month, day] = md.split('-').map(Number);
    return isRealDay(undefined, month, day);
  }, 'Not a real month-day');
export type MonthDay = z.infer<typeof MonthDaySchema>;

/**
 * An inclusive window. If `end` is earlier than `start` it wraps into the
 * next year (New Year: `12-31` to `01-02`).
 */
export const SeasonWindowSchema = z.strictObject({
  start: MonthDaySchema,
  end: MonthDaySchema,
});
export type SeasonWindow = z.infer<typeof SeasonWindowSchema>;

/**
 * A season (design doc §15): a recurring window plus optional per-year
 * overrides keyed by the year the window starts in. Seasons may overlap.
 */
export const SeasonSchema = z.strictObject({
  id: ContentIdSchema,
  name: DisplayNameSchema,
  description: DescriptionSchema,
  window: SeasonWindowSchema,
  overrides: z
    .record(z.string().regex(/^\d{4}$/, 'Override keys are four-digit years'), SeasonWindowSchema)
    .optional(),
});
export type Season = z.infer<typeof SeasonSchema>;

/** A map-local calendar date, `YYYY-MM-DD`. Shared code never reads the clock. */
export const LocalDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected a date like "2026-10-31"')
  .refine((date) => {
    const [year, month, day] = date.split('-').map(Number);
    return isRealDay(year, month, day);
  }, 'Not a real date');
export type LocalDate = z.infer<typeof LocalDateSchema>;
