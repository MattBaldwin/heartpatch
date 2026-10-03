import {
  spawnWindowAt,
  type LocalDate,
  type MapLocalTime,
  type SpawnWindow,
} from '@heartpatch/shared';
import type { Config } from '../config.js';

export const MINUTE_MS = 60_000;

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
  return localDateHour(at, timeZone).date;
}

/** The calendar date and wall-clock hour (0–23) at `at` in `timeZone`. */
export function localDateHour(at: Date, timeZone: string): { date: LocalDate; hour: number } {
  const { date, hour } = localDateTime(at, timeZone);
  return { date, hour };
}

/**
 * The calendar date, hour (0–23) and minute at `at` in `timeZone`
 * (Hearthfires, #18: nightfall is a time of day, not just an hour).
 */
export function localDateTime(
  at: Date,
  timeZone: string,
): { date: LocalDate; hour: number; minute: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(at);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? '';
  return {
    date: `${part('year').padStart(4, '0')}-${part('month')}-${part('day')}`,
    hour: Number(part('hour')),
    minute: Number(part('minute')),
  };
}

/**
 * Map-local wall-clock time at `at` in `timeZone` (an IANA zone), for the
 * shared Hearthfire and nightfall rules (#18, #21).
 */
export function mapLocalTime(at: Date, timeZone: string): MapLocalTime {
  const { date, hour, minute } = localDateTime(at, timeZone);
  return { date, minute: hour * 60 + minute };
}

/**
 * The spawn window at `at` on a map in `timeZone` (tech spec §8): map-local
 * date plus block, e.g. `2026-10-31/5`. Here rather than in shared because
 * time zones need `Intl`, which shared code doesn't use; the block maths is
 * shared (`spawnWindowAt`). On daylight-saving days one block runs 3 or 5
 * real hours; ids stay unique and in order.
 */
export function spawnWindowFor(at: Date, timeZone: string, hours: number): SpawnWindow {
  return spawnWindowAt(localDateHour(at, timeZone), hours);
}

/** `spawnWindowFor(at, timeZone, hours).id`. */
export function spawnWindowId(at: Date, timeZone: string, hours: number): string {
  return spawnWindowFor(at, timeZone, hours).id;
}
