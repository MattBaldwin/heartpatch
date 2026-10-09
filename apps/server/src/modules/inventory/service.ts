import {
  activeSeasons,
  BATTLE_RULES,
  craftSecondsFor,
  GAME_DATA,
  inSeason,
  isPageUnlocked,
  needMoreText,
  RECIPE_BOOK,
  recipeBookPages,
  recipePageKey,
  shortfall,
  unlockedPageKeys,
  type Craft,
  type Gather,
  type CraftResponse,
  type CollectResponse,
  type InventoryResponse,
  type ItemChangeReason,
  type ItemCounts,
  type PublicUser,
  type RecipeBookPage,
  type RecipeBookResponse,
} from '@heartpatch/shared';
import type { Executor } from '../../db/client.js';
import type { NewGameEvent } from '../../db/game-events.js';
import { isUniqueViolation } from '../../db/errors.js';
import { AppError } from '../../lib/errors.js';
import { localDate, type Clock } from '../../lib/time.js';
import { createBattlesRepo } from '../battles/repo.js';
import { createGatheringRepo, type GatherRow } from '../gathering/repo.js';
import { factoryView } from '../factory/view.js';
import { requireMember } from '../maps/members.js';
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
/** The recipe book (owner decision 2026-10-05), in book order. */
const BOOK_PAGES = recipeBookPages();
const BOOK_PAGE_BY_KEY = new Map<string, RecipeBookPage>(BOOK_PAGES.map((p) => [p.key, p]));

// Kid-readable messages (style guide §6).
const MESSAGES = {
  unknownItem: "We don't know that item.",
  unknownRecipe: "We don't know that recipe.",
  noCraft: "We couldn't find that.",
  busy: 'Your pot is still cooking! It pops into your bag when it’s ready.',
  collected: 'Already collected!',
  notReady: 'Not ready yet. Check back soon!',
  outOfSeason: (season: string) => `That recipe only works around ${season}!`,
  sealed: {
    recipe: 'That recipe page is still sealed! Collect everything it needs first.',
    building: 'That building page is still sealed! Collect everything it needs first.',
  },
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

/**
 * Locks every inventory row these grants will touch, per owner (owner id
 * order) and in item-id order, before any grant: one grant at a time would
 * otherwise lock items in grant order, against everyone else's item-id order
 * (tech spec §7 step 11). Missing rows are made by the grant.
 */
export async function lockGrantRows(
  tx: Executor,
  mapId: string,
  grants: readonly { userId: string; items: ItemCounts }[],
): Promise<void> {
  const byOwner = new Map<string, Set<string>>();
  for (const { userId, items } of grants) {
    const ids = byOwner.get(userId) ?? new Set<string>();
    for (const id of Object.keys(items)) ids.add(id);
    byOwner.set(userId, ids);
  }
  const inventory = createInventoryRepo(tx);
  for (const userId of [...byOwner.keys()].sort()) {
    const ids = [...(byOwner.get(userId) ?? [])].sort();
    if (ids.length > 0) await inventory.lockItems({ mapId, userId }, ids);
  }
}

/**
 * Banks a finished craft into its maker's bag, inside the caller's
 * transaction (owner decision 2026-10-06: no Collect tap): the items (ledger
 * reason `craft`) and the row marked collected, which frees the pot. The
 * caller has locked the craft and the inventory rows. Returns the
 * `item.crafted` event to append last, as a Collect did.
 */
export async function bankCraft(
  tx: Executor,
  craft: CraftRow,
  at: Date,
): Promise<NewGameEvent<'item.crafted'>> {
  const owner = { mapId: craft.mapId, userId: craft.userId };
  await grantItems(tx, owner, craft.items, 'craft', craft.id);
  await createInventoryRepo(tx).markCraftCollected(craft.id, at);
  return {
    mapId: craft.mapId,
    type: 'item.crafted',
    actorUserId: craft.userId,
    payload: {
      craftId: craft.id,
      userId: craft.userId,
      recipeId: craft.recipeId,
      items: craft.items,
    },
  };
}

/** A recipe book page by key (`recipe:<id>`, `building:<id>`), if the book has it. */
export const recipeBookPage = (key: string): RecipeBookPage | undefined =>
  BOOK_PAGE_BY_KEY.get(key);

/**
 * Refuses (`FORBIDDEN`) to make a sealed recipe book page: one whose
 * ingredients this account hasn't all collected yet, on any map (owner
 * decision 2026-10-05). Reads the ledger inside the caller's transaction and
 * takes no row locks, so it adds nothing to the lock order. Call it before
 * anything is spent.
 */
export async function requirePageOpen(
  tx: Executor,
  userId: string,
  page: RecipeBookPage,
): Promise<void> {
  // Always-open pages (every Heart Charm, Hearthfire…) skip the ledger read.
  if (RECIPE_BOOK.alwaysOpen.includes(page.key)) return;
  if (isPageUnlocked(page, await createInventoryRepo(tx).everCollected(userId))) return;
  throw new AppError('FORBIDDEN', MESSAGES.sealed[page.kind]);
}

/** Season ids on today on a map (its local date, design doc §15). */
export function seasonsOn(at: Date, timeZone: string): string[] {
  return activeSeasons(GAME_DATA.seasons, localDate(at, timeZone)).map((s) => s.id);
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
  /** Dev/test only: the player's crafts on this map finish now (e2e skips the wait). The bag, as `get`. */
  devCraftsReady: (user: PublicUser, mapId: string) => Promise<InventoryResponse>;
  /** Dev/test only: items for the player. */
  devGrant: (user: PublicUser, mapId: string, items: ItemCounts) => Promise<ItemCounts>;
  /** The recipe book pages this account has opened (account-level). */
  recipeBook: (user: PublicUser) => Promise<RecipeBookResponse>;
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

  const service: InventoryService = {
    get: async (user, mapId) => {
      const { map } = await requireMember(db, user, mapId);
      const owner = { mapId, userId: user.id };
      const at = now();
      const [items, gathers, crafts, factory] = await Promise.all([
        store.list(owner),
        createGatheringRepo(db).listActive(mapId, user.id),
        store.listActiveCrafts(owner),
        factoryView(db, owner, at),
      ]);
      return {
        items,
        gathers: gathers.map(toGather),
        crafts: crafts.map(toCraft),
        factory,
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
          const { map } = await requireMember(tx, user, mapId);
          if (!inSeason(recipe, new Set(seasonsOn(at, map.timeZone)))) {
            const season = SEASON_NAMES.get(recipe.season ?? '') ?? 'its season';
            throw new AppError('CONFLICT', MESSAGES.outOfSeason(season));
          }
          const page = recipeBookPage(recipePageKey(recipe.id));
          if (page) await requirePageOpen(tx, user.id, page);
          // A finished craft goes in the bag first and frees the pot; one
          // still cooking keeps it busy. Lock order (tech spec §7): the craft,
          // then every inventory row this touches (what's banked and what's
          // spent) in item-id order, then `maps`.
          const active = await repo.lockActiveCrafts(owner);
          if (active.some((c) => c.readyAt > at)) throw new AppError('CONFLICT', MESSAGES.busy);
          await lockGrantRows(tx, mapId, [
            ...active.map((c) => ({ userId: user.id, items: c.items })),
            { userId: user.id, items: recipe.inputs },
          ]);
          const banked: NewGameEvent[] = [];
          for (const done of active) banked.push(await bankCraft(tx, done, at));
          // Quicker with the right squishy on the team as it starts (#238: a
          // Frost squishy freezes Water). A plain read: no squishy locks.
          const team = recipe.fasterWith
            ? await createBattlesRepo(tx).listTeam(mapId, user.id, BATTLE_RULES.teamSize)
            : [];
          const seconds = craftSecondsFor(
            recipe,
            team.map((s) => s.element),
          );
          const craft = await repo.insertCraft({
            ...owner,
            recipeId: recipe.id,
            items: { [recipe.output.resource]: recipe.output.quantity },
            startedAt: at,
            readyAt: new Date(at.getTime() + seconds * 1000),
          });
          // Short of anything: CONFLICT, and the craft row rolls back with it.
          await consumeItems(tx, owner, recipe.inputs, 'craft', craft.id);
          for (const event of banked) await repo.appendEvent(event);
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
        await repo.appendEvent(await bankCraft(tx, craft, at));
        return { granted: craft.items, items: await repo.list(owner), now: at.toISOString() };
      });
      published(mapId);
      return result;
    },

    devCraftsReady: async (user, mapId) => {
      const at = now();
      await store.transaction(async (repo, tx) => {
        await requireMember(tx, user, mapId);
        await repo.makeCraftsReady({ mapId, userId: user.id }, at);
      });
      return service.get(user, mapId);
    },

    devGrant: async (user, mapId, items) => {
      const owner = { mapId, userId: user.id };
      return store.transaction(async (repo, tx) => {
        await requireMember(tx, user, mapId);
        await grantItems(tx, owner, items, 'dev-grant');
        return repo.list(owner);
      });
    },

    recipeBook: async (user) => {
      const open = unlockedPageKeys(BOOK_PAGES, await store.everCollected(user.id));
      return { unlocked: BOOK_PAGES.filter((p) => open.has(p.key)).map((p) => p.key) };
    },
  };
  return service;
}
