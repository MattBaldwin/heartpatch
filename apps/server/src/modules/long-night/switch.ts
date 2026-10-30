import type { PublicUser } from '@heartpatch/shared';
import type { Config } from '../../config.js';

/*
 * The Long Night feature switch (#727, `HP_LONG_NIGHT`), shaped like the
 * house's (`house/switch.ts`). It ships dark: off until the client PR
 * (#727e) flips it to `testers`. The Night is the whole patch's, so on
 * `testers` it runs on a patch with a tester among its members, and every
 * member there sees it.
 */

export interface LongNightSwitch {
  mode: Config['HP_LONG_NIGHT'];
  /** Lower-case usernames who see it while `mode` is `testers`. */
  testers: readonly string[];
}

/** Off for everyone: what a server with no setting gets. */
export const LONG_NIGHT_OFF: LongNightSwitch = { mode: 'off', testers: [] };

/** The switch from the server's config. */
export const longNightSwitchOf = (
  config: Pick<Config, 'HP_LONG_NIGHT' | 'HP_LONG_NIGHT_TESTERS'>,
): LongNightSwitch => ({
  mode: config.HP_LONG_NIGHT,
  testers: config.HP_LONG_NIGHT_TESTERS,
});

/** The Long Night runs on a patch with these members. */
export function longNightOnFor(
  longNight: LongNightSwitch,
  members: readonly Pick<PublicUser, 'username'>[],
): boolean {
  if (longNight.mode === 'on') return true;
  if (longNight.mode === 'off') return false;
  return members.some((m) => longNight.testers.includes(m.username.toLowerCase()));
}
