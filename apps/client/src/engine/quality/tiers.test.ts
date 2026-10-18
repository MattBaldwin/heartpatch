import { describe, expect, it } from 'vitest';
import { DEFAULT_QUALITY_TIER } from '../config.js';
import {
  crawlRenderScale,
  higherTier,
  isPhoneScreen,
  isQualityTier,
  lowerTier,
  pickInitialTier,
  renderScaleFloor,
  tierBloom,
} from './tiers.js';

describe('pickInitialTier', () => {
  it('defaults to high on the playtest devices', () => {
    expect(DEFAULT_QUALITY_TIER).toBe('high');
    expect(pickInitialTier()).toBe('high');
    expect(pickInitialTier(null, undefined)).toBe('high');
  });

  it('uses the first valid override', () => {
    expect(pickInitialTier('low')).toBe('low');
    expect(pickInitialTier('ultra', 'medium', 'low')).toBe('medium');
  });

  it('ignores junk', () => {
    expect(pickInitialTier('HIGH', '', 'toString')).toBe('high');
    expect(isQualityTier(3)).toBe(false);
  });
});

describe('lowerTier', () => {
  it('steps high → medium → low → nothing', () => {
    expect(lowerTier('high')).toBe('medium');
    expect(lowerTier('medium')).toBe('low');
    expect(lowerTier('low')).toBeNull();
  });
});

describe('higherTier', () => {
  it('steps back up, never above the ceiling', () => {
    expect(higherTier('low', 'high')).toBe('medium');
    expect(higherTier('medium', 'high')).toBe('high');
    expect(higherTier('high', 'high')).toBeNull();
    expect(higherTier('medium', 'medium')).toBeNull();
    expect(higherTier('low', 'medium')).toBe('medium');
  });
});

describe('renderScaleFloor', () => {
  it('uses the tier floor on Retina screens', () => {
    expect(renderScaleFloor('high', 2)).toBe(0.75);
    expect(renderScaleFloor('high', 3)).toBe(0.75);
    expect(renderScaleFloor('low', 2)).toBe(0.7);
  });

  it('never drops below one render pixel per CSS pixel', () => {
    expect(renderScaleFloor('low', 1)).toBe(1);
    expect(renderScaleFloor('low', 1.25)).toBeCloseTo(0.8);
    expect(renderScaleFloor('high', Number.NaN)).toBe(1);
  });

  it('keeps every effective pixel ratio at 1.4x or more on 2x screens', () => {
    for (const tier of ['high', 'medium', 'low'] as const) {
      expect(renderScaleFloor(tier, 2) * 2).toBeGreaterThanOrEqual(1.4);
    }
  });
});

describe('crawlRenderScale', () => {
  it('is one render pixel per CSS pixel, under the DPR cap, never above 1', () => {
    expect(crawlRenderScale(2)).toBe(0.5);
    expect(crawlRenderScale(3)).toBe(0.5); // the DPR cap is 2
    expect(crawlRenderScale(1.5)).toBeCloseTo(2 / 3);
    expect(crawlRenderScale(1)).toBe(1);
    expect(crawlRenderScale(Number.NaN)).toBe(1);
  });

  it('is never above a tier floor', () => {
    for (const tier of ['high', 'medium', 'low'] as const) {
      for (const dpr of [1, 1.25, 1.5, 2, 3]) {
        expect(crawlRenderScale(dpr)).toBeLessThanOrEqual(renderScaleFloor(tier, dpr));
      }
    }
  });
});

describe('isPhoneScreen (#501)', () => {
  it('is an iPhone in either orientation', () => {
    expect(isPhoneScreen({ width: 375, height: 667 })).toBe(true);
    expect(isPhoneScreen({ width: 440, height: 956 })).toBe(true);
    expect(isPhoneScreen({ width: 956, height: 440 })).toBe(true);
  });

  it('is not an iPad, a laptop or a missing screen', () => {
    expect(isPhoneScreen({ width: 744, height: 1133 })).toBe(false); // iPad mini
    expect(isPhoneScreen({ width: 834, height: 1194 })).toBe(false);
    expect(isPhoneScreen({ width: 1440, height: 900 })).toBe(false);
    expect(isPhoneScreen(undefined)).toBe(false);
    expect(isPhoneScreen({ width: 0, height: 0 })).toBe(false);
  });
});

describe('tierBloom (#501)', () => {
  it('drops bloom on medium on a phone only', () => {
    expect(tierBloom('high', true)).toBe(true);
    expect(tierBloom('medium', true)).toBe(false);
    expect(tierBloom('low', true)).toBe(false);
    expect(tierBloom('high', false)).toBe(true);
    expect(tierBloom('medium', false)).toBe(true);
    expect(tierBloom('low', false)).toBe(false);
  });
});
