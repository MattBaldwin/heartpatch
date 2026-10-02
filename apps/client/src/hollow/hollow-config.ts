// How the map looks at night (#21, design doc §14, style guide §1): colour
// drains to a soft dusk, and the Hearthfires' warm glow is what stands out.
// Cozy-spooky, never black. Every number is a guess to tune by eye.

export const NIGHT_LOOK = {
  /** The sky behind the island: deep lavender dusk. */
  clear: '#2e2a4d', // TUNE
  /** Share of the day's sky light (IBL) kept at night. */
  environment: 0.3, // TUNE
  /** Share of the day's sun kept at night: moonlight. */
  sun: 0.3, // TUNE
  /** The moon's cool colour on the sun light. */
  moon: [0.72, 0.78, 1] as const, // TUNE
} as const;

/** A `hollow.nightfall` older than this (a replay after reconnecting) doesn't play his visit again. */
export const VISIT_FRESH_MS = 5 * 60_000; // TUNE

/**
 * Where he stands on a visit, from what the camera looks at (world units,
 * +z is up-screen): close enough to be seen, never right on top of the
 * player's Heart Seed, and clear of the bottom cards.
 */
export const VISIT_SPOT = { x: 0.9, z: 1.6 } as const; // TUNE
