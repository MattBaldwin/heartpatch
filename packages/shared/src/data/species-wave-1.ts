import type { Species } from '../schemas/data/species.js';

/*
 * Wave 1 of the 500-squishy plan (#382): 30 hand-designed kinds, found in the
 * wild by biome (see `SPAWN_TABLES`, ids `wave-1-*`). 18 common, 9 uncommon,
 * 3 rare. Every one is a standalone kind for now: no evolutions (branching
 * kinds are a later lever), so none is met as a guardian either. Public
 * data like the rest of `species.ts`; where each one spawns is server-only.
 *
 * Stat budgets (hp + attack + defense + speed) follow the launch bands in
 * `species.ts`: common ~200–210, uncommon ~215–230, rare ~230–240. A
 * conflicted element × feeling (0.85×) gets a few more points, a harmonious
 * one (1.2×) a few less. Every move comes from the existing `MOVES`.
 *
 * Reading the visuals: `palette` is [primary, secondary, accent, detail];
 * `checkGameData` holds each one to the art rules (ink contrast, face kit
 * per feeling, glow, no two lines sharing body + dominant part + hue).
 */
export const WAVE_1_SPECIES: Species[] = [
  // ---- Meadow ----
  // Leaf + Joy. A dandelion seed that floats about.
  {
    id: 'dandypuff',
    name: 'Dandypuff',
    description: 'A fluffy seed puff that floats along on every breeze. Make a wish!',
    element: 'leaf',
    feeling: 'joy',
    rarity: 'common',
    baseStats: { hp: 60, attack: 50, defense: 45, speed: 60 }, // TUNE:
    moves: ['leafy-tickle', 'pollen-puff', 'petal-party'],
    evolutions: [],
    visual: {
      body: 'orb',
      palette: ['#fff6bf', '#ffffff', '#ffffff', '#9fd672'],
      parts: ['happy-eyes', 'smile', 'blush-cheeks', 'spike-coat', 'leaf-tail'],
      size: 0.95,
      stance: 0.4,
      pose: 'hover',
      attackPart: 'tail',
    },
    habitatPreferences: { elements: ['leaf'], feelings: ['joy', 'cozy'] },
  },
  // Spark + Cozy. A fuzzy bumblebee that hums while it works.
  {
    id: 'bumblebop',
    name: 'Bumblebop',
    description: 'Hums while it works and bops while it hums. Its tummy stripes are extra soft.',
    element: 'spark',
    feeling: 'cozy',
    rarity: 'common',
    baseStats: { hp: 50, attack: 55, defense: 45, speed: 65 }, // TUNE:
    moves: ['zip-zap', 'fizzy-pop', 'zoomies'],
    evolutions: [],
    visual: {
      body: 'pear',
      palette: ['#ffd23f', '#fff1b8', '#4a3a52', '#fff1b8'],
      parts: [
        'oval-eyes',
        'smile',
        'blush-cheeks',
        'zing-antennae',
        'nub-wings',
        'belly-patch',
        'stubby-arms',
      ],
      stance: 0.35,
      pose: 'hover',
      attackPart: 'wings',
    },
    habitatPreferences: { elements: ['spark'], feelings: ['cozy', 'joy'] },
  },
  // Light + Sleepy. A sun-warmed biscuit that naps where the light is best.
  {
    id: 'sunbaskit',
    name: 'Sunbaskit',
    description:
      'Naps in the warmest patch of sun, and shares the glow with anyone who sits close.',
    element: 'light',
    feeling: 'sleepy',
    rarity: 'common',
    baseStats: { hp: 65, attack: 40, defense: 55, speed: 40 }, // TUNE:
    moves: ['sunny-beam', 'night-light-hug', 'night-light'],
    evolutions: [],
    visual: {
      body: 'mochi',
      palette: ['#ffd98a', '#fff3d0', '#ffb347', '#fff9e6'],
      parts: ['sleepy-eyes', 'tiny-smile', 'blush-cheeks', 'sun-rays', 'stubby-arms', 'freckles'],
      glow: 'body',
      pose: 'sit',
      attackPart: 'arms',
    },
    habitatPreferences: { elements: ['light'], feelings: ['sleepy', 'cozy'] },
  },
  // Leaf + Silly. A meadow kitten with a lucky clover on its back.
  {
    id: 'clovermew',
    name: 'Clovermew',
    description:
      'A meadow kitten with a lucky clover on its back. It will not say where it found it.',
    element: 'leaf',
    feeling: 'silly',
    rarity: 'common',
    baseStats: { hp: 50, attack: 55, defense: 40, speed: 65 }, // TUNE:
    moves: ['leafy-tickle', 'prickle-roll', 'zoomies'],
    evolutions: [],
    visual: {
      body: 'barrel',
      palette: ['#a8e08a', '#e9fbd9', '#5fb85a', '#2f8f4a'],
      parts: [
        'dot-eyes',
        'open-mouth',
        'blush-cheeks',
        'leaf-ears',
        'stuck-leaf',
        'stubby-legs',
        'curly-tail',
      ],
      head: { body: 'orb', size: 0.85, forward: 0.35, up: 0.35 },
      pose: 'stand',
      attackPart: 'tail',
    },
    habitatPreferences: { elements: ['leaf'], feelings: ['silly', 'joy'] },
  },

  // ---- Forest ----
  // Leaf + Sleepy. A little mushroom that nods off in the shade.
  {
    id: 'spotcap',
    name: 'Spotcap',
    description: 'A sleepy little mushroom that nods off in the shade. Its spots are freckles.',
    element: 'leaf',
    feeling: 'sleepy',
    rarity: 'common',
    baseStats: { hp: 65, attack: 45, defense: 60, speed: 30 }, // TUNE:
    moves: ['leafy-tickle', 'mossy-nap', 'pollen-puff'],
    evolutions: [],
    visual: {
      body: 'blob',
      palette: ['#ea6254', '#fff6e6', '#fff6e6', '#f3c9b8'],
      ink: '#1a0f16',
      parts: [
        'sleepy-eyes',
        'tiny-smile',
        'blush-cheeks',
        'cloud-crown',
        'stubby-arms',
        'hop-feet',
      ],
      size: 1,
      pose: 'stand',
      attackPart: 'arms',
    },
    habitatPreferences: { elements: ['leaf'], feelings: ['sleepy', 'cozy'] },
  },
  // Shadow + Sleepy. A baby owl that only opens one eye at a time.
  {
    id: 'hootnook',
    name: 'Hootnook',
    description:
      "Whoo's sleepy? Hootnook! It opens just one eye, to check that you're still there.",
    element: 'shadow',
    feeling: 'sleepy',
    rarity: 'common',
    baseStats: { hp: 55, attack: 50, defense: 50, speed: 50 }, // TUNE:
    moves: ['peekaboo', 'boo', 'upside-snooze'],
    evolutions: [],
    visual: {
      body: 'bean',
      palette: ['#b5a48f', '#f3ead8', '#e0a43c', '#6e5d4a'],
      parts: ['sleepy-eyes', 'beak', 'pointy-ears', 'nub-wings', 'belly-patch', 'hop-feet'],
      size: 0.95,
      head: { body: 'orb', size: 0.78, forward: 0, up: 0.62 },
      pose: 'stand',
      attackPart: 'wings',
    },
    habitatPreferences: { elements: ['shadow'], feelings: ['sleepy', 'cozy'] },
  },
  // Stone + Cozy. A pinecone with a scratchy coat and a soft heart.
  {
    id: 'conecuddle',
    name: 'Conecuddle',
    description: 'A cuddly pinecone with a very scratchy coat and a very soft heart.',
    element: 'stone',
    feeling: 'cozy',
    rarity: 'common',
    baseStats: { hp: 60, attack: 45, defense: 65, speed: 30 }, // TUNE:
    moves: ['pebble-plop', 'sturdy-sit', 'rock-a-bye'],
    evolutions: [],
    visual: {
      body: 'tiered',
      palette: ['#d9a672', '#e7c9a0', '#6e4326', '#f5e1c2'],
      parts: [
        'oval-eyes',
        'smile',
        'blush-cheeks',
        'round-ears',
        'spike-coat',
        'stubby-arms',
        'hop-feet',
      ],
      size: 0.95,
      pose: 'sit',
      attackPart: 'arms',
    },
    habitatPreferences: { elements: ['stone'], feelings: ['cozy', 'sleepy'] },
  },
  // Leaf + Brave. A berry-picking bear cub tangled in brambles.
  {
    id: 'bramblebear',
    name: 'Bramblebear',
    description: 'A berry-picking bear cub, tangled up in thorny vines. It does not mind one bit.',
    element: 'leaf',
    feeling: 'brave',
    rarity: 'uncommon',
    baseStats: { hp: 70, attack: 65, defense: 55, speed: 35 }, // TUNE:
    moves: ['leafy-tickle', 'prickle-roll', 'mossy-nap'],
    evolutions: [],
    visual: {
      body: 'pear',
      palette: ['#8fbf6a', '#d24d6a', '#e7f5c8', '#5c8f3f'],
      parts: [
        'sharp-eyes',
        'brave-brows',
        'smirk',
        'round-ears',
        'bubble-crown',
        'strong-arms',
        'biped-legs',
        'ball-tail',
      ],
      size: 0.92,
      head: { body: 'orb', size: 0.78, forward: 0.12, up: 0.7 },
      stance: 0.1,
      pose: 'upright',
      attackPart: 'arms',
    },
    habitatPreferences: { elements: ['leaf'], feelings: ['brave', 'cozy'] },
  },

  // ---- Old forest ----
  // Leaf + Spooky. A gnarled stump that looks grumpy until you say hello.
  {
    id: 'knotkin',
    name: 'Knotkin',
    description:
      'A gnarly little stump that looks grumpy until you say hello. Then it creaks with giggles.',
    element: 'leaf',
    feeling: 'spooky',
    rarity: 'common',
    baseStats: { hp: 60, attack: 60, defense: 50, speed: 45 }, // TUNE:
    moves: ['leafy-tickle', 'boo', 'lantern-grin'],
    evolutions: [],
    visual: {
      body: 'bean',
      palette: ['#6e4f33', '#d4b48a', '#6aa84f', '#a07c58'],
      ink: '#fff1d6',
      parts: [
        'spooky-eyes',
        'tiny-smile',
        'leaf-sprout',
        'crag-nubs',
        'stubby-arms',
        'biped-legs',
        'vine-tail',
      ],
      pose: 'stand',
      attackPart: 'tail',
    },
    habitatPreferences: { elements: ['leaf'], feelings: ['spooky', 'sleepy'] },
  },
  // Light + Silly. A glowworm with its tail-light on.
  {
    id: 'gleamgrub',
    name: 'Gleamgrub',
    description:
      'A glowworm that wiggles through the old forest with its tail-light on. It is a bit shy about it.',
    element: 'light',
    feeling: 'silly',
    rarity: 'common',
    baseStats: { hp: 60, attack: 50, defense: 45, speed: 60 }, // TUNE:
    moves: ['sunny-beam', 'night-light', 'zoomies'],
    evolutions: [],
    visual: {
      body: 'orb',
      palette: ['#d8f27a', '#f4ffc7', '#9be34a', '#ffffff'],
      parts: [
        'dot-eyes',
        'open-mouth',
        'blush-cheeks',
        'zing-antennae',
        'serpent-body',
        'freckles',
      ],
      size: 0.9,
      glow: 'body',
      stance: 0.35,
      pose: 'slither',
      attackPart: 'tail',
    },
    habitatPreferences: { elements: ['light'], feelings: ['silly', 'joy'] },
  },
  // Shadow + Brave. A badger that digs tunnels under old roots.
  {
    id: 'burrowbrock',
    name: 'Burrowbrock',
    description: 'Digs cozy tunnels under old roots, then invites everyone in for a snack.',
    element: 'shadow',
    feeling: 'brave',
    rarity: 'uncommon',
    baseStats: { hp: 65, attack: 60, defense: 60, speed: 40 }, // TUNE:
    moves: ['peekaboo', 'shadow-snuggle', 'boo'],
    evolutions: [],
    visual: {
      body: 'barrel',
      palette: ['#b3a8c8', '#f1ecf5', '#d8d0e6', '#4d4262'],
      parts: [
        'sharp-eyes',
        'brave-brows',
        'smirk',
        'round-ears',
        'fur-ruff',
        'strong-arms',
        'stubby-legs',
        'ball-tail',
      ],
      size: 1.05,
      head: { body: 'orb', size: 0.85, forward: 0.4, up: 0.3 },
      pose: 'stand',
      attackPart: 'arms',
    },
    habitatPreferences: { elements: ['shadow'], feelings: ['brave', 'cozy'] },
  },
  // Shadow + Joy (conflicted, so the bigger budget). A moth that drifts out of the fog.
  {
    id: 'mistmoth',
    name: 'Mistmoth',
    description: 'Drifts out of the fog on soft, silent wings. If you whisper, it will dance.',
    element: 'shadow',
    feeling: 'joy',
    rarity: 'rare',
    baseStats: { hp: 60, attack: 60, defense: 55, speed: 65 }, // TUNE:
    moves: ['peekaboo', 'shadow-snuggle', 'upside-flop', 'boo'],
    evolutions: [],
    visual: {
      body: 'bean',
      palette: ['#b3a8e0', '#e6def9', '#ffd6f0', '#5e4f9c'],
      parts: [
        'happy-eyes',
        'smile',
        'blush-cheeks',
        'zing-antennae',
        'moth-wings',
        'stubby-arms',
        'freckles',
      ],
      size: 1.35,
      stance: 0.35,
      pose: 'hover',
      attackPart: 'wings',
    },
    habitatPreferences: { elements: ['shadow'], feelings: ['joy', 'cozy'] },
  },

  // ---- Hills ----
  // Fire + Silly. A toast-coloured toad that smells like breakfast.
  {
    id: 'toastoad',
    name: 'Toastoad',
    description:
      'A warm, toasty toad. Sit next to it on a chilly morning. It smells like breakfast.',
    element: 'fire',
    feeling: 'silly',
    rarity: 'common',
    baseStats: { hp: 55, attack: 55, defense: 45, speed: 55 }, // TUNE:
    moves: ['ember-boop', 'wiggle-wick', 'cozy-crackle'],
    evolutions: [],
    visual: {
      body: 'blob',
      palette: ['#e8a45a', '#fff0c9', '#ff7a2f', '#a8642e'],
      parts: [
        'dot-eyes',
        'open-mouth',
        'blush-cheeks',
        'eye-bumps',
        'flame-tuft',
        'crag-nubs',
        'hop-feet',
      ],
      size: 1,
      head: { body: 'mochi', size: 0.85, forward: 0.4, up: 0.2 },
      glow: 'accent',
      pose: 'sit',
      attackPart: 'legs',
    },
    habitatPreferences: { elements: ['fire'], feelings: ['silly', 'joy'] },
  },
  // Stone + Brave. A crab in a shell of tiny stones.
  {
    id: 'cobblecrab',
    name: 'Cobblecrab',
    description: 'Scuttles sideways in a shell made of tiny stones. Tap, tap, tap!',
    element: 'stone',
    feeling: 'brave',
    rarity: 'common',
    baseStats: { hp: 55, attack: 60, defense: 60, speed: 30 }, // TUNE:
    moves: ['pebble-plop', 'rumble-roll', 'sturdy-sit'],
    evolutions: [],
    visual: {
      body: 'mochi',
      palette: ['#a9b7d0', '#e3e9f4', '#ef7f6a', '#7d8aa6'],
      parts: [
        'oval-eyes',
        'brave-brows',
        'smirk',
        'zing-antennae',
        'claw-arms',
        'crag-nubs',
        'long-legs',
      ],
      size: 1.15,
      stance: 0.2,
      pose: 'stand',
      attackPart: 'arms',
    },
    habitatPreferences: { elements: ['stone'], feelings: ['brave', 'sleepy'] },
  },
  // Spark + Brave. A tiny bird that zips from fence post to fence post.
  {
    id: 'zapwren',
    name: 'Zapwren',
    description: 'A tiny bird that zips from fence post to fence post, fizzing with news.',
    element: 'spark',
    feeling: 'brave',
    rarity: 'uncommon',
    baseStats: { hp: 50, attack: 65, defense: 45, speed: 70 }, // TUNE:
    moves: ['zip-zap', 'static-glide', 'fizzy-pop', 'zoomies'],
    evolutions: [],
    visual: {
      body: 'orb',
      palette: ['#a79bff', '#e9e4ff', '#ffd93d', '#6e5fe0'],
      parts: ['sharp-eyes', 'brave-brows', 'beak', 'plume-wings', 'tail-feathers', 'biped-legs'],
      size: 0.85,
      stance: 0.3,
      pose: 'stand',
      attackPart: 'wings',
    },
    habitatPreferences: { elements: ['spark'], feelings: ['brave', 'joy'] },
  },
  // Fire + Brave. A lizard with a glowing back that loves a Hearthfire.
  {
    id: 'kilnback',
    name: 'Kilnback',
    description: 'A toasty lizard with a glowing back. It loves to curl up next to a Hearthfire.',
    element: 'fire',
    feeling: 'brave',
    rarity: 'uncommon',
    baseStats: { hp: 60, attack: 65, defense: 55, speed: 40 }, // TUNE:
    moves: ['ember-boop', 'toasty-tumble', 'wiggle-wick'],
    evolutions: [],
    visual: {
      body: 'bean',
      palette: ['#e86f4f', '#ffd9a8', '#ff9a3c', '#a84a32'],
      ink: '#1f1524',
      parts: [
        'sharp-eyes',
        'brave-brows',
        'smirk',
        'back-spines',
        'strong-arms',
        'biped-legs',
        'flame-tail',
      ],
      size: 1.05,
      head: { body: 'orb', size: 0.7, forward: 0.35, up: 0.65 },
      glow: 'accent',
      stance: 0.1,
      pose: 'upright',
      attackPart: 'tail',
    },
    habitatPreferences: { elements: ['fire'], feelings: ['brave', 'joy'] },
  },
  // Fire + Cozy. A cinnamon moose whose antlers glow like warm embers.
  {
    id: 'cinnamoose',
    name: 'Cinnamoose',
    description:
      'A cinnamon-sweet moose whose antlers glow like warm embers. It smells like cocoa.',
    element: 'fire',
    feeling: 'cozy',
    rarity: 'rare',
    baseStats: { hp: 65, attack: 55, defense: 60, speed: 50 }, // TUNE:
    moves: ['ember-boop', 'cozy-crackle', 'wiggle-wick', 'toasty-tumble'],
    evolutions: [],
    visual: {
      body: 'barrel',
      palette: ['#d79a6b', '#f3d9b8', '#ff9a3c', '#8a4f2e'],
      parts: [
        'oval-eyes',
        'smile',
        'blush-cheeks',
        'antlers',
        'flame-mane',
        'long-legs',
        'ball-tail',
      ],
      size: 1.6,
      head: { body: 'bean', size: 0.95, forward: 0.55, up: 0.65 },
      glow: 'accent',
      stance: 0.45,
      pose: 'stand',
      attackPart: 'horns',
    },
    habitatPreferences: { elements: ['fire'], feelings: ['cozy', 'joy'] },
  },

  // ---- Mountains ----
  // Frost + Cozy. A squishy shaped like a snug mitten.
  {
    id: 'snowmitt',
    name: 'Snowmitt',
    description: 'A squishy shaped like a snug mitten. Hold it and your hands warm right up.',
    element: 'frost',
    feeling: 'cozy',
    rarity: 'common',
    baseStats: { hp: 60, attack: 50, defense: 55, speed: 45 }, // TUNE:
    moves: ['snowball-toss', 'chilly-yawn', 'brrr-bluster'],
    evolutions: [],
    visual: {
      body: 'star',
      palette: ['#e6f4ff', '#ffffff', '#8fd0ff', '#bfe6ff'],
      parts: ['oval-eyes', 'tiny-smile', 'blush-cheeks', 'stubby-arms', 'hop-feet', 'ball-tail'],
      pose: 'sit',
      attackPart: 'arms',
    },
    habitatPreferences: { elements: ['frost'], feelings: ['cozy', 'sleepy'] },
  },
  // Frost + Silly. A snow bunny that rains ice pearls when it lands.
  {
    id: 'hailhop',
    name: 'Hailhop',
    description:
      'Hops across the peaks and rains tiny ice pearls with every landing. Plink, plink!',
    element: 'frost',
    feeling: 'silly',
    rarity: 'common',
    baseStats: { hp: 50, attack: 55, defense: 40, speed: 65 }, // TUNE:
    moves: ['snowball-toss', 'twirly-whirl', 'zoomies'],
    evolutions: [],
    visual: {
      body: 'bean',
      palette: ['#bfe3ff', '#ffffff', '#5aa9ff', '#ffffff'],
      parts: [
        'dot-eyes',
        'open-mouth',
        'blush-cheeks',
        'long-ears',
        'icicle-crown',
        'hop-feet',
        'ball-tail',
      ],
      size: 0.95,
      pose: 'sit',
      attackPart: 'legs',
    },
    habitatPreferences: { elements: ['frost'], feelings: ['silly', 'joy'] },
  },
  // Stone + Silly. A pile of pebbles that can't stop giggling.
  {
    id: 'gravelgiggle',
    name: 'Gravelgiggle',
    description: 'A pile of pebbles that cannot stop giggling. The whole mountain hears it.',
    element: 'stone',
    feeling: 'silly',
    rarity: 'common',
    baseStats: { hp: 60, attack: 55, defense: 60, speed: 35 }, // TUNE:
    moves: ['pebble-plop', 'rumble-boop', 'sturdy-sit'],
    evolutions: [],
    visual: {
      body: 'pebble',
      palette: ['#cdbfa9', '#a39684', '#8d867a', '#6f685c'],
      parts: ['dot-eyes', 'open-mouth', 'bubble-crown', 'crag-nubs', 'stubby-arms', 'stubby-legs'],
      size: 1,
      head: { body: 'pebble', size: 0.75, forward: 0.08, up: 0.72 },
      pose: 'sit',
      attackPart: 'arms',
    },
    habitatPreferences: { elements: ['stone'], feelings: ['silly', 'sleepy'] },
  },
  // Stone + Cozy. A stack of friendly stones.
  {
    id: 'stackle',
    name: 'Stackle',
    description: 'A stack of friendly stones with a sprig of moss on top. Do not sneeze near it!',
    element: 'stone',
    feeling: 'cozy',
    rarity: 'uncommon',
    baseStats: { hp: 70, attack: 50, defense: 75, speed: 25 }, // TUNE:
    moves: ['pebble-plop', 'sturdy-sit', 'rumble-roll', 'rock-a-bye'],
    evolutions: [],
    visual: {
      body: 'tall',
      palette: ['#b8b3ab', '#e6e1d8', '#7fae6a', '#d8cfc0'],
      parts: ['oval-eyes', 'smile', 'blush-cheeks', 'stem', 'crag-nubs', 'stubby-arms'],
      size: 1.05,
      pose: 'stand',
      attackPart: 'arms',
    },
    habitatPreferences: { elements: ['stone'], feelings: ['cozy', 'sleepy'] },
  },
  // Spark + Sleepy. A little lamb made of storm cloud.
  {
    id: 'cloudlamb',
    name: 'Cloudlamb',
    description: 'A little lamb made of storm cloud. Its snores sound like faraway thunder.',
    element: 'spark',
    feeling: 'sleepy',
    rarity: 'uncommon',
    baseStats: { hp: 70, attack: 55, defense: 60, speed: 50 }, // TUNE:
    moves: ['zip-zap', 'static-fluff', 'fizzy-pop', 'chilly-yawn'],
    evolutions: [],
    visual: {
      body: 'blob',
      palette: ['#e8ecff', '#ffffff', '#ffe45c', '#8e9bd6'],
      parts: [
        'sleepy-eyes',
        'tiny-smile',
        'blush-cheeks',
        'floppy-ears',
        'fur-ruff',
        'stubby-legs',
        'bolt-tail',
      ],
      size: 1.05,
      head: { body: 'orb', size: 0.7, forward: 0.35, up: 0.4 },
      pose: 'sit',
      attackPart: 'tail',
    },
    habitatPreferences: { elements: ['spark'], feelings: ['sleepy', 'cozy'] },
  },
  // Frost + Joy. A penguin that slides on its tummy and cheers itself on.
  {
    id: 'tuxtumble',
    name: 'Tuxtumble',
    description: 'Waddles, slides on its tummy and cheers itself on. Wheee!',
    element: 'frost',
    feeling: 'joy',
    rarity: 'uncommon',
    baseStats: { hp: 60, attack: 50, defense: 50, speed: 60 }, // TUNE:
    moves: ['snowball-toss', 'twirly-whirl', 'frosty-pounce'],
    evolutions: [],
    visual: {
      body: 'bean',
      palette: ['#9cc0ec', '#ffffff', '#ffb347', '#2f4f85'],
      parts: [
        'happy-eyes',
        'smile',
        'blush-cheeks',
        'belly-patch',
        'beak',
        'leaf-wings',
        'stubby-legs',
      ],
      pose: 'stand',
      attackPart: 'wings',
    },
    habitatPreferences: { elements: ['frost'], feelings: ['joy', 'cozy'] },
  },

  // ---- Lake ----
  // Water + Joy. A frog on a lily pad.
  {
    id: 'lilyhop',
    name: 'Lilyhop',
    description: 'Sits on a lily pad and waves at every dragonfly. Ribbit? Ribbit!',
    element: 'water',
    feeling: 'joy',
    rarity: 'common',
    baseStats: { hp: 55, attack: 45, defense: 50, speed: 55 }, // TUNE:
    moves: ['giggle-drizzle', 'bubble-bath', 'petal-party'],
    evolutions: [],
    visual: {
      body: 'mochi',
      palette: ['#8ad65f', '#e6ffd0', '#ff9ec4', '#3fae3a'],
      parts: ['happy-eyes', 'smile', 'blush-cheeks', 'eye-bumps', 'stem', 'leaf-arms'],
      size: 1.1,
      head: { body: 'orb', size: 0.9, forward: 0, up: 0.7 },
      pose: 'sit',
      attackPart: 'arms',
    },
    habitatPreferences: { elements: ['water'], feelings: ['joy', 'silly'] },
  },
  // Water + Cozy. A duckling that paddles in happy circles.
  {
    id: 'paddlemuff',
    name: 'Paddlemuff',
    description:
      'A fluffy duckling that paddles in happy circles. It never goes anywhere, and loves it.',
    element: 'water',
    feeling: 'cozy',
    rarity: 'common',
    baseStats: { hp: 65, attack: 45, defense: 50, speed: 45 }, // TUNE:
    moves: ['giggle-drizzle', 'belly-flop', 'bubble-bath'],
    evolutions: [],
    visual: {
      body: 'bean',
      palette: ['#fff2b0', '#ffffff', '#ff9f43', '#ffe27a'],
      parts: ['oval-eyes', 'beak', 'blush-cheeks', 'nub-wings', 'hop-feet', 'fluff-tail'],
      head: { body: 'orb', size: 0.85, forward: 0.2, up: 0.6 },
      pose: 'sit',
      attackPart: 'wings',
    },
    habitatPreferences: { elements: ['water'], feelings: ['cozy', 'joy'] },
  },
  // Water + Sleepy. A pond turtle that naps with its shell on.
  {
    id: 'shellnap',
    name: 'Shellnap',
    description: 'A pond turtle that naps with its shell on. Please do not rush it.',
    element: 'water',
    feeling: 'sleepy',
    rarity: 'uncommon',
    baseStats: { hp: 70, attack: 45, defense: 75, speed: 30 }, // TUNE:
    moves: ['giggle-drizzle', 'bubble-bath', 'snore-drizzle'],
    evolutions: [],
    visual: {
      body: 'pebble',
      palette: ['#8fd4a0', '#e9ffe6', '#3f8f5f', '#2f7a4d'],
      parts: ['sleepy-eyes', 'tiny-smile', 'shell-dome', 'stubby-legs', 'wiggle-tail'],
      size: 1.05,
      head: { body: 'pebble', size: 0.5, forward: 0.7, up: 0.08 },
      pose: 'sit',
      attackPart: 'tail',
    },
    habitatPreferences: { elements: ['water'], feelings: ['sleepy', 'cozy'] },
  },
  // Light + Cozy. A pond fish that carries its own little lantern.
  {
    id: 'lanternfin',
    name: 'Lanternfin',
    description:
      'A glowing pond fish with its own little lantern. It lights the way for lost bubbles.',
    element: 'light',
    feeling: 'cozy',
    rarity: 'rare',
    baseStats: { hp: 70, attack: 55, defense: 55, speed: 55 }, // TUNE:
    moves: ['sunny-beam', 'night-light', 'night-light-hug', 'dazzle-dance'],
    evolutions: [],
    visual: {
      body: 'barrel',
      palette: ['#5fd1e0', '#dffaff', '#fff1a0', '#2f9fb8'],
      parts: [
        'oval-eyes',
        'smile',
        'blush-cheeks',
        'uni-horn',
        'lure-lantern',
        'fin-row',
        'side-fins',
        'tail-fan',
      ],
      size: 1.2,
      glow: 'body',
      stance: 0.35,
      pose: 'hover',
      attackPart: 'tail',
    },
    habitatPreferences: { elements: ['light'], feelings: ['cozy', 'joy'] },
  },

  // ---- Pumpkin fields (everyday; Halloween's own kinds come in wave 2) ----
  // Fire + Joy. Popcorn that pops when it's happy.
  {
    id: 'kernelpop',
    name: 'Kernelpop',
    description: 'Pops up and down when it is happy. Pop, pop, pop! Smells like movie night.',
    element: 'fire',
    feeling: 'joy',
    rarity: 'common',
    baseStats: { hp: 50, attack: 60, defense: 40, speed: 60 }, // TUNE:
    moves: ['ember-boop', 'toasty-tumble', 'zoomies'],
    evolutions: [],
    visual: {
      body: 'pumpkin',
      palette: ['#fff1b8', '#fffbe8', '#ffc83a', '#ffe08a'],
      parts: [
        'happy-eyes',
        'smile',
        'blush-cheeks',
        'cloud-crown',
        'stubby-arms',
        'hop-feet',
        'flame-tail',
      ],
      size: 0.95,
      glow: 'accent',
      pose: 'sit',
      attackPart: 'tail',
    },
    habitatPreferences: { elements: ['fire'], feelings: ['joy', 'silly'] },
  },
  // Light + Cozy. A little haystack that glows like late-afternoon sun.
  {
    id: 'hayhug',
    name: 'Hayhug',
    description:
      'A cozy little haystack that glows like late-afternoon sun. Great for hugs and naps.',
    element: 'light',
    feeling: 'cozy',
    rarity: 'common',
    baseStats: { hp: 65, attack: 45, defense: 60, speed: 35 }, // TUNE:
    moves: ['sunny-beam', 'night-light-hug', 'sturdy-sit'],
    evolutions: [],
    visual: {
      body: 'drop',
      palette: ['#e8c872', '#f5e3a5', '#c99a3a', '#fff2bd'],
      parts: ['oval-eyes', 'smile', 'blush-cheeks', 'spike-coat', 'fur-ruff', 'hop-feet'],
      glow: 'body',
      pose: 'sit',
      attackPart: 'legs',
    },
    habitatPreferences: { elements: ['light'], feelings: ['cozy', 'sleepy'] },
  },
  // Light + Joy. A sunny flower friend that turns towards every smile.
  {
    id: 'marigoldie',
    name: 'Marigoldie',
    description: 'A sunny flower friend. It turns its face to every smile it sees.',
    element: 'light',
    feeling: 'joy',
    rarity: 'uncommon',
    baseStats: { hp: 60, attack: 50, defense: 50, speed: 55 }, // TUNE:
    moves: ['sunny-beam', 'dazzle-dance', 'glow-up'],
    evolutions: [],
    visual: {
      body: 'tall',
      palette: ['#ffcf4d', '#fff6c8', '#ff9a2e', '#6dbb54'],
      parts: ['happy-eyes', 'smile', 'blush-cheeks', 'sun-crown', 'leaf-arms', 'biped-legs'],
      head: { body: 'orb', size: 0.8, forward: 0.05, up: 0.75 },
      glow: 'body',
      pose: 'stand',
      attackPart: 'arms',
    },
    habitatPreferences: { elements: ['light'], feelings: ['joy', 'cozy'] },
  },
];
