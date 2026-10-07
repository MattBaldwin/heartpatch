import type { ChangeEntryView } from '@heartpatch/shared';
import { describe, expect, it } from 'vitest';
import type { SeenStore } from './whats-new-model.js';
import { createPopUp, hasNewSince, type PopUpDeps } from './whats-new-popup.js';

const entry = (slug: string, build: number | null): ChangeEntryView => ({
  slug,
  title: slug,
  area: 'other',
  body: 'Words.',
  tryIt: null,
  build,
  date: build === null ? null : '2026-10-07',
});

/** A pop-up with fake storage, a fake clock and a changelog that answers at once. */
function setup(over: Partial<PopUpDeps> & { stored?: number | null } = {}) {
  let stored = over.stored === undefined ? 100 : over.stored;
  const seen: SeenStore = {
    read: () => stored,
    write: (build) => {
      stored = build;
    },
  };
  const timers: (() => void)[] = [];
  const shown: (number | null)[] = [];
  let busy = false;
  let loads = 0;
  const popUp = createPopUp({
    current: 105,
    seen,
    busy: () => busy,
    load: () => {
      loads += 1;
      return Promise.resolve([entry('new', 104), entry('old', 98)]);
    },
    show: (since) => shown.push(since),
    setTimer: (task) => timers.push(task),
    retryMs: 3_000,
    ...over,
  });
  return {
    popUp,
    shown,
    timers,
    stored: () => stored,
    loads: () => loads,
    setBusy: (b: boolean) => {
      busy = b;
    },
    /** Lets the changelog's promise settle. */
    settle: () => new Promise((r) => setTimeout(r, 0)),
  };
}

describe('hasNewSince (#220)', () => {
  it('is true only for an entry built after the one seen', () => {
    expect(hasNewSince([entry('a', 104)], 100)).toBe(true);
    expect(hasNewSince([entry('a', 100), entry('b', 98)], 100)).toBe(false);
    expect(hasNewSince([entry('a', null)], 100)).toBe(false);
    expect(hasNewSince([entry('a', 104)], null)).toBe(false);
  });
});

describe('the What’s new pop-up (#220)', () => {
  it('pops up once after an update with something new, since the last build seen', async () => {
    const t = setup();
    t.popUp.maybePop();
    await t.settle();
    expect(t.shown).toEqual([100]);
    t.popUp.maybePop();
    await t.settle();
    expect(t.shown).toEqual([100]);
    expect(t.popUp.finished).toBe(true);
  });

  it('remembers the build when the sheet closes', async () => {
    const t = setup();
    t.popUp.maybePop();
    await t.settle();
    t.popUp.closed();
    expect(t.stored()).toBe(105);
  });

  it('waits while the screen is busy, then pops on a retry', async () => {
    const t = setup();
    t.setBusy(true);
    t.popUp.maybePop();
    await t.settle();
    t.popUp.maybePop(); // the map again: still one wait, one fetch
    await t.settle();
    expect(t.shown).toEqual([]);
    expect(t.timers).toHaveLength(1);
    expect(t.loads()).toBe(1);
    t.timers.shift()?.();
    expect(t.timers).toHaveLength(1); // still busy: waits again
    t.setBusy(false);
    t.timers.shift()?.();
    expect(t.shown).toEqual([100]);
  });

  it('stays away when the sheet was opened from the menu while it waited', async () => {
    const t = setup();
    t.setBusy(true);
    t.popUp.maybePop();
    await t.settle();
    t.popUp.closed(); // opened from the version line and closed
    t.setBusy(false);
    t.timers.shift()?.();
    expect(t.shown).toEqual([]);
    expect(t.popUp.finished).toBe(true);
  });

  it('stays quiet when nothing new arrived (a tooling or docs deploy)', async () => {
    const t = setup({ load: () => Promise.resolve([entry('old', 98)]) });
    t.popUp.maybePop();
    await t.settle();
    expect(t.shown).toEqual([]);
    expect(t.stored()).toBe(105);
  });

  it('tries again on a later visit when the changelog can’t be fetched', async () => {
    let answer: ChangeEntryView[] | null = null;
    const t = setup({ load: () => Promise.resolve(answer) });
    t.popUp.maybePop();
    await t.settle();
    expect(t.shown).toEqual([]);
    expect(t.stored()).toBe(100);
    answer = [entry('new', 104)];
    t.popUp.maybePop();
    await t.settle();
    expect(t.shown).toEqual([100]);
  });

  it('never pops on a brand-new device, the same build or a dev build', async () => {
    const fresh = setup({ stored: null });
    fresh.popUp.maybePop();
    await fresh.settle();
    expect(fresh.shown).toEqual([]);
    expect(fresh.stored()).toBe(105);
    expect(fresh.loads()).toBe(0);

    const same = setup({ stored: 105 });
    same.popUp.maybePop();
    await same.settle();
    expect(same.shown).toEqual([]);

    const dev = setup({ current: null });
    dev.popUp.maybePop();
    await dev.settle();
    expect(dev.shown).toEqual([]);
    expect(dev.loads()).toBe(0);
  });
});
