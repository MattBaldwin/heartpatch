import {
  activeSeasons,
  GAME_DATA,
  inSeason,
  needMoreText,
  shortfall,
  type Craft,
  type Gather,
  type CraftResponse,
  type CollectResponse,
  type InventoryResponse,
  type ItemChangeReason,
  type ItemCounts,
  type PublicUser,
} from '@heartpatch/shared';
import type { Executor } from '../../db/client.js';
import { isUniqueViolation } from '../../db/errors.js';
import { AppError } from '../../lib/errors.js';
import { localDate, type Clock } from '../../lib/time.js';
import { createGatheringRepo, type GatherRow } from '../gathering/repo.js';
import { createMapsRepo } from '../maps/repo.js';
import { createInventoryRepo, type CraftRow, type ItemOwner } from './repo.js';

/*
 * Inventory (#17, design doc §12): what each player has on a map, and
 * crafting. Other modules move items only through `grantItems` and
 * `consumeItems`, inside their own transaction, so a reward or a cost commits
 * together with the change it pays for (CLAUDE.md rule 7).
 */

const ITEMS = new Map(GAME_DATA.resources.map((r) => [r.id, r]));
const RECIPES = new Map(GAME_DATA.recipes.map((r) => [r.id, r]));
const SEASON_NAMES = new Map(GAME_DATA.seasons.map((s) => [s.id, s.name]));

// Kid-readable messages (style guide §6).
const MESSAGES = {
  noMap: "We couldn't find that patch.",
  unknownItem: "We don't know that item.",
  unknownRecipe: "We don't know that recipe.",
  noCraft: "We couldn't find that.",
  busy: "You're already making something! Collect it first.",
  collected: 'Already collected!',
  notReady: 'Not ready yet. Check back soon!',
  outOfSeason: (season: string) => `That recipe only works around ${season}!`,
} as const;

/** Checks ids against the shared resource table and amounts are whole and positive. */
function checkItems(items: ItemCounts): void {
  for (const [id, quantity] of Object.entries(items)) {
    if (!ITEMS.has(id)) throw new AppError('VALIDATION_FAILED', MESSAGES.unknownItem);
    if (!Number.isSafeInteger(quantity) || quantity <= 0) {
      throw new Error(`inventory: ${id} quantity must be a positive whole number`);
    }
  }
}

/**
 * Adds items to a player's bag, inside the caller's transaction, with a
 * ledger row per item (`reason`, and `refId` for what caused it). Unknown
 * item ids are refused (`VALIDATION_FAILED`). Call before the transaction's
 * game event (the event takes the `maps` row lock last).
 */
export async function grantItems(
  tx: Executor,
  owner: ItemOwner,
  items: ItemCounts,
  reason: ItemChangeReason,
  refId: string | null = null,
): Promise<void> {
  checkItems(items);
  await createInventoryRepo(tx).add(owner, items, { reason, refId });
}

/**
 * Takes items from a player's bag, inside the caller's transaction, with a
 * ledger row per item. Locks the rows first; if any item is short it throws
 * `CONFLICT` with a kid-readable line ("You need 1 more Timber first!") and
 * changes nothing.
 */
export async function consumeItems(
  tx: Executor,
  owner: ItemOwner,
  items: ItemCounts,
  reason: ItemChangeReason,
  refId: string | null = null,
): Promise<void> {
  checkItems(items);
  const repo = createInventoryRepo(tx);
  const have = await repo.lockItems(owner, Object.keys(items));
  const short = shortfall(have, items);
  if (Object.keys(short).length > 0) {
    throw new AppError('CONFLICT', needMoreText(short, GAME_DATA.resources));
  }
  await repo.subtract(owner, items, { reason, refId });
}

/** Season ids on today on a map (its local date, design doc §15). */
export function seasonsOn(at: Date, timeZone: string): string[] {
  return activeSeasons(GAME_DATA.seasons, localDate(at, timeZone)).map((s) => s.id);
}

/** The map, for an active member. NOT_FOUND otherwise, so maps can't be probed. */
export async function requireMember(tx: Executor, user: PublicUser, mapId: string) {
  const maps = createMapsRepo(tx);
  const [map, membership] = await Promise.all([
    maps.findMap(mapId),
    maps.membership(mapId, user.id),
  ]);
  if (!map || membership?.status !== 'active') throw new AppError('NOT_FOUND', MESSAGES.noMap);
  return map;
}

export const toGather = (row: GatherRow): Gather => ({
  id: row.id,
  q: row.q,
  r: row.r,
  resource: row.resource,
  items: row.items,
  startedAt: row.startedAt.toISOString(),
  readyAt: row.readyAt.toISOString(),
});

const toCraft = (row: CraftRow): Craft => ({
  id: row.id,
  recipeId: row.recipeId,
  items: row.items,
  startedAt: row.startedAt.toISOString(),
  readyAt: row.readyAt.toISOString(),
});

export interface InventoryService {
  /** The bag, gathers and crafts on the go, and the seasons on today. */
  get: (user: PublicUser, mapId: string) => Promise<InventoryResponse>;
  /** Uses up a recipe's inputs and starts it. */
  startCraft: (user: PublicUser, mapId: string, recipeId: string) => Promise<CraftResponse>;
  /** Puts a finished craft in the bag. */
  collectCraft: (user: PublicUser, mapId: string, craftId: string) => Promise<CollectResponse>;
  /** Dev/test only: items for the player. */
  devGrant: (user: PublicUser, mapId: string, items: ItemCounts) => Promise<ItemCounts>;
}

export interface InventoryServiceOptions {
  db: Executor;
  clock?: Clock;
  /** Live sync (`wsHub.publish`), called after commit. Never rejects. */
  publish?: (mapId: string) => Promise<void>;
}

export function createInventoryService(options: InventoryServiceOptions): InventoryService {
  const { db } = options;
  const now = options.clock ?? (() => new Date());
  const store = createInventoryRepo(db);
  const published = (mapId: string) => {
    void options.publish?.(mapId);
  };

  return {
    get: async (user, mapId) => {
      const map = await requireMember(db, user, mapId);
      const owner = { mapId, userId: user.id };
      const at = now();
      const [items, gathers, crafts] = await Promise.all([
        store.list(owner),
        createGatheringRepo(db).listActive(mapId, user.id),
        store.listActiveCrafts(owner),
      ]);
      return {
        items,
        gathers: gathers.map(toGather),
        crafts: crafts.map(toCraft),
        seasons: seasonsOn(at, map.timeZone),
        now: at.toISOString(),
      };
    },

    startCraft: async (user, mapId, recipeId) => {
      const recipe = RECIPES.get(recipeId);
      if (!recipe) throw new AppError('NOT_FOUND', MESSAGES.unknownRecipe);
      const owner = { mapId, userId: user.id };
      const at = now();
      try {
        return await store.transaction(async (repo, tx) => {
          const map = await requireMember(tx, user, mapId);
          if (!inSeason(recipe, new Set(seasonsOn(at, map.timeZone)))) {
            const season = SEASON_NAMES.get(recipe.season ?? '') ?? 'its season';
            throw new AppError('CONFLICT', MESSAGES.outOfSeason(season));
          }
          if ((await repo.listActiveCrafts(owner)).length > 0) {
            throw new AppError('CONFLICT', MESSAGES.busy);
          }
          const craft = await repo.insertCraft({
            ...owner,
            recipeId: recipe.id,
            items: { [recipe.output.resource]: recipe.output.quantity },
            startedAt: at,
            readyAt: new Date(at.getTime() + recipe.craftSeconds * 1000),
          });
          // Short of anything: CONFLICT, and the craft row rolls back with it.
          await consumeItems(tx, owner, recipe.inputs, 'craft', craft.id);
          return { craft: toCraft(craft), items: await repo.list(owner), now: at.toISOString() };
        });
      } catch (err) {
        // A double tap raced us to the one-craft-at-a-time index.
        if (isUniqueViolation(err)) throw new AppError('CONFLICT', MESSAGES.busy);
        throw err;
      }
    },

    collectCraft: async (user, mapId, craftId) => {
      const owner = { mapId, userId: user.id };
      const at = now();
      const result = await store.transaction(async (repo, tx) => {
        await requireMember(tx, user, mapId);
        const craft = await repo.lockCraft(craftId);
        if (!craft || craft.mapId !== mapId || craft.userId !== user.id) {
          throw new AppError('NOT_FOUND', MESSAGES.noCraft);
        }
        if (craft.collectedAt) throw new AppError('CONFLICT', MESSAGES.collected);
        if (craft.readyAt > at) throw new AppError('CONFLICT', MESSAGES.notReady);
        await grantItems(tx, owner, craft.items, 'craft', craft.id);
        await repo.markCraftCollected(craft.id, at);
        await repo.appendEvent({
          mapId,
          type: 'item.crafted',
          actorUserId: user.id,
          payload: {
            craftId: craft.id,
            userId: user.id,
            recipeId: craft.recipeId,
            items: craft.items,
          },
        });
        return { granted: craft.items, items: await repo.list(owner), now: at.toISOString() };
      });
      published(mapId);
      return result;
    },

    devGrant: async (user, mapId, items) => {
      const owner = { mapId, userId: user.id };
      return store.transaction(async (repo, tx) => {
        await requireMember(tx, user, mapId);
        await grantItems(tx, owner, items, 'dev-grant');
        return repo.list(owner);
      });
    },
  };
}
