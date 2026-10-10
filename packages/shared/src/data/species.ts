import type { Move } from '../schemas/data/moves.js';
import type { Species } from '../schemas/data/species.js';

/*
 * The Phase 1 launch roster (design doc §4, issue #10): 14 base lines plus 4
 * Halloween lines, each with a level-based evolution (§8). Lines branch
 * (#32): a second form at the same level is a sidegrade, the same element
 * and rarity with a different feeling; how it's reached is server-only
 * (`data/server/evolution-rules.ts`). Public:
 * this table ships to every client. Secret squishies, spawn tables and
 * guardian tables live in `data/server/` (CLAUDE.md rule 6).
 *
 * Balance intent (§5): no squishy is strictly best. Harmonious element ×
 * feeling combos (1.2× synergy: Puddlepuff, Pebblesnooze, Emberbun,
 * Fizzlepop, Flurrypup, Mossmuffin, Dawndrop) get a slightly smaller stat
 * budget; the one conflicted launch squishy (Glowboo, Light + Spooky, 0.85×)
 * gets a bigger one. A few plain commons (common rarity, small stat totals;
 * Puddlepuff and Pebblesnooze lean on their synergy) are great counters to
 * rarer squishies:
 *   Fuzzbolt     → Dawndrop, Thunderpuff  (Spark hits Light, Pebble Plop hits Spark;
 *                                          Silly disarms Joy and Brave)
 *   Pebblesnooze → Candlekit, Glowboo     (Stone hits Fire; Sleepy calms Spooky)
 *   Puddlepuff   → Glimmerock             (Water hits Stone; Silly disarms Joy)
 *   Snoozicle    → Mossmuffin             (Frost hits Leaf; Sleepy calms Cozy)
 * `species.test.ts` plays those matchups with the real engine.
 *
 * Stat budgets (hp + attack + defense + speed) for base forms: common ~200,
 * uncommon ~220, rare ~235, epic ~250, legendary ~275; an evolution adds
 * about 40% and is one rarity step up. Evolution levels: common 16,
 * uncommon 18, rare 22, epic 26, legendary 30.
 */

/*
 * Moves (design doc §6). Every move is named after something silly or sweet
 * (style guide §4). Each element has a light, reliable move (~40–45 power),
 * a bigger one (~65–80) and a helper (status, stat or heal).
 */
export const MOVES: Move[] = [
  // Fire
  {
    id: 'ember-boop',
    name: 'Ember Boop',
    description: 'A warm little boop on the nose.',
    element: 'fire',
    power: 40, // TUNE:
    accuracy: 100, // TUNE:
  },
  {
    id: 'toasty-tumble',
    name: 'Toasty Tumble',
    description: 'Rolls over in a cozy, crackly somersault.',
    element: 'fire',
    power: 70, // TUNE:
    accuracy: 90, // TUNE:
  },
  {
    id: 'wiggle-wick',
    name: 'Wiggle Wick',
    description: 'A flickery wiggle that makes the other squishy dizzy.',
    element: 'fire',
    power: 50, // TUNE:
    accuracy: 95, // TUNE:
    effects: [{ type: 'status', status: 'dizzy', chance: 25 }], // TUNE:
  },
  {
    id: 'cozy-crackle',
    name: 'Cozy Crackle',
    description: 'Sits by a crackly glow and feels much better.',
    element: 'fire',
    power: 0,
    accuracy: 100,
    effects: [{ type: 'heal', percent: 35 }], // TUNE:
  },
  // Water
  {
    id: 'giggle-drizzle',
    name: 'Giggle Drizzle',
    description: 'A sprinkle of giggly rain.',
    element: 'water',
    power: 40, // TUNE:
    accuracy: 100, // TUNE:
  },
  {
    id: 'belly-flop',
    name: 'Belly Flop',
    description: 'A big, bouncy splash landing. Splat!',
    element: 'water',
    power: 65, // TUNE:
    accuracy: 90, // TUNE:
    effects: [{ type: 'status', status: 'dizzy', chance: 20 }], // TUNE:
  },
  {
    id: 'bubble-bath',
    name: 'Bubble Bath',
    description: 'A warm, bubbly soak. Ahhh.',
    element: 'water',
    power: 0,
    accuracy: 100,
    effects: [{ type: 'heal', percent: 40 }], // TUNE:
  },
  {
    id: 'splish-splash',
    name: 'Splish Splash',
    description: 'Splashes every puddle in sight, all at once.',
    element: 'water',
    power: 80, // TUNE:
    accuracy: 85, // TUNE:
  },
  // Leaf
  {
    id: 'leafy-tickle',
    name: 'Leafy Tickle',
    description: 'A soft leaf tickles right under the chin.',
    element: 'leaf',
    power: 40, // TUNE:
    accuracy: 100, // TUNE:
  },
  {
    id: 'prickle-roll',
    name: 'Prickle Roll',
    description: 'Curls up into a fuzzy, prickly ball and rolls in.',
    element: 'leaf',
    power: 70, // TUNE:
    accuracy: 90, // TUNE:
  },
  {
    id: 'pollen-puff',
    name: 'Pollen Puff',
    description: 'A puff of pollen. Ah… ah… achoo! So dizzy.',
    element: 'leaf',
    power: 20, // TUNE:
    accuracy: 95, // TUNE:
    effects: [{ type: 'status', status: 'dizzy', chance: 40 }], // TUNE:
  },
  {
    id: 'mossy-nap',
    name: 'Mossy Nap',
    description: 'A quick nap on a soft bed of moss.',
    element: 'leaf',
    power: 0,
    accuracy: 100,
    effects: [{ type: 'heal', percent: 40 }], // TUNE:
  },
  {
    id: 'pumpkin-roll',
    name: 'Pumpkin Roll',
    description: 'Rolls in like a runaway pumpkin. Bonk!',
    element: 'leaf',
    power: 60, // TUNE:
    accuracy: 95, // TUNE:
  },
  // Frost
  {
    id: 'snowball-toss',
    name: 'Snowball Toss',
    description: 'A fluffy snowball, tossed with a giggle.',
    element: 'frost',
    power: 45, // TUNE:
    accuracy: 100, // TUNE:
  },
  {
    id: 'frosty-pounce',
    name: 'Frosty Pounce',
    description: 'A big, chilly pounce. Brrr!',
    element: 'frost',
    power: 75, // TUNE:
    accuracy: 90, // TUNE:
  },
  {
    id: 'chilly-yawn',
    name: 'Chilly Yawn',
    description: 'A yawn so frosty the other squishy starts yawning too.',
    element: 'frost',
    power: 0,
    accuracy: 80, // TUNE:
    effects: [{ type: 'status', status: 'sleepy', chance: 60 }], // TUNE:
  },
  {
    id: 'brrr-bluster',
    name: 'Brrr Bluster',
    description: 'Puffs up big in the cold wind and feels extra bold.',
    element: 'frost',
    power: 0,
    accuracy: 100,
    effects: [{ type: 'stat', target: 'self', stat: 'attack', stages: 1, chance: 100 }], // TUNE:
  },
  // Spark
  {
    id: 'zip-zap',
    name: 'Zip Zap',
    description: 'A tiny, tickly zap. Bzzt!',
    element: 'spark',
    power: 40, // TUNE:
    accuracy: 100, // TUNE:
  },
  {
    id: 'fizzy-pop',
    name: 'Fizzy Pop',
    description: 'Shakes up and pops like a soda bubble.',
    element: 'spark',
    power: 70, // TUNE:
    accuracy: 90, // TUNE:
    effects: [{ type: 'status', status: 'dizzy', chance: 15 }], // TUNE:
  },
  {
    id: 'static-fluff',
    name: 'Static Fluff',
    description: 'Fluffs up with static so the other squishy gets stuck to it.',
    element: 'spark',
    power: 30, // TUNE:
    accuracy: 100, // TUNE:
    effects: [{ type: 'stat', target: 'opponent', stat: 'speed', stages: -1, chance: 60 }], // TUNE:
  },
  {
    id: 'zoomies',
    name: 'Zoomies',
    description: 'Zooms round and round and gets super zippy.',
    element: 'spark',
    power: 0,
    accuracy: 100,
    effects: [{ type: 'stat', target: 'self', stat: 'speed', stages: 2, chance: 100 }], // TUNE:
  },
  {
    id: 'thunder-hug',
    name: 'Thunder Hug',
    description: 'A big, rumbly, crackly hug.',
    element: 'spark',
    power: 85, // TUNE:
    accuracy: 85, // TUNE:
  },
  // Stone
  {
    id: 'pebble-plop',
    name: 'Pebble Plop',
    description: 'Plops a smooth pebble down. Plonk!',
    element: 'stone',
    power: 45, // TUNE:
    accuracy: 100, // TUNE:
  },
  {
    id: 'rumble-roll',
    name: 'Rumble Roll',
    description: 'Rolls in with a big, rumbly wobble.',
    element: 'stone',
    power: 75, // TUNE:
    accuracy: 90, // TUNE:
  },
  {
    id: 'rock-a-bye',
    name: 'Rock-a-Bye',
    description: 'A gentle lullaby that makes everyone yawn.',
    element: 'stone',
    power: 0,
    accuracy: 85, // TUNE:
    effects: [{ type: 'status', status: 'sleepy', chance: 60 }], // TUNE:
  },
  {
    id: 'sturdy-sit',
    name: 'Sturdy Sit',
    description: 'Sits very, very still. Nothing can budge it now.',
    element: 'stone',
    power: 0,
    accuracy: 100,
    effects: [{ type: 'stat', target: 'self', stat: 'defense', stages: 2, chance: 100 }], // TUNE:
  },
  // Shadow
  {
    id: 'peekaboo',
    name: 'Peekaboo!',
    description: 'Hides, then pops out. Peekaboo!',
    element: 'shadow',
    power: 45, // TUNE:
    accuracy: 100, // TUNE:
  },
  {
    id: 'shadow-snuggle',
    name: 'Shadow Snuggle',
    description: 'Wraps the other squishy in a soft, shadowy snuggle.',
    element: 'shadow',
    power: 65, // TUNE:
    accuracy: 95, // TUNE:
  },
  {
    id: 'boo',
    name: 'Boo!',
    description: 'Boo! Then a giggle. The other squishy lets its guard down.',
    element: 'shadow',
    power: 0,
    accuracy: 100,
    effects: [{ type: 'stat', target: 'opponent', stat: 'defense', stages: -1, chance: 100 }], // TUNE:
  },
  {
    id: 'upside-flop',
    name: 'Upside Flop',
    description: 'Flops down upside down. Which way is up?',
    element: 'shadow',
    power: 60, // TUNE:
    accuracy: 90, // TUNE:
    effects: [{ type: 'status', status: 'dizzy', chance: 25 }], // TUNE:
  },
  // Light
  {
    // Thanksgiving's move: Crunchkin's line pops out of a leaf pile.
    id: 'leaf-pile-leap',
    name: 'Leaf Pile Leap',
    description: 'Dives into a leaf pile and pops out on top of you. Crunch!',
    element: 'leaf',
    power: 65, // TUNE:
    accuracy: 95, // TUNE:
  },
  {
    id: 'sunny-beam',
    name: 'Sunny Beam',
    description: 'A warm beam of morning sunshine.',
    element: 'light',
    power: 45, // TUNE:
    accuracy: 100, // TUNE:
  },
  {
    id: 'dazzle-dance',
    name: 'Dazzle Dance',
    description: 'A sparkly twirl that leaves everyone seeing stars.',
    element: 'light',
    power: 70, // TUNE:
    accuracy: 90, // TUNE:
    effects: [{ type: 'status', status: 'dizzy', chance: 15 }], // TUNE:
  },
  {
    id: 'night-light',
    name: 'Night Light',
    description: 'Glows extra bright so nobody has to be scared of the dark.',
    element: 'light',
    power: 55, // TUNE:
    accuracy: 100, // TUNE:
  },
  {
    id: 'glow-up',
    name: 'Glow Up',
    description: 'Glows brighter and brighter and feels quick and bold.',
    element: 'light',
    power: 0,
    accuracy: 100,
    effects: [
      { type: 'stat', target: 'self', stat: 'attack', stages: 1, chance: 100 }, // TUNE:
      { type: 'stat', target: 'self', stat: 'speed', stages: 1, chance: 100 }, // TUNE:
    ],
  },
  // Branch forms' signature moves (#32).
  {
    id: 'snore-drizzle',
    name: 'Snore Drizzle',
    description: 'A drowsy little rain cloud. The other squishy gets yawny.',
    element: 'water',
    power: 0,
    accuracy: 80, // TUNE:
    effects: [{ type: 'status', status: 'sleepy', chance: 60 }], // TUNE:
  },
  {
    id: 'toasty-snore',
    name: 'Toasty Snore',
    description: 'A warm, crackly snore that makes the other squishy sleepy.',
    element: 'fire',
    power: 0,
    accuracy: 80, // TUNE:
    effects: [{ type: 'status', status: 'sleepy', chance: 60 }], // TUNE:
  },
  {
    id: 'petal-party',
    name: 'Petal Party',
    description: 'Throws petals everywhere and feels fantastic.',
    element: 'leaf',
    power: 0,
    accuracy: 100,
    effects: [
      { type: 'stat', target: 'self', stat: 'attack', stages: 1, chance: 100 }, // TUNE:
      { type: 'stat', target: 'self', stat: 'speed', stages: 1, chance: 100 }, // TUNE:
    ],
  },
  {
    id: 'static-glide',
    name: 'Static Glide',
    description: 'Glides in on a fizzy breeze. Zzzip!',
    element: 'spark',
    power: 55, // TUNE:
    accuracy: 100,
  },
  {
    id: 'twirly-whirl',
    name: 'Twirly Whirl',
    description: 'Spins on the ice until the other squishy is dizzy too.',
    element: 'frost',
    power: 50, // TUNE:
    accuracy: 95, // TUNE:
    effects: [{ type: 'status', status: 'dizzy', chance: 25 }], // TUNE:
  },
  {
    id: 'lantern-grin',
    name: 'Lantern Grin',
    description: 'A big, glowy, lopsided grin. The other squishy forgets what it was doing.',
    element: 'leaf',
    power: 0,
    accuracy: 100,
    effects: [{ type: 'stat', target: 'opponent', stat: 'attack', stages: -1, chance: 100 }], // TUNE:
  },
  {
    id: 'night-light-hug',
    name: 'Night-Light Hug',
    description: 'A warm, glowy hug that chases the dark away.',
    element: 'light',
    power: 0,
    accuracy: 100,
    effects: [{ type: 'heal', percent: 35 }], // TUNE:
  },
  {
    id: 'upside-snooze',
    name: 'Upside Snooze',
    description: 'Hangs upside down for a quick nap. Much better.',
    element: 'shadow',
    power: 0,
    accuracy: 100,
    effects: [{ type: 'heal', percent: 40 }], // TUNE:
  },
  {
    id: 'sparkler-swirl',
    name: 'Sparkler Swirl',
    description: 'Twirls a sparkly little flame. Ooh, pretty!',
    element: 'fire',
    power: 55, // TUNE:
    accuracy: 100,
  },
  {
    id: 'rumble-boop',
    name: 'Rumble Boop',
    description: 'A big, rumbly boop with a sturdy horn. Wobble wobble.',
    element: 'stone',
    power: 70, // TUNE:
    accuracy: 90, // TUNE:
    effects: [{ type: 'status', status: 'dizzy', chance: 15 }], // TUNE:
  },
  {
    id: 'static-snuggle',
    name: 'Static Snuggle',
    description: 'Wraps up in a fuzzy, crackly blanket. So snug.',
    element: 'spark',
    power: 0,
    accuracy: 100,
    effects: [{ type: 'stat', target: 'self', stat: 'defense', stages: 2, chance: 100 }], // TUNE:
  },
  {
    id: 'bubble-bounce',
    name: 'Bubble Bounce',
    description: 'Bounces in on a big wobbly bubble. Boing!',
    element: 'water',
    power: 65, // TUNE:
    accuracy: 95, // TUNE:
  },
  {
    id: 'snow-snuggle',
    name: 'Snow Snuggle',
    description: 'Fluffs up its coat and feels much better.',
    element: 'frost',
    power: 0,
    accuracy: 100,
    effects: [{ type: 'heal', percent: 35 }], // TUNE:
  },
  {
    id: 'geode-glint',
    name: 'Geode Glint',
    description: 'Cracks a sleepy smile, and the sparkles inside go everywhere.',
    element: 'stone',
    power: 65, // TUNE:
    accuracy: 95, // TUNE:
    effects: [{ type: 'status', status: 'dizzy', chance: 15 }], // TUNE:
  },
  {
    id: 'lantern-flutter',
    name: 'Lantern Flutter',
    description: 'Flutters round and round a lantern. Whoosh!',
    element: 'shadow',
    power: 55, // TUNE:
    accuracy: 100,
  },
  {
    id: 'sprinkle-sneeze',
    name: 'Sprinkle Sneeze',
    description: 'Ah… ah… achoo! Sprinkles everywhere.',
    element: 'leaf',
    power: 50, // TUNE:
    accuracy: 95, // TUNE:
    effects: [{ type: 'status', status: 'dizzy', chance: 25 }], // TUNE:
  },
  {
    id: 'moonbeam-lullaby',
    name: 'Moonbeam Lullaby',
    description: 'Hums a soft, silvery lullaby. So… sleepy…',
    element: 'light',
    power: 0,
    accuracy: 85, // TUNE:
    effects: [{ type: 'status', status: 'sleepy', chance: 60 }], // TUNE:
  },
  {
    id: 'midnight-hoot',
    name: 'Midnight Hoot',
    description: 'A deep hoot like faraway thunder. The other squishy gets jumpy.',
    element: 'spark',
    power: 0,
    accuracy: 100,
    effects: [{ type: 'stat', target: 'opponent', stat: 'defense', stages: -1, chance: 100 }], // TUNE:
  },
  {
    id: 'acorn-stash',
    name: 'Acorn Stash',
    description: 'Tucks into a pile of leaves and snacks. Nothing can bother it now.',
    element: 'leaf',
    power: 0,
    accuracy: 100,
    effects: [{ type: 'stat', target: 'self', stat: 'defense', stages: 1, chance: 100 }], // TUNE:
  },
];

/*
 * Species, base form then its evolution. Stats, rarities and evolution
 * levels are all first guesses: // TUNE: every `baseStats` and `level`.
 */
export const SPECIES: Species[] = [
  // Water + Silly. A plain counter: Silly disarms Joy, Water soaks Stone.
  {
    id: 'puddlepuff',
    name: 'Puddlepuff',
    description: 'Jumps in every puddle it sees, then giggles about it.',
    element: 'water',
    feeling: 'silly',
    rarity: 'common',
    baseStats: { hp: 60, attack: 50, defense: 45, speed: 55 }, // TUNE:
    moves: ['giggle-drizzle', 'belly-flop', 'bubble-bath'],
    evolutions: [
      { into: 'splashmallow', level: 16 },
      { into: 'drizzledoze', level: 16 },
    ], // TUNE:
    visual: {
      body: 'drop',
      palette: ['#7cc0f4', '#e8f6ff', '#3f86d8'],
      parts: ['dot-eyes', 'open-mouth', 'blush-cheeks', 'belly-patch', 'water-curl', 'wiggle-tail'],
      pose: 'sit',
      attackPart: 'tail',
    },
    habitatPreferences: { elements: ['water'], feelings: ['silly', 'joy'] },
  },
  {
    id: 'splashmallow',
    name: 'Splashmallow',
    description: 'A big, bouncy splash of a squishy. Every puddle is a party.',
    element: 'water',
    feeling: 'silly',
    rarity: 'uncommon',
    baseStats: { hp: 80, attack: 70, defense: 65, speed: 75 }, // TUNE:
    moves: ['giggle-drizzle', 'belly-flop', 'bubble-bath', 'splish-splash'],
    evolutions: [],
    visual: {
      body: 'orb',
      palette: ['#6cb6f2', '#e8f6ff', '#3477cc', '#ffffff'],
      parts: [
        'dot-eyes',
        'brave-brows',
        'open-mouth',
        'fangs',
        'water-curl',
        'fin-row',
        'serpent-body',
      ],
      size: 1.3,
      stance: 0.45,
      pose: 'slither',
      attackPart: 'tail',
    },
    habitatPreferences: { elements: ['water'], feelings: ['silly', 'joy'] },
  },
  {
    id: 'drizzledoze',
    name: 'Drizzledoze',
    description: 'A sleepy pond frog. It snores tiny rain clouds.',
    element: 'water',
    feeling: 'sleepy',
    rarity: 'uncommon',
    baseStats: { hp: 92, attack: 63, defense: 83, speed: 68 }, // TUNE:
    moves: ['giggle-drizzle', 'splish-splash', 'bubble-bath', 'snore-drizzle'],
    evolutions: [],
    visual: {
      body: 'bun',
      palette: ['#7cc0f4', '#e8f6ff', '#3f86d8', '#ffffff'],
      parts: [
        'sleepy-eyes',
        'tiny-smile',
        'blush-cheeks',
        'belly-patch',
        'water-curl',
        'side-fins',
        'hop-feet',
        'wiggle-tail',
      ],
      size: 1.3,
      head: { body: 'orb', size: 0.8, forward: 0.3, up: 0.5 },
      stance: 0.15,
      pose: 'sit',
      attackPart: 'tail',
    },
    habitatPreferences: { elements: ['water'], feelings: ['sleepy', 'cozy'] },
  },

  // Stone + Sleepy. A plain counter: Stone beats Fire, Sleepy calms Spooky and Cozy.
  {
    id: 'pebblesnooze',
    name: 'Pebblesnooze',
    description: 'Naps on warm rocks. Sometimes it is a warm rock.',
    element: 'stone',
    feeling: 'sleepy',
    rarity: 'common',
    baseStats: { hp: 60, attack: 45, defense: 65, speed: 25 }, // TUNE:
    moves: ['pebble-plop', 'rock-a-bye', 'sturdy-sit'],
    evolutions: [
      { into: 'boulderdoze', level: 16 },
      { into: 'rumblehorn', level: 16 },
    ], // TUNE:
    visual: {
      body: 'pebble',
      palette: ['#b4ada2', '#e9e3d9', '#8a7cc4', '#6f665b'],
      parts: ['sleepy-eyes', 'tiny-smile', 'round-ears', 'nightcap', 'stubby-legs', 'freckles'],
      head: { body: 'orb', size: 0.75, forward: 0.62, up: 0.05 },
      stance: 0.12,
      pose: 'stand',
      attackPart: 'crown',
    },
    habitatPreferences: { elements: ['stone'], feelings: ['sleepy', 'cozy'] },
  },
  {
    id: 'boulderdoze',
    name: 'Boulderdoze',
    description: 'A big, snoozy boulder. Mountains have tried to wake it. No luck.',
    element: 'stone',
    feeling: 'sleepy',
    rarity: 'uncommon',
    baseStats: { hp: 85, attack: 65, defense: 90, speed: 35 }, // TUNE:
    moves: ['pebble-plop', 'rumble-roll', 'rock-a-bye', 'sturdy-sit'],
    evolutions: [],
    visual: {
      body: 'pebble',
      palette: ['#aaa296', '#e9e3d9', '#7a6cb8', '#837a6d'],
      parts: [
        'sleepy-eyes',
        'smirk',
        'round-ears',
        'nightcap',
        'cone-horns',
        'crag-nubs',
        'stubby-legs',
      ],
      size: 1.35,
      head: { body: 'orb', size: 0.6, forward: 0.68, up: 0.12 },
      stance: 0.22,
      pose: 'stand',
      attackPart: 'back',
    },
    habitatPreferences: { elements: ['stone'], feelings: ['sleepy', 'cozy'] },
  },
  {
    id: 'rumblehorn',
    name: 'Rumblehorn',
    description: "Woke up from its nap feeling brave. Now it guards everyone else's naps.",
    element: 'stone',
    feeling: 'brave',
    rarity: 'uncommon',
    baseStats: { hp: 75, attack: 95, defense: 85, speed: 45 }, // TUNE:
    moves: ['pebble-plop', 'rumble-boop', 'sturdy-sit', 'rumble-roll'],
    evolutions: [],
    visual: {
      body: 'bean',
      palette: ['#b4ada2', '#e9e3d9', '#8a7cc4', '#6f665b'],
      parts: [
        'sharp-eyes',
        'brave-brows',
        'smirk',
        'round-ears',
        'uni-horn',
        'crag-nubs',
        'strong-arms',
        'biped-legs',
      ],
      size: 1.35,
      head: { body: 'orb', size: 0.6, forward: 0.1, up: 0.82 },
      stance: 0.3,
      pose: 'upright',
      attackPart: 'arms',
    },
    habitatPreferences: { elements: ['stone'], feelings: ['brave', 'sleepy'] },
  },

  // Fire + Cozy (harmonious).
  {
    id: 'emberbun',
    name: 'Emberbun',
    description: 'Warm as a fresh bun. Loves snuggling up by the Hearthfire.',
    element: 'fire',
    feeling: 'cozy',
    rarity: 'common',
    baseStats: { hp: 50, attack: 55, defense: 45, speed: 50 }, // TUNE:
    moves: ['ember-boop', 'toasty-tumble', 'cozy-crackle'],
    evolutions: [
      { into: 'hearthbun', level: 16 },
      { into: 'embernap', level: 16 },
    ], // TUNE:
    visual: {
      body: 'blob',
      palette: ['#ffad73', '#fff0e0', '#ff6a2e'],
      parts: [
        'oval-eyes',
        'smile',
        'blush-cheeks',
        'long-ears',
        'flame-tuft',
        'biped-legs',
        'stubby-arms',
        'ball-tail',
      ],
      glow: 'accent',
      head: { body: 'orb', size: 1.1, forward: 0.08, up: 0.55 },
      stance: 0.3,
      pose: 'stand',
      attackPart: 'arms',
    },
    habitatPreferences: { elements: ['fire'], feelings: ['cozy'] },
  },
  {
    id: 'hearthbun',
    name: 'Hearthbun',
    description: 'A big, toasty bun that keeps the whole patch warm.',
    element: 'fire',
    feeling: 'cozy',
    rarity: 'uncommon',
    baseStats: { hp: 70, attack: 80, defense: 60, speed: 70 }, // TUNE:
    moves: ['ember-boop', 'toasty-tumble', 'cozy-crackle', 'pebble-plop'],
    evolutions: [],
    visual: {
      body: 'pear',
      palette: ['#ff9a55', '#fff0e0', '#ff5a1f', '#ffd166'],
      parts: [
        'sharp-eyes',
        'smirk',
        'blush-cheeks',
        'swept-ears',
        'flame-mane',
        'biped-legs',
        'strong-arms',
        'flame-tail',
        'belly-patch',
      ],
      size: 1.3,
      glow: 'accent',
      head: { body: 'orb', size: 0.74, forward: 0.12, up: 0.78 },
      stance: 0.28,
      pose: 'upright',
      attackPart: 'arms',
    },
    habitatPreferences: { elements: ['fire'], feelings: ['cozy'] },
  },
  {
    id: 'embernap',
    name: 'Embernap',
    description: 'Curled up like a warm coal. Toasty to cuddle, impossible to wake.',
    element: 'fire',
    feeling: 'sleepy',
    rarity: 'uncommon',
    baseStats: { hp: 93, attack: 75, defense: 88, speed: 55 }, // TUNE:
    moves: ['ember-boop', 'toasty-tumble', 'cozy-crackle', 'toasty-snore'],
    evolutions: [],
    visual: {
      body: 'bun',
      palette: ['#ffad73', '#fff0e0', '#ff6a2e', '#ffd166'],
      parts: [
        'sleepy-eyes',
        'tiny-smile',
        'blush-cheeks',
        'floppy-ears',
        'flame-crown',
        'stubby-arms',
        'stubby-legs',
        'fluff-tail',
      ],
      size: 1.3,
      glow: 'accent',
      head: { body: 'orb', size: 0.85, forward: 0.45, up: 0.3 },
      stance: 0.1,
      pose: 'sit',
      attackPart: 'crown',
    },
    habitatPreferences: { elements: ['fire'], feelings: ['sleepy', 'cozy'] },
  },

  // Frost + Sleepy. A plain counter: Frost nips Leaf, Sleepy calms Cozy.
  {
    id: 'snoozicle',
    name: 'Snoozicle',
    description: 'Falls asleep anywhere chilly. Wakes up with frosty whiskers.',
    element: 'frost',
    feeling: 'sleepy',
    rarity: 'common',
    baseStats: { hp: 60, attack: 50, defense: 55, speed: 40 }, // TUNE:
    moves: ['snowball-toss', 'chilly-yawn', 'frosty-pounce'],
    evolutions: [
      { into: 'drowsiberg', level: 16 },
      { into: 'twirlicle', level: 16 },
    ], // TUNE:
    visual: {
      body: 'tiered',
      palette: ['#d4f0ff', '#ffffff', '#86c5eb'],
      parts: ['sleepy-eyes', 'tiny-smile', 'pointy-ears', 'stubby-arms', 'ball-tail'],
      pose: 'sit',
      attackPart: 'arms',
    },
    habitatPreferences: { elements: ['frost'], feelings: ['sleepy'] },
  },
  {
    id: 'drowsiberg',
    name: 'Drowsiberg',
    description: 'A sleepy little iceberg. Most of its nap is under the surface.',
    element: 'frost',
    feeling: 'sleepy',
    rarity: 'uncommon',
    baseStats: { hp: 85, attack: 70, defense: 80, speed: 55 }, // TUNE:
    moves: ['snowball-toss', 'chilly-yawn', 'frosty-pounce', 'sturdy-sit'],
    evolutions: [],
    visual: {
      body: 'bean',
      palette: ['#c2e8fc', '#ffffff', '#6fb4e0', '#e8f8ff'],
      parts: [
        'sleepy-eyes',
        'smirk',
        'fangs',
        'pointy-ears',
        'icicle-crown',
        'fur-ruff',
        'strong-arms',
        'biped-legs',
      ],
      size: 1.3,
      head: { body: 'orb', size: 0.62, forward: 0.08, up: 0.82 },
      stance: 0.3,
      pose: 'upright',
      attackPart: 'arms',
    },
    habitatPreferences: { elements: ['frost'], feelings: ['sleepy'] },
  },
  {
    id: 'twirlicle',
    name: 'Twirlicle',
    description: 'Woke up, found the ice, and never stopped skating. Wheee!',
    element: 'frost',
    feeling: 'silly',
    rarity: 'uncommon',
    baseStats: { hp: 77, attack: 77, defense: 65, speed: 98 }, // TUNE:
    moves: ['snowball-toss', 'frosty-pounce', 'brrr-bluster', 'twirly-whirl'],
    evolutions: [],
    visual: {
      body: 'tiered',
      palette: ['#d4f0ff', '#ffffff', '#86c5eb', '#ff9ad5'],
      parts: [
        'sharp-eyes',
        'open-mouth',
        'blush-cheeks',
        'floppy-ears',
        'fur-ruff',
        'stubby-arms',
        'side-fins',
        'hop-feet',
      ],
      size: 1.3,
      stance: 0.2,
      pose: 'stand',
      attackPart: 'wings',
    },
    habitatPreferences: { elements: ['frost'], feelings: ['silly', 'joy'] },
  },

  // Spark + Silly. A plain counter: Spark zaps Light, Silly disarms Joy and Brave.
  {
    id: 'fuzzbolt',
    name: 'Fuzzbolt',
    description: 'So full of static its fur sticks out in every direction.',
    element: 'spark',
    feeling: 'silly',
    rarity: 'common',
    baseStats: { hp: 50, attack: 50, defense: 45, speed: 70 }, // TUNE:
    moves: ['zip-zap', 'fizzy-pop', 'pebble-plop'], // TUNE: Fizzy Pop, so it can hit hard
    evolutions: [
      { into: 'frizzbolt', level: 16 },
      { into: 'glidebolt', level: 16 },
    ], // TUNE:
    visual: {
      body: 'barrel',
      palette: ['#ffe45c', '#fff9db', '#f5a800'],
      parts: ['dot-eyes', 'open-mouth', 'blush-cheeks', 'bolt-ears', 'stubby-legs', 'bolt-chain'],
      head: { body: 'orb', size: 1.05, forward: 0.45, up: 0.3 },
      stance: 0.15,
      pose: 'stand',
      attackPart: 'tail',
    },
    habitatPreferences: { elements: ['spark'], feelings: ['silly'] },
  },
  {
    id: 'frizzbolt',
    name: 'Frizzbolt',
    description: 'The frizziest squishy around. Brushing does not help one bit.',
    element: 'spark',
    feeling: 'silly',
    rarity: 'uncommon',
    baseStats: { hp: 75, attack: 70, defense: 60, speed: 95 }, // TUNE:
    moves: ['zip-zap', 'belly-flop', 'fizzy-pop', 'pebble-plop'], // TUNE: Belly Flop for Stone foes
    evolutions: [],
    visual: {
      body: 'barrel',
      palette: ['#ffd93d', '#fff9db', '#f09a00', '#ffffff'],
      parts: [
        'sharp-eyes',
        'open-mouth',
        'fangs',
        'bolt-ears',
        'spark-crest',
        'long-legs',
        'bolt-chain',
        'spots',
      ],
      size: 1.3,
      head: { body: 'orb', size: 0.8, forward: 0.6, up: 0.62 },
      stance: 0.45,
      pose: 'stand',
      attackPart: 'tail',
    },
    habitatPreferences: { elements: ['spark'], feelings: ['silly'] },
  },
  {
    id: 'glidebolt',
    name: 'Glidebolt',
    description: 'A fluffy glider that zips from tree to tree. It never lands where it meant to.',
    element: 'spark',
    feeling: 'joy',
    rarity: 'uncommon',
    baseStats: { hp: 72, attack: 78, defense: 55, speed: 105 }, // TUNE:
    moves: ['zip-zap', 'fizzy-pop', 'zoomies', 'static-glide'],
    evolutions: [],
    visual: {
      body: 'barrel',
      palette: ['#ffe45c', '#fff9db', '#f5a800', '#ffffff'],
      parts: [
        'happy-eyes',
        'smile',
        'blush-cheeks',
        'bolt-ears',
        'big-bat-wings',
        'stubby-legs',
        'bolt-chain',
        'belly-patch',
      ],
      size: 1.3,
      head: { body: 'orb', size: 0.9, forward: 0.55, up: 0.45 },
      stance: 0.35,
      pose: 'hover',
      attackPart: 'wings',
    },
    habitatPreferences: { elements: ['spark'], feelings: ['joy', 'silly'] },
  },

  // Spark + Joy (harmonious).
  {
    id: 'fizzlepop',
    name: 'Fizzlepop',
    description: 'Fizzes with happy bubbles. Pops a little when it laughs.',
    element: 'spark',
    feeling: 'joy',
    rarity: 'uncommon',
    baseStats: { hp: 50, attack: 60, defense: 45, speed: 60 }, // TUNE:
    moves: ['zip-zap', 'fizzy-pop', 'zoomies'],
    evolutions: [
      { into: 'zingaling', level: 18 },
      { into: 'snugglestar', level: 18 },
    ], // TUNE:
    visual: {
      body: 'star',
      palette: ['#ffc93c', '#fffbe6', '#ff8fc0'],
      parts: ['happy-eyes', 'smile', 'blush-cheeks', 'nub-wings'],
      stance: 0.3,
      pose: 'hover',
      attackPart: 'wings',
    },
    habitatPreferences: { elements: ['spark'], feelings: ['joy'] },
  },
  {
    id: 'zingaling',
    name: 'Zingaling',
    description: 'Zings about like a happy little firework. Wheee!',
    element: 'spark',
    feeling: 'joy',
    rarity: 'rare',
    baseStats: { hp: 70, attack: 85, defense: 60, speed: 85 }, // TUNE:
    moves: ['zip-zap', 'fizzy-pop', 'zoomies', 'sunny-beam'],
    evolutions: [],
    visual: {
      body: 'star',
      palette: ['#ffbd1f', '#fffbe6', '#ff7fb8', '#ffffff'],
      parts: ['happy-eyes', 'smirk', 'blush-cheeks', 'glow-wings', 'zing-antennae', 'freckles'],
      size: 1.3,
      stance: 0.45,
      pose: 'hover',
      attackPart: 'horns',
    },
    habitatPreferences: { elements: ['spark', 'light'], feelings: ['joy'] },
  },
  {
    id: 'snugglestar',
    name: 'Snugglestar',
    description: 'A warm little star that tucks itself in at the top of the sky.',
    element: 'spark',
    feeling: 'cozy',
    rarity: 'rare',
    baseStats: { hp: 82, attack: 65, defense: 73, speed: 65 }, // TUNE:
    moves: ['zip-zap', 'fizzy-pop', 'static-fluff', 'static-snuggle'],
    evolutions: [],
    visual: {
      body: 'star',
      palette: ['#ffc93c', '#fffbe6', '#8a7cc4', '#ffffff'],
      parts: ['oval-eyes', 'tiny-smile', 'blush-cheeks', 'nightcap', 'plume-wings', 'freckles'],
      size: 1.3,
      stance: 0.4,
      pose: 'hover',
      attackPart: 'wings',
    },
    habitatPreferences: { elements: ['spark'], feelings: ['cozy', 'sleepy'] },
  },

  // Water + Cozy.
  {
    id: 'bubbletub',
    name: 'Bubbletub',
    description: 'Always smells like bubble bath. Gives very soggy hugs.',
    element: 'water',
    feeling: 'cozy',
    rarity: 'uncommon',
    baseStats: { hp: 70, attack: 50, defense: 60, speed: 40 }, // TUNE:
    moves: ['giggle-drizzle', 'bubble-bath', 'belly-flop'],
    evolutions: [
      { into: 'bubbletide', level: 18 },
      { into: 'bubblejelly', level: 18 },
    ], // TUNE:
    visual: {
      body: 'bun',
      palette: ['#8fded9', '#f4fffe', '#3fb5bf'],
      parts: ['oval-eyes', 'smile', 'blush-cheeks', 'bubble-crown', 'side-fins', 'tail-fan'],
      pose: 'sit',
      attackPart: 'tail',
    },
    habitatPreferences: { elements: ['water'], feelings: ['cozy'] },
  },
  {
    id: 'bubbletide',
    name: 'Bubbletide',
    description: 'Rolls in like a warm wave of bubbles. Everybody gets a soak.',
    element: 'water',
    feeling: 'cozy',
    rarity: 'rare',
    baseStats: { hp: 100, attack: 70, defense: 85, speed: 55 }, // TUNE:
    moves: ['giggle-drizzle', 'bubble-bath', 'belly-flop', 'splish-splash'],
    evolutions: [],
    visual: {
      body: 'bun',
      palette: ['#74d2cf', '#f4fffe', '#2fa3ad', '#ffffff'],
      parts: [
        'sharp-eyes',
        'smirk',
        'blush-cheeks',
        'uni-horn',
        'fin-row',
        'side-fins',
        'tail-fan',
      ],
      size: 1.3,
      stance: 0.15,
      pose: 'slither',
      attackPart: 'horns',
    },
    habitatPreferences: { elements: ['water'], feelings: ['cozy'] },
  },
  {
    id: 'bubblejelly',
    name: 'Bubblejelly',
    description: 'Floats along on its own bubbles, wiggling all its wiggly bits.',
    element: 'water',
    feeling: 'joy',
    rarity: 'rare',
    baseStats: { hp: 86, attack: 86, defense: 70, speed: 92 }, // TUNE:
    moves: ['giggle-drizzle', 'splish-splash', 'bubble-bath', 'bubble-bounce'],
    evolutions: [],
    visual: {
      body: 'ghost',
      palette: ['#8fded9', '#f4fffe', '#3fb5bf', '#ffffff'],
      parts: ['happy-eyes', 'smile', 'blush-cheeks', 'bubble-crown', 'side-fins', 'wisp-chain'],
      size: 1.3,
      stance: 0.4,
      pose: 'hover',
      attackPart: 'tail',
    },
    habitatPreferences: { elements: ['water'], feelings: ['joy', 'cozy'] },
  },

  // Leaf + Brave.
  {
    id: 'thistlepip',
    name: 'Thistlepip',
    description: 'Small, prickly and very brave. Puffs up its spikes to look big.',
    element: 'leaf',
    feeling: 'brave',
    rarity: 'uncommon',
    baseStats: { hp: 55, attack: 70, defense: 55, speed: 45 }, // TUNE:
    moves: ['leafy-tickle', 'prickle-roll', 'pollen-puff'],
    evolutions: [
      { into: 'bristlebloom', level: 18 },
      { into: 'petalprance', level: 18 },
    ], // TUNE:
    visual: {
      body: 'orb',
      palette: ['#9fd672', '#f2ffe6', '#b06fd8'],
      parts: ['oval-eyes', 'brave-brows', 'cat-mouth', 'spike-coat', 'biped-legs', 'leaf-tail'],
      stance: 0.12,
      pose: 'sit',
      attackPart: 'spikes',
    },
    habitatPreferences: { elements: ['leaf'], feelings: ['brave'] },
  },
  {
    id: 'bristlebloom',
    name: 'Bristlebloom',
    description: 'A big thistle in full bloom. Prickly outside, soft inside.',
    element: 'leaf',
    feeling: 'brave',
    rarity: 'rare',
    baseStats: { hp: 80, attack: 95, defense: 75, speed: 65 }, // TUNE:
    moves: ['leafy-tickle', 'prickle-roll', 'pollen-puff', 'mossy-nap'],
    evolutions: [],
    visual: {
      body: 'tall',
      palette: ['#86c955', '#f2ffe6', '#9a52cf', '#5aa83a'],
      parts: [
        'sharp-eyes',
        'brave-brows',
        'smirk',
        'thistle-crown',
        'back-spines',
        'biped-legs',
        'leaf-arms',
      ],
      size: 1.25,
      head: { body: 'orb', size: 0.62, forward: 0.08, up: 0.88 },
      stance: 0.3,
      pose: 'upright',
      attackPart: 'arms',
    },
    habitatPreferences: { elements: ['leaf'], feelings: ['brave'] },
  },
  {
    id: 'petalprance',
    name: 'Petalprance',
    description: "Swapped its prickles for petals and hasn't stopped dancing since.",
    element: 'leaf',
    feeling: 'joy',
    rarity: 'rare',
    baseStats: { hp: 79, attack: 90, defense: 69, speed: 95 }, // TUNE:
    moves: ['leafy-tickle', 'pollen-puff', 'leaf-pile-leap', 'petal-party'],
    evolutions: [],
    visual: {
      body: 'star',
      palette: ['#9fd672', '#f2ffe6', '#b06fd8', '#5aa83a'],
      parts: [
        'happy-eyes',
        'smile',
        'blush-cheeks',
        'leaf-sprout',
        'leaf-wings',
        'leaf-arms',
        'freckles',
      ],
      size: 1.3,
      stance: 0.45,
      pose: 'hover',
      attackPart: 'wings',
    },
    habitatPreferences: { elements: ['leaf'], feelings: ['joy', 'brave'] },
  },

  // Frost + Brave (harmonious).
  {
    id: 'flurrypup',
    name: 'Flurrypup',
    description: 'Charges into snowdrifts headfirst. Comes out a snowball.',
    element: 'frost',
    feeling: 'brave',
    rarity: 'rare',
    baseStats: { hp: 55, attack: 70, defense: 50, speed: 55 }, // TUNE:
    moves: ['snowball-toss', 'frosty-pounce', 'brrr-bluster'],
    evolutions: [
      { into: 'blusterpup', level: 22 },
      { into: 'mittenpup', level: 22 },
    ], // TUNE:
    visual: {
      body: 'barrel',
      palette: ['#b8dcff', '#ffffff', '#5f8fdb'],
      parts: ['dot-eyes', 'brave-brows', 'cat-mouth', 'floppy-ears', 'stubby-legs', 'curly-tail'],
      head: { body: 'orb', size: 1.1, forward: 0.45, up: 0.3 },
      stance: 0.15,
      pose: 'stand',
      attackPart: 'tail',
    },
    habitatPreferences: { elements: ['frost'], feelings: ['brave'] },
  },
  {
    id: 'blusterpup',
    name: 'Blusterpup',
    description: 'Brings its own snowstorm wherever it goes. Very proud of it.',
    element: 'frost',
    feeling: 'brave',
    rarity: 'epic',
    baseStats: { hp: 75, attack: 100, defense: 70, speed: 75 }, // TUNE:
    moves: ['snowball-toss', 'frosty-pounce', 'brrr-bluster', 'chilly-yawn'],
    evolutions: [],
    visual: {
      body: 'barrel',
      palette: ['#a8d2ff', '#ffffff', '#4a7fd6', '#e0f0ff'],
      parts: [
        'sharp-eyes',
        'brave-brows',
        'smirk',
        'fangs',
        'pointy-ears',
        'icicle-mane',
        'long-legs',
        'spike-tail',
      ],
      size: 1.3,
      finish: 'sparkle',
      head: { body: 'orb', size: 0.88, forward: 0.62, up: 0.7 },
      stance: 0.45,
      pose: 'stand',
      attackPart: 'tail',
    },
    habitatPreferences: { elements: ['frost'], feelings: ['brave'] },
  },
  {
    id: 'mittenpup',
    name: 'Mittenpup',
    description: 'Grew the fluffiest coat in the Gap. Hugs keep it extra warm.',
    element: 'frost',
    feeling: 'cozy',
    rarity: 'epic',
    baseStats: { hp: 110, attack: 81, defense: 96, speed: 76 }, // TUNE:
    moves: ['snowball-toss', 'frosty-pounce', 'chilly-yawn', 'snow-snuggle'],
    evolutions: [],
    visual: {
      body: 'barrel',
      palette: ['#b8dcff', '#ffffff', '#ff8fa8', '#e0f0ff'],
      parts: [
        'sharp-eyes',
        'smile',
        'blush-cheeks',
        'floppy-ears',
        'fur-ruff',
        'long-legs',
        'fluff-tail',
      ],
      size: 1.3,
      finish: 'sparkle',
      head: { body: 'orb', size: 0.92, forward: 0.6, up: 0.62 },
      stance: 0.4,
      pose: 'stand',
      attackPart: 'tail',
    },
    habitatPreferences: { elements: ['frost'], feelings: ['cozy', 'brave'] },
  },

  // Stone + Joy.
  {
    id: 'glimmerock',
    name: 'Glimmerock',
    description: 'A happy little rock with sparkly bits. It shows them to everyone.',
    element: 'stone',
    feeling: 'joy',
    rarity: 'rare',
    baseStats: { hp: 60, attack: 60, defense: 75, speed: 40 }, // TUNE:
    moves: ['pebble-plop', 'rumble-roll', 'sunny-beam'],
    evolutions: [
      { into: 'glittercrag', level: 22 },
      { into: 'geodoze', level: 22 },
    ], // TUNE:
    visual: {
      body: 'mochi',
      palette: ['#d2bff2', '#fbf7ff', '#6fd8ee'],
      parts: ['happy-eyes', 'smile', 'blush-cheeks', 'crystal-crown', 'stubby-arms', 'biped-legs'],
      stance: 0.1,
      pose: 'stand',
      attackPart: 'arms',
    },
    habitatPreferences: { elements: ['stone', 'light'], feelings: ['joy'] },
  },
  {
    id: 'glittercrag',
    name: 'Glittercrag',
    description: 'A big, beaming crag covered in crystals. It sparkles when it laughs.',
    element: 'stone',
    feeling: 'joy',
    rarity: 'epic',
    baseStats: { hp: 85, attack: 85, defense: 100, speed: 55 }, // TUNE:
    moves: ['pebble-plop', 'rumble-roll', 'sunny-beam', 'sturdy-sit'],
    evolutions: [],
    visual: {
      body: 'bean',
      palette: ['#c4adec', '#fbf7ff', '#4fc8e6', '#ffffff'],
      parts: [
        'happy-eyes',
        'smirk',
        'crystal-crown',
        'crystal-spines',
        'strong-arms',
        'biped-legs',
        'spots',
      ],
      size: 1.35,
      finish: 'sparkle',
      head: { body: 'orb', size: 0.55, forward: 0.12, up: 0.86 },
      stance: 0.3,
      pose: 'upright',
      attackPart: 'arms',
    },
    habitatPreferences: { elements: ['stone', 'light'], feelings: ['joy'] },
  },
  {
    id: 'geodoze',
    name: 'Geodoze',
    description: 'A sleepy geode. Make it smile and it sparkles inside.',
    element: 'stone',
    feeling: 'sleepy',
    rarity: 'epic',
    baseStats: { hp: 90, attack: 70, defense: 105, speed: 35 }, // TUNE:
    moves: ['pebble-plop', 'rock-a-bye', 'sturdy-sit', 'geode-glint'],
    evolutions: [],
    visual: {
      body: 'mochi',
      palette: ['#d2bff2', '#fbf7ff', '#6fd8ee', '#ffffff'],
      parts: [
        'sleepy-eyes',
        'tiny-smile',
        'blush-cheeks',
        'round-ears',
        'crystal-crown',
        'crystal-spines',
        'stubby-legs',
      ],
      size: 1.35,
      finish: 'sparkle',
      stance: 0.12,
      pose: 'sit',
      attackPart: 'back',
    },
    habitatPreferences: { elements: ['stone'], feelings: ['sleepy', 'joy'] },
  },

  // Shadow + Cozy.
  {
    id: 'nookling',
    name: 'Nookling',
    description: 'Finds the coziest dark corner in any room and curls up there.',
    element: 'shadow',
    feeling: 'cozy',
    rarity: 'uncommon',
    baseStats: { hp: 60, attack: 50, defense: 55, speed: 55 }, // TUNE:
    moves: ['peekaboo', 'shadow-snuggle', 'mossy-nap'],
    evolutions: [
      { into: 'snugglenook', level: 18 },
      { into: 'mothnook', level: 18 },
    ], // TUNE:
    visual: {
      body: 'blob',
      palette: ['#5f5ba6', '#d9d6ff', '#ffd27a'],
      parts: ['oval-eyes', 'tiny-smile', 'blush-cheeks', 'long-ears', 'hop-feet', 'ball-tail'],
      ink: '#fff4dc',
      head: { body: 'orb', size: 1.15, forward: 0.1, up: 0.5 },
      stance: 0.08,
      pose: 'sit',
      attackPart: 'legs',
    },
    habitatPreferences: { elements: ['shadow'], feelings: ['cozy', 'sleepy'] },
  },
  {
    id: 'snugglenook',
    name: 'Snugglenook',
    description: 'A soft, shadowy cuddle with ears. Every squishy wants a turn.',
    element: 'shadow',
    feeling: 'cozy',
    rarity: 'rare',
    baseStats: { hp: 85, attack: 70, defense: 75, speed: 75 }, // TUNE:
    moves: ['peekaboo', 'shadow-snuggle', 'mossy-nap', 'boo'],
    evolutions: [],
    visual: {
      body: 'bean',
      palette: ['#524e94', '#d9d6ff', '#ffc94d', '#ffd27a'],
      parts: [
        'sharp-eyes',
        'smirk',
        'blush-cheeks',
        'long-ears',
        'antlers',
        'hop-feet',
        'fluff-tail',
      ],
      size: 1.25,
      ink: '#fff4dc',
      head: { body: 'orb', size: 0.72, forward: 0.1, up: 0.8 },
      stance: 0.35,
      pose: 'stand',
      attackPart: 'legs',
    },
    habitatPreferences: { elements: ['shadow'], feelings: ['cozy', 'sleepy'] },
  },
  {
    id: 'mothnook',
    name: 'Mothnook',
    description: 'Follows lantern light all night long. Only a tiny bit spooky.',
    element: 'shadow',
    feeling: 'spooky',
    rarity: 'rare',
    baseStats: { hp: 72, attack: 83, defense: 61, speed: 94 }, // TUNE:
    moves: ['peekaboo', 'shadow-snuggle', 'boo', 'lantern-flutter'],
    evolutions: [],
    visual: {
      body: 'bean',
      palette: ['#5f5ba6', '#d9d6ff', '#ffd27a', '#ffd27a'],
      parts: [
        'spooky-eyes',
        'cat-mouth',
        'long-ears',
        'zing-antennae',
        'big-wings',
        'hop-feet',
        'fluff-tail',
      ],
      size: 1.25,
      ink: '#fff4dc',
      head: { body: 'orb', size: 0.75, forward: 0.1, up: 0.8 },
      stance: 0.45,
      pose: 'hover',
      attackPart: 'wings',
    },
    habitatPreferences: { elements: ['shadow'], feelings: ['spooky', 'cozy'] },
  },

  // Leaf + Cozy (harmonious).
  {
    id: 'mossmuffin',
    name: 'Mossmuffin',
    description: 'Soft and mossy, like a muffin left in the forest. Smells like rain.',
    element: 'leaf',
    feeling: 'cozy',
    rarity: 'rare',
    baseStats: { hp: 65, attack: 55, defense: 65, speed: 40 }, // TUNE:
    moves: ['leafy-tickle', 'mossy-nap', 'prickle-roll'],
    evolutions: [
      { into: 'mossquilt', level: 22 },
      { into: 'sprinklemuff', level: 22 },
    ], // TUNE:
    visual: {
      body: 'bun',
      palette: ['#e0b07c', '#fff3e2', '#6fb85a', '#5a9a48'],
      parts: ['oval-eyes', 'smile', 'blush-cheeks', 'muffin-cap', 'biped-legs'],
      stance: 0.1,
      pose: 'stand',
      attackPart: 'crown',
    },
    habitatPreferences: { elements: ['leaf'], feelings: ['cozy'] },
  },
  {
    id: 'mossquilt',
    name: 'Mossquilt',
    description: 'A big mossy blanket of a squishy. Naps here are the best naps.',
    element: 'leaf',
    feeling: 'cozy',
    rarity: 'epic',
    baseStats: { hp: 100, attack: 75, defense: 90, speed: 55 }, // TUNE:
    moves: ['leafy-tickle', 'mossy-nap', 'prickle-roll', 'pollen-puff'],
    evolutions: [],
    visual: {
      body: 'tall',
      palette: ['#d6a26c', '#fff3e2', '#5aa848', '#4a8a3a'],
      parts: [
        'sharp-eyes',
        'smirk',
        'blush-cheeks',
        'muffin-cap',
        'leaf-arms',
        'biped-legs',
        'fern-tail',
      ],
      size: 1.35,
      finish: 'sparkle',
      head: { body: 'orb', size: 0.6, forward: 0.08, up: 0.88 },
      stance: 0.3,
      pose: 'upright',
      attackPart: 'arms',
    },
    habitatPreferences: { elements: ['leaf'], feelings: ['cozy'] },
  },
  {
    id: 'sprinklemuff',
    name: 'Sprinklemuff',
    description: "Grew sprinkles instead of moss. Smells like giggles. Please don't lick it.",
    element: 'leaf',
    feeling: 'silly',
    rarity: 'epic',
    baseStats: { hp: 98, attack: 92, defense: 87, speed: 103 }, // TUNE:
    moves: ['leafy-tickle', 'prickle-roll', 'pollen-puff', 'sprinkle-sneeze'],
    evolutions: [],
    visual: {
      body: 'tiered',
      palette: ['#e0b07c', '#fff3e2', '#6fb85a', '#ff8fc0'],
      parts: [
        'dot-eyes',
        'open-mouth',
        'blush-cheeks',
        'muffin-cap',
        'stubby-arms',
        'biped-legs',
        'leaf-tail',
        'freckles',
      ],
      size: 1.3,
      finish: 'sparkle',
      stance: 0.2,
      pose: 'stand',
      attackPart: 'arms',
    },
    habitatPreferences: { elements: ['leaf'], feelings: ['silly', 'cozy'] },
  },

  // Light + Joy (harmonious). Rare and strong; Fuzzbolt is its plain counter.
  {
    id: 'dawndrop',
    name: 'Dawndrop',
    description: 'A drop of the very first sunshine. It hums good-morning songs.',
    element: 'light',
    feeling: 'joy',
    rarity: 'epic',
    baseStats: { hp: 60, attack: 65, defense: 55, speed: 65 }, // TUNE:
    moves: ['sunny-beam', 'dazzle-dance', 'glow-up'],
    evolutions: [
      { into: 'dazzledrop', level: 26 },
      { into: 'moondrop', level: 26 },
    ], // TUNE:
    visual: {
      body: 'orb',
      palette: ['#ffe9a8', '#fffdf2', '#ffb347'],
      parts: ['happy-eyes', 'smile', 'blush-cheeks', 'sun-rays', 'nub-wings'],
      finish: 'sparkle',
      glow: 'body',
      stance: 0.3,
      pose: 'hover',
      attackPart: 'crown',
    },
    habitatPreferences: { elements: ['light'], feelings: ['joy'] },
  },
  {
    id: 'dazzledrop',
    name: 'Dazzledrop',
    description: 'Glows like a whole sunrise. Even grumpy clouds smile at it.',
    element: 'light',
    feeling: 'joy',
    rarity: 'legendary',
    baseStats: { hp: 82, attack: 92, defense: 73, speed: 87 }, // TUNE:
    moves: ['sunny-beam', 'dazzle-dance', 'glow-up', 'giggle-drizzle'],
    evolutions: [],
    visual: {
      body: 'orb',
      palette: ['#ffdd7a', '#fffdf2', '#ff9f1c', '#fff4c2'],
      parts: ['happy-eyes', 'smirk', 'blush-cheeks', 'sun-rays', 'sun-crown', 'glow-wings'],
      size: 1.3,
      finish: 'iridescent',
      glow: 'body',
      stance: 0.45,
      pose: 'hover',
      attackPart: 'mane',
    },
    habitatPreferences: { elements: ['light'], feelings: ['joy'] },
  },
  {
    id: 'moondrop',
    name: 'Moondrop',
    description: 'When the sun gets sleepy, it becomes the moon. It hums lullabies.',
    element: 'light',
    feeling: 'sleepy',
    rarity: 'legendary',
    baseStats: { hp: 98, attack: 76, defense: 93, speed: 71 }, // TUNE:
    moves: ['sunny-beam', 'night-light', 'glow-up', 'moonbeam-lullaby'],
    evolutions: [],
    visual: {
      body: 'orb',
      palette: ['#fff0bf', '#fffdf2', '#a99cf0', '#e8dcff'],
      parts: [
        'sleepy-eyes',
        'tiny-smile',
        'blush-cheeks',
        'cloud-crown',
        'plume-wings',
        'freckles',
      ],
      size: 1.3,
      finish: 'iridescent',
      glow: 'body',
      stance: 0.45,
      pose: 'hover',
      attackPart: 'wings',
    },
    habitatPreferences: { elements: ['light'], feelings: ['sleepy', 'joy'] },
  },

  // Spark + Brave. The legendary of Juniper's Gap; Fuzzbolt is its plain counter.
  {
    id: 'thunderpuff',
    name: 'Thunderpuff',
    description: 'A little storm cloud with a big heart. Rumbles when it is happy.',
    element: 'spark',
    feeling: 'brave',
    rarity: 'legendary',
    baseStats: { hp: 70, attack: 70, defense: 60, speed: 60 }, // TUNE:
    moves: ['zip-zap', 'thunder-hug', 'zoomies', 'snowball-toss'],
    evolutions: [
      { into: 'thunderplume', level: 30 },
      { into: 'stormhoot', level: 30 },
    ], // TUNE:
    visual: {
      body: 'orb',
      palette: ['#96a1ca', '#eef1ff', '#ffd23f'],
      parts: ['oval-eyes', 'brave-brows', 'cat-mouth', 'cloud-crown', 'nub-wings', 'bolt-tail'],
      finish: 'iridescent',
      stance: 0.35,
      pose: 'hover',
      attackPart: 'wings',
    },
    habitatPreferences: { elements: ['spark'], feelings: ['brave'] },
  },
  {
    id: 'thunderplume',
    name: 'Thunderplume',
    description: 'A grand, fluffy thundercloud. Its rumbles sound like purring.',
    element: 'spark',
    feeling: 'brave',
    rarity: 'legendary',
    baseStats: { hp: 95, attack: 100, defense: 85, speed: 95 }, // TUNE:
    moves: ['static-fluff', 'thunder-hug', 'zoomies', 'snowball-toss'],
    evolutions: [],
    visual: {
      body: 'bean',
      palette: ['#93a0cc', '#eef1ff', '#ffcc00', '#c9d1ff'],
      parts: ['sharp-eyes', 'brave-brows', 'beak', 'storm-crest', 'big-wings', 'tail-feathers'],
      size: 1.3,
      finish: 'iridescent',
      head: { body: 'orb', size: 0.72, forward: 0.35, up: 0.72 },
      stance: 0.55,
      pose: 'hover',
      attackPart: 'wings',
    },
    habitatPreferences: { elements: ['spark'], feelings: ['brave'] },
  },
  {
    id: 'stormhoot',
    name: 'Stormhoot',
    description: 'A night owl made of storm clouds. Its hoot sounds like faraway thunder.',
    element: 'spark',
    feeling: 'spooky',
    rarity: 'legendary',
    baseStats: { hp: 84, attack: 98, defense: 79, speed: 108 }, // TUNE:
    moves: ['static-fluff', 'thunder-hug', 'peekaboo', 'midnight-hoot'],
    evolutions: [],
    visual: {
      body: 'orb',
      palette: ['#4f5888', '#eef1ff', '#ffd23f', '#c9d1ff'],
      ink: '#fff4dc',
      parts: ['spooky-eyes', 'beak', 'pointy-ears', 'cloud-crown', 'plume-wings', 'tail-feathers'],
      size: 1.3,
      finish: 'iridescent',
      stance: 0.45,
      pose: 'hover',
      attackPart: 'wings',
    },
    habitatPreferences: { elements: ['spark'], feelings: ['spooky', 'brave'] },
  },

  // Halloween (season `halloween`): sweet-spooky, each drawn by a Halloween activity.

  // Leaf + Silly. Found in pumpkin fields while you gather Pumpkins.
  {
    id: 'gourdon',
    name: 'Gourdon',
    description: 'A pumpkin with a lopsided grin. It tries to look spooky. It is not.',
    element: 'leaf',
    feeling: 'silly',
    rarity: 'common',
    season: 'halloween',
    baseStats: { hp: 60, attack: 50, defense: 55, speed: 40 }, // TUNE:
    moves: ['pumpkin-roll', 'leafy-tickle', 'boo'],
    evolutions: [
      { into: 'glowgourd', level: 16 },
      { into: 'squashboo', level: 16 },
    ], // TUNE:
    visual: {
      body: 'pumpkin',
      palette: ['#ff9a3c', '#ffe0b8', '#4f9a45'],
      parts: [
        'dot-eyes',
        'open-mouth',
        'blush-cheeks',
        'stem',
        'leaf-ears',
        'biped-legs',
        'vine-tail',
      ],
      stance: 0.12,
      pose: 'stand',
      attackPart: 'tail',
    },
    habitatPreferences: { elements: ['leaf', 'fire'], feelings: ['silly', 'spooky'] },
  },
  {
    id: 'glowgourd',
    name: 'Glowgourd',
    description: "A grinning jack-o'-lantern that glows from the inside. Still not spooky.",
    element: 'leaf',
    feeling: 'silly',
    rarity: 'uncommon',
    season: 'halloween',
    baseStats: { hp: 85, attack: 80, defense: 75, speed: 60 }, // TUNE: was attack 70, speed 55; #28's sim flagged it weak (33%)
    moves: ['pumpkin-roll', 'leafy-tickle', 'boo', 'ember-boop'],
    evolutions: [],
    visual: {
      body: 'pumpkin',
      palette: ['#ff8a1f', '#ffe066', '#3f8a35', '#ffd23f'],
      parts: [
        'sharp-eyes',
        'open-mouth',
        'fangs',
        'stem',
        'leaf-ears',
        'leaf-arms',
        'biped-legs',
        'vine-tail',
      ],
      size: 1.3,
      glow: 'body',
      stance: 0.35,
      pose: 'stand',
      attackPart: 'arms',
    },
    habitatPreferences: { elements: ['leaf', 'fire'], feelings: ['silly', 'spooky'] },
  },
  {
    id: 'squashboo',
    name: 'Squashboo',
    description: 'A pumpkin that learned to say boo. Then giggled about it for an hour.',
    element: 'leaf',
    feeling: 'spooky',
    rarity: 'uncommon',
    season: 'halloween',
    baseStats: { hp: 85, attack: 85, defense: 75, speed: 80 }, // TUNE:
    moves: ['pumpkin-roll', 'peekaboo', 'boo', 'lantern-grin'],
    evolutions: [],
    visual: {
      body: 'pumpkin',
      palette: ['#ffb871', '#fff6e0', '#4f9a45', '#ffd23f'],
      parts: ['spooky-eyes', 'boo-mouth', 'blush-cheeks', 'stem', 'bat-wings', 'wisp-chain'],
      size: 1.3,
      glow: 'body',
      stance: 0.4,
      pose: 'hover',
      attackPart: 'tail',
    },
    habitatPreferences: { elements: ['leaf'], feelings: ['spooky', 'silly'] },
  },

  // Light + Spooky (conflicted, so a bigger stat budget). A little ghost
  // who's afraid of the dark; comes out on Halloween nights in the woods.
  {
    id: 'glowboo',
    name: 'Glowboo',
    description: 'A little ghost who is scared of the dark, so it glows. Just in case.',
    element: 'light',
    feeling: 'spooky',
    rarity: 'rare',
    season: 'halloween',
    baseStats: { hp: 60, attack: 65, defense: 60, speed: 65 }, // TUNE:
    moves: ['night-light', 'boo', 'peekaboo'],
    evolutions: [
      { into: 'brightboo', level: 22 },
      { into: 'lullaboo', level: 22 },
    ], // TUNE:
    visual: {
      body: 'ghost',
      palette: ['#f1ecff', '#fff6c7', '#c9b8ff'],
      parts: ['spooky-eyes', 'boo-mouth', 'blush-cheeks', 'stubby-arms'],
      glow: 'body',
      stance: 0.25,
      pose: 'hover',
      attackPart: 'arms',
    },
    habitatPreferences: { elements: ['light'], feelings: ['spooky'] },
  },
  {
    id: 'brightboo',
    name: 'Brightboo',
    description: 'A big, glowy ghost. It lights the way home for every scared squishy.',
    element: 'light',
    feeling: 'spooky',
    rarity: 'epic',
    season: 'halloween',
    baseStats: { hp: 85, attack: 90, defense: 85, speed: 90 }, // TUNE:
    moves: ['night-light', 'boo', 'peekaboo', 'dazzle-dance'],
    evolutions: [],
    visual: {
      body: 'ghost',
      palette: ['#fff6e0', '#fff1a8', '#b8a2ff', '#ffe066'],
      parts: [
        'spooky-eyes',
        'brave-brows',
        'fangs',
        'strong-arms',
        'wisp-chain',
        'nub-wings',
        'freckles',
      ],
      size: 1.3,
      finish: 'sparkle',
      glow: 'body',
      stance: 0.4,
      pose: 'hover',
      attackPart: 'arms',
    },
    habitatPreferences: { elements: ['light'], feelings: ['spooky'] },
  },
  {
    id: 'lullaboo',
    name: 'Lullaboo',
    description: "Used to be afraid of the dark. Now it's everybody's night-light.",
    element: 'light',
    feeling: 'cozy',
    rarity: 'epic',
    season: 'halloween',
    baseStats: { hp: 95, attack: 75, defense: 85, speed: 70 }, // TUNE:
    moves: ['night-light', 'sunny-beam', 'boo', 'night-light-hug'],
    evolutions: [],
    visual: {
      body: 'ghost',
      palette: ['#f1ecff', '#fff6c7', '#c9b8ff', '#ffe066'],
      parts: [
        'oval-eyes',
        'tiny-smile',
        'blush-cheeks',
        'nightcap',
        'stubby-arms',
        'wisp-tail',
        'freckles',
      ],
      size: 1.3,
      finish: 'sparkle',
      glow: 'body',
      stance: 0.35,
      pose: 'hover',
      attackPart: 'arms',
    },
    habitatPreferences: { elements: ['light'], feelings: ['cozy', 'spooky'] },
  },

  // Shadow + Silly. A bat that hangs the wrong way up and loves Witch Dust.
  // Spawns key on terrain, season and time only, so it comes out at dusk
  // where Witch Dust is gathered (pumpkin fields, old woods).
  {
    id: 'upsybat',
    name: 'Upsybat',
    description: 'A bat that hangs the wrong way up. It thinks everyone else is upside down.',
    element: 'shadow',
    feeling: 'silly',
    rarity: 'uncommon',
    season: 'halloween',
    baseStats: { hp: 55, attack: 60, defense: 45, speed: 70 }, // TUNE:
    moves: ['upside-flop', 'peekaboo', 'zip-zap'],
    evolutions: [
      { into: 'topsywing', level: 18 },
      { into: 'hushwing', level: 18 },
    ], // TUNE:
    visual: {
      body: 'orb',
      palette: ['#4a3a7a', '#eadcff', '#9b7fd4'],
      parts: ['dot-eyes', 'open-mouth', 'blush-cheeks', 'pointy-ears', 'bat-wings'],
      ink: '#fff4dc',
      stance: 0.35,
      pose: 'hover',
      attackPart: 'wings',
    },
    habitatPreferences: { elements: ['shadow'], feelings: ['silly', 'spooky'] },
  },
  {
    id: 'topsywing',
    name: 'Topsywing',
    description: 'Does loop-the-loops all night. Still not sure which way is up.',
    element: 'shadow',
    feeling: 'silly',
    rarity: 'rare',
    season: 'halloween',
    baseStats: { hp: 75, attack: 85, defense: 65, speed: 100 }, // TUNE:
    moves: ['upside-flop', 'peekaboo', 'zip-zap', 'shadow-snuggle'],
    evolutions: [],
    visual: {
      body: 'bean',
      palette: ['#3f3070', '#eadcff', '#8f6fd0', '#ff9ad5'],
      parts: ['sharp-eyes', 'open-mouth', 'fangs', 'pointy-ears', 'big-bat-wings', 'curly-tail'],
      size: 1.25,
      ink: '#fff4dc',
      head: { body: 'orb', size: 0.68, forward: 0.15, up: 0.75 },
      stance: 0.5,
      pose: 'hover',
      attackPart: 'wings',
    },
    habitatPreferences: { elements: ['shadow'], feelings: ['silly', 'spooky'] },
  },
  {
    id: 'hushwing',
    name: 'Hushwing',
    description: 'Sleeps all day upside down, wrapped in its wings like a burrito.',
    element: 'shadow',
    feeling: 'sleepy',
    rarity: 'rare',
    season: 'halloween',
    // A smaller budget than Topsywing: its 40% Upside Snooze heal pays for it.
    baseStats: { hp: 84, attack: 67, defense: 75, speed: 62 }, // TUNE:
    moves: ['peekaboo', 'upside-flop', 'shadow-snuggle', 'upside-snooze'],
    evolutions: [],
    visual: {
      body: 'mochi',
      palette: ['#4a3a7a', '#eadcff', '#9b7fd4', '#ff9ad5'],
      parts: [
        'sleepy-eyes',
        'tiny-smile',
        'blush-cheeks',
        'round-ears',
        'nightcap',
        'big-bat-wings',
        'ball-tail',
      ],
      size: 1.25,
      ink: '#fff4dc',
      stance: 0.45,
      pose: 'hover',
      attackPart: 'wings',
    },
    habitatPreferences: { elements: ['shadow'], feelings: ['sleepy', 'silly'] },
  },

  // Fire + Spooky. A candle-kitten that loves Jack-o'-Lantern glow. Spawns
  // can't see buildings yet, so it comes out at dusk and night in the
  // pumpkin fields and old woods (where Emberwood grows) instead.
  {
    id: 'candlekit',
    name: 'Candlekit',
    description: 'A kitten with a candle flame for a tail tuft. Says "boo!" then purrs.',
    element: 'fire',
    feeling: 'spooky',
    rarity: 'uncommon',
    season: 'halloween',
    baseStats: { hp: 50, attack: 60, defense: 45, speed: 65 }, // TUNE:
    moves: ['wiggle-wick', 'ember-boop', 'boo'],
    evolutions: [
      { into: 'wickwhisker', level: 18 },
      { into: 'sparklewick', level: 18 },
    ], // TUNE:
    visual: {
      body: 'tall',
      palette: ['#3d3550', '#fff1d6', '#ffb43c'],
      parts: ['spooky-eyes', 'cat-mouth', 'pointy-ears', 'flame-tuft', 'curly-tail'],
      ink: '#fff4dc',
      glow: 'accent',
      pose: 'sit',
      attackPart: 'crown',
    },
    habitatPreferences: { elements: ['fire'], feelings: ['spooky', 'cozy'] },
  },
  {
    id: 'wickwhisker',
    name: 'Wickwhisker',
    description: 'A tall, flickery cat. Its whiskers glow like birthday candles.',
    element: 'fire',
    feeling: 'spooky',
    rarity: 'rare',
    season: 'halloween',
    baseStats: { hp: 70, attack: 85, defense: 60, speed: 90 }, // TUNE:
    moves: ['wiggle-wick', 'ember-boop', 'boo', 'toasty-tumble'],
    evolutions: [],
    visual: {
      body: 'barrel',
      palette: ['#2f2840', '#fff1d6', '#ff9f1c', '#ffe066'],
      parts: [
        'spooky-eyes',
        'brave-brows',
        'fangs',
        'pointy-ears',
        'flame-mane',
        'whisker-flames',
        'long-legs',
        'flame-tail',
      ],
      size: 1.25,
      ink: '#fff4dc',
      glow: 'accent',
      head: { body: 'orb', size: 0.85, forward: 0.6, up: 0.62 },
      stance: 0.42,
      pose: 'stand',
      attackPart: 'tail',
    },
    habitatPreferences: { elements: ['fire'], feelings: ['spooky', 'cozy'] },
  },
  {
    id: 'sparklewick',
    name: 'Sparklewick',
    description: "Glowed so bright it threw itself a party. Everyone's invited!",
    element: 'fire',
    feeling: 'joy',
    rarity: 'rare',
    season: 'halloween',
    baseStats: { hp: 72, attack: 87, defense: 61, speed: 92 }, // TUNE:
    moves: ['ember-boop', 'wiggle-wick', 'toasty-tumble', 'sparkler-swirl'],
    evolutions: [],
    visual: {
      body: 'tall',
      palette: ['#3d3550', '#fff1d6', '#ffb43c', '#ffe066'],
      parts: [
        'happy-eyes',
        'smile',
        'blush-cheeks',
        'pointy-ears',
        'flame-crown',
        'whisker-flames',
        'stubby-arms',
        'hop-feet',
        'curly-tail',
      ],
      size: 1.3,
      ink: '#fff4dc',
      glow: 'accent',
      stance: 0.15,
      pose: 'stand',
      attackPart: 'crown',
    },
    habitatPreferences: { elements: ['fire'], feelings: ['joy', 'spooky'] },
  },

  // Thanksgiving (season `thanksgiving`): drawn by the season's leaf piles.

  // Leaf + Joy. A baby squirrel that dives into every Magic Fallen Leaves pile.
  {
    id: 'crunchkin',
    name: 'Crunchkin',
    description: 'A baby squirrel in an acorn hat. It jumps into every leaf pile it sees. Crunch!',
    element: 'leaf',
    feeling: 'joy',
    rarity: 'uncommon',
    season: 'thanksgiving',
    baseStats: { hp: 55, attack: 60, defense: 45, speed: 60 }, // TUNE:
    moves: ['leafy-tickle', 'leaf-pile-leap', 'zoomies'],
    evolutions: [
      { into: 'maplecrunch', level: 18 },
      { into: 'huddlenut', level: 18 },
    ], // TUNE:
    visual: {
      body: 'bean',
      palette: ['#e8a066', '#fff1dc', '#b5693a', '#7cc96a'],
      parts: [
        'happy-eyes',
        'smile',
        'blush-cheeks',
        'round-ears',
        'acorn-cap',
        'stuck-leaf',
        'stubby-arms',
        'biped-legs',
        'bushy-tail',
      ],
      head: { body: 'orb', size: 1.12, forward: 0.1, up: 0.55 },
      stance: 0.12,
      pose: 'sit',
      attackPart: 'tail',
    },
    habitatPreferences: { elements: ['leaf'], feelings: ['joy', 'cozy'] },
  },
  {
    id: 'maplecrunch',
    name: 'Maplecrunch',
    description:
      'A big, bouncy squirrel with a mane of maple leaves. It can leap a whole leaf pile.',
    element: 'leaf',
    feeling: 'joy',
    rarity: 'rare',
    season: 'thanksgiving',
    baseStats: { hp: 84, attack: 95, defense: 71, speed: 95 }, // TUNE:
    moves: ['leafy-tickle', 'leaf-pile-leap', 'zoomies', 'sunny-beam'],
    evolutions: [],
    visual: {
      body: 'pear',
      palette: ['#e59a5c', '#fff1dc', '#c4562e', '#7cc96a'],
      parts: [
        'happy-eyes',
        'brave-brows',
        'smirk',
        'fangs',
        'pointy-ears',
        'acorn-cap',
        'maple-mane',
        'stuck-leaf',
        'strong-arms',
        'biped-legs',
        'bushy-tail',
      ],
      size: 1.3,
      head: { body: 'orb', size: 0.74, forward: 0.12, up: 0.78 },
      stance: 0.35,
      pose: 'upright',
      attackPart: 'tail',
    },
    habitatPreferences: { elements: ['leaf'], feelings: ['joy', 'cozy'] },
  },
  {
    id: 'huddlenut',
    name: 'Huddlenut',
    description: 'Tucks into a leaf pile with a snack for later. And for later-later.',
    element: 'leaf',
    feeling: 'cozy',
    rarity: 'rare',
    season: 'thanksgiving',
    baseStats: { hp: 89, attack: 65, defense: 80, speed: 49 }, // TUNE:
    moves: ['leafy-tickle', 'pollen-puff', 'leaf-pile-leap', 'acorn-stash'],
    evolutions: [],
    visual: {
      body: 'bun',
      palette: ['#e8a066', '#fff1dc', '#b5693a', '#7cc96a'],
      parts: [
        'oval-eyes',
        'smile',
        'blush-cheeks',
        'round-ears',
        'acorn-cap',
        'leaf-wings',
        'stuck-leaf',
        'stubby-arms',
        'hop-feet',
        'bushy-tail',
      ],
      size: 1.3,
      head: { body: 'orb', size: 0.85, forward: 0.15, up: 0.6 },
      stance: 0.12,
      pose: 'sit',
      attackPart: 'tail',
    },
    habitatPreferences: { elements: ['leaf'], feelings: ['cozy', 'joy'] },
  },
];
