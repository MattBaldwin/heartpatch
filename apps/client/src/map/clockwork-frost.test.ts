import { describe, expect, it } from 'vitest';
import { ClockworkFrost, clockworkFrost, FROST_LOOK, frostUniform } from './clockwork-frost.js';

describe('Clockwork Isle frost (#874 C4, plan R1.1)', () => {
  it('frosts a Clockwork Isle only', () => {
    expect(clockworkFrost('clockwork-isle')).toBeInstanceOf(ClockworkFrost);
    expect(clockworkFrost('wild-isle')).toBeNull();
    expect(clockworkFrost('cozy')).toBeNull();
    // An older server sends no type: a Cozy Patch.
    expect(clockworkFrost(undefined)).toBeNull();
  });

  it('sets the one uniform from the look, and turns off at amount 0', () => {
    const frost = new ClockworkFrost();
    expect(frostUniform(frost)).toEqual([
      FROST_LOOK.tint,
      FROST_LOOK.rimStrength,
      FROST_LOOK.rimPower,
      1,
    ]);
    frost.amount = 0;
    const [tint, rim, , on] = frostUniform(frost);
    expect([tint, rim, on]).toEqual([0, 0, 0]);
  });

  it('hands the shader linear colours (the look is sRGB)', () => {
    const frost = new ClockworkFrost();
    expect(frost.color[0]).toBeCloseTo(FROST_LOOK.color[0] ** 2.2);
    expect(frost.rim[2]).toBeCloseTo(FROST_LOOK.rim[2] ** 2.2);
  });

  it('is cool and soft: blue over red, a light touch', () => {
    const [r, , b] = FROST_LOOK.color;
    expect(b).toBeGreaterThan(r);
    expect(FROST_LOOK.tint).toBeGreaterThan(0);
    expect(FROST_LOOK.tint).toBeLessThanOrEqual(0.35);
    expect(FROST_LOOK.rimStrength).toBeLessThanOrEqual(0.5);
  });
});
