import { describe, expect, it, vi } from 'vitest';
import { ApiRequestError } from '../net/api.js';
import { sampleHouse } from './house-fixtures.js';
import { createResidentMover } from './house-move.js';

const moved = sampleHouse(1).view;
const offline = () => new ApiRequestError('OFFLINE', 'We can’t reach the patch right now.');
const mochi = '0190a000-0000-7000-8000-000000000001';

function setup(
  move: (
    mapId: string,
    squishyId: string,
    roomId: string | null,
    key: string,
  ) => Promise<typeof moved>,
) {
  let n = 0;
  const spy = vi.fn(move);
  const mover = createResidentMover({
    move: spy,
    newKey: () => `key-${String(++n)}`,
    wait: () => Promise.resolve(),
    retryAfterMs: 0,
  });
  return { mover, spy };
}

describe('moving a resident', () => {
  it('moves in with a fresh Idempotency-Key and hands back the house', async () => {
    const { mover, spy } = setup(() => Promise.resolve(moved));
    await expect(mover.move('map-1', mochi, 'snug', () => true)).resolves.toEqual({
      kind: 'moved',
      view: moved,
    });
    expect(spy).toHaveBeenCalledWith('map-1', mochi, 'snug', 'key-1');
  });

  it('moves out with a null room', async () => {
    const { mover, spy } = setup(() => Promise.resolve(moved));
    await mover.move('map-1', mochi, null, () => true);
    expect(spy).toHaveBeenCalledWith('map-1', mochi, null, 'key-1');
  });

  it('retries once after a dropped connection with the same key; a new tap gets a new key', async () => {
    const { mover, spy } = setup(
      vi
        .fn()
        .mockRejectedValueOnce(offline())
        .mockResolvedValueOnce(moved)
        .mockResolvedValueOnce(moved),
    );
    await expect(mover.move('map-1', mochi, 'snug', () => true)).resolves.toMatchObject({
      kind: 'moved',
    });
    await mover.move('map-1', mochi, null, () => true);
    expect(spy.mock.calls.map((c) => c[3])).toEqual(['key-1', 'key-1', 'key-2']);
  });

  it('passes the server’s refusal on calmly', async () => {
    const message = 'Mochi just moved out. Let them stretch their legs first!';
    const { mover } = setup(() => Promise.reject(new ApiRequestError('CONFLICT', message)));
    await expect(mover.move('map-1', mochi, 'snug', () => true)).resolves.toEqual({
      kind: 'failed',
      message,
    });
  });

  it('moves once for a double tap, and drops a reply after the player left', async () => {
    let finish: (v: typeof moved) => void = () => undefined;
    const { mover, spy } = setup(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const first = mover.move('map-1', mochi, 'snug', () => true);
    expect(mover.busy).toBe(true);
    await expect(mover.move('map-1', mochi, 'snug', () => true)).resolves.toEqual({
      kind: 'dropped',
    });
    finish(moved);
    await expect(first).resolves.toMatchObject({ kind: 'moved' });
    expect(spy).toHaveBeenCalledTimes(1);
    expect(mover.busy).toBe(false);

    let wanted = true;
    const { mover: late } = setup(() => {
      wanted = false;
      return Promise.resolve(moved);
    });
    await expect(late.move('map-1', mochi, 'snug', () => wanted)).resolves.toEqual({
      kind: 'dropped',
    });
  });
});
