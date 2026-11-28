import type { OrnamentSource } from '../schemas/christmas.js';
import { PRESENT_ITEM } from '../schemas/data/advent.js';

/** The Patch Tree's tunables (#37 2c, owner answer 5). Checked by `patch-tree.test.ts`. */
export interface PatchTreeRules {
  /** Ornaments that light the star. */
  readonly starAt: number;
  /** Ornaments one December gift hangs, by what it held. */
  readonly ornaments: Readonly<Record<OrnamentSource, number>>;
  /** Warmth one December gift adds to its pair, by what it held. */
  readonly warmth: Readonly<Record<OrnamentSource, number>>;
  /** The item that makes a gift a present gift (a present gifted unopened). */
  readonly presentItemId: string;
}

/**
 * The shared Patch Tree (#37 §2, §3): every December gift picked up between
 * patch-mates hangs an ornament and warms that pair; a present gifted
 * unopened hangs two and warms them twice ("doubles warmth").
 */
export const PATCH_TREE: PatchTreeRules = {
  starAt: 12, // TUNE: owner answer 5, [DEFAULT: 12]
  ornaments: {
    gift: 1, // TUNE:
    'present-gift': 2, // TUNE: plan §3, a present hangs two
  },
  warmth: {
    gift: 1, // TUNE:
    'present-gift': 2, // TUNE: plan §3, "doubles warmth"
  },
  presentItemId: PRESENT_ITEM,
};
