import type { PublicUser } from '@heartpatch/shared';
import type { Config } from '../../config.js';

/*
 * The Clockwork Isle feature switch (#874, `HP_CLOCKWORK_ISLE`), a clone of
 * the Wild Isle's (`wild-isle-switch.ts`). Off by default. It only gates
 * making a Clockwork Isle; a patch that already is one plays on whatever the
 * switch says.
 */

export interface ClockworkIsleSwitch {
  mode: Config['HP_CLOCKWORK_ISLE'];
  /** Lower-case usernames who can make one while `mode` is `testers`. */
  testers: readonly string[];
}

/** Off for everyone: what a server with no setting gets. */
export const CLOCKWORK_ISLE_OFF: ClockworkIsleSwitch = { mode: 'off', testers: [] };

/** The switch from the server's config. */
export const clockworkIsleSwitchOf = (
  config: Pick<Config, 'HP_CLOCKWORK_ISLE' | 'HP_CLOCKWORK_ISLE_TESTERS'>,
): ClockworkIsleSwitch => ({
  mode: config.HP_CLOCKWORK_ISLE,
  testers: config.HP_CLOCKWORK_ISLE_TESTERS,
});

/** This player can make a Clockwork Isle. */
export function clockworkIsleOpenFor(
  clockworkIsle: ClockworkIsleSwitch,
  user: PublicUser,
): boolean {
  if (clockworkIsle.mode === 'on') return true;
  if (clockworkIsle.mode === 'off') return false;
  return clockworkIsle.testers.includes(user.username.toLowerCase());
}
