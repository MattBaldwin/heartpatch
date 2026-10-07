import { findAvoidedWords, type ChangeEntryView } from '@heartpatch/shared';
import { describe, expect, it } from 'vitest';
import {
  createSeenStore,
  groupByBuild,
  groupLabel,
  isNewSince,
  popUpPlan,
  SEEN_BUILD_KEY,
} from './whats-new-model.js';
import { WHATS_NEW_TEXT } from './whats-new.js';

const entry = (
  slug: string,
  build: number | null,
  date: string | null = '2026-10-07',
): ChangeEntryView => ({
  slug,
  title: slug,
  area: 'other',
  body: 'Words.',
  tryIt: null,
  build,
  date: build === null ? null : date,
});

describe('groupByBuild (#220)', () => {
  it('groups by version, newest first, with "Coming next" on top', () => {
    const groups = groupByBuild([
      entry('b', 296),
      entry('c', 298),
      entry('a', 298),
      entry('next', null),
      entry('d', 293),
    ]);
    expect(groups.map((g) => [g.build, g.entries.map((e) => e.slug)])).toEqual([
      [null, ['next']],
      [298, ['a', 'c']],
      [296, ['b']],
      [293, ['d']],
    ]);
  });

  it('labels each version with its build and date', () => {
    expect(groupLabel({ build: 298, date: '2026-10-07' }, 0)).toBe('v0.298 · Oct 7');
    expect(groupLabel({ build: 12, date: null }, 0)).toBe('v0.12');
    expect(groupLabel({ build: null, date: null }, 0)).toBe('Coming next');
  });
});

describe('the pop-up after an update (#220)', () => {
  it('a brand-new device remembers its build quietly: no history pops up', () => {
    expect(popUpPlan(298, null)).toEqual({ pop: false, since: null, remember: 298 });
  });

  it('pops up once after an update, with everything since the last version seen', () => {
    expect(popUpPlan(298, 293)).toEqual({ pop: true, since: 293, remember: null });
    const groups = groupByBuild([entry('a', 298), entry('b', 296), entry('c', 293)]);
    expect(groups.map((g) => isNewSince(g, 293))).toEqual([true, true, false]);
  });

  it('stays away on the same build, an older one, or a dev build', () => {
    expect(popUpPlan(298, 298).pop).toBe(false);
    expect(popUpPlan(290, 298).pop).toBe(false);
    expect(popUpPlan(null, 290)).toEqual({ pop: false, since: 290, remember: null });
  });

  it('remembers per device, and copes with blocked storage', () => {
    const data = new Map<string, string>();
    const storage = {
      getItem: (k: string) => data.get(k) ?? null,
      setItem: (k: string, v: string) => data.set(k, v),
    } as unknown as Storage;
    const seen = createSeenStore(() => storage);
    expect(seen.read()).toBeNull();
    seen.write(298);
    expect(data.get(SEEN_BUILD_KEY)).toBe('298');
    expect(seen.read()).toBe(298);
    data.set(SEEN_BUILD_KEY, 'garbage');
    expect(seen.read()).toBeNull();

    const blocked = createSeenStore(() => {
      throw new Error('SecurityError');
    });
    expect(blocked.read()).toBeNull();
    expect(() => {
      blocked.write(1);
    }).not.toThrow();
  });
});

describe('words', () => {
  it('uses no avoided words (style guide §9)', () => {
    const lines = [
      ...Object.values(WHATS_NEW_TEXT).map((t) => (typeof t === 'string' ? t : t('v0.1'))),
      groupLabel({ build: null, date: null }, 0),
    ];
    for (const line of lines) expect(findAvoidedWords(line), line).toEqual([]);
  });
});
