import { describe, expect, it, vi } from 'vitest';
import type { LinesView, MapView, PublicLine } from '@heartpatch/shared';
import { testView, testWildIsle, userId } from '../map/test-view.js';
import { createLineFeed, isClockworkView } from './line-feed.js';

const ME = userId(1);
const wild = testWildIsle();
const clockwork: MapView = { ...wild, map: { ...wild.map, patchType: 'clockwork-isle' } };
const at = (view: MapView, seq: number): MapView => ({ ...view, seq });
const wire = (q: number, r: number, powered: boolean): PublicLine => ({
  q,
  r,
  kind: 'wire',
  ownerUserId: ME,
  level: 1,
  powered,
});
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

/** A read the test finishes by hand. */
function slowFetch() {
  const waiting: ((view: LinesView) => void)[] = [];
  const fetch = vi.fn(
    () =>
      new Promise<LinesView>((resolve) => {
        waiting.push(resolve);
      }),
  );
  return { fetch, finish: (lines: PublicLine[]) => waiting.shift()?.({ lines }) };
}

describe('line feed (#874 C4)', () => {
  it('knows a Clockwork Isle from a Wild Isle and a Cozy Patch', () => {
    expect(isClockworkView(clockwork)).toBe(true);
    expect(isClockworkView(wild)).toBe(false);
    expect(isClockworkView(testView())).toBe(false);
  });

  it('never asks about lines anywhere else (they answer NOT_FOUND)', async () => {
    const fetch = vi.fn(() => Promise.resolve({ lines: [] }));
    const feed = createLineFeed(fetch, () => undefined);
    feed.follow(wild);
    feed.follow(testView());
    await flush();
    expect(fetch).not.toHaveBeenCalled();
    expect(feed.loaded).toBe(false);
  });

  it('reads once per seq, and again when the seq moves', async () => {
    const fetch = vi.fn(() => Promise.resolve({ lines: [wire(1, 1, true)] }));
    const onChange = vi.fn();
    const feed = createLineFeed(fetch, onChange);
    feed.follow(at(clockwork, 3));
    await flush();
    feed.follow(at(clockwork, 3));
    await flush();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(feed.loaded).toBe(true);
    expect(feed.lines).toEqual([wire(1, 1, true)]);
    feed.follow(at(clockwork, 4));
    await flush();
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(onChange).toHaveBeenCalled();
  });

  it('applies my command at once, then reads again for the power', async () => {
    const slow = slowFetch();
    const feed = createLineFeed(slow.fetch, () => undefined);
    feed.follow(at(clockwork, 1));
    slow.finish([]);
    await flush();
    feed.apply(
      { q: 2, r: 3, kind: 'wire', line: { level: 1 }, items: {}, refund: {} },
      ME,
    );
    // Drawn at once, dark until the server says.
    expect(feed.lines).toEqual([wire(2, 3, false)]);
    expect(slow.fetch).toHaveBeenCalledTimes(2);
    slow.finish([wire(2, 3, true)]);
    await flush();
    expect(feed.lines).toEqual([wire(2, 3, true)]);
    // Taking it up: gone.
    feed.apply({ q: 2, r: 3, kind: 'wire', line: null, items: {}, refund: {} }, ME);
    expect(feed.lines).toEqual([]);
  });

  it('keeps a wire and a rail on the same tile apart', async () => {
    const fetch = vi.fn(() => Promise.resolve({ lines: [wire(0, 0, true)] }));
    const feed = createLineFeed(fetch, () => undefined);
    feed.follow(at(clockwork, 1));
    await flush();
    feed.apply({ q: 0, r: 0, kind: 'rail', line: { level: 1 }, items: {}, refund: {} }, ME);
    expect(feed.lines.map((l) => l.kind).sort()).toEqual(['rail', 'wire']);
  });

  it('asks once more when a change lands while a read is out, and drops the stale read', async () => {
    const slow = slowFetch();
    const feed = createLineFeed(slow.fetch, () => undefined);
    feed.follow(at(clockwork, 1));
    feed.follow(at(clockwork, 2));
    expect(slow.fetch).toHaveBeenCalledTimes(1);
    slow.finish([wire(9, 9, false)]);
    await flush();
    // The first read may predate seq 2: not shown; a second read goes out.
    expect(feed.lines).toEqual([]);
    expect(slow.fetch).toHaveBeenCalledTimes(2);
    slow.finish([wire(9, 9, true)]);
    await flush();
    expect(feed.lines).toEqual([wire(9, 9, true)]);
  });

  it('forgets the lines when the map stops being a Clockwork Isle', async () => {
    const fetch = vi.fn(() => Promise.resolve({ lines: [wire(1, 1, true)] }));
    const feed = createLineFeed(fetch, () => undefined);
    feed.follow(at(clockwork, 1));
    await flush();
    feed.follow(wild);
    expect(feed.lines).toEqual([]);
    expect(feed.loaded).toBe(false);
  });
});
