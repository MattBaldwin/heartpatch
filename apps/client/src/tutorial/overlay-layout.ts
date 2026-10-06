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
 * - `guide`: the hole is lit and the arrow points, but nothing is blocked: the
 *   target is only the next thing to tap, not what finishes the step (#140).
 * - `open`: nothing is blocked (the target isn't on screen, so never trap the player).
 */
export type GateMode = 'blockAll' | 'spotlight' | 'guide' | 'open';

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
  /**
   * The target only guides (a step that needs more than one tap, like
   * building then fuelling a fire): lit and pointed at, never gated.
   */
  soft?: boolean;
  /**
   * The open sheet Sprout is peeking over (no target while it waits): the
   * bubble keeps clear of it where it can, and never covers it whole.
   */
  avoid?: Rect | null;
}): OverlayLayout {
  const { viewport, insets } = spec;
  const whole: Rect = { x: 0, y: 0, width: viewport.width, height: viewport.height };
  const hole = spec.target ? holeFor(spec.target, viewport) : null;

  if (!hole) {
    const gate: GateMode = spec.talkOnly ? 'blockAll' : 'open';
    // A peek over a sheet: the bigger gap beside it (the top when it's a
    // toss-up, since a sheet keeps its buttons at its foot).
    const avoid = spec.avoid;
    const below = Math.max(
      0,
      avoid ? viewport.height - insets.bottom - (avoid.y + avoid.height) : 0,
    );
    const above = Math.max(0, avoid ? avoid.y - insets.top : 0);
    const peek = avoid
      ? placeBubble({
          hole: avoid,
          prefer: below > above ? 'bottom' : 'top',
          viewport,
          insets,
          size: spec.bubbleSize ?? { width: BUBBLE_MAX_WIDTH, height: 200 },
          tucked: false,
          shrink: false,
        })
      : null;
    return {
      gate,
      hole: null,
      blockers: gate === 'blockAll' ? [whole] : [],
      bubble: peek && peek.y + peek.height / 2 < viewport.height / 2 ? 'top' : 'bottom',
      bubbleRect: peek,
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
  const soft = spec.soft ?? false;
  return {
    gate: soft ? 'guide' : 'spotlight',
    hole,
    blockers: soft ? [] : blockersAround(hole, viewport),
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
  /** When nothing fits whole: shrink into the bigger gap (default), or take the preferred edge whole. */
  shrink?: boolean;
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
  // Its usual place at the bottom whenever it fits there whole, so it covers
  // the corner buttons only when the target leaves no other room.
  candidates.push(
    ...(spec.prefer === 'top' && intersects(atBottom, hole)
      ? [atTop, atBottom]
      : [atBottom, atTop]),
  );
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
  if (spec.shrink === false) return spec.prefer === 'top' ? atTop : atBottom;
  // Nowhere fits whole: the bigger gap above or below the hole, and the
  // bubble scrolls inside it (tutorial-overlay.ts caps its height).
  const above = hole.y - BUBBLE_MARGIN - top;
  const below = bottom - (hole.y + hole.height + BUBBLE_MARGIN);
  return above >= below
    ? { x, y: top, width, height: Math.max(0, above) }
    : { x, y: hole.y + hole.height + BUBBLE_MARGIN, width, height: Math.max(0, below) };
}

/** Sprout's orb while a sheet is open (tutorial.css `.tutorial-held`). */
export const ORB_SIZE = 48;
/** Room between the orb and the screen edge or the safe area. */
const ORB_MARGIN = 8;

/** How much of `a` lies inside `b`, in square pixels. */
function overlap(a: Rect, b: Rect): number {
  const w = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
}

/**
 * Where Sprout's orb sits while it waits for a sheet to close (#139): a spot
 * at the screen's edge clear of every obstacle (the sheet's card, every
 * button on screen), trying the corners first and then down each side. If
 * nothing is clear (a sheet that fills the phone), the spot it covers least.
 */
export function placeOrb(spec: {
  viewport: Size;
  insets: Insets;
  obstacles: readonly Rect[];
  size?: number;
}): Rect {
  const { viewport, insets } = spec;
  const size = spec.size ?? ORB_SIZE;
  const left = insets.left + ORB_MARGIN;
  const right = viewport.width - insets.right - ORB_MARGIN - size;
  const top = insets.top + ORB_MARGIN;
  const at = (x: number, y: number): Rect => ({
    x,
    y: Math.min(Math.max(y, top), viewport.height - insets.bottom - ORB_MARGIN - size),
    width: size,
    height: size,
  });
  // The corners, then the sides at the chip's own height (38%), then a
  // little above and below it, never as low as the tray handles (55%).
  const corner = at(left, top);
  const candidates = [
    at(right, top),
    ...[0.38, 0.24, 0.3, 0.14].flatMap((share) => [
      at(left, Math.round(viewport.height * share)),
      at(right, Math.round(viewport.height * share)),
    ]),
  ];
  let best = corner;
  let least = Number.POSITIVE_INFINITY;
  for (const candidate of [corner, ...candidates]) {
    const covered = spec.obstacles.reduce((sum, o) => sum + overlap(candidate, o), 0);
    if (covered === 0) return candidate;
    if (covered < least) {
      least = covered;
      best = candidate;
    }
  }
  return best;
}

/**
 * The tucked chip never covers a sheet the step is using (a tray on the
 * step's route, the care sheet): if `chip` overlaps one of the `sheets`'
 * cards, it docks into Sprout's orb at a spot clear of them and of the
 * `obstacles` (placeOrb). Null: the chip stays where it is.
 */
export function dockChip(spec: {
  chip: Rect;
  sheets: readonly Rect[];
  viewport: Size;
  insets: Insets;
  obstacles: readonly Rect[];
}): Rect | null {
  if (!spec.sheets.some((sheet) => intersects(spec.chip, sheet))) return null;
  return placeOrb({
    viewport: spec.viewport,
    insets: spec.insets,
    obstacles: [...spec.sheets, ...spec.obstacles],
  });
}

/** The smallest rect holding all of `rects` (null for none). */
export function union(rects: readonly Rect[]): Rect | null {
  const first = rects[0];
  if (!first) return null;
  let x0 = first.x;
  let y0 = first.y;
  let x1 = first.x + first.width;
  let y1 = first.y + first.height;
  for (const r of rects) {
    x0 = Math.min(x0, r.x);
    y0 = Math.min(y0, r.y);
    x1 = Math.max(x1, r.x + r.width);
    y1 = Math.max(y1, r.y + r.height);
  }
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}
