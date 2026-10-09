import { describe, expect, it } from 'vitest';
import { createRechecker } from './rechecker.js';

describe('createRechecker', () => {
  it('counts looks until each one settles, the recheck included', async () => {
    const timers: (() => void)[] = [];
    const settle: (() => void)[] = [];
    const look = () => new Promise<void>((resolve) => settle.push(resolve));
    const checks = createRechecker(look, (task) => timers.push(task), 5_000);
    const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

    checks.check();
    expect(checks.pending).toBe(2); // the look now, and the recheck to come
    settle.shift()!();
    await flush();
    expect(checks.pending).toBe(1);
    // The recheck's look runs when its timer fires and counts until it settles.
    timers.shift()!();
    expect(checks.pending).toBe(1);
    settle.shift()!();
    await flush();
    expect(checks.pending).toBe(0);

    // Two map opens: four looks, each counted.
    checks.check();
    checks.check();
    expect(checks.pending).toBe(4);
  });

  it('counts a look that fails as finished too', async () => {
    const checks = createRechecker(
      () => Promise.reject(new Error('offline')),
      () => undefined,
      5_000,
    );
    checks.check();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(checks.pending).toBe(1); // only the recheck, still waiting on its timer
  });
});
