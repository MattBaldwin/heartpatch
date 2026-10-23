import { describe, expect, it } from 'vitest';
import {
  FAR_HOLLOW_TEXT,
  farHollowState,
  freshLine,
  justArrived,
  shortDate,
} from './far-hollow-model.js';

describe('the far Hollow sheet model (#306 PR 6)', () => {
  it('knows whether I am away, there, or done', () => {
    expect(farHollowState({ arrived: false, completedAt: null })).toBe('away');
    expect(farHollowState({ arrived: true, completedAt: null })).toBe('arrived');
    expect(farHollowState({ arrived: true, completedAt: '2026-11-04T16:00:00.000Z' })).toBe(
      'complete',
    );
  });

  it('knows I may only just have arrived: there, and nothing in the house found yet (#306 6c)', () => {
    const room = (id: string, fixed: string[] = []) => ({ id, fixed, bloomed: false });
    const house = (keys: string[], fixed: string[]) => ({
      room: 'front-hall',
      lastLitRoom: 'front-hall',
      keys,
      unlocked: [],
      bonusOpen: [],
      chestsOpened: [],
      rooms: [room('front-hall'), room('parlour', fixed)],
      echoes: [],
      serverTime: '2026-10-30T16:00:00.000Z',
    });
    expect(justArrived({ arrived: true, completedAt: null, house: null })).toBe(true);
    expect(justArrived({ arrived: true, completedAt: null, house: house([], []) })).toBe(true);
    expect(justArrived({ arrived: true, completedAt: null, house: house([], ['picture']) })).toBe(
      false,
    );
    expect(justArrived({ arrived: true, completedAt: null, house: house(['brass-key'], []) })).toBe(
      false,
    );
    expect(justArrived({ arrived: false, completedAt: null, house: null })).toBe(false);
    expect(
      justArrived({ arrived: true, completedAt: '2026-11-04T16:00:00.000Z', house: house([], []) }),
    ).toBe(false);
  });

  it('says when a fresh one comes', () => {
    expect(shortDate('2026-12-01')).toBe('Dec 1');
    expect(shortDate('2027-10-01')).toBe('Oct 1');
    expect(freshLine({ id: 'christmas', name: 'Christmas', startsOn: '2026-12-01' })).toBe(
      'A fresh far Hollow comes with Christmas on Dec 1 ✨',
    );
    expect(freshLine(null)).toBe(FAR_HOLLOW_TEXT.freshSoon);
  });

  it('keeps the words kind and short', () => {
    expect(FAR_HOLLOW_TEXT.title('The far Hollow')).toBe('The far Hollow 🕯️');
    // Patch › Town › Hollow: never "village" or "community" in player text.
    const words = [
      ...Object.values(FAR_HOLLOW_TEXT).flatMap((w) => (typeof w === 'string' ? [w] : [])),
      FAR_HOLLOW_TEXT.title('The far Hollow'),
      FAR_HOLLOW_TEXT.kicker('Christmas'),
      FAR_HOLLOW_TEXT.road(3, 16),
      FAR_HOLLOW_TEXT.fresh('Christmas', 'Dec 1'),
    ];
    for (const line of words) {
      expect(line).not.toMatch(/village|community/i);
      expect(line.length).toBeLessThan(140);
    }
  });
});
