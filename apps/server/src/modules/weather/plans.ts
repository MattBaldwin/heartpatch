import {
  activeSeasons,
  addDays,
  deriveSeed,
  GAME_DATA,
  MAP_GEN,
  patchRules,
  planWeatherDay,
  wildIsleLayout,
  type DayWindow,
  type Island,
  type LocalDate,
  type WeatherDay,
  type WeatherFront,
  type WeatherRules,
} from '@heartpatch/shared';
import type { Executor } from '../../db/client.js';
import { instantOfLocal, localDate } from '../../lib/time.js';
import { createWeatherRepo, type WeatherMapRow } from './repo.js';

/*
 * Wild Isle weather plans on the server (#621, plan §4): each map-local day's
 * fronts come from `deriveSeed(mapSeed, 'weather', day)` (secret: the seed is
 * never sent, only the plan) and are stored once (`weather_days`, `ON
 * CONFLICT DO NOTHING`), so a retune of `WEATHER_RULES` never rewrites a day
 * kids already saw, and the client and server read the same fronts.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/** A Wild Isle map as the weather sees it: its rules and where its days fall. */
export interface WeatherMap extends WeatherMapRow {
  rules: WeatherRules;
  island: Island;
}

/** The map's weather, or null for a Cozy Patch (no weather) or a missing map. */
export async function weatherMap(tx: Executor, mapId: string): Promise<WeatherMap | null> {
  const row = await createWeatherRepo(tx).map(mapId);
  const rules = row ? patchRules(row.patchType).weather : null;
  if (!row || !rules) return null;
  return { ...row, rules, island: islandOf(row.maxPlayers) };
}

/** The island a plan is drawn over: the generator's layout for the map's seats. */
export function islandOf(maxPlayers: number): Island {
  const rules = MAP_GEN.wildIsle;
  if (!rules) throw new RangeError('no Wild Isle settings in mapGen');
  let layout = rules.layouts[0];
  try {
    layout = wildIsleLayout(rules, maxPlayers);
  } catch {
    // A seat count with no layout of its own: the first one's size.
  }
  if (!layout) throw new RangeError('no Wild Isle layout');
  return { radius: layout.radius, oceanRings: layout.oceanRings };
}

/** A map-local day as instants, its real midnight to the next (23 or 25 hours on a DST day). */
export function dayWindow(day: LocalDate, timeZone: string): DayWindow {
  const near = (d: LocalDate) => new Date(Date.parse(`${d}T12:00:00Z`));
  const next = addDays(day, 1);
  return {
    day,
    startMs: instantOfLocal({ date: day, minute: 0 }, timeZone, near(day)).getTime(),
    endMs: instantOfLocal({ date: next, minute: 0 }, timeZone, near(next)).getTime(),
  };
}

/** A day's plan as the rules make it today (not stored). */
export function planDay(map: WeatherMap, day: LocalDate): WeatherDay {
  const seasons = activeSeasons(GAME_DATA.seasons, day).map((s) => s.id);
  return planWeatherDay(
    deriveSeed(map.seed ?? map.id, 'weather', day),
    map.rules,
    seasons,
    dayWindow(day, map.timeZone),
    map.island,
  );
}

/** The map-local days from `from`'s to `to`'s, in order. */
export function daysBetween(map: WeatherMap, from: Date, to: Date): LocalDate[] {
  const days: LocalDate[] = [];
  const last = localDate(to, map.timeZone);
  for (let day = localDate(from, map.timeZone); day <= last; day = addDays(day, 1)) {
    days.push(day);
  }
  return days;
}

/** The oldest instant whose weather still counts: days past retention roll no knocks. */
export function keptFrom(map: WeatherMap, now: Date): Date {
  return new Date(now.getTime() - map.rules.retentionDays * DAY_MS);
}

/**
 * Each day's plan, stored the first time anyone needs it (each day its own
 * statement, so a plan is never held behind a busy transaction's locks:
 * call this outside the transaction that reads them, in day order).
 */
export async function storeDays(
  db: Executor,
  map: WeatherMap,
  days: readonly LocalDate[],
  at: Date,
): Promise<Map<LocalDate, WeatherDay>> {
  const repo = createWeatherRepo(db);
  const stored = await repo.days(map.id, days);
  const missing = days.filter((d) => !stored.has(d));
  if (missing.length === 0) return stored;
  for (const day of missing) await repo.insertDay(map.id, planDay(map, day), at);
  // Another reader may have stored one first: theirs stands.
  for (const [day, plan] of await repo.days(map.id, missing)) stored.set(day, plan);
  return stored;
}

/**
 * The fronts over `[from, to]`, read inside a transaction: the stored days,
 * and any day nobody stored yet as the rules would plan it (it's stored
 * when someone next asks; the plan is the same unless the rules changed).
 */
export async function frontsBetween(
  tx: Executor,
  map: WeatherMap,
  from: Date,
  to: Date,
): Promise<WeatherFront[]> {
  const days = daysBetween(map, from, to);
  const stored = await createWeatherRepo(tx).days(map.id, days);
  return days.flatMap((day) => (stored.get(day) ?? planDay(map, day)).fronts);
}
