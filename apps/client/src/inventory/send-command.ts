import { ApiRequestError } from '../net/api.js';

/*
 * Sending one bag or gathering command with what a phone needs, as battle
 * actions do (battle/battle-submit.ts): one `Idempotency-Key` per tap, and
 * one retry with that same key when the request never reached the server,
 * so a Collect that did land is replayed ("Yay! +5 Timber") rather than
 * answered "Already collected!". Pure (the API and the clock are passed in).
 */

/** A command that never reached the server is sent once more, with the same key, after this long. */
export const COMMAND_RETRY_MS = 1200; // TUNE: a phone's radio often comes back within a second

export interface SendDeps {
  newKey: () => string;
  wait: (ms: number) => Promise<void>;
  retryAfterMs: number;
}

/**
 * Sends `send(key)`, retrying once after `OFFLINE` with the same key.
 * `stillWanted` is asked after the wait: once the player has moved on (another
 * map, logout), no retry is sent and the result is null.
 */
export async function sendCommand<T>(
  deps: SendDeps,
  send: (key: string) => Promise<T>,
  stillWanted: () => boolean,
): Promise<T | null> {
  const key = deps.newKey();
  try {
    return await send(key);
  } catch (err) {
    if (!(err instanceof ApiRequestError) || err.code !== 'OFFLINE' || !stillWanted()) throw err;
    await deps.wait(deps.retryAfterMs);
    if (!stillWanted()) return null;
    return send(key);
  }
}
