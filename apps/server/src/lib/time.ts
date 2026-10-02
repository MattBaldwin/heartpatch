import type { LocalDate } from '@heartpatch/shared';
import type { Config } from '../config.js';

/** The game clock. Services take one instead of calling `new Date()`, so tests and dev can move time. */
export type Clock = () => Date;

/**
 * The server's clock (tech spec §7, "Dev time override"). With `HP_DEV_NOW`
 * set (development and test only), the clock starts at that instant and keeps
 * ticking from there, so seasons and nightfall can be tried out locally.
 */
export function createClock(config: Pick<Config, 'NODE_ENV' | 'HP_DEV_NOW'>): Clock {
  if (config.HP_DEV_NOW === undefined) return () => new Date();
  if (config.NODE_ENV === 'production') {
    throw new Error('HP_DEV_NOW is for development and tests only');
  }
  const offsetMs = new Date(config.HP_DEV_NOW).getTime() - Date.now();
  return () => new Date(Date.now() + offsetMs);
}

/**
 * The canonical IANA name for a time zone (e.g. `US/Central` →
 * `America/Chicago`), or null if the runtime doesn't know the zone.
 */
export function canonicalTimeZone(timeZone: string): string | null {
  try {
    return new Intl.DateTimeFormat('en-US', { timeZone }).resolvedOptions().timeZone;
  } catch {
    return null;
  }
}

/** The calendar date at `at` in `timeZone` (e.g. a map's), as `YYYY-MM-DD`. */
export function localDate(at: Date, timeZone: string): LocalDate {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(at);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? '';
  return `${part('year').padStart(4, '0')}-${part('month')}-${part('day')}`;
}
