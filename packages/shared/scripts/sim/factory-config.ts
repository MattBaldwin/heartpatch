import { FUEL_CONFIG, type FuelProfile } from './fuel-config.js';

/**
 * `pnpm sim:factory` (#294): when a casual and an engaged kid can pay for
 * each Crafting Factory level. Build income is the fuel model's (#277): the
 * Keeper's build-node taps and build gatherers on the kid's real land, of
 * which `100 − buildShare` percent isn't kept for fires.
 */
export interface FactoryConfig {
  /** Days to look ahead. */
  readonly days: number;
  readonly seats: readonly number[];
  /** The fuel model's kids (their sessions, build nodes and gatherers). */
  readonly profiles: readonly FuelProfile[];
  /** Home builds a kid pays for first (level 1), before saving for the Factory. */
  readonly firstBuilds: readonly string[];
  /** Heart Charms each kid makes a day (their Timber comes out of build income). */
  readonly charmsPerDay: Readonly<Record<string, number>>;
  /** The guardrail: a casual kid can build level 1 by this day (owner rule, #294). */
  readonly levelOneByDay: number;
  /** And level 2 by this day (owner decision 2026-10-08: about day 10). */
  readonly levelTwoByDay: number;
}

export const FACTORY_CONFIG: FactoryConfig = {
  days: 30,
  seats: [4, 2],
  profiles: FUEL_CONFIG.profiles,
  // TUNE: a first week's home (#294 mockup): both habitats and the Training Grounds.
  firstBuilds: ['cozy-meadow', 'ember-den', 'training-grounds'],
  charmsPerDay: { casual: 3, engaged: 6 }, // TUNE: guess
  levelOneByDay: 7, // the issue's "a casual kid can build level 1 in their first week"
  levelTwoByDay: 10, // owner decision 2026-10-08: level 2 has no Glimmer, about day 6–10
};
