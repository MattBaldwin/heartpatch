import {
  GAME_DATA,
  inSeason,
  needMoreText,
  shortfall,
  type Craft,
  type Gather,
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
const RECIPE_NAMES = new Map(GAME_DATA.recipes.map((r) => [r.id, r.name]));

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

/**
 * The pop-up when things land in the bag (owner decision 2026-10-06):
 * "🍪 +3 Treats!" or "🪵 +5 Timber, 🍪 +3 Treats!", everything that landed
 * at once added up. Empty when nothing did.
 */
export function landedText(landed: readonly { items: ItemCounts }[]): string {
  const total: ItemCounts = {};
  for (const { items } of landed) {
    for (const [id, n] of Object.entries(items)) total[id] = (total[id] ?? 0) + n;
  }
  const parts = Object.entries(total)
    .filter(([, n]) => n > 0)
    .sort(([a], [b]) => (ORDER.get(a) ?? Infinity) - (ORDER.get(b) ?? Infinity))
    .map(([id, n]) => `${itemIcon(id)} +${String(n)} ${itemName(id)}`);
  return parts.length === 0 ? '' : `${parts.join(', ')}!`;
}

/** What the gathering chip over the map shows: one gather, and how many others. */
export interface GatherChip {
  /** A gather that's ready to collect, else the one ready soonest. */
  readonly gather: Gather;
  readonly ready: boolean;
  /** Other gathers going on at the same time. */
  readonly more: number;
}

/**
 * The gathering chip (design doc §12): a gather runs for minutes on a patch,
 * so the map keeps saying so until it's collected. Null when nothing's going.
 */
export function gatherChip(
  gathers: readonly Gather[],
  msUntil: (iso: string) => number,
): GatherChip | null {
  const ready = gathers.find((g) => msUntil(g.readyAt) <= 0);
  const soonest = [...gathers].sort((a, b) => Date.parse(a.readyAt) - Date.parse(b.readyAt))[0];
  const gather = ready ?? soonest;
  if (!gather) return null;
  return { gather, ready: ready !== undefined, more: gathers.length - 1 };
}

/** A craft on the go or waiting to be collected, as the bag lists it. */
export interface BagCraft {
  readonly craft: Craft;
  /** The recipe's name, or what it makes when the recipe is gone from the data. */
  readonly name: string;
  readonly icon: string;
}

/**
 * Every craft the server says is on the go or ready, soonest first, whatever
 * its recipe or season: the bag is the one place that always offers Collect,
 * so a craft from an old recipe or a season that's over is never stuck.
 */
export function bagCrafts(crafts: readonly Craft[]): BagCraft[] {
  return [...crafts]
    .sort((a, b) => Date.parse(a.readyAt) - Date.parse(b.readyAt))
    .map((craft) => {
      const output = Object.keys(craft.items)[0] ?? craft.recipeId;
      return {
        craft,
        name: RECIPE_NAMES.get(craft.recipeId) ?? itemName(output),
        icon: itemIcon(output),
      };
    });
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
      state = { kind: 'short', note: needMoreText(missing, GAME_DATA.resources) };
    } else {
      state = { kind: 'ready' };
    }
    return { recipe, icon: itemIcon(recipe.output.resource), cost, state };
  });
}
