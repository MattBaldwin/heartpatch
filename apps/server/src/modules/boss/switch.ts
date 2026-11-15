import type { Config } from '../../config.js';

/*
 * The mini-boss feature switch (#234, `HP_MINI_BOSSES`), shaped like the
 * computer patch-mates' (`computer-mates/switch.ts`). It ships dark: off
 * until the owner's on-device frame-time capture. Off, every patch behaves as
 * an empty boss bag: no visit opens, `GET /maps/:mapId/boss` is null, a fight
 * start is NOT_FOUND and the sweep opens none. A fight already going still
 * finishes. `testers` opens it on patches owned by an
 * `HP_MINI_BOSSES_TESTERS` account.
 */

export interface MinibossSwitch {
  mode: Config['HP_MINI_BOSSES'];
  /** Lower-case usernames whose patches get visits while `mode` is `testers`. */
  testers: readonly string[];
}

/** Off for everyone: what a server with no setting gets. */
export const MINIBOSSES_OFF: MinibossSwitch = { mode: 'off', testers: [] };

/** The switch from the server's config. */
export const minibossSwitchOf = (
  config: Pick<Config, 'HP_MINI_BOSSES' | 'HP_MINI_BOSSES_TESTERS'>,
): MinibossSwitch => ({
  mode: config.HP_MINI_BOSSES,
  testers: config.HP_MINI_BOSSES_TESTERS,
});

/**
 * Whether a boss may visit the patch owned by `ownerUsername` (null: the
 * patch has no owner, which only `on` opens).
 */
export function minibossOpenFor(miniBosses: MinibossSwitch, ownerUsername: string | null): boolean {
  if (miniBosses.mode === 'on') return true;
  if (miniBosses.mode === 'off' || ownerUsername === null) return false;
  return miniBosses.testers.includes(ownerUsername.toLowerCase());
}
