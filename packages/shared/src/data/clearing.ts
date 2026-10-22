import type { ClearingRules } from '../schemas/data/clearing.js';

/** Clearing land (#242). Owner decisions 2026-10-11 (Q4, Q5). */
export const CLEARING_RULES: ClearingRules = {
  seconds: 2 * 60, // TUNE: "about 2 minutes" (owner)
  // TUNE: owner Q4: tools wear out. Sim (#295 plan revision 1): a casual kid
  // has 0–5 clearable spots by day 30, so 3 clears a tool is plenty.
  tools: [
    { id: 'axe', name: 'Axe', uses: 3 },
    { id: 'pickaxe', name: 'Pickaxe', uses: 3 },
    { id: 'spade', name: 'Spade', uses: 3 },
  ],
  // Owner Q5: not Juniper's Gap. Lakes, Old Forest and Pumpkin Fields clear
  // like other land, taking their spot with them (owner decision 2026-10-22,
  // #601 Q1), so the Water Well, Ember Kiln and Pumpkin Barn have land to stand on.
  terrains: [
    { terrain: 'forest', tool: 'axe' },
    { terrain: 'mountains', tool: 'pickaxe' },
    { terrain: 'meadow', tool: 'spade' },
    { terrain: 'hills', tool: 'spade' },
    { terrain: 'lake', tool: 'spade' },
    { terrain: 'old-forest', tool: 'axe' },
    { terrain: 'pumpkin-fields', tool: 'spade' },
  ],
  landDropCycles: 2, // TUNE: a meadow drops 4 Greens, like a Greens spot's gather
};
