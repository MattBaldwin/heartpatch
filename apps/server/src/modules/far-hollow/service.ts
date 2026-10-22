import {
  BATTLE_RULES,
  COMMUNITY_RULES,
  deriveSeed,
  EXPLORE_RULES,
  exploreJoy,
  exploreNeeds,
  farHollowLayout,
  farHollowSeed,
  GAME_DATA,
  GROWTH_RULES,
  HOLLOW_RULES,
  HOME_BASE_RULES,
  hollowedOpenAt,
  isFullyExplored,
  isSearched,
  JOURNEY_RULES,
  journeyFor,
  latestSeasonRun,
  nextSeasonRun,
  placeEchoes,
  Rng,
  searchedCount,
  searchSpots,
  withSearched,
  type ExploreNotable,
  type FarHollowSearchRequest,
  type FarHollowSearchResponse,
  type FarHollowTile,
  type FarHollowTileView,
  type FarHollowView,
  type ItemCounts,
  type PublicUser,
  type SearchSpot,
  type SeasonRun,
  type ToolId,
} from '@heartpatch/shared';
import {
  FAR_HOLLOW_FINDS,
  FAR_HOLLOW_SECRETS,
  LORE_PAGES,
  rollExploreFind,
  withFoundItems,
} from '@heartpatch/shared/server';
import { uuidv7 } from 'uuidv7';
import type { Database, Executor } from '../../db/client.js';
import type { NewGameEvent } from '../../db/game-events.js';
import { AppError } from '../../lib/errors.js';
import { newSeed } from '../../lib/rng.js';
import { localDate, mapLocalTime, type Clock } from '../../lib/time.js';
import { createBattlesRepo } from '../battles/repo.js';
import { applyXp, growthEvents, type Growth } from '../care/service.js';
import { createInventoryRepo } from '../inventory/repo.js';
import { consumeItems, grantItems, lockGrantRows } from '../inventory/service.js';
import { createLoreRepo } from '../lore/repo.js';
import { requireMember } from '../maps/members.js';
import { grantRekindledPiece, rekindledDrop } from '../wardrobe/rekindled.js';
import {
  createFarHollowRepo,
  farHollowTransaction,
  type FarHollowKey,
  type FarHollowRow,
} from './repo.js';

/*
 * The far Hollow (#306 PR 6, plan Q7, owner decision 7): each kid's own grey
 * village, fresh every season, reached by winning the far road from any
 * trading post (`modules/journeys`). Explore only: its tiles are searched
 * once a spot, for better finds than a patch's grey village (Heartdust 4×,
 * the Rekindled set at 2× the village odds), and searching its last spot
 * brings the joy all back: the season's guaranteed lore page and a gift.
 * The server is the authority (rule 1): the layout comes from the map's
 * secret seed and the season (rule 6), and only progress is stored. A new
 * season is a new seed, so last season's rows stop matching on their own.
 *
 * Lock order (tech spec §7): a search locks the season's rows (step 6, tile
 * order), the team's squishies (10), the bag (11), then `maps`.
 */

// Kid-readable messages (style guide §6).
export const FAR_HOLLOW_MESSAGES = {
  notArrived: 'Take the far road from a trading post first! 🧭',
  night: 'Too spooky after dark! Come back in the morning 🌙',
  noTile: "We couldn't find that spot.",
  noSpot: "We couldn't find that spot.",
  searched: 'You already searched there!',
  needTool: (tool: string) => `You need a ${tool} for that! 🛠️`,
} as const;

const TOOL_NAMES = new Map(EXPLORE_RULES.tools.map((t) => [t.id, t.name]));
const LORE_TITLES = new Map(LORE_PAGES.map((p) => [p.id, p.title]));
const RULES = COMMUNITY_RULES.farHollow;

/** This season's far Hollow on a map, as the server works it out (its seed never leaves). */
export interface FarHollowSeason {
  readonly run: SeasonRun;
  readonly seed: string;
  readonly tiles: readonly FarHollowTile[];
  readonly timeZone: string;
}

/**
 * The season's far Hollow on the map at `at`: the season whose window
 * started last (`latestSeasonRun`), its seed and its layout.
 */
export async function farHollowSeasonAt(
  tx: Executor,
  mapId: string,
  at: Date,
): Promise<FarHollowSeason> {
  const map = await createFarHollowRepo(tx).findMap(mapId);
  if (!map) throw new AppError('NOT_FOUND', FAR_HOLLOW_MESSAGES.noTile);
  const run = latestSeasonRun(GAME_DATA.seasons, localDate(at, map.timeZone));
  if (!run) throw new Error('farHollowSeasonAt: no seasons in the data');
  // A hand-authored map has no seed: derive one, as territory does.
  const mapSeed = map.seed ?? deriveSeed('hand-authored-map', mapId);
  const seed = farHollowSeed(mapSeed, run);
  return { run, seed, tiles: farHollowLayout(seed, RULES), timeZone: map.timeZone };
}

/** The far road's trail (`journeyFor` at the far Hollow's distance). */
export function farRoad(): FarHollowView['road'] {
  const { level, teamSize } = journeyFor(RULES.distance, JOURNEY_RULES, GROWTH_RULES.maxLevel);
  return { distance: RULES.distance, level, teamSize };
}

/** Is it day on the map, so the far Hollow is open (the Hollowed places' hours)? */
export function farHollowOpen(at: Date, timeZone: string): boolean {
  return hollowedOpenAt(mapLocalTime(at, timeZone), { ...HOME_BASE_RULES, ...HOLLOW_RULES });
}

/** A far-Hollow tile's spots, from its season's seed (the same for every visit). */
const spotsOf = (season: FarHollowSeason, tile: FarHollowTile): SearchSpot[] =>
  searchSpots(season.seed, tile, EXPLORE_RULES) ?? [];

/**
 * Every tile of the season's far Hollow searched to its last spot, and when
 * the last was. Counts the season's tiles as the data has them now, so a
 * mid-season data change (a tile more or fewer) never leaves it unfinishable.
 */
function completedAt(
  rows: readonly FarHollowRow[],
  tiles: readonly Pick<FarHollowTile, 'index'>[],
): Date | null {
  let last: Date | null = null;
  for (const tile of tiles) {
    const done = rows.find((r) => r.tileIndex === tile.index)?.completedAt ?? null;
    if (done === null) return null;
    if (!last || done > last) last = done;
  }
  return last;
}

/** Uses left of each tool in a bag (a tool is counted in uses). */
function toolUses(items: ItemCounts): Record<ToolId, number> {
  return {
    shovel: items['shovel'] ?? 0,
    net: items['net'] ?? 0,
    rope: items['rope'] ?? 0,
    lantern: items['lantern'] ?? 0,
  };
}

/** The find worth telling the patch about, as explore tells it. */
function notableOf(items: ItemCounts, lore: string | null, clothing: string | null) {
  const notable: ExploreNotable | null = lore
    ? 'lore'
    : clothing
      ? 'cosmetic'
      : (items[COMMUNITY_RULES.joyResource] ?? 0) > 0
        ? 'heartdust'
        : null;
  return notable;
}

export interface FarHollowServiceOptions {
  db: Database;
  clock?: Clock;
  /** Live sync (`wsHub.publish`) after a commit. */
  publish?: (mapId: string) => Promise<void> | void;
  /** Tests swap the find roll. */
  rng?: () => Rng;
}

export interface FarHollowService {
  /** My far Hollow this season: arrived or not, its tiles and how far along I am. */
  view: (user: PublicUser, mapId: string) => Promise<FarHollowView>;
  /** One of its tiles up close (once I've arrived, by day). */
  tile: (user: PublicUser, mapId: string, index: number) => Promise<FarHollowTileView>;
  /** Search one spot on one of its tiles. */
  search: (
    user: PublicUser,
    mapId: string,
    request: FarHollowSearchRequest,
  ) => Promise<FarHollowSearchResponse>;
  /** Dev and e2e only (`HP_DEV_SQUISHY_GRANTS`): arrive without the far road, every spot but the last searched or none. */
  devArrive: (user: PublicUser, mapId: string, nearlyDone: boolean) => Promise<FarHollowView>;
}

export function createFarHollowService(options: FarHollowServiceOptions): FarHollowService {
  const { db } = options;
  const now = options.clock ?? (() => new Date());
  const rngFor = options.rng ?? (() => Rng.fromSeed(newSeed()));
  const published = (mapId: string) => {
    void Promise.resolve(options.publish?.(mapId)).catch(() => undefined);
  };

  /** The view, from rows already read. */
  const viewOf = (season: FarHollowSeason, rows: readonly FarHollowRow[]): FarHollowView => {
    const byIndex = new Map(rows.map((r) => [r.tileIndex, r]));
    const date = localDate(now(), season.timeZone);
    const next = nextSeasonRun(GAME_DATA.seasons, date);
    const done = completedAt(rows, season.tiles);
    return {
      name: RULES.name,
      season: { id: season.run.id, name: season.run.name },
      arrived: rows.length > 0,
      tiles: season.tiles.map((tile) => {
        const spots = spotsOf(season, tile);
        return {
          index: tile.index,
          q: tile.q,
          r: tile.r,
          terrain: tile.terrain,
          searched: searchedCount(byIndex.get(tile.index)?.searched ?? 0, spots.length),
          total: spots.length,
        };
      }),
      completedAt: done?.toISOString() ?? null,
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
      return viewOf(season, await createFarHollowRepo(db).listRows(key));
    },

    tile: async (user, mapId, index) => {
      await requireMember(db, user, mapId, ['multiplayer']);
      const at = now();
      const { season, key } = await mine(db, user.id, mapId, at);
      const rows = await createFarHollowRepo(db).listRows(key);
      if (rows.length === 0) throw new AppError('FORBIDDEN', FAR_HOLLOW_MESSAGES.notArrived);
      if (!farHollowOpen(at, season.timeZone)) {
        throw new AppError('FORBIDDEN', FAR_HOLLOW_MESSAGES.night);
      }
      const tile = season.tiles.find((t) => t.index === index);
      if (!tile) throw new AppError('NOT_FOUND', FAR_HOLLOW_MESSAGES.noTile);
      const spots = spotsOf(season, tile);
      const mask = rows.find((r) => r.tileIndex === index)?.searched ?? 0;
      const searched = searchedCount(mask, spots.length);
      const items = await createInventoryRepo(db).list({ mapId, userId: user.id });
      return {
        q: tile.q,
        r: tile.r,
        terrain: tile.terrain,
        spots: spots.map((s) => ({ ...s, done: isSearched(mask, s.index) })),
        needs: exploreNeeds(tile.terrain, EXPLORE_RULES),
        progress: { searched, total: spots.length },
        homestead: null,
        tools: toolUses(items),
        // Drawn as a grey village tile: its joy and echoes. Each Keeper's far
        // Hollow is their own, so it goes by its Keeper's id.
        community: {
          id: user.id,
          name: RULES.name,
          joy: exploreJoy({ searched, total: spots.length }),
          echoes: placeEchoes(season.seed, tile, spots, RULES.echoesPerTile),
        },
        farHollow: { index: tile.index, name: RULES.name },
      };
    },

    search: async (user, mapId, request) => {
      const at = now();
      const result = await farHollowTransaction(db, async (repo, tx) => {
        await requireMember(tx, user, mapId, ['multiplayer']);
        const { season, key } = await mine(tx, user.id, mapId, at);
        if (!farHollowOpen(at, season.timeZone)) {
          throw new AppError('FORBIDDEN', FAR_HOLLOW_MESSAGES.night);
        }
        // Step 6: every row of my season's far Hollow, so the last spot is
        // only ever the last once, whichever tile it's on.
        const rows = await repo.lockRows(key);
        if (rows.length === 0) throw new AppError('FORBIDDEN', FAR_HOLLOW_MESSAGES.notArrived);
        const tile = season.tiles.find((t) => t.index === request.tile);
        if (!tile) throw new AppError('NOT_FOUND', FAR_HOLLOW_MESSAGES.noTile);
        // A tile the data added after I arrived gets its row now (an insert takes no lock to order).
        let row = rows.find((r) => r.tileIndex === tile.index);
        if (!row) {
          await repo.arrive(key, season.tiles.length);
          row = { tileIndex: tile.index, searched: 0, completedAt: null };
          rows.push(row);
        }
        const spots = spotsOf(season, tile);
        const spot = spots.find((s) => s.index === request.spot);
        if (!spot) throw new AppError('NOT_FOUND', FAR_HOLLOW_MESSAGES.noSpot);
        if (isSearched(row.searched, spot.index)) {
          throw new AppError('CONFLICT', FAR_HOLLOW_MESSAGES.searched);
        }

        // A friendly word before `consumeItems` would refuse it.
        const owner = { mapId, userId: user.id };
        if (spot.tool !== null) {
          const have = (await createInventoryRepo(tx).list(owner))[spot.tool] ?? 0;
          if (have < 1) {
            throw new AppError(
              'CONFLICT',
              FAR_HOLLOW_MESSAGES.needTool(TOOL_NAMES.get(spot.tool) ?? spot.tool),
            );
          }
        }

        const searched = withSearched(row.searched, spot.index);
        const explored = isFullyExplored(searched, spots.length);
        await repo.setProgress(key, tile.index, {
          searched,
          completedAt: explored ? at : row.completedAt,
        });
        const after = rows.map((r) =>
          r.tileIndex === tile.index ? { ...r, completedAt: explored ? at : r.completedAt } : r,
        );
        // The last spot of the whole far Hollow: the joy is all back.
        const completed =
          explored && completedAt(after, season.tiles) !== null && row.completedAt === null;

        // What it found: the server rolls it (rule 1); a page already found isn't rolled again.
        const foundLore = new Set(
          (await createLoreRepo(tx).listFound(user.id)).map((f) => f.pageId),
        );
        const roll = rollExploreFind(
          FAR_HOLLOW_FINDS,
          { kind: spot.kind, terrain: tile.terrain },
          rngFor(),
          foundLore,
        );
        // The season's guaranteed page, when the last spot didn't find one of its own.
        const lore =
          roll.lore ??
          (completed
            ? (FAR_HOLLOW_SECRETS.lorePages.find((id) => !foundLore.has(id)) ?? null)
            : null);
        const rekindled = await rekindledDrop(
          tx,
          { place: 'far-hollow', userId: user.id, mapId, at },
          { rng: rngFor() },
        );
        const found = withFoundItems(
          completed ? addItems(roll.items, FAR_HOLLOW_SECRETS.completionGift) : roll.items,
          rekindled,
        );

        // Step 10: the team's XP, plain, as exploring gives it (squishies in id order).
        const team = await createBattlesRepo(tx).listTeam(mapId, user.id, BATTLE_RULES.teamSize);
        const growths: Growth[] = [];
        for (const squishyId of team.map((s) => s.id).sort()) {
          const growth = await applyXp(tx, squishyId, EXPLORE_RULES.xpPerSquishy, at, {
            plain: true,
          });
          if (growth) growths.push(growth);
        }

        // Step 11: the bag, every row it spends or grants locked in item order.
        const searchId = uuidv7();
        const wear: ItemCounts = spot.tool ? { [spot.tool]: 1 } : {};
        await lockGrantRows(tx, mapId, [{ userId: user.id, items: { ...wear, ...found } }]);
        if (spot.tool) await consumeItems(tx, owner, wear, 'explore', searchId);
        if (Object.keys(found).length > 0) {
          await grantItems(tx, owner, found, 'explore', searchId);
        }

        // A Rekindled piece appends its own event first; ours stay the last writes.
        const drop = { source: 'explore' as const, refId: searchId, userId: user.id, mapId, at };
        const clothing = await grantRekindledPiece(tx, drop, rekindled);
        const notable = notableOf(found, lore, clothing);
        // An explore search like any other, placed on the patch at the post
        // the far road set off from: the lore pages and the Seeker track count it.
        const post = (await repo.roadPost(mapId, user.id)) ?? { q: 0, r: 0 };
        const events: NewGameEvent[] = [
          {
            mapId,
            type: 'explore.searched',
            actorUserId: user.id,
            payload: {
              userId: user.id,
              q: post.q,
              r: post.r,
              terrain: tile.terrain,
              searchId,
              spot: spot.index,
              kind: spot.kind,
              tool: spot.tool,
              items: found,
              lorePage: lore,
              notable,
            },
          },
          ...(completed
            ? [
                {
                  mapId,
                  type: 'journey.completed' as const,
                  actorUserId: user.id,
                  payload: {
                    userId: user.id,
                    season: season.run.id,
                    year: season.run.year,
                    lorePage: lore,
                  },
                },
              ]
            : []),
          ...growthEvents(growths),
        ];
        for (const event of events) await repo.appendEvent(event);

        const items = await createInventoryRepo(tx).list(owner);
        const progress = { searched: searchedCount(searched, spots.length), total: spots.length };
        return {
          spot: spot.index,
          found,
          lore: lore ? { id: lore, title: LORE_TITLES.get(lore) ?? '' } : null,
          clothing,
          notable,
          xp: growths.map((g) => ({ squishyId: g.squishyId, xp: g.xp })),
          tool: spot.tool ? { id: spot.tool, usesLeft: items[spot.tool] ?? 0 } : null,
          progress,
          explored,
          homestead: null,
          items,
          joy: exploreJoy(progress),
          completed,
        } satisfies FarHollowSearchResponse;
      });
      published(mapId);
      return result;
    },

    devArrive: async (user, mapId, nearlyDone) => {
      const at = now();
      const result = await farHollowTransaction(db, async (repo, tx) => {
        await requireMember(tx, user, mapId, ['multiplayer']);
        const { season, key } = await mine(tx, user.id, mapId, at);
        await repo.arrive(key, season.tiles.length);
        const last = season.tiles.at(-1);
        for (const tile of season.tiles) {
          const spots = spotsOf(season, tile);
          // Nearly done: every spot searched but the far Hollow's very last one.
          const keep = nearlyDone ? spots.length - (tile === last ? 1 : 0) : 0;
          const searched = spots.slice(0, keep).reduce((m, s) => withSearched(m, s.index), 0);
          const done = isFullyExplored(searched, spots.length);
          await repo.setProgress(key, tile.index, { searched, completedAt: done ? at : null });
        }
        return viewOf(season, await repo.listRows(key));
      });
      published(mapId);
      return result;
    },
  };
}

/** Two piles of items added up. */
function addItems(a: ItemCounts, b: Readonly<Record<string, number>>): ItemCounts {
  const sum: Record<string, number> = { ...a };
  for (const [id, n] of Object.entries(b)) sum[id] = (sum[id] ?? 0) + n;
  return sum;
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
  if (!(await createFarHollowRepo(tx).arrive(key, season.tiles.length))) return [];
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
