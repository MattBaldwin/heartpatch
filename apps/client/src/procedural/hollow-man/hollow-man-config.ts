// The Hollow Man's look (design doc §14, style guide §5): a tall, thin,
// flickering silhouette with long reaching arms and glowing eyes. Spooky-tense
// (owner decision 2026-10-04), never gory: no mouth, no claws, no blood; a
// ragged cloak, long soft fingers, and eyes that flare as he reaches. Every
// number here is a guess to tune by eye.

/** His outline, bottom to top, as (radius, height) pairs lathed round the Y axis. */
export const HOLLOW_MAN_PROFILE: readonly (readonly [number, number])[] = [
  [0.0, 0.0],
  [0.135, 0.0], // TUNE: a narrow cloak hem (made ragged by HOLLOW_HEM)
  [0.12, 0.08],
  [0.09, 0.32],
  [0.07, 0.55], // TUNE: a thin, gaunt middle
  [0.092, 0.69], // TUNE: bony shoulders
  [0.06, 0.76],
  [0.05, 0.79], // TUNE: a long neck
  [0.07, 0.86], // TUNE: a long, narrow head
  [0.064, 0.94],
  [0.035, 0.985],
  [0.0, 0.995],
];

export const HOLLOW_MAN = {
  /** World units tall (a map tile is about 1.1 across): tall and thin, not towering. */
  height: 1.45, // TUNE
  /** Deep plum-black body, drawn unlit and a little see-through: a shadow, not a creature. */
  bodyColor: '#251c3a', // TUNE
  bodyAlpha: 0.86, // TUNE
  /** Moon-gold eyes: they glow, and flare when he reaches. */
  eyeColor: '#ffe08a', // TUNE
  eyeSize: 0.042, // TUNE: fraction of his height
  eyeHeight: 0.875, // TUNE: fraction of his height
  eyeGap: 0.033, // TUNE: half the distance between the eyes, fraction of his height
} as const;

/** The ragged hem of his cloak: soft tatters, wavy round the bottom edge. */
export const HOLLOW_HEM = {
  /** How many tatters round the hem. */
  tatters: 7, // TUNE
  /** How far up the gaps between tatters reach, fraction of his height. */
  depth: 0.07, // TUNE
  /** How far up the cloak the raggedness fades out, fraction of his height. */
  fade: 0.16, // TUNE
} as const;

/** His long arms (fractions of his height), hanging at rest and reaching out and down. */
export const HOLLOW_ARM = {
  /** Shoulder, out from his middle and up, and a little in front (−z, towards the camera). */
  shoulder: [0.098, 0.69, -0.015], // TUNE
  /** Arm length to the wrist: long, nearly to his knees. */
  length: 0.5, // TUNE
  /** Thickness at the shoulder and at the wrist. */
  radius: [0.026, 0.012], // TUNE
  /** Three long soft fingers, splayed this far apart (radians), this long. */
  fingerLength: 0.11, // TUNE
  fingerSplay: 0.3, // TUNE
  /** Angle out from his sides at rest (radians), so the arms clear the cloak. */
  restSpread: 0.2, // TUNE
  /** At full reach: raised forward (radians from hanging) and spread a little wider. */
  reachRaise: 1.2, // TUNE: out and down, towards what he wants, never straight at the camera
  reachSpread: 0.3, // TUNE
} as const;

/** His eyes as he reaches: bigger and hotter, never a flash (it eases with the reach). */
export const EYE_FLARE = {
  scale: 1.45, // TUNE
  brightness: 1.5, // TUNE: emissive multiplier at full flare (more blows out to white)
  color: '#ffd45c', // TUNE: a hotter, deeper gold
} as const;

/** Frames per second of the visit animation. */
export const VISIT_FPS = 60;

/**
 * The visit, as (frame, value) keys: he fades in, flickers twice like a
 * candle, hesitates, and fades away (style guide §5: "He hesitates at light
 * and noise, and fades away"). About 4.5 s, the only time the map draws
 * continuously at night.
 */
export const VISIT_KEYS = {
  bodyAlpha: [
    [0, 0],
    [45, 1],
    [70, 0.45], // TUNE: first flicker
    [80, 1],
    [150, 0.55], // TUNE: second flicker
    [160, 1],
    [215, 1],
    [270, 0],
  ],
  eyeAlpha: [
    [0, 0],
    [30, 0],
    [60, 1],
    [70, 0.3],
    [82, 1],
    [200, 1],
    [250, 0],
    [270, 0],
  ],
  /** A slow drift up, as if he's lighter than air. */
  rise: [
    [0, -0.04],
    [270, 0.06],
  ],
} as const satisfies Record<string, readonly (readonly [number, number])[]>;

/** The visit's last frame. */
export function visitFrames(): number {
  return Math.max(...Object.values(VISIT_KEYS).flatMap((keys) => keys.map(([frame]) => frame)));
}

/**
 * Where one arm points at `reach` (0 hanging, 1 reaching): its roll out from
 * his side and its pitch forward (towards −z, the camera's side), radians.
 * `side` is −1 (his right, on screen left) or 1.
 */
export function armAngles(side: -1 | 1, reach: number): { roll: number; pitch: number } {
  const r = Math.min(1, Math.max(0, reach));
  return {
    roll: side * (HOLLOW_ARM.restSpread + HOLLOW_ARM.reachSpread * r),
    pitch: HOLLOW_ARM.reachRaise * r,
  };
}
