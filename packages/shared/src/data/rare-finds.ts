import { RaritySchema, type Rarity } from '../schemas/data/common.js';
import {
  RareFindTiersSchema,
  type RareFindTier,
  type RareFindTiers,
} from '../schemas/data/rare-finds.js';

/**
 * The rare-find moment by rarity (#391). Secret kinds get the Legendary-size
 * moment, called "Special" so nothing ever says "secret", and never a patch
 * line (CLAUDE.md rule 6). Only Legendary finds tell the whole patch (owner
 * decision 2026-10-12). No Mythic row in Phase 1: Mythic squishies arrive
 * in Phase 2 and get at least the Legendary moment until they have one.
 */
export const RARE_FIND_TIERS: RareFindTiers = RareFindTiersSchema.parse({
  rare: {
    ms: 1800, // TUNE
    scale: 1,
    label: 'Rare',
    banner: '✨ Something rare is here! ✨',
    patchLine: false,
  },
  epic: {
    ms: 2000, // TUNE
    scale: 2,
    label: 'Epic',
    banner: '✨ Something epic is here! ✨',
    patchLine: false,
  },
  legendary: {
    ms: 2200, // TUNE
    scale: 3,
    label: 'Legendary',
    banner: '🌟 Something legendary is here! 🌟',
    patchLine: true,
  },
  secret: {
    ms: 2200, // TUNE
    scale: 3,
    label: 'Special',
    banner: '✨ Something special is here! ✨',
    patchLine: false,
  },
} satisfies RareFindTiers);

/** The ladder, lowest first (`secret` is off the ladder). */
const LADDER: readonly Rarity[] = RaritySchema.options.filter((r) => r !== 'secret');

/**
 * A rarity's moment: its own row, else (for a rarity above Rare with no row
 * yet, like Mythic in Phase 1) the nearest row below it on the ladder. Null
 * below Rare, and for a secret kind without a row.
 */
export function rareFindTier(
  rarity: Rarity,
  tiers: RareFindTiers = RARE_FIND_TIERS,
): RareFindTier | null {
  const own = tiers[rarity];
  if (own) return own;
  const at = LADDER.indexOf(rarity);
  if (at < 0) return null;
  // Walk down from just below it to Rare.
  for (const step of LADDER.slice(LADDER.indexOf('rare'), at).reverse()) {
    const below = tiers[step];
    if (below) return below;
  }
  return null;
}
