import type { CrookedHouseSecrets } from '../../schemas/data/crooked-house-secrets.js';

/** The Crooked House's rewards and odds (#306 6b). Secret (CLAUDE.md rule 6). */
export const CROOKED_HOUSE_SECRETS: CrookedHouseSecrets = {
  // TUNE: which find table each room's bloom rolls (FAR_HOLLOW_FINDS: Heartdust 4×).
  blooms: {
    parlour: { kind: 'hollow-log', terrain: 'old-forest' },
    conservatory: { kind: 'flower-bed', terrain: 'meadow' },
    'stair-hall': { kind: 'hollow-log', terrain: 'old-forest' },
    'dining-room': { kind: 'pumpkin-row', terrain: 'meadow' },
    library: { kind: 'cave', terrain: 'hills' },
    kitchen: { kind: 'pumpkin-row', terrain: 'meadow' },
    scullery: { kind: 'pond', terrain: 'meadow' },
    landing: { kind: 'hollow-log', terrain: 'old-forest' },
    'blue-bedroom': { kind: 'glow-mushrooms', terrain: 'old-forest' },
    nursery: { kind: 'flower-bed', terrain: 'meadow' },
    'music-room': { kind: 'cave', terrain: 'hills' },
    'sewing-room': { kind: 'reeds', terrain: 'meadow' },
  },
  // Owner decision 6: small loot plus a rare friend now and then, of the room's element.
  chests: {
    inglenook: {
      loot: [
        { weight: 2, items: { treats: 4, heartdust: 1 } }, // TUNE: every pile and weight
        { weight: 1, items: { emberwood: 3, heartdust: 2 } },
      ],
      friend: {
        chance: 20,
        level: { min: 6, max: 10 },
        species: [{ species: 'candlekit', weight: 1 }],
      }, // TUNE
    },
    'hanging-garden': {
      loot: [
        { weight: 2, items: { greens: 4, heartdust: 1 } },
        { weight: 1, items: { pumpkins: 2, heartdust: 2 } },
      ],
      friend: {
        chance: 20, // TUNE
        level: { min: 6, max: 10 },
        species: [
          { species: 'mossmuffin', weight: 1 },
          { species: 'crunchkin', weight: 2 },
        ],
      },
    },
    pantry: {
      loot: [
        { weight: 2, items: { treats: 5, heartdust: 1 } },
        { weight: 1, items: { water: 3, heartdust: 2 } },
      ],
      friend: {
        chance: 20, // TUNE
        level: { min: 6, max: 10 },
        species: [
          { species: 'shellnap', weight: 1 },
          { species: 'bubbletub', weight: 1 },
        ],
      },
    },
    'lantern-closet': {
      loot: [
        { weight: 2, items: { glimmer: 4, heartdust: 1 } },
        { weight: 1, items: { treats: 3, heartdust: 2 } },
      ],
      friend: {
        chance: 20,
        level: { min: 6, max: 10 },
        species: [{ species: 'glowboo', weight: 1 }],
      }, // TUNE
    },
  },
  // Owner decision 4: the cellar's pile, and the Lantern Keeper's Cloak.
  attic: {
    items: { heartdust: 10, glimmer: 25 },
    keepsake: 'lantern-keepers-cloak',
  },
};
