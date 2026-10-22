import { describe, expect, it } from 'vitest';
import {
  beamAt,
  chestSparkAt,
  easeOutBack,
  lidAngle,
  momentMs,
  sparkStart,
} from './cellar-chests-view.js';
import { CELLAR_CHESTS } from './hollowed-config.js';

describe('the cellar chests’ moments (#306)', () => {
  it('pops a small lid open with a little overshoot, then rests open', () => {
    const { open, openMs } = CELLAR_CHESTS.small;
    expect(lidAngle('small', -10)).toBe(0);
    expect(lidAngle('small', 0)).toBe(0);
    const peak = Math.max(
      ...Array.from({ length: 40 }, (_, i) => lidAngle('small', (i / 40) * openMs)),
    );
    expect(peak).toBeGreaterThan(open);
    expect(lidAngle('small', openMs * 3)).toBeCloseTo(open);
    expect(easeOutBack(1)).toBeCloseTo(1);
  });

  it('wobbles the big lid shut first, then swings it open slower', () => {
    const { open, openMs, wobbleMs, wobble } = CELLAR_CHESTS.big;
    for (let ms = 1; ms < wobbleMs; ms += 25) {
      expect(lidAngle('big', ms)).toBeLessThanOrEqual(wobble);
      expect(lidAngle('big', ms)).toBeGreaterThanOrEqual(0);
    }
    expect(lidAngle('big', wobbleMs + openMs * 3)).toBeCloseTo(open);
    expect(openMs).toBeGreaterThan(CELLAR_CHESTS.small.openMs);
    expect(momentMs('big')).toBeGreaterThan(momentMs('small'));
    expect(sparkStart('big')).toBeGreaterThan(wobbleMs);
  });

  it('flies sparkles up out of the chest and twinkles them out', () => {
    const out = { dx: 0, dy: 0, dz: 0, s: 0, a: 0 };
    for (let i = 0; i < CELLAR_CHESTS.big.sparks; i++) {
      chestSparkAt('big', i, 0.4, out);
      expect(out.dy).toBeGreaterThan(0);
      expect(out.s).toBeGreaterThan(0);
      chestSparkAt('big', i, 1, out);
      expect(out.s).toBeLessThan(0.05);
    }
  });

  it('shows the beam only after the wobble, growing then fading', () => {
    const { wobbleMs, beam } = CELLAR_CHESTS.big;
    expect(beamAt(wobbleMs / 2).alpha).toBe(0);
    const mid = beamAt(wobbleMs + beam.ms / 2);
    expect(mid.alpha).toBeGreaterThan(0.9);
    expect(mid.grow).toBeCloseTo(1, 1);
    expect(beamAt(wobbleMs + beam.ms + 1).alpha).toBe(0);
  });
});
