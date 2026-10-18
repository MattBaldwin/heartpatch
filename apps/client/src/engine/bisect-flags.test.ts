import { describe, expect, it } from 'vitest';
import {
  bisectFlags,
  bisectLabel,
  NO_BISECT,
  readBisectFlags,
  setBisectFlags,
} from './bisect-flags.js';

describe('bisect flags (#501)', () => {
  it('reads each flag from the address, only with =1', () => {
    expect(readBisectFlags(new URLSearchParams('?fps=1'))).toEqual(NO_BISECT);
    expect(readBisectFlags(new URLSearchParams('?nopost=1&nowater=1&cap30=1&nosky=0'))).toEqual({
      ...NO_BISECT,
      noPost: true,
      noWater: true,
      cap30: true,
    });
    expect(readBisectFlags(new URLSearchParams('?nograss=1&nosky=1&noportraits=1'))).toMatchObject({
      noGrass: true,
      noSky: true,
      noPortraits: true,
      noPost: false,
    });
  });

  it('labels the flags that are on as the address spells them', () => {
    expect(bisectLabel(NO_BISECT)).toBe('');
    expect(bisectLabel({ ...NO_BISECT, noWater: true, cap30: true })).toBe('nowater cap30');
  });

  it('holds one set for the page, none until set', () => {
    expect(bisectFlags()).toEqual(NO_BISECT);
    setBisectFlags({ ...NO_BISECT, noSky: true });
    expect(bisectFlags().noSky).toBe(true);
    setBisectFlags(NO_BISECT);
  });
});
