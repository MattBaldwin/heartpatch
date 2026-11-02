import { describe, expect, it } from 'vitest';
import { createFrameLoop, type FrameLoop } from './frame-loop.js';

/** A fake `requestAnimationFrame`: callbacks wait until `step` runs one frame. */
function fakeFrames() {
  let next = 1;
  let now = 0;
  let booked = 0;
  const queue = new Map<number, FrameRequestCallback>();
  return {
    raf: (cb: FrameRequestCallback) => {
      booked++;
      queue.set(next, cb);
      return next++;
    },
    caf: (id: number) => {
      queue.delete(id);
    },
    /** Runs every callback booked before this frame, as a browser does. */
    step: () => {
      now += 16;
      const due = [...queue];
      queue.clear();
      for (const [, cb] of due) cb(now);
    },
    get pending() {
      return queue.size;
    },
    get booked() {
      return booked;
    },
  };
}

/**
 * The explore screen's shape (explore-screen.ts `tick`): while a gesture is
 * held, each frame feeds it a tick and the feed wakes the loop, and the frame
 * itself asks for the next one too. `holding` stands for `holdSince !== null`.
 */
function heldScreen(frames: ReturnType<typeof fakeFrames>) {
  const screen = { holding: false, ticks: 0, starts: 0 };
  const loop: FrameLoop = createFrameLoop({
    frame: () => {
      screen.ticks++;
      if (screen.holding) loop.wake(); // feed({ type: 'tick' }) while held
      return screen.holding;
    },
    live: () => true,
    onStart: () => {
      screen.starts++;
    },
    raf: frames.raf,
    caf: frames.caf,
  });
  return { screen, loop };
}

describe('createFrameLoop', () => {
  it('a held gesture keeps exactly one frame booked and runs once a frame', () => {
    const frames = fakeFrames();
    const { screen, loop } = heldScreen(frames);
    screen.holding = true; // a log lifted: the stage's 'down'
    loop.wake();
    // 54 frames is a 900 ms hold at 60 fps.
    for (let i = 1; i <= 54; i++) {
      frames.step();
      expect(frames.pending).toBe(1);
      expect(screen.ticks).toBe(i);
    }
    expect(frames.booked).toBe(55);
    screen.holding = false; // let go
    frames.step();
    frames.step();
    expect(frames.pending).toBe(0);
    expect(screen.ticks).toBe(55);
    expect(screen.starts).toBe(1);
  });

  it('a run of quick easy-button taps never books a second chain', () => {
    const frames = fakeFrames();
    const { screen, loop } = heldScreen(frames);
    // Ten mushroom taps: easy-down (held for a few frames), easy-up, a frame apart.
    for (let tap = 0; tap < 10; tap++) {
      screen.holding = true;
      loop.wake();
      for (let f = 0; f < 5; f++) {
        frames.step();
        expect(frames.pending).toBe(1);
      }
      screen.holding = false;
      loop.wake(); // the count went up on the lift
      frames.step();
      expect(frames.pending).toBeLessThanOrEqual(1);
    }
    frames.step();
    expect(frames.pending).toBe(0);
    // One tick per frame stepped: 10 taps × 6 frames.
    expect(screen.ticks).toBe(60);
    expect(frames.booked).toBe(60);
  });

  it('a wake from inside a frame that would stop books one more frame', () => {
    const frames = fakeFrames();
    let woke = false;
    const loop: FrameLoop = createFrameLoop({
      frame: () => {
        if (!woke) {
          woke = true;
          loop.wake(); // a find lands mid-frame and asks to draw
        }
        return false;
      },
      live: () => true,
      raf: frames.raf,
      caf: frames.caf,
    });
    loop.wake();
    frames.step();
    expect(frames.pending).toBe(1);
    frames.step();
    expect(frames.pending).toBe(0);
  });

  it('books nothing while closed, and stop cancels the booked frame', () => {
    const frames = fakeFrames();
    let open = false;
    const loop = createFrameLoop({ frame: () => true, live: () => open, ...frames });
    loop.wake();
    expect(loop.pending).toBe(false);
    open = true;
    loop.wake();
    loop.wake();
    expect(frames.pending).toBe(1);
    loop.stop();
    expect(loop.pending).toBe(false);
    expect(frames.pending).toBe(0);
    // Closed mid-frame: the frame's end books nothing.
    loop.wake();
    open = false;
    frames.step();
    expect(frames.pending).toBe(0);
  });
});
