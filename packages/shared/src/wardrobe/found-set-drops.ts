import type { ItemCounts } from '../gathering/index.js';
import type { Rng } from '../rng/index.js';
import type { FoundSetDropTable, FoundSetPlace } from '../schemas/data/found-set-drops.js';

// Rolling a found set's drop (#306 PR 5). Server-only: it reads the secret
// tables (`@heartpatch/shared/server`). The server rolls every find
// (CLAUDE.md rule 1).

/** What one roll found: a piece (maybe none) and the set's finds (maybe none). */
export interface FoundSetRoll {
  readonly clothing: string | null;
  readonly items: ItemCounts;
}

export const NOTHING_FOUND: FoundSetRoll = { clothing: null, items: {} };

/** The tables for one place, in data order (one per set). */
export function foundSetTables(
  tables: readonly FoundSetDropTable[],
  place: FoundSetPlace,
): FoundSetDropTable[] {
  return tables.filter((t) => t.place === place);
}

/**
 * Rolls one table: its chance first, then a weighted pick. A piece the
 * player has already found (`found`: what the set's title has counted)
 * finds nothing rather than another pick, so the odds of everything else
 * never shift as the set fills up.
 */
export function rollFoundSet(
  table: FoundSetDropTable,
  found: ReadonlySet<string>,
  rng: Rng,
): FoundSetRoll {
  if (!rng.chance(table.chance)) return NOTHING_FOUND;
  const entry = rng.weighted(table.entries);
  if (entry.clothing !== undefined) {
    return found.has(entry.clothing) ? NOTHING_FOUND : { clothing: entry.clothing, items: {} };
  }
  return { clothing: null, items: { ...(entry.items ?? {}) } };
}

/**
 * Rolls every set's table for `place`, and keeps at most one piece (the
 * first set's, in data order): one piece of clothing an event, ever.
 */
export function rollFoundSets(
  tables: readonly FoundSetDropTable[],
  place: FoundSetPlace,
  found: ReadonlySet<string>,
  rng: Rng,
): FoundSetRoll {
  let clothing: string | null = null;
  const items: Record<string, number> = {};
  for (const table of foundSetTables(tables, place)) {
    const roll = rollFoundSet(table, found, rng);
    clothing ??= roll.clothing;
    for (const [id, n] of Object.entries(roll.items)) items[id] = (items[id] ?? 0) + n;
  }
  return { clothing, items };
}

/** `items` with a roll's finds added: the one bag grant an event makes. */
export function withFoundItems(items: ItemCounts, roll: FoundSetRoll): ItemCounts {
  const all: Record<string, number> = { ...items };
  for (const [id, n] of Object.entries(roll.items)) all[id] = (all[id] ?? 0) + n;
  return all;
}
