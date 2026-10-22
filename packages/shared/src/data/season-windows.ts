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
}

/** Every window that starts in one of `years`, as runs. */
function runsIn(seasons: readonly Season[], years: readonly number[]): SeasonRun[] {
  return years.flatMap((year) =>
    seasons.map((season) => ({
      id: season.id,
      name: season.name,
      year,
      startsOn: `${String(year).padStart(4, '0')}-${windowFor(season, year).start}`,
    })),
  );
}

/**
 * The season whose window started last on or before a map-local date
 * (`YYYY-MM-DD`): the one running now, or between seasons the one that ran
 * last, so every date belongs to exactly one run (#306 PR 6: the far Hollow
 * is fresh each one). Overlapping windows go to the later start (New Year
 * over Christmas on Dec 31); a tie to the earlier row. Null with no seasons.
 */
export function latestSeasonRun(seasons: readonly Season[], localDate: string): SeasonRun | null {
  const date = LocalDateSchema.parse(localDate);
  const year = Number(date.slice(0, 4));
  let latest: SeasonRun | null = null;
  for (const run of runsIn(seasons, [year - 1, year])) {
    if (run.startsOn <= date && (latest === null || run.startsOn > latest.startsOn)) latest = run;
  }
  return latest;
}

/**
 * The next season to start after a map-local date (`YYYY-MM-DD`), or null
 * with no seasons. A tie goes to the earlier row.
 */
export function nextSeasonRun(seasons: readonly Season[], localDate: string): SeasonRun | null {
  const date = LocalDateSchema.parse(localDate);
  const year = Number(date.slice(0, 4));
  let next: SeasonRun | null = null;
  for (const run of runsIn(seasons, [year, year + 1])) {
    if (run.startsOn > date && (next === null || run.startsOn < next.startsOn)) next = run;
  }
  return next;
}
