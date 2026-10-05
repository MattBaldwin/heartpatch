import { hexDistance, hexRing, hexToWorld, type Hex } from '../../hex/index.js';
import type {
  CinematicActorKey,
  CinematicInput,
  CinematicMoodKey,
} from '../../schemas/data/cinematic.js';

// "The Great Scatter" (design doc §25): the opening cinematic every new
// player sees once, right after picking their Keeper and before the
// tutorial. Nine shots, about 132 seconds: wonder first, a spooky-tense
// middle (he pulls the joy out of the squishies and the Heartpatch breaks),
// then hope, and "Your part": plant, claim land, care, befriend. Every number
// is a first guess to judge on the playtest devices (`// TUNE:`); captions
// follow style guide §2 and §6.
//
// The camera looks towards +z (the default camera stands at −z), so "behind"
// a place is +z and a face turned to the camera has yaw 0.

/** World hex size (the map's is 0.65): roomy tiles, so squishies read at a distance. */
const HEX = 1.3; // TUNE

const place = (q: number, r: number): { x: number; z: number } => hexToWorld({ q, r }, HEX);

/** Places in the world (hex coords), shared by the regions and the actors. */
const HEART = place(0, 0);
const FOREST = place(2, -4);
const PUMPKINS = place(-7, 0);
const AUTUMN = place(-9, 4);
const SNOW = place(-5, -4);
const MEADOW = place(7, 0);
const LAKE = place(9, -2);
const HOME = place(-4, 8);

/** Squishy, Keeper and Heart Seed sizes in this world. */
const SQ = 0.45; // TUNE
const KEEPER = 0.42; // TUNE
const HOLLOW = 1.6; // TUNE: tall and thin, about four Keepers; never towering over the camera

type Key = CinematicActorKey;
type Actor = NonNullable<CinematicInput['shots'][number]['actors']>[number];

/** A squishy that pops up out of the ground at `t` and stays until `until`. */
function bloom(
  id: string,
  species: string,
  x: number,
  z: number,
  t: number,
  until: number,
  yaw = 0,
): Actor {
  return {
    id,
    kind: 'squishy',
    species,
    path: [
      { at: t, x, z, y: -0.35, scale: 0, yaw },
      { at: t + 0.6, x, z, scale: SQ, yaw },
      { at: until, x, z, scale: SQ, yaw },
    ],
    moves: [{ at: t + 0.6, move: 'bounce' }],
  };
}

/** A squishy that's just there for the whole span. */
function stay(
  id: string,
  species: string,
  x: number,
  z: number,
  from: number,
  until: number,
  extra: Partial<Actor> = {},
): Actor {
  return {
    id,
    kind: 'squishy',
    species,
    path: [
      { at: from, x, z, scale: SQ },
      { at: until, x, z, scale: SQ },
    ],
    ...extra,
  };
}

const mood = (at: number, drain: number, night: number, glow: number): CinematicMoodKey => ({
  at,
  drain,
  night,
  glow,
});

/** The Heartpatch's own squishies: they bloom in shot 1, huddle in shot 4, scatter in shot 5. */
const PATCH = [
  { id: 'pp-puddle', species: 'puddlepuff', dx: -1.7, dz: -0.9, t: 4.0 },
  { id: 'pp-ember', species: 'emberbun', dx: 1.5, dz: -1.1, t: 4.9 },
  { id: 'pp-thistle', species: 'thistlepip', dx: -0.5, dz: -1.9, t: 5.8 },
  { id: 'pp-fuzz', species: 'fuzzbolt', dx: 2.2, dz: 0.5, t: 6.6 },
  { id: 'pp-fizzle', species: 'fizzlepop', dx: -2.3, dz: 0.7, t: 7.3 },
  { id: 'pp-bubble', species: 'bubbletub', dx: 0.6, dz: 1.9, t: 8.0 },
  { id: 'pp-glimmer', species: 'glimmerock', dx: 0.9, dz: -1.6, t: 8.7 },
  { id: 'pp-dawn', species: 'dawndrop', dx: -1.1, dz: 1.6, t: 9.4 },
  { id: 'pp-pebble', species: 'pebblesnooze', dx: 1.8, dz: 1.4, t: 10.1 },
] as const;

/** Where each squishy tumbles to in the Scatter (shot 5): out of frame, every which way. */
const TUMBLE: Readonly<Record<string, readonly [number, number]>> = {
  'pp-puddle': [-7, -4],
  'pp-ember': [7, -5],
  'pp-thistle': [-2, -8],
  'pp-fuzz': [8, 2],
  'pp-fizzle': [-8, 1],
  'pp-bubble': [3, -7],
  'pp-glimmer': [5, -8],
  'pp-dawn': [-5, -7],
  'pp-pebble': [6, 6],
};

/** The few taken to the Hollow in the Scatter: grey, drifting off into the trees. */
const TAKEN = new Set(['pp-bubble', 'pp-dawn', 'pp-pebble']);

/** The Heartpatch's glowing heart, a big Heart Seed in the middle of the field. */
const HEART_SCALE = 2.4; // TUNE

// ── Shot 1: The Heartpatch ──────────────────────────────────────────────
const shot1: CinematicInput['shots'][number] = {
  id: 'heartpatch',
  title: 'The Heartpatch',
  duration: 15,
  transition: 'cut',
  music: 'wonder',
  camera: [
    { at: 0, position: [-15, 10, -22], target: [0, 0, 0], fov: 0.75 },
    { at: 7, position: [5.5, 5.2, -12], target: [0, 0.4, 0.5] },
    { at: 15, position: [2.4, 2.5, -6], target: [0, 0.4, 0.3] },
  ],
  mood: [mood(0, 0, 0, 1)],
  captions: [
    { at: 1.2, until: 6.6, text: 'Long ago, every squishy was born in the Heartpatch.' },
    { at: 7.4, until: 14.4, text: "It was a glowing field where the world's joy took shape." },
  ],
  cues: [
    ...PATCH.map((p) => ({ at: p.t + 0.3, cue: 'bloom' })),
    { at: 6.2, cue: 'giggle' },
    { at: 9.0, cue: 'giggle' },
  ].sort((a, b) => a.at - b.at),
  actors: [
    {
      id: 'heart',
      kind: 'heart-seed',
      path: [
        { at: 0, ...HEART, y: 0.35, scale: HEART_SCALE, glow: 0.8 },
        { at: 15, ...HEART, y: 0.35, scale: HEART_SCALE, glow: 1 },
      ],
    },
    ...PATCH.map((p) => bloom(p.id, p.species, HEART.x + p.dx, HEART.z + p.dz, p.t, 15)),
  ],
};

// ── Shot 2: Seasons of joy ──────────────────────────────────────────────
const shot2: CinematicInput['shots'][number] = {
  id: 'seasons',
  title: 'Seasons of joy',
  duration: 14,
  transition: 'dissolve',
  music: 'wonder',
  camera: [
    { at: 0, position: [PUMPKINS.x - 1.0, 2.9, PUMPKINS.z - 5.6], target: [PUMPKINS.x, 0.2, 0] },
    { at: 4.7, position: [PUMPKINS.x + 0.6, 2.6, PUMPKINS.z - 5.0], target: [PUMPKINS.x, 0.2, 0] },
    {
      at: 4.7,
      cut: true,
      position: [AUTUMN.x + 1.0, 2.9, AUTUMN.z - 5.6],
      target: [AUTUMN.x, 0.2, AUTUMN.z],
    },
    { at: 9.4, position: [AUTUMN.x - 0.5, 2.6, AUTUMN.z - 5.0], target: [AUTUMN.x, 0.2, AUTUMN.z] },
    {
      at: 9.4,
      cut: true,
      position: [SNOW.x - 0.8, 3.0, SNOW.z - 5.6],
      target: [SNOW.x, 0.3, SNOW.z],
    },
    { at: 14, position: [SNOW.x + 0.6, 2.7, SNOW.z - 5.0], target: [SNOW.x, 0.3, SNOW.z] },
  ],
  mood: [mood(0, 0, 0.15, 1)],
  dissolves: [4.7, 9.4],
  captions: [
    { at: 0.8, until: 6.6, text: 'When the world celebrated, the magic surged…' },
    { at: 7.2, until: 13.6, text: '…and new squishies bloomed with every season!' },
  ],
  cues: [
    { at: 1.3, cue: 'bloom' },
    { at: 2.1, cue: 'bloom' },
    { at: 2.9, cue: 'bloom' },
    { at: 6.0, cue: 'bloom' },
    { at: 6.8, cue: 'bloom' },
    { at: 10.7, cue: 'bloom' },
    { at: 11.5, cue: 'bloom' },
  ],
  actors: [
    // Pumpkins glowing, and spooky squishies popping up.
    bloom('s-gourdon', 'gourdon', PUMPKINS.x - 0.45, PUMPKINS.z - 1.0, 1.0, 4.7),
    bloom('s-glowboo', 'glowboo', PUMPKINS.x + 0.45, PUMPKINS.z - 0.6, 1.8, 4.7),
    bloom('s-upsybat', 'upsybat', PUMPKINS.x, PUMPKINS.z + 0.2, 2.6, 4.7),
    // Leaf piles with cozy squishies.
    bloom('s-mossmuffin', 'mossmuffin', AUTUMN.x - 0.4, AUTUMN.z - 0.8, 5.7, 9.4),
    bloom('s-snugglenook', 'snugglenook', AUTUMN.x + 0.45, AUTUMN.z - 0.3, 6.5, 9.4),
    // Snowfall and frosty squishies.
    bloom('s-flurrypup', 'flurrypup', SNOW.x - 0.4, SNOW.z - 0.8, 10.4, 14),
    bloom('s-snoozicle', 'snoozicle', SNOW.x + 0.45, SNOW.z - 0.3, 11.2, 14),
  ],
};

// ── Shot 3: The Keepers of old ──────────────────────────────────────────
const FIRE_A = { x: MEADOW.x - 1.5, z: MEADOW.z + 0.7 };
const FIRE_B = { x: MEADOW.x + 1.7, z: MEADOW.z + 0.3 };
const EVOLVE = { x: MEADOW.x + 0.2, z: MEADOW.z - 0.7 };

const shot3: CinematicInput['shots'][number] = {
  id: 'keepers-of-old',
  title: 'The Keepers of old',
  duration: 16,
  transition: 'dissolve',
  music: 'wonder',
  camera: [
    { at: 0, position: [MEADOW.x - 4.6, 3.3, MEADOW.z - 7], target: [MEADOW.x, 0.3, 0] },
    { at: 16, position: [MEADOW.x + 1.0, 2.0, MEADOW.z - 4.6], target: [MEADOW.x + 0.3, 0.4, 0] },
  ],
  mood: [mood(0, 0, 0.2, 1)],
  captions: [
    { at: 1.0, until: 7.2, text: 'Keepers tended the fires and cared for the squishies.' },
    { at: 8.0, until: 15.4, text: 'Loved squishies grew… and changed into something wonderful!' },
  ],
  cues: [
    { at: 3.2, cue: 'twinkle' },
    { at: 5.4, cue: 'giggle' },
    { at: 9.6, cue: 'evolve' },
    { at: 12.6, cue: 'squeak' },
  ],
  actors: [
    {
      id: 'fire-a',
      kind: 'hearthfire',
      path: [
        { at: 0, ...FIRE_A },
        { at: 16, ...FIRE_A },
      ],
    },
    {
      id: 'fire-b',
      kind: 'hearthfire',
      path: [
        { at: 0, ...FIRE_B },
        { at: 16, ...FIRE_B },
      ],
    },
    {
      id: 'keeper-maple',
      kind: 'keeper',
      keeperBase: 'maple',
      path: [
        { at: 0, x: FIRE_A.x + 0.7, z: FIRE_A.z - 0.4, scale: KEEPER, yaw: 0.5 },
        { at: 16, x: FIRE_A.x + 0.7, z: FIRE_A.z - 0.4, scale: KEEPER, yaw: 0.5 },
      ],
      moves: [{ at: 3.0, move: 'bounce' }],
    },
    {
      id: 'keeper-hazel',
      kind: 'keeper',
      keeperBase: 'hazel',
      path: [
        { at: 0, x: FIRE_B.x - 0.6, z: FIRE_B.z - 0.6, scale: KEEPER, yaw: -0.4 },
        { at: 16, x: FIRE_B.x - 0.6, z: FIRE_B.z - 0.6, scale: KEEPER, yaw: -0.4 },
      ],
      moves: [{ at: 10.0, move: 'bounce' }],
    },
    {
      id: 'keeper-moss',
      kind: 'keeper',
      keeperBase: 'moss',
      path: [
        { at: 0, x: LAKE.x - 1.6, z: LAKE.z - 1.2, scale: KEEPER, yaw: -0.8 },
        { at: 16, x: LAKE.x - 1.6, z: LAKE.z - 1.2, scale: KEEPER, yaw: -0.8 },
      ],
    },
    // Playing: a hop, a chase round the fire.
    stay('k-emberbun', 'emberbun', FIRE_A.x + 0.2, FIRE_A.z - 0.9, 0, 16, {
      moves: [
        { at: 2.4, move: 'bounce' },
        { at: 5.2, move: 'bounce' },
        { at: 12.4, move: 'bounce' },
      ],
    }),
    {
      id: 'k-fuzzbolt',
      kind: 'squishy',
      species: 'fuzzbolt',
      path: [
        { at: 0, x: FIRE_B.x + 0.8, z: FIRE_B.z - 0.9, scale: SQ, yaw: -1.2 },
        { at: 5, x: FIRE_B.x - 0.2, z: FIRE_B.z - 1.4, scale: SQ, yaw: -0.4 },
        { at: 10, x: FIRE_B.x + 0.9, z: FIRE_B.z - 1.2, scale: SQ, yaw: 1.0 },
        { at: 16, x: FIRE_B.x + 0.6, z: FIRE_B.z - 0.8, scale: SQ, yaw: 0 },
      ],
      moves: [{ at: 5.1, move: 'jiggle' }],
    },
    // Napping by the fire.
    stay('k-pebblesnooze', 'pebblesnooze', FIRE_A.x - 0.8, FIRE_A.z - 0.6, 0, 16),
    // Growing into something bigger and sparklier.
    {
      id: 'k-puddlepuff',
      kind: 'squishy',
      species: 'puddlepuff',
      path: [
        { at: 0, ...EVOLVE, scale: SQ },
        { at: 8.6, ...EVOLVE, scale: SQ },
        { at: 9.4, ...EVOLVE, scale: SQ * 1.25 },
        { at: 9.6, ...EVOLVE, scale: 0 },
      ],
      moves: [{ at: 8.4, move: 'jiggle' }],
    },
    {
      id: 'k-splashmallow',
      kind: 'squishy',
      species: 'splashmallow',
      path: [
        { at: 9.4, ...EVOLVE, scale: 0 },
        { at: 10.2, ...EVOLVE, scale: SQ * 1.3 },
        { at: 16, ...EVOLVE, scale: SQ * 1.3 },
      ],
      moves: [{ at: 10.2, move: 'bounce' }],
    },
  ],
};

// ── Shot 4: The Hollow Man ──────────────────────────────────────────────
/** Where he steps out of the trees: the forest's near edge, a little off-centre. */
const EDGE = { x: FOREST.x + 0.8, z: FOREST.z - 2.6 };

const shot4: CinematicInput['shots'][number] = {
  id: 'hollow-man',
  title: 'The Hollow Man',
  duration: 14,
  transition: 'cut',
  music: 'none',
  camera: [
    { at: 0, position: [1.7, 2.5, -5.6], target: [0.3, 0.8, 2.6] },
    { at: 14, position: [1.4, 2.2, -4.8], target: [0.4, 1.0, 3.6] },
  ],
  // Colour drains from the edges of the frame, and the light dims (style
  // guide §5: spooky through absence).
  mood: [mood(0, 0, 0.5, 1), mood(2.5, 0.15, 0.6, 1), mood(9, 0.65, 0.75, 0.85)],
  captions: [
    { at: 1.5, until: 7.0, text: 'But one night, something hollow came.' },
    { at: 7.6, until: 13.6, text: 'He had no joy of his own… so he wanted ours.' },
  ],
  cues: [
    { at: 2.8, cue: 'nightfall' },
    { at: 8.2, cue: 'nightfall' },
  ],
  actors: [
    {
      id: 'heart',
      kind: 'heart-seed',
      path: [
        { at: 0, ...HEART, y: 0.35, scale: HEART_SCALE, glow: 1 },
        { at: 14, ...HEART, y: 0.35, scale: HEART_SCALE, glow: 0.8 },
      ],
    },
    {
      // He fades in at the trees' edge, flickers like a candle, and stands
      // still. He never rushes at the camera, never speaks.
      id: 'hollow',
      kind: 'hollow-man',
      path: [
        { at: 3.0, ...EDGE, z: EDGE.z + 0.6, scale: HOLLOW, alpha: 0 },
        { at: 5.6, ...EDGE, scale: HOLLOW, alpha: 1 },
        { at: 6.1, ...EDGE, scale: HOLLOW, alpha: 0.45, flash: true },
        { at: 6.4, ...EDGE, scale: HOLLOW, alpha: 1, flash: true },
        { at: 10.6, ...EDGE, z: EDGE.z - 0.3, scale: HOLLOW, alpha: 1 },
        { at: 11.0, ...EDGE, z: EDGE.z - 0.3, scale: HOLLOW, alpha: 0.5, flash: true },
        { at: 11.3, ...EDGE, z: EDGE.z - 0.3, scale: HOLLOW, alpha: 1, flash: true },
        // His long arms start to lift: he's seen the glow.
        { at: 12, ...EDGE, z: EDGE.z - 0.35, scale: HOLLOW, alpha: 1, reach: 0 },
        { at: 14, ...EDGE, z: EDGE.z - 0.4, scale: HOLLOW, alpha: 1, reach: 0.25 },
      ],
    },
    // The squishies huddle together, towards the light.
    ...PATCH.map((p): Actor => ({
      id: p.id,
      kind: 'squishy',
      species: p.species,
      path: [
        { at: 0, x: HEART.x + p.dx, z: HEART.z + p.dz, scale: SQ },
        { at: 6.0, x: HEART.x + p.dx, z: HEART.z + p.dz, scale: SQ },
        { at: 8.0, x: HEART.x + p.dx * 0.75, z: HEART.z + p.dz * 0.6 - 0.5, scale: SQ },
        { at: 14, x: HEART.x + p.dx * 0.75, z: HEART.z + p.dz * 0.6 - 0.5, scale: SQ },
      ],
      moves: [{ at: 6.2 + (p.t % 1), move: 'jiggle' }],
    })),
  ],
};

// ── Shot 5: The Great Scatter ───────────────────────────────────────────
// How he did it (owner decision 2026-10-04, "spooky-tense"): he glides to the
// glow and reaches out with his long arms, and the joy drifts out of every
// squishy into his hands as little warm lights. His eyes flare, a low rumble,
// the Heartpatch breaks with a short shake, and a cold wind blows the lights
// and the squishies away across the land. No one is hurt; all are rescuable.
const SHATTER = 6.5; // TUNE: the moment the Heartpatch breaks
/** Where he stands as it breaks: close to the glow, never close to the camera. */
const REACHED = { x: EDGE.x * 0.4, z: HEART.z + 1.8 };
/** Between his hands as he reaches (he turns to the camera, which is towards −z). */
const HANDS = { x: REACHED.x, y: 1.15, z: REACHED.z - 1.0 }; // TUNE
/** A squishy's joy, as a little light. */
const JOY = 0.22; // TUNE

/** A Heartpatch squishy tumbling away (or, for the taken few, turning grey and drifting off). */
function scatter(p: (typeof PATCH)[number]): Actor[] {
  const from = { x: HEART.x + p.dx * 0.75, z: HEART.z + p.dz * 0.6 - 0.5 };
  const [tx, tz] = TUMBLE[p.id] ?? [0, -8];
  const lift = 1.6 + (p.t % 1); // TUNE: how high each one tumbles
  const hold: Key[] = [
    { at: 0, ...from, scale: SQ },
    { at: SHATTER + 0.2, ...from, scale: SQ },
  ];
  if (!TAKEN.has(p.id)) {
    const mid = { x: from.x + (tx - from.x) * 0.5, z: from.z + (tz - from.z) * 0.5 };
    return [
      {
        id: p.id,
        kind: 'squishy',
        species: p.species,
        path: [
          ...hold,
          { at: SHATTER + 1.2, ...mid, y: lift, scale: SQ, yaw: 1.5 },
          { at: SHATTER + 2.2, x: tx, z: tz, scale: SQ, yaw: 3.0 },
          { at: 17, x: tx, z: tz, scale: SQ, yaw: 3.0 },
        ],
        moves: [
          { at: 2.4 + (p.t % 1), move: 'jiggle' },
          { at: SHATTER + 2.2, move: 'wobble' },
        ],
      },
    ];
  }
  // Grey, then drifting gently into the trees' shadows (never hurt: always rescuable).
  const grey = SHATTER + 1.0;
  return [
    {
      id: p.id,
      kind: 'squishy',
      species: p.species,
      path: [...hold, { at: grey, ...from, scale: SQ }],
      moves: [
        { at: 2.4 + (p.t % 1), move: 'jiggle' },
        { at: SHATTER + 0.3, move: 'jiggle' },
      ],
    },
    {
      id: `${p.id}-grey`,
      kind: 'squishy',
      species: p.species,
      shadow: true,
      path: [
        { at: grey, ...from, scale: SQ },
        { at: grey + 4, x: from.x * 0.6 + EDGE.x * 0.4, z: EDGE.z - 0.6, y: 0.3, scale: SQ },
        { at: grey + 7, x: EDGE.x * 0.8, z: EDGE.z + 1.2, y: 0.5, scale: 0 },
      ],
    },
  ];
}

/**
 * A squishy's joy, pulled out into his hands as a little warm light, then
 * blown away on the cold wind the way that squishy tumbles.
 */
function joyOf(p: (typeof PATCH)[number], i: number): Actor {
  const from = { x: HEART.x + p.dx * 0.75, z: HEART.z + p.dz * 0.6 - 0.5 };
  const [tx, tz] = TUMBLE[p.id] ?? [0, -8];
  const leaves = 1.8 + i * 0.28; // TUNE: one after another
  const swirl = (i - (PATCH.length - 1) / 2) * 0.09; // a little cloud between his hands
  return {
    id: `${p.id}-joy`,
    kind: 'joy',
    path: [
      { at: leaves, ...from, y: 0.3, scale: 0, glow: 1 },
      { at: leaves + 0.5, ...from, y: 0.6, scale: JOY, glow: 1 },
      { at: 5.4, x: HANDS.x + swirl, y: HANDS.y + Math.abs(swirl) * 0.6, z: HANDS.z, scale: JOY },
      { at: SHATTER, x: HANDS.x + swirl * 0.6, y: HANDS.y, z: HANDS.z, scale: JOY * 1.1 },
      // The cold wind: up and away, every which way.
      {
        at: SHATTER + 1.4,
        x: HANDS.x + (tx - HANDS.x) * 0.5,
        y: 2.6,
        z: HANDS.z + (tz - HANDS.z) * 0.5,
        scale: JOY,
        glow: 0.8,
      },
      { at: SHATTER + 3.2, x: tx * 1.4, y: 3.4, z: tz * 1.4, scale: JOY * 0.6, glow: 0 },
    ],
  };
}

const shot5: CinematicInput['shots'][number] = {
  id: 'great-scatter',
  title: 'The Great Scatter',
  duration: 17,
  transition: 'cut',
  music: 'none',
  camera: [
    { at: 0, position: [1.4, 2.6, -6.0], target: [0.3, 0.9, 2.4] },
    { at: SHATTER - 0.5, position: [1.0, 3.0, -7.0], target: [0.1, 0.9, 0.8] },
    { at: 17, position: [0, 7.0, -11], target: [0, 3.0, 3.5] },
  ],
  mood: [
    mood(0, 0.65, 0.75, 0.85),
    mood(SHATTER, 0.75, 0.75, 1),
    mood(SHATTER + 1.5, 0.85, 0.8, 0),
  ],
  captions: [
    { at: 1.0, until: 6.0, text: 'He pulled the joy right out of them…' },
    { at: 6.8, until: 11.6, text: 'The Heartpatch shattered, and its Heart Seeds scattered.' },
    { at: 12.0, until: 16.9, text: 'A cold wind blew the squishies across the land.' },
  ],
  cues: [
    { at: 1.4, cue: 'nightfall' },
    { at: 5.0, cue: 'hollow-sting' },
    { at: SHATTER, cue: 'shatter' },
    { at: SHATTER + 0.3, cue: 'cold-wind' },
    { at: SHATTER + 1.4, cue: 'whoosh' },
    { at: SHATTER + 2.3, cue: 'boop' },
  ],
  // A short shake as it breaks (none for reduced motion).
  shakes: [{ at: SHATTER, seconds: 0.7, strength: 0.07 }], // TUNE
  actors: [
    {
      // He glides to the glow (never towards the player), reaches out with
      // his long arms, his eyes flare as it breaks, and he fades.
      id: 'hollow',
      kind: 'hollow-man',
      path: [
        { at: 0, ...EDGE, z: EDGE.z - 0.4, scale: HOLLOW, alpha: 1, reach: 0.25 },
        { at: 3.0, x: EDGE.x * 0.6, z: HEART.z + 2.4, scale: HOLLOW, alpha: 1, reach: 0.5 },
        { at: 5.2, ...REACHED, scale: HOLLOW, alpha: 1, reach: 1 },
        { at: SHATTER, ...REACHED, scale: HOLLOW, alpha: 1, reach: 1 },
        { at: SHATTER + 0.4, ...REACHED, scale: HOLLOW, alpha: 0.4, reach: 0.4 },
        { at: SHATTER + 3.5, ...REACHED, z: REACHED.z + 0.6, scale: HOLLOW, alpha: 0, reach: 0 },
      ],
    },
    {
      // The heart cracks with light, then breaks into Heart Seeds.
      id: 'heart',
      kind: 'heart-seed',
      path: [
        { at: 0, ...HEART, y: 0.35, scale: HEART_SCALE, glow: 0.8 },
        { at: 5.2, ...HEART, y: 0.35, scale: HEART_SCALE, glow: 0.9 },
        { at: 5.8, ...HEART, y: 0.4, scale: HEART_SCALE * 1.06, glow: 1 },
        { at: 6.0, ...HEART, y: 0.4, scale: HEART_SCALE * 0.98, glow: 0.6, flash: true },
        { at: 6.2, ...HEART, y: 0.4, scale: HEART_SCALE * 1.1, glow: 1, flash: true },
        { at: SHATTER, ...HEART, y: 0.45, scale: HEART_SCALE * 1.15, glow: 1 },
        { at: SHATTER + 0.15, ...HEART, y: 0.45, scale: 0, glow: 1 },
      ],
    },
    {
      // Heart Seeds streaking across the sky, every which way.
      id: 'seeds',
      kind: 'shards',
      path: [
        { at: SHATTER, ...HEART, y: 0.5, glow: 1 },
        { at: SHATTER + 6, ...HEART, y: 0.5, glow: 1 },
        { at: 17, ...HEART, y: 0.5, glow: 0 },
      ],
    },
    ...PATCH.flatMap(scatter),
    ...PATCH.map(joyOf),
  ],
};

// ── Shot 6: The land today ──────────────────────────────────────────────
/** Old Hearthfires across the land (in a portrait frame), going out one by one. */
const OLD_FIRES = [
  { id: 'old-fire-a', ...place(2, 1), out: 3.4 },
  { id: 'old-fire-b', ...place(-3, 2), out: 5.2 },
  { id: 'old-fire-c', ...place(3, -6), out: 7.0 },
  { id: 'old-fire-d', ...place(-1, -2), out: 8.8 },
  { id: 'old-fire-e', ...place(3, -3), out: 10.6 },
];
/** Far away, a few other Heart Seeds glow: other Keepers. */
const FAR_SEEDS = [
  { id: 'far-seed-a', ...place(4, -9), phase: 0 },
  { id: 'far-seed-b', ...place(-3, 1), phase: 0.6 },
  { id: 'far-seed-c', ...place(4, -3), phase: 1.2 },
];

const shot6: CinematicInput['shots'][number] = {
  id: 'land-today',
  title: 'The land today',
  duration: 15,
  transition: 'dissolve',
  music: 'night',
  camera: [
    { at: 0, position: [0, 24, -21], target: [0, 0, 1.5], fov: 0.85 },
    { at: 15, position: [1.5, 21, -17.5], target: [0.5, 0, 1.0], fov: 0.85 },
  ],
  mood: [mood(0, 0.75, 0.6, 0), mood(15, 0.7, 0.7, 0)],
  captions: [
    { at: 1.0, until: 7.0, text: 'Now the land is wild, and the fires are going out.' },
    { at: 7.6, until: 14.4, text: 'He still walks at night. And he only needs one.' },
  ],
  cues: OLD_FIRES.map((f) => ({ at: f.out, cue: 'whiff' })),
  actors: [
    ...OLD_FIRES.map((f): Actor => ({
      id: f.id,
      kind: 'hearthfire',
      path: [
        { at: 0, x: f.x, z: f.z, scale: 2.4 },
        { at: f.out, x: f.x, z: f.z, scale: 2.4, lit: false },
        { at: 15, x: f.x, z: f.z, scale: 2.4, lit: false },
      ],
    })),
    ...FAR_SEEDS.map((s): Actor => ({
      id: s.id,
      kind: 'heart-seed',
      path: [0, 2.5, 5, 7.5, 10, 12.5, 15].map((at, i) => ({
        at,
        x: s.x,
        z: s.z,
        y: 0.3,
        scale: 4.5,
        glow: (i + Math.round(s.phase * 2)) % 2 === 0 ? 0.55 : 1,
      })),
    })),
  ],
};

// ── Shot 7: Your Heart Seed ─────────────────────────────────────────────
const SEED_LANDS = 3.6; // TUNE
/** Where your seed lands, and where it's planted. */
const SEED = { x: HOME.x + 0.35, z: HOME.z - 0.1 };
/** You, beside it. */
const YOU = { x: HOME.x - 0.45, z: HOME.z + 0.1 };

const shot7: CinematicInput['shots'][number] = {
  id: 'your-heart-seed',
  title: 'Your Heart Seed',
  duration: 10,
  transition: 'dissolve',
  music: 'wonder',
  camera: [
    { at: 0, position: [HOME.x, 6.5, HOME.z - 7.5], target: [HOME.x, 1.6, HOME.z] },
    { at: SEED_LANDS, position: [HOME.x + 0.4, 3.4, HOME.z - 5.6], target: [HOME.x, 0.5, HOME.z] },
    { at: 10, position: [HOME.x + 0.5, 2.0, HOME.z - 3.8], target: [HOME.x + 0.1, 0.45, HOME.z] },
  ],
  // Still the long night: the colour comes back as you play your part.
  mood: [mood(0, 0.7, 0.65, 0), mood(SEED_LANDS, 0.7, 0.6, 0), mood(10, 0.7, 0.45, 0)],
  captions: [
    { at: 1.0, until: 5.6, text: 'But a Heart Seed has found you, Keeper.' },
    { at: 6.2, until: 9.6, text: "Now it's your turn!" },
  ],
  cues: [
    { at: 1.0, cue: 'whoosh' },
    { at: SEED_LANDS, cue: 'seed-land' },
    { at: SEED_LANDS + 2.4, cue: 'twinkle' },
  ],
  actors: [
    {
      id: 'you',
      kind: 'player-keeper',
      path: [
        { at: 0, ...YOU, scale: KEEPER, yaw: 0.25 },
        { at: 10, ...YOU, scale: KEEPER, yaw: 0.25 },
      ],
      moves: [{ at: SEED_LANDS + 0.4, move: 'bounce' }],
    },
    {
      // Your Heart Seed falls from the sky, lands at your feet, and glows.
      id: 'your-seed',
      kind: 'heart-seed',
      path: [
        { at: 0.8, x: HOME.x + 1.6, z: HOME.z + 3, y: 9, scale: 1.0, glow: 1 },
        { at: SEED_LANDS, ...SEED, y: 0.15, scale: 1.0, glow: 0.7 },
        { at: SEED_LANDS + 2.4, ...SEED, y: 0.15, scale: 1.15, glow: 1 },
        { at: 10, ...SEED, y: 0.15, scale: 1.15, glow: 1 },
      ],
    },
  ],
};

// ── Shot 8: Your part ───────────────────────────────────────────────────
// The four things a Keeper does (owner's playtest notes 2026-10-04), each a
// few seconds with soft dissolves between: plant the seed and light the
// Hearthfire; claim the land around home, grey tile by grey tile turning
// colourful; care for a squishy (a boop, hearts, and it glows); and befriend
// a wild one with a Heart Charm (a toss, three wobbles, and it joins).
const PART = {
  plant: 0,
  claim: 6.0, // TUNE
  care: 12.5, // TUNE
  befriend: 17.0, // TUNE
  end: 24.0, // TUNE
} as const;
const HOME_HEX: Hex = { q: -4, r: 8 };
/** The world's meadow reaches this far from its centre: claims stay on its tiles. */
const WORLD_RADIUS = 10;
const onLand = (h: Hex) => hexDistance(h, { q: 0, r: 0 }) <= WORLD_RADIUS;
/** Home's neighbours, then a few tiles further out, in the order they turn colourful. */
const CLAIMED: readonly Hex[] = [
  ...hexRing(HOME_HEX, 1),
  ...hexRing(HOME_HEX, 2)
    .filter(onLand)
    .filter((_, i) => i % 2 === 0),
];
const FIRE = { x: SEED.x, z: SEED.z + 0.15 };
/** Where care and befriending happen: two of home's neighbours, in front of the fire. */
const CARE_AT = { x: HOME.x + 1.15, z: HOME.z + 0.55 };
const WILD_AT = { x: HOME.x + 1.25, z: HOME.z + 1.75 };
const TOSS = PART.befriend + 1.6; // TUNE: the Heart Charm leaves your hand
const JOINS = PART.befriend + 4.8; // TUNE: after three wobbles

/** A puff of little hearts rising from a spot, from `at` for `seconds`. */
const hearts = (id: string, x: number, z: number, at: number, seconds: number): Actor => ({
  id,
  kind: 'hearts',
  path: [
    { at, x, z, y: 0.3, glow: 1 },
    { at: at + seconds * 0.7, x, z, y: 0.3, glow: 1 },
    { at: at + seconds, x, z, y: 0.3, glow: 0 },
  ],
});

const shot8: CinematicInput['shots'][number] = {
  id: 'your-part',
  title: 'Your part',
  duration: PART.end,
  transition: 'dissolve',
  music: 'wonder',
  dissolves: [PART.claim, PART.care, PART.befriend],
  camera: [
    // Plant and light: close on you and your seed.
    { at: 0, position: [HOME.x + 0.5, 1.8, HOME.z - 3.6], target: [HOME.x + 0.1, 0.45, HOME.z] },
    {
      at: PART.claim,
      position: [HOME.x + 0.7, 1.5, HOME.z - 3.0],
      target: [HOME.x + 0.1, 0.5, HOME.z + 0.1],
    },
    // Claim: from above, the colour spreads round home.
    {
      at: PART.claim,
      cut: true,
      position: [HOME.x + 0.8, 7.6, HOME.z - 6.4],
      target: [HOME.x, 0, HOME.z + 0.4],
    },
    {
      at: PART.care,
      position: [HOME.x + 0.6, 6.6, HOME.z - 5.4],
      target: [HOME.x, 0, HOME.z + 0.4],
    },
    // Care: close on a squishy.
    {
      at: PART.care,
      cut: true,
      position: [CARE_AT.x + 0.2, 1.15, CARE_AT.z - 2.0],
      target: [CARE_AT.x - 0.25, 0.35, CARE_AT.z],
    },
    {
      at: PART.befriend,
      position: [CARE_AT.x + 0.1, 1.0, CARE_AT.z - 1.7],
      target: [CARE_AT.x - 0.25, 0.35, CARE_AT.z],
    },
    // Befriend: you, the Heart Charm, and a wild squishy.
    {
      at: PART.befriend,
      cut: true,
      position: [HOME.x + 0.2, 1.7, HOME.z - 2.2],
      target: [HOME.x + 0.75, 0.4, HOME.z + 1.2],
    },
    {
      at: PART.end,
      position: [HOME.x + 0.35, 1.5, HOME.z - 1.8],
      target: [HOME.x + 0.8, 0.4, HOME.z + 1.2],
    },
  ],
  // Still drained while you plant and claim (claimed land keeps its colour);
  // then the colour is back, behind the dissolve, for care and befriending.
  mood: [
    mood(0, 0.7, 0.45, 0),
    mood(2.6, 0.7, 0.3, 0),
    mood(PART.care - 0.1, 0.7, 0.15, 0),
    mood(PART.care + 0.1, 0, 0.05, 0),
  ],
  captions: [
    { at: 0.6, until: 5.6, text: 'Plant your seed. Light a fire. Make a home.' },
    {
      at: PART.claim + 0.4,
      until: PART.care - 0.3,
      text: 'Bring color back to the land, one patch at a time.',
    },
    { at: PART.care + 0.6, until: PART.befriend - 0.4, text: 'Care for your squishies…' },
    {
      at: PART.befriend + 0.5,
      until: PART.end - 0.8,
      text: '…and find new friends with a Heart Charm!',
    },
  ],
  claims: [
    { at: 2.6, hex: HOME_HEX },
    ...CLAIMED.map((hex, i) => ({ at: PART.claim + 0.9 + i * 0.5, hex })),
  ],
  cues: [
    { at: 1.4, cue: 'bloom' },
    { at: 2.6, cue: 'pop' },
    { at: 3.0, cue: 'twinkle' },
    ...CLAIMED.map((_, i) => ({ at: PART.claim + 0.9 + i * 0.5, cue: 'pop' })),
    { at: PART.claim + 4.6, cue: 'bloom' },
    { at: PART.care + 1.1, cue: 'boop' },
    { at: PART.care + 1.6, cue: 'giggle' },
    { at: PART.care + 2.0, cue: 'twinkle' },
    { at: TOSS, cue: 'charm' },
    { at: TOSS + 1.6, cue: 'squeak' },
    { at: TOSS + 2.3, cue: 'squeak' },
    { at: JOINS, cue: 'yay' },
    { at: JOINS + 0.6, cue: 'giggle' },
  ].sort((a, b) => a.at - b.at),
  actors: [
    {
      id: 'you',
      kind: 'player-keeper',
      path: [
        { at: 0, ...YOU, scale: KEEPER, yaw: 0.25 },
        { at: PART.care, ...YOU, scale: KEEPER, yaw: 0.25 },
        // Over to the squishy for a cuddle.
        { at: PART.care, x: CARE_AT.x - 0.6, z: CARE_AT.z - 0.15, scale: KEEPER, yaw: -0.9 },
        { at: PART.befriend, x: CARE_AT.x - 0.6, z: CARE_AT.z - 0.15, scale: KEEPER, yaw: -0.9 },
        // Then facing the wild one.
        { at: PART.befriend, x: HOME.x + 0.3, z: HOME.z + 0.5, scale: KEEPER, yaw: -0.4 },
        { at: PART.end, x: HOME.x + 0.3, z: HOME.z + 0.5, scale: KEEPER, yaw: -0.4 },
      ],
      moves: [
        { at: 1.2, move: 'bounce' },
        { at: 3.2, move: 'bounce' },
        { at: PART.claim + 0.9, move: 'bounce' },
        { at: PART.claim + 2.4, move: 'bounce' },
        { at: PART.claim + 3.9, move: 'bounce' },
        { at: PART.care + 1.0, move: 'bounce' },
        { at: TOSS - 0.2, move: 'bounce' },
        { at: JOINS + 0.2, move: 'bounce' },
      ],
    },
    {
      // Planted: your seed sinks into the ground…
      id: 'your-seed',
      kind: 'heart-seed',
      path: [
        { at: 0, ...SEED, y: 0.15, scale: 1.15, glow: 1 },
        { at: 1.2, ...SEED, y: 0.15, scale: 1.15, glow: 1 },
        { at: 2.0, ...SEED, y: -0.05, scale: 0.5, glow: 1 },
        { at: 2.3, ...SEED, y: -0.1, scale: 0, glow: 1 },
      ],
    },
    {
      // …and up comes your Hearthfire, lit.
      id: 'home-fire',
      kind: 'hearthfire',
      path: [
        { at: 2.3, ...FIRE, scale: 0 },
        { at: 2.9, ...FIRE, scale: 1.1 },
        { at: 3.2, ...FIRE, scale: 1 },
        { at: PART.end, ...FIRE, scale: 1 },
      ],
    },
    // Squishies come back to the claimed land.
    bloom('b-thistle', 'thistlepip', HOME.x - 1.3, HOME.z + 0.8, PART.claim + 4.3, PART.care),
    bloom('b-ember', 'emberbun', HOME.x + 0.2, HOME.z + 1.4, PART.claim + 4.9, PART.care),
    // Care: a boop, a puff of hearts, and its glow comes back.
    {
      ...stay('c-puddle', 'puddlepuff', CARE_AT.x, CARE_AT.z, PART.claim + 4.6, PART.befriend),
      path: [
        { at: PART.claim + 4.6, ...CARE_AT, y: -0.35, scale: 0, yaw: -0.5 },
        { at: PART.claim + 5.2, ...CARE_AT, scale: SQ, yaw: -0.5 },
        { at: PART.befriend, ...CARE_AT, scale: SQ, yaw: -0.5 },
      ],
      moves: [
        { at: PART.claim + 5.2, move: 'bounce' },
        { at: PART.care + 1.2, move: 'jiggle' },
        { at: PART.care + 1.7, move: 'bounce' },
        { at: PART.care + 2.9, move: 'bounce' },
      ],
    },
    hearts('c-hearts', CARE_AT.x, CARE_AT.z, PART.care + 1.3, 2.4),
    {
      id: 'c-glow',
      kind: 'joy',
      path: [
        { at: PART.care + 1.4, ...CARE_AT, y: 0.25, scale: 0, glow: 1 },
        { at: PART.care + 2.1, ...CARE_AT, y: 0.25, scale: 0.75, glow: 0.9 },
        { at: PART.befriend - 0.6, ...CARE_AT, y: 0.25, scale: 0.6, glow: 0.4 },
        { at: PART.befriend, ...CARE_AT, y: 0.25, scale: 0.5, glow: 0 },
      ],
    },
    // Befriend: a wild squishy, a Heart Charm toss, three wobbles, and it joins.
    {
      id: 'd-wild',
      kind: 'squishy',
      species: 'fizzlepop',
      path: [
        { at: PART.befriend, ...WILD_AT, scale: SQ, yaw: 0.4 },
        { at: JOINS + 0.6, ...WILD_AT, scale: SQ, yaw: 0.4 },
        // A happy hop over to you.
        { at: JOINS + 1.4, x: HOME.x + 0.85, z: HOME.z + 0.95, y: 0.25, scale: SQ, yaw: 0.6 },
        { at: JOINS + 1.8, x: HOME.x + 0.75, z: HOME.z + 0.85, scale: SQ, yaw: 0.6 },
        { at: PART.end, x: HOME.x + 0.75, z: HOME.z + 0.85, scale: SQ, yaw: 0.6 },
      ],
      moves: [
        { at: PART.befriend + 0.6, move: 'jiggle' },
        { at: TOSS + 1.5, move: 'wobble' },
        { at: TOSS + 2.2, move: 'wobble' },
        { at: TOSS + 2.9, move: 'wobble' },
        { at: JOINS, move: 'bounce' },
        { at: JOINS + 1.8, move: 'bounce' },
      ],
    },
    {
      id: 'd-charm',
      kind: 'heart-charm',
      path: [
        { at: TOSS, x: HOME.x + 0.45, z: HOME.z + 0.6, y: 0.45, scale: 0.6, glow: 0.6 },
        {
          at: TOSS + 0.55,
          x: HOME.x + 0.85,
          z: HOME.z + 1.15,
          y: 1.25,
          scale: 1,
          glow: 0.8,
          yaw: 3,
        },
        { at: TOSS + 1.1, ...WILD_AT, z: WILD_AT.z - 0.2, y: 0.75, scale: 1, glow: 1, yaw: 6.3 },
        { at: JOINS - 0.2, ...WILD_AT, z: WILD_AT.z - 0.2, y: 0.8, scale: 1.1, glow: 1, yaw: 6.3 },
        { at: JOINS, ...WILD_AT, z: WILD_AT.z - 0.2, y: 0.8, scale: 0, glow: 1, yaw: 6.3 },
      ],
    },
    hearts('d-hearts', WILD_AT.x, WILD_AT.z, JOINS, 2.2),
  ],
};

// ── Shot 9: Heartpatch (the title) ───────────────────────────────────────
const shot9: CinematicInput['shots'][number] = {
  id: 'title',
  title: 'Heartpatch',
  duration: 7,
  transition: 'dissolve',
  music: 'wonder',
  camera: [
    {
      at: 0,
      position: [HOME.x + 0.6, 2.6, HOME.z - 4.4],
      target: [HOME.x + 0.2, 0.55, HOME.z + 0.6],
    },
    {
      at: 7,
      position: [HOME.x + 0.8, 3.4, HOME.z - 5.8],
      target: [HOME.x + 0.2, 0.7, HOME.z + 0.6],
    },
  ],
  mood: [mood(0, 0, 0.05, 0)],
  titleAt: 1.0,
  cues: [
    { at: 1.0, cue: 'title' },
    { at: 2.4, cue: 'giggle' },
  ],
  actors: [
    {
      id: 'you',
      kind: 'player-keeper',
      path: [
        { at: 0, x: HOME.x + 0.1, z: HOME.z + 0.35, scale: KEEPER, yaw: 0.1 },
        { at: 7, x: HOME.x + 0.1, z: HOME.z + 0.35, scale: KEEPER, yaw: 0.1 },
      ],
      moves: [{ at: 1.2, move: 'bounce' }],
    },
    {
      id: 'home-fire',
      kind: 'hearthfire',
      path: [
        { at: 0, ...FIRE },
        { at: 7, ...FIRE },
      ],
    },
    stay('t-puddle', 'puddlepuff', CARE_AT.x, CARE_AT.z, 0, 7, {
      moves: [{ at: 1.4, move: 'bounce' }],
    }),
    stay('t-thistle', 'thistlepip', HOME.x - 1.0, HOME.z + 0.8, 0, 7, {
      moves: [{ at: 2.0, move: 'bounce' }],
    }),
    stay('t-ember', 'emberbun', HOME.x - 0.3, HOME.z + 1.3, 0, 7, {
      moves: [{ at: 2.6, move: 'bounce' }],
    }),
    stay('t-fizzle', 'fizzlepop', HOME.x + 0.75, HOME.z + 0.85, 0, 7, {
      moves: [{ at: 2.3, move: 'bounce' }],
    }),
  ],
};

/** The opening cinematic (design doc §25), checked by `checkCinematic` in tests. */
export const GREAT_SCATTER: CinematicInput = {
  id: 'great-scatter',
  world: {
    hexSize: HEX,
    // The meadow first; later regions paint over it.
    regions: [
      { ground: 'meadow', center: { q: 0, r: 0 }, radius: 10 },
      { ground: 'heartpatch', center: { q: 0, r: 0 }, radius: 1 },
      { ground: 'old-forest', center: { q: 2, r: -4 }, radius: 2 },
      { ground: 'forest', center: { q: -3, r: -2 }, radius: 1 },
      { ground: 'forest', center: { q: 5, r: -3 }, radius: 1 },
      { ground: 'hills', center: { q: -3, r: 4 }, radius: 1 },
      { ground: 'pumpkin-fields', center: { q: -7, r: 0 }, radius: 1 },
      { ground: 'autumn', center: { q: -9, r: 4 }, radius: 1 },
      { ground: 'snow', center: { q: -5, r: -4 }, radius: 1 },
      { ground: 'lake', center: { q: 9, r: -2 }, radius: 1 },
      { ground: 'junipers-gap', center: { q: 1, r: -6 }, radius: 0 },
    ],
  },
  shots: [shot1, shot2, shot3, shot4, shot5, shot6, shot7, shot8, shot9],
};
