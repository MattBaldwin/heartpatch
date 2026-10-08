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

/**
 * The night show (#277): the Hollow Man's walk along a Keeper's border,
 * played from the night's outcome. Live, he backs away from lit tiles across
 * the prowl (`HOLLOW_RULES.show.prowlMinutes`) and strikes at its end; the
 * morning replay plays the same stops sped up.
 */
export const SHOW = {
  /** Between stops in the morning replay. */
  replayBeatMs: 3_500, // TUNE
  /** Between strikes once the prowl ends, and from the last one to his leaving. */
  strikeGapMs: 5_000, // TUNE
  /** How long one stop's move plays (a glide, then the lean or the reach). */
  moveMs: 2_600, // TUNE
  /** How far outside a tile he stands, in tiles, from its middle. */
  standOff: 0.95, // TUNE
  /** How far he leans in at a lit tile before sliding back, in tiles. */
  lean: 0.35, // TUNE
  /** His fade while he waits between stops (0–1). */
  waitAlpha: 0.75, // TUNE
  /** How big he stands on the map. */
  scale: 0.85, // TUNE
} as const;

/** The dusk chip ("Night in N min") and the dark-land nudge show this long before nightfall. */
export const DUSK_MINUTES = 60; // TUNE

/** The dashed edge on my dark land (#277): lavender, like the mockup's. */
export const DARK_EDGE = {
  color: '#b7a8f0', // TUNE
  dashes: 2, // TUNE: per hex edge
  fill: 0.55, // TUNE: share of each dash slot that's drawn
  width: 0.045, // TUNE: world units
  inset: 0.9, // TUNE: of the tile's radius
  lift: 0.02, // TUNE: above the tile top
} as const;
