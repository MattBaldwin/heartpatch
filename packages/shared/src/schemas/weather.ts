import { z } from 'zod';
import { HexSchema } from '../hex/index.js';
import { WeatherKindSchema } from './data/weather.js';
import { LocalDateSchema } from './time.js';

/**
 * One weather front (Wild Isle, #621): it drifts in a straight line from
 * `from` to `to` (shared `hexLine`) between `startAt` and `endAt`, covering
 * every tile within `radius` of where it is. Weather at a tile is a pure
 * function of the fronts and the time, so client and server agree.
 */
export const WeatherFrontSchema = z.strictObject({
  /** Stable within its map and day (knocks name it). */
  id: z.string().min(1).max(64),
  kind: WeatherKindSchema.exclude(['clear']),
  from: HexSchema,
  to: HexSchema,
  startAt: z.iso.datetime(),
  endAt: z.iso.datetime(),
  radius: z.number().int().min(1).max(6),
});
export type WeatherFront = z.infer<typeof WeatherFrontSchema>;

/** One map-local day's plan: its fronts (none on a clear day). */
export const WeatherDaySchema = z.strictObject({
  day: LocalDateSchema,
  fronts: z.array(WeatherFrontSchema),
});
export type WeatherDay = z.infer<typeof WeatherDaySchema>;

/**
 * `GET /api/v1/maps/:mapId/weather` (Wild Isle only; NOT_FOUND on a Cozy
 * Patch). Today's fronts, and tomorrow's: in full with a Weather Vane, or a
 * one-line summary without.
 */
export const WeatherViewSchema = z.object({
  today: WeatherDaySchema,
  tomorrow: z.union([WeatherDaySchema, z.strictObject({ summary: z.string().min(1).max(200) })]),
  serverTime: z.iso.datetime(),
});
export type WeatherView = z.infer<typeof WeatherViewSchema>;
