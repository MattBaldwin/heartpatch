import type { Rng } from '../rng/index.js';
import type { ExploreFindTable } from '../schemas/data/explore-finds.js';
import type { ItemCounts } from '../gathering/index.js';

// Rolling an explore find (#199). Server-only: it reads the secret find
// tables (`@heartpatch/shared/server`). The server rolls every find
// (CLAUDE.md rule 1); the touch interaction is feel, not outcome.

/** What one search found: items (maybe none) or a lore page. */
export interface ExploreFindRoll {
  readonly items: ItemCounts;
  readonly lore: string | null;
}

/** The table for a spot: the terrain's own for that kind, else the kind's general one. */
export function exploreFindTable(
  tables: readonly ExploreFindTable[],
  kind: string,
  terrain: string,
): ExploreFindTable | undefined {
  return (
    tables.find((t) => t.kind === kind && t.terrains?.includes(terrain)) ??
    tables.find((t) => t.kind === kind && !t.terrains)
  );
}

/**
 * Rolls a find for a spot of `kind` on `terrain`. A lore page the player
 * already has (`foundLore`) is never rolled, so a page is found once.
 */
export function rollExploreFind(
  tables: readonly ExploreFindTable[],
  spot: { kind: string; terrain: string },
  rng: Rng,
  foundLore: ReadonlySet<string>,
): ExploreFindRoll {
  const table = exploreFindTable(tables, spot.kind, spot.terrain);
  if (!table) throw new Error(`no explore find table for "${spot.kind}"`);
  const finds = table.finds.filter((f) => f.lore === undefined || !foundLore.has(f.lore));
  if (finds.length === 0) return { items: {}, lore: null };
  const find = rng.weighted(finds);
  return { items: { ...(find.items ?? {}) }, lore: find.lore ?? null };
}
