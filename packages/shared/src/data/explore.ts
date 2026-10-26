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
    // #335: mountains are a trail you hike up to lookouts with the Walking
    // Stick; hills are a cave you explore with the Lantern. The ids stay, so
    // their finds and lore pages do too.
    { id: 'ledge', name: 'Lookout', tool: 'rope', interaction: 'climb' },
    { id: 'cave', name: 'Dark nook', tool: 'lantern', interaction: 'light' },
    { id: 'snow-drift', name: 'Snow drift', tool: 'rope', interaction: 'poke' },
    { id: 'cairn', name: 'Cairn', tool: null, interaction: 'stack' },
    { id: 'glow-mushrooms', name: 'Glow mushrooms', tool: null, interaction: 'pick' },
    // Wild Isle (#621 W1-11): the coast. Shells and driftwood by hand, crab
    // holes with the Shovel, tide pools and kelp beds with the Snorkel. The
    // gestures are the lake's and the meadow's own, so no new interaction.
    { id: 'shells', name: 'Shell pile', tool: null, interaction: 'lift' },
    { id: 'driftwood', name: 'Driftwood', tool: null, interaction: 'lift' },
    { id: 'crab-hole', name: 'Crab hole', tool: 'shovel', interaction: 'dig' },
    { id: 'tide-pool', name: 'Tide pool', tool: 'net', interaction: 'dive' },
    { id: 'kelp-bed', name: 'Kelp bed', tool: 'net', interaction: 'part' },
    // Wild Isle (#621 W1-13): the river bank. A mossy log to peek under by
    // hand, a pebble bar to dig with the Shovel, and a swirly eddy and a
    // cattail bed with the Snorkel. Same gestures again, so no new interaction.
    { id: 'mossy-log', name: 'Mossy log', tool: null, interaction: 'lift' },
    { id: 'pebble-bar', name: 'Pebble bar', tool: 'shovel', interaction: 'dig' },
    { id: 'eddy', name: 'Swirly eddy', tool: 'net', interaction: 'dive' },
    { id: 'cattails', name: 'Cattail bed', tool: 'net', interaction: 'part' },
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
  // a Walking Stick and a Lantern (#335: the Net and Rope, renamed); the coast and
  // the river bank (#621) hands, a Shovel and a Snorkel. Juniper's Gap can't be explored in Phase 1.
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
      // #335: the hills cave. A new kit, so its own layout: half-searched
      // hills restart, finished ones stay finished (the server, #339).
      terrain: 'hills',
      layout: 2,
      kinds: [
        { kind: 'cave', weight: 3 },
        { kind: 'glow-mushrooms', weight: 2 },
        { kind: 'rock', weight: 1 },
      ],
      spots: { min: 8, max: 12 },
    },
    {
      // #335: the mountain trail, with its own layout as the hills.
      terrain: 'mountains',
      layout: 2,
      kinds: [
        { kind: 'ledge', weight: 4 },
        { kind: 'snow-drift', weight: 1 },
        { kind: 'cairn', weight: 2 },
      ],
      spots: { min: 8, max: 12 },
    },
    {
      // Wild Isle (#621 W1-11): the beach ringing the island. A new terrain,
      // so no saved progress to keep: it starts on the rules' layout.
      terrain: 'coast',
      kinds: [
        { kind: 'shells', weight: 3 },
        { kind: 'driftwood', weight: 2 },
        { kind: 'crab-hole', weight: 4 },
        { kind: 'tide-pool', weight: 3 },
        { kind: 'kelp-bed', weight: 2 },
      ],
      spots: { min: 8, max: 12 },
    },
    {
      // Wild Isle (#621 W1-13): a river tile is explored as its bank, with the
      // water flowing past its back edges. Its spots sit only on the shore and
      // in the shallows (`band`: from the waterline, 0.56 of the way out, to
      // the back edges). Layout 2 for the band; nobody can reach a river tile
      // yet, so there's no saved progress to keep.
      terrain: 'river',
      layout: 2,
      band: { depth: 0.44 }, // TUNE: the client's BANK.water is 1 - depth
      kinds: [
        { kind: 'mossy-log', weight: 3 },
        { kind: 'pebble-bar', weight: 4 },
        { kind: 'eddy', weight: 3 },
        { kind: 'cattails', weight: 3 },
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
