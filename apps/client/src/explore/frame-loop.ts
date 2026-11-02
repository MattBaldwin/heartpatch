/**
 * Explore's own frame loop: one `requestAnimationFrame` chain at most, ever.
 *
 * The screen draws every frame while the Keeper walks or a gesture plays,
 * then stops. Anything may ask for frames (`wake`), including code the frame
 * itself runs (a held gesture's tick feeds the gesture, which wakes the loop).
 * A wake during a frame only notes that another frame is wanted; the frame's
 * end books the next one, once. Before this, a wake inside the frame booked a
 * frame and the frame's end booked another, so a held log or easy button
 * doubled the chains every frame (65,000 callbacks in one 900 ms hold).
 */

export interface FrameLoop {
  /** Asks for a frame soon (no-op while one is booked; noted while one runs). */
  wake: () => void;
  /** Cancels the booked frame, if any. */
  stop: () => void;
  /** A frame is booked. */
  readonly pending: boolean;
}

export interface FrameLoopOptions {
  /** One frame's work; true asks for the next frame. */
  frame: (now: number) => boolean;
  /** Whether frames may run at all (a closed screen books none). */
  live: () => boolean;
  /** A new chain starts (the screen resets its frame clock). */
  onStart?: () => void;
  raf?: (cb: FrameRequestCallback) => number;
  caf?: (id: number) => void;
}

export function createFrameLoop(options: FrameLoopOptions): FrameLoop {
  const raf = options.raf ?? ((cb: FrameRequestCallback) => requestAnimationFrame(cb));
  const caf =
    options.caf ??
    ((id: number) => {
      cancelAnimationFrame(id);
    });
  let id = 0;
  let running = false;
  let wanted = false;

  const book = (): void => {
    id = raf(run);
  };

  function run(now: number): void {
    id = 0;
    running = true;
    let more: boolean;
    try {
      more = options.frame(now);
    } finally {
      running = false;
    }
    // A frame booked meanwhile (none can be, but never two chains) wins.
    if (id === 0 && (more || wanted) && options.live()) book();
    wanted = false;
  }

  return {
    wake: () => {
      if (running) {
        wanted = true;
        return;
      }
      if (id === 0 && options.live()) {
        options.onStart?.();
        book();
      }
    },
    stop: () => {
      if (id !== 0) caf(id);
      id = 0;
      wanted = false;
    },
    get pending() {
      return id !== 0;
    },
  };
}
