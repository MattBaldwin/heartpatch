import type { CinematicState } from '@heartpatch/shared';
import type { CinematicApi } from './cinematic-api.js';
import { canSkip } from './skip.js';

/*
 * Whether this account has seen the opening cinematic, as `ensure` needs it
 * after the Keeper pick. Pure (the API and the session check are passed
 * in), so it's unit-tested without the DOM.
 */

/**
 * The answer to use: the prefetch from login (`early`) when it says "seen";
 * otherwise one more ask, since a first viewing on another device may have
 * finished since. Only new players pay for the second call. A failed call
 * counts as no answer (null), and the game goes on without the story
 * (decision A). `stillCurrent` is checked after every wait: once the player
 * has logged out or switched, the result is `stale` and nothing from the old
 * account may be kept.
 */
export async function checkSeen(
  api: Pick<CinematicApi, 'get'>,
  early: Promise<CinematicState | null> | null,
  stillCurrent: () => boolean,
): Promise<{ stale: true } | { stale: false; seen: CinematicState | null }> {
  const prefetched = await (early ?? Promise.resolve(null));
  if (!stillCurrent()) return { stale: true };
  if (canSkip(prefetched)) return { stale: false, seen: prefetched };
  const asked = await api.get().catch(() => null);
  if (!stillCurrent()) return { stale: true };
  return { stale: false, seen: asked };
}
