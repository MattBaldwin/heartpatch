import type { Species } from '../schemas/data/species.js';

/*
 * Wave 1 of the 500-squishy plan (#382): 9 hand-designed kinds, found in the
 * wild by biome (see `SPAWN_TABLES`, ids `wave-1-*`). 5 common, 2 uncommon,
 * 2 rare (the brief's 30; the rest did not read at a glance as toys and were
 * dropped rather than shipped weak). Each is built round one hook a kid can say in five words (the
 * creative brief the owner approved): a moth carrying its own moon, a shooting
 * star turned snail, a snowflake afraid of melting. Every one is a
 * standalone kind for now: no evolutions (branching kinds are a later lever),
 * so none is met as a guardian either. Public data like the rest of
 * `species.ts`; where each one spawns is server-only.
 *
 * Stat budgets (hp + attack + defense + speed) follow the launch bands in
 * `species.ts` (TUNE: every `baseStats` and spawn weight): common ~200-215, uncommon ~215-240, rare ~230-245. A
 * conflicted element x feeling (0.85x) gets a few more points, a harmonious
 * one (1.2x) a few less. Every move comes from the existing `MOVES`.
 *
 * Reading the visuals: `palette` is [primary, secondary, accent, detail];
 * `checkGameData` holds each one to the art rules (ink contrast, face kit
 * per feeling, glow, no two lines sharing body + dominant part + hue).
 */
export const WAVE_1_SPECIES: Species[] = [
  {
    id: 'moonmoth',
    name: 'Moonmoth',
    description: 'When the woods went dark, one moth decided to glow like the moon. It still does.',
    element: 'shadow',
    feeling: 'spooky',
    rarity: 'rare',
    baseStats: {
      hp: 65,
      attack: 60,
      defense: 55,
      speed: 55,
    },
    moves: ['peekaboo', 'night-light', 'shadow-snuggle', 'upside-flop'],
    evolutions: [],
    visual: {
      body: 'orb',
      palette: ['#8fb2ff', '#dce8ff', '#ffd45a', '#4a64b0'],
      parts: ['spooky-eyes', 'tiny-smile', 'moth-wings', 'zing-antennae', 'fluff-tail'],
      size: 1.5,
      glow: 'accent',
      stance: 0.5,
      pose: 'hover',
      attackPart: 'wings',
    },
    habitatPreferences: {
      elements: ['shadow'],
      feelings: ['spooky', 'sleepy'],
    },
  },
  {
    id: 'cometsnail',
    name: 'Cometsnail',
    description: 'It fell from the sky in a hurry. It has not been in a hurry since.',
    element: 'spark',
    feeling: 'joy',
    rarity: 'rare',
    baseStats: {
      hp: 65,
      attack: 55,
      defense: 60,
      speed: 50,
    },
    moves: ['zip-zap', 'static-glide', 'fizzy-pop', 'zoomies'],
    evolutions: [],
    visual: {
      body: 'star',
      palette: ['#ff8fd0', '#ffe6f5', '#ffd23f', '#ffb347'],
      parts: ['happy-eyes', 'smile', 'blush-cheeks', 'zing-antennae', 'bolt-chain'],
      size: 1.5,
      glow: 'body',
      stance: 0.5,
      pose: 'hover',
      attackPart: 'tail',
    },
    habitatPreferences: {
      elements: ['spark'],
      feelings: ['joy', 'cozy'],
    },
  },
  {
    id: 'shellnap',
    name: 'Shellnap',
    description:
      'A pond turtle wearing a teacup it found after a picnic. Please do not rush it. Or the tea.',
    element: 'water',
    feeling: 'sleepy',
    rarity: 'uncommon',
    baseStats: {
      hp: 70,
      attack: 45,
      defense: 75,
      speed: 30,
    },
    moves: ['giggle-drizzle', 'bubble-bath', 'snore-drizzle'],
    evolutions: [],
    visual: {
      body: 'pebble',
      palette: ['#9fe0c0', '#fff4e6', '#ffe9d6', '#ff9ec4'],
      parts: ['sleepy-eyes', 'tiny-smile', 'shell-dome', 'stubby-legs', 'handle-arc', 'freckles'],
      size: 1.05,
      head: {
        body: 'orb',
        size: 0.5,
        forward: 0.7,
        up: 0.1,
      },
      pose: 'stand',
      attackPart: 'tail',
    },
    habitatPreferences: {
      elements: ['water'],
      feelings: ['sleepy', 'cozy'],
    },
  },
  {
    id: 'gnomnom',
    name: 'Gnomnom',
    description: 'Guards the garden. Eats the garden. Feels fine about it.',
    element: 'stone',
    feeling: 'cozy',
    rarity: 'uncommon',
    baseStats: {
      hp: 65,
      attack: 55,
      defense: 65,
      speed: 40,
    },
    moves: ['pebble-plop', 'sturdy-sit', 'rock-a-bye', 'rumble-roll'],
    evolutions: [],
    visual: {
      body: 'pear',
      palette: ['#b9b2a7', '#fff4e6', '#d9453b', '#7a6f66'],
      parts: [
        'oval-eyes',
        'smile',
        'blush-cheeks',
        'nightcap',
        'fur-ruff',
        'stubby-legs',
        'stubby-arms',
        'freckles',
      ],
      size: 1.1,
      pose: 'stand',
      attackPart: 'arms',
    },
    habitatPreferences: {
      elements: ['stone'],
      feelings: ['cozy', 'sleepy'],
    },
  },
  {
    id: 'lilyhop',
    name: 'Lilyhop',
    description: 'Sits on a lily pad and waves at every dragonfly. Ribbit? Ribbit!',
    element: 'water',
    feeling: 'joy',
    rarity: 'common',
    baseStats: {
      hp: 55,
      attack: 45,
      defense: 50,
      speed: 55,
    },
    moves: ['giggle-drizzle', 'bubble-bath', 'petal-party'],
    evolutions: [],
    visual: {
      body: 'blob',
      palette: ['#8ad65f', '#e6ffd0', '#ff9ec4', '#3fae3a'],
      parts: ['happy-eyes', 'smile', 'blush-cheeks', 'eye-bumps', 'hop-feet'],
      size: 1.0,
      pose: 'sit',
      attackPart: 'legs',
    },
    habitatPreferences: {
      elements: ['water'],
      feelings: ['joy', 'cozy'],
    },
  },
  {
    id: 'hailhop',
    name: 'Hailhop',
    description: 'Hops the peaks and rains tiny ice pearls with every landing. Plink, plink!',
    element: 'frost',
    feeling: 'joy',
    rarity: 'common',
    baseStats: {
      hp: 55,
      attack: 50,
      defense: 45,
      speed: 60,
    },
    moves: ['snowball-toss', 'twirly-whirl', 'frosty-pounce'],
    evolutions: [],
    visual: {
      body: 'bean',
      palette: ['#ffffff', '#e4f3ff', '#7ec4ff', '#bfe6fb'],
      parts: [
        'happy-eyes',
        'smile',
        'blush-cheeks',
        'long-ears',
        'icicle-crown',
        'hop-feet',
        'ball-tail',
      ],
      size: 1.0,
      pose: 'sit',
      attackPart: 'legs',
    },
    habitatPreferences: {
      elements: ['frost'],
      feelings: ['joy', 'cozy'],
    },
  },
  {
    id: 'fogglet',
    name: 'Fogglet',
    description: 'Everyone else lifted hours ago. Fogglet is still here. Shh.',
    element: 'shadow',
    feeling: 'sleepy',
    rarity: 'common',
    baseStats: {
      hp: 60,
      attack: 45,
      defense: 50,
      speed: 50,
    },
    moves: ['peekaboo', 'upside-snooze', 'shadow-snuggle'],
    evolutions: [],
    visual: {
      body: 'orb',
      palette: ['#bfb3d6', '#e9e2f5', '#d8ccf0', '#8a7aa8'],
      parts: ['sleepy-eyes', 'tiny-smile', 'cloud-crown', 'wisp-tail'],
      stance: 0.3,
      pose: 'hover',
      attackPart: 'tail',
    },
    habitatPreferences: {
      elements: ['shadow'],
      feelings: ['sleepy', 'cozy'],
    },
  },
  {
    id: 'chillypep',
    name: 'Chillypep',
    description: 'Brrr, says Chillypep, steaming gently. Brrr.',
    element: 'fire',
    feeling: 'joy',
    rarity: 'common',
    baseStats: {
      hp: 50,
      attack: 60,
      defense: 45,
      speed: 55,
    },
    moves: ['ember-boop', 'wiggle-wick', 'toasty-tumble'],
    evolutions: [],
    visual: {
      body: 'tall',
      palette: ['#f46a5c', '#ffd2c2', '#5fbf4a', '#3fae3a'],
      parts: ['happy-eyes', 'smile', 'blush-cheeks', 'stem', 'leaf-arms', 'stubby-legs'],
      ink: '#1a0f16',
      size: 1.1,
      glow: 'accent',
      pose: 'stand',
      attackPart: 'arms',
    },
    habitatPreferences: {
      elements: ['fire'],
      feelings: ['joy', 'cozy'],
    },
  },
  {
    id: 'flakefluff',
    name: 'Flakefluff',
    description: 'It is brave about everything except warm hands.',
    element: 'frost',
    feeling: 'brave',
    rarity: 'common',
    baseStats: {
      hp: 50,
      attack: 55,
      defense: 45,
      speed: 55,
    },
    moves: ['snowball-toss', 'frosty-pounce', 'brrr-bluster'],
    evolutions: [],
    visual: {
      body: 'orb',
      palette: ['#f4fbff', '#ffffff', '#8ec6f0', '#bfe6fb'],
      parts: ['brave-brows', 'dot-eyes', 'tiny-smile', 'spike-coat'],
      stance: 0.5,
      pose: 'hover',
      attackPart: 'spikes',
    },
    habitatPreferences: {
      elements: ['frost'],
      feelings: ['brave', 'joy'],
    },
  },
];
