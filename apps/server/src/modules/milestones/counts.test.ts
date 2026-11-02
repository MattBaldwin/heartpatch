import { MILESTONE_RULES } from '@heartpatch/shared';
import { describe, expect, it } from 'vitest';
import { milestonesCount } from './counts.js';

describe('milestonesCount', () => {
  const min = MILESTONE_RULES.minMembers;

  it('counts on a multiplayer patch with enough active members', () => {
    expect(milestonesCount({ kind: 'multiplayer', members: min })).toBe(true);
    expect(milestonesCount({ kind: 'multiplayer', members: min + 1 })).toBe(true);
  });

  it("doesn't count on a patch with too few members", () => {
    expect(milestonesCount({ kind: 'multiplayer', members: min - 1 })).toBe(false);
    expect(milestonesCount({ kind: 'multiplayer', members: 0 })).toBe(false);
  });

  it('never counts on the Tutorial Glade, however many members', () => {
    expect(milestonesCount({ kind: 'tutorial', members: min + 5 })).toBe(false);
  });

  it('uses the rules it is given', () => {
    expect(milestonesCount({ kind: 'multiplayer', members: 1 }, { minMembers: 1 })).toBe(true);
    expect(milestonesCount({ kind: 'multiplayer', members: 2 }, { minMembers: 3 })).toBe(false);
  });
});
