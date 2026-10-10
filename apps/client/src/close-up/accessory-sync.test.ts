import type { SetAccessoryResponse } from '@heartpatch/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiRequestError } from '../net/api.js';
import { AccessorySync } from './accessory-sync.js';

const SEND_AFTER = 400;
const ID = '00000000-0000-7000-8000-000000000001';

/** A server the test answers by hand, so it can act while a send is on its way. */
function setup(kept: string | null = null) {
  const sent: (string | null)[] = [];
  const replies: { resolve: (r: SetAccessoryResponse) => void; reject: (e: unknown) => void }[] =
    [];
  const errors: string[] = [];
  const keptLines: (string | null)[] = [];
  let changes = 0;
  const sync = new AccessorySync({
    put: (itemId) => {
      sent.push(itemId);
      return new Promise<SetAccessoryResponse>((resolve, reject) => {
        replies.push({ resolve, reject });
      });
    },
    newKey: () => 'key',
    wait: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    retryAfterMs: 1000,
    sendAfterMs: SEND_AFTER,
    onChange: () => (changes += 1),
    onKept: (itemId) => keptLines.push(itemId),
    onError: (message) => errors.push(message),
  });
  sync.load(kept);
  /** Settles send `i` (default: the latest) and lets its callbacks run. */
  const answer = async (reply: string | null | Error, i = replies.length - 1) => {
    const pending = replies[i]!;
    if (reply instanceof Error) pending.reject(reply);
    else pending.resolve({ squishyId: ID, accessory: reply });
    await vi.advanceTimersByTimeAsync(0);
  };
  return { sync, sent, errors, keptLines, answer, changes: () => changes };
}

const refused = () => new ApiRequestError('FORBIDDEN', "You don't have that one yet.");

describe('AccessorySync (Dress up, #340)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('shows a tap at once and sends it after a pause, once', async () => {
    const { sync, sent, keptLines, answer } = setup();
    sync.choose('tiny-bow');
    sync.choose('tiny-crown');
    expect(sync.shown).toBe('tiny-crown');
    expect(sent).toEqual([]);
    await vi.advanceTimersByTimeAsync(SEND_AFTER);
    expect(sent).toEqual(['tiny-crown']);
    await answer('tiny-crown');
    expect(sync).toMatchObject({ kept: 'tiny-crown', shown: 'tiny-crown', sending: false });
    expect(keptLines).toEqual(['tiny-crown']);
  });

  it('sends nothing when the tap lands back on what the server kept', async () => {
    const { sync, sent } = setup('tiny-bow');
    sync.choose('tiny-crown');
    sync.choose('tiny-bow');
    await vi.advanceTimersByTimeAsync(SEND_AFTER);
    expect(sent).toEqual([]);
    expect(sync.sending).toBe(false);
  });

  it('rolls a refused choice back to what the server kept', async () => {
    const { sync, errors, keptLines, answer } = setup('tiny-bow');
    sync.choose('tiny-crown');
    await vi.advanceTimersByTimeAsync(SEND_AFTER);
    await answer(refused());
    expect(sync).toMatchObject({ kept: 'tiny-bow', shown: 'tiny-bow', sending: false });
    expect(errors).toEqual(["You don't have that one yet."]);
    expect(keptLines).toEqual([]);
  });

  it('sends one at a time: a tap while one is on its way goes next', async () => {
    const { sync, sent, keptLines, answer } = setup();
    sync.choose('tiny-bow');
    await vi.advanceTimersByTimeAsync(SEND_AFTER);
    sync.choose('tiny-crown');
    await vi.advanceTimersByTimeAsync(SEND_AFTER);
    // Still one request: the crown waits for the bow's answer.
    expect(sent).toEqual(['tiny-bow']);
    await answer('tiny-bow');
    // The bow's answer doesn't pull the crown off what's shown.
    expect(sync).toMatchObject({ kept: 'tiny-bow', shown: 'tiny-crown' });
    expect(keptLines).toEqual([]);
    await vi.advanceTimersByTimeAsync(SEND_AFTER);
    expect(sent).toEqual(['tiny-bow', 'tiny-crown']);
    await answer('tiny-crown');
    expect(sync).toMatchObject({ kept: 'tiny-crown', shown: 'tiny-crown', sending: false });
    expect(keptLines).toEqual(['tiny-crown']);
  });

  it('a refusal while another tap waits rolls back to the latest kept piece', async () => {
    const { sync, sent, answer } = setup('tiny-bow');
    sync.choose('tiny-crown');
    await vi.advanceTimersByTimeAsync(SEND_AFTER);
    sync.choose('pumpkin-cap');
    await answer(refused());
    // Back to what the server kept; the waiting tap is dropped with it.
    expect(sync).toMatchObject({ kept: 'tiny-bow', shown: 'tiny-bow', sending: false });
    await vi.advanceTimersByTimeAsync(SEND_AFTER * 2);
    expect(sent).toEqual(['tiny-crown']);
  });

  it('a fresh read leaves a tap not sent yet on, and updates what was kept', () => {
    const { sync } = setup('tiny-bow');
    sync.choose('tiny-crown');
    sync.load('tiny-bow');
    expect(sync).toMatchObject({ kept: 'tiny-bow', shown: 'tiny-crown' });
    const idle = setup('tiny-bow').sync;
    idle.load(null);
    expect(idle).toMatchObject({ kept: null, shown: null });
  });

  it('flush sends a waiting tap now', async () => {
    const { sync, sent } = setup();
    sync.choose('tiny-bow');
    sync.flush();
    await vi.advanceTimersByTimeAsync(0);
    expect(sent).toEqual(['tiny-bow']);
  });

  it('drops a late answer after a reset (another squishy)', async () => {
    const { sync, keptLines, answer, changes } = setup();
    sync.choose('tiny-bow');
    await vi.advanceTimersByTimeAsync(SEND_AFTER);
    sync.reset('snuggle-scarf');
    const before = changes();
    await answer('tiny-bow');
    expect(sync).toMatchObject({ kept: 'snuggle-scarf', shown: 'snuggle-scarf', sending: false });
    expect(keptLines).toEqual([]);
    expect(changes()).toBe(before);
  });
});
