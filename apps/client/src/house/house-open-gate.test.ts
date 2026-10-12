import { describe, expect, it, vi } from 'vitest';
import { createOpenGate } from './house-open-gate.js';

/** A fetch that resolves (or rejects) when told. */
function later<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { fetch: () => promise, resolve, reject };
}

describe('house open gate', () => {
  it('opens with the reply', async () => {
    const gate = createOpenGate();
    const ready = vi.fn();
    const reply = later<string>();
    const opening = gate.open(reply.fetch, ready, vi.fn());
    expect(gate.busy).toBe(true);
    reply.resolve('house');
    await opening;
    expect(ready).toHaveBeenCalledWith('house');
    expect(gate.busy).toBe(false);
  });

  it('builds once on a double tap', async () => {
    const gate = createOpenGate();
    const ready = vi.fn();
    const fetch = vi.fn(() => Promise.resolve('house'));
    await Promise.all([gate.open(fetch, ready, vi.fn()), gate.open(fetch, ready, vi.fn())]);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(ready).toHaveBeenCalledTimes(1);
  });

  it('ignores a reply that lands after a hide, a logout or another player (cancel)', async () => {
    const gate = createOpenGate();
    const ready = vi.fn();
    const fail = vi.fn();
    const reply = later<string>();
    const opening = gate.open(reply.fetch, ready, fail);
    gate.cancel();
    expect(gate.busy).toBe(false);
    reply.resolve('the last player’s house');
    await opening;
    expect(ready).not.toHaveBeenCalled();

    const failing = later<string>();
    const again = gate.open(failing.fetch, ready, fail);
    gate.cancel();
    failing.reject(new Error('offline'));
    await again;
    expect(fail).not.toHaveBeenCalled();
  });

  it('uses only the newest open after a cancel', async () => {
    const gate = createOpenGate();
    const ready = vi.fn();
    const first = later<string>();
    const second = later<string>();
    const a = gate.open(first.fetch, ready, vi.fn());
    gate.cancel();
    const b = gate.open(second.fetch, ready, vi.fn());
    second.resolve('new');
    first.resolve('old');
    await Promise.all([a, b]);
    expect(ready).toHaveBeenCalledTimes(1);
    expect(ready).toHaveBeenCalledWith('new');
  });

  it('says why it could not open, then lets the player try again', async () => {
    const gate = createOpenGate();
    const fail = vi.fn();
    await gate.open(() => Promise.reject(new Error('offline')), vi.fn(), fail);
    expect(fail).toHaveBeenCalledTimes(1);
    expect(gate.busy).toBe(false);
    const ready = vi.fn();
    await gate.open(() => Promise.resolve('house'), ready, vi.fn());
    expect(ready).toHaveBeenCalledWith('house');
  });
});
