import { HOUSE_FLICKER } from './house-config.js';

/*
 * The fire and lamp flicker (#381 H2). The house renders on demand (tech
 * spec §6), so the flicker is a slow timer (`HOUSE_FLICKER.hz`, about 8–10
 * ticks a second on medium and high), never a per-frame loop: each tick
 * nudges the warm lights and asks for one frame. It runs only while the
 * house is on screen and the page shows; it stops when the house closes and
 * pauses while the tab is in the background. On low it's off (a still fire,
 * so an idle house draws nothing on the older iPad). Pure (timers, the page's
 * visibility and the scene are passed in), so it's unit-tested.
 */

/** How bright the fire (or a lamp, with its smaller `depth`) is at `t` seconds: around 1. */
export function flickerAt(t: number, depth: number): number {
  const wave =
    0.55 * Math.sin(2 * Math.PI * 1.7 * t) +
    0.3 * Math.sin(2 * Math.PI * 3.1 * t + 1.3) +
    0.15 * Math.sin(2 * Math.PI * 5.3 * t + 0.4);
  return 1 + depth * wave;
}

export interface FlickerDeps {
  /** Sets the fire's and the lamp's strength, as shares of their steady light. */
  apply: (fire: number, lamp: number) => void;
  /** Asks the stage for one frame. */
  frame: () => void;
  /** The page is in the background (`document.hidden`). */
  hidden: () => boolean;
  /** Calls back when the page shows or hides; returns the unsubscribe. */
  onVisibility: (changed: () => void) => () => void;
  setInterval?: (fn: () => void, ms: number) => unknown;
  clearInterval?: (id: unknown) => void;
  /** Seconds, for the flicker's wave. */
  now?: () => number;
}

export interface Flicker {
  /** Flickers at `hz` ticks a second (0: still) while the page shows. */
  start: (hz: number) => void;
  /** Stops for good (the house closed) and puts the steady light back. */
  stop: () => void;
  /** A timer is ticking now. */
  readonly running: boolean;
  readonly hz: number;
  /** Ticks so far (the dev hook proves it stops). */
  readonly ticks: number;
}

export function createFlicker(deps: FlickerDeps): Flicker {
  const every = deps.setInterval ?? ((fn, ms) => setInterval(fn, ms));
  const clear =
    deps.clearInterval ??
    ((id) => {
      clearInterval(id as ReturnType<typeof setInterval>);
    });
  const now = deps.now ?? (() => performance.now() / 1000);
  let hz = 0;
  let timer: unknown = null;
  let ticks = 0;
  let unsubscribe: (() => void) | null = null;

  const halt = () => {
    if (timer === null) return;
    clear(timer);
    timer = null;
  };
  const steady = () => {
    deps.apply(1, 1);
    deps.frame();
  };
  /** Ticks while wanted and the page shows; pauses (steady light) while it hides. */
  const sync = () => {
    if (hz <= 0 || deps.hidden()) {
      if (timer !== null) {
        halt();
        steady();
      }
      return;
    }
    if (timer !== null) return;
    timer = every(() => {
      if (deps.hidden()) {
        sync();
        return;
      }
      ticks += 1;
      const t = now();
      deps.apply(
        flickerAt(t, HOUSE_FLICKER.depth.fire),
        flickerAt(t + 0.37, HOUSE_FLICKER.depth.lamp),
      );
      deps.frame();
    }, 1000 / hz);
  };

  return {
    start(next) {
      if (next === hz && unsubscribe) {
        sync();
        return;
      }
      const was = timer !== null;
      halt();
      hz = Math.max(0, next);
      unsubscribe ??= deps.onVisibility(sync);
      sync();
      if (was && timer === null) steady();
    },
    stop() {
      const was = timer !== null;
      halt();
      hz = 0;
      unsubscribe?.();
      unsubscribe = null;
      if (was) deps.apply(1, 1);
    },
    get running() {
      return timer !== null;
    },
    get hz() {
      return hz;
    },
    get ticks() {
      return ticks;
    },
  };
}
