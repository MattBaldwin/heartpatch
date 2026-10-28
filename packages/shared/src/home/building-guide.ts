import type { ItemCounts } from '../gathering/index.js';
import { patchRules, type PatchType } from '../patch-types/index.js';
import {
  buildsOnPatchType,
  type Building,
  type BuildingKind,
  type BuildingPlacement,
  type NeedsWaterSchema,
  type TravelBuilding,
} from '../schemas/data/buildings.js';
import type { HomeBaseRules } from '../schemas/data/home-base.js';
import type { WaterKind } from '../schemas/data/terrains.js';
import type { z } from 'zod';
import {
  buildingEffects,
  economyEffects,
  wildIsleEffects,
  type BuildingEffect,
  type EconomyEffect,
  type EconomyEffectRules,
  type WildIsleEffect,
} from './building-effects.js';
import { buildCost } from './costs.js';
import { isBuildableOn } from './water-works.js';

// The Buildings guide (#715): every building a patch can have, why it's
// worth building and where it goes, read straight from the building data
// (CLAUDE.md rule 5), so a new building shows up with no sheet code. Facts,
// not words: the client words each one (style guide) and asks its own Build
// sheet sources whether the picked tile fits, so the guide and the Build
// sheet never disagree. Nothing here is secret (rule 6). Pure.

/** The guide's shelves, in the order they show. */
export const GUIDE_GROUPS = [
  'fires',
  'home',
  'helpers',
  'resources',
  'water',
  'shelters',
  'travel',
  'fences',
] as const;
export type GuideGroup = (typeof GUIDE_GROUPS)[number];

const GROUP_OF: Record<BuildingKind, GuideGroup> = {
  hearthfire: 'fires',
  habitat: 'home',
  'training-grounds': 'helpers',
  factory: 'helpers',
  warehouse: 'helpers',
  vane: 'helpers',
  resource: 'resources',
  works: 'water',
  canal: 'water',
  shelter: 'shelters',
  travel: 'travel',
  fence: 'fences',
};

/** Why build one: what it does at level 1. */
export type GuideValue =
  | BuildingEffect
  | EconomyEffect
  | Exclude<WildIsleEffect, { kind: 'needs-water' }>
  /** A travel building: what it joins up (`reach` for a waystation). */
  | { readonly kind: 'travel'; readonly role: TravelBuilding['role']; readonly reach?: number }
  /** Taking it down gives every bit of it back (a Jack-o'-Lantern kit). */
  | { readonly kind: 'refund-all' };

/** Where it can go. */
export type GuidePlace =
  | { readonly kind: 'placement'; readonly placement: BuildingPlacement }
  /** It stands on water of this kind (a bridge), next to the player's land. */
  | { readonly kind: 'on-water'; readonly water: WaterKind }
  /** Only on land of this terrain (a resource building). */
  | { readonly kind: 'terrain'; readonly terrain: string }
  /** Only next to one of these. */
  | { readonly kind: 'needs-water'; readonly water: readonly z.infer<typeof NeedsWaterSchema>[] }
  /** On a tile's edges, priced per edge (a fence). */
  | { readonly kind: 'edges' }
  | { readonly kind: 'per-tile'; readonly max: number }
  /** How many one home base (or, out on the land, one patch) can have. */
  | { readonly kind: 'per-home'; readonly max: number; readonly atHome: boolean }
  /** Only on these patch types. */
  | { readonly kind: 'patch'; readonly patchTypes: readonly PatchType[] }
  /** Only built during this season. */
  | { readonly kind: 'season'; readonly season: string };

/** Why it can't be built yet: it waits on the "Coming later" shelf. */
export type GuideGate =
  /** A seasonal building out of its season: back next time. */
  | { readonly kind: 'season'; readonly season: string }
  /** In the data, but its rules aren't in the game yet (the Waystation). */
  | { readonly kind: 'not-yet' };

export interface BuildingGuideEntry {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly group: GuideGroup;
  readonly value: readonly GuideValue[];
  readonly place: readonly GuidePlace[];
  /** Null: buildable now. */
  readonly gate: GuideGate | null;
  /** Level 1, once (or per edge, when `place` has `edges`). */
  readonly cost: ItemCounts;
  /** What each level costs, level 1 first (an upgrade's price after that). */
  readonly levels: readonly ItemCounts[];
}

/** What the guide reads besides the building, all public data. */
export interface BuildingGuideContext {
  readonly patchType: PatchType;
  /** The seasons on today (map-local), by id. */
  readonly seasons: readonly string[];
  readonly rules: HomeBaseRules;
  readonly economy: EconomyEffectRules;
}

/**
 * One building's guide entry, or null when it never goes up on this patch
 * type (its `patchTypes` leave it out, or its terrain isn't there).
 */
export function buildingGuide(def: Building, ctx: BuildingGuideContext): BuildingGuideEntry | null {
  if (!buildsOnPatchType(def, ctx.patchType)) return null;
  if (
    def.kind === 'resource' &&
    !patchRules(ctx.patchType).terrains.some((t) => t.id === def.terrain)
  ) {
    return null;
  }
  let gate: GuideGate | null = null;
  if (!isBuildableOn(ctx.rules, def, ctx.patchType)) {
    // A Wild Isle kind its patch takes but whose rules still wait.
    if (def.kind !== 'travel') return null;
    gate = { kind: 'not-yet' };
  } else if (def.season !== undefined && !ctx.seasons.includes(def.season)) {
    gate = { kind: 'season', season: def.season };
  }
  return {
    id: def.id,
    name: def.name,
    description: def.description,
    group: GROUP_OF[def.kind],
    value: valueOf(def, ctx.economy),
    place: placeOf(def),
    gate,
    cost: buildCost(def),
    levels: def.levels.map((l) => l.cost),
  };
}

/** Every building this patch can have, shelf by shelf, in data order within a shelf. */
export function buildingsGuide(
  defs: readonly Building[],
  ctx: BuildingGuideContext,
): BuildingGuideEntry[] {
  const entries = defs.flatMap((d) => buildingGuide(d, ctx) ?? []);
  return GUIDE_GROUPS.flatMap((g) => entries.filter((e) => e.group === g));
}

function valueOf(def: Building, economy: EconomyEffectRules): GuideValue[] {
  const out: GuideValue[] = [
    ...buildingEffects(def),
    ...economyEffects(def, 1, economy),
    ...wildIsleEffects(def).filter(
      (e): e is Exclude<WildIsleEffect, { kind: 'needs-water' }> => e.kind !== 'needs-water',
    ),
  ];
  if (def.kind === 'travel') {
    out.push(
      def.reach === undefined
        ? { kind: 'travel', role: def.role }
        : { kind: 'travel', role: def.role, reach: def.reach },
    );
  }
  if (def.refundPercent === 100) out.push({ kind: 'refund-all' });
  return out;
}

function placeOf(def: Building): GuidePlace[] {
  const out: GuidePlace[] = [];
  if (def.kind === 'travel' && def.onWater !== undefined) {
    out.push({ kind: 'on-water', water: def.onWater });
  } else {
    out.push({ kind: 'placement', placement: def.placement });
  }
  if (def.kind === 'resource') out.push({ kind: 'terrain', terrain: def.terrain });
  if ('needsWater' in def && def.needsWater) {
    out.push({ kind: 'needs-water', water: def.needsWater });
  }
  if (def.slot === 'edge') out.push({ kind: 'edges' });
  const atHome = def.placement === 'home';
  if (def.maxPerHome !== undefined) out.push({ kind: 'per-home', max: def.maxPerHome, atHome });
  if (!atHome && def.maxPerTile !== undefined) out.push({ kind: 'per-tile', max: def.maxPerTile });
  if (def.patchTypes) out.push({ kind: 'patch', patchTypes: def.patchTypes });
  if (def.season !== undefined) out.push({ kind: 'season', season: def.season });
  return out;
}
