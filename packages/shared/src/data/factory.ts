import type { FactoryRules } from '../schemas/data/factory.js';

/** Crafting Factory rules (#294). Its levels are in `BUILDINGS`. */
export const FACTORY_RULES: FactoryRules = {
  maxBatch: 999, // owner decision 2026-10-08: no design cap, only a sane one
  welcomeBackMinutes: 30, // TUNE: owner decision 2026-10-08
};
