import { hexToWorld } from '../../hex/index.js';
import type {
  CinematicActorKey,
  CinematicInput,
  CinematicMoodKey,
} from '../../schemas/data/cinematic.js';

// "The Great Scatter" (design doc §25): the opening cinematic every new
// player sees once, right after picking their Keeper and before the
// tutorial. Seven shots, about 111 seconds: wonder first, a flash of spooky,
// then hope. Every number is a first guess to judge on the playtest devices
// (`// TUNE:`); captions follow style guide §2 and §6.
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
const HOLLOW = 1.5; // TUNE: about three Keepers tall, never towering over the camera

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
      // still. He never comes close, never speaks.
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
        { at: 14, ...EDGE, z: EDGE.z - 0.4, scale: HOLLOW, alpha: 1 },
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
const SHATTER = 6.5; // TUNE: the moment the Heartpatch breaks

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
          { at: 16, x: tx, z: tz, scale: SQ, yaw: 3.0 },
        ],
        moves: [{ at: SHATTER + 2.2, move: 'wobble' }],
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
      moves: [{ at: SHATTER + 0.3, move: 'jiggle' }],
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

const shot5: CinematicInput['shots'][number] = {
  id: 'great-scatter',
  title: 'The Great Scatter',
  duration: 16,
  transition: 'cut',
  music: 'none',
  camera: [
    { at: 0, position: [1.4, 2.6, -6.0], target: [0.3, 0.9, 2.4] },
    { at: SHATTER - 0.5, position: [1.0, 3.0, -7.0], target: [0.1, 0.9, 0.8] },
    { at: 16, position: [0, 7.0, -11], target: [0, 3.0, 3.5] },
  ],
  mood: [
    mood(0, 0.65, 0.75, 0.85),
    mood(SHATTER, 0.75, 0.75, 1),
    mood(SHATTER + 1.5, 0.85, 0.8, 0),
  ],
  captions: [
    { at: 1.0, until: 6.0, text: 'He reached for the Heartpatch…' },
    { at: 6.8, until: 11.6, text: 'It shattered, and its Heart Seeds scattered.' },
    { at: 12.0, until: 16, text: 'The squishies were lost across the land.' },
  ],
  cues: [
    { at: 1.4, cue: 'nightfall' },
    { at: SHATTER, cue: 'shatter' },
    { at: SHATTER + 0.6, cue: 'whoosh' },
    { at: SHATTER + 1.4, cue: 'whoosh' },
    { at: SHATTER + 2.3, cue: 'boop' },
  ],
  actors: [
    {
      // He glides towards the glow (never towards the player) and fades as it breaks.
      id: 'hollow',
      kind: 'hollow-man',
      path: [
        { at: 0, ...EDGE, z: EDGE.z - 0.4, scale: HOLLOW, alpha: 1 },
        { at: 5.0, x: EDGE.x * 0.4, z: HEART.z + 2.6, scale: HOLLOW, alpha: 1 },
        { at: SHATTER, x: EDGE.x * 0.4, z: HEART.z + 2.4, scale: HOLLOW, alpha: 1 },
        { at: SHATTER + 0.3, x: EDGE.x * 0.4, z: HEART.z + 2.4, scale: HOLLOW, alpha: 0.4 },
        { at: SHATTER + 3.5, x: EDGE.x * 0.4, z: HEART.z + 3.0, scale: HOLLOW, alpha: 0 },
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
        { at: 16, ...HEART, y: 0.5, glow: 0 },
      ],
    },
    ...PATCH.flatMap(scatter),
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

const shot7: CinematicInput['shots'][number] = {
  id: 'your-heart-seed',
  title: 'Your Heart Seed',
  duration: 21,
  transition: 'dissolve',
  music: 'wonder',
  camera: [
    { at: 0, position: [HOME.x, 6.5, HOME.z - 7.5], target: [HOME.x, 1.6, HOME.z] },
    { at: SEED_LANDS, position: [HOME.x + 0.4, 3.4, HOME.z - 5.6], target: [HOME.x, 0.5, HOME.z] },
    // The push in, onto the player's own Keeper and their seed.
    { at: 12, position: [HOME.x + 0.5, 1.3, HOME.z - 2.6], target: [HOME.x + 0.2, 0.45, HOME.z] },
    { at: 21, position: [HOME.x + 0.6, 1.5, HOME.z - 3.4], target: [HOME.x + 0.2, 0.5, HOME.z] },
  ],
  // The colour comes back as the seed glows: dawn after the long night.
  mood: [mood(0, 0.7, 0.65, 0), mood(SEED_LANDS, 0.7, 0.6, 0), mood(12, 0, 0.05, 0)],
  captions: [
    { at: 1.0, until: 5.6, text: 'But a Heart Seed has found you, Keeper.' },
    { at: 6.0, until: 11.0, text: 'Plant it. Light a fire. Bring the squishies home.' },
    { at: 11.4, until: 16.6, text: 'And bring the color back, one patch at a time.' },
  ],
  titleAt: 16.8,
  cues: [
    { at: 1.0, cue: 'whoosh' },
    { at: SEED_LANDS, cue: 'seed-land' },
    { at: SEED_LANDS + 2.4, cue: 'twinkle' },
    { at: 12.6, cue: 'bloom' },
    { at: 13.3, cue: 'bloom' },
    { at: 14.0, cue: 'giggle' },
    { at: 16.8, cue: 'title' },
  ],
  actors: [
    {
      id: 'you',
      kind: 'player-keeper',
      path: [
        { at: 0, x: HOME.x - 0.45, z: HOME.z + 0.1, scale: KEEPER, yaw: 0.25 },
        { at: 21, x: HOME.x - 0.45, z: HOME.z + 0.1, scale: KEEPER, yaw: 0.25 },
      ],
      moves: [
        { at: SEED_LANDS + 0.4, move: 'bounce' },
        { at: 14.2, move: 'bounce' },
      ],
    },
    {
      // Your Heart Seed falls from the sky, lands at your feet, and glows.
      id: 'your-seed',
      kind: 'heart-seed',
      path: [
        { at: 0.8, x: HOME.x + 1.6, z: HOME.z + 3, y: 9, scale: 1.0, glow: 1 },
        { at: SEED_LANDS, x: HOME.x + 0.35, z: HOME.z - 0.1, y: 0.15, scale: 1.0, glow: 0.7 },
        { at: SEED_LANDS + 2.4, x: HOME.x + 0.35, z: HOME.z - 0.1, y: 0.15, scale: 1.15, glow: 1 },
        { at: 21, x: HOME.x + 0.35, z: HOME.z - 0.1, y: 0.15, scale: 1.15, glow: 1 },
      ],
    },
    // The squishies come home.
    bloom('home-puddle', 'puddlepuff', HOME.x + 1.2, HOME.z + 0.6, 12.3, 21, -0.4),
    bloom('home-thistle', 'thistlepip', HOME.x - 1.3, HOME.z + 0.8, 13.0, 21, 0.4),
    bloom('home-ember', 'emberbun', HOME.x + 0.2, HOME.z + 1.4, 13.7, 21),
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
  shots: [shot1, shot2, shot3, shot4, shot5, shot6, shot7],
};
