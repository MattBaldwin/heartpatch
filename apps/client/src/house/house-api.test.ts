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

  it('moves a resident in or out with an Idempotency-Key, checked by the shared schema', async () => {
    const { moveResident } = await import('./house-api.js');
    const view = sampleHouse(1).view;
    apiCallFor.mockResolvedValue(view);
    const squishyId = '0190a000-0000-7000-8000-000000000001';
    await expect(moveResident('map-1', squishyId, 'snug', 'key-1')).resolves.toBe(view);
    expect(apiCallFor).toHaveBeenCalledWith('/maps/map-1/house/residents', {
      method: 'POST',
      body: { squishyId, roomId: 'snug' },
      schema: HouseViewSchema,
      headers: { 'idempotency-key': 'key-1' },
    });
    // Moving out sends a null room, with a fresh key of its own.
    await moveResident('map-1', squishyId, null);
    const [, options] = apiCallFor.mock.calls[1] as [
      string,
      { body: unknown; headers: Record<string, string> },
    ];
    expect(options.body).toEqual({ squishyId, roomId: null });
    expect(options.headers['idempotency-key']).toMatch(/^[0-9a-f]{32}$/u);
  });

  it('the samples it is tested with are real house views', () => {
    for (const level of [1, 2, 3, 4]) {
      expect(HouseViewSchema.safeParse(sampleHouse(level).view).success).toBe(true);
    }
  });
});
