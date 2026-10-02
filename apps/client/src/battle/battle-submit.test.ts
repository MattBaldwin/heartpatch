import type { PlayerBattle } from '@heartpatch/shared';
import { describe, expect, it } from 'vitest';
import { ApiRequestError } from '../net/api.js';
import { sendAction, type SubmitDeps } from './battle-submit.js';

const current = { id: 'battle-1', view: { turn: 3 } };
const move = { type: 'move', move: 'test-hush-hum' } as const;
const reply = { id: 'battle-1' } as PlayerBattle;

/** A fake API that answers each call in order; `calls` records what it got. */
function fakeApi(answers: (PlayerBattle | Error)[]) {
  const calls: { key: string; turn: number }[] = [];
  const waits: number[] = [];
  const deps: SubmitDeps = {
    act: (_id, _action, turn, key) => {
      calls.push({ key, turn });
      const answer = answers.shift();
      if (answer instanceof Error) return Promise.reject(answer);
      if (!answer) return Promise.reject(new Error('no answer left'));
      return Promise.resolve(answer);
    },
    newKey: () => 'key-1',
    wait: (ms) => {
      waits.push(ms);
      return Promise.resolve();
    },
    retryAfterMs: 1200,
  };
  return { deps, calls, waits };
}

const offline = () => new ApiRequestError('OFFLINE', 'no signal');

describe('sendAction', () => {
  it('sends once and hands the reply back while the battle is open', async () => {
    const { deps, calls } = fakeApi([reply]);
    expect(await sendAction(deps, current, move, () => true)).toBe(reply);
    expect(calls).toEqual([{ key: 'key-1', turn: 3 }]);
  });

  it('retries once with the same key after an OFFLINE error', async () => {
    const { deps, calls, waits } = fakeApi([offline(), reply]);
    expect(await sendAction(deps, current, move, () => true)).toBe(reply);
    expect(calls.map((c) => c.key)).toEqual(['key-1', 'key-1']);
    expect(waits).toEqual([1200]);
  });

  it('gives up after the second OFFLINE error, and never retries other errors', async () => {
    const { deps, calls } = fakeApi([offline(), offline()]);
    await expect(sendAction(deps, current, move, () => true)).rejects.toMatchObject({
      code: 'OFFLINE',
    });
    expect(calls).toHaveLength(2);
    const conflict = fakeApi([new ApiRequestError('CONFLICT', 'moved on'), reply]);
    await expect(sendAction(conflict.deps, current, move, () => true)).rejects.toMatchObject({
      code: 'CONFLICT',
    });
    expect(conflict.calls).toHaveLength(1);
  });

  it('drops a reply that lands after the player left, and sends no retry then', async () => {
    // The reply arrives after Back was tapped.
    let open = true;
    const late = fakeApi([]);
    late.deps.act = () => {
      open = false;
      return Promise.resolve(reply);
    };
    expect(await sendAction(late.deps, current, move, () => open)).toBeNull();

    // The radio dropped, and the player left during the wait before the retry.
    open = true;
    const left = fakeApi([offline(), reply]);
    left.deps.wait = () => {
      open = false;
      return Promise.resolve();
    };
    expect(await sendAction(left.deps, current, move, () => open)).toBeNull();
    expect(left.calls).toHaveLength(1);

    // The player left before the OFFLINE error even came back: no retry, the error surfaces.
    open = true;
    const gone = fakeApi([]);
    gone.deps.act = () => {
      open = false;
      return Promise.reject(offline());
    };
    await expect(sendAction(gone.deps, current, move, () => open)).rejects.toMatchObject({
      code: 'OFFLINE',
    });
  });
});
