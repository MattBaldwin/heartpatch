import {
  BATTLE_RULES,
  deriveSeed,
  EXPLORE_RULES,
  exploreNeeds,
  isExplorable,
  isFullyExplored,
  isSearched,
  Rng,
  searchedCount,
  searchSpots,
  withSearched,
  type ExploreNotable,
  type ExploreTileResponse,
  type ItemCounts,
  type PublicUser,
  type SearchSpot,
  type SearchSpotRequest,
  type SearchSpotResponse,
  type ToolId,
} from '@heartpatch/shared';
import { EXPLORE_FINDS, LORE_PAGES, rollExploreFind } from '@heartpatch/shared/server';
import { uuidv7 } from 'uuidv7';
import type { Database, Executor } from '../../db/client.js';
import type { NewGameEvent } from '../../db/game-events.js';
import { AppError } from '../../lib/errors.js';
import { newSeed } from '../../lib/rng.js';
import type { Clock } from '../../lib/time.js';
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
  type ExploreRow,
  type ExploreTileRow,
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
} as const;

const TOOL_NAMES = new Map(EXPLORE_RULES.tools.map((t) => [t.id, t.name]));
const LORE_TITLES = new Map(LORE_PAGES.map((p) => [p.id, p.title]));

export interface ExploreServiceOptions {
  db: Database;
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

/** My tile and its spots, or a kid-readable error. */
function tileSpots(
  seed: string,
  tile: ExploreTileRow | null,
  userId: string,
): { tile: ExploreTileRow; spots: SearchSpot[] } {
  if (!tile) throw new AppError('NOT_FOUND', MESSAGES.noTile);
  if (tile.ownerUserId !== userId) throw new AppError('FORBIDDEN', MESSAGES.notYours);
  if (!isExplorable(tile.terrain, EXPLORE_RULES)) {
    throw new AppError('CONFLICT', MESSAGES.cantExplore);
  }
  const spots = searchSpots(seed, tile, EXPLORE_RULES) ?? [];
  if (spots.length === 0) throw new AppError('CONFLICT', MESSAGES.cantExplore);
  return { tile, spots };
}

/**
 * A row's progress, counted against today's layout. A row made under another
 * layout or terrain (a tuning bump, a converted tile) starts fresh.
 */
function searchedMask(row: ExploreRow | null, tile: ExploreTileRow): number {
  if (!row || row.layout !== EXPLORE_RULES.layout || row.terrain !== tile.terrain) return 0;
  return row.searched;
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
    /** `GET /maps/:mapId/explore?q=&r=`: the explore view of one of my tiles. */
    view: async (
      user: PublicUser,
      mapId: string,
      at: { q: number; r: number },
    ): Promise<ExploreTileResponse> => {
      const db = options.db;
      await requireMember(db, user, mapId, ['multiplayer']);
      const repo = createExploreRepo(db);
      const { tile, spots } = tileSpots(
        await seedOf(db, mapId),
        await repo.findTileAt(mapId, at.q, at.r),
        user.id,
      );
      const row = await repo.findRow(user.id, tile.id);
      const mask = searchedMask(row, tile);
      const items = await createInventoryRepo(db).list({ mapId, userId: user.id });
      return {
        q: tile.q,
        r: tile.r,
        terrain: tile.terrain,
        spots: spots.map((s) => ({ ...s, done: isSearched(mask, s.index) })),
        needs: exploreNeeds(tile.terrain, EXPLORE_RULES),
        progress: { searched: searchedCount(mask, spots.length), total: spots.length },
        homestead: homesteadOf(row),
        tools: toolUses(items),
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
        // Step 6: the tile, so its owner can't change mid-search.
        const { tile, spots } = tileSpots(
          seed,
          await repo.lockTileAt(mapId, request.q, request.r),
          user.id,
        );
        const spot = spots.find((s) => s.index === request.spot);
        if (!spot) throw new AppError('NOT_FOUND', MESSAGES.noSpot);

        // A stale row still marked explored (a layout bump, a converted
        // tile) is one of the player's explored rows, which a capture or a
        // finished tile may be locking in order: take that whole set first,
        // in `(user_id, tile_id)` order, so the refresh below can't invert it.
        const seen = await repo.findRow(user.id, tile.id);
        if (
          seen?.completedAt &&
          (seen.layout !== EXPLORE_RULES.layout || seen.terrain !== tile.terrain)
        ) {
          await repo.lockExplored(mapId, [user.id]);
        }
        // Then the player's row for it.
        const row =
          (await repo.lockRow(user.id, tile.id)) ??
          (await repo.insertRow({
            userId: user.id,
            tileId: tile.id,
            mapId,
            layout: EXPLORE_RULES.layout,
            terrain: tile.terrain,
            spotCount: spots.length,
            at,
          }));
        const before = searchedMask(row, tile);
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
        const explored = isFullyExplored(searched, spots.length);
        const fresh = before === 0 && row.searched !== 0;
        await repo.updateProgress(
          user.id,
          tile.id,
          {
            layout: EXPLORE_RULES.layout,
            terrain: tile.terrain,
            searched,
            spotCount: spots.length,
            completedAt: explored ? at : null,
            // A row restarted under a new layout isn't explored, so it isn't a homestead.
            ...(fresh ? { joinedAt: null, pausedAt: null, resumedAt: null } : {}),
          },
          at,
        );
        // Still with the explore rows (before squishies and the bag): a
        // finished tile may join home, and may join land beyond it too.
        // A row restarted under a new layout may have been a homestead: the
        // land joined through it is worked out again too.
        const homesteadEvents =
          explored || fresh ? await refreshHomesteads(tx, mapId, [user.id], at) : [];

        // What it found: the server rolls it (rule 1); a page already found isn't rolled again.
        const foundLore = new Set(
          (await createLoreRepo(tx).listFound(user.id)).map((f) => f.pageId),
        );
        const roll = rollExploreFind(
          EXPLORE_FINDS,
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
        const homestead = homesteadOf(await repo.findRow(user.id, tile.id));
        return {
          spot: spot.index,
          found: roll.items,
          lore: roll.lore ? { id: roll.lore, title: LORE_TITLES.get(roll.lore) ?? '' } : null,
          clothing,
          notable,
          xp: growths.map((g) => ({ squishyId: g.squishyId, xp: g.xp })),
          tool: spot.tool ? { id: spot.tool, usesLeft: items[spot.tool] ?? 0 } : null,
          progress: { searched: searchedCount(searched, spots.length), total: spots.length },
          explored,
          homestead,
          items,
        } satisfies SearchSpotResponse;
      });
      published(mapId);
      return result;
    },
  };
}

export type ExploreService = ReturnType<typeof createExploreService>;
