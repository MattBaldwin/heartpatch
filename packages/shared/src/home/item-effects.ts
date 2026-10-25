import { GAME_DATA } from '../data/index.js';
import type { BuildingPlacement } from '../schemas/data/buildings.js';
import { CARE_RULES } from '../data/care.js';
import { CLEARING_RULES } from '../data/clearing.js';
import { HOME_BASE_RULES } from '../data/home-base.js';
import type { ClearToolId } from '../schemas/data/clearing.js';
import type { ToolId } from '../schemas/data/explore.js';
import { isBuildable } from '../schemas/data/home-base.js';
import type { GameData } from '../schemas/data/game-data.js';
import { isAvailableRecipe } from '../schemas/data/recipes.js';
import { fedWith } from '../care/contentment.js';
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
  /** A tool for exploring your land (#199), counted in uses. */
  | { readonly kind: 'explore'; readonly tool: ToolId }
  /** A tool for clearing land (#242), counted in uses: the terrains it clears. */
  | { readonly kind: 'clear'; readonly tool: ClearToolId; readonly terrains: readonly string[] }
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
  | { readonly kind: 'keepsake'; readonly season: string }
  /** Wild Isle works that make it by themselves (#621 W1-8: a Fishing Pier's Fish). */
  | { readonly kind: 'made-at'; readonly buildings: readonly string[] };

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
  if (item.tool) effects.push({ kind: 'explore', tool: item.tool });
  const clears = item.clearTool;
  if (clears) {
    const terrains = CLEARING_RULES.terrains.filter((t) => t.tool === clears).map((t) => t.terrain);
    effects.push({ kind: 'clear', tool: clears, terrains });
  }

  // A gathered or seasonal thing a recipe also makes (Treats from Pumpkins).
  // A made thing's own page already says how it's made.
  const makers = data.recipes.filter((r) => isAvailableRecipe(r) && r.output.resource === item.id);
  if (item.kind !== 'crafted' && makers.length > 0) {
    effects.push({ kind: 'made-from', recipes: makers.map((r) => r.id) });
  }

  // Only buildings a player can build now (a gated kind, #601's, says nothing yet).
  const buildings = data.buildings.filter((b) => isBuildable(HOME_BASE_RULES, b));
  const firstCost = (b: (typeof data.buildings)[number]) => b.levels[0]?.cost ?? {};
  const inFirst = buildings.filter((b) => (firstCost(b)[item.id] ?? 0) > 0);
  // A made thing that's a building's whole cost (the Jack-o'-Lantern) says
  // what it becomes and what that does; anything else is one material.
  const whole = (b: (typeof data.buildings)[number]) =>
    item.kind === 'crafted' && Object.keys(firstCost(b)).length === 1;
  for (const b of inFirst.filter(whole)) {
    effects.push({ kind: 'builds', building: b.id, placement: b.placement });
    for (const effect of buildingEffects(b)) effects.push({ kind: 'building', effect });
  }
  const materials = inFirst.filter((b) => !whole(b));
  if (materials.length > 0) {
    effects.push({ kind: 'build-with', buildings: materials.map((b) => b.id) });
  }

  const upgrades = buildings.filter(
    (b) =>
      !inFirst.includes(b) && b.levels.slice(1).some((level) => (level.cost[item.id] ?? 0) > 0),
  );
  if (upgrades.length > 0) effects.push({ kind: 'upgrades', buildings: upgrades.map((b) => b.id) });

  const fuel = buildings.filter((b) => b.kind === 'hearthfire' && b.fuelResource === item.id);
  if (fuel.length > 0) effects.push({ kind: 'fuel', buildings: fuel.map((b) => b.id) });

  const recipes = data.recipes.filter((r) => isAvailableRecipe(r) && (r.inputs[item.id] ?? 0) > 0);
  if (recipes.length > 0) effects.push({ kind: 'recipes', recipes: recipes.map((r) => r.id) });

  // Its own cost, or a food (#621 W1-8b: Pies) that can pay for it instead.
  const care = data.careActions.filter(
    (c) => (c.cost?.[item.id] ?? 0) > 0 || fedWith(c, item.id, CARE_RULES) !== null,
  );
  if (care.length > 0) effects.push({ kind: 'care', actions: care.map((c) => c.id) });

  // Wild Isle works (#621 W1-8) that make it, for an item with nothing else
  // to say but the recipes it goes into (Fish, Flour and Salt: Pies): Water
  // and Greens keep today's chips, so a Cozy Patch's Bag reads as before.
  const works = data.buildings.filter((b) => b.kind === 'works' && b.makes.resource === item.id);
  const onlyRecipes = !effects.some((e) => e.kind !== 'recipes');
  if (onlyRecipes && works.length > 0) {
    effects.push({ kind: 'made-at', buildings: works.map((b) => b.id) });
  }

  if (effects.length === 0 && item.season) effects.push({ kind: 'keepsake', season: item.season });
  return effects;
}
