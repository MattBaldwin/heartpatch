import { GAME_DATA, STARTERS, type ItemCounts, type Species } from '@heartpatch/shared';

// What the "Choose your friend!" screen shows (owner decision 2026-10-03):
// the three starters from shared data, as kid-readable cards. Pure, so the
// screen's logic is tested without a DOM or a renderer.

export const STARTER_TEXT = {
  title: 'Choose your friend!',
  subtitle: 'Who will be your first squishy here?',
  hint: 'Tap a friend below to meet them.',
  choose: 'Choose',
  choosing: 'One moment…',
  loadFailed: 'We couldn’t reach your patch. Check your connection and try again!',
  /** After the account's first pick, with Sprout's gift (owner decision 2026-10-04). */
  giftHint: 'Offer one to a wild squishy to make a new friend!',
  giftDone: 'Let’s go!',
} as const;

/** One starter's card. */
export interface StarterCard {
  readonly speciesId: string;
  readonly name: string;
  /** Element and feeling names, as players say them ("Water", "Silly"). */
  readonly element: string;
  readonly feeling: string;
  readonly description: string;
  /** The species' main vinyl colour, for the card's accent. */
  readonly color: string;
  /** Read out for the card button: "Puddlepuff, Water and Silly". */
  readonly label: string;
}

const elementNames = new Map(GAME_DATA.elements.map((e) => [e.id, e.name]));
const feelingNames = new Map(GAME_DATA.feelings.map((f) => [f.id, f.name]));
const speciesById = new Map(GAME_DATA.species.map((s) => [s.id, s]));

/** The starter species, in `STARTERS` order (a missing one would be a data bug). */
export function starterSpecies(): Species[] {
  return STARTERS.speciesIds.map((id) => {
    const species = speciesById.get(id);
    if (!species) throw new Error(`starter species ${id} is missing`);
    return species;
  });
}

/** The three cards, in `STARTERS` order. */
export function starterCards(): StarterCard[] {
  return starterSpecies().map((s) => {
    const element = elementNames.get(s.element) ?? s.element;
    const feeling = feelingNames.get(s.feeling) ?? s.feeling;
    return {
      speciesId: s.id,
      name: s.name,
      element,
      feeling,
      description: s.description,
      color: s.visual.palette[0] ?? '#c9b8ff',
      label: `${s.name}, ${element} and ${feeling}`,
    };
  });
}

/** The confirm button's words: nothing picked yet, or "Choose Puddlepuff". */
export function chooseLabel(picked: StarterCard | null): string {
  return picked ? `${STARTER_TEXT.choose} ${picked.name}` : STARTER_TEXT.choose;
}

/**
 * Where each starter stands in the preview, left to right like the cards
 * under it: `spacing` apart, centred on x = 0.
 */
export function starterSpots(count: number, spacing: number): number[] {
  return Array.from({ length: count }, (_, i) => (i - (count - 1) / 2) * spacing);
}

/**
 * The card the pick starts on: the player's tutorial Partner (#24), if it's
 * one of the cards, else none. They can still tap another.
 */
export function preselectedCard(
  cards: readonly StarterCard[],
  speciesId: string | null,
): StarterCard | null {
  return cards.find((c) => c.speciesId === speciesId) ?? null;
}

/** The gift card's heading: "Puddlepuff is your friend!" */
export function giftTitle(picked: Pick<StarterCard, 'name'>): string {
  return `${picked.name} is your friend!`;
}

const itemNames = new Map(GAME_DATA.resources.map((r) => [r.id, r.name]));

/**
 * What Sprout tucked into the bag with the account's first pick, in one
 * kid-readable line ("Sprout tucked 3 Heart Charms in your Bag!"), or null
 * when there's no gift (any later pick).
 */
export function giftLine(gift: ItemCounts): string | null {
  const parts = Object.entries(gift)
    .filter(([, n]) => n > 0)
    .map(([id, n]) => {
      const name = itemNames.get(id) ?? id;
      // "Treats" is already plural.
      return `${String(n)} ${n === 1 || name.endsWith('s') ? name : `${name}s`}`;
    });
  if (parts.length === 0) return null;
  const list =
    parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(', ')} and ${parts.at(-1) ?? ''}`;
  return `Sprout tucked ${list ?? ''} in your Bag!`;
}
