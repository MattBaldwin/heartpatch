import { GAME_DATA } from '@heartpatch/shared';
import { describe, expect, it } from 'vitest';
import { weatherNotesLine } from './night-text.js';

const [first, second, third, fourth] = GAME_DATA.buildings;

describe('weatherNotesLine', () => {
  it('says nothing with nothing knocked', () => {
    expect(weatherNotesLine([])).toBeNull();
  });

  it('names one building and asks kindly for a fix', () => {
    const line = weatherNotesLine([{ buildingId: first!.id }]);
    expect(line?.text).toBe(`The storm knocked your ${first!.name} about 🌧️ Fix it when you can!`);
  });

  it('counts when there are many', () => {
    const line = weatherNotesLine(
      [first, second, third, fourth].map((b) => ({ buildingId: b!.id })),
    );
    expect(line?.text).toContain('4 of your buildings');
    expect(line?.text).toContain('Fix them');
    expect(line?.text).not.toMatch(/damag|destroy|broke/i);
  });
});
