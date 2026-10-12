import type { HouseView } from '@heartpatch/shared';
import { describe, expect, it } from 'vitest';
import { createHouseBuilder } from './house-build.js';
import { sampleHouse } from './house-fixtures.js';
import { createViewSync } from './house-view-sync.js';

/** A reply the test lands by hand. */
function deferred<T>() {
  let resolve: (v: T) => void = () => undefined;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

describe('house view sync', () => {
  it('drops a read that lands after the build’s reply, so the old level never comes back', async () => {
    const sync = createViewSync();
    let shown: HouseView = sampleHouse(1).view;
    const build = deferred<HouseView>();
    const builder = createHouseBuilder({
      build: () => build.promise,
      newKey: () => 'k',
      wait: () => Promise.resolve(),
      retryAfterMs: 0,
    });

    // As the screen does it: a build starts and drops reads in flight…
    sync.drop();
    const building = builder.build('map-1', 2, () => true);
    // …but a read starts while it's in flight (the sheet reopened).
    const read = deferred<HouseView>();
    const fresh = sync.begin();
    const reading = read.promise.then((v) => {
      if (fresh()) shown = v;
    });

    // The build lands first: the screen drops reads, then takes its reply.
    build.resolve(sampleHouse(2).view);
    const outcome = await building;
    expect(outcome.kind).toBe('built');
    sync.drop();
    if (outcome.kind === 'built') shown = outcome.view;

    // The stale level-1 read lands last and is dropped.
    read.resolve(sampleHouse(1).view);
    await reading;
    expect(shown.level).toBe(2);
  });

  it('keeps the latest of two reads and drops the older', () => {
    const sync = createViewSync();
    const first = sync.begin();
    const second = sync.begin();
    expect(first()).toBe(false);
    expect(second()).toBe(true);
    sync.drop();
    expect(second()).toBe(false);
  });
});
