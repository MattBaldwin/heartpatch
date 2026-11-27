import { describe, expect, it } from 'vitest';
import { bossBeat } from './boss-beat.js';

const ctx = { boss: 'b' as const, lastMove: null, element: 'frost' as const };

describe('bossBeat (#190 PR 4)', () => {
  it("is the boss's windup, not the team's", () => {
    expect(bossBeat({ kind: 'effect', side: 'b', windup: true }, ctx)).toEqual({
      kind: 'windup',
      element: 'frost',
    });
    expect(bossBeat({ kind: 'effect', side: 'a', windup: true }, ctx)).toBeNull();
    expect(bossBeat({ kind: 'effect', side: 'b' }, ctx)).toBeNull();
  });

  it("lands on the team's hit after the boss's landing move only", () => {
    const landed = { ...ctx, lastMove: { user: 'b' as const, landing: true } };
    expect(bossBeat({ kind: 'hit', side: 'a' }, landed)?.kind).toBe('landing');
    // An ordinary boss hit, a hit on the boss, and my own landing are not the thump.
    expect(
      bossBeat({ kind: 'hit', side: 'a' }, { ...ctx, lastMove: { user: 'b', landing: false } }),
    ).toBeNull();
    expect(bossBeat({ kind: 'hit', side: 'b' }, landed)).toBeNull();
    expect(
      bossBeat({ kind: 'hit', side: 'b' }, { ...ctx, lastMove: { user: 'a', landing: true } }),
    ).toBeNull();
  });

  it("calls the boss's backup, and ends the fight", () => {
    expect(bossBeat({ kind: 'move', side: 'b', backup: true }, ctx)?.kind).toBe('backup');
    expect(bossBeat({ kind: 'move', side: 'a', backup: true }, ctx)).toBeNull();
    expect(bossBeat({ kind: 'move', side: 'b' }, ctx)).toBeNull();
    expect(bossBeat({ kind: 'end', side: 'a' }, ctx)).toEqual({ kind: 'end', element: null });
  });
});
