import { GAME_DATA } from '../data/index.js';
import { HOME_BASE_RULES } from '../data/home-base.js';
import { RECIPE_BOOK } from '../data/recipe-book.js';
import { shortfall, type ItemCounts } from '../gathering/index.js';
import { buildCost } from '../home/costs.js';
import type { GameData } from '../schemas/data/game-data.js';
import { isBuildable, type HomeBaseRules } from '../schemas/data/home-base.js';

// The recipe book (owner decision 2026-10-05, design doc §12–13): one page per
// craft recipe and per home-buildable building. A page opens the first time
// the account has collected every ingredient it needs, on any patch; a few
// are always open. Pure and deterministic: the server passes in what the
// account has ever collected, and refuses to make a sealed page.

/** `recipe:<recipeId>` or `building:<buildingId>`. */
export type RecipeBookPageKey = `recipe:${string}` | `building:${string}`;

export const recipePageKey = (recipeId: string): RecipeBookPageKey => `recipe:${recipeId}`;
export const buildingPageKey = (buildingId: string): RecipeBookPageKey => `building:${buildingId}`;

/** What a page makes: an item in the bag, or a building on the home base. */
export type RecipeBookOutput =
  { kind: 'item'; resource: string; quantity: number } | { kind: 'building'; building: string };

export interface RecipeBookPage {
  key: RecipeBookPageKey;
  kind: 'recipe' | 'building';
  /** The recipe or building id. */
  id: string;
  name: string;
  description: string;
  /** What making it uses: a recipe's inputs, or a building's level-1 cost. */
  ingredients: ItemCounts;
  /** How long it takes to make; null for buildings (they go up at once). */
  seconds: number | null;
  /** Only makeable in this season (existing season rules); null any time. */
  season: string | null;
  output: RecipeBookOutput;
}

/**
 * Every page, make pages (recipes) first in data order, then build pages
 * (buildings whose kind is buildable today) in data order.
 */
export function recipeBookPages(
  data: Pick<GameData, 'recipes' | 'buildings'> = GAME_DATA,
  rules: HomeBaseRules = HOME_BASE_RULES,
): RecipeBookPage[] {
  const make = data.recipes.map((r): RecipeBookPage => ({
    key: recipePageKey(r.id),
    kind: 'recipe',
    id: r.id,
    name: r.name,
    description: r.description,
    ingredients: { ...r.inputs },
    seconds: r.craftSeconds,
    season: r.season ?? null,
    output: { kind: 'item', resource: r.output.resource, quantity: r.output.quantity },
  }));
  const build = data.buildings
    .filter((b) => isBuildable(rules, b))
    .map((b): RecipeBookPage => ({
      key: buildingPageKey(b.id),
      kind: 'building',
      id: b.id,
      name: b.name,
      description: b.description,
      ingredients: buildCost(b),
      seconds: null,
      season: b.season ?? null,
      output: { kind: 'building', building: b.id },
    }));
  return [...make, ...build];
}

/** Is this page open? Always-open, or every ingredient has been collected at least once. */
export function isPageUnlocked(
  page: Pick<RecipeBookPage, 'key' | 'ingredients'>,
  everCollected: ReadonlySet<string>,
  alwaysOpen: readonly string[] = RECIPE_BOOK.alwaysOpen,
): boolean {
  return (
    alwaysOpen.includes(page.key) ||
    Object.keys(page.ingredients).every((id) => everCollected.has(id))
  );
}

/** The keys of every open page, given the item ids the account has ever collected. */
export function unlockedPageKeys(
  pages: readonly Pick<RecipeBookPage, 'key' | 'ingredients'>[],
  everCollected: ReadonlySet<string>,
  alwaysOpen: readonly string[] = RECIPE_BOOK.alwaysOpen,
): Set<RecipeBookPageKey> {
  return new Set(
    pages.filter((p) => isPageUnlocked(p, everCollected, alwaysOpen)).map((p) => p.key),
  );
}

/** The kid-voice hint a sealed page shows, or null (always-open pages have none). */
export function sealedHint(key: string, book = RECIPE_BOOK): string | null {
  return book.sealedHints.find((h) => h.page === key)?.line ?? null;
}

/** Does the bag hold everything this page uses right now? (Seasons are checked separately.) */
export function canMakeNow(page: Pick<RecipeBookPage, 'ingredients'>, bag: ItemCounts): boolean {
  return Object.keys(shortfall(bag, page.ingredients)).length === 0;
}

/** Public facts about where an item turns up, for a page's ingredient list. */
export interface WhereToFind {
  /** Terrains whose resource nodes give it, in data order. */
  terrains: string[];
  /** Every home ring has a node of it (`mapGen.homeRingNodes`). */
  homeRing: boolean;
  /** Resources whose gathers can bring it along as a bonus (`gather.extras`). */
  bonusFrom: string[];
  /** Recipes that make it. */
  madeBy: string[];
  /** Its season, or null if it's around all year. */
  season: string | null;
}

/** Where to look for an item, from public gather, terrain, map and recipe data only. */
export function whereToFind(
  resourceId: string,
  data: Pick<GameData, 'resources' | 'terrains' | 'mapGen' | 'recipes'> = GAME_DATA,
): WhereToFind {
  return {
    terrains: data.terrains.filter((t) => t.nodeResources.includes(resourceId)).map((t) => t.id),
    homeRing: data.mapGen.homeRingNodes.includes(resourceId),
    bonusFrom: data.resources
      .filter((r) => r.gather?.extras?.some((e) => e.resource === resourceId) ?? false)
      .map((r) => r.id),
    madeBy: data.recipes.filter((r) => r.output.resource === resourceId).map((r) => r.id),
    season: data.resources.find((r) => r.id === resourceId)?.season ?? null,
  };
}
