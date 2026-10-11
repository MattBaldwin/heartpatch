// Where the home's mood bubbles go (#393), pure so tests read it without a
// renderer. Every squishy on screen has a face box (from its head's top down
// part of its height). Each bubble starts just over its own squishy's head;
// if it would cover a real share of another squishy's face (or a bubble
// already placed), it slides a little sideways, its tail still pointing at
// its own head, and then climbs on a stem, never letting the stem cross a
// face. With no clear spot within `maxLift` it hides, so it never sits on
// another squishy's face or reads as theirs. Squishies nearest the camera go
// first and keep their spot. Works in reused typed arrays: nothing is
// allocated per frame.

export interface MoodLayoutSize {
  /** A bubble's width and height on screen, CSS px (its tail not included). */
  readonly width: number;
  readonly height: number;
  /** Space between a squishy's head and its bubble's tail tip, CSS px. */
  readonly gap: number;
  /** How far a bubble may climb past its spot before it hides instead, CSS px. */
  readonly maxLift: number;
  /** How far it climbs each try, CSS px. */
  readonly step: number;
  /** How far it may slide sideways off its head (its tail stays over the head), CSS px. */
  readonly slide: number;
  /** A face box's width, as a share of the squishy's height on screen. */
  readonly faceWidth: number;
  /** A face box's height, from the head's top, as a share of the squishy's height on screen. */
  readonly faceHeight: number;
  /** A bubble (or its stem) is in the way when it covers more than this share of a face box. */
  readonly faceCover: number;
}

/** One frame's squishies on screen, nearest the camera first. Grow with `ensure`. */
export interface MoodLayoutFrame {
  count: number;
  /** Head top and feet, CSS px; x is the middle. */
  x: Float32Array;
  top: Float32Array;
  foot: Float32Array;
  /** 1 when this squishy has a bubble. */
  marked: Uint8Array;
  /** 1 when its face can be seen (one tucked inside its habitat can't), so a bubble must keep clear of it. */
  face: Uint8Array;
  /** Out: the bubble's middle and bottom (tail tip), and whether it hides (no clear spot). */
  bx: Float32Array;
  y: Float32Array;
  hidden: Uint8Array;
}

export function createMoodLayoutFrame(capacity = 16): MoodLayoutFrame {
  return {
    count: 0,
    x: new Float32Array(capacity),
    top: new Float32Array(capacity),
    foot: new Float32Array(capacity),
    marked: new Uint8Array(capacity),
    face: new Uint8Array(capacity),
    bx: new Float32Array(capacity),
    y: new Float32Array(capacity),
    hidden: new Uint8Array(capacity),
  };
}

/** Makes room for `n` squishies (only grows; rare, when squishies arrive). */
export function ensureMoodLayoutFrame(frame: MoodLayoutFrame, n: number): void {
  if (frame.x.length >= n) return;
  const next = createMoodLayoutFrame(Math.max(n, frame.x.length * 2));
  frame.x = next.x;
  frame.top = next.top;
  frame.foot = next.foot;
  frame.marked = next.marked;
  frame.face = next.face;
  frame.bx = next.bx;
  frame.y = next.y;
  frame.hidden = next.hidden;
}

/** How much of box b (its area) box a covers, 0–1. */
function covers(
  ax0: number,
  ay0: number,
  ax1: number,
  ay1: number,
  bx0: number,
  by0: number,
  bx1: number,
  by1: number,
): number {
  const w = Math.min(ax1, bx1) - Math.max(ax0, bx0);
  const h = Math.min(ay1, by1) - Math.max(ay0, by0);
  const area = (bx1 - bx0) * (by1 - by0);
  return w > 0 && h > 0 && area > 0 ? (w * h) / area : 0;
}

function overlaps(
  ax0: number,
  ay0: number,
  ax1: number,
  ay1: number,
  bx0: number,
  by0: number,
  bx1: number,
  by1: number,
): boolean {
  return ax0 < bx1 && bx0 < ax1 && ay0 < by1 && by0 < ay1;
}

/**
 * Is a bubble for squishy `i`, its middle at `mid` and its bottom at
 * `bottom`, clear of faces and of nearer squishies' bubbles?
 */
function clearAt(
  frame: MoodLayoutFrame,
  size: MoodLayoutSize,
  i: number,
  mid: number,
  bottom: number,
): boolean {
  const { count, x, top, foot, marked, face, bx, y, hidden } = frame;
  const half = size.width / 2;
  const x0 = mid - half;
  const x1 = mid + half;
  const y0 = bottom - size.height;
  // The stem from the bubble down to its own head, once it climbed past
  // its spot just over the head.
  const xi = x[i] ?? 0;
  const stemEnd = (top[i] ?? 0) - 1;
  const climbed = bottom < (top[i] ?? 0) - size.gap;
  for (let j = 0; j < count; j++) {
    if (j !== i && face[j]) {
      const xj = x[j] ?? 0;
      const tall = Math.max(0, (foot[j] ?? 0) - (top[j] ?? 0));
      const fw = (tall * size.faceWidth) / 2;
      const fy0 = top[j] ?? 0;
      const fy1 = fy0 + tall * size.faceHeight;
      // Covering a sliver of a face (often one already hidden behind its
      // neighbours) is fine; covering a real share of it is not. A stem
      // across a face never is.
      // (Either share: a real part of the face, or most of the bubble on a big face.)
      if (covers(x0, y0, x1, bottom, xj - fw, fy0, xj + fw, fy1) > size.faceCover) return false;
      if (covers(xj - fw, fy0, xj + fw, fy1, x0, y0, x1, bottom) > 0.5) return false;
      if (climbed && overlaps(xi - 1, bottom, xi + 1, stemEnd, xj - fw, fy0, xj + fw, fy1)) {
        return false;
      }
    }
    // Bubbles already placed (the nearer squishies went first).
    if (j < i && marked[j] && !hidden[j]) {
      const mj = bx[j] ?? 0;
      const by = y[j] ?? 0;
      if (overlaps(x0, y0, x1, bottom, mj - half, by - size.height, mj + half, by)) return false;
    }
  }
  return true;
}

/** Fills `frame.bx`, `frame.y` and `frame.hidden` for every marked squishy. */
export function layoutMoodMarks(frame: MoodLayoutFrame, size: MoodLayoutSize): void {
  const { count, x, top, marked, bx, y, hidden } = frame;
  for (let i = 0; i < count; i++) {
    if (!marked[i]) continue;
    const head = x[i] ?? 0;
    const base = (top[i] ?? 0) - size.gap;
    bx[i] = head;
    y[i] = base;
    hidden[i] = 1;
    search: for (let lift = 0; lift <= size.maxLift; lift += size.step) {
      // Straight up first, then a little to either side.
      for (let k = 0; k < 3; k++) {
        const mid = head + (k === 0 ? 0 : k === 1 ? -size.slide : size.slide);
        if (clearAt(frame, size, i, mid, base - lift)) {
          bx[i] = mid;
          y[i] = base - lift;
          hidden[i] = 0;
          break search;
        }
      }
    }
  }
}
