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
 * - `power`, `rails`, `research` (Clockwork Isle, #874): wires and
 *   generators (`POWER_RULES`), rails and the Rail Depot (`RAIL_RULES`), and
 *   the Research Bench (`RESEARCH_TREE`).
 */
export const PATCH_TYPE_RULES: Readonly<
  Record<
    PatchType,
    {
      readonly excludedTerrains: readonly string[];
      readonly travel: boolean;
      readonly weather: boolean;
      readonly power: boolean;
      readonly rails: boolean;
      readonly research: boolean;
    }
  >
> = {
  cozy: {
    excludedTerrains: ['ocean', 'river', 'wild-lake', 'coast'],
    travel: false,
    weather: false,
    power: false,
    rails: false,
    research: false,
  },
  'wild-isle': {
    excludedTerrains: ['lake'],
    travel: true,
    weather: true,
    power: false,
    rails: false,
    research: false,
  },
  // A Wild Isle you wire up (#874): its terrains, roads and supply, no
  // weather in Wave 1 (wind fronts are Wave 2), plus power, rails and research.
  'clockwork-isle': {
    excludedTerrains: ['lake'],
    travel: true,
    weather: false,
    power: true,
    rails: true,
    research: true,
  },
};
