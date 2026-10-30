import type { PublicUser } from '@heartpatch/shared';
import type { Config } from '../../config.js';

/*
 * The Wild Isle feature switch (#621, `HP_WILD_ISLE`), shaped like the
 * house's (`house/switch.ts`). Off by default; production turns it on in
 * `infra/compose/docker-compose.prod.yml` (W1-12). It only gates making a Wild Isle; a patch
 * that already is one plays on whatever the switch says.
 */

export interface WildIsleSwitch {
  mode: Config['HP_WILD_ISLE'];
  /** Lower-case usernames who can make one while `mode` is `testers`. */
  testers: readonly string[];
}

/** Off for everyone: what a server with no setting gets. */
export const WILD_ISLE_OFF: WildIsleSwitch = { mode: 'off', testers: [] };

/** The switch from the server's config. */
export const wildIsleSwitchOf = (
  config: Pick<Config, 'HP_WILD_ISLE' | 'HP_WILD_ISLE_TESTERS'>,
): WildIsleSwitch => ({
  mode: config.HP_WILD_ISLE,
  testers: config.HP_WILD_ISLE_TESTERS,
});

/** This player can make a Wild Isle. */
export function wildIsleOpenFor(wildIsle: WildIsleSwitch, user: PublicUser): boolean {
  if (wildIsle.mode === 'on') return true;
  if (wildIsle.mode === 'off') return false;
  return wildIsle.testers.includes(user.username.toLowerCase());
}
