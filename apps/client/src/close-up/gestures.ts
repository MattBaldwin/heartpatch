import { GESTURE } from './close-up-config.js';

/*
 * Reads the close-up's touch gestures (design doc §20) from raw pointer
 * samples: tap to boop, stroke to pet, pinch to tickle, swipe down to go
 * back. Pure (positions and times come in), so it's unit-tested without a
 * DOM. Dragging a treat starts on the Feed button and is handled there.
 */

export type Gesture = 'boop' | 'stroke' | 'tickle' | 'back';

export interface GesturePoint {
  readonly id: number;
  /** CSS pixels from the view's top left. */
  readonly x: number;
  readonly y: number;
  /** Event time, ms. */
  readonly t: number;
}

/** The squishy on screen: an ellipse in CSS pixels. */
export interface ScreenTarget {
  readonly x: number;
  readonly y: number;
  readonly rx: number;
  readonly ry: number;
}

/** True when a point is on the squishy (with a little slop for small fingers). */
export function onTarget(
  target: ScreenTarget,
  x: number,
  y: number,
  slop: number = GESTURE.hitSlop,
): boolean {
  const rx = target.rx * (1 + slop);
  const ry = target.ry * (1 + slop);
  if (rx <= 0 || ry <= 0) return false;
  const dx = (x - target.x) / rx;
  const dy = (y - target.y) / ry;
  return dx * dx + dy * dy <= 1;
}

interface Track {
  readonly start: GesturePoint;
  last: GesturePoint;
  /** Path travelled while over the squishy. */
  overPx: number;
  readonly startedOn: boolean;
}

/**
 * Feed it pointer events; `onGesture` fires once per recognised gesture.
 * One finger: a quick still press on the squishy is a boop; travelling over
 * it is a stroke (once per touch); a quick drag down that didn't start on it
 * goes back. Two fingers: a pinch near the squishy is a tickle (once per
 * pinch). A second finger cancels the first finger's boop or stroke.
 */
export class GestureReader {
  readonly #tracks = new Map<number, Track>();
  readonly #onGesture: (gesture: Gesture, at: GesturePoint) => void;
  readonly #target: () => ScreenTarget;
  /** Set once the current touch (or pinch) has counted, so it counts once. */
  #done = false;
  #pinchStart: number | null = null;

  constructor(target: () => ScreenTarget, onGesture: (gesture: Gesture, at: GesturePoint) => void) {
    this.#target = target;
    this.#onGesture = onGesture;
  }

  /** Fingers on screen now. */
  get fingers(): number {
    return this.#tracks.size;
  }

  down(p: GesturePoint): void {
    if (this.#tracks.size === 0) this.#done = false;
    this.#tracks.set(p.id, {
      start: p,
      last: p,
      overPx: 0,
      startedOn: onTarget(this.#target(), p.x, p.y),
    });
    if (this.#tracks.size === 2) this.#pinchStart = this.#gap();
  }

  move(p: GesturePoint): void {
    const track = this.#tracks.get(p.id);
    if (!track) return;
    const target = this.#target();
    const step = Math.hypot(p.x - track.last.x, p.y - track.last.y);
    if (onTarget(target, p.x, p.y) && onTarget(target, track.last.x, track.last.y)) {
      track.overPx += step;
    }
    track.last = p;
    if (this.#done) return;

    if (this.#tracks.size === 2 && this.#pinchStart !== null && this.#pinchStart > 0) {
      const gap = this.#gap();
      const mid = this.#middle();
      const change = Math.abs(gap - this.#pinchStart) / this.#pinchStart;
      if (change >= GESTURE.pinchRatio && onTarget(target, mid.x, mid.y, GESTURE.hitSlop * 2)) {
        this.#done = true;
        this.#onGesture('tickle', { ...mid, id: p.id, t: p.t });
      }
      return;
    }
    if (this.#tracks.size === 1 && track.overPx >= GESTURE.strokePx) {
      this.#done = true;
      this.#onGesture('stroke', p);
    }
  }

  up(p: GesturePoint): void {
    const track = this.#tracks.get(p.id);
    if (!track) return;
    this.#tracks.delete(p.id);
    if (this.#tracks.size > 0) {
      // One finger of a pinch lifted: nothing else counts until all are up.
      this.#done = true;
      this.#pinchStart = null;
      return;
    }
    this.#pinchStart = null;
    if (this.#done) return;
    const dx = p.x - track.start.x;
    const dy = p.y - track.start.y;
    const ms = p.t - track.start.t;
    const still = Math.abs(dx) <= GESTURE.tapMovePx && Math.abs(dy) <= GESTURE.tapMovePx;
    if (still && ms <= GESTURE.tapMs && track.startedOn) {
      this.#done = true;
      this.#onGesture('boop', track.start);
      return;
    }
    const down = dy >= GESTURE.swipePx && dy >= 2 * Math.abs(dx) && ms <= GESTURE.swipeMs;
    if (down && !track.startedOn) {
      this.#done = true;
      this.#onGesture('back', p);
    }
  }

  cancel(p: GesturePoint): void {
    this.#tracks.delete(p.id);
    this.#pinchStart = null;
    this.#done = true;
  }

  /** Forgets every finger (the view closed or lost focus). */
  reset(): void {
    this.#tracks.clear();
    this.#pinchStart = null;
    this.#done = true;
  }

  #points(): GesturePoint[] {
    return [...this.#tracks.values()].map((t) => t.last);
  }

  #gap(): number {
    const [a, b] = this.#points();
    return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
  }

  #middle(): { x: number; y: number } {
    const [a, b] = this.#points();
    return a && b ? { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } : { x: 0, y: 0 };
  }
}
