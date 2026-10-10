import {
  CLOTHING,
  CLOTHING_BY_ID,
  SQUISHY_SLOT,
  type ClothingItem,
  type OwnedClothing,
  type Rarity,
} from '@heartpatch/shared';
import { RARITY_NAMES } from '../ui/rarity/rarity.js';

// Dress up (#340): the close-up's picker for a squishy accessory. Pure: what
// the picker lists and says. The screen sends the choice to the server, which
// checks it (`POST …/squishies/:squishyId/accessory`, CLAUDE.md rule 1).

export const DRESS_UP_TEXT = {
  open: 'Dress up',
  title: (name: string) => `Dress up ${name}`,
  hint: 'Tap one to put it on!',
  nothing: 'Nothing',
  takeOff: 'Take it off',
  wearing: '✓ Wearing',
  done: 'Done',
  loading: 'Finding your accessories…',
  loves: (name: string, item: string) => `${name} loves the ${item}!`,
  tookOff: (name: string) => `${name} is all cozy as they are.`,
} as const;

/** One button in the picker: an accessory, or "Nothing" (`itemId` null) to take it off. */
export interface DressUpChoice {
  readonly itemId: string | null;
  readonly name: string;
  /** Under the name: its rarity, or "Wearing" for the one it has on. */
  readonly sub: string;
  /** The swatch: the piece's first colour (null for "Nothing"). */
  readonly color: string | null;
  readonly rarity: Rarity | null;
  readonly on: boolean;
}

const ORDER = new Map(CLOTHING.map((item, i) => [item.id, i]));

/** A squishy accessory from the catalog, or null for anything else. */
export function accessoryItem(id: string | null | undefined): ClothingItem | null {
  const item = id ? CLOTHING_BY_ID.get(id) : undefined;
  return item?.slot === SQUISHY_SLOT ? item : null;
}

/**
 * "Nothing" first, then every squishy accessory the player owns, in catalog
 * order. One owned piece dresses any of their squishies (DECISIONS
 * "Wardrobe (#43)"), so counts don't matter here.
 */
export function dressUpChoices(
  owned: readonly OwnedClothing[],
  wearing: string | null,
): DressUpChoice[] {
  const items = owned
    .flatMap(({ itemId }) => accessoryItem(itemId) ?? [])
    .sort((a, b) => (ORDER.get(a.id) ?? 0) - (ORDER.get(b.id) ?? 0));
  return [
    {
      itemId: null,
      name: DRESS_UP_TEXT.nothing,
      sub: DRESS_UP_TEXT.takeOff,
      color: null,
      rarity: null,
      on: wearing === null,
    },
    ...items.map((item) => ({
      itemId: item.id,
      name: item.name,
      sub: item.id === wearing ? DRESS_UP_TEXT.wearing : RARITY_NAMES[item.rarity],
      color: item.visual.pieces[0]?.color ?? null,
      rarity: item.rarity,
      on: item.id === wearing,
    })),
  ];
}

/** What the picker says once the server kept a choice. */
export function dressedLine(name: string, itemId: string | null): string {
  const item = accessoryItem(itemId);
  return item ? DRESS_UP_TEXT.loves(name, item.name) : DRESS_UP_TEXT.tookOff(name);
}
