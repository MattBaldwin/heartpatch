import type { MilestoneRules, MilestoneTrack } from '../schemas/data/milestones.js';
import { CLOTHING } from './clothing.js';
import { SPECIES } from './species.js';

/**
 * Keeper milestones everyone can see (design doc §24; issue #44). Secret ones
 * are server-only (`data/server/secret-milestones.ts`). Thresholds and
 * rewards are first guesses for a 4-seat patch over a Halloween season.
 * TUNE: all of them, after real play.
 *
 * - Progress counts only on patches with `MILESTONE_RULES.minMembers` active
 *   members, never on the Tutorial Glade (decision F); The First Patch reads
 *   the account instead.
 * - Each tier grants once (`milestone_rewards`): its title, its coins
 *   (`creditCoins`, no cap) and its piece, if it has one.
 */

/** Halloween's own squishies, clothes and harvest count for its seasonal track. */
const HALLOWEEN_SPECIES = SPECIES.filter((s) => s.season === 'halloween').map((s) => s.id);
const HALLOWEEN_CLOTHING = CLOTHING.filter(
  (c) => c.season === 'halloween' && c.sources.includes('found'),
).map((c) => c.id);

export const MILESTONE_RULES: MilestoneRules = {
  minMembers: 2, // TUNE: design doc §24 [DEFAULT: 2]
};

export const MILESTONE_TRACKS: MilestoneTrack[] = [
  {
    // Design doc §26: finishing the tutorial once.
    id: 'first-patch',
    name: 'The First Patch',
    secret: false,
    progress: { from: 'tutorial-completed' },
    tiers: [
      {
        threshold: 1,
        goal: 'Finish the tutorial with Sprout.',
        title: { id: 'sprouts-friend', name: "Sprout's Friend" },
        coins: 20, // TUNE
      },
    ],
  },
  {
    // Gentle's half share (`rewardPercent`) counts half a tile.
    id: 'territory',
    name: 'Explorer',
    secret: false,
    progress: {
      from: 'events',
      sources: [
        { eventType: 'tile.captured', where: [], player: 'userId', scaleBy: 'rewardPercent' },
      ],
    },
    tiers: [
      {
        threshold: 10,
        goal: 'Claim 10 tiles.',
        title: { id: 'trailblazer', name: 'Trailblazer' },
        coins: 25,
        clothing: 'explorers-hat',
      },
      {
        threshold: 50,
        goal: 'Claim 50 tiles.',
        title: { id: 'map-maker', name: 'Map Maker' },
        coins: 50,
        clothing: 'cartographer-cape',
      },
      {
        threshold: 150,
        goal: 'Claim 150 tiles.',
        title: { id: 'keeper-of-the-gap', name: 'Keeper of the Gap' },
        coins: 100,
        clothing: 'crown-of-the-gap',
      },
    ],
  },
  {
    // Kinds of squishy befriended with a Heart Charm. A starter pick writes
    // no event (DECISIONS "Starter pick"), so it never counts.
    id: 'collector',
    name: 'Collector',
    secret: false,
    progress: {
      from: 'events',
      sources: [
        { eventType: 'squishy.captured', where: [], player: 'userId', distinct: 'speciesId' },
      ],
    },
    tiers: [
      {
        threshold: 3,
        goal: 'Befriend 3 kinds of squishy.',
        title: { id: 'squishy-pal', name: 'Squishy Pal' },
        coins: 25,
      },
      {
        threshold: 8,
        goal: 'Befriend 8 kinds of squishy.',
        title: { id: 'collector', name: 'Collector' },
        coins: 50,
        clothing: 'collectors-satchel',
      },
      {
        threshold: 14,
        goal: 'Befriend 14 kinds of squishy.',
        title: { id: 'friend-to-all', name: 'Friend to All Squishies' },
        coins: 100,
        clothing: 'rainbow-jacket',
      },
    ],
  },
  {
    id: 'evolution',
    name: 'Evolution',
    secret: false,
    progress: {
      from: 'events',
      sources: [{ eventType: 'squishy.evolved', where: [], player: 'userId' }],
    },
    tiers: [
      {
        threshold: 1,
        goal: 'Help a squishy grow up.',
        title: { id: 'proud-keeper', name: 'Proud Keeper' },
        coins: 25,
      },
      {
        threshold: 5,
        goal: 'Help 5 squishies grow up.',
        title: { id: 'evolver', name: 'Evolver' },
        coins: 50,
        clothing: 'evolvers-goggles',
      },
      {
        threshold: 20,
        goal: 'Help 20 squishies grow up.',
        title: { id: 'glow-up-guru', name: 'Glow-Up Guru' },
        coins: 100,
        clothing: 'prism-boots',
      },
    ],
  },
  {
    // Full-value care only (decision G): the first few a day per squishy, so
    // tapping all afternoon doesn't race ahead.
    id: 'caretaker',
    name: 'Caretaker',
    secret: false,
    progress: {
      from: 'events',
      sources: [
        {
          eventType: 'squishy.cared',
          where: [{ op: 'equals', field: 'full', value: true }],
          player: 'userId',
        },
      ],
    },
    tiers: [
      {
        threshold: 100,
        goal: 'Feed, pet or play 100 times.',
        title: { id: 'cuddle-buddy', name: 'Cuddle Buddy' },
        coins: 25,
      },
      {
        threshold: 500,
        goal: 'Feed, pet or play 500 times.',
        title: { id: 'caretaker', name: 'Caretaker' },
        coins: 50,
        clothing: 'heart-mittens',
      },
      {
        threshold: 2000,
        goal: 'Feed, pet or play 2,000 times.',
        title: { id: 'heart-of-the-patch', name: 'Heart of the Patch' },
        coins: 100,
      },
    ],
  },
  {
    // A challenge on your land that you held (DECISIONS "Offline defense (#16)").
    id: 'defender',
    name: 'Defender',
    secret: false,
    progress: {
      from: 'events',
      sources: [
        {
          eventType: 'raid.resolved',
          where: [{ op: 'equals', field: 'outcome', value: 'held' }],
          player: 'defenderUserId',
        },
      ],
    },
    tiers: [
      {
        threshold: 1,
        goal: 'Keep your land safe from a challenge.',
        title: { id: 'watchful', name: 'Watchful' },
        coins: 25,
      },
      {
        threshold: 10,
        goal: 'Keep your land safe 10 times.',
        title: { id: 'hearthkeeper', name: 'Hearthkeeper' },
        coins: 50,
        clothing: 'hearthkeeper-lantern',
      },
      {
        threshold: 50,
        goal: 'Keep your land safe 50 times.',
        title: { id: 'patch-protector', name: 'Patch Protector' },
        coins: 100,
        clothing: 'ember-cloak',
      },
    ],
  },
  {
    id: 'rescuer',
    name: 'Rescuer',
    secret: false,
    progress: {
      from: 'events',
      sources: [{ eventType: 'squishy.rescued', where: [], player: 'userId' }],
    },
    tiers: [
      {
        threshold: 1,
        goal: 'Bring a squishy home from the Hollow.',
        title: { id: 'hollow-rescuer', name: 'Hollow Rescuer' },
        coins: 25,
        clothing: 'brave-scarf',
      },
      {
        threshold: 10,
        goal: 'Bring 10 squishies home from the Hollow.',
        title: { id: 'lightbringer', name: 'Lightbringer' },
        coins: 100,
        clothing: 'lightbringer-wings',
      },
    ],
  },
  {
    // Halloween fun, while the Halloween window is on (design doc §15, §24).
    id: 'halloween',
    name: 'Halloween',
    secret: false,
    season: 'halloween',
    progress: {
      from: 'events',
      sources: [
        {
          eventType: 'squishy.captured',
          where: [{ op: 'oneOf', field: 'speciesId', values: HALLOWEEN_SPECIES }],
          player: 'userId',
        },
        {
          eventType: 'resource.gathered',
          where: [{ op: 'equals', field: 'resource', value: 'pumpkins' }],
          player: 'userId',
        },
        {
          eventType: 'clothing.found',
          where: [{ op: 'oneOf', field: 'itemId', values: HALLOWEEN_CLOTHING }],
          player: 'userId',
        },
      ],
    },
    tiers: [
      {
        threshold: 5,
        goal: 'Do 5 Halloween things: befriend, harvest or find!',
        title: { id: 'pumpkin-pal', name: 'Pumpkin Pal' },
        coins: 25,
      },
      {
        threshold: 15,
        goal: 'Do 15 Halloween things.',
        title: { id: 'spooky-sweetie', name: 'Spooky Sweetie' },
        coins: 50,
      },
      {
        threshold: 40,
        goal: 'Do 40 Halloween things.',
        title: { id: 'harvest-moon', name: 'Moonlit Pumpkin' },
        coins: 100,
        clothing: 'harvest-moon-costume',
      },
    ],
  },
];
