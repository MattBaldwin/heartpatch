import type { ClothingItem } from '../schemas/data/clothing.js';

/**
 * The clothing catalog (design doc §23; issue #43): Keeper clothing and
 * squishy accessories in one table. Ids are stored in players' rows: add
 * freely, never rename or remove one. Shapes and colours are first guesses to
 * judge in the Keeper gallery (`/keepers.html?items=…`).
 *
 * - **Starter** items (`sources: ['starter']`) are every account's from the
 *   start, so the wardrobe is never empty (DECISIONS "Wardrobe (#43)").
 * - **Everyday** items are found all year; **Halloween** items only drop in
 *   the Halloween window (design doc §15) and stay wearable forever.
 * - Where items drop, and how often, is server-only
 *   (`data/server/clothing-drops.ts`, CLAUDE.md rule 6).
 *
 * Pieces sit in their socket's units (`ClothingPieceSchema`): +y up, −z the
 * front, x across. Turns are degrees.
 */

// ── Starter set: one per slot but costume ────────────────────────────────
const STARTER: ClothingItem[] = [
  {
    id: 'sunny-cap',
    name: 'Sunny Cap',
    description: 'A comfy cap for sunny days and squinty smiles.',
    slot: 'hat',
    rarity: 'common',
    sources: ['starter'],
    tradable: false,
    visual: {
      pieces: [
        { shape: 'ellipsoid', at: [0, -0.02, 0.04], size: [1.0, 0.62, 1.02], color: '#ffd166' },
        { shape: 'ellipsoid', at: [0, -0.16, -0.5], size: [0.8, 0.08, 0.55], color: '#ffb347' },
        { shape: 'ellipsoid', at: [0, 0.3, 0.04], size: [0.14, 0.1, 0.14], color: '#ffb347' },
      ],
    },
  },
  {
    id: 'daisy-clip',
    name: 'Daisy Clip',
    description: 'A little daisy that never needs watering.',
    slot: 'hair-accessory',
    rarity: 'common',
    sources: ['starter'],
    tradable: false,
    visual: {
      pieces: [
        { shape: 'ellipsoid', at: [0, 0, 0], size: [1.0, 1.0, 0.3], color: '#ffffff' },
        { shape: 'ellipsoid', at: [0, 0, -0.1], size: [0.42, 0.42, 0.25], color: '#ffd166' },
      ],
    },
  },
  {
    id: 'cozy-sweater',
    name: 'Cozy Sweater',
    description: 'Knitted with extra snuggles.',
    slot: 'top',
    rarity: 'common',
    sources: ['starter'],
    tradable: false,
    visual: {
      pieces: [
        { shape: 'ellipsoid', at: [0, 0.02, 0], size: [1.1, 1.08, 1.1], color: '#ff9fb2' },
        { shape: 'ellipsoid', at: [0, 0.46, 0], size: [0.72, 0.2, 0.75], color: '#fff1e6' },
        { shape: 'ellipsoid', at: [0, 0.08, -0.53], size: [0.3, 0.26, 0.08], color: '#fff1e6' },
      ],
    },
  },
  {
    id: 'picnic-skirt',
    name: 'Picnic Skirt',
    description: 'Checked, swishy and ready for sandwiches.',
    slot: 'bottom',
    rarity: 'common',
    sources: ['starter'],
    tradable: false,
    visual: {
      pieces: [
        { shape: 'cone', at: [0, -0.15, 0], size: [1.4, 1.5, 1.4], color: '#7fc8a9' },
        { shape: 'ellipsoid', at: [0, 0.32, 0], size: [1.06, 0.22, 1.06], color: '#ffffff' },
      ],
    },
  },
  {
    id: 'puddle-boots',
    name: 'Puddle Boots',
    description: 'Splash first, ask questions later.',
    slot: 'shoes',
    rarity: 'common',
    sources: ['starter'],
    tradable: false,
    visual: {
      pieces: [
        { shape: 'ellipsoid', at: [0, 0.1, 0], size: [1.15, 1.2, 1.1], color: '#ffd84d' },
        { shape: 'capsule', at: [0, 0.75, 0.15], size: [0.8, 0.9, 0.7], color: '#ffd84d' },
      ],
    },
  },
  {
    id: 'acorn-backpack',
    name: 'Acorn Backpack',
    description: 'Room for snacks, treasures and one sleepy squishy.',
    slot: 'back',
    rarity: 'common',
    sources: ['starter'],
    tradable: false,
    visual: {
      pieces: [
        { shape: 'ellipsoid', at: [0, -0.08, 0.6], size: [0.78, 0.82, 0.48], color: '#c98a4b' },
        { shape: 'ellipsoid', at: [0, 0.3, 0.6], size: [0.84, 0.36, 0.52], color: '#7a4f2c' },
        { shape: 'capsule', at: [0, 0.52, 0.6], size: [0.1, 0.2, 0.1], color: '#7a4f2c' },
      ],
    },
  },
  {
    id: 'firefly-lantern',
    name: 'Firefly Lantern',
    description: 'A friendly glow for walks after dusk.',
    slot: 'held',
    rarity: 'common',
    sources: ['starter'],
    tradable: false,
    visual: {
      pieces: [
        { shape: 'capsule', at: [0, 0.35, 0], size: [0.12, 0.5, 0.12], color: '#6b4430' },
        { shape: 'ellipsoid', at: [0, -0.05, 0], size: [0.5, 0.6, 0.5], color: '#fff3a8' },
        { shape: 'cone', at: [0, 0.3, 0], size: [0.45, 0.25, 0.45], color: '#6b4430' },
      ],
    },
  },
];

// ── Everyday: found all year ─────────────────────────────────────────────
const EVERYDAY: ClothingItem[] = [
  {
    id: 'pom-pom-beanie',
    name: 'Pom-Pom Beanie',
    description: 'Warm ears and a bouncy pom-pom on top.',
    slot: 'hat',
    rarity: 'common',
    sources: ['found'],
    tradable: true,
    visual: {
      pieces: [
        { shape: 'ellipsoid', at: [0, -0.04, 0.04], size: [1.02, 0.7, 1.04], color: '#7fa8f0' },
        { shape: 'ellipsoid', at: [0, -0.28, 0.04], size: [1.06, 0.18, 1.08], color: '#fff4c2' },
        { shape: 'ellipsoid', at: [0, 0.36, 0.04], size: [0.32, 0.3, 0.32], color: '#fff4c2' },
      ],
    },
  },
  {
    id: 'flower-crown',
    name: 'Flower Crown',
    description: 'Picked from the sunniest corner of the meadow.',
    slot: 'hat',
    rarity: 'uncommon',
    sources: ['found'],
    tradable: true,
    visual: {
      pieces: [
        { shape: 'ellipsoid', at: [0, -0.1, 0], size: [1.02, 0.12, 1.02], color: '#7fc8a9' },
        { shape: 'ellipsoid', at: [0, -0.04, -0.48], size: [0.2, 0.2, 0.14], color: '#ff8fab' },
        {
          shape: 'ellipsoid',
          at: [-0.38, -0.04, -0.3],
          size: [0.18, 0.18, 0.14],
          color: '#ffd166',
        },
        { shape: 'ellipsoid', at: [0.38, -0.04, -0.3], size: [0.18, 0.18, 0.14], color: '#c4a8f0' },
        { shape: 'ellipsoid', at: [-0.48, -0.04, 0.1], size: [0.17, 0.17, 0.14], color: '#ff8fab' },
        { shape: 'ellipsoid', at: [0.48, -0.04, 0.1], size: [0.17, 0.17, 0.14], color: '#ffd166' },
      ],
    },
  },
  {
    id: 'starry-crown',
    name: 'Starry Crown',
    description: 'Fit for the ruler of a very cozy kingdom.',
    slot: 'hat',
    rarity: 'rare',
    sources: ['found'],
    tradable: true,
    visual: {
      pieces: [
        { shape: 'capsule', at: [0, 0.02, 0], size: [0.82, 0.24, 0.82], color: '#ffd84d' },
        { shape: 'cone', at: [0, 0.24, -0.38], size: [0.2, 0.32, 0.2], color: '#ffd84d' },
        { shape: 'cone', at: [-0.3, 0.2, -0.24], size: [0.18, 0.26, 0.18], color: '#ffd84d' },
        { shape: 'cone', at: [0.3, 0.2, -0.24], size: [0.18, 0.26, 0.18], color: '#ffd84d' },
        { shape: 'ellipsoid', at: [0, 0.04, -0.42], size: [0.14, 0.14, 0.08], color: '#ff6f91' },
      ],
    },
  },
  {
    id: 'heart-clip',
    name: 'Heart Clip',
    description: 'Wear your heart in your hair.',
    slot: 'hair-accessory',
    rarity: 'common',
    sources: ['found'],
    tradable: true,
    visual: {
      pieces: [
        { shape: 'ellipsoid', at: [-0.18, 0.1, 0], size: [0.55, 0.55, 0.3], color: '#ff6f91' },
        { shape: 'ellipsoid', at: [0.18, 0.1, 0], size: [0.55, 0.55, 0.3], color: '#ff6f91' },
        {
          shape: 'cone',
          at: [0, -0.2, 0],
          size: [0.6, 0.5, 0.3],
          turn: [0, 0, 180],
          color: '#ff6f91',
        },
      ],
    },
  },
  {
    id: 'big-bow',
    name: 'Big Bow',
    description: 'The bigger the bow, the bigger the smile.',
    slot: 'hair-accessory',
    rarity: 'uncommon',
    sources: ['found'],
    tradable: true,
    visual: {
      pieces: [
        {
          shape: 'teardrop',
          at: [-0.4, 0, 0],
          size: [0.7, 0.8, 0.35],
          turn: [0, 0, 90],
          color: '#ff6f91',
        },
        {
          shape: 'teardrop',
          at: [0.4, 0, 0],
          size: [0.7, 0.8, 0.35],
          turn: [0, 0, -90],
          color: '#ff6f91',
        },
        { shape: 'ellipsoid', at: [0, 0, 0], size: [0.34, 0.36, 0.36], color: '#e24f78' },
      ],
    },
  },
  {
    id: 'cozy-apron',
    name: 'Cozy Apron',
    description: 'For baking, gardening and wiping sticky squishies.',
    slot: 'top',
    rarity: 'common',
    sources: ['found'],
    tradable: true,
    visual: {
      pieces: [
        { shape: 'ellipsoid', at: [0, -0.12, -0.42], size: [0.78, 0.95, 0.22], color: '#fff1e6' },
        { shape: 'ellipsoid', at: [0, -0.3, -0.52], size: [0.42, 0.22, 0.08], color: '#ff8fab' },
        { shape: 'ellipsoid', at: [0, 0.05, 0], size: [1.08, 0.12, 1.08], color: '#fff1e6' },
      ],
    },
  },
  {
    id: 'rainbow-scarf',
    name: 'Rainbow Scarf',
    description: 'Every colour, all at once, all wrapped up.',
    slot: 'top',
    rarity: 'uncommon',
    sources: ['found'],
    tradable: true,
    visual: {
      pieces: [
        { shape: 'ellipsoid', at: [0, 0.44, 0], size: [1.12, 0.24, 1.12], color: '#ff8fab' },
        { shape: 'ellipsoid', at: [0, 0.34, 0], size: [1.1, 0.16, 1.1], color: '#ffd166' },
        { shape: 'capsule', at: [0.24, 0.1, -0.5], size: [0.2, 0.48, 0.1], color: '#7fa8f0' },
        { shape: 'capsule', at: [0.36, 0.06, -0.48], size: [0.18, 0.42, 0.1], color: '#9fd88b' },
      ],
    },
  },
  {
    // The tutorial's reward (#24, design doc §26 step 12): account-bound.
    id: 'seedling-scarf',
    name: 'Seedling Scarf',
    description: 'Knitted from the first leaves of your Heart Seed.',
    slot: 'top',
    rarity: 'uncommon',
    sources: ['tutorial'],
    tradable: false,
    visual: {
      pieces: [
        { shape: 'ellipsoid', at: [0, 0.44, 0], size: [1.12, 0.24, 1.12], color: '#7fc97f' },
        { shape: 'ellipsoid', at: [0, 0.34, 0], size: [1.1, 0.16, 1.1], color: '#a8e6a1' },
        { shape: 'capsule', at: [0.24, 0.1, -0.5], size: [0.2, 0.48, 0.1], color: '#7fc97f' },
        { shape: 'ellipsoid', at: [0.3, -0.16, -0.52], size: [0.26, 0.12, 0.2], color: '#5fb85f' },
      ],
    },
  },
  {
    id: 'twirly-tutu',
    name: 'Twirly Tutu',
    description: 'Spins all by itself. Probably.',
    slot: 'bottom',
    rarity: 'uncommon',
    sources: ['found'],
    tradable: true,
    visual: {
      pieces: [
        { shape: 'ellipsoid', at: [0, 0, 0], size: [1.5, 0.5, 1.5], color: '#ffc4e1' },
        { shape: 'ellipsoid', at: [0, -0.12, 0], size: [1.62, 0.32, 1.62], color: '#ffe3f0' },
      ],
    },
  },
  {
    id: 'bunny-slippers',
    name: 'Bunny Slippers',
    description: 'Hop-hop-hop wherever you go.',
    slot: 'shoes',
    rarity: 'rare',
    sources: ['found'],
    tradable: true,
    visual: {
      pieces: [
        { shape: 'ellipsoid', at: [0, 0.08, 0], size: [1.2, 1.15, 1.12], color: '#fff6fb' },
        {
          shape: 'capsule',
          at: [-0.22, 0.9, -0.2],
          size: [0.26, 0.9, 0.2],
          turn: [-15, 0, 10],
          color: '#fff6fb',
        },
        {
          shape: 'capsule',
          at: [0.22, 0.9, -0.2],
          size: [0.26, 0.9, 0.2],
          turn: [-15, 0, -10],
          color: '#fff6fb',
        },
        { shape: 'ellipsoid', at: [0, 0.3, -0.52], size: [0.2, 0.16, 0.12], color: '#ff9db5' },
      ],
    },
  },
  {
    id: 'cloud-cape',
    name: 'Cloud Cape',
    description: 'Soft as a cloud, and only a little bit damp.',
    slot: 'back',
    rarity: 'rare',
    sources: ['found'],
    tradable: true,
    visual: {
      pieces: [
        { shape: 'ellipsoid', at: [0, -0.35, 0.5], size: [1.2, 1.6, 0.2], color: '#e8f1ff' },
        {
          shape: 'ellipsoid',
          at: [-0.32, -1.05, 0.52],
          size: [0.55, 0.42, 0.24],
          color: '#e8f1ff',
        },
        { shape: 'ellipsoid', at: [0.32, -1.05, 0.52], size: [0.55, 0.42, 0.24], color: '#e8f1ff' },
        { shape: 'ellipsoid', at: [0, 0.42, 0], size: [1.1, 0.18, 1.1], color: '#ffffff' },
      ],
    },
  },
  {
    id: 'butterfly-wings',
    name: 'Butterfly Wings',
    description: 'Flutter, flutter. No flying, but lots of fluttering.',
    slot: 'back',
    rarity: 'epic',
    sources: ['found'],
    tradable: true,
    visual: {
      pieces: [
        {
          shape: 'ellipsoid',
          at: [-0.62, 0.32, 0.6],
          size: [1.0, 1.1, 0.08],
          turn: [0, -20, 25],
          color: '#c4a8f0',
        },
        {
          shape: 'ellipsoid',
          at: [0.62, 0.32, 0.6],
          size: [1.0, 1.1, 0.08],
          turn: [0, 20, -25],
          color: '#c4a8f0',
        },
        {
          shape: 'ellipsoid',
          at: [-0.5, -0.35, 0.6],
          size: [0.65, 0.7, 0.08],
          turn: [0, -20, -20],
          color: '#ff9fd6',
        },
        {
          shape: 'ellipsoid',
          at: [0.5, -0.35, 0.6],
          size: [0.65, 0.7, 0.08],
          turn: [0, 20, 20],
          color: '#ff9fd6',
        },
      ],
    },
  },
  {
    id: 'bubble-wand',
    name: 'Bubble Wand',
    description: 'One wave, a hundred tiny bubbles.',
    slot: 'held',
    rarity: 'uncommon',
    sources: ['found'],
    tradable: true,
    visual: {
      pieces: [
        { shape: 'capsule', at: [0, 0.4, 0], size: [0.1, 0.9, 0.1], color: '#7fd1b9' },
        {
          shape: 'arc',
          at: [0, 0.95, 0],
          size: [0.5, 0.5, 0.1],
          turn: [90, 0, 0],
          color: '#ff8fab',
        },
        { shape: 'ellipsoid', at: [0.35, 1.25, -0.1], size: [0.3, 0.3, 0.3], color: '#d6f0ff' },
      ],
    },
  },
  {
    id: 'squishy-net',
    name: 'Squishy Net',
    description: 'For catching butterflies. Squishies prefer hugs.',
    slot: 'held',
    rarity: 'common',
    sources: ['found'],
    tradable: true,
    visual: {
      pieces: [
        { shape: 'capsule', at: [0, 0.5, 0], size: [0.1, 1.2, 0.1], color: '#c98a4b' },
        { shape: 'ellipsoid', at: [0, 1.25, 0], size: [0.6, 0.12, 0.6], color: '#ffffff' },
        {
          shape: 'cone',
          at: [0, 1.05, 0],
          size: [0.55, 0.45, 0.55],
          turn: [180, 0, 0],
          color: '#e8f1ff',
        },
      ],
    },
  },
  {
    id: 'cloud-onesie',
    name: 'Cloud Onesie',
    description: 'Be a fluffy cloud. Drift around. Have a nap.',
    slot: 'costume',
    rarity: 'legendary',
    sources: ['found'],
    tradable: true,
    visual: {
      pieces: [
        { shape: 'ellipsoid', at: [0, -0.2, 0], size: [0.95, 0.66, 1.0], color: '#f3f7ff' },
        { shape: 'ellipsoid', at: [0, 0.22, 0.12], size: [1.0, 0.6, 0.9], color: '#f3f7ff' },
        { shape: 'ellipsoid', at: [-0.38, 0.46, 0.12], size: [0.42, 0.3, 0.42], color: '#ffffff' },
        { shape: 'ellipsoid', at: [0.38, 0.46, 0.12], size: [0.42, 0.3, 0.42], color: '#ffffff' },
        { shape: 'ellipsoid', at: [0, 0.52, 0.1], size: [0.5, 0.3, 0.5], color: '#ffffff' },
      ],
    },
  },
];

// ── Halloween: found only in the Halloween window ────────────────────────
const HALLOWEEN: ClothingItem[] = [
  {
    id: 'witch-hat',
    name: 'Witch Hat',
    description: 'Pointy, purple and a tiny bit magical.',
    slot: 'hat',
    rarity: 'uncommon',
    season: 'halloween',
    sources: ['found'],
    tradable: true,
    visual: {
      pieces: [
        { shape: 'ellipsoid', at: [0, -0.1, 0.04], size: [1.5, 0.1, 1.5], color: '#6b4a7a' },
        { shape: 'cone', at: [0, 0.38, 0.04], size: [0.8, 1.0, 0.8], color: '#6b4a7a' },
        { shape: 'capsule', at: [0, 0.02, 0.04], size: [0.82, 0.14, 0.82], color: '#ffa552' },
      ],
    },
  },
  {
    id: 'pumpkin-hood',
    name: 'Pumpkin Hood',
    description: 'Snug as a pumpkin, with a stem on top.',
    slot: 'hat',
    rarity: 'rare',
    season: 'halloween',
    sources: ['found'],
    tradable: true,
    visual: {
      pieces: [
        { shape: 'ellipsoid', at: [0, -0.1, 0.1], size: [1.12, 0.85, 1.1], color: '#ff9a3c' },
        { shape: 'ellipsoid', at: [-0.3, -0.1, 0.1], size: [0.5, 0.82, 1.0], color: '#f08a2c' },
        { shape: 'ellipsoid', at: [0.3, -0.1, 0.1], size: [0.5, 0.82, 1.0], color: '#f08a2c' },
        {
          shape: 'capsule',
          at: [0, 0.38, 0.1],
          size: [0.12, 0.26, 0.12],
          turn: [0, 0, 12],
          color: '#6a9a5a',
        },
      ],
    },
  },
  {
    id: 'bat-clip',
    name: 'Bat Clip',
    description: 'A tiny bat that hangs out in your hair.',
    slot: 'hair-accessory',
    rarity: 'common',
    season: 'halloween',
    sources: ['found'],
    tradable: true,
    visual: {
      pieces: [
        { shape: 'ellipsoid', at: [0, 0, 0], size: [0.4, 0.42, 0.34], color: '#4a3557' },
        {
          shape: 'teardrop',
          at: [-0.4, 0.05, 0],
          size: [0.45, 0.65, 0.12],
          turn: [0, 0, 70],
          color: '#4a3557',
        },
        {
          shape: 'teardrop',
          at: [0.4, 0.05, 0],
          size: [0.45, 0.65, 0.12],
          turn: [0, 0, -70],
          color: '#4a3557',
        },
      ],
    },
  },
  {
    id: 'candy-corn-clip',
    name: 'Candy Corn Clip',
    description: 'Looks yummy. Please do not eat it.',
    slot: 'hair-accessory',
    rarity: 'common',
    season: 'halloween',
    sources: ['found'],
    tradable: true,
    visual: {
      pieces: [
        { shape: 'cone', at: [0, 0.05, 0], size: [0.6, 0.85, 0.3], color: '#ffffff' },
        { shape: 'cone', at: [0, -0.1, 0], size: [0.66, 0.55, 0.32], color: '#ffa552' },
        { shape: 'ellipsoid', at: [0, -0.32, 0], size: [0.62, 0.24, 0.32], color: '#ffd84d' },
      ],
    },
  },
  {
    id: 'moonlit-sweater',
    name: 'Moonlit Sweater',
    description: 'Midnight blue, with a smiling moon.',
    slot: 'top',
    rarity: 'uncommon',
    season: 'halloween',
    sources: ['found'],
    tradable: true,
    visual: {
      pieces: [
        { shape: 'ellipsoid', at: [0, 0.02, 0], size: [1.1, 1.08, 1.1], color: '#3f4f8c' },
        { shape: 'ellipsoid', at: [0, 0.08, -0.54], size: [0.36, 0.36, 0.08], color: '#fff4c2' },
        { shape: 'ellipsoid', at: [0.07, 0.1, -0.58], size: [0.26, 0.3, 0.06], color: '#3f4f8c' },
      ],
    },
  },
  {
    id: 'pumpkin-bloomers',
    name: 'Pumpkin Bloomers',
    description: 'Round, orange and extremely puffy.',
    slot: 'bottom',
    rarity: 'uncommon',
    season: 'halloween',
    sources: ['found'],
    tradable: true,
    visual: {
      pieces: [
        { shape: 'ellipsoid', at: [0, -0.05, 0], size: [1.35, 0.95, 1.3], color: '#ff9a3c' },
        { shape: 'ellipsoid', at: [0, 0.32, 0], size: [1.08, 0.2, 1.08], color: '#6a9a5a' },
      ],
    },
  },
  {
    id: 'curly-witch-boots',
    name: 'Curly Witch Boots',
    description: 'The toes curl up when you giggle.',
    slot: 'shoes',
    rarity: 'rare',
    season: 'halloween',
    sources: ['found'],
    tradable: true,
    visual: {
      pieces: [
        { shape: 'ellipsoid', at: [0, 0.08, 0.05], size: [1.12, 1.15, 1.0], color: '#4a3557' },
        {
          shape: 'cone',
          at: [0, 0.3, -0.62],
          size: [0.5, 0.7, 0.5],
          turn: [-70, 0, 0],
          color: '#4a3557',
        },
        { shape: 'capsule', at: [0, 0.75, 0.1], size: [0.85, 0.9, 0.75], color: '#6b4a7a' },
        { shape: 'ellipsoid', at: [0, 0.32, -0.5], size: [0.2, 0.2, 0.12], color: '#ffd84d' },
      ],
    },
  },
  {
    id: 'ghost-cape',
    name: 'Ghost Cape',
    description: 'Swooshy and see-through. Well, almost.',
    slot: 'back',
    rarity: 'rare',
    season: 'halloween',
    sources: ['found'],
    tradable: true,
    visual: {
      pieces: [
        {
          shape: 'teardrop',
          at: [0, -0.4, 0.5],
          size: [1.3, 1.8, 0.2],
          turn: [0, 0, 180],
          color: '#f8f4ff',
        },
        { shape: 'ellipsoid', at: [0, 0.42, 0], size: [1.1, 0.2, 1.1], color: '#f8f4ff' },
        { shape: 'ellipsoid', at: [0, 0.42, -0.55], size: [0.18, 0.18, 0.12], color: '#b39ddb' },
      ],
    },
  },
  {
    id: 'bat-wings',
    name: 'Bat Wings',
    description: 'Flap flap! Upside-down naps not included.',
    slot: 'back',
    rarity: 'epic',
    season: 'halloween',
    sources: ['found'],
    tradable: true,
    visual: {
      pieces: [
        {
          shape: 'teardrop',
          at: [-0.7, 0.2, 0.6],
          size: [0.8, 1.3, 0.08],
          turn: [0, -15, 60],
          color: '#4a3557',
        },
        {
          shape: 'teardrop',
          at: [0.7, 0.2, 0.6],
          size: [0.8, 1.3, 0.08],
          turn: [0, 15, -60],
          color: '#4a3557',
        },
        { shape: 'ellipsoid', at: [0, 0.1, 0.55], size: [0.3, 0.4, 0.2], color: '#4a3557' },
      ],
    },
  },
  {
    id: 'jack-o-lamp',
    name: "Jack-o'-Lamp",
    description: 'A pumpkin with a cheeky grin and a cozy glow.',
    slot: 'held',
    rarity: 'uncommon',
    season: 'halloween',
    sources: ['found'],
    tradable: true,
    visual: {
      pieces: [
        { shape: 'capsule', at: [0, 0.45, 0], size: [0.1, 0.4, 0.1], color: '#6b4430' },
        { shape: 'ellipsoid', at: [0, -0.02, 0], size: [0.62, 0.52, 0.6], color: '#ff9a3c' },
        { shape: 'ellipsoid', at: [-0.1, 0.04, -0.29], size: [0.1, 0.1, 0.05], color: '#ffe48a' },
        { shape: 'ellipsoid', at: [0.1, 0.04, -0.29], size: [0.1, 0.1, 0.05], color: '#ffe48a' },
        {
          shape: 'arc',
          at: [0, -0.1, -0.3],
          size: [0.26, 0.1, 0.05],
          turn: [0, 180, 0],
          color: '#ffe48a',
        },
      ],
    },
  },
  {
    id: 'tiny-broom',
    name: 'Tiny Broom',
    description: 'Too small to ride. Perfect for sweeping up crumbs.',
    slot: 'held',
    rarity: 'rare',
    season: 'halloween',
    sources: ['found'],
    tradable: true,
    visual: {
      pieces: [
        { shape: 'capsule', at: [0, 0.4, 0], size: [0.1, 1.3, 0.1], color: '#a0703f' },
        { shape: 'cone', at: [0, -0.35, 0], size: [0.45, 0.5, 0.45], color: '#e8c068' },
        { shape: 'capsule', at: [0, -0.12, 0], size: [0.24, 0.08, 0.24], color: '#6b4a7a' },
      ],
    },
  },
  {
    id: 'ghost-sheet',
    name: 'Ghost Sheet',
    description: 'A friendly ghost who mostly says "boo" and giggles.',
    slot: 'costume',
    rarity: 'rare',
    season: 'halloween',
    sources: ['found'],
    tradable: true,
    visual: {
      pieces: [
        { shape: 'teardrop', at: [0, 0.02, 0], size: [1.2, 1.12, 1.2], color: '#f8f4ff' },
        // A dome over the head, so the sheet hides the face.
        { shape: 'ellipsoid', at: [0, 0.2, 0], size: [1.12, 0.66, 1.34], color: '#f8f4ff' },
        { shape: 'ellipsoid', at: [-0.14, 0.24, -0.66], size: [0.1, 0.13, 0.05], color: '#3b2a3f' },
        { shape: 'ellipsoid', at: [0.14, 0.24, -0.66], size: [0.1, 0.13, 0.05], color: '#3b2a3f' },
        { shape: 'ellipsoid', at: [0, 0.12, -0.66], size: [0.08, 0.08, 0.04], color: '#ff9db5' },
      ],
    },
  },
  {
    id: 'squishy-onesie',
    name: 'Squishy Onesie',
    description: 'Dress up as your favourite squishy, ears and all.',
    slot: 'costume',
    rarity: 'legendary',
    season: 'halloween',
    sources: ['found'],
    tradable: true,
    visual: {
      pieces: [
        { shape: 'ellipsoid', at: [0, -0.2, 0], size: [0.95, 0.66, 1.0], color: '#a8e6cf' },
        { shape: 'ellipsoid', at: [0, 0.22, 0.12], size: [1.0, 0.6, 0.9], color: '#a8e6cf' },
        {
          shape: 'teardrop',
          at: [-0.3, 0.52, 0.1],
          size: [0.24, 0.3, 0.16],
          turn: [0, 0, 20],
          color: '#a8e6cf',
        },
        {
          shape: 'teardrop',
          at: [0.3, 0.52, 0.1],
          size: [0.24, 0.3, 0.16],
          turn: [0, 0, -20],
          color: '#a8e6cf',
        },
        { shape: 'ellipsoid', at: [0, -0.18, -0.5], size: [0.5, 0.4, 0.06], color: '#fff6e0' },
      ],
    },
  },
];

// ── Squishy accessories (one per squishy) ────────────────────────────────
// Pieces are in the squishy's body sizes, from its crown (top of the head) or
// neck. They're drawn on squishies when the close-up view arrives.
const SQUISHY: ClothingItem[] = [
  {
    id: 'tiny-bow',
    name: 'Tiny Bow',
    description: 'A teeny bow for a teeny friend.',
    slot: 'squishy',
    rarity: 'common',
    sources: ['starter'],
    tradable: false,
    visual: {
      anchor: 'crown',
      pieces: [
        {
          shape: 'teardrop',
          at: [-0.1, 0.02, 0],
          size: [0.16, 0.2, 0.1],
          turn: [0, 0, 90],
          color: '#ff6f91',
        },
        {
          shape: 'teardrop',
          at: [0.1, 0.02, 0],
          size: [0.16, 0.2, 0.1],
          turn: [0, 0, -90],
          color: '#ff6f91',
        },
        { shape: 'ellipsoid', at: [0, 0.02, 0], size: [0.08, 0.08, 0.08], color: '#e24f78' },
      ],
    },
  },
  {
    id: 'snuggle-scarf',
    name: 'Snuggle Scarf',
    description: 'Keeps little necks toasty.',
    slot: 'squishy',
    rarity: 'common',
    sources: ['found'],
    tradable: true,
    visual: {
      anchor: 'neck',
      pieces: [
        { shape: 'ellipsoid', at: [0, 0, 0], size: [0.85, 0.16, 0.85], color: '#ff8fab' },
        { shape: 'capsule', at: [0.18, -0.12, -0.38], size: [0.12, 0.26, 0.06], color: '#ff8fab' },
      ],
    },
  },
  {
    id: 'tiny-top-hat',
    name: 'Tiny Top Hat',
    description: 'Very fancy. Very tiny. Very proud.',
    slot: 'squishy',
    rarity: 'uncommon',
    sources: ['found'],
    tradable: true,
    visual: {
      anchor: 'crown',
      pieces: [
        { shape: 'ellipsoid', at: [0, 0, 0], size: [0.36, 0.04, 0.36], color: '#3b2a3f' },
        { shape: 'capsule', at: [0, 0.12, 0], size: [0.22, 0.24, 0.22], color: '#3b2a3f' },
        { shape: 'capsule', at: [0, 0.05, 0], size: [0.23, 0.05, 0.23], color: '#ff6f91' },
      ],
    },
  },
  {
    id: 'tiny-crown',
    name: 'Tiny Crown',
    description: 'For the bravest, snuggliest squishy around.',
    slot: 'squishy',
    rarity: 'epic',
    sources: ['found'],
    tradable: true,
    visual: {
      anchor: 'crown',
      pieces: [
        { shape: 'capsule', at: [0, 0.04, 0], size: [0.26, 0.08, 0.26], color: '#ffd84d' },
        { shape: 'cone', at: [0, 0.12, -0.1], size: [0.07, 0.12, 0.07], color: '#ffd84d' },
        { shape: 'cone', at: [-0.09, 0.11, 0.05], size: [0.06, 0.1, 0.06], color: '#ffd84d' },
        { shape: 'cone', at: [0.09, 0.11, 0.05], size: [0.06, 0.1, 0.06], color: '#ffd84d' },
      ],
    },
  },
  {
    id: 'tiny-witch-hat',
    name: 'Tiny Witch Hat',
    description: 'Makes any squishy look extra magical.',
    slot: 'squishy',
    rarity: 'rare',
    season: 'halloween',
    sources: ['found'],
    tradable: true,
    visual: {
      anchor: 'crown',
      pieces: [
        { shape: 'ellipsoid', at: [0, 0, 0], size: [0.42, 0.04, 0.42], color: '#6b4a7a' },
        {
          shape: 'cone',
          at: [0, 0.14, 0],
          size: [0.22, 0.3, 0.22],
          turn: [0, 0, 8],
          color: '#6b4a7a',
        },
      ],
    },
  },
  {
    id: 'pumpkin-cap',
    name: 'Pumpkin Cap',
    description: 'A snug little pumpkin with a curly stem.',
    slot: 'squishy',
    rarity: 'uncommon',
    season: 'halloween',
    sources: ['found'],
    tradable: true,
    visual: {
      anchor: 'crown',
      pieces: [
        { shape: 'ellipsoid', at: [0, 0.03, 0], size: [0.34, 0.18, 0.34], color: '#ff9a3c' },
        { shape: 'capsule', at: [0, 0.14, 0], size: [0.05, 0.1, 0.05], color: '#6a9a5a' },
      ],
    },
  },
];

/** Every clothing item, checked by `checkClothingData` in tests. */
export const CLOTHING: ClothingItem[] = [...STARTER, ...EVERYDAY, ...HALLOWEEN, ...SQUISHY];

/** The catalog by id. */
export const CLOTHING_BY_ID: ReadonlyMap<string, ClothingItem> = new Map(
  CLOTHING.map((item) => [item.id, item]),
);

/** Every account's items from the start (design doc §23: the wardrobe is never empty). */
export const STARTER_CLOTHING: readonly string[] = CLOTHING.filter((item) =>
  item.sources.includes('starter'),
).map((item) => item.id);
