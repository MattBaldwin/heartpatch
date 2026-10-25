import type {
  Building,
  NeedsWaterSchema,
  ResourceBuildingRules,
} from '../schemas/data/buildings.js';
import type { ElementId, FeelingId } from '../schemas/data/elements.js';
import type { ExploreRules } from '../schemas/data/explore.js';
import type { JobRules } from '../schemas/data/jobs.js';
import type { WeatherKind } from '../schemas/data/weather.js';
import type { ItemCounts } from '../gathering/index.js';
import type { z } from 'zod';
import { productionCycleSeconds, productionSource, worksSource } from './production.js';

// What a building does (#207), worked out from its data alone, so a new
// building gets its build-menu chips without engine code (CLAUDE.md rule 5).
// Only public building data: nothing server-only (rule 6). The client words
// and decorates each effect.

export type BuildingEffect =
  /** A Hearthfire: squishies this many tiles around it are safe at night. */
  | { readonly kind: 'safe'; readonly radius: number }
  /** A Hearthfire burns fuel every night it's lit. */
  | { readonly kind: 'fuel'; readonly perNight: number }
  /** A habitat: squishies with these tags grow faster living there. */
  | {
      readonly kind: 'grows';
      readonly elements: readonly ElementId[];
      readonly feelings: readonly FeelingId[];
    }
  /** How many squishies live there. */
  | { readonly kind: 'room'; readonly capacity: number }
  /** Training Grounds: how many practice at once, and the XP each earns an hour. */
  | { readonly kind: 'training'; readonly capacity: number; readonly xpPerHour: number }
  /**
   * A fence (#203): keeps challengers out until they break it. `hp` is its
   * energy at this level; `element` its material's (what cracks it fast).
   */
  | { readonly kind: 'fence'; readonly hp: number; readonly element: ElementId }
  /** The Crafting Factory (#294): how many batches it runs at once. */
  | { readonly kind: 'batches'; readonly queues: number };

/**
 * What `building` does at `level` (1 = just built), in the order a row shows
 * it. A level past its last one reads as its last.
 */
export function buildingEffects(building: Building, level = 1): BuildingEffect[] {
  const at = <T>(levels: readonly T[]): T => levelRow(levels, level);
  switch (building.kind) {
    case 'hearthfire':
      return [
        { kind: 'safe', radius: at(building.levels).safeRadius },
        { kind: 'fuel', perNight: building.fuelPerNight },
      ];
    case 'habitat':
      return [
        { kind: 'grows', elements: building.tags.elements, feelings: building.tags.feelings },
        { kind: 'room', capacity: at(building.levels).capacity },
      ];
    case 'training-grounds': {
      const { capacity, xpPerHour } = at(building.levels);
      return [{ kind: 'training', capacity, xpPerHour }];
    }
    case 'fence':
      return [{ kind: 'fence', hp: at(building.levels).hp, element: building.element }];
    case 'factory':
      return [{ kind: 'batches', queues: at(building.levels).queues }];
    case 'resource':
    case 'warehouse':
      // Their effects need the job rules: `economyEffects`.
      return [];
    case 'works':
    case 'canal':
    case 'shelter':
    case 'vane':
    case 'travel':
      // Wild Isle kinds (#621): `wildIsleEffects` (and a works' output,
      // `economyEffects`), kept apart so an older build menu stays exhaustive.
      return [];
  }
}

/**
 * Picks a level's row. Levels are 1-based; anything below 1 reads as 1 and
 * past the last as the last. The schema requires at least one level, so the
 * last always exists.
 */
function levelRow<T>(levels: readonly T[], level: number): T {
  const i = Math.min(Math.max(Math.floor(level) || 1, 1), levels.length) - 1;
  return (levels[i] ?? levels[levels.length - 1]) as T;
}

/**
 * What a patch-economy building does (#601), for its build card. Kept apart
 * from `BuildingEffect` until the client words them (#601 PR 7), so an
 * older build menu's chips stay exhaustive.
 */
export type EconomyEffect =
  /**
   * A resource building: what it makes an hour on a joined homestead, how
   * many hours of it it holds, and its Heart Coins a morning.
   */
  | {
      readonly kind: 'produces';
      readonly resource: string;
      readonly perHour: number;
      readonly storageHours: number;
      readonly upkeep: number;
    }
  /** The Warehouse: buildings from this level up deliver to the bag; its Heart Coins a morning. */
  | { readonly kind: 'delivers'; readonly fromLevel: number; readonly upkeep: number };

/** The rules `economyEffects` reads, all public data. */
export interface EconomyEffectRules {
  readonly jobs: Pick<JobRules, 'work' | 'terrainYields'>;
  readonly explore: Pick<ExploreRules, 'homestead'>;
  readonly resourceBuildings: Pick<ResourceBuildingRules, 'warehouseDeliversFromLevel'>;
}

/**
 * What a resource building or the Warehouse does at `level` (1 = just
 * built); `[]` for any other building. A level past its last reads as its last.
 */
export function economyEffects(
  building: Building,
  level: number,
  rules: EconomyEffectRules,
): EconomyEffect[] {
  if (building.kind === 'warehouse') {
    const { upkeep } = levelRow(building.levels, level);
    return [
      { kind: 'delivers', fromLevel: rules.resourceBuildings.warehouseDeliversFromLevel, upkeep },
    ];
  }
  if (building.kind !== 'resource' && building.kind !== 'works') return [];
  const row = levelRow(building.levels, level);
  // A Wild Isle works (#621 W1-8): its own `makes`, at 100 % pace.
  const source =
    building.kind === 'works'
      ? worksSource(building)
      : productionSource(building, rules.jobs, rules.explore);
  if (!source) return [];
  const cycle = productionCycleSeconds(source.seconds, row, rules.jobs);
  return [
    {
      kind: 'produces',
      resource: source.resource,
      perHour: Math.floor((source.perCycle * 3600) / cycle),
      storageHours: row.storageHours,
      upkeep: row.upkeep,
    },
  ];
}

/**
 * What a Wild Isle building does besides making things (#621 W1-8), for its
 * build card. Its own union, like `EconomyEffect` was, so the client words
 * these before any older chip switch sees one.
 */
export type WildIsleEffect =
  /** It only stands next to one of these (an edge-to-edge neighbour). */
  | { readonly kind: 'needs-water'; readonly water: readonly z.infer<typeof NeedsWaterSchema>[] }
  /** It takes these from the bag each cycle (a Watermill's Greens). */
  | { readonly kind: 'eats'; readonly items: Readonly<ItemCounts> }
  /** Its pace under a front of each kind, as a whole percent. */
  | {
      readonly kind: 'weather';
      readonly percent: Readonly<Partial<Record<WeatherKind, number>>>;
    }
  /** It only works under a front of this kind (the Rain Barrel). */
  | { readonly kind: 'only-while'; readonly weather: WeatherKind }
  /** A Canal: carries water this many canals inland. */
  | { readonly kind: 'carries-water'; readonly maxRun: number }
  /** A Levee or Seawall: buildings this many tiles around are kept from these. */
  | {
      readonly kind: 'shelters';
      readonly radius: number;
      readonly from: readonly ('storm' | 'flood')[];
    }
  /** The Weather Vane: its owner sees tomorrow's fronts in full. */
  | { readonly kind: 'forecast' }
  /** A storm never knocks it, and its pace ignores the weather (the Greenhouse). */
  | { readonly kind: 'weatherproof' };

/** What a Wild Isle building does (#621 W1-8), in the order a card shows it; `[]` for the rest. */
export function wildIsleEffects(building: Building): WildIsleEffect[] {
  const out: WildIsleEffect[] = [];
  if ('needsWater' in building && building.needsWater) {
    out.push({ kind: 'needs-water', water: building.needsWater });
  }
  switch (building.kind) {
    case 'works':
      if (building.eats) out.push({ kind: 'eats', items: building.eats });
      if (building.weather && Object.keys(building.weather).length > 0) {
        out.push({ kind: 'weather', percent: building.weather });
      }
      if (building.onlyWhile) out.push({ kind: 'only-while', weather: building.onlyWhile });
      break;
    case 'canal':
      out.push({ kind: 'carries-water', maxRun: building.maxRun });
      break;
    case 'shelter':
      out.push({
        kind: 'shelters',
        radius: building.protects.radius,
        from: building.protects.from,
      });
      break;
    case 'vane':
      out.push({ kind: 'forecast' });
      break;
    default:
      break;
  }
  if (building.weatherproof === true) out.push({ kind: 'weatherproof' });
  return out;
}
