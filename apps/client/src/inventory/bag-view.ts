import {
  GAME_DATA,
  inSeason,
  shortfall,
  type Craft,
  type ItemCounts,
  type Recipe,
} from '@heartpatch/shared';
import { itemIcon } from './item-icons.js';

// What the bag shows (design doc §12): items with big numbers and a picture,
// and the recipes you can make. Pure, so it's unit-tested without the DOM.

export interface BagItem {
  readonly id: string;
  readonly name: string;
  readonly icon: string;
  readonly count: number;
}

const ITEMS = new Map(GAME_DATA.resources.map((r) => [r.id, r]));
const ORDER = new Map(GAME_DATA.resources.map((r, i) => [r.id, i]));
const SEASON_NAMES = new Map(GAME_DATA.seasons.map((s) => [s.id, s.name]));

export function itemName(id: string): string {
  return ITEMS.get(id)?.name ?? 'Mystery thing';
}

/** Items with a count above 0, in the resource table's order. */
export function bagItems(items: ItemCounts): BagItem[] {
  return Object.entries(items)
    .filter(([, count]) => count > 0)
    .sort(([a], [b]) => (ORDER.get(a) ?? Infinity) - (ORDER.get(b) ?? Infinity))
    .map(([id, count]) => ({ id, name: itemName(id), icon: itemIcon(id), count }));
}

/** "+5 🪵 Timber, +1 🔮 Witch Dust" for what a gather or craft gives. */
export function describeItems(items: ItemCounts): string {
  return Object.entries(items)
    .map(([id, n]) => `+${String(n)} ${itemIcon(id)} ${itemName(id)}`)
    .join(', ');
}

export type RecipeState =
  /** Tap "Make". */
  | { readonly kind: 'ready' }
  /** Not enough of something: what's missing. */
  | { readonly kind: 'short'; readonly note: string }
  /** Something else is being made. */
  | { readonly kind: 'busy' }
  /** A seasonal recipe outside its season. */
  | { readonly kind: 'sleeping'; readonly note: string };

export interface BagRecipe {
  readonly recipe: Recipe;
  readonly icon: string;
  /** "2 🪵 · 1 🍪" with what each needs. */
  readonly cost: string;
  readonly state: RecipeState;
}

export function bagRecipes(
  items: ItemCounts,
  crafts: readonly Craft[],
  seasons: readonly string[],
  recipes: readonly Recipe[] = GAME_DATA.recipes,
): BagRecipe[] {
  const on = new Set(seasons);
  return recipes.map((recipe) => {
    const cost = Object.entries(recipe.inputs)
      .map(([id, n]) => `${String(n)} ${itemIcon(id)}`)
      .join(' · ');
    const missing = shortfall(items, recipe.inputs);
    let state: RecipeState;
    if (!inSeason(recipe, on)) {
      const season = SEASON_NAMES.get(recipe.season ?? '') ?? 'its season';
      state = { kind: 'sleeping', note: `Only around ${season}.` };
    } else if (crafts.length > 0) {
      state = { kind: 'busy' };
    } else if (Object.keys(missing).length > 0) {
      const need = Object.entries(missing)
        .map(([id, n]) => `${String(n)} more ${itemName(id)}`)
        .join(', ');
      state = { kind: 'short', note: `Need ${need}.` };
    } else {
      state = { kind: 'ready' };
    }
    return { recipe, icon: itemIcon(recipe.output.resource), cost, state };
  });
}
