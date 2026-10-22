import {
  BATTLE_RULES,
  COMMUNITY_RULES,
  communityReach,
  deriveSeed,
  EXPLORE_RULES,
  exploreJoy,
  exploreLayout,
  GAME_DATA,
  HOLLOW_RULES,
  HOME_BASE_RULES,
  hollowedOpenAt,
  exploreNeeds,
  isExplorable,
  isFullyExplored,
  isSearched,
  memoryPuzzle,
  MEMORY_PUZZLES,
  placeEchoes,
  puzzleSolvedBy,
  Rng,
  searchedCount,
  searchSpots,
  withSearched,
  type DevHomesteadRequest,
  type ExploreNotable,
  type Hex,
  type HollowedExplore,
  type HollowedPuzzle,
  type ExploreTileResponse,
  type ItemCounts,
  type PublicUser,
  type SearchSpot,
  type SearchSpotRequest,
  type SearchSpotResponse,
  type SolvePuzzleRequest,
  type SolvePuzzleResponse,
  type ToolId,
} from '@heartpatch/shared';
import {
  EXPLORE_FINDS,
  HOLLOWED_FINDS,
  LORE_PAGES,
  PUZZLE_REWARDS,
  rollExploreFind,
  rollPuzzleReward,
} from '@heartpatch/shared/server';
import { uuidv7 } from 'uuidv7';
import type { Database, Executor } from '../../db/client.js';
import type { NewGameEvent } from '../../db/game-events.js';
import { AppError } from '../../lib/errors.js';
import { newSeed } from '../../lib/rng.js';
import { latestLocalMinute, mapLocalTime, type Clock } from '../../lib/time.js';
import { createBattlesRepo } from '../battles/repo.js';
import { applyXp, growthEvents, type Growth } from '../care/service.js';
import { createInventoryRepo } from '../inventory/repo.js';
import { consumeItems, grantItems, lockGrantRows } from '../inventory/service.js';
import { createLoreRepo } from '../lore/repo.js';
import { requireMember } from '../maps/members.js';
import { createTerritoryRepo } from '../territory/repo.js';
import { rollFoundDrop } from '../wardrobe/drops.js';
import { homesteadOf, refreshHomesteads } from './homesteads.js';
import {
  createExploreRepo,
  exploreTransaction,
  type ExploreRepo,
  type ExploreRow,
  type ExploreTileRow,
  type ExploreVillage,
} from './repo.js';

/*
 * Exploring your land (#199, owner design 2026-10-07): zoom into a tile you
 * own and search its spots with your Keeper and crafted tools. The server is
 * the authority (CLAUDE.md rule 1): it owns where the spots are (from the
 * secret map seed), which are done, what each one gives (secret tables, rule
 * 6) and the tool wear. A search is one transaction (rule 7): the tile, the
 * player's row for it, homesteads when it finishes the tile, the team's XP,
 * the bag, found clothing, then the events.
 */

// Kid-readable messages (style guide §6).
const MESSAGES = {
  noTile: "We couldn't find that spot.",
  notYours: 'You can only explore your own land.',
  cantExplore: "There's nothing to search here yet!",
  noSpot: "We couldn't find that spot.",
  searched: 'You already searched there!',
  needTool: (tool: string) => `You need a ${tool} for that! 🛠️`,
  // A grey village tile (#306 2a), the panel's own words.
  villageAway: 'Claim land next to it to explore!',
  villageNight: 'Too spooky after dark! Come back in the morning 🌙',
  // Memory puzzles (#306 PR 2b).
  noPuzzle: "There's nothing to fix here!",
  puzzleFixed: 'You already fixed this one! ✨',
  puzzleWrong: 'Not quite! Watch it once more and try again.',
} as const;

const TOOL_NAMES = new Map(EXPLORE_RULES.tools.map((t) => [t.id, t.name]));
const LORE_TITLES = new Map(LORE_PAGES.map((p) => [p.id, p.title]));

/**
 * Rekindled recipe pages a memory puzzle can give (#306 PR 5 plugs this in;
 * until then puzzles give lore pages and the fallback). Both run inside the
 * solve's transaction, after the bag (tech spec §7 step 11) and before the
 * events.
 */
export interface RekindledRecipes {
  /** The Rekindled recipe pages still sealed for this player on this patch, by id and title. */
  sealed: (
    tx: Executor,
    owner: { mapId: string; userId: string },
  ) => Promise<{ id: string; title: string }[]>;
  /** Opens one of them for the player (`refId`: the solve). */
  grant: (
    tx: Executor,
    owner: { mapId: string; userId: string },
    pageId: string,
    refId: string,
  ) => Promise<void>;
}

export interface ExploreServiceOptions {
  db: Database;
  /** Rekindled recipe pages for memory puzzles (#306 PR 5); none until it lands. */
  rekindled?: RekindledRecipes;
  clock?: Clock;
  /** Live sync (`wsHub.publish`) after a commit. */
  publish?: (mapId: string) => Promise<void> | void;
  /** Tests swap the find roll. */
  rng?: () => Rng;
}

/** The seed a map's spots come from (server-only; a hand-authored map has none: derive one, as territory does). */
async function seedOf(tx: Executor, mapId: string): Promise<string> {
  return (await createTerritoryRepo(tx).mapSeed(mapId)) ?? deriveSeed('hand-authored-map', mapId);
}

/** A grey village tile as one visit sees it: the village, and when this morning's spots began. */
interface Grey {
  readonly village: ExploreVillage;
  readonly morning: Date;
}

/**
 * The grey village a wild tile belongs to, if I may explore it now (#306
 * 2a): my land touches the village and it's day on the map. Null on any
 * other tile (mine, or someone's land, which the owner check refuses).
 */
async function greyVillage(
  repo: ExploreRepo,
  mapId: string,
  tile: ExploreTileRow | null,
  userId: string,
  at: Date,
): Promise<Grey | null> {
  if (!tile?.communityId || tile.ownerUserId !== null) return null;
  const village = await repo.findVillage(tile.id);
  if (!village) return null;
  const { reach } = communityReach(village.tiles, await repo.listTiles(mapId), userId);
  if (reach !== 'touching') throw new AppError('FORBIDDEN', MESSAGES.villageAway);
  const zone = await repo.mapTimeZone(mapId);
  const rules = { ...HOME_BASE_RULES, ...HOLLOW_RULES };
  if (!hollowedOpenAt(mapLocalTime(at, zone), rules)) {
    throw new AppError('FORBIDDEN', MESSAGES.villageNight);
  }
  return { village, morning: latestLocalMinute(at, zone, HOLLOW_RULES.morningMinute) };
}

/** My tile (or a grey village tile I may explore) and its spots, or a kid-readable error. */
function tileSpots(
  seed: string,
  tile: ExploreTileRow | null,
  userId: string,
  grey: Grey | null,
): { tile: ExploreTileRow; spots: SearchSpot[] } {
  if (!tile) throw new AppError('NOT_FOUND', MESSAGES.noTile);
  if (!grey && tile.ownerUserId !== userId) throw new AppError('FORBIDDEN', MESSAGES.notYours);
  if (!isExplorable(tile.terrain, EXPLORE_RULES)) {
    throw new AppError('CONFLICT', MESSAGES.cantExplore);
  }
  const spots = searchSpots(seed, tile, EXPLORE_RULES) ?? [];
  if (spots.length === 0) throw new AppError('CONFLICT', MESSAGES.cantExplore);
  return { tile, spots };
}

/**
 * A row's progress, counted against its terrain's layout today
 * (`exploreLayout`). A row made on another terrain (a converted tile) starts
 * fresh. One made under an older layout of the same terrain (a new kit,
 * #335) starts fresh while half-searched, but a finished one stays finished,
 * so a new kit never takes a homestead away (owner decision 2026-10-09).
 */
function searchedMask(
  row: ExploreRow | null,
  tile: ExploreTileRow,
  spots: readonly SearchSpot[],
): number {
  if (!row || row.terrain !== tile.terrain) return 0;
  if (row.layout === exploreLayout(tile.terrain, EXPLORE_RULES)) return row.searched;
  // Finished: every spot of today's kit is done. The row's stored `searched`
  // and `spot_count` stay the old kit's on purpose; it's never written again.
  return row.completedAt ? spots.reduce((mask, s) => withSearched(mask, s.index), 0) : 0;
}

/**
 * A grey village tile's progress (#306 2a): only today's searches count
 * (its spots refill each morning), on today's layout.
 */
function greyMask(row: ExploreRow | null, tile: ExploreTileRow, grey: Grey): number {
  if (!row || row.terrain !== tile.terrain) return 0;
  if (row.layout !== exploreLayout(tile.terrain, EXPLORE_RULES)) return 0;
  return row.updatedAt.getTime() >= grey.morning.getTime() ? row.searched : 0;
}

/** A grey village tile's echoes, from the village's secret seed. */
function echoesOf(grey: Grey, tile: Hex, spots: readonly SearchSpot[]) {
  return placeEchoes(grey.village.seed, tile, spots, COMMUNITY_RULES.echoesPerTile);
}

/** A grey village tile's memory puzzle (PR 2b) as I see it. */
function puzzleView(
  grey: Grey,
  tile: ExploreTileRow,
  spots: readonly SearchSpot[],
  solvedBy: readonly string[],
  userId: string,
): HollowedPuzzle {
  const puzzle = memoryPuzzle(
    grey.village.seed,
    tile,
    spots,
    echoesOf(grey, tile, spots),
    MEMORY_PUZZLES,
  );
  return { ...puzzle, order: [...puzzle.order], solved: solvedBy.includes(userId) };
}

/** A grey village tile's explore extras: its name, today's joy, its echoes and its puzzle. */
function greyView(
  grey: Grey,
  tile: ExploreTileRow,
  spots: readonly SearchSpot[],
  searched: number,
  userId: string,
): HollowedExplore {
  return {
    id: grey.village.id,
    name: grey.village.name,
    joy: exploreJoy({ searched, total: spots.length }),
    echoes: echoesOf(grey, tile, spots),
    puzzle: puzzleView(grey, tile, spots, grey.village.puzzleSolvedBy, userId),
  };
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

/** The find worth telling the patch about, if any (never which items or how many). */
function notableOf(items: ItemCounts, lore: string | null, clothing: string | null) {
  const notable: ExploreNotable | null = lore
    ? 'lore'
    : clothing
      ? 'cosmetic'
      : (items['heartdust'] ?? 0) > 0
        ? 'heartdust'
        : null;
  return notable;
}

export function createExploreService(options: ExploreServiceOptions) {
  const now = options.clock ?? (() => new Date());
  const rngFor = options.rng ?? (() => Rng.fromSeed(newSeed()));
  const published = (mapId: string) => {
    void options.publish?.(mapId);
  };

  return {
    /** Dev only (`HP_DEV_SQUISHY_GRANTS`): a ready homestead next to home (#295, e2e). */
    devHomestead: async (
      user: PublicUser,
      mapId: string,
      ask: DevHomesteadRequest = {},
    ): Promise<{ q: number; r: number }> => {
      if (ask.terrain !== undefined && !GAME_DATA.terrains.some((t) => t.id === ask.terrain)) {
        throw new AppError('BAD_REQUEST', `No terrain "${ask.terrain}".`);
      }
      if (
        ask.nodeResource !== undefined &&
        !GAME_DATA.resources.some((r) => r.id === ask.nodeResource)
      ) {
        throw new AppError('BAD_REQUEST', `No resource "${ask.nodeResource}".`);
      }
      const made = await exploreTransaction(options.db, async (repo, tx) => {
        await requireMember(tx, user, mapId, ['multiplayer']);
        return repo.devMakeHomestead(mapId, user.id, now(), await seedOf(tx, mapId), ask);
      });
      if (!made) throw new AppError('CONFLICT', MESSAGES.noTile);
      published(mapId);
      return made;
    },

    /** Dev only (`HP_DEV_SQUISHY_GRANTS`): my land reaches my nearest grey village (#306 2a, e2e). */
    devHollowedReach: async (
      user: PublicUser,
      mapId: string,
    ): Promise<{ q: number; r: number }> => {
      const square = await exploreTransaction(options.db, async (repo, tx) => {
        await requireMember(tx, user, mapId, ['multiplayer']);
        return repo.devHollowedReach(mapId, user.id);
      });
      if (!square) throw new AppError('CONFLICT', MESSAGES.noTile);
      published(mapId);
      return square;
    },

    /** `GET /maps/:mapId/explore?q=&r=`: the explore view of one of my tiles (or a grey village tile). */
    view: async (
      user: PublicUser,
      mapId: string,
      at: { q: number; r: number },
    ): Promise<ExploreTileResponse> => {
      const db = options.db;
      await requireMember(db, user, mapId, ['multiplayer']);
      const repo = createExploreRepo(db);
      const found = await repo.findTileAt(mapId, at.q, at.r);
      const grey = await greyVillage(repo, mapId, found, user.id, now());
      const { tile, spots } = tileSpots(await seedOf(db, mapId), found, user.id, grey);
      const row = await repo.findRow(user.id, tile.id);
      const mask = grey ? greyMask(row, tile, grey) : searchedMask(row, tile, spots);
      const items = await createInventoryRepo(db).list({ mapId, userId: user.id });
      const searched = searchedCount(mask, spots.length);
      return {
        q: tile.q,
        r: tile.r,
        terrain: tile.terrain,
        spots: spots.map((s) => ({ ...s, done: isSearched(mask, s.index) })),
        needs: exploreNeeds(tile.terrain, EXPLORE_RULES),
        progress: { searched, total: spots.length },
        homestead: grey ? null : homesteadOf(row),
        tools: toolUses(items),
        ...(grey ? { community: greyView(grey, tile, spots, searched, user.id) } : {}),
      };
    },

    /** `POST /maps/:mapId/explore/search`: search one spot on one of my tiles. */
    search: async (
      user: PublicUser,
      mapId: string,
      request: SearchSpotRequest,
    ): Promise<SearchSpotResponse> => {
      const at = now();
      const result = await exploreTransaction(options.db, async (repo, tx) => {
        await requireMember(tx, user, mapId, ['multiplayer']);
        const seed = await seedOf(tx, mapId);
        // Step 6: the tile, so its owner can't change mid-search. A grey
        // village's own rows are only read: restoring (PR 3) locks the tile first.
        const locked = await repo.lockTileAt(mapId, request.q, request.r);
        const grey = await greyVillage(repo, mapId, locked, user.id, at);
        const { tile, spots } = tileSpots(seed, locked, user.id, grey);
        const spot = spots.find((s) => s.index === request.spot);
        if (!spot) throw new AppError('NOT_FOUND', MESSAGES.noSpot);

        // A stale row still marked explored (a converted tile) is one of the
        // player's explored rows, which a capture or a finished tile may be
        // locking in order: take that whole set first, in `(user_id,
        // tile_id)` order, so the refresh below can't invert it. (A finished
        // row under an older layout of the same terrain stays finished.)
        const seen = await repo.findRow(user.id, tile.id);
        const maskOf = (r: ExploreRow) =>
          grey ? greyMask(r, tile, grey) : searchedMask(r, tile, spots);
        if (seen?.completedAt && maskOf(seen) === 0) {
          await repo.lockExplored(mapId, [user.id]);
        }
        // Then the player's row for it.
        const row =
          (await repo.lockRow(user.id, tile.id)) ??
          (await repo.insertRow({
            userId: user.id,
            tileId: tile.id,
            mapId,
            layout: exploreLayout(tile.terrain, EXPLORE_RULES),
            terrain: tile.terrain,
            spotCount: spots.length,
            at,
          }));
        const before = maskOf(row);
        if (isSearched(before, spot.index)) throw new AppError('CONFLICT', MESSAGES.searched);

        // A friendly word before `consumeItems` would refuse it.
        const owner = { mapId, userId: user.id };
        if (spot.tool !== null) {
          const have = (await createInventoryRepo(tx).list(owner))[spot.tool] ?? 0;
          if (have < 1) {
            throw new AppError(
              'CONFLICT',
              MESSAGES.needTool(TOOL_NAMES.get(spot.tool) ?? spot.tool),
            );
          }
        }

        const searched = withSearched(before, spot.index);
        // A grey village tile never finishes: its spots refill each morning,
        // and it isn't my land to join home (#306 2a).
        const explored = !grey && isFullyExplored(searched, spots.length);
        const fresh = before === 0 && row.searched !== 0;
        // Only a finished row is a homestead (`tile_explore_homestead_after_explored`):
        // one that isn't finished after this search drops its homestead
        // columns, so a row that's somehow joined but short of spots ends up
        // half-searched, not a 500 (#511). On a grey tile only an old
        // finished row (from before it was a village) has any to drop.
        const unjoin = grey
          ? row.completedAt !== null || row.joinedAt !== null
          : fresh || (!explored && row.joinedAt !== null);
        await repo.updateProgress(
          user.id,
          tile.id,
          {
            layout: exploreLayout(tile.terrain, EXPLORE_RULES),
            terrain: tile.terrain,
            searched,
            spotCount: spots.length,
            completedAt: explored ? at : null,
            // A row restarted on a new terrain or layout isn't explored, so it isn't a homestead.
            ...(unjoin ? { joinedAt: null, pausedAt: null, resumedAt: null } : {}),
          },
          at,
        );
        // Still with the explore rows (before squishies and the bag): a
        // finished tile may join home, and may join land beyond it too.
        // A row restarted under a new layout may have been a homestead: the
        // land joined through it is worked out again too.
        const homesteadEvents =
          explored || unjoin ? await refreshHomesteads(tx, mapId, [user.id], at) : [];

        // What it found: the server rolls it (rule 1); a page already found isn't rolled again.
        const foundLore = new Set(
          (await createLoreRepo(tx).listFound(user.id)).map((f) => f.pageId),
        );
        const roll = rollExploreFind(
          grey ? HOLLOWED_FINDS : EXPLORE_FINDS,
          { kind: spot.kind, terrain: tile.terrain },
          rngFor(),
          foundLore,
        );

        // Step 10: the team's XP, plain, like Training Grounds (squishies in id order).
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
        await lockGrantRows(tx, mapId, [{ userId: user.id, items: { ...wear, ...roll.items } }]);
        if (spot.tool) await consumeItems(tx, owner, wear, 'explore', searchId);
        if (Object.keys(roll.items).length > 0) {
          await grantItems(tx, owner, roll.items, 'explore', searchId);
        }

        // Found clothing appends its own event first; ours stay the last writes.
        const clothing = await rollFoundDrop(tx, {
          source: 'explore',
          refId: searchId,
          userId: user.id,
          mapId,
          tileId: tile.id,
          at,
        });
        const notable = notableOf(roll.items, roll.lore, clothing);
        const coords = { q: tile.q, r: tile.r };
        const events: NewGameEvent[] = [
          {
            mapId,
            type: 'explore.searched',
            actorUserId: user.id,
            payload: {
              userId: user.id,
              ...coords,
              terrain: tile.terrain,
              searchId,
              spot: spot.index,
              kind: spot.kind,
              tool: spot.tool,
              items: roll.items,
              lorePage: roll.lore,
              notable,
            },
          },
          ...(explored
            ? [
                {
                  mapId,
                  type: 'tile.explored' as const,
                  actorUserId: user.id,
                  payload: { userId: user.id, ...coords, terrain: tile.terrain },
                },
              ]
            : []),
          ...homesteadEvents,
          ...growthEvents(growths),
        ];
        for (const event of events) await repo.appendEvent(event);

        const items = await createInventoryRepo(tx).list(owner);
        const homestead = grey ? null : homesteadOf(await repo.findRow(user.id, tile.id));
        const progress = { searched: searchedCount(searched, spots.length), total: spots.length };
        return {
          spot: spot.index,
          found: roll.items,
          lore: roll.lore ? { id: roll.lore, title: LORE_TITLES.get(roll.lore) ?? '' } : null,
          clothing,
          notable,
          xp: growths.map((g) => ({ squishyId: g.squishyId, xp: g.xp })),
          tool: spot.tool ? { id: spot.tool, usesLeft: items[spot.tool] ?? 0 } : null,
          progress,
          explored,
          homestead,
          items,
          ...(grey ? { joy: exploreJoy(progress) } : {}),
        } satisfies SearchSpotResponse;
      });
      published(mapId);
      return result;
    },

    /**
     * `POST /maps/:mapId/explore/puzzle`: put a grey village tile's broken
     * thing back together (#306 PR 2b). Once a tile each; the server checks
     * the order against the tile's own and rolls what it gives (rule 1).
     */
    solvePuzzle: async (
      user: PublicUser,
      mapId: string,
      request: SolvePuzzleRequest,
    ): Promise<SolvePuzzleResponse> => {
      const at = now();
      const result = await exploreTransaction(options.db, async (repo, tx) => {
        await requireMember(tx, user, mapId, ['multiplayer']);
        const seed = await seedOf(tx, mapId);
        // Step 6: the tile, so its owner can't change mid-solve (restoring
        // takes it first too), then its village row below.
        const locked = await repo.lockTileAt(mapId, request.q, request.r);
        if (!locked) throw new AppError('NOT_FOUND', MESSAGES.noTile);
        const grey = await greyVillage(repo, mapId, locked, user.id, at);
        if (!grey) throw new AppError('CONFLICT', MESSAGES.noPuzzle);
        const { tile, spots } = tileSpots(seed, locked, user.id, grey);
        const solvedBy = await repo.lockPuzzle(tile.id);
        if (solvedBy === null) throw new AppError('CONFLICT', MESSAGES.noPuzzle);
        const puzzle = puzzleView(grey, tile, spots, solvedBy, user.id);
        if (puzzle.solved) throw new AppError('CONFLICT', MESSAGES.puzzleFixed);
        if (!puzzleSolvedBy(puzzle, request.order)) {
          throw new AppError('CONFLICT', MESSAGES.puzzleWrong);
        }
        await repo.setPuzzleSolvedBy(tile.id, [...solvedBy, user.id]);

        // What it gives: a page not found yet, else a small thank-you (rule 1, rule 6).
        const owner = { mapId, userId: user.id };
        // Found, or given by a solve the lore consumer hasn't recorded yet.
        const foundLore = new Set([
          ...(await createLoreRepo(tx).listFound(user.id)).map((f) => f.pageId),
          ...(await repo.listPuzzledPages(mapId, user.id)),
        ]);
        const recipes = (await options.rekindled?.sealed(tx, owner)) ?? [];
        const reward = rollPuzzleReward(
          PUZZLE_REWARDS,
          { foundLore, recipes: recipes.map((r) => r.id) },
          rngFor(),
        );
        const found = reward.kind === 'items' ? { ...reward.items } : {};
        const lorePage = reward.kind === 'lore' ? reward.id : null;
        const recipe = reward.kind === 'recipe' ? reward.id : null;

        // Step 11: the bag.
        const solveId = uuidv7();
        if (Object.keys(found).length > 0) {
          await lockGrantRows(tx, mapId, [{ userId: user.id, items: found }]);
          await grantItems(tx, owner, found, 'explore', solveId);
        }
        if (recipe) await options.rekindled?.grant(tx, owner, recipe, solveId);

        const notable = notableOf(found, lorePage, null);
        await repo.appendEvent({
          mapId,
          type: 'explore.puzzled',
          actorUserId: user.id,
          payload: {
            userId: user.id,
            q: tile.q,
            r: tile.r,
            terrain: tile.terrain,
            communityId: grey.village.id,
            solveId,
            skin: puzzle.skin,
            lorePage,
            recipe,
            items: found,
            notable,
          },
        });

        return {
          puzzle: { ...puzzle, solved: true },
          lore: lorePage ? { id: lorePage, title: LORE_TITLES.get(lorePage) ?? '' } : null,
          recipe: recipe
            ? { id: recipe, title: recipes.find((r) => r.id === recipe)?.title ?? '' }
            : null,
          found,
          items: await createInventoryRepo(tx).list(owner),
        } satisfies SolvePuzzleResponse;
      });
      published(mapId);
      return result;
    },
  };
}

export type ExploreService = ReturnType<typeof createExploreService>;
