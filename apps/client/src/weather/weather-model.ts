import {
  frontSummary,
  type FrontSummary,
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

export function frontLine(summary: FrontSummary): string {
  return `${WEATHER_EMOJI[summary.kind]} ${FRONT_NAME[summary.kind]} from the ${summary.from} ${WHEN[summary.when]}`;
}

/** One line per front in a day, in time order; empty when the sky stays clear. */
export function dayLines(day: WeatherDay, timeZone: string): string[] {
  const start = dayStartMs(day.day, timeZone);
  return [...day.fronts]
    .sort((a, b) => Date.parse(a.startAt) - Date.parse(b.startAt))
    .map((f: WeatherFront) => frontLine(frontSummary(f, start)));
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
): ForecastPage {
  const tomorrow = view.tomorrow;
  const hasVane = 'fronts' in tomorrow;
  return {
    now: nowLine(kindNow),
    today: hasVane ? dayLines(view.today, timeZone) : null,
    tomorrow: hasVane
      ? { summary: null, lines: dayLines(tomorrow, timeZone) }
      : { summary: tomorrow.summary, lines: [] },
    hasVane,
  };
}
