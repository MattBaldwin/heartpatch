import { ItemCountsSchema, type ItemChangeReason, type ItemCounts } from '@heartpatch/shared';
import { and, asc, eq, gt, inArray, isNull, sql } from 'drizzle-orm';
import { withTransaction, type Executor, type Transaction } from '../../db/client.js';
import { appendGameEvent, type GameEvent, type NewGameEvent } from '../../db/game-events.js';
import { crafts, inventories, mapMembers, resourceLedger } from '../../db/schema.js';

/** Whose bag: inventory is per player per map. */
export interface ItemOwner {
  mapId: string;
  userId: string;
}

/** Why items moved, for the ledger (tech spec §4). */
export interface ItemChange {
  reason: ItemChangeReason;
  /** What caused it (a gather, a craft), if there is one. */
  refId: string | null;
}

export interface CraftRow {
  id: string;
  mapId: string;
  userId: string;
  recipeId: string;
  items: ItemCounts;
  startedAt: Date;
  readyAt: Date;
  collectedAt: Date | null;
}

/**
 * Inventory and craft storage. Plain queries; `grantItems` / `consumeItems`
 * (service.ts) and the crafting service decide the rules and run inside the
 * caller's transaction.
 */
export interface InventoryRepo {
  transaction: <T>(fn: (repo: InventoryTxRepo, tx: Executor) => Promise<T>) => Promise<T>;

  /** The player's items with a quantity above 0. */
  list: (owner: ItemOwner) => Promise<ItemCounts>;
  /**
   * Item ids this account has ever received (any positive `resource_ledger`
   * row, any reason) on any map it has joined: the recipe book's "collected".
   * Takes no row locks.
   */
  everCollected: (userId: string) => Promise<Set<string>>;
  /**
   * Row-locks these items (`FOR UPDATE`, in id order so two consumers never
   * deadlock) and returns what the player has of each. Missing rows are 0.
   */
  lockItems: (owner: ItemOwner, itemIds: readonly string[]) => Promise<ItemCounts>;
  /**
   * Adds to each item, creating rows as needed, and writes a ledger row per
   * item. Quantities must be positive.
   */
  add: (owner: ItemOwner, items: ItemCounts, change: ItemChange) => Promise<void>;
  /**
   * Takes from each item and writes a ledger row per item. The caller has
   * locked the rows and checked there's enough.
   */
  subtract: (owner: ItemOwner, items: ItemCounts, change: ItemChange) => Promise<void>;

  insertCraft: (craft: Omit<CraftRow, 'id' | 'collectedAt'>) => Promise<CraftRow>;
  /** Row-locks the craft until commit; collecting runs under it. */
  lockCraft: (craftId: string) => Promise<CraftRow | null>;
  /** The player's crafts that haven't been collected yet, oldest first. */
  listActiveCrafts: (owner: ItemOwner) => Promise<CraftRow[]>;
  markCraftCollected: (craftId: string, at: Date) => Promise<void>;
}

/** The repo inside `transaction`: the only place it can write game events. */
export interface InventoryTxRepo extends InventoryRepo {
  /** `appendGameEvent` in this transaction; call it as the last write. */
  appendEvent: <T extends NewGameEvent['type']>(event: NewGameEvent<T>) => Promise<GameEvent>;
}

const ownedBy = (owner: ItemOwner) =>
  and(eq(inventories.mapId, owner.mapId), eq(inventories.userId, owner.userId));

const toCraft = (row: typeof crafts.$inferSelect): CraftRow => ({
  ...row,
  // JSON is checked on read, so a hand-edited row fails loudly.
  items: ItemCountsSchema.parse(row.items),
});

export function createInventoryRepo(db: Executor): InventoryRepo {
  return queries(db);
}

function createInventoryTxRepo(tx: Transaction): InventoryTxRepo {
  return { ...queries(tx), appendEvent: (event) => appendGameEvent(tx, event) };
}

function queries(db: Executor): InventoryRepo {
  const counts = (rows: { itemId: string; quantity: number }[]): ItemCounts =>
    Object.fromEntries(rows.map((r) => [r.itemId, r.quantity]));

  return {
    transaction: (fn) => withTransaction(db, (tx) => fn(createInventoryTxRepo(tx), tx)),

    list: async (owner) =>
      counts(
        await db
          .select({ itemId: inventories.itemId, quantity: inventories.quantity })
          .from(inventories)
          .where(and(ownedBy(owner), gt(inventories.quantity, 0)))
          .orderBy(asc(inventories.itemId)),
      ),

    // Through map_members, so the ledger's (map_id, user_id) index serves
    // each of the account's maps; left maps still count (rows are kept).
    everCollected: async (userId) =>
      new Set(
        (
          await db
            .selectDistinct({ itemId: resourceLedger.itemId })
            .from(mapMembers)
            .innerJoin(
              resourceLedger,
              and(
                eq(resourceLedger.mapId, mapMembers.mapId),
                eq(resourceLedger.userId, mapMembers.userId),
              ),
            )
            .where(and(eq(mapMembers.userId, userId), gt(resourceLedger.delta, 0)))
        ).map((r) => r.itemId),
      ),

    lockItems: async (owner, itemIds) => {
      if (itemIds.length === 0) return {};
      return counts(
        await db
          .select({ itemId: inventories.itemId, quantity: inventories.quantity })
          .from(inventories)
          .where(and(ownedBy(owner), inArray(inventories.itemId, [...itemIds])))
          .orderBy(asc(inventories.itemId))
          .for('update'),
      );
    },

    add: async (owner, items, change) => {
      const rows = Object.entries(items).map(([itemId, quantity]) => ({
        ...owner,
        itemId,
        quantity,
      }));
      if (rows.length === 0) return;
      // Sorted, so concurrent grants take row locks in the same order.
      rows.sort((a, b) => (a.itemId < b.itemId ? -1 : a.itemId > b.itemId ? 1 : 0));
      await db
        .insert(inventories)
        .values(rows)
        .onConflictDoUpdate({
          target: [inventories.mapId, inventories.userId, inventories.itemId],
          set: {
            quantity: sql`${inventories.quantity} + excluded.quantity`,
            updatedAt: sql`now()`,
          },
        });
      await db
        .insert(resourceLedger)
        .values(rows.map((r) => ({ ...owner, itemId: r.itemId, delta: r.quantity, ...change })));
    },

    subtract: async (owner, items, change) => {
      const entries = Object.entries(items);
      if (entries.length === 0) return;
      for (const [itemId, quantity] of entries) {
        await db
          .update(inventories)
          .set({ quantity: sql`${inventories.quantity} - ${quantity}`, updatedAt: sql`now()` })
          .where(and(ownedBy(owner), eq(inventories.itemId, itemId)));
      }
      await db
        .insert(resourceLedger)
        .values(
          entries.map(([itemId, quantity]) => ({ ...owner, itemId, delta: -quantity, ...change })),
        );
    },

    insertCraft: async (craft) => {
      const [row] = await db.insert(crafts).values(craft).returning();
      if (!row) throw new Error('insertCraft: insert returned no row');
      return toCraft(row);
    },

    lockCraft: async (craftId) => {
      const [row] = await db.select().from(crafts).where(eq(crafts.id, craftId)).for('update');
      return row ? toCraft(row) : null;
    },

    listActiveCrafts: async (owner) =>
      (
        await db
          .select()
          .from(crafts)
          .where(
            and(
              eq(crafts.mapId, owner.mapId),
              eq(crafts.userId, owner.userId),
              isNull(crafts.collectedAt),
            ),
          )
          .orderBy(asc(crafts.startedAt), asc(crafts.id))
      ).map(toCraft),

    markCraftCollected: async (craftId, at) => {
      await db.update(crafts).set({ collectedAt: at }).where(eq(crafts.id, craftId));
    },
  };
}
