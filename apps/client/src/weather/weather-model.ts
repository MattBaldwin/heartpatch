import {
  frontCover,
  frontSummary,
  type FrontSummary,
  type Hex,
  type PartOfDay,
  type WeatherDay,
  type WeatherFront,
  type WeatherKind,
  type WeatherView,
} from '@heartpatch/shared';
import { dayStartMs } from './weather-time.js';

// What the weather says to a player (#621 W1-9): cozy, short, kid-readable.
// A storm "knocks a building about"; nothing here says "damage" or "destroy".

export const WEATHER_EMOJI: Readonly<Record<WeatherKind, string>> = {
  clear: '☀️',
  rain: '🌧️',
  storm: '⛈️',
  fog: '🌫️',
  drought: '🌞',
};

const NOW_LINE: Readonly<Record<WeatherKind, string>> = {
  clear: 'Clear skies over your home',
  rain: 'Rain is pattering over your home',
  storm: 'A storm is rumbling over your home',
  fog: 'Fog is floating over your home',
  drought: 'Warm and dry over your home',
};

const FRONT_NAME: Readonly<Record<Exclude<WeatherKind, 'clear'>, string>> = {
  rain: 'Rain',
  storm: 'A storm',
  fog: 'Fog',
  drought: 'A warm, dry spell',
};

const WHEN: Readonly<Record<PartOfDay, string>> = {
  morning: 'in the morning',
  afternoon: 'in the afternoon',
  evening: 'in the evening',
  night: 'at night',
};

export const WEATHER_TEXT = {
  title: 'Weather',
  close: 'Close the weather',
  nowHead: 'Right now',
  todayHead: 'Today',
  tomorrowHead: 'Tomorrow',
  mapLabel: "Today's skies over the island",
  nothingComing: 'No weather on the way ☀️',
  noVane: 'A Weather Vane shows every front coming, and when. 🌬️',
  stormTip: 'Storms can knock a building about. You can fix it, and it will work again!',
  chipLabel: (kind: WeatherKind): string => `${NOW_LINE[kind]}. Open the forecast.`,
} as const;

export function nowLine(kind: WeatherKind): string {
  return `${WEATHER_EMOJI[kind]} ${NOW_LINE[kind]}`;
}

/** How a front sits against my home: over it this minute, later or earlier, or never. */
export type FrontState = 'now' | 'later' | 'missing';

export function frontLine(summary: FrontSummary, state: FrontState = 'later'): string {
  const lead = `${WEATHER_EMOJI[summary.kind]} ${FRONT_NAME[summary.kind]} from the ${summary.from}`;
  if (state === 'now') return `${lead}, right now`;
  return state === 'missing'
    ? `${lead} ${WHEN[summary.when]}, missing your home`
    : `${lead} ${WHEN[summary.when]}`;
}

/** Where I am and what time it is, so a line can agree with the "right now" line above it. */
export interface HomeClock {
  readonly home: Hex;
  readonly nowMs: number;
}

/**
 * One line per front in a day, in time order; empty when the sky stays clear.
 * With a home, a line speaks about the stretch the front is over my home (the
 * same cover `weatherAt` reads for "right now"), not the middle of its trip
 * across the island, so the two never disagree.
 */
export function dayLines(day: WeatherDay, timeZone: string, at?: HomeClock): string[] {
  const start = dayStartMs(day.day, timeZone);
  const end = start + 24 * 3_600_000;
  return [...day.fronts]
    .sort((a, b) => Date.parse(a.startAt) - Date.parse(b.startAt))
    .map((f: WeatherFront) => {
      if (!at) return frontLine(frontSummary(f, start));
      const cover = frontCover(f, at.home);
      if (cover.some(([from, to]) => from <= at.nowMs && at.nowMs < to)) {
        return frontLine(frontSummary(f, start), 'now');
      }
      const today = cover.find(([from, to]) => to > start && from < end);
      if (!today) return frontLine(frontSummary(f, start), 'missing');
      // Reuse the shared part-of-day rule on the stretch over my home.
      const over = {
        ...f,
        startAt: new Date(Math.max(today[0], start)).toISOString(),
        endAt: new Date(Math.min(today[1], end)).toISOString(),
      };
      return frontLine(frontSummary(over, start));
    });
}

export interface ForecastPage {
  readonly now: string;
  /** Today's fronts: only with a Weather Vane. */
  readonly today: readonly string[] | null;
  /** Tomorrow: a one-line guess without a vane, the fronts with one. */
  readonly tomorrow: { readonly summary: string | null; readonly lines: readonly string[] };
  readonly hasVane: boolean;
}

export function forecastPage(
  view: WeatherView,
  kindNow: WeatherKind,
  timeZone: string,
  at?: HomeClock,
): ForecastPage {
  const tomorrow = view.tomorrow;
  const hasVane = 'fronts' in tomorrow;
  return {
    now: nowLine(kindNow),
    today: hasVane ? dayLines(view.today, timeZone, at) : null,
    tomorrow: hasVane
      ? { summary: null, lines: dayLines(tomorrow, timeZone, at) }
      : { summary: tomorrow.summary, lines: [] },
    hasVane,
  };
}
