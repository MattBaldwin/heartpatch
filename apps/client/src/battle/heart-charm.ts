import {
  befriendedOf,
  GAME_DATA,
  joiningSpecies,
  RECIPES,
  RESOURCES,
  TILE_BATTLE_KINDS,
  type EvolutionStep,
  type PlayerBattle,
} from '@heartpatch/shared';
import { otherSide } from './battle-view.js';

// The "Use Heart Charm" button in wild battles (owner decision 2026-10-04)
// and against neutral land's guardians (#279): always there, with how many
// are in the bag, so a player learns that befriending exists even before
// they have a charm. Pure words for the HUD.

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

/** Every public evolution, for naming the form a land guardian joins as. */
const PUBLIC_STEPS: readonly EvolutionStep[] = GAME_DATA.species.flatMap((s) =>
  s.evolutions.map((e) => ({ from: s.id, into: e.into, level: e.level })),
);

/**
 * The species that joined the player in `battle`, in team order (#279): a
 * wild squishy as it was; a land guardian one evolution back from the form
 * it fought as (owner decision 2026-10-08), as the server grants it.
 */
export function newFriends(battle: PlayerBattle): string[] {
  const friends = befriendedOf(battle.view, otherSide(battle.mySide));
  return friends.map((s) =>
    TILE_BATTLE_KINDS.has(battle.kind) ? joiningSpecies(s.speciesId, PUBLIC_STEPS) : s.speciesId,
  );
}

/** "Moonpuff joined your patch!", "Moonpuff and Snoozlet joined your patch!" */
export function joinedLine(names: readonly string[]): string {
  const last = names.at(-1) ?? 'Your new squishy';
  const who = names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${last}` : last;
  return `${who} joined your patch!`;
}
