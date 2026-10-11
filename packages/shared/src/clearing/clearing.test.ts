import { describe, expect, it } from 'vitest';
import { CLEARING_RULES } from '../data/clearing.js';
import { JOB_RULES } from '../data/jobs.js';
import { RESOURCES } from '../data/resources.js';
import { clearDrop } from './index.js';

const drop = (terrain: string, nodeResource: string | null = null) =>
  clearDrop({ terrain, nodeResource }, RESOURCES, JOB_RULES, CLEARING_RULES);

describe('clearDrop (#242)', () => {
  it("drops one gather of the tile's spot", () => {
    const stone = RESOURCES.find((r) => r.id === 'stone')?.gather?.quantity;
    expect(drop('hills', 'stone')).toEqual({ stone });
    expect(drop('mountains', 'glimmer')).toEqual({ glimmer: 1 });
  });

  it("drops a couple of the land's own yield when there's no spot", () => {
    expect(drop('meadow')).toEqual({ greens: 4 });
    expect(drop('mountains')).toEqual({ ice: 2 });
  });

  it('drops nothing where nothing grows', () => {
    expect(drop('clearing')).toEqual({});
  });
});
