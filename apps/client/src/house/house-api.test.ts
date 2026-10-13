import {
  BuildHouseRequestSchema,
  ClaimHouseGiftRequestSchema,
  HouseViewSchema,
  MoveResidentRequestSchema,
} from '@heartpatch/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { sampleHouse, withGift, withGrow } from './house-fixtures.js';

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

  it('moves a resident in or out with an Idempotency-Key, checked by the shared schema', async () => {
    const { houseApi } = await import('./house-api.js');
    const view = sampleHouse(1).view;
    apiCallFor.mockResolvedValue(view);
    const squishyId = '0190a000-0000-7000-8000-000000000001';
    await expect(houseApi.moveResident('map-1', squishyId, 'snug', 'key-1')).resolves.toBe(view);
    expect(apiCallFor).toHaveBeenCalledWith('/maps/map-1/house/residents', {
      method: 'POST',
      body: { squishyId, roomId: 'snug' },
      schema: HouseViewSchema,
      headers: { 'idempotency-key': 'key-1' },
    });
    // Moving out sends a null room, with the caller's key for that tap.
    await houseApi.moveResident('map-1', squishyId, null, 'key-2');
    const [, options] = apiCallFor.mock.calls[1] as [
      string,
      { body: unknown; headers: Record<string, string> },
    ];
    expect(options.body).toEqual({ squishyId, roomId: null });
    expect(options.headers['idempotency-key']).toBe('key-2');
    // Both bodies are what the server's strict schema takes.
    expect(MoveResidentRequestSchema.safeParse({ squishyId, roomId: 'snug' }).success).toBe(true);
    expect(MoveResidentRequestSchema.safeParse(options.body).success).toBe(true);
  });

  it('opens the day’s gift with its Idempotency-Key, the reply checked by the shared schema', async () => {
    const { houseApi } = await import('./house-api.js');
    const view = withGift(sampleHouse(1), { claimed: true }).view;
    apiCallFor.mockResolvedValue(view);
    await expect(houseApi.claimGift('map-1', '2026-10-12', 'gift-1')).resolves.toBe(view);
    expect(apiCallFor).toHaveBeenCalledWith('/maps/map-1/house/gift/claim', {
      method: 'POST',
      body: { day: '2026-10-12' },
      schema: HouseViewSchema,
      headers: { 'idempotency-key': 'gift-1' },
    });
    expect(ClaimHouseGiftRequestSchema.safeParse({ day: '2026-10-12' }).success).toBe(true);
  });

  it('the samples it is tested with are real house views', () => {
    for (const level of [1, 2, 3, 4]) {
      expect(HouseViewSchema.safeParse(sampleHouse(level).view).success).toBe(true);
      for (const grow of ['not-yet', 'ready'] as const) {
        expect(HouseViewSchema.safeParse(withGrow(sampleHouse(level), grow).view).success).toBe(
          true,
        );
      }
      for (const claimed of [false, true]) {
        expect(
          HouseViewSchema.safeParse(withGift(sampleHouse(level), { claimed }).view).success,
        ).toBe(true);
      }
    }
  });
});
