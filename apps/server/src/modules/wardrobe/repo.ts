import { and, isNull, asc, count, eq, isNotNull } from 'drizzle-orm';
import { z } from 'zod';
import { withTransaction, type Executor, type Transaction } from '../../db/client.js';
import { appendGameEvent, type GameEvent, type NewGameEvent } from '../../db/game-events.js';
import {
  clothingOwned,
  mapMembers,
  maps,
  outfits,
  squishies,
  squishyAccessories,
  tiles,
} from '../../db/schema.js';

/** The worn set (`preset` 0) or a saved outfit (1–3). */
export interface OutfitRow {
  preset: number;
  name: string | null;
  wearing: string[];
}

/** A squishy as the wardrobe needs it (read only: squishies belong to their own modules). */
export interface SquishyRow {
  id: string;
  mapId: string;
  ownerUserId: string;
  state: string;
}

/** One stored piece of clothing on its way in. */
export interface NewClothing {
  userId: string;
  itemId: string;
  /** How it arrived: `gather`, `capture`, `rescue`, `dev-grant`, … */
  source: string;
  /** What caused it; one piece per (source, ref). */
  refId: string | null;
  mapId: string | null;
  at: Date;
}

/** Preset 0 is what the Keeper wears now (`outfits`). */
export const WORN = 0;

const WearingJsonSchema = z.array(z.string());

/**
 * Wardrobe storage: clothing pieces (`clothing_owned`), outfits (`outfits`)
 * and squishy accessories (`squishy_accessories`). Account-level (tech spec
 * §4). Plain queries; the service decides the rules.
 */
export interface WardrobeRepo {
  transaction: <T>(fn: (repo: WardrobeTxRepo, tx: Executor) => Promise<T>) => Promise<T>;

  /** Item id → how many stored pieces the player has, not held for a trade (starter items aren't stored). */
  countOwned: (userId: string) => Promise<Map<string, number>>;
  /** Every outfit row: the worn set and the saved presets, by preset. */
  listOutfits: (userId: string) => Promise<OutfitRow[]>;
  /** Row-locks the player's worn set until commit (null before they first dress). */
  lockWorn: (userId: string) => Promise<OutfitRow | null>;
  saveOutfit: (userId: string, outfit: OutfitRow, at: Date) => Promise<void>;
  /** Maps where the player is an active member, by id (the lock order for events). */
  activeMapIds: (userId: string) => Promise<string[]>;
  /** A map's time zone, and the terrain of one of its tiles if asked. */
  mapPlace: (
    mapId: string,
    tileId: string | null,
  ) => Promise<{ timeZone: string; terrain: string | null } | null>;
  /** Row-locks a squishy until commit. */
  lockSquishy: (squishyId: string) => Promise<SquishyRow | null>;
  setAccessory: (
    squishyId: string,
    userId: string,
    itemId: string | null,
    at: Date,
  ) => Promise<void>;
}

/** The repo inside `transaction`: the only place it can write game events. */
export interface WardrobeTxRepo extends WardrobeRepo {
  /** `appendGameEvent` in this transaction; call it as the last write. */
  appendEvent: <T extends NewGameEvent['type']>(event: NewGameEvent<T>) => Promise<GameEvent>;
}

/**
 * Stores a piece; false if this source event already granted one. The
 * wardrobe service's `grantClothing` is the one caller: everyone else grants
 * through it.
 */
export async function insertClothing(db: Executor, piece: NewClothing): Promise<boolean> {
  const inserted = await db
    .insert(clothingOwned)
    .values({
      userId: piece.userId,
      itemId: piece.itemId,
      source: piece.source,
      refId: piece.refId,
      mapId: piece.mapId,
      acquiredAt: piece.at,
    })
    .onConflictDoNothing({
      target: [clothingOwned.source, clothingOwned.refId],
      where: isNotNull(clothingOwned.refId),
    })
    .returning({ id: clothingOwned.id });
  return inserted.length > 0;
}

export function createWardrobeRepo(db: Executor): WardrobeRepo {
  return queries(db);
}

function createWardrobeTxRepo(tx: Transaction): WardrobeTxRepo {
  return { ...queries(tx), appendEvent: (event) => appendGameEvent(tx, event) };
}

/** A stored `outfits.wearing` (or null for a player who never dressed) as item ids. */
export const wornOf = (wearing: unknown): string[] =>
  wearing === null ? [] : WearingJsonSchema.parse(wearing);

const toOutfit = (row: { preset: number; name: string | null; wearing: unknown }): OutfitRow => ({
  preset: row.preset,
  name: row.name,
  // JSON is checked on read, so a hand-edited row fails loudly.
  wearing: wornOf(row.wearing),
});

const outfitColumns = { preset: outfits.preset, name: outfits.name, wearing: outfits.wearing };

function queries(db: Executor): WardrobeRepo {
  return {
    transaction: (fn) => withTransaction(db, (tx) => fn(createWardrobeTxRepo(tx), tx)),

    countOwned: async (userId) => {
      const rows = await db
        .select({ itemId: clothingOwned.itemId, count: count() })
        .from(clothingOwned)
        // A piece held for a trade or gift (#271) waits at the post: not wearable.
        .where(and(eq(clothingOwned.userId, userId), isNull(clothingOwned.heldByOfferId)))
        .groupBy(clothingOwned.itemId);
      return new Map(rows.map((r) => [r.itemId, r.count]));
    },

    listOutfits: async (userId) =>
      (
        await db
          .select(outfitColumns)
          .from(outfits)
          .where(eq(outfits.userId, userId))
          .orderBy(asc(outfits.preset))
      ).map(toOutfit),

    lockWorn: async (userId) => {
      const [row] = await db
        .select(outfitColumns)
        .from(outfits)
        .where(and(eq(outfits.userId, userId), eq(outfits.preset, WORN)))
        .for('update');
      return row ? toOutfit(row) : null;
    },

    saveOutfit: async (userId, outfit, at) => {
      const values = { name: outfit.name, wearing: outfit.wearing, updatedAt: at };
      await db
        .insert(outfits)
        .values({ userId, preset: outfit.preset, ...values })
        .onConflictDoUpdate({ target: [outfits.userId, outfits.preset], set: values });
    },

    activeMapIds: async (userId) =>
      (
        await db
          .select({ mapId: mapMembers.mapId })
          .from(mapMembers)
          .where(and(eq(mapMembers.userId, userId), eq(mapMembers.status, 'active')))
          .orderBy(asc(mapMembers.mapId))
      ).map((r) => r.mapId),

    mapPlace: async (mapId, tileId) => {
      const [map] = await db
        .select({ timeZone: maps.timeZone })
        .from(maps)
        .where(eq(maps.id, mapId));
      if (!map) return null;
      if (tileId === null) return { timeZone: map.timeZone, terrain: null };
      const [tile] = await db
        .select({ terrain: tiles.terrain })
        .from(tiles)
        .where(and(eq(tiles.id, tileId), eq(tiles.mapId, mapId)));
      return { timeZone: map.timeZone, terrain: tile?.terrain ?? null };
    },

    lockSquishy: async (squishyId) => {
      const [row] = await db
        .select({
          id: squishies.id,
          mapId: squishies.mapId,
          ownerUserId: squishies.ownerUserId,
          state: squishies.state,
        })
        .from(squishies)
        .where(eq(squishies.id, squishyId))
        .for('update');
      return row ?? null;
    },

    setAccessory: async (squishyId, userId, itemId, at) => {
      if (itemId === null) {
        await db.delete(squishyAccessories).where(eq(squishyAccessories.squishyId, squishyId));
        return;
      }
      await db
        .insert(squishyAccessories)
        .values({ squishyId, userId, itemId, updatedAt: at })
        .onConflictDoUpdate({
          target: squishyAccessories.squishyId,
          set: { userId, itemId, updatedAt: at },
        });
    },
  };
}
