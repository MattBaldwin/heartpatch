// Where the tutorial overlay puts its pieces (tech spec §6 "Tutorial UI
// layer"): the spotlight hole over the target, the input blockers around it,
// Sprout's bubble and the arrow. Pure geometry in CSS pixels, so it's
// unit-tested; tutorial-overlay.ts applies it to the DOM.

export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface Size {
  readonly width: number;
  readonly height: number;
}

/** Space the safe areas (notch, home bar) take, from `env(safe-area-inset-*)`. */
export interface Insets {
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
  readonly left: number;
}

export const SPOTLIGHT_PADDING = 10; // TUNE: breathing room around the target
/** Never a hole smaller than a tap target (style guide §3.2: 44 pt). */
export const MIN_HOLE = 56; // TUNE
/** Keeps the arrow off the rounded screen corners. */
const ARROW_MARGIN = 28;

/**
 * - `blockAll`: nothing behind the overlay takes input (Sprout is just talking).
 * - `spotlight`: only the hole takes input; the rest is blocked.
 * - `open`: nothing is blocked (the target isn't on screen, so never trap the player).
 */
export type GateMode = 'blockAll' | 'spotlight' | 'open';

export interface OverlayLayout {
  readonly gate: GateMode;
  /** The lit hole around the target, or null. */
  readonly hole: Rect | null;
  /** Areas that swallow taps (the hole is left out of them). */
  readonly blockers: readonly Rect[];
  /** Sprout's bubble sits at the top or bottom of the screen, away from the hole. */
  readonly bubble: 'top' | 'bottom';
  /** Where the arrow tip touches the hole, and which way it points. */
  readonly arrow: { readonly x: number; readonly y: number; readonly points: 'up' | 'down' } | null;
}

const clamp = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), Math.max(min, max));

/** The target grown by the padding (and to a tappable size), kept on screen. */
export function holeFor(target: Rect, viewport: Size): Rect | null {
  const width = Math.max(target.width + SPOTLIGHT_PADDING * 2, MIN_HOLE);
  const height = Math.max(target.height + SPOTLIGHT_PADDING * 2, MIN_HOLE);
  const cx = target.x + target.width / 2;
  const cy = target.y + target.height / 2;
  const x0 = Math.max(0, cx - width / 2);
  const y0 = Math.max(0, cy - height / 2);
  const x1 = Math.min(viewport.width, cx + width / 2);
  const y1 = Math.min(viewport.height, cy + height / 2);
  // Entirely off screen (or squeezed to nothing): there's nothing to point at.
  if (x1 - x0 < 1 || y1 - y0 < 1) return null;
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}

/** Four rects covering the viewport except `hole` (empty ones left out). */
export function blockersAround(hole: Rect, viewport: Size): Rect[] {
  const right = hole.x + hole.width;
  const bottom = hole.y + hole.height;
  return [
    { x: 0, y: 0, width: viewport.width, height: hole.y },
    { x: 0, y: bottom, width: viewport.width, height: viewport.height - bottom },
    { x: 0, y: hole.y, width: hole.x, height: hole.height },
    { x: right, y: hole.y, width: viewport.width - right, height: hole.height },
  ].filter((r) => r.width > 0 && r.height > 0);
}

/**
 * Lays the overlay out for one step. `target` is the target's on-screen rect,
 * or null when the step has no target (`none`) or it can't be found.
 * `talkOnly` steps block everything: the only way on is through Sprout.
 */
export function layoutOverlay(spec: {
  target: Rect | null;
  hasTarget: boolean;
  talkOnly: boolean;
  viewport: Size;
  insets: Insets;
}): OverlayLayout {
  const { viewport, insets } = spec;
  const whole: Rect = { x: 0, y: 0, width: viewport.width, height: viewport.height };
  const hole = spec.target ? holeFor(spec.target, viewport) : null;

  if (!hole) {
    // A gameplay step whose target isn't on screen must not trap the player.
    const gate: GateMode = spec.talkOnly || !spec.hasTarget ? 'blockAll' : 'open';
    return {
      gate,
      hole: null,
      blockers: gate === 'blockAll' ? [whole] : [],
      bubble: 'bottom',
      arrow: null,
    };
  }

  const holeCenterY = hole.y + hole.height / 2;
  // The bubble goes on the side with more room, and the arrow points across.
  const bubble =
    holeCenterY > (viewport.height + insets.top - insets.bottom) / 2 ? 'top' : 'bottom';
  const x = clamp(
    hole.x + hole.width / 2,
    insets.left + ARROW_MARGIN,
    viewport.width - insets.right - ARROW_MARGIN,
  );
  return {
    gate: 'spotlight',
    hole,
    blockers: blockersAround(hole, viewport),
    bubble,
    arrow:
      bubble === 'top'
        ? { x, y: hole.y, points: 'down' }
        : { x, y: hole.y + hole.height, points: 'up' },
  };
}
