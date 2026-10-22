import {
  NOTHING_FOUND,
  REKINDLED_DROPS,
  rollFoundSets,
  type FoundSetDropTable,
  type FoundSetPlace,
  type FoundSetRoll,
} from '@heartpatch/shared/server';
import { Rng, type ClothingDropSource } from '@heartpatch/shared';
import type { Executor } from '../../db/client.js';
import { newSeed } from '../../lib/rng.js';
import { devDropChanceOr, grantFoundPiece } from './drops.js';
import { createWardrobeRepo } from './repo.js';

/*
 * The Rekindled set's drops (#306 PR 5): the one way Hollowed places hand
 * out its pieces and finds, so the village searches (2a), the memory
 * puzzles (2b), the cellars (2c) and the far Hollow (PR 6) never edit the
 * secret tables (`REKINDLED_DROPS`, CLAUDE.md rule 6). Two steps, so the
 * caller keeps its own lock order (tech spec §7):
 *
 * 1. `rekindledDrop` rolls, reading only what the player owns (no locks, no
 *    writes). Add its `items` to the bag grant you were going to make, so
 *    every bag row is still locked once, in item order (`lockGrantRows`).
 * 2. After your state writes and before your own event, `grantRekindledPiece`
 *    grants its `clothing` and appends `clothing.found` (which moves the
 *    Rekindler title along). A piece is the event's one piece of clothing:
 *    skip any other found-clothing roll for that event.
 */

export interface RekindledDropRoll {
  /** Which Hollowed place is rolling: its own odds. */
  place: FoundSetPlace;
  userId: string;
}

export interface RekindledDropOptions {
  /** Tests swap the tables. */
  tables?: readonly FoundSetDropTable[];
  /** Tests swap the roll. */
  rng?: Rng;
}

/** Rolls the Rekindled tables for `place`. A piece the player has already isn't found again. */
export async function rekindledDrop(
  tx: Executor,
  roll: RekindledDropRoll,
  options: RekindledDropOptions = {},
): Promise<FoundSetRoll> {
  const tables = (options.tables ?? REKINDLED_DROPS).map((t) => ({
    ...t,
    chance: devDropChanceOr(t.chance),
  }));
  if (!tables.some((t) => t.place === roll.place && t.chance > 0)) return NOTHING_FOUND;
  const owned = await createWardrobeRepo(tx).countOwned(roll.userId);
  const rng = options.rng ?? Rng.fromSeed(newSeed());
  return rollFoundSets(tables, roll.place, new Set(owned.keys()), rng);
}

export interface RekindledPieceEvent {
  /** The found-clothing source the event names (`explore` for a village search). */
  source: ClothingDropSource;
  /** The search, puzzle or cellar find: at most one piece per event, ever. */
  refId: string;
  userId: string;
  mapId: string;
  at: Date;
}

/**
 * Grants `roll.clothing`, if any, and appends `clothing.found`, inside the
 * caller's transaction. Returns the item id granted, or null.
 */
export async function grantRekindledPiece(
  tx: Executor,
  event: RekindledPieceEvent,
  roll: FoundSetRoll,
): Promise<string | null> {
  return roll.clothing === null ? null : grantFoundPiece(tx, event, roll.clothing);
}
