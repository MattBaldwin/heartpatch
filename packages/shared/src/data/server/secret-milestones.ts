import { CLOTHING } from '../clothing.js';
import type { MilestoneTrack } from '../../schemas/data/milestones.js';

/**
 * Secret milestones (design doc §24 "Secret"; issue #44). Server-only
 * (CLAUDE.md rule 6): the Milestones screen shows each as "???" until it's
 * earned, and only then sends its name, goal and title. Nothing here is a
 * clothing reward, since the catalog ships to every client and a piece would
 * give a secret away. TUNE: all of them.
 */

/** Legendary pieces, and the rarer Mythic ones (#261), that can turn up as finds. */
const LEGENDARY_FINDS = CLOTHING.filter(
  (c) => (c.rarity === 'legendary' || c.rarity === 'mythic') && c.sources.includes('found'),
).map((c) => c.id);

export const SECRET_MILESTONES: MilestoneTrack[] = [
  {
    // The launch secret squishy (DECISIONS "Launch roster (#10)").
    id: 'heart-whisperer',
    name: 'Heart Whisperer',
    secret: true,
    progress: {
      from: 'events',
      sources: [
        {
          eventType: 'squishy.captured',
          where: [{ op: 'equals', field: 'speciesId', value: 'heartlet' }],
          player: 'userId',
        },
      ],
    },
    tiers: [
      {
        threshold: 1,
        goal: 'Befriend a tiny piece of the Heartpatch.',
        title: { id: 'heart-whisperer', name: 'Heart Whisperer' },
        coins: 50,
      },
    ],
  },
  {
    id: 'squishy-coach',
    name: 'Big and Bouncy',
    secret: true,
    progress: {
      from: 'events',
      sources: [
        {
          eventType: 'squishy.leveled',
          where: [{ op: 'atLeast', field: 'level', value: 20 }],
          player: 'userId',
        },
      ],
    },
    tiers: [
      {
        threshold: 1,
        goal: 'Help a squishy reach level 20.',
        title: { id: 'squishy-coach', name: 'Squishy Coach' },
        coins: 50,
      },
    ],
  },
  {
    // Something in seven slots at once: every Keeper owns a starter piece for each.
    id: 'dressed-up',
    name: 'All Dressed Up',
    secret: true,
    progress: {
      from: 'events',
      sources: [
        {
          eventType: 'outfit.changed',
          where: [{ op: 'atLeast', field: 'wearing.length', value: 7 }],
          player: 'userId',
        },
      ],
    },
    tiers: [
      {
        threshold: 1,
        goal: 'Wear something in seven slots at once.',
        title: { id: 'snappy-dresser', name: 'Snappy Dresser' },
        coins: 50,
      },
    ],
  },
  {
    id: 'lucky-star',
    name: 'Lucky Star',
    secret: true,
    progress: {
      from: 'events',
      sources: [
        {
          eventType: 'clothing.found',
          where: [{ op: 'oneOf', field: 'itemId', values: LEGENDARY_FINDS }],
          player: 'userId',
        },
      ],
    },
    tiers: [
      {
        threshold: 1,
        goal: 'Find a Legendary or Mythic piece of clothing.',
        title: { id: 'lucky-star', name: 'Lucky Star' },
        coins: 50,
      },
    ],
  },
];
