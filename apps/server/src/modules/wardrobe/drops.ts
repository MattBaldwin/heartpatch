import {
  CLOTHING_BY_ID,
  pickClothingDrop,
  Rng,
  type ClothingDropSource,
  type ClothingDropTable,
} from '@heartpatch/shared';
import { CLOTHING_DROPS } from '@heartpatch/shared/server';
import type { Executor } from '../../db/client.js';
import { newSeed } from '../../lib/rng.js';
import { seasonsOn } from '../inventory/service.js';
import { createWardrobeRepo } from './repo.js';

/*
 * Found clothing (design doc §23 "Getting clothing"; issue #43): a small,
 * server-side chance of a piece when a player gathers, captures a tile or
 * rescues a squishy. The tables are secret (`@heartpatch/shared/server`,
 * CLAUDE.md rule 6) and never leave the server; players only ever see what
 * they found. Seasonal pieces only drop in their season (design doc §15),
 * using the map's local date and the game clock (so `HP_DEV_NOW` tests it).
 */

/** What found something: gathers and tile captures call this today; Hollow rescues (#21) later. */
export interface FoundDropEvent {
  source: ClothingDropSource;
  /** The gather, capture or rescue: at most one piece per event, ever. */
  refId: string;
  userId: string;
  mapId: string;
  /** The tile it happened on, for terrain-only pieces; null if none. */
  tileId: string | null;
  at: Date;
}

export interface FoundDropOptions {
  /** Tests swap the tables. */
  tables?: readonly ClothingDropTable[];
  /** Tests swap the roll. */
  rng?: Rng;
}

/**
 * `HP_DEV_DROP_CHANCE` (dev and test only; refused in production): every
 * table's chance, so a find can be tried on a phone or in a test without
 * gathering a hundred times. `buildApp` sets it.
 */
let devChance: number | null = null;

export function setDevDropChance(chance: number | null): void {
  devChance = chance;
}

/**
 * Rolls for a found piece of clothing and, on a find, grants it and appends
 * `clothing.found`, all inside the caller's transaction: call it after your
 * state writes and before your own event, which stays the last write.
 * Idempotent: an event that already found something finds nothing
 * again. Returns the item id found, or null.
 */
export async function rollFoundDrop(
  tx: Executor,
  event: FoundDropEvent,
  options: FoundDropOptions = {},
): Promise<string | null> {
  const table = (options.tables ?? CLOTHING_DROPS).find((t) => t.source === event.source);
  if (!table) return null;
  const store = createWardrobeRepo(tx);
  const place = await store.mapPlace(event.mapId, event.tileId);
  if (!place) return null;
  const context = {
    seasons: new Set(seasonsOn(event.at, place.timeZone)),
    terrain: place.terrain ?? undefined,
  };
  const rolled = { ...table, chance: devChance ?? table.chance };
  const rng = options.rng ?? Rng.fromSeed(newSeed());
  const itemId = pickClothingDrop(rolled, context, CLOTHING_BY_ID, rng);
  if (!itemId) return null;

  return store.transaction(async (repo) => {
    const granted = await repo.grant({
      userId: event.userId,
      itemId,
      source: event.source,
      refId: event.refId,
      mapId: event.mapId,
      at: event.at,
    });
    if (!granted) return null;
    await repo.appendEvent({
      mapId: event.mapId,
      type: 'clothing.found',
      actorUserId: event.userId,
      payload: { userId: event.userId, itemId, source: event.source, refId: event.refId },
    });
    return itemId;
  });
}
