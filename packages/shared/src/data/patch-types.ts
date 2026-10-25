import type { PatchType } from '../patch-types/patch-type.js';

/**
 * What differs between patch types (#621), as data. `patchRules` turns it
 * into the rules a patch plays by; Cozy is today's game, unchanged.
 * - `excludedTerrains`: terrains its generator never places (Cozy has no
 *   water or coast; a Wild Isle's lakes are `wild-lake`, never Cozy's
 *   claimable `lake`).
 * - `travel`: roads, bridges, ferry docks and the supply line home
 *   (`TRAVEL_RULES`).
 * - `weather`: moving fronts and their effects (`WEATHER_RULES`).
 */
export const PATCH_TYPE_RULES: Readonly<
  Record<
    PatchType,
    {
      readonly excludedTerrains: readonly string[];
      readonly travel: boolean;
      readonly weather: boolean;
    }
  >
> = {
  cozy: {
    excludedTerrains: ['ocean', 'river', 'wild-lake', 'coast'],
    travel: false,
    weather: false,
  },
  'wild-isle': { excludedTerrains: ['lake'], travel: true, weather: true },
};
