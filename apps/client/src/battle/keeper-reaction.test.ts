import { describe, expect, it } from 'vitest';
import type { PlaybackStep } from './battle-playback.js';
import { effectivenessLine } from './battle-view.js';
import { keeperReaction } from './keeper-reaction.js';

const step = (kind: PlaybackStep['kind'], side: 'a' | 'b', extra: Partial<PlaybackStep> = {}) =>
  ({
    kind,
    side,
    slot: 0,
    text: '',
    callout: null,
    squish: null,
    energy: null,
    to: null,
    move: null,
    effectiveness: null,
    status: null,
    item: null,
    shielded: false,
    ms: 0,
    ...extra,
  }) satisfies PlaybackStep;

describe('keeperReaction', () => {
  it('jumps for joy when my squishy lands a super or good hit', () => {
    for (const tier of ['super', 'good']) {
      expect(keeperReaction(step('hit', 'b', { callout: effectivenessLine(tier) }), 'a')).toEqual({
        move: 'bounce',
        strength: 1,
      });
    }
  });

  it('just watches an ordinary or weak hit on the other side', () => {
    expect(keeperReaction(step('hit', 'b'), 'a')).toBeNull();
    expect(
      keeperReaction(step('hit', 'b', { callout: effectivenessLine('weak') }), 'a'),
    ).toBeNull();
  });

  it('winces a little when my squishy is hit, even by a big one', () => {
    const big = step('hit', 'a', { callout: effectivenessLine('super') });
    expect(keeperReaction(big, 'a')).toEqual({ move: 'wobble', strength: 0.5 });
  });

  it('reacts to tuckered-out squishies, swaps and the end', () => {
    expect(keeperReaction(step('tuckered', 'b'), 'a')?.move).toBe('bounce');
    expect(keeperReaction(step('tuckered', 'a'), 'a')?.move).toBe('wobble');
    expect(keeperReaction(step('swap', 'a'), 'a')?.move).toBe('jiggle');
    expect(keeperReaction(step('swap', 'b'), 'a')).toBeNull();
    expect(keeperReaction(step('end', 'a', { squish: 'bounce' }), 'a')?.move).toBe('bounce');
    expect(keeperReaction(step('end', 'a'), 'a')?.move).toBe('wobble');
  });

  it('stays still for moves, misses and status lines (no per-frame motion)', () => {
    for (const kind of ['move', 'miss', 'heal', 'effect', 'forfeit'] as const) {
      expect(keeperReaction(step(kind, 'a'), 'a')).toBeNull();
    }
  });

  it('watches a Heart Charm land, and cheers at the end for a new friend', () => {
    expect(keeperReaction(step('capture', 'b', { squish: 'bounce' }), 'a')).toBeNull();
    expect(keeperReaction(step('capture', 'b', { squish: 'wobble' }), 'a')).toBeNull();
    expect(keeperReaction(step('end', 'a', { squish: 'bounce' }), 'a')).toEqual({
      move: 'bounce',
      strength: 1.2,
    });
  });

  it('works from either side', () => {
    const big = step('hit', 'a', { callout: effectivenessLine('super') });
    expect(keeperReaction(big, 'b')?.move).toBe('bounce');
  });
});
