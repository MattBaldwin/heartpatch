import type { WeatherKind, WeatherView } from '@heartpatch/shared';

/** The kinds the island gallery page can pin with `?weather=`. */
export function galleryWeatherKind(value: string | null): Exclude<WeatherKind, 'clear'> | null {
  return value === 'rain' || value === 'storm' || value === 'fog' || value === 'drought'
    ? value
    : null;
}

/**
 * A fixed sky for the island gallery and its e2e: one front sitting over the
 * island's middle, half through its life, so the same page shows the same
 * weather every time. With `vane` it also plans tomorrow's fronts in full.
 */
export function galleryWeather(
  kind: Exclude<WeatherKind, 'clear'>,
  nowMs: number,
  vane: boolean,
): WeatherView {
  const hour = 3_600_000;
  const day = new Date(nowMs).toISOString().slice(0, 10);
  const front = {
    id: `gallery-${kind}`,
    kind,
    from: { q: 0, r: 0 },
    to: { q: 0, r: 0 },
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
              from: { q: 6, r: -3 },
              to: { q: -6, r: 3 },
              startAt: new Date(nowMs + 30 * hour).toISOString(),
              endAt: new Date(nowMs + 34 * hour).toISOString(),
              radius: 3,
            },
          ],
        }
      : { summary: 'Rain from the east in the afternoon' },
    serverTime: new Date(nowMs).toISOString(),
  };
}
