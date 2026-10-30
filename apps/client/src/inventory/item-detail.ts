import { CARE_RULES, GAME_DATA, itemEffects, whereToFind } from '@heartpatch/shared';
import { FEED_ACTION } from '../care/food-pick.js';
import { whereText } from '../recipes/book-model.js';
import { itemName } from './bag-view.js';
import { itemChip, type ItemChip } from './item-chips.js';
import { itemIcon } from './item-icons.js';
import { usesLine } from './tool-uses.js';

// The card a tapped Bag item opens (#241): what it's for, as a line and
// chips, and where a gathered or seasonal one turns up. Pure, so it's
// unit-tested without the DOM.

export interface ItemDetail {
  readonly id: string;
  readonly name: string;
  readonly icon: string;
  readonly count: number;
  /** "You have 2", or a tool's uses: "12 dives left" (#199). */
  readonly have: string;
  /** The item's description: what it's for. */
  readonly purpose: string;
  /** A food's "Care: Feed" chip carries `feed`: tapping it opens care with that food picked. */
  readonly chips: readonly (ItemChip & { readonly feed?: string })[];
  /** "Mountains." for something found out in the world; null for a made thing. */
  readonly where: string | null;
}

const ITEMS = new Map(GAME_DATA.resources.map((r) => [r.id, r]));

/**
 * A made food (Pies, Frosty Treats) says what it's made from and where to
 * make it, like Treats do: a food's card is where a kid looks for more.
 */
const madeFood = (id: string): boolean =>
  ITEMS.get(id)?.kind === 'crafted' &&
  CARE_RULES.foods?.[id] !== undefined &&
  whereToFind(id).madeBy.length > 0;

export function itemDetail(id: string, count: number): ItemDetail {
  const item = ITEMS.get(id);
  const food = CARE_RULES.foods?.[id] !== undefined;
  const effects = itemEffects(id);
  const made = madeFood(id)
    ? [{ kind: 'made-from' as const, recipes: whereToFind(id).madeBy }]
    : [];
  const chips = [...made, ...effects].map((e) =>
    e.kind === 'care' && food && e.actions.includes(FEED_ACTION)
      ? { ...itemChip(e), feed: id }
      : itemChip(e),
  );
  return {
    id,
    name: itemName(id),
    icon: itemIcon(id),
    count,
    have: item?.tool ? usesLine(item.tool, count) : `You have ${String(count)}`,
    purpose: item?.description ?? '',
    chips,
    where: item && (item.kind !== 'crafted' || madeFood(id)) ? whereText(id) : null,
  };
}
