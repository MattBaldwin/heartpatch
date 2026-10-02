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
