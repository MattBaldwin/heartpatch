import { describe, expect, it, vi } from 'vitest';
import { ApiRequestError } from '../net/api.js';
import { createHouseBuilder } from './house-build.js';
import { sampleHouse } from './house-fixtures.js';

const built = sampleHouse(2).view;
const offline = () => new ApiRequestError('OFFLINE', 'We can’t reach the patch right now.');

function setup(build: (mapId: string, toLevel: number, key: string) => Promise<typeof built>) {
  let n = 0;
  const spy = vi.fn(build);
  const builder = createHouseBuilder({
    build: spy,
    newKey: () => `key-${String(++n)}`,
    wait: () => Promise.resolve(),
    retryAfterMs: 0,
  });
  return { builder, spy };
}

describe('house build', () => {
  it('builds the level it was asked for with a fresh Idempotency-Key, and hands back the new house', async () => {
    const { builder, spy } = setup(() => Promise.resolve(built));
    await expect(builder.build('map-1', 2, () => true)).resolves.toEqual({
      kind: 'built',
      view: built,
    });
    expect(spy).toHaveBeenCalledWith('map-1', 2, 'key-1');
  });

  it('retries once after a dropped connection with the same key, so the server replays it', async () => {
    const { builder, spy } = setup(
      vi.fn().mockRejectedValueOnce(offline()).mockResolvedValueOnce(built),
    );
    await expect(builder.build('map-1', 2, () => true)).resolves.toMatchObject({ kind: 'built' });
    expect(spy.mock.calls.map((c) => c[2])).toEqual(['key-1', 'key-1']);
  });

  it('a new tap after a failure is a new attempt with a new key', async () => {
    const { builder, spy } = setup(
      vi
        .fn()
        .mockRejectedValueOnce(new ApiRequestError('CONFLICT', 'Not quite yet!'))
        .mockResolvedValueOnce(built),
    );
    await builder.build('map-1', 2, () => true);
    await builder.build('map-1', 2, () => true);
    expect(spy.mock.calls.map((c) => c[2])).toEqual(['key-1', 'key-2']);
  });

  it('passes the server’s kid message on calmly, and a stranger error kindly', async () => {
    const message = 'Not quite yet! Check what the house needs.';
    const { builder } = setup(() => Promise.reject(new ApiRequestError('CONFLICT', message)));
    await expect(builder.build('map-1', 2, () => true)).resolves.toEqual({
      kind: 'failed',
      message,
    });
    const { builder: other } = setup(() => Promise.reject(new Error('boom')));
    await expect(other.build('map-1', 2, () => true)).resolves.toEqual({
      kind: 'failed',
      message: 'Oops, something went wobbly. Try again!',
    });
  });

  it('builds once for a double tap: the second waits for nothing', async () => {
    let finish: (v: typeof built) => void = () => undefined;
    const { builder, spy } = setup(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const first = builder.build('map-1', 2, () => true);
    expect(builder.busy).toBe(true);
    await expect(builder.build('map-1', 2, () => true)).resolves.toEqual({ kind: 'dropped' });
    finish(built);
    await expect(first).resolves.toMatchObject({ kind: 'built' });
    expect(spy).toHaveBeenCalledTimes(1);
    expect(builder.busy).toBe(false);
  });

  it('drops the reply once the player has left the house', async () => {
    let wanted = true;
    const { builder } = setup(() => {
      wanted = false;
      return Promise.resolve(built);
    });
    await expect(builder.build('map-1', 2, () => wanted)).resolves.toEqual({ kind: 'dropped' });
  });

  it('sends no retry once the player has left', async () => {
    let wanted = true;
    const { builder, spy } = setup(() => {
      wanted = false;
      return Promise.reject(offline());
    });
    await expect(builder.build('map-1', 2, () => wanted)).resolves.toEqual({ kind: 'dropped' });
    expect(spy).toHaveBeenCalledTimes(1);
  });
});
