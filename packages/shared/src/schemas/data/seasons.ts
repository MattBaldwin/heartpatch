import { z } from 'zod';
import { isRealDay } from '../time.js';
import { ContentIdSchema, DescriptionSchema, DisplayNameSchema } from './common.js';

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

// Moved to schemas/time.ts; re-exported so existing imports keep working.
export { LocalDateSchema, type LocalDate } from '../time.js';
