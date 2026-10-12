import { describe, expect, it } from 'vitest';
import { HOUSE_NOTES } from '../data/house-notes.js';
import { HOUSE_GIFTS } from '../data/server/house-gifts.js';
import { deriveSeed } from '../rng/index.js';
import {
  houseGiftNote,
  houseGiftRow,
  houseGiftSeed,
  rollHouseGift,
  type HouseGiftGiver,
} from './gifts.js';

describe('the daily gift roll (#381 PR H, server-only)', () => {
  const userId = '0190a000-0000-7000-8000-000000000001';
  const mapSeed = 'a-secret-map-seed';
  const givers: HouseGiftGiver[] = [
    { squishyId: '0190a000-0000-7000-8000-00000000000a', feeling: 'silly' },
    { squishyId: '0190a000-0000-7000-8000-00000000000b', feeling: 'cozy' },
    { squishyId: '0190a000-0000-7000-8000-00000000000c', feeling: 'sleepy' },
  ];
  const input = { mapSeed, userId, day: '2026-10-12', level: 1, givers };
  const roll = (over: Partial<typeof input> = {}) =>
    rollHouseGift({ ...input, ...over }, HOUSE_GIFTS, HOUSE_NOTES);

  it('is seeded from the map seed, the Keeper and the day', () => {
    expect(houseGiftSeed(input)).toBe(deriveSeed(mapSeed, 'house-gift', userId, '2026-10-12'));
  });

  it('rolls the same gift for the same inputs, whatever order the residents come in', () => {
    const first = roll();
    expect(first).not.toBeNull();
    expect(roll()).toEqual(first);
    expect(roll({ givers: [...givers].reverse() })).toEqual(first);
  });

  it('rolls afresh on another day, and for another Keeper or map seed', () => {
    const days = Array.from({ length: 10 }, (_, i) => `2026-10-${String(10 + i)}`);
    expect(new Set(days.map((day) => JSON.stringify(roll({ day })))).size).toBeGreaterThan(1);
    expect(roll({ day: '2026-10-13' })).not.toEqual(roll());
    const others = [
      roll({ userId: '0190a000-0000-7000-8000-0000000000ff' }),
      roll({ mapSeed: 'another-map-seed' }),
    ];
    expect(others.some((o) => JSON.stringify(o) !== JSON.stringify(roll()))).toBe(true);
  });

  it('leaves no gift when no resident is home', () => {
    expect(roll({ givers: [] })).toBeNull();
  });

  it('gives something from its level row, in range, from a resident at home', () => {
    for (const level of [1, 2, 3, 4]) {
      const row = houseGiftRow(HOUSE_GIFTS, level);
      for (let d = 1; d <= 28; d += 1) {
        const gift = roll({ level, day: `2026-11-${String(d).padStart(2, '0')}` })!;
        const option = row.gifts.find((g) => g.itemId === gift.itemId)!;
        expect(option).toBeDefined();
        expect(gift.count).toBeGreaterThanOrEqual(option.min);
        expect(gift.count).toBeLessThanOrEqual(option.max);
        expect(givers.map((g) => g.squishyId)).toContain(gift.giverSquishyId);
      }
    }
  });

  it('picks the highest gift row at or under the level, and Glimmer only from level 3', () => {
    expect(houseGiftRow(HOUSE_GIFTS, 1).fromLevel).toBe(1);
    expect(houseGiftRow(HOUSE_GIFTS, 3).fromLevel).toBe(3);
    expect(houseGiftRow(HOUSE_GIFTS, 9).fromLevel).toBe(4);
    const glimmer = (level: number) =>
      houseGiftRow(HOUSE_GIFTS, level).gifts.some((g) => g.itemId === 'glimmer');
    expect([1, 2, 3, 4].map(glimmer)).toEqual([false, false, true, true]);
  });

  it("matches the note to the giver's feeling (or anyone's), the same every time", () => {
    const giver = givers[0]!;
    const gift = roll({ givers: [giver] })!;
    const note = HOUSE_NOTES.find((n) => n.id === gift.noteId)!;
    expect([undefined, 'silly']).toContain(note.feeling);
    expect(houseGiftNote(HOUSE_NOTES, { ...input, ...giver }).id).toBe(gift.noteId);
    // A giver whose squishy row is gone: a note for anyone.
    for (let d = 1; d <= 20; d += 1) {
      const day = `2026-12-${String(d).padStart(2, '0')}`;
      const gone = houseGiftNote(HOUSE_NOTES, { ...input, day, squishyId: '', feeling: null });
      expect(gone.feeling).toBeUndefined();
    }
  });
});
