import { LocalDateSchema, type LocalDate } from '../schemas/time.js';

/*
 * Spawn windows (tech spec §8 "No rerolls"): a block of map-local wall-clock
 * time whose wild squishies are fixed. The block length divides 24; the id is
 * the map-local date plus the 0-based block, e.g. `2026-10-31/5` (20:00–23:59
 * with 4-hour blocks). Shared code never reads the clock or time zones, so the
 * server turns an instant into map-local date and hour (`spawnWindowId` in
 * `apps/server/src/lib/time.ts`) and this file does the rest.
 */

/** Block lengths that divide a day evenly. */
export const SPAWN_WINDOW_HOURS = [1, 2, 3, 4, 6, 8, 12, 24] as const;

export interface SpawnWindow {
  /** `YYYY-MM-DD/<block>`: unique per map-local block. To order ids, compare the date, then the block as a number. */
  readonly id: string;
  /** The map-local date the block is on. */
  readonly date: LocalDate;
  /** 0-based block of the day: `floor(local hour / hours)`. */
  readonly block: number;
  /** Block length in hours. */
  readonly hours: number;
}

export function isSpawnWindowHours(hours: number): boolean {
  return (SPAWN_WINDOW_HOURS as readonly number[]).includes(hours);
}

/**
 * The spawn window holding a map-local wall-clock time. On daylight-saving
 * days one block is longer or shorter in real time (an hour skipped or
 * repeated), but ids stay unique and in order.
 */
export function spawnWindowAt(local: { date: string; hour: number }, hours: number): SpawnWindow {
  if (!isSpawnWindowHours(hours)) {
    throw new RangeError(`spawn windows must divide a day evenly, got ${String(hours)} hours`);
  }
  if (!Number.isInteger(local.hour) || local.hour < 0 || local.hour > 23) {
    throw new RangeError(`expected a local hour 0–23, got ${String(local.hour)}`);
  }
  const date = LocalDateSchema.parse(local.date);
  const block = Math.floor(local.hour / hours);
  return { id: `${date}/${String(block)}`, date, block, hours };
}

/** The block's middle, in local hours (what its time of day is judged by). */
export function spawnWindowMidpoint(window: SpawnWindow): number {
  return window.block * window.hours + window.hours / 2;
}
