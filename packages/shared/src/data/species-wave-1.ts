import type { Species } from '../schemas/data/species.js';

/*
 * Wave 1 of the 500-squishy plan (#382): 8 hand-designed kinds, found in the
 * wild by biome (see the server spawn tables, ids `wave-1-*`). 4 common, 2 uncommon,
 * 2 rare (the brief's 30; the rest did not read at a glance as toys and were
 * dropped rather than shipped weak). Each is built round one hook a kid can say in five words (the
 * creative brief the owner approved): a moth carrying its own moon, a shooting
 * star turned snail, a snowflake afraid of melting. #443 gives each line a
 * kid and one teen, listed after its kind (the branch teens come in Phase 2).
 * No wave-1 form is met as a guardian. Public data like the rest of
 * `species.ts`; where each one spawns is server-only.
 *
 * Stat budgets (hp + attack + defense + speed) follow the launch bands in
 * `species.ts` (TUNE: every `baseStats` and spawn weight): common 195-215, uncommon 210-240, rare 225-245 (the bands `species-wave-1.test.ts` pins). A
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
      body: 'comet-star',
      palette: ['#ff8fd0', '#ffe6f5', '#ffd23f', '#ffb347'],
      parts: ['happy-eyes', 'smile', 'blush-cheeks', 'spark-crest', 'bolt-chain'],
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
        size: 0.68,
        forward: 0.62,
        up: 0.14,
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
    feeling: 'silly',
    rarity: 'common',
    baseStats: {
      hp: 55,
      attack: 50,
      defense: 45,
      speed: 55,
    },
    moves: ['giggle-drizzle', 'bubble-bath', 'belly-flop'],
    evolutions: [{ into: 'lilyleap', level: 16 }], // TUNE: #443 kid at the common level
    visual: {
      body: 'blob',
      palette: ['#8ad65f', '#e6ffd0', '#ff9ec4', '#3fae3a'],
      parts: ['dot-eyes', 'open-mouth', 'blush-cheeks', 'eye-bumps', 'hop-feet'],
      size: 1.0,
      pose: 'sit',
      attackPart: 'legs',
    },
    habitatPreferences: {
      elements: ['water'],
      feelings: ['silly', 'joy'],
    },
  },
  // #443 kid (stage 2): Lilyhop grows a water curl, a preview of Croakaroo's.
  {
    id: 'lilyleap',
    name: 'Lilyleap',
    description: 'A curl of pond water bobs on its head. It splashes it at friends to say hi.',
    element: 'water',
    feeling: 'silly',
    rarity: 'common',
    baseStats: { hp: 65, attack: 59, defense: 53, speed: 65 }, // TUNE: ×1.18 Lilyhop
    moves: ['giggle-drizzle', 'bubble-bath', 'belly-flop'],
    evolutions: [{ into: 'croakaroo', level: 24 }], // TUNE: kid level + 8 (#443)
    visual: {
      body: 'blob',
      palette: ['#86d45a', '#e6ffd0', '#6cc4f0', '#3fae3a'],
      parts: ['dot-eyes', 'open-mouth', 'blush-cheeks', 'eye-bumps', 'water-curl', 'hop-feet'],
      size: 1.15,
      stance: 0.3,
      pose: 'sit',
      attackPart: 'legs',
    },
    habitatPreferences: { elements: ['water'], feelings: ['silly', 'joy'] },
  },
  // #443 teen (stage 3): the line's only teen until its branch ships in Phase 2.
  {
    id: 'croakaroo',
    name: 'Croakaroo',
    description:
      'Its big hands catch dragonflies, then let them go again. It sticks out its tongue to say hi.',
    element: 'water',
    feeling: 'silly',
    rarity: 'uncommon',
    baseStats: { hp: 77, attack: 70, defense: 63, speed: 77 }, // TUNE: ×1.4 Lilyhop
    moves: ['giggle-drizzle', 'bubble-bath', 'belly-flop', 'splish-splash'],
    evolutions: [],
    visual: {
      body: 'blob',
      palette: ['#7fcf52', '#e6ffd0', '#5cb8ec', '#3fae3a'],
      parts: [
        'sharp-eyes',
        'open-mouth',
        'giggle-tongue',
        'eye-bumps',
        'water-curl',
        'hop-feet',
        'round-hands',
        'spots',
      ],
      size: 1.3,
      stance: 0.4,
      pose: 'sit',
      attackPart: 'legs',
    },
    habitatPreferences: { elements: ['water'], feelings: ['silly', 'joy'] },
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
    evolutions: [{ into: 'hailbounce', level: 16 }], // TUNE: #443 kid at the common level
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
  // #443 kid (stage 2): Hailhop's ball tail fluffs out, before Hailhare's mane.
  {
    id: 'hailbounce',
    name: 'Hailbounce',
    description: 'Its tail fluffed up like a snowdrift. Every bounce shakes off a little flurry.',
    element: 'frost',
    feeling: 'joy',
    rarity: 'common',
    baseStats: { hp: 65, attack: 59, defense: 53, speed: 71 }, // TUNE: ×1.18 Hailhop
    moves: ['snowball-toss', 'twirly-whirl', 'frosty-pounce'],
    evolutions: [{ into: 'hailhare', level: 24 }], // TUNE: kid level + 8 (#443)
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
        'fluff-tail',
      ],
      size: 1.15,
      stance: 0.3,
      pose: 'sit',
      attackPart: 'legs',
    },
    habitatPreferences: { elements: ['frost'], feelings: ['joy', 'cozy'] },
  },
  // #443 teen (stage 3): the line's only teen until its branch ships in Phase 2.
  {
    id: 'hailhare',
    name: 'Hailhare',
    description:
      'Wears a frosty mane like a scarf. It races the snowflakes down the mountain, and wins.',
    element: 'frost',
    feeling: 'joy',
    rarity: 'uncommon',
    baseStats: { hp: 80, attack: 76, defense: 66, speed: 88 }, // TUNE: ×1.4 Hailhop, plus 16 (sim: 35% at ×1.4)
    moves: ['snowball-toss', 'twirly-whirl', 'frosty-pounce', 'brrr-bluster'],
    evolutions: [],
    visual: {
      body: 'bean',
      palette: ['#ffffff', '#a8d8ff', '#6bb8fb', '#bfe6fb'],
      parts: [
        'happy-eyes',
        'smirk',
        'blush-cheeks',
        'long-ears',
        'icicle-crown',
        'icicle-mane',
        'long-legs',
        'fluff-tail',
      ],
      size: 1.3,
      stance: 0.45,
      pose: 'stand',
      attackPart: 'legs',
    },
    habitatPreferences: { elements: ['frost'], feelings: ['joy', 'cozy'] },
  },
  {
    id: 'chillypep',
    name: 'Chillypep',
    description: 'Brrr, says Chillypep, steaming gently. Brrr.',
    element: 'fire',
    feeling: 'brave',
    rarity: 'common',
    baseStats: {
      hp: 50,
      attack: 60,
      defense: 45,
      speed: 55,
    },
    moves: ['ember-boop', 'wiggle-wick', 'toasty-tumble'],
    evolutions: [{ into: 'pepperpip', level: 16 }], // TUNE: #443 kid at the common level
    visual: {
      body: 'tall',
      palette: ['#f46a5c', '#ffd2c2', '#5fbf4a', '#3fae3a'],
      parts: ['brave-brows', 'dot-eyes', 'smirk', 'blush-cheeks', 'stem', 'stubby-legs'],
      ink: '#1a0f16',
      size: 1.1,
      glow: 'accent',
      pose: 'stand',
      attackPart: 'crown',
    },
    habitatPreferences: {
      elements: ['fire'],
      feelings: ['brave', 'joy'],
    },
  },
  // #443 kid (stage 2): Chillypep's first leaf tufts, before Jalapow's leafy mane.
  {
    id: 'pepperpip',
    name: 'Pepperpip',
    description:
      'Two leafy tufts popped up by its stem. They wiggle when it gets excited, which is a lot.',
    element: 'fire',
    feeling: 'brave',
    rarity: 'common',
    baseStats: { hp: 59, attack: 71, defense: 53, speed: 65 }, // TUNE: ×1.18 Chillypep
    moves: ['ember-boop', 'wiggle-wick', 'toasty-tumble'],
    evolutions: [{ into: 'jalapow', level: 24 }], // TUNE: kid level + 8 (#443)
    visual: {
      body: 'tall',
      palette: ['#f46a5c', '#ffd2c2', '#5fbf4a', '#3fae3a'],
      parts: [
        'brave-brows',
        'dot-eyes',
        'smirk',
        'blush-cheeks',
        'stem',
        'whisker-flames',
        'stubby-legs',
        'stubby-arms',
      ],
      ink: '#1a0f16',
      size: 1.25,
      glow: 'accent',
      stance: 0.3,
      pose: 'stand',
      attackPart: 'crown',
    },
    habitatPreferences: { elements: ['fire'], feelings: ['brave', 'joy'] },
  },
  // #443 teen (stage 3): the line's only teen until its branch ships in Phase 2.
  {
    id: 'jalapow',
    name: 'Jalapow',
    description:
      'Its leafy top grew big and bushy, and so did its arms. It still says brrr. Nobody knows why.',
    element: 'fire',
    feeling: 'brave',
    rarity: 'uncommon',
    baseStats: { hp: 70, attack: 84, defense: 63, speed: 77 }, // TUNE: ×1.4 Chillypep
    moves: ['ember-boop', 'wiggle-wick', 'toasty-tumble', 'cozy-crackle'],
    evolutions: [],
    visual: {
      body: 'tall',
      palette: ['#f25c4e', '#ffd2c2', '#5fbf4a', '#3fae3a'],
      parts: [
        'brave-brows',
        'sharp-eyes',
        'smirk',
        'blush-cheeks',
        'stem',
        'flame-mane',
        'long-legs',
        'strong-arms',
      ],
      ink: '#1a0f16',
      size: 1.42,
      glow: 'accent',
      stance: 0.45,
      pose: 'stand',
      attackPart: 'crown',
    },
    habitatPreferences: { elements: ['fire'], feelings: ['brave', 'joy'] },
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
    evolutions: [{ into: 'snowtuft', level: 16 }], // TUNE: #443 kid at the common level
    visual: {
      body: 'tiered',
      palette: ['#9fd0f5', '#ffffff', '#ffffff', '#bfe6fb'],
      parts: ['brave-brows', 'dot-eyes', 'tiny-smile', 'icicle-crown'],
      pose: 'stand',
      attackPart: 'crown',
    },
    habitatPreferences: {
      elements: ['frost'],
      feelings: ['brave', 'joy'],
    },
  },
  // #443 kid (stage 2): Flakefluff grows little snow arms, before Frostbold's strong ones.
  {
    id: 'snowtuft',
    name: 'Snowtuft',
    description: 'It grew two tiny arms. It holds them up to catch every snowflake that falls.',
    element: 'frost',
    feeling: 'brave',
    rarity: 'common',
    baseStats: { hp: 59, attack: 65, defense: 53, speed: 65 }, // TUNE: ×1.18 Flakefluff
    moves: ['snowball-toss', 'frosty-pounce', 'brrr-bluster'],
    evolutions: [{ into: 'frostbold', level: 24 }], // TUNE: kid level + 8 (#443)
    visual: {
      body: 'tiered',
      palette: ['#9fd0f5', '#ffffff', '#ffffff', '#bfe6fb'],
      parts: ['brave-brows', 'dot-eyes', 'tiny-smile', 'icicle-crown', 'stubby-arms'],
      size: 1.15,
      stance: 0.3,
      pose: 'stand',
      attackPart: 'crown',
    },
    habitatPreferences: { elements: ['frost'], feelings: ['brave', 'joy'] },
  },
  // #443 teen (stage 3): the line's only teen until its branch ships in Phase 2.
  {
    id: 'frostbold',
    name: 'Frostbold',
    description:
      'Now it stands on two feet, with crystal spines down its back. It guards the snow while it naps.',
    element: 'frost',
    feeling: 'brave',
    rarity: 'uncommon',
    baseStats: { hp: 70, attack: 77, defense: 63, speed: 77 }, // TUNE: ×1.4 Flakefluff
    moves: ['snowball-toss', 'frosty-pounce', 'brrr-bluster', 'twirly-whirl'],
    evolutions: [],
    visual: {
      body: 'tiered',
      palette: ['#93c8f2', '#ffffff', '#d2ecff', '#bfe6fb'],
      parts: [
        'brave-brows',
        'sharp-eyes',
        'smirk',
        'icicle-crown',
        'crystal-spines',
        'strong-arms',
        'stubby-legs',
      ],
      size: 1.3,
      stance: 0.45,
      pose: 'stand',
      attackPart: 'crown',
    },
    habitatPreferences: { elements: ['frost'], feelings: ['brave', 'joy'] },
  },
];
