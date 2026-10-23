import { LocalDateSchema, type Season, type SeasonWindow } from '../schemas/data/seasons.js';

/** The window a season uses for the year it starts in. */
function windowFor(season: Season, startYear: number): SeasonWindow {
  return season.overrides?.[String(startYear)] ?? season.window;
}

function isActive(season: Season, year: number, monthDay: string): boolean {
  // A wrapping window that started last year can still be running.
  for (const startYear of [year, year - 1]) {
    const { start, end } = windowFor(season, startYear);
    const wraps = end < start;
    if (startYear === year) {
      if (wraps ? monthDay >= start : monthDay >= start && monthDay <= end) return true;
    } else if (wraps && monthDay <= end) {
      return true;
    }
  }
  return false;
}

/**
 * Seasons active on a map-local date (`YYYY-MM-DD`), in table order. Windows
 * are inclusive, may overlap, and wrap into the next year when `end` is
 * before `start`. Throws on an invalid date.
 */
export function activeSeasons(seasons: readonly Season[], localDate: string): Season[] {
  const date = LocalDateSchema.parse(localDate);
  const year = Number(date.slice(0, 4));
  const monthDay = date.slice(5);
  return seasons.filter((season) => isActive(season, year, monthDay));
}

/** A season's window as it starts in one year: which season, and its first and last local dates. */
export interface SeasonRun {
  readonly id: string;
  readonly name: string;
  /** The year its window starts in (a wrapping window ends the year after). */
  readonly year: number;
  /** Its first day, `YYYY-MM-DD` in the map's time zone. */
  readonly startsOn: string;
  /** Its last day, `YYYY-MM-DD` in the map's time zone. */
  readonly endsOn: string;
}

/** Every window that starts in one of `years`, as runs. */
function runsIn(seasons: readonly Season[], years: readonly number[]): SeasonRun[] {
  const ymd = (y: number, md: string) => `${String(y).padStart(4, '0')}-${md}`;
  return years.flatMap((year) =>
    seasons.map((season) => {
      const { start, end } = windowFor(season, year);
      return {
        id: season.id,
        name: season.name,
        year,
        startsOn: ymd(year, start),
        endsOn: ymd(end < start ? year + 1 : year, end),
      };
    }),
  );
}

/**
 * The season a map-local date (`YYYY-MM-DD`) belongs to (#306 PR 6: the far
 * Hollow is fresh each one). A season whose window is running holds until
 * its own window ends, so when windows overlap the earlier start keeps the
 * date (Halloween 2026 runs to Nov 9 though Thanksgiving starts Nov 3);
 * between seasons it's the one that started last. Every date belongs to
 * exactly one run. A tie goes to the earlier row. Null with no seasons.
 */
export function seasonRunAt(seasons: readonly Season[], localDate: string): SeasonRun | null {
  const date = LocalDateSchema.parse(localDate);
  const year = Number(date.slice(0, 4));
  const runs = runsIn(seasons, [year - 1, year]).filter((run) => run.startsOn <= date);
  let running: SeasonRun | null = null;
  let latest: SeasonRun | null = null;
  for (const run of runs) {
    if (run.endsOn >= date && (running === null || run.startsOn < running.startsOn)) running = run;
    if (latest === null || run.startsOn > latest.startsOn) latest = run;
  }
  return running ?? latest;
}

/** The next map-local date after `date` (`YYYY-MM-DD`). */
function dayAfter(date: string): string {
  const next = new Date(`${date}T00:00:00Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  return next.toISOString().slice(0, 10);
}

/**
 * The season that takes over after the one a map-local date belongs to
 * (`seasonRunAt`), and `takesOverOn`, the first day it does (#306: when a
 * fresh far Hollow comes). Null with no seasons.
 */
export function nextSeasonRun(
  seasons: readonly Season[],
  localDate: string,
): (SeasonRun & { readonly takesOverOn: string }) | null {
  const now = seasonRunAt(seasons, localDate);
  if (!now) return null;
  // Day by day: windows overlap and wrap, and two years always reach the next one.
  let day = LocalDateSchema.parse(localDate);
  for (let i = 0; i < 2 * 366; i++) {
    day = dayAfter(day);
    const run = seasonRunAt(seasons, day);
    if (run && (run.id !== now.id || run.year !== now.year)) return { ...run, takesOverOn: day };
  }
  return null;
}
