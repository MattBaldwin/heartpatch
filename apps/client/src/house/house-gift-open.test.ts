import type { HouseView } from '@heartpatch/shared';
import { describe, expect, it, vi } from 'vitest';
import { ApiRequestError } from '../net/api.js';
import { sampleHouse, withGift } from './house-fixtures.js';
import { createGiftOpener } from './house-gift-open.js';
import { createViewSync } from './house-view-sync.js';

const wrapped = withGift(sampleHouse(1)).view;
const opened = withGift(sampleHouse(1), { claimed: true }).view;
const offline = () => new ApiRequestError('OFFLINE', 'We can’t reach the patch right now.');

function setup(claim: (mapId: string, day: string, key: string) => Promise<HouseView>) {
  let n = 0;
  const spy = vi.fn(claim);
  const opener = createGiftOpener({
    claim: spy,
    newKey: () => `key-${String(++n)}`,
    wait: () => Promise.resolve(),
    retryAfterMs: 0,
  });
  return { opener, spy };
}

/** A reply the test lands by hand. */
function deferred<T>() {
  let resolve: (v: T) => void = () => undefined;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

describe('opening the daily gift (#381 H2)', () => {
  it('opens the day the house showed with a fresh Idempotency-Key, and hands back the house', async () => {
    const { opener, spy } = setup(() => Promise.resolve(opened));
    await expect(opener.open('map-1', '2026-10-12', () => true)).resolves.toEqual({
      kind: 'opened',
      view: opened,
    });
    expect(spy).toHaveBeenCalledWith('map-1', '2026-10-12', 'key-1');
  });

  it('retries once after a dropped connection with the same key, so the server replays it', async () => {
    const { opener, spy } = setup(
      vi.fn().mockRejectedValueOnce(offline()).mockResolvedValueOnce(opened),
    );
    await expect(opener.open('map-1', '2026-10-12', () => true)).resolves.toMatchObject({
      kind: 'opened',
    });
    expect(spy.mock.calls.map((c) => c[2])).toEqual(['key-1', 'key-1']);
  });

  it('a new tap after a refusal is a new attempt with a new key', async () => {
    const { opener, spy } = setup(
      vi
        .fn()
        .mockRejectedValueOnce(
          new ApiRequestError('CONFLICT', 'No gift yet today. Check back soon! 🎁'),
        )
        .mockResolvedValueOnce(opened),
    );
    await opener.open('map-1', '2026-10-12', () => true);
    await opener.open('map-1', '2026-10-12', () => true);
    expect(spy.mock.calls.map((c) => c[2])).toEqual(['key-1', 'key-2']);
  });

  it('shows the server’s CONFLICT message as given', async () => {
    const message = 'Already opened! Come back tomorrow 🎁';
    const { opener } = setup(() => Promise.reject(new ApiRequestError('CONFLICT', message)));
    await expect(opener.open('map-1', '2026-10-12', () => true)).resolves.toEqual({
      kind: 'failed',
      message,
    });
  });

  it('opens once for a double tap', async () => {
    const reply = deferred<HouseView>();
    const { opener, spy } = setup(() => reply.promise);
    const first = opener.open('map-1', '2026-10-12', () => true);
    expect(opener.busy).toBe(true);
    await expect(opener.open('map-1', '2026-10-12', () => true)).resolves.toEqual({
      kind: 'dropped',
    });
    reply.resolve(opened);
    await expect(first).resolves.toMatchObject({ kind: 'opened' });
    expect(spy).toHaveBeenCalledTimes(1);
    expect(opener.busy).toBe(false);
  });

  it('sends no retry and drops the reply once the player has left the house', async () => {
    let wanted = true;
    const { opener, spy } = setup(() => {
      wanted = false;
      return Promise.reject(offline());
    });
    await expect(opener.open('map-1', '2026-10-12', () => wanted)).resolves.toEqual({
      kind: 'dropped',
    });
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('takes a reply with no gift (yesterday’s, until the next read) as opened', async () => {
    const { opener } = setup(() => Promise.resolve({ ...opened, gift: null }));
    const outcome = await opener.open('map-1', '2026-10-11', () => true);
    expect(outcome).toMatchObject({ kind: 'opened', view: { gift: null } });
  });

  it('drops a read that lands after the open’s reply, so the wrapped gift never comes back', async () => {
    const sync = createViewSync();
    let shown: HouseView = wrapped;
    const claim = deferred<HouseView>();
    const { opener } = setup(() => claim.promise);

    // As the screen does it: the open starts and drops reads in flight…
    sync.drop();
    const opening = opener.open('map-1', '2026-10-12', () => true);
    // …but a read starts while it's in flight (the sheet reopened).
    const read = deferred<HouseView>();
    const fresh = sync.begin();
    const reading = read.promise.then((v) => {
      if (fresh()) shown = v;
    });

    claim.resolve(opened);
    const outcome = await opening;
    expect(outcome.kind).toBe('opened');
    sync.drop();
    if (outcome.kind === 'opened') shown = outcome.view;

    // The stale read (the gift still wrapped) lands last and is dropped.
    read.resolve(wrapped);
    await reading;
    expect(shown.gift?.claimed).toBe(true);
  });
});
