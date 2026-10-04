import type { CinematicState, PublicUser } from '@heartpatch/shared';
import type { Executor } from '../../db/client.js';
import type { Clock } from '../../lib/time.js';
import { createCinematicRepo } from './repo.js';

export interface CinematicService {
  /** Whether the player has seen the opening cinematic (design doc §25). */
  get: (user: PublicUser) => Promise<CinematicState>;
  /** Watched to the end or skipped: remembered on the account. The first time stays. */
  markSeen: (user: PublicUser) => Promise<CinematicState>;
}

export interface CinematicServiceOptions {
  db: Executor;
  clock?: Clock;
}

const stateOf = (seenAt: Date | null): CinematicState => ({
  seenAt: seenAt ? seenAt.toISOString() : null,
});

export function createCinematicService(options: CinematicServiceOptions): CinematicService {
  const now = options.clock ?? (() => new Date());
  const store = createCinematicRepo(options.db);

  return {
    get: async (user) => stateOf(await store.seenAt(user.id)),
    markSeen: async (user) => stateOf(await store.markSeen(user.id, now())),
  };
}
