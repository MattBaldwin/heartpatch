import { PATCH_TYPE_RULES } from '../data/patch-types.js';
import { TERRAINS } from '../data/terrains.js';
import { TERRITORY_RULES } from '../data/territory.js';
import { TRAVEL_RULES } from '../data/travel.js';
import { WEATHER_RULES } from '../data/weather.js';
import type { Terrain } from '../schemas/data/terrains.js';
import type { TerritoryRules } from '../schemas/data/territory.js';
import type { TravelRules } from '../schemas/data/travel.js';
import type { WeatherRules } from '../schemas/data/weather.js';
import type { PatchType } from './patch-type.js';

export * from './patch-type.js';

/**
 * The rules one patch plays by (#621). Every rule that differs between a
 * Cozy Patch and a Wild Isle is read from here, never from an ad hoc check
 * of the type, so a Cozy Patch reads exactly today's values.
 */
export interface PatchRules {
  readonly patchType: PatchType;
  /** Terrains its generator may place, in `TERRAINS` order. */
  readonly terrains: readonly Terrain[];
  /** Claiming, tending and fading land: the same on both types today. */
  readonly territory: TerritoryRules;
  /** Roads, bridges and the supply line home; null: none (reach as today). */
  readonly travel: TravelRules | null;
  /** Moving weather fronts; null: no weather. */
  readonly weather: WeatherRules | null;
}

const RULES = Object.fromEntries(
  (Object.keys(PATCH_TYPE_RULES) as PatchType[]).map((patchType) => {
    const data = PATCH_TYPE_RULES[patchType];
    const rules: PatchRules = {
      patchType,
      terrains: TERRAINS.filter((t) => !data.excludedTerrains.includes(t.id)),
      territory: TERRITORY_RULES,
      travel: data.travel ? TRAVEL_RULES : null,
      weather: data.weather ? WEATHER_RULES : null,
    };
    return [patchType, rules];
  }),
) as Record<PatchType, PatchRules>;

/** The rules a patch of this type plays by. */
export function patchRules(patchType: PatchType): PatchRules {
  return RULES[patchType];
}
