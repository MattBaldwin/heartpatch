import { ItemCountsSchema, type ItemCounts } from '@heartpatch/shared';
import { and, asc, eq, gt, inArray, isNull, sql } from 'drizzle-orm';
import { withTransaction, type Executor, type Transaction } from '../../db/client.js';
import { appendGameEvent, type GameEvent, type NewGameEvent } from '../../db/game-events.js';
import { crafts, inventoryItems } from '../../db/schema.js';

/** Whose bag: inventory is per player per map. */
export interface ItemOwner {
  mapId: string;
  userId: string;
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
   * Row-locks these items (`FOR UPDATE`, in id order so two consumers never
   * deadlock) and returns what the player has of each. Missing rows are 0.
   */
  lockItems: (owner: ItemOwner, itemIds: readonly string[]) => Promise<ItemCounts>;
  /** Adds to each item, creating rows as needed. Quantities must be positive. */
  add: (owner: ItemOwner, items: ItemCounts) => Promise<void>;
  /** Takes from each item. The caller has locked the rows and checked there's enough. */
  subtract: (owner: ItemOwner, items: ItemCounts) => Promise<void>;

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
  and(eq(inventoryItems.mapId, owner.mapId), eq(inventoryItems.userId, owner.userId));

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
          .select({ itemId: inventoryItems.itemId, quantity: inventoryItems.quantity })
          .from(inventoryItems)
          .where(and(ownedBy(owner), gt(inventoryItems.quantity, 0)))
          .orderBy(asc(inventoryItems.itemId)),
      ),

    lockItems: async (owner, itemIds) => {
      if (itemIds.length === 0) return {};
      return counts(
        await db
          .select({ itemId: inventoryItems.itemId, quantity: inventoryItems.quantity })
          .from(inventoryItems)
          .where(and(ownedBy(owner), inArray(inventoryItems.itemId, [...itemIds])))
          .orderBy(asc(inventoryItems.itemId))
          .for('update'),
      );
    },

    add: async (owner, items) => {
      const rows = Object.entries(items).map(([itemId, quantity]) => ({
        ...owner,
        itemId,
        quantity,
      }));
      if (rows.length === 0) return;
      // Sorted, so concurrent grants take row locks in the same order.
      rows.sort((a, b) => (a.itemId < b.itemId ? -1 : a.itemId > b.itemId ? 1 : 0));
      await db
        .insert(inventoryItems)
        .values(rows)
        .onConflictDoUpdate({
          target: [inventoryItems.mapId, inventoryItems.userId, inventoryItems.itemId],
          set: {
            quantity: sql`${inventoryItems.quantity} + excluded.quantity`,
            updatedAt: sql`now()`,
          },
        });
    },

    subtract: async (owner, items) => {
      for (const [itemId, quantity] of Object.entries(items)) {
        await db
          .update(inventoryItems)
          .set({ quantity: sql`${inventoryItems.quantity} - ${quantity}`, updatedAt: sql`now()` })
          .where(and(ownedBy(owner), eq(inventoryItems.itemId, itemId)));
      }
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
