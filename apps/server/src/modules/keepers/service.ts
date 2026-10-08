import {
  KEEPER_DATA,
  completeKeeperConfig,
  type CompleteKeeperConfig,
  keeperConfigProblem,
  type KeeperConfig,
  type KeeperData,
  type PublicUser,
} from '@heartpatch/shared';
import type { Executor } from '../../db/client.js';
import { AppError } from '../../lib/errors.js';
import type { Clock } from '../../lib/time.js';
import { createKeepersRepo } from './repo.js';

export interface KeepersService {
  /** The player's Keeper, or null before they pick one. */
  get: (user: PublicUser) => Promise<KeeperConfig | null>;
  /** Picks or changes the player's Keeper (free, any time: design doc §23). */
  save: (user: PublicUser, config: KeeperConfig) => Promise<KeeperConfig>;
}

export interface KeepersServiceOptions {
  db: Executor;
  clock?: Clock;
  /** Tests swap the data. */
  data?: KeeperData;
}

// Kid-readable messages (style guide §6), one per field a config can get wrong.
const MESSAGES: Readonly<Record<keyof KeeperConfig, string>> = {
  base: "We don't know that Keeper. Pick one from the list!",
  hairColor: "We don't know that hair color. Pick another one!",
  eyeColor: "We don't know that eye color. Pick another one!",
  outfit: "We don't know that outfit. Pick another one!",
  hairstyle: "We don't know that hair style. Pick another one!",
  skinTone: "We don't know that skin tone. Pick another one!",
  eyes: "We don't know those eyes. Pick another one!",
  brows: "We don't know those brows. Pick another one!",
  mouth: "We don't know that smile. Pick another one!",
  extras: "We don't know that extra. Pick another one!",
};

export function createKeepersService(options: KeepersServiceOptions): KeepersService {
  const data = options.data ?? KEEPER_DATA;
  const now = options.clock ?? (() => new Date());
  const store = createKeepersRepo(options.db);
  const baseStyle = (config: KeeperConfig) =>
    data.bases.find((b) => b.id === config.base)?.hairstyle;

  return {
    get: (user) => store.find(user.id),

    save: async (user, config) => {
      // The schema checked the shape; the ids must name real data too.
      const problem = keeperConfigProblem(config, data);
      if (problem) throw new AppError('VALIDATION_FAILED', MESSAGES[problem]);
      // Every builder choice is stored; one an older app didn't send comes
      // from the starting look (#289).
      const full = completeKeeperConfig(config, data);
      const keeper: CompleteKeeperConfig = {
        base: full.base,
        hairColor: full.hairColor,
        eyeColor: full.eyeColor,
        outfit: full.outfit,
        skinTone: full.skinTone,
        eyes: full.eyes,
        brows: full.brows,
        mouth: full.mouth,
        extras: full.extras,
        // None, or the base's own, is stored as none: the base's style shows.
        ...(config.hairstyle === undefined || config.hairstyle === baseStyle(config)
          ? {}
          : { hairstyle: config.hairstyle }),
      };
      await store.save(user.id, keeper, now());
      return keeper;
    },
  };
}
