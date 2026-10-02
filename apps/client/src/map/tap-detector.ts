// Tells a tap on the map apart from the camera's pan and pinch, which share
// the same pointers (MapCamera owns the gestures; this only listens).

/** A tap moves less than this, in CSS pixels. */
export const TAP_MAX_MOVE_PX = 10; // TUNE
/** And lifts within this long. */
export const TAP_MAX_MS = 400; // TUNE

export interface PointerSample {
  readonly id: number;
  /** CSS pixels from the canvas's top left. */
  readonly x: number;
  readonly y: number;
  /** Event time, ms. */
  readonly t: number;
}

/**
 * Feed it pointer events; it calls `onTap` for a quick, still, one-finger
 * press. A second finger (a pinch) or any drag cancels the tap.
 */
export class TapDetector {
  private readonly down = new Set<number>();
  private candidate: PointerSample | null = null;
  private readonly onTap: (x: number, y: number) => void;

  constructor(onTap: (x: number, y: number) => void) {
    this.onTap = onTap;
  }

  pointerDown(p: PointerSample): void {
    this.down.add(p.id);
    this.candidate = this.down.size === 1 ? p : null;
  }

  pointerMove(p: PointerSample): void {
    const c = this.candidate;
    if (c?.id !== p.id) return;
    if (Math.abs(p.x - c.x) > TAP_MAX_MOVE_PX || Math.abs(p.y - c.y) > TAP_MAX_MOVE_PX) {
      this.candidate = null;
    }
  }

  pointerUp(p: PointerSample): void {
    this.down.delete(p.id);
    const c = this.candidate;
    if (c?.id !== p.id) return;
    this.candidate = null;
    const still = Math.abs(p.x - c.x) <= TAP_MAX_MOVE_PX && Math.abs(p.y - c.y) <= TAP_MAX_MOVE_PX;
    if (still && p.t - c.t <= TAP_MAX_MS) this.onTap(c.x, c.y);
  }

  pointerCancel(p: PointerSample): void {
    this.down.delete(p.id);
    if (this.candidate?.id === p.id) this.candidate = null;
  }
}

/** Wires a detector to a canvas's pointer events until `signal` aborts. */
export function listenForTaps(
  canvas: HTMLCanvasElement,
  onTap: (x: number, y: number) => void,
  signal: AbortSignal,
): void {
  const taps = new TapDetector(onTap);
  const sample = (e: PointerEvent): PointerSample => {
    const rect = canvas.getBoundingClientRect();
    return { id: e.pointerId, x: e.clientX - rect.left, y: e.clientY - rect.top, t: e.timeStamp };
  };
  canvas.addEventListener(
    'pointerdown',
    (e) => {
      taps.pointerDown(sample(e));
    },
    { signal },
  );
  canvas.addEventListener(
    'pointermove',
    (e) => {
      taps.pointerMove(sample(e));
    },
    { signal },
  );
  canvas.addEventListener(
    'pointerup',
    (e) => {
      taps.pointerUp(sample(e));
    },
    { signal },
  );
  canvas.addEventListener(
    'pointercancel',
    (e) => {
      taps.pointerCancel(sample(e));
    },
    { signal },
  );
}
