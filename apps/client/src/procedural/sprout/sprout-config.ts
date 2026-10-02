/**
 * Sprout, the tiny glowing spirit of your Heart Seed (design doc §26), in the
 * vinyl-toy style (§19). Not a species: it never enters the body and part
 * registry. All first guesses to judge on the playtest devices.
 */
export const SPROUT = {
  /** Body diameter in world units (a hex tile is about 2 across). */
  size: 0.9, // TUNE
  /** Height of Sprout's middle above the ground it floats over. */
  floatHeight: 1.7, // TUNE
  /** Warm seed-glow body colours (sRGB hex); each Sprout is mixed between them. */
  bodyColors: ['#ffe48a', '#ffd36e'], // TUNE
  leafColor: '#8fdc8a', // TUNE
  /** How brightly the body glows on its own (emissive, 0–1 of the body colour). */
  glow: { min: 0.35, max: 0.45 }, // TUNE
  /** The soft halo behind Sprout, as a multiple of the body size. */
  haloScale: 2.6, // TUNE
  /** Body squash: height over width, picked in [min, max]. */
  squash: { min: 1.04, max: 1.14 }, // TUNE: a little taller than wide, seed-like
  /** Leaf lean outwards, in degrees, picked in [min, max]. */
  leafSplayDeg: { min: 28, max: 40 }, // TUNE
  /** The hop when Sprout talks: height (body sizes) and duration (seconds). */
  hop: { height: 0.35, seconds: 0.7 }, // TUNE
} as const;
