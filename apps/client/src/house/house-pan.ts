import { TAP_MAX_MOVE_PX } from '../map/tap-detector.js';
import {
  chevronBox,
  fitHouse,
  framedFocus,
  panPerPixel,
  panPose,
  panRange,
  residentBoxes,
  type FramedSpot,
  type HousePose,
  type HouseViewport,
  type ScreenBox,
} from './house-camera.js';
import type { HouseBounds } from './house-layout.js';

/*
 * The dollhouse's sideways drag on a tall phone (#381 B4), apart from the
 * screen so it's unit-tested. A fit does the costly work once (the framing
 * that keeps the frame's edges between residents, the trees round the
 * clearing); a drag only slides the fitted pose, gathered per frame, and
 * the trees are re-framed when the finger lifts (review: a full refit per
 * pointermove took 6–28 ms).
 */

/** What a fit needs, read once from the screen and the scene. */
export interface PanMeasure {
  readonly vp: HouseViewport;
  readonly bounds: HouseBounds;
  readonly room: Pick<HouseBounds, 'minX' | 'maxX'> | null;
  readonly spots: readonly FramedSpot[];
}

/** The dollhouse pose now, and where the "more this way" chevrons sit. */
export interface PanFrame {
  readonly base: HousePose;
  readonly cues: { readonly left: ScreenBox; readonly right: ScreenBox };
}

export interface HousePanDeps {
  /** Reads the viewport and the scene (once per fit). */
  readonly measure: () => PanMeasure;
  /** Re-frames the trees round the clearing for a pose (costly: once per fit or lift). */
  readonly frameOutside: (pose: HousePose, vp: HouseViewport) => void;
  /** The edge-between-residents framing (a seam for tests). */
  readonly framedFocus?: typeof framedFocus;
}

export interface HousePan {
  /** Fits the dollhouse to the screen as it is now, keeping the drag inside the new limits. */
  fit(): PanFrame;
  /**
   * A finger (pointer `id`) went down at `x` (CSS px). A second finger stops
   * the drag: only a lone finger slides the house.
   */
  down(x: number, id?: number): void;
  /**
   * Finger `id` moved: true once it's dragging (past a tap's slop), when a
   * frame should be drawn. After a second finger lifts, the one left starts
   * a fresh drag where it is (B4 review: it jumped by the gap between them).
   */
  move(x: number, id?: number): boolean;
  /** The frame's slide, if a drag moved it since the last one (null if not). */
  step(): PanFrame | null;
  /**
   * Finger `id` lifted: any last slide, and once the last finger is up, the
   * trees catch up if it dragged.
   */
  up(id?: number): PanFrame | null;
  /** Back to the fit (a new house opens). */
  reset(): void;
  readonly pan: number;
  readonly limits: { readonly min: number; readonly max: number };
}

export function createHousePan(deps: HousePanDeps): HousePan {
  const focusFor = deps.framedFocus ?? framedFocus;
  let fitted: HousePose | null = null;
  let measured: PanMeasure | null = null;
  let limits = { min: 0, max: 0 };
  let pan = 0;
  let base: HousePose | null = null;
  /** The fingers down now, by pointer id. */
  const down = new Set<number>();
  /** The dragging finger: its id, where it went down, where it was last, whether it's dragging. */
  let finger: { id: number; start: number; last: number; dragging: boolean } | null = null;
  let pending = 0;
  let dragged = false;

  const frame = (): PanFrame => {
    if (!fitted || !measured) throw new Error('pan before fit');
    pan = Math.min(limits.max, Math.max(limits.min, pan));
    base = panPose(fitted, pan);
    const faces = residentBoxes(base, measured.vp, measured.spots);
    return {
      base,
      cues: {
        left: chevronBox('left', measured.vp, faces),
        right: chevronBox('right', measured.vp, faces),
      },
    };
  };

  return {
    fit() {
      const m = deps.measure();
      measured = m;
      const focus = focusFor(m.bounds, m.vp, m.room, m.spots);
      fitted = fitHouse(m.bounds, m.vp, undefined, focus);
      limits = panRange(m.bounds, m.vp, focus);
      const out = frame();
      deps.frameOutside(out.base, m.vp);
      return out;
    },
    down(x, id = 0) {
      down.add(id);
      finger = down.size === 1 ? { id, start: x, last: x, dragging: false } : null;
    },
    move(x, id = 0) {
      if (down.size !== 1 || !down.has(id)) return false;
      // The finger left after a pinch: a new drag from here, never a jump.
      if (finger?.id !== id) {
        finger = { id, start: x, last: x, dragging: false };
        return false;
      }
      if (!finger.dragging) {
        // A tap's jitter never slides the house.
        if (Math.abs(x - finger.start) <= TAP_MAX_MOVE_PX) return false;
        finger.dragging = true;
        finger.last = x;
        return true;
      }
      pending += x - finger.last;
      finger.last = x;
      return true;
    },
    step() {
      if (pending === 0 || !fitted || !measured) return null;
      pan -= pending * panPerPixel(fitted, measured.vp);
      pending = 0;
      dragged = true;
      return frame();
    },
    up(id = 0) {
      down.delete(id);
      if (finger?.id === id || down.size !== 1) finger = null;
      const last = this.step();
      if (down.size > 0 || !dragged || !base || !measured) return last;
      dragged = false;
      deps.frameOutside(base, measured.vp);
      return last ?? frame();
    },
    reset() {
      pan = 0;
      pending = 0;
      finger = null;
      down.clear();
      dragged = false;
    },
    get pan() {
      return pan;
    },
    get limits() {
      return limits;
    },
  };
}
