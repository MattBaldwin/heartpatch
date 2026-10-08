import { describe, expect, it } from 'vitest';
import { BORDER, PLAYER_COLORS } from './map-config.js';
import { legendEntries, legendLabel } from './map-legend.js';
import { member, testView, userId } from './test-view.js';

describe('legendEntries', () => {
  it('lists every Keeper with a home, in slot order, as their land is drawn', () => {
    const members = [...testView(4).members].reverse();
    const entries = legendEntries(members, userId(2));
    expect(entries.map((e) => e.slot)).toEqual([0, 1, 2, 3]);
    expect(entries.map((e) => e.mine)).toEqual([false, true, false, false]);
    for (const e of entries) {
      expect(e.color).toBe(PLAYER_COLORS[e.slot]);
      expect(e.icon).toBe(BORDER.icons[e.slot]);
      expect(e.line).toBe(BORDER.lines[e.slot]);
    }
  });

  it('leaves out members without a home on this map', () => {
    const homeless = { ...member(5, 0), homeSlot: null };
    expect(legendEntries([member(1, 0), homeless], null)).toHaveLength(1);
  });

  it('marks nobody as mine for a visitor', () => {
    expect(legendEntries(testView(2).members, null).some((e) => e.mine)).toBe(false);
  });
});

describe('legendLabel', () => {
  it('says whose land it is', () => {
    const [you, sunny] = legendEntries([member(1, 0), member(4, 3)], userId(1));
    expect(legendLabel(you!)).toBe('Your land');
    expect(legendLabel(sunny!)).toBe("keeper4's land");
  });
});
