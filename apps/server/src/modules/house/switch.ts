import type { PublicUser } from '@heartpatch/shared';
import type { Config } from '../../config.js';

/*
 * The Keeper's house feature switch (#381, `HP_HOUSE`). It exists from the
 * first house PR so the whole feature can ship dark: if it isn't solid by
 * the Oct 27 go/no-go it stays off and lands in Phase 2 (coordinator,
 * 2026-10-11).
 */

export interface HouseSwitch {
  mode: Config['HP_HOUSE'];
  /** Lower-case usernames who see it while `mode` is `testers`. */
  testers: readonly string[];
}

/** Off for everyone: what a server with no setting gets. */
export const HOUSE_OFF: HouseSwitch = { mode: 'off', testers: [] };

/** The switch from the server's config. */
export const houseSwitchOf = (
  config: Pick<Config, 'HP_HOUSE' | 'HP_HOUSE_TESTERS'>,
): HouseSwitch => ({
  mode: config.HP_HOUSE,
  testers: config.HP_HOUSE_TESTERS,
});

/** This player sees the house. */
export function houseOpenFor(house: HouseSwitch, user: PublicUser): boolean {
  if (house.mode === 'on') return true;
  if (house.mode === 'off') return false;
  return house.testers.includes(user.username.toLowerCase());
}
