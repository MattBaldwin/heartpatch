import {
  NOTHING_FOUND,
  REKINDLED_DROPS,
  rollFoundSets,
  type FoundSetDropTable,
  type FoundSetPlace,
  type FoundSetRoll,
} from '@heartpatch/shared/server';
import {
  FOUND_SETS,
  foundSetTrackId,
  MILESTONE_RULES,
  Rng,
  type ClothingDropSource,
} from '@heartpatch/shared';
import type { Executor } from '../../db/client.js';
import { newSeed } from '../../lib/rng.js';
import { createMilestonesRepo } from '../milestones/repo.js';
import { devDropChanceOr, grantFoundPiece } from './drops.js';

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
 *    skip any other found-clothing roll for that event. `source` is a
 *    `ClothingDropSource` (a puzzle or cellar find is `explore`; a new source
 *    is a shared-contract change) and `refId` a uuid unique to the event.
 *
 * Pieces only drop where milestones count (`MILESTONE_RULES.minMembers`
 * active members, decision F, as the milestones consumer judges it), so
 * every piece found moves the set's title along; elsewhere a piece's share
 * finds nothing, and the set's finds still drop. "Already found" is what the
 * title has counted, not what's owned: a piece that somehow wasn't counted
 * (a patch-mate left before the consumer got to it) can still drop again,
 * so the title is never out of reach.
 */

export interface RekindledDropRoll {
  /** Which Hollowed place is rolling: its own odds. */
  place: FoundSetPlace;
  userId: string;
  mapId: string;
  /** When it happens, on the game clock (who counted as a member by then). */
  at: Date;
}

export interface RekindledDropOptions {
  /** Tests swap the tables. */
  tables?: readonly FoundSetDropTable[];
  /** Tests swap the roll. */
  rng?: Rng;
}

/**
 * Rolls the Rekindled tables for `place`. A piece the player's title has
 * counted isn't found again, and pieces only drop where milestones count.
 * Reads only (no locks, no writes).
 */
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
  const milestones = createMilestonesRepo(tx);
  const map = await milestones.mapContext(roll.mapId, roll.at);
  const counts = map?.kind === 'multiplayer' && map.members >= MILESTONE_RULES.minMembers;
  const found = await milestones.countedKeys(roll.userId, FOUND_SETS.map(foundSetTrackId));
  const rng = options.rng ?? Rng.fromSeed(newSeed());
  const rolled = rollFoundSets(tables, roll.place, found, rng);
  return counts ? rolled : { clothing: null, items: rolled.items };
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
