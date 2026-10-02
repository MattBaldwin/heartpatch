import { describe, expect, it } from 'vitest';
import { SPROUT } from './sprout-config.js';
import { sproutHash, sproutParams } from './sprout-params.js';

describe('sproutParams', () => {
  it('is the same Sprout every time for the same player', () => {
    expect(sproutParams('player-1')).toEqual(sproutParams('player-1'));
    expect(sproutHash(sproutParams('player-1'))).toBe(sproutHash(sproutParams('player-1')));
  });

  it('varies a little between players', () => {
    expect(sproutHash(sproutParams('player-1'))).not.toBe(sproutHash(sproutParams('player-2')));
  });

  it('stays inside the tuned ranges', () => {
    for (const owner of ['a', 'b', 'c', 'd', 'e', 'f']) {
      const p = sproutParams(owner);
      expect(p.glow).toBeGreaterThanOrEqual(SPROUT.glow.min);
      expect(p.glow).toBeLessThanOrEqual(SPROUT.glow.max);
      expect(p.squash).toBeGreaterThanOrEqual(SPROUT.squash.min);
      expect(p.squash).toBeLessThanOrEqual(SPROUT.squash.max);
      expect(p.leafSplayDeg).toBeGreaterThanOrEqual(SPROUT.leafSplayDeg.min);
      expect(p.leafSplayDeg).toBeLessThanOrEqual(SPROUT.leafSplayDeg.max);
      for (const c of p.body) {
        expect(c).toBeGreaterThanOrEqual(0);
        expect(c).toBeLessThanOrEqual(1);
      }
    }
  });

  // Pinned so a change to the seeding (which would change every player's
  // Sprout) is a deliberate one.
  it('keeps its seeding stable', () => {
    expect(sproutHash(sproutParams('player-1'))).toMatchInlineSnapshot(
      `"963470ad6a695fa6b2e9ceb527ceb279"`,
    );
  });
});
