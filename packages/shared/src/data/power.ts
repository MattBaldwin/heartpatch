import type { PowerRules } from '../schemas/data/power.js';

/**
 * Clockwork Isle power (#874, owner answer Q3: wires like roads). Cozy and
 * Wild patches never read these (`patchRules(type).power` is null). Checked
 * by `checkPowerRules`.
 */
export const POWER_RULES: PowerRules = {
  model: 'wires', // owner answer Q3, 2026-11-28
  wire: {
    cost: { parts: 1 }, // TUNE: one tile of wire
    maxRun: 6, // TUNE:
  },
  radius: 2, // TUNE: read only by model 'radius'
  // A Windmill's pace by its tile's wind ("the colder the wind, the faster it spins").
  windPace: { '1': 75, '2': 100, '3': 150 }, // TUNE:
};
