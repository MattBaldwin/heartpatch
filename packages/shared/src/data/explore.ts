import type { ExploreRules } from '../schemas/data/explore.js';

/**
 * Exploring your land (#199, owner design 2026-10-07). Checked by
 * `checkExploreRules` in tests; the server and the explore view read the
 * same numbers. What each spot gives is server-only
 * (`data/server/explore-finds.ts`).
 */
export const EXPLORE_RULES: ExploreRules = {
  // Bump when anything below (or `searchSpots`) would move or swap a tile's spots.
  layout: 1,
  spotKinds: [
    { id: 'rock', name: 'Rock', tool: null, interaction: 'lift' },
    { id: 'tree', name: 'Tree', tool: null, interaction: 'shake' },
    { id: 'hollow-log', name: 'Hollow log', tool: null, interaction: 'lift' },
    { id: 'flower-bed', name: 'Flower bed', tool: null, interaction: 'shake' },
    { id: 'pumpkin-row', name: 'Pumpkin row', tool: null, interaction: 'lift' },
    { id: 'mound', name: 'Mound', tool: 'shovel', interaction: 'dig' },
    { id: 'pond', name: 'Pond', tool: 'net', interaction: 'scoop' },
    { id: 'reeds', name: 'Reeds', tool: 'net', interaction: 'scoop' },
    { id: 'ledge', name: 'Ledge', tool: 'rope', interaction: 'climb' },
    { id: 'cave', name: 'Cave', tool: 'lantern', interaction: 'light' },
  ],
  // TUNE: owner decision 2026-10-06 ("a Shovel lasts 20 digs"); the rest are guesses.
  tools: [
    { id: 'shovel', name: 'Shovel', uses: 20 },
    { id: 'net', name: 'Net', uses: 20 },
    { id: 'rope', name: 'Rope', uses: 10 },
    { id: 'lantern', name: 'Lantern', uses: 15 },
  ],
  // Tools per terrain (owner decisions 2026-10-07): meadows, forests and
  // pumpkin fields want hands and a Shovel; lakes a Net; hills and mountains
  // a Rope and a Lantern. Juniper's Gap can't be explored in Phase 1.
  // TUNE: the kits' weights and spot counts.
  terrains: [
    {
      terrain: 'meadow',
      kinds: [
        { kind: 'rock', weight: 3 },
        { kind: 'flower-bed', weight: 3 },
        { kind: 'tree', weight: 1 },
        { kind: 'mound', weight: 4 },
      ],
      spots: { min: 8, max: 12 },
    },
    {
      terrain: 'forest',
      kinds: [
        { kind: 'tree', weight: 4 },
        { kind: 'hollow-log', weight: 2 },
        { kind: 'rock', weight: 2 },
        { kind: 'mound', weight: 3 },
      ],
      spots: { min: 10, max: 14 },
    },
    {
      terrain: 'old-forest',
      kinds: [
        { kind: 'tree', weight: 3 },
        { kind: 'hollow-log', weight: 3 },
        { kind: 'rock', weight: 1 },
        { kind: 'mound', weight: 3 },
      ],
      spots: { min: 10, max: 14 },
    },
    {
      terrain: 'pumpkin-fields',
      kinds: [
        { kind: 'pumpkin-row', weight: 4 },
        { kind: 'rock', weight: 1 },
        { kind: 'mound', weight: 3 },
      ],
      spots: { min: 8, max: 12 },
    },
    {
      terrain: 'lake',
      kinds: [
        { kind: 'pond', weight: 3 },
        { kind: 'reeds', weight: 2 },
      ],
      spots: { min: 6, max: 10 },
    },
    {
      terrain: 'hills',
      kinds: [
        { kind: 'ledge', weight: 3 },
        { kind: 'cave', weight: 3 },
      ],
      spots: { min: 8, max: 12 },
    },
    {
      terrain: 'mountains',
      kinds: [
        { kind: 'ledge', weight: 4 },
        { kind: 'cave', weight: 3 },
      ],
      spots: { min: 8, max: 12 },
    },
  ],
  placement: {
    buildingSpotScale: 0.3, // the client's SPOT_SIZE (apps/client/src/home/home-config.ts)
    buildingClearance: 0.2, // TUNE: room for a habitat's footprint
    minGap: 0.16, // TUNE: the Keeper fits between two spots
    edgeMargin: 0.08, // TUNE: nothing hangs over the tile's edge
  },
  xpPerSquishy: 6, // TUNE: held to the sim:progression gate (#193-style)
  // TUNE: owner decision 2026-10-07 (Q1, "about 125%"); tuned from `pnpm sim:economy`.
  homestead: { gatherPercent: 125 },
};
