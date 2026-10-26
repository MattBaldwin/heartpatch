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
    // #335: the mountain trail's hand and Walking Stick spots.
    kind: 'snow-drift',
    finds: [
      { weight: 3, items: { ice: 1 } },
      { weight: 2, items: { stone: 1 } },
      { weight: 1, items: { glimmer: 1 } },
      { weight: 2 },
      { weight: 1, items: { heartdust: 1 } },
    ],
  },
  {
    kind: 'cairn',
    finds: [
      { weight: 5, items: { stone: 1 } },
      { weight: 2, items: { stone: 2 } },
      { weight: 1, items: { glimmer: 1 } }, // TUNE: #523, more Glimmer on the mountain trail
      { weight: 2 },
      { weight: 1, items: { heartdust: 1 } },
    ],
  },
  {
    // #335: the hills cave's hand spot.
    kind: 'glow-mushrooms',
    finds: [
      { weight: 3, items: { greens: 1 } },
      { weight: 2, items: { emberwood: 1 } },
      { weight: 1, items: { glimmer: 1 } }, // TUNE: #523, more Glimmer in the hills cave
      { weight: 2 },
      { weight: 1, items: { heartdust: 1 } },
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
  // Wild Isle (#621 W1-11): the coast. Fish is the coast's own find (a Fishing
  // Pier catches lots, so a pool or a crab hole gives a few); Salt stays the
  // Salt Pans'. TUNE: every weight and amount.
  {
    kind: 'shells',
    finds: [
      { weight: 4, items: { stone: 1 } },
      { weight: 1, items: { glimmer: 1 } },
      { weight: 3 },
      { weight: 1, items: { heartdust: 1 } },
    ],
  },
  {
    kind: 'driftwood',
    finds: [
      { weight: 4, items: { timber: 1 } },
      { weight: 2, items: { timber: 2 } },
      { weight: 2, items: { emberwood: 1 } },
      { weight: 2 },
      { weight: 1, items: { heartdust: 1 } },
    ],
  },
  {
    kind: 'crab-hole',
    finds: [
      { weight: 3, items: { stone: 1 } },
      { weight: 2, items: { fish: 1 } },
      { weight: 1, items: { glimmer: 1 } },
      { weight: 2 },
      { weight: 1, items: { heartdust: 1 } },
    ],
  },
  {
    kind: 'tide-pool',
    finds: [
      { weight: 4, items: { fish: 1 } },
      { weight: 1, items: { fish: 2 } },
      { weight: 2, items: { water: 2 } },
      { weight: 2 },
      { weight: 1, items: { heartdust: 1 } },
    ],
  },
  {
    kind: 'kelp-bed',
    finds: [
      { weight: 4, items: { greens: 2 } },
      { weight: 2, items: { fish: 1 } },
      { weight: 2, items: { water: 1 } },
      { weight: 2 },
      { weight: 1, items: { heartdust: 1 } },
    ],
  },
];
