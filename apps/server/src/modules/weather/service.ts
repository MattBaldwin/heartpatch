import {
  addDays,
  forecastLine,
  heartSeedOf,
  WEATHER_RULES,
  type DevKnockRequest,
  type DevWeatherRequest,
  type HollowStatus,
  type PublicUser,
  type WeatherView,
} from '@heartpatch/shared';
import type { Executor } from '../../db/client.js';
import { appendGameEvent } from '../../db/game-events.js';
import { AppError } from '../../lib/errors.js';
import { localDate, type Clock } from '../../lib/time.js';
import { upkeepOf } from '../buildings/production.js';
import { createBuildingsRepo } from '../buildings/repo.js';
import { requireMember } from '../maps/members.js';
import { createMapsRepo } from '../maps/repo.js';
import { knockable, resolveWeather } from './knocks.js';
import {
  dayWindow,
  daysBetween,
  keptFrom,
  storeDays,
  weatherMap,
  type WeatherMap,
} from './plans.js';
import { createWeatherRepo } from './repo.js';

export { weatherMap } from './plans.js';

/*
 * Wild Isle weather (#621, plan §3–4): today's and tomorrow's fronts for
 * everyone on the patch (tomorrow in full only with a Weather Vane), and the
 * hourly sweep that rolls every player's storms so patch-mates see knocks
 * and the morning card is right for a kid who's away. A Cozy Patch has no
 * weather: `NOT_FOUND`, and nothing here runs for it.
 */

// Kid-readable messages (style guide §6).
export const MESSAGES = {
  noWeather: 'There is no weather on this patch.',
  noBuilding: "We couldn't find that building.",
  notKnockable: "Storms can't knock that one about.",
  noHome: 'You need a home first!',
  vaneOnly: 'Build a Weather Vane to see tomorrow! 🌬️',
} as const;

/** Nights of knocks the morning card looks back over (`HollowStatus.weatherNotes`). */
export const WEATHER_NOTE_NIGHTS = 3; // TUNE:

const DAY_MS = 24 * 60 * 60 * 1000;

export interface WeatherService {
  /** Today's fronts and tomorrow's (in full with a Weather Vane), stored on first read. */
  view: (user: PublicUser, mapId: string) => Promise<WeatherView>;
  /** Rolls every player's storms on one map up to now. How many buildings it knocked. */
  sweep: (mapId: string) => Promise<number>;
  /** Every Wild Isle map's id, for the sweep job. */
  wildMaps: () => Promise<string[]>;
  /** Deletes plans older than every map's retention. How many went. */
  retain: () => Promise<number>;
  /** Dev/test only: today's plan becomes one front over my Heart Seed. */
  devWeather: (user: PublicUser, mapId: string, request: DevWeatherRequest) => Promise<WeatherView>;
  /** Dev/test only: a storm knocks one of my buildings about now. */
  devKnock: (user: PublicUser, mapId: string, request: DevKnockRequest) => Promise<void>;
}

export interface WeatherServiceOptions {
  db: Executor;
  clock?: Clock;
  /** Live sync (`wsHub.publish`), called after commit when something changed. Never rejects. */
  publish?: (mapId: string) => Promise<void>;
}

/**
 * Stores the plans a player's storms will be rolled against (`resolveWeather`
 * reads them in its transaction): from their least-rolled building's last
 * look to now, never further back than retention. Read unlocked, outside
 * the caller's transaction, so no insert waits behind its locks.
 */
export async function storeWeatherFor(
  db: Executor,
  map: WeatherMap,
  userId: string,
  at: Date,
): Promise<void> {
  const rows = (await createBuildingsRepo(db).listOwned(map.id, userId)).filter(
    (r) => upkeepOf(r) !== null && knockable(r),
  );
  const kept = keptFrom(map, at).getTime();
  const from = Math.min(
    at.getTime(),
    ...rows.map((r) => Math.max((r.weatherCheckedThrough ?? r.placedAt).getTime(), kept)),
  );
  await storeDays(db, map, daysBetween(map, new Date(from), at), at);
}

export function createWeatherService(options: WeatherServiceOptions): WeatherService {
  const { db } = options;
  const now = options.clock ?? (() => new Date());
  const published = (mapId: string) => {
    void options.publish?.(mapId);
  };

  async function requireWeather(user: PublicUser, mapId: string): Promise<WeatherMap> {
    await requireMember(db, user, mapId);
    const map = await weatherMap(db, mapId);
    if (!map) throw new AppError('NOT_FOUND', MESSAGES.noWeather);
    return map;
  }

  async function viewOf(user: PublicUser, map: WeatherMap, at: Date): Promise<WeatherView> {
    const today = localDate(at, map.timeZone);
    const tomorrow = addDays(today, 1);
    const plans = await storeDays(db, map, [today, tomorrow], at);
    const todays = plans.get(today);
    const next = plans.get(tomorrow);
    if (!todays || !next) throw new Error('weather plans vanished');
    const { forecast } = map.rules;
    const detail =
      !forecast.detailNeedsVane || (await createWeatherRepo(db).hasVane(map.id, user.id));
    const summary = forecast.summaryForAll
      ? forecastLine(next, dayWindow(tomorrow, map.timeZone).startMs)
      : MESSAGES.vaneOnly;
    return {
      today: todays,
      tomorrow: detail ? next : { summary },
      serverTime: at.toISOString(),
    };
  }

  return {
    view: async (user, mapId) => {
      const map = await requireWeather(user, mapId);
      return viewOf(user, map, now());
    },

    sweep: async (mapId) => {
      const at = now();
      const map = await weatherMap(db, mapId);
      if (!map) return 0;
      // Today's and tomorrow's plans exist for every reader, kept or not.
      const today = localDate(at, map.timeZone);
      await storeDays(db, map, [today, addDays(today, 1)], at);
      let knocked = 0;
      for (const userId of await createWeatherRepo(db).buildingOwners(mapId)) {
        await storeWeatherFor(db, map, userId, at);
        // One player at a time, in the settle's order (tech spec §7): the
        // member row (step 2, so it takes turns with their settle), their
        // upkeep buildings (step 8, id order), then `maps`.
        knocked += await createWeatherRepo(db).transaction(async (tx) => {
          if (!(await createMapsRepo(tx).lockMember(mapId, userId))) return 0;
          const rows = await createBuildingsRepo(tx).lockUpkeepBuildings(mapId, userId);
          const weather = await resolveWeather(tx, map, rows, at);
          for (const event of weather.events) await appendGameEvent(tx, event);
          return weather.knocked.length;
        });
      }
      if (knocked > 0) published(mapId);
      return knocked;
    },

    wildMaps: () => createWeatherRepo(db).wildMaps(),

    retain: async () => {
      // Wild Isle's retention, counted back from today in UTC with a day's
      // slack for zones either side of it.
      const kept = new Date(now().getTime() - (WEATHER_RULES.retentionDays + 1) * DAY_MS);
      return createWeatherRepo(db).deleteBefore(localDate(kept, 'UTC'));
    },

    devWeather: async (user, mapId, request) => {
      const map = await requireWeather(user, mapId);
      const at = now();
      const start = request.at ? new Date(request.at) : at;
      const seed = heartSeedOf(await createWeatherRepo(db).homeTiles(mapId, user.id));
      if (!seed) throw new AppError('CONFLICT', MESSAGES.noHome);
      const day = localDate(start, map.timeZone);
      await createWeatherRepo(db).putDay(
        mapId,
        {
          day,
          kind: request.kind,
          fronts: [
            {
              id: `${day}-dev`,
              kind: request.kind,
              from: seed,
              to: seed,
              startAt: start.toISOString(),
              // Never past the day's end, like every planned front.
              endAt: new Date(
                Math.min(
                  start.getTime() + request.hours * 60 * 60 * 1000,
                  dayWindow(day, map.timeZone).endMs,
                ),
              ).toISOString(),
              // Over my whole home and the land around it.
              radius: 3,
            },
          ],
        },
        at,
      );
      published(mapId);
      return viewOf(user, map, at);
    },

    devKnock: async (user, mapId, { buildingId }) => {
      await requireWeather(user, mapId);
      const at = now();
      await createWeatherRepo(db).transaction(async (tx) => {
        // The member row (step 2), my upkeep buildings (step 8), then `maps`.
        if (!(await createMapsRepo(tx).lockMember(mapId, user.id))) {
          throw new AppError('NOT_FOUND', MESSAGES.noBuilding);
        }
        const rows = await createBuildingsRepo(tx).lockUpkeepBuildings(mapId, user.id);
        const row = rows.find((r) => r.id === buildingId);
        if (!row) throw new AppError('NOT_FOUND', MESSAGES.noBuilding);
        if (!knockable(row)) throw new AppError('CONFLICT', MESSAGES.notKnockable);
        await createBuildingsRepo(tx).setWeather(row.id, {
          damagedAt: at,
          damagedBy: 'dev',
          weatherCheckedThrough: at,
        });
        await appendGameEvent(tx, {
          mapId,
          type: 'building.knocked',
          actorUserId: user.id,
          payload: {
            userId: user.id,
            buildingRowId: row.id,
            buildingId: row.buildingId,
            q: row.q,
            r: row.r,
            frontId: 'dev',
            at: at.toISOString(),
          },
        });
      });
      published(mapId);
    },
  };
}

/** My knocked buildings for the morning card (`HollowStatus.weatherNotes`), or null on a Cozy Patch. */
export async function weatherNotes(
  db: Executor,
  mapId: string,
  userId: string,
  at: Date,
): Promise<NonNullable<HollowStatus['weatherNotes']> | null> {
  if (!(await weatherMap(db, mapId))) return null;
  const since = new Date(at.getTime() - WEATHER_NOTE_NIGHTS * DAY_MS);
  return (await createWeatherRepo(db).knockedSince(mapId, userId, since)).map((r) => ({
    buildingRowId: r.id,
    buildingId: r.buildingId,
    q: r.q,
    r: r.r,
    at: r.damagedAt.toISOString(),
  }));
}
