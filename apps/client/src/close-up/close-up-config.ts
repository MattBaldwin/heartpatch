import type { FeelingId } from '@heartpatch/shared';
import type { SquishMove } from '../procedural/config.js';

/**
 * Close-up view tunables (#20, design doc §20). All first guesses to check on
 * the playtest devices (iPhone 14+, recent iPads).
 */

/** Where the squishy stands and how big it is drawn. */
export const STAGE = {
  /** Extra scale on the squishy (bodies are about 1 unit tall). */
  scale: 1.6, // TUNE
  /** Clear colour behind the backdrop (sRGB), also used when there's no snapshot. */
  clear: '#fde8f0', // TUNE: the home and battle pink
} as const;

/** A camera pose around the squishy, looking at a point above its feet. */
export interface ClosePose {
  /** Distance from the look-at point. */
  readonly distance: number;
  /** Angle above the horizon, radians. */
  readonly pitch: number;
  /** Turn around the squishy, radians (0: straight at its face). */
  readonly yaw: number;
  /** Look-at height as a fraction of the squishy's height. */
  readonly lookAt: number;
}

export const CAMERA_POSES = {
  /** Where the swoop starts: up and back, like the map's tilted view. */
  from: { distance: 13, pitch: 0.95, yaw: -0.5, lookAt: 0.2 }, // TUNE
  /** Face to face: a touch above eye level so the face fills the screen. */
  face: { distance: 5.2, pitch: 0.16, yaw: 0, lookAt: 0.5 }, // TUNE
} as const satisfies Record<string, ClosePose>;

export const CAMERA_FOV = 0.7; // TUNE: radians; a little tele so the face isn't distorted

/** How long the camera moves take (ms). */
export const SWOOP = {
  inMs: 900, // TUNE
  outMs: 420, // TUNE: leaving is quicker than arriving
  /** The veil that hides the scene swap on the way out. */
  veilMs: 220, // TUNE
} as const;

/** The blurred backdrop: a snapshot of the view the player came from (cheap depth of field). */
export const BACKDROP = {
  /** Width of the blurred image, in pixels; bilinear upsampling does the rest. */
  width: 48, // TUNE
  /** Box blur radius (pixels of the small image) and passes (3 ≈ Gaussian). */
  radius: 2, // TUNE
  passes: 3,
  /** Tint over the backdrop so the squishy pops: colour (sRGB) and how much. */
  tint: '#fff0f6', // TUNE
  tintAmount: 0.35, // TUNE
} as const;

/** Gesture thresholds, in CSS pixels and ms. */
export const GESTURE = {
  /** A boop moves less than this and lifts within `tapMs`. */
  tapMovePx: 12, // TUNE
  tapMs: 450, // TUNE
  /** A stroke travels at least this far over the squishy. */
  strokePx: 70, // TUNE
  /** A pinch tickle changes the finger gap by at least this fraction. */
  pinchRatio: 0.12, // TUNE
  /** Swipe down to go back: at least this far, mostly down, within `swipeMs`. */
  swipePx: 110, // TUNE
  swipeMs: 700, // TUNE
  /** The squishy's hit area grows by this fraction so small fingers find it. */
  hitSlop: 0.25, // TUNE
} as const;

/**
 * How the squishy reacts to a touch (design doc §20: happy wiggle, blush,
 * giggle; the yawn is Sleepy's idle move).
 */
export type ReactionId = 'boop' | 'wiggle' | 'giggle' | 'nom' | 'sniff';

export interface Reaction {
  readonly move: SquishMove;
  readonly strength: number;
  /** A little bubble over its head (emoji or a word or two), or null. */
  readonly bubble: string | null;
  /** Pink cheeks for a moment. */
  readonly blush: boolean;
}

// Player-facing bubbles (style guide §2: short and silly).
export const REACTIONS: Readonly<Record<ReactionId, Reaction>> = {
  boop: { move: 'jiggle', strength: 1, bubble: 'Boop!', blush: false },
  wiggle: { move: 'wobble', strength: 0.7, bubble: '💗', blush: true },
  giggle: { move: 'jiggle', strength: 1.4, bubble: 'Hee hee!', blush: true },
  nom: { move: 'bounce', strength: 1, bubble: 'Nom nom!', blush: false },
  sniff: { move: 'wobble', strength: 0.4, bubble: 'Sniff sniff?', blush: false },
};

/** Idle personality moves that aren't shader squish moves (design doc §20). */
export type IdleMotion = 'spin' | 'puff' | 'nod' | 'snuggle' | 'hop' | 'boo';

export interface IdleMove {
  readonly motion: IdleMotion;
  readonly ms: number;
  readonly bubble: string | null;
  /** A squish move to play with it (on the shader clock), if any. */
  readonly squish: SquishMove | null;
}

/**
 * What each feeling does when left alone (style guide §5: Joy bounces, Cozy
 * snuggles, Brave puffs up, Silly spins, Sleepy nods off, Spooky goes "boo!"
 * and then giggles).
 */
export const IDLE_BY_FEELING: Readonly<Record<FeelingId, IdleMove>> = {
  joy: { motion: 'hop', ms: 1100, bubble: null, squish: 'bounce' },
  cozy: { motion: 'snuggle', ms: 1600, bubble: '☺️', squish: 'wobble' },
  brave: { motion: 'puff', ms: 1300, bubble: null, squish: null },
  silly: { motion: 'spin', ms: 1000, bubble: 'Wheee!', squish: 'jiggle' },
  sleepy: { motion: 'nod', ms: 2200, bubble: 'Yaaawn… 💤', squish: null },
  spooky: { motion: 'boo', ms: 1200, bubble: 'Boo! …hee hee', squish: 'jiggle' },
};

/** How often an idle move plays while nobody is touching (ms, ± jitter). */
export const IDLE = {
  everyMs: 6000, // TUNE
  jitterMs: 1500, // TUNE
  /** Wait this long after a gesture before the next idle move. */
  afterTouchMs: 4000, // TUNE
  /** Puff: how much bigger it gets. Nod: how far it sinks (fraction of height). */
  puffScale: 0.12, // TUNE
  nodSink: 0.06, // TUNE
  hopHeight: 0.35, // TUNE: fraction of height
} as const;

/** Bubbles stay up this long (ms), and never higher than this (clear of the account chip). */
export const BUBBLE_MS = 1400; // TUNE
export const BUBBLE_TOP_PX = 96; // TUNE

/** When the squishy leaves while up close, its reason stays up this long before the swoop out. */
export const GONE_MS = 2200; // TUNE

/** Draw about 30 frames a second while the squishy only breathes (tech spec §6). */
export const BREATHING_FRAME_MS = 33;
