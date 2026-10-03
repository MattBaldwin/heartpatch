// When sound may play (#25, tech spec §15 "iOS"). Safari only lets an
// AudioContext start inside a user gesture, and a phone call, Siri or leaving
// the app suspends ("interrupted") it again. So:
//
//   locked ── gesture ──▶ starting ── context running ──▶ running
//                                                          │   ▲
//        hidden, call, Siri, a context that won't resume   ▼   │ gesture or back in view
//                                                       suspended
//
// No AudioContext at all (or it can't be made) is `unsupported`, for good.
// Nothing here plays before the first tap. Pure apart from the context it is
// given, so the transitions are unit-tested with a fake.

export type AudioState = 'locked' | 'starting' | 'running' | 'suspended' | 'unsupported';

/** The slice of AudioContext this needs (tests pass a fake). */
export interface UnlockContext {
  /** 'suspended' | 'running' | 'closed', and 'interrupted' on iOS Safari. */
  readonly state: string;
  resume(): Promise<void>;
  suspend(): Promise<void>;
  addEventListener(type: 'statechange', listener: () => void): void;
}

export interface UnlockDeps<C extends UnlockContext> {
  /** Makes the context; called only inside a gesture. Null or a throw: unsupported. */
  create: () => C | null;
  /** Plays something silent in the same gesture (old iOS needs a sound to unlock). */
  prime?: (context: C) => void;
}

export class AudioUnlock<C extends UnlockContext> {
  private current: AudioState = 'locked';
  private ctx: C | null = null;
  private hidden = false;
  private readonly listeners = new Set<(state: AudioState) => void>();

  private readonly deps: UnlockDeps<C>;

  constructor(deps: UnlockDeps<C>) {
    this.deps = deps;
  }

  get state(): AudioState {
    return this.current;
  }

  /** The context once a gesture made it (null before, or when unsupported). */
  get context(): C | null {
    return this.ctx;
  }

  /** Called for every state change; returns an unsubscribe. */
  onChange(listener: (state: AudioState) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * A tap, click or key press. Must run synchronously inside the event
   * handler, or iOS won't count it.
   */
  gesture(): void {
    if (this.current === 'unsupported' || this.current === 'running') return;
    if (!this.ctx) {
      let made: C | null;
      try {
        made = this.deps.create();
      } catch {
        made = null;
      }
      if (!made) {
        this.set('unsupported');
        return;
      }
      this.ctx = made;
      made.addEventListener('statechange', () => {
        this.sync();
        // Safari settles this resume when the call or Siri is over, so sound
        // comes back without a tap if the page stayed in view.
        if (made.state === 'interrupted') this.resume();
      });
      this.set('starting');
    }
    const ctx = this.ctx;
    try {
      this.deps.prime?.(ctx);
    } catch {
      // A failed prime only matters on very old iOS; resume still runs.
    }
    this.resume();
    this.sync();
  }

  /** The page went into or out of the background (`visibilitychange`). */
  visibility(hidden: boolean): void {
    this.hidden = hidden;
    const ctx = this.ctx;
    if (!ctx) return;
    if (hidden) {
      // Quiet in the background, and no battery spent on a hidden app.
      if (ctx.state === 'running') ctx.suspend().catch(() => undefined);
    } else {
      // iOS may refuse without a gesture; the next tap tries again.
      this.resume();
    }
    this.sync();
  }

  private resume(): void {
    const ctx = this.ctx;
    if (!ctx || this.hidden || ctx.state === 'running' || ctx.state === 'closed') return;
    const settle = () => {
      this.sync(true);
    };
    ctx.resume().then(settle, settle);
  }

  /**
   * Reads the context's state into ours. While starting, a not-yet-running
   * context is still starting, until its resume has settled.
   */
  private sync(settled = false): void {
    const ctx = this.ctx;
    if (!ctx) return;
    if (ctx.state === 'running') {
      this.set(this.hidden ? 'suspended' : 'running');
    } else if (ctx.state === 'closed') {
      // Closed contexts never come back: make a fresh one on the next tap.
      this.ctx = null;
      this.set('locked');
    } else if (this.current !== 'starting' || settled) {
      // 'suspended' or 'interrupted' (a call, Siri, another app's audio).
      this.set('suspended');
    }
  }

  private set(next: AudioState): void {
    if (next === this.current) return;
    this.current = next;
    for (const listener of this.listeners) listener(next);
  }
}
