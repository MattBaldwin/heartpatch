/**
 * Procedural squishy tunables (design doc §19). Shapes and parts are data in
 * `@heartpatch/shared` (`BODIES`, `PARTS`); this file holds the look and
 * motion numbers shared by every squishy. All first guesses to judge in the
 * dev gallery (`/gallery.html`) and on the playtest devices.
 */

import { ART_RULES } from '@heartpatch/shared';

/**
 * Fixed toy colours (sRGB hex) for the `ink`, `white` and `blush` palette
 * roles. A species may set its own ink (`visual.ink`, ART_BIBLE §1.7).
 */
export const FIXED_COLORS = {
  ink: ART_RULES.defaultInk,
  white: '#ffffff',
  blush: '#ff9db5', // TUNE
} as const;

/** Per-squishy variation, seeded from the instance id. */
export const VARIATION = {
  /** Overall lightness change, as a fraction (±); face contrast is checked at both ends. */
  lightness: ART_RULES.lightnessVariation,
  /** Warm/cool shift moved between red and blue, 0–1 sRGB (±); face contrast is checked at both ends. */
  warmth: ART_RULES.warmthVariation,
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

/**
 * Detail a squishy field can draw at: the shared levels, plus `hero` for the
 * one squishy that fills the screen in the close-up view (#20). Keepers stay
 * on `SquishyLod`.
 */
export type SquishyDetail = SquishyLod | 'hero';

export interface LodSettings {
  /** Body rings top to bottom; the body has twice as many segments around. */
  bodyRings: number;
  /** Rings on a part primitive. */
  partRings: number;
  /** Segments around a part primitive. */
  partSegments: number;
}

export const LOD: Readonly<Record<SquishyDetail, LodSettings>> = {
  low: { bodyRings: 14, partRings: 6, partSegments: 10 }, // TUNE
  high: { bodyRings: 32, partRings: 12, partSegments: 20 }, // TUNE
  // TUNE: one squishy at full-screen size on a 2× display, so the silhouette
  // stays round (~9k body triangles; still one draw call per shape).
  hero: { bodyRings: 48, partRings: 16, partSegments: 28 },
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

/**
 * How a squishy is drawn: `normal`, or `shadow` for the Hollow's rescue
 * guardians (owner decision 7, 2026-10-03): dark lavender, a soft glowing rim
 * and glassy eyes, on the same meshes in the same draw calls.
 */
export type SquishyLook = 'normal' | 'shadow';

/**
 * Look codes in the `squishMotion` attribute's spare `w`: 0 normal, then the
 * shadow look for the body and parts, and for the eyes (and their glints).
 */
export const SQUISH_LOOK_CODE = { normal: 0, shadow: 1, shadowEyes: 2 } as const;

/** The shadow look (linear RGB). Judge on the battle arena and in the gallery (`?shadow`). */
export const SHADOW_LOOK = {
  /** Dark lavender the vinyl is tinted towards, keeping its shading. */
  tint: [0.11, 0.07, 0.22], // TUNE
  /** How far (0–1) the colour moves towards the tint. */
  tintMix: 0.9, // TUNE
  /** Eyes keep their own colour, mixed this far towards the glow: soft, glassy, readable. */
  eyeGlowMix: 0.55, // TUNE
  /** The soft glowing rim: colour, strength and falloff (higher hugs the edge). */
  glow: [0.72, 0.55, 1], // TUNE
  glowStrength: 0.75, // TUNE
  glowFalloff: 3.5, // TUNE
} as const;

/**
 * Rarity material tiers and glow (ART_BIBLE §1.4), drawn by the squish
 * shader from a per-instance code: no extra meshes or draw calls.
 */
export const FINISH = {
  /** Sparkle flecks: cells per body height, share of cells with a fleck, fleck strength. */
  sparkle: { cells: 11, density: 0.16, strength: 0.9 }, // TUNE
  /** Iridescent rim: strength and how tightly it hugs the edge. */
  iridescent: { strength: 0.55, falloff: 2.2 }, // TUNE
  /** Glow: how much of the vinyl's own colour is added back as light. */
  glow: 0.28, // TUNE
} as const;

/** Codes in `squishEvent`'s spare `w`: the finish, plus 4 when the instance glows. */
export const FINISH_CODE = { vinyl: 0, sparkle: 1, iridescent: 2, glow: 4 } as const;

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
