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
  // Owner Q5: not lakes, Juniper's Gap, Old Forest or Pumpkin Fields in Phase 1.
  terrains: [
    { terrain: 'forest', tool: 'axe' },
    { terrain: 'mountains', tool: 'pickaxe' },
    { terrain: 'meadow', tool: 'spade' },
    { terrain: 'hills', tool: 'spade' },
  ],
  landDropCycles: 2, // TUNE: a meadow drops 4 Greens, like a Greens spot's gather
};
