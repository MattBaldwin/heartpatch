import type { PublicUser } from '@heartpatch/shared';
import type { Config } from '../../config.js';

/*
 * The computer patch-mates feature switch (#386, `HP_COMPUTER_MATES`),
 * shaped like the Long Night's (`long-night/switch.ts`). It ships dark: off
 * until the client lane (#386b) lands. Off answers the switch route
 * NOT_FOUND and leaves `computerMates` out of a patch's detail. `testers`
 * opens it to patches owned by an `HP_COMPUTER_MATES_TESTERS` account.
 */

export interface ComputerMatesSwitch {
  mode: Config['HP_COMPUTER_MATES'];
  /** Lower-case usernames whose patches get it while `mode` is `testers`. */
  testers: readonly string[];
}

/** Off for everyone: what a server with no setting gets. */
export const COMPUTER_MATES_OFF: ComputerMatesSwitch = { mode: 'off', testers: [] };

/** The switch from the server's config. */
export const computerMatesSwitchOf = (
  config: Pick<Config, 'HP_COMPUTER_MATES' | 'HP_COMPUTER_MATES_TESTERS'>,
): ComputerMatesSwitch => ({
  mode: config.HP_COMPUTER_MATES,
  testers: config.HP_COMPUTER_MATES_TESTERS,
});

/** Whether the patch owned by `owner` may use computer patch-mates. */
export function computerMatesOpenFor(
  computerMates: ComputerMatesSwitch,
  owner: Pick<PublicUser, 'username'>,
): boolean {
  if (computerMates.mode === 'on') return true;
  if (computerMates.mode === 'off') return false;
  return computerMates.testers.includes(owner.username.toLowerCase());
}
