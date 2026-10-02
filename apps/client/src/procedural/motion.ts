import type { QualityTier } from '../engine/config.js';
import { SQUISH, SQUISH_MOVE_CODE, type SquishMove, type SquishyLod } from './config.js';

/**
 * CPU-side bookkeeping for squish moves and detail levels. The shader does
 * the motion; this only knows when a move is running, so render-on-demand
 * keeps drawing exactly as long as something moves.
 */

export interface SquishEvent {
  readonly move: SquishMove;
  /** Seconds on the field's squishy clock. */
  readonly start: number;
  readonly strength: number;
}

/** The `squishEvent` attribute: start time, kind code, strength. */
export function eventAttribute(event: SquishEvent | null): [number, number, number, number] {
  return event ? [event.start, SQUISH_MOVE_CODE[event.move], event.strength, 0] : [0, 0, 0, 0];
}

/** True while the move is still playing at `now` (seconds). */
export function eventRunning(event: SquishEvent | null, now: number): boolean {
  return event !== null && now >= event.start && now < event.start + SQUISH.duration[event.move];
}

/** Where squishies are seen: the map (many, small) or a close-up (care, wardrobe, battle). */
export type SquishyView = 'map' | 'closeUp';

/**
 * The detail level for a view on a quality tier. The map always uses `low`;
 * close-ups use `high` unless the device has dropped to the low tier.
 */
export function lodFor(view: SquishyView, tier: QualityTier): SquishyLod {
  return view === 'closeUp' && tier !== 'low' ? 'high' : 'low';
}
