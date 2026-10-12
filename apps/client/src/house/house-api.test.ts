import { HouseViewSchema } from '@heartpatch/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { sampleHouse } from './house-fixtures.js';

const apiCallFor = vi.fn();
vi.mock('../net/api.js', () => ({ apiCallFor }));

afterEach(() => {
  apiCallFor.mockReset();
});

describe('house api', () => {
  it('reads the patch’s house through the net client, checked by the shared schema', async () => {
    const { houseApi } = await import('./house-api.js');
    const view = sampleHouse(1).view;
    apiCallFor.mockResolvedValue(view);
    await expect(houseApi.get('map-1')).resolves.toBe(view);
    expect(apiCallFor).toHaveBeenCalledWith('/maps/map-1/house', {
      method: 'GET',
      schema: HouseViewSchema,
    });
  });

  it('the samples it is tested with are real house views', () => {
    for (const level of [1, 2, 3, 4]) {
      expect(HouseViewSchema.safeParse(sampleHouse(level).view).success).toBe(true);
    }
  });
});
