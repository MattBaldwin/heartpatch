import { GAME_DATA, itemEffects, type ItemEffect } from '@heartpatch/shared';
import { STAT_WORDS } from '../battle/battle-view.js';
import { buildingIcon, effectChip } from '../home/home-view.js';

// What a bag item is for, as chips (#241, mockup 2026-10-07):
// the recipe book and the Bag word `itemEffects` the same way. Battle chips
// are drawn green like the book's potion line; the rest like the build menu.

export interface ItemChip {
  readonly text: string;
  /** A battle effect (drawn green). */
  readonly battle: boolean;
}

const BUILDING_NAMES = new Map(GAME_DATA.buildings.map((b) => [b.id, b.name]));
const RECIPE_NAMES = new Map(GAME_DATA.recipes.map((r) => [r.id, r.name]));
const RECIPES = new Map(GAME_DATA.recipes.map((r) => [r.id, r]));
const ITEM_NAMES = new Map(GAME_DATA.resources.map((r) => [r.id, r.name]));
const CARE_NAMES = new Map(GAME_DATA.careActions.map((c) => [c.id, c.name]));
const SEASON_NAMES = new Map(GAME_DATA.seasons.map((s) => [s.id, s.name]));

const building = (id: string) => BUILDING_NAMES.get(id) ?? id;
const article = (name: string) => (/^[aeiou]/i.test(name) ? `an ${name}` : `a ${name}`);

/** "A", "A and B", "A, B and more": a chip stays one short line. */
function few(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? '';
  if (names.length === 2) return `${names[0] ?? ''} and ${names[1] ?? ''}`;
  return `${names.slice(0, 2).join(', ')} and more`;
}

/** One item effect as a chip. */
export function itemChip(effect: ItemEffect): ItemChip {
  const chip = (text: string, battle = false): ItemChip => ({ text, battle });
  switch (effect.kind) {
    case 'boost':
      return chip(
        `${effect.stat === 'attack' ? '💪' : '🧸'} +${String(effect.percent)}% ${STAT_WORDS[effect.stat]} all battle`,
        true,
      );
    case 'heal':
      return chip(`💚 Heals ${String(effect.percent)}% energy`, true);
    case 'shield':
      return chip(`🫧 Next bump ${String(effect.percent)}% softer`, true);
    case 'battle':
      return chip('🎒 Use it in a battle');
    case 'befriend':
      return chip('💗 Helps befriend a wild squishy');
    case 'builds':
      return chip(`${buildingIcon(effect.building)} Builds ${article(building(effect.building))}`);
    case 'building':
      return chip(effectChip(effect.effect));
    case 'fuel':
      return chip('🪵 Keeps fires lit at night');
    case 'made-from': {
      // What goes in, across every recipe that makes it: "Made from Pumpkins".
      const inputs = [
        ...new Set(effect.recipes.flatMap((r) => Object.keys(RECIPES.get(r)?.inputs ?? {}))),
      ];
      return chip(`🥣 Made from ${few(inputs.map((i) => ITEM_NAMES.get(i) ?? i))}`);
    }
    case 'recipes':
      return chip(`🍳 Goes into ${few(effect.recipes.map((r) => RECIPE_NAMES.get(r) ?? r))}`);
    case 'build-with':
      return chip(`🔨 For building ${few(effect.buildings.map(building))}`);
    case 'upgrades': {
      const names = effect.buildings.map(building);
      return chip(`⬆️ Upgrades ${names.length === 1 ? article(names[0] ?? '') : few(names)}`);
    }
    case 'care':
      return chip(`🤗 Care: ${effect.actions.map((a) => CARE_NAMES.get(a) ?? a).join(' · ')}`);
    case 'keepsake':
      return chip(`🎀 A ${SEASON_NAMES.get(effect.season) ?? effect.season} keepsake`);
  }
}

/** Every chip for a bag item, in order. */
export function itemChips(resourceId: string): ItemChip[] {
  return itemEffects(resourceId).map(itemChip);
}
