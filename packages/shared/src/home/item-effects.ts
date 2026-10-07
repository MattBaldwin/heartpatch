import { GAME_DATA } from '../data/index.js';
import type { BuildingPlacement } from '../schemas/data/buildings.js';
import type { GameData } from '../schemas/data/game-data.js';
import { buildingEffects, type BuildingEffect } from './building-effects.js';

// What a bag item is for (#241), worked out from its data alone like
// `buildingEffects` (#207), so new content gets its recipe-book and Bag chips
// without engine code (CLAUDE.md rule 5). Only public data: nothing
// server-only (rule 6). The client words and decorates each effect.

/**
 * The item a wild battle's befriend move costs (#14). The battle server
 * spends it; this is the one rule about it that isn't in the content tables.
 */
export const BEFRIEND_ITEM = 'heart-charm';

export type ItemEffect =
  /** A battle item raises this stat for the whole battle. */
  | { readonly kind: 'boost'; readonly stat: 'attack' | 'defense'; readonly percent: number }
  /** A battle item gives back this share of full energy. */
  | { readonly kind: 'heal'; readonly percent: number }
  /** A battle item takes this share off the next bump. */
  | { readonly kind: 'shield'; readonly percent: number }
  /** It can be used in a battle. */
  | { readonly kind: 'battle' }
  /** It helps befriend a wild squishy. */
  | { readonly kind: 'befriend' }
  /** It's built into this building, where the building goes. */
  | { readonly kind: 'builds'; readonly building: string; readonly placement: BuildingPlacement }
  /** What the building it's built into does. */
  | { readonly kind: 'building'; readonly effect: BuildingEffect }
  /** Buildings it keeps going each night. */
  | { readonly kind: 'fuel'; readonly buildings: readonly string[] }
  /** Something you can also make: the recipes that make it. */
  | { readonly kind: 'made-from'; readonly recipes: readonly string[] }
  /** Recipes it goes into. */
  | { readonly kind: 'recipes'; readonly recipes: readonly string[] }
  /** Buildings it helps build. */
  | { readonly kind: 'build-with'; readonly buildings: readonly string[] }
  /** Buildings it only helps upgrade. */
  | { readonly kind: 'upgrades'; readonly buildings: readonly string[] }
  /** Care actions that use it. */
  | { readonly kind: 'care'; readonly actions: readonly string[] }
  /** A seasonal thing with no use yet: a keepsake. */
  | { readonly kind: 'keepsake'; readonly season: string };

type ItemData = Pick<GameData, 'resources' | 'recipes' | 'buildings' | 'careActions'>;

/**
 * What `resourceId` does, in the order a row shows it: what a made thing
 * does first, then what it goes into. Empty for an unknown id.
 */
export function itemEffects(resourceId: string, data: ItemData = GAME_DATA): ItemEffect[] {
  const item = data.resources.find((r) => r.id === resourceId);
  if (!item) return [];
  const effects: ItemEffect[] = [];

  const battle = item.battleEffect;
  if (battle) {
    if (battle.attackPercent) {
      effects.push({ kind: 'boost', stat: 'attack', percent: battle.attackPercent });
    }
    if (battle.defensePercent) {
      effects.push({ kind: 'boost', stat: 'defense', percent: battle.defensePercent });
    }
    if (battle.healPercent) effects.push({ kind: 'heal', percent: battle.healPercent });
    effects.push({ kind: 'shield', percent: battle.shieldPercent });
    effects.push({ kind: 'battle' });
  }
  if (item.id === BEFRIEND_ITEM) effects.push({ kind: 'befriend' });

  // A gathered or seasonal thing a recipe also makes (Treats from Pumpkins).
  // A made thing's own page already says how it's made.
  const makers = data.recipes.filter((r) => r.output.resource === item.id);
  if (item.kind !== 'crafted' && makers.length > 0) {
    effects.push({ kind: 'made-from', recipes: makers.map((r) => r.id) });
  }

  const firstCost = (b: (typeof data.buildings)[number]) => b.levels[0]?.cost ?? {};
  const inFirst = data.buildings.filter((b) => (firstCost(b)[item.id] ?? 0) > 0);
  // A made thing that's a building's whole point (the Jack-o'-Lantern) says
  // what it becomes; a gathered one is just one of the materials.
  if (item.kind === 'crafted') {
    for (const b of inFirst) {
      effects.push({ kind: 'builds', building: b.id, placement: b.placement });
      for (const effect of buildingEffects(b)) effects.push({ kind: 'building', effect });
    }
  } else if (inFirst.length > 0) {
    effects.push({ kind: 'build-with', buildings: inFirst.map((b) => b.id) });
  }

  const upgrades = data.buildings.filter(
    (b) =>
      !inFirst.includes(b) && b.levels.slice(1).some((level) => (level.cost[item.id] ?? 0) > 0),
  );
  if (upgrades.length > 0) effects.push({ kind: 'upgrades', buildings: upgrades.map((b) => b.id) });

  const fuel = data.buildings.filter((b) => b.kind === 'hearthfire' && b.fuelResource === item.id);
  if (fuel.length > 0) effects.push({ kind: 'fuel', buildings: fuel.map((b) => b.id) });

  const recipes = data.recipes.filter((r) => (r.inputs[item.id] ?? 0) > 0);
  if (recipes.length > 0) effects.push({ kind: 'recipes', recipes: recipes.map((r) => r.id) });

  const care = data.careActions.filter((c) => (c.cost?.[item.id] ?? 0) > 0);
  if (care.length > 0) effects.push({ kind: 'care', actions: care.map((c) => c.id) });

  if (effects.length === 0 && item.season) effects.push({ kind: 'keepsake', season: item.season });
  return effects;
}
