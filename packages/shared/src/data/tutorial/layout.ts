import type { TutorialLayout, TutorialTile } from '../../schemas/data/tutorial.js';

const home = (q: number, r: number, terrain: string, nodeResource: string | null = null) =>
  ({ q, r, terrain, nodeResource, guardianStrength: null, homeSlot: 0 }) satisfies TutorialTile;

const wild = (
  q: number,
  r: number,
  terrain: string,
  nodeResource: string | null,
  guardianStrength: number,
) => ({ q, r, terrain, nodeResource, guardianStrength, homeSlot: null }) satisfies TutorialTile;

/**
 * The Tutorial Glade (design doc §26): hand-authored, the same for every
 * player. Home base in the middle with Timber, Emberwood, Stone and a farm
 * plot (Treats) on its ring, like every real home (design doc §11; step 2), gentle guardians on the next ring (step 8), a little
 * tougher at the edge. `checkTutorialData` checks it covers radius 3 exactly.
 */
export const TUTORIAL_LAYOUT: TutorialLayout = {
  name: 'Tutorial Glade',
  radius: 3, // TUNE: design doc §26 [DEFAULT: hex radius 3, 37 tiles]
  heartSeed: { q: 0, r: 0 },
  tiles: [
    // The Heart Seed and its ring: the player's home base.
    home(0, 0, 'meadow'),
    home(-1, 1, 'meadow', 'treats'), // the farm plot
    home(0, 1, 'meadow'),
    home(1, 0, 'forest', 'timber'),
    home(1, -1, 'old-forest', 'emberwood'),
    home(0, -1, 'hills', 'stone'),
    home(-1, 0, 'meadow'),

    // Ring 2: easy guardians, for the first claim.
    // TUNE: guardian strengths
    wild(-2, 2, 'meadow', null, 1),
    wild(-1, 2, 'lake', null, 1),
    wild(0, 2, 'pumpkin-fields', 'pumpkins', 1),
    wild(1, 1, 'meadow', null, 1),
    wild(2, 0, 'forest', 'timber', 1),
    wild(2, -1, 'forest', null, 1),
    wild(2, -2, 'old-forest', 'emberwood', 1),
    wild(1, -2, 'meadow', null, 1),
    wild(0, -2, 'hills', 'stone', 1),
    wild(-1, -1, 'meadow', null, 1),
    wild(-2, 0, 'forest', 'timber', 1),
    wild(-2, 1, 'meadow', null, 1),

    // Ring 3: the edge of the Glade.
    wild(-3, 3, 'lake', null, 2),
    wild(-2, 3, 'lake', null, 2),
    wild(-1, 3, 'meadow', null, 2),
    wild(0, 3, 'pumpkin-fields', null, 2),
    wild(1, 2, 'meadow', null, 2),
    wild(2, 1, 'forest', null, 2),
    wild(3, 0, 'old-forest', null, 2),
    wild(3, -1, 'old-forest', 'emberwood', 2),
    wild(3, -2, 'mountains', 'glimmer', 2),
    wild(3, -3, 'mountains', null, 2),
    wild(2, -3, 'hills', null, 2),
    wild(1, -3, 'hills', 'stone', 2),
    wild(0, -3, 'meadow', null, 2),
    wild(-1, -2, 'forest', null, 2),
    wild(-2, -1, 'forest', 'timber', 2),
    wild(-3, 0, 'meadow', null, 2),
    wild(-3, 1, 'lake', null, 2),
    wild(-3, 2, 'meadow', null, 2),
  ],
};
