import { describe, expect, it } from 'vitest';
import { hardwareScalingFor } from './dpr.js';

describe('hardwareScalingFor', () => {
  it('renders at native resolution up to 2x', () => {
    expect(hardwareScalingFor(1)).toBe(1);
    expect(hardwareScalingFor(2)).toBe(0.5);
  });

  it('caps 3x screens at 2x', () => {
    expect(hardwareScalingFor(3)).toBe(0.5);
  });

  it('falls back to 1x for nonsense values', () => {
    expect(hardwareScalingFor(0)).toBe(1);
    expect(hardwareScalingFor(Number.NaN)).toBe(1);
  });
});
