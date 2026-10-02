import type { ClothingItem } from '../schemas/data/clothing.js';
import type { ClothingDropTable } from '../schemas/data/clothing-drops.js';
import type { Rng } from '../rng/index.js';

/** Where and when a drop is rolled. */
export interface DropContext {
  /** Season ids on right now (map-local date). */
  readonly seasons: ReadonlySet<string>;
  /** The tile's terrain, when there is one. */
  readonly terrain?: string | undefined;
}

/**
 * The entries of `table` that can drop here and now: seasonal items only in
 * their season (design doc §15), terrain-bound ones only on their terrain.
 */
export function eligibleDrops(
  table: ClothingDropTable,
  context: DropContext,
  catalog: ReadonlyMap<string, ClothingItem>,
): ClothingDropTable['entries'] {
  return table.entries.filter((entry) => {
    const item = catalog.get(entry.item);
    if (!item) return false;
    if (item.season !== undefined && !context.seasons.has(item.season)) return false;
    if (entry.terrains && !entry.terrains.includes(context.terrain ?? '')) return false;
    return true;
  });
}

/**
 * Rolls one found-clothing drop: first the table's chance, then a weighted
 * pick among what can drop here and now. The item id, or null for nothing.
 * Always rolls the chance first, so the odds don't shift with the season.
 */
export function pickClothingDrop(
  table: ClothingDropTable,
  context: DropContext,
  catalog: ReadonlyMap<string, ClothingItem>,
  rng: Rng,
): string | null {
  if (!rng.chance(table.chance)) return null;
  const entries = eligibleDrops(table, context, catalog);
  if (entries.length === 0) return null;
  return rng.weighted(entries).item;
}
