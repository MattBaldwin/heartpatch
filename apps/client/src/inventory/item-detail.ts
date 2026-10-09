import { GAME_DATA } from '@heartpatch/shared';
import { whereText } from '../recipes/book-model.js';
import { itemName } from './bag-view.js';
import { itemChips, type ItemChip } from './item-chips.js';
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
  readonly chips: readonly ItemChip[];
  /** "Mountains." for something found out in the world; null for a made thing. */
  readonly where: string | null;
}

const ITEMS = new Map(GAME_DATA.resources.map((r) => [r.id, r]));

export function itemDetail(id: string, count: number): ItemDetail {
  const item = ITEMS.get(id);
  return {
    id,
    name: itemName(id),
    icon: itemIcon(id),
    count,
    have: item?.tool ? usesLine(item.tool, count) : `You have ${String(count)}`,
    purpose: item?.description ?? '',
    chips: itemChips(id),
    where: item && item.kind !== 'crafted' ? whereText(id) : null,
  };
}
