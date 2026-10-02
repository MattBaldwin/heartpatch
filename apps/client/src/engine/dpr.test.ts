import { describe, expect, it } from 'vitest';
import { cappedPixelRatio, hardwareScalingFor } from './dpr.js';

describe('hardwareScalingFor', () => {
  it('renders at native resolution up to 2x', () => {
    expect(hardwareScalingFor(1)).toBe(1);
    expect(hardwareScalingFor(2)).toBe(0.5);
  });

  it('caps 3x screens at 2x', () => {
    expect(hardwareScalingFor(3)).toBe(0.5);
    expect(cappedPixelRatio(3)).toBe(2);
  });

  it('falls back to 1x for nonsense values', () => {
    expect(hardwareScalingFor(0)).toBe(1);
    expect(hardwareScalingFor(Number.NaN)).toBe(1);
  });

  it('applies the dynamic render scale on top of the DPR cap', () => {
    expect(hardwareScalingFor(3, 0.75)).toBeCloseTo(1 / 1.5);
    expect(hardwareScalingFor(2, 2)).toBe(0.5);
    expect(hardwareScalingFor(2, 0)).toBe(0.5);
  });
});
