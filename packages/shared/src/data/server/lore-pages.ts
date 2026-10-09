import type { LoreChapter, LoreEntry } from '../../schemas/data/lore-pages.js';

/**
 * The Lorebook's chapters (#307, owner-approved 2026-10-09). Titles are shown
 * from the start, so a kid sees where pages are still to be found.
 */
export const LORE_CHAPTERS: LoreChapter[] = [
  { id: 'junipers-gap', title: "Juniper's Gap", order: 1 },
  { id: 'wild-lands', title: 'The Wild Lands', order: 2 },
  { id: 'hollow-man', title: 'The Hollow Man', order: 3 },
  { id: 'little-guardians', title: 'Little Guardians', order: 4 },
];

/**
 * Lore pages (design doc §16; #24 seeded the first, #307 fills the book to 12,
 * owner-approved 2026-10-09). Secret until found (CLAUDE.md rule 6): the
 * words and the conditions stay on the server; only a page's `hint` is sent
 * before it's found. The forest chihuahuas are only ever glimpsed, never
 * explained.
 */
export const LORE_PAGES: LoreEntry[] = [
  // ── Juniper's Gap ─────────────────────────────────────────────────────
  {
    // The Glade's first step: planting the Heart Seed.
    id: 'where-the-squishies-bloomed',
    chapter: 'junipers-gap',
    order: 1,
    title: 'Where the Squishies Bloomed',
    text: 'An old journal page, soft at the corners: “Today the Heartpatch giggled, and a brand-new squishy rolled out of the grass. It was round and pink and sneezed three times.”',
    hint: "Every Keeper's story starts with a seed.",
    trigger: {
      mapKinds: ['tutorial'],
      eventType: 'tutorial.advanced',
      where: [{ op: 'equals', field: 'completedStepId', value: 'plant' }],
      finder: 'tutorial-player',
    },
  },
  {
    // Exploring your land: a flower bed's find (`EXPLORE_FINDS`).
    id: 'a-pressed-juniper-sprig',
    chapter: 'junipers-gap',
    order: 2,
    title: 'A Pressed Juniper Sprig',
    text: 'Tucked between two leaves: a sprig of juniper, pressed flat and still smelling of summer. A note in tiny letters says: “From the Gap, before the Scatter. Keep it close.”',
    hint: 'Flowers remember the old days.',
    trigger: {
      mapKinds: ['multiplayer'],
      eventType: 'explore.searched',
      where: [{ op: 'equals', field: 'lorePage', value: 'a-pressed-juniper-sprig' }],
      finder: 'actor',
    },
  },
  {
    // Exploring your land: a ledge's find (`EXPLORE_FINDS`).
    id: 'the-door-in-the-gap',
    chapter: 'junipers-gap',
    order: 3,
    title: 'The Door in the Gap',
    text: 'Scratched into a high stone ledge: a map of Juniper’s Gap, a little round door in the middle, and one word written three times, very small. “Shut. Shut. Shut.”',
    hint: 'High places see far.',
    trigger: {
      mapKinds: ['multiplayer'],
      eventType: 'explore.searched',
      where: [{ op: 'equals', field: 'lorePage', value: 'the-door-in-the-gap' }],
      finder: 'actor',
    },
  },

  // ── The Wild Lands ────────────────────────────────────────────────────
  {
    id: 'the-tidied-clearing',
    chapter: 'wild-lands',
    order: 1,
    title: 'The Tidied Clearing',
    text: 'Deep in the old forest, a little clearing has been swept clean. The acorns sit in a neat row, smallest to biggest. Whoever lives here is very tidy… and very small.',
    hint: 'The oldest trees keep a tidy secret.',
    trigger: {
      mapKinds: ['multiplayer'],
      eventType: 'tile.captured',
      where: [{ op: 'equals', field: 'terrain', value: 'old-forest' }],
      finder: 'actor',
    },
  },
  {
    // Exploring your land (#199): a rock's find (`EXPLORE_FINDS`).
    id: 'under-a-mossy-rock',
    chapter: 'wild-lands',
    order: 2,
    title: 'Under a Mossy Rock',
    text: 'Under the rock, wrapped in a leaf: one tiny silver bell, polished bright. Someone very small has been keeping it safe. You tuck it back, just in case they come looking.',
    hint: 'Something hides under the moss…',
    trigger: {
      mapKinds: ['multiplayer'],
      eventType: 'explore.searched',
      where: [{ op: 'equals', field: 'lorePage', value: 'under-a-mossy-rock' }],
      finder: 'actor',
    },
  },
  {
    // Exploring your land: reeds' find (`EXPLORE_FINDS`).
    id: 'the-humming-reeds',
    chapter: 'wild-lands',
    order: 3,
    title: 'The Humming Reeds',
    text: 'When the wind blows through the lake reeds, they hum a tune: three notes up, one note down. Squishies nearby always sway along, even the sleepy ones.',
    hint: 'Some water hums, if you listen.',
    trigger: {
      mapKinds: ['multiplayer'],
      eventType: 'explore.searched',
      where: [{ op: 'equals', field: 'lorePage', value: 'the-humming-reeds' }],
      finder: 'actor',
    },
  },

  // ── The Hollow Man ────────────────────────────────────────────────────
  {
    // Exploring your land (#199): a cave's find (`EXPLORE_FINDS`).
    id: 'chalk-on-the-cave-wall',
    chapter: 'hollow-man',
    order: 1,
    title: 'Chalk on the Cave Wall',
    text: 'Soft chalk drawings cover the cave wall: a fire, a ring of squishies, and two little dogs sitting very straight. A long, thin shadow stops right where the firelight begins.',
    hint: 'Dark places hold old drawings.',
    trigger: {
      mapKinds: ['multiplayer'],
      eventType: 'explore.searched',
      where: [{ op: 'equals', field: 'lorePage', value: 'chalk-on-the-cave-wall' }],
      finder: 'actor',
    },
  },
  {
    // Fueling a Hearthfire on a patch.
    id: 'too-bright-for-him',
    chapter: 'hollow-man',
    order: 2,
    title: 'Too Bright for Him',
    text: 'You stack the Emberwood high and the fire crackles. Past the firelight, something tall leans in… then leans right back out. He really doesn’t like a happy fire.',
    hint: 'A well-fed fire keeps more than toes warm.',
    trigger: {
      mapKinds: ['multiplayer'],
      eventType: 'building.fueled',
      where: [],
      finder: 'actor',
    },
  },
  {
    // One of your squishies is taken to the Hollow (a nightfall job's event:
    // its owner is the payload's player).
    id: 'grey-footprints',
    chapter: 'hollow-man',
    order: 3,
    title: 'Grey Footprints',
    text: 'Long, thin footprints cross the frosty grass and stop at the edge of the dark. Your squishy is waiting in the Hollow, and it knows you’re coming.',
    hint: 'Found on a quiet, grey morning.',
    trigger: {
      mapKinds: ['multiplayer'],
      eventType: 'squishy.hollowed',
      where: [],
      finder: 'payload-user',
    },
  },

  // ── Little Guardians ──────────────────────────────────────────────────
  {
    // Found in the Tutorial Glade, the night Sprout shows the Hollow Man.
    id: 'paw-prints-by-the-fire',
    chapter: 'little-guardians',
    order: 1,
    title: 'Paw Prints by the Fire',
    text: 'Two sets of tiny paw prints circle your Hearthfire, round and round, like someone small and brave kept watch all night. Far away, something barked twice.',
    hint: 'Your very first night keeps a secret.',
    trigger: {
      mapKinds: ['tutorial'],
      eventType: 'hollow.nightfall',
      where: [],
      finder: 'tutorial-player',
    },
  },
  {
    id: 'two-watchful-dogs',
    chapter: 'little-guardians',
    order: 2,
    title: 'Two Watchful Dogs',
    text: 'A page from an old Juniper\'s Gap journal: two little dogs sit by a fire, ears up, looking out at the dark. Underneath, in careful letters: "They never let him near."',
    hint: 'Bring someone home, and the night feels smaller.',
    trigger: {
      mapKinds: ['multiplayer'],
      eventType: 'squishy.rescued',
      where: [],
      finder: 'actor',
    },
  },
  {
    // Befriending a squishy on a patch.
    id: 'a-bell-in-the-trees',
    chapter: 'little-guardians',
    order: 3,
    title: 'A Bell in the Trees',
    text: 'As your new friend snuggles in, you hear it: a tiny silver bell, jingling far off in the trees. Then a small, proud “yip!” Then just the wind.',
    hint: 'Some friendships ring a little bell.',
    trigger: {
      mapKinds: ['multiplayer'],
      eventType: 'squishy.captured',
      where: [],
      finder: 'actor',
    },
  },
];
