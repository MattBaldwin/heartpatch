import { z } from 'zod';

// Time-related schemas shared by accounts, maps and seasons. Shared code never
// reads the clock: the server passes times in.

const DAYS_IN_MONTH = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

/** Whether `day` exists in `month`; with no year, Feb 29 counts as real. */
export function isRealDay(
  year: number | undefined,
  month: number | undefined,
  day: number | undefined,
) {
  if (month === undefined || day === undefined) return false;
  const leap = year === undefined || (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  const max = month === 2 && !leap ? 28 : DAYS_IN_MONTH[month - 1];
  return max !== undefined && day >= 1 && day <= max;
}

/**
 * IANA time zone from the device (`Intl.DateTimeFormat().resolvedOptions().timeZone`).
 * The server checks it's a real zone and stores the canonical name. Accounts
 * use it for daily caps, maps for nightfall and daily jobs (design doc §3).
 */
export const TimeZoneSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z_]+(?:\/[A-Za-z0-9_+-]+)*$/);

/** A map-local calendar date, `YYYY-MM-DD`. Shared code never reads the clock. */
export const LocalDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected a date like "2026-10-31"')
  .refine((date) => {
    const [year, month, day] = date.split('-').map(Number);
    return isRealDay(year, month, day);
  }, 'Not a real date');
export type LocalDate = z.infer<typeof LocalDateSchema>;
