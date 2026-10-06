import type { Move } from '../schemas/data/moves.js';
import type { Species } from '../schemas/data/species.js';

/*
 * The Phase 1 launch roster (design doc §4, issue #10): 14 base lines plus 4
 * Halloween lines, each with one simple level-based evolution (§8). Public:
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
    evolutions: [{ into: 'splashmallow', level: 16 }], // TUNE:
    visual: {
      body: 'drop',
      palette: ['#7cc0f4', '#e8f6ff', '#3f86d8'],
      parts: ['dot-eyes', 'open-mouth', 'blush-cheeks', 'belly-patch', 'water-curl'],
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
      body: 'drop',
      palette: ['#6cb6f2', '#e8f6ff', '#3477cc', '#ffffff'],
      parts: [
        'dot-eyes',
        'open-mouth',
        'blush-cheeks',
        'belly-patch',
        'water-curl',
        'fin-crest',
        'ball-tail',
      ],
      size: 1.3,
    },
    habitatPreferences: { elements: ['water'], feelings: ['silly', 'joy'] },
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
    evolutions: [{ into: 'boulderdoze', level: 16 }], // TUNE:
    visual: {
      body: 'pebble',
      palette: ['#b4ada2', '#e9e3d9', '#8a7cc4', '#6f665b'],
      parts: ['sleepy-eyes', 'tiny-smile', 'round-ears', 'nightcap', 'freckles'],
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
      palette: ['#a39b8f', '#e9e3d9', '#7a6cb8', '#837a6d'],
      parts: ['sleepy-eyes', 'tiny-smile', 'round-ears', 'nightcap', 'crag-nubs', 'freckles'],
      size: 1.35,
    },
    habitatPreferences: { elements: ['stone'], feelings: ['sleepy', 'cozy'] },
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
    evolutions: [{ into: 'hearthbun', level: 16 }], // TUNE:
    visual: {
      body: 'bun',
      palette: ['#ffad73', '#fff0e0', '#ff6a2e'],
      parts: ['oval-eyes', 'smile', 'blush-cheeks', 'flame-tuft'],
      glow: 'accent',
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
      body: 'bun',
      palette: ['#ff9a55', '#fff0e0', '#ff5a1f', '#ffd166'],
      parts: ['oval-eyes', 'smile', 'blush-cheeks', 'flame-crown', 'round-ears', 'belly-patch'],
      size: 1.3,
      glow: 'accent',
    },
    habitatPreferences: { elements: ['fire'], feelings: ['cozy'] },
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
    evolutions: [{ into: 'drowsiberg', level: 16 }], // TUNE:
    visual: {
      body: 'tiered',
      palette: ['#d4f0ff', '#ffffff', '#86c5eb'],
      parts: ['sleepy-eyes', 'tiny-smile', 'pointy-ears', 'ball-tail'],
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
      body: 'tiered',
      palette: ['#c2e8fc', '#ffffff', '#6fb4e0', '#e8f8ff'],
      parts: ['sleepy-eyes', 'tiny-smile', 'pointy-ears', 'ball-tail', 'icicle-crown'],
      size: 1.3,
    },
    habitatPreferences: { elements: ['frost'], feelings: ['sleepy'] },
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
    evolutions: [{ into: 'frizzbolt', level: 16 }], // TUNE:
    visual: {
      body: 'blob',
      palette: ['#ffe45c', '#fff9db', '#f5a800'],
      parts: ['dot-eyes', 'open-mouth', 'blush-cheeks', 'bolt-ears', 'curly-tail'],
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
      body: 'blob',
      palette: ['#ffd93d', '#fff9db', '#f09a00', '#ffffff'],
      parts: [
        'dot-eyes',
        'open-mouth',
        'blush-cheeks',
        'bolt-ears',
        'curly-tail',
        'spark-crest',
        'spots',
      ],
      size: 1.3,
    },
    habitatPreferences: { elements: ['spark'], feelings: ['silly'] },
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
    evolutions: [{ into: 'zingaling', level: 18 }], // TUNE:
    visual: {
      body: 'star',
      palette: ['#ffc93c', '#fffbe6', '#ff8fc0'],
      parts: ['happy-eyes', 'smile', 'blush-cheeks', 'nub-wings'],
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
      parts: ['happy-eyes', 'smile', 'blush-cheeks', 'nub-wings', 'zing-antennae', 'freckles'],
      size: 1.3,
    },
    habitatPreferences: { elements: ['spark', 'light'], feelings: ['joy'] },
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
    evolutions: [{ into: 'bubbletide', level: 18 }], // TUNE:
    visual: {
      body: 'pebble',
      palette: ['#8fded9', '#f4fffe', '#3fb5bf'],
      parts: ['oval-eyes', 'smile', 'blush-cheeks', 'floppy-ears', 'bubble-crown'],
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
      body: 'pebble',
      palette: ['#74d2cf', '#f4fffe', '#2fa3ad', '#ffffff'],
      parts: ['oval-eyes', 'smile', 'blush-cheeks', 'floppy-ears', 'bubble-crown', 'fin-crest'],
      size: 1.3,
    },
    habitatPreferences: { elements: ['water'], feelings: ['cozy'] },
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
    evolutions: [{ into: 'bristlebloom', level: 18 }], // TUNE:
    visual: {
      body: 'pear',
      palette: ['#9fd672', '#f2ffe6', '#b06fd8'],
      parts: ['oval-eyes', 'brave-brows', 'cat-mouth', 'thistle-crown', 'leaf-tail'],
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
      body: 'pear',
      palette: ['#86c955', '#f2ffe6', '#9a52cf', '#ffd6f5'],
      parts: [
        'oval-eyes',
        'brave-brows',
        'cat-mouth',
        'thistle-crown',
        'leaf-tail',
        'leaf-wings',
        'spots',
      ],
      size: 1.25,
    },
    habitatPreferences: { elements: ['leaf'], feelings: ['brave'] },
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
    evolutions: [{ into: 'blusterpup', level: 22 }], // TUNE:
    visual: {
      body: 'bean',
      palette: ['#b8dcff', '#ffffff', '#5f8fdb'],
      parts: ['dot-eyes', 'brave-brows', 'cat-mouth', 'floppy-ears', 'curly-tail'],
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
      body: 'bean',
      palette: ['#a8d2ff', '#ffffff', '#4a7fd6', '#e0f0ff'],
      parts: ['dot-eyes', 'brave-brows', 'cat-mouth', 'floppy-ears', 'fluff-tail', 'nub-horns'],
      size: 1.3,
      finish: 'sparkle',
    },
    habitatPreferences: { elements: ['frost'], feelings: ['brave'] },
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
    evolutions: [{ into: 'glittercrag', level: 22 }], // TUNE:
    visual: {
      body: 'mochi',
      palette: ['#d2bff2', '#fbf7ff', '#6fd8ee'],
      parts: ['happy-eyes', 'smile', 'blush-cheeks', 'crystal-crown'],
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
      body: 'mochi',
      palette: ['#c4adec', '#fbf7ff', '#4fc8e6', '#ffffff'],
      parts: ['happy-eyes', 'smile', 'blush-cheeks', 'crystal-crown', 'crystal-spines', 'spots'],
      size: 1.35,
      finish: 'sparkle',
    },
    habitatPreferences: { elements: ['stone', 'light'], feelings: ['joy'] },
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
    evolutions: [{ into: 'snugglenook', level: 18 }], // TUNE:
    visual: {
      body: 'blob',
      palette: ['#5f5ba6', '#d9d6ff', '#ffd27a'],
      parts: ['oval-eyes', 'tiny-smile', 'blush-cheeks', 'long-ears', 'ball-tail'],
      ink: '#fff4dc',
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
      body: 'blob',
      palette: ['#524e94', '#d9d6ff', '#ffc94d', '#ffd27a'],
      parts: ['oval-eyes', 'tiny-smile', 'blush-cheeks', 'long-ears', 'fluff-tail', 'freckles'],
      size: 1.25,
      ink: '#fff4dc',
    },
    habitatPreferences: { elements: ['shadow'], feelings: ['cozy', 'sleepy'] },
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
    evolutions: [{ into: 'mossquilt', level: 22 }], // TUNE:
    visual: {
      body: 'bun',
      palette: ['#e0b07c', '#fff3e2', '#6fb85a', '#5a9a48'],
      parts: ['oval-eyes', 'smile', 'blush-cheeks', 'muffin-cap'],
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
      body: 'bun',
      palette: ['#d6a26c', '#fff3e2', '#5aa848', '#4a8a3a'],
      parts: ['oval-eyes', 'smile', 'blush-cheeks', 'muffin-cap', 'fern-tail', 'round-ears'],
      size: 1.35,
      finish: 'sparkle',
    },
    habitatPreferences: { elements: ['leaf'], feelings: ['cozy'] },
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
    evolutions: [{ into: 'dazzledrop', level: 26 }], // TUNE:
    visual: {
      body: 'orb',
      palette: ['#ffe9a8', '#fffdf2', '#ffb347'],
      parts: ['happy-eyes', 'smile', 'blush-cheeks', 'sun-rays'],
      finish: 'sparkle',
      glow: 'body',
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
    baseStats: { hp: 85, attack: 95, defense: 75, speed: 90 }, // TUNE:
    moves: ['sunny-beam', 'dazzle-dance', 'glow-up', 'giggle-drizzle'],
    evolutions: [],
    visual: {
      body: 'orb',
      palette: ['#ffdd7a', '#fffdf2', '#ff9f1c', '#fff4c2'],
      parts: ['happy-eyes', 'smile', 'blush-cheeks', 'sun-rays', 'glow-wings'],
      size: 1.3,
      finish: 'iridescent',
      glow: 'body',
    },
    habitatPreferences: { elements: ['light'], feelings: ['joy'] },
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
    evolutions: [{ into: 'thunderplume', level: 30 }], // TUNE:
    visual: {
      body: 'mochi',
      palette: ['#8f9ac4', '#eef1ff', '#ffd23f'],
      parts: ['oval-eyes', 'brave-brows', 'cat-mouth', 'cloud-crown', 'bolt-tail'],
      finish: 'iridescent',
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
      body: 'mochi',
      palette: ['#8a96c6', '#eef1ff', '#ffcc00', '#c9d1ff'],
      parts: ['oval-eyes', 'brave-brows', 'cat-mouth', 'cloud-crown', 'bolt-tail', 'plume-wings'],
      size: 1.3,
      finish: 'iridescent',
    },
    habitatPreferences: { elements: ['spark'], feelings: ['brave'] },
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
    evolutions: [{ into: 'glowgourd', level: 16 }], // TUNE:
    visual: {
      body: 'pumpkin',
      palette: ['#ff9a3c', '#ffe0b8', '#4f9a45'],
      parts: ['dot-eyes', 'open-mouth', 'blush-cheeks', 'stem', 'leaf-tail'],
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
      parts: ['dot-eyes', 'open-mouth', 'blush-cheeks', 'stem', 'leaf-tail', 'leaf-ears'],
      size: 1.3,
      glow: 'body',
    },
    habitatPreferences: { elements: ['leaf', 'fire'], feelings: ['silly', 'spooky'] },
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
    evolutions: [{ into: 'brightboo', level: 22 }], // TUNE:
    visual: {
      body: 'ghost',
      palette: ['#f1ecff', '#fff6c7', '#c9b8ff'],
      parts: ['spooky-eyes', 'boo-mouth', 'blush-cheeks'],
      glow: 'body',
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
      parts: ['spooky-eyes', 'boo-mouth', 'blush-cheeks', 'nub-wings', 'wisp-tail', 'freckles'],
      size: 1.3,
      finish: 'sparkle',
      glow: 'body',
    },
    habitatPreferences: { elements: ['light'], feelings: ['spooky'] },
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
    evolutions: [{ into: 'topsywing', level: 18 }], // TUNE:
    visual: {
      body: 'bean',
      palette: ['#4a3a7a', '#eadcff', '#9b7fd4'],
      parts: ['dot-eyes', 'open-mouth', 'blush-cheeks', 'pointy-ears', 'bat-wings'],
      ink: '#fff4dc',
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
      parts: [
        'dot-eyes',
        'open-mouth',
        'blush-cheeks',
        'pointy-ears',
        'big-bat-wings',
        'curly-tail',
      ],
      size: 1.25,
      ink: '#fff4dc',
    },
    habitatPreferences: { elements: ['shadow'], feelings: ['silly', 'spooky'] },
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
    evolutions: [{ into: 'wickwhisker', level: 18 }], // TUNE:
    visual: {
      body: 'tall',
      palette: ['#3d3550', '#fff1d6', '#ffb43c'],
      parts: ['spooky-eyes', 'cat-mouth', 'pointy-ears', 'flame-tuft', 'curly-tail'],
      ink: '#fff4dc',
      glow: 'accent',
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
      body: 'tall',
      palette: ['#2f2840', '#fff1d6', '#ff9f1c', '#ffe066'],
      parts: [
        'spooky-eyes',
        'cat-mouth',
        'pointy-ears',
        'flame-tuft',
        'curly-tail',
        'whisker-flames',
        'freckles',
      ],
      size: 1.25,
      ink: '#fff4dc',
      glow: 'accent',
    },
    habitatPreferences: { elements: ['fire'], feelings: ['spooky', 'cozy'] },
  },
];
