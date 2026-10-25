import type { Hex, WeatherKind, WeatherView } from '@heartpatch/shared';

/** The kinds the island gallery page can pin with `?weather=`. */
export function galleryWeatherKind(value: string | null): Exclude<WeatherKind, 'clear'> | null {
  return value === 'rain' || value === 'storm' || value === 'fog' || value === 'drought'
    ? value
    : null;
}

/**
 * A fixed sky for the island gallery and its e2e: one front sitting over
 * `centre` (my Heart Seed, as the dev weather route puts it, so the sky wash
 * shows too), half through its life, so the same page shows the same weather
 * every time. With `vane` it also plans tomorrow's fronts in full.
 */
export function galleryWeather(
  kind: Exclude<WeatherKind, 'clear'>,
  nowMs: number,
  vane: boolean,
  centre: Hex = { q: 0, r: 0 },
): WeatherView {
  const hour = 3_600_000;
  const day = new Date(nowMs).toISOString().slice(0, 10);
  const front = {
    id: `gallery-${kind}`,
    kind,
    from: centre,
    to: centre,
    startAt: new Date(nowMs - hour).toISOString(),
    endAt: new Date(nowMs + hour).toISOString(),
    radius: 5,
  };
  const next = new Date(nowMs + 24 * hour).toISOString().slice(0, 10);
  return {
    today: { day, kind, fronts: [front] },
    tomorrow: vane
      ? {
          day: next,
          fronts: [
            {
              ...front,
              id: 'gallery-tomorrow',
              kind: 'rain',
              from: { q: centre.q + 6, r: centre.r - 3 },
              to: { q: centre.q - 6, r: centre.r + 3 },
              startAt: new Date(nowMs + 30 * hour).toISOString(),
              endAt: new Date(nowMs + 34 * hour).toISOString(),
              radius: 3,
            },
          ],
        }
      : { summary: 'Rain from the east tomorrow afternoon ☔' },
    serverTime: new Date(nowMs).toISOString(),
  };
}
