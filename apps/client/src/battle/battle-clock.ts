/*
 * The battle screen's clock: every timer and every pose reads time from
 * here, so the whole show can run slower (dev tuning) or be stepped by hand
 * (dev captures and tests) without touching the choreography. Pure where it
 * can be: the manual clock has no timers of its own.
 */

export interface BattleClock {
  /** Battle time, ms. */
  now(): number;
  /** Runs `fn` after `ms` of battle time; returns an id for `cancel`. */
  later(ms: number, fn: () => void): number;
  cancel(id: number): void;
  /** Cancels everything pending (the battle closed). */
  clearAll(): void;
}

/**
 * Wall-clock time, `slowmo` times slower (1 is real time): `?battle-slowmo=8`
 * plays a battle 8× slower, to judge the choreography frame by frame.
 */
export function realClock(
  slowmo = 1,
  host: {
    now: () => number;
    setTimeout: (fn: () => void, ms: number) => number;
    clearTimeout: (id: number) => void;
  } = {
    now: () => performance.now(),
    setTimeout: (fn, ms) => window.setTimeout(fn, ms),
    clearTimeout: (id) => {
      window.clearTimeout(id);
    },
  },
): BattleClock {
  const timers = new Set<number>();
  return {
    now: () => host.now() / slowmo,
    later: (ms, fn) => {
      const id = host.setTimeout(() => {
        timers.delete(id);
        fn();
      }, ms * slowmo);
      timers.add(id);
      return id;
    },
    cancel: (id) => {
      host.clearTimeout(id);
      timers.delete(id);
    },
    clearAll: () => {
      for (const id of timers) host.clearTimeout(id);
      timers.clear();
    },
  };
}

interface Pending {
  readonly id: number;
  readonly at: number;
  readonly fn: () => void;
}

/**
 * A clock that only moves when told (`set`, `advance`): due timers fire in
 * time order as it passes them. Dev builds use it for frame-exact captures
 * (`?battle-clock=manual`); tests use it to play a log step by step.
 */
export class ManualClock implements BattleClock {
  #t = 0;
  #nextId = 1;
  #pending: Pending[] = [];

  now(): number {
    return this.#t;
  }

  later(ms: number, fn: () => void): number {
    const id = this.#nextId++;
    this.#pending.push({ id, at: this.#t + Math.max(0, ms), fn });
    return id;
  }

  cancel(id: number): void {
    this.#pending = this.#pending.filter((p) => p.id !== id);
  }

  clearAll(): void {
    this.#pending = [];
  }

  /** Moves to battle time `t` (never backwards), firing what came due on the way, in order. */
  set(t: number): void {
    const target = Math.max(this.#t, t);
    for (;;) {
      let next: Pending | null = null;
      for (const p of this.#pending) {
        if (
          p.at <= target &&
          (next === null || p.at < next.at || (p.at === next.at && p.id < next.id))
        ) {
          next = p;
        }
      }
      if (!next) break;
      this.#pending = this.#pending.filter((p) => p !== next);
      this.#t = Math.max(this.#t, next.at);
      next.fn();
    }
    this.#t = target;
  }

  advance(ms: number): void {
    this.set(this.#t + ms);
  }

  /** Timers still waiting (tests). */
  get pending(): number {
    return this.#pending.length;
  }
}
