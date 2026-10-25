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

/**
 * One map-local day's plan: the kind of day it rolled (`WEATHER_RULES.days`,
 * for the forecast chip, e.g. "Dry spell") and its fronts (none on a clear
 * day). `kind` is optional so a plan stored without it still parses.
 */
export const WeatherDaySchema = z.strictObject({
  day: LocalDateSchema,
  kind: WeatherKindSchema.optional(),
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

/**
 * `POST /maps/:mapId/dev/weather` (dev/test only, plan §9): today's plan
 * becomes one front of `kind` sitting over my Heart Seed from `at` (default
 * now) for `hours`, for screenshots and tests.
 */
export const DevWeatherRequestSchema = z.strictObject({
  kind: WeatherKindSchema.exclude(['clear']),
  at: z.iso.datetime().optional(),
  hours: z.number().int().min(1).max(12).default(2),
});
export type DevWeatherRequest = z.infer<typeof DevWeatherRequestSchema>;

/** `POST /maps/:mapId/dev/knock` (dev/test only): a storm knocks one of my buildings about now. */
export const DevKnockRequestSchema = z.strictObject({ buildingId: z.uuid() });
export type DevKnockRequest = z.infer<typeof DevKnockRequestSchema>;
