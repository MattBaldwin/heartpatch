import type { PublicUser } from '@heartpatch/shared';
import type { Config } from '../../config.js';

/*
 * The push nudges feature switch (#726, `HP_PUSH`), shaped like the Long
 * Night's (`long-night/switch.ts`). It ships dark: off until the client lane
 * (#726e) passes the real-phone test. A nudge is the player's own, so on
 * `testers` it's per account: a tester gets nudges, their patch-mates don't.
 */

export interface PushSwitch {
  mode: Config['HP_PUSH'];
  /** Lower-case usernames who get nudges while `mode` is `testers`. */
  testers: readonly string[];
}

/** Off for everyone: what a server with no setting gets. */
export const PUSH_OFF: PushSwitch = { mode: 'off', testers: [] };

/** The switch from the server's config. */
export const pushSwitchOf = (config: Pick<Config, 'HP_PUSH' | 'HP_PUSH_TESTERS'>): PushSwitch => ({
  mode: config.HP_PUSH,
  testers: config.HP_PUSH_TESTERS,
});

/** Push is on for this player (their own account decides, not their patch). */
export function pushOnFor(push: PushSwitch, user: Pick<PublicUser, 'username'>): boolean {
  if (push.mode === 'on') return true;
  if (push.mode === 'off') return false;
  return push.testers.includes(user.username.toLowerCase());
}
