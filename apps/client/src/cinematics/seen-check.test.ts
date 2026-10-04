import type { CinematicState } from '@heartpatch/shared';
import { describe, expect, it } from 'vitest';
import { checkSeen } from './seen-check.js';
import { shouldAutoPlay } from './skip.js';

const seenBefore: CinematicState = { seenAt: '2026-10-04T12:00:00.000Z' };
const neverSeen: CinematicState = { seenAt: null };

/** A fake API that answers each `get` in order; `calls` counts them. */
function fakeApi(answers: (CinematicState | Error)[]) {
  const api = {
    calls: 0,
    get: (): Promise<CinematicState> => {
      api.calls += 1;
      const answer = answers.shift();
      if (answer instanceof Error) return Promise.reject(answer);
      if (!answer) return Promise.reject(new Error('no answer left'));
      return Promise.resolve(answer);
    },
  };
  return api;
}

/** What `setUser` stores: the login prefetch, a failure counting as no answer. */
const prefetch = (answer: CinematicState | Error): Promise<CinematicState | null> =>
  (answer instanceof Error ? Promise.reject(answer) : Promise.resolve(answer)).catch(() => null);

const offline = () => new Error('no signal');

describe('checkSeen', () => {
  it('trusts a prefetched "seen" and asks nothing more (one call in all)', async () => {
    const api = fakeApi([]);
    expect(await checkSeen(api, prefetch(seenBefore), () => true)).toEqual({
      stale: false,
      seen: seenBefore,
    });
    expect(api.calls).toBe(0);
  });

  it('asks again when the prefetch says "not seen" (two calls in all)', async () => {
    // Seen on another device since the login prefetch.
    const api = fakeApi([seenBefore]);
    expect(await checkSeen(api, prefetch(neverSeen), () => true)).toEqual({
      stale: false,
      seen: seenBefore,
    });
    expect(api.calls).toBe(1);
  });

  it('keeps "not seen" for a brand-new player, so the story plays', async () => {
    const api = fakeApi([neverSeen]);
    const result = await checkSeen(api, prefetch(neverSeen), () => true);
    expect(result).toEqual({ stale: false, seen: neverSeen });
    expect(!result.stale && shouldAutoPlay(result.seen)).toBe(true);
  });

  it('asks again when the prefetch failed, and uses that answer', async () => {
    const api = fakeApi([neverSeen]);
    expect(await checkSeen(api, prefetch(offline()), () => true)).toEqual({
      stale: false,
      seen: neverSeen,
    });
    expect(api.calls).toBe(1);
  });

  it('asks once when there was no prefetch at all', async () => {
    const api = fakeApi([seenBefore]);
    expect(await checkSeen(api, null, () => true)).toEqual({ stale: false, seen: seenBefore });
    expect(api.calls).toBe(1);
  });

  it('gives no answer when both calls fail, so play goes on with no story (decision A)', async () => {
    const api = fakeApi([offline()]);
    const result = await checkSeen(api, prefetch(offline()), () => true);
    expect(result).toEqual({ stale: false, seen: null });
    expect(api.calls).toBe(1);
    expect(!result.stale && shouldAutoPlay(result.seen)).toBe(false);
  });

  it("drops the old account's prefetch when the player logs out mid-prefetch", async () => {
    let session = 1;
    let land: (state: CinematicState) => void = () => undefined;
    const early = new Promise<CinematicState | null>((resolve) => {
      land = resolve;
    });
    const api = fakeApi([]);
    const pending = checkSeen(api, early, () => session === 1);
    session += 1; // logged out (setUser) before the prefetch landed
    land(seenBefore);
    expect(await pending).toEqual({ stale: true });
    // Nothing more is asked for an account that's gone.
    expect(api.calls).toBe(0);
  });

  it('drops the re-ask too when the player logs out while it is in flight', async () => {
    let session = 1;
    const api = {
      calls: 0,
      get: (): Promise<CinematicState> => {
        api.calls += 1;
        session += 1; // logged out while this call was out
        return Promise.resolve(seenBefore);
      },
    };
    expect(await checkSeen(api, prefetch(neverSeen), () => session === 1)).toEqual({
      stale: true,
    });
    expect(api.calls).toBe(1);
  });
});
