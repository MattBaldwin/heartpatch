import type { LoreEntry } from '../../schemas/data/lore-pages.js';

/**
 * Lore pages (design doc §16; Phase 1 seeds three, #24). Secret until found
 * (CLAUDE.md rule 6): the words and the conditions stay on the server. The
 * forest chihuahuas are only ever glimpsed, never explained.
 */
export const LORE_PAGES: LoreEntry[] = [
  {
    // Found in the Tutorial Glade, the night Sprout shows the Hollow Man.
    id: 'paw-prints-by-the-fire',
    title: 'Paw Prints by the Fire',
    text: 'Two sets of tiny paw prints circle your Hearthfire, round and round, like someone small and brave kept watch all night. Far away, something barked twice.',
    trigger: {
      mapKinds: ['tutorial'],
      eventType: 'hollow.nightfall',
      where: [],
      finder: 'tutorial-player',
    },
  },
  {
    id: 'the-tidied-clearing',
    title: 'The Tidied Clearing',
    text: 'Deep in the old forest, a little clearing has been swept clean. The acorns sit in a neat row, smallest to biggest. Whoever lives here is very tidy… and very small.',
    trigger: {
      mapKinds: ['multiplayer'],
      eventType: 'tile.captured',
      where: [{ op: 'equals', field: 'terrain', value: 'old-forest' }],
      finder: 'actor',
    },
  },
  {
    id: 'two-watchful-dogs',
    title: 'Two Watchful Dogs',
    text: 'A page from an old Juniper\'s Gap journal: two little dogs sit by a fire, ears up, looking out at the dark. Underneath, in careful letters: "They never let him near."',
    trigger: {
      mapKinds: ['multiplayer'],
      eventType: 'squishy.rescued',
      where: [],
      finder: 'actor',
    },
  },
  {
    // Exploring your land (#199): a rock's find (`EXPLORE_FINDS`).
    id: 'under-a-mossy-rock',
    title: 'Under a Mossy Rock',
    text: 'Under the rock, wrapped in a leaf: one tiny silver bell, polished bright. Someone very small has been keeping it safe. You tuck it back, just in case they come looking.',
    trigger: {
      mapKinds: ['multiplayer'],
      eventType: 'explore.searched',
      where: [{ op: 'equals', field: 'lorePage', value: 'under-a-mossy-rock' }],
      finder: 'actor',
    },
  },
  {
    // Exploring your land (#199): a cave's find (`EXPLORE_FINDS`).
    id: 'chalk-on-the-cave-wall',
    title: 'Chalk on the Cave Wall',
    text: 'Soft chalk drawings cover the cave wall: a fire, a ring of squishies, and two little dogs sitting very straight. A long, thin shadow stops right where the firelight begins.',
    trigger: {
      mapKinds: ['multiplayer'],
      eventType: 'explore.searched',
      where: [{ op: 'equals', field: 'lorePage', value: 'chalk-on-the-cave-wall' }],
      finder: 'actor',
    },
  },
];
