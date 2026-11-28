import type { FoundSet } from '../schemas/data/found-sets.js';
import type { MilestoneRules, MilestoneTrack } from '../schemas/data/milestones.js';
import { CLOTHING } from './clothing.js';
import { FOUND_SETS } from './found-sets.js';
import { SPECIES } from './species.js';
import { CLOCKWORK_ISLE_SPECIES } from './species-wave-3.js';

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

/** Thanksgiving's squishies, clothes and Magic Fallen Leaves count for Cozy Harvest (#34). */
const THANKSGIVING_SPECIES = SPECIES.filter((s) => s.season === 'thanksgiving').map((s) => s.id);
const THANKSGIVING_CLOTHING = CLOTHING.filter(
  (c) => c.season === 'thanksgiving' && c.sources.includes('found'),
).map((c) => c.id);

/**
 * Every everyday common (#732 B2): the all-year, common-rarity base forms, the
 * ones a kid can actually befriend. Evolved forms never spawn wild (only base
 * forms do, `data/server/spawn-tables.ts`), so a kid form would make the track
 * unreachable; seasonal ones would too, off-season. Clockwork Isle kinds
 * (#874) are left out: only an isle has them. Derived, never hand-copied.
 */
const EVOLVED_INTO = new Set(SPECIES.flatMap((s) => s.evolutions.map((e) => e.into)));
export const EVERYDAY_COMMON_SPECIES: string[] = SPECIES.filter(
  (s) =>
    s.rarity === 'common' &&
    s.season === undefined &&
    !EVOLVED_INTO.has(s.id) &&
    !CLOCKWORK_ISLE_SPECIES.has(s.id),
).map((s) => s.id);

/** A found set's milestone track id: its counted keys are the pieces found (#306 PR 5). */
export function foundSetTrackId(set: Pick<FoundSet, 'id'>): string {
  return `set-${set.id}`;
}

/**
 * A found set's track (#306 PR 5): one step per different piece found, and
 * the set's title once every piece is in. Finds only (`clothing.found`), so a
 * piece is never counted twice and never got another way.
 */
export function foundSetTrack(set: FoundSet): MilestoneTrack {
  return {
    id: foundSetTrackId(set),
    name: set.name,
    secret: false,
    progress: {
      from: 'events',
      sources: [
        {
          eventType: 'clothing.found',
          where: [{ op: 'oneOf', field: 'itemId', values: set.pieces }],
          player: 'userId',
          distinct: 'itemId',
        },
      ],
    },
    tiers: [
      {
        threshold: set.pieces.length,
        goal: `Find all ${String(set.pieces.length)} ${set.name} pieces ${set.where}.`,
        title: set.title,
        coins: set.coins,
      },
    ],
  };
}

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
    // Every everyday common (#732 B2): its own track, because a track's tiers
    // share one counter and `collector` counts every kind. One tier, as big
    // as the list, so a new everyday common raises the goal by itself.
    id: 'commons',
    name: 'Every Common',
    secret: false,
    progress: {
      from: 'events',
      sources: [
        {
          eventType: 'squishy.captured',
          where: [{ op: 'oneOf', field: 'speciesId', values: EVERYDAY_COMMON_SPECIES }],
          player: 'userId',
          distinct: 'speciesId',
        },
      ],
    },
    tiers: [
      {
        threshold: EVERYDAY_COMMON_SPECIES.length,
        goal: 'Befriend every everyday common squishy.',
        title: { id: 'everyday-friend', name: 'Everyday Friend' }, // TUNE:
        coins: 75, // TUNE:
        clothing: 'patchwork-pal-scarf',
      },
    ],
  },
  {
    id: 'evolution',
    name: 'Evolution',
    secret: false,
    progress: {
      from: 'events',
      // Squishies that evolved, not evolutions (#443): with four stages one
      // squishy evolves up to three times, and "Help 5 squishies evolve" means 5.
      sources: [
        { eventType: 'squishy.evolved', where: [], player: 'userId', distinct: 'squishyId' },
      ],
    },
    tiers: [
      {
        threshold: 1,
        goal: 'Help a squishy evolve.',
        title: { id: 'proud-keeper', name: 'Proud Keeper' },
        coins: 25,
      },
      {
        threshold: 5,
        goal: 'Help 5 squishies evolve.',
        title: { id: 'evolver', name: 'Evolver' },
        coins: 50,
        clothing: 'evolvers-goggles',
      },
      {
        threshold: 20,
        goal: 'Help 20 squishies evolve.',
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
    // Mini-boss wins (#190 plan §7): one per won fight, whichever boss.
    // Visible before the first visit as a teaser; it names no boss.
    id: 'big-friend',
    name: 'Big Friend',
    secret: false,
    progress: {
      from: 'events',
      sources: [
        {
          eventType: 'battle.ended',
          where: [
            { op: 'equals', field: 'kind', value: 'miniboss' },
            { op: 'equals', field: 'winner', value: 'a' },
          ],
          player: 'userId',
        },
      ],
    },
    tiers: [
      {
        threshold: 1,
        goal: 'Beat a BIG squishy.',
        title: { id: 'big-hugger', name: 'Big Hugger' },
        coins: 25, // TUNE
      },
      {
        threshold: 4,
        goal: 'Beat 4 BIG squishies.',
        title: { id: 'big-friend', name: 'Big Friend' },
        coins: 50, // TUNE
      },
      {
        threshold: 10,
        goal: 'Beat 10 BIG squishies.',
        title: { id: 'giant-heart', name: 'Giant Heart' },
        coins: 100, // TUNE
      },
    ],
  },
  {
    // Search spots explored on your own land (#199; owner decision 2026-10-07:
    // "Seeker", so the Territory track keeps "Explorer"). One per search.
    id: 'seeker',
    name: 'Seeker',
    secret: false,
    progress: {
      from: 'events',
      sources: [{ eventType: 'explore.searched', where: [], player: 'userId' }],
    },
    tiers: [
      {
        threshold: 25,
        goal: 'Search 25 spots on your land.',
        title: { id: 'rock-flipper', name: 'Rock Flipper' },
        coins: 25,
        clothing: 'seekers-bandana',
      },
      {
        threshold: 100,
        goal: 'Search 100 spots on your land.',
        title: { id: 'trail-seeker', name: 'Trail Seeker' },
        coins: 50,
        clothing: 'trail-pack',
      },
      {
        threshold: 300,
        goal: 'Search 300 spots on your land.',
        title: { id: 'seeker-of-secrets', name: 'Seeker of Secrets' },
        coins: 100,
        clothing: 'mossy-crown',
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
        goal: 'Befriend Halloween squishies, gather Pumpkins or find spooky clothes.',
        title: { id: 'pumpkin-pal', name: 'Pumpkin Pal' },
        coins: 25,
      },
      {
        threshold: 15,
        goal: 'Befriend Halloween squishies, gather Pumpkins or find spooky clothes.',
        title: { id: 'spooky-sweetie', name: 'Spooky Sweetie' },
        coins: 50,
      },
      {
        threshold: 40,
        goal: 'Befriend Halloween squishies, gather Pumpkins or find spooky clothes.',
        title: { id: 'harvest-moon', name: 'Moonlit Pumpkin' },
        coins: 100,
        clothing: 'harvest-moon-costume',
      },
    ],
  },
  {
    // Cozy Harvest (#34): Thanksgiving's track, counted like Halloween's while
    // the Thanksgiving window is on. Shorter tiers than Halloween's because
    // the window is shorter.
    id: 'cozy-harvest',
    name: 'Cozy Harvest',
    secret: false,
    season: 'thanksgiving',
    progress: {
      from: 'events',
      sources: [
        {
          eventType: 'squishy.captured',
          where: [{ op: 'oneOf', field: 'speciesId', values: THANKSGIVING_SPECIES }],
          player: 'userId',
        },
        {
          eventType: 'resource.gathered',
          where: [{ op: 'equals', field: 'resource', value: 'magic-fallen-leaves' }],
          player: 'userId',
        },
        {
          eventType: 'clothing.found',
          where: [{ op: 'oneOf', field: 'itemId', values: THANKSGIVING_CLOTHING }],
          player: 'userId',
        },
      ],
    },
    tiers: [
      {
        threshold: 4, // TUNE:
        goal: 'Befriend harvest squishies, gather Magic Fallen Leaves or find harvest clothes.',
        title: { id: 'leaf-lover', name: 'Leaf Lover' },
        coins: 25, // TUNE:
      },
      {
        threshold: 10, // TUNE:
        goal: 'Befriend harvest squishies, gather Magic Fallen Leaves or find harvest clothes.',
        title: { id: 'cozy-crunch', name: 'Cozy Crunch' },
        coins: 50, // TUNE:
      },
      {
        threshold: 20, // TUNE:
        goal: 'Befriend harvest squishies, gather Magic Fallen Leaves or find harvest clothes.',
        title: { id: 'pile-pal', name: 'Pile Pal' },
        coins: 100, // TUNE:
        clothing: 'leaf-pile-costume',
      },
    ],
  },
  {
    // Christmas (#37): counted like Halloween's while the Christmas window is
    // on, from the December things a kid can do today. Advent is one present
    // a day (plus one missed day a day) for December 1 to 25; about one day
    // in three also leaves a wrapped present to open (`spareOneIn`), and the
    // Eve's fall bundle holds one more; Christmas Eve gives a few fights
    // (`triesPerDay` on the 24th and the 25th's morning), each one chip.
    // So about 25 advent presents, 8 or 9 bag presents and up to 6 chips.
    // Left out: gifts (`gift.collected`: two kids could pass one Treat back
    // and forth forever). The Patch Tree (#37 2c) counts only the gift that
    // lights its star (`tree.decorated` with `starLit`, for the giver): once
    // a patch, so ornaments can't be farmed the same way. Every chip counts,
    // 0 points too: the fight's card says "You helped!", and the day's tries
    // already cap them. The goal text names every source
    // (`milestones.test.ts`), and never the Eve's BIG squishy (rule 6).
    id: 'christmas',
    name: 'Christmas',
    secret: false,
    season: 'christmas',
    progress: {
      from: 'events',
      sources: [
        { eventType: 'advent.claimed', where: [], player: 'userId' },
        { eventType: 'present.opened', where: [], player: 'userId' },
        { eventType: 'boss.chipped', where: [], player: 'userId' },
        {
          eventType: 'tree.decorated',
          where: [{ op: 'equals', field: 'starLit', value: true }],
          player: 'fromUserId',
        },
      ],
    },
    tiers: [
      {
        threshold: 5, // TUNE: about the first week of advent
        goal: 'Open 5 advent or bag presents, help on Eve, or light the star.',
        title: { id: 'jingle-pal', name: 'Jingle Pal' },
        coins: 25, // TUNE:
      },
      {
        threshold: 15, // TUNE: mid-December
        goal: 'Open 15 advent or bag presents, help on Eve, or light the star.',
        title: { id: 'cocoa-cuddler', name: 'Cocoa Cuddler' },
        coins: 50, // TUNE:
      },
      {
        threshold: 30, // TUNE: most of advent plus a few bag presents or Eve chips
        goal: 'Open 30 advent or bag presents, help on Eve, or light the star.',
        title: { id: 'merry-helper', name: 'Merry Helper' },
        coins: 100, // TUNE:
        clothing: 'jolly-elf-costume',
      },
    ],
  },
  {
    // The far Hollow (#306 6b, owner decision 4): the Crooked House's attic
    // chest puts it all right (`journey.completed`, once a season; only
    // Halloween's far Hollow is the Crooked House, a lantern house). Public,
    // not secret: its title shares its words with the attic's cloak, which
    // the catalog ships to every client.
    id: 'lantern-keeper',
    name: 'Lantern Keeper',
    secret: false,
    progress: {
      from: 'events',
      sources: [
        {
          eventType: 'journey.completed',
          where: [{ op: 'equals', field: 'season', value: 'halloween' }],
          player: 'userId',
        },
      ],
    },
    tiers: [
      {
        threshold: 1,
        goal: 'Put every room of the Crooked House right.',
        title: { id: 'lantern-keeper', name: 'Lantern Keeper' },
        coins: 50,
      },
    ],
  },
  // Found sets (#306 PR 5): the Rekindled title, and any later set's.
  ...FOUND_SETS.map(foundSetTrack),
];
