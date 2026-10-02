/**
 * Procedural squishy tunables (design doc §19). Shapes and parts are data in
 * `@heartpatch/shared` (`BODIES`, `PARTS`); this file holds the look and
 * motion numbers shared by every squishy. All first guesses to judge in the
 * dev gallery (`/gallery.html`) and on the playtest devices.
 */

/** Fixed toy colours (sRGB hex) for the `ink`, `white` and `blush` palette roles. */
export const FIXED_COLORS = {
  ink: '#3b2a3f', // TUNE: soft plum, warmer than black
  white: '#ffffff',
  blush: '#ff9db5', // TUNE
} as const;

/** Per-squishy variation, seeded from the instance id. */
export const VARIATION = {
  /** Overall lightness change, as a fraction (±). */
  lightness: 0.06, // TUNE
  /** Warm/cool shift moved between red and blue, 0–1 sRGB (±). */
  warmth: 0.025, // TUNE
  /** Placement wobble for single and paired parts, in degrees (±). */
  placementDeg: 2.5, // TUNE
  /** Breaths per second, picked in [min, max]. */
  breathRate: { min: 0.32, max: 0.45 }, // TUNE
  /** Breathing squash as a fraction of height, picked in [min, max]. */
  breathAmplitude: { min: 0.022, max: 0.032 }, // TUNE
  /** Scattered pattern pieces stay at least this far apart, in degrees. */
  scatterSpacingDeg: 18, // TUNE
  /** Placement tries per scattered piece before it's left out. */
  scatterTries: 8,
} as const;

/**
 * Detail levels. `low` is the map view and the low quality tier; `high` is
 * close-ups (wardrobe, care, battle) on medium and high tiers. Both are
 * smooth-shaded, so low only loses silhouette roundness up close.
 */
export type SquishyLod = 'low' | 'high';

export interface LodSettings {
  /** Body rings top to bottom; the body has twice as many segments around. */
  bodyRings: number;
  /** Rings on a part primitive. */
  partRings: number;
  /** Segments around a part primitive. */
  partSegments: number;
}

export const LOD: Readonly<Record<SquishyLod, LodSettings>> = {
  low: { bodyRings: 14, partRings: 6, partSegments: 10 }, // TUNE
  high: { bodyRings: 32, partRings: 12, partSegments: 20 }, // TUNE
};

/** Soft-vinyl material (matches the test scene's vinyl). */
export const VINYL = {
  roughness: 0.42, // TUNE
  clearCoatIntensity: 0.9, // TUNE
  clearCoatRoughness: 0.2, // TUNE
  /** Rim light (linear RGB) so squishies pop off the ground. */
  rimColor: [1, 0.93, 0.97], // TUNE
  rimStrength: 0.35, // TUNE
} as const;

/** Event animations. Each shader formula decays to rest within its duration. */
export type SquishMove = 'jiggle' | 'wobble' | 'bounce';

/** Kind codes in the `squishEvent` attribute; 0 means none. */
export const SQUISH_MOVE_CODE: Readonly<Record<SquishMove, number>> = {
  jiggle: 1,
  wobble: 2,
  bounce: 3,
};

export const SQUISH = {
  /** Seconds each move runs before the squishy is at rest again. */
  duration: { jiggle: 0.9, wobble: 1, bounce: 1.1 }, // TUNE
  /** Tap jiggle: squash amplitude, side lean, decay per second, wobble speed (rad/s). */
  jiggle: { squash: 0.16, lean: 0.1, decay: 6, speed: 30 }, // TUNE
  /** Landing wobble: squash amplitude, decay per second, speed (rad/s). */
  wobble: { squash: 0.28, decay: 5, speed: 17 }, // TUNE
  /** Happy bounce: hop height (fraction of body height), hops, squash on landing. */
  bounce: { height: 0.45, hops: 2, squash: 0.22 }, // TUNE
} as const;

/** Contact shadow: a soft dark disc under each squishy. */
export const CONTACT_SHADOW = {
  color: '#6b4b6e', // TUNE: plum, matches the test scene
  /** Diameter as a multiple of the body's larger footprint side. */
  scale: 1.35, // TUNE
} as const;
