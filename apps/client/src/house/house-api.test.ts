import { BuildHouseRequestSchema, HouseViewSchema } from '@heartpatch/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { sampleHouse, withGrow } from './house-fixtures.js';

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

  it('builds the next level with its Idempotency-Key, the reply checked by the shared schema', async () => {
    const { houseApi } = await import('./house-api.js');
    const view = sampleHouse(2).view;
    apiCallFor.mockResolvedValue(view);
    await expect(houseApi.build('map-1', 2, 'abc123')).resolves.toBe(view);
    expect(apiCallFor).toHaveBeenCalledWith('/maps/map-1/house/build', {
      method: 'POST',
      body: { toLevel: 2 },
      schema: HouseViewSchema,
      headers: { 'idempotency-key': 'abc123' },
    });
    // The body is what the server's strict schema takes.
    expect(BuildHouseRequestSchema.safeParse({ toLevel: 2 }).success).toBe(true);
  });

  it('the samples it is tested with are real house views', () => {
    for (const level of [1, 2, 3, 4]) {
      expect(HouseViewSchema.safeParse(sampleHouse(level).view).success).toBe(true);
      for (const grow of ['not-yet', 'ready'] as const) {
        expect(HouseViewSchema.safeParse(withGrow(sampleHouse(level), grow).view).success).toBe(
          true,
        );
      }
    }
  });
});
