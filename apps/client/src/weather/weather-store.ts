import {
  weatherAt,
  type Hex,
  type MapView,
  type WeatherKind,
  type WeatherView,
} from '@heartpatch/shared';
import { heartSeedOf } from '../hollow/dark-land.js';
import { weatherApi, type WeatherApi } from './weather-api.js';
import { localDay } from './weather-time.js';

/** How often the plan is fetched again (a vane or a dev route can change it). // TUNE: */
export const REFETCH_MS = 15 * 60_000;

export interface WeatherDeps {
  /** The game clock (the server's time), in milliseconds. */
  now: () => number;
  me: () => string | null;
  api?: WeatherApi;
}

export interface Weather {
  readonly view: WeatherView | null;
  readonly map: MapView | null;
  readonly home: Hex | null;
  /** What the sky is doing over my home right now (`clear` before the plan arrives). */
  kindNow(): WeatherKind;
}

/**
 * What the client knows of the Wild Isle weather: the last plan, fetched
 * when a Wild Isle opens, every 15 minutes, and when the local day turns.
 * One store shared by the layer, the tint, the chip and the sheet.
 */
export class WeatherStore implements Weather {
  view: WeatherView | null = null;
  map: MapView | null = null;
  home: Hex | null = null;
  private readonly api: WeatherApi;
  private readonly listeners = new Set<() => void>();
  private fetchedAt = -Infinity;
  private fetchedDay = '';
  private inFlight = false;
  private timer: ReturnType<typeof setInterval> | null = null;

  private readonly deps: WeatherDeps;

  constructor(deps: WeatherDeps) {
    this.deps = deps;
    this.api = deps.api ?? weatherApi;
  }

  /** The game clock, in milliseconds. */
  now(): number {
    return this.deps.now();
  }

  get wild(): boolean {
    return this.map?.map.patchType === 'wild-isle';
  }

  onChange(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** The map opened or its view changed. */
  sync(view: MapView): void {
    if (this.map?.map.id !== view.map.id) {
      this.view = null;
      this.fetchedAt = -Infinity;
      this.fetchedDay = '';
    }
    this.map = view;
    this.home = this.wild ? heartSeedOf(view, this.deps.me()) : null;
    if (!this.wild) {
      this.view = null;
      this.emit();
      return;
    }
    this.refreshIfStale();
  }

  /** Starts the stale check; the returned stop is for the scene's disposal. */
  start(): () => void {
    this.stop();
    this.timer = setInterval(() => this.refreshIfStale(), 30_000);
    return () => this.stop();
  }

  private stop(): void {
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
  }

  refreshIfStale(): void {
    if (!this.wild || !this.map || this.inFlight) return;
    const now = this.deps.now();
    const day = localDay(now, this.map.map.timeZone);
    if (now - this.fetchedAt < REFETCH_MS && day === this.fetchedDay) return;
    void this.refresh();
  }

  async refresh(): Promise<void> {
    const map = this.map;
    if (!map || this.inFlight) return;
    this.inFlight = true;
    try {
      const view = await this.api.get(map.map.id);
      if (this.map?.map.id !== map.map.id) return;
      this.view = view;
      this.fetchedAt = this.deps.now();
      this.fetchedDay = localDay(this.fetchedAt, map.map.timeZone);
      this.emit();
    } catch {
      // Keep the last plan; the next tick tries again.
      this.fetchedAt = this.deps.now() - REFETCH_MS + 60_000;
    } finally {
      this.inFlight = false;
    }
  }

  kindNow(): WeatherKind {
    if (!this.view || !this.home) return 'clear';
    return weatherAt(this.view.today.fronts, this.home, this.deps.now());
  }

  private emit(): void {
    for (const fn of this.listeners) fn();
  }
}
