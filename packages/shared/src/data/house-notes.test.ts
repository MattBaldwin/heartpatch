import { describe, expect, it } from 'vitest';
import { FeelingIdSchema } from '../schemas/data/elements.js';
import { checkHouseNotes, type HouseNote } from '../schemas/data/house.js';
import { HOUSE_NOTES } from './house-notes.js';

describe('HOUSE_NOTES (#381 PR H)', () => {
  it('passes its checks: avoided words, one {name} each, unique ids, notes for anyone', () => {
    expect(checkHouseNotes(HOUSE_NOTES)).toEqual([]);
  });

  it('has notes for every feeling, so any giver gets one that suits it', () => {
    for (const feeling of FeelingIdSchema.options) {
      expect(HOUSE_NOTES.some((n) => n.feeling === feeling)).toBe(true);
    }
  });

  it('keeps every note short, a glance for a 10-year-old (style guide §2)', () => {
    for (const note of HOUSE_NOTES) {
      expect(note.line.split(/\s+/).length, note.id).toBeLessThanOrEqual(12);
    }
  });

  it('refuses an avoided word, a missing or doubled {name}, a duplicate id, and no notes for anyone', () => {
    const broken: HouseNote[] = [
      { id: 'grumpy', feeling: 'brave', line: '{name} chased off an enemy for you' },
      { id: 'nameless', feeling: 'joy', line: 'Someone left this' },
      { id: 'twice', feeling: 'joy', line: '{name} and {name} again' },
      { id: 'twice', feeling: 'cozy', line: '{name} is cozy' },
    ];
    expect(checkHouseNotes(broken)).toEqual([
      'notes["nameless"]: the line names {name} exactly once',
      'notes["twice"]: the line names {name} exactly once',
      'notes: duplicate id "twice"',
      'notes: needs at least one note for any giver (no feeling)',
      'notes["grumpy"].line: "enemy"',
    ]);
  });
});
