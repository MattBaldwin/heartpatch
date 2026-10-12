import { deriveSeed, Rng, type Seed } from '../rng/index.js';
import type { FeelingId } from '../schemas/data/elements.js';
import type { HouseGiftRow, HouseGiftTable } from '../schemas/data/house-gifts.js';
import type { HouseNote } from '../schemas/data/house.js';

/*
 * Rolling the house's daily gift (#381 PR H, plan §1c "Daily return
 * reasons"). Server-only: it reads the secret gift table
 * (`@heartpatch/shared/server`) and is seeded from the secret map seed
 * (tech spec §8), so neither the odds nor tomorrow's gift can be worked out
 * on the client. Pure and deterministic: the server rolls lazily on the first
 * read of the day, and the same inputs always give the same gift.
 */

/** A resident that can leave today's gift: at home (not away), with its feeling for the note. */
export interface HouseGiftGiver {
  squishyId: string;
  feeling: FeelingId;
}

/** What a gift is seeded by: the map seed (never sent), the Keeper and the patch's local day. */
export interface HouseGiftSeedInput {
  /** `maps.seed`, or `deriveSeed('hand-authored-map', mapId)` for a map without one. */
  mapSeed: Seed;
  userId: string;
  /** The patch's local day (`YYYY-MM-DD`). */
  day: string;
}

/** What `rollHouseGift` rolls from. */
export interface HouseGiftInput extends HouseGiftSeedInput {
  level: number;
  /** Residents at home now; any order (they're sorted by id first). */
  givers: readonly HouseGiftGiver[];
}

/** Today's gift: who left it, what, how many, and which note. */
export interface HouseGiftRoll {
  giverSquishyId: string;
  itemId: string;
  count: number;
  noteId: string;
}

/** The seed for one Keeper's gift on one patch day. Never sent to the client. */
export const houseGiftSeed = (input: HouseGiftSeedInput): Seed =>
  deriveSeed(input.mapSeed, 'house-gift', input.userId, input.day);

/** The gift-table row for a house at `level`: the highest `fromLevel` at or under it. */
export function houseGiftRow(gifts: HouseGiftTable, level: number): HouseGiftRow {
  const row = gifts.table.findLast((r) => r.fromLevel <= level) ?? gifts.table[0];
  if (!row) throw new Error('houseGiftRow: no gift rows');
  return row;
}

/**
 * The note that goes with a gift from a giver of this feeling: one of the
 * notes for its feeling or for anyone, seeded by the Keeper's day and the
 * giver, so the same gift always shows the same note. A null feeling (the
 * giver's squishy row is gone) picks from the notes for anyone.
 */
export function houseGiftNote(
  notes: readonly HouseNote[],
  input: HouseGiftSeedInput & { squishyId: string; feeling: FeelingId | null },
): HouseNote {
  const fits = notes.filter((n) => n.feeling === undefined || n.feeling === input.feeling);
  const pool = fits.length > 0 ? fits : notes;
  return Rng.fromSeed(deriveSeed(houseGiftSeed(input), 'note', input.squishyId)).pick(pool);
}

/**
 * Today's gift for this Keeper, or null when no resident is home to leave
 * one. The same map, Keeper, day, level and givers always roll the same
 * gift, and another day rolls afresh.
 */
export function rollHouseGift(
  input: HouseGiftInput,
  gifts: HouseGiftTable,
  notes: readonly HouseNote[],
): HouseGiftRoll | null {
  if (input.givers.length === 0) return null;
  const givers = [...input.givers].sort((a, b) => (a.squishyId < b.squishyId ? -1 : 1));
  const rng = Rng.fromSeed(houseGiftSeed(input));
  const giver = rng.pick(givers);
  const gift = rng.weighted(houseGiftRow(gifts, input.level).gifts);
  return {
    giverSquishyId: giver.squishyId,
    itemId: gift.itemId,
    count: rng.int(gift.min, gift.max),
    noteId: houseGiftNote(notes, { ...input, ...giver }).id,
  };
}
