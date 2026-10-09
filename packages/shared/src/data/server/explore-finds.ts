import type { ExploreFindTable } from '../../schemas/data/explore-finds.js';

/**
 * What exploring finds (#199). Secret (CLAUDE.md rule 6). Every find is
 * small next to a gather (a node gives 2–5 a gather), so gathering stays the
 * main source; Heartdust and lore turn up now and then. Clothing is the
 * wardrobe's `explore` drop table, rolled on top (#261).
 * TUNE: every weight and amount.
 */
export const EXPLORE_FINDS: ExploreFindTable[] = [
  {
    kind: 'rock',
    finds: [
      { weight: 5, items: { stone: 1 } },
      { weight: 2, items: { stone: 2 } },
      { weight: 2 },
      { weight: 1, items: { heartdust: 1 } },
      { weight: 1, lore: 'under-a-mossy-rock' },
    ],
  },
  {
    kind: 'tree',
    finds: [
      { weight: 4, items: { timber: 1 } },
      { weight: 3, items: { greens: 1 } },
      { weight: 2 },
      { weight: 1, items: { heartdust: 1 } },
    ],
  },
  {
    kind: 'hollow-log',
    finds: [
      { weight: 3, items: { timber: 1 } },
      { weight: 3, items: { emberwood: 1 } },
      { weight: 2 },
      { weight: 1, items: { heartdust: 1 } },
    ],
  },
  {
    kind: 'flower-bed',
    finds: [
      { weight: 4, items: { greens: 2 } },
      { weight: 3, items: { treats: 1 } },
      { weight: 2 },
      { weight: 1, items: { heartdust: 1 } },
      { weight: 1, lore: 'a-pressed-juniper-sprig' },
    ],
  },
  {
    kind: 'pumpkin-row',
    finds: [
      { weight: 3, items: { greens: 1 } },
      { weight: 3, items: { treats: 1 } },
      { weight: 3 },
      { weight: 1, items: { heartdust: 1 } },
    ],
  },
  {
    kind: 'mound',
    finds: [
      { weight: 3, items: { stone: 1 } },
      { weight: 2, items: { timber: 1 } },
      { weight: 1, items: { glimmer: 1 } },
      { weight: 2 },
      { weight: 1, items: { heartdust: 1 } },
    ],
  },
  {
    kind: 'pond',
    finds: [
      { weight: 4, items: { water: 2 } },
      { weight: 2, items: { greens: 1 } },
      { weight: 2 },
      { weight: 1, items: { heartdust: 1 } },
    ],
  },
  {
    kind: 'reeds',
    finds: [
      { weight: 3, items: { greens: 2 } },
      { weight: 3, items: { water: 1 } },
      { weight: 2 },
      { weight: 1, lore: 'the-humming-reeds' },
    ],
  },
  {
    kind: 'ledge',
    finds: [
      { weight: 3, items: { stone: 2 } },
      { weight: 2, items: { ice: 1 } },
      { weight: 1, items: { glimmer: 1 } },
      { weight: 2 },
      { weight: 1, items: { heartdust: 1 } },
      { weight: 1, lore: 'the-door-in-the-gap' },
    ],
  },
  {
    kind: 'cave',
    finds: [
      { weight: 3, items: { glimmer: 1 } },
      { weight: 2, items: { stone: 2 } },
      { weight: 1 },
      { weight: 1, items: { heartdust: 1 } },
      { weight: 1, lore: 'chalk-on-the-cave-wall' },
    ],
  },
];
