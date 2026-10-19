import type { MapLocalTime } from '../home/hearthfire.js';
import { isNightAt } from '../hollow/index.js';
import type { HollowRules } from '../schemas/data/hollow.js';
import type { HomeBaseRules } from '../schemas/data/home-base.js';

/**
 * Can a Hollowed Community be explored right now (#306)? By day only: from
 * morning (`morningMinute`) until nightfall (`nightfallMinute`), map-local,
 * the same night `isNightAt` draws. The explore routes refuse at night and
 * the panel says so with the same rule.
 */
export function hollowedOpenAt(
  local: MapLocalTime,
  rules: Pick<HomeBaseRules, 'nightfallMinute'> & Pick<HollowRules, 'morningMinute'>,
): boolean {
  return !isNightAt(local, rules);
}
