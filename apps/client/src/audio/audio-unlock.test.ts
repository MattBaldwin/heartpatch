import { describe, expect, it } from 'vitest';
import { AudioUnlock, type AudioState, type UnlockContext } from './audio-unlock.js';

/** A stand-in AudioContext: `resumes` says what resume() does. */
class FakeContext implements UnlockContext {
  state = 'suspended';
  resumes: 'run' | 'refuse' | 'stay' = 'run';
  resumeCalls = 0;
  suspendCalls = 0;
  private readonly listeners: (() => void)[] = [];

  resume(): Promise<void> {
    this.resumeCalls += 1;
    if (this.resumes === 'refuse') return Promise.reject(new Error('not allowed'));
    if (this.resumes === 'run') this.to('running');
    return Promise.resolve();
  }

  suspend(): Promise<void> {
    this.suspendCalls += 1;
    this.to('suspended');
    return Promise.resolve();
  }

  addEventListener(_type: 'statechange', listener: () => void): void {
    this.listeners.push(listener);
  }

  /** The browser changes the state (a call, Siri, closing). */
  to(state: string): void {
    this.state = state;
    for (const listener of this.listeners) listener();
  }
}

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

function setup(make: () => FakeContext | null = () => new FakeContext()) {
  const made: FakeContext[] = [];
  let primed = 0;
  const unlock = new AudioUnlock<FakeContext>({
    create: () => {
      const ctx = make();
      if (ctx) made.push(ctx);
      return ctx;
    },
    prime: () => {
      primed += 1;
    },
  });
  const states: AudioState[] = [];
  unlock.onChange((s) => states.push(s));
  return { unlock, made, states, primed: () => primed };
}

describe('AudioUnlock', () => {
  it('stays locked, with no context, until the first gesture', () => {
    const { unlock, made } = setup();
    expect(unlock.state).toBe('locked');
    expect(unlock.context).toBeNull();
    unlock.visibility(false);
    unlock.visibility(true);
    expect(made).toHaveLength(0);
    expect(unlock.state).toBe('locked');
  });

  it('makes, primes and resumes the context inside the first gesture', async () => {
    const { unlock, made, states, primed } = setup();
    unlock.gesture();
    expect(made).toHaveLength(1);
    expect(primed()).toBe(1);
    expect(made[0]?.resumeCalls).toBe(1);
    await flush();
    expect(unlock.state).toBe('running');
    expect(states).toEqual(['starting', 'running']);
    // Later taps don't make another context or resume again.
    unlock.gesture();
    expect(made).toHaveLength(1);
    expect(made[0]?.resumeCalls).toBe(1);
  });

  it('is starting while the resume is pending, then suspended if it is refused', async () => {
    const { unlock, made } = setup(() => {
      const ctx = new FakeContext();
      ctx.resumes = 'refuse';
      return ctx;
    });
    unlock.gesture();
    expect(unlock.state).toBe('starting');
    await flush();
    expect(unlock.state).toBe('suspended');
    // The next tap tries again, and this time it works.
    const ctx = made[0];
    if (!ctx) throw new Error('no context');
    ctx.resumes = 'run';
    unlock.gesture();
    await flush();
    expect(unlock.state).toBe('running');
    expect(made).toHaveLength(1);
  });

  it('asks to resume during an iOS interruption, and runs again when it ends', async () => {
    const { unlock, made } = setup();
    unlock.gesture();
    await flush();
    const ctx = made[0];
    if (!ctx) throw new Error('no context');
    // While the call lasts, Safari holds the resume.
    ctx.resumes = 'stay';
    ctx.to('interrupted');
    expect(ctx.resumeCalls).toBe(2);
    await flush();
    expect(unlock.state).toBe('suspended');
    // The call ends: Safari runs the context again, no tap needed.
    ctx.to('running');
    expect(unlock.state).toBe('running');
  });

  it('resumes on the next gesture if an interruption leaves it suspended', async () => {
    const { unlock, made } = setup();
    unlock.gesture();
    await flush();
    const ctx = made[0];
    if (!ctx) throw new Error('no context');
    ctx.resumes = 'refuse';
    ctx.to('interrupted');
    await flush();
    expect(unlock.state).toBe('suspended');
    ctx.resumes = 'run';
    unlock.gesture();
    await flush();
    expect(unlock.state).toBe('running');
  });

  it('suspends while hidden and resumes when back in view', async () => {
    const { unlock, made } = setup();
    unlock.gesture();
    await flush();
    const ctx = made[0];
    if (!ctx) throw new Error('no context');
    unlock.visibility(true);
    expect(ctx.suspendCalls).toBe(1);
    expect(unlock.state).toBe('suspended');
    // A tap while hidden can't start sound in the background.
    unlock.gesture();
    expect(ctx.state).toBe('suspended');
    unlock.visibility(false);
    await flush();
    expect(unlock.state).toBe('running');
  });

  it('waits for a tap when iOS will not resume without one after coming back', async () => {
    const { unlock, made } = setup();
    unlock.gesture();
    await flush();
    const ctx = made[0];
    if (!ctx) throw new Error('no context');
    unlock.visibility(true);
    ctx.resumes = 'refuse';
    unlock.visibility(false);
    await flush();
    expect(unlock.state).toBe('suspended');
    ctx.resumes = 'run';
    unlock.gesture();
    await flush();
    expect(unlock.state).toBe('running');
  });

  it('makes a fresh context on the next tap after one closes', async () => {
    const { unlock, made } = setup();
    unlock.gesture();
    await flush();
    made[0]?.to('closed');
    expect(unlock.state).toBe('locked');
    expect(unlock.context).toBeNull();
    unlock.gesture();
    await flush();
    expect(made).toHaveLength(2);
    expect(unlock.context).toBe(made[1]);
    expect(unlock.state).toBe('running');
  });

  it('is unsupported for good when there is no AudioContext', () => {
    const { unlock, states } = setup(() => null);
    unlock.gesture();
    expect(unlock.state).toBe('unsupported');
    unlock.gesture();
    expect(states).toEqual(['unsupported']);
  });

  it('is unsupported when making the context throws', () => {
    const { unlock } = setup(() => {
      throw new Error('too many contexts');
    });
    unlock.gesture();
    expect(unlock.state).toBe('unsupported');
  });

  it('still resumes when priming throws', async () => {
    const ctx = new FakeContext();
    const unlock = new AudioUnlock<FakeContext>({
      create: () => ctx,
      prime: () => {
        throw new Error('no buffers');
      },
    });
    unlock.gesture();
    await flush();
    expect(unlock.state).toBe('running');
  });
});
