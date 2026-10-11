import type { ExploreRules } from '../schemas/data/explore.js';

/**
 * Exploring your land (#199, owner design 2026-10-07). Checked by
 * `checkExploreRules` in tests; the server and the explore view read the
 * same numbers. What each spot gives is server-only
 * (`data/server/explore-finds.ts`).
 */
export const EXPLORE_RULES: ExploreRules = {
  // Bump when anything below (or `searchSpots`) would move or swap every
  // tile's spots. One terrain's change bumps that terrain's own `layout` (#335).
  layout: 1,
  spotKinds: [
    { id: 'rock', name: 'Rock', tool: null, interaction: 'lift' },
    { id: 'tree', name: 'Tree', tool: null, interaction: 'shake' },
    { id: 'hollow-log', name: 'Hollow log', tool: null, interaction: 'lift' },
    { id: 'flower-bed', name: 'Flower bed', tool: null, interaction: 'shake' },
    { id: 'pumpkin-row', name: 'Pumpkin row', tool: null, interaction: 'lift' },
    { id: 'mound', name: 'Mound', tool: 'shovel', interaction: 'dig' },
    // #335: a lake is explored underwater with the Snorkel. The ids stay, so
    // the kit, the finds and saved progress are unchanged.
    { id: 'pond', name: 'Bubble spring', tool: 'net', interaction: 'dive' },
    { id: 'reeds', name: 'Reed bed', tool: 'net', interaction: 'part' },
    { id: 'ledge', name: 'Ledge', tool: 'rope', interaction: 'climb' },
    { id: 'cave', name: 'Cave', tool: 'lantern', interaction: 'light' },
  ],
  // TUNE: owner decision 2026-10-06 ("a Shovel lasts 20 digs"); the rest are guesses.
  tools: [
    { id: 'shovel', name: 'Shovel', uses: 20 },
    // #335 (owner decision 2026-10-09): the Net became the Snorkel and the
    // Rope the Walking Stick, renamed in place: the ids stay `net` and
    // `rope`, so every bag keeps its uses with no migration.
    { id: 'net', name: 'Snorkel', uses: 20 },
    { id: 'rope', name: 'Walking Stick', uses: 10 },
    { id: 'lantern', name: 'Lantern', uses: 15 },
  ],
  // Tools per terrain (owner decisions 2026-10-07): meadows, forests and
  // pumpkin fields want hands and a Shovel; lakes a Snorkel; hills and mountains
  // a Walking Stick and a Lantern (#335: the Net and Rope, renamed). Juniper's Gap can't be explored in Phase 1.
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
  // #335 (owner decision 2026-10-09), on the game's one clock (checked in
  // sky.test.ts): night ends at the Hollow's morning (`HOLLOW_RULES`), dusk
  // starts with the battle arena's (2 hours before nightfall) and night
  // falls with nightfall (`HOME_BASE_RULES`). TUNE: dawn's start.
  sky: {
    phases: [
      { from: 0, phase: 'night' },
      { from: 6 * 60, phase: 'dawn' },
      { from: 7 * 60, phase: 'day' },
      { from: 17 * 60, phase: 'dusk' },
      { from: 19 * 60, phase: 'night' },
    ],
    blendMinutes: 20,
  },
  xpPerSquishy: 6, // TUNE: held to the sim:progression gate (#193-style)
  // TUNE: owner decision 2026-10-07: yield, not speed (a speed bonus gave +0 %
  // because of the 4-cycle cap). +1 a cycle, sized with `pnpm sim:economy`;
  // revisit after the #28 playtest.
  homestead: { yieldPercent: 100, yieldPlus: 1 },
};
