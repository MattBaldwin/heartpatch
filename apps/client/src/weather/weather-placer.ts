import type { WeatherFront } from '@heartpatch/shared';
import {
  createWeatherLayout,
  layoutWeather,
  type CloudThickness,
  type WeatherLayout,
} from './weather-layout.js';

/** Weather positions are recomputed at most this often unless something changed. // TUNE: */
export const PLACE_EVERY_MS = 30_000;

/**
 * Owns the one fixed layout and decides when to refill it. Fronts crawl over
 * hours, so positions need no more than one refresh each 30 seconds; a new
 * plan or a new rain share (tier, mode) refills at once.
 */
export class WeatherPlacer {
  readonly layout: WeatherLayout = createWeatherLayout();
  private fronts: readonly WeatherFront[] = [];
  private share = 1;
  private clouds: CloudThickness = { share: 1, alpha: 1 };
  private placedAt = -Infinity;
  /** How many times the layout was refilled (for tests and the dev hook). */
  placed = 0;

  setFronts(fronts: readonly WeatherFront[]): void {
    this.fronts = fronts;
    this.placedAt = -Infinity;
  }

  setRainShare(share: number): void {
    if (share === this.share) return;
    this.share = share;
    this.placedAt = -Infinity;
  }

  setClouds(clouds: CloudThickness): void {
    if (clouds.share === this.clouds.share && clouds.alpha === this.clouds.alpha) return;
    this.clouds = clouds;
    this.placedAt = -Infinity;
  }

  /** Refills the layout if it is due. Returns whether it did. */
  update(nowMs: number): boolean {
    if (nowMs - this.placedAt < PLACE_EVERY_MS && nowMs >= this.placedAt) return false;
    layoutWeather(this.fronts, nowMs, this.share, this.layout, this.clouds);
    this.placedAt = nowMs;
    this.placed++;
    return true;
  }
}
