import { RECIPES, RESOURCES, type BattleItemEffect } from '@heartpatch/shared';
import { itemIcon } from '../inventory/item-icons.js';

// Battle potions (#214, owner decisions 2026-10-07): the "Use item" button
// next to "Use Heart Charm", the picker it opens, the pill chips, and the
// words for a sip. Every potion comes from shared data (`battleEffect`), so
// a new one needs no code here. Pure words and shapes for the HUD.

export interface BattlePotion {
  readonly id: string;
  readonly name: string;
  readonly icon: string;
  readonly effect: BattleItemEffect;
}

/** Every item usable in battle, in data order. */
export const BATTLE_POTIONS: readonly BattlePotion[] = RESOURCES.flatMap((r) =>
  r.battleEffect ? [{ id: r.id, name: r.name, icon: itemIcon(r.id), effect: r.battleEffect }] : [],
);

const POTIONS = new Map(BATTLE_POTIONS.map((p) => [p.id, p]));

export const potionOf = (id: string): BattlePotion | undefined => POTIONS.get(id);

/** "Use item (3)": every potion in the bag; no count while it loads. */
export function itemButtonLabel(total: number | null): string {
  return total === null ? 'Use item' : `Use item (${String(total)})`;
}

export type PotionTileState = 'ready' | 'empty' | 'used';

export interface PotionTile {
  readonly id: string;
  readonly name: string;
  readonly icon: string;
  /** How many are in the bag; null while it loads. */
  readonly count: number | null;
  readonly state: PotionTileState;
  /** One short line under the name (style guide §2: no numbers). */
  readonly tag: string;
}

/** The main effect in a few words; every potion also brings the sparkle shield. */
function effectTag(effect: BattleItemEffect): string {
  if (effect.attackPercent) return 'Bolder!';
  if (effect.defensePercent) return 'Softer bumps';
  return 'More energy';
}

/**
 * The picker's tiles: one per potion, dimmed with a reason when there's none
 * in the bag ("Make in Bag") or this side already had one this battle
 * ("Had one!").
 */
export function potionTiles(
  counts: Readonly<Record<string, number>> | null,
  used: readonly string[],
): PotionTile[] {
  return BATTLE_POTIONS.map((p) => {
    const count = counts ? (counts[p.id] ?? 0) : null;
    const state: PotionTileState = used.includes(p.id) ? 'used' : count === 0 ? 'empty' : 'ready';
    return {
      id: p.id,
      name: p.name,
      icon: p.icon,
      count,
      state,
      tag: state === 'used' ? 'Had one!' : state === 'empty' ? 'Make in Bag' : effectTag(p.effect),
    };
  });
}

/** Every potion in the bag, for the button's count. */
export function potionTotal(counts: Readonly<Record<string, number>> | null): number | null {
  if (!counts) return null;
  return BATTLE_POTIONS.reduce((sum, p) => sum + (counts[p.id] ?? 0), 0);
}

/** What a pill shows for its squishy: the potion boosts and a shield that's up. */
export interface PlateChips {
  readonly attack: boolean;
  readonly defense: boolean;
  readonly shield: boolean;
}

export const NO_CHIPS: PlateChips = { attack: false, defense: false, shield: false };

export function chipsOf(squishy: {
  readonly boosts: { readonly attack: number; readonly defense: number };
  readonly shield: number;
}): PlateChips {
  return {
    attack: squishy.boosts.attack > 0,
    defense: squishy.boosts.defense > 0,
    shield: squishy.shield > 0,
  };
}

/** The chips after drinking `id`: its boosts join the old ones, and its shield is up. */
export function chipsAfterDrinking(chips: PlateChips, id: string): PlateChips {
  const effect = potionOf(id)?.effect;
  if (!effect) return chips;
  return {
    attack: chips.attack || (effect.attackPercent ?? 0) > 0,
    defense: chips.defense || (effect.defensePercent ?? 0) > 0,
    shield: true,
  };
}

/** The pill's chips, with labels for screen readers (⚔️+ and 🛡️+ are the owner's). */
export const CHIP_LOOKS = {
  attack: { text: '⚔️+', label: 'Feeling bold' },
  defense: { text: '🛡️+', label: 'Softer bumps' },
  shield: { text: '✨', label: 'Sparkle shield' },
} as const;

/** The caption for a sip: "Emberbun sipped Brave Brew! Feeling bold!" */
export function sipLine(who: string, id: string): string {
  const potion = potionOf(id);
  if (!potion) return `${who} had a little snack!`;
  const { effect } = potion;
  if (effect.healPercent) return `${who} slurped ${potion.name}! Much better!`;
  return `${who} sipped ${potion.name}! ${effect.attackPercent ? 'Feeling bold!' : 'So snug!'}`;
}

export const SHIELD_CALLOUT = 'Sparkle shield!';
export const SHIELD_LINE = 'The sparkle shield soaked up most of it!';

/** The picker's question. */
export const pickLine = (who: string): string => `Pick a potion! It takes ${who}’s turn.`;

const NAMES = new Map(RESOURCES.map((r) => [r.id, r.name]));

/**
 * "No Cozy Cocoa yet! Make it from 2 Treats + 2 Timber in your Bag.", from
 * the real recipe, so retuning it changes the hint too.
 */
export function noPotionLine(id: string): string {
  const name = NAMES.get(id) ?? 'potion';
  const recipe = RECIPES.find((r) => r.output.resource === id);
  if (!recipe) return `No ${name} yet! Look in your Bag to make one.`;
  const parts = Object.entries(recipe.inputs).map(
    ([input, count]) => `${String(count)} ${NAMES.get(input) ?? input}`,
  );
  return `No ${name} yet! Make it from ${parts.join(' + ')} in your Bag.`;
}

/** "You already had Brave Brew this battle!" */
export const usedLine = (id: string): string =>
  `You already had ${NAMES.get(id) ?? 'that'} this battle!`;
