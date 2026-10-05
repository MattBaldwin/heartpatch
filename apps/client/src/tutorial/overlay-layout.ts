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
/** Room between Sprout's bubble and the screen edges or the spotlight. */
export const BUBBLE_MARGIN = 16;
/** The bubble's widest (tutorial.css `.tutorial-bubble` max-width). */
export const BUBBLE_MAX_WIDTH = 460;
/** Narrower than this, a bubble beside the spotlight is too cramped to read. */
const BUBBLE_MIN_WIDTH = 180; // TUNE

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
  /**
   * Exactly where the bubble goes when there's a spotlight: never over the
   * hole (the owner's rule: Sprout never covers what it's talking about).
   * Null: no spotlight, so the stylesheet places it.
   */
  readonly bubbleRect: Rect | null;
  /** Where the arrow tip touches the hole, and which way it points. */
  readonly arrow: { readonly x: number; readonly y: number; readonly points: 'up' | 'down' } | null;
}

const clamp = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), Math.max(min, max));

/** True when the two rects share any area (touching edges don't count). */
export function intersects(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

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
 * `talkOnly` steps (and loading, errors) block everything: the only way on is
 * through Sprout's bubble, which always has a button. Any other step without
 * a spotlight leaves input open, so the player can never be trapped.
 */
export function layoutOverlay(spec: {
  target: Rect | null;
  talkOnly: boolean;
  viewport: Size;
  insets: Insets;
  /** The bubble as drawn now (its words set its height); a guess before it's measured. */
  bubbleSize?: Size;
  /** Tucked away into a small chip (a gameplay step after "Let's go!"). */
  tucked?: boolean;
}): OverlayLayout {
  const { viewport, insets } = spec;
  const whole: Rect = { x: 0, y: 0, width: viewport.width, height: viewport.height };
  const hole = spec.target ? holeFor(spec.target, viewport) : null;

  if (!hole) {
    const gate: GateMode = spec.talkOnly ? 'blockAll' : 'open';
    return {
      gate,
      hole: null,
      blockers: gate === 'blockAll' ? [whole] : [],
      bubble: 'bottom',
      bubbleRect: null,
      arrow: null,
    };
  }

  const holeCenterY = hole.y + hole.height / 2;
  // The bubble goes on the side with more room, and the arrow points across.
  const prefer =
    holeCenterY > (viewport.height + insets.top - insets.bottom) / 2 ? 'top' : 'bottom';
  const bubbleRect = placeBubble({
    hole,
    prefer,
    viewport,
    insets,
    size: spec.bubbleSize ?? { width: BUBBLE_MAX_WIDTH, height: 200 },
    tucked: spec.tucked ?? false,
  });
  const bubble = bubbleRect.y + bubbleRect.height / 2 < holeCenterY ? 'top' : 'bottom';
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
    bubbleRect,
    arrow:
      bubble === 'top'
        ? { x, y: hole.y, points: 'down' }
        : { x, y: hole.y + hole.height, points: 'up' },
  };
}

/**
 * Where Sprout's bubble goes so it never covers the spotlight: the preferred
 * edge of the screen, then the other edge, then beside the hole. A tucked
 * chip tries its own spot on the left first. If nothing fits whole, it
 * shrinks into the bigger gap above or below the hole and scrolls.
 */
export function placeBubble(spec: {
  hole: Rect;
  prefer: 'top' | 'bottom';
  viewport: Size;
  insets: Insets;
  size: Size;
  tucked: boolean;
}): Rect {
  const { hole, viewport, insets, size } = spec;
  const left = insets.left + BUBBLE_MARGIN;
  const right = viewport.width - insets.right - BUBBLE_MARGIN;
  const top = insets.top + BUBBLE_MARGIN;
  const bottom = viewport.height - insets.bottom - BUBBLE_MARGIN;
  // A full bubble is as wide as the stylesheet lets it be; a chip keeps its size.
  const width = Math.min(spec.tucked ? size.width : BUBBLE_MAX_WIDTH, right - left);
  // Narrower means taller: the same words wrap onto more lines.
  const heightAt = (w: number) => Math.ceil((size.height * size.width) / Math.max(w, 1));
  const height = heightAt(width);
  const x = spec.tucked ? insets.left + 8 : left + (right - left - width) / 2;
  const atTop: Rect = { x, y: top, width, height };
  const atBottom: Rect = { x, y: bottom - height, width, height };

  const candidates: Rect[] = [];
  if (spec.tucked) {
    // The chip's own place (tutorial.css `.tutorial-tucked`): left side, 38%
    // down; else just above or below the hole, clear of the corner buttons.
    candidates.push(
      { x, y: Math.round(viewport.height * 0.38), width, height },
      { x, y: Math.max(top, hole.y - BUBBLE_MARGIN - height), width, height },
      { x, y: Math.min(bottom - height, hole.y + hole.height + BUBBLE_MARGIN), width, height },
    );
  }
  candidates.push(...(spec.prefer === 'top' ? [atTop, atBottom] : [atBottom, atTop]));
  // Beside the hole, on whichever side has more room.
  const roomLeft = hole.x - BUBBLE_MARGIN - left;
  const roomRight = right - (hole.x + hole.width + BUBBLE_MARGIN);
  const besideWidth = Math.min(width, Math.max(roomLeft, roomRight));
  if (besideWidth >= Math.min(BUBBLE_MIN_WIDTH, width)) {
    const besideHeight = heightAt(besideWidth);
    candidates.push({
      x:
        roomRight >= roomLeft
          ? hole.x + hole.width + BUBBLE_MARGIN
          : hole.x - BUBBLE_MARGIN - besideWidth,
      y: clamp(hole.y + hole.height / 2 - besideHeight / 2, top, bottom - besideHeight),
      width: besideWidth,
      height: besideHeight,
    });
  }
  const fits = candidates.find((c) => !intersects(c, hole));
  if (fits) return fits;
  // Nowhere fits whole: the bigger gap above or below the hole, and the
  // bubble scrolls inside it (tutorial-overlay.ts caps its height).
  const above = hole.y - BUBBLE_MARGIN - top;
  const below = bottom - (hole.y + hole.height + BUBBLE_MARGIN);
  return above >= below
    ? { x, y: top, width, height: Math.max(0, above) }
    : { x, y: hole.y + hole.height + BUBBLE_MARGIN, width, height: Math.max(0, below) };
}
