import {
  CLOTHING,
  findAvoidedWords,
  type AdventDayState,
  type AdventDayView,
  type AdventView,
} from '@heartpatch/shared';
import { describe, expect, it } from 'vitest';
import {
  ADVENT_TEXT,
  catchUpDays,
  contentsLine,
  dayLook,
  foundLine,
  foundLines,
  phaseOf,
  pickedCatchUp,
  presentWaiting,
  stuckNote,
  todayOf,
} from './advent-model.js';

const date = (n: number) => `2026-12-${String(n).padStart(2, '0')}`;

/** A calendar on `today` with `opened` days opened and today's catch-up left or used. */
function calendar(today: string, opened: number[], catchUpLeft = true): AdventView {
  const days: AdventDayView[] = Array.from({ length: 25 }, (_, i) => {
    const n = i + 1;
    const day = date(n);
    const contents = ['treats', 'pies'];
    if (opened.includes(n)) return { day, state: 'opened', items: { treats: 2 }, contents };
    const state: AdventDayState =
      day > today ? 'locked' : day === today ? 'today' : catchUpLeft ? 'catch-up' : 'missed';
    return { day, state, contents };
  });
  return { today, days, catchUpLeft, presentContents: ['treats'] };
}

describe('dayLook (#37 1d)', () => {
  const view = calendar(date(5), [1, 2, 4]);
  const look = (n: number) => dayLook(view.days[n - 1] as AdventDayView, view);

  it('gives every state its own words and picture, not only a colour', () => {
    const tags = [look(1), look(5), look(3), look(8)].map((l) => `${l.tag}|${l.icon}`);
    expect(new Set(tags).size).toBe(4);
    expect(look(5).tag).toBe('Today');
    expect(look(3).tag).toBe('Catch up');
    expect(look(1).tag).toBe('Opened');
    expect(look(8).tag).toBe('Wrapped');
  });

  it('puts the wrapped-present look on locked days and names the fixed days', () => {
    expect(look(8).icon).toBe('🎀');
    expect(dayLook(view.days[23] as AdventDayView, view).icon).toBe('🎆');
    expect(dayLook(view.days[24] as AdventDayView, view).icon).toBe('⭐');
  });

  it('reads aloud what each day is', () => {
    expect(look(5).label).toBe('Day 5, today, open it');
    expect(look(3).label).toBe('Day 3, you missed it, open it now');
    expect(look(1).label).toBe('Day 1, opened, see what it held');
    expect(look(8).label).toBe('Day 8, still wrapped up');
  });

  it('tells a missed day from a locked one, and says when catch-up is used', () => {
    const used = calendar(date(5), [1], false);
    const missed = dayLook(used.days[2] as AdventDayView, used);
    expect(missed.state).toBe('missed');
    expect(missed.tag).toBe('Missed');
    expect(missed.label).toContain('catch up is used');
    expect(missed.tag).not.toBe(look(8).tag);
  });
});

describe('the calendar around today', () => {
  it('knows before, live and over', () => {
    expect(phaseOf(calendar(date(5), []))).toBe('live');
    expect(phaseOf(calendar('2026-12-25', []))).toBe('live');
    expect(phaseOf(calendar('2026-12-28', [], false))).toBe('over');
    expect(phaseOf(calendar('2026-11-30', []))).toBe('before');
  });

  it("badges only while today's present waits", () => {
    expect(presentWaiting(null)).toBe(false);
    expect(presentWaiting(calendar(date(5), []))).toBe(true);
    expect(presentWaiting(calendar(date(5), [5]))).toBe(false);
    expect(presentWaiting(calendar('2026-12-28', [], false))).toBe(false);
    expect(todayOf(calendar('2026-12-28', [], false))).toBeNull();
  });

  it('picks the missed day tapped, else the oldest', () => {
    const view = calendar(date(6), [1]);
    expect(catchUpDays(view).map((d) => d.day)).toEqual([date(2), date(3), date(4), date(5)]);
    expect(pickedCatchUp(view, null)?.day).toBe(date(2));
    expect(pickedCatchUp(view, date(4))?.day).toBe(date(4));
    expect(pickedCatchUp(view, date(1))?.day).toBe(date(2));
    expect(pickedCatchUp(calendar(date(6), [1], false), null)).toBeNull();
  });

  it("explains a day that can't be opened without asking the server", () => {
    const used = calendar(date(5), [1], false);
    expect(stuckNote(used.days[7] as AdventDayView, used)).toBe(ADVENT_TEXT.tapLocked);
    expect(stuckNote(used.days[2] as AdventDayView, used)).toBe(ADVENT_TEXT.tapMissedUsed);
    const over = calendar('2026-12-28', [], false);
    expect(stuckNote(over.days[2] as AdventDayView, over)).toBe(ADVENT_TEXT.tapMissedOver);
    expect(stuckNote(used.days[4] as AdventDayView, used)).toBeNull();
  });
});

describe('what a present can hold and held', () => {
  it('shows names and pictures, never odds', () => {
    const line = contentsLine(['treats', 'pies']);
    expect(line).toMatch(/Treats/);
    expect(line).not.toMatch(/%|chance|odds/i);
  });

  it('names a Christmas outfit by its name, not "Mystery thing"', () => {
    const outfit = CLOTHING[0] as { id: string; name: string };
    expect(contentsLine([outfit.id])).toContain(outfit.name);
    expect(contentsLine([outfit.id])).not.toMatch(/Mystery/);
  });

  it('counts more than one', () => {
    expect(foundLine('treats', 1)).not.toMatch(/×/);
    expect(foundLine('treats', 3)).toMatch(/^3 × /);
    expect(foundLines({ treats: 3, pies: 1 })).toHaveLength(2);
  });
});

describe('advent words (style guide §9)', () => {
  it('avoid the avoided words', () => {
    const words: string[] = [];
    const collect = (value: unknown): void => {
      if (typeof value === 'string') words.push(value);
      else if (typeof value === 'function') {
        words.push((value as (n: number) => string)(3));
      } else if (value && typeof value === 'object') Object.values(value).forEach(collect);
    };
    collect(ADVENT_TEXT);
    expect(findAvoidedWords(words.join(' '))).toEqual([]);
  });
});
