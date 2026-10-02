// The Hollow Man's look (design doc §14, style guide §5): a tall, soft,
// flickering silhouette with glowing eyes. Spooky through absence, never
// scary: no mouth, no hands, no sharp edges; he fades in, flickers, hesitates
// and fades away. Every number here is a guess to tune by eye.

/** His outline, bottom to top, as (radius, height) pairs lathed round the Y axis. */
export const HOLLOW_MAN_PROFILE: readonly (readonly [number, number])[] = [
  [0.0, 0.0],
  [0.17, 0.0], // TUNE: a soft cloak hem
  [0.15, 0.08],
  [0.12, 0.3],
  [0.095, 0.55],
  [0.1, 0.68], // TUNE: rounded shoulders
  [0.075, 0.76],
  [0.085, 0.84], // TUNE: a round head
  [0.075, 0.93],
  [0.04, 0.98],
  [0.0, 0.99],
];

export const HOLLOW_MAN = {
  /** World units tall (a map tile is about 1.1 across): tall, not towering. */
  height: 1.3, // TUNE
  /** Plum-dusk body, drawn unlit and see-through: a shadow, not a creature. */
  bodyColor: '#4a3a6e', // TUNE
  bodyAlpha: 0.78, // TUNE
  /** Soft moon-gold eyes: they glow, they don't glare. */
  eyeColor: '#ffe7a3', // TUNE
  eyeSize: 0.05, // TUNE: fraction of his height
  eyeHeight: 0.865, // TUNE: fraction of his height
  eyeGap: 0.038, // TUNE: half the distance between the eyes, fraction of his height
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
