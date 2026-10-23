import {
  COMMUNITY_RULES,
  deriveSeed,
  farHollowSeed,
  GAME_DATA,
  GROWTH_RULES,
  HOLLOW_RULES,
  HOME_BASE_RULES,
  hollowedOpenAt,
  JOURNEY_RULES,
  journeyFor,
  latestSeasonRun,
  nextSeasonRun,
  type FarHollowView,
  type PublicUser,
  type SeasonRun,
} from '@heartpatch/shared';
import type { Database, Executor } from '../../db/client.js';
import type { NewGameEvent } from '../../db/game-events.js';
import { AppError } from '../../lib/errors.js';
import { localDate, mapLocalTime, type Clock } from '../../lib/time.js';
import { requireMember } from '../maps/members.js';
import {
  createFarHollowRepo,
  farHollowTransaction,
  type FarHollowKey,
  type FarHollowStateRow,
} from './repo.js';

/*
 * The far Hollow (#306 PR 6, plan Q7, owner decision 7): each kid's own
 * place, fresh every season, reached by winning the far road from any
 * trading post (`modules/journeys`). Halloween 2026's is the Crooked House:
 * #306 6b adds its rooms and commands on this state row. The server is the
 * authority (rule 1): what hides where comes from the map's secret seed and
 * the season (rule 6), and only progress is stored. A new season is a new
 * seed, so last season's rows stop matching on their own.
 */

// Kid-readable messages (style guide §6).
export const FAR_HOLLOW_MESSAGES = {
  notArrived: 'Take the far road from a trading post first! 🧭',
  night: 'Too spooky after dark! Come back in the morning 🌙',
  noMap: "We couldn't find that patch.",
} as const;

const RULES = COMMUNITY_RULES.farHollow;

/** This season's far Hollow on a map, as the server works it out (its seed never leaves). */
export interface FarHollowSeason {
  readonly run: SeasonRun;
  readonly seed: string;
  readonly timeZone: string;
}

/**
 * The season's far Hollow on the map at `at`: the season whose window
 * started last (`latestSeasonRun`) and its seed.
 */
export async function farHollowSeasonAt(
  tx: Executor,
  mapId: string,
  at: Date,
): Promise<FarHollowSeason> {
  const map = await createFarHollowRepo(tx).findMap(mapId);
  if (!map) throw new AppError('NOT_FOUND', FAR_HOLLOW_MESSAGES.noMap);
  const run = latestSeasonRun(GAME_DATA.seasons, localDate(at, map.timeZone));
  if (!run) throw new Error('farHollowSeasonAt: no seasons in the data');
  // A hand-authored map has no seed: derive one, as territory does.
  const mapSeed = map.seed ?? deriveSeed('hand-authored-map', mapId);
  return { run, seed: farHollowSeed(mapSeed, run), timeZone: map.timeZone };
}

/** The far road's trail (`journeyFor` at the far Hollow's distance). */
export function farRoad(): FarHollowView['road'] {
  const { level, teamSize } = journeyFor(RULES.distance, JOURNEY_RULES, GROWTH_RULES.maxLevel);
  return { distance: RULES.distance, level, teamSize };
}

/** Is it day on the map, so the far road is open (the Hollowed places' hours)? */
export function farHollowOpen(at: Date, timeZone: string): boolean {
  return hollowedOpenAt(mapLocalTime(at, timeZone), { ...HOME_BASE_RULES, ...HOLLOW_RULES });
}

export interface FarHollowServiceOptions {
  db: Database;
  clock?: Clock;
  /** Live sync (`wsHub.publish`) after a commit. */
  publish?: (mapId: string) => Promise<void> | void;
}

export interface FarHollowService {
  /** My far Hollow this season: arrived or not, and whether I've brought it all back. */
  view: (user: PublicUser, mapId: string) => Promise<FarHollowView>;
  /** Dev and e2e only (`HP_DEV_SQUISHY_GRANTS`): arrive without the far road. */
  devArrive: (user: PublicUser, mapId: string) => Promise<FarHollowView>;
}

export function createFarHollowService(options: FarHollowServiceOptions): FarHollowService {
  const { db } = options;
  const now = options.clock ?? (() => new Date());
  const published = (mapId: string) => {
    void Promise.resolve(options.publish?.(mapId)).catch(() => undefined);
  };

  /** The view, from the state row already read. */
  const viewOf = (season: FarHollowSeason, state: FarHollowStateRow | null): FarHollowView => {
    const next = nextSeasonRun(GAME_DATA.seasons, localDate(now(), season.timeZone));
    return {
      name: RULES.name,
      season: { id: season.run.id, name: season.run.name },
      arrived: state !== null,
      completedAt: state?.completedAt?.toISOString() ?? null,
      nextSeason: next ? { id: next.id, name: next.name, startsOn: next.startsOn } : null,
      road: farRoad(),
    };
  };

  /** This season's far Hollow and the key of my rows in it. */
  const mine = async (tx: Executor, userId: string, mapId: string, at: Date) => {
    const season = await farHollowSeasonAt(tx, mapId, at);
    const key: FarHollowKey = { userId, mapId, seasonSeed: season.seed };
    return { season, key };
  };

  return {
    view: async (user, mapId) => {
      await requireMember(db, user, mapId, ['multiplayer']);
      const { season, key } = await mine(db, user.id, mapId, now());
      return viewOf(season, await createFarHollowRepo(db).findState(key));
    },

    devArrive: async (user, mapId) => {
      const at = now();
      const result = await farHollowTransaction(db, async (repo, tx) => {
        await requireMember(tx, user, mapId, ['multiplayer']);
        const { season, key } = await mine(tx, user.id, mapId, at);
        await repo.arrive(key, at);
        return viewOf(season, await repo.findState(key));
      });
      published(mapId);
      return result;
    },
  };
}

/**
 * The far road's finish (`modules/journeys`, tech spec §7 step 5b, after the
 * battle and its `journeys` row): a win is an arrival in this season's far
 * Hollow. Returns its event, or none when I'd already arrived this season.
 */
export async function arriveInFarHollow(
  tx: Executor,
  input: { mapId: string; userId: string; journeyId: string; at: Date },
): Promise<NewGameEvent[]> {
  const season = await farHollowSeasonAt(tx, input.mapId, input.at);
  const key = { userId: input.userId, mapId: input.mapId, seasonSeed: season.seed };
  if (!(await createFarHollowRepo(tx).arrive(key, input.at))) return [];
  return [
    {
      mapId: input.mapId,
      type: 'journey.arrived',
      actorUserId: input.userId,
      payload: {
        userId: input.userId,
        journeyId: input.journeyId,
        season: season.run.id,
        year: season.run.year,
      },
    },
  ];
}
