import { RECIPES, RESOURCES } from '@heartpatch/shared';

// The "Use Heart Charm" button in wild battles (owner decision 2026-10-04):
// always there, with how many are in the bag, so a player learns that
// befriending exists even before they have a charm. Pure words for the HUD.

/** What a capture costs (the server's `HEART_CHARM`). */
export const HEART_CHARM = 'heart-charm';

export interface CharmButton {
  readonly label: string;
  /** Out of charms: the button shows dimmed and explains instead of acting. */
  readonly empty: boolean;
}

/** The button for `count` charms in the bag; `null` while the count is still loading. */
export function charmButton(count: number | null): CharmButton {
  if (count === null) return { label: 'Use Heart Charm', empty: false };
  return { label: `Use Heart Charm (${String(count)})`, empty: count <= 0 };
}

const NAMES = new Map(RESOURCES.map((r) => [r.id, r.name]));

/** "2 Timber", "1 Treat": a resource name for a count (plain plural `s` dropped for one). */
function amount(id: string, count: number): string {
  const name = NAMES.get(id) ?? id;
  const word = count === 1 && name.endsWith('s') ? name.slice(0, -1) : name;
  return `${String(count)} ${word}`;
}

/**
 * "No Heart Charms! Craft one from 2 Timber + 1 Treat in your Bag.", from
 * the real recipe, so retuning it changes the hint too.
 */
export function noCharmsLine(): string {
  const recipe = RECIPES.find((r) => r.output.resource === HEART_CHARM);
  if (!recipe) return 'No Heart Charms! Look in your Bag to make one.';
  const parts = Object.entries(recipe.inputs).map(([id, count]) => amount(id, count));
  return `No Heart Charms! Craft one from ${parts.join(' + ')} in your Bag.`;
}

/** After a won wild battle where nobody was befriended. */
export const BEFRIEND_NUDGE = 'Weaken a wild squishy, then use a Heart Charm to befriend it!';
