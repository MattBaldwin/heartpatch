import { describe, expect, it } from 'vitest';
import { createAwayTracker } from './away.js';

const MIN = 60_000;

function setup() {
  const store = new Map<string, string>();
  let now = Date.UTC(2026, 9, 20, 12);
  const tracker = createAwayTracker({
    storage: {
      getItem: (k) => store.get(k) ?? null,
      setItem: (k, v) => {
        store.set(k, v);
      },
    },
    now: () => now,
    key: (mapId) => `seen.kid.${mapId}`,
  });
  return {
    tracker,
    store,
    wait: (ms: number) => {
      now += ms;
    },
  };
}

describe('time away from a patch, for the welcome-back card (#294)', () => {
  it('never counts a first visit as away', () => {
    const { tracker } = setup();
    tracker.arrived('p');
    expect(tracker.awayMs('p')).toBe(0);
  });

  it('is 0 for a kid who stays on the patch while a long batch finishes', () => {
    const { tracker, wait } = setup();
    tracker.arrived('p');
    tracker.settled('p', true);
    // A 30-minute Frozen Water lands with the kid still playing.
    wait(31 * MIN);
    expect(tracker.awayMs('p')).toBe(0);
  });

  it('counts the time the app was in the back, once, then 0 again', () => {
    const { tracker, wait } = setup();
    tracker.arrived('p');
    tracker.settled('p', true);
    tracker.left('p');
    wait(45 * MIN);
    tracker.arrived('p');
    expect(tracker.awayMs('p')).toBe(45 * MIN);
    tracker.settled('p', true);
    wait(MIN);
    expect(tracker.awayMs('p')).toBe(0);
  });

  it('remembers across a closed app (a fresh tracker on the same storage)', () => {
    const first = setup();
    first.tracker.arrived('p');
    first.tracker.settled('p', true);
    const store = first.store;
    let now = Date.UTC(2026, 9, 20, 12) + 2 * 60 * MIN;
    const again = createAwayTracker({
      storage: {
        getItem: (k) => store.get(k) ?? null,
        setItem: (k, v) => {
          store.set(k, v);
        },
      },
      now: () => now,
      key: (mapId) => `seen.kid.${mapId}`,
    });
    again.arrived('p');
    expect(again.awayMs('p')).toBe(2 * 60 * MIN);
    now += 1;
  });

  it("doesn't count a settle while the page is hidden as being here", () => {
    const { tracker, wait } = setup();
    tracker.arrived('p');
    tracker.settled('p', true);
    tracker.left('p');
    wait(20 * MIN);
    // A background tab's timer settles: still away.
    tracker.settled('p', false);
    wait(20 * MIN);
    tracker.arrived('p');
    expect(tracker.awayMs('p')).toBe(40 * MIN);
  });

  it('is 0 with nowhere to remember, or nobody signed in', () => {
    const none = createAwayTracker({ storage: null, now: () => 0, key: () => 'k' });
    none.left('p');
    none.arrived('p');
    expect(none.awayMs('p')).toBe(0);
    const nobody = createAwayTracker({
      storage: { getItem: () => '0', setItem: () => undefined },
      now: () => 99 * MIN,
      key: () => null,
    });
    nobody.arrived('p');
    expect(nobody.awayMs('p')).toBe(0);
  });
});
