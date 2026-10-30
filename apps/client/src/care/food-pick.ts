import {
  CARE_RULES,
  foodPercentFor,
  GAME_DATA,
  type CareResult,
  type ElementId,
  type ItemCounts,
} from '@heartpatch/shared';
import { itemName } from '../inventory/bag-view.js';
import { itemIcon } from '../inventory/item-icons.js';

/*
 * The care sheet's food row (owner's pick 2026-10-30, option C): when the bag
 * holds more than plain Treats, a row of foods sits right above Feed with the
 * best one for this squishy already picked. Pure, so it's unit-tested without
 * the DOM. How much a food gives comes from `CARE_RULES.foods` through the
 * shared `foodPercentFor`, the same table the server feeds with; the client
 * only chooses which `itemId` to send.
 */

/** The feed: the care action paid with exactly one food (Treats). */
const FEED = GAME_DATA.careActions.find((a) => {
  const cost = Object.keys(a.cost ?? {});
  return cost.length === 1 && cost[0] !== undefined && CARE_RULES.foods?.[cost[0]] !== undefined;
});
/** The feed's own food, which the row is for doing without (Treats). */
const PLAIN = Object.keys(FEED?.cost ?? {})[0] ?? 'treats';
/** Every food, in the care rules' order (plain Treats first: the cheapest). */
const FOODS = Object.keys(CARE_RULES.foods ?? {});

export const FEED_ACTION = FEED?.id ?? 'feed';
export const PLAIN_FOOD = PLAIN;

// Player-facing text (style guide §2, §6).
export const FOOD_TEXT = {
  best: 'Best',
  // The picked food is extra yummy for this squishy.
  loves: (squishy: string, food: string) => `${squishy} loves ${food}!`,
  // A food that's extra yummy only for some elements, picked for another.
  bestFor: (food: string, element: string) => `${food} are best for ${element} squishies.`,
  tile: (food: string, n: number) => `${food}, ${String(n)}`,
  row: 'Pick a food',
} as const;

export interface FoodTile {
  readonly id: string;
  /** "🍧" */
  readonly icon: string;
  /** Short enough for a tile on an iPhone SE: "Frosty" for Frosty Treats. */
  readonly short: string;
  readonly name: string;
  readonly count: number;
  /** Percent of a feed's happiness it gives this squishy (`CARE_RULES.foods`). */
  readonly percent: number;
  /** The gold "Best" tag: the pre-picked food, when it beats plain Treats. */
  readonly best: boolean;
  readonly picked: boolean;
}

export interface FoodRow {
  readonly tiles: readonly FoodTile[];
  /** The food Feed sends now. */
  readonly picked: string;
  /** "Hailhop loves Frosty Treats!", or empty. */
  readonly hint: string;
}

const percentOf = (id: string, element: ElementId | undefined): number => {
  const rule = CARE_RULES.foods?.[id];
  return rule === undefined ? 100 : foodPercentFor(rule, element);
};

/** "Frosty" for "Frosty Treats": a long name keeps its first word on the tile. */
export function shortFoodName(name: string): string {
  return name.length > 8 ? (name.split(' ')[0] ?? name) : name;
}

/**
 * The best food in the bag for a squishy of `element`: the yummiest, then
 * the one there's most of, then the cheapest (the food table's order, plain
 * Treats first), so a tie never burns Pies by default. Null with no food.
 */
export function bestFood(items: ItemCounts, element: ElementId | undefined): string | null {
  const owned = FOODS.filter((id) => (items[id] ?? 0) > 0);
  const ranked = [...owned].sort(
    (a, b) =>
      percentOf(b, element) - percentOf(a, element) ||
      (items[b] ?? 0) - (items[a] ?? 0) ||
      FOODS.indexOf(a) - FOODS.indexOf(b),
  );
  return ranked[0] ?? null;
}

/**
 * The row for one squishy, or null when the bag holds no food but plain
 * Treats (or none at all): then the sheet is exactly as before. `pick` is
 * the player's tap; one that's run out falls back to the best.
 */
export function foodRow(
  items: ItemCounts,
  squishy: { readonly name: string; readonly element?: ElementId },
  pick: string | null,
): FoodRow | null {
  const owned = FOODS.filter((id) => (items[id] ?? 0) > 0);
  if (!owned.some((id) => id !== PLAIN)) return null;
  const best = bestFood(items, squishy.element) ?? PLAIN;
  const picked = pick !== null && owned.includes(pick) ? pick : best;
  const plain = percentOf(PLAIN, squishy.element);
  const tiles = owned.map((id): FoodTile => {
    const name = itemName(id);
    const percent = percentOf(id, squishy.element);
    return {
      id,
      icon: itemIcon(id),
      short: shortFoodName(name),
      name,
      count: items[id] ?? 0,
      percent,
      best: id === best && percent > plain,
      picked: id === picked,
    };
  });
  return { tiles, picked, hint: foodHint(picked, squishy) };
}

/** The line under the row for the picked food. */
export function foodHint(
  food: string,
  squishy: { readonly name: string; readonly element?: ElementId },
): string {
  const plain = percentOf(PLAIN, squishy.element);
  if (percentOf(food, squishy.element) > plain)
    return FOOD_TEXT.loves(squishy.name, itemName(food));
  const rule = CARE_RULES.foods?.[food];
  const fan =
    rule !== undefined && typeof rule !== 'number'
      ? Object.entries(rule.elements).find(([, p]) => p > plain)?.[0]
      : undefined;
  const element = GAME_DATA.elements.find((e) => e.id === fan)?.name;
  return element ? FOOD_TEXT.bestFor(itemName(food), element) : '';
}

/** "3 Pies", "1 Pie", "2 Frosty": the count under Feed for the picked food. */
export function foodCount(food: string, n: number): string {
  const short = shortFoodName(itemName(food));
  return `${String(n)} ${n === 1 && short.endsWith('s') ? short.slice(0, -1) : short}`;
}

/**
 * A feed the server says gave more than a plain one would at full value:
 * the big "Yum!" moment. From the reply, never a client guess, so a feed
 * past the day's full ones (or a plain Treat) gets the usual squash.
 */
export function bigFeed(result: Pick<CareResult, 'action' | 'contentmentGained'>): boolean {
  return result.action === FEED_ACTION && result.contentmentGained > (FEED?.contentment ?? 0);
}
