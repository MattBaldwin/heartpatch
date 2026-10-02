import type { Wardrobe } from '@heartpatch/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiRequestError } from '../../net/api.js';
import { OutfitSync } from './outfit-sync.js';

const SEND_AFTER = 700;

const wardrobe = (wearing: string[]): Wardrobe => ({
  owned: ['sunny-cap', 'witch-hat', 'puddle-boots'].map((itemId) => ({ itemId, count: 1 })),
  wearing,
  presets: [],
});

/** A server the test answers by hand, so it can act while a send is on its way. */
function setup() {
  const sent: { wearing: string[]; key: string }[] = [];
  const replies: { resolve: (w: Wardrobe) => void; reject: (e: unknown) => void }[] = [];
  const errors: string[] = [];
  let keys = 0;
  const sync = new OutfitSync({
    wear: (wearing, key) => {
      sent.push({ wearing: [...wearing], key });
      return new Promise<Wardrobe>((resolve, reject) => {
        replies.push({ resolve, reject });
      });
    },
    newKey: () => `key-${String((keys += 1))}`,
    wait: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    retryAfterMs: 1000,
    sendAfterMs: SEND_AFTER,
    onChange: () => undefined,
    onError: (message) => errors.push(message),
  });
  sync.load(wardrobe([]));
  /** Settles the latest send and lets its callbacks run. */
  const answer = async (reply: Wardrobe | Error) => {
    const pending = replies.at(-1)!;
    if (reply instanceof Error) pending.reject(reply);
    else pending.resolve(reply);
    await vi.advanceTimersByTimeAsync(0);
  };
  return { sync, sent, errors, answer };
}

describe('OutfitSync (optimistic try-on)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('dresses at once and sends a flurry of taps as one outfit after a pause', async () => {
    const { sync, sent, answer } = setup();
    sync.tryOn('sunny-cap');
    expect(sync.trying).toEqual(['sunny-cap']);
    await vi.advanceTimersByTimeAsync(SEND_AFTER - 100);
    sync.tryOn('puddle-boots');
    await vi.advanceTimersByTimeAsync(SEND_AFTER - 100);
    sync.tryOn('witch-hat'); // swaps the cap out
    expect(sent).toEqual([]);
    expect(sync.sending).toBe(true);

    await vi.advanceTimersByTimeAsync(SEND_AFTER);
    expect(sent.map((s) => s.wearing)).toEqual([['witch-hat', 'puddle-boots']]);
    await answer(wardrobe(['witch-hat', 'puddle-boots']));
    expect(sync.server?.wearing).toEqual(['witch-hat', 'puddle-boots']);
    expect(sync.sending).toBe(false);
    expect(sync.sends).toBe(1);
  });

  it("doesn't send an outfit the server already has", async () => {
    const { sync, sent } = setup();
    sync.tryOn('sunny-cap');
    sync.tryOn('sunny-cap'); // on, then off again
    await vi.advanceTimersByTimeAsync(SEND_AFTER);
    expect(sent).toEqual([]);
  });

  it('keeps taps made while a send is on its way, and sends them next', async () => {
    const { sync, sent, answer } = setup();
    sync.tryOn('sunny-cap');
    await vi.advanceTimersByTimeAsync(SEND_AFTER);
    sync.tryOn('puddle-boots'); // while the first is in flight
    await answer(wardrobe(['sunny-cap']));
    expect(sync.trying).toEqual(['sunny-cap', 'puddle-boots']);
    await vi.advanceTimersByTimeAsync(SEND_AFTER);
    expect(sent.map((s) => s.wearing)).toEqual([['sunny-cap'], ['sunny-cap', 'puddle-boots']]);
  });

  it('rolls back to what the server kept when it refuses, and says why', async () => {
    const { sync, errors, answer } = setup();
    sync.tryOn('sunny-cap');
    await vi.advanceTimersByTimeAsync(SEND_AFTER);
    await answer(wardrobe(['sunny-cap']));
    sync.tryOn('witch-hat');
    await vi.advanceTimersByTimeAsync(SEND_AFTER);
    await answer(new ApiRequestError('FORBIDDEN', "You don't have that one yet. Keep exploring!"));
    expect(sync.trying).toEqual(['sunny-cap']);
    expect(errors).toEqual(["You don't have that one yet. Keep exploring!"]);
    expect(sync.sending).toBe(false);
  });

  it('retries once, with the same key, when the send never reached the server', async () => {
    const { sync, sent, answer } = setup();
    sync.tryOn('sunny-cap');
    await vi.advanceTimersByTimeAsync(SEND_AFTER);
    await answer(new ApiRequestError('OFFLINE', 'offline'));
    await vi.advanceTimersByTimeAsync(1000);
    expect(sent.map((s) => s.key)).toEqual(['key-1', 'key-1']);
    await answer(wardrobe(['sunny-cap']));
    expect(sync.server?.wearing).toEqual(['sunny-cap']);
  });

  it('drops taps not sent yet when a preset goes on instead', async () => {
    const { sync, sent } = setup();
    sync.tryOn('sunny-cap');
    sync.wore(wardrobe(['witch-hat']));
    await vi.advanceTimersByTimeAsync(SEND_AFTER * 2);
    expect(sent).toEqual([]);
    expect(sync.trying).toEqual(['witch-hat']);
  });

  it('sends waiting taps at once on close, and forgets everything on logout', async () => {
    const { sync, sent, answer } = setup();
    sync.tryOn('sunny-cap');
    sync.flush();
    await vi.advanceTimersByTimeAsync(0);
    expect(sent).toHaveLength(1);
    sync.reset();
    await answer(wardrobe(['sunny-cap'])); // a late answer for the old player
    expect(sync.server).toBeNull();
    expect(sync.trying).toEqual([]);
  });
});
