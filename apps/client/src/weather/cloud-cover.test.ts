import { describe, expect, it } from 'vitest';
import { createCloudDiscs, underCloud } from './cloud-cover.js';

describe('underCloud', () => {
  it('hides a point inside any cloud disc, and only while the disc is in use', () => {
    const cover = createCloudDiscs(2);
    cover.discs.set([100, 100, 30, 300, 200, 50]);
    cover.count = 2;
    expect(underCloud(cover, 110, 120)).toBe(true);
    expect(underCloud(cover, 340, 210)).toBe(true);
    expect(underCloud(cover, 200, 150)).toBe(false);
    cover.count = 1;
    expect(underCloud(cover, 340, 210)).toBe(false);
  });

  it('hides nothing with no clouds', () => {
    expect(underCloud(createCloudDiscs(4), 0, 0)).toBe(false);
  });
});
