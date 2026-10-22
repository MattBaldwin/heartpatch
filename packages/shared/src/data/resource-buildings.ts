import type { ResourceBuildingRules } from '../schemas/data/buildings.js';

/**
 * How resource buildings and the Warehouse work together (#601). Their
 * levels are in `BUILDINGS`; checked by `checkResourceBuildings` in tests.
 */
export const RESOURCE_BUILDING_RULES: ResourceBuildingRules = {
  warehouseDeliversFromLevel: 3, // owner decision 2026-10-22
};
