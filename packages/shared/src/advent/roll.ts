import { deriveSeed, Rng, type Seed } from '../rng/index.js';
import type { AdventResult } from '../schemas/christmas.js';
import { PRESENT_ITEM, type AdventPool, type AdventPresents } from '../schemas/data/advent.js';
import type { LocalDate } from '../schemas/time.js';

/*
 * Rolling advent presents (#37 1c). Server-only: it reads the secret table
 * (`@heartpatch/shared/server`) and is seeded from its secret salt (tech spec
 * §8), so neither the odds nor a day's present can be worked out on the
 * client. Pure and deterministic: the same Keeper and day always roll the
 * same present, from whichever patch it is opened (the claim is account
 * level), so a retry can't fish for a better one.
 */

/** The seed of one Keeper's present for one advent day. Never sent to the client. */
export const adventSeed = (table: AdventPresents, userId: string, day: LocalDate): Seed =>
  deriveSeed(table.seedSalt, 'advent', userId, day);

/** The seed of one opening of a present from the bag. Never sent to the client. */
export const presentOpeningSeed = (
  table: AdventPresents,
  userId: string,
  openingId: string,
): Seed => deriveSeed(table.seedSalt, 'present-open', userId, openingId);

function addTo(out: Record<string, number>, id: string, n: number): void {
  out[id] = (out[id] ?? 0) + n;
}

/** `picks` different items from the pool, by weight, without repeats. */
function rollPool(rng: Rng, { picks, pool }: AdventPool, out: Record<string, number>): void {
  let left = pool.filter((e) => e.weight > 0);
  for (let i = 0; i < picks && left.length > 0; i += 1) {
    const entry = rng.weighted(left);
    addTo(out, entry.itemId, rng.int(entry.min, entry.max));
    left = left.filter((e) => e !== entry);
  }
}

/**
 * The day's advent present for this Keeper: `daily.picks` things from the
 * pool, the day's fixed items (Fireworks on the 24th) and, on 1 claim in
 * `spareOneIn`, a wrapped present to pass on.
 */
export function rollAdventPresent(
  table: AdventPresents,
  userId: string,
  day: LocalDate,
): AdventResult {
  const rng = Rng.fromSeed(adventSeed(table, userId, day));
  const out: Record<string, number> = {};
  rollPool(rng, table.daily, out);
  if (rng.int(1, table.spareOneIn) === 1) addTo(out, PRESENT_ITEM, 1);
  const fixed = table.fixed[String(Number(day.slice(8)))] ?? {};
  for (const [id, n] of Object.entries(fixed)) addTo(out, id, n);
  return out;
}

/** What a present opened from the bag held. Never another present. */
export function rollPresentOpening(
  table: AdventPresents,
  userId: string,
  openingId: string,
): AdventResult {
  const rng = Rng.fromSeed(presentOpeningSeed(table, userId, openingId));
  const out: Record<string, number> = {};
  rollPool(rng, table.opening, out);
  return out;
}

/** What a wrapped present from the bag *can* hold, as item ids in table order, with no odds. */
export const wrappedPresentContents = (table: AdventPresents): string[] =>
  table.opening.pool.filter((e) => e.weight > 0).map((e) => e.itemId);

/**
 * What a day's present *can* hold, as item ids in table order, with no
 * odds: the calendar sheet shows these (owner answer 3, "contents shown").
 */
export function adventContents(table: AdventPresents, day: LocalDate): string[] {
  const ids = table.daily.pool.filter((e) => e.weight > 0).map((e) => e.itemId);
  ids.push(PRESENT_ITEM);
  for (const id of Object.keys(table.fixed[String(Number(day.slice(8)))] ?? {})) {
    if (!ids.includes(id)) ids.push(id);
  }
  return ids;
}
